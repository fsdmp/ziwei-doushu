# ziwei-doushu 线上部署（8.140.235.234 · ziwei.offiai.cn / test-ziwei.offiai.cn）

部署形态：**纯静态站**——Next.js `output: 'export'` 构建出 `out/`，rsync 到 nginx 目录。
无服务进程、无重启、无数据库；AI 解读由前端直连 mistsee 线上后端
（`mistsee.offiai.cn`，见 `lib/ai.ts`——两环境共用同一后端，测试只是换了 H5 站点）。

两个环境**同机**，443 由 APISIX 按域名分流到两个独立 openresty 实例（真实拓扑
见 `deploy/nginx-ziwei.conf` 头注），只按域名与目录区分：

| 环境 | 域名 | APISIX → 实例 | root（rsync 目标） | 发布命令 |
| --- | --- | --- | --- | --- |
| 正式 | `ziwei.offiai.cn` | route `ziwei` → 127.0.0.1:8003（`/usr/local/ziwei-static`） | `/usr/local/ziwei-static/html` | `make release` |
| 测试 | `test-ziwei.offiai.cn` | route `test-ziwei` → 127.0.0.1:8005（`/usr/local/test-ziwei-static`） | `/usr/local/test-ziwei-static/html` | `make release ENV=test` |

证书在 APISIX 侧一张 `*.offiai.cn` 通配符（新子域免签，DNS 指到本机即通）。

> **首次部署记录（2026-11-02，commit 0d0ef11）**：全站静态导出上 nginx，
> 手动 npm run build + 上传。本工具链（Makefile + 本文档）为后续日常发布而建，
> 自下次发布起走 `make release`。

## 日常发布

```bash
make release              # 正式环境：build + rsync + 线上验证（指纹一致 + 关键路径 200）
make release ENV=test     # 测试环境：同流程，目标换成 test-ziwei.offiai.cn
make upload               # 只传不验（构建 + rsync，不碰验证）
make verify               # 只验线上（需本地已有 out/，对比构建指纹）
```

不在开发机旁时也可用服务器侧脚本 `deploy-ziwei` / `deploy-test-ziwei`
（服务器本机构建，注意先 `git pull`，详见下文「服务器侧一键脚本」）。

`ENV`（prod 默认 / test）决定 `SITE` 与 `REMOTE_DIR` 的默认值并注入构建
（`NEXT_PUBLIC_SITE_URL`，压过 `.env.production`——sitemap/canonical/分享链接/
合盘邀请链接全由它取值，两环境各自正确）。其余参数可覆盖：
`make release ENV=test SERVER=root@1.2.3.4 REMOTE_DIR=/srv/ziwei-test/html`

**验证原理（静态站版 healthz）**：Next 导出的 HTML 无集中 buildId，
但每个 chunk 文件名带内容 hash（turbopack 形如 `2mmpezlrfmbu5.js`，
webpack 形如 `main-app-1175c1c0d82b673a.js`，文件名即指纹）。`make verify`
从本地 `out/index.html` 提取首个 chunk 文件名，确认线上首页引用同一指纹、
且 `/chart`、`/invite`、`/archive`、`/open-in-mini.html` 返回 200——指纹一致即证明「线上跑的正是
本次构建」（nginx 已配 HTML 不缓存，同步即生效）。

## 服务器侧一键脚本（2026-11-08 增，与 make release 并存）

服务器上另有一对同构脚本，**在服务器本机构建**（适合不在开发机旁时应急发布，
或本地构建环境不可用）：

| 脚本 | 目标 |
| --- | --- |
| `/usr/local/bin/deploy-ziwei` | 正式站（构建后 rsync → `/usr/local/ziwei-static/html/`） |
| `/usr/local/bin/deploy-test-ziwei` | 测试站（构建后 rsync → `/usr/local/test-ziwei-static/html/`） |

- 构建目录 `/root/ziwei/ziwei-doushu`，`npx next build --webpack`——服务器仅
  1.8G 内存且 `vm.swappiness=0`（内核宁杀不换页），Turbopack 编译期必 OOM，
  故脚本临时调 `vm.swappiness=100`（trap 退出还原）+ 4G swap
  + `--max-old-space-size=3072` 走 webpack。
