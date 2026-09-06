/**
 * Pure validation for the approved NFL analytical configuration.
 *
 * This module does not import application state, UI code, or model formulas.
 * It returns a structured result so bootstrap can fail closed with the stable
 * MODEL_CONFIGURATION_INVALID error code.
 */

export const MODEL_CONFIGURATION_INVALID = 'MODEL_CONFIGURATION_INVALID';

export const APPROVED_SCENARIOS = Object.freeze([
  Object.freeze({ id: 'statistical-matchup', order: 1 }),
  Object.freeze({ id: 'monte-carlo-variance', order: 2 }),
  Object.freeze({ id: 'stadium-weather', order: 3 }),
  Object.freeze({ id: 'fatigue', order: 4 }),
  Object.freeze({ id: 'competitive-factors', order: 5 }),
]);

export const APPROVED_METRIC_PAIRINGS = Object.freeze({
  pass_efficiency: Object.freeze({
    offenseMetric: 'offense.pass_epa_per_dropback',
    defenseMetric: 'defense.pass_epa_allowed_per_dropback',
  }),
  rush_efficiency: Object.freeze({
    offenseMetric: 'offense.rush_epa_per_attempt',
    defenseMetric: 'defense.rush_epa_allowed_per_attempt',
  }),
  success_rate: Object.freeze({
    offenseMetric: 'offense.success_rate',
    defenseMetric: 'defense.success_rate_allowed',
  }),
  pressure: Object.freeze({
    offenseMetric: 'offense.pressure_allowed_rate',
    defenseMetric: 'defense.pressure_generated_rate',
  }),
  explosiveness: Object.freeze({
    offenseMetric: 'offense.explosive_play_rate',
    defenseMetric: 'defense.explosive_play_rate_allowed',
  }),
  interceptions: Object.freeze({
    offenseMetric: 'offense.interception_rate',
    defenseMetric: 'defense.interception_forced_rate',
  }),
  fumbles: Object.freeze({
    offenseMetric: 'offense.fumble_rate',
    defenseMetric: 'defense.fumble_forced_rate',
  }),
});

const COVERAGE_TOLERANCE = 1e-12;
const ZERO_TOLERANCE = 1e-12;
const RESIDUAL_CENTER_TOLERANCE = 1e-10;
const EXPECTED_RESIDUAL_POINTS = 201;
const EXPECTED_COVERAGE_THRESHOLD = 0.85;
const EXPECTED_ITERATIONS = 10000;
const APPROVED_CERTIFICATION_STATUS = 'approved-for-phase-4d-implementation';
const APPROVED_EXCEPTION_DISPOSITION = 'FAIL — FORMALLY ACCEPTED';
const APPROVED_EXCEPTION_IDS = Object.freeze([
  'expectedCalibrationError',
  'maximumEligibleBinGap',
]);
const APPROVED_EXCEPTION_THRESHOLDS = Object.freeze({
  expectedCalibrationError: 0.04,
  maximumEligibleBinGap: 0.08,
});
const APPROVED_MONITORING = Object.freeze({
  season: 2026,
  interimMinimumEligibleBinaryGames: 200,
  minimumEligibleCalibrationBinGames: 40,
});

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

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

function addIssue(issues, path, rule, message) {
  issues.push(Object.freeze({ path, rule, message }));
}

function validateNoNullOrNonfinite(value, path, issues, visited = new Set()) {
  if (value === null || value === undefined) {
    addIssue(issues, path, 'REQUIRED', 'A required configuration value is missing.');
    return;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    addIssue(issues, path, 'FINITE_NUMBER', 'Configuration numbers must be finite.');
    return;
  }
  if (typeof value !== 'object') {
    return;
  }
  if (visited.has(value)) {
    addIssue(issues, path, 'ACYCLIC', 'Configuration values must not contain cycles.');
    return;
  }
  visited.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      validateNoNullOrNonfinite(entry, `${path}[${index}]`, issues, visited);
    });
  } else {
    Object.entries(value).forEach(([key, entry]) => {
      validateNoNullOrNonfinite(entry, `${path}.${key}`, issues, visited);
    });
  }
  visited.delete(value);
}

function validateRequiredObject(value, path, issues) {
  if (!isPlainObject(value)) {
    addIssue(issues, path, 'OBJECT', 'A plain object is required.');
    return false;
  }
  return true;
}

function validateFiniteField(value, path, issues, predicate = () => true, message = '') {
  if (!isFiniteNumber(value)) {
    addIssue(issues, path, 'FINITE_NUMBER', 'A finite number is required.');
    return false;
  }
  if (!predicate(value)) {
    addIssue(issues, path, 'VALUE', message || 'The numeric value is outside its allowed range.');
    return false;
  }
  return true;
}

