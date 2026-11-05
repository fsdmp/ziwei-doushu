// heming-simple.ts 简版合盘引擎（docs/09 §3.1 B 侧「纯前端 heming 引擎出简版」）：
// B 消费入局后先给命宫对照 + 契合亮点的「可看」结果，深度分析交给现有 AI 接口
// （/api/v1/ziwei/heming，chartA/chartB）。纯本地、无网络——快、稳、零成本，
// 是 AI 深读前的钩子：让 B 在等流式输出前先看到「有关系感」的东西。
//
// 口径与 lib/ziwei/heming-knowledge.ts 对齐（倪海厦体系断语）；只取结构化字段，
// 不做复杂计分——v1 的简版只需要「对照 + 一句契合话术」。

import type { ZiweiChart } from './types';
import { STAR_IN_FUQI_GU } from './heming-knowledge';

/** 宫位主星名列表（空宫借对宫主星，与盘面显示口径一致）。
 *  宫名口径：palace.name 无「宫」后缀（'命宫'/'夫妻'/'财帛'…，见 algorithm 命名）。 */
function majorStars(chart: ZiweiChart, palaceName: string): string[] {
  const palace = chart.palaces.find(p => p.name === palaceName || p.name === palaceName + '宫');
  if (!palace) return [];
  const own = palace.stars.filter(s => s.type === 'major').map(s => s.name);
  if (own.length > 0) return own;
  return palace.borrowedStars ?? [];
}

/** 星性五系（互动文案的最小分类学；够 v1，不追求穷尽） */
const STAR_TEMPER: Record<string, 'leader' | 'action' | 'warm' | 'mind'> = {
  '紫微': 'leader', '天府': 'leader',
  '武曲': 'action', '廉贞': 'action', '七杀': 'action', '破军': 'action',
  '太阳': 'warm', '太阴': 'warm', '天同': 'warm', '天梁': 'warm',
  '天机': 'mind', '巨门': 'mind', '贪狼': 'mind', '天相': 'mind',
};

const TEMPER_LABEL: Record<string, string> = {
  leader: '主导型', action: '行动型', warm: '滋养型', mind: '机变型',
};

/** 命宫星系组合的契合话术（同系=同频，异系按组合各给一句） */
const TEMPER_PAIR: Record<string, string> = {
  'leader|leader': '两人都自带主心骨——山顶不容二虎，但商量好了就是最硬的组合',
  'action|action': '都是行动派，节奏快、火花也快——有话当天说开，越攒越炸',
  'warm|warm': '两个软心肠相遇，日子温和绵长——记得偶尔制造点仪式感，别把浪漫过成习惯',
  'mind|mind': '两个聪明脑对话，永远有聊不完的话题——只是都想到了，谁去做？',
  'leader|action': '一个定方向、一个打天下——天生的干档组合，注意功劳簿要两个人一起看',
  'leader|warm': '一个掌舵、一个守港——最经典的互补结构，家是港湾不是战场',
  'leader|mind': '一个拍板、一个出谋——谋与断齐备，只防「谋太多断太急」',
  'action|warm': '一个冲锋、一个收尾——刚柔相济，冲的人记得回头看一眼',
  'action|mind': '一个敢干、一个会算——良配，但吵架也是快棋对慢棋，各让半步',
  'warm|mind': '一个用心、一个用脑——情绪和道理都齐全，就怕一个觉得对方冷、一个觉得对方缠',
};

/** 双方命宫星系组合 → 契合一句（无主星/未知星兜底） */
function temperHighlight(a: string[], b: string[]): string | null {
  const ta = a.map(s => STAR_TEMPER[s]).find(Boolean);
  const tb = b.map(s => STAR_TEMPER[s]).find(Boolean);
  if (!ta || !tb) return null;
  const key = [ta, tb].sort().join('|');
  return TEMPER_PAIR[key] ?? null;
}

export interface SimpleHeming {
  /** 命宫对照（星名可为空串 = 空宫无主星） */
  aMing: string[];
  bMing: string[];
  aTemper: string | null;
  bTemper: string | null;
  /** 契合亮点一句（星系组合话术） */
  highlight: string | null;
  /** 双方夫妻宫断语摘要（倪海厦体系，STAR_IN_FUQI_GU.summary） */
  aFuqi: string | null;
  bFuqi: string | null;
}

/** 简版合盘：命宫对照 + 星系契合 + 夫妻宫摘要。任何一维缺料都不致命——
 *  页面按空值降级渲染。 */
export function simpleHeming(chartA: ZiweiChart, chartB: ZiweiChart): SimpleHeming {
  const aMing = majorStars(chartA, '命宫');
  const bMing = majorStars(chartB, '命宫');
  const fuqiSummary = (chart: ZiweiChart): string | null => {
    const stars = majorStars(chart, '夫妻');
    for (const s of stars) {
      const knowledge = STAR_IN_FUQI_GU[s];
      if (knowledge) return knowledge.summary;
    }
    return null;
  };
  const temper = (stars: string[]): string | null => {
    const t = stars.map(s => STAR_TEMPER[s]).find(Boolean);
    return t ? TEMPER_LABEL[t] : null;
  };
  return {
    aMing, bMing,
    aTemper: temper(aMing), bTemper: temper(bMing),
    highlight: temperHighlight(aMing, bMing),
    aFuqi: fuqiSummary(chartA),
    bFuqi: fuqiSummary(chartB),
  };
}
