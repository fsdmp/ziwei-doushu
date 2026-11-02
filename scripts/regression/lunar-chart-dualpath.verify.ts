/**
 * 一次性广域验证（不挂 npm test）：
 * 1900–2026 每年正月 / 七月 / 当年闰月，初一 / 当月最后一天，午时 / 晚子时，
 * 农历输入与等价公历输入各起一张完整命盘，deepEqual 全量比对。
 * 通过 ⇒ 农历链路与公历链路（已有完整回归覆盖）在引擎层完全等价。
 */
import assert from 'node:assert/strict';
import { generateChart } from '../../lib/ziwei/algorithm';
import { formToBirthInfo } from '../../lib/ziwei/share';
import { lunarToSolar, lunarMonthDayCount, leapMonthOfLunarYear } from '../../lib/ziwei/lunar-solar';
import type { BirthFormState } from '../../components/BirthForm';

function makeForm(over: Partial<BirthFormState>): BirthFormState {
  return {
    name: '',
    calendar: 'solar',
    year: '2000',
    month: '1',
    day: '1',
    lunarLeap: false,
    clockHour: '10',
    clockMinute: '30',
    unknownTime: false,
    province: '',
    city: '',
    longitude: 120,
    gender: 'male',
    ...over,
  };
}

let pairs = 0;
const t0 = Date.now();
for (let year = 1900; year <= 2026; year++) {
  const leap = leapMonthOfLunarYear(year);
  const months: Array<[number, boolean]> = [[1, false], [7, false]];
  if (leap > 0) months.push([leap, true]);

  for (const [month, isLeap] of months) {
    const lastDay = lunarMonthDayCount(year, month, isLeap);
    assert.ok(lastDay === 29 || lastDay, `${year} 年 ${isLeap ? '闰' : ''}${month} 月天数异常`);

    for (const day of [1, lastDay]) {
      for (const [ch, cm] of [['12', '0'], ['23', '55']] as const) {
        const solar = lunarToSolar(year, month, day, isLeap)!;
        const lunarChart = generateChart(formToBirthInfo(makeForm({
          calendar: 'lunar', year: String(year), month: String(month), day: String(day),
          lunarLeap: isLeap, clockHour: ch, clockMinute: cm,
        }))!);
        const solarChart = generateChart(formToBirthInfo(makeForm({
          calendar: 'solar',
          year: String(solar.year), month: String(solar.month), day: String(solar.day),
          clockHour: ch, clockMinute: cm,
        }))!);
        assert.deepEqual(lunarChart, solarChart,
          `农历 ${year}/${isLeap ? '闰' : ''}${month}/${day} ${ch}:${cm} 双路径命盘不一致`);
        pairs++;
      }
    }
  }
}
console.log(`dual-path deepEqual 通过：${pairs} 对命盘（${Math.round((Date.now() - t0) / 1000)}s）`);
