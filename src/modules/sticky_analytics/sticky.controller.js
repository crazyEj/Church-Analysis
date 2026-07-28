'use strict';

/**
 * src/modules/sticky_analytics/sticky.controller.js
 *
 * Express router exposing the Sticky Analytics engine. Churn alerts
 * surface pastorally sensitive information (who's drifting away and
 * why) so that endpoint is locked to PASTOR+ rather than the general
 * ELDER threshold used elsewhere.
 *
 * Mount in the app entrypoint with:
 *   app.use('/api/sticky', require('./src/modules/sticky_analytics/sticky.controller'));
 */

const express = require('express');
const stickyService = require('./sticky.service');
const { requireRole, ROLES } = require('../../shared/middleware/rbac');

const router = express.Router();

function parseCampusId(raw) {
  if (raw === undefined || raw === '') return null;
  const campusId = Number(raw);
  if (!Number.isInteger(campusId)) {
    const err = new Error('campusId must be an integer');
    err.statusCode = 400;
    throw err;
  }
  return campusId;
}

/**
 * GET /api/sticky/ratio
 * Stickiness Ratio for a single month.
 *
 * Query params: year, month, campusId?
 */
router.get('/ratio', requireRole(ROLES.ELDER), async (req, res, next) => {
  try {
    const year = Number(req.query.year);
    const month = Number(req.query.month);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      const err = new Error('year and month (1-12) are required');
      err.statusCode = 400;
      throw err;
    }
    const campusId = parseCampusId(req.query.campusId);

    const result = await stickyService.calculateStickinessRatio({ year, month, campusId });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sticky/ratio-trend
 * Stickiness Ratio trend across a range of months.
 *
 * Query params: startYear, startMonth, endYear, endMonth, campusId?
 */
router.get('/ratio-trend', requireRole(ROLES.ELDER), async (req, res, next) => {
  try {
    const startYear = Number(req.query.startYear);
    const startMonth = Number(req.query.startMonth);
    const endYear = Number(req.query.endYear);
    const endMonth = Number(req.query.endMonth);

    if ([startYear, startMonth, endYear, endMonth].some((v) => !Number.isInteger(v))) {
      const err = new Error('startYear, startMonth, endYear, endMonth are all required integers');
      err.statusCode = 400;
      throw err;
    }
    const campusId = parseCampusId(req.query.campusId);

    const series = await stickyService.getStickinessRatioTrend({ startYear, startMonth, endYear, endMonth, campusId });
    res.json({ series });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sticky/churn-alerts
 * Pastoral Churn Alert list, sorted by anomaly score descending.
 * Restricted to PASTOR role or higher — this surfaces individually
 * identifiable pastoral-care information.
 *
 * Query params: asOfDate?, campusId?, baselineThreshold?
 */
router.get('/churn-alerts', requireRole(ROLES.PASTOR), async (req, res, next) => {
  try {
    const asOfDate = req.query.asOfDate ? new Date(req.query.asOfDate) : new Date();
    if (Number.isNaN(asOfDate.getTime())) {
      const err = new Error('asOfDate must be a valid date');
      err.statusCode = 400;
      throw err;
    }
    const campusId = parseCampusId(req.query.campusId);
    const baselineThreshold = req.query.baselineThreshold ? Number(req.query.baselineThreshold) : 0.5;

    const alerts = await stickyService.getPastoralChurnAlerts({ asOfDate, campusId, baselineThreshold });
    res.json({ asOfDate, campusId, baselineThreshold, alertCount: alerts.length, alerts });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/sticky/cohort-matrix
 * New Visitor Assimilation Pipeline — cohort retention matrix plus
 * the aggregate decay curve (Week 1 / 2 / 3 / 6 return rates).
 *
 * Query params: cohortStartDate, cohortEndDate, groupBy? ('week'|'month')
 */
router.get('/cohort-matrix', requireRole(ROLES.ELDER), async (req, res, next) => {
  try {
    if (!req.query.cohortStartDate || !req.query.cohortEndDate) {
      const err = new Error('cohortStartDate and cohortEndDate are required');
      err.statusCode = 400;
      throw err;
    }
    const cohortStartDate = new Date(req.query.cohortStartDate);
    const cohortEndDate = new Date(req.query.cohortEndDate);
    if (Number.isNaN(cohortStartDate.getTime()) || Number.isNaN(cohortEndDate.getTime())) {
      const err = new Error('cohortStartDate and cohortEndDate must be valid dates');
      err.statusCode = 400;
      throw err;
    }
    const groupBy = req.query.groupBy === 'month' ? 'month' : 'week';

    const result = await stickyService.getNewVisitorAssimilation({ cohortStartDate, cohortEndDate, groupBy });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;