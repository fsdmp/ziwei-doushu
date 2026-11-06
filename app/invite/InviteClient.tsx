'use client';

// InviteClient.tsx 合盘邀请落地页（docs/09 §3.1）——裂变闭环的 B 侧门面 + A 侧结果页。
//
// B 侧（默认）：拉公开卡面（无生辰）→ 填自己生辰 → 消费入局（回 A 生辰）→
//   纯前端简版（命宫对照/契合亮点，heming-simple）→ 可选 AI 深读（流式，与 /heming 同接口）。
// A 侧（?a=1，从回访提示条进入）：JWT 拉双方生辰 → 本地重排双盘 → 简版 + AI 深读。
//
// 容错铁律（§3.4）：邀请过期/已用/查无——降级成「起一张你自己的盘」CTA，永不出错误页。

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import BirthForm, { type BirthFormState } from '@/components/BirthForm';
import AiContent from '@/components/AiContent';
import { streamAI, type AIError } from '@/lib/ai';
import {
  fetchInviteCard, fetchInviteResult, consumeInvite, payloadToBirth,
  type InviteCard,
} from '@/lib/invite';
import { formToBirthInfo } from '@/lib/ziwei/share';
import { generateChart as buildChart } from '@/lib/ziwei/algorithm';
import { newSessionId } from '@/lib/unlock';
import { reportEventOnce } from '@/lib/events';
import { touchSession } from '@/lib/unlock';
import { simpleHeming, type SimpleHeming } from '@/lib/ziwei/heming-simple';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { useTheme } from '@/components/ThemeProvider';

type Stage =
  | { k: 'loading' }                                                     // 拉卡面/结果
  | { k: 'invalid'; reason: string }                                     // 降级：邀请失效（文案区分原因）
  | { k: 'card'; card: InviteCard }                                      // B：卡面 + 填生辰
  // 双盘简版：hostName=邀请人昵称（结果页文案用）；myChart=访客自己的盘（右栏），taChart=对方的盘
  | { k: 'result'; brief: SimpleHeming; myChart: ZiweiChart; taChart: ZiweiChart; hostName: string; side: 'b' | 'a' };

