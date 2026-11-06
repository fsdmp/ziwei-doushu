'use client';

// InviteReturnBanner.tsx 合盘邀请的 A 侧回访闭环（docs/09 §3.1 A 侧回访）：
// 拉 GET /ziwei/invites/mine（无 JWT 静默跳过——浏览器直开没有回访语义），
// 有「已回应且未看过」的邀请 → 顶部轻提示条「TA 回应了你们的合盘」→ 点击进结果页
// （/invite?invite=…&a=1，A 视角拉双方生辰本地跑完整合盘）。
//
// 不只等下次进站——三个时机自动盯，B 回应后 A 停在页面里也能弹：
// ① 发起即刻（HemingInviteButton 签发成功广播 ziwei:invite-issued）；
// ② 回前台（visibilitychange：A 切去微信转发/催 TA，切回来立即拉）；
// ③ 前台轮询 30s（仅当还有在挂未回应的码；无码/码已回应即停——浏览器直开
//    空 JWT 恒空列表，自动不轮询）。
//
// 「未看过」记 localStorage（按 token 记，看过/关过就不再弹——回执感一次给足，
// 不做成每页都追着弹的打扰条；回看走常驻入口 MyHemingInviteButton）。
// 挂 layout 全局：A 从任意页面进站都能接上回访。

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchMyInvites, type MyInvite } from '@/lib/invite';

const SEEN_KEY = 'ziwei_invite_seen';
const POLL_MS = 30_000;

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
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopPoll = () => {
      if (timer !== null) { clearInterval(timer); timer = null; }
    };
    // 有在挂未回应的码才轮询（等到了/没码了即停），网络失败维持现状不灭活
    function schedule(on: boolean): void {
      if (!on) { stopPoll(); return; }
      if (timer === null) timer = setInterval(check, POLL_MS);
    }
    async function check(): Promise<void> {
      try {
        const mine = await fetchMyInvites(); // 无 JWT/网络失败均静默：回访是锦上添花
        if (!alive) return;
        // 最新已回应的优先（一人多枚码时只提最新那次）
        const seen = loadSeen();
        const found = mine.find(m => m.kind === 'heming' && m.responded && !seen.has(m.token));
        if (found) { setHit(found); schedule(false); return; }
        schedule(mine.some(m => m.kind === 'heming' && !m.responded));
      } catch { /* 本次失败不动定时器：已有轮询继续，没有就算了 */ }
    }

    // ② 回前台补拉：A 切去微信转发卡片再切回来，是 B 回应后最高频的回访时机
    const onVis = () => { if (document.visibilityState === 'visible') void check(); };
    // ① 发起即刻盯：本会话刚签发的码立即纳入轮询
    const onIssued = () => { void check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('ziwei:invite-issued', onIssued);
    void check();
    return () => {
      alive = false;
      stopPoll();
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('ziwei:invite-issued', onIssued);
    };
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
      background: 'var(--vip-grad)',
      color: 'white', fontSize: '13px', letterSpacing: '0.03em',
      boxShadow: '0 4px 20px var(--vip-glow)',
    }}>
      <span style={{ fontSize: '15px' }}>☯</span>
      <span style={{ flex: 1, lineHeight: 1.5 }}>TA 回应了你们的合盘，去看看</span>
      <button
        onClick={open}
        style={{
          padding: '6px 16px', borderRadius: '999px', border: 'none',
          // 白按钮上的紫字：固定白底用 --vip-ink（不随主题提亮）
          background: 'rgba(255,255,255,0.95)', color: 'var(--vip-ink)',
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
