import type { BirthFormState } from '@/components/BirthForm';
import type { BirthInfo } from './types';
import { lunarToSolar } from './lunar-solar';
import { branchFromSolarMinutes, resolveZiweiDayOffset, shiftGregorianDate } from './true-solar-time';

/** 根据北京时间 + 经度计算真太阳时时辰支 (0-11)。
 *  边界规则只有一份实现：true-solar-time.ts 的 branchFromSolarMinutes。 */
export function calcTrueSolarBranch(clockHour: number, clockMinute: number, longitude: number): number {
  const solar = clockHour * 60 + clockMinute + (longitude - 120) * 4;
  return branchFromSolarMinutes(((solar % 1440) + 1440) % 1440);
}

/** BirthFormState → BirthInfo
 *
 * 农历输入先换算成公历（lunarToSolar，闰月不存在/当月无此日返回 null），
 * 后续规则一律作用于公历排盘日。
 *
 * 子时规则（倪海厦体系/三合派标准，按经度校正后的真太阳时判定）：
 * · 真太阳时 23:00-23:59 = 晚子时，**按次日**排盘（日期 +1）
 * · 真太阳时 00:00-00:59 = 早子时，按本日排盘
 * 这与「时辰支同为子(0)」并不冲突——子时分早晚两段，需要在日期上区分。
 * 时辰支与换日共用同一份真太阳时换算（true-solar-time.ts），口径天然一致。
 */
export function formToBirthInfo(form: BirthFormState): BirthInfo | null {
  let y = parseInt(form.year) || 0;
  let m = parseInt(form.month) || 0;
  let d = parseInt(form.day) || 0;
  let hour = 0;

  // 原始输入快照：必须在换算/换日改写 y/m/d 之前抓取——历法、闰月、
  // 用户原话年月日与时辰是否详尽都留在这里（档案标签按所选历法显示、
  // 恢复表单 round-trip 的唯一原料）
  const orig: NonNullable<BirthInfo['origInput']> = {
    year: y, month: m, day: d,
    calendar: form.calendar,
    lunarLeap: form.calendar === 'lunar' && form.lunarLeap,
  };
  if (!form.unknownTime) {
    orig.clockHour = parseInt(form.clockHour) || 0;
    orig.clockMinute = parseInt(form.clockMinute) || 0;
  }

  if (form.calendar === 'lunar') {
    const solar = lunarToSolar(y, m, d, form.lunarLeap);
    if (!solar) return null;
    y = solar.year; m = solar.month; d = solar.day;
  }

  // 晚子时换日按真太阳时判定，与时辰支同一口径（见 true-solar-time.ts 的 resolveZiweiDayOffset）。
  // 只看钟表 23 点会和经度校正后的时辰错位：东经 100° 钟表 23:30 是真太阳时 22:10 亥时，不该换日。
  if (!form.unknownTime) {
    const solar = (parseInt(form.clockHour) || 0) * 60 + (parseInt(form.clockMinute) || 0) + (form.longitude - 120) * 4;
    const normalizedMinutes = ((solar % 1440) + 1440) % 1440;
    hour = branchFromSolarMinutes(normalizedMinutes);
    const dayOffset = resolveZiweiDayOffset({ dayOffset: Math.floor(solar / 1440), normalizedMinutes, branch: hour });
    if (dayOffset !== 0 && y > 0 && m > 0 && d > 0) {
      ({ year: y, month: m, day: d } = shiftGregorianDate({ year: y, month: m, day: d }, dayOffset));
    }
  }

  return {
    year: y, month: m, day: d,
    hour,
    gender: form.gender,
    name: form.name || undefined,
    province: form.province || undefined,
    city: form.city || undefined,
    longitude: form.province ? form.longitude : undefined,
    origInput: orig,
  };
}

/** BirthInfo → BirthFormState（formToBirthInfo 的反向换算）：盘 JSON 的生辰
 *  换回表单态——档案续问恢复（chart/heming 页）后合盘邀请/分享卡的生辰原料。
 *  origInput 优先（换算/换日前的用户原话）：历法、闰月、原始年月日与时辰都
 *  从原话还原；clockHour 缺省 = 时辰不详（unknownTime 置位，邀请按钮对
 *  unknownTime 同样放行）；整个 origInput 缺省 = 老 chart JSON，按公历 +
 *  时辰不详退化（历史口径）。 */
export function formFromBirthInfo(b: BirthInfo): BirthFormState {
  const o = b.origInput;
  return {
    name: b.name ?? '',
    calendar: o?.calendar === 'lunar' ? 'lunar' : 'solar',
    year: String(o?.year ?? b.year),
    month: String(o?.month ?? b.month),
    day: String(o?.day ?? b.day),
    lunarLeap: o?.calendar === 'lunar' && !!o.lunarLeap,
    clockHour: o?.clockHour !== undefined ? String(o.clockHour) : '',
    clockMinute: o?.clockMinute !== undefined ? String(o.clockMinute) : '',
    unknownTime: o?.clockHour === undefined,
    province: b.province ?? '',
    city: b.city ?? '',
    longitude: b.longitude ?? 120,
    gender: b.gender,
  };
}

/** BirthFormState → URLSearchParams（用于分享链接） */
export function formToSearchParams(form: BirthFormState): URLSearchParams {
  const p = new URLSearchParams();
  if (form.name) p.set('n', form.name);
  p.set('y', form.year);
  p.set('m', form.month);
  p.set('d', form.day);
  if (form.unknownTime) {
    p.set('u', '1');
  } else {
    p.set('h', form.clockHour);
    p.set('mi', form.clockMinute);
  }
  if (form.province) p.set('p', form.province);
  if (form.city) p.set('c', form.city);
  if (form.longitude && form.longitude !== 120) p.set('lo', String(form.longitude));
  // 农历输入：cal=l 标记历法，lp=1 标记闰月；公历不带这两个参数（老链接天然兼容）
  if (form.calendar === 'lunar') {
    p.set('cal', 'l');
    if (form.lunarLeap) p.set('lp', '1');
  }
  p.set('g', form.gender === 'male' ? 'm' : 'f');
  return p;
}

/** URLSearchParams → Partial<BirthFormState>，不完整时返回 null */
export function searchParamsToForm(params: URLSearchParams): Partial<BirthFormState> | null {
  const year = params.get('y');
  const month = params.get('m');
  const day = params.get('d');
  if (!year || !month || !day) return null;
  return {
    name: params.get('n') || '',
    year,
    month,
    day,
    unknownTime: params.get('u') === '1',
    clockHour: params.get('h') || '8',
    clockMinute: params.get('mi') || '0',
    province: params.get('p') || '',
    city: params.get('c') || '',
    longitude: parseFloat(params.get('lo') || '120'),
    calendar: params.get('cal') === 'l' ? 'lunar' : 'solar',
    lunarLeap: params.get('lp') === '1',
    gender: params.get('g') === 'f' ? 'female' : 'male',
  };
}
