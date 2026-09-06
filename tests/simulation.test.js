import MODEL_CONFIG from '../js/config/model-config.js';
import { calculateBaseMatchup } from '../js/model/matchup-model.js';
import { toWinProbabilities } from '../js/model/probability-model.js';
import {
  FACTOR_OPTIONS,
  runScenarios,
} from '../js/model/scenario-engine.js';
import {
  assert,
  assertApprox,
  assertDeepEqual,
  assertEqual,
  assertThrows,
  test,
} from './test-utils.js';

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

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

function createFactors(overrides = {}) {
  return {
    venue: 'neutral',
    wind: 'normal',
    precipitation: 'none',
    travel: 'neutral',
    teamARest: 'standard',
    teamBRest: 'standard',
    gameType: 'regular-season',
    momentum: 'neutral',
    isDivisionalMatchup: false,
    ...overrides,
  };
}

function createBaseMatchup(teamA = createTeam('AAA'), teamB = createTeam('BBB')) {
  return calculateBaseMatchup({
    teamA,
    teamB,
    leagueMetrics: createLeagueMetrics(),
    modelConfig: MODEL_CONFIG,
  });
}

function run({
  matchup = createBaseMatchup(),
  factors = createFactors(),
  modelConfig = MODEL_CONFIG,
  randomSource = () => 0.5,
  leagueMetrics,
} = {}) {
  return runScenarios({
    matchup,
    factors,
    leagueMetrics,
    modelConfig,
    randomSource,
  });
}

test('approved semantic factor option sets remain exact', () => {
  assertDeepEqual(FACTOR_OPTIONS.venue, ['team-a-home', 'neutral', 'team-b-home']);
  assertDeepEqual(FACTOR_OPTIONS.wind, ['normal', 'moderate', 'high']);
  assertDeepEqual(FACTOR_OPTIONS.precipitation, ['none', 'rain', 'snow']);
  assertDeepEqual(FACTOR_OPTIONS.travel, ['team-a-traveled', 'neutral', 'team-b-traveled']);
  assertDeepEqual(FACTOR_OPTIONS.rest, ['short', 'standard', 'extended']);
  assertDeepEqual(FACTOR_OPTIONS.gameType, [
    'regular-season',
    'wild-card',
    'divisional-round',
    'conference-championship',
    'super-bowl',
  ]);
  assertDeepEqual(FACTOR_OPTIONS.momentum, ['team-a', 'neutral', 'team-b']);
});

test('neutral defaults produce zero situational adjustments', () => {
  const result = run();

  assertEqual(result.adjustments.stadiumWeather.total, 0);
  assertEqual(result.adjustments.fatigue.total, 0);
  assertEqual(result.adjustments.competitive.total, 0);
});

test('venue adjustment uses the approved antisymmetric sign', () => {
  const teamAHome = run({ factors: createFactors({ venue: 'team-a-home' }) });
  const teamBHome = run({ factors: createFactors({ venue: 'team-b-home' }) });

  assertEqual(teamAHome.adjustments.stadiumWeather.venue, MODEL_CONFIG.situational.venue);
  assertEqual(teamBHome.adjustments.stadiumWeather.venue, -MODEL_CONFIG.situational.venue);
});

test('wind uses the continuous hinge function and pass-component interaction', () => {
  const teamA = createTeam('AAA');
  teamA.metrics['offense.pass_epa_per_dropback'].value = 1;
  const modelConfig = clone(MODEL_CONFIG);
  modelConfig.situational.wind.above10Pass = -0.1;
  modelConfig.situational.wind.above20Pass = -0.2;
  const result = run({
    matchup: createBaseMatchup(teamA, createTeam('BBB')),
    factors: createFactors({ wind: 'high' }),
    modelConfig,
  });
  const expectedBasis = (-0.1 * 17.5) + (-0.2 * 7.5);

  assertEqual(result.adjustments.stadiumWeather.representativeWindMph, 27.5);
  assertApprox(result.adjustments.stadiumWeather.windBasis, expectedBasis, 1e-12);
  assertApprox(
    result.adjustments.stadiumWeather.wind,
    expectedBasis * result.adjustments.stadiumWeather.passComponent,
    1e-12,
  );
});

test('precipitation interacts only with the deterministic base score', () => {
  const teamA = createTeam('AAA');
  teamA.metrics['offense.pass_epa_per_dropback'].value = 1;
  const matchup = createBaseMatchup(teamA, createTeam('BBB'));
  const modelConfig = clone(MODEL_CONFIG);
  modelConfig.situational.precipitation.rainScore = -0.25;
  const result = run({
    matchup,
    factors: createFactors({ precipitation: 'rain' }),
    modelConfig,
  });

  assertApprox(
    result.adjustments.stadiumWeather.precipitation,
    -0.25 * matchup.scoreDelta,
    1e-12,
  );
});

