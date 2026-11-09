'use client';

// InviteClient.tsx 合盘邀请落地页（docs/09 §3.1）——裂变闭环的 B 侧门面 + A 侧结果页。
//
// B 侧（默认）：拉公开卡面（无生辰）→ 填自己生辰 → 消费入局（回 A 生辰）→
//   纯前端简版（命宫对照/契合亮点，heming-simple）→ 可选 AI 深读（流式，与 /heming 同接口）。
// A 侧（?a=1，从回访提示条进入）：JWT 拉双方生辰 → 本地重排双盘 → 简版 + AI 深读。
// 深读后可追问（快捷问+输入框，2026-11-06 补齐）：吃问答限额但独立分桶（qna_heming，
// key=本次合盘会话 id）——与 solo 盘问答各限各的互不影响，墙与四把钥匙同款。
//
// 容错铁律（§3.4）：邀请过期/已用/查无——降级成「起一张你自己的盘」CTA，永不出错误页。

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import BirthForm, { type BirthFormState } from '@/components/BirthForm';
import AiContent from '@/components/AiContent';
import { streamAI, requestJSON, type AIError } from '@/lib/ai';
import {
  fetchInviteCard, fetchInviteResult, consumeInvite, payloadToBirth,
  type InviteCard,
} from '@/lib/invite';
import { formToBirthInfo } from '@/lib/ziwei/share';
import { generateChart as buildChart } from '@/lib/ziwei/algorithm';
import {
  touchSession, QNA_FREE_LIMIT,
  qnaCanAsk, qnaUnlocked, qnaUsed, recordQnaAsk, markQnaUnlocked,
  unlockBy, unlockByShare, isMember, refreshMember,
  openAdUnlock, confirmPendingAdUnlock, sharePanelEnabled, fetchUnlockStatus,
} from '@/lib/unlock';
import { pushShareCard, openSharePanel, openPaySheet, miniToast } from '@/lib/mini-bridge';
import { reportEventOnce } from '@/lib/events';
import { simpleHeming, type SimpleHeming } from '@/lib/ziwei/heming-simple';
import type { ZiweiChart } from '@/lib/ziwei/types';
import { useTheme } from '@/components/ThemeProvider';

/** 快捷追问（与 /heming 页同款五问：感情/合伙/结婚/矛盾/财运，合盘语境通用） */
const QUICK_QUESTIONS = [
  '感情匹配度如何？',
  '适合合伙创业吗？',
  '两人结婚是否合适？',
  '哪方面最容易产生矛盾？',
  '财运是否互补？',
];

/** 服务端 errx.CodeInviteViewLocked：非会员回看已回应邀请超出 24h 窗 */
const INVITE_VIEW_LOCKED = 42903;

type Stage =
  | { k: 'loading' }                                                     // 拉卡面/结果
  // 降级：邀请失效（文案区分原因）；locked=非会员回看超窗（42903）——给会员 CTA
  | { k: 'invalid'; reason: string; locked?: boolean }
  | { k: 'card'; card: InviteCard }                                      // B：卡面 + 填生辰
  // 双盘简版：hostName=邀请人昵称（结果页文案用）；myChart=访客自己的盘（右栏），taChart=对方的盘
  // hKey=合盘会话 id（甲盘 sessionId）：追问限额与解锁台账的 key（qna_heming 分桶）
  | { k: 'result'; brief: SimpleHeming; myChart: ZiweiChart; taChart: ZiweiChart; hostName: string; side: 'b' | 'a'; hKey: string };

