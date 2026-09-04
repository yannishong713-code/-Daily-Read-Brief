// analyze.mjs — 零成本本地规则引擎（不调用任何 LLM API）
// 依据用户既定规则：只有"经济稳/政策发力+资金放量+板块持续"才提高仓位；存量市卖弱买强不加总仓。
export default function analyze(d, cfg) {
  const { market, breadth, boards, fund, notes } = d;
  // 合并 config 中的 kind/kw（快照行情里没有），供板块联动检测使用
  const cfgEtfs = (cfg.etfs || []).reduce((o, c) => (o[c.code] = c, o), {});
  const etfs = (d.etfs || []).map((e) => ({ ...e, ...(cfgEtfs[e.code] || {}) }));

  const idxAvg = market.length ? market.reduce((s, x) => s + x.pct, 0) / market.length : 0;
  const total = (breadth.up || 0) + (breadth.down || 0);
  const breadthUp = total ? (breadth.up / total) * 100 : null;
  const turnover = fund.turnover ?? null;
  const turnoverPrev = fund.turnoverPrev ?? null;
  const turnRatio = turnover && turnoverPrev ? turnover / turnoverPrev : null; // >1 放量
  const industryTop = boards.industryTop || [];
  const industryOut = boards.industryOut || [];
  const conceptTop = boards.conceptTop || [];
  const topNames = [...industryTop.map((b) => b.name), ...conceptTop.map((b) => b.name)];
  const outNames = industryOut.map((b) => b.name);

  // ---- 三变量打分 ----
  let econ = notes?.economy ?? '暂无数据'; // 人工维护，默认中性偏弱
  let pol = notes?.policy ?? '暂无数据';
  let econScore = /荣枯线|偏弱|下行/.test(econ) ? -1 : 0; // 弱经济
  let polScore = /增量|发力|宽松|降准|降息|加码/.test(pol) ? 1 : 0; // 政策发力
  const fundStrong = (fund.marketNet ?? 0) > 80 || turnRatio > 1.08; // 资金放量
  const netTxt = fund.marketNet == null ? '暂无数据' :
    `主力${fund.marketNet >= 0 ? '净流入' : '净流出'} ${Math.abs(fund.marketNet)} 亿`;
  const boardsHot = topNames.some((n) => [...etfs].some((e) => (e.kw || []).some((k) => n.includes(k)))); // 板块持续(命中持仓)

  const score = idxAvg * 0.4 + ((breadthUp ?? 50) - 50) * 0.03 + (fundStrong ? 1.2 : 0) + (boardsHot ? 0.8 : 0) + econScore * 0.3 + polScore * 0.5;

  // ---- 赚钱周期 1..5：1冰点 2启动 3进攻 4分歧 5退潮 ----
  let phase = 3;
  if (idxAvg <= -1.8 || (breadthUp !== null && breadthUp <= 22) || fund.marketNet <= -250) phase = 5;
  else if (idxAvg <= -0.6 || (breadthUp !== null && breadthUp <= 38)) phase = 4;
  else if (idxAvg >= 0.8 && breadthUp !== null && breadthUp >= 62 && fundStrong) phase = 2;
  else if (idxAvg >= 0.3 && fundStrong) phase = 1;
  const phaseName = ['底部孕育', '修复启动', '趋势进攻', '高位分歧', '退潮防守'][phase - 1];

  // ---- 今日判断 ----
  let judgment;
  if (idxAvg <= -1.5 || fund.marketNet <= -200 || phase === 5) judgment = '防守';
  else if (score <= -0.5 || breadthUp < 40) judgment = '等待机会';
  else if (fundStrong && boardsHot && polScore > 0 && econScore <= 0 && idxAvg >= -0.3 && breadthUp >= 45) judgment = '进攻';
  else judgment = '观望';

  // ---- ETF 动作 ----
  const etfActs = etfs.map((e) => {
    let act = '持有', why = '';
    const themeHit = (e.kw || []).some((k) => topNames.some((n) => n.includes(k)));
    const themeOut = (e.kw || []).some((k) => outNames.some((n) => n.includes(k)));
    const deepRed = e.pct <= -2.3;
    const weak = idxAvg < -0.5 || fund.marketNet < -60;
    if (e.kind === '防御' || e.kind === '对冲') {
      if (weak) { act = '加仓'; why = `弱势避险方向：主力净流出${fund.marketNet}亿、指数均值${idxAvg.toFixed(2)}%`; }
      else { act = '持有'; why = '市场不弱，防御仓维持'; }
    } else if (e.kind === '海外') {
      if (deepRed) { act = '等待'; why = `跌幅${e.pct.toFixed(2)}%较深，境外盘隔夜变量未明`; }
      else { act = '持有'; why = '跟随外盘，当前波动正常'; }
    } else { // A成长
      if (themeHit && idxAvg >= -0.3 && !themeOut) { act = '加仓'; why = '所属题材进入资金TOP3，板块持续'; }
      else if (themeOut) {
        if (weak) { act = '减仓'; why = '所属板块被资金抛弃且市场转弱，卖弱'; }
        else if (e.pct <= -1.5) { act = '等待'; why = `所属板块资金流出，个股回调${Math.abs(e.pct).toFixed(1)}%先观察`; }
        else { act = '持有'; why = '所属板块被抛弃但盘面整体偏强，暂持观察轮动'; }
      }
      else if (deepRed && !weak) { act = '逢跌加'; why = `回调${Math.abs(e.pct).toFixed(1)}%但非全面出逃，按纪律分批`; }
      else if (deepRed && weak) { act = '等待'; why = `回调${Math.abs(e.pct).toFixed(1)}%且市场整体弱，先看企稳`; }
      else if (idxAvg <= -0.8) { act = '等待'; why = '大盘弱，反弹确认前不动'; }
      else { act = '持有'; why = '无明确加减信号'; }
    }
    return { code: e.code, name: e.name, pct: e.pct, act, why };
  });

  // ---- 明日机会信号 ----
  const signals = [];
  const hot = [...industryTop, ...conceptTop];
  if (hot.length) signals.push(`资金主攻：${hot.slice(0, 3).map((b) => `${b.name}+${b.net}亿`).join('、')}`);
  if (boardsHot) signals.push('资金TOP3命中你持仓方向，题材有持续性，留意回踩加仓点');
  if (breadthUp !== null && breadthUp >= 55 && fund.marketNet > 0) signals.push('上涨家数占比高且主力净流入，情绪修复，可关注放量板块');
  if (fundStrong && turnRatio) signals.push(`成交较上日${turnRatio >= 1 ? '放量' : '缩量'}${turnRatio >= 1 ? '+' : ''}${((turnRatio - 1) * 100).toFixed(0)}%，资金活性${turnRatio >= 1 ? '提升' : '下降'}`);
  if (!signals.length) signals.push('暂无数据（规则引擎未识别到显著信号）');

  // ---- 🎯 今日操作 ----
  let position, cash, swap, when;
  const heldN = etfs.length;
  if (judgment === '防守') { position = '总仓位≤50%'; cash = '现金≥50%'; }
  else if (judgment === '进攻') { position = '总仓位70-80%'; cash = '现金20-30%'; }
  else if (judgment === '观望') { position = '总仓位55-65%'; cash = '现金35-45%'; }
  else { position = '总仓位≤55%，空仓等待为主'; cash = '现金≥45%'; }
  const cut = etfActs.filter((x) => x.act === '减仓').map((x) => x.name);
  const add = etfActs.filter((x) => x.act === '加仓' || x.act === '逢跌加').map((x) => x.name);
  swap = cut.length || add.length
    ? `卖弱买强：考虑 ${cut.length ? '减 ' + cut.join('、') : '暂无减仓'}；${add.length ? '加/逢跌加 ' + add.join('、') : '暂无加仓'}；存量市不加总仓`
    : '维持现有组合，暂不换仓（存量市卖弱买强不加总仓）';
  when = /(15:|1[4-9]:)/.test(d.meta.generatedAt || '') || d.meta.label === '盘后'
    ? '明日开盘执行' : '收盘后/尾盘再确认，避免盘中追价';

  return {
    judgment,
    reasons: {
      idxAvg: `四大指数均值 ${idxAvg.toFixed(2)}%`,
      breadth: breadthUp === null ? '宽度：暂无数据' : `上涨占比 ${breadthUp.toFixed(0)}%（涨${breadth.up}/跌${breadth.down}）`,
      fund: fund.marketNet == null ? '全市场主力：暂无数据（采集失败，不编造）'
        : `全市场主力 ${fund.marketNet} 亿` + (turnRatio ? `，成交${turnRatio >= 1 ? '放量' : '缩量'}至 ${(turnover / 1e8).toFixed(0)} 亿` : ''),
      boardsHot: boardsHot ? '板块持续：资金TOP3命中持仓方向' : '板块持续：未命中持仓方向',
    },
    threeVars: {
      economy: { text: econ, tag: /荣枯线|偏弱|下行/.test(econ) ? '偏弱' : '中性' },
      policy: { text: pol, tag: polScore > 0 ? '发力' : '中性/观察' },
      capital: {
        text: netTxt + (turnRatio ? `｜成交较上日${turnRatio >= 1 ? '放量' : '缩量'}${((turnRatio - 1) * 100).toFixed(0)}%` : ''),
        tag: fund.marketNet == null ? '暂无数据' : (fundStrong ? '资金活跃' : '资金平淡'),
      },
    },
    phase: { n: phase, name: phaseName, note: `阶段${phase}/5：${phaseName}。仅当资金放量+板块持续+宽度修复同时出现才升仓` },
    operation: { position, cash, swap, when },
    signals,
    etfs: etfActs,
    capNote: '判断由本地规则引擎按既定纪律生成（0成本，无LLM），非投资建议。',
  };
}
