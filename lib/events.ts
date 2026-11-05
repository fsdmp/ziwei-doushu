// events.ts 紫微 H5 数据事件面（docs/11 §1）——「曝光/过程」侧事件上报：
// 起盘 chart_new / 问答墙 qna_wall / 流年锁面 liunian_wall / 解读反馈 feedback /
// 前端报错 h5_error。动作侧（分享解锁/邀请/广告）已有各自 server 台账，不在此重复。
//
// 语义：fire-and-forget——失败静默丢（统计容忍丢数，不重试不攒返）；3s 防抖
// 合并批量（一次起盘的 chart_new + 墙曝光合成一批 POST，省 8/min 组限流额度）；
// 墙类事件每盘只报一次（模块级 Set 去重，React StrictMode 双跑/组件重挂不重复计）。

import { requestJSON } from '@/lib/ai';

export type ZiweiEventKind = 'chart_new' | 'qna_wall' | 'liunian_wall' | 'feedback' | 'h5_error';

interface QueuedEvent { session_id: string; kind: ZiweiEventKind; payload?: unknown }

const queue: QueuedEvent[] = [];
const onceDone = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** 与服务端 ziweiMaxEventsPerReq / ziweiMaxEventPayload 对齐 */
const MAX_BATCH = 20;
const MAX_QUEUE = 50; // 错误风暴场景的爆队列上限：超了丢新事件（旧的先送走）
const FLUSH_DELAY_MS = 3000;

function sendBatch(batch: QueuedEvent[], keepalive: boolean): void {
  requestJSON<{ accepted: number }>('/api/v1/ziwei/events', 'POST', { events: batch }, { keepalive })
    .catch(() => { /* 丢就丢：统计容忍 */ });
}

function flush(): void {
  flushTimer = null;
  if (queue.length === 0) return;
  sendBatch(queue.splice(0, MAX_BATCH), false);
  // 一批只发 MAX_BATCH 条：队列还有剩余就续上防抖定时器接着冲，
  // 否则尾批要干等下一个事件进来才被带走
  if (queue.length > 0) {
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  }
}

/** 关页/切后台立即冲干队列：keepalive 让请求在页面卸载过程中也能发出去 */
function flushNow(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  while (queue.length > 0) {
    sendBatch(queue.splice(0, MAX_BATCH), true);
  }
}

/** 页面卸载钩子（pagehide / visibilitychange hidden）用：队列空是 no-op，
 *  失败静默丢，与普通冲队同一语义 */
export function flushEventsOnHide(): void {
  if (queue.length === 0) return;
  flushNow();
}

function enqueue(ev: QueuedEvent): void {
  if (queue.length >= MAX_QUEUE) return;
  queue.push(ev);
  if (flushTimer === null) {
    flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
  }
}

/** 单条 payload 截断（rune）：h5_error 的 stack 等长文本取前 512 字符够定位 */
function truncatePayload(s: string): string {
  return Array.from(s).slice(0, 512).join('');
}

/** 普通事件（feedback/h5_error 可多次）。payload 对象序列化后超长由服务端截断 */
export function reportEvent(kind: ZiweiEventKind, sessionId: string, payload?: unknown): void {
  enqueue({ session_id: sessionId, kind, payload });
}

/** 每盘只报一次的事件（chart_new/qna_wall/liunian_wall 的幂等口径） */
export function reportEventOnce(kind: ZiweiEventKind, sessionId: string, payload?: unknown): void {
  const key = `${kind}:${sessionId}`;
  if (onceDone.has(key)) return;
  onceDone.add(key);
  reportEvent(kind, sessionId, payload);
}

/** 前端报错（全局 onerror/unhandledrejection 收口；stack 截 512 防超长） */
export function reportH5Error(stack: string, page?: string): void {
  const sid = ''; // 无盘全局事件：server 侧 session_id 空串落表
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  enqueue({
    session_id: sid,
    kind: 'h5_error',
    payload: { stack: truncatePayload(stack), page, ua: truncatePayload(ua) },
  });
}
