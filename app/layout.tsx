import type { Metadata, Viewport } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/ThemeProvider';
import MiniBridgeFab from '@/components/MiniBridgeFab';
import ErrorReporter from '@/components/ErrorReporter';
import InviteReturnBanner from '@/components/InviteReturnBanner';
import { SITE_URL } from '@/lib/site';

// 手机浏览器 / 微信内置浏览器 / 小程序 webview 统一视口：
// viewport-fit=cover 兼容刘海屏安全区，maximumScale=1 防止聚焦输入框时 iOS 自动放大
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: '紫微命盘 · 倪海厦正宗紫微斗数',
  description: '基于倪海厦正宗紫微斗数体系，AI深度解读您的命盘格局、大限流年、感情事业财富健康全方位解析',
  keywords: '紫微斗数, 倪海厦, 紫微斗数全集, 紫微斗数全书, 骨髓赋, 命盘, 命理, 14主星, 12宫位',
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: '紫微命盘 · 倪海厦正宗紫微斗数',
    description: '基于倪海厦正宗紫微斗数体系，AI深度解读您的命盘格局、大限流年、感情事业财富健康全方位解析',
    url: SITE_URL,
    siteName: '紫微研究',
    locale: 'zh_CN',
    type: 'website',
  },
  // 站长平台验证（拿到 verification code 后填入对应字段，重新部署即可）
  verification: {
    // Google Search Console: 在 https://search.google.com/search-console 添加站点后获取
    google: process.env.NEXT_PUBLIC_GOOGLE_VERIFICATION || undefined,
    // Bing Webmaster Tools: 在 https://www.bing.com/webmasters 添加站点后获取
    other: {
      'msvalidate.01': process.env.NEXT_PUBLIC_BING_VERIFICATION || '808FFC6023A2C359B375DD860FEDA856',
      // 百度站长（等执照下来后）
      'baidu-site-verification': process.env.NEXT_PUBLIC_BAIDU_VERIFICATION || '',
      // 360 站长（等执照下来后）
      '360-site-verification': process.env.NEXT_PUBLIC_360_VERIFICATION || '',
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 登录态首帧先取：小程序容器把 JWT 拼在 #t= 上，若等 lib/ai 首次请求才取，
            站内 router.push 翻页（首页→/chart）已把 hash 丢掉——AI 问答将永远匿名 401
            （后端 fail-closed）。这里取走存 sessionStorage 并从地址栏精确移除 t 参数
            （不进分享链接/日志，其余 hash 内容保留），与 lib/ai 的兜底捕获同键同语义 */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var h=location.hash;if(!h)return;var p=new URLSearchParams(h.charAt(0)==='#'?h.slice(1):h);var t=p.get('t');if(!t)return;sessionStorage.setItem('ziwei_ai_token',t);p.delete('t');var r=p.toString();history.replaceState(null,'',location.pathname+location.search+(r?'#'+r:''));}catch(e){}})();` }} />
        {/* 宿主小程序版本首帧先存：服务端把它拼在 /ziwei/web 下发的 URL query 上
            （mp_env/mp_ver，见 mistsee handler withHostVersion），这里读一次进
            sessionStorage——站内 router.push 翻页会丢 query，等 lib/ai 首次请求才取
            就晚了。之后所有对服务端的请求回发 X-App-Env/X-App-Version（lib/ai
            hostVersionHeaders），访问日志/灰度对 H5 流量与小程序流量同口径。参数
            非敏感不从地址栏清除；无参（旧版小程序/直开浏览器）不存，回发侧同缺席 */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var q=new URLSearchParams(location.search);var e=q.get('mp_env'),v=q.get('mp_ver');if(e)sessionStorage.setItem('ziwei_mp_env',e);if(v)sessionStorage.setItem('ziwei_mp_ver',v);}catch(e){}})();` }} />
        {/* 门禁：仅小程序 web-view 可用（UA 含 miniProgram），其余环境在首帧渲染前
            跳转引导页扫码进小程序；location.replace 不留历史，返回键不困在站内。
            localhost 放行便于本地开发调试；内测参数 ?beta=1 放行并记入 sessionStorage，
            同一会话只需带一次参数，后续页面/刷新不再跳引导页，会话结束自动失效 */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{if(/[?&]beta=1/.test(location.search)){sessionStorage.setItem('ziwei-beta','1');return;}if(sessionStorage.getItem('ziwei-beta')==='1')return;if(!/miniProgram/i.test(navigator.userAgent)&&!/^(localhost|127\\.0\\.0\\.1|\\[::1\\])$/.test(location.hostname)){location.replace('/open-in-mini.html');}}catch(e){}})();` }} />
        <script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ziwei-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);else document.documentElement.setAttribute('data-theme','dark');}catch(e){}})();` }} />
        {/* 微信体验分析 web 采集（web-view 真实体验回传，官方「Web 项目接入指引」片段）：
            原片段非 ES5，按本仓 head 脚本惯例改写为 ES5 IIFE 一起编译（async/await
            拍平成回调链，SCRIPT_URLs 数组只有一个地址，Promise.race 就地退化成单加载）。
            maskMode 先 no-mask 方便联调看全量数据，观察期过后按官方 privacy 文档
            （developers.weixin.qq.com/.../privacy.html）按需切 all-mask 脱敏输入。
            加载失败仅 console.error，不影响业务；window.__startPX 未注入时静默跳过 */}
        <script dangerouslySetInnerHTML={{ __html: `(function(){'use strict';try{var param={maskMode:'no-mask',recordCanvas:false,projectId:'wxc7d66f0f80d04243-sfff0fi_k-YZNVLA',iframe:false,console:true,network:true};var supportESModule='noModule' in document.createElement('script');var SCRIPT_URL='https://dev.weixin.qq.com/platform-console/proxy/assets/tel/'+(supportESModule?'px.min.js':'px.es5.min.js');function loadScript(url,ok,fail){var s=document.createElement('script');s.type='text/javascript';s.async=true;s.src=url;s.onload=function(){ok(url);};s.onerror=function(){fail(new Error('Script load error'));};(document.head||document.getElementsByTagName('head')[0]).appendChild(s);};function start(){if(window.__startPX)window.__startPX(param);}try{sessionStorage.setItem('wxobs_start_timestamp',String(Date.now()));}catch(e){}loadScript(SCRIPT_URL,start,function(err){if(window.console)console.error('Error loading scripts:',err);});}catch(e){}})();` }} />
      </head>
      <body className="min-h-screen">
        <ThemeProvider>
          {children}
          {/* 合盘邀请回访提示条（docs/09 §3.1 A 侧回访）：TA 回应后 A 任意页面进站可见 */}
          <InviteReturnBanner />
          {/* 小程序桥常驻测试入口：右缘悬浮，仅 web-view 环境渲染，联调完整体摘除 */}
          <MiniBridgeFab />
          <ErrorReporter />
        </ThemeProvider>
      </body>
    </html>
  );
}
