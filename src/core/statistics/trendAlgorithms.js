'use strict';

/**
 * src/core/statistics/trendAlgorithms.js
 *
 * Higher-level trend classification built on top of the primitives in
 * anomalyDetection.js. Used to label a rolling-average series as
 * 'rising' / 'stable' / 'declining' for dashboard badges, and to detect
 * moving-average crossovers (a 4wk avg dipping below the 12wk avg is a
 * classic early warning signal, borrowed from financial time series
 * analysis and directly applicable to attendance stickiness).
 */

const { linearTrendSlope } = require('./anomalyDetection');

const TREND_LABELS = Object.freeze({
  RISING: 'rising',
  STABLE: 'stable',
  DECLINING: 'declining',
});

/**
 * Classify a series of values (e.g. rolling 4-week averages over time)
 * into a trend label, using slope relative to the series' own mean to
 * stay scale-invariant (a swing of 2 people/week matters more for a
 * campus averaging 20 than one averaging 2000).
 *
 * @param {number[]} series
 * @param {number} [sensitivity=0.02] - fractional slope-to-mean ratio threshold
 * @returns {{label: string, slope: number, normalizedSlope: number}}
 */
function classifyTrend(series, sensitivity = 0.02) {
  if (series.length < 2) {
    return { label: TREND_LABELS.STABLE, slope: 0, normalizedSlope: 0 };
  }

  const slope = linearTrendSlope(series);
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  const normalizedSlope = mean === 0 ? 0 : slope / mean;

  let label = TREND_LABELS.STABLE;
  if (normalizedSlope > sensitivity) label = TREND_LABELS.RISING;
  else if (normalizedSlope < -sensitivity) label = TREND_LABELS.DECLINING;

  return { label, slope: Number(slope.toFixed(4)), normalizedSlope: Number(normalizedSlope.toFixed(4)) };
}

/**
 * Detect moving-average crossovers between a fast series (e.g. 4-week
 * rolling avg) and a slow series (e.g. 12-week rolling avg) of equal
 * length/alignment. A "bearish crossover" (fast dips below slow) flags
 * early-stage stickiness erosion before raw attendance numbers make it
 * obvious.
 *
 * @param {Array<{weekEnding: Date, rolling4wk: number|null, rolling12wk: number|null}>} series
 * @returns {Array<{weekEnding: Date, crossoverType: 'bullish'|'bearish'}>}
 */
function detectMovingAverageCrossovers(series) {
  const crossovers = [];

  for (let i = 1; i < series.length; i += 1) {
    const prev = series[i - 1];
    const curr = series[i];

    if (
      prev.rolling4wk == null ||
      prev.rolling12wk == null ||
      curr.rolling4wk == null ||
      curr.rolling12wk == null
    ) {
      continue; // not enough trailing data yet
    }

    const wasAbove = prev.rolling4wk >= prev.rolling12wk;
    const isAbove = curr.rolling4wk >= curr.rolling12wk;

    if (wasAbove && !isAbove) {
      crossovers.push({ weekEnding: curr.weekEnding, crossoverType: 'bearish' });
    } else if (!wasAbove && isAbove) {
      crossovers.push({ weekEnding: curr.weekEnding, crossoverType: 'bullish' });
    }
  }

  return crossovers;
}

module.exports = { TREND_LABELS, classifyTrend, detectMovingAverageCrossovers };