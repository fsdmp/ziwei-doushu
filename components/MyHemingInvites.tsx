'use client';

// MyHemingInvites.tsx 「☯ 我的合盘邀请」列表入口（多有效邀请，2026-11-09）——
// 替代原 MyHemingInviteButton（读本机单键码、只能回最后一枚）。在途码不止一枚后
// 数据源改服务端 GET /invites/mine：触发按钮恒渲染（列表在服务端，不依赖本机
// 有无码；无 JWT/没发过时空态兜底），点开弹层看全部邀请——
//   等待回应：剩余天数 + 撤回（腾出在途名额，对方打开即显示失效）
//   已回应：查看合盘（/invite?a=1）；非会员回应后 24h 超窗锁面引导会员永久回看
//   已失效：过期或已撤回（服务端撤回即置 expired，视图不再细分）
// 在途上限与超窗判定都以服务端为准（max_pending / view_locked，会员 10 / 非会员 3）。
// 首页回访横幅（InviteReturnBanner）同走 mine 列表，两处口径一致。

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchMyInvites, revokeMyInvite, INVITE_MAX_PENDING_FALLBACK, type MyInvite } from '@/lib/invite';
import { openPaySheet } from '@/lib/mini-bridge';
import type { AIError } from '@/lib/ai';

interface MyHemingInvitesProps {
  label?: string;
  className?: string;
  /** 覆盖触发按钮内联样式（主页导航等异形入口用） */
  buttonStyle?: React.CSSProperties;
}

