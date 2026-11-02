# ziwei-doushu 线上部署（8.140.235.234 · ziwei.offiai.cn）

部署形态：**纯静态站**——Next.js `output: 'export'` 构建出 `out/`，rsync 到 nginx 目录
`/usr/local/ziwei-static/html/`。无服务进程、无重启、无数据库；AI 解读由前端直连
mistsee 线上后端（`mistsee.offiai.cn`，见 `lib/ai.ts`）。

与 mistsee 同机同 nginx（证书复用 `/etc/nginx/cert/offiai.cn.*`）。

> **首次部署记录（2026-11-02，commit 0d0ef11）**：全站静态导出上 nginx，
> 手动 npm run build + 上传。本工具链（Makefile + 本文档）为后续日常发布而建，
> 自下次发布起走 `make release`。

## 日常发布

```bash
make release    # 一键：build + rsync + 线上验证（指纹一致 + 关键路径 200）
make upload     # 只传不验（构建 + rsync，不碰验证）
make verify     # 只验线上（需本地已有 out/，对比构建指纹）
```

参数可覆盖：`make release SERVER=root@1.2.3.4 REMOTE_DIR=/srv/ziwei/html SITE=https://xxx`

**验证原理（静态站版 healthz）**：Next 导出的 HTML 无集中 buildId，
但每个 chunk 文件名带内容 hash（turbopack 形如 `2mmpezlrfmbu5.js`，
webpack 形如 `main-app-1175c1c0d82b673a.js`，文件名即指纹）。`make verify`
从本地 `out/index.html` 提取首个 chunk 文件名，确认线上首页引用同一指纹、
且 `/chart`、`/open-in-mini.html` 返回 200——指纹一致即证明「线上跑的正是
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
