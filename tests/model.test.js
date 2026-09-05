import MODEL_CONFIG from '../js/config/model-config.js';
import {
  APPROVED_SCENARIOS,
  MODEL_CONFIGURATION_INVALID,
  validateModelConfig,
} from '../js/model/model-config-validator.js';
import {
  COVERAGE_TOLERANCE,
  PAIR_UNAVAILABLE_REASON,
  evaluateCoverage,
} from '../js/model/coverage.js';
import { calculateBaseMatchup } from '../js/model/matchup-model.js';
import { logistic } from '../js/core/math.js';
import { toWinProbabilities } from '../js/model/probability-model.js';
import {
  APPROVED_MONTE_CARLO_ITERATIONS,
  simulateDistribution,
  summarizeDistribution,
} from '../js/model/monte-carlo.js';
import {
  assert,
  assertApprox,
  assertDeepEqual,
  assertEqual,
  assertThrows,
  runRegisteredTests,
  test,
} from './test-utils.js';

const UNIT_BY_PAIR_ID = Object.freeze({
  pass_efficiency: 'epa-per-dropback',
  rush_efficiency: 'epa-per-rush',
  success_rate: 'rate',
  pressure: 'rate',
  explosiveness: 'rate',
  interceptions: 'rate',
  fumbles: 'rate',
});

const APP_CONFIG_FIXTURE = Object.freeze({
  schemaVersion: '1.0.0',
  scenarios: APPROVED_SCENARIOS,
});

const METRIC_CATALOG_FIXTURE = Object.freeze(Object.fromEntries(
  MODEL_CONFIG.metricPairs.flatMap((pair) => [
    [
      pair.offenseMetric,
      Object.freeze({
        id: pair.offenseMetric,
        unit: UNIT_BY_PAIR_ID[pair.id],
        higherIsBetter: MODEL_CONFIG.metricDirections[pair.offenseMetric].higherIsBetter,
      }),
    ],
    [
      pair.defenseMetric,
      Object.freeze({
        id: pair.defenseMetric,
        unit: UNIT_BY_PAIR_ID[pair.id],
        higherIsBetter: MODEL_CONFIG.metricDirections[pair.defenseMetric].higherIsBetter,
      }),
    ],
  ]),
));

function createTeam(teamId, defaultValue = 0) {
  return {
    teamId,
    metrics: Object.fromEntries(MODEL_CONFIG.metricPairs.flatMap((pair) => [
      [pair.offenseMetric, { value: defaultValue, rank: 1, sampleSize: 100 }],
      [pair.defenseMetric, { value: defaultValue, rank: 1, sampleSize: 100 }],
    ])),
  };
}

function createLeagueMetrics(mean = 0, standardDeviation = 1) {
  return {
    status: 'ready',
    metrics: Object.fromEntries(MODEL_CONFIG.metricPairs.flatMap((pair) => [
      [pair.offenseMetric, {
        usable: true,
        mean,
        standardDeviation,
        validCount: 32,
        distinctValueCount: 32,
      }],
      [pair.defenseMetric, {
        usable: true,
        mean,
        standardDeviation,
        validCount: 32,
        distinctValueCount: 32,
      }],
    ])),
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function validate(modelConfig = MODEL_CONFIG, overrides = {}) {
  return validateModelConfig({
    modelConfig,
    metricCatalog: overrides.metricCatalog ?? METRIC_CATALOG_FIXTURE,
    appConfig: overrides.appConfig ?? APP_CONFIG_FIXTURE,
  });
}

function assertIssue(result, pathPrefix, rule) {
  assertEqual(result.ok, false, 'Invalid configuration must fail closed.');
  assertEqual(result.code, MODEL_CONFIGURATION_INVALID, 'Stable configuration error code is required.');
  assert(
    result.issues.some(
      (issue) => issue.path.startsWith(pathPrefix) && issue.rule === rule,
    ),
    `Expected ${rule} issue at ${pathPrefix}.`,
  );
}

function isDeeplyFrozen(value, visited = new Set()) {
  if (value === null || typeof value !== 'object' || visited.has(value)) {
    return true;
  }
  visited.add(value);
  return Object.isFrozen(value)
    && Object.values(value).every((nested) => isDeeplyFrozen(nested, visited));
}

test('approved production configuration passes complete validation', () => {
  const result = validate();
  assertEqual(result.ok, true);
  assertEqual(result.config, MODEL_CONFIG, 'Validator must return the same approved object.');
  assertEqual(result.issues.length, 0);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.issues));
});

