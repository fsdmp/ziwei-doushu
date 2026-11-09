'use client';
import { useState, useCallback, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import BirthForm, { type BirthFormState } from '@/components/BirthForm';
import ShareButton from '@/components/ShareButton';
import HemingInviteButton from '@/components/HemingInviteButton';
import MyHemingInviteButton from '@/components/MyHemingInviteButton';
import AiContent from '@/components/AiContent';
import { streamAI, type AIError } from '@/lib/ai';
import { formToBirthInfo, formFromBirthInfo } from '@/lib/ziwei/share';
import { generateChart as buildChart } from '@/lib/ziwei/algorithm';
import { newSessionId } from '@/lib/unlock';
import { reportEventOnce } from '@/lib/events';
import { touchSession } from '@/lib/unlock';
import { saveLastSession, loadLastSession, type LastSession } from '@/lib/ziwei/history';
import { archiveQDisplay } from '@/lib/ziwei/q-label';
import type { BirthInfo, ZiweiChart } from '@/lib/ziwei/types';
import { useTheme } from '@/components/ThemeProvider';

/** 首轮综合分析的默认问（与服务端 ziweiHemingDefaultQuestion 同文案、q-label.ts
 *  前缀同源，改任何一侧都要同步）：追问回传历史时首轮 q 空缺补它——模型上下文
 *  里此前的问答才成对 */
const HEMING_DEFAULT_Q = '请综合分析我们两人的合盘：性格互补与冲突、感情互动模式、需要彼此留意的地方，并给出相处建议。';

/** 合盘一轮已完成的问答：q 空串 = 首轮综合分析（展示「合盘综合解读」） */
interface HemingRound { q: string; a: string }

/** 流式中的新轮：text 是增量累积的半成品，完成后转正为 HemingRound */
interface HemingStream { q: string; text: string }

export default function HemingPage() {
  const router = useRouter();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // ─── 双方命盘状态 ─────────────────────────────────────────
  const [chartA, setChartA] = useState<ZiweiChart | null>(null);
  const [chartB, setChartB] = useState<ZiweiChart | null>(null);
  // 双方表单状态由 BirthForm onFormSave 同步到此处，统一按钮触发起盘
  const [formA, setFormA] = useState<BirthFormState | null>(null);
  const [formB, setFormB] = useState<BirthFormState | null>(null);
  // 合盘会话多轮态（2026-11-09 追问带上下文改造）：rounds 是已完成轮次，stream
  // 是流式中的新轮——旧实现单字符串 analysis 每轮被清空顶替（旧解读闪没、
  // 快捷问题/输入框整块卸载），与 solo 聊天面板的连续感差一截
  const [rounds, setRounds] = useState<HemingRound[]>([]);
  const [stream, setStream] = useState<HemingStream | null>(null);
  // 「回到上次」按钮的数据源：mounted 后再读 localStorage——渲染期读会与预渲染
  // HTML（构建期无存储数据 = 无按钮）不一致，触发 hydration 回退整树重渲
  //（web-view 有 hydrate 黑屏前科，docs/09 §8，不新增 mismatch 源）
  const [lastHeming, setLastHeming] = useState<LastSession | null>(null);
  useEffect(() => { setLastHeming(loadLastSession('heming')); }, []);

  // 当前合盘会话 id：只在起盘动作生成，与盘的生成/重建解耦（追问沿用同一 id，
  // server interpret_done/档案按它归并）；恢复通道（archive 载荷、回到上次）从
  // 带来的盘上同步——续问落库归并同一行盘
  const sessIdRef = useRef<string | null>(null);
  // 双盘对应的表单快照（JSON 串）：盘在手里时表单动没动的判定依据——未动则
  // 追问沿用现有盘不重排（档案恢复的老行无 origInput，反推表单再重排会得到
  // 另一张盘并覆盖档案行）；动过才按新表单重建（上游 #52 语义保留）
  const formsSnapshotRef = useRef<string>('');

  // 档案「回到这张合盘继续问」恢复通道（docs/10 §5.1，2026-11-06 合盘同权）：
  // archive 页存双盘 JSON 跳来，一次性消费（读后即清）。sessionId 原样保留——
  // 续问落库按 session_id 归并同一行盘（合盘口，不再有 solo 降级覆盖乙盘）；
  // 生辰一并换回表单态（chart 页恢复同款）：重新合盘改生辰、邀请/分享原料都在。
  // 轮次还原（2026-11-09）：rounds 优先（档案恢复带全部问答），analysis 兜底
  //（老载荷/非会员「回看上一次」旧数据只有末轮全文）
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ziwei_archive_restore_heming');
      if (!raw) return;
      sessionStorage.removeItem('ziwei_archive_restore_heming');
      const r = JSON.parse(raw) as {
        chartA: ZiweiChart; chartB: ZiweiChart;
        analysis?: string; rounds?: HemingRound[];
      };
      if (r.chartA?.palaces && r.chartB?.palaces) {
        setChartA(r.chartA);
        setChartB(r.chartB);
        if (r.chartA.sessionId) sessIdRef.current = r.chartA.sessionId;
        const fa = r.chartA.birthInfo ? formFromBirthInfo(r.chartA.birthInfo) : null;
        const fb = r.chartB.birthInfo ? formFromBirthInfo(r.chartB.birthInfo) : null;
        if (fa) setFormA(fa);
        if (fb) setFormB(fb);
        formsSnapshotRef.current = JSON.stringify([fa, fb]);
        setRounds(r.rounds?.length ? r.rounds : (r.analysis ? [{ q: '', a: r.analysis }] : []));
      }
    } catch { /* 恢复失败走表单 */ }
  }, []);

  // ─── AI 合盘分析状态 ─────────────────────────────────────
  const [analyzing, setAnalyzing] = useState(false);
  const [question, setQuestion] = useState('');
  const [analysisError, setAnalysisError] = useState(false);
  // 后端未实现时（404）单独说明，而不是让用户反复重试
  const [apiMissing, setApiMissing] = useState(false);
  // 登录态缺失/过期（后端 fail-closed）：提示回小程序重新打开
  const [authExpired, setAuthExpired] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const analysisRef = useRef<HTMLDivElement>(null);

  // 会话是否已开始（出现过至少一轮或正在流式）：追问框常驻的判定——流式期间
  // 不再卸载（旧实现的 {analysis && …} 门让追问框每轮闪没）
  const hasSession = rounds.length > 0 || analyzing || !!stream;

  // ─── 起盘（单次调用，返回 chart 给统一流程使用）──────────
  // 开源版不含后端 /api/generate：直接用本仓库的排盘引擎在浏览器里起盘
  const generateChart = useCallback(async (info: BirthInfo): Promise<ZiweiChart | null> => {
    try {
      return buildChart(info);
    } catch {
      return null;
    }
  }, []);

  // 表单是否填齐
  const isFormReady = (f: BirthFormState | null): boolean =>
    !!(f && f.year && f.month && f.day && f.gender && (f.unknownTime || (f.clockHour !== '' && f.clockMinute !== '')));

  // ─── 统一入口：起盘 + 合盘分析（含追问）───────────────────
  const runAnalysis = useCallback(async (q?: string) => {
    setFormError(null);
    if (!isFormReady(formA) || !isFormReady(formB)) {
      setFormError('请先填写双方完整出生信息');
      return;
    }
    setAnalyzing(true);
    setStream({ q: q ?? '', text: '' });
    setAnalysisError(false);
    setAuthExpired(false);
    // 新轮从框顶开始流式（旧实现只在完成后滚一次；追问发起时用户在下方输入区，
    // 不滚的话新内容在其视口外长出来）
    setTimeout(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);

    try {
      // 盘面复用优先（2026-11-09 档案续问错盘修法）：表单未动（快照一致）且有盘
      // 时沿用现有双盘，不重排——档案恢复的老行没有 origInput，反推表单重排会
      // 得到完全不同的盘（时辰退化子时、农历退化换算日），同 sessionId 落库把
      // 档案行盘面覆盖成错盘。改过生辰或首盘才按当前表单重建（上游 #52 保留：
      // 每次起盘跟当前表单走，避免编辑生辰后复用旧盘）
      let cA = chartA;
      let cB = chartB;
      const snap = JSON.stringify([formA, formB]);
      if (cA && cB && snap === formsSnapshotRef.current) {
        // 复用路径也要抬白名单：档案/回到上次恢复的盘再追问，问答计数/流年
        // 解锁键不能被启动 cleanup 重锁
        const sid = cA.sessionId;
        if (sid) touchSession(sid);
      } else {
        // 每次按当前表单起盘，避免编辑出生信息后复用旧盘（上游 #52）；
        // 农历输入换算失败（日期不存在）在此拦下
        const infoA = formToBirthInfo(formA!);
        const infoB = formToBirthInfo(formB!);
        if (!infoA || !infoB) {
          setFormError('农历日期不存在，请核对双方出生日期（闰月 / 当月天数）');
          return;
        }
        const [builtA, builtB] = await Promise.all([
          generateChart(infoA),
          generateChart(infoB),
        ]);
        if (!builtA || !builtB) {
          setAnalysisError(true);
          setAnalyzing(false);
          return;
        }
        cA = builtA;
        cB = builtB;
        // 会话 id 只在起盘动作生成，与盘的重建解耦（与 solo 口径一致：一次起盘
        // 一个 uuid）：本页已有会话（追问/恢复通道带来）沿用，首次起盘才生成
        const sid = sessIdRef.current ?? newSessionId();
        sessIdRef.current = sid;
        cA.sessionId = sid; // server interpret_done/档案按甲盘 sessionId 归因
        setChartA(cA);
        setChartB(cB);
        formsSnapshotRef.current = snap;
        // 数据事件面（docs/11 §1）：一次合盘起盘一记（同 id 自动去重）——复用盘
        // 的追问不算新起盘，不重记
        reportEventOnce('chart_new', sid, { chart_kind: 'heming', from: 'fresh' });
        touchSession(sid);
      }

      // 历史轮次全量回传（服务端 20 条窗口，与 solo 同口径）：追问的上下文——
      // 此前不带历史，服务端每轮孤立全量重分析，「继续追问」答非所续
      //（2026-11-09 真机反馈）。只传历史，不带当前问——服务端把 question 收尾
      // 追加进 LLM 序列，这里再带一份就重复两次。空问补默认问（老档案行首轮
      // question 存的就是服务端默认问的答案对，原样还原问句才不悬空）
      const msgs = rounds.flatMap(r => [
        { role: 'user' as const, content: r.q || HEMING_DEFAULT_Q },
        { role: 'assistant' as const, content: r.a },
      ]);
      const acc = await streamAI('/api/v1/ziwei/heming',
        { chartA: cA, chartB: cB, question: q ?? undefined, messages: msgs },
        (_delta, full) => setStream({ q: q ?? '', text: full }));
      if (!acc) throw new Error('empty');
      const nextRounds = [...rounds, { q: q ?? '', a: acc }];
      setRounds(nextRounds);
      // 本地最近一条会话（docs/10 §5.4）：heming「回到上次」的数据源。rounds
      // 全量留存（多轮会话），analysis 兼容字段留末轮全文（老读者回退用）
      saveLastSession('heming', {
        chart: cA, chartB: cB, formA: formA ?? undefined, formB: formB ?? undefined,
        analysis: acc, rounds: nextRounds,
      });
      setTimeout(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      // 后端缺失（404）单独说明，而不是让用户反复重试
      if ((e as AIError).code === 'api-missing') setApiMissing(true);
      if ((e as AIError).code === 'auth-expired') setAuthExpired(true);
      setAnalysisError(true);
    } finally {
      setAnalyzing(false);
      setStream(null);
    }
  }, [formA, formB, chartA, chartB, rounds, generateChart]);

  // 回到本轮会话起点：清轮次与双盘（快照一并清，下次按当前表单重建）
  const resetSession = useCallback(() => {
    setRounds([]);
    setStream(null);
    setChartA(null);
    setChartB(null);
    formsSnapshotRef.current = '';
    setAnalyzing(false);
    setFormError(null);
    setAnalysisError(false);
  }, []);

  const cardStyle = {
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.9)',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(200,160,60,0.2)'}`,
    borderRadius: '16px',
    padding: '24px',
  };

  const labelStyle = {
    fontSize: '10px', letterSpacing: '0.4em', color: 'var(--ac)', opacity: 0.7,
    marginBottom: '16px', display: 'block',
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
      {/* 顶栏 */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: isDark ? 'rgba(2,8,16,0.88)' : 'rgba(250,245,235,0.92)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--bdr)',
        display: 'flex', alignItems: 'center', padding: '0 14px', height: '52px', gap: '10px',
      }}>
        <button
          onClick={() => router.push('/')}
          style={{
            display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px',
            color: 'var(--tx-3)', background: 'none', border: 'none', cursor: 'pointer',
            flexShrink: 0, whiteSpace: 'nowrap', padding: 0,
          }}
        >
          <span style={{ fontSize: '16px' }}>‹</span>
          <span>返回</span>
        </button>
        <div style={{ width: '1px', height: '20px', background: 'var(--bdr-med)' }} />
        <span style={{
          fontSize: '12px', color: 'var(--ac)', letterSpacing: '0.2em',
          flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>合盘分析</span>
        <div style={{ flex: 1 }} />
        {lastHeming && (
          <button
            onClick={() => {
              if (!lastHeming.chart) return;
              if (lastHeming.formA) setFormA(lastHeming.formA);
              if (lastHeming.formB) setFormB(lastHeming.formB);
              setChartA(lastHeming.chart as typeof chartA);
              if (lastHeming.chartB) setChartB(lastHeming.chartB as typeof chartB);
              // 恢复通道同步会话 id：续问沿用原 id 落库归并同一行盘
              sessIdRef.current = (lastHeming.chart as ZiweiChart).sessionId ?? sessIdRef.current;
              // 轮次与快照同步：多轮会话整段还原（rounds 优先，analysis 兜底），
              // 快照视作「这两盘就是当前表单起的」——追问不重排
              setRounds(lastHeming.rounds?.length
                ? lastHeming.rounds
                : (lastHeming.analysis ? [{ q: '', a: lastHeming.analysis }] : []));
              formsSnapshotRef.current = JSON.stringify([lastHeming.formA ?? null, lastHeming.formB ?? null]);
            }}
            style={{ fontSize: '12px', color: 'var(--tx-3)', background: 'none',
              border: '1px solid var(--bdr-med)', borderRadius: '8px', padding: '4px 10px',
              cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            回到上次
          </button>
        )}
        {/* 云端档案入口：会员紫（与 chart 页 .chart-archive-btn 同色，尺寸随本头部紧凑款） */}
        <button
          onClick={() => router.push('/archive')}
          style={{ fontSize: '12px', color: 'var(--vip)', background: 'var(--vip-bg)',
            border: '1px solid var(--vip-bdr)', borderRadius: '8px', padding: '4px 10px',
            cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          ✦ 云端档案
        </button>
        <span style={{
          fontSize: '11px', color: 'var(--tx-3)',
          flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>感情 · 合伙 · 亲子 · 朋友</span>
      </header>

      {/* 主体 */}
      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* 标题 */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ fontSize: '28px', color: 'var(--ac)', opacity: 0.15, marginBottom: '12px' }}>☯</div>
          <h1 style={{ fontSize: '22px', fontWeight: 600, letterSpacing: '0.15em', color: 'var(--tx-0)', marginBottom: '8px' }}>
            紫微合盘
          </h1>
          <p style={{ fontSize: '13px', color: 'var(--tx-3)', lineHeight: 1.6 }}>
            输入两个人的出生信息，AI 基于倪海厦体系分析双方命盘的缘分匹配度、感情走向与相处建议
          </p>
        </div>

        {/* 双栏表单 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '24px' }}
          className="heming-grid">
          {/* 甲方 */}
          <div style={cardStyle}>
            <span style={labelStyle}>甲方 — A</span>
            <BirthForm
              hideSubmit
              onSubmit={() => {}}
              onFormSave={setFormA}
            />
            {/* 裂变入口（docs/09 §3.1）：甲方填好后可把邀请发给 TA，由 TA 亲自填乙方——
                「想知道和 TA 的关系」是裂变引擎第一排序，比物质奖励强 */}
            <div style={{
              marginTop: '16px', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '8px',
            }}>
              {/* 竖排：手机上两个长按钮同行放不下（「和 TA 合一张盘」被迫换行
                  挤压、说明文字被顶掉）——各占整行，视觉也更有层次 */}
              <HemingInviteButton form={formA} />
              <MyHemingInviteButton />
              <p style={{ fontSize: '10px', color: 'var(--tx-3)', lineHeight: 1.6 }}>
                转发给 TA，对方填好生辰就能看到你们的合盘
              </p>
            </div>
          </div>

          {/* 乙方 */}
          <div style={cardStyle}>
            <span style={labelStyle}>乙方 — B</span>
            <BirthForm
              hideSubmit
              onSubmit={() => {}}
              onFormSave={setFormB}
            />
          </div>
        </div>

        {/* ═══ 大合盘分析框（视觉中心，始终显示）════════════════ */}
        <div ref={analysisRef} style={{
          ...cardStyle,
          minHeight: '320px',
          padding: '32px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: hasSession ? 'flex-start' : 'center',
        }}>
          {/* 区块标题 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: hasSession ? '20px' : '24px' }}>
            <span style={{ color: 'var(--ac)', opacity: 0.6 }}>◉</span>
            <span style={{ fontSize: '11px', letterSpacing: '0.3em', color: 'var(--tx-3)' }}>合盘分析 · HEMING</span>
          </div>

          {/* 已有会话的「重新合盘」：恢复/追问后想重跑（改生辰重排）没有入口——
              原「开始合盘分析」按钮在空态分支里，出了结果就消失 */}
          {hasSession && (
            <button
              onClick={resetSession}
              style={{
                alignSelf: 'flex-start', marginBottom: '16px',
                fontSize: '12px', padding: '6px 14px',
                border: '1px solid var(--bdr-med)', borderRadius: 'var(--r-pill)',
                background: 'transparent', color: 'var(--tx-3)', cursor: 'pointer',
              }}
            >
              ‹ 重新合盘（修改双方生辰）
            </button>
          )}

          {/* 轮次堆叠（旧解读保留在屏上，新轮追加——与 solo 聊天面板同一连续感） */}
          {rounds.map((r, i) => (
            <div key={i} style={{ marginBottom: i < rounds.length - 1 || stream ? '20px' : 0 }}>
              {r.q && (
                <div style={{
                  fontSize: '12px', color: 'var(--tx-2)', marginBottom: '8px',
                  padding: '6px 12px', borderRadius: '10px',
                  background: 'var(--bg-2)', display: 'inline-block',
                }}>
                  问：{archiveQDisplay(r.q).label}
                </div>
              )}
              <AiContent text={r.a} />
            </div>
          ))}

          {/* 流式中的新轮（文字未到先给 spinner，旧实现是整框顶替） */}
          {stream && (
            <div>
              {stream.q && (
                <div style={{
                  fontSize: '12px', color: 'var(--tx-2)', marginBottom: '8px',
                  padding: '6px 12px', borderRadius: '10px',
                  background: 'var(--bg-2)', display: 'inline-block',
                }}>
                  问：{archiveQDisplay(stream.q).label}
                </div>
              )}
              {!stream.text && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '40px 0', color: 'var(--tx-3)', fontSize: '13px' }}>
                  <div style={{
                    width: '14px', height: '14px',
                    border: '2px solid var(--bdr-med)', borderTopColor: 'var(--ac)',
                    borderRadius: '50%', animation: 'spin 0.8s linear infinite',
                  }} />
                  正在对比双方命盘…
                </div>
              )}
              {stream.text && <AiContent text={stream.text} streaming />}
            </div>
          )}

          {/* 空态：还没有任何轮次 */}
          {!hasSession && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ fontSize: '13px', color: 'var(--tx-3)', marginBottom: '24px', lineHeight: 1.7 }}>
                填好双方出生信息后，点击下方按钮<br />
                AI 将基于倪海厦体系深度分析两人缘分匹配度
              </div>
              <button
                onClick={() => runAnalysis()}
                style={{
                  padding: '14px 40px', borderRadius: 'var(--r-pill)', border: 'none',
                  background: 'linear-gradient(135deg, #9a6210, #c88020)',
                  color: '#fff8e8', fontSize: '14px', fontWeight: 600,
                  letterSpacing: '0.15em', cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(140,100,20,0.25)',
                  transition: 'transform 0.15s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(0)'; }}
              >
                开始合盘分析
              </button>
              {formError && (
                <div style={{ marginTop: '20px', fontSize: '13px', color: '#dc2626' }}>
                  {formError}
                </div>
              )}
            </div>
          )}

          {analysisError && (
            <div style={{ padding: '12px 16px', borderRadius: '10px', border: '1px solid var(--bdr)', background: 'var(--bg-card)', fontSize: '13px', color: 'var(--tx-2)', marginTop: '12px' }}>
              {authExpired
                ? '登录已过期，请回到小程序重新打开本页。'
                : apiMissing
                  ? '合盘 AI 分析后端未就绪：默认直连 mistsee.offiai.cn，若你自建了后端，请在 .env.local 配置 NEXT_PUBLIC_AI_API_BASE 指向它（见 README「快速开始」）。两人的命盘可以分别到「排盘」页（/chart）查看。'
                  : '分析暂时不可用，请重试。'}
            </div>
          )}
        </div>

        {/* ═══ 针对合盘的追问聊天框（会话开始后常驻，流式期间不再卸载）═══ */}
        {hasSession && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
              <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: 'var(--tx-3)' }}>
                针对此次合盘继续追问
              </div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                {/* 裂变常驻入口与分享同排（docs/09 §3.1）：让没填乙方的人也能发起邀请 */}
                <HemingInviteButton form={formA} label="☯ 邀请 TA 合盘" />
                <ShareButton title="紫微合盘 · 看看你们的缘分" ch="heming" label="✦ 分享合盘" />
              </div>
            </div>

            {/* 快捷问题 */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {[
                '感情匹配度如何？',
                '适合合伙创业吗？',
                '两人结婚是否合适？',
                '哪方面最容易产生矛盾？',
                '财运是否互补？',
              ].map(q => (
                <button
                  key={q}
                  onClick={() => { setQuestion(q); runAnalysis(q); }}
                  disabled={analyzing}
                  style={{
                    fontSize: '12px', padding: '6px 14px',
                    borderRadius: 'var(--r-pill)',
                    border: '1px solid var(--bdr-med)',
                    background: 'transparent', color: 'var(--tx-2)',
                    cursor: analyzing ? 'not-allowed' : 'pointer',
                    opacity: analyzing ? 0.5 : 1,
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => { if (!analyzing) (e.currentTarget as HTMLElement).style.borderColor = 'var(--ac-bdr)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--bdr-med)'; }}
                >
                  {q}
                </button>
              ))}
            </div>

            {/* 输入框 + 追问按钮 */}
            <div style={{ display: 'flex', gap: '8px' }}>
              <input
                type="text"
                value={question}
                onChange={e => setQuestion(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !analyzing) runAnalysis(question || undefined); }}
                placeholder="继续追问，如：哪几年是两人感情关键期？"
                disabled={analyzing}
                className="input-base"
                style={{ fontSize: '13px', flex: 1 }}
              />
              <button
                onClick={() => runAnalysis(question || undefined)}
                disabled={analyzing}
                style={{
                  padding: '10px 20px', borderRadius: 'var(--r-sm)', border: 'none',
                  background: analyzing ? 'var(--bg-2)' : 'var(--tx-0)',
                  color: analyzing ? 'var(--tx-3)' : 'white',
                  fontSize: '13px', fontWeight: 500,
                  cursor: analyzing ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s', whiteSpace: 'nowrap',
                }}
              >
                {analyzing ? '分析中…' : '继续追问'}
              </button>
            </div>
            {formError && (
              <div style={{ fontSize: '13px', color: '#dc2626' }}>{formError}</div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @media (max-width: 680px) {
          .heming-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
