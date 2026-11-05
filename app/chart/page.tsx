'use client';
import { useState } from 'react';
import BirthForm, { type BirthFormState } from '@/components/BirthForm';
import ChartBoard from '@/components/ChartBoard';
import InsightPanel from '@/components/InsightPanel';
import ShareButton, { birthForShare } from '@/components/ShareButton';
import { pushShareCard } from '@/lib/mini-bridge';
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

export default function ChartPage() {
  const [chart, setChart] = useState<ZiweiChart | null>(null);
  const [selectedPalace, setSelectedPalace] = useState<Palace | null>(null);
  // 表单原始态留一份给分享卡（排盘 BirthInfo 的 hour 是时辰索引，分享卡要的是钟点）
  const [savedForm, setSavedForm] = useState<BirthFormState | null>(null);

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
        <BirthForm
          onSubmit={(info: BirthInfo) => {
            const next = generateChart(info);
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
        </div>

        <ChartBoard chart={chart} onPalaceSelect={setSelectedPalace} />
        <InsightPanel chart={chart} selectedPalace={selectedPalace} />
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
        .chart-reset-btn {
          padding: 6px 14px;
          cursor: pointer;
          border: 1px solid var(--bdr-med);
          border-radius: 8px;
          background: transparent;
          color: var(--tx-2);
          font-size: 13px;
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
