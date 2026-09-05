import APP_CONFIG from '../config/app-config.js';

export const ACTIONS = Object.freeze({
  APP_BOOTSTRAP_FAILED: 'APP_BOOTSTRAP_FAILED',
  DATA_LOAD_SUCCEEDED: 'DATA_LOAD_SUCCEEDED',
  DATA_LOAD_FAILED: 'DATA_LOAD_FAILED',
  SEASON_CHANGED: 'SEASON_CHANGED',
  TEAM_A_CHANGED: 'TEAM_A_CHANGED',
  TEAM_B_CHANGED: 'TEAM_B_CHANGED',
  FACTOR_CHANGED: 'FACTOR_CHANGED',
  BASE_ANALYTICS_STARTED: 'BASE_ANALYTICS_STARTED',
  BASE_ANALYTICS_SUCCEEDED: 'BASE_ANALYTICS_SUCCEEDED',
  BASE_ANALYTICS_FAILED: 'BASE_ANALYTICS_FAILED',
  SIMULATION_STARTED: 'SIMULATION_STARTED',
  SIMULATION_SUCCEEDED: 'SIMULATION_SUCCEEDED',
  SIMULATION_FAILED: 'SIMULATION_FAILED',
  RESET_REQUESTED: 'RESET_REQUESTED',
  NOTICE_SET: 'NOTICE_SET',
  NOTICE_CLEARED: 'NOTICE_CLEARED',
  APP_DESTROYED: 'APP_DESTROYED',
});

export const LIFECYCLE_STATUS = Object.freeze({
  BOOTING: 'booting',
  READY: 'ready',
  FATAL_ERROR: 'fatal-error',
  DESTROYED: 'destroyed',
});

export const BASE_ANALYTICS_STATUS = Object.freeze({
  UNAVAILABLE: 'unavailable',
  CALCULATING: 'calculating',
  READY: 'ready',
  INSUFFICIENT_DATA: 'insufficient-data',
  ERROR: 'error',
});

export const SIMULATION_STATUS = Object.freeze({
  NOT_RUN: 'not-run',
  RUNNING: 'running',
  COMPLETE: 'complete',
  INSUFFICIENT_DATA: 'insufficient-data',
  ERROR: 'error',
});

const FACTOR_KEYS = Object.freeze(Object.keys(APP_CONFIG.factors.defaults));
const ACTION_TYPES = new Set(Object.values(ACTIONS));
const READY_ONLY_ACTIONS = new Set([
  ACTIONS.SEASON_CHANGED,
  ACTIONS.TEAM_A_CHANGED,
  ACTIONS.TEAM_B_CHANGED,
  ACTIONS.FACTOR_CHANGED,
  ACTIONS.BASE_ANALYTICS_STARTED,
  ACTIONS.BASE_ANALYTICS_SUCCEEDED,
  ACTIONS.BASE_ANALYTICS_FAILED,
  ACTIONS.SIMULATION_STARTED,
  ACTIONS.SIMULATION_SUCCEEDED,
  ACTIONS.SIMULATION_FAILED,
  ACTIONS.RESET_REQUESTED,
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function copySerializable(value, path = 'value', active = new WeakSet()) {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`${path} must contain only finite numbers.`);
    }
    return value === 0 ? 0 : value;
  }
  if (typeof value !== 'object') {
    throw new TypeError(`${path} must contain only serializable values.`);
  }
  if (active.has(value)) {
    throw new TypeError(`${path} must not contain circular references.`);
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    throw new TypeError(`${path} must contain only arrays and plain objects.`);
  }

  active.add(value);
  let copy;
  if (Array.isArray(value)) {
    copy = value.map((entry, index) => (
      copySerializable(entry, `${path}[${index}]`, active)
    ));
  } else {
    copy = {};
    Object.entries(value).forEach(([key, entry]) => {
      copy[key] = copySerializable(entry, `${path}.${key}`, active);
    });
  }
  active.delete(value);
  return Object.freeze(copy);
}

function freezeState(state) {
  Object.values(state).forEach((section) => {
    if (section && typeof section === 'object' && !Object.isFrozen(section)) {
      Object.freeze(section);
    }
  });
  return Object.freeze(state);
}

function requirePlainObject(value, path) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${path} must be a plain object.`);
  }
  return value;
}

function requireNonemptyString(value, path) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${path} must be a nonempty string.`);
  }
  return value;
}

function requireTeamId(value, path) {
  if (value === null) {
    return null;
  }
  return requireNonemptyString(value, path);
}