function toCatalogMap(metricCatalog, issues) {
  let entries;
  if (Array.isArray(metricCatalog)) {
    entries = metricCatalog;
  } else if (isPlainObject(metricCatalog) && Array.isArray(metricCatalog.metrics)) {
    entries = metricCatalog.metrics;
  } else if (isPlainObject(metricCatalog)) {
    entries = Object.entries(metricCatalog).map(([id, metadata]) => ({
      ...(isPlainObject(metadata) ? metadata : {}),
      id: isPlainObject(metadata) && isNonEmptyString(metadata.id) ? metadata.id : id,
    }));
  } else {
    addIssue(issues, 'metricCatalog', 'CATALOG', 'The metric catalog must be an array or plain object.');
    return new Map();
  }

  const catalog = new Map();
  entries.forEach((entry, index) => {
    const path = `metricCatalog[${index}]`;
    if (!isPlainObject(entry)) {
      addIssue(issues, path, 'CATALOG_ENTRY', 'Each metric catalog entry must be a plain object.');
      return;
    }
    if (!isNonEmptyString(entry.id)) {
      addIssue(issues, `${path}.id`, 'METRIC_ID', 'A nonempty metric ID is required.');
      return;
    }
    if (catalog.has(entry.id)) {
      addIssue(issues, `${path}.id`, 'UNIQUE', 'Metric catalog IDs must be unique.');
      return;
    }
    if (typeof entry.higherIsBetter !== 'boolean') {
      addIssue(
        issues,
        `${path}.higherIsBetter`,
        'DIRECTION',
        'Metric catalog entries require a Boolean strength direction.',
      );
    }
    if (!isNonEmptyString(entry.unit)) {
      addIssue(issues, `${path}.unit`, 'UNIT', 'Metric catalog entries require a nonempty unit.');
    }
    catalog.set(entry.id, entry);
  });
  return catalog;
}

function validateAppConfig(appConfig, modelConfig, issues) {
  if (!validateRequiredObject(appConfig, 'appConfig', issues)) {
    return;
  }

  const schemaVersion = appConfig.schemaVersion ?? appConfig.dataset?.schemaVersion;
  if (!isNonEmptyString(schemaVersion)) {
    addIssue(
      issues,
      'appConfig.schemaVersion',
      'SCHEMA_VERSION',
      'The application configuration must declare a dataset schema version.',
    );
  } else if (schemaVersion !== modelConfig?.sourceData?.schemaVersion) {
    addIssue(
      issues,
      'appConfig.schemaVersion',
      'SCHEMA_COMPATIBILITY',
      'Application and model schema versions must match.',
    );
  }

  if (!Array.isArray(appConfig.scenarios)) {
    addIssue(
      issues,
      'appConfig.scenarios',
      'SCENARIOS',
      'The application configuration must declare the five active scenarios.',
    );
    return;
  }

  if (appConfig.scenarios.length !== APPROVED_SCENARIOS.length) {
    addIssue(
      issues,
      'appConfig.scenarios',
      'SCENARIO_COUNT',
      'Exactly five Version 1 scenarios are required.',
    );
  }
  const scenarioIds = new Set();
  appConfig.scenarios.forEach((scenario, index) => {
    const path = `appConfig.scenarios[${index}]`;
    if (!isPlainObject(scenario)) {
      addIssue(issues, path, 'SCENARIO', 'Each scenario must be a plain object.');
      return;
    }
    if (!isNonEmptyString(scenario.id)) {
      addIssue(issues, `${path}.id`, 'SCENARIO_ID', 'A nonempty scenario ID is required.');
    } else if (scenarioIds.has(scenario.id)) {
      addIssue(issues, `${path}.id`, 'UNIQUE', 'Scenario IDs must be unique.');
    } else {
      scenarioIds.add(scenario.id);
    }
    const approved = APPROVED_SCENARIOS[index];
    if (!approved || scenario.id !== approved.id || scenario.order !== approved.order) {
      addIssue(
        issues,
        path,
        'SCENARIO_ORDER',
        'Scenario IDs and order must match the approved Version 1 sequence.',
      );
    }
  });
}

