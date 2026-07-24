'use strict';

/**
 * config/powerbi_engine.js
 *
 * A lightweight "semantic layer" measure registry — the DAX-equivalent
 * concept of naming a calculation once (e.g. "Rolling4WkAvg") and
 * resolving it to its implementation, so controllers/services request
 * measures by name instead of hardcoding which aggregation module and
 * function backs them. This keeps a single source of truth for what a
 * given "measure" means across the whole app, mirroring how a Power BI
 * dataset centralizes measure definitions independent of any one report page.
 */

const { getWeeklyAttendanceWithRollingAverages } = require('../src/core/aggregation/rollingAverage');
const { getMonthlyActiveWithGrowth } = require('../src/core/aggregation/momGrowth');
const { getYoYMatchingWeekSeries } = require('../src/core/aggregation/yoyComparison');

/**
 * Each measure definition documents:
 *   - id: stable measure name used across controllers/dashboards
 *   - description: human-readable definition (the "DAX comment")
 *   - grain: the natural time grain the measure operates at
 *   - resolve: the function that actually computes it, given params
 */
const MEASURES = Object.freeze({
  ROLLING_4WK_AVG_ATTENDANCE: {
    id: 'ROLLING_4WK_AVG_ATTENDANCE',
    description:
      'Trailing 4-week average of unique weekend attendees. ' +
      'DAX-equivalent: AVERAGEX(DATESINPERIOD(Date[Date], LASTDATE(Date[Date]), -4, WEEK), [WeeklyAttendance])',
    grain: 'week',
    resolve: (params) => getWeeklyAttendanceWithRollingAverages(params),
  },
  ROLLING_12WK_AVG_ATTENDANCE: {
    id: 'ROLLING_12WK_AVG_ATTENDANCE',
    description:
      'Trailing 12-week average of unique weekend attendees. Same source as the 4-week ' +
      'measure — both are returned together since they share the same underlying window query.',
    grain: 'week',
    resolve: (params) => getWeeklyAttendanceWithRollingAverages(params),
  },
  MOM_ATTENDANCE_GROWTH: {
    id: 'MOM_ATTENDANCE_GROWTH',
    description:
      'Month-over-month percent change in monthly active attendees. ' +
      'DAX-equivalent: DIVIDE([ThisMonth] - [LastMonth], [LastMonth])',
    grain: 'month',
    resolve: (params) => getMonthlyActiveWithGrowth(params),
  },
  YOY_MATCHING_WEEK: {
    id: 'YOY_MATCHING_WEEK',
    description:
      'Year-over-year comparison using liturgical (Easter-offset) week alignment rather than ' +
      'raw ISO week number, so movable feasts do not desynchronize the comparison.',
    grain: 'week',
    resolve: (params) => getYoYMatchingWeekSeries(params),
  },
});

/**
 * Resolve and execute a named measure with the given parameters —
 * analogous to evaluating a DAX measure in a given filter context.
 *
 * @param {keyof typeof MEASURES} measureId
 * @param {Object} params
 * @returns {Promise<any>}
 */
async function evaluateMeasure(measureId, params) {
  const measure = MEASURES[measureId];
  if (!measure) {
    throw new Error(`[powerbi_engine] Unknown measure: ${measureId}. Known measures: ${Object.keys(MEASURES).join(', ')}`);
  }
  return measure.resolve(params);
}

function listMeasures() {
  return Object.values(MEASURES).map(({ id, description, grain }) => ({ id, description, grain }));
}

module.exports = { MEASURES, evaluateMeasure, listMeasures };