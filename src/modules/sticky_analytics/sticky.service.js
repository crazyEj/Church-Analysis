'use strict';

/**
 * src/modules/sticky_analytics/sticky.service.js
 *
 * Core Sticky Analytics business logic:
 *   1. Stickiness Ratio — engagement density measure (weekly regulars
 *      as a share of the broader monthly-active population).
 *   2. Pastoral Churn Alert — per-individual baseline-vs-current drop
 *      detection with an anomaly score, for care team follow-up.
 *   3. Cohort/assimilation pipeline is implemented in cohort.processor.js
 *      and re-exported here for a single service-layer entrypoint.
 */

const { query } = require('../../../config/database');
const { computeChurnAnomalyScore } = require('../../core/statistics/anomalyDetection');
const {
  runNewVisitorAssimilationPipeline,
} = require('./cohort.processor');

/**
 * Stickiness Ratio = Unique Weekly Attendees (avg across the weeks in
 * the month) / Monthly Active Attendees (distinct individuals with at
 * least one check-in in the month).
 *
 * @param {Object} params
 * @param {number} params.year
 * @param {number} params.month - 1-12
 * @param {number|null} [params.campusId=null]
 * @returns {Promise<{year: number, month: number, avgUniqueWeeklyAttendees: number, monthlyActiveAttendees: number, stickinessRatio: number}>}
 */
async function calculateStickinessRatio({ year, month, campusId = null }) {
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month, 0)); // last day of month

  const sql = `
    WITH month_checkins AS (
      SELECT individual_id, checkin_date,
             (date_trunc('week', checkin_date::timestamp))::date AS week_start
      FROM check_ins
      WHERE checkin_date BETWEEN $1 AND $2
        AND ($3::int IS NULL OR campus_id = $3)
    ),
    weekly_uniques AS (
      SELECT week_start, COUNT(DISTINCT individual_id) AS weekly_unique
      FROM month_checkins
      GROUP BY week_start
    ),
    monthly_active AS (
      SELECT COUNT(DISTINCT individual_id) AS monthly_active
      FROM month_checkins
    )
    SELECT
      (SELECT ROUND(AVG(weekly_unique), 2) FROM weekly_uniques) AS avg_unique_weekly_attendees,
      (SELECT monthly_active FROM monthly_active) AS monthly_active_attendees;
  `;

  const { rows } = await query(sql, [monthStart, monthEnd, campusId]);
  const avgUniqueWeeklyAttendees = Number(rows[0]?.avg_unique_weekly_attendees || 0);
  const monthlyActiveAttendees = Number(rows[0]?.monthly_active_attendees || 0);

  const stickinessRatio =
    monthlyActiveAttendees === 0 ? 0 : Number((avgUniqueWeeklyAttendees / monthlyActiveAttendees).toFixed(3));

  return { year, month, avgUniqueWeeklyAttendees, monthlyActiveAttendees, stickinessRatio };
}

/**
 * Stickiness Ratio trend across a range of months — for charting
 * engagement density over time rather than a single snapshot.
 *
 * @param {Object} params
 * @param {number} params.startYear
 * @param {number} params.startMonth
 * @param {number} params.endYear
 * @param {number} params.endMonth
 * @param {number|null} [params.campusId=null]
 * @returns {Promise<Array<Object>>}
 */
