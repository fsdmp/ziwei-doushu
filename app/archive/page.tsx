'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestJSON } from '@/lib/ai';
import { openPaySheet } from '@/lib/mini-bridge';
import { refreshMember, isMember, touchSession } from '@/lib/unlock';
import { loadLastSession, LAST_SESSION_EVENT, type LastSession } from '@/lib/ziwei/history';
import { archiveQDisplay } from '@/lib/ziwei/q-label';
import ChartBoard from '@/components/ChartBoard';
import AiContent from '@/components/AiContent';
import type { ZiweiChart } from '@/lib/ziwei/types';

/**
 * 云端档案（docs/10 §5）：会员的起盘/合盘/解读云端留存。非会员可见入口，
 * 点进引导开会员（openPaySheet 收银台通道）——档案是这个功能自带的转化曝光位。
 * 三态：列表（卡片流，20/页）→ 详情（盘面只读 + 问答流水 + 用此盘继续问）；
 * 非成员态 = 引导层，本地有「上一次」时拆两段对比式转化（免费回看最近一次 ↔
 * 会员留存每一次，2026-11-06）。读路径不校验会员（过期冻结可看），非会员
 * 列表恒空（零落库）。
 */

interface ArchiveItem {
  id: number;
  kind: 'solo' | 'heming';
  label: string;
  asked_at: string;
  msg_count: number;
  last_q: string;
  last_a_digest: string;
}

interface ArchiveDetail {
  id: number;
  kind: 'solo' | 'heming';
  label: string;
  chart_a: ZiweiChart;
  chart_b: ZiweiChart | null;
  session_id: string;
  msgs: { question: string; answer: string; created_at: string }[];
}

/** 非会员「回看上一次」的数据源（docs/10 §5.4 本地会话）：solo/heming 各存
 *  最近 1 条，取 savedAt 较新者展示。chart 缺失的脏数据视为无记录。 */
type LastPick = { kind: 'solo' | 'heming'; data: LastSession };

/** 读本地「上一次」快照（mount 与 LAST_SESSION_EVENT 重读共用一份口径）。 */
function pickLastSession(): LastPick | null {
  const cands: LastPick[] = [];
  for (const kind of ['solo', 'heming'] as const) {
    const last = loadLastSession(kind);
    if (last?.chart) cands.push({ kind, data: last });
  }
  return cands.length ? cands.reduce((a, b) => (b.data.savedAt > a.data.savedAt ? b : a)) : null;
}

