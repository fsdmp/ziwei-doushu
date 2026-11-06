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
import type { BirthInfo, ZiweiChart } from '@/lib/ziwei/types';
import { useTheme } from '@/components/ThemeProvider';

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
  // 「回到上次」按钮的数据源：mounted 后再读 localStorage——渲染期读会与预渲染
  // HTML（构建期无存储数据 = 无按钮）不一致，触发 hydration 回退整树重渲
  //（web-view 有 hydrate 黑屏前科，docs/09 §8，不新增 mismatch 源）
  const [lastHeming, setLastHeming] = useState<LastSession | null>(null);
  useEffect(() => { setLastHeming(loadLastSession('heming')); }, []);

  // 档案「回到这张合盘继续问」恢复通道（docs/10 §5.1，2026-11-06 合盘同权）：
  // archive 页存双盘 JSON 跳来，一次性消费（读后即清）。sessionId 原样保留——
  // 续问落库按 session_id 归并同一行盘（合盘口，不再有 solo 降级覆盖乙盘）；
  // 生辰一并换回表单态（chart 页恢复同款）：重新合盘改生辰、邀请/分享原料都在。
  // 非会员「回看上一次」（2026-11-06）多带解读原文（analysis）——与页内
  // 「回到上次」同款完整会话；会员续问不带（新轮问答），字段可选向后兼容
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ziwei_archive_restore_heming');
      if (!raw) return;
      sessionStorage.removeItem('ziwei_archive_restore_heming');
      const r = JSON.parse(raw) as { chartA: ZiweiChart; chartB: ZiweiChart; analysis?: string };
      if (r.chartA?.palaces && r.chartB?.palaces) {
        setChartA(r.chartA);
        setChartB(r.chartB);
        if (r.chartA.birthInfo) setFormA(formFromBirthInfo(r.chartA.birthInfo));
        if (r.chartB.birthInfo) setFormB(formFromBirthInfo(r.chartB.birthInfo));
        if (r.analysis) setAnalysis(r.analysis);
      }
    } catch { /* 恢复失败走表单 */ }
  }, []);

  // ─── AI 合盘分析状态 ─────────────────────────────────────
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [question, setQuestion] = useState('');
  const [analysisError, setAnalysisError] = useState(false);
  // 后端未实现时（404）单独说明，而不是让用户反复重试
  const [apiMissing, setApiMissing] = useState(false);
  // 登录态缺失/过期（后端 fail-closed）：提示回小程序重新打开
  const [authExpired, setAuthExpired] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const analysisRef = useRef<HTMLDivElement>(null);

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

  // ─── 统一入口：起盘 + 合盘分析 ─────────────────────────────
  const runAnalysis = useCallback(async (q?: string) => {
    setFormError(null);
    if (!isFormReady(formA) || !isFormReady(formB)) {
      setFormError('请先填写双方完整出生信息');
      return;
    }
    setAnalyzing(true);
    setAnalysis('');
    setAnalysisError(false);
    setAuthExpired(false);

    try {
      // 并行起两张盘（如果还没起）；农历输入换算失败（日期不存在）在此拦下
      const infoA = formToBirthInfo(formA!);
      const infoB = formToBirthInfo(formB!);
      if (!infoA || !infoB) {
        setFormError('农历日期不存在，请核对双方出生日期（闰月 / 当月天数）');
        return;
      }
      let cA = chartA;
      let cB = chartB;
      const [newA, newB] = await Promise.all([
        cA ? Promise.resolve(cA) : generateChart(infoA),
        cB ? Promise.resolve(cB) : generateChart(infoB),
      ]);
      cA = newA;
      cB = newB;
      if (!cA || !cB) {
        setAnalysisError(true);
        setAnalyzing(false);
        return;
      }
      // 甲盘挂起盘会话 id（server interpret_done/档案按甲盘 sessionId 归因，
      // 与 solo 口径一致：一次起盘一个 uuid）
      if (!cA.sessionId) cA.sessionId = newSessionId();
      if (!chartA) setChartA(cA);
      if (!chartB) setChartB(cB);
      // 数据事件面（docs/11 §1）：一次合盘起盘一记（追问不重复记——cA 已有 id）
      reportEventOnce('chart_new', cA.sessionId, { chart_kind: 'heming', from: 'fresh' });
      touchSession(cA.sessionId);

      let acc = '';
      await streamAI('/api/v1/ziwei/heming', { chartA: cA, chartB: cB, question: q ?? undefined }, (_delta, full) => {
        acc = full;
        setAnalysis(full);
      });
      if (!acc) throw new Error('empty');
      // 本地最近一条会话（docs/10 §5.4）：heming「回到上次」的数据源
      saveLastSession('heming', {
        chart: cA, chartB: cB, formA: formA ?? undefined, formB: formB ?? undefined, analysis: acc,
      });
      // scroll to analysis
      setTimeout(() => analysisRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      // 后端缺失（404）单独说明，而不是让用户反复重试
      if ((e as AIError).code === 'api-missing') setApiMissing(true);
      if ((e as AIError).code === 'auth-expired') setAuthExpired(true);
      setAnalysisError(true);
    } finally {
      setAnalyzing(false);
    }
  }, [chartA, chartB, formA, formB, generateChart]);

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
              if (lastHeming.analysis) setAnalysis(lastHeming.analysis);
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
          justifyContent: (!analysis && !analyzing) ? 'center' : 'flex-start',
        }}>
          {/* 区块标题 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: (analysis || analyzing) ? '20px' : '24px' }}>
            <span style={{ color: 'var(--ac)', opacity: 0.6 }}>◉</span>
            <span style={{ fontSize: '11px', letterSpacing: '0.3em', color: 'var(--tx-3)' }}>合盘分析 · HEMING</span>
          </div>

          {/* 回到上次/已出结果态的「重新合盘」：恢复后想重跑（改生辰重排）没有
              入口——原「开始合盘分析」按钮在 !analysis 分支里，出了结果就消失 */}
          {(analysis || analyzing) && (
            <button
              onClick={() => { setAnalysis(''); setChartA(null); setChartB(null); setAnalyzing(false); setFormError(null); }}
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

          {/* 状态分支 */}
          {!analysis && !analyzing && (
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

          {analyzing && !analysis && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '40px 0', color: 'var(--tx-3)', fontSize: '13px' }}>
              <div style={{
                width: '14px', height: '14px',
                border: '2px solid var(--bdr-med)', borderTopColor: 'var(--ac)',
                borderRadius: '50%', animation: 'spin 0.8s linear infinite',
              }} />
              正在对比双方命盘…
            </div>
          )}

          {analysis && <AiContent text={analysis} streaming={analyzing} />}

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

        {/* ═══ 针对合盘的追问聊天框（仅分析完成后显示）═══════════ */}
        {analysis && (
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