function validateCertification(modelConfig, issues) {
  const certification = modelConfig.certification;
  if (!validateRequiredObject(certification, 'modelConfig.certification', issues)) {
    return new Map();
  }
  if (certification.status !== APPROVED_CERTIFICATION_STATUS) {
    addIssue(
      issues,
      'modelConfig.certification.status',
      'APPROVAL',
      'Only the product-owner-approved configuration may enter Phase 4D.',
    );
  }
  if (certification.productionExportAuthorized !== true) {
    addIssue(
      issues,
      'modelConfig.certification.productionExportAuthorized',
      'APPROVAL',
      'Production implementation must be explicitly authorized.',
    );
  }
  if (!isIsoDate(certification.reportApprovedDate)) {
    addIssue(
      issues,
      'modelConfig.certification.reportApprovedDate',
      'ISO_DATE',
      'A valid report approval date is required.',
    );
  }
  if (!Array.isArray(certification.acceptedExceptions)) {
    addIssue(
      issues,
      'modelConfig.certification.acceptedExceptions',
      'EXCEPTIONS',
      'The formally accepted calibration exceptions must be recorded.',
    );
    return new Map();
  }

  const exceptions = new Map();
  certification.acceptedExceptions.forEach((exception, index) => {
    const path = `modelConfig.certification.acceptedExceptions[${index}]`;
    if (!isPlainObject(exception)) {
      addIssue(issues, path, 'EXCEPTION', 'Each accepted exception must be a plain object.');
      return;
    }
    if (!APPROVED_EXCEPTION_IDS.includes(exception.criterion)) {
      addIssue(issues, `${path}.criterion`, 'EXCEPTION_ID', 'The exception criterion is not approved.');
    } else if (exceptions.has(exception.criterion)) {
      addIssue(issues, `${path}.criterion`, 'UNIQUE', 'Exception criteria must be unique.');
    } else {
      exceptions.set(exception.criterion, exception);
    }
    validateFiniteField(exception.observed, `${path}.observed`, issues);
    validateFiniteField(
      exception.threshold,
      `${path}.threshold`,
      issues,
      (value) => value > 0,
      'Exception thresholds must be greater than zero.',
    );
    if (
      APPROVED_EXCEPTION_IDS.includes(exception.criterion)
      && exception.threshold !== APPROVED_EXCEPTION_THRESHOLDS[exception.criterion]
    ) {
      addIssue(
        issues,
        `${path}.threshold`,
        'EXCEPTION_THRESHOLD',
        'The approved calibration threshold must remain unchanged.',
      );
    }
    if (exception.disposition !== APPROVED_EXCEPTION_DISPOSITION) {
      addIssue(
        issues,
        `${path}.disposition`,
        'EXCEPTION_DISPOSITION',
        'The approved failure disposition must remain explicit.',
      );
    }
    if (!isIsoDate(exception.approvedDate)) {
      addIssue(issues, `${path}.approvedDate`, 'ISO_DATE', 'A valid exception approval date is required.');
    }
  });
  if (
    exceptions.size !== APPROVED_EXCEPTION_IDS.length
    || APPROVED_EXCEPTION_IDS.some((criterion) => !exceptions.has(criterion))
  ) {
    addIssue(
      issues,
      'modelConfig.certification.acceptedExceptions',
      'EXCEPTION_SET',
      'Both approved Version 1 calibration exceptions must be preserved exactly once.',
    );
  }
  return exceptions;
}

function validateTraining(modelConfig, issues) {
  const training = modelConfig.training;
  if (!validateRequiredObject(training, 'modelConfig.training', issues)) {
    return;
  }
  for (const field of ['firstSeason', 'lastSeason', 'holdoutSeason', 'trainingGames']) {
    if (!isPositiveInteger(training[field])) {
      addIssue(
        issues,
        `modelConfig.training.${field}`,
        'POSITIVE_INTEGER',
        'Training metadata values must be positive integers.',
      );
    }
  }
  if (
    isPositiveInteger(training.firstSeason)
    && isPositiveInteger(training.lastSeason)
    && training.firstSeason > training.lastSeason
  ) {
    addIssue(
      issues,
      'modelConfig.training',
      'SEASON_ORDER',
      'The first training season cannot follow the last training season.',
    );
  }
  if (
    isPositiveInteger(training.lastSeason)
    && isPositiveInteger(training.holdoutSeason)
    && training.lastSeason >= training.holdoutSeason
  ) {
    addIssue(
      issues,
      'modelConfig.training.holdoutSeason',
      'HOLDOUT_ORDER',
      'The holdout season must follow every training season.',
    );
  }
}