export default function ArchivePage() {
  const router = useRouter();
  const [member, setMember] = useState<boolean | null>(null); // null=加载中
  const [items, setItems] = useState<ArchiveItem[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [detail, setDetail] = useState<ArchiveDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [justImported, setJustImported] = useState(false);
  // 非会员「回看上一次」：mounted 后再读 localStorage——渲染期读会与预渲染
  // HTML 不一致触发 hydration 回退（/chart 同款处理，不新增 mismatch 源）
  const [lastPick, setLastPick] = useState<LastPick | null>(null);
  useEffect(() => { setLastPick(pickLastSession()); }, []);

  const fetchList = useCallback(async () => {
    try {
      const d = await requestJSON<{ items: ArchiveItem[]; more: boolean }>(
        `/api/v1/ziwei/archive?page=1`, 'GET');
      setItems(d.items || []);
      setMore(d.more);
      setPage(1); // 重拉即回第一页（事件触发的后台刷新可能打断翻页态）
    } catch {
      setErr('档案读取失败，稍后再试');
    }
  }, []);

  // 开通导入（docs/10 §0.6）：会员进档案页时把本地最近一条会话静默存入云端
  //（已导入过服务端幂等跳过）——开通瞬间柜子不空。失败静默（下次再试）。
  const importLocal = useCallback(async () => {
    let importedAny = false;
    for (const kind of ['solo', 'heming'] as const) {
      const last = loadLastSession(kind);
      const chart = last?.chart as ZiweiChart | undefined;
      if (!chart?.sessionId) continue; // 老数据无会话 id，无物可导
      try {
        const res = await requestJSON<{ imported: boolean }>(
          '/api/v1/ziwei/archive/import', 'POST', {
            chart,
            chartB: kind === 'heming' ? last?.chartB : undefined,
            messages: (last?.messages ?? []).map(m => ({ role: m.role, content: m.content })),
          });
        if (res.imported) importedAny = true; // 记下继续走：两盘一次进齐，不因 solo 成功就漏 heming
      } catch { /* 静默 */ }
    }
    return importedAny; // 有新导入：列表要重拉
  }, []);

  // 会员态 + 首页列表（引导层与列表互斥：非会员不拉档案）
  useEffect(() => {
    (async () => {
      await refreshMember();
      setMember(isMember());
      if (isMember()) {
        const imported = await importLocal();
        await fetchList();
        if (imported) setJustImported(true);
      }
    })();
  }, [fetchList, importLocal]);

  // 别处的解读流收尾（2026-11-08 真机反馈「刚起的盘退出再进才有」）：流在
  // /chart 起的 fetch 不随路由切换中断，用户常在解读还在生成时就点进档案页
  // ——mount 快照（本地「上一次」/云端列表）此刻都没有这轮问答。收尾保存的
  // LAST_SESSION_EVENT 到点：重读「上一次」；会员的云端档案行由服务端在同一
  // 刻异步落库，等一拍再重拉列表。多轮连发用尾沿防抖合并成一次。
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const onSaved = () => {
      setLastPick(pickLastSession());
      if (member !== true) return;
      if (refetchTimer.current) clearTimeout(refetchTimer.current);
      refetchTimer.current = setTimeout(() => {
        refetchTimer.current = null;
        fetchList();
      }, 600);
    };
    window.addEventListener(LAST_SESSION_EVENT, onSaved);
    return () => {
      window.removeEventListener(LAST_SESSION_EVENT, onSaved);
      if (refetchTimer.current) { clearTimeout(refetchTimer.current); refetchTimer.current = null; }
    };
  }, [member, fetchList]);

  const loadMore = useCallback(async () => {
    if (loading || !more) return;
    setLoading(true);
    try {
      const next = page + 1;
      const d = await requestJSON<{ items: ArchiveItem[]; more: boolean }>(
        `/api/v1/ziwei/archive?page=${next}`, 'GET');
      setItems(prev => [...prev, ...(d.items || [])]);
      setPage(next);
      setMore(d.more);
    } catch { /* 翻页失败静默 */ } finally {
      setLoading(false);
    }
  }, [loading, more, page]);

  const openDetail = useCallback(async (id: number) => {
    setErr('');
    try {
      const d = await requestJSON<ArchiveDetail>(`/api/v1/ziwei/archive/${id}`, 'GET');
      setDetail(d);
    } catch {
      setErr('这份档案取不出来了');
    }
  }, []);

  const removeItem = useCallback(async (id: number) => {
    if (!confirm('删除这份档案？删除后无法找回。')) return;
    try {
      await requestJSON(`/api/v1/ziwei/archive/${id}`, 'DELETE');
      setItems(prev => prev.filter(i => i.id !== id));
      if (detail?.id === id) setDetail(null);
    } catch { /* 静默 */ }
  }, [detail]);

  // 用此盘继续问（docs/10 §5.1）：盘 JSON 暂存 sessionStorage，跳对应页恢复
  // ——sessionId 原样带回，落库钩子按 session_id 归并同盘。touchSession 把该盘
  // 抬回「最近 10 盘」白名单，否则下次启动 cleanupOldSessions 会清掉它的
  // 问答计数/流年解锁键（早于窗口的老档案盘恢复即被重锁）。
  // 问答原文一并带回（2026-11-06 真机反馈：只带盘跳过去历史问答没了）：solo
  // 转成 InsightPanel 会话初值（云端流水无 hidden 概念，平铺 user/assistant）；
  // heming 页是「单次全量分析」模型，取云端最后一轮 answer 当 analysis——与
  // 本地「回到上次」同语义（那里存的就是最近一次 runAnalysis 的全文）。
  // 合盘必须回 /heming 恢复双盘（2026-11-06）：走 /chart 会以 solo 口追问，
  // 服务端 upsert 同 session 行把 kind 覆盖成 solo、乙盘数据被清空（降级）。
  // 缺 chart_b 的老 heming 行兜底走 /chart（无乙盘可恢复，与 solo 同路）
  const continueAsk = useCallback((d: ArchiveDetail) => {
    const toHeming = d.kind === 'heming' && d.chart_b;
    const lastAnswer = d.msgs.length ? d.msgs[d.msgs.length - 1].answer : '';
    try {
      if (toHeming) {
        sessionStorage.setItem('ziwei_archive_restore_heming',
          JSON.stringify({ chartA: d.chart_a, chartB: d.chart_b, analysis: lastAnswer }));
      } else {
        sessionStorage.setItem('ziwei_archive_restore', JSON.stringify({
          chart: d.chart_a,
          // 页内注入的结构化指令（主题/选宫/四化）按 hidden 恢复——不渲染用户
          // 气泡（2026-11-08 真机反馈：续问后对话里把指令原文显示出来了），
          // 但 content 原样带回：下一轮全量回传时上下文不缺（hidden 是纯前端
          // 展示概念，见 InsightPanel 对 roundMessages 的处理）
          messages: d.msgs.flatMap(m => [
            { role: 'user' as const, content: m.question || '（默认综合解读）',
              hidden: m.question ? archiveQDisplay(m.question).auto || undefined : undefined },
            { role: 'assistant' as const, content: m.answer },
          ]),
        }));
      }
      touchSession(d.session_id);
      router.push(toHeming ? '/heming' : '/chart');
    } catch { /* 存不进直接跳，起盘态由用户自起 */ router.push(toHeming ? '/heming' : '/chart'); }
  }, []);

  // 非会员「回看上一次」（docs/10 §5.4）：本地最近一条直达恢复——复用档案
  // 续问的 sessionStorage 通道，但载荷多带问答/解读原文（消费端向后兼容：
  // 会员续问不带、仍是新轮问答），恢复成与页内「回到上次」同款完整会话——
  // 同名入口行为必须一致（2026-11-06 真机反馈：只带盘跳过去历史问答没了）。
  // touchSession 抬白名单与 continueAsk 同因（老盘不抬会被启动 cleanup 重锁
  // 问答计数/流年键），老数据无 sessionId 时跳过 touch 照常恢复。零云端请求
  //（非会员零落库不破）
  const viewLast = useCallback(() => {
    if (!lastPick?.data.chart) return;
    const toHeming = lastPick.kind === 'heming' && !!lastPick.data.chartB;
    try {
      if (toHeming) {
        sessionStorage.setItem('ziwei_archive_restore_heming', JSON.stringify({
          chartA: lastPick.data.chart,
          chartB: lastPick.data.chartB,
          analysis: lastPick.data.analysis ?? '',
        }));
      } else {
        sessionStorage.setItem('ziwei_archive_restore', JSON.stringify({
          chart: lastPick.data.chart,
          messages: lastPick.data.messages ?? [],
        }));
      }
      const sid = (lastPick.data.chart as ZiweiChart).sessionId;
      if (sid) touchSession(sid);
      router.push(toHeming ? '/heming' : '/chart');
    } catch { /* 存不进直接跳，起盘态由用户自起 */ router.push(toHeming ? '/heming' : '/chart'); }
  }, [lastPick, router]);

  const cardStyle = {
    background: 'var(--t-card, rgba(255,255,255,0.04))',
    border: '1px solid var(--t-border, rgba(255,255,255,0.1))',
    borderRadius: '14px',
  };

  return (
    <main className="mx-auto w-full" style={{ maxWidth: 640, padding: '24px 14px calc(32px + env(safe-area-inset-bottom))' }}>
      <div className="flex items-center justify-between" style={{ marginBottom: 18 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700 }}>云端档案</h1>
          <p style={{ fontSize: 12, color: 'var(--t-faint, #999)', marginTop: 2 }}>
            {member
              ? '起盘 · 合盘 · 解读，永久留存'
              : lastPick
                ? '上一次可回看 · 每一次留云端'
                : '会员专属 · 命盘与解读云端永存'}
          </p>
        </div>
        <button
          onClick={() => router.push('/chart')}
          className="px-3 py-1.5 rounded-lg"
          style={{ fontSize: 12, border: '1px solid var(--t-border, rgba(255,255,255,0.15))', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
        >
          起一张盘
        </button>
      </div>

      {/* 加载中 */}
      {member === null && (
        <div style={{ textAlign: 'center', padding: '48px 0', fontSize: 13, color: 'var(--t-faint, #999)' }}>…</div>
      )}

      {/* 非会员：引导层（档案功能的转化曝光位，docs/10 §5.2）。
          本地有「上一次」时拆两段对比式转化（2026-11-06）：先给免费甜头
          （本机留着最近一次，可回看），再给会员对比（每一次都留云端） */}
      {member === false && (
        <div style={{ ...cardStyle, padding: 28, textAlign: 'center' }}>
          <div style={{ fontSize: 34, marginBottom: 8 }}>✦</div>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>紫微云端档案</div>
          {lastPick ? (
            <>
              <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--t-text, #ccc)' }}>
                上一次的盘与解读还在本机——<br />最近一次，随时回看、继续问。
              </div>
              <button
                onClick={viewLast}
                className="w-full py-2.5 rounded-xl"
                style={{
                  fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', cursor: 'pointer',
                  border: '1px solid var(--t-border, rgba(255,255,255,0.2))',
                  background: 'transparent', color: 'inherit', marginTop: 12, marginBottom: 16,
                }}
              >
                ✦ 回看上一次 · 继续那张盘
              </button>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10,
                margin: '0 0 14px', color: 'var(--t-faint, #999)', fontSize: 11, letterSpacing: '0.15em',
              }}>
                <span style={{ flex: 1, height: '1px', background: 'var(--t-border, rgba(255,255,255,0.1))' }} />
                开通会员后
                <span style={{ flex: 1, height: '1px', background: 'var(--t-border, rgba(255,255,255,0.1))' }} />
              </div>
            </>
          ) : null}
          <div style={{ fontSize: 13, lineHeight: 1.9, color: 'var(--t-text, #ccc)', marginBottom: 20 }}>
            每一次起盘、每一次合盘、每一句解读——<br />
            云端永久留存，换手机也在。<br />
            <span style={{ fontSize: 12, color: 'var(--t-faint, #999)' }}>
              会员还可免分享解锁问答与流年。
            </span>
          </div>
          <button
            onClick={() => openPaySheet('member')}
            className="w-full py-2.5 rounded-xl"
            style={{
              fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', cursor: 'pointer',
              background: 'var(--vip-grad)', color: 'white',
            }}
          >
            开通会员 · 解锁云端档案
          </button>
          {!lastPick && (
            <div style={{ fontSize: 11, color: 'var(--t-faint, #999)', marginTop: 10 }}>
              起一张盘后，最近一次的记录会留在这里，随时可回看。
            </div>
          )}
          <div style={{ fontSize: 11, color: 'var(--t-faint, #999)', marginTop: 10 }}>
            已免费的一切照旧 · 本地记录不受影响
          </div>
        </div>
      )}

      {/* 会员：列表 / 详情 */}
      {member === true && !detail && (
        <>
          {items.length === 0 && !err && (
            <div style={{ ...cardStyle, padding: 32, textAlign: 'center', fontSize: 13, color: 'var(--t-faint, #999)' }}>
              档案还是空的——去起一张盘，解读会自动存进来。
            </div>
          )}
          {err && <div style={{ textAlign: 'center', fontSize: 12, color: '#c88', padding: 16 }}>{err}</div>}
          {justImported && (
            <div style={{ ...cardStyle, padding: '10px 16px', marginBottom: 4, fontSize: 12, color: 'var(--t-faint, #999)' }}>
              ✦ 上次的盘已存入云端档案
            </div>
          )}
          <div className="flex flex-col" style={{ gap: 10 }}>
            {items.map(it => (
              <div key={it.id} style={{ ...cardStyle, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <button onClick={() => openDetail(it.id)} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'transparent', border: 'none', padding: 0, color: 'inherit', cursor: 'pointer' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {it.kind === 'heming' ? '♡ 合盘' : '✦ 命盘'}
                    <span style={{ fontSize: 11, color: 'var(--t-faint, #999)', fontWeight: 400 }}>{it.label}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--t-faint, #999)', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {it.last_q ? `最近一问：${archiveQDisplay(it.last_q).label}` : '暂无解读'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t-faint, #aaa)', marginTop: 2 }}>
                    {new Date(it.asked_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {' · '}{it.msg_count} 轮解读
                  </div>
                </button>
                <button
                  onClick={() => removeItem(it.id)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--t-faint, #888)', fontSize: 11, cursor: 'pointer', padding: 4 }}
                  aria-label="删除"
                >
                  删除
                </button>
              </div>
            ))}
          </div>
          {more && (
            <button
              onClick={loadMore}
              disabled={loading}
              className="w-full py-2.5 rounded-xl mt-3"
              style={{ fontSize: 12, border: '1px solid var(--t-border, rgba(255,255,255,0.15))', background: 'transparent', color: 'inherit', cursor: 'pointer' }}
            >
              {loading ? '…' : '展开更早'}
            </button>
          )}
        </>
      )}

      {member === true && detail && (
        <>
          <button
            onClick={() => setDetail(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--t-faint, #999)', fontSize: 12, cursor: 'pointer', marginBottom: 12, padding: 0 }}
          >
            ← 返回档案
          </button>
          <div style={{ ...cardStyle, padding: '16px 18px', marginBottom: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {detail.kind === 'heming' ? '♡ 合盘' : '✦ 命盘'} · {detail.label}
            </div>
            <button
              onClick={() => continueAsk(detail)}
              className="mt-3 w-full py-2 rounded-lg"
              style={{ fontSize: 12, fontWeight: 600, cursor: 'pointer', background: 'var(--vip-grad)', color: 'white', border: 'none' }}
            >
              {detail.kind === 'heming' && detail.chart_b ? '✦ 回到这张合盘继续问' : '✦ 用这张盘继续问'}
            </button>
          </div>
          {/* 合盘双盘都渲染（2026-11-06）：乙盘一直存着但此前看不见 */}
          {detail.kind === 'heming' && (
            <div style={{ fontSize: 11, color: 'var(--t-faint, #999)', letterSpacing: '0.2em', marginBottom: 6 }}>甲方之盘</div>
          )}
          <div style={{ ...cardStyle, padding: '10px 12px', marginBottom: 12, overflowX: 'auto' }}>
            <ChartBoard chart={detail.chart_a} />
          </div>
          {detail.kind === 'heming' && detail.chart_b && (
            <>
              <div style={{ fontSize: 11, color: 'var(--t-faint, #999)', letterSpacing: '0.2em', marginBottom: 6 }}>乙方之盘</div>
              <div style={{ ...cardStyle, padding: '10px 12px', marginBottom: 12, overflowX: 'auto' }}>
                <ChartBoard chart={detail.chart_b} />
              </div>
            </>
          )}
          {detail.msgs.map((m, i) => (
            <div key={i} style={{ ...cardStyle, padding: '14px 16px', marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: 'var(--t-faint, #999)', marginBottom: 6 }}>
                {new Date(m.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                问：{m.question ? archiveQDisplay(m.question).label : '（默认综合解读）'}
              </div>
              {/* 与聊天面板/heming 页同一渲染口径（**【小节】** 金色头 + **加粗**）：
                  此前 pre-wrap 纯文本，markdown 记号原样露出（2026-11-08 真机反馈） */}
              <AiContent text={m.answer} />
            </div>
          ))}
        </>
      )}
    </main>
  );
}