test('model configuration is lossless, exact, and deeply frozen', () => {
  assertEqual(MODEL_CONFIG.modelVersion, 'v1-calibrated-20260903');
  assertEqual(MODEL_CONFIG.calibrationReportId, 'MCR-v1-20260903');
  assertEqual(MODEL_CONFIG.certification.productionExportAuthorized, true);
  assertEqual(MODEL_CONFIG.metricPairs.length, 7);
  assertEqual(Object.keys(MODEL_CONFIG.featureStatus).length, 21);
  assertEqual(MODEL_CONFIG.residualDistribution.probabilities.length, 201);
  assertEqual(MODEL_CONFIG.residualDistribution.quantiles.length, 201);
  assertEqual(
    MODEL_CONFIG.residualDistribution.checksumSha256,
    '5130eb5efb8e8ea653b82041a2898297c441dd1fc9f20c1b6174a77881f8bc70',
  );
  assertApprox(MODEL_CONFIG.probabilityCalibration.slope, 0.1205288732344612, 0);
  assert(isDeeplyFrozen(MODEL_CONFIG), 'Every nested configuration value must be frozen.');
});

test('validation is pure and does not mutate supplied inputs', () => {
  const modelConfig = clone(MODEL_CONFIG);
  const metricCatalog = clone(METRIC_CATALOG_FIXTURE);
  const appConfig = clone(APP_CONFIG_FIXTURE);
  const before = JSON.stringify({ modelConfig, metricCatalog, appConfig });
  const result = validateModelConfig({ modelConfig, metricCatalog, appConfig });
  assertEqual(result.ok, true);
  assertEqual(
    JSON.stringify({ modelConfig, metricCatalog, appConfig }),
    before,
    'Validator must not mutate any input.',
  );
});

test('unapproved or nonproduction certification fails closed', () => {
  const pending = clone(MODEL_CONFIG);
  pending.certification.status = 'pending-product-owner-report-approval';
  pending.certification.productionExportAuthorized = false;
  const result = validate(pending);
  assertIssue(result, 'modelConfig.certification.status', 'APPROVAL');
  assertIssue(
    result,
    'modelConfig.certification.productionExportAuthorized',
    'APPROVAL',
  );
});

test('both formally accepted failures and monitoring thresholds are mandatory', () => {
  const missingException = clone(MODEL_CONFIG);
  missingException.certification.acceptedExceptions.pop();
  assertIssue(
    validate(missingException),
    'modelConfig.certification.acceptedExceptions',
    'EXCEPTION_SET',
  );

  const weakenedThreshold = clone(MODEL_CONFIG);
  weakenedThreshold.monitoring.maximumEligibleBinGapThreshold = 0.2;
  assertIssue(
    validate(weakenedThreshold),
    'modelConfig.monitoring.maximumEligibleBinGapThreshold',
    'MONITORING_THRESHOLD',
  );

  const coordinatedWeakening = clone(MODEL_CONFIG);
  coordinatedWeakening.certification.acceptedExceptions[1].threshold = 0.2;
  coordinatedWeakening.monitoring.maximumEligibleBinGapThreshold = 0.2;
  assertIssue(
    validate(coordinatedWeakening),
    'modelConfig.certification.acceptedExceptions[1].threshold',
    'EXCEPTION_THRESHOLD',
  );

  const reducedMonitoringMinimum = clone(MODEL_CONFIG);
  reducedMonitoringMinimum.monitoring.interimMinimumEligibleBinaryGames = 1;
  assertIssue(
    validate(reducedMonitoringMinimum),
    'modelConfig.monitoring.interimMinimumEligibleBinaryGames',
    'MONITORING_MINIMUM',
  );
});

test('catalog identity, direction, and unit mismatches are rejected', () => {
  const missingCatalogMetric = clone(METRIC_CATALOG_FIXTURE);
  delete missingCatalogMetric['offense.pass_epa_per_dropback'];
  assertIssue(
    validate(MODEL_CONFIG, { metricCatalog: missingCatalogMetric }),
    'modelConfig.metricPairs[0].offenseMetric',
    'CATALOG_ID',
  );

  const wrongDirection = clone(METRIC_CATALOG_FIXTURE);
  wrongDirection['offense.pass_epa_per_dropback'].higherIsBetter = false;
  assertIssue(
    validate(MODEL_CONFIG, { metricCatalog: wrongDirection }),
    'modelConfig.metricPairs[0].offenseMetric',
    'DIRECTION_COMPATIBILITY',
  );

  const wrongUnit = clone(METRIC_CATALOG_FIXTURE);
  wrongUnit['defense.pass_epa_allowed_per_dropback'].unit = 'rate';
  assertIssue(
    validate(MODEL_CONFIG, { metricCatalog: wrongUnit }),
    'modelConfig.metricPairs[0]',
    'UNIT_COMPATIBILITY',
  );
});

