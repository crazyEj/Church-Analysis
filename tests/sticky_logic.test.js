'use strict';

/**
 * tests/sticky_logic.test.js
 *
 * Assures no false churn flags and validates the cohort decay curve
 * math. These are pure-function tests against the statistics and
 * cohort-processing modules — no database required (the SQL-backed
 * functions in sticky.service.js and cohort.processor.js that hit
 * Postgres directly are exercised via integration tests against a
 * real/test database, outside the scope of this unit suite).
 */

const { computeChurnAnomalyScore } = require('../src/core/statistics/anomalyDetection');
const {
  buildCohortMatrixFromReturns,
  computeAggregateDecayCurve,
} = require('../src/modules/sticky_analytics/cohort.processor');

describe('computeChurnAnomalyScore', () => {
  test('assigns a high score to a strong habitual attendee who dropped to zero and has been gone a long time', () => {
    const score = computeChurnAnomalyScore({
      baselineFrequency: 0.9,
      currentRolling4WkRate: 0,
      weeksSinceLastCheckIn: 12,
    });
    expect(score).toBeGreaterThanOrEqual(70);
    expect(score).toBeLessThanOrEqual(100);
  });

  test('assigns a low score to someone who was already a sporadic attendee (weak baseline)', () => {
    const score = computeChurnAnomalyScore({
      baselineFrequency: 0.15,
      currentRolling4WkRate: 0,
      weeksSinceLastCheckIn: 5,
    });
    expect(score).toBeLessThan(35);
  });

  test('does NOT flag someone whose current rate matches their baseline (no false churn flag)', () => {
    const score = computeChurnAnomalyScore({
      baselineFrequency: 0.6,
      currentRolling4WkRate: 0.6,
      weeksSinceLastCheckIn: 0,
    });
    expect(score).toBe(0);
  });

  test('recency multiplier increases score for a longer absence, all else equal', () => {
    const shortAbsence = computeChurnAnomalyScore({
      baselineFrequency: 0.8,
      currentRolling4WkRate: 0,
      weeksSinceLastCheckIn: 4,
    });
    const longAbsence = computeChurnAnomalyScore({
      baselineFrequency: 0.8,
      currentRolling4WkRate: 0,
      weeksSinceLastCheckIn: 16,
    });
    expect(longAbsence).toBeGreaterThan(shortAbsence);
  });

  test('recency multiplier caps out — 20 weeks absent scores the same as 12 weeks absent', () => {
    const twelveWeeks = computeChurnAnomalyScore({
      baselineFrequency: 0.8,
      currentRolling4WkRate: 0,
      weeksSinceLastCheckIn: 12,
    });
    const twentyWeeks = computeChurnAnomalyScore({
      baselineFrequency: 0.8,
      currentRolling4WkRate: 0,
      weeksSinceLastCheckIn: 20,
    });
    expect(twentyWeeks).toBe(twelveWeeks);
  });

  test('score is always clamped between 0 and 100', () => {
    const score = computeChurnAnomalyScore({
      baselineFrequency: 1.5,
      currentRolling4WkRate: -0.5,
      weeksSinceLastCheckIn: 999,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

describe('buildCohortMatrixFromReturns', () => {
  const sampleReturns = [
    { individual_id: 1, cohort_week: '2026-01-04', week_1: true, week_2: true, week_3: true, week_6: true },
    { individual_id: 2, cohort_week: '2026-01-04', week_1: true, week_2: true, week_3: false, week_6: false },
    { individual_id: 3, cohort_week: '2026-01-04', week_1: true, week_2: false, week_3: false, week_6: false },
    { individual_id: 4, cohort_week: '2026-01-04', week_1: false, week_2: false, week_3: false, week_6: false },
    { individual_id: 5, cohort_week: '2026-01-11', week_1: true, week_2: true, week_3: true, week_6: false },
    { individual_id: 6, cohort_week: '2026-01-11', week_1: false, week_2: false, week_3: false, week_6: false },
  ];

  test('groups individuals into correct cohort buckets with correct sizes', () => {
    const matrix = buildCohortMatrixFromReturns(sampleReturns, 'week');
    expect(matrix).toHaveLength(2);
    expect(matrix[0].cohortPeriod).toBe('2026-01-04');
    expect(matrix[0].cohortSize).toBe(4);
    expect(matrix[1].cohortSize).toBe(2);
  });

  test('computes correct week-1 through week-6 counts and percentages for a cohort', () => {
    const matrix = buildCohortMatrixFromReturns(sampleReturns, 'week');
    const cohort1 = matrix[0];

    expect(cohort1.week1).toEqual({ count: 3, pct: 75 });
    expect(cohort1.week2).toEqual({ count: 2, pct: 50 });
    expect(cohort1.week3).toEqual({ count: 1, pct: 25 });
    expect(cohort1.week6).toEqual({ count: 1, pct: 25 });
  });

  test('produces a monotonically non-increasing decay pattern for a typical cohort', () => {
    const matrix = buildCohortMatrixFromReturns(sampleReturns, 'week');
    const cohort1 = matrix[0];
    expect(cohort1.week1.pct).toBeGreaterThanOrEqual(cohort1.week2.pct);
    expect(cohort1.week2.pct).toBeGreaterThanOrEqual(cohort1.week3.pct);
  });

  test('handles an empty cohort list without throwing', () => {
    expect(buildCohortMatrixFromReturns([], 'week')).toEqual([]);
  });
});

describe('computeAggregateDecayCurve', () => {
  test('aggregates across multiple cohorts into a single decay curve', () => {
    const matrix = [
      {
        cohortPeriod: '2026-01-04',
        cohortSize: 4,
        week1: { count: 3, pct: 75 },
        week2: { count: 2, pct: 50 },
        week3: { count: 1, pct: 25 },
        week6: { count: 1, pct: 25 },
      },
      {
        cohortPeriod: '2026-01-11',
        cohortSize: 2,
        week1: { count: 1, pct: 50 },
        week2: { count: 1, pct: 50 },
        week3: { count: 1, pct: 50 },
        week6: { count: 0, pct: 0 },
      },
    ];

    const result = computeAggregateDecayCurve(matrix);
    expect(result.totalGuests).toBe(6);
    expect(result.decayCurve.week1).toBeCloseTo(66.7, 1);
    expect(result.decayCurve.week6).toBeCloseTo(16.7, 1);
  });

  test('returns zeroed curve for an empty matrix without dividing by zero', () => {
    const result = computeAggregateDecayCurve([]);
    expect(result.totalGuests).toBe(0);
    expect(result.decayCurve).toEqual({ week1: 0, week2: 0, week3: 0, week6: 0 });
  });
});