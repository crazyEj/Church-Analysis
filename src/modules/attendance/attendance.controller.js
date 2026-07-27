'use strict';

/**
 * src/modules/attendance/attendance.controller.js
 *
 * Express router exposing the Attendance Analytics engine.
 * Mount in the app entrypoint with:
 *   app.use('/api/attendance', require('./src/modules/attendance/attendance.controller'));
 */

const express = require('express');
const attendanceService = require('./attendance.service');
const { parseAttendanceFilters, describeWeek } = require('./attendance.utils');
const { requireRole, ROLES } = require('../../shared/middleware/rbac');

const router = express.Router();

/**
 * GET /api/attendance/weekend
 * Total unique weekend attendance, optionally sliced by campus,
 * service time, attendance type, and age bracket.
 *
 * Query params: startDate, endDate, campusId?, serviceTime?, attendanceType?, ageBracket?
 */
router.get('/weekend', requireRole(ROLES.ELDER), async (req, res, next) => {
  try {
    const filters = parseAttendanceFilters(req.query);
    const result = await attendanceService.getUniqueWeekendAttendance(filters);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/attendance/breakdown
 * Multi-dimensional breakdown: Campus x Service Time x Type x Age Bracket.
 *
 * Query params: startDate, endDate
 */
router.get('/breakdown', requireRole(ROLES.ELDER), async (req, res, next) => {
  try {
    const { startDate, endDate } = parseAttendanceFilters(req.query);
    const rows = await attendanceService.getAttendanceSlicedBreakdown({ startDate, endDate });
    res.json({ startDate, endDate, breakdown: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/attendance/in-person-vs-online
 * Single-weekend split between in-person and online attendance.
 *
 * Query params: weekEnding (any date within the weekend), campusId?
 */
router.get('/in-person-vs-online', requireRole(ROLES.ELDER), async (req, res, next) => {
  try {
    if (!req.query.weekEnding) {
      const err = new Error('weekEnding query param is required');
      err.statusCode = 400;
      throw err;
    }
    const weekEnding = new Date(req.query.weekEnding);
    if (Number.isNaN(weekEnding.getTime())) {
      const err = new Error('weekEnding must be a valid date');
      err.statusCode = 400;
      throw err;
    }
    const campusId = req.query.campusId ? Number(req.query.campusId) : null;

    const result = await attendanceService.getInPersonVsOnline({ weekEnding, campusId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/attendance/rolling-average
 * 4-week and 12-week trailing rolling averages over a date range.
 *
 * Query params: startDate, endDate, campusId?
 */
router.get('/rolling-average', requireRole(ROLES.ELDER), async (req, res, next) => {
  try {
    const { startDate, endDate, campusId } = parseAttendanceFilters(req.query);
    const series = await attendanceService.getRollingAverageAttendance({ startDate, endDate, campusId });
    res.json({
      startDate,
      endDate,
      campusId,
      series: series.map((row) => ({ ...row, ...describeWeek(row.week_ending) })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/attendance/yoy
 * Year-over-Year comparison for a single week, using Easter-aligned
 * matching rather than raw ISO week number.
 *
 * Query params: currentDate, yearsBack?, campusId?
 */
router.get('/yoy', requireRole(ROLES.ELDER), async (req, res, next) => {
  try {
    if (!req.query.currentDate) {
      const err = new Error('currentDate query param is required');
      err.statusCode = 400;
      throw err;
    }
    const currentDate = new Date(req.query.currentDate);
    if (Number.isNaN(currentDate.getTime())) {
      const err = new Error('currentDate must be a valid date');
      err.statusCode = 400;
      throw err;
    }
    const yearsBack = req.query.yearsBack ? Number(req.query.yearsBack) : 1;
    const campusId = req.query.campusId ? Number(req.query.campusId) : null;

    const result = await attendanceService.getYoYMatchingWeeks({ currentDate, yearsBack, campusId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/attendance/yoy-series
 * Year-over-Year comparison across an entire date range — powers a
 * "this year vs. last year" trend chart.
 *
 * Query params: startDate, endDate, campusId?
 */
router.get('/yoy-series', requireRole(ROLES.ELDER), async (req, res, next) => {
  try {
    const { startDate, endDate, campusId } = parseAttendanceFilters(req.query);
    const series = await attendanceService.getYoYMatchingWeeksSeries({ startDate, endDate, campusId });
    res.json({ startDate, endDate, campusId, series });
  } catch (err) {
    next(err);
  }
});

module.exports = router;