// fetch-market.mjs — 免费数据采集（全部免 Key 公共接口）
// 数据源：腾讯行情 qt.gtimg.cn / 东方财富 push2 + push2ex
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

const UT = '7eea3edcaed734bea9cbfc24409ed989';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function cnNow() {
  // 返回北京时间 yyyy-mm-dd hh:mm:ss / 及 yyyymmdd
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const g = (t) => p.find((x) => x.type === t).value;
  const date = `${g('year')}-${g('month')}-${g('day')}`;
  const time = `${g('hour')}:${g('minute')}:${g('second')}`;
  return { date, time, ymd: date.replaceAll('-', '') };
}

async function http(url, tries = 3) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return res;
    } catch (e) { lastErr = e; if (i < tries) await sleep(700 * i); }
  }
  throw lastErr;
}

// ---------- 腾讯行情（GB18030/latin1 容错；数字为 ASCII 不受影响） ----------
export async function fetchTencent(codes) {
  const url = `https://qt.gtimg.cn/q=${codes.join(',')}`;
  const buf = Buffer.from(await (await http(url)).arrayBuffer());
  let text;
  try { text = new TextDecoder('gb18030').decode(buf); }
  catch { text = buf.toString('latin1'); } // 无ICU时：中文名会乱码，但价格/涨跌/时间戳(ASCII)完好
  const out = [];
  const re = /v_(\w+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(text))) {
    const t = m[2].split('~');
    const tsIdx = t.findIndex((x) => /^\d{12,14}$/.test(x));
    if (tsIdx < 0) continue;
    out.push({
      code: m[1], name: t[1] || '', price: parseFloat(t[3]),
      prev: parseFloat(t[4]), chg: parseFloat(t[tsIdx + 1]),
      pct: parseFloat(t[tsIdx + 2]), high: parseFloat(t[tsIdx + 3]),
      low: parseFloat(t[tsIdx + 4]), ts: t[tsIdx],
    });
  }
  return out;
}

// 东财接口多域名容灾（主域名偶发不可达时自动切换备用域名）
const EM_HOSTS = [
  'https://push2.eastmoney.com',
  'https://push2delay.eastmoney.com',
  'https://82.push2.eastmoney.com',
];
async function emGet(pathAndQuery) {
  let lastErr;
  for (const host of EM_HOSTS) {
    try { return await (await http(`${host}${pathAndQuery}`, 1)).json(); }
    catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// ---------- 东财指数/成交额（f6=成交额元） ----------
// secids: 1.000001 上证 / 0.399106 深证综指(全深市) / 0.899050 北证50
export async function fetchEmUlist(secids, fields = 'f2,f3,f4,f6,f12,f14') {
  const j = await emGet(`/api/qt/ulist.np/get?fltt=2&invt=2&secids=${secids.join(',')}&fields=${fields}`);
  return (j.data && j.data.diff) || [];
}

// ---------- 板块资金（行业 m:90+t:2 / 概念 m:90+t:3） ----------
export async function fetchBoardFlow(fs, dir = 'desc', pz = 100, maxPages = 6) {
  const rows = [];
  for (let pn = 1; pn <= maxPages; pn++) {
    const j = await emGet(`/api/qt/clist/get?fid=f62&po=${dir === 'desc' ? 1 : 0}&pz=${pz}&pn=${pn}&np=1&fltt=2&invt=2&fs=${fs}&fields=f12,f14,f62,f3,f184`);
    const diff = (j.data && j.data.diff) || [];
    rows.push(...diff.map((d) => ({
      code: d.f12, name: d.f14, net: Math.round(d.f62 / 1e8 * 100) / 100, // 亿元
      pct: d.f3, netPct: d.f184,
    })));
    if (!j.data || pn * pz >= j.data.total) break;
    await sleep(150);
  }
  return rows;
}

// 概念板块里的“标签类”噪音（非真题材）
const JUNK = ['融资融券', '深股通', '沪股通', '富时罗素', 'MSCI中国', '标普道琼斯A股',
  '预盈预增', '预亏预减', '机构重仓', '昨日涨停', '昨日连板', '昨日触板', '转债标的',
  'AH股', '低价股', '高送转', '参股银行', '破净股', 'QFII重仓', '社保重仓', '基金重仓',
  '百元股', '注册制次新股', '次新股'];

export function cleanConcept(rows, n = 3) {
  const out = [];
  for (const r of rows) {
    if (JUNK.some((k) => r.name.includes(k))) continue;
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}

// ---------- 涨跌分布（涨/跌/平家数） ----------
export async function fetchBreadth() {
  const url = `https://push2ex.eastmoney.com/getTopicZDFenBu?ut=${UT}&dpt=wz.ztzt`;
  const j = await (await http(url)).json();
  const fenbu = (j.data && j.data.fenbu) || [];
  let up = 0, down = 0, flat = 0;
  for (const b of fenbu) {
    const k = parseFloat(Object.keys(b)[0]);
    if (k > 0) up += b[Object.keys(b)[0]];
    else if (k < 0) down += b[Object.keys(b)[0]];
    else flat += b[Object.keys(b)[0]];
  }
  return { up, down, flat, date: j.data?.qdate };
}

// ---------- 涨停/跌停家数 ----------
async function fetchTopicPool(type, dateYmd) {
  try {
    const url = `https://push2ex.eastmoney.com/getTopic${type}Pool?ut=${UT}&dpt=wz.ztzt&Pageindex=0&pagesize=1&sort=fund:asc&date=${dateYmd}`;
    const j = await (await http(url)).json();
    return j.data ? (j.data.tc ?? j.data.dtc ?? null) : null;
  } catch { return null; }
}
export async function fetchLimits(dateYmd) {
  const [zt, dt] = await Promise.all([
    fetchTopicPool('ZT', dateYmd),
    fetchTopicPool('DT', dateYmd),
  ]);
  return { limitUp: zt, limitDown: dt };
}

export function loadJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { return null; }
}
export function saveJson(rel, obj) {
  fs.writeFileSync(path.join(ROOT, rel), JSON.stringify(obj, null, 2), 'utf8');
}