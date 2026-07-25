'use strict';

/**
 * src/core/aggregation/rollingAverage.js
 *
 * Power BI-equivalent trailing rolling average logic. Provides both:
 *   1. A pure-JS function for computing rolling averages over an
 *      already-fetched weekly series (used by services that need to
 *      post-process results, e.g. churn scoring).
 *   2. A parameterized SQL builder using window functions, so the
 *      database does the heavy lifting for large date ranges (the
 *      "DAX-equivalent" measure, evaluated server-side).
 */

const { query } = require('../../../config/database');

/**
 * Compute a trailing rolling average over a chronologically-ordered
 * array of { weekEnding: Date, count: number } points.
 *
 * @param {Array<{weekEnding: Date, count: number}>} weeklySeries - ascending by weekEnding
 * @param {number} windowSize - number of trailing weeks to average (e.g. 4 or 12)
 * @returns {Array<{weekEnding: Date, count: number, rollingAverage: number|null}>}
 *   rollingAverage is null until `windowSize` data points have accumulated.
 */
function computeTrailingRollingAverage(weeklySeries, windowSize) {
  if (!Array.isArray(weeklySeries)) {
    throw new TypeError('weeklySeries must be an array');
  }
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new RangeError('windowSize must be a positive integer');
  }

  return weeklySeries.map((point, index) => {
    if (index + 1 < windowSize) {
      return { ...point, rollingAverage: null };
    }
    const windowSlice = weeklySeries.slice(index - windowSize + 1, index + 1);
    const sum = windowSlice.reduce((acc, p) => acc + p.count, 0);
    return { ...point, rollingAverage: Number((sum / windowSize).toFixed(2)) };
  });
}

/**
 * Fetch weekly unique attendance counts plus trailing rolling averages
 * (both 4-week and 12-week) directly from Postgres using a window
 * function, scoped optionally to a campus.
 *
 * This is the SQL-native equivalent of a Power BI measure such as:
 *   Rolling4WkAvg := AVERAGEX(DATESINPERIOD('Date'[Date], LASTDATE('Date'[Date]), -4, WEEK), [WeeklyAttendance])
 *
 * @param {Object} params
 * @param {Date} params.startDate
 * @param {Date} params.endDate
 * @param {number} [params.campusId] - optional campus filter
 * @returns {Promise<Array<{week_ending: Date, weekly_attendance: number, rolling_4wk_avg: number, rolling_12wk_avg: number}>>}
 */
async function getWeeklyAttendanceWithRollingAverages({ startDate, endDate, campusId = null }) {
  const sql = `
    WITH weekly_counts AS (
      SELECT
        (date_trunc('week', ci.checkin_date::timestamp) + interval '6 days')::date AS week_ending,
        COUNT(DISTINCT ci.individual_id) AS weekly_attendance
      FROM check_ins ci
      WHERE ci.checkin_date BETWEEN $1 AND $2
        AND ($3::int IS NULL OR ci.campus_id = $3)
      GROUP BY 1
    )
    SELECT
      week_ending,
      weekly_attendance,
      ROUND(
        AVG(weekly_attendance) OVER (
          ORDER BY week_ending
          ROWS BETWEEN 3 PRECEDING AND CURRENT ROW
        ), 2
      ) AS rolling_4wk_avg,
      ROUND(
        AVG(weekly_attendance) OVER (
          ORDER BY week_ending
          ROWS BETWEEN 11 PRECEDING AND CURRENT ROW
        ), 2
      ) AS rolling_12wk_avg
    FROM weekly_counts
    ORDER BY week_ending;
  `;

  const { rows } = await query(sql, [startDate, endDate, campusId]);
  return rows;
}

module.exports = {
  computeTrailingRollingAverage,
  getWeeklyAttendanceWithRollingAverages,
};