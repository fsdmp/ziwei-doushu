'use client';

// ShareGuideTip.tsx 分享引导条（share_panel=false 期专用，2026-11-06）：
// 引导式分享解锁依赖新版 bridge（share 态），未发版期间墙上「分享解锁」
// 维持点即给——但点完弹出本引导条，把「分享」呈现为解锁流程的一环
//（用户感知：点了分享 → 分享卡出现 → 解锁），实际不分享也已解锁（合规
// 无强制不变）。share_panel=true 后由 bridge 分享页承担引导，本组件不渲染。
//
// 形态：底部非模态小卡——不遮解读区（问答解锁后答案正在流式输出，模态
// 引导会挡住「立刻能看」），6 秒自动消失，可手动关。

import { useEffect } from 'react';
import { pushShareCard, miniToast } from '@/lib/mini-bridge';
import { sharePanelEnabled } from '@/lib/unlock';

interface ShareGuideTipProps {
  open: boolean;
  onClose: () => void;
  /** 转发卡标题（与解锁时 pushShareCard 的素材同源） */
  title: string;
  /** 渠道标记（qna / liunian，归因同源） */
  ch: string;
  /** 副文案（默认「TA 也会想测一张」） */
  sub?: string;
}

export default function ShareGuideTip({ open, onClose, title, ch, sub = 'TA 也会想测一张' }: ShareGuideTipProps) {
  // 6 秒自动收起：引导是氛围不是阻塞，用户在读解读时自然淡出
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(onClose, 6000);
    return () => clearTimeout(t);
  }, [open, onClose]);

  if (!open || sharePanelEnabled()) return null; // true 模式引导归 bridge 分享页

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2"
      style={{
        bottom: 'calc(18px + env(safe-area-inset-bottom))',
        zIndex: 60,
        display: 'flex', alignItems: 'center', gap: '10px',
        maxWidth: 'min(92vw, 420px)',
        padding: '10px 12px 10px 16px',
        borderRadius: '14px',
        background: 'rgba(24,16,44,0.94)',
        border: '1px solid rgba(122,92,190,0.45)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
        backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e8dcc0', letterSpacing: '0.05em' }}>
          ✦ 已分享 · 解锁成功
        </div>
        <div style={{ fontSize: 11, color: 'rgba(232,220,192,0.55)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {sub}
        </div>
      </div>
      <button
        onClick={() => {
          pushShareCard({ title, ch });
          miniToast('点右上角「···」可转发给朋友');
        }}
        style={{
          padding: '7px 14px', borderRadius: '999px', border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, #7a5cbe, #5b3fa0)', color: 'white',
          fontSize: 12, fontWeight: 600, letterSpacing: '0.05em', whiteSpace: 'nowrap',
        }}
      >
        发给朋友
      </button>
      <button
        onClick={onClose}
        aria-label="关闭"
        style={{
          width: 22, height: 22, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'rgba(255,255,255,0.08)', color: 'rgba(232,220,192,0.6)',
          fontSize: 12, lineHeight: 1, flexShrink: 0,
        }}
      >×</button>
    </div>
  );
}