function requireLeagueMetrics(value, path = 'action.payload.leagueMetrics') {
  requirePlainObject(value, path);
  if (value.status !== 'ready') {
    throw new RangeError(`${path}.status must be ready.`);
  }
  return copySerializable(value, path);
}

function requireErrorRecord(value, fallbackCode) {
  if (typeof value === 'string' && value.trim() !== '') {
    return copySerializable({
      code: fallbackCode,
      message: value,
    }, 'action.payload.error');
  }
  requirePlainObject(value, 'action.payload.error');
  const code = requireNonemptyString(value.code ?? fallbackCode, 'action.payload.error.code');
  const message = requireNonemptyString(
    value.message ?? APP_CONFIG.messages[code] ?? APP_CONFIG.messages[fallbackCode],
    'action.payload.error.message',
  );
  const error = { code, message };
  if ('context' in value) {
    error.context = value.context;
  }
  return copySerializable(error, 'action.payload.error');
}

function createNotice(code, message, severity = 'error') {
  return copySerializable({ code, message, severity }, 'notice');
}

function requireNotice(value) {
  requirePlainObject(value, 'action.payload.notice');
  const severity = value.severity ?? 'info';
  if (!['info', 'success', 'warning', 'error'].includes(severity)) {
    throw new RangeError('action.payload.notice.severity is invalid.');
  }
  return createNotice(
    requireNonemptyString(value.code, 'action.payload.notice.code'),
    requireNonemptyString(value.message, 'action.payload.notice.message'),
    severity,
  );
}

function requireAvailableSeasons(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError('action.payload.availableSeasons must be a nonempty array.');
  }
  const seasons = value.map((season, index) => {
    if (!Number.isInteger(season) || season < 1920) {
      throw new TypeError(`action.payload.availableSeasons[${index}] must be a valid season.`);
    }
    return season;
  });
  if (new Set(seasons).size !== seasons.length) {
    throw new RangeError('action.payload.availableSeasons must not contain duplicates.');
  }
  return Object.freeze(
    [...seasons]
      .sort((left, right) => right - left)
      .slice(0, APP_CONFIG.dataset.exposedSeasonCount),
  );
}

function requireSelectedSeason(value, availableSeasons, path = 'action.payload.selectedSeason') {
  if (!Number.isInteger(value) || !availableSeasons.includes(value)) {
    throw new RangeError(`${path} must be an exposed available season.`);
  }
  return value;
}

function requireFactorChange(payload) {
  requirePlainObject(payload, 'action.payload');
  if (!FACTOR_KEYS.includes(payload.factor)) {
    throw new RangeError('action.payload.factor is not an active Version 1 factor.');
  }
  if (!APP_CONFIG.factors.options[payload.factor].includes(payload.value)) {
    throw new RangeError(`action.payload.value is invalid for ${payload.factor}.`);
  }
  return payload;
}

function snapshotMatchesState(snapshot, state) {
  if (!isPlainObject(snapshot) || !isPlainObject(snapshot.factors)) {
    return false;
  }
  if (
    snapshot.season !== state.data.selectedSeason
    || snapshot.teamAId !== state.matchup.teamAId
    || snapshot.teamBId !== state.matchup.teamBId
  ) {
    return false;
  }
  return FACTOR_KEYS.every((key) => snapshot.factors[key] === state.factors[key]);
}

function withRecalculatedStale(simulation, candidateState) {
  if (simulation.result === null || simulation.inputSnapshot === null) {
    return simulation.isStale === false
      ? simulation
      : { ...simulation, isStale: false };
  }
  const isStale = !snapshotMatchesState(simulation.inputSnapshot, candidateState);
  return simulation.isStale === isStale
    ? simulation
    : { ...simulation, isStale };
}

function clearMatchup() {
  return {
    teamAId: null,
    teamBId: null,
    baseAnalytics: null,
    baseAnalyticsStatus: BASE_ANALYTICS_STATUS.UNAVAILABLE,
  };
}

function clearSimulation() {
  return {
    status: SIMULATION_STATUS.NOT_RUN,
    result: null,
    inputSnapshot: null,
    isStale: false,
    error: null,
  };
}

