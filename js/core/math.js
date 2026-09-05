/**
 * Pure mathematical primitives shared by the rebuild.
 *
 * This module contains no NFL configuration, browser access, or mutable state.
 * Additional approved primitives will be added only when their implementation
 * units require them.
 */

export function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Numerically stable logistic function for every finite JavaScript number.
 *
 * The two-branch form avoids overflow from evaluating exp(-x) when x is a
 * large negative value. No probability cap or floor is applied.
 */
export function logistic(value) {
  if (!isFiniteNumber(value)) {
    throw new TypeError('logistic value must be a finite number.');
  }

  if (value >= 0) {
    const negativeExponential = Math.exp(-value);
    return 1 / (1 + negativeExponential);
  }

  const positiveExponential = Math.exp(value);
  return positiveExponential / (1 + positiveExponential);
}

export function arithmeticMean(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('arithmeticMean values must be a nonempty array.');
  }

  let sum = 0;
  let compensation = 0;
  values.forEach((value) => {
    if (!isFiniteNumber(value)) {
      throw new TypeError('arithmeticMean values must contain only finite numbers.');
    }
    const adjusted = value - compensation;
    const next = sum + adjusted;
    compensation = (next - sum) - adjusted;
    sum = next;
  });

  const result = sum / values.length;
  if (!isFiniteNumber(result)) {
    throw new RangeError('arithmeticMean result must remain finite.');
  }
  return result;
}

/**
 * Linear percentile using index (n - 1) * probability.
 *
 * This is the default NumPy/pandas linear interpolation convention used by
 * the certified generator. The input array is copied before sorting.
 */
export function percentileLinear(values, probability) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError('percentileLinear values must be a nonempty array.');
  }
  if (!isFiniteNumber(probability) || probability < 0 || probability > 1) {
    throw new RangeError('percentileLinear probability must be inside [0, 1].');
  }
  if (!values.every(isFiniteNumber)) {
    throw new TypeError('percentileLinear values must contain only finite numbers.');
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) {
    return sorted[lowerIndex];
  }
  const fraction = index - lowerIndex;
  return sorted[lowerIndex]
    + ((sorted[upperIndex] - sorted[lowerIndex]) * fraction);
}
