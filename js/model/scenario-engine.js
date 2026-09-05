import { isFiniteNumber } from '../core/math.js';
import { APPROVED_SCENARIOS } from './model-config-validator.js';
import { calculateBaseMatchup } from './matchup-model.js';
import { simulateDistribution, summarizeDistribution } from './monte-carlo.js';
import { toWinProbabilities } from './probability-model.js';

export const SCENARIO_RUN_STATUS = Object.freeze({
  COMPLETE: 'complete',
  INSUFFICIENT_DATA: 'insufficient-data',
});

export const FACTOR_OPTIONS = Object.freeze({
  venue: Object.freeze(['team-a-home', 'neutral', 'team-b-home']),
  wind: Object.freeze(['normal', 'moderate', 'high']),
  precipitation: Object.freeze(['none', 'rain', 'snow']),
  travel: Object.freeze(['team-a-traveled', 'neutral', 'team-b-traveled']),
  rest: Object.freeze(['short', 'standard', 'extended']),
  gameType: Object.freeze([
    'regular-season',
    'wild-card',
    'divisional-round',
    'conference-championship',
    'super-bowl',
  ]),
  momentum: Object.freeze(['team-a', 'neutral', 'team-b']),
});

const PASS_COMPONENT_PAIR_IDS = Object.freeze(new Set([
  'pass_efficiency',
  'pressure',
  'explosiveness',
]));

const VENUE_SIGN = Object.freeze({
  'team-a-home': 1,
  neutral: 0,
  'team-b-home': -1,
});

const WIND_MPH = Object.freeze({
  normal: 5,
  moderate: 17.5,
  high: 27.5,
});

const TRAVEL_SIGN = Object.freeze({
  'team-a-traveled': -1,
  neutral: 0,
  'team-b-traveled': 1,
});