export default function InviteClient() {
  const router = useRouter();
  const sp = useSearchParams();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const token = sp.get('invite') ?? '';
  const isHost = sp.get('a') === '1'; // A 视角（回访提示条进入）

  const [stage, setStage] = useState<Stage>({ k: 'loading' });
  // 结果重拉触发器：回看锁面开通会员回来时 +1，落地 effect 依赖它重跑
  const [reloadKey, setReloadKey] = useState(0);
  const [formB, setFormB] = useState<BirthFormState | null>(null);
  const [consuming, setConsuming] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // AI 深读（B/A 共用，与 /heming 页同接口同协议）
  const [analysis, setAnalysis] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState(false);

  // 会员打开邀请结果即幂等归档（2026-11-11）：sessionId=inv-<token> 确定性——
  // 同一份合盘在云端档案永远一行，深读的解读随后落同一行。列表只保留近 7 天后，
  // 这是「会员有档案可看」承诺的落点：没深读过的邀请合盘也有档案。服务端
  // /archive/import 对已存在的 (uid, session_id) 幂等跳过，失败静默下次再试。
  // A/B 双视角都归（各自的 uid 各一行）；chart 口径恒 A=发起方（服务器语义）
  useEffect(() => {
    if (stage.k !== 'result') return;
    let alive = true;
    refreshMember().then(() => {
      if (!alive || !isMember()) return;
      const pair = stage.side === 'b'
        ? { chartA: stage.taChart, chartB: stage.myChart }
        : { chartA: stage.myChart, chartB: stage.taChart };
      requestJSON('/api/v1/ziwei/archive/import', 'POST',
        { chart: pair.chartA, chartB: pair.chartB, messages: [] },
      ).catch(() => { /* 静默：下次打开再试 */ });
    }).catch(() => { /* 无网络身份就谈不上会员 */ });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage.k]);

  // ── 追问（docs/09 §4）：深读后可继续问，吃问答限额但独立分桶（qna_heming，
  //    key=本次合盘会话 id）——与 solo 盘问答各限各的互不影响 ──
  const [question, setQuestion] = useState('');
  const [followUps, setFollowUps] = useState<{ q: string; a: string }[]>([]);
  const [asking, setAsking] = useState(false);
  const [walled, setWalled] = useState(false);
  const [hasPendingAsk, setHasPendingAsk] = useState(false);
  // 墙条 DOM：撞墙时滚进视野。挂起问题解锁后自动重发——resumeRef 指向每次渲染
  // 的最新续答函数（pageshow 监听只挂一次，直接引用会锁死首帧闭包的 hKey/stage）
  const wallRef = useRef<HTMLDivElement | null>(null);
  const pendingAskRef = useRef<string | null>(null);
  const askingRef = useRef(false);
  const walledRef = useRef(false);
  const hKeyRef = useRef('');
  const resumeRef = useRef<() => void>(() => {});
  useEffect(() => { askingRef.current = asking; }, [asking]);
  useEffect(() => { walledRef.current = walled; }, [walled]);
  useEffect(() => { hKeyRef.current = stage.k === 'result' ? stage.hKey : ''; }, [stage]);

  // 解锁回查（与 InsightPanel 同款三通道，锁品类换成 qna_heming）：支付回来刷
  // member 收墙、广告看完确认记账、引导式分享点了「发送给朋友」台账命中——
  // 任一命中即收墙续答；没点转发直接返回则锁保留
  useEffect(() => {
    const onShow = () => {
      refreshMember().then(() => {
        if (isMember()) { setWalled(false); resumeRef.current(); }
      });
      confirmPendingAdUnlock('qna_heming').then(ok => {
        if (ok) { setWalled(false); resumeRef.current(); }
      });
      if (walledRef.current) {
        fetchUnlockStatus('qna_heming', hKeyRef.current).then(ok => {
          if (ok) {
            markQnaUnlocked(hKeyRef.current);
            setWalled(false);
            resumeRef.current();
          }
        });
      }
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

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
        if (isHost && code === 'biz' && (e as AIError).bizCode === INVITE_VIEW_LOCKED) {
          // 非会员回看超窗（回应后 24h）：锁面引导会员永久回看（2026-11-09 与
          // 云端档案权益划界；服务端判定为准，H5 只负责给出路）
          setStage({ k: 'invalid', reason: (e as AIError).bizMsg || '这份合盘的免费回看已过', locked: true });
        } else if (isHost && code === 'biz') {
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
  }, [token, isHost, reloadKey]);

  // 回看锁面的回程：bridge 收银台 navigateBack 回 H5（pageshow）刷新会员，
  // 已开通即重拉结果——「付完直接看」，不让人再手动点一次
  const lockedRef = useRef(false);
  useEffect(() => { lockedRef.current = stage.k === 'invalid' && !!stage.locked; }, [stage]);
  useEffect(() => {
    const onShow = () => {
      if (!lockedRef.current) return;
      refreshMember().then(() => {
        if (isMember()) setReloadKey(k => k + 1);
      });
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

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
      // 裂变来的起盘 from='invite'（docs/11 §1，与 heming 页 'fresh' 区分归因）。
      // 按邀请码确定性派生（2026-11-09）：此前每次进结果页随机新 id，会员每看
      // 一次深读档案就多一行重复；同一份邀请合盘永远一个会话 id → 档案归并一行、
      // 起盘事件同码只记一次。'inv-' + 24 位 hex 落在 sessionId 合法字符集内
      const sid = `inv-${token}`;
      chartA.sessionId = sid;
      reportEventOnce('chart_new', sid, { chart_kind: 'heming', from: 'invite' });
      touchSession(sid);
      const myChart = side === 'b' ? chartB : chartA;
      const taChart = side === 'b' ? chartA : chartB;
      setStage({ k: 'result', brief: simpleHeming(chartA, chartB), myChart, taChart, hostName, side, hKey: sid });
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

  // ── 追问（深读完成后可用；快捷问与输入框同计 qna_heming 桶的额度，深读本身
  //    不烧——对齐 solo 页「总览免费、追问计数」的口径）──
  const askFollowUp = async (text: string) => {
    const q = text.trim();
    if (!q || askingRef.current || stage.k !== 'result') return;
    if (!qnaCanAsk(stage.hKey)) {
      // 撞墙：这一问挂起不丢，任一钥匙（分享/会员/广告）生效后自动重发
      pendingAskRef.current = q;
      setHasPendingAsk(true);
      setWalled(true);
      reportEventOnce('qna_wall', stage.hKey, { asked: qnaUsed(stage.hKey) });
      // 墙条就在输入框上方，滚进视野让用户看到「为什么没动静」
      requestAnimationFrame(() => wallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      return;
    }
    // 会员钥匙短路生效的合盘落台账 source=member（归因口径与 solo 一致）
    if (isMember() && !qnaUnlocked(stage.hKey)) {
      unlockBy('qna_heming', stage.hKey, 'member');
    }
    askingRef.current = true;
    setAsking(true);
    setQuestion('');
    setFollowUps(prev => [...prev, { q, a: '' }]);
    let counted = false; // 额度计数点 = 首个流式增量（失败/空答不烧额度，可无负担重试）
    try {
      const { chartA, chartB } = stage.side === 'b'
        ? { chartA: stage.taChart, chartB: stage.myChart }
        : { chartA: stage.myChart, chartB: stage.taChart };
      let acc = '';
      await streamAI('/api/v1/ziwei/heming', { chartA, chartB, question: q }, (_d, full) => {
        if (!counted) {
          counted = true;
          if (!qnaUnlocked(stage.hKey)) recordQnaAsk(stage.hKey);
        }
        acc = full;
        setFollowUps(prev => prev.map((f, i) => (i === prev.length - 1 ? { ...f, a: full } : f)));
      });
      if (!acc) throw Object.assign(new Error('empty'), { code: 'empty' });
    } catch (e) {
      const code = (e as AIError).code;
      const msg = code === 'auth-expired'
        ? '登录已过期，请回到小程序重新打开本页。'
        : code === 'rate-limited'
          ? '提问太快了，稍等片刻再试。'
          : '追问暂时不可用，请稍后重试。';
      setFollowUps(prev => prev.map((f, i) => (i === prev.length - 1 && !f.a ? { ...f, a: msg } : f)));
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
  };

  // 续答：挂起的问题在钥匙生效后自动重发；追问进行中不硬插，短间隔重试到空闲
  const resumePendingAsk = () => {
    const p = pendingAskRef.current;
    if (!p || stage.k !== 'result' || !qnaCanAsk(stage.hKey)) return;
    if (askingRef.current) {
      setTimeout(() => resumeRef.current(), 600);
      return;
    }
    pendingAskRef.current = null;
    setHasPendingAsk(false);
    askFollowUp(p);
  };
  resumeRef.current = resumePendingAsk;

  // 分享解锁（与 InsightPanel 同款两形态）：share_panel=true 跳 bridge 真面板，
  // 点了「发送给朋友」才落账，回来 pageshow 回查命中才收墙；旧版点即给
  const shareUnlock = () => {
    if (stage.k !== 'result') return;
    const title = '紫微合盘 · 看看你们的缘分';
    pushShareCard({ title, ch: 'qna' });
    if (sharePanelEnabled()) {
      openSharePanel({ title, ch: 'qna', lock: { kind: 'qna_heming', chartKey: stage.hKey } });
      return;
    }
    unlockByShare('qna_heming', stage.hKey);
    markQnaUnlocked(stage.hKey);
    setWalled(false);
    resumePendingAsk();
    miniToast('✦ 已解锁 · 继续追问');
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
        {stage.k === 'invalid' && stage.locked && (
          // 非会员回看超窗锁面（42903）：给会员出路；开通回来 pageshow 自动重拉
          <div style={{ ...cardStyle, textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ fontSize: '32px', marginBottom: '16px' }}>🔒</div>
            <p style={{ fontSize: '15px', color: 'var(--tx-1)', marginBottom: '8px', lineHeight: 1.7 }}>{stage.reason}</p>
            <p style={{ fontSize: '12px', color: 'var(--tx-3)', marginBottom: '28px', lineHeight: 1.7 }}>
              会员可永久回看每一份合盘，起盘、合盘、解读都在云端档案里
            </p>
            <button
              onClick={() => openPaySheet('member')}
              style={{
                padding: '13px 36px', borderRadius: 'var(--r-pill, 999px)', border: 'none',
                background: 'var(--vip-grad)', color: 'white', fontSize: '13px', fontWeight: 600,
                letterSpacing: '0.12em', cursor: 'pointer', boxShadow: '0 4px 12px var(--vip-glow)',
              }}
            >
              开通会员 · 永久回看
            </button>
          </div>
        )}
        {stage.k === 'invalid' && !stage.locked && (
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

              {/* ── 追问区（深读完成后）：快捷问 + 输入框，额度吃 qna_heming
                  独立分桶（N=3，与 solo 盘互不影响），撞墙出同款四钥匙墙 ── */}
              {analysis && (
                <>
                  <div style={{ borderTop: '1px solid var(--bdr)', margin: '20px 0 14px' }} />
                  <div style={{ fontSize: '11px', letterSpacing: '0.2em', color: 'var(--tx-3)', marginBottom: '12px' }}>
                    针对这次合盘继续追问
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {QUICK_QUESTIONS.map(q => (
                      <button
                        key={q}
                        onClick={() => askFollowUp(q)}
                        disabled={asking}
                        style={{
                          fontSize: '12px', padding: '6px 14px',
                          borderRadius: 'var(--r-pill, 999px)',
                          border: '1px solid var(--ac-bdr)',
                          background: 'var(--ac-bg)', color: 'var(--ac-dim)',
                          cursor: asking ? 'not-allowed' : 'pointer',
                          opacity: asking ? 0.5 : 1,
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>

                  {/* 追问记录（问答对：问句小金字气泡 + AI 作答） */}
                  {followUps.map((f, i) => (
                    <div key={i} style={{ marginTop: '16px' }}>
                      <div style={{ textAlign: 'right', marginBottom: '8px' }}>
                        <span style={{
                          display: 'inline-block', maxWidth: '85%', fontSize: '12px',
                          padding: '6px 12px', borderRadius: '12px', textAlign: 'left',
                          background: 'rgba(212,168,67,0.08)', border: '1px solid rgba(212,168,67,0.18)',
                          color: 'var(--ac-dim)',
                        }}>{f.q}</span>
                      </div>
                      <AiContent text={f.a} streaming={asking && i === followUps.length - 1} />
                    </div>
                  ))}

                  {/* 限额墙（docs/09 §4/§7）：免费额度尽，四把钥匙同款；文案留替代路 */}
                  {walled && (
                    <div ref={wallRef} style={{
                      margin: '14px 0 4px', padding: '14px 16px', borderRadius: '12px',
                      background: 'var(--vip-bg)', border: '1px solid var(--vip-bdr)',
                    }}>
                      <p style={{ fontSize: '12px', color: 'var(--tx-1)', lineHeight: 1.8, margin: `0 0 ${hasPendingAsk ? 6 : 12}px` }}>
                        这次合盘的 {QNA_FREE_LIMIT} 次免费追问已经用完。分享给朋友，<b>这次合盘</b>的追问就不限次数了——
                        <span style={{ color: 'var(--tx-3)' }}>或开通会员处处不限，或看段光影同样解锁。</span>
                      </p>
                      {hasPendingAsk && (
                        <p style={{ fontSize: '11px', color: 'var(--ac)', opacity: 0.85, margin: '0 0 12px' }}>
                          ✦ 你刚才的问题已留着，解锁后自动接着解读
                        </p>
                      )}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={shareUnlock} style={{
                          flex: 1, padding: '10px', borderRadius: '10px', border: 'none',
                          background: 'var(--vip-grad)', color: 'white',
                          fontSize: '12px', fontWeight: 600, letterSpacing: '0.08em', cursor: 'pointer',
                        }}>
                          ✦ 分享解锁 · 本次合盘不限次
                        </button>
                        <button onClick={() => openPaySheet('member')} style={{
                          flex: 1, padding: '10px', borderRadius: '10px',
                          background: 'transparent', border: '1px solid rgba(212,168,67,0.5)',
                          color: 'var(--ac)', fontSize: '12px', fontWeight: 600,
                          letterSpacing: '0.08em', cursor: 'pointer',
                        }}>
                          ✦ 会员解锁 · 处处不限
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '10px' }}>
                        <button
                          onClick={() => { if (stage.k === 'result') openAdUnlock('qna_heming', stage.hKey); }}
                          style={{ fontSize: '11px', color: 'var(--tx-3)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px', textDecoration: 'underline', textUnderlineOffset: 2 }}
                        >
                          或看段光影 · 同样解锁
                        </button>
                        <span style={{ color: 'var(--tx-3)', fontSize: 11, alignSelf: 'center' }}>·</span>
                        <button
                          onClick={() => { pendingAskRef.current = null; setHasPendingAsk(false); setWalled(false); }}
                          style={{ fontSize: '11px', color: 'var(--tx-3)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px', textDecoration: 'underline', textUnderlineOffset: 2 }}
                        >
                          先不问
                        </button>
                      </div>
                    </div>
                  )}

                  {/* 输入框 + 追问按钮（与 /heming 页同款形态） */}
                  <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                    <input
                      type="text"
                      value={question}
                      onChange={e => setQuestion(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !asking) askFollowUp(question); }}
                      placeholder="继续追问，如：哪几年是两人感情关键期？"
                      disabled={asking}
                      style={{
                        flex: 1, fontSize: '13px', padding: '10px 12px',
                        borderRadius: '10px', border: '1px solid var(--bdr-med)',
                        background: 'var(--bg-card)', color: 'var(--tx-1)', outline: 'none',
                      }}
                    />
                    <button
                      onClick={() => askFollowUp(question)}
                      disabled={asking || !question.trim()}
                      style={{
                        padding: '10px 20px', borderRadius: '10px', border: 'none',
                        background: asking || !question.trim() ? 'var(--bg-2)' : 'var(--tx-0)',
                        color: asking || !question.trim() ? 'var(--tx-2)' : 'white',
                        fontSize: '13px', fontWeight: 500, whiteSpace: 'nowrap',
                        cursor: asking || !question.trim() ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {asking ? '分析中…' : '追问'}
                    </button>
                  </div>
                </>
              )}
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
