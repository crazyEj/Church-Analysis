'use strict';

/**
 * src/core/aggregation/momGrowth.js
 *
 * Month-over-month growth measure, computed server-side with LAG()
 * window functions — the SQL-native equivalent of a Power BI
 * `[MoM Growth %] := DIVIDE([This Month] - [Last Month], [Last Month])` measure.
 */

const { query } = require('../../../config/database');

/**
 * @param {Object} params
 * @param {Date} params.startDate
 * @param {Date} params.endDate
 * @param {number|null} [params.campusId=null]
 * @returns {Promise<Array<{month: Date, monthly_active_attendees: number, prior_month: number|null, absolute_change: number|null, percent_change: number|null}>>}
 */
async function getMonthlyActiveWithGrowth({ startDate, endDate, campusId = null }) {
  const sql = `
    WITH monthly_counts AS (
      SELECT
        date_trunc('month', ci.checkin_date)::date AS month,
        COUNT(DISTINCT ci.individual_id) AS monthly_active_attendees
      FROM check_ins ci
      WHERE ci.checkin_date BETWEEN $1 AND $2
        AND ($3::int IS NULL OR ci.campus_id = $3)
      GROUP BY 1
    )
    SELECT
      month,
      monthly_active_attendees,
      LAG(monthly_active_attendees) OVER (ORDER BY month) AS prior_month,
      monthly_active_attendees - LAG(monthly_active_attendees) OVER (ORDER BY month) AS absolute_change,
      ROUND(
        CASE
          WHEN LAG(monthly_active_attendees) OVER (ORDER BY month) IS NULL
            OR LAG(monthly_active_attendees) OVER (ORDER BY month) = 0 THEN NULL
          ELSE (
            (monthly_active_attendees - LAG(monthly_active_attendees) OVER (ORDER BY month))::numeric
            / LAG(monthly_active_attendees) OVER (ORDER BY month)
          ) * 100
        END, 2
      ) AS percent_change
    FROM monthly_counts
    ORDER BY month;
  `;

  const { rows } = await query(sql, [startDate, endDate, campusId]);
  return rows;
}

module.exports = { getMonthlyActiveWithGrowth };