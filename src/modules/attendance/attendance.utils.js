'use strict';

/**
 * src/modules/attendance/attendance.utils.js
 *
 * Pure helper functions used by the attendance service/controller.
 * Kept dependency-free from the DB layer so they're trivially unit
 * testable.
 */

const { getWeekEndingSunday, getISOWeek } = require('../../shared/utils/liturgicalCalendar');
const { AGE_BRACKETS: INDIVIDUAL_AGE_BRACKETS } = require('../../core/models/Individual');
const { ATTENDANCE_TYPES, AGE_BRACKETS } = require('../../core/models/CheckIn');

/**
 * Validate and normalize query-string filter params coming off an
 * Express request into the shape services expect. Throws a descriptive
 * error on invalid input so the controller can return a 400.
 *
 * @param {Object} raw - req.query
 * @returns {{startDate: Date, endDate: Date, campusId: number|null, serviceTime: string|null, attendanceType: string|null, ageBracket: string|null}}
 */
function parseAttendanceFilters(raw = {}) {
  const errors = [];

  const startDate = raw.startDate ? new Date(raw.startDate) : null;
  const endDate = raw.endDate ? new Date(raw.endDate) : null;

  if (!startDate || Number.isNaN(startDate.getTime())) errors.push('startDate is required and must be a valid date');
  if (!endDate || Number.isNaN(endDate.getTime())) errors.push('endDate is required and must be a valid date');
  if (startDate && endDate && startDate > endDate) errors.push('startDate must be before endDate');

  let campusId = null;
  if (raw.campusId !== undefined && raw.campusId !== '') {
    campusId = Number(raw.campusId);
    if (!Number.isInteger(campusId)) errors.push('campusId must be an integer');
  }

  let attendanceType = null;
  if (raw.attendanceType) {
    if (!Object.values(ATTENDANCE_TYPES).includes(raw.attendanceType)) {
      errors.push(`attendanceType must be one of ${Object.values(ATTENDANCE_TYPES).join('|')}`);
    } else {
      attendanceType = raw.attendanceType;
    }
  }

  let ageBracket = null;
  if (raw.ageBracket) {
    if (!Object.values(AGE_BRACKETS).includes(raw.ageBracket)) {
      errors.push(`ageBracket must be one of ${Object.values(AGE_BRACKETS).join('|')}`);
    } else {
      ageBracket = raw.ageBracket;
    }
  }

  const serviceTime = raw.serviceTime ? String(raw.serviceTime) : null;

  if (errors.length > 0) {
    const err = new Error(`Invalid attendance filters: ${errors.join('; ')}`);
    err.statusCode = 400;
    throw err;
  }

  return { startDate, endDate, campusId, serviceTime, attendanceType, ageBracket };
}

/**
 * Build the "week ending" label plus ISO week metadata for a date —
 * used to annotate rows returned to the frontend so charts can render
 * human-readable week labels without recomputing calendar math client-side.
 *
 * @param {Date} date
 * @returns {{weekEnding: Date, isoWeek: number, isoWeekYear: number}}
 */
function describeWeek(date) {
  const weekEnding = getWeekEndingSunday(date);
  const { isoWeek, isoWeekYear } = getISOWeek(weekEnding);
  return { weekEnding, isoWeek, isoWeekYear };
}

module.exports = {
  parseAttendanceFilters,
  describeWeek,
  AGE_BRACKETS: INDIVIDUAL_AGE_BRACKETS,
};