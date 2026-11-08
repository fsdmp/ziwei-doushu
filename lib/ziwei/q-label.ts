import { TOPIC_PROMPTS, TOPIC_LABELS } from './topics';

/**
 * 云端档案「问题」的展示归一（2026-11-08 真机反馈：列表最近一问与详情问答
 * 把页内注入的结构化指令原文显示出来了）。
 *
 * 落库的 question 有两类：
 * - 用户手打的自由问——原样展示；
 * - 页内自动/主题注入的指令（主题按钮、选宫、选四化、合盘默认问）——展示
 *   短标签，续问恢复时按 hidden 处理不渲染用户气泡（与本地「回到上次」
 *   hidden 语义一致，见 InsightPanel Message.hidden）。
 *
 * 主题指令按「前 10 字」前缀匹配而非全等：服务端列表把 last_q 截到 64 字，
 * 全文匹配永远撞不上截断版；指令开头措辞足够独特，自由问撞前 10 字的概率
 * 可忽略。选宫/四化/合盘默认问取指令内的动态字段（宫名、飞化名）拼标签。
 */

export interface ArchiveQDisplay {
  /** 展示文案：注入指令 → 短标签；自由问 → 原文 */
  label: string;
  /** 是否页内注入的指令（展示短标签 / 恢复会话时 hidden） */
  auto: boolean;
}

/** 与服务端 ziwei.go ziweiHemingDefaultQuestion 同文案（H5 未填追问时服务端
 *  补的默认问），改任何一侧都要同步。 */
const HEMING_DEFAULT_Q_PREFIX = '请综合分析我们两人的合盘';

export function archiveQDisplay(q: string): ArchiveQDisplay {
  const t = q.trim();
  if (!t) return { label: '', auto: false };
  for (const [key, prompt] of Object.entries(TOPIC_PROMPTS)) {
    if (t.startsWith(prompt.slice(0, 10))) {
      return { label: TOPIC_LABELS[key] ?? '主题解读', auto: true };
    }
  }
  const palace = t.match(/^请重点分析【(.+?)】/); // 选宫注入
  if (palace) return { label: `${palace[1]}解读`, auto: true };
  const sihua = t.match(/^请分析【(.+?)】/); // 选四化飞化注入
  if (sihua) return { label: `${sihua[1]}解读`, auto: true };
  if (t.startsWith(HEMING_DEFAULT_Q_PREFIX)) return { label: '合盘综合解读', auto: true };
  return { label: t, auto: false };
}
