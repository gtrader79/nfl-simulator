import APP_CONFIG from '../js/config/app-config.js';
import { createAppController, createProductionRandomSource } from '../js/app-controller.js';
import { calculateBaseMatchup } from '../js/model/matchup-model.js';
import { runScenarios } from '../js/model/scenario-engine.js';
import MODEL_CONFIG from '../js/config/model-config.js';

import { validateModelConfig } from '../js/model/model-config-validator.js';
import {
  ACTIONS,
  BASE_ANALYTICS_STATUS,
  LIFECYCLE_STATUS,
  SIMULATION_STATUS,
  createInitialState,
  createStore,
} from '../js/state/store.js';
import {
  selectAreResultsStale,
  selectAvailableSeasons,
  selectBaseAnalytics,
  selectCanRunSimulation,
  selectFreshnessDisplay,
  selectIsDivisionalMatchup,
  selectIsValidMatchup,
  selectSelectedSeason,
  selectSimulationDisplayResult,
  selectTeamA,
  selectTeamB,
  selectViewModel,
} from '../js/state/selectors.js';
import {
  assert,
  assertDeepEqual,
  assertEqual,
  assertThrows,
  test,
} from './test-utils.js';

const LEAGUE_METRICS = Object.freeze({
  status: 'ready',
  metrics: Object.freeze({}),
});

const UNIT_BY_PAIR_ID = Object.freeze({
  pass_efficiency: 'epa-per-dropback',
  rush_efficiency: 'epa-per-rush',
  success_rate: 'rate',
  pressure: 'rate',
  explosiveness: 'rate',
  interceptions: 'rate',
  fumbles: 'rate',
});

const METRIC_CATALOG = Object.freeze(Object.fromEntries(
  MODEL_CONFIG.metricPairs.flatMap((pair) => [
    [pair.offenseMetric, Object.freeze({
      id: pair.offenseMetric,
      unit: UNIT_BY_PAIR_ID[pair.id],
      higherIsBetter: MODEL_CONFIG.metricDirections[pair.offenseMetric].higherIsBetter,
    })],
    [pair.defenseMetric, Object.freeze({
      id: pair.defenseMetric,
      unit: UNIT_BY_PAIR_ID[pair.id],
      higherIsBetter: MODEL_CONFIG.metricDirections[pair.defenseMetric].higherIsBetter,
    })],
  ]),
));

const TEAMS = Object.freeze([
  Object.freeze({
    teamId: 'AAA',
    abbreviation: 'AAA',
    teamName: 'Alpha Aces',
    conference: 'AFC',
    division: 'AFC East',
  }),
  Object.freeze({
    teamId: 'BBB',
    abbreviation: 'BBB',
    teamName: 'Beta Bisons',
    conference: 'AFC',
    division: 'AFC East',
  }),
  Object.freeze({
    teamId: 'CCC',
    abbreviation: 'CCC',
    teamName: 'Central Cats',
    conference: 'NFC',
    division: 'NFC North',
  }),
]);

const SEASONS = Object.freeze([
  Object.freeze({
    season: 2026,
    updatedDate: '2026-10-27',
    period: Object.freeze({
      type: 'regular-season',
      week: 8,
      postseasonRound: null,
    }),
    teams: TEAMS,
  }),
  Object.freeze({
    season: 2025,
    updatedDate: '2026-02-08',
    period: Object.freeze({
      type: 'postseason',
      week: null,
      postseasonRound: 'Super Bowl',
    }),
    teams: TEAMS,
  }),
  Object.freeze({
    season: 2024,
    updatedDate: '2025-01-05',
    period: Object.freeze({
      type: 'regular-season',
      week: 18,
      postseasonRound: null,
    }),
    teams: TEAMS,
  }),
  Object.freeze({
    season: 2023,
    updatedDate: '2024-01-07',
    period: Object.freeze({
      type: 'regular-season',
      week: 18,
      postseasonRound: null,
    }),
    teams: TEAMS,
  }),
]);

function createRepository(seasons = SEASONS) {
  return Object.freeze({
    getSeason(year) {
      return seasons.find((season) => season.season === year) ?? null;
    },
    getTeam(year, teamId) {
      return this.getSeason(year)?.teams.find((team) => team.teamId === teamId) ?? null;
    },
  });
}