async function getStickinessRatioTrend({ startYear, startMonth, endYear, endMonth, campusId = null }) {
  const results = [];
  let year = startYear;
  let month = startMonth;

  while (year < endYear || (year === endYear && month <= endMonth)) {
    // eslint-disable-next-line no-await-in-loop
    const monthResult = await calculateStickinessRatio({ year, month, campusId });
    results.push(monthResult);

    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return results;
}

/**
 * "Pastoral Churn Alert" — identify individuals who had a strong
 * historical attendance habit (baseline frequency > 0.5 over the
 * trailing 6 months, i.e. attending at least bi-weekly on average) but
 * whose rolling 4-week attendance has fallen to zero.
 *
 * Baseline frequency is computed as:
 *   (distinct weeks attended in trailing 6 months) / (26 weeks)
 *
 * @param {Object} params
 * @param {Date} [params.asOfDate=new Date()] - reference date ("today")
 * @param {number|null} [params.campusId=null]
 * @param {number} [params.baselineThreshold=0.5] - minimum baseline frequency to qualify as "had a real habit"
 * @returns {Promise<Array<{individualId: number, firstName: string, lastName: string, baselineFrequency: number, weeksSinceLastCheckIn: number, anomalyScore: number}>>}
 */
async function getPastoralChurnAlerts({ asOfDate = new Date(), campusId = null, baselineThreshold = 0.5 } = {}) {
  const sixMonthsAgo = new Date(asOfDate);
  sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);

  const fourWeeksAgo = new Date(asOfDate);
  fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);

  const sql = `
    WITH relevant_individuals AS (
      SELECT DISTINCT ci.individual_id
      FROM check_ins ci
      WHERE ci.checkin_date BETWEEN $1 AND $4
        AND ($3::int IS NULL OR ci.campus_id = $3)
    ),
    baseline AS (
      SELECT
        ri.individual_id,
        COUNT(DISTINCT date_trunc('week', ci.checkin_date::timestamp)) AS weeks_attended_baseline
      FROM relevant_individuals ri
      LEFT JOIN check_ins ci
        ON ci.individual_id = ri.individual_id
        AND ci.checkin_date BETWEEN $1 AND $4
        AND ($3::int IS NULL OR ci.campus_id = $3)
      GROUP BY ri.individual_id
    ),
    rolling_recent AS (
      SELECT
        ri.individual_id,
        COUNT(DISTINCT date_trunc('week', ci.checkin_date::timestamp)) AS weeks_attended_recent,
        MAX(ci.checkin_date) AS last_checkin_date
      FROM relevant_individuals ri
      LEFT JOIN check_ins ci
        ON ci.individual_id = ri.individual_id
        AND ($3::int IS NULL OR ci.campus_id = $3)
      GROUP BY ri.individual_id
    ),
    recent_4wk AS (
      SELECT
        ri.individual_id,
        COUNT(DISTINCT date_trunc('week', ci.checkin_date::timestamp)) AS weeks_attended_last_4wk
      FROM relevant_individuals ri
      LEFT JOIN check_ins ci
        ON ci.individual_id = ri.individual_id
        AND ci.checkin_date BETWEEN $2 AND $4
        AND ($3::int IS NULL OR ci.campus_id = $3)
      GROUP BY ri.individual_id
    )
    SELECT
      i.id AS individual_id,
      i.first_name,
      i.last_name,
      b.weeks_attended_baseline,
      r4.weeks_attended_last_4wk,
      rr.last_checkin_date,
      ($4::date - rr.last_checkin_date) AS days_since_last_checkin
    FROM individuals i
    JOIN baseline b ON b.individual_id = i.id
    JOIN recent_4wk r4 ON r4.individual_id = i.id
    JOIN rolling_recent rr ON rr.individual_id = i.id
    WHERE (b.weeks_attended_baseline::numeric / 26.0) > $5
      AND r4.weeks_attended_last_4wk = 0
    ORDER BY b.weeks_attended_baseline DESC;
  `;

  const { rows } = await query(sql, [sixMonthsAgo, fourWeeksAgo, campusId, asOfDate, baselineThreshold]);

  return rows.map((row) => {
    const baselineFrequency = Number(row.weeks_attended_baseline) / 26;
    const weeksSinceLastCheckIn = row.days_since_last_checkin != null ? Math.floor(Number(row.days_since_last_checkin) / 7) : 26;

    const anomalyScore = computeChurnAnomalyScore({
      baselineFrequency,
      currentRolling4WkRate: 0,
      weeksSinceLastCheckIn,
    });

    return {
      individualId: row.individual_id,
      firstName: row.first_name,
      lastName: row.last_name,
      baselineFrequency: Number(baselineFrequency.toFixed(3)),
      lastCheckinDate: row.last_checkin_date,
      weeksSinceLastCheckIn,
      anomalyScore,
    };
  }).sort((a, b) => b.anomalyScore - a.anomalyScore);
}

/**
 * Re-exported convenience wrapper around the New Visitor Assimilation
 * Pipeline so `sticky.controller.js` has a single service module to
 * import from.
 *
 * @param {Object} params
 * @param {Date} params.cohortStartDate
 * @param {Date} params.cohortEndDate
 * @param {'week'|'month'} [params.groupBy='week']
 */
async function getNewVisitorAssimilation(params) {
  return runNewVisitorAssimilationPipeline(params);
}

module.exports = {
  calculateStickinessRatio,
  getStickinessRatioTrend,
  getPastoralChurnAlerts,
  getNewVisitorAssimilation,
};