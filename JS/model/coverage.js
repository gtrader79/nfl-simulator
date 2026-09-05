/**
 * Directional fitted-weight coverage for one offense-versus-defense matchup.
 *
 * League metrics use this contract:
 * {
 *   metrics: {
 *     "metric.id": {
 *       usable: true,
 *       mean: 0,
 *       standardDeviation: 1,
 *       validCount: 32,
 *       distinctValueCount: 32
 *     }
 *   }
 * }
 *
 * A direct metric-ID map is also accepted. That permits the future
 * league-metrics module to expose metadata around its canonical `metrics`
 * collection without changing this pure model function.
 */

export const COVERAGE_TOLERANCE = 1e-12;

export const COVERAGE_STATUS = Object.freeze({
  ELIGIBLE: 'eligible',
  INSUFFICIENT_DATA: 'insufficient-data',
});

export const PAIR_UNAVAILABLE_REASON = Object.freeze({
  INACTIVE_PAIR: 'inactive-pair',
  OFFENSE_VALUE: 'offense-value-unavailable',
  DEFENSE_VALUE: 'defense-value-unavailable',
  OFFENSE_DISTRIBUTION: 'offense-distribution-unusable',
  DEFENSE_DISTRIBUTION: 'defense-distribution-unusable',
});

const MINIMUM_DISTRIBUTION_TEAMS = 24;
const MINIMUM_DISTINCT_VALUES = 2;

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function requireTeam(team, argumentName) {
  if (!isPlainObject(team) || !isPlainObject(team.metrics)) {
    throw new TypeError(`${argumentName} must be a team object with a metrics object.`);
  }
}

function requireModelConfig(modelConfig) {
  if (!isPlainObject(modelConfig) || !Array.isArray(modelConfig.metricPairs)) {
    throw new TypeError('modelConfig must contain a metricPairs array.');
  }
  if (
    !isFiniteNumber(modelConfig.coverageThreshold)
    || modelConfig.coverageThreshold < 0
    || modelConfig.coverageThreshold > 1
  ) {
    throw new RangeError('modelConfig.coverageThreshold must be finite and inside [0, 1].');
  }
}

function getDistributionMap(leagueMetrics) {
  if (!isPlainObject(leagueMetrics)) {
    throw new TypeError('leagueMetrics must be a plain object.');
  }
  const distributions = isPlainObject(leagueMetrics.metrics)
    ? leagueMetrics.metrics
    : leagueMetrics;
  if (!isPlainObject(distributions)) {
    throw new TypeError('leagueMetrics.metrics must be a plain object when supplied.');
  }
  return distributions;
}

function getMetricValue(team, metricId) {
  const metric = team.metrics[metricId];
  return isPlainObject(metric) && isFiniteNumber(metric.value)
    ? metric.value
    : null;
}

function getUsableDistribution(distributions, metricId) {
  const distribution = distributions[metricId];
  if (
    !isPlainObject(distribution)
    || distribution.usable !== true
    || !isFiniteNumber(distribution.mean)
    || !isFiniteNumber(distribution.standardDeviation)
    || distribution.standardDeviation <= 0
    || !Number.isInteger(distribution.validCount)
    || distribution.validCount < MINIMUM_DISTRIBUTION_TEAMS
    || !Number.isInteger(distribution.distinctValueCount)
    || distribution.distinctValueCount < MINIMUM_DISTINCT_VALUES
  ) {
    return null;
  }
  return Object.freeze({
    mean: distribution.mean,
    standardDeviation: distribution.standardDeviation,
    validCount: distribution.validCount,
    distinctValueCount: distribution.distinctValueCount,
  });
}

function validatePair(pair, index) {
  if (!isPlainObject(pair)) {
    throw new TypeError(`modelConfig.metricPairs[${index}] must be a plain object.`);
  }
  if (
    typeof pair.id !== 'string'
    || pair.id.trim() === ''
    || typeof pair.offenseMetric !== 'string'
    || pair.offenseMetric.trim() === ''
    || typeof pair.defenseMetric !== 'string'
    || pair.defenseMetric.trim() === ''
  ) {
    throw new TypeError(`modelConfig.metricPairs[${index}] has an invalid identity.`);
  }
  if (
    typeof pair.active !== 'boolean'
    || !isFiniteNumber(pair.coefficient)
    || pair.coefficient < 0
    || !isFiniteNumber(pair.nominalCoverageContribution)
    || pair.nominalCoverageContribution < 0
  ) {
    throw new TypeError(`modelConfig.metricPairs[${index}] has invalid analytical values.`);
  }
  if (
    (pair.active && (pair.coefficient <= 0 || pair.nominalCoverageContribution <= 0))
    || (!pair.active && (pair.coefficient !== 0 || pair.nominalCoverageContribution !== 0))
  ) {
    throw new RangeError(`modelConfig.metricPairs[${index}] has incoherent activity values.`);
  }
}