test('pair IDs, activity, coefficients, and coverage contributions stay coherent', () => {
  const badCoverage = clone(MODEL_CONFIG);
  badCoverage.metricPairs[0].nominalCoverageContribution += 0.01;
  assertIssue(validate(badCoverage), 'modelConfig.metricPairs', 'COVERAGE_SUM');

  const inactiveNonzero = clone(MODEL_CONFIG);
  const fumbles = inactiveNonzero.metricPairs.find((pair) => pair.id === 'fumbles');
  fumbles.coefficient = 0.1;
  assertIssue(
    validate(inactiveNonzero),
    'modelConfig.metricPairs[6]',
    'INACTIVE_ZERO',
  );

  const duplicate = clone(MODEL_CONFIG);
  duplicate.metricPairs[1].id = duplicate.metricPairs[0].id;
  assertIssue(validate(duplicate), 'modelConfig.metricPairs[1].id', 'UNIQUE');

  const missingPair = clone(MODEL_CONFIG);
  missingPair.metricPairs.pop();
  delete missingPair.metricDirections['offense.fumble_rate'];
  delete missingPair.metricDirections['defense.fumble_forced_rate'];
  delete missingPair.shrinkage['offense.fumble_rate'];
  delete missingPair.shrinkage['defense.fumble_forced_rate'];
  delete missingPair.featureStatus['pairFeature.fumbles'];
  assertIssue(validate(missingPair), 'modelConfig.metricPairs', 'PAIR_SET');

  const repairedPair = clone(MODEL_CONFIG);
  repairedPair.metricPairs[0].defenseMetric = 'defense.rush_epa_allowed_per_attempt';
  assertIssue(
    validate(repairedPair),
    'modelConfig.metricPairs[0]',
    'PAIR_DEFINITION',
  );
});

test('probability calibration requires a positive slope and zero intercept', () => {
  const badSlope = clone(MODEL_CONFIG);
  badSlope.probabilityCalibration.slope = 0;
  assertIssue(
    validate(badSlope),
    'modelConfig.probabilityCalibration.slope',
    'VALUE',
  );

  const badIntercept = clone(MODEL_CONFIG);
  badIntercept.probabilityCalibration.intercept = 0.01;
  assertIssue(
    validate(badIntercept),
    'modelConfig.probabilityCalibration.intercept',
    'ZERO_INTERCEPT',
  );
});

test('residual arrays require exact length, order, symmetry, center, and checksum form', () => {
  const wrongLength = clone(MODEL_CONFIG);
  wrongLength.residualDistribution.probabilities.pop();
  assertIssue(
    validate(wrongLength),
    'modelConfig.residualDistribution',
    'RESIDUAL_LENGTH',
  );

  const wrongOrder = clone(MODEL_CONFIG);
  wrongOrder.residualDistribution.probabilities[1]
    = wrongOrder.residualDistribution.probabilities[0];
  assertIssue(
    validate(wrongOrder),
    'modelConfig.residualDistribution.probabilities[1]',
    'STRICT_ORDER',
  );

  const wrongSymmetry = clone(MODEL_CONFIG);
  wrongSymmetry.residualDistribution.quantiles[0] += 1;
  assertIssue(
    validate(wrongSymmetry),
    'modelConfig.residualDistribution.quantiles',
    'RESIDUAL_SYMMETRY',
  );

  const wrongChecksum = clone(MODEL_CONFIG);
  wrongChecksum.residualDistribution.checksumSha256 = 'invalid';
  assertIssue(
    validate(wrongChecksum),
    'modelConfig.residualDistribution.checksumSha256',
    'SHA256',
  );
});

test('situational coefficients and feature status cannot diverge', () => {
  const wrongActivity = clone(MODEL_CONFIG);
  wrongActivity.featureStatus['situational.venue'].active = false;
  assertIssue(
    validate(wrongActivity),
    'modelConfig.featureStatus.situational.venue.active',
    'ACTIVITY_COMPATIBILITY',
  );

  const fixedZeroViolation = clone(MODEL_CONFIG);
  fixedZeroViolation.situational.gameType.wildCard = 0.1;
  assertIssue(
    validate(fixedZeroViolation),
    'modelConfig.featureStatus.situational.roundWC.fixedZero',
    'FIXED_ZERO',
  );
});

test('application schema and the five approved scenarios are enforced', () => {
  const wrongSchema = clone(APP_CONFIG_FIXTURE);
  wrongSchema.schemaVersion = '2.0.0';
  assertIssue(
    validate(MODEL_CONFIG, { appConfig: wrongSchema }),
    'modelConfig.sourceData.schemaVersion',
    'SCHEMA_COMPATIBILITY',
  );

  const wrongScenarioOrder = clone(APP_CONFIG_FIXTURE);
  [wrongScenarioOrder.scenarios[0], wrongScenarioOrder.scenarios[1]] = [
    wrongScenarioOrder.scenarios[1],
    wrongScenarioOrder.scenarios[0],
  ];
  assertIssue(
    validate(MODEL_CONFIG, { appConfig: wrongScenarioOrder }),
    'appConfig.scenarios[0]',
    'SCENARIO_ORDER',
  );
});

test('missing, null, and nonfinite values fail visibly', () => {
  assertIssue(validateModelConfig(), 'modelConfig', 'OBJECT');

  const nullCoefficient = clone(MODEL_CONFIG);
  nullCoefficient.metricPairs[0].coefficient = null;
  assertIssue(
    validate(nullCoefficient),
    'modelConfig.metricPairs[0].coefficient',
    'REQUIRED',
  );

  const infiniteCoefficient = clone(MODEL_CONFIG);
  infiniteCoefficient.metricPairs[0].coefficient = Number.POSITIVE_INFINITY;
  assertIssue(
    validate(infiniteCoefficient),
    'modelConfig.metricPairs[0].coefficient',
    'FINITE_NUMBER',
  );
});