/** 邀请有效期（与服务端 ziweiInviteTTL 同值）：只用于「剩 N 天」展示 */
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function MyHemingInvites({ label = '☯ 我的合盘邀请', className = '', buttonStyle }: MyHemingInvitesProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<MyInvite[] | null>(null); // null = 加载中
  const [loadErr, setLoadErr] = useState(false);
  // 撤回二次确认：行内展开确认，不叠第二层弹窗（web-view 里原生 confirm 不可控，
  // 见 archive 页删除确认的同款教训）
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ token: string; msg: string } | null>(null);

  const load = useCallback(async () => {
    setLoadErr(false);
    try {
      const mine = await fetchMyInvites(); // 无 JWT 静默空列表
      setList(mine.filter(m => m.kind === 'heming'));
    } catch {
      setLoadErr(true);
      setList([]);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setList(null);
    setConfirming(null);
    setRowErr(null);
    void load();
  }, [open, load]);

  // 本会话刚签发的码：弹层开着时即刻刷新（与首页横幅同一广播）
  useEffect(() => {
    if (!open) return;
    const onIssued = () => { void load(); };
    window.addEventListener('ziwei:invite-issued', onIssued);
    return () => window.removeEventListener('ziwei:invite-issued', onIssued);
  }, [open, load]);

  const revoke = async (token: string) => {
    setRevoking(token);
    setRowErr(null);
    try {
      await revokeMyInvite(token);
      setConfirming(null);
      await load();
    } catch (e) {
      const err = e as AIError;
      setRowErr({
        token,
        msg: err.code === 'biz' ? (err.bizMsg || '撤回失败') : err.code === 'auth-expired'
          ? '登录已过期，请回到小程序重新打开' : '网络不稳，请稍后再试',
      });
    } finally {
      setRevoking(null);
    }
  };

  const pendingN = list?.filter(m => m.status === 'pending').length ?? 0;
  // 在途上限以服务端为准（会员 10 / 非会员 3，每行同值）：本地不判会员，
  // 开通后重开弹层即见新上限
  const maxPending = list?.[0]?.max_pending ?? INVITE_MAX_PENDING_FALLBACK;
  const isMemberCap = maxPending > INVITE_MAX_PENDING_FALLBACK;

  const chip = (m: MyInvite) => {
    const s = m.status === 'pending'
      ? { t: '等待回应', c: 'var(--ac-dim)', b: 'var(--ac-bg)', bd: 'var(--ac-bdr)' }
      : m.status === 'consumed'
        ? { t: '已回应', c: 'var(--vip-ink, #7c5cbf)', b: 'var(--vip-bg)', bd: 'var(--vip-bdr)' }
        : { t: '已失效', c: 'var(--tx-3)', b: 'transparent', bd: 'var(--bdr-med)' };
    return (
      <span style={{
        fontSize: '11px', padding: '2px 8px', borderRadius: '999px', whiteSpace: 'nowrap',
        color: s.c, background: s.b, border: `1px solid ${s.bd}`,
      }}>{s.t}</span>
    );
  };

  // 锁面文案区分两种原因（服务端 view_locked 是合集）：最新一条超窗 vs 不是
  // 最近一条（H5 从列表数据取最近已回应，判定口径与服务端一致）
  const latestConsumed = list
    ?.filter(m => m.kind === 'heming' && m.status === 'consumed' && m.consumed_at)
    .reduce<string | null>((acc, m) => (!acc || m.consumed_at! > acc ? m.consumed_at! : acc), null) ?? null;

  const subline = (m: MyInvite) => {
    if (m.status === 'consumed' && m.view_locked) {
      return m.consumed_at && m.consumed_at === latestConsumed
        ? '免费回看已过（回应后 24 小时）'
        : '免费仅可回看最近一条已回应';
    }
    if (m.status === 'consumed' && m.consumed_at) return `${fmtTime(m.consumed_at)} TA 已回应`;
    if (m.status === 'pending') {
      const left = Math.max(1, Math.ceil((new Date(m.created_at).getTime() + INVITE_TTL_MS - Date.now()) / 86400000));
      return `${fmtTime(m.created_at)} 发起 · 剩 ${left} 天`;
    }
    return `${fmtTime(m.created_at)} 发起`;
  };

  const linkBtn = (color: string): React.CSSProperties => ({
    fontSize: '12px', color, background: 'none', border: 'none', cursor: 'pointer',
    padding: '4px 2px', whiteSpace: 'nowrap',
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`chart-reset-btn ${className}`}
        style={buttonStyle}
      >
        {label}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center',
              justifyContent: 'center', padding: '16px',
            }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.22 }}
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: '420px', maxHeight: '80vh', overflowY: 'auto',
                background: 'var(--bg-0)', border: '1px solid var(--bdr)', borderRadius: '16px',
                boxShadow: '0 24px 60px rgba(0,0,0,0.3)', textAlign: 'left',
              }}
            >
              {/* 标题行：在途计数 x/5 + 关闭 */}
              <div style={{
                padding: '14px 18px', borderBottom: '1px solid var(--bdr)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--tx-0)', letterSpacing: '0.1em' }}>
                    ☯ 我的合盘邀请
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--tx-3)', marginTop: '2px' }}>
                    在途 {pendingN}/{maxPending} · 邀请 7 天有效
                    {isMemberCap
                      ? ' · 合盘已存云端档案，永久回看'
                      : ' · 开通会员合盘永久存云端档案'}
                  </div>
                </div>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="关闭"
                  style={{
                    width: '28px', height: '28px', borderRadius: '50%', border: 'none',
                    background: 'var(--bg-2)', color: 'var(--tx-2)', fontSize: '16px',
                    cursor: 'pointer', lineHeight: 1,
                  }}
                >×</button>
              </div>

              <div style={{ padding: '6px 18px 18px' }}>
                {list === null && (
                  <div style={{ textAlign: 'center', padding: '28px 0', fontSize: '12px', color: 'var(--tx-3)' }}>读取中…</div>
                )}
                {list !== null && loadErr && (
                  <div style={{ textAlign: 'center', padding: '28px 0', fontSize: '12px', color: '#c88' }}>
                    列表读取失败，稍后再试
                  </div>
                )}
                {list !== null && !loadErr && list.length === 0 && (
                  <div style={{ textAlign: 'center', padding: '28px 0', fontSize: '12px', color: 'var(--tx-3)', lineHeight: 1.8 }}>
                    还没有发起过合盘邀请<br />填好你的生辰，点「和 TA 合一张盘」发给 TA
                  </div>
                )}
                {list !== null && list.map(m => (
                  <div key={m.token} style={{ padding: '12px 0', borderBottom: '1px solid var(--bdr)' }}>
                    {/* 两行结构（2026-11-11 真机反馈「弹窗被文字挤宽」）：首行徽+操作、
                        次行说明——窄屏最小内容宽度不再把弹窗撑破 */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      {chip(m)}
                      <span style={{ flex: 1 }} />
                      {m.status === 'consumed' && !m.view_locked && (
                        <button
                          onClick={() => { setOpen(false); router.push(`/invite?invite=${encodeURIComponent(m.token)}&a=1`); }}
                          style={linkBtn('var(--ac-dim)')}
                        >
                          查看合盘 ›
                        </button>
                      )}
                      {/* 超窗/非最近一条锁面：会员永久回看——邀请是社交事件有时效，
                          永久留存是云端档案的会员权益 */}
                      {m.status === 'consumed' && m.view_locked && (
                        <button
                          onClick={() => openPaySheet('member')}
                          style={{ ...linkBtn('var(--vip)'), fontWeight: 600 }}
                        >
                          🔒 会员永久回看
                        </button>
                      )}
                      {m.status === 'pending' && confirming !== m.token && (
                        <button onClick={() => { setConfirming(m.token); setRowErr(null); }} style={linkBtn('var(--tx-3)')}>
                          撤回
                        </button>
                      )}
                    </div>
                    <div style={{
                      marginTop: '6px', fontSize: '12px', color: 'var(--tx-2)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {subline(m)}
                    </div>
                    {/* 行内撤回确认：撤了对方打开即「已失效」，不可恢复 */}
                    {confirming === m.token && (
                      <div style={{
                        marginTop: '10px', padding: '10px 12px', borderRadius: '10px',
                        background: 'var(--bg-2)', display: 'flex', alignItems: 'center', gap: '10px',
                      }}>
                        <span style={{ flex: 1, fontSize: '12px', color: 'var(--tx-2)', lineHeight: 1.6 }}>
                          撤回后对方打开会显示「已失效」
                        </span>
                        <button onClick={() => setConfirming(null)} style={linkBtn('var(--tx-3)')}>取消</button>
                        <button
                          onClick={() => revoke(m.token)}
                          disabled={revoking === m.token}
                          style={{ ...linkBtn('#e08585'), fontWeight: 600, opacity: revoking === m.token ? 0.6 : 1 }}
                        >
                          {revoking === m.token ? '撤回中…' : '确认撤回'}
                        </button>
                      </div>
                    )}
                    {rowErr?.token === m.token && (
                      <div style={{ marginTop: '6px', fontSize: '11px', color: '#dc2626' }}>{rowErr.msg}</div>
                    )}
                  </div>
                ))}
                {list !== null && list.length > 0 && (
                  <div style={{ fontSize: '11px', color: 'var(--tx-3)', marginTop: '12px', lineHeight: 1.7 }}>
                    在途最多 {maxPending} 张，满了自动顶掉最早未回应的；列表只保留近 7 天。
                    {isMemberCap
                      ? <>已回应的合盘可随时回看——会员打开即存入云端档案，永久留存。<span
                          onClick={() => { setOpen(false); router.push('/archive'); }}
                          style={{ color: 'var(--vip)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2, whiteSpace: 'nowrap' }}
                        >去云端档案查看 ›</span></>
                      : <>免费仅可回看最近一条已回应（24 小时内）；<span
                          onClick={() => openPaySheet('member')}
                          style={{ color: 'var(--vip)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 }}
                        >开通会员</span>在途提升到 10 张、全部永久回看并存云端档案。</>}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
