'use client';
import { useState } from 'react';
import BirthForm from '@/components/BirthForm';
import ChartBoard from '@/components/ChartBoard';
import InsightPanel from '@/components/InsightPanel';
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
export default function ChartPage() {
  const [chart, setChart] = useState<ZiweiChart | null>(null);
  const [selectedPalace, setSelectedPalace] = useState<Palace | null>(null);

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
        <BirthForm onSubmit={(info: BirthInfo) => setChart(generateChart(info))} />
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
        <button
          type="button"
          onClick={() => { setChart(null); setSelectedPalace(null); }}
          className="chart-reset-btn"
        >
          ← 重新起盘
        </button>

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
        .chart-reset-btn {
          grid-column: 1 / -1; /* 独占一行，避免把命盘挤进右侧窄列 */
          margin-bottom: 4px;
          padding: 6px 14px;
          cursor: pointer;
          border: 1px solid var(--bdr-med);
          border-radius: 8px;
          background: transparent;
          color: var(--tx-2);
          font-size: 13px;
          justify-self: start;
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
