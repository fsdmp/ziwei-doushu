// mini-bridge.ts 小程序 web-view 桥：本站（ziwei-doushu）嵌在雾见小程序 web-view 里时，
// 调用小程序原生能力的唯一通道。web-view 与小程序是隔离的 JS 环境：广告
// （createRewardedVideoAd）、虚拟支付收银台（requestVirtualPayment）调不了，转发面板
// 也无法编程拉起——微信给的口子是 JSSDK 的 wx.miniProgram 系列，且各有边界：
// · navigateTo 实时可靠 → 广告/充值走它：跳小程序原生中转页（pages/ziwei-bridge）承载
// · postMessage 仅在小程序「后退 / 组件销毁 / 分享」三个时机送达 → 只适合带数据，
//   这里用于分享素材：H5 按钮 postMessage 转发文案，用户点右上角「···」转发时容器页
//   收到，用它定制转发卡（时机上分享动作必晚于点击，素材必已到达）
// 浏览器直接访问本站时本模块全部静默降级（isMiniProgram=false，按钮不渲染）。

/** JSSDK 版本：web-view 内 wx.miniProgram 系列无需 wx.config，脚本到即用 */
const SDK_URL = 'https://res.wx.qq.com/open/js/jweixin-1.6.0.js';

/** wx.miniProgram 的最小类型面（本站只用这两件事：跳原生页 / 带数据） */
interface WxMiniProgram {
  navigateTo(options: { url: string }): void;
  postMessage(options: { data: unknown }): void;
}

declare global {
  interface Window {
    wx?: { miniProgram?: WxMiniProgram };
  }
}

/** 小程序环境检测（UA 含 miniProgram，与 layout.tsx 门禁同口径）；模块级缓存避免重复嗅探。
 *  联调后门：?mp=1 在开发域名（localhost）或 beta 内测会话下视同小程序环境——浏览器里
 *  也能看到 FAB/入口做 UI 联调（真机链路仍需 web-view）。注意 beta 会话标志
 *  （sessionStorage ziwei-beta=1）在生产域名同样可开——仿真态只是 UI 层，桥调用在真
 *  环境外必然失败，无安全面，但别把 mp=1 当作生产不可达的保证。 */
let cachedInMini: boolean | null = null;
export function isMiniProgram(): boolean {
  if (cachedInMini === null) {
    cachedInMini = inRealMiniProgram() || isSimulatedMini();
  }
  return cachedInMini;
}

/** 真实 web-view 环境（仅 UA 判定，不含 ?mp=1 仿真）——真环境里分享常驻入口由容器页
 *  原生按钮（open-type=share，一点即弹转发面板）承载，H5 侧分享按钮不再重复渲染 */
export function inRealMiniProgram(): boolean {
  return typeof navigator !== 'undefined' && /miniProgram/i.test(navigator.userAgent);
}

/** 仅仿真环境（dev 域名/beta 会话 + ?mp=1）：MiniBridgeFab 等联调脚手架的渲染
 *  门禁——真 web-view 不渲染（真实链路由页面内正式入口承载），浏览器默认也不渲染。 */
export function isSimulatedMini(): boolean {
  if (typeof navigator === 'undefined' || typeof location === 'undefined') return false;
  const devHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)
    || (() => { try { return sessionStorage.getItem('ziwei-beta') === '1' } catch { return false } })();
  return devHost && /[?&]mp=1(?![\w])/.test(location.search);
}

/** SDK 注入 promise（幂等；加载失败置空允许下次重试） */
let sdkPromise: Promise<WxMiniProgram> | null = null;

function loadBridge(): Promise<WxMiniProgram> {
  if (!isMiniProgram()) return Promise.reject(new Error('not-in-miniprogram'));
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.wx?.miniProgram) {
      resolve(window.wx.miniProgram);
      return;
    }
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.onload = () => {
      if (window.wx?.miniProgram) resolve(window.wx.miniProgram);
      else reject(new Error('sdk loaded without miniProgram'));
    };
    script.onerror = () => {
      sdkPromise = null; // 失败清标记：下次调用重试注入
      reject(new Error('sdk load failed'));
    };
    document.head.appendChild(script);
  });
  return sdkPromise;
}

/** 轻量 toast（桥层专用）：H5 无全局 toast 基建，直接挂一个会自己消失的 DOM 节点 */
function toast(msg: string): void {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = msg;
  el.style.cssText = 'position:fixed;left:50%;bottom:18vh;transform:translateX(-50%);'
    + 'background:rgba(20,16,32,.82);color:#e8dcc0;padding:9px 18px;border-radius:10px;'
    + 'font-size:13px;letter-spacing:.05em;z-index:9999;pointer-events:none;'
    + 'transition:opacity .3s;max-width:78vw;text-align:center';
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 320) }, 2400);
}

/** 跳小程序原生页（统一收口）。连点节流：快速双击会叠两层 bridge 页，要返回两次；
 *  桥不可用必须出声——静默失败里最贵的是充值入口（用户点「充值」毫无反应 = 直接
 *  损失收入），不能只靠「入口本就不该渲染」兜底（弱网下 SDK 加载失败是真实场景） */
let lastBridgeJumpAt = 0;
function miniNavigateTo(path: string): void {
  const now = Date.now();
  if (now - lastBridgeJumpAt < 500) return;
  lastBridgeJumpAt = now;
  loadBridge()
    .then(mp => mp.navigateTo({ url: path }))
    .catch(() => toast('调不起小程序能力，请稍后再试'));
}

/** 吊起激励视频广告（小程序侧：ziwei-bridge → 播放 → 服务端核销） */
export function openRewardedAd(): void {
  miniNavigateTo('/pages/ziwei-bridge/index?cmd=ad');
}

/**
 * 吊起虚拟支付收银台（小程序侧：ziwei-bridge → PaySheet → wx.requestVirtualPayment）。
 * kind 与 PaySheet 视图档对齐：single=单次点灯 / member=以雾为约（默认）/ reweave=再望。
 */
export function openPaySheet(kind: 'single' | 'member' | 'reweave' = 'member'): void {
  miniNavigateTo(`/pages/ziwei-bridge/index?cmd=pay&kind=${kind}`);
}

/** 转发卡素材：title 做卡片标题；invite/ch 由容器页拼进转发卡 path 的 query（白名单，
 *  接收方落地容器页再透传回 H5，裂变闭环在此合拢）。仅在用户点右上角「···」或原生
 *  分享按钮转发时送达——H5 侧配引导文案，见 ShareModal。 */
export interface ShareCardPayload {
  title: string;
  /** 邀请码（server /ziwei/invites 签发）：带上后转发卡 path 含 ?invite=… */
  invite?: string;
  /** 渠道标记（裂变玩法区分来源） */
  ch?: string;
}

/** 推送转发卡素材（容器页 useShareAppMessage 消费）。 */
export function pushShareCard(payload: ShareCardPayload): void {
  loadBridge()
    .then(mp => mp.postMessage({ data: { type: 'share', ...payload } }))
    .catch(() => {});
}

/** pushShareCard 的纯标题简写（兼容旧用法：ShareModal 等）。 */
export function pushShareTitle(title: string): void {
  pushShareCard({ title });
}
