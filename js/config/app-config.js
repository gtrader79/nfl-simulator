function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

export const APP_CONFIG = deepFreeze({
  dataset: {
    url: './data/nfl-simulator-data.json',
    schemaVersion: '1.0.0',
    exposedSeasonCount: 3,
    expectedTeamCount: 32,
  },
  schemaVersion: '1.0.0',
  scenarios: [
    { id: 'statistical-matchup', order: 1, label: 'Statistical Matchup' },
    { id: 'monte-carlo-variance', order: 2, label: 'Monte Carlo Variance' },
    { id: 'stadium-weather', order: 3, label: 'Stadium & Weather' },
    { id: 'fatigue', order: 4, label: 'Fatigue' },
    { id: 'competitive-factors', order: 5, label: 'Competitive Factors' },
  ],
  factors: {
    defaults: {
      venue: 'neutral',
      wind: 'normal',
      precipitation: 'none',
      travel: 'neutral',
      teamARest: 'standard',
      teamBRest: 'standard',
      gameType: 'regular-season',
      momentum: 'neutral',
    },
    options: {
      venue: ['team-a-home', 'neutral', 'team-b-home'],
      wind: ['normal', 'moderate', 'high'],
      precipitation: ['none', 'rain', 'snow'],
      travel: ['team-a-traveled', 'neutral', 'team-b-traveled'],
      teamARest: ['short', 'standard', 'extended'],
      teamBRest: ['short', 'standard', 'extended'],
      gameType: [
        'regular-season',
        'wild-card',
        'divisional-round',
        'conference-championship',
        'super-bowl',
      ],
      momentum: ['team-a', 'neutral', 'team-b'],
    },
  },
  messages: {
    BOOTSTRAP_FAILED: 'The NFL Simulator could not start.',
    CHART_LIBRARY_MISSING: 'Analytics are temporarily unavailable.',
    MATTER_LIBRARY_MISSING: 'Visual Simulation is temporarily unavailable.',
    DATA_LOAD_FAILED: 'NFL season data could not be loaded.',
    DATA_SCHEMA_INVALID: 'NFL season data is not in the expected format.',
    SEASON_NOT_FOUND: 'The selected season is unavailable.',
    TEAM_NOT_FOUND: 'The selected team is unavailable for this season.',
    DUPLICATE_TEAM_SELECTION: 'Choose two different teams.',
    LEAGUE_METRICS_INVALID: 'Selected-season league metrics are unavailable.',
    INSUFFICIENT_COVERAGE: 'Insufficient data to run a reliable simulation for this matchup.',
    MODEL_CONFIGURATION_INVALID: 'The approved model configuration could not be validated.',
    SIMULATION_FAILED: 'The simulation could not be completed.',
    CHART_DATA_UNAVAILABLE: 'The required chart data is unavailable.',
    CHART_RENDER_FAILED: 'This chart could not be displayed.',
    BALL_DROP_UNAVAILABLE: 'Visual Simulation is temporarily unavailable.',
  },
});

export default APP_CONFIG;