function createReadyStore() {
  const store = createStore({ initialState: createInitialState() });
  store.dispatch({
    type: ACTIONS.DATA_LOAD_SUCCEEDED,
    payload: {
      schemaVersion: '1.0.0',
      generatedAt: '2026-09-04T12:00:00Z',
      availableSeasons: [2023, 2026, 2024, 2025],
      leagueMetrics: LEAGUE_METRICS,
    },
  });
  return store;
}

function selectTeams(store, teamAId = 'AAA', teamBId = 'BBB') {
  store.dispatch({ type: ACTIONS.TEAM_A_CHANGED, payload: { teamId: teamAId } });
  store.dispatch({ type: ACTIONS.TEAM_B_CHANGED, payload: { teamId: teamBId } });
}

function createSnapshot(state, isDivisionalMatchup = true) {
  return {
    season: state.data.selectedSeason,
    teamAId: state.matchup.teamAId,
    teamBId: state.matchup.teamBId,
    factors: { ...state.factors },
    isDivisionalMatchup,
  };
}

function completeSimulation(store, runId = 'run-1') {
  const snapshot = createSnapshot(store.getState());
  const result = { runId, finalScenarioId: 'competitive-factors', scenarios: [] };
  store.dispatch({ type: ACTIONS.SIMULATION_STARTED });
  store.dispatch({
    type: ACTIONS.SIMULATION_SUCCEEDED,
    payload: { result, inputSnapshot: snapshot },
  });
  return { result, snapshot };
}

test('application configuration matches the approved model and semantic factor contract', () => {
  const validation = validateModelConfig({
    modelConfig: MODEL_CONFIG,
    metricCatalog: METRIC_CATALOG,
    appConfig: APP_CONFIG,
  });

  assertEqual(validation.ok, true);
  assertDeepEqual(APP_CONFIG.factors.defaults, {
    venue: 'neutral',
    wind: 'normal',
    precipitation: 'none',
    travel: 'neutral',
    teamARest: 'standard',
    teamBRest: 'standard',
    gameType: 'regular-season',
    momentum: 'neutral',
  });
  assertEqual(APP_CONFIG.scenarios.length, 5);
  assertEqual(Object.isFrozen(APP_CONFIG.factors.defaults), true);
});

test('initial state is canonical, serializable, and deeply immutable', () => {
  const state = createInitialState();

  assertEqual(state.lifecycle.status, LIFECYCLE_STATUS.BOOTING);
  assertEqual(state.data.selectedSeason, null);
  assertEqual(state.matchup.teamAId, null);
  assertEqual(state.matchup.baseAnalyticsStatus, BASE_ANALYTICS_STATUS.UNAVAILABLE);
  assertEqual(state.simulation.status, SIMULATION_STATUS.NOT_RUN);
  assertDeepEqual(state.factors, APP_CONFIG.factors.defaults);
  assertEqual(Object.isFrozen(state), true);
  assertEqual(Object.isFrozen(state.factors), true);
  assertEqual(typeof JSON.stringify(state), 'string');
});

test('invalid application defaults fail before state creation', () => {
  const invalidConfig = {
    ...APP_CONFIG,
    factors: {
      ...APP_CONFIG.factors,
      defaults: { ...APP_CONFIG.factors.defaults, wind: 'hurricane' },
    },
  };

  assertThrows(() => createInitialState(invalidConfig), 'invalid for factor wind');
});

test('data load success exposes only the three newest seasons and selects the latest', () => {
  const store = createReadyStore();
  const state = store.getState();

  assertEqual(state.lifecycle.status, LIFECYCLE_STATUS.READY);
  assertDeepEqual(state.data.availableSeasons, [2026, 2025, 2024]);
  assertEqual(state.data.selectedSeason, 2026);
  assertEqual(state.data.schemaVersion, '1.0.0');
  assertEqual(state.data.leagueMetrics.status, 'ready');
  assertEqual(state.matchup.teamAId, null);
});

test('data load failure enters a fatal state and clears dependent output', () => {
  const store = createStore({ initialState: createInitialState() });
  store.dispatch({
    type: ACTIONS.DATA_LOAD_FAILED,
    payload: { error: { code: 'DATA_SCHEMA_INVALID' } },
  });

  assertEqual(store.getState().lifecycle.status, LIFECYCLE_STATUS.FATAL_ERROR);
  assertEqual(store.getState().lifecycle.fatalError.code, 'DATA_SCHEMA_INVALID');
  assertEqual(store.getState().simulation.result, null);
});

