'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import BirthForm, { type BirthFormState } from '@/components/BirthForm';
import ChartBoard from '@/components/ChartBoard';
import InsightPanel from '@/components/InsightPanel';
import HemingInviteButton from '@/components/HemingInviteButton';
import MyHemingInviteButton from '@/components/MyHemingInviteButton';
import ShareButton, { birthForShare } from '@/components/ShareButton';
import { pushShareCard } from '@/lib/mini-bridge';
import { newSessionId } from '@/lib/unlock';
import { reportEventOnce } from '@/lib/events';
import { touchSession } from '@/lib/unlock';
import { loadLastSession, type LastSession } from '@/lib/ziwei/history';
import { formFromBirthInfo } from '@/lib/ziwei/share';
import { generateChart } from '@/lib/ziwei/algorithm';
import type { BirthInfo, ZiweiChart, Palace } from '@/lib/ziwei/types';

/**
 * 命盘页 —— 开源版「排盘引擎 Demo」
 *
 * 这是一个最小可运行示例：用本仓库的排盘引擎 generateChart() 配合基础 UI
 * 组件，渲染一张完整紫微命盘 + 基础解读，并支持本命 / 大限 / 流年切换
 * （时间维度切换由 ChartBoard 内置的 TimeNav 负责）。
 *
 * 说明：线上商业版的完整交互界面（重设计的新 UI、AI 流式解读、合盘、分享
 * 卡片等）不在开源范围内；但排盘内核——安星算法、四化、格局识别、古籍库——
 * 完全开放（见 lib/ziwei/*），可自由二次开发出你自己的界面。
 */
/** 转发卡亮点：命宫主星串（「紫微·破军 坐命」——比站点默认文案钩人）。不走
 *  lib/ziwei/patterns 的 detectPatterns：那个模块带 server-only 声明且体量大，
 *  为一句文案拖进客户端包不划算 */
function mingStarsHighlight(chart: ZiweiChart): string | undefined {
  const ming = chart.palaces.find(p => p.branch === chart.mingGongBranch);
  const stars = ming?.stars.filter(s => s.type === 'major').map(s => s.name) ?? [];
  return stars.length > 0 ? `${stars.join('·')} 坐命` : undefined;
}

/** 转发卡默认标题：ShareButton 的兜底文案与起盘时静默 push 用同一份，避免两处漂移 */
const SHARE_TITLE = '紫微斗数 · 起一张你的命盘';

/** 起盘后主动提示「和 TA 合一张盘」的关闭记忆（sessionStorage，会话级）：
 *  2026-11-06 口径调整——原 24h 频控（localStorage 时间戳）让横幅「有时显示有时
 *  不显示」反直觉，且抑制的恰是起盘高潮点（合盘意愿最强时刻）。现改为：每次
 *  起盘都提示；用户点 × 后本次浏览会话不再弹（sessionStorage 随会话结束清除） */
const HEMING_HINT_DISMISSED = 'ziwei_heming_hint_dismissed';