test('accepted configuration keeps every analytical gate exact', () => {
  const activeCoverage = MODEL_CONFIG.metricPairs.reduce(
    (sum, pair) => sum + pair.nominalCoverageContribution,
    0,
  );
  assertApprox(activeCoverage, 1, 1e-12);
  assertEqual(MODEL_CONFIG.coverageThreshold, 0.85);
  assertEqual(MODEL_CONFIG.iterations, 10000);
  assertEqual(MODEL_CONFIG.probabilityCalibration.intercept, 0);
  assertEqual(MODEL_CONFIG.certification.acceptedExceptions.length, 2);
  assertDeepEqual(
    MODEL_CONFIG.certification.acceptedExceptions.map(({ criterion, disposition }) => ({
      criterion,
      disposition,
    })),
    [
      {
        criterion: 'expectedCalibrationError',
        disposition: 'FAIL — FORMALLY ACCEPTED',
      },
      {
        criterion: 'maximumEligibleBinGap',
        disposition: 'FAIL — FORMALLY ACCEPTED',
      },
    ],
  );
});

test('complete directional evidence produces full coverage and nominal coefficients', () => {
  const result = evaluateCoverage({
    offenseTeam: createTeam('AAA'),
    defenseTeam: createTeam('BBB'),
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });

  assertEqual(result.eligible, true);
  assertEqual(result.status, 'eligible');
  assertEqual(result.coverage, 1);
  assertEqual(result.normalizationFactor, 1);
  assertEqual(result.activePairCount, 6);
  assertEqual(result.availablePairCount, 6);
  assertEqual(result.availablePairIds.length, 6);
  assertEqual(result.unavailablePairIds.length, 0);
  result.pairs.filter((pair) => pair.active).forEach((pair) => {
    assertEqual(pair.effectiveCoefficient, pair.coefficient);
  });
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.pairs));
  assert(Object.isFrozen(result.pairs[0]));
});

test('legitimate zero remains available while null removes only its pairing', () => {
  const offenseTeam = createTeam('AAA');
  const defenseTeam = createTeam('BBB');
  offenseTeam.metrics['offense.pass_epa_per_dropback'].value = 0;

  const withZero = evaluateCoverage({
    offenseTeam,
    defenseTeam,
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });
  assertEqual(withZero.coverage, 1);
  assertEqual(withZero.pairs[0].offenseValue, 0);

  offenseTeam.metrics['offense.explosive_play_rate'].value = null;
  const withNull = evaluateCoverage({
    offenseTeam,
    defenseTeam,
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });
  const explosive = MODEL_CONFIG.metricPairs.find((pair) => pair.id === 'explosiveness');
  assertApprox(withNull.coverage, 1 - explosive.nominalCoverageContribution, 1e-12);
  assertDeepEqual(withNull.unavailablePairIds, ['explosiveness']);
  assertDeepEqual(
    withNull.pairs.find((pair) => pair.id === 'explosiveness').unavailableReasons,
    [PAIR_UNAVAILABLE_REASON.OFFENSE_VALUE],
  );
});

test('an unusable role-specific league distribution removes that pairing', () => {
  const leagueMetrics = createLeagueMetrics();
  leagueMetrics.metrics['defense.pressure_generated_rate'].usable = false;
  const result = evaluateCoverage({
    offenseTeam: createTeam('AAA'),
    defenseTeam: createTeam('BBB'),
    leagueMetrics,
    modelConfig: MODEL_CONFIG,
  });
  const pressure = MODEL_CONFIG.metricPairs.find((pair) => pair.id === 'pressure');

  assertApprox(result.coverage, 1 - pressure.nominalCoverageContribution, 1e-12);
  assertDeepEqual(result.unavailablePairIds, ['pressure']);
  assertDeepEqual(
    result.pairs.find((pair) => pair.id === 'pressure').unavailableReasons,
    [PAIR_UNAVAILABLE_REASON.DEFENSE_DISTRIBUTION],
  );
});

test('coverage below 85 percent blocks output and exposes no effective coefficients', () => {
  const offenseTeam = createTeam('AAA');
  offenseTeam.metrics['offense.interception_rate'].value = null;
  const result = evaluateCoverage({
    offenseTeam,
    defenseTeam: createTeam('BBB'),
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });

  assertEqual(result.eligible, false);
  assertEqual(result.status, 'insufficient-data');
  assert(result.coverage < MODEL_CONFIG.coverageThreshold);
  assertEqual(result.normalizationFactor, null);
  result.pairs.forEach((pair) => assertEqual(pair.effectiveCoefficient, 0));
});

