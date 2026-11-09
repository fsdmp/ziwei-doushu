'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ZiweiChart, Palace, Star } from '@/lib/ziwei/types';
import { BRANCHES, STEMS } from '@/lib/ziwei/constants';
import { Solar } from 'lunar-javascript';
import {
  chartKey, liunianUnlocked, markLiunianUnlocked, unlockByShare,
  isMember, unlockBy, refreshMember, openAdUnlock, confirmPendingAdUnlock,
  sharePanelEnabled, fetchUnlockStatus, onPageVisible, watchUnlock,
} from '@/lib/unlock';
import { reportEventOnce } from '@/lib/events';
import { pushShareCard, openPaySheet, openSharePanel, miniToast } from '@/lib/mini-bridge';
import ShareGuideTip from './ShareGuideTip';
import PalaceCell from './PalaceCell';
import TimeNav, { type TimeView, getYearStemIndex, buildSiHuaOverlay } from './TimeNav';

interface ChartBoardProps {
  chart: ZiweiChart;
  onStarSelect?: (star: Star, palace: Palace) => void;
  onPalaceSelect?: (palace: Palace) => void;
  onSiHuaClick?: (starName: string, siHua: string, view: TimeView) => void;
  /** 入场动画直通：只读回看场景（云端档案详情双盘同屏）关掉 stagger——
      24 宫 ×2 盘的错峰入场在 web-view 里首帧卡顿明显，动画留给起盘页 */
  instant?: boolean;
}

const BRANCH_GRID_POS: Record<number, [number, number]> = {
  5: [1, 1], 6: [1, 2], 7: [1, 3], 8: [1, 4],
  4: [2, 1], 9: [2, 4],
  3: [3, 1], 10: [3, 4],
  2: [4, 1], 1: [4, 2], 0: [4, 3], 11: [4, 4],
};

// 每个地支宫位在网格中的中心坐标（百分比）
const BRANCH_SVG_POS: Record<number, [number, number]> = {
  5: [12.5, 12.5], 6: [37.5, 12.5], 7: [62.5, 12.5], 8: [87.5, 12.5],
  4: [12.5, 37.5],                                      9: [87.5, 37.5],
  3: [12.5, 62.5],                                     10: [87.5, 62.5],
  2: [12.5, 87.5], 1: [37.5, 87.5], 0: [62.5, 87.5], 11: [87.5, 87.5],
};

// 绕盘面顺时针排列（用于三方四正四边形排序）
const CLOCKWISE_INDEX: Record<number, number> = {
  5: 0, 6: 1, 7: 2, 8: 3,
  9: 4, 10: 5,
  11: 6, 0: 7, 1: 8, 2: 9,
  3: 10, 4: 11,
};

function sortClockwise(branches: number[]): number[] {
  return [...branches].sort((a, b) => CLOCKWISE_INDEX[a] - CLOCKWISE_INDEX[b]);
}

/** 三方四正：本宫 + 对宫 + 两个三合宫 */
function getSanFangSiZheng(branch: number): [number, number, number, number] {
  return [
    branch,
    (branch + 6) % 12,   // 对宫
    (branch + 4) % 12,   // 三合1
    (branch + 8) % 12,   // 三合2
  ];
}

const ANIMATION_ORDER = [5, 6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4];

