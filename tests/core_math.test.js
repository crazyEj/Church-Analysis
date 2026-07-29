'use strict';

/**
 * tests/core_math.test.js
 *
 * Ensures DAX-equivalent calculations match expected raw-math results.
 * Covers: trailing rolling averages, Easter/Thanksgiving computation,
 * and Easter-aligned YoY week matching. These are pure-function tests —
 * no database required.
 */

const { computeTrailingRollingAverage } = require('../src/core/aggregation/rollingAverage');
const {
  computeEasterSunday,
  computeThanksgiving,
  getEasterAlignedMatchingWeek,
  getWeekEndingSunday,
  daysFromEaster,
  isHolidayAdjacent,
} = require('../src/shared/utils/liturgicalCalendar');
const { linearTrendSlope, meanAndStdDev } = require('../src/core/statistics/anomalyDetection');
const { classifyTrend, detectMovingAverageCrossovers } = require('../src/core/statistics/trendAlgorithms');

describe('computeTrailingRollingAverage', () => {
  test('returns null rolling average until window is full', () => {
    const series = [10, 20, 30].map((count, i) => ({ weekEnding: new Date(2026, 0, 1 + i * 7), count }));
    const result = computeTrailingRollingAverage(series, 4);
    expect(result.every((r) => r.rollingAverage === null)).toBe(true);
  });

  test('computes correct 4-week trailing average once window fills', () => {
    const counts = [100, 110, 90, 120, 130]; // 5 weeks
    const series = counts.map((count, i) => ({ weekEnding: new Date(2026, 0, 1 + i * 7), count }));
    const result = computeTrailingRollingAverage(series, 4);

    // Week 4 (index 3): avg(100,110,90,120) = 105
    expect(result[3].rollingAverage).toBe(105);
    // Week 5 (index 4): avg(110,90,120,130) = 112.5
    expect(result[4].rollingAverage).toBe(112.5);
  });

  test('throws on invalid windowSize', () => {
    expect(() => computeTrailingRollingAverage([], 0)).toThrow(RangeError);
    expect(() => computeTrailingRollingAverage([], -3)).toThrow(RangeError);
  });
});

