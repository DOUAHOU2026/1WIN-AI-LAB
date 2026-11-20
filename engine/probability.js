export const CONFIDENCE_LEVEL = 0.95;

export function validateProbability(value, label = 'probability') {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite value between 0 and 1.`);
  }
  return value;
}

export function validateDistribution(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) throw new TypeError('An outcome distribution must not be empty.');
  const normalized = outcomes.map((outcome, index) => {
    if (!Number.isFinite(outcome.netPerUnit)) throw new TypeError(`Outcome ${index} has no finite netPerUnit.`);
    validateProbability(outcome.probability, `outcome ${index} probability`);
    return { ...outcome };
  });
  const total = normalized.reduce((sum, outcome) => sum + outcome.probability, 0);
  if (Math.abs(total - 1) > 1e-10) throw new RangeError(`Outcome probabilities must sum to 1 (received ${total}).`);
  return normalized;
}

export function expectedValue(outcomes) {
  return validateDistribution(outcomes).reduce((sum, outcome) => sum + outcome.probability * outcome.netPerUnit, 0);
}

export function distributionVariance(outcomes) {
  const checked = validateDistribution(outcomes);
  const mean = expectedValue(checked);
  return checked.reduce((sum, outcome) => sum + outcome.probability * ((outcome.netPerUnit - mean) ** 2), 0);
}

export function theoreticalCrashDistribution(target, reachProbability) {
  if (!Number.isFinite(target) || target <= 1) throw new RangeError('Cash-out target must be greater than 1.');
  validateProbability(reachProbability, 'reach probability');
  return validateDistribution([
    { label: 'cash-out', probability: reachProbability, netPerUnit: target - 1 },
    { label: 'crash-before-cash-out', probability: 1 - reachProbability, netPerUnit: -1 }
  ]);
}

export function wilsonInterval(successes, trials, confidence = CONFIDENCE_LEVEL) {
  if (!Number.isInteger(successes) || successes < 0 || !Number.isInteger(trials) || trials < 0 || successes > trials) {
    throw new RangeError('Wilson interval counts are invalid.');
  }
  if (trials === 0) return null;
  const z = confidence === 0.95 ? 1.959963984540054 : normalQuantile((1 + confidence) / 2);
  const p = successes / trials;
  const denominator = 1 + (z * z) / trials;
  const center = (p + (z * z) / (2 * trials)) / denominator;
  const half = z * Math.sqrt((p * (1 - p) + (z * z) / (4 * trials)) / trials) / denominator;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

export function meanConfidenceInterval(values, confidence = CONFIDENCE_LEVEL) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  const half = normalQuantile((1 + confidence) / 2) * Math.sqrt(variance / values.length);
  return { mean, standardError: Math.sqrt(variance / values.length), lower: mean - half, upper: mean + half, confidence };
}

export function oneSidedMeanPValue(values) {
  if (!Array.isArray(values) || values.length < 2) return 1;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  if (variance === 0) return mean > 0 ? 0 : 1;
  const z = mean / Math.sqrt(variance / values.length);
  return Math.max(0, Math.min(1, 1 - normalCdf(z)));
}

export function oneSidedDifferencePValue(candidateValues, baselineValues) {
  if (candidateValues.length < 2 || baselineValues.length < 2) return 1;
  const candidate = meanConfidenceInterval(candidateValues);
  const baseline = meanConfidenceInterval(baselineValues);
  const difference = candidate.mean - baseline.mean;
  const se = Math.hypot(candidate.standardError, baseline.standardError);
  if (se === 0) return difference > 0 ? 0 : 1;
  return Math.max(0, Math.min(1, 1 - normalCdf(difference / se)));
}

/** Holm step-down correction. Results preserve input order. */
export function holmBonferroni(items, alpha = 0.05) {
  if (!(alpha > 0 && alpha < 1)) throw new RangeError('alpha must be between 0 and 1.');
  const ordered = items.map((item, index) => ({ ...item, index, pValue: Math.max(0, Math.min(1, item.pValue)) }))
    .sort((a, b) => a.pValue - b.pValue || a.index - b.index);
  let stillRejecting = true;
  let runningAdjusted = 0;
  const adjusted = new Array(items.length);
  ordered.forEach((item, rank) => {
    const multiplicity = ordered.length - rank;
    const adjustedP = Math.min(1, multiplicity * item.pValue);
    runningAdjusted = Math.max(runningAdjusted, adjustedP);
    const reject = stillRejecting && item.pValue <= alpha / multiplicity;
    if (!reject) stillRejecting = false;
    adjusted[item.index] = { ...item, adjustedPValue: runningAdjusted, reject };
  });
  return adjusted;
}

function normalCdf(value) {
  // Abramowitz-Stegun 7.1.26 approximation, absolute error below 7.5e-8.
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function normalQuantile(probability) {
  if (!(probability > 0 && probability < 1)) throw new RangeError('Quantile probability must be between 0 and 1.');
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const low = 0.02425;
  const high = 1 - low;
  let q; let r;
  if (probability < low) {
    q = Math.sqrt(-2 * Math.log(probability));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (probability > high) {
    q = Math.sqrt(-2 * Math.log(1 - probability));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  q = probability - 0.5;
  r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