function validateMetricConfiguration(modelConfig, metricCatalog, issues) {
  if (!Array.isArray(modelConfig.metricPairs) || modelConfig.metricPairs.length === 0) {
    addIssue(issues, 'modelConfig.metricPairs', 'METRIC_PAIRS', 'At least one metric pairing is required.');
    return;
  }
  const directions = validateRequiredObject(
    modelConfig.metricDirections,
    'modelConfig.metricDirections',
    issues,
  ) ? modelConfig.metricDirections : {};
  const shrinkage = validateRequiredObject(
    modelConfig.shrinkage,
    'modelConfig.shrinkage',
    issues,
  ) ? modelConfig.shrinkage : {};
  const statuses = validateRequiredObject(
    modelConfig.featureStatus,
    'modelConfig.featureStatus',
    issues,
  ) ? modelConfig.featureStatus : {};

  const pairIds = new Set();
  const usedMetricIds = new Set();
  const expectedFeatureIds = new Set();
  let coverageTotal = 0;
  let activePairCount = 0;

  modelConfig.metricPairs.forEach((pair, index) => {
    const path = `modelConfig.metricPairs[${index}]`;
    if (!isPlainObject(pair)) {
      addIssue(issues, path, 'METRIC_PAIR', 'Each metric pairing must be a plain object.');
      return;
    }
    if (!isNonEmptyString(pair.id)) {
      addIssue(issues, `${path}.id`, 'PAIR_ID', 'A nonempty pairing ID is required.');
    } else if (pairIds.has(pair.id)) {
      addIssue(issues, `${path}.id`, 'UNIQUE', 'Pairing IDs must be unique.');
    } else {
      pairIds.add(pair.id);
    }

    const approvedPairing = APPROVED_METRIC_PAIRINGS[pair.id];
    if (!approvedPairing) {
      addIssue(issues, `${path}.id`, 'PAIR_SET', 'The pairing ID is not part of the approved Version 1 set.');
    } else if (
      pair.offenseMetric !== approvedPairing.offenseMetric
      || pair.defenseMetric !== approvedPairing.defenseMetric
    ) {
      addIssue(
        issues,
        path,
        'PAIR_DEFINITION',
        'The offense and defense metrics do not match the approved pairing.',
      );
    }

    for (const [field, rolePrefix] of [
      ['offenseMetric', 'offense.'],
      ['defenseMetric', 'defense.'],
    ]) {
      const metricId = pair[field];
      if (!isNonEmptyString(metricId) || !metricId.startsWith(rolePrefix)) {
        addIssue(
          issues,
          `${path}.${field}`,
          'METRIC_ROLE',
          `The ${field} must use the ${rolePrefix} namespace.`,
        );
        continue;
      }
      if (usedMetricIds.has(metricId)) {
        addIssue(issues, `${path}.${field}`, 'UNIQUE', 'Each model metric may appear in only one pairing.');
      }
      usedMetricIds.add(metricId);

      const direction = directions[metricId];
      if (!isPlainObject(direction) || typeof direction.higherIsBetter !== 'boolean') {
        addIssue(
          issues,
          `modelConfig.metricDirections.${metricId}`,
          'DIRECTION',
          'Every paired metric requires a Boolean strength direction.',
        );
      }
      const catalogEntry = metricCatalog.get(metricId);
      if (!catalogEntry) {
        addIssue(issues, `${path}.${field}`, 'CATALOG_ID', 'The paired metric is absent from the metric catalog.');
      } else if (
        isPlainObject(direction)
        && typeof direction.higherIsBetter === 'boolean'
        && catalogEntry.higherIsBetter !== direction.higherIsBetter
      ) {
        addIssue(
          issues,
          `${path}.${field}`,
          'DIRECTION_COMPATIBILITY',
          'Model and catalog strength directions do not match.',
        );
      }

      validateFiniteField(
        shrinkage[metricId],
        `modelConfig.shrinkage.${metricId}`,
        issues,
        (value) => value > 0,
        'Selected shrinkage strengths must be greater than zero.',
      );
    }

    const offenseCatalog = metricCatalog.get(pair.offenseMetric);
    const defenseCatalog = metricCatalog.get(pair.defenseMetric);
    if (
      offenseCatalog
      && defenseCatalog
      && isNonEmptyString(offenseCatalog.unit)
      && isNonEmptyString(defenseCatalog.unit)
      && offenseCatalog.unit !== defenseCatalog.unit
    ) {
      addIssue(
        issues,
        path,
        'UNIT_COMPATIBILITY',
        'Paired offense and defense metrics must use compatible units.',
      );
    }

    validateFiniteField(
      pair.coefficient,
      `${path}.coefficient`,
      issues,
      (value) => value >= 0,
      'Strength-oriented metric coefficients must be nonnegative.',
    );
    validateFiniteField(
      pair.nominalCoverageContribution,
      `${path}.nominalCoverageContribution`,
      issues,
      (value) => value >= 0 && value <= 1,
      'Coverage contributions must be between zero and one.',
    );
    if (typeof pair.active !== 'boolean') {
      addIssue(issues, `${path}.active`, 'BOOLEAN', 'Pair activity must be Boolean.');
    } else if (pair.active) {
      activePairCount += 1;
      if (!isFiniteNumber(pair.coefficient) || pair.coefficient <= ZERO_TOLERANCE) {
        addIssue(issues, `${path}.coefficient`, 'ACTIVE_COEFFICIENT', 'Active pairings require a positive coefficient.');
      }
      if (
        isFiniteNumber(pair.nominalCoverageContribution)
        && pair.nominalCoverageContribution <= 0
      ) {
        addIssue(
          issues,
          `${path}.nominalCoverageContribution`,
          'ACTIVE_COVERAGE',
          'Active pairings require positive coverage contribution.',
        );
      }
    } else if (
      pair.coefficient !== 0
      || pair.nominalCoverageContribution !== 0
    ) {
      addIssue(
        issues,
        path,
        'INACTIVE_ZERO',
        'Inactive pairings must retain zero coefficient and zero coverage contribution.',
      );
    }
    if (isFiniteNumber(pair.nominalCoverageContribution)) {
      coverageTotal += pair.nominalCoverageContribution;
    }

    const featureId = `pairFeature.${pair.id}`;
    expectedFeatureIds.add(featureId);
    const featureStatus = statuses[featureId];
    validateFeatureStatus(
      featureStatus,
      pair.coefficient,
      `modelConfig.featureStatus.${featureId}`,
      issues,
    );
    if (
      isPlainObject(featureStatus)
      && typeof featureStatus.active === 'boolean'
      && typeof pair.active === 'boolean'
      && featureStatus.active !== pair.active
    ) {
      addIssue(
        issues,
        `modelConfig.featureStatus.${featureId}.active`,
        'ACTIVITY_COMPATIBILITY',
        'Pair and feature-status activity must match.',
      );
    }
  });

  if (activePairCount === 0) {
    addIssue(issues, 'modelConfig.metricPairs', 'ACTIVE_PAIR', 'At least one active pairing is required.');
  }
  const approvedPairIds = Object.keys(APPROVED_METRIC_PAIRINGS);
  if (
    pairIds.size !== approvedPairIds.length
    || approvedPairIds.some((pairId) => !pairIds.has(pairId))
  ) {
    addIssue(
      issues,
      'modelConfig.metricPairs',
      'PAIR_SET',
      'Every approved Version 1 metric pairing must appear exactly once.',
    );
  }
  if (Math.abs(coverageTotal - 1) > COVERAGE_TOLERANCE) {
    addIssue(
      issues,
      'modelConfig.metricPairs',
      'COVERAGE_SUM',
      'Nominal coverage contributions must sum to one within 1e-12.',
    );
  }

  for (const key of Object.keys(directions)) {
    if (!usedMetricIds.has(key)) {
      addIssue(issues, `modelConfig.metricDirections.${key}`, 'UNUSED_METRIC', 'Direction metadata contains an unpaired metric.');
    }
  }
  for (const key of Object.keys(shrinkage)) {
    if (!usedMetricIds.has(key)) {
      addIssue(issues, `modelConfig.shrinkage.${key}`, 'UNUSED_METRIC', 'Shrinkage metadata contains an unpaired metric.');
    }
  }
  return expectedFeatureIds;
}

