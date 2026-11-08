export interface BirthInfo {
  year: number;      // Gregorian year（已经过子时换日修正后的"排盘日"）
  month: number;     // Gregorian month (1-12)
  day: number;       // Gregorian day
  hour: number;      // 时辰 branch index (0=子, 1=丑, ... 11=亥)
  gender: 'male' | 'female';
  name?: string;
  province?: string;   // 出生省份
  city?: string;       // 出生城市
  longitude?: number;  // 出生地经度（用于真太阳时校正）
  /**
   * 原始输入（用户在表单里实际填的时间，农历→公历换算与晚子时换日之前的
   * 用户原话），始终留存。两个用途：
   * · 恢复表单 round-trip（档案续问/合盘邀请）：历法选择、闰月、原始年月日
   *   与时辰从原话还原，而非展示换算值
   * · 云端档案标签按起盘所选历法显示：农历 orig → "农历1990年闰5月14日"，
   *   公历 orig → "1990年5月14日"（server 端拼 label）
   * 例：用户农历输入 5/9 23:55 → year/month/day 是换算+换日后的公历排盘日，
   *     这里保存 { year, month, day, calendar:'lunar', lunarLeap, clockHour:23, clockMinute:55 }。
   * clockHour/clockMinute 时辰不详（unknownTime）时缺省——它俩缺省与否就是
   * 恢复时 unknownTime 的判定信号；整个 origInput 缺省 = 老 chart JSON，
   * 恢复按公历 + 时辰不详退化（历史口径）。
   */
  origInput?: {
    year: number;
    month: number;
    day: number;
    calendar: 'solar' | 'lunar';
    lunarLeap: boolean;
    clockHour?: number;
    clockMinute?: number;
  };
}

export interface LunarInfo {
  lunarYear: number;
  lunarMonth: number;    // positive = normal, negative = leap month
  lunarDay: number;
  yearStem: number;      // 0-9 (甲乙丙丁戊己庚辛壬癸)
  yearBranch: number;    // 0-11 (子丑寅卯辰巳午未申酉戌亥)
  isLeapMonth: boolean;
  /** 节气四柱（年/月/日/时柱），如 ["壬午","壬子","壬戌","庚戌"] */
  fourPillars?: [string, string, string, string];
  /** 非节气四柱（农历口径：正月初一换年 + 农历月，与紫微同历法）——节气交界日其月柱会与 fourPillars 不同 */
  fourPillarsLunar?: [string, string, string, string];
}

export type SiHua = '禄' | '权' | '科' | '忌';

/** 星辰亮度 8 档（紫微斗数标准）——'地' 为 XD1（现代修订亮度表第一版）额外等级 */
export type StarBrightness = '庙' | '旺' | '得' | '利' | '平' | '不' | '闲' | '陷' | '地';

export interface Star {
  name: string;
  type: 'major' | 'minor' | 'lucky' | 'sha';
  siHua?: SiHua;
  /** 粗粒度亮度（保留向后兼容，算法判断用） */
  brightness?: 'bright' | 'normal' | 'dim';
  /** 原始 7 档亮度（庙/旺/得/利/平/不/陷）—— 显示层使用 */
  brightnessRaw?: StarBrightness;
}

export interface SelfSihuaMark {
  siHua: SiHua;       // 禄/权/科/忌
  starName: string;   // 自化的星
}

export interface Palace {
  branch: number;      // 0-11 (地支索引)
  stem: number;        // 0-9 (天干索引)
  name: string;        // 宫名
  stars: Star[];
  daXianAge?: [number, number];   // 大限年龄段
  isCurrentDaXian?: boolean;
  isMingGong?: boolean;
  isShenGong?: boolean;
  /** 宫干自化（倪师体系核心） */
  selfSihua?: SelfSihuaMark[];
  /** 对宫地支索引（永远 = (branch + 6) % 12） */
  oppositeBranch?: number;
  /** 是否空宫（无主星） */
  isEmpty?: boolean;
  /** 若为空宫，借自哪个宫的地支索引 = oppositeBranch */
  borrowedFromBranch?: number;
  /** 若为空宫，借自哪个宫名 */
  borrowedFromName?: string;
  /** 若为空宫，借到的对宫主星名列表（结构化数据，文案层不再需要从文本反查） */
  borrowedStars?: string[];
}

export interface DaXianSiHua {
  stemIndex: number;
  stemName: string;
  lu: string;    // 化禄星名
  quan: string;  // 化权星名
  ke: string;    // 化科星名
  ji: string;    // 化忌星名
}

export interface DaXian {
  startAge: number;
  endAge: number;
  palaceBranch: number;
  palaceName: string;
  stemIndex?: number;    // 大限宫的天干索引（用于大限四化）
  stemName?: string;
  siHua?: DaXianSiHua;   // 该大限四化（基于宫干）
}

export interface ZiweiChart {
  birthInfo: BirthInfo;
  lunarInfo: LunarInfo;
  mingGongBranch: number;    // 命宫地支
  shenGongBranch: number;    // 身宫地支
  wuxingJu: number;          // 五行局 (2,3,4,5,6)
  wuxingJuName: string;      // e.g. '水二局'
  ziweiPos: number;          // 紫微星位置
  palaces: Palace[];         // 12宫，按地支0-11排序
  daXians: DaXian[];
  currentAge: number;
  currentDaXianIndex: number;
  /** Signed analysis-cache eligibility marker assigned by /api/generate. */
  analysisCacheProfile?: string;
  /** 起盘会话 id（docs/09 §4/§5/§6 解锁维度）：起盘时生成的一次性 uuid——问答
   *  额度与流年解锁都按它计，重起盘即新 id 重新上锁。由起盘入口赋值
   *  （newSessionId，lib/unlock.ts），排盘引擎自身不关心。 */
  sessionId?: string;
  /** 命主星（按命宫地支查表） */
  mingZhu?: string;
  /** 身主星（按生年地支查表） */
  shenZhu?: string;
  /** 阴阳性别（阳男/阴男/阳女/阴女） */
  yinYangGender?: string;
}
