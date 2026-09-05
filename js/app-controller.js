import APP_CONFIG from './config/app-config.js';
import MODEL_CONFIG from './config/model-config.js';
import { validateModelConfig } from './model/model-config-validator.js';
import { calculateBaseMatchup } from './model/matchup-model.js';
import { runScenarios } from './model/scenario-engine.js';
import { ACTIONS } from './state/store.js';
import { selectViewModel, selectCanRunSimulation, selectIsValidMatchup,
  selectTeamA, selectTeamB, selectIsDivisionalMatchup } from './state/selectors.js';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** One new source per explicit run; no production seed or cached sample sequence. */
export function createProductionRandomSource({ cryptoImpl = globalThis.crypto,
  fallback = Math.random, warn = console.warn } = {}) {
  if (typeof cryptoImpl?.getRandomValues === 'function') {
    const buffer = new Uint32Array(1);
    return () => {
      cryptoImpl.getRandomValues(buffer);
      return (buffer[0] + 0.5) / 4294967296;
    };
  }
  warn('Web Crypto unavailable; using fresh Math.random draws.');
  return () => {
    const value = fallback();
    if (!Number.isFinite(value) || value < 0 || value >= 1) {
      throw new RangeError('Invalid fallback random draw.');
    }
    return value === 0 ? Number.EPSILON : value;
  };
}

function validateResult(result, config, snapshot) {
  if (result?.status !== 'complete' || result.eligible !== true
    || result.modelVersion !== config.modelVersion
    || result.teamAId !== snapshot.teamAId || result.teamBId !== snapshot.teamBId
    || result.scenarios?.length !== APP_CONFIG.scenarios.length) {
    throw new Error('Invalid simulation result identity.');
  }
  for (const [index, scenario] of result.scenarios.entries()) {
    const expected = APP_CONFIG.scenarios[index];
    const count = index === 0 ? 1 : config.iterations;
    const a = scenario.probabilitySummary?.teamA;
    const b = scenario.probabilitySummary?.teamB;
    if (scenario.id !== expected.id || scenario.order !== expected.order
      || scenario.teamAProbabilitySamples?.length !== count
      || a?.count !== count || b?.count !== count) throw new Error('Invalid scenario contract.');
    for (const summary of [a, b]) {
      if (!['mean', 'p5', 'median', 'p95'].every(key => Number.isFinite(summary[key])
        && summary[key] >= 0 && summary[key] <= 1)
        || summary.p5 > summary.median || summary.median > summary.p95) {
        throw new Error('Invalid probability summary.');
      }
    }
    if (b.mean !== 1 - a.mean || b.p5 !== 1 - a.p95
      || b.median !== 1 - a.median || b.p95 !== 1 - a.p5
      || !scenario.teamAProbabilitySamples.every(p => Number.isFinite(p) && p >= 0 && p <= 1)) {
      throw new Error('Invalid complementary distribution.');
    }
  }
}

/**
 * Repository: load({signal}) returns validated dataset metadata; getAvailableSeasons(),
 * getSeason(year), getTeam(year,id). calculateLeagueMetrics(teams,config) is injected.
 * createInputController({handlers}) returns bind(), setEnabledState(viewModel), destroy().
 * Only initialize()/destroy() are public; event handlers stay in the closure.
 * Renderer and input implementations are owned by the later UI unit.
 */
