'use client';
import { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { streamAI, type AIError } from '@/lib/ai';
import { pushShareCard } from '@/lib/mini-bridge';
import {
  chartKey, qnaCanAsk, qnaUnlocked, recordQnaAsk, markQnaUnlocked, unlockByShare,
  QNA_FREE_LIMIT, qnaUsed, isMember, unlockBy, refreshMember,
} from '@/lib/unlock';
import { openRewardedAd, openPaySheet } from '@/lib/mini-bridge';
import { saveLastSession } from '@/lib/ziwei/history';
import { reportEventOnce, reportEvent } from '@/lib/events';
import type { ZiweiChart, Palace } from '@/lib/ziwei/types';
import type { TimeView } from './TimeNav';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  hidden?: boolean; // don't show user bubble for auto/topic messages
}

interface SelectedSiHua {
  starName: string;
  siHua: string;
  view: TimeView;
}

interface InsightPanelProps {
  chart: ZiweiChart;
  selectedPalace?: Palace | null;
  selectedSiHua?: SelectedSiHua | null;
  /** 会话恢复初值（「回到上次」/ 档案续问）：不传则空会话 */
  initialMessages?: { role: 'user' | 'assistant'; content: string; hidden?: boolean }[];
}

const TOPICS = [
  { key: 'overview',     label: '命格' },
  { key: 'love',        label: '感情' },
  { key: 'career',      label: '事业' },
  { key: 'wealth',      label: '财运' },
  { key: 'health',      label: '健康' },
  { key: 'personality', label: '性格' },
] as const;

const TOPIC_PROMPTS: Record<string, string> = {
  overview: `请生成命格总览，按以下结构输出：

**【命格定性】**
用一句话概括这个命盘的核心格局与命主气质。

**【主星解读】**
命宫主星的核心特质，引用倪海厦原话或观点。

**【三方四正】**
财、官、迁三宫的联动分析及整体格局。

**【当前大限】**
当下大限运势方向与最值得关注的事项。

**【优势与注意】**
命盘天赋优势，以及需要注意的风险或功课。`,

  love: `请深度分析感情婚姻运，按以下结构输出：

**【感情格局】**
一句话定性感情命格。

**【夫妻宫分析】**
夫妻宫主星、四化，以及倪海厦体系的具体解读。

**【三方联动】**
相关宫位对感情的影响。

**【当前大限感情运】**
当下10年感情走向与关键节点。

**【实际建议】**
具体可行的感情建议。`,

  career: `请深度分析事业运，按以下结构输出：

**【事业格局】**
一句话定性事业命格，宜任职或宜创业。

**【官禄宫分析】**
官禄宫主星、四化，以及倪师对这种配置的判断。

**【财帛宫联动】**
财运与事业的关系，财路来源分析。

**【当前大限事业运】**
当下10年事业走向。

**【实际建议】**
适合的方向、行业与策略。`,

  wealth: `请深度分析财运，按以下结构输出：

**【财运格局】**
一句话定性财运模式，是主动财还是被动财。

**【财帛宫分析】**
财帛宫主星、四化，财富来源与流动模式。

**【田宅宫（财库）】**
积蓄能力与不动产运势分析。

**【当前大限财运】**
当下财运走向与注意事项。

**【理财建议】**
具体的财务建议。`,

  health: `请分析健康运势，按以下结构输出：

**【疾厄宫主星】**
疾厄宫星曜与健康含义。

**【主要风险】**
结合倪海厦子午流注理论，分析主要健康隐患与需关注的部位。

**【大限健康走势】**
当下健康趋势与关键时间段。

**【预防建议】**
具体注意事项与养生方向。`,

  personality: `请深度解析性格特质，按以下结构输出：

**【命宫主星性格】**
命宫主星的核心性格特质，引用倪师原话。

**【三方性格综合】**
财、官、迁三宫对性格的影响，全貌描绘。

**【人际关系模式】**
与他人互动方式、待人处世风格。

**【优势与人生课题】**
天赋优势，以及需要面对的人生功课。`,
};

const PALACE_ROLES: Record<string, string> = {
  '命宫':   '自我、性格、先天格局',
  '兄弟宫': '兄弟关系、合伙人',
  '夫妻宫': '感情关系、婚姻状态',
  '子女宫': '子女缘分、下属关系',
  '财帛宫': '财运来源、收入方式',
  '疾厄宫': '身体健康、意外',
  '迁移宫': '外出机遇、人际格局',
  '交友宫': '朋友圈、贵人、小人',
  '官禄宫': '事业成就、社会地位',
  '田宅宫': '不动产、家庭环境',
  '福德宫': '精神享受、内心福分',
  '父母宫': '父母关系、文书契约',
};

