'use strict';

/**
 * src/modules/sticky_analytics/cohort.processor.js
 *
 * "New Visitor Assimilation Pipeline" — builds a cohort retention
 * matrix keyed by first-ever visit date, then tracks whether each
 * cohort member returned at fixed checkpoints (Week 1, 2, 3, 6). This
 * is the Power BI "DAX cohort matrix" pattern: rows = cohort period,
 * columns = period offset, cell = retained count/percentage.
 */

const { query } = require('../../../config/database');

const CHECKPOINT_WEEKS = Object.freeze([1, 2, 3, 6]);

/**
 * Identify cohorts: for every individual whose first-ever check-in
 * (across all history, not just this pipeline's window) falls inside
 * [cohortStartDate, cohortEndDate], determine which of the checkpoint
 * weeks (1, 2, 3, 6 weeks after their first visit) they returned for.
 *
 * @param {Object} params
 * @param {Date} params.cohortStartDate - earliest first-visit date to include
 * @param {Date} params.cohortEndDate - latest first-visit date to include
 * @returns {Promise<Array<{individual_id: number, cohort_week: Date, week_1: boolean, week_2: boolean, week_3: boolean, week_6: boolean}>>}
 */
async function getIndividualCohortReturns({ cohortStartDate, cohortEndDate }) {
  const sql = `
    WITH cohort_individuals AS (
      SELECT id AS individual_id, first_visit_date AS cohort_week
      FROM individuals
      WHERE first_visit_date BETWEEN $1 AND $2
    ),
    checkpoint_flags AS (
      SELECT
        ci.individual_id,
        cw.cohort_week,
        checkpoint.weeks_offset,
        EXISTS (
          SELECT 1 FROM check_ins c
          WHERE c.individual_id = ci.individual_id
            AND c.checkin_date BETWEEN
              (cw.cohort_week + ((checkpoint.weeks_offset * 7) - 3) * interval '1 day')
              AND
              (cw.cohort_week + ((checkpoint.weeks_offset * 7) + 3) * interval '1 day')
        ) AS returned
      FROM cohort_individuals ci
      JOIN cohort_individuals cw ON cw.individual_id = ci.individual_id
      CROSS JOIN (VALUES (1), (2), (3), (6)) AS checkpoint(weeks_offset)
    )
    SELECT
      individual_id,
      cohort_week,
      BOOL_OR(CASE WHEN weeks_offset = 1 THEN returned END) AS week_1,
      BOOL_OR(CASE WHEN weeks_offset = 2 THEN returned END) AS week_2,
      BOOL_OR(CASE WHEN weeks_offset = 3 THEN returned END) AS week_3,
      BOOL_OR(CASE WHEN weeks_offset = 6 THEN returned END) AS week_6
    FROM checkpoint_flags
    GROUP BY individual_id, cohort_week
    ORDER BY cohort_week, individual_id;
  `;

  const { rows } = await query(sql, [cohortStartDate, cohortEndDate]);
  return rows;
}

/**
 * Aggregate individual-level checkpoint flags into a cohort matrix:
 * one row per cohort period (calendar week of first visit), with
 * counts and retention percentages at each checkpoint.
 *
 * @param {Array<Object>} individualReturns - output of getIndividualCohortReturns
 * @param {'week'|'month'} [groupBy='week'] - cohort bucketing granularity
 * @returns {Array<{cohortPeriod: string, cohortSize: number, week1: {count:number, pct:number}, week2: {...}, week3: {...}, week6: {...}}>}
 */
function buildCohortMatrixFromReturns(individualReturns, groupBy = 'week') {
  const buckets = new Map();

  for (const row of individualReturns) {
    const cohortDate = new Date(row.cohort_week);
    const bucketKey =
      groupBy === 'month'
        ? `${cohortDate.getUTCFullYear()}-${String(cohortDate.getUTCMonth() + 1).padStart(2, '0')}`
        : cohortDate.toISOString().slice(0, 10);

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, {
        cohortPeriod: bucketKey,
        cohortSize: 0,
        checkpointCounts: { week_1: 0, week_2: 0, week_3: 0, week_6: 0 },
      });
    }

    const bucket = buckets.get(bucketKey);
    bucket.cohortSize += 1;
    for (const wk of ['week_1', 'week_2', 'week_3', 'week_6']) {
      if (row[wk]) bucket.checkpointCounts[wk] += 1;
    }
  }

  return Array.from(buckets.values())
    .sort((a, b) => (a.cohortPeriod < b.cohortPeriod ? -1 : 1))
    .map((bucket) => {
      const pct = (count) => (bucket.cohortSize === 0 ? 0 : Number(((count / bucket.cohortSize) * 100).toFixed(1)));
      return {
        cohortPeriod: bucket.cohortPeriod,
        cohortSize: bucket.cohortSize,
        week1: { count: bucket.checkpointCounts.week_1, pct: pct(bucket.checkpointCounts.week_1) },
        week2: { count: bucket.checkpointCounts.week_2, pct: pct(bucket.checkpointCounts.week_2) },
        week3: { count: bucket.checkpointCounts.week_3, pct: pct(bucket.checkpointCounts.week_3) },
        week6: { count: bucket.checkpointCounts.week_6, pct: pct(bucket.checkpointCounts.week_6) },
      };
    });
}

/**
 * Compute the aggregate decay curve across ALL cohorts in range —
 * i.e. "of all first-time guests in this period, what % typically
 * come back at week 1 / 2 / 3 / 6" — the single decay curve pastoral
 * staff use to gauge assimilation pipeline health overall.
 *
 * @param {Array<Object>} cohortMatrix - output of buildCohortMatrixFromReturns
 * @returns {{totalGuests: number, decayCurve: {week1: number, week2: number, week3: number, week6: number}}}
 */
function computeAggregateDecayCurve(cohortMatrix) {
  const totals = cohortMatrix.reduce(
    (acc, row) => {
      acc.totalGuests += row.cohortSize;
      acc.week1 += row.week1.count;
      acc.week2 += row.week2.count;
      acc.week3 += row.week3.count;
      acc.week6 += row.week6.count;
      return acc;
    },
    { totalGuests: 0, week1: 0, week2: 0, week3: 0, week6: 0 }
  );

  const pct = (count) => (totals.totalGuests === 0 ? 0 : Number(((count / totals.totalGuests) * 100).toFixed(1)));

  return {
    totalGuests: totals.totalGuests,
    decayCurve: {
      week1: pct(totals.week1),
      week2: pct(totals.week2),
      week3: pct(totals.week3),
      week6: pct(totals.week6),
    },
  };
}

/**
 * Full pipeline entrypoint: fetch, build matrix, and compute the
 * aggregate decay curve in one call.
 *
 * @param {Object} params
 * @param {Date} params.cohortStartDate
 * @param {Date} params.cohortEndDate
 * @param {'week'|'month'} [params.groupBy='week']
 * @returns {Promise<{cohortMatrix: Array<Object>, aggregate: Object}>}
 */
async function runNewVisitorAssimilationPipeline({ cohortStartDate, cohortEndDate, groupBy = 'week' }) {
  const individualReturns = await getIndividualCohortReturns({ cohortStartDate, cohortEndDate });
  const cohortMatrix = buildCohortMatrixFromReturns(individualReturns, groupBy);
  const aggregate = computeAggregateDecayCurve(cohortMatrix);
  return { cohortMatrix, aggregate };
}

module.exports = {
  CHECKPOINT_WEEKS,
  getIndividualCohortReturns,
  buildCohortMatrixFromReturns,
  computeAggregateDecayCurve,
  runNewVisitorAssimilationPipeline,
};