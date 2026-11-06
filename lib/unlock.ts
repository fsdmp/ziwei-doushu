// unlock.ts 紫微 H5 解锁体系（docs/09 §4/§5/§6）——一切按「一次起盘」计：
// 盘 id = 起盘时生成的会话 uuid（ZiweiChart.sessionId，2026-11-05 拍板）。
// · qna_extra（v2 问答限额）：每盘免费 3 问，一次分享该盘不限次
// · liunian_all（v2.5 流年解锁）：一次分享该盘全部年份
// · qna_heming（合盘邀请追问，2026-11-06）：/invite 结果页深读后的追问同款
//   N=3 限额，key=合盘会话 id（甲盘 sessionId）——与 solo 各限各的互不影响，
//   一边撞墙/解锁不动另一边的额度（kind 分桶即隔离，台账也按 kind 各落各行）
// 两把锁判定都在本地（盘 id 是会话级身份，重起盘即新 id 重新上锁——减压阀
// 最大化）；server user_unlocks 是统一台账（uid+kind+盘 id，幂等落账）：解锁
// 事件统计 + 将来付费（pay 钥匙）插同一张表。落账 best-effort，失败不拦解锁。
//
// 合规口径（§7）：解锁信号 = 分享入口被点击（pushShareCard 被调用），点按钮即
// 解锁、一次给足、已解锁的分享入口随之消失、墙文案永远留替代路（不说「仅限分享」）。

import { requestJSON } from '@/lib/ai';
import { openRewardedAd } from '@/lib/mini-bridge';
import type { ZiweiChart } from '@/lib/ziwei/types';

/** 每盘免费问答次数（docs/09 §4：预设 6 问设计下认真用户几乎必撞墙；2026-11-06 由 5 收紧为 3） */
export const QNA_FREE_LIMIT = 3;

// ─── 盘 id：起盘会话 uuid ──────────────────────────────────

/** 起盘时生成的一次性盘 id（crypto.randomUUID，老 web-view 降级拼随机串） */
export function newSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* 降级 */ }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 取盘 id：起盘入口已赋 sessionId；万一漏赋（旧调用路径/测试数据）用生辰派生
 *  hash 兜底——保证任何盘都有可用 key，只是那一张不会跨重起重置而已。 */