- `NEXT_PUBLIC_SITE_URL` 各自注入（ziwei / test-ziwei 域名），语义同 Makefile。
- rsync 同为 `--delete`，exclude 清单与 Makefile 是**两份手工拷贝，改任一方必须同步另一方**。

⚠️ 两个坑：

1. **脚本不 `git pull`**——构建的是 `/root/ziwei/ziwei-doushu` 当前 checkout，
   发布前需手动上去拉新并核对 `git log -1`。
   2026-11-08 曾发现该 checkout 落后 main 40 个 commit，直接跑会把旧代码发上线。
2. **指纹口径不通用**——服务器脚本走 webpack、本地 `make build` 走 Turbopack，
   chunk 文件名体系不同；服务器脚本发的版本，拿本地 `out/` 跑 `make verify`
   比对指纹必失败——这是预期（构建器不同），不代表同步故障，需在服务器本地
   或按路径 200 验证。

## rsync 语义（重要）

`make upload` 使用 `--delete` 清理旧构建的 hash 资源（Next 每次构建文件名都变，
不清理会无限累积），但**显式排除**：

- `MP_verify_*.txt` —— 微信业务域名校验文件，删了小程序 web-view 会挂
- `wLKL4DZ96W.txt` —— 微信侧域名校验文件（2026-11-02 下发），**不可删**
- `vjrssHFjy5.txt` —— 抖音侧域名校验文件（2026-11-08 下发），**不可删**
- `.well-known/` —— 服务器侧可能的 acme 等协议目录

（微信/抖音后台若重新下发校验文件，文件名会变——记得同步改 **Makefile 与
服务器 deploy 脚本两处** exclude，并更新本清单。）

其余服务器上多出来的文件都会被删——**不要手工往 `html/` 放东西**，
要放就放进仓库 `public/`（构建时会拷入 `out/` 一起发布）；
实在要放服务器，必须同步加进 Makefile 的 exclude 清单。

## 首次部署（已完成，备查）

1. DNS：`ziwei A 8.140.235.234`（offiai.cn 控制台）
2. nginx：`deploy/nginx-ziwei.conf` → `/etc/nginx/conf.d/ziwei.conf`，改证书路径后
   `nginx -t && nginx -s reload`。要点：`$uri.html` 兜底解析 `/chart`、
   hash 资源长缓存（`^~ /_next/static/`）、HTML `no-cache`
3. 目录：`mkdir -p /usr/local/ziwei-static/html`
4. 微信 MP 后台：业务域名配置会往该目录放 `MP_verify_*.txt`（rsync 已排除，勿手动清理）
5. 发布：`make release`

## 测试环境（test-ziwei.offiai.cn，2026-11-06 增）

测试站与正式站同机，只按域名/目录区分；**谁能看到测试站由 mistsee 服务端的
uid 白名单决定**——白名单用户在小程序里打开紫微入口时，`GET /ziwei/web`
下发的是测试站地址，其余用户照旧正式站。整条链路：

```
mistsee .env 配 MISTSEE_GRAY_TEST_UID_LIST=<uid 逗号分隔>          ← 谁走测试
mistsee .env 配 MISTSEE_ZIWEI_WEB_URL_FULL_TEST=https://test-ziwei.offiai.cn
make release（mistsee 仓库，重启生效）
   ↓ 白名单用户小程序打开紫微 → web-view 加载 test-ziwei.offiai.cn
本仓库 make release ENV=test                                        ← 测试站内容
   ↓ H5 直连 mistsee.offiai.cn 调 AI（同一后端；服务端 CORS 已放行测试站 origin）
```

### 首次开通（2026-11-06 已完成，备查；新环境照此复刻）