test('eligible partial coverage renormalizes only available coefficients', () => {
  const offenseTeam = createTeam('AAA');
  offenseTeam.metrics['offense.explosive_play_rate'].value = null;
  const result = evaluateCoverage({
    offenseTeam,
    defenseTeam: createTeam('BBB'),
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });
  const expectedCoverage = 1 - MODEL_CONFIG.metricPairs.find(
    (pair) => pair.id === 'explosiveness',
  ).nominalCoverageContribution;

  assertEqual(result.eligible, true);
  assertApprox(result.coverage, expectedCoverage, 1e-12);
  result.pairs.forEach((pair) => {
    const expected = pair.available ? pair.coefficient / expectedCoverage : 0;
    assertApprox(pair.effectiveCoefficient, expected, 1e-12);
  });

  const exactGateConfig = clone(MODEL_CONFIG);
  exactGateConfig.coverageThreshold = expectedCoverage + (COVERAGE_TOLERANCE / 2);
  assertEqual(evaluateCoverage({
    offenseTeam,
    defenseTeam: createTeam('BBB'),
    leagueMetrics: createLeagueMetrics(),
    modelConfig: exactGateConfig,
  }).eligible, true, 'Coverage tolerance must make the threshold inclusive.');

  exactGateConfig.coverageThreshold = expectedCoverage + (COVERAGE_TOLERANCE * 2);
  assertEqual(evaluateCoverage({
    offenseTeam,
    defenseTeam: createTeam('BBB'),
    leagueMetrics: createLeagueMetrics(),
    modelConfig: exactGateConfig,
  }).eligible, false, 'Coverage outside the approved tolerance must fail.');
});

test('base matchup evaluates the two directional coverages independently', () => {
  const teamA = createTeam('AAA');
  const teamB = createTeam('BBB');
  teamA.metrics['offense.interception_rate'].value = null;
  const result = calculateBaseMatchup({
    teamA,
    teamB,
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });

  assertEqual(result.eligible, false);
  assertEqual(result.status, 'insufficient-data');
  assertEqual(result.scoreDelta, null);
  assertEqual(result.teamAOffenseVsTeamBDefense.eligible, false);
  assertEqual(result.teamBOffenseVsTeamADefense.eligible, true);
  assertDeepEqual(
    result.insufficientDirections,
    ['team-a-offense-vs-team-b-defense'],
  );
});

test('deterministic base score matches a hand-calculated pass contribution', () => {
  const teamA = createTeam('AAA');
  const teamB = createTeam('BBB');
  teamA.metrics['offense.pass_epa_per_dropback'].value = 1;
  const result = calculateBaseMatchup({
    teamA,
    teamB,
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });
  const passPair = MODEL_CONFIG.metricPairs.find((pair) => pair.id === 'pass_efficiency');
  const passContribution = result.teamAOffenseVsTeamBDefense.contributions.find(
    (contribution) => contribution.pairId === 'pass_efficiency',
  );

  assertEqual(result.eligible, true);
  assertApprox(passContribution.offenseZScore, 1, 1e-12);
  assertApprox(passContribution.defenseZScore, 0, 1e-12);
  assertApprox(passContribution.matchupFeature, 1, 1e-12);
  assertApprox(passContribution.contribution, passPair.coefficient, 1e-12);
  assertApprox(result.teamAOffenseVsTeamBDefense.score, passPair.coefficient, 1e-12);
  assertApprox(result.scoreDelta, passPair.coefficient, 1e-12);
});

test('lower-is-better metrics are strength-oriented before differencing', () => {
  const teamA = createTeam('AAA');
  const teamB = createTeam('BBB');
  teamA.metrics['offense.pressure_allowed_rate'].value = -1;
  const result = calculateBaseMatchup({
    teamA,
    teamB,
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });
  const pressure = result.teamAOffenseVsTeamBDefense.contributions.find(
    (contribution) => contribution.pairId === 'pressure',
  );

  assertApprox(pressure.offenseZScore, 1, 1e-12);
  assertApprox(pressure.defenseZScore, 0, 1e-12);
  assert(pressure.contribution > 0, 'Allowing less pressure must favor the offense.');
});

test('directional scores equal their available contribution sums', () => {
  const teamA = createTeam('AAA', 0.25);
  const teamB = createTeam('BBB', -0.25);
  const result = calculateBaseMatchup({
    teamA,
    teamB,
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });

  for (const direction of [
    result.teamAOffenseVsTeamBDefense,
    result.teamBOffenseVsTeamADefense,
  ]) {
    const sum = direction.contributions.reduce(
      (total, contribution) => total + (contribution.contribution ?? 0),
      0,
    );
    assertApprox(direction.score, sum, 1e-12);
  }
  assertApprox(
    result.scoreDelta,
    result.teamAOffenseVsTeamBDefense.score
      - result.teamBOffenseVsTeamADefense.score,
    1e-12,
  );
});

test('swapping teams negates the deterministic score delta', () => {
  const teamA = createTeam('AAA', 0.3);
  const teamB = createTeam('BBB', -0.2);
  const leagueMetrics = createLeagueMetrics(0.05, 0.4);
  const original = calculateBaseMatchup({
    teamA,
    teamB,
    leagueMetrics,
    modelConfig: MODEL_CONFIG,
  });
  const swapped = calculateBaseMatchup({
    teamA: teamB,
    teamB: teamA,
    leagueMetrics,
    modelConfig: MODEL_CONFIG,
  });

  assertApprox(original.scoreDelta, -swapped.scoreDelta, 1e-12);
});

