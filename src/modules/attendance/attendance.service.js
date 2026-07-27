'use strict';

/**
 * src/modules/attendance/attendance.service.js
 *
 * Core Attendance Analytics business logic. This is the
 * Power BI-equivalent tabular engine for attendance: unique counting
 * (not raw check-in row counting — a person checking into 3 kids
 * classes counts once), multi-dimensional slicing, and time
 * intelligence (rolling averages + Easter-aware YoY).
 */

const { query } = require('../../../config/database');
const {
  getWeeklyAttendanceWithRollingAverages,
} = require('../../core/aggregation/rollingAverage');
const {
  getYoYMatchingWeekComparison,
  getYoYMatchingWeekSeries,
} = require('../../core/aggregation/yoyComparison');

/**
 * Total UNIQUE weekend attendance for a date range, counting each
 * individual once regardless of how many services/classes they
 * checked into that weekend. Optional slices narrow the population
 * before the distinct-count is taken.
 *
 * @param {Object} filters
 * @param {Date} filters.startDate
 * @param {Date} filters.endDate
 * @param {number|null} [filters.campusId]
 * @param {string|null} [filters.serviceTime]
 * @param {string|null} [filters.attendanceType] - 'in_person' | 'online'
 * @param {string|null} [filters.ageBracket] - 'kids' | 'youth' | 'adults'
 * @returns {Promise<{totalUniqueAttendance: number, filters: Object}>}
 */
async function getUniqueWeekendAttendance(filters) {
  const { startDate, endDate, campusId = null, serviceTime = null, attendanceType = null, ageBracket = null } = filters;

  const sql = `
    SELECT COUNT(DISTINCT individual_id) AS total_unique_attendance
    FROM check_ins
    WHERE checkin_date BETWEEN $1 AND $2
      AND ($3::int IS NULL OR campus_id = $3)
      AND ($4::text IS NULL OR service_time = $4)
      AND ($5::text IS NULL OR attendance_type = $5)
      AND ($6::text IS NULL OR age_bracket = $6);
  `;

  const { rows } = await query(sql, [startDate, endDate, campusId, serviceTime, attendanceType, ageBracket]);

  return {
    totalUniqueAttendance: Number(rows[0]?.total_unique_attendance || 0),
    filters: { startDate, endDate, campusId, serviceTime, attendanceType, ageBracket },
  };
}

/**
 * Multi-dimensional attendance breakdown: unique attendance counted
 * simultaneously across Campus x Service Time x Attendance Type x Age
 * Bracket — the equivalent of a Power BI matrix visual with four
 * dimensions on rows/columns and a single distinct-count measure.
 *
 * Uses GROUPING SETS so the DB computes every requested aggregation
 * level in a single scan rather than N separate round trips.
 *
 * @param {Object} params
 * @param {Date} params.startDate
 * @param {Date} params.endDate
 * @returns {Promise<Array<Object>>}
 */
async function getAttendanceSlicedBreakdown({ startDate, endDate }) {
  const sql = `
    SELECT
      c.name AS campus_name,
      ci.campus_id,
      ci.service_time,
      ci.attendance_type,
      ci.age_bracket,
      COUNT(DISTINCT ci.individual_id) AS unique_attendance
    FROM check_ins ci
    LEFT JOIN campuses c ON c.id = ci.campus_id
    WHERE ci.checkin_date BETWEEN $1 AND $2
    GROUP BY GROUPING SETS (
      (c.name, ci.campus_id),
      (c.name, ci.campus_id, ci.service_time),
      (ci.attendance_type),
      (ci.age_bracket),
      (c.name, ci.campus_id, ci.attendance_type, ci.age_bracket)
    )
    ORDER BY c.name NULLS LAST, ci.service_time NULLS LAST;
  `;

  const { rows } = await query(sql, [startDate, endDate]);
  return rows;
}

/**
 * Attendance for a single weekend, sliced In-Person vs. Online — a
 * common single-purpose dashboard tile.
 *
 * @param {Object} params
 * @param {Date} params.weekEnding
 * @param {number|null} [params.campusId]
 * @returns {Promise<{weekEnding: Date, inPerson: number, online: number, total: number}>}
 */
async function getInPersonVsOnline({ weekEnding, campusId = null }) {
  const weekStart = new Date(weekEnding);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);

  const sql = `
    SELECT
      ci.attendance_type,
      COUNT(DISTINCT ci.individual_id) AS unique_attendance
    FROM check_ins ci
    WHERE ci.checkin_date BETWEEN $1 AND $2
      AND ($3::int IS NULL OR ci.campus_id = $3)
    GROUP BY ci.attendance_type;
  `;

  const { rows } = await query(sql, [weekStart, weekEnding, campusId]);

  const inPerson = Number(rows.find((r) => r.attendance_type === 'in_person')?.unique_attendance || 0);
  const online = Number(rows.find((r) => r.attendance_type === 'online')?.unique_attendance || 0);

  return { weekEnding, inPerson, online, total: inPerson + online };
}

/**
 * Rolling average time-intelligence for a date range (delegates to the
 * core aggregation engine, which does 4-week and 12-week trailing
 * averages via window functions).
 *
 * @param {Object} params
 * @param {Date} params.startDate
 * @param {Date} params.endDate
 * @param {number|null} [params.campusId]
 * @returns {Promise<Array<Object>>}
 */
async function getRollingAverageAttendance({ startDate, endDate, campusId = null }) {
  return getWeeklyAttendanceWithRollingAverages({ startDate, endDate, campusId });
}

/**
 * "Year-over-Year Matching Weeks" — accurately maps the current
 * week to the liturgically-equivalent week last year (accounting for
 * Easter drift) rather than a naive ISO-week-number match.
 *
 * @param {Object} params
 * @param {Date} params.currentDate
 * @param {number} [params.yearsBack=1]
 * @param {number|null} [params.campusId=null]
 * @returns {Promise<Object>}
 */
async function getYoYMatchingWeeks({ currentDate, yearsBack = 1, campusId = null }) {
  return getYoYMatchingWeekComparison({ currentDate, yearsBack, campusId });
}

/**
 * Full-range YoY series — powers a "this year vs. last year" trend chart.
 *
 * @param {Object} params
 * @param {Date} params.startDate
 * @param {Date} params.endDate
 * @param {number|null} [params.campusId=null]
 * @returns {Promise<Array<Object>>}
 */
async function getYoYMatchingWeeksSeries({ startDate, endDate, campusId = null }) {
  return getYoYMatchingWeekSeries({ startDate, endDate, campusId });
}

module.exports = {
  getUniqueWeekendAttendance,
  getAttendanceSlicedBreakdown,
  getInPersonVsOnline,
  getRollingAverageAttendance,
  getYoYMatchingWeeks,
  getYoYMatchingWeeksSeries,
};