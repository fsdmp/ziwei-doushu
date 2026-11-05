// unlock.ts 紫微 H5 解锁体系（docs/09 §4/§5/§6）——一切按「一次起盘」计：
// 盘 id = 起盘时生成的会话 uuid（ZiweiChart.sessionId，2026-11-05 拍板）。
// · qna_extra（v2 问答限额）：每盘免费 5 问，一次分享该盘不限次
// · liunian_all（v2.5 流年解锁）：一次分享该盘全部年份
// 两把锁判定都在本地（盘 id 是会话级身份，重起盘即新 id 重新上锁——减压阀
// 最大化）；server user_unlocks 是统一台账（uid+kind+盘 id，幂等落账）：解锁
// 事件统计 + 将来付费（pay 钥匙）插同一张表。落账 best-effort，失败不拦解锁。
//
// 合规口径（§7）：解锁信号 = 分享入口被点击（pushShareCard 被调用），点按钮即
// 解锁、一次给足、已解锁的分享入口随之消失、墙文案永远留替代路（不说「仅限分享」）。

import { requestJSON } from '@/lib/ai';
import type { ZiweiChart } from '@/lib/ziwei/types';

/** 每盘免费问答次数（docs/09 §4：预设 6 问设计下认真用户几乎必撞墙） */
export const QNA_FREE_LIMIT = 5;

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

// ─── 会员钥匙（docs/11 §5）：判定函数内短路，全部调用点零改动 ─────────────

/** 会员态缓存：null=未拉取。refreshMember() 在 layout 挂载与 pageshow 时调 */
let memberCache: boolean | null = null;

/** 拉取会员态（GET /ziwei/me）并刷新缓存；失败保持原值（默认非会员）。 */
export async function refreshMember(): Promise<void> {
  try {
    const me = await requestJSON<{ member: boolean; member_until: string | null }>(
      '/api/v1/ziwei/me', 'GET');
    memberCache = !!me.member;
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

export type UnlockKind = 'qna_extra' | 'liunian_all';
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