export function chartKey(chart: ZiweiChart): string {
  if (chart.sessionId) return chart.sessionId;
  const b = chart.birthInfo;
  const src = `${b.year}-${b.month}-${b.day}-${b.hour}-${b.gender}-${b.longitude ?? 120}`;
  let h = 5381;
  for (let i = 0; i < src.length; i++) {
    h = ((h << 5) + h + src.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

// ─── 问答配额（本地判定，按盘）─────────────────────────────

const qnaUsedKey = (k: string) => `ziwei_qna_used_${k}`;
const qnaUnlockKey = (k: string) => `ziwei_qna_unlocked_${k}`;

export function qnaUnlocked(key: string): boolean {
  try { return localStorage.getItem(qnaUnlockKey(key)) === '1'; } catch { return false; }
}

export function qnaUsed(key: string): number {
  try { return Number(localStorage.getItem(qnaUsedKey(key)) || '0'); } catch { return 0; }
}

/** 记一次提问（用户主动问才调：主题按钮/输入框；系统自动注入不计） */
export function recordQnaAsk(key: string): void {
  try { localStorage.setItem(qnaUsedKey(key), String(qnaUsed(key) + 1)); } catch { /* 存不进=不限，可接受 */ }
}

/** 问答本地解锁置位（分享入口点击后调） */
export function markQnaUnlocked(key: string): void {
  try { localStorage.setItem(qnaUnlockKey(key), '1'); } catch { /* 忽略 */ }
}

/** 是否可继续提问：会员（钥匙短路）或 已解锁（分享/广告任一）或 免费额度未用完。
 *  会员短路生效的盘由调用方（InsightPanel）落台账 source=member——判定函数
 *  保持纯读，不在此内嵌落账副作用。 */
export function qnaCanAsk(key: string): boolean {
  if (isMember()) return true;
  return qnaUnlocked(key) || qnaUsed(key) < QNA_FREE_LIMIT;
}

// ─── 广告钥匙（docs/11 §4.1）：看完才解锁（ref 回查确认）──────────────────
// 点「看段光影」不再立即置位——跳 bridge 播激励视频，看完 AdWatch 记账（ref
// 幂等），回前台回查 /ziwei/ad/summary?ref= 确认记账后才 mark+台账。无填充/
// 中途关闭：不记账 → 不解锁，调用方提示「试试分享」。pending 存 sessionStorage
// （不进 localStorage 白名单清理）。

interface AdPending { ref: string; kind: UnlockKind; key: string; beforeTotal: number }
const AD_PENDING = 'ziwei_ad_pending';

/** 生成一次观看 ref（server AdWatch 上限 64 字符；新版 bridge 透传记账，H5 凭
 *  它精确回查；旧版 bridge 不读 ref——回查退化用总数差分，同样可靠） */
function newAdRef(): string {
  return `zw-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 发起广告解锁：记 pending（含点前观看总数，供旧 bridge 的差分确认）→ 跳
 *  bridge 播放。确认在 confirmPendingAdUnlock。 */
export function openAdUnlock(kind: UnlockKind, key: string): void {
  const ref = newAdRef();
  requestJSON<{ watched_total?: number }>('/api/v1/ziwei/ad/summary', 'GET')
    .then(r => {
      try {
        sessionStorage.setItem(AD_PENDING,
          JSON.stringify({ ref, kind, key, beforeTotal: r?.watched_total ?? 0 } satisfies AdPending));
      } catch { /* 存不进：回查无从对账，本次按不解锁处理（宁可少给不白给） */ }
      openRewardedAd(ref);
    })
    .catch(() => { /* 点前总数拉不到：差分确认退化为「有任何新记账即算」 */ 
      try {
        sessionStorage.setItem(AD_PENDING,
          JSON.stringify({ ref, kind, key, beforeTotal: -1 } satisfies AdPending));
      } catch { /* 同上 */ }
      openRewardedAd(ref);
    });
}

/** 回前台确认 pending 广告（pageshow 调）：记账确认 → mark 解锁 + 台账
 *  source=ad，返回 true；未记账/无 pending → 清 pending 返回 false。
 *  双通道确认（bridge 新旧都成立）：
 *  · ref 精确回查（新版 bridge：watchZiweiAd(ref) 记账，同 ref 命中即本次看完）
 *  · 总数差分（旧版 bridge 在线时：它不读 ref，用「观看总数 > 点前值」判定
 *    ——bridge 只在完整看完才 POST 记账，差分等价于看完；beforeTotal=-1 表示
 *    点前总数没拉到，退化为「有任一新记账即算」（单 web-view 实例无并发观看） */
export async function confirmPendingAdUnlock(kind: UnlockKind): Promise<boolean> {
  let p: AdPending | null = null;
  try {
    const raw = sessionStorage.getItem(AD_PENDING);
    if (raw) p = JSON.parse(raw) as AdPending;
  } catch { /* 忽略 */ }
  if (!p) return false;
  // 只消费本组件的锁：问答墙（InsightPanel）与流年锁（ChartBoard）都在
  // pageshow 回查，共用一个 pending——不过滤则谁先跑谁吃掉，会把问答的广告
  // 记成流年解锁（墙不收、问题不续、流年反被打开）
  if (p.kind !== kind) return false;
  try { sessionStorage.removeItem(AD_PENDING); } catch { /* 忽略 */ }
  if (!p.ref || !p.kind || !p.key) return false;
  const unlock = () => {
    // 两把问答锁（solo qna_extra / 合盘邀请 qna_heming）共用 qna 本地 key 形态
    //——key 各是各的会话 id，分桶即隔离；流年锁单独形态
    if (p.kind === 'liunian_all') markLiunianUnlocked(p.key);
    else markQnaUnlocked(p.key);
    unlockBy(p.kind, p.key, 'ad');
  };
  // 稍等记账到达（bridge navigateBack 与本回调几乎同刻，网络慢一拍）
  for (let i = 0; i < 3; i++) {
    try {
      const byRef = await requestJSON<{ recorded?: boolean }>(
        `/api/v1/ziwei/ad/summary?ref=${encodeURIComponent(p.ref)}`, 'GET');
      if (byRef?.recorded) { unlock(); return true; }
      // ref 未命中（旧 bridge / 记账慢）→ 总数差分兜底。仅当点前总数拍到过
      //（>=0）才允许差分——拍不到时不能退化为「有历史观看就算」（白给），
      // 宁可本次不解锁（2026-11-06 修：-1 分支恒真的漏洞）
      if (p.beforeTotal >= 0) {
        const sum = await requestJSON<{ watched_total?: number }>(
          '/api/v1/ziwei/ad/summary', 'GET');
        const total = sum?.watched_total ?? -1;
        if (total > p.beforeTotal) { unlock(); return true; }
      }
    } catch { /* 网络抖动：退避重查 */ }
    await new Promise(res => setTimeout(res, 400));
  }
  return false;
}

// ─── 会员钥匙（docs/11 §5）：判定函数内短路，全部调用点零改动 ─────────────

/** 会员态缓存：null=未拉取。refreshMember() 在 layout 挂载与 pageshow 时调 */
let memberCache: boolean | null = null;
/** 分享交互开关（server 配置经 /ziwei/me 下发）：true=分享入口跳 bridge 真面板
 *  （需新版 bridge 已发版），false=右上角「···」引导（旧版线上即用）。 */
let sharePanelCache = false;

export function sharePanelEnabled(): boolean {
  return sharePanelCache;
}

/** 拉取会员态（GET /ziwei/me）并刷新缓存；失败保持原值（默认非会员）。 */
export async function refreshMember(): Promise<void> {
  try {
    const me = await requestJSON<{ member: boolean; member_until: string | null; share_panel?: boolean }>(
      '/api/v1/ziwei/me', 'GET');
    memberCache = !!me.member;
    if (typeof me.share_panel === 'boolean') sharePanelCache = me.share_panel;
  } catch { /* 未登录/弱网：按非会员处理（memberCache 保持 null → false） */ }
}

/** 会员态只读（未拉取/失败一律 false——短路是权益，默认不开）。 */
export function isMember(): boolean {
  return memberCache === true;
}

// ─── 流年解锁（本地判定，按盘）─────────────────────────────

const liunianUnlockKey = (k: string) => `ziwei_liunian_unlocked_${k}`;

export function liunianUnlocked(key: string): boolean {
  if (isMember()) return true; // 会员钥匙：流年全部年份直接放行
  try { return localStorage.getItem(liunianUnlockKey(key)) === '1'; } catch { return false; }
}

/** 流年本地解锁置位（分享入口点击后调；重起盘=新 key 自然重新上锁） */
export function markLiunianUnlocked(key: string): void {
  try { localStorage.setItem(liunianUnlockKey(key), '1'); } catch { /* 忽略 */ }
}

// ─── server 统一台账（docs/09 §6 + docs/11 §5：uid+kind+盘 id，幂等）────

export type UnlockKind = 'qna_extra' | 'qna_heming' | 'liunian_all';
export type UnlockSource = 'share' | 'ad' | 'member';

/** member 台账防重（模块级，页面会话内有效）：member 短路不能写本地解锁 key
 *  （会员过期要重新上锁，语义与 markXxxUnlocked 相斥），改用内存 Set 挡重复
 *  落账——ChartBoard 挂载/effect 依赖重跑/会员每一问都不再重复 POST。刷新
 *  页面会重报一次，服务端幂等（uid+kind+盘 id）兜底；发送失败不重试（台账
 *  本就 best-effort，丢了无功能影响）。 */
const memberLedgerSent = new Set<string>();

/** 解锁落账（POST /api/v1/ziwei/unlocks）。判定在本地，落账 best-effort：
 *  失败不拦解锁（fire-and-forget，不 await 也可）。source 由调用方带——
 *  share=分享入口点击（docs/09 §7.4）、ad=看广告解锁（与分享同权限一次
 *  给足，点按钮即解锁，docs/11 §4.1）、member=会员短路生效（docs/11 §5）。 */
export function unlockBy(kind: UnlockKind, key: string, source: UnlockSource): void {
  if (source === 'member') {
    const dedup = `${kind}:${key}`;
    if (memberLedgerSent.has(dedup)) return;
    memberLedgerSent.add(dedup);
  }
  requestJSON<{ unlocked: boolean }>('/api/v1/ziwei/unlocks', 'POST', {
    kind, chart_key: key, source,
  }).catch(() => { /* 台账尽力而为：无 JWT/弱网丢一条统计，无功能影响 */ });
}

/** 分享入口被点击后的落账（原入口名保留，语义=source share）。 */
export function unlockByShare(kind: UnlockKind, key: string): void {
  unlockBy(kind, key, 'share');
}

/** 页面重回前台的多事件收口：web-view 从原生页（bridge）返回时 pageshow
 *  在部分机型/基础库不触发（只触发 visibilitychange 或 focus）——三事件任一
 *  即回调（800ms 去抖防三事件连发重复跑）。返回注销函数。 */
export function onPageVisible(cb: () => void): () => void {
  let last = 0;
  const fire = () => {
    const now = Date.now();
    if (now - last < 800) return;
    last = now;
    cb();
  };
  const onVis = () => { if (document.visibilityState === 'visible') fire(); };
  window.addEventListener('pageshow', fire);
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('focus', fire);
  return () => {
    window.removeEventListener('pageshow', fire);
    document.removeEventListener('visibilitychange', onVis);
    window.removeEventListener('focus', fire);
  };
}

/** 分享钥匙观察器（share_panel=true 引导式）：跳 bridge 后台账何时落不确定
 *  （用户在分享页停留时长不定、返回事件可能不触发）——回前台事件 + 2.5s
 *  轮询双保险，命中台账即回调并自动停止；60s 观察窗后放弃（墙保留可重点）。
 *  返回停止函数（重复发起时先停上一个）。 */
export function watchUnlock(kind: UnlockKind, key: string, onUnlocked: () => void): () => void {
  let stopped = false;
  let fired = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    offEvents();
    clearInterval(timer);
    clearTimeout(giveUp);
  };
  const check = async () => {
    if (stopped || fired) return;
    // 本地已置位（会员/广告先解过）直接兑现，省一次网络
    const localDone = kind === 'qna_extra' ? qnaUnlocked(key) : liunianUnlocked(key);
    if (localDone) { fired = true; onUnlocked(); stop(); return; }
    const ok = await fetchUnlockStatus(kind, key);
    if (ok && !stopped && !fired) { fired = true; onUnlocked(); stop(); }
  };
  const offEvents = onPageVisible(check);
  const timer = setInterval(check, 2500);
  const giveUp = setTimeout(stop, 60_000);
  check();
  return stop;
}

/** 台账回查（引导式分享解锁，docs/10 §4）：share_panel=true 时分享解锁不再
 *  点按钮即给——跳 bridge 后用户点了「发送给朋友」才落账（bridge 上报），
 *  pageshow 拉本口判真正的解锁时点；未点转发直接返回则 false（锁保留）。 */
export async function fetchUnlockStatus(kind: UnlockKind, key: string): Promise<boolean> {
  try {
    const r = await requestJSON<{ unlocked: boolean }>(
      `/api/v1/ziwei/unlocks/status?kind=${kind}&chart_key=${encodeURIComponent(key)}`, 'GET');
    return !!r?.unlocked;
  } catch { return false; /* 弱网按未解锁处理（锁保留，可再试） */ }
}

// ─── localStorage 卫生（docs/11 §3.2）──────────────────────

/** 最近盘 id 环形数组（上限 10）：清理时的保留白名单。起盘时 touch 进列。 */
const RECENT_KEY = 'ziwei_sessions_recent';
const RECENT_MAX = 10;

export function touchSession(key: string): void {
  try {
    const arr: string[] = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const next = [key, ...arr.filter(k => k !== key)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* 忽略 */ }
}

/** 清理旧盘解锁 key：ziwei_qna_/ziwei_liunian_ 前缀只保留最近
 *  10 盘的，其余删除。每盘 3 个 key、重度用户一年几百盘会缓慢膨胀，启动时清
 *  一次。与档案会话对象（ziwei_last_*）互不干扰（docs/11 §3.2）。 */
export function cleanupOldSessions(): void {
  try {
    let recent: string[] = [];
    try { recent = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { /* 空 */ }
    const keep = new Set(recent);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (!k.startsWith('ziwei_qna_') && !k.startsWith('ziwei_liunian_')) continue;
      // 盘 id 是 key 尾段（ziwei_qna_used_<id> / ziwei_liunian_unlocked_<id>）
      const id = k.replace(/^ziwei_(qna|liunian)_[a-z]+_/, '');
      if (!keep.has(id)) localStorage.removeItem(k);
    }
  } catch { /* 忽略 */ }
}