function validateFeatureStatus(status, coefficient, path, issues) {
  if (!isPlainObject(status)) {
    addIssue(issues, path, 'FEATURE_STATUS', 'A feature-status object is required.');
    return;
  }
  for (const field of ['active', 'fixedZero', 'stronglyRegularized']) {
    if (typeof status[field] !== 'boolean') {
      addIssue(issues, `${path}.${field}`, 'BOOLEAN', 'Feature-status flags must be Boolean.');
    }
  }
  if (isFiniteNumber(coefficient) && typeof status.active === 'boolean') {
    const isActive = Math.abs(coefficient) > ZERO_TOLERANCE;
    if (status.active !== isActive) {
      addIssue(issues, `${path}.active`, 'ACTIVITY_COMPATIBILITY', 'Feature activity must match its coefficient.');
    }
  }
  if (status.fixedZero === true && coefficient !== 0) {
    addIssue(issues, `${path}.fixedZero`, 'FIXED_ZERO', 'A fixed-zero feature must retain a zero coefficient.');
  }
}

function validateSituational(modelConfig, expectedFeatureIds, issues) {
  const situational = modelConfig.situational;
  if (!validateRequiredObject(situational, 'modelConfig.situational', issues)) {
    return;
  }
  const coefficients = new Map([
    ['situational.venue', situational.venue],
    ['situational.windAbove10Pass', situational.wind?.above10Pass],
    ['situational.windAbove20Pass', situational.wind?.above20Pass],
    ['situational.rainScore', situational.precipitation?.rainScore],
    ['situational.snowScore', situational.precipitation?.snowScore],
    ['situational.travelEast', situational.travelEast],
    ['situational.restShort', situational.rest?.short],
    ['situational.restExtended', situational.rest?.extended],
    ['situational.roundWC', situational.gameType?.wildCard],
    ['situational.roundDIV', situational.gameType?.divisional],
    ['situational.roundCON', situational.gameType?.conference],
    ['situational.roundSB', situational.gameType?.superBowl],
    ['situational.momentum', situational.momentum],
    ['situational.divisionHome', situational.divisionHomeInteraction],
  ]);

  const statuses = isPlainObject(modelConfig.featureStatus)
    ? modelConfig.featureStatus
    : {};
  for (const [featureId, coefficient] of coefficients) {
    expectedFeatureIds.add(featureId);
    validateFiniteField(
      coefficient,
      `modelConfig.${featureId}`,
      issues,
    );
    validateFeatureStatus(
      statuses[featureId],
      coefficient,
      `modelConfig.featureStatus.${featureId}`,
      issues,
    );
  }

  for (const featureId of Object.keys(statuses)) {
    if (!expectedFeatureIds.has(featureId)) {
      addIssue(
        issues,
        `modelConfig.featureStatus.${featureId}`,
        'UNUSED_FEATURE',
        'Feature status contains an unknown model feature.',
      );
    }
  }
}