test('bootstrap failure uses a safe serializable fatal-error record', () => {
  const store = createStore({ initialState: createInitialState() });
  store.dispatch({
    type: ACTIONS.APP_BOOTSTRAP_FAILED,
    payload: { error: { code: 'MODEL_CONFIGURATION_INVALID', context: { module: 'main' } } },
  });

  const error = store.getState().lifecycle.fatalError;
  assertEqual(error.code, 'MODEL_CONFIGURATION_INVALID');
  assertEqual(error.message, APP_CONFIG.messages.MODEL_CONFIGURATION_INVALID);
  assertDeepEqual(error.context, { module: 'main' });
  assertEqual('stack' in error, false);
});

test('season change preserves factors but clears teams, analytics, results, and stale state', () => {
  const store = createReadyStore();
  selectTeams(store);
  store.dispatch({
    type: ACTIONS.FACTOR_CHANGED,
    payload: { factor: 'venue', value: 'team-a-home' },
  });
  completeSimulation(store);
  store.dispatch({
    type: ACTIONS.SEASON_CHANGED,
    payload: { selectedSeason: 2025, leagueMetrics: LEAGUE_METRICS },
  });

  const state = store.getState();
  assertEqual(state.data.selectedSeason, 2025);
  assertEqual(state.factors.venue, 'team-a-home');
  assertEqual(state.matchup.teamAId, null);
  assertEqual(state.matchup.baseAnalytics, null);
  assertEqual(state.simulation.result, null);
  assertEqual(state.simulation.isStale, false);
});

test('team selection prevents a duplicate matchup without corrupting the accepted team', () => {
  const store = createReadyStore();
  store.dispatch({ type: ACTIONS.TEAM_A_CHANGED, payload: { teamId: 'AAA' } });
  store.dispatch({ type: ACTIONS.TEAM_B_CHANGED, payload: { teamId: 'AAA' } });

  const state = store.getState();
  assertEqual(state.matchup.teamAId, 'AAA');
  assertEqual(state.matchup.teamBId, null);
  assertEqual(state.notice.code, 'DUPLICATE_TEAM_SELECTION');
});

test('team changes clear base analytics and allow an incomplete matchup', () => {
  const store = createReadyStore();
  selectTeams(store);
  store.dispatch({ type: ACTIONS.BASE_ANALYTICS_STARTED });
  store.dispatch({
    type: ACTIONS.BASE_ANALYTICS_SUCCEEDED,
    payload: { result: { scoreDelta: 1.5 } },
  });
  store.dispatch({ type: ACTIONS.TEAM_B_CHANGED, payload: { teamId: null } });

  assertEqual(store.getState().matchup.teamBId, null);
  assertEqual(store.getState().matchup.baseAnalytics, null);
  assertEqual(
    store.getState().matchup.baseAnalyticsStatus,
    BASE_ANALYTICS_STATUS.UNAVAILABLE,
  );
});

test('base analytics transitions through calculating, ready, and failure states', () => {
  const store = createReadyStore();
  selectTeams(store);
  store.dispatch({ type: ACTIONS.BASE_ANALYTICS_STARTED });
  assertEqual(
    store.getState().matchup.baseAnalyticsStatus,
    BASE_ANALYTICS_STATUS.CALCULATING,
  );
  store.dispatch({
    type: ACTIONS.BASE_ANALYTICS_SUCCEEDED,
    payload: { result: { scoreDelta: 2 } },
  });
  assertEqual(store.getState().matchup.baseAnalyticsStatus, BASE_ANALYTICS_STATUS.READY);
  store.dispatch({
    type: ACTIONS.BASE_ANALYTICS_FAILED,
    payload: {
      status: BASE_ANALYTICS_STATUS.INSUFFICIENT_DATA,
      error: { code: 'INSUFFICIENT_COVERAGE' },
    },
  });
  assertEqual(
    store.getState().matchup.baseAnalyticsStatus,
    BASE_ANALYTICS_STATUS.INSUFFICIENT_DATA,
  );
  assertEqual(store.getState().notice.code, 'INSUFFICIENT_COVERAGE');
});

