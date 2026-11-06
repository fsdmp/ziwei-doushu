'use client';

// MyHemingInviteButton.tsx 「☯ 我的合盘邀请」常驻入口（A 侧回访，docs/09 §3.1）：
// 读签发时存的本机码（HemingInviteButton saveMyHemingInvite），有码才渲染——
// A 关掉一次性回执条后仍可随时回来。进 /invite?a=1（A 视角拉双方生辰本地重排）：
// 未回应 = 等待态文案，已回应 = 完整合盘，一个入口覆盖两态。
//
// 渲染条件是 localStorage，必须 mounted 后读——渲染期读会与预渲染 HTML 不一致，
// 触发 hydration 整树重渲（web-view 黑屏前科，docs/09 §8，不新增 mismatch 源）。

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { loadMyHemingInvite } from '@/lib/invite';

interface MyHemingInviteButtonProps {
  /** 按钮文案 */
  label?: string;
  className?: string;
}

export default function MyHemingInviteButton({ label = '☯ 我的合盘邀请', className = '' }: MyHemingInviteButtonProps) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => { setToken(loadMyHemingInvite()); }, []);
  // 本会话内刚发起的邀请即刻可见（不用等下次 mount 重读）
  useEffect(() => {
    const onIssued = () => setToken(loadMyHemingInvite());
    window.addEventListener('ziwei:invite-issued', onIssued);
    return () => window.removeEventListener('ziwei:invite-issued', onIssued);
  }, []);

  if (!token) return null;

  return (
    <button
      type="button"
      onClick={() => router.push(`/invite?invite=${encodeURIComponent(token)}&a=1`)}
      className={`chart-reset-btn ${className}`}
    >
      {label}
    </button>
  );
}