/** Render AI markdown: **【Title】** → gold header, **bold** → strong */
function AiContent({ text, streaming }: { text: string; streaming?: boolean }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-0.5">
      {lines.map((line, i) => {
        const sectionMatch = line.match(/^\*\*【(.+?)】\*\*$/);
        if (sectionMatch) {
          return (
            <div key={i} className="pt-3 pb-0.5 first:pt-0">
              <span className="text-[11px] font-semibold tracking-wide" style={{ color: 'var(--t-gold)' }}>
                【{sectionMatch[1]}】
              </span>
            </div>
          );
        }
        if (line.trim() === '') return <div key={i} className="h-1" />;
        const parts = line.split(/\*\*(.+?)\*\*/);
        return (
          <div key={i} className="text-[11px] leading-relaxed" style={{ color: 'var(--t-text2)' }}>
            {parts.map((part, j) =>
              j % 2 === 0
                ? part
                : <strong key={j} className="font-medium" style={{ color: 'var(--t-text)' }}>{part}</strong>
            )}
          </div>
        );
      })}
      {streaming && (
        <span
          className="inline-block w-1.5 h-3 ml-0.5 animate-pulse rounded-sm align-middle"
          style={{ background: 'var(--t-gold)', opacity: 0.6 }}
        />
      )}
    </div>
  );
}