test('simulation success replaces output only after running and stores its immutable snapshot', () => {
  const store = createReadyStore();
  selectTeams(store);
  const { result, snapshot } = completeSimulation(store);
  const state = store.getState();

  assertEqual(state.simulation.status, SIMULATION_STATUS.COMPLETE);
  assertDeepEqual(state.simulation.result, result);
  assertDeepEqual(state.simulation.inputSnapshot, snapshot);
  assertEqual(state.simulation.isStale, false);
  assertEqual(Object.isFrozen(state.simulation.result), true);
  assertEqual(Object.isFrozen(state.simulation.inputSnapshot.factors), true);
});

test('factor changes mark completed results stale and returning to the snapshot restores freshness', () => {
  const store = createReadyStore();
  selectTeams(store);
  completeSimulation(store);
  store.dispatch({
    type: ACTIONS.FACTOR_CHANGED,
    payload: { factor: 'momentum', value: 'team-a' },
  });
  assertEqual(store.getState().simulation.isStale, true);
  store.dispatch({
    type: ACTIONS.FACTOR_CHANGED,
    payload: { factor: 'momentum', value: 'neutral' },
  });
  assertEqual(store.getState().simulation.isStale, false);
});

test('team changes retain the prior result and snapshot while marking them stale', () => {
  const store = createReadyStore();
  selectTeams(store);
  completeSimulation(store);
  const priorResult = store.getState().simulation.result;
  const priorSnapshot = store.getState().simulation.inputSnapshot;
  store.dispatch({ type: ACTIONS.TEAM_B_CHANGED, payload: { teamId: 'CCC' } });

  assertEqual(store.getState().simulation.result, priorResult);
  assertEqual(store.getState().simulation.inputSnapshot, priorSnapshot);
  assertEqual(store.getState().simulation.inputSnapshot.teamBId, 'BBB');
  assertEqual(store.getState().simulation.isStale, true);
});

test('rerun start retains the previous result and its snapshot while entering running state', () => {
  const store = createReadyStore();
  selectTeams(store);
  completeSimulation(store);
  store.dispatch({
    type: ACTIONS.FACTOR_CHANGED,
    payload: { factor: 'venue', value: 'team-a-home' },
  });
  const priorResult = store.getState().simulation.result;
  const priorSnapshot = store.getState().simulation.inputSnapshot;
  store.dispatch({ type: ACTIONS.SIMULATION_STARTED });

  assertEqual(store.getState().simulation.status, SIMULATION_STATUS.RUNNING);
  assertEqual(store.getState().simulation.result, priorResult);
  assertEqual(store.getState().simulation.inputSnapshot, priorSnapshot);
  assertEqual(store.getState().simulation.isStale, true);
});

test('failed rerun retains the previous output and keeps it visibly stale', () => {
  const store = createReadyStore();
  selectTeams(store);
  completeSimulation(store);
  store.dispatch({
    type: ACTIONS.FACTOR_CHANGED,
    payload: { factor: 'venue', value: 'team-a-home' },
  });
  const priorResult = store.getState().simulation.result;
  store.dispatch({ type: ACTIONS.SIMULATION_STARTED });
  store.dispatch({
    type: ACTIONS.SIMULATION_FAILED,
    payload: { error: { code: 'SIMULATION_FAILED' } },
  });

  assertEqual(store.getState().simulation.status, SIMULATION_STATUS.ERROR);
  assertEqual(store.getState().simulation.result, priorResult);
  assertEqual(store.getState().simulation.isStale, true);
  assertEqual(store.getState().simulation.error.code, 'SIMULATION_FAILED');
});

test('first-run insufficient coverage exposes no result and is not mislabeled stale', () => {
  const store = createReadyStore();
  selectTeams(store);
  store.dispatch({
    type: ACTIONS.SIMULATION_FAILED,
    payload: {
      status: SIMULATION_STATUS.INSUFFICIENT_DATA,
      error: { code: 'INSUFFICIENT_COVERAGE' },
    },
  });

  assertEqual(store.getState().simulation.status, SIMULATION_STATUS.INSUFFICIENT_DATA);
  assertEqual(store.getState().simulation.result, null);
  assertEqual(store.getState().simulation.isStale, false);
});