1. **DNS**：`test-ziwei A 8.140.235.234`（offiai.cn 控制台；子域共享主域备案）✅
2. **证书**：无需另签——APISIX 侧一张 `*.offiai.cn` 通配符证书覆盖所有子域 ✅
3. **静态实例**（与正式站同构，`deploy/nginx-ziwei.conf` 头注有完整拓扑与 server 块）：
   `cp -r /usr/local/ziwei-static /usr/local/test-ziwei-static`，实例
   `conf/nginx.conf` 改 `listen 127.0.0.1:8005`、`root /usr/local/test-ziwei-static/html`，
   清空旧 html 后 `openresty -p /usr/local/test-ziwei-static -c conf/nginx.conf` 启动 ✅
4. **APISIX 路由**：admin API 加 route `test-ziwei`（host `test-ziwei.offiai.cn` →
   upstream `127.0.0.1:8005`，proxy-rewrite 补 `X-Forwarded-Proto: https`，
   与 route `ziwei` 同款）✅
5. **mistsee 侧**：按上面链路配两个 env 并 `make release`（mistsee 仓库）✅
   （当前白名单：`MISTSEE_GRAY_TEST_UID_LIST=1`，即小程序首个用户）
6. **微信 MP 后台（⚠️ 唯一未完成项，漏了 web-view 打不开测试站）**：
   「开发管理 → 业务域名」添加 `test-ziwei.offiai.cn`，按提示下载 `MP_verify_*.txt`
   放进 `/usr/local/test-ziwei-static/html/`（rsync `--delete` 已排除该文件，不会被清掉）
7. **发布测试站内容**：`make release ENV=test` ✅

### 日常

- 测试站出新版：`make release ENV=test`（与正式互不影响，产物目录独立）；
  服务器本机也可跑 `deploy-test-ziwei`（先 `git pull`，见「服务器侧一键脚本」）
- 加/减测试用户：只改 mistsee 的 `MISTSEE_GRAY_TEST_UID_LIST` 重启，本仓库不动
- 测试站**无访问控制**：拿到域名谁都能看，勿放敏感内容/未公开数据

## 小程序端发布（另一条线，不在本仓库）

静态站只是小程序的 web-view 落地页与分享页。小程序本体的源码与构建不在本仓库
（本仓库 `app/` 是 Next.js 路由目录），发布走小程序仓库 + 微信开发者工具
「上传」→ MP 后台「提审」→「发布」。web-view 页面 URL 指向本站的场景，
顺序上先 `make release` 再提审小程序，避免审核员看到旧版页面。

## 发布记录

> 沿 mistsee 惯例：每次发布在此追加一段（日期 + 版本/commit + 内容 + 验证结果 + 遗留）。

### 2026-11-09 · fix(合盘): 追问区剩余低对比度——问句气泡与发送键禁用态（ENV=test）

- **内容**：commit 4fdffec——真机反馈「合盘的追问也看不清」：chips 改 ac 色系后追问区仍有
  两处低对比——问句回显气泡 `--ac`（亮色 #B8922A 浅金底 ~2.8:1）→ `--ac-dim`；发送键
  禁用态黑底白字压 opacity 0.5（~2:1）→ 实底 `--bg-2`+`--tx-2`（~7:1）。heming/invite 两页同步。
- **发布**：`make release ENV=test`。首页指纹仍 `3y705tc4v-41-`（共享 chunk 未动），
  补验 /heming /invite /chart chunk 清单一致；含 ac-dim 的页面 chunk（0schtl7f1n3x2 /
  2sg81n54sxhnx）线上 200，确认新版生效。
- **遗留**：正式站发布与小程序提审待办（与上版相同）。

### 2026-11-09 · feat(合盘): 页面重构 + 追问聊天化 + 合盘分享卡 + 追问按钮配色（ENV=test）

- **内容**：commit fa80b61——/heming 对标 invite 视觉重构（720px 单列卡流、命宫对照卡、
  重新合盘回表单预填）；追问聊天化（发送清空输入、问句金气泡回显、空输入禁发）；
  合盘专属分享卡 HemingShareCard（ShareModal 加 heming 通道）；真机反馈「追问按钮灰色
  看不清字」修复：快捷问 chips 两页统一 ac 色系（--ac-bg/--ac-bdr/--ac-dim，双主题对比度
  达标），InsightPanel 禁用态 opacity 30%→50%。**未推正式站**。