export default function InviteClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const token = sp.get('invite') ?? '';
  const isHost = sp.get('a') === '1'; // A 视角（回访提示条进入）

  const [stage, setStage] = useState<Stage>({ k: 'loading' });
  const [formB, setFormB] = useState<BirthFormState | null>(null);
  const [consuming, setConsuming] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // AI 深读（B/A 共用，与 /heming 页同接口同协议）
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(false);

  // ── 落地：无 token 不属于本页；有 token 按 A/B 视角拉数据 ──
  useEffect(() => {
    if (!token) {
      router.replace('/');
      return;
    }
    let alive = true;
    (async () => {
      try {
        if (isHost) {
          const result = await fetchInviteResult(token);
          enterResult(result.inviter_birth, result.invitee_birth, 'a', '你们');
        } else {
          const card = await fetchInviteCard(token);
          if (!alive) return;
          if (!card.valid) {
            setStage({ k: 'invalid', reason: '这份邀请已失效' });
          } else {
            setStage({ k: 'card', card });
          }
        }
      } catch (e) {
        if (!alive) return;
        const code = (e as AIError).code;
        if (isHost && code === 'biz') {
          // A 查未回应的码（或码已不在）：等待态，给回 heming 页的出路
          setStage({ k: 'invalid', reason: (e as AIError).bizMsg || 'TA 还没有回应' });
        } else if (code === 'network' || code === 'failed' || code === 'rate-limited') {
          setStage({ k: 'invalid', reason: '网络不稳，稍后重试' });
        } else {
          // auth-expired（A 模式）等：引导回小程序重新打开
          setStage({ k: 'invalid', reason: '登录已过期，请回到小程序重新打开本页' });
        }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isHost]);

  // ── 双盘简版（A/B 生辰 → 重排双盘 → 本地引擎）──
  // myChart/taChart 按访客视角对位：side='b' 时我是 B（chartB 是我的盘），
  // side='a' 时我是 A。AI 深读的 chartA/chartB 语义不变（服务器口径：A=发起方）。
  const enterResult = (birthAJson: string, birthBJson: string, side: 'a' | 'b', hostName: string) => {
    const formA = payloadToBirth(birthAJson);
    const formBB = payloadToBirth(birthBJson);
    const infoA = formA && formToBirthInfo(formA);
    const infoB = formBB && formToBirthInfo(formBB);
    if (!infoA || !infoB) {
      setStage({ k: 'invalid', reason: '这份邀请缺少出生信息' });
      return;
    }
    try {
      const chartA = buildChart(infoA);
      const chartB = buildChart(infoB);
      // 甲盘（A 的盘）挂起盘会话 id：server interpret_done/档案按甲盘归因；
      // 裂变来的起盘 from='invite'（docs/11 §1，与 heming 页 'fresh' 区分归因）
      chartA.sessionId = newSessionId();
      reportEventOnce('chart_new', chartA.sessionId, { chart_kind: 'heming', from: 'invite' });
      touchSession(chartA.sessionId);
      const myChart = side === 'b' ? chartB : chartA;
      const taChart = side === 'b' ? chartA : chartB;
      setStage({ k: 'result', brief: simpleHeming(chartA, chartB), myChart, taChart, hostName, side });
    } catch {
      setStage({ k: 'invalid', reason: '命盘生成失败，请重试' });
    }
  };

  // ── B 消费入局 ──
  const respond = async () => {
    if (!formB || consuming) return;
    setFormError(null);
    if (!formB.year || !formB.month || !formB.day || !(formB.unknownTime || (formB.clockHour !== '' && formB.clockMinute !== ''))) {
      setFormError('请先填完出生日期与时间');
      return;
    }
    setConsuming(true);
    try {
      const res = await consumeInvite(token, formB);
      const hostName = stage.k === 'card' ? stage.card.inviter_name : '朋友';
      enterResult(res.inviter_birth, birthToPayloadStr(formB), 'b', hostName);
    } catch (e) {
      const code = (e as AIError).code;
      if (code === 'biz') setFormError((e as AIError).bizMsg || '这份邀请已失效');
      else if (code === 'auth-expired') setFormError('请回到小程序重新打开本页再回应');
      else setFormError('网络不稳，请稍后再试');
    } finally {
      setConsuming(false);
    }
  };

  // ── AI 深读 ──
  const deepRead = async () => {
    if (stage.k !== 'result' || analyzing) return;
    setAnalyzing(true);
    setAnalysisError(false);
    try {
      let acc = '';
      const { chartA, chartB } = stage.side === 'b'
        ? { chartA: stage.taChart, chartB: stage.myChart }
        : { chartA: stage.myChart, chartB: stage.taChart };
      await streamAI('/api/v1/ziwei/heming', { chartA, chartB }, (_d, full) => {
        acc = full;
        setAnalysis(full);
      });
      if (!acc) throw new Error('empty');
    } catch {
      setAnalysisError(true);
    } finally {
      setAnalyzing(false);
    }
  };

  const cardStyle = {
    background: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.9)',
    border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(200,160,60,0.2)'}`,
    borderRadius: '16px',
    padding: '24px',
  };

  const ctaToOwnChart = (
    <button
      onClick={() => router.push('/chart')}
      style={{
        padding: '12px 32px', borderRadius: 'var(--r-pill, 999px)', border: 'none',
        background: 'linear-gradient(135deg, #9a6210, #c88020)',
        color: '#fff8e8', fontSize: '13px', fontWeight: 600,
        letterSpacing: '0.15em', cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(140,100,20,0.25)',
      }}
    >起一张我自己的盘</button>
  );

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-0)' }}>
      {/* 顶栏（与 heming 页同款视觉） */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: isDark ? 'rgba(2,8,16,0.88)' : 'rgba(250,245,235,0.92)',
        backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid var(--bdr)',
        display: 'flex', alignItems: 'center', padding: '0 24px', height: '52px', gap: '16px',
      }}>
        <button onClick={() => router.push('/')} style={{
          display: 'flex', alignItems: 'center', gap: '4px', fontSize: '13px',
          color: 'var(--tx-3)', background: 'none', border: 'none', cursor: 'pointer',
        }}>
          <span style={{ fontSize: '16px' }}>‹</span><span>返回</span>
        </button>
        <div style={{ width: '1px', height: '20px', background: 'var(--bdr-med)' }} />
        <span style={{ fontSize: '12px', color: 'var(--ac)', letterSpacing: '0.2em' }}>合盘邀请</span>
      </header>

      <div style={{ maxWidth: '720px', margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* ── 加载中 ── */}
        {stage.k === 'loading' && (
          <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--tx-3)', fontSize: '13px' }}>
            <div style={{
              width: '18px', height: '18px', margin: '0 auto 16px',
              border: '2px solid var(--bdr-med)', borderTopColor: 'var(--ac)',
              borderRadius: '50%', animation: 'spin 0.8s linear infinite',
            }} />
            正在打开这份邀请…
          </div>
        )}

        {/* ── 降级：邀请失效（不出错误页，给起盘出路）── */}
        {stage.k === 'invalid' && (
          <div style={{ ...cardStyle, textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '32px', color: 'var(--ac)', opacity: 0.3, marginBottom: '16px' }}>☯</div>
            <p style={{ fontSize: '15px', color: 'var(--tx-1)', marginBottom: '8px' }}>{stage.reason}</p>
            <p style={{ fontSize: '12px', color: 'var(--tx-3)', marginBottom: '28px', lineHeight: 1.7 }}>
              没关系，缘分可以自己开始——起一张你自己的盘
            </p>
            {ctaToOwnChart}
          </div>
        )}

        {/* ── B 侧：卡面 + 填生辰 ── */}
        {stage.k === 'card' && (
          <>
            <div style={{ ...cardStyle, textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '36px', color: 'var(--ac)', opacity: 0.2, marginBottom: '12px' }}>☯</div>
              <h1 style={{ fontSize: '19px', fontWeight: 600, letterSpacing: '0.1em', color: 'var(--tx-0)', marginBottom: '8px' }}>
                {stage.card.inviter_name} 想和你合一张盘
              </h1>
              <p style={{ fontSize: '12px', color: 'var(--tx-3)', lineHeight: 1.7 }}>
                填上你的出生信息，立刻看看你们的关系
              </p>
            </div>
            <div style={cardStyle}>
              <BirthForm
                hideSubmit
                onSubmit={() => {}}
                onFormSave={setFormB}
              />
              <button
                onClick={respond}
                disabled={consuming}
                style={{
                  width: '100%', padding: '14px', marginTop: '8px',
                  borderRadius: '16px', border: 'none',
                  background: consuming
                    ? 'rgba(180,120,20,0.15)'
                    : 'linear-gradient(135deg, #9a6210, #c88020)',
                  color: consuming ? 'rgba(120,80,10,0.4)' : '#fff8e8',
                  fontSize: '13px', fontWeight: 600, letterSpacing: '0.15em',
                  cursor: consuming ? 'not-allowed' : 'pointer',
                  boxShadow: consuming ? 'none' : '0 4px 16px rgba(140,100,20,0.25)',
                }}
              >
                {consuming ? '正在合盘…' : '回应 TA · 看你们的合盘'}
              </button>
              {formError && (
                <div style={{ marginTop: '14px', fontSize: '12px', color: '#dc2626', textAlign: 'center', lineHeight: 1.7 }}>
                  {formError}
                  {formError.includes('失效') && (
                    <span style={{ display: 'block', marginTop: '10px' }}>{ctaToOwnChart}</span>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 结果：双盘简版 + AI 深读（A/B 共用）── */}
        {stage.k === 'result' && (
          <>
            <div style={{ ...cardStyle, marginBottom: '20px' }}>
              <p style={{ fontSize: '12px', color: 'var(--tx-3)', letterSpacing: '0.2em', marginBottom: '16px' }}>
                {stage.side === 'a' ? 'TA 已回应 · 你们的关系' : `你和${stage.hostName}的关系`}
              </p>

              {/* 命宫对照（右栏永远是访客自己的盘） */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '12px', alignItems: 'center', marginBottom: '18px' }}>
                <div style={{ textAlign: 'center', padding: '14px 8px', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,250,235,0.7)', borderRadius: '12px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--tx-3)', marginBottom: '6px' }}>TA 的命宫</div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ac)', letterSpacing: '0.05em' }}>
                    {stage.brief.aMing.length > 0 ? stage.brief.aMing.join('·') : '空宫'}
                  </div>
                  {stage.brief.aTemper && <div style={{ fontSize: '10px', color: 'var(--tx-3)', marginTop: '4px' }}>{stage.brief.aTemper}</div>}
                </div>
                <div style={{ fontSize: '18px', color: 'var(--ac)', opacity: 0.5 }}>×</div>
                <div style={{ textAlign: 'center', padding: '14px 8px', background: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(255,250,235,0.7)', borderRadius: '12px' }}>
                  <div style={{ fontSize: '10px', color: 'var(--tx-3)', marginBottom: '6px' }}>你的命宫</div>
                  <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ac)', letterSpacing: '0.05em' }}>
                    {stage.brief.bMing.length > 0 ? stage.brief.bMing.join('·') : '空宫'}
                  </div>
                  {stage.brief.bTemper && <div style={{ fontSize: '10px', color: 'var(--tx-3)', marginTop: '4px' }}>{stage.brief.bTemper}</div>}
                </div>
              </div>

              {/* 契合亮点 */}
              {stage.brief.highlight && (
                <div style={{
                  padding: '14px 16px', borderRadius: '12px',
                  background: isDark ? 'rgba(212,168,67,0.08)' : 'rgba(212,168,67,0.07)',
                  border: `1px solid ${isDark ? 'rgba(212,168,67,0.25)' : 'rgba(212,168,67,0.3)'}`,
                  fontSize: '13px', color: 'var(--tx-1)', lineHeight: 1.8, marginBottom: '12px',
                }}>
                  <span style={{ color: 'var(--ac)', fontWeight: 600 }}>契合亮点 · </span>{stage.brief.highlight}
                </div>
              )}

              {/* 夫妻宫摘要 */}
              {(stage.brief.aFuqi || stage.brief.bFuqi) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {stage.brief.aFuqi && (
                    <p style={{ fontSize: '12px', color: 'var(--tx-2)', lineHeight: 1.8 }}>
                      <span style={{ color: 'var(--tx-3)' }}>{stage.side === 'a' ? '你' : stage.hostName}的夫妻宫 · </span>{stage.brief.aFuqi}
                    </p>
                  )}
                  {stage.brief.bFuqi && (
                    <p style={{ fontSize: '12px', color: 'var(--tx-2)', lineHeight: 1.8 }}>
                      <span style={{ color: 'var(--tx-3)' }}>{stage.side === 'a' ? 'TA' : '你'}的夫妻宫 · </span>{stage.brief.bFuqi}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* AI 深读 */}
            <div style={cardStyle}>
              {!analysis && !analyzing && (
                <div style={{ textAlign: 'center', padding: '12px 0 4px' }}>
                  <p style={{ fontSize: '12px', color: 'var(--tx-3)', marginBottom: '18px', lineHeight: 1.7 }}>
                    想更深入？AI 基于双方命盘细看你们的缘分与相处
                  </p>
                  <button
                    onClick={deepRead}
                    style={{
                      padding: '13px 36px', borderRadius: 'var(--r-pill, 999px)', border: 'none',
                      background: 'var(--vip-grad)',
                      color: 'white', fontSize: '13px', fontWeight: 600,
                      letterSpacing: '0.15em', cursor: 'pointer',
                      boxShadow: '0 4px 12px var(--vip-glow)',
                    }}
                  >
                    ✦ AI 深度合盘
                  </button>
                </div>
              )}
              {analyzing && !analysis && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '24px 0', color: 'var(--tx-3)', fontSize: '13px' }}>
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
                  深度分析暂时不可用，请稍后重试。
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// BirthFormState → payload JSON 串（B 侧 enterResult 复用 payloadToBirth 的对称编码；
// 保持在组件文件底部，贴近唯一调用点）
function birthToPayloadStr(form: BirthFormState): string {
  const { name: _name, ...rest } = form;
  return JSON.stringify(rest);
}