const MOMENTUM_SIGN = Object.freeze({
  'team-a': 1,
  neutral: 0,
  'team-b': -1,
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

function canonicalizeZero(value) {
  return value === 0 ? 0 : value;
}

function requireOption(value, options, path) {
  if (!options.includes(value)) {
    throw new RangeError(`${path} must be one of: ${options.join(', ')}.`);
  }
}

function requireFactors(factors) {
  if (!isPlainObject(factors)) {
    throw new TypeError('factors must be a plain object.');
  }
  requireOption(factors.venue, FACTOR_OPTIONS.venue, 'factors.venue');
  requireOption(factors.wind, FACTOR_OPTIONS.wind, 'factors.wind');
  requireOption(
    factors.precipitation,
    FACTOR_OPTIONS.precipitation,
    'factors.precipitation',
  );
  requireOption(factors.travel, FACTOR_OPTIONS.travel, 'factors.travel');
  requireOption(factors.teamARest, FACTOR_OPTIONS.rest, 'factors.teamARest');
  requireOption(factors.teamBRest, FACTOR_OPTIONS.rest, 'factors.teamBRest');
  requireOption(factors.gameType, FACTOR_OPTIONS.gameType, 'factors.gameType');
  requireOption(factors.momentum, FACTOR_OPTIONS.momentum, 'factors.momentum');
  if (typeof factors.isDivisionalMatchup !== 'boolean') {
    throw new TypeError('factors.isDivisionalMatchup must be Boolean.');
  }
}

function requireSituationalConfig(modelConfig) {
  if (!isPlainObject(modelConfig) || !isPlainObject(modelConfig.situational)) {
    throw new TypeError('modelConfig.situational must be a plain object.');
  }
  const situational = modelConfig.situational;
  const values = [
    situational.venue,
    situational.wind?.above10Pass,
    situational.wind?.above20Pass,
    situational.precipitation?.rainScore,
    situational.precipitation?.snowScore,
    situational.travelEast,
    situational.rest?.short,
    situational.rest?.extended,
    situational.gameType?.wildCard,
    situational.gameType?.divisional,
    situational.gameType?.conference,
    situational.gameType?.superBowl,
    situational.momentum,
    situational.divisionHomeInteraction,
  ];
  if (!values.every(isFiniteNumber)) {
    throw new TypeError('Every situational coefficient must be finite.');
  }
  if (!isPlainObject(modelConfig.probabilityCalibration)) {
    throw new TypeError('modelConfig.probabilityCalibration must be a plain object.');
  }
  if (!isPlainObject(modelConfig.residualDistribution)) {
    throw new TypeError('modelConfig.residualDistribution must be a plain object.');
  }
  return situational;
}

function resolveBaseMatchup(matchup, leagueMetrics, modelConfig) {
  if (!isPlainObject(matchup)) {
    throw new TypeError('matchup must be a plain object.');
  }
  if ('teamA' in matchup || 'teamB' in matchup) {
    return calculateBaseMatchup({
      teamA: matchup.teamA,
      teamB: matchup.teamB,
      leagueMetrics,
      modelConfig,
    });
  }
  if (
    typeof matchup.eligible !== 'boolean'
    || typeof matchup.status !== 'string'
    || typeof matchup.teamAId !== 'string'
    || typeof matchup.teamBId !== 'string'
  ) {
    throw new TypeError('matchup must be a base-matchup result or contain teamA and teamB.');
  }
  if (matchup.eligible && !isFiniteNumber(matchup.scoreDelta)) {
    throw new TypeError('An eligible matchup requires a finite scoreDelta.');
  }
  return matchup;
}

function copyFactors(factors) {
  return {
    venue: factors.venue,
    wind: factors.wind,
    precipitation: factors.precipitation,
    travel: factors.travel,
    teamARest: factors.teamARest,
    teamBRest: factors.teamBRest,
    gameType: factors.gameType,
    momentum: factors.momentum,
    isDivisionalMatchup: factors.isDivisionalMatchup,
  };
}

function sumPassContributions(direction) {
  if (!Array.isArray(direction?.contributions)) {
    throw new TypeError('Eligible matchup directions require contribution arrays.');
  }
  return direction.contributions.reduce((sum, contribution) => {
    if (!PASS_COMPONENT_PAIR_IDS.has(contribution.pairId)) {
      return sum;
    }
    if (contribution.contribution === null) {
      return sum;
    }
    if (!isFiniteNumber(contribution.contribution)) {
      throw new TypeError('Available matchup contributions must be finite.');
    }
    return sum + contribution.contribution;
  }, 0);
}

function getPassComponent(baseMatchup) {
  const teamAPass = sumPassContributions(baseMatchup.teamAOffenseVsTeamBDefense);
  const teamBPass = sumPassContributions(baseMatchup.teamBOffenseVsTeamADefense);
  const passComponent = teamAPass - teamBPass;
  if (!isFiniteNumber(passComponent)) {
    throw new RangeError('Pass-component score must remain finite.');
  }
  return passComponent;
}

function calculateAdjustments(baseMatchup, factors, situational) {
  const baseScore = baseMatchup.scoreDelta;
  const venueSign = VENUE_SIGN[factors.venue];
  const representativeWindMph = WIND_MPH[factors.wind];
  const passComponent = getPassComponent(baseMatchup);
  const windBasis = (
    situational.wind.above10Pass * Math.max(representativeWindMph - 10, 0)
  ) + (
    situational.wind.above20Pass * Math.max(representativeWindMph - 20, 0)
  );
  const venue = situational.venue * venueSign;
  const wind = windBasis * passComponent;
  const precipitationCoefficient = factors.precipitation === 'rain'
    ? situational.precipitation.rainScore
    : factors.precipitation === 'snow'
      ? situational.precipitation.snowScore
      : 0;
  const precipitation = precipitationCoefficient * baseScore;
  const stadiumWeatherTotal = venue + wind + precipitation;

  const travelSign = TRAVEL_SIGN[factors.travel];
  const shortRestDifference = Number(factors.teamARest === 'short')
    - Number(factors.teamBRest === 'short');
  const extendedRestDifference = Number(factors.teamARest === 'extended')
    - Number(factors.teamBRest === 'extended');
  const travel = situational.travelEast * travelSign;
  const shortRest = situational.rest.short * shortRestDifference;
  const extendedRest = situational.rest.extended * extendedRestDifference;
  const fatigueTotal = travel + shortRest + extendedRest;

  const gameTypeCoefficient = {
    'regular-season': 0,
    'wild-card': situational.gameType.wildCard,
    'divisional-round': situational.gameType.divisional,
    'conference-championship': situational.gameType.conference,
    'super-bowl': situational.gameType.superBowl,
  }[factors.gameType];
  const momentumSign = MOMENTUM_SIGN[factors.momentum];
  const divisionalIndicator = Number(factors.isDivisionalMatchup);
  const gameType = baseScore * gameTypeCoefficient;
  const momentum = situational.momentum * momentumSign;
  const divisionHome = situational.divisionHomeInteraction
    * divisionalIndicator
    * venueSign;
  const competitiveTotal = gameType + momentum + divisionHome;

  const finiteValues = [
    venueSign,
    representativeWindMph,
    passComponent,
    windBasis,
    venue,
    wind,
    precipitationCoefficient,
    precipitation,
    stadiumWeatherTotal,
    travelSign,
    shortRestDifference,
    extendedRestDifference,
    travel,
    shortRest,
    extendedRest,
    fatigueTotal,
    gameTypeCoefficient,
    momentumSign,
    divisionalIndicator,
    gameType,
    momentum,
    divisionHome,
    competitiveTotal,
  ];
  if (!finiteValues.every(isFiniteNumber)) {
    throw new RangeError('Situational adjustments must remain finite.');
  }

  return {
    stadiumWeather: {
      venueSign: canonicalizeZero(venueSign),
      representativeWindMph: canonicalizeZero(representativeWindMph),
      passComponent: canonicalizeZero(passComponent),
      windBasis: canonicalizeZero(windBasis),
      venue: canonicalizeZero(venue),
      wind: canonicalizeZero(wind),
      precipitationCoefficient: canonicalizeZero(precipitationCoefficient),
      precipitation: canonicalizeZero(precipitation),
      total: canonicalizeZero(stadiumWeatherTotal),
    },
    fatigue: {
      travelSign: canonicalizeZero(travelSign),
      shortRestDifference: canonicalizeZero(shortRestDifference),
      extendedRestDifference: canonicalizeZero(extendedRestDifference),
      travel: canonicalizeZero(travel),
      shortRest: canonicalizeZero(shortRest),
      extendedRest: canonicalizeZero(extendedRest),
      total: canonicalizeZero(fatigueTotal),
    },
    competitive: {
      gameTypeCoefficient: canonicalizeZero(gameTypeCoefficient),
      momentumSign: canonicalizeZero(momentumSign),
      divisionalIndicator: canonicalizeZero(divisionalIndicator),
      gameType: canonicalizeZero(gameType),
      momentum: canonicalizeZero(momentum),
      divisionHome: canonicalizeZero(divisionHome),
      total: canonicalizeZero(competitiveTotal),
    },
  };
}

function createProbabilitySummary(teamAProbabilitySamples) {
  const teamA = summarizeDistribution(teamAProbabilitySamples);
  const teamB = {
    count: teamA.count,
    mean: 1 - teamA.mean,
    p5: 1 - teamA.p95,
    median: 1 - teamA.median,
    p95: 1 - teamA.p5,
  };
  return { teamA, teamB };
}

function createScenario({
  definition,
  scoreSamples,
  probabilityCalibration,
  deterministic,
  cumulativeAdjustment,
}) {
  const teamAProbabilitySamples = scoreSamples.map((scoreDelta) => (
    toWinProbabilities({
      scoreDelta,
      calibration: probabilityCalibration,
    }).teamAProbability
  ));
  const latentScoreSummary = summarizeDistribution(scoreSamples);
  const probabilitySummary = createProbabilitySummary(teamAProbabilitySamples);

  return {
    id: definition.id,
    order: definition.order,
    deterministic,
    cumulativeAdjustment,
    latentScoreSummary,
    probabilitySummary,
    teamAProbabilitySamples: Object.freeze(teamAProbabilitySamples),
  };
}

/**
 * Executes the five approved scenarios cumulatively.
 *
 * `matchup` may be a certified base-matchup result or `{teamA, teamB}`. The
 * latter form uses `leagueMetrics` to calculate the base result first.
 */
export function runScenarios({
  matchup,
  factors,
  leagueMetrics,
  modelConfig,
  randomSource,
} = {}) {
  requireFactors(factors);
  const situational = requireSituationalConfig(modelConfig);
  const baseMatchup = resolveBaseMatchup(matchup, leagueMetrics, modelConfig);
  const factorsSnapshot = copyFactors(factors);

  if (!baseMatchup.eligible) {
    return deepFreeze({
      status: SCENARIO_RUN_STATUS.INSUFFICIENT_DATA,
      eligible: false,
      modelVersion: modelConfig.modelVersion,
      teamAId: baseMatchup.teamAId,
      teamBId: baseMatchup.teamBId,
      baseScore: null,
      factors: factorsSnapshot,
      adjustments: null,
      residuals: [],
      scenarios: [],
    });
  }

  const baseScore = baseMatchup.scoreDelta;
  const adjustments = calculateAdjustments(baseMatchup, factors, situational);
  const simulation = simulateDistribution({
    baseScore,
    varianceConfig: modelConfig.residualDistribution,
    iterations: modelConfig.iterations,
    randomSource,
  });
  const stadiumWeatherScore = baseScore + adjustments.stadiumWeather.total;
  const fatigueScore = stadiumWeatherScore + adjustments.fatigue.total;
  const competitiveScore = fatigueScore + adjustments.competitive.total;

  const scenarioScoreSamples = [
    [baseScore],
    simulation.samples,
    simulation.residuals.map((residual) => stadiumWeatherScore + residual),
    simulation.residuals.map((residual) => fatigueScore + residual),
    simulation.residuals.map((residual) => competitiveScore + residual),
  ];
  const cumulativeAdjustments = [
    0,
    0,
    adjustments.stadiumWeather.total,
    adjustments.stadiumWeather.total + adjustments.fatigue.total,
    adjustments.stadiumWeather.total
      + adjustments.fatigue.total
      + adjustments.competitive.total,
  ];

  const scenarios = APPROVED_SCENARIOS.map((definition, index) => createScenario({
    definition,
    scoreSamples: scenarioScoreSamples[index],
    probabilityCalibration: modelConfig.probabilityCalibration,
    deterministic: index === 0,
    cumulativeAdjustment: cumulativeAdjustments[index],
  }));

  return deepFreeze({
    status: SCENARIO_RUN_STATUS.COMPLETE,
    eligible: true,
    modelVersion: modelConfig.modelVersion,
    teamAId: baseMatchup.teamAId,
    teamBId: baseMatchup.teamBId,
    baseScore,
    factors: factorsSnapshot,
    adjustments,
    residuals: [...simulation.residuals],
    scenarios,
  });
}

export default runScenarios;
