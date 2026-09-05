import {
  arithmeticMean,
  isFiniteNumber,
  percentileLinear,
} from '../core/math.js';

export const APPROVED_MONTE_CARLO_ITERATIONS = 10000;

const EXPECTED_QUANTILE_POINTS = 201;
const EXPECTED_FIRST_PROBABILITY = 0.0025;
const EXPECTED_LAST_PROBABILITY = 0.9975;
const TABLE_TOLERANCE = 1e-12;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireVarianceConfig(varianceConfig) {
  if (!isPlainObject(varianceConfig)) {
    throw new TypeError('varianceConfig must be a plain object.');
  }
  const { probabilities, quantiles } = varianceConfig;
  if (!Array.isArray(probabilities) || !Array.isArray(quantiles)) {
    throw new TypeError('varianceConfig requires probabilities and quantiles arrays.');
  }
  if (
    probabilities.length !== EXPECTED_QUANTILE_POINTS
    || quantiles.length !== EXPECTED_QUANTILE_POINTS
  ) {
    throw new RangeError(`The empirical residual table must contain ${EXPECTED_QUANTILE_POINTS} points.`);
  }
  if (!probabilities.every(isFiniteNumber) || !quantiles.every(isFiniteNumber)) {
    throw new TypeError('The empirical residual table must contain only finite numbers.');
  }
  if (
    Math.abs(probabilities[0] - EXPECTED_FIRST_PROBABILITY) > TABLE_TOLERANCE
    || Math.abs(probabilities.at(-1) - EXPECTED_LAST_PROBABILITY) > TABLE_TOLERANCE
  ) {
    throw new RangeError('Residual probabilities must span 0.0025 through 0.9975.');
  }

  const expectedStep = (
    EXPECTED_LAST_PROBABILITY - EXPECTED_FIRST_PROBABILITY
  ) / (EXPECTED_QUANTILE_POINTS - 1);
  for (let index = 1; index < probabilities.length; index += 1) {
    const step = probabilities[index] - probabilities[index - 1];
    if (step <= 0 || Math.abs(step - expectedStep) > TABLE_TOLERANCE) {
      throw new RangeError('Residual probabilities must be strictly increasing and equally spaced.');
    }
    if (quantiles[index] < quantiles[index - 1]) {
      throw new RangeError('Residual quantiles must be monotonically nondecreasing.');
    }
  }
}

function interpolateResidual(uniformValue, probabilities, quantiles) {
  if (uniformValue <= probabilities[0]) {
    return quantiles[0];
  }
  const finalIndex = probabilities.length - 1;
  if (uniformValue >= probabilities[finalIndex]) {
    return quantiles[finalIndex];
  }

  let lowerIndex = 0;
  let upperIndex = finalIndex;
  while (upperIndex - lowerIndex > 1) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (uniformValue < probabilities[middleIndex]) {
      upperIndex = middleIndex;
    } else {
      lowerIndex = middleIndex;
    }
  }

  const lowerProbability = probabilities[lowerIndex];
  const upperProbability = probabilities[upperIndex];
  const fraction = (
    uniformValue - lowerProbability
  ) / (upperProbability - lowerProbability);
  return quantiles[lowerIndex]
    + ((quantiles[upperIndex] - quantiles[lowerIndex]) * fraction);
}

/**
 * Generates the one approved empirical residual sequence for a simulation run.
 *
 * The returned residuals are intentionally separate from the resulting score
 * samples. The scenario engine must reuse residuals[i] for Scenarios 2–5.
 */
export function simulateDistribution({
  baseScore,
  varianceConfig,
  iterations,
  randomSource,
} = {}) {
  if (!isFiniteNumber(baseScore)) {
    throw new TypeError('baseScore must be a finite number.');
  }
  if (iterations !== APPROVED_MONTE_CARLO_ITERATIONS) {
    throw new RangeError(`iterations must equal ${APPROVED_MONTE_CARLO_ITERATIONS}.`);
  }
  if (typeof randomSource !== 'function') {
    throw new TypeError('randomSource must be a function.');
  }
  requireVarianceConfig(varianceConfig);

  const residuals = new Array(iterations);
  const samples = new Array(iterations);
  for (let index = 0; index < iterations; index += 1) {
    const uniformValue = randomSource();
    if (!isFiniteNumber(uniformValue) || uniformValue < 0 || uniformValue >= 1) {
      throw new RangeError(`randomSource must return a finite value inside [0, 1) at index ${index}.`);
    }
    const residual = interpolateResidual(
      uniformValue,
      varianceConfig.probabilities,
      varianceConfig.quantiles,
    );
    const sample = baseScore + residual;
    if (!isFiniteNumber(residual) || !isFiniteNumber(sample)) {
      throw new RangeError(`Monte Carlo output must remain finite at index ${index}.`);
    }
    residuals[index] = residual;
    samples[index] = sample;
  }

  return Object.freeze({
    baseScore,
    iterations,
    residuals: Object.freeze(residuals),
    samples: Object.freeze(samples),
  });
}

export function summarizeDistribution(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new TypeError('samples must be a nonempty array.');
  }
  if (!samples.every(isFiniteNumber)) {
    throw new TypeError('samples must contain only finite numbers.');
  }

  return Object.freeze({
    count: samples.length,
    mean: arithmeticMean(samples),
    p5: percentileLinear(samples, 0.05),
    median: percentileLinear(samples, 0.5),
    p95: percentileLinear(samples, 0.95),
  });
}

export default simulateDistribution;
