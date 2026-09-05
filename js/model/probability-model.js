import { isFiniteNumber, logistic } from '../core/math.js';

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requireCalibration(calibration) {
  if (!isPlainObject(calibration)) {
    throw new TypeError('calibration must be a plain object.');
  }
  if (!isFiniteNumber(calibration.slope) || calibration.slope <= 0) {
    throw new RangeError('calibration.slope must be a finite number greater than zero.');
  }
  if (!isFiniteNumber(calibration.intercept) || calibration.intercept !== 0) {
    throw new RangeError('calibration.intercept must be finite and exactly zero.');
  }
}

/**
 * Converts an approved latent matchup score into complementary win
 * probabilities using the certified zero-intercept logistic calibration.
 *
 * Returned probabilities retain full precision. Display rounding belongs to
 * the renderer and no cap, floor, or favorite compression is applied here.
 */
export function toWinProbabilities({ scoreDelta, calibration } = {}) {
  if (!isFiniteNumber(scoreDelta)) {
    throw new TypeError('scoreDelta must be a finite number.');
  }
  requireCalibration(calibration);

  const calibratedScore = (calibration.slope * scoreDelta) + calibration.intercept;
  if (!isFiniteNumber(calibratedScore)) {
    throw new RangeError('Calibrated score must remain finite.');
  }

  const teamAProbability = logistic(calibratedScore);
  const teamBProbability = 1 - teamAProbability;
  if (
    !isFiniteNumber(teamAProbability)
    || !isFiniteNumber(teamBProbability)
    || teamAProbability < 0
    || teamAProbability > 1
    || teamBProbability < 0
    || teamBProbability > 1
  ) {
    throw new RangeError('Calibrated probabilities must be finite and inside [0, 1].');
  }

  return Object.freeze({
    scoreDelta,
    calibratedScore,
    calibrationSlope: calibration.slope,
    calibrationIntercept: calibration.intercept,
    teamAProbability,
    teamBProbability,
  });
}

export default toWinProbabilities;