function validateProbabilityCalibration(modelConfig, issues) {
  const calibration = modelConfig.probabilityCalibration;
  if (!validateRequiredObject(calibration, 'modelConfig.probabilityCalibration', issues)) {
    return;
  }
  validateFiniteField(
    calibration.slope,
    'modelConfig.probabilityCalibration.slope',
    issues,
    (value) => value > 0,
    'The probability-calibration slope must be greater than zero.',
  );
  if (calibration.intercept !== 0) {
    addIssue(
      issues,
      'modelConfig.probabilityCalibration.intercept',
      'ZERO_INTERCEPT',
      'The approved calibration intercept is exactly zero.',
    );
  }
}

function validateResidualDistribution(modelConfig, issues) {
  const residuals = modelConfig.residualDistribution;
  if (!validateRequiredObject(residuals, 'modelConfig.residualDistribution', issues)) {
    return;
  }
  const probabilities = residuals.probabilities;
  const quantiles = residuals.quantiles;
  if (!Array.isArray(probabilities) || !Array.isArray(quantiles)) {
    addIssue(
      issues,
      'modelConfig.residualDistribution',
      'RESIDUAL_ARRAYS',
      'Residual probabilities and quantiles must be arrays.',
    );
    return;
  }
  if (
    probabilities.length !== quantiles.length
    || probabilities.length !== EXPECTED_RESIDUAL_POINTS
  ) {
    addIssue(
      issues,
      'modelConfig.residualDistribution',
      'RESIDUAL_LENGTH',
      'The approved residual distribution requires 201 paired points.',
    );
  }
  const length = Math.min(probabilities.length, quantiles.length);
  for (let index = 0; index < length; index += 1) {
    const probability = probabilities[index];
    const quantile = quantiles[index];
    if (!isFiniteNumber(probability) || probability <= 0 || probability >= 1) {
      addIssue(
        issues,
        `modelConfig.residualDistribution.probabilities[${index}]`,
        'PROBABILITY',
        'Residual probabilities must be finite and strictly inside (0, 1).',
      );
    }
    if (!isFiniteNumber(quantile)) {
      addIssue(
        issues,
        `modelConfig.residualDistribution.quantiles[${index}]`,
        'FINITE_NUMBER',
        'Residual quantiles must be finite.',
      );
    }
    if (index > 0) {
      if (
        isFiniteNumber(probability)
        && isFiniteNumber(probabilities[index - 1])
        && probability <= probabilities[index - 1]
      ) {
        addIssue(
          issues,
          `modelConfig.residualDistribution.probabilities[${index}]`,
          'STRICT_ORDER',
          'Residual probabilities must be strictly increasing.',
        );
      }
      if (
        isFiniteNumber(quantile)
        && isFiniteNumber(quantiles[index - 1])
        && quantile < quantiles[index - 1]
      ) {
        addIssue(
          issues,
          `modelConfig.residualDistribution.quantiles[${index}]`,
          'ORDER',
          'Residual quantiles must be nondecreasing.',
        );
      }
    }
  }

  for (let index = 0; index < Math.floor(length / 2); index += 1) {
    const mirrorIndex = length - index - 1;
    if (
      isFiniteNumber(probabilities[index])
      && isFiniteNumber(probabilities[mirrorIndex])
      && Math.abs(probabilities[index] + probabilities[mirrorIndex] - 1)
        > RESIDUAL_CENTER_TOLERANCE
    ) {
      addIssue(
        issues,
        'modelConfig.residualDistribution.probabilities',
        'RESIDUAL_SYMMETRY',
        'Mirrored residual probabilities must be symmetric.',
      );
      break;
    }
    if (
      isFiniteNumber(quantiles[index])
      && isFiniteNumber(quantiles[mirrorIndex])
      && Math.abs(quantiles[index] + quantiles[mirrorIndex])
        > RESIDUAL_CENTER_TOLERANCE
    ) {
      addIssue(
        issues,
        'modelConfig.residualDistribution.quantiles',
        'RESIDUAL_SYMMETRY',
        'Mirrored residual quantiles must be centered and symmetric.',
      );
      break;
    }
  }
  if (
    length % 2 === 1
    && isFiniteNumber(quantiles[Math.floor(length / 2)])
    && Math.abs(quantiles[Math.floor(length / 2)]) > RESIDUAL_CENTER_TOLERANCE
  ) {
    addIssue(
      issues,
      `modelConfig.residualDistribution.quantiles[${Math.floor(length / 2)}]`,
      'RESIDUAL_CENTER',
      'The center residual quantile must be zero within 1e-10.',
    );
  }
  if (
    typeof residuals.checksumSha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(residuals.checksumSha256)
  ) {
    addIssue(
      issues,
      'modelConfig.residualDistribution.checksumSha256',
      'SHA256',
      'A lowercase 64-character SHA-256 checksum is required.',
    );
  }
}

