'use strict';

/**
 * src/core/aggregation/yoyComparison.js
 *
 * True time-intelligence YoY comparisons. Naively comparing "ISO Week 23
 * this year" to "ISO Week 23 last year" silently misaligns whenever
 * Easter (or another movable anchor) shifts, since a chunk of
 * congregations see a multi-week attendance bump around Holy Week that
 * has nothing to do with the raw week number. This module re-anchors
 * comparisons to liturgical offset instead of raw week number.
 */

const { query } = require('../../../config/database');
const {
  getEasterAlignedMatchingWeek,
  getWeekEndingSunday,
  isHolidayAdjacent,
} = require('../../shared/utils/liturgicalCalendar');

/**
 * Resolve the "matching week" in a prior year for a given current-year
 * date, using Easter-offset alignment rather than raw ISO week number.
 *
 * @param {Date} currentDate
 * @param {number} yearsBack - e.g. 1 for YoY
 * @returns {{currentWeekEnding: Date, matchingWeekEnding: Date}}
 */
function resolveMatchingWeek(currentDate, yearsBack = 1) {
  const currentWeekEnding = getWeekEndingSunday(currentDate);
  const targetYear = currentWeekEnding.getUTCFullYear() - yearsBack;
  const matchingWeekEnding = getEasterAlignedMatchingWeek(currentWeekEnding, targetYear);
  return { currentWeekEnding, matchingWeekEnding };
}

/**
 * Compute attendance for a specific week-ending Sunday, optionally
 * sliced by campus.
 *
 * @param {Date} weekEnding
 * @param {number|null} campusId
 * @returns {Promise<number>}
 */
async function getAttendanceForWeek(weekEnding, campusId = null) {
  const weekStart = new Date(weekEnding);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);

  const sql = `
    SELECT COUNT(DISTINCT individual_id) AS attendance
    FROM check_ins
    WHERE checkin_date BETWEEN $1 AND $2
      AND ($3::int IS NULL OR campus_id = $3);
  `;
  const { rows } = await query(sql, [weekStart, weekEnding, campusId]);
  return Number(rows[0]?.attendance || 0);
}

/**
 * Compute a full "Year-over-Year Matching Weeks" comparison: given a
 * current-year week, find the liturgically-equivalent week last year,
 * pull both attendance figures, and return the delta — flagging either
 * week if it's holiday-adjacent (so dashboard consumers know not to
 * over-interpret a spike/dip as organic growth or decline).
 *
 * @param {Object} params
 * @param {Date} params.currentDate - any date within the week of interest
 * @param {number} [params.yearsBack=1]
 * @param {number|null} [params.campusId=null]
 * @returns {Promise<Object>} full YoY comparison payload
 */
async function getYoYMatchingWeekComparison({ currentDate, yearsBack = 1, campusId = null }) {
  const { currentWeekEnding, matchingWeekEnding } = resolveMatchingWeek(currentDate, yearsBack);

  const [currentAttendance, priorAttendance] = await Promise.all([
    getAttendanceForWeek(currentWeekEnding, campusId),
    getAttendanceForWeek(matchingWeekEnding, campusId),
  ]);

  const currentFlag = isHolidayAdjacent(currentWeekEnding);
  const priorFlag = isHolidayAdjacent(matchingWeekEnding);

  const absoluteChange = currentAttendance - priorAttendance;
  const percentChange = priorAttendance === 0 ? null : Number(((absoluteChange / priorAttendance) * 100).toFixed(2));

  return {
    current: {
      weekEnding: currentWeekEnding,
      attendance: currentAttendance,
      isHolidayAdjacent: currentFlag.isAnomalousWeek,
      nearestAnchor: currentFlag.nearestAnchor,
    },
    priorYear: {
      weekEnding: matchingWeekEnding,
      attendance: priorAttendance,
      isHolidayAdjacent: priorFlag.isAnomalousWeek,
      nearestAnchor: priorFlag.nearestAnchor,
    },
    comparison: {
      alignmentMethod: 'easter_offset', // vs. naive 'iso_week_number'
      absoluteChange,
      percentChange,
      reliableComparison: !currentFlag.isAnomalousWeek && !priorFlag.isAnomalousWeek,
    },
  };
}

/**
 * Compute YoY comparisons for an entire range of weeks at once —
 * used to render a full "this year vs last year" trend line on the
 * dashboard rather than a single-week snapshot.
 *
 * @param {Object} params
 * @param {Date} params.startDate
 * @param {Date} params.endDate
 * @param {number|null} [params.campusId=null]
 * @returns {Promise<Array<Object>>}
 */
async function getYoYMatchingWeekSeries({ startDate, endDate, campusId = null }) {
  const weeks = [];
  const cursor = getWeekEndingSunday(startDate);
  const end = getWeekEndingSunday(endDate);

  while (cursor.getTime() <= end.getTime()) {
    weeks.push(new Date(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 7);
  }

  const results = [];
  for (const weekEnding of weeks) {
    // Sequential await keeps the DB connection pool from being flooded
    // when the range spans a full year (52 x 2 queries).
    // eslint-disable-next-line no-await-in-loop
    const comparison = await getYoYMatchingWeekComparison({ currentDate: weekEnding, campusId });
    results.push(comparison);
  }
  return results;
}

module.exports = {
  resolveMatchingWeek,
  getAttendanceForWeek,
  getYoYMatchingWeekComparison,
  getYoYMatchingWeekSeries,
};