test('reset restores the latest season, factor defaults, and empty output while retaining data', () => {
  const store = createReadyStore();
  store.dispatch({
    type: ACTIONS.SEASON_CHANGED,
    payload: { selectedSeason: 2025, leagueMetrics: LEAGUE_METRICS },
  });
  selectTeams(store);
  store.dispatch({
    type: ACTIONS.FACTOR_CHANGED,
    payload: { factor: 'wind', value: 'high' },
  });
  completeSimulation(store);
  store.dispatch({
    type: ACTIONS.RESET_REQUESTED,
    payload: { selectedSeason: 2026, leagueMetrics: LEAGUE_METRICS },
  });

  const state = store.getState();
  assertEqual(state.data.selectedSeason, 2026);
  assertDeepEqual(state.data.availableSeasons, [2026, 2025, 2024]);
  assertDeepEqual(state.factors, APP_CONFIG.factors.defaults);
  assertEqual(state.matchup.teamAId, null);
  assertEqual(state.simulation.result, null);
  assertEqual(state.notice, null);
});

test('notice actions set and clear one controlled user-facing notice', () => {
  const store = createReadyStore();
  store.dispatch({
    type: ACTIONS.NOTICE_SET,
    payload: { notice: { code: 'TEST_NOTICE', message: 'Test message.', severity: 'warning' } },
  });
  assertEqual(store.getState().notice.severity, 'warning');
  store.dispatch({ type: ACTIONS.NOTICE_CLEARED });
  assertEqual(store.getState().notice, null);
});

test('unknown actions and invalid factor values fail without mutating state', () => {
  const store = createReadyStore();
  const before = store.getState();

  assertThrows(() => store.dispatch({ type: 'UNKNOWN_ACTION' }), 'Unknown state action');
  assertEqual(store.getState(), before);
  assertThrows(() => store.dispatch({
    type: ACTIONS.FACTOR_CHANGED,
    payload: { factor: 'wind', value: 'extreme' },
  }), 'invalid for wind');
  assertEqual(store.getState(), before);
});

test('ready-only transitions are rejected before successful initialization', () => {
  const store = createStore({ initialState: createInitialState() });

  assertThrows(() => store.dispatch({
    type: ACTIONS.TEAM_A_CHANGED,
    payload: { teamId: 'AAA' },
  }), 'requires a ready application');
});

test('destroy is terminal and prevents later callbacks from changing state', () => {
  const store = createReadyStore();
  store.dispatch({ type: ACTIONS.APP_DESTROYED });
  const destroyed = store.getState();

  assertEqual(destroyed.lifecycle.status, LIFECYCLE_STATUS.DESTROYED);
  assertEqual(store.dispatch({ type: ACTIONS.APP_DESTROYED }), destroyed);
  assertThrows(() => store.dispatch({ type: ACTIONS.NOTICE_CLEARED }), 'destroyed');
  assertEqual(store.getState(), destroyed);
});

test('subscribers receive only successful state replacements and can unsubscribe', () => {
  const store = createReadyStore();
  const events = [];
  const unsubscribe = store.subscribe((state, action) => {
    events.push([state.matchup.teamAId, action.type]);
  });

  store.dispatch({ type: ACTIONS.TEAM_A_CHANGED, payload: { teamId: 'AAA' } });
  store.dispatch({ type: ACTIONS.TEAM_A_CHANGED, payload: { teamId: 'AAA' } });
  unsubscribe();
  unsubscribe();
  store.dispatch({ type: ACTIONS.TEAM_A_CHANGED, payload: { teamId: 'CCC' } });

  assertDeepEqual(events, [['AAA', ACTIONS.TEAM_A_CHANGED]]);
});

test('store rejects nonserializable state and action data without mutating caller inputs', () => {
  assertThrows(() => createStore({
    initialState: { ...createInitialState(), invalid: new Date() },
  }), 'arrays and plain objects');

  const store = createReadyStore();
  selectTeams(store);
  const result = { runId: 'run-2', scenarios: [] };
  const snapshot = createSnapshot(store.getState());
  const before = JSON.stringify({ result, snapshot });
  store.dispatch({ type: ACTIONS.SIMULATION_STARTED });
  store.dispatch({
    type: ACTIONS.SIMULATION_SUCCEEDED,
    payload: { result, inputSnapshot: snapshot },
  });
  assertEqual(JSON.stringify({ result, snapshot }), before);
  assert(result !== store.getState().simulation.result);
});