function validateSourceData(modelConfig, appConfig, issues) {
  const sourceData = modelConfig.sourceData;
  if (!validateRequiredObject(sourceData, 'modelConfig.sourceData', issues)) {
    return;
  }
  for (const field of ['provider', 'nflreadpyVersion', 'schemaVersion']) {
    if (!isNonEmptyString(sourceData[field])) {
      addIssue(issues, `modelConfig.sourceData.${field}`, 'STRING', 'A nonempty source value is required.');
    }
  }
  if (!isIsoDate(sourceData.generationDate)) {
    addIssue(issues, 'modelConfig.sourceData.generationDate', 'ISO_DATE', 'A valid generation date is required.');
  }
  for (const field of ['firstSeason', 'trainingLastSeason', 'holdoutSeason']) {
    if (!isPositiveInteger(sourceData[field])) {
      addIssue(issues, `modelConfig.sourceData.${field}`, 'POSITIVE_INTEGER', 'A positive season integer is required.');
    }
  }
  if (isPlainObject(modelConfig.training)) {
    if (sourceData.trainingLastSeason !== modelConfig.training.lastSeason) {
      addIssue(
        issues,
        'modelConfig.sourceData.trainingLastSeason',
        'TRAINING_COMPATIBILITY',
        'Source and model training-season boundaries must match.',
      );
    }
    if (sourceData.holdoutSeason !== modelConfig.training.holdoutSeason) {
      addIssue(
        issues,
        'modelConfig.sourceData.holdoutSeason',
        'HOLDOUT_COMPATIBILITY',
        'Source and model holdout seasons must match.',
      );
    }
    if (
      isPositiveInteger(sourceData.firstSeason)
      && isPositiveInteger(modelConfig.training.firstSeason)
      && sourceData.firstSeason > modelConfig.training.firstSeason
    ) {
      addIssue(
        issues,
        'modelConfig.sourceData.firstSeason',
        'SOURCE_SCOPE',
        'Source history must begin no later than final model training.',
      );
    }
  }
  const appSchema = appConfig?.schemaVersion ?? appConfig?.dataset?.schemaVersion;
  if (isNonEmptyString(appSchema) && sourceData.schemaVersion !== appSchema) {
    addIssue(
      issues,
      'modelConfig.sourceData.schemaVersion',
      'SCHEMA_COMPATIBILITY',
      'Source and application schema versions must match.',
    );
  }
}

function validateMonitoring(modelConfig, acceptedExceptions, issues) {
  const monitoring = modelConfig.monitoring;
  if (!validateRequiredObject(monitoring, 'modelConfig.monitoring', issues)) {
    return;
  }
  if (
    monitoring.season !== APPROVED_MONITORING.season
  ) {
    addIssue(
      issues,
      'modelConfig.monitoring.season',
      'MONITORING_SEASON',
      'The approved monitoring season is 2026.',
    );
  }
  for (const field of [
    'interimMinimumEligibleBinaryGames',
    'minimumEligibleCalibrationBinGames',
  ]) {
    if (!isPositiveInteger(monitoring[field])) {
      addIssue(issues, `modelConfig.monitoring.${field}`, 'POSITIVE_INTEGER', 'A positive game count is required.');
    }
    if (monitoring[field] !== APPROVED_MONITORING[field]) {
      addIssue(
        issues,
        `modelConfig.monitoring.${field}`,
        'MONITORING_MINIMUM',
        'The approved monitoring game-count minimum must remain unchanged.',
      );
    }
  }
  const eceException = acceptedExceptions.get('expectedCalibrationError');
  const gapException = acceptedExceptions.get('maximumEligibleBinGap');
  if (
    !isFiniteNumber(monitoring.expectedCalibrationErrorThreshold)
    || !eceException
    || monitoring.expectedCalibrationErrorThreshold !== eceException.threshold
  ) {
    addIssue(
      issues,
      'modelConfig.monitoring.expectedCalibrationErrorThreshold',
      'MONITORING_THRESHOLD',
      'The approved expected-calibration-error threshold must remain unchanged.',
    );
  }
  if (
    !isFiniteNumber(monitoring.maximumEligibleBinGapThreshold)
    || !gapException
    || monitoring.maximumEligibleBinGapThreshold !== gapException.threshold
  ) {
    addIssue(
      issues,
      'modelConfig.monitoring.maximumEligibleBinGapThreshold',
      'MONITORING_THRESHOLD',
      'The approved eligible-bin-gap threshold must remain unchanged.',
    );
  }
  if (monitoring.finalSeasonReviewRequired !== true) {
    addIssue(
      issues,
      'modelConfig.monitoring.finalSeasonReviewRequired',
      'MONITORING_REVIEW',
      'The required final-season calibration review must remain enabled.',
    );
  }
  if (!isNonEmptyString(monitoring.recalibrationTrigger)) {
    addIssue(
      issues,
      'modelConfig.monitoring.recalibrationTrigger',
      'MONITORING_TRIGGER',
      'The Version 1.1 recalibration trigger must remain documented.',
    );
  }
}

