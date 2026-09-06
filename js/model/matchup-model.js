import { evaluateCoverage } from './coverage.js';

export const MATCHUP_STATUS = Object.freeze({
  READY: 'ready',
  INSUFFICIENT_DATA: 'insufficient-data',
});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function requireTeam(team, argumentName) {
  if (
    !isPlainObject(team)
    || typeof team.teamId !== 'string'
    || team.teamId.trim() === ''
    || !isPlainObject(team.metrics)
  ) {
    throw new TypeError(`${argumentName} must have a nonempty teamId and metrics object.`);
  }
}

function requireDirection(modelConfig, metricId) {
  const direction = modelConfig?.metricDirections?.[metricId];
  if (!isPlainObject(direction) || typeof direction.higherIsBetter !== 'boolean') {
    throw new TypeError(`Missing strength direction for metric ${metricId}.`);
  }
  return direction.higherIsBetter ? 1 : -1;
}

function calculateZScore(value, distribution, direction, metricId) {
  const zScore = direction * (
    (value - distribution.mean) / distribution.standardDeviation
  );
  if (!Number.isFinite(zScore)) {
    throw new RangeError(`Metric ${metricId} produced a nonfinite strength Z-score.`);
  }
  return zScore;
}

function buildUnavailableContribution(pair) {
  return {
    pairId: pair.id,
    offenseMetric: pair.offenseMetric,
    defenseMetric: pair.defenseMetric,
    active: pair.active,
    available: false,
    unavailableReasons: [...pair.unavailableReasons],
    nominalCoefficient: pair.coefficient,
    effectiveCoefficient: pair.effectiveCoefficient,
    nominalCoverageContribution: pair.nominalCoverageContribution,
    offenseValue: pair.offenseValue,
    defenseValue: pair.defenseValue,
    offenseZScore: null,
    defenseZScore: null,
    matchupFeature: null,
    contribution: pair.active ? null : 0,
  };
}

function calculateDirection({ offenseTeam, defenseTeam, leagueMetrics, modelConfig }) {
  const coverage = evaluateCoverage({
    offenseTeam,
    defenseTeam,
    leagueMetrics,
    modelConfig,
  });

  if (!coverage.eligible) {
    return deepFreeze({
      status: MATCHUP_STATUS.INSUFFICIENT_DATA,
      eligible: false,
      offenseTeamId: offenseTeam.teamId,
      defenseTeamId: defenseTeam.teamId,
      score: null,
      coverage,
      contributions: coverage.pairs.map(buildUnavailableContribution),
    });
  }

  let score = 0;
  const contributions = coverage.pairs.map((pair) => {
    if (!pair.available) {
      return buildUnavailableContribution(pair);
    }

    const offenseDirection = requireDirection(modelConfig, pair.offenseMetric);
    const defenseDirection = requireDirection(modelConfig, pair.defenseMetric);
    const offenseZScore = calculateZScore(
      pair.offenseValue,
      pair.offenseDistribution,
      offenseDirection,
      pair.offenseMetric,
    );
    const defenseZScore = calculateZScore(
      pair.defenseValue,
      pair.defenseDistribution,
      defenseDirection,
      pair.defenseMetric,
    );
    const matchupFeature = offenseZScore - defenseZScore;
    const contribution = pair.effectiveCoefficient * matchupFeature;
    if (!Number.isFinite(matchupFeature) || !Number.isFinite(contribution)) {
      throw new RangeError(`Metric pair ${pair.id} produced a nonfinite contribution.`);
    }
    score += contribution;

    return {
      pairId: pair.id,
      offenseMetric: pair.offenseMetric,
      defenseMetric: pair.defenseMetric,
      active: true,
      available: true,
      unavailableReasons: [],
      nominalCoefficient: pair.coefficient,
      effectiveCoefficient: pair.effectiveCoefficient,
      nominalCoverageContribution: pair.nominalCoverageContribution,
      offenseValue: pair.offenseValue,
      defenseValue: pair.defenseValue,
      offenseZScore,
      defenseZScore,
      matchupFeature,
      contribution,
    };
  });

  if (!Number.isFinite(score)) {
    throw new RangeError('Directional matchup score must be finite.');
  }

  return deepFreeze({
    status: MATCHUP_STATUS.READY,
    eligible: true,
    offenseTeamId: offenseTeam.teamId,
    defenseTeamId: defenseTeam.teamId,
    score,
    coverage,
    contributions,
  });
}

/**
 * Calculates the deterministic Version 1 base statistical matchup.
 *
 * Positive scoreDelta favors Team A. This function does not perform
 * probability calibration, residual sampling, or situational adjustment.
 */
export function calculateBaseMatchup({
  teamA,
  teamB,
  leagueMetrics,
  modelConfig,
} = {}) {
  requireTeam(teamA, 'teamA');
  requireTeam(teamB, 'teamB');
  if (teamA.teamId === teamB.teamId) {
    throw new RangeError('teamA and teamB must identify different teams.');
  }

  const teamAOffenseVsTeamBDefense = calculateDirection({
    offenseTeam: teamA,
    defenseTeam: teamB,
    leagueMetrics,
    modelConfig,
  });
  const teamBOffenseVsTeamADefense = calculateDirection({
    offenseTeam: teamB,
    defenseTeam: teamA,
    leagueMetrics,
    modelConfig,
  });
  const eligible = teamAOffenseVsTeamBDefense.eligible
    && teamBOffenseVsTeamADefense.eligible;

  if (!eligible) {
    const insufficientDirections = [];
    if (!teamAOffenseVsTeamBDefense.eligible) {
      insufficientDirections.push('team-a-offense-vs-team-b-defense');
    }
    if (!teamBOffenseVsTeamADefense.eligible) {
      insufficientDirections.push('team-b-offense-vs-team-a-defense');
    }
    return deepFreeze({
      status: MATCHUP_STATUS.INSUFFICIENT_DATA,
      eligible: false,
      teamAId: teamA.teamId,
      teamBId: teamB.teamId,
      scoreDelta: null,
      insufficientDirections,
      teamAOffenseVsTeamBDefense,
      teamBOffenseVsTeamADefense,
    });
  }

  const scoreDelta = teamAOffenseVsTeamBDefense.score
    - teamBOffenseVsTeamADefense.score;
  if (!Number.isFinite(scoreDelta)) {
    throw new RangeError('Base matchup score delta must be finite.');
  }

  return deepFreeze({
    status: MATCHUP_STATUS.READY,
    eligible: true,
    teamAId: teamA.teamId,
    teamBId: teamB.teamId,
    scoreDelta,
    insufficientDirections: [],
    teamAOffenseVsTeamBDefense,
    teamBOffenseVsTeamADefense,
  });
}

export default calculateBaseMatchup;
