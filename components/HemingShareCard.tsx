'use client';

/**
 * 合盘分享卡 — 双命宫对照（2026-11-09 真机反馈「分享出去的好丑」：合盘此前
 * 走 ShareModal 的无 chart 分支，弹窗只剩三条文字按钮，没有任何卡图物料）。
 *
 * 设计：与 ShareCardCanvas（solo 680×420 金米族）同一视觉语言，主体换成
 * 邀请结果页同款的「甲方命宫 × 乙方命宫」对照 + 契合亮点金条。不印生辰日期
 * （solo 卡有生日行，合盘卡不该替用户泄露双方生日）。
 * 离屏渲染复用 ShareModal 的 captureShareCard——同样挂 id="share-card"，
 * 同一弹窗同一时刻只有一张离屏卡（solo/合盘互斥渲染），id 不冲突。
 */

import type { ZiweiChart } from '@/lib/ziwei/types';
import { simpleHeming } from '@/lib/ziwei/heming-simple';
import { SITE_HOST } from '@/lib/site';

interface HemingShareCardProps {
  chartA: ZiweiChart;
  chartB: ZiweiChart;
}

export default function HemingShareCard({ chartA, chartB }: HemingShareCardProps) {
  const brief = simpleHeming(chartA, chartB);

  /** 一侧命宫块：主星大字（空宫斜体灰）+ 性格注脚。高度交 flex 分配
      （420 高扣除顶栏/亮点/标语后主体仅约 180px，minHeight 会挤溢出） */
  const mingBlock = (label: string, stars: string[], temper: string | null) => (
    <div style={{
      flex: 1,
      background: 'rgba(255,255,255,0.5)',
      border: '1px solid rgba(184,146,42,0.3)',
      borderRadius: '10px',
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 0,
      overflow: 'hidden',
    }}>
      <div style={{ fontSize: '10px', color: '#a89b7c', letterSpacing: '0.3em', marginBottom: '6px' }}>{label}</div>
      {stars.length > 0 ? (
        <div style={{
          fontSize: '34px',
          fontWeight: 800,
          color: '#8b6a14',
          letterSpacing: '0.04em',
          lineHeight: 1.15,
          textAlign: 'center',
        }}>{stars.join('·')}</div>
      ) : (
        <div style={{ fontSize: '22px', fontWeight: 600, color: '#a89b7c', fontStyle: 'italic' }}>空宫</div>
      )}
      {temper && (
        <div style={{ fontSize: '11px', color: '#6b5d3f', marginTop: '6px', letterSpacing: '0.05em' }}>{temper}</div>
      )}
    </div>
  );

  return (
    <div id="share-card" style={{
      width: '680px',
      height: '420px',
      flexShrink: 0,
      background: 'linear-gradient(135deg, #fef9eb 0%, #f7e8c4 60%, #efd8a0 100%)',
      padding: '20px 28px',
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Microsoft JhengHei", sans-serif',
      position: 'relative',
      boxSizing: 'border-box',
      borderRadius: '14px',
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* 装饰光晕（与 solo 卡同款两枚） */}
      <div style={{
        position: 'absolute', top: '-60px', left: '-60px',
        width: '180px', height: '180px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(184,146,42,0.18) 0%, transparent 70%)',
      }} />
      <div style={{
        position: 'absolute', bottom: '-50px', right: '-50px',
        width: '160px', height: '160px', borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(196,90,45,0.12) 0%, transparent 70%)',
      }} />

      {/* 顶部：☯ 徽记 + 标题（同 solo 卡的「紫」圆徽位） */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', position: 'relative', zIndex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '34px', height: '34px', borderRadius: '50%',
            background: 'linear-gradient(135deg, #d4a948 0%, #b8922a 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: '15px', fontWeight: 700,
          }}>☯</div>
          <div>
            <div style={{ fontSize: '15px', color: '#3d2f10', fontWeight: 600, letterSpacing: '0.12em', lineHeight: 1.2 }}>紫微合盘</div>
            <div style={{ fontSize: '9px', color: '#a89b7c', letterSpacing: '0.18em', marginTop: '2px' }}>雾见叙心 · 倪海厦正宗</div>
          </div>
        </div>
        <div style={{ fontSize: '8px', color: '#b8922a', letterSpacing: '0.08em' }}>
          {SITE_HOST}
        </div>
      </div>

      {/* 主体：甲方命宫 × 乙方命宫（邀请结果页同款对照） */}
      <div style={{
        display: 'flex', gap: '12px', alignItems: 'stretch',
        flex: 1, position: 'relative', zIndex: 1, minHeight: 0,
      }}>
        {mingBlock('甲 方 · 命 宫', brief.aMing, brief.aTemper)}
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '4px',
        }}>
          <div style={{ fontSize: '22px', color: '#b8922a', fontWeight: 600 }}>×</div>
          {/* 竖排字拆两行平排——html2canvas 不支持 writing-mode，vertical-rl
              会被画成横排溢出（离屏截图源要迁就截图器，不是浏览器） */}
          <div style={{ fontSize: '8px', color: '#a89b7c', letterSpacing: '0.15em', textAlign: 'center', lineHeight: 1.5 }}>HE<br />MING</div>
        </div>
        {mingBlock('乙 方 · 命 宫', brief.bMing, brief.bTemper)}
      </div>

      {/* 契合亮点（有才渲染）：金左边条白底，同 solo 卡 highlight 形态。
          截断用 maxHeight+overflow hidden——html2canvas 不渲染 -webkit-line-clamp
          与 textOverflow ellipsis，靠它们截图时会整段铺出去 */}
      {brief.highlight && (
        <div style={{
          marginTop: '12px',
          fontSize: '13px',
          color: '#5b4c2e',
          fontWeight: 500,
          padding: '10px 14px',
          background: 'rgba(255,255,255,0.5)',
          borderLeft: '3px solid #b8922a',
          borderRadius: '6px',
          letterSpacing: '0.04em',
          position: 'relative', zIndex: 1,
          overflow: 'hidden',
          // border-box（Tailwind preflight 全局）：上下 padding 20 + 一行 21 = 41，恰好一行
          lineHeight: '21px',
          maxHeight: '41px',
        }}>
          <span style={{ color: '#8b6a14', fontWeight: 600 }}>契合亮点 · </span>{brief.highlight}
        </div>
      )}

      {/* 底部标语（与 solo 卡同块） */}
      <div style={{
        marginTop: '12px',
        padding: '10px 14px',
        background: 'linear-gradient(135deg, rgba(212,169,72,0.18) 0%, rgba(184,146,42,0.08) 100%)',
        border: '1px solid rgba(184,146,42,0.3)',
        borderRadius: '8px',
        position: 'relative', zIndex: 1,
      }}>
        <div style={{ fontSize: '11px', color: '#3d2f10', fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1.4 }}>
          紫微为门 · 天地人为路
        </div>
        <div style={{ fontSize: '10px', color: '#8b6a14', fontWeight: 600, letterSpacing: '0.08em', lineHeight: 1.4, marginTop: '2px' }}>
          倪海厦为师 · AI 答疑伴学
        </div>
        <div style={{ fontSize: '9px', color: '#8b6a14', letterSpacing: '0.1em', marginTop: '4px', fontWeight: 600 }}>
          微信搜小程序「雾见叙心」· 合一张你们的盘 →
        </div>
      </div>
    </div>
  );
}