function assertStateContract(state) {
  requirePlainObject(state, 'initialState');
  copySerializable(state, 'initialState');
  if (!Object.values(LIFECYCLE_STATUS).includes(state.lifecycle?.status)) {
    throw new RangeError('initialState.lifecycle.status is invalid.');
  }
  if (!Object.values(BASE_ANALYTICS_STATUS).includes(state.matchup?.baseAnalyticsStatus)) {
    throw new RangeError('initialState.matchup.baseAnalyticsStatus is invalid.');
  }
  if (!Object.values(SIMULATION_STATUS).includes(state.simulation?.status)) {
    throw new RangeError('initialState.simulation.status is invalid.');
  }
}

function reduceState(state, action) {
  requirePlainObject(action, 'action');
  if (!ACTION_TYPES.has(action.type)) {
    throw new RangeError(`Unknown state action: ${String(action.type)}.`);
  }
  if (state.lifecycle.status === LIFECYCLE_STATUS.DESTROYED) {
    if (action.type === ACTIONS.APP_DESTROYED) {
      return state;
    }
    throw new Error('The application store has been destroyed.');
  }
  if (
    READY_ONLY_ACTIONS.has(action.type)
    && state.lifecycle.status !== LIFECYCLE_STATUS.READY
  ) {
    throw new Error(`${action.type} requires a ready application.`);
  }

  const payload = action.payload ?? {};

  switch (action.type) {
    case ACTIONS.APP_BOOTSTRAP_FAILED:
    case ACTIONS.DATA_LOAD_FAILED: {
      const fallbackCode = action.type === ACTIONS.APP_BOOTSTRAP_FAILED
        ? 'BOOTSTRAP_FAILED'
        : 'DATA_LOAD_FAILED';
      return freezeState({
        ...state,
        lifecycle: {
          status: LIFECYCLE_STATUS.FATAL_ERROR,
          fatalError: requireErrorRecord(payload.error, fallbackCode),
        },
        matchup: clearMatchup(),
        simulation: clearSimulation(),
        notice: null,
      });
    }

    case ACTIONS.DATA_LOAD_SUCCEEDED: {
      if (state.lifecycle.status !== LIFECYCLE_STATUS.BOOTING) {
        throw new Error('DATA_LOAD_SUCCEEDED requires a booting application.');
      }
      requirePlainObject(payload, 'action.payload');
      const schemaVersion = requireNonemptyString(
        payload.schemaVersion,
        'action.payload.schemaVersion',
      );
      if (schemaVersion !== APP_CONFIG.dataset.schemaVersion) {
        throw new RangeError('action.payload.schemaVersion is incompatible.');
      }
      const generatedAt = requireNonemptyString(
        payload.generatedAt,
        'action.payload.generatedAt',
      );
      if (!Number.isFinite(Date.parse(generatedAt))) {
        throw new RangeError('action.payload.generatedAt must be a valid date-time string.');
      }
      const availableSeasons = requireAvailableSeasons(payload.availableSeasons);
      const selectedSeason = payload.selectedSeason === undefined
        ? availableSeasons[0]
        : requireSelectedSeason(payload.selectedSeason, availableSeasons);
      return freezeState({
        lifecycle: { status: LIFECYCLE_STATUS.READY, fatalError: null },
        data: {
          schemaVersion,
          generatedAt,
          availableSeasons,
          selectedSeason,
          leagueMetrics: requireLeagueMetrics(payload.leagueMetrics),
        },
        matchup: clearMatchup(),
        factors: state.factors,
        simulation: clearSimulation(),
        notice: null,
      });
    }

    case ACTIONS.SEASON_CHANGED: {
      requirePlainObject(payload, 'action.payload');
      const selectedSeason = requireSelectedSeason(
        payload.selectedSeason,
        state.data.availableSeasons,
      );
      return freezeState({
        ...state,
        data: {
          ...state.data,
          selectedSeason,
          leagueMetrics: requireLeagueMetrics(payload.leagueMetrics),
        },
        matchup: clearMatchup(),
        simulation: clearSimulation(),
        notice: null,
      });
    }

    case ACTIONS.TEAM_A_CHANGED:
    case ACTIONS.TEAM_B_CHANGED: {
      requirePlainObject(payload, 'action.payload');
      const key = action.type === ACTIONS.TEAM_A_CHANGED ? 'teamAId' : 'teamBId';
      const oppositeKey = key === 'teamAId' ? 'teamBId' : 'teamAId';
      const teamId = requireTeamId(payload.teamId, 'action.payload.teamId');
      if (teamId !== null && teamId === state.matchup[oppositeKey]) {
        return freezeState({
          ...state,
          notice: createNotice(
            'DUPLICATE_TEAM_SELECTION',
            APP_CONFIG.messages.DUPLICATE_TEAM_SELECTION,
          ),
        });
      }
      if (teamId === state.matchup[key]) {
        return state;
      }
      const matchup = {
        ...state.matchup,
        [key]: teamId,
        baseAnalytics: null,
        baseAnalyticsStatus: BASE_ANALYTICS_STATUS.UNAVAILABLE,
      };
      const candidateState = { ...state, matchup };
      const simulation = withRecalculatedStale(state.simulation, candidateState);
      return freezeState({
        ...candidateState,
        simulation,
        notice: state.notice?.code === 'DUPLICATE_TEAM_SELECTION' ? null : state.notice,
      });
    }

    case ACTIONS.FACTOR_CHANGED: {
      const change = requireFactorChange(payload);
      if (state.factors[change.factor] === change.value) {
        return state;
      }
      const factors = { ...state.factors, [change.factor]: change.value };
      const candidateState = { ...state, factors };
      return freezeState({
        ...candidateState,
        simulation: withRecalculatedStale(state.simulation, candidateState),
      });
    }

    case ACTIONS.BASE_ANALYTICS_STARTED:
      if (
        state.matchup.teamAId === null
        || state.matchup.teamBId === null
        || state.matchup.teamAId === state.matchup.teamBId
      ) {
        throw new Error('BASE_ANALYTICS_STARTED requires two different selected teams.');
      }
      return freezeState({
        ...state,
        matchup: {
          ...state.matchup,
          baseAnalytics: null,
          baseAnalyticsStatus: BASE_ANALYTICS_STATUS.CALCULATING,
        },
      });

    case ACTIONS.BASE_ANALYTICS_SUCCEEDED:
      requirePlainObject(payload, 'action.payload');
      return freezeState({
        ...state,
        matchup: {
          ...state.matchup,
          baseAnalytics: copySerializable(payload.result, 'action.payload.result'),
          baseAnalyticsStatus: BASE_ANALYTICS_STATUS.READY,
        },
        notice: null,
      });

    case ACTIONS.BASE_ANALYTICS_FAILED: {
      requirePlainObject(payload, 'action.payload');
      const status = payload.status ?? BASE_ANALYTICS_STATUS.ERROR;
      if (![BASE_ANALYTICS_STATUS.INSUFFICIENT_DATA, BASE_ANALYTICS_STATUS.ERROR].includes(status)) {
        throw new RangeError('action.payload.status is invalid for base analytics failure.');
      }
      const error = requireErrorRecord(
        payload.error,
        status === BASE_ANALYTICS_STATUS.INSUFFICIENT_DATA
          ? 'INSUFFICIENT_COVERAGE'
          : 'SIMULATION_FAILED',
      );
      return freezeState({
        ...state,
        matchup: {
          ...state.matchup,
          baseAnalytics: null,
          baseAnalyticsStatus: status,
        },
        notice: createNotice(error.code, error.message),
      });
    }

    case ACTIONS.SIMULATION_STARTED:
      if (
        state.matchup.teamAId === null
        || state.matchup.teamBId === null
        || state.matchup.teamAId === state.matchup.teamBId
        || state.data.leagueMetrics?.status !== 'ready'
        || state.simulation.status === SIMULATION_STATUS.RUNNING
      ) {
        throw new Error('SIMULATION_STARTED requires an eligible nonrunning matchup.');
      }
      return freezeState({
        ...state,
        simulation: {
          ...state.simulation,
          status: SIMULATION_STATUS.RUNNING,
          error: null,
        },
        notice: null,
      });

    case ACTIONS.SIMULATION_SUCCEEDED: {
      if (state.simulation.status !== SIMULATION_STATUS.RUNNING) {
        throw new Error('SIMULATION_SUCCEEDED requires a running simulation.');
      }
      requirePlainObject(payload, 'action.payload');
      const inputSnapshot = copySerializable(
        requirePlainObject(payload.inputSnapshot, 'action.payload.inputSnapshot'),
        'action.payload.inputSnapshot',
      );
      if (!snapshotMatchesState(inputSnapshot, state)) {
        throw new RangeError('action.payload.inputSnapshot must match current simulation inputs.');
      }
      return freezeState({
        ...state,
        simulation: {
          status: SIMULATION_STATUS.COMPLETE,
          result: copySerializable(payload.result, 'action.payload.result'),
          inputSnapshot,
          isStale: false,
          error: null,
        },
        notice: null,
      });
    }

    case ACTIONS.SIMULATION_FAILED: {
      requirePlainObject(payload, 'action.payload');
      const status = payload.status ?? SIMULATION_STATUS.ERROR;
      if (![SIMULATION_STATUS.INSUFFICIENT_DATA, SIMULATION_STATUS.ERROR].includes(status)) {
        throw new RangeError('action.payload.status is invalid for simulation failure.');
      }
      const error = requireErrorRecord(
        payload.error,
        status === SIMULATION_STATUS.INSUFFICIENT_DATA
          ? 'INSUFFICIENT_COVERAGE'
          : 'SIMULATION_FAILED',
      );
      const hasPriorResult = state.simulation.result !== null;
      return freezeState({
        ...state,
        simulation: {
          ...state.simulation,
          status,
          isStale: hasPriorResult ? true : false,
          error,
        },
        notice: createNotice(error.code, error.message),
      });
    }

    case ACTIONS.RESET_REQUESTED: {
      requirePlainObject(payload, 'action.payload');
      const latestSeason = state.data.availableSeasons[0];
      const selectedSeason = payload.selectedSeason ?? latestSeason;
      if (selectedSeason !== latestSeason) {
        throw new RangeError('Reset must select the most recent available season.');
      }
      return freezeState({
        lifecycle: { status: LIFECYCLE_STATUS.READY, fatalError: null },
        data: {
          ...state.data,
          selectedSeason,
          leagueMetrics: requireLeagueMetrics(payload.leagueMetrics),
        },
        matchup: clearMatchup(),
        factors: copySerializable(APP_CONFIG.factors.defaults, 'APP_CONFIG.factors.defaults'),
        simulation: clearSimulation(),
        notice: null,
      });
    }

    case ACTIONS.NOTICE_SET:
      requirePlainObject(payload, 'action.payload');
      return freezeState({ ...state, notice: requireNotice(payload.notice) });

    case ACTIONS.NOTICE_CLEARED:
      return state.notice === null ? state : freezeState({ ...state, notice: null });

    case ACTIONS.APP_DESTROYED:
      return freezeState({
        ...state,
        lifecycle: { status: LIFECYCLE_STATUS.DESTROYED, fatalError: null },
        notice: null,
      });

    default:
      throw new RangeError(`Unknown state action: ${String(action.type)}.`);
  }
}

