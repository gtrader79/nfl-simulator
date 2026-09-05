import {
  BASE_ANALYTICS_STATUS,
  LIFECYCLE_STATUS,
  SIMULATION_STATUS,
} from './store.js';

function requireState(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    throw new TypeError('state must be an object.');
  }
  return state;
}

function requireRepository(repository) {
  if (
    repository === null
    || typeof repository !== 'object'
    || typeof repository.getSeason !== 'function'
    || typeof repository.getTeam !== 'function'
  ) {
    throw new TypeError('repository must provide getSeason() and getTeam().');
  }
  return repository;
}

function formatUpdatedDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return null;
  }
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

function getPeriodLabel(season) {
  if (season?.period?.type === 'regular-season' && Number.isInteger(season.period.week)) {
    return `Week ${season.period.week}`;
  }
  if (
    season?.period?.type === 'postseason'
    && typeof season.period.postseasonRound === 'string'
    && season.period.postseasonRound.trim() !== ''
  ) {
    return ({ 'wild-card': 'Wild Card', 'divisional-round': 'Divisional Round',
      'conference-championship': 'Conference Championship', 'super-bowl': 'Super Bowl' })
      [season.period.postseasonRound] ?? season.period.postseasonRound;
  }
  return null;
}

export function selectAvailableSeasons(state) {
  requireState(state);
  return state.data.availableSeasons;
}

export function selectSelectedSeason(state, repository) {
  requireState(state);
  requireRepository(repository);
  if (!Number.isInteger(state.data.selectedSeason)) {
    return null;
  }
  return repository.getSeason(state.data.selectedSeason) ?? null;
}

export function selectTeamA(state, repository) {
  requireState(state);
  requireRepository(repository);
  if (!Number.isInteger(state.data.selectedSeason) || state.matchup.teamAId === null) {
    return null;
  }
  return repository.getTeam(state.data.selectedSeason, state.matchup.teamAId) ?? null;
}

export function selectTeamB(state, repository) {
  requireState(state);
  requireRepository(repository);
  if (!Number.isInteger(state.data.selectedSeason) || state.matchup.teamBId === null) {
    return null;
  }
  return repository.getTeam(state.data.selectedSeason, state.matchup.teamBId) ?? null;
}

export function selectIsValidMatchup(state, repository) {
  const teamA = selectTeamA(state, repository);
  const teamB = selectTeamB(state, repository);
  return Boolean(
    teamA
    && teamB
    && typeof teamA.teamId === 'string'
    && typeof teamB.teamId === 'string'
    && teamA.teamId !== teamB.teamId,
  );
}

export function selectIsDivisionalMatchup(state, repository) {
  if (!selectIsValidMatchup(state, repository)) {
    return false;
  }
  const teamA = selectTeamA(state, repository);
  const teamB = selectTeamB(state, repository);
  return Boolean(
    typeof teamA.conference === 'string'
    && teamA.conference !== ''
    && teamA.conference === teamB.conference
    && typeof teamA.division === 'string'
    && teamA.division !== ''
    && teamA.division === teamB.division,
  );
}

export function selectCanRunSimulation(state, repository) {
  requireState(state);
  return state.lifecycle.status === LIFECYCLE_STATUS.READY
    && selectIsValidMatchup(state, repository)
    && state.data.leagueMetrics?.status === 'ready'
    && state.simulation.status !== SIMULATION_STATUS.RUNNING;
}

export function selectAreResultsStale(state) {
  requireState(state);
  return state.simulation.isStale === true;
}

export function selectBaseAnalytics(state) {
  requireState(state);
  return state.matchup.baseAnalyticsStatus === BASE_ANALYTICS_STATUS.READY
    ? state.matchup.baseAnalytics
    : null;
}

export function selectSimulationDisplayResult(state) {
  requireState(state);
  return state.simulation.result;
}

export function selectFreshnessDisplay(state, repository) {
  const season = selectSelectedSeason(state, repository);
  if (!season) {
    return null;
  }
  const periodLabel = getPeriodLabel(season);
  const updatedDate = formatUpdatedDate(season.updatedDate);
  if (!periodLabel || !updatedDate) {
    return null;
  }
  return Object.freeze({
    season: season.season,
    periodLabel,
    updatedDate,
    text: `${season.season} season data through ${periodLabel} — Updated ${updatedDate}`,
  });
}

export function selectViewModel(state, repository) {
  requireState(state);
  requireRepository(repository);
  const selectedSeason = selectSelectedSeason(state, repository);
  const teamA = selectTeamA(state, repository);
  const teamB = selectTeamB(state, repository);
  const isValidMatchup = selectIsValidMatchup(state, repository);

  return Object.freeze({
    lifecycleStatus: state.lifecycle.status,
    fatalError: state.lifecycle.fatalError,
    availableSeasons: selectAvailableSeasons(state),
    selectedSeason,
    teamA,
    teamB,
    factors: state.factors,
    isValidMatchup,
    isDivisionalMatchup: isValidMatchup
      ? selectIsDivisionalMatchup(state, repository)
      : false,
    canRunSimulation: selectCanRunSimulation(state, repository),
    baseAnalyticsStatus: state.matchup.baseAnalyticsStatus,
    baseAnalytics: selectBaseAnalytics(state),
    simulationStatus: state.simulation.status,
    simulationResult: selectSimulationDisplayResult(state),
    simulationInputSnapshot: state.simulation.inputSnapshot,
    areResultsStale: selectAreResultsStale(state),
    freshness: selectFreshnessDisplay(state, repository),
    notice: state.notice,
  });
}

export default selectViewModel;