- **发布**：`make release ENV=test`。首页指纹 `3y705tc4v-41-` 与上版相同（首页共享 chunk
  未动，`make verify` 证明力不足），按 2026-11-02 农历版同款方法补验：/heming /invite
  /chart 三页线上与本地 chunk 清单逐一比对全部一致（25/22/25 个）；关键路径 200。
- **遗留**：正式站发布（`make release`）与小程序提审仍待办（与上版相同）。

### 2026-11-09 · fix(合盘): 追问带上下文与盘面复用 + 档案导入补解读（ENV=test）

- **内容**：commit 0318b82——合盘追问全量回传历史轮次（配套 mistsee 服务端 v0.1.15
  `/heming` 收 `messages`，已在正式后端生效）；/heming 页轮次化（旧解读不闪没、追问框
  常驻）；表单快照一致时复用双盘不重排（档案老行无 origInput 重排错盘根治）；档案导入
  补解读全文；恢复通道带全轮次；详情读取中态+滚动归零+双盘 instant。**未推正式站**。
- **发布**：`make release ENV=test`，构建指纹 `3y705tc4v-41-`，线上首页一致；
  `/chart` `/invite` `/archive` `/open-in-mini.html` 脚本验证 200，另手工补验 `/heming` 200。
- **链路**：测试站直连正式后端 mistsee.offiai.cn（v0.1.15）——白名单用户（uid=1）真机
  可直接验合盘追问是否接上文。
- **遗留**：正式站发布（`make release`）与小程序提审（9f737e4 分享缩略图）待办；老导入
  的空合盘档案不会自动补解读（服务端幂等），本地留有会话的删档重进即愈。

### 2026-11-02 · feat(门禁): 内测参数 `?beta=1`

- **内容**：`app/layout.tsx` 门禁脚本支持内测参数——URL 带 `?beta=1` 时放行并记入
  `sessionStorage`（键 `ziwei-beta`），同一会话只需带一次参数，后续页面/刷新不再跳
  `/open-in-mini.html`；会话结束自动失效。伪参数（如 `xbeta=1`）不生效。
- **发布**：`make release`，构建指纹 `310vm2bl3xxpt`，线上首页一致；
  `/chart`、`/open-in-mini.html` 均 200；线上 HTML 已含 `beta=1` 门禁逻辑。
- **内测入口**：`https://ziwei.offiai.cn/?beta=1`
- **遗留**：参数无保密性（纯客户端门禁），知道链接即可绕过；如需收紧可换
  带签名的时间戳参数。

### 2026-11-02 · feat(排盘): 农历起盘 + 盘面公历/农历显示

- **内容**：出生表单支持公历/农历切换（月下拉按当年闰月表插入闰X月、日按当月实际
  天数生成、换年自动修正失效组合）；`formToBirthInfo` 收敛为唯一换算入口（农历→公历
  →晚子时换日，非法日期返回 null），顺手修复 `/chart` 内联转换漏晚子时换日的旧 bug；
  盘面标题下新增公历/农历/干支年日期行（展示层 Solar→Lunar 现算原始历法，不用安星口径
  的 `chart.lunarInfo`，闰月不丢「闰」标）；分享链接新增 `cal`/`lp` 参数。另删排盘页
  开源 Demo 文案。
- **发布**：两次 `make release`。注意本次首页构建指纹不变（共享 chunk 未改动），
  `make verify` 证明力不足，改用 `/chart` 页 chunk 清单比对验证（线上与本地 8 个
  chunk 完全一致）。
- **验证**：新增 `lunar-input.test.ts`（历法锚点/双路径/非法日期/链接 round-trip）挂入
  `npm test`；一次性广域验证 `lunar-chart-dualpath.verify.ts`——1900–2026 每年
  正月/七月/当年闰月 × 首末日 × 午时/晚子时共 **1204 对完整命盘 deepEqual 全过**。
- **遗留**：`ChartSummary` 为无引用孤儿组件（原含日期显示），待清理；`make verify`
  只比首页指纹，可考虑扩为同时比对 `/chart` 页。