export function createInitialState(appConfig = APP_CONFIG) {
  requirePlainObject(appConfig, 'appConfig');
  requirePlainObject(appConfig.factors, 'appConfig.factors');
  requirePlainObject(appConfig.factors.defaults, 'appConfig.factors.defaults');
  requirePlainObject(appConfig.factors.options, 'appConfig.factors.options');
  FACTOR_KEYS.forEach((key) => {
    const value = appConfig.factors.defaults[key];
    if (!Array.isArray(appConfig.factors.options[key]) || !appConfig.factors.options[key].includes(value)) {
      throw new RangeError(`appConfig default is invalid for factor ${key}.`);
    }
  });

  return freezeState({
    lifecycle: { status: LIFECYCLE_STATUS.BOOTING, fatalError: null },
    data: {
      schemaVersion: null,
      generatedAt: null,
      availableSeasons: Object.freeze([]),
      selectedSeason: null,
      leagueMetrics: null,
    },
    matchup: clearMatchup(),
    factors: copySerializable(appConfig.factors.defaults, 'appConfig.factors.defaults'),
    simulation: clearSimulation(),
    notice: null,
  });
}

export function createStore({ initialState } = {}) {
  assertStateContract(initialState);
  let state = copySerializable(initialState, 'initialState');
  let listeners = new Set();
  let isDispatching = false;

  return Object.freeze({
    getState() {
      return state;
    },

    dispatch(action) {
      if (isDispatching) {
        throw new Error('State actions may not be dispatched from inside a reducer transition.');
      }
      isDispatching = true;
      let nextState;
      try {
        nextState = reduceState(state, action);
      } finally {
        isDispatching = false;
      }
      if (nextState !== state) {
        state = nextState;
        [...listeners].forEach((listener) => listener(state, action));
      }
      return state;
    },

    subscribe(listener) {
      if (typeof listener !== 'function') {
        throw new TypeError('listener must be a function.');
      }
      listeners.add(listener);
      let active = true;
      return function unsubscribe() {
        if (active) {
          listeners.delete(listener);
          active = false;
        }
      };
    },
  });
}

export default createStore;