test('team and matchup selectors resolve only selected-season repository records', () => {
  const store = createReadyStore();
  const repository = createRepository();
  selectTeams(store);

  assertEqual(selectAvailableSeasons(store.getState())[0], 2026);
  assertEqual(selectSelectedSeason(store.getState(), repository).season, 2026);
  assertEqual(selectTeamA(store.getState(), repository).teamId, 'AAA');
  assertEqual(selectTeamB(store.getState(), repository).teamId, 'BBB');
  assertEqual(selectIsValidMatchup(store.getState(), repository), true);
  assertEqual(selectIsDivisionalMatchup(store.getState(), repository), true);
});

test('divisional status is derived from season-specific team identity and never stored as a factor', () => {
  const store = createReadyStore();
  const repository = createRepository();
  selectTeams(store, 'AAA', 'CCC');

  assertEqual(selectIsDivisionalMatchup(store.getState(), repository), false);
  assertEqual('isDivisionalMatchup' in store.getState().factors, false);
});

test('run eligibility requires ready data, two repository teams, and a nonrunning simulation', () => {
  const store = createReadyStore();
  const repository = createRepository();
  assertEqual(selectCanRunSimulation(store.getState(), repository), false);
  selectTeams(store);
  assertEqual(selectCanRunSimulation(store.getState(), repository), true);
  store.dispatch({ type: ACTIONS.SIMULATION_STARTED });
  assertEqual(selectCanRunSimulation(store.getState(), repository), false);
});

test('base and simulation display selectors expose only their approved contracts', () => {
  const store = createReadyStore();
  selectTeams(store);
  store.dispatch({ type: ACTIONS.BASE_ANALYTICS_STARTED });
  assertEqual(selectBaseAnalytics(store.getState()), null);
  store.dispatch({
    type: ACTIONS.BASE_ANALYTICS_SUCCEEDED,
    payload: { result: { scoreDelta: 1.25 } },
  });
  completeSimulation(store);

  assertEqual(selectBaseAnalytics(store.getState()).scoreDelta, 1.25);
  assertEqual(selectSimulationDisplayResult(store.getState()).runId, 'run-1');
  assertEqual(selectAreResultsStale(store.getState()), false);
});

test('freshness selector formats regular-season and postseason periods from repository data', () => {
  const store = createReadyStore();
  const repository = createRepository();

  assertEqual(
    selectFreshnessDisplay(store.getState(), repository).text,
    '2026 season data through Week 8 — Updated October 27, 2026',
  );
  store.dispatch({
    type: ACTIONS.SEASON_CHANGED,
    payload: { selectedSeason: 2025, leagueMetrics: LEAGUE_METRICS },
  });
  assertEqual(
    selectFreshnessDisplay(store.getState(), repository).text,
    '2025 season data through Super Bowl — Updated February 8, 2026',
  );
});

test('view model centralizes current teams, derived state, snapshots, and display output', () => {
  const store = createReadyStore();
  const repository = createRepository();
  selectTeams(store);
  completeSimulation(store);
  store.dispatch({
    type: ACTIONS.FACTOR_CHANGED,
    payload: { factor: 'momentum', value: 'team-b' },
  });
  const viewModel = selectViewModel(store.getState(), repository);

  assertEqual(viewModel.teamA.teamId, 'AAA');
  assertEqual(viewModel.teamB.teamId, 'BBB');
  assertEqual(viewModel.isDivisionalMatchup, true);
  assertEqual(viewModel.canRunSimulation, true);
  assertEqual(viewModel.areResultsStale, true);
  assertEqual(viewModel.simulationInputSnapshot.factors.momentum, 'neutral');
  assertEqual(viewModel.simulationResult.runId, 'run-1');
  assertEqual(Object.isFrozen(viewModel), true);
});


