'use strict';

/**
 * src/shared/utils/liturgicalCalendar.js
 *
 * True time-intelligence support. Calendar-week alignment (ISO week 23
 * last year vs. ISO week 23 this year) breaks down around movable
 * feasts — Easter shifts by up to 5 weeks year to year, and drags
 * Palm Sunday / Good Friday / attendance spikes with it. Thanksgiving
 * causes a predictable attendance dip that lands on a different ISO
 * week each year. This module lets the aggregation layer align years
 * by *ministry significance* rather than raw calendar position.
 */

/**
 * Compute the date of Easter Sunday (Western/Gregorian) for a given year
 * using the Anonymous Gregorian algorithm (Meeus/Jones/Butcher).
 *
 * @param {number} year
 * @returns {Date} UTC midnight date of Easter Sunday
 */
function computeEasterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;

  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Compute US Thanksgiving (4th Thursday of November) for a given year.
 *
 * @param {number} year
 * @returns {Date}
 */
function computeThanksgiving(year) {
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const nov1Day = nov1.getUTCDay(); // 0 = Sunday
  const firstThursdayOffset = (4 - nov1Day + 7) % 7; // 4 = Thursday
  const firstThursday = 1 + firstThursdayOffset;
  const fourthThursday = firstThursday + 21;
  return new Date(Date.UTC(year, 10, fourthThursday));
}

/**
 * Compute Palm Sunday (one week before Easter) — often a high-attendance
 * outlier that should not be blindly averaged into "normal" weeks.
 *
 * @param {number} year
 * @returns {Date}
 */
function computePalmSunday(year) {
  const easter = computeEasterSunday(year);
  const palmSunday = new Date(easter);
  palmSunday.setUTCDate(palmSunday.getUTCDate() - 7);
  return palmSunday;
}

/**
 * Compute Christmas Eve / Christmas-adjacent Sunday — the nearest Sunday
 * to Dec 25, another structurally anomalous attendance week.
 *
 * @param {number} year
 * @returns {Date}
 */
function computeNearestSundayToChristmas(year) {
  const christmas = new Date(Date.UTC(year, 11, 25));
  const day = christmas.getUTCDay();
  const distanceToSunday = day === 0 ? 0 : Math.min(day, 7 - day);
  const direction = day === 0 ? 0 : day <= 3 ? -1 : 1;
  const nearestSunday = new Date(christmas);
  nearestSunday.setUTCDate(nearestSunday.getUTCDate() + direction * distanceToSunday);
  return nearestSunday;
}

/**
 * Return the set of "anomalous" ministry dates for a given year that
 * should be flagged/excluded from baseline trend calculations
 * (statistics/anomalyDetection.js consumes this list).
 *
 * @param {number} year
 * @returns {{easter: Date, palmSunday: Date, thanksgiving: Date, christmasSunday: Date}}
 */
function getLiturgicalAnchors(year) {
  return {
    easter: computeEasterSunday(year),
    palmSunday: computePalmSunday(year),
    thanksgiving: computeThanksgiving(year),
    christmasSunday: computeNearestSundayToChristmas(year),
  };
}

/**
 * Get the ISO 8601 week number and week-year for a given date.
 *
 * @param {Date} date
 * @returns {{isoWeek: number, isoWeekYear: number}}
 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // Monday = 1 ... Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const isoWeek = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { isoWeek, isoWeekYear: d.getUTCFullYear() };
}

/**
 * Number of days between a date and Easter Sunday of that same
 * liturgical year (negative = before Easter, positive = after).
 * This is the anchor used for holiday-aware YoY week matching:
 * instead of aligning by raw ISO week, we align by "days relative to
 * Easter", which keeps Palm Sunday, Easter, and the weeks that trail
 * it correctly lined up across years even though Easter itself moves.
 *
 * @param {Date} date
 * @returns {number}
 */
function daysFromEaster(date) {
  const year = date.getUTCFullYear();
  const easter = computeEasterSunday(year);
  return Math.round((date.getTime() - easter.getTime()) / 86400000);
}

/**
 * Given a date in the "current" year, find the corresponding Sunday in
 * `targetYear` that has the same ministry significance — i.e. same
 * offset (in weeks) from Easter Sunday, rather than the same raw ISO
 * week number. This is what makes "Week 23 last year -> Week 23 this
 * year" actually correct across an Easter shift.
 *
 * @param {Date} date - a date (any day of week; will be normalized to its Sunday)
 * @param {number} targetYear
 * @returns {Date} the matching Sunday in targetYear
 */
function getEasterAlignedMatchingWeek(date, targetYear) {
  const sunday = getWeekEndingSunday(date);
  const offsetWeeks = Math.round(daysFromEaster(sunday) / 7);
  const targetEaster = computeEasterSunday(targetYear);
  const matched = new Date(targetEaster);
  matched.setUTCDate(matched.getUTCDate() + offsetWeeks * 7);
  return matched;
}

/**
 * Normalize any date to the Sunday that "owns" its ministry week
 * (Mon-Sat count toward the upcoming Sunday's weekend service week).
 *
 * @param {Date} date
 * @returns {Date}
 */
function getWeekEndingSunday(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday
  const daysUntilSunday = day === 0 ? 0 : 7 - day;
  d.setUTCDate(d.getUTCDate() + daysUntilSunday);
  return d;
}

/**
 * Determine whether a given date falls within `windowDays` of any
 * known liturgical anchor for its year — used to flag/exclude outlier
 * weeks from baseline statistics.
 *
 * @param {Date} date
 * @param {number} [windowDays=3]
 * @returns {{isAnomalousWeek: boolean, nearestAnchor: string|null, distanceDays: number|null}}
 */
function isHolidayAdjacent(date, windowDays = 3) {
  const anchors = getLiturgicalAnchors(date.getUTCFullYear());
  let nearest = null;
  let minDistance = Infinity;

  for (const [name, anchorDate] of Object.entries(anchors)) {
    const distance = Math.abs((date.getTime() - anchorDate.getTime()) / 86400000);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = name;
    }
  }

  return {
    isAnomalousWeek: minDistance <= windowDays,
    nearestAnchor: minDistance <= windowDays ? nearest : null,
    distanceDays: nearest ? Math.round(minDistance) : null,
  };
}

module.exports = {
  computeEasterSunday,
  computeThanksgiving,
  computePalmSunday,
  computeNearestSundayToChristmas,
  getLiturgicalAnchors,
  getISOWeek,
  daysFromEaster,
  getEasterAlignedMatchingWeek,
  getWeekEndingSunday,
  isHolidayAdjacent,
};