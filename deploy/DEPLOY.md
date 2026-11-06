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

## rsync 语义（重要）

`make upload` 使用 `--delete` 清理旧构建的 hash 资源（Next 每次构建文件名都变，
不清理会无限累积），但**显式排除**：

- `MP_verify_*.txt` —— 微信业务域名校验文件，删了小程序 web-view 会挂
- `wLKL4DZ96W.txt` —— 线上受保护文件（域名校验类），**不可删**
- `.well-known/` —— 服务器侧可能的 acme 等协议目录

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

- 测试站出新版：`make release ENV=test`（与正式互不影响，产物目录独立）
- 加/减测试用户：只改 mistsee 的 `MISTSEE_GRAY_TEST_UID_LIST` 重启，本仓库不动
- 测试站**无访问控制**：拿到域名谁都能看，勿放敏感内容/未公开数据

## 小程序端发布（另一条线，不在本仓库）

静态站只是小程序的 web-view 落地页与分享页。小程序本体的源码与构建不在本仓库
（本仓库 `app/` 是 Next.js 路由目录），发布走小程序仓库 + 微信开发者工具
「上传」→ MP 后台「提审」→「发布」。web-view 页面 URL 指向本站的场景，
顺序上先 `make release` 再提审小程序，避免审核员看到旧版页面。

## 发布记录

> 沿 mistsee 惯例：每次发布在此追加一段（日期 + 版本/commit + 内容 + 验证结果 + 遗留）。

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