describe('computeEasterSunday', () => {
  // Known reference dates (Western/Gregorian Easter) for validation.
  test('matches known historical Easter Sundays', () => {
    expect(computeEasterSunday(2024).toISOString().slice(0, 10)).toBe('2024-03-31');
    expect(computeEasterSunday(2025).toISOString().slice(0, 10)).toBe('2025-04-20');
    expect(computeEasterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
  });
});

describe('computeThanksgiving', () => {
  test('matches known historical Thanksgiving dates (4th Thursday of November)', () => {
    expect(computeThanksgiving(2024).toISOString().slice(0, 10)).toBe('2024-11-28');
    expect(computeThanksgiving(2025).toISOString().slice(0, 10)).toBe('2025-11-27');
    expect(computeThanksgiving(2026).toISOString().slice(0, 10)).toBe('2026-11-26');
  });
});

describe('Easter-aligned YoY week matching', () => {
  test('a week aligned exactly on Easter Sunday maps to Easter Sunday next year', () => {
    const easter2025 = computeEasterSunday(2025); // 2025-04-20
    const matched = getEasterAlignedMatchingWeek(easter2025, 2026);
    const easter2026 = computeEasterSunday(2026); // 2026-04-05
    expect(matched.toISOString().slice(0, 10)).toBe(easter2026.toISOString().slice(0, 10));
  });

  test('a week two weeks after Easter maps to two weeks after Easter the following year', () => {
    const easter2025 = computeEasterSunday(2025);
    const twoWeeksAfter = new Date(easter2025);
    twoWeeksAfter.setUTCDate(twoWeeksAfter.getUTCDate() + 14);

    const matched = getEasterAlignedMatchingWeek(twoWeeksAfter, 2026);
    const easter2026 = computeEasterSunday(2026);
    const expected = new Date(easter2026);
    expected.setUTCDate(expected.getUTCDate() + 14);

    expect(matched.toISOString().slice(0, 10)).toBe(expected.toISOString().slice(0, 10));
  });

  test('naive ISO-week matching would misalign across the Easter shift (sanity check)', () => {
    // Easter 2025 is April 20; Easter 2026 is April 5 — a 15 day shift.
    // Confirms the two years genuinely have different Easter offsets,
    // which is the entire premise for why offset-based matching matters.
    const e2025 = computeEasterSunday(2025).getTime();
    const e2026 = computeEasterSunday(2026).getTime();
    const diffDays = Math.abs(e2025 - e2026) / 86400000;
    expect(diffDays).toBeGreaterThan(0);
  });
});

describe('daysFromEaster / getWeekEndingSunday', () => {
  test('daysFromEaster returns 0 for Easter Sunday itself', () => {
    const easter = computeEasterSunday(2026);
    expect(daysFromEaster(easter)).toBe(0);
  });

  test('getWeekEndingSunday normalizes a mid-week date to the upcoming Sunday', () => {
    // 2026-04-08 is a Wednesday
    const wednesday = new Date(Date.UTC(2026, 3, 8));
    const sunday = getWeekEndingSunday(wednesday);
    expect(sunday.getUTCDay()).toBe(0);
    expect(sunday.getTime()).toBeGreaterThanOrEqual(wednesday.getTime());
  });
});

describe('isHolidayAdjacent', () => {
  test('flags Easter Sunday itself as holiday-adjacent', () => {
    const easter = computeEasterSunday(2026);
    const { isAnomalousWeek, nearestAnchor } = isHolidayAdjacent(easter);
    expect(isAnomalousWeek).toBe(true);
    expect(nearestAnchor).toBe('easter');
  });

  test('does not flag an ordinary mid-summer week', () => {
    const midJuly = new Date(Date.UTC(2026, 6, 12));
    const { isAnomalousWeek } = isHolidayAdjacent(midJuly);
    expect(isAnomalousWeek).toBe(false);
  });
});

describe('statistics primitives', () => {
  test('meanAndStdDev computes correctly for a known set', () => {
    const { mean, stdDev } = meanAndStdDev([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(mean).toBe(5);
    expect(stdDev).toBeCloseTo(2, 5);
  });

  test('linearTrendSlope is positive for a rising series', () => {
    expect(linearTrendSlope([10, 20, 30, 40])).toBeGreaterThan(0);
  });

  test('linearTrendSlope is negative for a declining series', () => {
    expect(linearTrendSlope([40, 30, 20, 10])).toBeLessThan(0);
  });

  test('linearTrendSlope is zero for a flat series', () => {
    expect(linearTrendSlope([15, 15, 15, 15])).toBe(0);
  });
});

describe('classifyTrend', () => {
  test('classifies a clearly rising series as rising', () => {
    expect(classifyTrend([100, 110, 125, 140, 160]).label).toBe('rising');
  });

  test('classifies a clearly declining series as declining', () => {
    expect(classifyTrend([160, 140, 125, 110, 100]).label).toBe('declining');
  });

  test('classifies a near-flat series as stable', () => {
    expect(classifyTrend([100, 101, 99, 100, 100]).label).toBe('stable');
  });
});

describe('detectMovingAverageCrossovers', () => {
  test('detects a bearish crossover when fast avg dips below slow avg', () => {
    const series = [
      { weekEnding: new Date(2026, 0, 4), rolling4wk: 120, rolling12wk: 100 },
      { weekEnding: new Date(2026, 0, 11), rolling4wk: 90, rolling12wk: 100 },
    ];
    const crossovers = detectMovingAverageCrossovers(series);
    expect(crossovers).toHaveLength(1);
    expect(crossovers[0].crossoverType).toBe('bearish');
  });

  test('ignores rows with incomplete rolling data', () => {
    const series = [
      { weekEnding: new Date(2026, 0, 4), rolling4wk: null, rolling12wk: null },
      { weekEnding: new Date(2026, 0, 11), rolling4wk: 90, rolling12wk: 100 },
    ];
    expect(detectMovingAverageCrossovers(series)).toHaveLength(0);
  });
});