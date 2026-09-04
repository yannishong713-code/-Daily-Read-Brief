# 老马每日必读 · GitHub 自动版

每天 15:35（北京时间，交易日）由 GitHub Actions 自动抓取收盘数据 → 本地规则引擎生成 AI 分析 → 重建页面并自动发布。
你只需在手机上打开网址，**每次都是最新内容**；盘中打开还会实时刷新 12 只持仓 + 4 大指数的价格。

## 为什么零成本？

| 环节 | 用什么 | 费用 |
|---|---|---|
| 托管网页 | GitHub Pages（仓库设为**公开**） | 免费 |
| 定时任务 | GitHub Actions（公开仓库额度内） | 免费 |
| 行情/资金/涨跌数据 | 腾讯行情 qt.gtimg.cn + 东方财富 push2（公开接口，免 Key） | 免费 |
| AI 分析 | 本地规则引擎（按你的纪律逻辑自动判断，无需任何模型） | 免费 |
| （可选）AI 总评润色 | 若你在仓库 Secrets 填了 LLM Key 才调用，不填则纯本地 | 用你自己的 Key |

> 页面所有“事实”来自免费公开接口；“判断/动作”来自内置规则引擎，**不编造数据**，采集失败时页面显示“暂无数据”。

## 目录结构

```
laoma-daily/
├─ index.html            ← 手机访问的页面（每天自动重建，含最新快照）
├─ index.template.html   ← 页面模板（保留占位符，勿手改生成件）
├─ config.json           ← 你的持仓/经济/政策注记/重要日历（唯一需要人工维护的文件）
├─ data/snapshot.json    ← 每次运行的快照存档
├─ scripts/
│  ├─ update.mjs         ← 一键：抓数→分析→重建页面（Actions 调用它）
│  ├─ fetch-market.mjs   ← 免费数据源采集
│  └─ analyze.mjs        ← 0成本规则引擎（判断/阶段/12只动作/操作）
└─ .github/workflows/refresh.yml  ← 每交易日 15:35 自动运行
```

## 第一次部署（约 5 分钟）

1. **GitHub 新建一个「公开」仓库**，名字建议 `laoma-daily`（公开仓库的 Pages 和 Actions 才完全免费）。
2. 把本文件夹**全部内容**作为仓库根目录推送（含 `.github` 隐藏目录）：
   ```bash
   cd laoma-daily
   git init
   git add -A
   git commit -m "init"
   git branch -M main
   git remote add origin https://github.com/<你的用户名>/laoma-daily.git
   git push -u origin main
   ```
   （不想用命令行：也可在 GitHub 网页仓库里点 Add file → Upload files，把整个文件夹内容拖进去。）
3. **开启 Pages**：仓库 Settings → Pages → Source 选 **Deploy from a branch** → 分支 `main` / 目录 `/(root)` → Save。等约 1 分钟。
4. 打开 **https://\<你的用户名\>.github.io/laoma-daily/** —— 页面此时已带实时行情。
5. **手动跑一次**：仓库 Actions → 左侧 `laoma-daily 盘后自动更新` → Run workflow。成功后盘后快照/AI 判断即注入页面。
6. 之后无需任何操作：**每个交易日 15:35 自动更新**（脚本自动跳过周末/休市）。
7. 手机浏览器打开网址 → 收藏，或用“添加到主屏幕”，每天一点开即最新。

## 日常维护（想改才改）

| 想做什么 | 操作 |
|---|---|
| 换持仓/加备注/改重要日历 | 编辑 `config.json` → 推送（push 也会自动重建一次页面） |
| 更新经济/政策注记 | 改 `config.json` 的 `notes`（建议每月末核对 PMI、每周核对政策） |
| 手动立即更新 | 仓库 Actions → Run workflow |
| 加 AI 总评润色 | 仓库 Settings → Secrets 添加 `LLM_API_KEY`、`LLM_BASE_URL`（OpenAI 兼容）、`LLM_MODEL` |

## 页面里有什么（按你的固定模板）

今日判断（进攻/观望/防守/等待机会）→ 指数与市场宽度 → 三大变量（经济/政策/资金）→ 资金 TOP3 与被抛弃 → 12 只持仓动作（🟢加仓/逢跌加 · 🟡持有/等待 · 🟠减仓）→ 赚钱周期 1-5 → 明日机会信号 → 🎯今日操作 → 未来时间窗口。
红涨绿跌；盘中价格每 60 秒自动刷新一次；事实/判断有颜色标签区分。

## 常见问题

- **休市不更新？** 正常。脚本判断到非交易日会自动跳过，页面保留最近一次快照，价格显示“上一交易日定格”。
- **15:35 后页面还没变？** Actions 排队约需 1-10 分钟，稍后下拉刷新即可。
- **某天数据抓取失败？** 页面该栏显示“暂无数据”而不是乱编。可在 Actions 日志里看原因，或手动 Run workflow 重试。
- **想完全私有？** Pages 免费版不支持私有仓库，公开仓库是零成本的前提。页面只含市场公开数据与规则建议，不含隐私。

## 免责声明

页面由本地规则引擎自动生成，仅为个人复盘工具，不构成投资建议。市场有风险，决策需谨慎。
