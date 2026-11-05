'use client';

// HemingInviteButton.tsx 合盘邀请的 A 侧发起入口（docs/09 §3.1 A 侧旅程）：
// 点「和 TA 合一张盘」→ 签发邀请码（服务端存 A 生辰）→ 推转发卡素材
// （「{A昵称} 想和你合一张盘」+ invite/ch）→ 开 ShareModal 引导点转发。
// 面板弹出永远靠原生层用户动作（postMessage 时机保证素材先到），这里只备料。
//
// 放置：heming 页（乙方表单旁/追问区同排）与 chart 页工具栏（与 ✦ 分享 同排）——
// 两处都是「盘已起完」的高潮点，生辰（BirthFormState）在手。

import { useState } from 'react';
import type { BirthFormState } from '@/components/BirthForm';
import { createHemingInvite } from '@/lib/invite';
import { pushShareCard } from '@/lib/mini-bridge';
import { SITE_URL } from '@/lib/site';
import ShareModal from './ShareModal';
import type { AIError } from '@/lib/ai';

interface HemingInviteButtonProps {
  /** 发起人生辰（服务端存 payload、B 侧重排 A 盘的原料）；null = 未起盘，按钮不渲染 */
  form: BirthFormState | null;
  /** 按钮文案 */
  label?: string;
  className?: string;
}

export default function HemingInviteButton({ form, label = '☯ 和 TA 合一张盘', className = '' }: HemingInviteButtonProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // 发起成功后开 ShareModal（标题型：合盘邀请没有单盘卡图）引导转发
  const [modal, setModal] = useState<{ title: string; invite: string } | null>(null);

  // 生辰不完整不出按钮（服务端也会拒，这里先挡一层免得白点）：
  // 年月日 + 性别 + 钟点（或勾选时辰不详）齐全才可发起
  const ready = !!form && !!form.year && !!form.month && !!form.day &&
    !!(form.unknownTime || (form.clockHour !== '' && form.clockMinute !== ''));
  if (!ready) return null;

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const issued = await createHemingInvite(form);
      const title = `${issued.inviter_name} 想和你合一张盘`;
      // 先备转发卡素材（postMessage 在转发动作发生时必已送达容器页）
      pushShareCard({ title, invite: issued.token, ch: 'heming' });
      setModal({ title, invite: issued.token });
    } catch (e) {
      const code = (e as AIError).code;
      if (code === 'auth-expired') setErr('登录已过期，请回到小程序重新打开本页');
      else if (code === 'biz') setErr((e as AIError).bizMsg || '邀请生成失败，请稍后再试');
      else setErr('网络不稳，请稍后再试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className={`share-btn ${className}`}
        style={{
          padding: '6px 14px', cursor: busy ? 'not-allowed' : 'pointer', fontSize: 13,
          border: '1px solid rgba(212,168,67,0.4)', borderRadius: 8,
          background: 'transparent', color: 'var(--t-gold, #d4a843)',
          letterSpacing: '0.05em', opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? '生成邀请…' : label}
      </button>
      {err && (
        <span style={{ fontSize: 11, color: '#dc2626', marginLeft: 8 }}>{err}</span>
      )}
      {modal && (
        // B 主路是转发卡进小程序 web-view（docs/09 §0 拍板：免门禁 H5 直链页不做）；
        // 复制链接通道隐藏（hideCopyLink）——直链在浏览器被门禁拦且邀请码丢失。
        // shareUrl 仍带令牌传给弹窗：留作后续门禁透传 query 后直接放开
        <ShareModal
          open
          onClose={() => setModal(null)}
          shareUrl={`${SITE_URL}/invite?invite=${encodeURIComponent(modal.invite)}`}
          chart={null}
          birth={{ year: '', month: '', day: '', hour: '', minute: '', gender: 'male' }}
          highlight={modal.title}
          title={modal.title}
          invite={modal.invite}
          ch="heming"
          hideCopyLink
        />
      )}
    </>
  );
}
