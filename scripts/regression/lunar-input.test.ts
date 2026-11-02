/**
 * 农历起盘链路回归：
 * 1) 历法锚点——春节、闰月换算与 lunar-javascript 表一致
 * 2) formToBirthInfo 农历输入 = 先换公历再走既有规则（含晚子时换日）
 * 3) 不存在的农历日期（无该闰月 / 当月无此日）必须返回 null，绝不静默滚动
 * 4) 分享链接编解码保留历法与闰月状态
 */
import assert from 'node:assert/strict';
import { lunarToSolar, lunarMonthDayCount, leapMonthOfLunarYear } from '../../lib/ziwei/lunar-solar';
import { formToBirthInfo, formToSearchParams, searchParamsToForm } from '../../lib/ziwei/share';
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

// ── 1. 历法锚点 ────────────────────────────────────────────
// 千禧年春节：农历 2000 年正月初一 = 公历 2000-02-05
assert.deepEqual(lunarToSolar(2000, 1, 1), { year: 2000, month: 2, day: 5 });

// 庚子年闰四月存在；两个公开锚点：端午 2020-06-25（五月初五）、闰四月初一 = 2020-05-23
// （2020-06-21 夏至日环食必为朔日 = 五月初一，倒推闰四月始于 05-23）
assert.equal(leapMonthOfLunarYear(2020), 4);
assert.deepEqual(lunarToSolar(2020, 4, 1, true), { year: 2020, month: 5, day: 23 });
assert.deepEqual(lunarToSolar(2020, 5, 5), { year: 2020, month: 6, day: 25 });

// 2021 辛丑年无闰月
assert.equal(leapMonthOfLunarYear(2021), 0);

// 每个月天数只能是 29/30（抽查数年）
for (const year of [1900, 1949, 2000, 2020, 2026]) {
  for (let month = 1; month <= 12; month++) {
    const cnt = lunarMonthDayCount(year, month);
    assert.ok(cnt === 29 || cnt === 30, `农历 ${year}-${month} 天数异常：${cnt}`);
  }
}

// ── 2. 两条输入路径结果一致（含闰月） ─────────────────────
for (const [ly, lm, leap] of [[2000, 1, false], [2020, 4, false], [2020, 4, true], [2023, 2, true]] as const) {
  if (leap) assert.equal(leapMonthOfLunarYear(ly), lm, `测试用例农历 ${ly} 年闰${lm} 月与闰月表不符`);

  const dayCount = lunarMonthDayCount(ly, lm, leap);
  for (const day of [1, Math.floor(dayCount / 2), dayCount]) {
    for (const [clockHour, clockMinute] of [['10', '30'], ['23', '55'], ['0', '10']] as const) {
      const solar = lunarToSolar(ly, lm, day, leap)!;
      const viaLunar = formToBirthInfo(makeForm({
        calendar: 'lunar', year: String(ly), month: String(lm), day: String(day),
        lunarLeap: leap, clockHour, clockMinute,
      }))!;
      const viaSolar = formToBirthInfo(makeForm({
        calendar: 'solar',
        year: String(solar.year), month: String(solar.month), day: String(solar.day),
        clockHour, clockMinute,
      }))!;
      assert.deepEqual(
        { y: viaLunar.year, m: viaLunar.month, d: viaLunar.day, h: viaLunar.hour },
        { y: viaSolar.year, m: viaSolar.month, d: viaSolar.day, h: viaSolar.hour },
        `农历 ${ly}/${leap ? '闰' : ''}${lm}/${day} ${clockHour}:${clockMinute} 与公历路径结果不一致`,
      );
    }
  }
}

// ── 3. 晚子时作用于换算后的公历日 ─────────────────────────
// 农历 2000 年正月初一（公历 2000-02-05）23:30 → 排盘日 2000-02-06
const lateZi = formToBirthInfo(makeForm({
  calendar: 'lunar', year: '2000', month: '1', day: '1', clockHour: '23', clockMinute: '30',
}))!;
assert.deepEqual(
  { year: lateZi.year, month: lateZi.month, day: lateZi.day },
  { year: 2000, month: 2, day: 6 },
);

// ── 4. 非法农历日期 → null，绝不静默滚动 ──────────────────
assert.equal(formToBirthInfo(makeForm({ calendar: 'lunar', year: '2021', month: '4', day: '1', lunarLeap: true })), null, '2021 年没有闰四月');
const m29 = lunarMonthDayCount(2000, 1); // 2000 年正月天数
if (m29 === 29) {
  assert.equal(formToBirthInfo(makeForm({ calendar: 'lunar', year: '2000', month: '1', day: '30' })), null, '正月没有三十');
}
assert.equal(formToBirthInfo(makeForm({ calendar: 'lunar', year: '1899', month: '1', day: '1' })), null, '年份越界');
assert.equal(formToBirthInfo(makeForm({ calendar: 'lunar', year: '2051', month: '1', day: '1' })), null, '年份越界');

// ── 5. 分享链接 round-trip 保留农历 + 闰月 ────────────────
const lunarForm = makeForm({ calendar: 'lunar', year: '2020', month: '4', day: '15', lunarLeap: true });
const restored = searchParamsToForm(formToSearchParams(lunarForm))!;
assert.equal(restored.calendar, 'lunar');
assert.equal(restored.lunarLeap, true);
assert.equal(restored.year, '2020');
assert.equal(restored.month, '4');
assert.equal(restored.day, '15');

// 公历表单不带历法参数（老链接兼容）
const solarParams = formToSearchParams(makeForm({ year: '1990', month: '6', day: '4' }));
assert.equal(solarParams.get('cal'), null);
const restoredSolar = searchParamsToForm(solarParams)!;
assert.equal(restoredSolar.calendar, 'solar');
assert.equal(restoredSolar.lunarLeap, false);

console.log('lunar input regression passed');
