// invite.ts 紫微合盘裂变邀请（docs/09 v1）的 H5 侧 API 客户端与生辰序列化。
// 凭据状态机在 mistsee/server（service/ziwei_invite.go），这里只做四个口的收口：
// A 签发（带 A 生辰）/ B 公开卡面（免登录、无生辰）/ B 消费（落 B 生辰、回 A 生辰）/
// A 回访（mine 列表 + result 双方生辰）。
//
// 生辰 payload 的形态 = BirthFormState 去 name（「不存姓名」由服务端再净练一遍，双保险）。
// 存表单原始态而非排盘结果：合盘要本地重排双盘，表单态可完整复原（农历/闰月/经度/
// 时辰不详都在），排盘结果不可逆。

import { requestJSON, type AIError } from '@/lib/ai';
import type { BirthFormState } from '@/components/BirthForm';

/** BirthFormState → 邀请 payload（去 name：本地就不给，隐私最小化） */
export function birthToPayload(form: BirthFormState): Record<string, unknown> {
  const { name: _name, ...rest } = form;
  return rest as Record<string, unknown>;
}

/** 服务端 payload → 表单态（服务端已剔 name，这里按缺省补齐恢复完整 BirthFormState）。
 *  异常 payload（缺年月日/性别）返回 null——老数据或损坏兜底，调用方按失效处理。 */
export function payloadToBirth(payload: string | Record<string, unknown>): BirthFormState | null {
  let p: Record<string, unknown>;
  if (typeof payload === 'string') {
    try { p = JSON.parse(payload); } catch { return null; }
  } else {
    p = payload;
  }
  const str = (v: unknown, def = ''): string => (typeof v === 'string' && v !== '' ? v : def);
  const num = (v: unknown, def: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : def);
  if (!p.year || !p.month || !p.day) return null;
  const gender = p.gender === 'female' ? 'female' : p.gender === 'male' ? 'male' : null;
  if (!gender) return null;
  return {
    name: '',
    calendar: p.calendar === 'lunar' ? 'lunar' : 'solar',
    year: str(p.year), month: str(p.month), day: str(p.day),
    lunarLeap: p.lunarLeap === true,
    clockHour: str(p.clockHour, '8'), clockMinute: str(p.clockMinute, '0'),
    unknownTime: p.unknownTime === true,
    province: str(p.province), city: str(p.city),
    longitude: num(p.longitude, 120),
    gender,
  };
}

// ─── A 侧：签发 ─────────────────────────────────────────────

export interface InviteIssued {
  token: string;
  /** A 的小程序昵称（服务端代查，H5 拿不到）：拼「{A昵称} 想和你合一张盘」卡面标题 */
  inviter_name: string;
}

/** A 发起合盘邀请（POST /api/v1/ziwei/invites，JWT）：同 kind 未消费的旧码服务端复用。 */
export async function createHemingInvite(form: BirthFormState): Promise<InviteIssued> {
  return requestJSON<InviteIssued>('/api/v1/ziwei/invites', 'POST', {
    kind: 'heming',
    birth: birthToPayload(form),
  });
}

// ─── A 侧：本机在挂合盘码（「我的合盘邀请」常驻入口的数据源）────────────
// 服务端「同 kind 未消费复用」保证在挂的 heming 码至多一枚，单值即够：
// 发新码自然覆盖，被消费的旧码凭 token 仍可回访（result 按 token 查）。

const MY_HEMING_KEY = 'ziwei_my_heming_invite';

/** 签发成功记一枚本机码：常驻入口「☯ 我的合盘邀请」据此渲染/进结果页 */
export function saveMyHemingInvite(token: string): void {
  try { localStorage.setItem(MY_HEMING_KEY, token); } catch { /* 隐私模式存不进就算了 */ }
}

/** 读本机最近一枚合盘码；未发起过/隐私模式返回 null（入口不渲染） */
export function loadMyHemingInvite(): string | null {
  try { return localStorage.getItem(MY_HEMING_KEY); } catch { return null; }
}

// ─── B 侧：公开卡面（免登录）──────────────────────────────

export interface InviteCard {
  token: string;
  kind: string;
  valid: boolean;
  /** 无昵称时服务端回「朋友」 */
  inviter_name: string;
}

/** B 落地拉邀请卡面（GET /api/v1/ziwei/invites/:token，公开+限流）。
 *  查无/过期/已用都不抛错——valid=false 由落地页降级起盘。 */
export async function fetchInviteCard(token: string): Promise<InviteCard> {
  return requestJSON<InviteCard>(`/api/v1/ziwei/invites/${encodeURIComponent(token)}`, 'GET');
}

// ─── B 侧：消费入局（JWT）─────────────────────────────────

export interface ConsumeResult {
  first_time: boolean;
  /** A 生辰 payload（B 入局后可见，本地重排 A 盘跑简版对照与 AI 深读） */
  inviter_birth: string;
}

/** B 填完生辰消费邀请（POST …/consume，JWT）：重复消费幂等（first_time=false），
 *  被他人用掉/过期/自邀抛 code='biz' 的 AIError（bizMsg 带可直接展示的文案）。 */
export async function consumeInvite(token: string, form: BirthFormState): Promise<ConsumeResult> {
  return requestJSON<ConsumeResult>(`/api/v1/ziwei/invites/${encodeURIComponent(token)}/consume`, 'POST', {
    birth: birthToPayload(form),
  });
}

// ─── A 侧：回访 ────────────────────────────────────────────

export interface MyInvite {
  token: string;
  kind: string;
  status: 'pending' | 'consumed' | 'expired';
  responded: boolean;
  created_at: string;
  consumed_at: string | null;
}

/** A 查自己在挂邀请（GET /api/v1/ziwei/invites/mine，JWT）。
 *  401（无 JWT）静默返回空列表——浏览器直开场景没有回访语义，不惊扰。 */
export async function fetchMyInvites(): Promise<MyInvite[]> {
  try {
    return await requestJSON<MyInvite[]>('/api/v1/ziwei/invites/mine', 'GET');
  } catch (e) {
    if ((e as AIError).code === 'auth-expired') return [];
    throw e;
  }
}

export interface InviteResult {
  token: string;
  kind: string;
  inviter_birth: string;
  invitee_birth: string;
}

/** A 查已回应邀请的双方生辰（GET …/result，JWT+inviter 校验），本地重排双盘出完整合盘。 */
export async function fetchInviteResult(token: string): Promise<InviteResult> {
  return requestJSON<InviteResult>(`/api/v1/ziwei/invites/${encodeURIComponent(token)}/result`, 'GET');
}
