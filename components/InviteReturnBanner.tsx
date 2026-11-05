'use client';

// InviteReturnBanner.tsx 合盘邀请的 A 侧回访闭环（docs/09 §3.1 A 侧回访）：
// 进站/落地拉一次 GET /ziwei/invites/mine（无 JWT 静默跳过——浏览器直开没有回访语义），
// 有「已回应且未看过」的邀请 → 顶部轻提示条「TA 回应了你们的合盘」→ 点击进结果页
// （/invite?invite=…&a=1，A 视角拉双方生辰本地跑完整合盘）。
//
// 「未看过」记 localStorage（按 token 记，看过/关过就不再弹——回执感一次给足，
// 不做成每页都追着弹的打扰条）。挂 layout 全局：A 从任意页面进站都能接上回访。

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchMyInvites, type MyInvite } from '@/lib/invite';

const SEEN_KEY = 'ziwei_invite_seen';

function loadSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set();
  } catch { return new Set(); }
}

function markSeen(token: string): void {
  try {
    const seen = loadSeen();
    seen.add(token);
    // 只留最近 50 个：长期用户不会积压无限增长
    const arr = Array.from(seen).slice(-50);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  } catch { /* 隐私模式存不进就算了 */ }
}

export default function InviteReturnBanner() {
  const router = useRouter();
  const [hit, setHit] = useState<MyInvite | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const mine = await fetchMyInvites(); // 无 JWT/网络失败均静默：回访是锦上添花
      if (!alive) return;
      // 最新已回应的优先（一人多枚码时只提最新那次）
      const seen = loadSeen();
      const found = mine.find(m => m.kind === 'heming' && m.responded && !seen.has(m.token));
      if (found) setHit(found);
    })().catch(() => {});
    return () => { alive = false; };
  }, []);

  if (!hit) return null;

  const open = () => {
    markSeen(hit.token);
    setHit(null);
    router.push(`/invite?invite=${encodeURIComponent(hit.token)}&a=1`);
  };
  const dismiss = () => {
    markSeen(hit.token);
    setHit(null);
  };

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 90,
      display: 'flex', alignItems: 'center', gap: '10px',
      padding: '10px 14px calc(10px + env(safe-area-inset-top, 0))',
      background: 'linear-gradient(135deg, rgba(122,92,190,0.95), rgba(91,63,160,0.95))',
      color: 'white', fontSize: '13px', letterSpacing: '0.03em',
      boxShadow: '0 4px 20px rgba(91,63,160,0.35)',
    }}>
      <span style={{ fontSize: '15px' }}>☯</span>
      <span style={{ flex: 1, lineHeight: 1.5 }}>TA 回应了你们的合盘，去看看</span>
      <button
        onClick={open}
        style={{
          padding: '6px 16px', borderRadius: '999px', border: 'none',
          background: 'rgba(255,255,255,0.95)', color: '#5b3fa0',
          fontSize: '12px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
        }}
      >查看</button>
      <button
        onClick={dismiss}
        aria-label="关闭"
        style={{
          width: '24px', height: '24px', borderRadius: '50%', border: 'none',
          background: 'rgba(255,255,255,0.15)', color: 'white', fontSize: '14px',
          cursor: 'pointer', lineHeight: 1, flexShrink: 0,
        }}
      >×</button>
    </div>
  );
}
