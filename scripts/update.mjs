// update.mjs — 采集→分析→更新 snapshot.json→重建 index.html（可被 GitHub Actions 调用）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOT, cnNow, fetchTencent, fetchEmUlist, fetchBoardFlow, cleanConcept,
  fetchBreadth, fetchLimits, loadJson, saveJson,
} from './fetch-market.mjs';
import analyze from './analyze.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const cfg = loadJson('config.json') || {};
  const now = cnNow();
  // 手动指定交易日（测试用）：FORCE_DATE=20260904
  const todayYmd = process.env.FORCE_DATE || now.ymd;
  const weekday = new Date(`${todayYmd.slice(0, 4)}-${todayYmd.slice(4, 6)}-${todayYmd.slice(6)}T12:00:00+08:00`).getDay();
  if (!process.env.FORCE_DATE && (weekday === 0 || weekday === 6)) {
    console.log('休市：周末，不更新。'); return;
  }

  // 1) 行情
  const idxCodes = (cfg.indices || []).map((x) => x.code);
  const etfCodes = (cfg.etfs || []).map((x) => x.code);
  const [tenAll] = await Promise.all([fetchTencent([...idxCodes, ...etfCodes])]);
  const tenIdx = tenAll.filter((t) => idxCodes.includes(t.code));
  const tenEtf = tenAll.filter((t) => etfCodes.includes(t.code));

  // 交易日守卫：行情时间戳日期 != 今天 → 休市
  const q = tenIdx[0];
  const qDate = q?.ts?.slice(0, 8);
  if (qDate && qDate !== todayYmd && !process.env.FORCE_DATE) {
    console.log(`休市：行情停留在 ${qDate}（今天 ${todayYmd} 无交易）。不更新。`);
    return;
  }

  // 2) 两市成交额（沪 1.000001 + 深市全市场 0.399106）
  let turnover = null;
  try {
    const ul = await fetchEmUlist(['1.000001', '0.399106']);
    turnover = ul.reduce((s, x) => s + (x.f6 || 0), 0); // 元
  } catch { /* 保底：由腾讯分时量估算失败则 null */ }

  // 3) 宽度 / 涨停跌停
  let breadth = {};
  try { breadth = { ...breadth, ...(await fetchBreadth()) }; } catch { breadth = { up: null, down: null, flat: null }; }
  try { breadth = { ...breadth, ...(await fetchLimits(todayYmd)) }; } catch { breadth.limitUp = breadth.limitDown = null; }

  // 4) 板块资金
  let industryDesc = [], industryAsc = [], conceptDesc = [];
  try {
    [industryDesc, industryAsc, conceptDesc] = await Promise.all([
      fetchBoardFlow('m:90+t:2', 'desc', 100, 1),
      fetchBoardFlow('m:90+t:2', 'asc', 100, 1),
      fetchBoardFlow('m:90+t:3', 'desc', 100, 1),
    ]);
  } catch (e) { console.log('板块资金部分失败：', e.message); }
  // 全市场主力净流入 = 行业板块净流入之和（东财口径，行业板块覆盖全市场）
  let marketNetTotal = null;
  try {
    const allInd = await fetchBoardFlow('m:90+t:2', 'desc', 100, 8);
    if (allInd.length) marketNetTotal = Math.round(allInd.reduce((s, b) => s + b.net, 0) * 100) / 100;
  } catch { marketNetTotal = null; } // 失败则不编造，页面上显示暂无数据

  // 5) 近3日历史（仅盘后追加）
  const hour = parseInt(q.ts.slice(8, 10), 10);
  const postClose = qDate === todayYmd && hour >= 15;
  const prev = loadJson('data/snapshot.json') || {};
  const prevTurnover = postClose ? (prev.fund?.turnover ?? null) : null;
  const historyNet = (prev.fund?.historyNet || []).slice(0, 2);
  if (postClose) {
    historyNet.unshift({ date: qDate.slice(0, 4) + '-' + qDate.slice(4, 6) + '-' + qDate.slice(6), net: marketNetTotal });
  }

  // 6) 组装快照
  const idxOut = tenIdx.map((t, i) => ({
    code: t.code, name: cfg.indices[i]?.name || t.name,
    price: t.price, pct: t.pct, chg: t.chg, high: t.high, low: t.low, ts: t.ts,
  }));
  const etfOut = tenEtf.map((t) => {
    const c = cfg.etfs.find((x) => x.code === t.code) || {};
    return { code: t.code, name: c.name || t.name, price: t.price, pct: t.pct, chg: t.chg, ts: t.ts };
  });

  const snapshot = {
    meta: {
      label: postClose ? '盘后' : '盘中预览',
      generatedAt: `${now.date} ${now.time}`,
      tradingDay: qDate ? `${qDate.slice(0, 4)}-${qDate.slice(4, 6)}-${qDate.slice(6)}` : null,
      source: '腾讯行情 + 东方财富（均免费公共接口，无 API 费用）',
      note: postClose ? '收盘快照，由 GitHub Actions 交易日 15:35 自动生成' : '非收盘数据，仅供盘中参考；收盘后自动覆盖',
    },
    market: idxOut,
    breadth: {
      up: breadth.up, down: breadth.down, flat: breadth.flat,
      limitUp: breadth.limitUp, limitDown: breadth.limitDown,
    },
    boards: {
      industryTop: industryDesc.slice(0, 3),
      conceptTop: cleanConcept(conceptDesc, 3),
      industryOut: industryAsc.slice(0, 3),
    },
    fund: {
      marketNet: marketNetTotal,
      turnover, turnoverPrev: prevTurnover,
      historyNet,
    },
    etfs: etfOut,
    notes: cfg.notes || {},
    agenda: (cfg.agenda || []).filter((a) => a.date >= now.date).slice(0, 3),
  };

  // 7) 规则引擎分析
  snapshot.analysis = analyze(snapshot, cfg);

  // 8) 可选：若配置了免费/低价 LLM Key，则生成一段总评（无 Key 自动跳过，零成本）
  if (process.env.LLM_API_KEY && process.env.LLM_BASE_URL) {
    try {
      const j = await fetch(`${process.env.LLM_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LLM_API_KEY}` },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'gpt-4o-mini',
          messages: [{ role: 'user', content:
            `你是A股盘后分析师。请用≤120字概括今日并给明日要点。数据：指数均值${snapshot.analysis.reasons.idxAvg}、${snapshot.analysis.reasons.fund}、判断=${snapshot.analysis.judgment}、阶段${snapshot.analysis.phase.n}/5。直接输出正文，不要客套。` }],
          temperature: 0.4,
        }),
        signal: AbortSignal.timeout(20000),
      });
      const jj = await j.json();
      snapshot.analysis.llm = jj.choices?.[0]?.message?.content?.trim() || null;
    } catch (e) { console.log('LLM 可选增强跳过：', e.message); }
  }

  // 9) 落盘
  saveJson('data/snapshot.json', snapshot);

  // 10) 由模板重建 index.html（替换快照占位符，模板保持可复用）
  const htmlPath = path.join(ROOT, 'index.html');
  const tplPath = path.join(ROOT, 'index.template.html');
  let html = fs.readFileSync(tplPath, 'utf8');
  html = html.replace(/\/\*__SNAPSHOT_JSON__\*\/null/, () => JSON.stringify(snapshot));
  fs.writeFileSync(htmlPath, html, 'utf8');

  console.log(`✅ ${now.date} ${now.time} | 标签=${snapshot.meta.label} | 判断=${snapshot.analysis.judgment} | 阶段=${snapshot.analysis.phase.n}/5 | 主力净流入=${marketNetTotal == null ? '暂无' : marketNetTotal + '亿'} | 涨停=${breadth.limitUp} 跌停=${breadth.limitDown}`);
}

main().catch((e) => { console.error('更新失败：', e); process.exit(1); });