test('coverage and matchup calculations do not mutate inputs and deeply freeze outputs', () => {
  const teamA = createTeam('AAA', 0.1);
  const teamB = createTeam('BBB', -0.1);
  const leagueMetrics = createLeagueMetrics();
  const before = JSON.stringify({ teamA, teamB, leagueMetrics });
  const result = calculateBaseMatchup({
    teamA,
    teamB,
    leagueMetrics,
    modelConfig: MODEL_CONFIG,
  });

  assertEqual(JSON.stringify({ teamA, teamB, leagueMetrics }), before);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.teamAOffenseVsTeamBDefense));
  assert(Object.isFrozen(result.teamAOffenseVsTeamBDefense.coverage));
  assert(Object.isFrozen(result.teamAOffenseVsTeamBDefense.contributions));
  assert(Object.isFrozen(result.teamAOffenseVsTeamBDefense.contributions[0]));
});

test('invalid calculation contracts fail closed with explicit exceptions', () => {
  assertThrows(
    () => evaluateCoverage(),
    'offenseTeam must be a team object',
  );
  assertThrows(
    () => evaluateCoverage({
      offenseTeam: createTeam('AAA'),
      defenseTeam: createTeam('BBB'),
      leagueMetrics: null,
      modelConfig: MODEL_CONFIG,
    }),
    'leagueMetrics must be a plain object',
  );
  assertThrows(
    () => calculateBaseMatchup({
      teamA: createTeam('AAA'),
      teamB: createTeam('AAA'),
      leagueMetrics: createLeagueMetrics(),
      modelConfig: MODEL_CONFIG,
    }),
    'different teams',
  );

  const invalidDistribution = createLeagueMetrics();
  invalidDistribution.metrics['offense.pass_epa_per_dropback'].standardDeviation = 0;
  const result = evaluateCoverage({
    offenseTeam: createTeam('AAA'),
    defenseTeam: createTeam('BBB'),
    leagueMetrics: invalidDistribution,
    modelConfig: MODEL_CONFIG,
  });
  assertDeepEqual(result.unavailablePairIds, ['pass_efficiency']);
});

test('stable logistic primitive returns approved mathematical values', () => {
  assertEqual(logistic(0), 0.5);
  assertApprox(logistic(Math.log(3)), 0.75, 1e-15);
  assertApprox(logistic(-Math.log(3)), 0.25, 1e-15);
});

test('zero latent score produces exactly neutral complementary probabilities', () => {
  const result = toWinProbabilities({
    scoreDelta: 0,
    calibration: MODEL_CONFIG.probabilityCalibration,
  });

  assertEqual(result.calibratedScore, 0);
  assertEqual(result.teamAProbability, 0.5);
  assertEqual(result.teamBProbability, 0.5);
});

test('approved full-precision slope calibrates positive and negative scores symmetrically', () => {
  const scoreDelta = 4.25;
  const positive = toWinProbabilities({
    scoreDelta,
    calibration: MODEL_CONFIG.probabilityCalibration,
  });
  const negative = toWinProbabilities({
    scoreDelta: -scoreDelta,
    calibration: MODEL_CONFIG.probabilityCalibration,
  });
  const expected = 1 / (
    1 + Math.exp(-(MODEL_CONFIG.probabilityCalibration.slope * scoreDelta))
  );

  assertEqual(
    positive.calibrationSlope,
    0.1205288732344612,
    'The certified slope must retain full precision.',
  );
  assertApprox(positive.teamAProbability, expected, 1e-15);
  assertApprox(positive.teamAProbability, 1 - negative.teamAProbability, 1e-15);
  assertApprox(positive.teamBProbability, negative.teamAProbability, 1e-15);
});

test('Team B probability is always derived as the exact Team A complement', () => {
  for (const scoreDelta of [-50, -7.5, -0.01, 0, 0.01, 7.5, 50]) {
    const result = toWinProbabilities({
      scoreDelta,
      calibration: MODEL_CONFIG.probabilityCalibration,
    });
    assertEqual(result.teamBProbability, 1 - result.teamAProbability);
    assertApprox(result.teamAProbability + result.teamBProbability, 1, 0);
  }
});

test('probability calibration remains finite at extreme scores without artificial caps', () => {
  const high = toWinProbabilities({
    scoreDelta: Number.MAX_VALUE,
    calibration: MODEL_CONFIG.probabilityCalibration,
  });
  const low = toWinProbabilities({
    scoreDelta: -Number.MAX_VALUE,
    calibration: MODEL_CONFIG.probabilityCalibration,
  });
  const ordinaryTail = toWinProbabilities({
    scoreDelta: 50,
    calibration: MODEL_CONFIG.probabilityCalibration,
  });

  assertEqual(high.teamAProbability, 1);
  assertEqual(high.teamBProbability, 0);
  assertEqual(low.teamAProbability, 0);
  assertEqual(low.teamBProbability, 1);
  assert(
    ordinaryTail.teamAProbability > 0.99 && ordinaryTail.teamAProbability < 1,
    'An ordinary tail score must remain an uncapped full-precision probability.',
  );
});

