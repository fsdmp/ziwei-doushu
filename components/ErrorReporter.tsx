'use client';
import { useEffect } from 'react';
import { reportH5Error, flushEventsOnHide } from '@/lib/events';
import { refreshMember, cleanupOldSessions } from '@/lib/unlock';

/**
 * 全站启动副作用（挂 layout，全站一次）：
 * ① 错误上报（docs/11 §3.1）：onerror + unhandledrejection 收口到 server 事件
 *   表（kind=h5_error）——web-view 里的 hydrate 黑屏从「靠用户截图」变为可查表
 *   定位。未登录（无 JWT）时上报被 401 拒，静默丢（fire-and-forget 语义）。
 * ② 会员态拉取（docs/11 §5）：unlock 判定函数的 member 短路数据源；pageshow
 *   （含 bridge 支付完成 navigateBack 回前台）时刷新——会员开通回来即生效。
 * ③ localStorage 卫生（docs/11 §3.2）：清掉最近 10 盘之外的旧解锁 key。
 * ④ 事件收尾：pagehide / 切后台时立即冲干 events 队列（keepalive），
 *   防尾批跟着页面一起没了。
 */
export default function ErrorReporter() {
  useEffect(() => {
    // SPA 换页不重挂本组件，页面归属在上报时刻取——挂载时缓存会归因到落地页
    const page = () => (typeof location !== 'undefined' ? location.pathname : undefined);
    const onErr = (ev: ErrorEvent) => {
      reportH5Error(`${ev.message}\n${ev.error?.stack ?? ''}`.trim(), page());
    };
    const onRej = (ev: PromiseRejectionEvent) => {
      reportH5Error(String(ev.reason ?? 'unhandledrejection'), page());
    };
    const onShow = () => refreshMember();
    const onHide = () => flushEventsOnHide();
    const onVis = () => {
      if (document.visibilityState === 'hidden') flushEventsOnHide();
    };
    window.addEventListener('error', onErr);
    window.addEventListener('unhandledrejection', onRej);
    window.addEventListener('pageshow', onShow);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    refreshMember();
    cleanupOldSessions();
    return () => {
      window.removeEventListener('error', onErr);
      window.removeEventListener('unhandledrejection', onRej);
      window.removeEventListener('pageshow', onShow);
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return null;
}
