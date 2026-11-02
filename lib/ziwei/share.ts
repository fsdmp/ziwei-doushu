import type { BirthFormState } from '@/components/BirthForm';
import type { BirthInfo } from './types';
import { lunarToSolar } from './lunar-solar';

/** 根据北京时间 + 经度计算真太阳时时辰支 (0-11) */
export function calcTrueSolarBranch(clockHour: number, clockMinute: number, longitude: number): number {
  const clockMins = clockHour * 60 + clockMinute;
  const offset = (longitude - 120) * 4;
  const solar = ((clockMins + offset) % 1440 + 1440) % 1440;
  if (solar >= 1380 || solar < 60) return 0;
  return Math.floor((solar - 60) / 120) + 1;
}

/** BirthFormState → BirthInfo
 *
 * 农历输入先换算成公历（lunarToSolar，闰月不存在/当月无此日返回 null），
 * 后续规则一律作用于公历排盘日。
 *
 * 子时规则（倪海厦体系/三合派标准）：
 * · 23:00-23:59 = 晚子时，**按次日**排盘（日期 +1）
 * · 00:00-00:59 = 早子时，按本日排盘
 * 这与「时辰支同为子(0)」并不冲突——子时分早晚两段，需要在日期上区分。
 */
export function formToBirthInfo(form: BirthFormState): BirthInfo | null {
  let y = parseInt(form.year) || 0;
  let m = parseInt(form.month) || 0;
  let d = parseInt(form.day) || 0;

  if (form.calendar === 'lunar') {
    const solar = lunarToSolar(y, m, d, form.lunarLeap);
    if (!solar) return null;
    y = solar.year; m = solar.month; d = solar.day;
  }

  // 晚子时（23:00-23:59）按次日处理：用 Date 对象自动处理月末/年末进位
  if (!form.unknownTime) {
    const clockHour = parseInt(form.clockHour) || 0;
    if (clockHour === 23 && y > 0 && m > 0 && d > 0) {
      const next = new Date(y, m - 1, d + 1);
      y = next.getFullYear();
      m = next.getMonth() + 1;
      d = next.getDate();
    }
  }

  const hour = form.unknownTime
    ? 0
    : calcTrueSolarBranch(parseInt(form.clockHour) || 0, parseInt(form.clockMinute) || 0, form.longitude);
  return {
    year: y, month: m, day: d,
    hour,
    gender: form.gender,
    name: form.name || undefined,
    province: form.province || undefined,
    city: form.city || undefined,
    longitude: form.province ? form.longitude : undefined,
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