function freezeResult(result) {
  if (Array.isArray(result.issues)) {
    Object.freeze(result.issues);
  }
  return Object.freeze(result);
}

/**
 * Validate the complete analytical configuration without mutating any input.
 *
 * @returns {{ok: true, config: object, issues: readonly object[]} |
 *   {ok: false, code: string, issues: readonly object[]}}
 */
export function validateModelConfig({ modelConfig, metricCatalog, appConfig } = {}) {
  const issues = [];
  if (!validateRequiredObject(modelConfig, 'modelConfig', issues)) {
    return freezeResult({
      ok: false,
      code: MODEL_CONFIGURATION_INVALID,
      issues,
    });
  }

  validateNoNullOrNonfinite(modelConfig, 'modelConfig', issues);

  if (!/^v1-calibrated-\d{8}$/.test(modelConfig.modelVersion ?? '')) {
    addIssue(
      issues,
      'modelConfig.modelVersion',
      'MODEL_VERSION',
      'The model version must use v1-calibrated-YYYYMMDD.',
    );
  }
  if (!/^MCR-v1-\d{8}$/.test(modelConfig.calibrationReportId ?? '')) {
    addIssue(
      issues,
      'modelConfig.calibrationReportId',
      'REPORT_ID',
      'A Version 1 calibration-report identifier is required.',
    );
  }
  if (!isNonEmptyString(modelConfig.coefficientPrecision)) {
    addIssue(
      issues,
      'modelConfig.coefficientPrecision',
      'PRECISION',
      'Coefficient precision metadata is required.',
    );
  }
  if (modelConfig.coverageThreshold !== EXPECTED_COVERAGE_THRESHOLD) {
    addIssue(
      issues,
      'modelConfig.coverageThreshold',
      'COVERAGE_THRESHOLD',
      'The approved directional coverage threshold is exactly 0.85.',
    );
  }
  if (modelConfig.iterations !== EXPECTED_ITERATIONS) {
    addIssue(
      issues,
      'modelConfig.iterations',
      'ITERATIONS',
      'The approved Monte Carlo iteration count is exactly 10,000.',
    );
  }

  const regularization = modelConfig.selectedRegularization;
  if (validateRequiredObject(regularization, 'modelConfig.selectedRegularization', issues)) {
    validateFiniteField(
      regularization.alpha,
      'modelConfig.selectedRegularization.alpha',
      issues,
      (value) => value > 0,
      'Regularization alpha must be greater than zero.',
    );
    if (!(regularization.halfLife === 'none' || [2, 4, 6].includes(regularization.halfLife))) {
      addIssue(
        issues,
        'modelConfig.selectedRegularization.halfLife',
        'HALF_LIFE',
        'Recency half-life must be 2, 4, 6, or "none".',
      );
    }
    validateFiniteField(
      regularization.strongPenaltyMultiplier,
      'modelConfig.selectedRegularization.strongPenaltyMultiplier',
      issues,
      (value) => value > 1,
      'Strong-penalty multiplier must exceed one.',
    );
  }

  const acceptedExceptions = validateCertification(modelConfig, issues);
  validateTraining(modelConfig, issues);
  const catalog = toCatalogMap(metricCatalog, issues);
  const expectedFeatureIds = new Set();
  if (catalog.size > 0) {
    const pairFeatureIds = validateMetricConfiguration(modelConfig, catalog, issues);
    pairFeatureIds.forEach((featureId) => expectedFeatureIds.add(featureId));
  } else if (Array.isArray(modelConfig.metricPairs)) {
    modelConfig.metricPairs.forEach((pair) => {
      if (isPlainObject(pair) && isNonEmptyString(pair.id)) {
        expectedFeatureIds.add(`pairFeature.${pair.id}`);
      }
    });
  }
  validateSituational(modelConfig, expectedFeatureIds, issues);
  validateProbabilityCalibration(modelConfig, issues);
  validateResidualDistribution(modelConfig, issues);
  validateSourceData(modelConfig, appConfig, issues);
  validateMonitoring(modelConfig, acceptedExceptions, issues);
  validateAppConfig(appConfig, modelConfig, issues);

  if (issues.length > 0) {
    return freezeResult({
      ok: false,
      code: MODEL_CONFIGURATION_INVALID,
      issues,
    });
  }
  return freezeResult({ ok: true, config: modelConfig, issues });
}

export default validateModelConfig;