function controllerHarness(overrides = {}) {
  const store = createStore({ initialState: createInitialState() });
  const calls = { loads: 0, binds: 0, renders: 0, runs: 0, sources: 0, destroyed: 0 };
  const teams = TEAMS.map(team => ({ ...team, metrics: Object.fromEntries(
    Object.keys(MODEL_CONFIG.metricDirections).map(id =>
      [id, { value: 0, sampleSize: 100, rank: 1 }])) }));
  const seasons = SEASONS.map(season => ({ ...season, teams }));
  const league = { status: 'ready', metrics: Object.fromEntries(
    Object.keys(MODEL_CONFIG.metricDirections).map(id =>
      [id, { usable: true, mean: 0, standardDeviation: 1, validCount: 32, distinctValueCount: 32 }])) };
  let handlers;
  let signal;
  const repository = {
    ...createRepository(seasons),
    getAvailableSeasons: () => [2024, 2026, 2025],
    async load(options) {
      calls.loads++;
      signal = options.signal;
      return { schemaVersion: '1.0.0', generatedAt: '2026-09-04T00:00:00Z' };
    },
    ...overrides.repository,
  };
  const controller = createAppController({
    store, repository, metricCatalog: METRIC_CATALOG,
    calculateLeagueMetrics: () => league,
    renderer: { render() { calls.renders++; }, destroy() { calls.destroyed++; } },
    createInputController(options) {
      handlers = options.handlers;
      return { bind() { calls.binds++; }, setEnabledState() {}, destroy() { calls.destroyed++; } };
    },
    clock: () => '2026-09-04T12:00:00Z',
    yieldFrame: async () => {},
    randomSourceFactory: () => { calls.sources++; return () => 0.5; },
    model: { calculateBaseMatchup, runScenarios(args) { calls.runs++; return runScenarios(args); } },
    logger: { error() {} },
    ...overrides.dependencies,
  });
  return { controller, store, calls, get handlers() { return handlers; }, get signal() { return signal; } };
}

async function readyController(overrides) {
  const h = controllerHarness(overrides);
  await h.controller.initialize();
  h.handlers.onTeamAChange('AAA');
  h.handlers.onTeamBChange('BBB');
  return h;
}

test('controller initializes once and binds once with latest season and no selected teams', async () => {
  const h = controllerHarness();
  await Promise.all([h.controller.initialize(), h.controller.initialize()]);
  assertEqual(h.calls.loads, 1);
  assertEqual(h.calls.binds, 1);
  assertEqual(h.store.getState().data.selectedSeason, 2026);
  assertEqual(h.store.getState().matchup.teamAId, null);
});

test('controller computes immediate base analytics without running stochastic scenarios', async () => {
  const h = await readyController();
  assertEqual(h.store.getState().matchup.baseAnalyticsStatus, 'ready');
  assertEqual(h.calls.runs, 0);
  assertEqual(h.handlers.onTeamBChange('AAA'), false);
  assertEqual(h.store.getState().matchup.teamBId, 'BBB');
  assertEqual(h.handlers.onTeamBChange('UNKNOWN'), false);
});

test('controller explicit run wraps certified model output with immutable identity and metadata', async () => {
  const h = await readyController();
  assertEqual(await h.handlers.onRun(), true);
  const result = h.store.getState().simulation.result;
  assertEqual(result.scenarios.length, 5);
  assertEqual(result.finalScenarioId, 'competitive-factors');
  assertEqual(result.inputSnapshot.teamA.teamName, 'Alpha Aces');
  assertEqual(result.inputSnapshot.isDivisionalMatchup, true);
  assertEqual(result.completedAt, '2026-09-04T12:00:00Z');
  assertEqual(Object.isFrozen(result.inputSnapshot.teamA), true);
});

test('controller factor edits do not rerun and each explicit rerun creates a fresh source', async () => {
  const h = await readyController();
  await h.handlers.onRun();
  h.handlers.onFactorChange('venue', 'team-a-home');
  assertEqual(h.store.getState().simulation.isStale, true);
  assertEqual(h.calls.runs, 1);
  await h.handlers.onRun();
  assertEqual(h.calls.sources, 2);
  assertEqual(h.store.getState().simulation.result.runId, 'run-2');
  assertEqual(h.store.getState().simulation.isStale, false);
});

