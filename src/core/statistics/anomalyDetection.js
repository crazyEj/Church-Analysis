'use strict';

/**
 * src/core/statistics/anomalyDetection.js
 *
 * Statistical primitives used by Sticky Analytics to score how
 * abnormal an individual's or a cohort's attendance drop-off is,
 * relative to their own historical baseline (not a church-wide
 * average — attendance frequency is highly individual).
 */

/**
 * Compute mean and standard deviation for a numeric array.
 *
 * @param {number[]} values
 * @returns {{mean: number, stdDev: number}}
 */
function meanAndStdDev(values) {
  if (!values.length) return { mean: 0, stdDev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  return { mean, stdDev: Math.sqrt(variance) };
}

/**
 * Compute a z-score for a single observation against a baseline
 * distribution. Used to answer: "how many standard deviations below
 * this person's normal attendance rate is their current rate?"
 *
 * @param {number} observedValue
 * @param {number} baselineMean
 * @param {number} baselineStdDev
 * @returns {number} z-score (negative = below baseline)
 */
function zScore(observedValue, baselineMean, baselineStdDev) {
  if (baselineStdDev === 0) {
    // No variance in baseline (e.g. person attended every single week):
    // any deviation at all is maximally significant.
    return observedValue < baselineMean ? -Infinity : 0;
  }
  return (observedValue - baselineMean) / baselineStdDev;
}

/**
 * Compute a bounded 0-100 "Pastoral Churn Anomaly Score" for an
 * individual, combining:
 *   - how strong their historical baseline attendance was (weight of signal)
 *   - how far their current rolling rate has fallen from that baseline
 *   - recency (weeks since their last check-in — longer absence -> higher score)
 *
 * The score is intentionally bounded and monotonic so it can be used
 * directly to sort a pastoral care follow-up list by urgency.
 *
 * @param {Object} params
 * @param {number} params.baselineFrequency - fraction of expected weeks attended over trailing 6 months (0-1)
 * @param {number} params.currentRolling4WkRate - fraction of last 4 weeks attended (0-1)
 * @param {number} params.weeksSinceLastCheckIn
 * @returns {number} anomaly score, 0 (no concern) - 100 (highest concern)
 */
function computeChurnAnomalyScore({ baselineFrequency, currentRolling4WkRate, weeksSinceLastCheckIn }) {
  const clampedBaseline = Math.max(0, Math.min(1, baselineFrequency));
  const clampedCurrent = Math.max(0, Math.min(1, currentRolling4WkRate));

  // How far they've fallen relative to how strong a habit they had.
  // A person who was at 0.9 baseline and dropped to 0 is a bigger signal
  // than someone who was already sporadic at 0.55 baseline.
  const dropMagnitude = clampedBaseline - clampedCurrent; // 0 to 1
  const baselineWeight = Math.min(1, clampedBaseline / 0.5); // baselines >= 0.5 get full weight

  // Recency multiplier: caps growth after 12 weeks absent (long past the
  // point where "more weeks away" adds meaningfully more urgency).
  const recencyMultiplier = Math.min(1, weeksSinceLastCheckIn / 12);

  const rawScore = dropMagnitude * baselineWeight * 100 * (0.5 + 0.5 * recencyMultiplier);

  return Math.round(Math.max(0, Math.min(100, rawScore)));
}

/**
 * Simple linear regression slope (least squares) over an ordered
 * numeric series — used by trend detection to classify a metric as
 * trending up, flat, or down.
 *
 * @param {number[]} yValues - ordered sequentially (x = index)
 * @returns {number} slope (change in y per unit x)
 */
function linearTrendSlope(yValues) {
  const n = yValues.length;
  if (n < 2) return 0;

  const xValues = yValues.map((_, i) => i);
  const xMean = xValues.reduce((a, b) => a + b, 0) / n;
  const yMean = yValues.reduce((a, b) => a + b, 0) / n;

  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (xValues[i] - xMean) * (yValues[i] - yMean);
    denominator += (xValues[i] - xMean) ** 2;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

module.exports = {
  meanAndStdDev,
  zScore,
  computeChurnAnomalyScore,
  linearTrendSlope,
};