test('travel and team-specific rest differences follow approved fatigue signs', () => {
  const modelConfig = clone(MODEL_CONFIG);
  modelConfig.situational.travelEast = 2;
  modelConfig.situational.rest.short = -3;
  modelConfig.situational.rest.extended = 4;
  const result = run({
    factors: createFactors({
      travel: 'team-a-traveled',
      teamARest: 'short',
      teamBRest: 'extended',
    }),
    modelConfig,
  });

  assertEqual(result.adjustments.fatigue.travel, -2);
  assertEqual(result.adjustments.fatigue.shortRest, -3);
  assertEqual(result.adjustments.fatigue.extendedRest, -4);
  assertEqual(result.adjustments.fatigue.total, -9);
});

test('game type, momentum, and divisional venue interaction are narrowly scoped', () => {
  const teamA = createTeam('AAA');
  teamA.metrics['offense.pass_epa_per_dropback'].value = 1;
  const matchup = createBaseMatchup(teamA, createTeam('BBB'));
  const result = run({
    matchup,
    factors: createFactors({
      venue: 'team-a-home',
      gameType: 'super-bowl',
      momentum: 'team-b',
      isDivisionalMatchup: true,
    }),
  });
  const expected = (
    matchup.scoreDelta * MODEL_CONFIG.situational.gameType.superBowl
  ) - MODEL_CONFIG.situational.momentum
    + MODEL_CONFIG.situational.divisionHomeInteraction;

  assertApprox(result.adjustments.competitive.total, expected, 1e-12);
});

test('unsupported certified situational terms remain exactly zero', () => {
  const result = run({
    factors: createFactors({
      wind: 'high',
      precipitation: 'snow',
      travel: 'team-a-traveled',
      teamARest: 'short',
      gameType: 'divisional-round',
    }),
  });

  assertEqual(result.adjustments.stadiumWeather.wind, 0);
  assertEqual(result.adjustments.stadiumWeather.precipitation, 0);
  assertEqual(result.adjustments.fatigue.travel, 0);
  assertEqual(result.adjustments.fatigue.shortRest, 0);
  assertEqual(result.adjustments.competitive.gameType, 0);
});

test('scenario order is exactly one through five and Scenario 1 is deterministic', () => {
  const result = run();

  assertDeepEqual(result.scenarios.map(({ id, order }) => ({ id, order })), [
    { id: 'statistical-matchup', order: 1 },
    { id: 'monte-carlo-variance', order: 2 },
    { id: 'stadium-weather', order: 3 },
    { id: 'fatigue', order: 4 },
    { id: 'competitive-factors', order: 5 },
  ]);
  assertEqual(result.scenarios[0].deterministic, true);
  assertEqual(result.scenarios[0].teamAProbabilitySamples.length, 1);
  assertEqual(result.scenarios.slice(1).every((scenario) => !scenario.deterministic), true);
  assertEqual(result.scenarios.slice(1).every(
    (scenario) => scenario.teamAProbabilitySamples.length === MODEL_CONFIG.iterations,
  ), true);
});

test('Scenarios 2 through 5 reuse the same residual at every index', () => {
  let index = 0;
  const result = run({
    factors: createFactors({
      venue: 'team-a-home',
      teamARest: 'extended',
      momentum: 'team-a',
    }),
    randomSource: () => {
      const value = (index + 0.5) / MODEL_CONFIG.iterations;
      index += 1;
      return value;
    },
  });

  for (const sampleIndex of [0, 1, 5000, 9999]) {
    const scenario2Score = result.baseScore + result.residuals[sampleIndex];
    const scenario3Score = scenario2Score + result.adjustments.stadiumWeather.total;
    const scenario4Score = scenario3Score + result.adjustments.fatigue.total;
    const scenario5Score = scenario4Score + result.adjustments.competitive.total;
    const expectedScores = [scenario2Score, scenario3Score, scenario4Score, scenario5Score];
    result.scenarios.slice(1).forEach((scenario, scenarioIndex) => {
      const probability = toWinProbabilities({
        scoreDelta: expectedScores[scenarioIndex],
        calibration: MODEL_CONFIG.probabilityCalibration,
      }).teamAProbability;
      assertApprox(scenario.teamAProbabilitySamples[sampleIndex], probability, 1e-15);
    });
  }
});

test('scenario probability summaries are ordered and exactly complementary', () => {
  const result = run({ randomSource: Math.random });

  result.scenarios.forEach((scenario) => {
    const { teamA, teamB } = scenario.probabilitySummary;
    assert(teamA.p5 <= teamA.median && teamA.median <= teamA.p95);
    assert(teamB.p5 <= teamB.median && teamB.median <= teamB.p95);
    assertApprox(teamA.mean + teamB.mean, 1, 0);
    assertApprox(teamB.p5, 1 - teamA.p95, 0);
    assertApprox(teamB.median, 1 - teamA.median, 0);
    assertApprox(teamB.p95, 1 - teamA.p5, 0);
  });
});