export function createAppController({ store, repository, metricCatalog,
  calculateLeagueMetrics, renderer, createInputController,
  modelConfig = MODEL_CONFIG, clock = () => new Date().toISOString(),
  yieldFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))),
  randomSourceFactory = createProductionRandomSource,
  model = { calculateBaseMatchup, runScenarios }, logger = console } = {}) {
  for (const [name, object, methods] of [
    ['store', store, ['getState', 'dispatch', 'subscribe']],
    ['repository', repository, ['load', 'getAvailableSeasons', 'getSeason', 'getTeam']],
    ['renderer', renderer, ['render', 'destroy']],
    ['model', model, ['calculateBaseMatchup', 'runScenarios']],
  ]) {
    if (!methods.every(method => typeof object?.[method] === 'function')) {
      throw new TypeError(`Invalid ${name} dependency.`);
    }
  }
  if (![calculateLeagueMetrics, createInputController, clock, yieldFrame, randomSourceFactory]
    .every(fn => typeof fn === 'function')) throw new TypeError('Missing controller dependency.');
  let initialization;
  let destroyed = false;
  let generation = 0;
  let runNumber = 0;
  let inputs;
  let unsubscribe;
  const abort = new AbortController();
  const dispatch = (type, payload) => store.dispatch({ type, payload });
  function report(code, error) {
    try { logger.error({ code, module: 'app-controller', timestamp: clock(),
      season: store.getState().data.selectedSeason, cause: error }); } catch { /* Diagnostics cannot break recovery. */ }
    return { code, message: APP_CONFIG.messages[code] ?? APP_CONFIG.messages.SIMULATION_FAILED };
  }
  function notice(code, error) {
    dispatch(ACTIONS.NOTICE_SET, { notice: { ...report(code, error), severity: 'error' } });
  }
  function render() {
    if (destroyed) return;
    const state = store.getState();
    const view = selectViewModel(state, repository);
    renderer.render(state, view);
    inputs?.setEnabledState(view);
  }
  const editable = () => !destroyed && store.getState().lifecycle.status === 'ready'
    && store.getState().simulation.status !== 'running';
  function metricsFor(year) {
    const season = repository.getSeason(year);
    if (!season) throw new Error('Season unavailable.');
    const metrics = calculateLeagueMetrics(season.teams, modelConfig);
    if (metrics?.status !== 'ready') throw new Error('League metrics unavailable.');
    return metrics;
  }
  function base() {
    const state = store.getState();
    return model.calculateBaseMatchup({ teamA: selectTeamA(state, repository),
      teamB: selectTeamB(state, repository), leagueMetrics: state.data.leagueMetrics, modelConfig });
  }
  function changeTeam(type, teamId) {
    if (!editable()) return false;
    const before = store.getState();
    if (teamId !== null && !repository.getTeam(before.data.selectedSeason, teamId)) {
      notice('TEAM_NOT_FOUND'); return false;
    }
    dispatch(type, { teamId });
    if (store.getState().matchup === before.matchup) return false;
    if (selectIsValidMatchup(store.getState(), repository)) {
      dispatch(ACTIONS.BASE_ANALYTICS_STARTED);
      try {
        const result = base();
        if (!result.eligible) dispatch(ACTIONS.BASE_ANALYTICS_FAILED, {
          status: 'insufficient-data', error: report('INSUFFICIENT_COVERAGE') });
        else dispatch(ACTIONS.BASE_ANALYTICS_SUCCEEDED, { result });
      } catch (error) {
        dispatch(ACTIONS.BASE_ANALYTICS_FAILED, { error: report('SIMULATION_FAILED', error) });
      }
    }
    return true;
  }
  async function run() {
    if (destroyed || !selectCanRunSimulation(store.getState(), repository)) return false;
    const token = ++generation;
    try {
      const matchup = base(); // Recheck both directional coverage gates at run time.
      if (!matchup.eligible) {
        dispatch(ACTIONS.SIMULATION_FAILED, { status: 'insufficient-data',
          error: report('INSUFFICIENT_COVERAGE') });
        return false;
      }
      const state = store.getState();
      const snapshot = freeze({ season: state.data.selectedSeason,
        teamAId: state.matchup.teamAId, teamBId: state.matchup.teamBId,
        teamA: structuredClone(selectTeamA(state, repository)),
        teamB: structuredClone(selectTeamB(state, repository)),
        factors: { ...state.factors }, isDivisionalMatchup: selectIsDivisionalMatchup(state, repository) });
      dispatch(ACTIONS.SIMULATION_STARTED);
      await yieldFrame();
      if (destroyed || generation !== token) return false;
      const result = await model.runScenarios({ matchup, leagueMetrics: state.data.leagueMetrics,
        factors: { ...snapshot.factors, isDivisionalMatchup: snapshot.isDivisionalMatchup },
        modelConfig, randomSource: randomSourceFactory() });
      if (destroyed || generation !== token) return false;
      validateResult(result, modelConfig, snapshot);
      const completedAt = clock();
      if (!Number.isFinite(Date.parse(completedAt))) throw new Error('Invalid completion timestamp.');
      const output = { ...result, runId: `run-${++runNumber}`, completedAt,
        datasetGeneratedAt: state.data.generatedAt, inputSnapshot: snapshot,
        baseMatchup: matchup, finalScenarioId: 'competitive-factors' };
      dispatch(ACTIONS.SIMULATION_SUCCEEDED, { result: output, inputSnapshot: snapshot });
      return true;
    } catch (error) {
      if (!destroyed && token === generation) dispatch(ACTIONS.SIMULATION_FAILED, {
        error: report('SIMULATION_FAILED', error) });
      return false;
    }
  }
  const handlers = Object.freeze({
    onTeamAChange: id => changeTeam(ACTIONS.TEAM_A_CHANGED, id),
    onTeamBChange: id => changeTeam(ACTIONS.TEAM_B_CHANGED, id),
    onFactorChange(factor, value) {
      if (!editable()) return false;
      if (!Object.hasOwn(APP_CONFIG.factors.options, factor)
        || !APP_CONFIG.factors.options[factor].includes(value)) return false;
      dispatch(ACTIONS.FACTOR_CHANGED, { factor, value }); return true;
    },
    onSeasonChange(selectedSeason) {
      if (!editable()) return false;
      if (!store.getState().data.availableSeasons.includes(selectedSeason)) {
        notice('SEASON_NOT_FOUND'); return false;
      }
      if (selectedSeason === store.getState().data.selectedSeason) return true;
      try {
        const leagueMetrics = metricsFor(selectedSeason);
        ++generation;
        dispatch(ACTIONS.SEASON_CHANGED, { selectedSeason, leagueMetrics }); return true;
      } catch (error) { notice('LEAGUE_METRICS_INVALID', error); return false; }
    },
    onRun: run,
    onReset() {
      if (destroyed || store.getState().lifecycle.status !== 'ready') return false;
      const selectedSeason = store.getState().data.availableSeasons[0];
      try {
        const leagueMetrics = metricsFor(selectedSeason);
        ++generation;
        dispatch(ACTIONS.RESET_REQUESTED, { selectedSeason, leagueMetrics }); return true;
      } catch (error) { notice('LEAGUE_METRICS_INVALID', error); return false; }
    },
  });
  async function start() {
    let phase = 'bootstrap';
    try {
      inputs = createInputController({ handlers });
      if (!['bind', 'setEnabledState', 'destroy'].every(key => typeof inputs?.[key] === 'function')) {
        throw new TypeError('Invalid input adapter.');
      }
      unsubscribe = store.subscribe(render);
      render();
      phase = 'model';
      const validation = validateModelConfig({ modelConfig, metricCatalog, appConfig: APP_CONFIG });
      if (!validation.ok) {
        dispatch(ACTIONS.APP_BOOTSTRAP_FAILED, { error: report('MODEL_CONFIGURATION_INVALID', validation.issues) });
        return false;
      }
      phase = 'bootstrap';
      inputs.bind();
      phase = 'data';
      const dataset = await repository.load({ signal: abort.signal });
      if (destroyed) return false;
      const availableSeasons = repository.getAvailableSeasons();
      const latest = Math.max(...availableSeasons);
      const leagueMetrics = metricsFor(latest);
      dispatch(ACTIONS.DATA_LOAD_SUCCEEDED, { schemaVersion: dataset.schemaVersion,
        generatedAt: dataset.generatedAt, availableSeasons, leagueMetrics });
      return true;
    } catch (error) {
      if (!destroyed) {
        const code = phase === 'model' ? 'MODEL_CONFIGURATION_INVALID'
          : phase === 'bootstrap' ? 'BOOTSTRAP_FAILED'
          : error?.code === 'DATA_SCHEMA_INVALID' ? 'DATA_SCHEMA_INVALID' : 'DATA_LOAD_FAILED';
        try { dispatch(phase !== 'data' ? ACTIONS.APP_BOOTSTRAP_FAILED : ACTIONS.DATA_LOAD_FAILED,
          { error: report(code, error) }); } catch (renderError) { report('BOOTSTRAP_FAILED', renderError); }
      }
      return false;
    }
  }
  return Object.freeze({
    initialize() {
      if (destroyed) return Promise.resolve(false);
      initialization ??= start();
      return initialization;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ++generation;
      abort.abort();
      unsubscribe?.();
      for (const cleanup of [() => inputs?.destroy(), () => renderer.destroy()]) {
        try { cleanup(); } catch (error) { report('BOOTSTRAP_FAILED', error); }
      }
      dispatch(ACTIONS.APP_DESTROYED);
    },
  });
}

export default createAppController;