test('invalid score or calibration inputs fail closed', () => {
  assertThrows(() => toWinProbabilities(), 'scoreDelta must be a finite number');
  assertThrows(
    () => toWinProbabilities({ scoreDelta: Number.NaN, calibration: {} }),
    'scoreDelta must be a finite number',
  );
  assertThrows(
    () => toWinProbabilities({ scoreDelta: 1, calibration: null }),
    'calibration must be a plain object',
  );
  assertThrows(
    () => toWinProbabilities({
      scoreDelta: 1,
      calibration: new (class Calibration {
        constructor() {
          this.slope = 0.1;
          this.intercept = 0;
        }
      })(),
    }),
    'calibration must be a plain object',
  );
  assertThrows(
    () => toWinProbabilities({
      scoreDelta: 1,
      calibration: { slope: 0, intercept: 0 },
    }),
    'greater than zero',
  );
  assertThrows(
    () => toWinProbabilities({
      scoreDelta: 1,
      calibration: { slope: 0.1, intercept: 0.01 },
    }),
    'exactly zero',
  );
  assertThrows(() => logistic(Number.POSITIVE_INFINITY), 'finite number');
});

test('probability calculation is pure and returns an immutable value object', () => {
  const calibration = clone(MODEL_CONFIG.probabilityCalibration);
  const before = JSON.stringify(calibration);
  const result = toWinProbabilities({ scoreDelta: 3, calibration });

  assertEqual(JSON.stringify(calibration), before);
  assertEqual(Object.isFrozen(calibration), false, 'Caller input must not be frozen.');
  assert(Object.isFrozen(result), 'Probability result must be immutable.');
});

test('empirical residual sampling clamps only outside the exported probability span', () => {
  const draws = [0, 0.0025, 0.9975, 0.9999999999999999];
  let drawIndex = 0;
  const result = simulateDistribution({
    baseScore: 0,
    varianceConfig: MODEL_CONFIG.residualDistribution,
    iterations: APPROVED_MONTE_CARLO_ITERATIONS,
    randomSource: () => draws[drawIndex++] ?? 0.5,
  });
  const quantiles = MODEL_CONFIG.residualDistribution.quantiles;

  assertEqual(result.residuals[0], quantiles[0]);
  assertEqual(result.residuals[1], quantiles[0]);
  assertEqual(result.residuals[2], quantiles.at(-1));
  assertEqual(result.residuals[3], quantiles.at(-1));
});

test('empirical residual sampling uses linear interpolation between quantile points', () => {
  const probabilities = MODEL_CONFIG.residualDistribution.probabilities;
  const quantiles = MODEL_CONFIG.residualDistribution.quantiles;
  const midpoint = (probabilities[0] + probabilities[1]) / 2;
  const expected = (quantiles[0] + quantiles[1]) / 2;
  const result = simulateDistribution({
    baseScore: 0,
    varianceConfig: MODEL_CONFIG.residualDistribution,
    iterations: APPROVED_MONTE_CARLO_ITERATIONS,
    randomSource: () => midpoint,
  });

  assertApprox(result.residuals[0], expected, 1e-12);
  assertApprox(result.residuals.at(-1), expected, 1e-12);
});

test('deterministic random draws produce reproducible residual and score sequences', () => {
  const sequence = [0.0025, 0.5, 0.9975];
  let calls = 0;
  const result = simulateDistribution({
    baseScore: 7,
    varianceConfig: MODEL_CONFIG.residualDistribution,
    iterations: APPROVED_MONTE_CARLO_ITERATIONS,
    randomSource: () => sequence[calls++ % sequence.length],
  });

  assertEqual(calls, APPROVED_MONTE_CARLO_ITERATIONS);
  assertEqual(result.residuals[0], MODEL_CONFIG.residualDistribution.quantiles[0]);
  assertEqual(result.residuals[1], MODEL_CONFIG.residualDistribution.quantiles[100]);
  assertEqual(result.residuals[2], MODEL_CONFIG.residualDistribution.quantiles.at(-1));
  assertEqual(result.samples[0], 7 + result.residuals[0]);
  assertEqual(result.samples[1], 7 + result.residuals[1]);
  assertEqual(result.samples[2], 7 + result.residuals[2]);
});

test('Monte Carlo execution requires exactly 10000 fresh uniform draws', () => {
  assertEqual(APPROVED_MONTE_CARLO_ITERATIONS, MODEL_CONFIG.iterations);
  assertThrows(
    () => simulateDistribution({
      baseScore: 0,
      varianceConfig: MODEL_CONFIG.residualDistribution,
      iterations: 9999,
      randomSource: () => 0.5,
    }),
    'iterations must equal 10000',
  );

  let calls = 0;
  const result = simulateDistribution({
    baseScore: 0,
    varianceConfig: MODEL_CONFIG.residualDistribution,
    iterations: MODEL_CONFIG.iterations,
    randomSource: () => {
      calls += 1;
      return (calls - 0.5) / MODEL_CONFIG.iterations;
    },
  });
  assertEqual(calls, 10000);
  assertEqual(result.residuals.length, 10000);
  assertEqual(result.samples.length, 10000);
});