function normalizeCoverage(coverage) {
  if (Math.abs(coverage - 1) <= COVERAGE_TOLERANCE) {
    return 1;
  }
  return coverage;
}

/**
 * Evaluates one directional offense-versus-defense evidence set.
 *
 * Unavailable football evidence is a normal result, not an exception. Invalid
 * function contracts throw because bootstrap validation should have prevented
 * them from reaching production model execution.
 */
export function evaluateCoverage({
  offenseTeam,
  defenseTeam,
  leagueMetrics,
  modelConfig,
} = {}) {
  requireTeam(offenseTeam, 'offenseTeam');
  requireTeam(defenseTeam, 'defenseTeam');
  requireModelConfig(modelConfig);
  const distributions = getDistributionMap(leagueMetrics);

  const pairSnapshots = [];
  let activePairCount = 0;
  let availablePairCount = 0;
  let nominalCoverage = 0;

  modelConfig.metricPairs.forEach((pair, index) => {
    validatePair(pair, index);

    if (!pair.active) {
      pairSnapshots.push({
        id: pair.id,
        offenseMetric: pair.offenseMetric,
        defenseMetric: pair.defenseMetric,
        active: false,
        available: false,
        unavailableReasons: [PAIR_UNAVAILABLE_REASON.INACTIVE_PAIR],
        coefficient: pair.coefficient,
        nominalCoverageContribution: pair.nominalCoverageContribution,
        effectiveCoefficient: 0,
        offenseValue: null,
        defenseValue: null,
        offenseDistribution: null,
        defenseDistribution: null,
      });
      return;
    }

    activePairCount += 1;
    const offenseValue = getMetricValue(offenseTeam, pair.offenseMetric);
    const defenseValue = getMetricValue(defenseTeam, pair.defenseMetric);
    const offenseDistribution = getUsableDistribution(distributions, pair.offenseMetric);
    const defenseDistribution = getUsableDistribution(distributions, pair.defenseMetric);
    const unavailableReasons = [];

    if (offenseValue === null) {
      unavailableReasons.push(PAIR_UNAVAILABLE_REASON.OFFENSE_VALUE);
    }
    if (defenseValue === null) {
      unavailableReasons.push(PAIR_UNAVAILABLE_REASON.DEFENSE_VALUE);
    }
    if (offenseDistribution === null) {
      unavailableReasons.push(PAIR_UNAVAILABLE_REASON.OFFENSE_DISTRIBUTION);
    }
    if (defenseDistribution === null) {
      unavailableReasons.push(PAIR_UNAVAILABLE_REASON.DEFENSE_DISTRIBUTION);
    }

    const available = unavailableReasons.length === 0;
    if (available) {
      availablePairCount += 1;
      nominalCoverage += pair.nominalCoverageContribution;
    }

    pairSnapshots.push({
      id: pair.id,
      offenseMetric: pair.offenseMetric,
      defenseMetric: pair.defenseMetric,
      active: true,
      available,
      unavailableReasons,
      coefficient: pair.coefficient,
      nominalCoverageContribution: pair.nominalCoverageContribution,
      effectiveCoefficient: 0,
      offenseValue,
      defenseValue,
      offenseDistribution,
      defenseDistribution,
    });
  });

  const totalNominalCoverage = modelConfig.metricPairs.reduce(
    (sum, pair) => sum + pair.nominalCoverageContribution,
    0,
  );
  if (Math.abs(totalNominalCoverage - 1) > COVERAGE_TOLERANCE) {
    throw new RangeError('Active nominal coverage contributions must sum to one.');
  }

  const coverage = normalizeCoverage(nominalCoverage);
  const eligible = coverage + COVERAGE_TOLERANCE >= modelConfig.coverageThreshold;
  const normalizationFactor = eligible && coverage > 0 ? 1 / coverage : null;

  const pairs = pairSnapshots.map((pair) => ({
    ...pair,
    unavailableReasons: [...pair.unavailableReasons],
    effectiveCoefficient: pair.available && normalizationFactor !== null
      ? pair.coefficient * normalizationFactor
      : 0,
  }));

  return deepFreeze({
    status: eligible ? COVERAGE_STATUS.ELIGIBLE : COVERAGE_STATUS.INSUFFICIENT_DATA,
    eligible,
    coverage,
    threshold: modelConfig.coverageThreshold,
    tolerance: COVERAGE_TOLERANCE,
    normalizationFactor,
    activePairCount,
    availablePairCount,
    availablePairIds: pairs.filter((pair) => pair.available).map((pair) => pair.id),
    unavailablePairIds: pairs
      .filter((pair) => pair.active && !pair.available)
      .map((pair) => pair.id),
    pairs,
  });
}

export default evaluateCoverage;
