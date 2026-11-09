import { useEffect, useState, useCallback } from 'react';
import type { BirthFormState } from '@/components/BirthForm';

const STORAGE_KEY = 'ziwei_history';
const MAX_ENTRIES = 10;

// ─── 本地最近一条会话（docs/10 §5.4：非会员「回到上次」）───────────────────
// solo / heming 各存最近 1 条完整会话（生辰 + 盘 + 对话原文）：语义是会话恢复
// 不是历史——换设备/清缓存/起下一个盘即丢（会员的「档案」才是留存）。
// 独立 key，与解锁状态 key（ziwei_qna_*/ziwei_liunian_*）互不干扰。

export interface LastSessionData {
  chart: unknown;               // ZiweiChart（solo=甲盘 / heming=甲盘）
  chartB?: unknown;             // heming 的乙盘
  /** solo 的问答记录（InsightPanel 恢复初值） */
  messages?: { role: 'user' | 'assistant'; content: string; hidden?: boolean }[];
  form?: BirthFormState;        // solo 生辰（重起盘表单预填用）
  formA?: BirthFormState;       // heming 双方生辰
  formB?: BirthFormState;
  /** heming 的解读全文（兼容字段：老数据只有它；新数据取 rounds[0] 或末轮） */
  analysis?: string;
  /** heming 全部轮次（2026-11-09 真机反馈「追问不带历史」的修法配套）：合盘
   *  追问从此带上下文，会话是多轮的——本地「上一次」/档案恢复按轮次还原，
   *  analysis 留作老数据回退（rounds 缺省时包装成单轮） */
  rounds?: { q: string; a: string }[];
}

export interface LastSession extends LastSessionData {
  savedAt: number;
}

const LAST_KEY = (kind: 'solo' | 'heming') => `ziwei_last_${kind}`;

/** saveLastSession 落盘后的同页广播（2026-11-08 真机反馈「退出再进才有」的
 *  修法）：解读流在 /chart 起的 fetch 不随路由切换中断，收尾保存可能发生在
 *  用户已跳去 /archive 之后——那边 mount 时读的快照已过期。storage 事件只
 *  跨页签生效，同页只能自己广播，档案页监听它重读「上一次」/重拉云端列表。 */
export const LAST_SESSION_EVENT = 'ziwei-last-session-changed';

export function saveLastSession(kind: 'solo' | 'heming', data: LastSessionData): void {
  try {
    localStorage.setItem(LAST_KEY(kind), JSON.stringify({ ...data, savedAt: Date.now() }));
    window.dispatchEvent(new Event(LAST_SESSION_EVENT));
  } catch { /* 忽略 */ }
}

export function loadLastSession(kind: 'solo' | 'heming'): LastSession | null {
  try {
    const raw = localStorage.getItem(LAST_KEY(kind));
    return raw ? JSON.parse(raw) as LastSession : null;
  } catch { return null; }
}

/** 清掉某类的本地「上一次」。云端档案删除时对同 sessionId 的一条一并清：
 *  否则下次进档案页 importLocal 幂等查无（行刚被删）→ 从本地复活再存入
 *  （2026-11-08 真机反馈「删了又自动存回来」）。 */
export function clearLastSession(kind: 'solo' | 'heming'): void {
  try { localStorage.removeItem(LAST_KEY(kind)); } catch { /* 忽略 */ }
}

export function lastSessionLabel(kind: 'solo' | 'heming'): string | null {
  return loadLastSession(kind) ? '回到上次' : null;
}

export interface HistoryEntry {
  id: string;
  label: string;
  form: BirthFormState;
  savedAt: number;
}

export function useHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch { /* localStorage 不可用时静默失败 */ }
  }, []);

  const save = useCallback((form: BirthFormState) => {
    const label = [
      form.name,
      `${form.year}年${form.month}月${form.day}日`,
      form.city || form.province || '',
      form.gender === 'male' ? '男' : '女',
    ].filter(Boolean).join(' · ');

    const entry: HistoryEntry = {
      id: Date.now().toString(),
      label,
      form,
      savedAt: Date.now(),
    };

    setHistory(prev => {
      // 去重：相同出生年月日+性别+时辰视为同一条记录
      const deduped = prev.filter(e =>
        !(e.form.year === form.year &&
          e.form.month === form.month &&
          e.form.day === form.day &&
          e.form.gender === form.gender &&
          e.form.clockHour === form.clockHour &&
          e.form.clockMinute === form.clockMinute)
      );
      const updated = [entry, ...deduped].slice(0, MAX_ENTRIES);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  const remove = useCallback((id: string) => {
    setHistory(prev => {
      const updated = prev.filter(e => e.id !== id);
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
      return updated;
    });
  }, []);

  return { history, save, remove };
}