test('Scenario 1 probability equals direct calibration of the base score', () => {
  const teamA = createTeam('AAA');
  teamA.metrics['offense.pass_epa_per_dropback'].value = 1;
  const result = run({ matchup: createBaseMatchup(teamA, createTeam('BBB')) });
  const expected = toWinProbabilities({
    scoreDelta: result.baseScore,
    calibration: MODEL_CONFIG.probabilityCalibration,
  });
  const scenario = result.scenarios[0];

  assertEqual(scenario.latentScoreSummary.mean, result.baseScore);
  assertEqual(scenario.latentScoreSummary.p5, result.baseScore);
  assertEqual(scenario.latentScoreSummary.median, result.baseScore);
  assertEqual(scenario.latentScoreSummary.p95, result.baseScore);
  assertEqual(scenario.probabilitySummary.teamA.mean, expected.teamAProbability);
});

test('swapped teams, factors, and mirrored residuals preserve probability symmetry', () => {
  const teamA = createTeam('AAA', 0.3);
  const teamB = createTeam('BBB', -0.2);
  const matchup = createBaseMatchup(teamA, teamB);
  const swappedMatchup = createBaseMatchup(teamB, teamA);
  let originalIndex = 0;
  let swappedIndex = 0;
  const original = run({
    matchup,
    factors: createFactors({
      venue: 'team-a-home',
      precipitation: 'rain',
      travel: 'team-a-traveled',
      teamARest: 'extended',
      teamBRest: 'short',
      gameType: 'super-bowl',
      momentum: 'team-a',
      isDivisionalMatchup: true,
    }),
    randomSource: () => {
      const value = (originalIndex + 0.5) / MODEL_CONFIG.iterations;
      originalIndex += 1;
      return value;
    },
  });
  const swapped = run({
    matchup: swappedMatchup,
    factors: createFactors({
      venue: 'team-b-home',
      precipitation: 'rain',
      travel: 'team-b-traveled',
      teamARest: 'short',
      teamBRest: 'extended',
      gameType: 'super-bowl',
      momentum: 'team-b',
      isDivisionalMatchup: true,
    }),
    randomSource: () => {
      const value = 1 - ((swappedIndex + 0.5) / MODEL_CONFIG.iterations);
      swappedIndex += 1;
      return value;
    },
  });

  original.scenarios.forEach((scenario, index) => {
    assertApprox(
      scenario.probabilitySummary.teamA.mean,
      1 - swapped.scenarios[index].probabilitySummary.teamA.mean,
      1e-10,
    );
  });
});

test('insufficient base coverage blocks every scenario before randomness', () => {
  const teamA = createTeam('AAA');
  teamA.metrics['offense.interception_rate'].value = null;
  const matchup = createBaseMatchup(teamA, createTeam('BBB'));
  let calls = 0;
  const result = run({
    matchup,
    randomSource: () => {
      calls += 1;
      return 0.5;
    },
  });

  assertEqual(result.status, 'insufficient-data');
  assertEqual(result.eligible, false);
  assertEqual(result.scenarios.length, 0);
  assertEqual(result.residuals.length, 0);
  assertEqual(calls, 0);
});

test('scenario engine can resolve raw teams with explicit league metrics', () => {
  const result = run({
    matchup: { teamA: createTeam('AAA'), teamB: createTeam('BBB') },
    leagueMetrics: createLeagueMetrics(),
  });

  assertEqual(result.status, 'complete');
  assertEqual(result.teamAId, 'AAA');
  assertEqual(result.teamBId, 'BBB');
});

test('invalid factors and situational coefficients fail before randomness', () => {
  assertThrows(() => run({ factors: createFactors({ wind: 'hurricane' }) }), 'factors.wind');
  assertThrows(
    () => run({ factors: createFactors({ isDivisionalMatchup: null }) }),
    'must be Boolean',
  );
  const invalidConfig = clone(MODEL_CONFIG);
  invalidConfig.situational.momentum = Number.NaN;
  let calls = 0;
  assertThrows(() => run({
    modelConfig: invalidConfig,
    randomSource: () => {
      calls += 1;
      return 0.5;
    },
  }), 'situational coefficient');
  assertEqual(calls, 0);
});

test('scenario execution does not mutate inputs and deeply freezes results', () => {
  const matchup = createBaseMatchup();
  const factors = createFactors({ venue: 'team-a-home' });
  const before = JSON.stringify({ matchup, factors });
  const result = run({ matchup, factors });

  assertEqual(JSON.stringify({ matchup, factors }), before);
  assert(Object.isFrozen(result));
  assert(Object.isFrozen(result.factors));
  assert(Object.isFrozen(result.adjustments));
  assert(Object.isFrozen(result.residuals));
  assert(Object.isFrozen(result.scenarios));
  assert(Object.isFrozen(result.scenarios[0]));
  assert(Object.isFrozen(result.scenarios[0].probabilitySummary.teamA));
});