export default function ChartPage() {
  const router = useRouter();
  const [chart, setChart] = useState<ZiweiChart | null>(null);
  const [selectedPalace, setSelectedPalace] = useState<Palace | null>(null);
  // 表单原始态留一份给分享卡（排盘 BirthInfo 的 hour 是时辰索引，分享卡要的是钟点）
  const [savedForm, setSavedForm] = useState<BirthFormState | null>(null);
  // 起盘高潮点的一次性主动提示（24h 频控）：「想知道和 TA 的关系」是裂变第一引擎
  const [hemingHint, setHemingHint] = useState(false);
  // 「回到上次」/ 档案续问恢复的对话初值（docs/10 §5.4）
  const [restoredMsgs, setRestoredMsgs] = useState<
    { role: 'user' | 'assistant'; content: string; hidden?: boolean }[] | undefined>(undefined);
  // 「回到上次」按钮的数据源：mounted 后再读 localStorage——渲染期读会与预渲染
  // HTML（构建期无存储数据 = 无按钮）不一致，触发 hydration 回退整树重渲
  //（web-view 有 hydrate 黑屏前科，docs/09 §8，不新增 mismatch 源）
  const [lastSolo, setLastSolo] = useState<LastSession | null>(null);
  useEffect(() => { setLastSolo(loadLastSession('solo')); }, []);

  // 档案「用此盘继续问」恢复通道（docs/10 §5.1）：archive 页存盘 JSON 跳来，
  // 一次性消费（读后即清）；sessionId 原样保留——追问落库按 session_id 归并同盘
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('ziwei_archive_restore');
      if (raw) {
        sessionStorage.removeItem('ziwei_archive_restore');
        const restored = JSON.parse(raw) as ZiweiChart;
        if (restored && restored.palaces) {
          setChart(restored);
          // 生辰一并换回表单态：合盘邀请/分享卡入口（HemingInviteButton/ShareButton）
          // 都以 savedForm 为原料，不恢复则档案续问回来这两个按钮静默消失
          if (restored.birthInfo) setSavedForm(formFromBirthInfo(restored.birthInfo));
        }
      }
    } catch { /* 恢复失败走表单 */ }
  }, []);

  useEffect(() => {
    if (!chart) return;
    try {
      if (sessionStorage.getItem(HEMING_HINT_DISMISSED) === '1') return;
      setHemingHint(true);
    } catch { /* 隐私模式按不提示处理 */ }
  }, [chart]);

  // 关闭 = 本次浏览不再主动提示（新会话/明天再起盘会再有）
  const dismissHemingHint = () => {
    setHemingHint(false);
    try { sessionStorage.setItem(HEMING_HINT_DISMISSED, '1'); } catch { /* 忽略 */ }
  };

  // ── 未起盘：展示出生信息表单 ──
  if (!chart) {
    return (
      <main
        className="chart-form-page mx-auto w-full"
        style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px 48px' }}
      >
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 8 }}>紫微斗数排盘</h1>
        <p style={{ color: '#888', marginBottom: 32, fontSize: 14, lineHeight: 1.7 }}>
          输入出生年月日时，排盘引擎即时生成命盘。
        </p>
        {/* 表单态入口行：「回到上次」有本地会话才出；云端档案常驻（docs/10 §0.3，
            2026-11-06 起盘页放开——起盘前就让人知道「解读能存」） */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          {lastSolo && (
            <button
              type="button"
              onClick={() => {
                if (!lastSolo.chart) return;
                setChart(lastSolo.chart as ZiweiChart);
                setRestoredMsgs(lastSolo.messages ?? []);
                // 生辰一并恢复（heming 页恢复 formA 同款）：否则工具栏合盘邀请按钮
                // 与分享卡生辰在「回到上次」后静默消失
                if (lastSolo.form) setSavedForm(lastSolo.form);
              }}
              className="chart-reset-btn"
            >
              ✦ 回到上次 · 继续那张盘
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push('/archive')}
            className="chart-archive-btn"
          >
            ✦ 档案
          </button>
        </div>
        <BirthForm
          onSubmit={(info: BirthInfo) => {
            const next = generateChart(info);
            // 盘 id：一次起盘一个 uuid（问答额度/流年解锁的维度，重起即重置）
            next.sessionId = newSessionId();
            // 数据事件面（docs/11 §1）：一次起盘一记，漏斗「起盘→解读」的分子分母
            reportEventOnce('chart_new', next.sessionId, { chart_kind: 'solo', from: 'fresh' });
            touchSession(next.sessionId);
            setChart(next);
            // 起盘即静默刷新转发卡素材（浏览器环境此调用自动降级无副作用）：用户
            // 不点「✦ 分享」、直接点右上角「···」转发时，容器页消费的也是当前盘
            // 文案——否则拿到的是上一次点分享按钮时的旧盘素材
            pushShareCard({ title: mingStarsHighlight(next) || SHARE_TITLE, ch: 'chart' });
          }}
          onFormSave={setSavedForm}
        />
      </main>
    );
  }

  // ── 已起盘：命盘 + 解读（手机单列纵向堆叠，≥1024px 双栏） ──
  return (
    <main
      className="mx-auto w-full"
      style={{
        maxWidth: 1280,
        margin: '0 auto',
        padding: '16px 10px calc(24px + env(safe-area-inset-bottom))',
      }}
    >
      <div className="chart-page-grid">
        <div className="chart-toolbar">
          <button
            type="button"
            onClick={() => { setChart(null); setSelectedPalace(null); }}
            className="chart-reset-btn"
          >
            ← 重新起盘
          </button>
          {/* 通用分享入口：转发卡标题带本盘最强格局（有格局比默认文案钩人），
              ch=chart 供裂变归因区分来源 */}
          <ShareButton
            title={SHARE_TITLE}
            highlight={mingStarsHighlight(chart)}
            chart={chart}
            birth={savedForm ? birthForShare(savedForm) : undefined}
            ch="chart"
          />
          {/* 合盘邀请常驻入口（docs/09 §3.1：常驻入口收进 ShareButton 同排）：
              生辰在手，发起即存 payload */}
          <HemingInviteButton form={savedForm} label="☯ 合盘" />
          {/* A 侧回访常驻入口：签发过合盘码才渲染，未回应=等待态/已回应=完整合盘 */}
          <MyHemingInviteButton />
          {/* 云端档案入口（docs/10 §5.2）：非会员也可见，点进引导开会员——
              这个功能自带的转化曝光位；会员紫与工具栏灰按钮拉开层级 */}
          <button
            type="button"
            onClick={() => router.push('/archive')}
            className="chart-archive-btn"
          >
            ✦ 档案
          </button>
        </div>

        {/* 起盘高潮点的一次性主动提示（24h 频控，可关） */}
        {hemingHint && (
          <div
            className="heming-hint"
            style={{
              gridColumn: '1 / -1',
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '12px 16px', borderRadius: '12px',
              background: 'var(--vip-bg)',
              border: '1px solid var(--vip-bdr)',
              fontSize: '13px', color: 'var(--tx-1)',
            }}
          >
            <span style={{ color: 'var(--vip)' }}>☯</span>
            <span style={{ flex: 1, lineHeight: 1.6 }}>
              盘已起好——<b>和 TA 合一张盘？</b>发给那个你想懂的人
            </span>
            <HemingInviteButton form={savedForm} label="合盘" />
            <button
              type="button"
              aria-label="关闭"
              onClick={dismissHemingHint}
              style={{
                width: '22px', height: '22px', borderRadius: '50%', border: 'none',
                background: 'var(--vip-bg)', color: 'var(--vip)',
                fontSize: '13px', cursor: 'pointer', lineHeight: 1, flexShrink: 0,
              }}
            >×</button>
          </div>
        )}

        <ChartBoard chart={chart} onPalaceSelect={setSelectedPalace} />
        <InsightPanel chart={chart} selectedPalace={selectedPalace} initialMessages={restoredMsgs} />
      </div>

      <style>{`
        .chart-page-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 16px;
          margin-top: 12px;
          align-items: stretch;
        }
        .chart-toolbar {
          grid-column: 1 / -1; /* 独占一行，避免把命盘挤进右侧窄列 */
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 4px;
        }
        @media (min-width: 1024px) {
          .chart-page-grid {
            grid-template-columns: minmax(0, 1fr) minmax(0, 380px);
            gap: 20px;
            margin-top: 16px;
            align-items: start;
          }
        }
      `}</style>
    </main>
  );
}