test('controller rejects duplicate Run while yielding and Reset invalidates pending calculation', async () => {
  let release;
  const h = await readyController({ dependencies: {
    yieldFrame: () => new Promise(resolve => { release = resolve; }),
  } });
  const pending = h.handlers.onRun();
  assertEqual(h.store.getState().simulation.status, 'running');
  assertEqual(await h.handlers.onRun(), false);
  assertEqual(h.handlers.onFactorChange('wind', 'high'), false);
  h.handlers.onReset();
  release();
  assertEqual(await pending, false);
  assertEqual(h.calls.runs, 0);
  assertEqual(h.store.getState().simulation.status, 'not-run');
});

test('controller season change clears output and preserves conditions while Reset restores defaults', async () => {
  const h = await readyController();
  await h.handlers.onRun();
  h.handlers.onFactorChange('wind', 'high');
  h.handlers.onSeasonChange(2025);
  assertEqual(h.store.getState().simulation.result, null);
  assertEqual(h.store.getState().factors.wind, 'high');
  h.handlers.onReset();
  assertEqual(h.store.getState().data.selectedSeason, 2026);
  assertEqual(h.store.getState().factors.wind, 'normal');
  assertEqual(h.calls.loads, 1);
});

test('controller coverage failure blocks random sampling and exposes insufficient-data', async () => {
  const h = await readyController({ dependencies: {
    model: { calculateBaseMatchup: () => ({ eligible: false }), runScenarios },
  } });
  assertEqual(await h.handlers.onRun(), false);
  assertEqual(h.calls.sources, 0);
  assertEqual(h.store.getState().simulation.status, 'insufficient-data');
});

test('controller rejects malformed rerun results and retains the prior result snapshot', async () => {
  let fail = false;
  const h = await readyController({ dependencies: {
    model: { calculateBaseMatchup, runScenarios: args => fail ? {} : runScenarios(args) },
  } });
  await h.handlers.onRun();
  const prior = h.store.getState().simulation.result;
  fail = true;
  assertEqual(await h.handlers.onRun(), false);
  assertEqual(h.store.getState().simulation.result, prior);
  assertEqual(h.store.getState().simulation.isStale, true);
});

test('controller invalid model configuration stops before loading data', async () => {
  const h = controllerHarness({ dependencies: { modelConfig: {} } });
  assertEqual(await h.controller.initialize(), false);
  assertEqual(h.calls.loads, 0);
  assertEqual(h.store.getState().lifecycle.fatalError.code, 'MODEL_CONFIGURATION_INVALID');
});

test('controller data errors become safe fatal messages rather than raw exceptions', async () => {
  const h = controllerHarness({ repository: {
    async load() { throw Object.assign(new Error('private raw payload'), { code: 'DATA_SCHEMA_INVALID' }); },
  } });
  assertEqual(await h.controller.initialize(), false);
  assertEqual(h.store.getState().lifecycle.fatalError.code, 'DATA_SCHEMA_INVALID');
  assertEqual(h.store.getState().lifecycle.fatalError.message.includes('private'), false);
});

test('controller teardown is idempotent and prevents a delayed load from restoring ready state', async () => {
  let release;
  const h = controllerHarness({ repository: {
    load: () => new Promise(resolve => { release = resolve; }),
  } });
  const pending = h.controller.initialize();
  h.controller.destroy();
  h.controller.destroy();
  release({ schemaVersion: '1.0.0', generatedAt: '2026-09-04T00:00:00Z' });
  await pending;
  assertEqual(h.store.getState().lifecycle.status, 'destroyed');
  assertEqual(h.calls.destroyed, 2);
});

test('controller teardown aborts load signal and disables captured handlers', async () => {
  const h = await readyController();
  h.controller.destroy();
  assertEqual(h.signal.aborted, true);
  assertEqual(h.handlers.onTeamAChange('CCC'), false);
  assertEqual(await h.handlers.onRun(), false);
});

test('production random source excludes both endpoints and diagnoses fallback', () => {
  let draw = 0;
  const source = createProductionRandomSource({ cryptoImpl: {
    getRandomValues(buffer) { buffer[0] = draw; },
  } });
  assert(source() > 0);
  draw = 4294967295;
  assert(source() < 1);
  let warnings = 0;
  const fallback = createProductionRandomSource({
    cryptoImpl: null, fallback: () => 0, warn: () => { warnings++; },
  });
  assert(fallback() > 0);
  assertEqual(warnings, 1);
});
