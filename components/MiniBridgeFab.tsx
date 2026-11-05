'use client';

// MiniBridgeFab.tsx 小程序桥联调入口：右缘竖排悬浮，仅仿真环境（dev 域名/beta 会话
// + ?mp=1，见 lib/mini-bridge isSimulatedMini）渲染——真 web-view 的正式链路由
// 页面内真实入口承载（ChatPanel 的看视频/充值、ShareButton 的分享），本组件绝不
// 暴露给线上用户；浏览器默认也不渲染。
// · 分享：推转发素材给容器页（postMessage），气泡引导用户点右上角「···」转发
// · 广告：跳小程序原生中转页（ziwei-bridge）播激励视频并核销
// 联调完可整体摘除（layout 里删一行即撤）。

import { useEffect, useRef, useState } from 'react';
import { isSimulatedMini, inRealMiniProgram, openRewardedAd, pushShareTitle } from '@/lib/mini-bridge';

export default function MiniBridgeFab() {
  const [inMini, setInMini] = useState(false);
  // 仿真环境恒非真 web-view，分享按钮恒显示（真 web-view 里不该出现本组件——
  // 真环境分享由容器页原生按钮 + 页面内 ShareButton 承载）
  const [shareHere, setShareHere] = useState(false);
  const [hint, setHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setInMini(isSimulatedMini());
    setShareHere(!inRealMiniProgram());
    return () => { if (hintTimer.current) clearTimeout(hintTimer.current); };
  }, []);

  if (!inMini) return null;

  /** 连点分享以最后一次提示为准：旧定时器作废，不出现提示提前消失 */
  const onShare = () => {
    pushShareTitle('紫微斗数 · 起一张你的命盘');
    setHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(false), 4000);
  };

  /** 与 ChatPanel 入口同款胶囊样式：主题变量随深浅色走，毛玻璃在盘面上可读 */
  const pillStyle: React.CSSProperties = {
    border: '1px solid rgba(212,168,67,0.35)',
    color: 'var(--t-gold)',
    background: 'var(--t-card)',
    backdropFilter: 'blur(6px)',
  };

  return (
    <div
      className="fixed z-[90] flex flex-col items-end gap-2"
      style={{ right: 8, bottom: '18vh' }}
    >
      {/* 转发引导气泡：小程序里转发面板无法编程拉起，只能指路右上角。
          行宽按文案实测留足（窄了会中途折行错位），两行各自 nowrap 兜底 */}
      {hint && (
        <div
          className="text-[10px] leading-relaxed rounded-lg px-3 py-1.5"
          style={{ ...pillStyle, textAlign: 'center', whiteSpace: 'nowrap' }}
        >
          分享内容已备好
          <br />点右上角 <b>「···」转发</b>
        </div>
      )}
      {shareHere && (
        <button
          onClick={onShare}
          className="text-[11px] rounded-full px-3 py-2 transition-opacity active:opacity-60"
          style={pillStyle}
        >
          ✦ 分享
        </button>
      )}
      <button
        onClick={openRewardedAd}
        className="text-[11px] rounded-full px-3 py-2 transition-opacity active:opacity-60"
        style={pillStyle}
      >
        ▶ 广告
      </button>
    </div>
  );
}