export default function ChartBoard({ chart, onStarSelect, onPalaceSelect, onSiHuaClick, instant }: ChartBoardProps) {
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [timeView, setTimeView] = useState<TimeView>('mingpan');
  const [liunianYear, setLiunianYear] = useState<number>(new Date().getFullYear());

  // ── v2.5 流年锁（docs/09 §5）：默认当年自由看，过去/未来年份一次分享解锁该盘
  // 全部年份。解锁按盘 id（起盘 uuid）记本地——重起盘即重新上锁（2026-11-05 拍板），
  // server 只落台账。
  const cKey = useMemo(() => chartKey(chart), [chart]);
  const [liunianLocked, setLiunianLocked] = useState(() => !liunianUnlocked(cKey));
  // 会员钥匙（docs/11 §5）：member 短路让流年直接放行——落台账 source=member
  //（幂等；首把钥匙 share 先到则不被覆盖）。
  // 支付回来自动解锁：pageshow（bridge 收银台 navigateBack 回 H5）刷新 member，
  // 已开通则收锁面——「会员直接用，不阻塞」的回程半段
  useEffect(() => {
    if (isMember()) {
      if (typeof window !== 'undefined') {
        try {
          if (localStorage.getItem(`ziwei_liunian_unlocked_${cKey}`) !== '1') {
            unlockBy('liunian_all', cKey, 'member');
          }
        } catch { /* 忽略 */ }
      }
      if (liunianLocked) setLiunianLocked(false);
    }
  }, [cKey, liunianLocked]);
  // 续看（与问答「挂起续答」同理）：任一钥匙生效后收锁并直接跳到用户当初
  // 想看的年份——不让人解锁完还得再点一次年份。组件级声明：回前台效果与
  // 分享 watchUnlock 回调共用
  const resumeLiunian = () => {
    const y = unlockAskRef.current;
    setLiunianLocked(false);
    setUnlockAsk(null);
    if (y !== null) setLiunianYear(y);
  };
  // 回前台多事件收口（web-view 返回 pageshow 不可靠，见 onPageVisible 注释）：
  // 会员收锁 + 广告钥匙回查；分享钥匙回查归发起时挂的 watchUnlock
  useEffect(() => {
    const off = onPageVisible(() => {
      refreshMember().then(() => {
        if (isMember()) resumeLiunian();
      });
      confirmPendingAdUnlock('liunian_all').then(ok => {
        if (ok) resumeLiunian();
      });
    });
    return off;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // 想去但被锁的年份（解锁面板的钩子文案用「解锁 {year} 年的你」）
  const [unlockAsk, setUnlockAsk] = useState<number | null>(null);
  // 分享引导条（share_panel=false 期点即给后的「已分享·解锁」呈现）
  const [shareGuide, setShareGuide] = useState<string | null>(null);
  // 分享钥匙观察器停止句柄（重复发起先停上一个；60s 观察窗自动放弃）
  const stopWatchRef = useRef<(() => void) | null>(null);
  // 想看年份/锁态/盘 id 的镜像 ref：pageshow 监听只挂一次，读 state 会锁死首帧值
  const unlockAskRef = useRef<number | null>(null);
  const liunianLockedRef = useRef(false);
  const cKeyRef = useRef('');
  useEffect(() => { unlockAskRef.current = unlockAsk; }, [unlockAsk]);
  useEffect(() => { liunianLockedRef.current = liunianLocked; }, [liunianLocked]);
  useEffect(() => { cKeyRef.current = cKey; }, [cKey]);

  const handleYearChange = (year: number) => {
    if (year !== new Date().getFullYear() && liunianLocked) {
      setUnlockAsk(year); // 锁面：拦截切换，弹解锁钩子
      // 数据事件面（docs/11 §1）：锁面曝光每盘一记，流年漏斗的曝光分母
      reportEventOnce('liunian_wall', cKey, { year });
      return;
    }
    setLiunianYear(year);
  };

  // 分享解锁（docs/09 §7.4）：点按钮即解锁（本地置位，永不被弱网卡住），一次给足
  //（本盘全部年份），入口随之消失；server 台账 fire-and-forget。
  const shareUnlockLiunian = () => {
    if (unlockAsk === null) return;
    const title = `解锁 ${unlockAsk} 年的我 · 紫微流年`;
    pushShareCard({ title, ch: 'liunian' });
    if (sharePanelEnabled()) {
      // 引导式分享解锁（docs/10 §4）：点按钮不解锁——跳 bridge，点了「发送
      // 给朋友」才落账；watchUnlock 事件+轮询双保险（返回时 pageshow 可能
      // 不触发），命中台账才解锁并跳到想看的年份。没点转发直接返回：锁面保留
      stopWatchRef.current?.();
      stopWatchRef.current = watchUnlock('liunian_all', cKey, () => {
        markLiunianUnlocked(cKeyRef.current);
        resumeLiunian();
      });
      openSharePanel({ title, ch: 'liunian', lock: { kind: 'liunian_all', chartKey: cKey } });
      return;
    }
    // 旧版线上（bridge 未发版）：点即给（合规口径不变）+ 底部分享引导条
    unlockByShare('liunian_all', cKey);
    markLiunianUnlocked(cKey);
    setLiunianLocked(false);
    setLiunianYear(unlockAsk);
    setUnlockAsk(null);
    setShareGuide(title);
  };

  // 展示用原始农历日期（Solar→Lunar 现算）。不用 chart.lunarInfo——那是安星口径
  // （闰月按 prev-month 等策略重映射过），闰月出生者会丢「闰」标；这里要给用户看
  // 的是他输入的真实历法日期。纯展示，不参与排盘与大限/流年切换。
  const lunarDisplay = useMemo(() => {
    try {
      const { year, month, day } = chart.birthInfo;
      const lu = Solar.fromYmd(year, month, day).getLunar();
      const m = lu.getMonth();
      return { year: lu.getYear(), month: Math.abs(m), leap: m < 0, day: lu.getDay() };
    } catch {
      return null;
    }
  }, [chart.birthInfo.year, chart.birthInfo.month, chart.birthInfo.day]);

  const palaceMap: Record<number, Palace> = {};
  chart.palaces.forEach(p => { palaceMap[p.branch] = p; });

  // 计算当前叠加四化数据（大限或流年）
  const currentDx = chart.daXians[chart.currentDaXianIndex];
  const overlayData: Record<string, string> = (() => {
    if (timeView === 'daxian' && currentDx) {
      const dxPalace = chart.palaces.find(p => p.branch === currentDx.palaceBranch);
      if (dxPalace) return buildSiHuaOverlay(dxPalace.stem);
    }
    if (timeView === 'liunian') {
      return buildSiHuaOverlay(getYearStemIndex(liunianYear));
    }
    return {};
  })();
  const overlayLabel = timeView === 'daxian' ? '限' : timeView === 'liunian' ? '年' : undefined;

  const handlePalaceClick = (branch: number) => {
    const isDeselecting = selectedBranch === branch;
    setSelectedBranch(prev => prev === branch ? null : branch);
    if (!isDeselecting) {
      const palace = palaceMap[branch];
      if (palace) onPalaceSelect?.(palace);
    }
  };

  // 三方四正
  const sanFangBranches = selectedBranch !== null ? getSanFangSiZheng(selectedBranch) : null;
  const sanFangSet = sanFangBranches ? new Set(sanFangBranches) : null;

  return (
    <div className="w-full select-none">
      {/* 时间导航轴 */}
      <TimeNav
        chart={chart}
        view={timeView}
        liunianYear={liunianYear}
        onViewChange={setTimeView}
        onYearChange={handleYearChange}
      />

      {/* ── v2.5 流年解锁面（docs/09 §5）：锁的是年份切换本身，渲染层无需改。
          钩子文案「解锁 {year} 年的你」；合规：点按钮即解锁、一次给足、留替代路 ── */}
      <AnimatePresence>
        {unlockAsk !== null && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18 }}
            className="mb-3 rounded-xl p-3.5"
            style={{
              background: 'var(--vip-bg)',
              border: '1px solid var(--vip-bdr)',
            }}
          >
            <div className="text-[11px] mb-1" style={{ color: 'var(--t-gold)', letterSpacing: '0.15em' }}>
              解锁 {unlockAsk} 年的你
            </div>
            <div className="text-[10px] mb-2.5" style={{ color: 'var(--t-text2)', lineHeight: 1.7 }}>
              那一年的流年四化、宫位联动与运势走向。分享一次，<b>这张盘</b>的过去与未来年份全部打开——
              <span style={{ color: 'var(--t-faint)' }}>或开通会员处处不限，或看段光影同样解锁；今年的流年本来就能看。</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={shareUnlockLiunian}
                className="flex-1 py-2 rounded-lg text-[11px] font-semibold transition-all"
                style={{
                  background: 'var(--vip-grad)',
                  color: 'white', letterSpacing: '0.08em',
                  cursor: 'pointer',
                }}
              >
                ✦ 分享解锁 · 全部年份
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
              <button
                onClick={() => setUnlockAsk(null)}
                className="px-3 py-2 rounded-lg text-[11px]"
                style={{
                  border: '1px solid var(--t-border)', color: 'var(--t-faint)',
                  background: 'transparent', cursor: 'pointer',
                }}
              >
                先看今年
              </button>
            </div>
            <div className="mt-2" style={{ textAlign: 'center' }}>
              <button
                onClick={() => {
                  // 广告钥匙（docs/11 §4.1）：看完记账才解锁——跳 bridge 播放，
                  // pageshow 回查确认（confirmPendingAdUnlock）后收锁
                  if (unlockAsk === null) return;
                  openAdUnlock('liunian_all', cKey);
                }}
                className="text-[11px] underline underline-offset-2"
                style={{ color: 'var(--t-faint)', background: 'transparent',
                  border: 'none', cursor: 'pointer', padding: '2px 6px' }}
              >
                或看段光影 · 同样解锁
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 命盘标题 */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-3"
      >
        <div className="text-[10px] tracking-[0.5em] uppercase mb-1" style={{ color: 'var(--t-faint)' }}>
          Zi Wei Dou Shu
        </div>
        <h2 className="text-sm tracking-[0.25em] font-medium" style={{ color: 'var(--t-gold)' }}>
          {chart.birthInfo.name ? `${chart.birthInfo.name} · ` : ''}紫微斗数命盘
        </h2>
        {/* 公历/农历生日（引擎统一按公历排盘，展示层现算原始农历，闰月带「闰」标）
            ——纯展示，不参与任何排盘/切换逻辑 */}
        <div className="text-[10px] mt-1.5 tracking-wide flex flex-wrap justify-center gap-x-3" style={{ color: 'var(--t-faint)' }}>
          <span>公历 {chart.birthInfo.year}年{chart.birthInfo.month}月{chart.birthInfo.day}日</span>
          {lunarDisplay && (
            <span>
              农历 {lunarDisplay.year}年{lunarDisplay.leap ? '闰' : ''}{lunarDisplay.month}月{lunarDisplay.day}日
            </span>
          )}
          <span>{STEMS[chart.lunarInfo.yearStem]}{BRANCHES[chart.lunarInfo.yearBranch]}年</span>
        </div>
      </motion.div>

      {/* 4x4 命盘网格（含 SVG 叠加层）；minmax(0,1fr) 防止星曜文字把网格撑出屏幕 */}
      <div
        className="grid rounded-xl overflow-hidden relative"
        style={{
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gridTemplateRows: 'repeat(4, auto)',
          gap: '1px',
          background: 'var(--t-border)',
          border: '1px solid var(--t-border)',
          boxShadow: '0 4px 32px rgba(0,0,0,0.15)',
        }}
      >
        {ANIMATION_ORDER.map((branch, i) => {
          const [row, col] = BRANCH_GRID_POS[branch];
          const palace = palaceMap[branch];
          if (!palace) return null;
          return (
            <div key={branch} style={{ gridRow: row, gridColumn: col, background: 'var(--t-bg)', minWidth: 0, overflow: 'hidden' }}>
              <PalaceCell
                palace={palace}
                onClick={() => handlePalaceClick(branch)}
                onStarClick={(star) => onStarSelect?.(star, palace)}
                isSelected={selectedBranch === branch}
                isSanFang={!!(sanFangSet?.has(branch) && selectedBranch !== branch)}
                delay={instant ? 0 : i * 0.04}
                overlayStarSiHua={Object.keys(overlayData).length > 0 ? overlayData : undefined}
                overlayLabel={overlayLabel}
                onSiHuaClick={(starName, siHua) => onSiHuaClick?.(starName, siHua, timeView)}
              />
            </div>
          );
        })}

        {/* 中央信息区 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: instant ? 0 : 0.5 }}
          className="palace-center-tile flex flex-col items-center justify-center p-4 gap-3"
          style={{ gridRow: '2 / 4', gridColumn: '2 / 4', background: 'var(--t-bg)', minWidth: 0 }}
        >
          <div className="palace-center-symbol text-5xl select-none leading-none" style={{ color: 'var(--t-gold)', opacity: 0.12, filter: 'drop-shadow(0 0 12px rgba(180,120,30,0.15))' }}>
            ☯
          </div>

          <div className="text-center space-y-1">
            <div className="text-[9px] tracking-[0.3em] font-medium" style={{ color: 'var(--t-gold)' }}>紫微斗数</div>
            <div className="text-[10px] space-y-0.5" style={{ color: 'var(--t-faint)' }}>
              <div>命宫 <span style={{ color: 'var(--t-gold)', opacity: 0.7 }}>{BRANCHES[chart.mingGongBranch]}</span></div>
              <div>身宫 <span className="text-sky-500/70">{BRANCHES[chart.shenGongBranch]}</span></div>
              <div className="text-[9px]" style={{ color: 'var(--t-gold)', opacity: 0.75 }}>{chart.wuxingJuName}</div>
            </div>
          </div>

          {chart.currentDaXianIndex >= 0 && (() => {
            const dx = chart.daXians[chart.currentDaXianIndex];
            return (
              <div className="border border-purple-500/30 rounded-lg px-2 py-1 text-center"
                style={{ background: 'rgba(147,51,234,0.06)' }}>
                <div className="text-[8px] text-purple-500/80 mb-0.5 tracking-wider">当前大限</div>
                <div className="text-[12px] text-purple-400 font-medium tabular-nums">{dx.startAge}–{dx.endAge}岁</div>
                <div className="text-[9px] text-purple-500/60">{dx.palaceName}</div>
              </div>
            );
          })()}

          <div className="text-[8px] text-center leading-relaxed font-mono" style={{ color: 'var(--t-faint)', opacity: 0.75 }}>
            {chart.lunarInfo.lunarYear}·{chart.lunarInfo.isLeapMonth ? '闰' : ''}
            {chart.lunarInfo.lunarMonth}·{chart.lunarInfo.lunarDay}
          </div>
        </motion.div>

        {/* ── 三方四正 SVG 连线（绝对定位在 grid 内部，受 overflow:hidden 裁切） ── */}
        <AnimatePresence>
          {sanFangBranches !== null && (
            <motion.div
              key={`sf-${selectedBranch}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="pointer-events-none"
              style={{
                position: 'absolute',
                inset: 0,
                zIndex: 20,
              }}
            >
              <svg
                width="100%"
                height="100%"
                xmlns="http://www.w3.org/2000/svg"
                style={{ display: 'block' }}
              >
                {(() => {
                  // 三角形（三方）+ 一条直线（对宫）
                  const p0 = BRANCH_SVG_POS[sanFangBranches[0]]; // 本宫
                  const p1 = BRANCH_SVG_POS[sanFangBranches[1]]; // 对宫
                  const p2 = BRANCH_SVG_POS[sanFangBranches[2]]; // 三合1
                  const p3 = BRANCH_SVG_POS[sanFangBranches[3]]; // 三合2
                  const dash = "6,5";
                  const stroke = "rgba(37,99,235,0.55)";
                  const sw = "1.5";
                  return (
                    <>
                      {/* 对宫直线：本宫 ↔ 对宫（穿过中心） */}
                      <line
                        x1={`${p0[0]}%`} y1={`${p0[1]}%`}
                        x2={`${p1[0]}%`} y2={`${p1[1]}%`}
                        stroke={stroke} strokeWidth={sw}
                        strokeDasharray={dash} strokeLinecap="round"
                      />
                      {/* 三合三角形：本宫 → 三合1 → 三合2 → 本宫 */}
                      <line
                        x1={`${p0[0]}%`} y1={`${p0[1]}%`}
                        x2={`${p2[0]}%`} y2={`${p2[1]}%`}
                        stroke={stroke} strokeWidth={sw}
                        strokeDasharray={dash} strokeLinecap="round"
                      />
                      <line
                        x1={`${p2[0]}%`} y1={`${p2[1]}%`}
                        x2={`${p3[0]}%`} y2={`${p3[1]}%`}
                        stroke={stroke} strokeWidth={sw}
                        strokeDasharray={dash} strokeLinecap="round"
                      />
                      <line
                        x1={`${p3[0]}%`} y1={`${p3[1]}%`}
                        x2={`${p0[0]}%`} y2={`${p0[1]}%`}
                        stroke={stroke} strokeWidth={sw}
                        strokeDasharray={dash} strokeLinecap="round"
                      />
                      {/* 四个宫位中心标记点 */}
                      {[p0, p1, p2, p3].map((p, i) => (
                        <circle
                          key={i}
                          cx={`${p[0]}%`} cy={`${p[1]}%`}
                          r="3"
                          fill={i === 0 ? 'rgba(37,99,235,0.8)' : 'rgba(37,99,235,0.45)'}
                        />
                      ))}
                    </>
                  );
                })()}
              </svg>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 图例 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: instant ? 0 : 0.7 }}
        className="mt-3 flex items-center justify-center gap-2 text-[9px] flex-wrap"
      >
        {[
          { h: '化禄', c: 'text-emerald-500 border-emerald-500/30' },
          { h: '化权', c: 'text-blue-500 border-blue-500/30' },
          { h: '化科', c: 'text-yellow-500 border-yellow-500/30' },
          { h: '化忌', c: 'text-red-500 border-red-500/30' },
        ].map(({ h, c }) => (
          <span key={h} className={`border px-1.5 py-0.5 rounded-full font-medium ${c}`}>{h}</span>
        ))}
        <span className="px-1.5 py-0.5 rounded-full" style={{ color: 'var(--t-faint)', border: '1px solid var(--t-border)' }}>
          点击宫位看三方四正
        </span>
      </motion.div>
      <ShareGuideTip
        open={shareGuide !== null}
        onClose={() => setShareGuide(null)}
        title={shareGuide ?? ''}
        ch="liunian"
        sub={`流年已解锁 · ${unlockAskRef.current ?? ''} 年的自己，分享给朋友看`}
      />
    </div>
  );
}