test('different injected random sequences produce different empirical samples', () => {
  const lower = simulateDistribution({
    baseScore: 0,
    varianceConfig: MODEL_CONFIG.residualDistribution,
    iterations: MODEL_CONFIG.iterations,
    randomSource: () => 0.25,
  });
  const upper = simulateDistribution({
    baseScore: 0,
    varianceConfig: MODEL_CONFIG.residualDistribution,
    iterations: MODEL_CONFIG.iterations,
    randomSource: () => 0.75,
  });

  assert(lower.residuals[0] < 0);
  assert(upper.residuals[0] > 0);
  assert(lower.samples[0] !== upper.samples[0]);
});

test('invalid Monte Carlo arguments and random values fail closed', () => {
  assertThrows(() => simulateDistribution(), 'baseScore must be a finite number');
  assertThrows(
    () => simulateDistribution({
      baseScore: 0,
      varianceConfig: MODEL_CONFIG.residualDistribution,
      iterations: MODEL_CONFIG.iterations,
      randomSource: null,
    }),
    'randomSource must be a function',
  );
  for (const invalidDraw of [-0.1, 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assertThrows(
      () => simulateDistribution({
        baseScore: 0,
        varianceConfig: MODEL_CONFIG.residualDistribution,
        iterations: MODEL_CONFIG.iterations,
        randomSource: () => invalidDraw,
      }),
      'inside [0, 1)',
    );
  }
});

test('invalid empirical residual tables fail before any random draw', () => {
  const invalidConfigs = [];
  const wrongLength = clone(MODEL_CONFIG.residualDistribution);
  wrongLength.quantiles.pop();
  invalidConfigs.push(wrongLength);
  const wrongSpacing = clone(MODEL_CONFIG.residualDistribution);
  wrongSpacing.probabilities[1] += 0.001;
  invalidConfigs.push(wrongSpacing);
  const wrongOrder = clone(MODEL_CONFIG.residualDistribution);
  wrongOrder.quantiles[1] = wrongOrder.quantiles[0] - 1;
  invalidConfigs.push(wrongOrder);
  const nonfinite = clone(MODEL_CONFIG.residualDistribution);
  nonfinite.quantiles[1] = Number.POSITIVE_INFINITY;
  invalidConfigs.push(nonfinite);

  invalidConfigs.forEach((varianceConfig) => {
    let calls = 0;
    assertThrows(() => simulateDistribution({
      baseScore: 0,
      varianceConfig,
      iterations: MODEL_CONFIG.iterations,
      randomSource: () => {
        calls += 1;
        return 0.5;
      },
    }));
    assertEqual(calls, 0, 'Invalid variance must fail before random values are consumed.');
  });
});

test('distribution summary uses arithmetic mean and linear percentiles', () => {
  const summary = summarizeDistribution([40, 0, 30, 10, 20]);

  assertEqual(summary.count, 5);
  assertEqual(summary.mean, 20);
  assertEqual(summary.p5, 2);
  assertEqual(summary.median, 20);
  assertEqual(summary.p95, 38);
});

test('distribution summaries preserve input order, freeze output, and reject invalid samples', () => {
  const samples = [3, 1, 2];
  const before = JSON.stringify(samples);
  const summary = summarizeDistribution(samples);

  assertEqual(JSON.stringify(samples), before);
  assert(Object.isFrozen(summary));
  assertThrows(() => summarizeDistribution([]), 'nonempty array');
  assertThrows(() => summarizeDistribution([0, Number.NaN]), 'finite numbers');
});

test('approved residual table produces a finite centered ordered summary', () => {
  let index = 0;
  const result = simulateDistribution({
    baseScore: 0,
    varianceConfig: MODEL_CONFIG.residualDistribution,
    iterations: MODEL_CONFIG.iterations,
    randomSource: () => {
      const uniformValue = (index + 0.5) / MODEL_CONFIG.iterations;
      index += 1;
      return uniformValue;
    },
  });
  const summary = summarizeDistribution(result.samples);

  assert(Number.isFinite(summary.mean));
  assert(Math.abs(summary.mean) < 1e-10, 'Symmetric deterministic draws must center at zero.');
  assert(summary.p5 <= summary.median);
  assert(summary.median <= summary.p95);
  assert(Math.abs(summary.median) < 1e-10);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.residuals));
  assert(Object.isFrozen(result.samples));
});

export async function runModelConfigTests(options) {
  return runRegisteredTests(options);
}

if (typeof window === 'undefined') {
  const summary = await runModelConfigTests();
  if (summary.failed > 0 && typeof process !== 'undefined') {
    process.exitCode = 1;
  }
}