export default function InsightPanel({ chart, selectedPalace, selectedSiHua, initialMessages }: InsightPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTopic, setActiveTopic] = useState<string>('overview');
  // v2 问答限额（docs/09 §4）：每盘免费 5 问，按盘 id（起盘 uuid）记本地；撞墙出「分享解锁」
  const cKey = useMemo(() => chartKey(chart), [chart]);
  const [walled, setWalled] = useState(false);
  // 墙条 DOM：撞墙时滚进视野（sendMessage 的撞墙分支用）
  const wallRef = useRef<HTMLDivElement | null>(null);
  // 解读反馈（docs/11 §3.3）：已评消息下标集合——一轮一评，防连点重复上报
  const [rated, setRated] = useState<Set<number>>(new Set());
  // 会员支付回来自动收墙（docs/10 §5.3）：pageshow（bridge 收银台 navigateBack
  // 回 H5）刷新 member 态，已开通则墙即刻消失——「会员直接用，不阻塞」
  useEffect(() => {
    const onShow = () => {
      refreshMember().then(() => {
        if (isMember()) setWalled(false);
      });
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);
  const messagesRef = useRef<Message[]>([]); // always-current copy for closures
  const loadingRef = useRef(false);
  const autoLoaded = useRef(false);
  const lastPalaceBranch = useRef<number | undefined>(undefined);
  const lastSiHuaKey = useRef<string | undefined>(undefined);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep refs in sync
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { loadingRef.current = loading; }, [loading]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Auto-generate 命格总览 on mount（「回到上次」恢复的会话除外：历史里已有总览，
  // 再自动补一轮 = 多烧一次 LLM 且对话里重复同一段）
  useEffect(() => {
    if (autoLoaded.current) return;
    autoLoaded.current = true;
    if (initialMessages && initialMessages.length > 0) return;
    sendMessage(TOPIC_PROMPTS.overview, true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Inject palace analysis when palace selected
  useEffect(() => {
    if (!selectedPalace || selectedPalace.branch === lastPalaceBranch.current) return;
    lastPalaceBranch.current = selectedPalace.branch;

    const majorStars = selectedPalace.stars.filter(s => s.type === 'major');
    const starDesc = majorStars.length > 0
      ? majorStars.map(s => `${s.name}${s.siHua ? '化' + s.siHua : ''}`).join('、')
      : '空宫（借对宫）';
    const role = PALACE_ROLES[selectedPalace.name] ?? '';

    const prompt = `请重点分析【${selectedPalace.name}】（主管：${role}），该宫主星为${starDesc}，按以下结构输出：

**【宫位定性】**
${selectedPalace.name}在命盘中的意义，以及这种星曜配置的整体判断。

**【主星解读】**
主星在此宫的倪海厦体系解读，引用具体观点。

**【三方四正联动】**
三方四正宫位对此宫的影响。

**【实际建议】**
基于此宫的具体建议。`;

    sendMessage(prompt, true);
  }, [selectedPalace]); // eslint-disable-line react-hooks/exhaustive-deps

  // 注入四化飞化分析
  useEffect(() => {
    if (!selectedSiHua) return;
    const key = `${selectedSiHua.starName}-${selectedSiHua.siHua}-${selectedSiHua.view}`;
    if (key === lastSiHuaKey.current) return;
    lastSiHuaKey.current = key;

    // 找出该星所在宫位
    const palaceOfStar = chart.palaces.find(p =>
      p.stars.some(s => s.name === selectedSiHua.starName)
    );
    const palaceName = palaceOfStar?.name ?? '未知宫位';
    const viewLabel = selectedSiHua.view === 'daxian' ? '大限' : '流年';

    const prompt = `请分析【${viewLabel}${selectedSiHua.starName}化${selectedSiHua.siHua}】的飞化影响，按以下结构输出：

**【化${selectedSiHua.siHua}基本含义】**
化${selectedSiHua.siHua}在倪海厦体系中的核心含义，以及${selectedSiHua.starName}化${selectedSiHua.siHua}的特殊含义。

**【落宫影响】**
${selectedSiHua.starName}化${selectedSiHua.siHua}落在【${palaceName}】，该宫主管的领域受到何种影响，倪师如何解读。

**【三方四正飞化路径】**
化${selectedSiHua.siHua}入${palaceName}后，对其三方四正（对宫、两个三合宫）的联动影响。

**【当前运势影响】**
在${viewLabel}时间维度下，此化${selectedSiHua.siHua}对命主近期运势的具体影响。

**【实际建议】**
基于此四化的具体可操作建议。`;

    sendMessage(prompt, true);
  }, [selectedSiHua]); // eslint-disable-line react-hooks/exhaustive-deps

  // roundMessages：本轮全量消息（含 hidden 展示标记——存「回到上次」要原样带回，
  // hidden 是纯前端概念，发给服务端的载荷在函数内剥掉，wire format 不变）。
  // byUser：用户主动问才计免费额度——计数点见 onDelta 首帧。
  const streamResponse = async (roundMessages: Message[], byUser = false) => {
    let got = '';    // 本轮回答全文（成功时）
    let failMsg = ''; // 本轮失败文案（失败时）
    let counted = false; // 本轮额度是否已计（onDelta 首帧只计一次）
    try {
      // 先占一个空气泡承接流式增量；流失败且气泡仍为空时在 catch 里替换为提示文案
      setMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      await streamAI('/api/v1/ziwei/interpret', {
        chart,
        messages: roundMessages.map(m => ({ role: m.role, content: m.content })),
      }, (_delta, full) => {
        // 额度计数点 = 首个流式增量到达（服务端已受理并开始回答）：fetch 失败/
        // 限流/空回答的那次不烧额度，用户可无负担重试
        if (byUser && !counted) {
          counted = true;
          if (!qnaUnlocked(cKey)) recordQnaAsk(cKey);
        }
        got = full;
        setMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: full };
          return updated;
        });
      });
      if (!got) throw Object.assign(new Error('empty'), { code: 'empty' });
    } catch (e) {
      const code = (e as AIError).code;
      const msg = code === 'auth-expired'
        ? '登录已过期，请回到小程序重新打开本页。'
        : code === 'api-missing'
          ? 'AI 解读后端未就绪：默认直连 mistsee.offiai.cn，若你自建了后端，请在 .env.local 配置 NEXT_PUBLIC_AI_API_BASE 指向它（协议见 README「快速开始」）。排盘本身不需要任何 API Key。'
          : code === 'rate-limited'
            ? '提问太快了，稍等片刻再试。'
            : '解读失败，请稍后重试。';
      failMsg = msg;
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === 'assistant' && !last.content) {
          updated[updated.length - 1] = { role: 'assistant', content: msg };
        } else {
          updated.push({ role: 'assistant', content: msg });
        }
        return updated;
      });
    } finally {
      setLoading(false);
      loadingRef.current = false;
      // 本地最近一条会话（docs/10 §5.4）：非会员「回到上次」的数据源，每轮问答
      // 后覆盖存（chart + 全量消息）。载荷从入参 roundMessages + 本轮回答构造
      // （messagesRef 靠 useEffect 同步，finally 时可能滞后最后一轮的批处理）；
      // hidden 原样保留——恢复后主题按钮的伪用户气泡才能回到隐藏态
      const last = got || failMsg;
      const all: Message[] = [
        ...roundMessages,
        ...(last ? [{ role: 'assistant' as const, content: last }] : []),
      ];
      saveLastSession('solo', { chart, messages: all });
    }
  };

  // byUser：用户主动提问（主题按钮/输入框）才计入免费额度——mount 总览、选宫、
  // 选四化的自动注入是体验钩子不烧额度（docs/09 §4 的「问」对应用户的问）。
  // hidden 只管气泡展示：主题按钮 hidden=true 复用隐藏用户气泡，但它是用户动作。
  const sendMessage = (text: string, hidden = false, byUser = false) => {
    if (!text.trim() || loadingRef.current) return;
    if (byUser && !qnaCanAsk(cKey)) {
      // 撞墙：免费额度用完且未分享解锁——出墙（合规：留替代路，不说「仅限分享」）
      setWalled(true);
      // 数据事件面（docs/11 §1）：墙曝光每盘一记（reportEventOnce 幂等），撞墙率
      // = qna_wall / interpret_done 的 session——转化看台账 qna_extra 行
      reportEventOnce('qna_wall', cKey, { asked: qnaUsed(cKey) });
      // 不静默：点了没反应最伤信任——墙条就在输入框上方，滚进视野让用户看到
      // 「为什么没动静」（本页无 toast 基建，滚动是贴现有交互的最小实现）
      requestAnimationFrame(() => wallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      return;
    }
    // 会员钥匙（docs/11 §5）：member 短路生效的问答盘落台账 source=member
    //（每盘一锁幂等，归因「会员免掉多少分享解锁」）
    if (byUser && isMember() && !qnaUnlocked(cKey)) {
      unlockBy('qna_extra', cKey, 'member');
    }
    loadingRef.current = true;
    setLoading(true);

    const userMsg: Message = { role: 'user', content: text, hidden };
    // Capture current messages synchronously via ref (avoids stale closure)
    const roundMessages = [...messagesRef.current, userMsg];

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    streamResponse(roundMessages, byUser);
  };

  // 分享解锁（docs/09 §7.4）：解锁信号 = 分享入口被点击——推转发卡素材即解锁
  //（本地置位，点按钮即生效，永不被弱网卡住），server 台账 fire-and-forget。
  // 一次给足：本盘不限次，墙永久消失。
  const shareUnlock = () => {
    pushShareCard({ title: '我的紫微命盘 · 倪海厦正宗解读', ch: 'qna' });
    unlockByShare('qna_extra', cKey);
    markQnaUnlocked(cKey);
    setWalled(false);
  };

  const handleTopicClick = (topicKey: string) => {
    if (loadingRef.current) return;
    setActiveTopic(topicKey);
    sendMessage(TOPIC_PROMPTS[topicKey], true, true);
  };

  const handleSend = () => {
    sendMessage(input, false, true);
  };

  return (
    <div className="insight-panel flex flex-col h-full rounded-xl overflow-hidden card-glass">

      {/* ── Topic buttons ── */}
      <div className="flex-shrink-0 px-2 pt-2.5 pb-2" style={{ borderBottom: '1px solid var(--t-border)' }}>
        <div className="grid grid-cols-6 gap-1">
          {TOPICS.map(t => {
            const isActive = activeTopic === t.key;
            return (
              <button
                key={t.key}
                onClick={() => handleTopicClick(t.key)}
                disabled={loading}
                className="py-1.5 text-[10px] font-medium rounded-lg transition-all duration-150 disabled:opacity-40"
                style={{
                  background: isActive ? 'rgba(212,168,67,0.12)' : 'transparent',
                  border: `1px solid ${isActive ? 'rgba(212,168,67,0.3)' : 'var(--t-border)'}`,
                  color: isActive ? 'var(--t-gold)' : 'var(--t-faint)',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Messages ── */}
      <div ref={scrollRef} className="insight-messages flex-1 overflow-y-auto p-4 space-y-4 min-h-0">

        {/* Loading state before first message */}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="text-4xl mb-3" style={{ color: 'var(--t-gold)', opacity: 0.1 }}>✦</div>
            <p className="text-[10px] animate-pulse" style={{ color: 'var(--t-faint)' }}>命格解读生成中…</p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((msg, i) => {
            if (msg.role === 'user' && msg.hidden) return null;

            if (msg.role === 'user') {
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex justify-end"
                >
                  <div
                    className="max-w-[85%] rounded-xl px-3 py-2 text-[11px]"
                    style={{
                      background: 'rgba(212,168,67,0.08)',
                      border: '1px solid rgba(212,168,67,0.18)',
                      color: 'var(--t-gold)',
                    }}
                  >
                    {msg.content}
                  </div>
                </motion.div>
              );
            }

            // Assistant message
            const isLastMsg = i === messages.length - 1;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div
                  className="text-[9px] tracking-widest mb-2 flex items-center gap-1.5"
                  style={{ color: 'var(--t-faint)' }}
                >
                  <span style={{ color: 'var(--t-gold)', opacity: 0.4 }}>✦</span>
                  命理解读
                </div>
                <AiContent text={msg.content} streaming={loading && isLastMsg} />
                {!(loading && isLastMsg) && (
                  <div className="flex gap-2 mt-1.5" style={{ opacity: rated.has(i) ? 0.35 : 0.7 }}>
                    {(['up', 'down'] as const).map(r => (
                      <button
                        key={r}
                        onClick={() => {
                          if (rated.has(i)) return;
                          setRated(prev => new Set(prev).add(i));
                          reportEvent('feedback', cKey, { rating: r });
                        }}
                        style={{ background: 'transparent', border: 'none', cursor: 'pointer',
                          fontSize: 12, padding: '2px 4px', color: 'var(--t-faint)' }}
                        aria-label={r === 'up' ? '有帮助' : '没帮助'}
                      >
                        {r === 'up' ? '👍' : '👎'}
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* ── v2 问答墙（docs/09 §4/§7）：免费额度尽，分享解锁一次给足；永远留替代路 ── */}
      <AnimatePresence>
        {walled && (
          <motion.div
            ref={wallRef}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="flex-shrink-0 mx-3 mb-2 rounded-xl p-3"
            style={{
              background: 'rgba(122,92,190,0.08)',
              border: '1px solid rgba(122,92,190,0.25)',
            }}
          >
            <div className="text-[11px] mb-2" style={{ color: 'var(--t-text)', lineHeight: 1.7 }}>
              这张盘的 {QNA_FREE_LIMIT} 次免费解读已经用完。分享给朋友，<b>这张盘</b>的解读就不限次数了——
              <span style={{ color: 'var(--t-faint)' }}>或开通会员处处不限，或看段光影同样解锁。</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={shareUnlock}
                className="flex-1 py-2 rounded-lg text-[11px] font-semibold transition-all"
                style={{
                  background: 'linear-gradient(135deg, #7a5cbe, #5b3fa0)',
                  color: 'white', letterSpacing: '0.08em',
                  cursor: 'pointer',
                }}
              >
                ✦ 分享解锁 · 本盘不限次
              </button>
              <button
                onClick={() => openPaySheet('member')}
                className="flex-1 py-2 rounded-lg text-[11px] font-semibold"
                style={{
                  background: 'transparent', cursor: 'pointer',
                  border: '1px solid rgba(212,168,67,0.5)', color: 'var(--t-gold)',
                  letterSpacing: '0.08em',
                }}
              >
                ✦ 会员解锁 · 处处不限
              </button>
            </div>
            <div className="flex gap-2 mt-2" style={{ justifyContent: 'center' }}>
              <button
                onClick={() => {
                  // 广告钥匙（docs/11 §4.1）：与分享同权限——本盘一次给足不限次。
                  // 点按钮即解锁（bridge AdWatch 记账与本地互不依赖，同分享的
                  // 「不验证真分享」口径）；台账 source=ad 归因
                  markQnaUnlocked(cKey);
                  unlockBy('qna_extra', cKey, 'ad');
                  setWalled(false);
                  openRewardedAd();
                }}
                className="text-[11px] underline underline-offset-2"
                style={{ color: 'var(--t-faint)', background: 'transparent',
                  border: 'none', cursor: 'pointer', padding: '2px 6px' }}
              >
                或看段光影 · 同样解锁
              </button>
              <span style={{ color: 'var(--t-faint)', fontSize: 11, alignSelf: 'center' }}>·</span>
              <button
                onClick={() => setWalled(false)}
                className="text-[11px] underline underline-offset-2"
                style={{ color: 'var(--t-faint)', background: 'transparent',
                  border: 'none', cursor: 'pointer', padding: '2px 6px' }}
              >
                先不问
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Input ── */}
      <div className="safe-bottom flex-shrink-0 px-3 pb-3 pt-2" style={{ borderTop: '1px solid var(--t-border)' }}>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSend()}
            placeholder="继续追问，如：今年适合换工作吗？"
            disabled={loading}
            className="flex-1 rounded-lg px-3 py-2 text-[11px] focus:outline-none transition-colors"
            style={{
              background: 'var(--t-card)',
              border: '1px solid var(--t-border)',
              color: 'var(--t-text)',
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            className="px-3 py-2 rounded-lg text-[11px] font-medium transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: 'rgba(212,168,67,0.15)',
              border: '1px solid rgba(212,168,67,0.25)',
              color: 'var(--t-gold)',
            }}
          >
            {loading ? '…' : '追问'}
          </button>
        </div>
      </div>

    </div>
  );
}
