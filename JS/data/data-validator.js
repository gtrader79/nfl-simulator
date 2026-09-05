import APP_CONFIG from '../config/app-config.js';
import MODEL_CONFIG from '../config/model-config.js';

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

/** Reject malformed data before it can reach state or normalization. */
export function validateDataset(input, modelConfig = MODEL_CONFIG) {
  const fail = (path) => {
    const error = new Error(`Invalid NFL dataset: ${path}`);
    error.code = 'DATA_SCHEMA_INVALID';
    throw error;
  };
  const object = (v, p) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(p);
  };
  const string = (v, p) => { if (typeof v !== 'string' || !v.trim()) fail(p); };
  const integer = (v, p, min = 0, max = Infinity) => {
    if (!Number.isInteger(v) || v < min || v > max) fail(p);
  };
  const date = (v, p) => {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)
      || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString().slice(0, 10) !== v) fail(p);
  };
  object(input, 'root');
  if (input.schemaVersion !== APP_CONFIG.dataset.schemaVersion) fail('schemaVersion');
  if (input.datasetId !== 'nfl-simulator') fail('datasetId');
  if (typeof input.generatedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(input.generatedAt)
    || !Number.isFinite(Date.parse(input.generatedAt))) fail('generatedAt');
  date(input.generatedAt.slice(0, 10), 'generatedAt');
  object(input.source, 'source');
  string(input.source.provider, 'source.provider');
  string(input.source.description, 'source.description');
  if (!Array.isArray(input.seasons) || !input.seasons.length) fail('seasons');
  const required = [...new Set(modelConfig.metricPairs.flatMap(p => [p.offenseMetric, p.defenseMetric]))];
  const years = new Set();
  const seasons = input.seasons.map((season) => {
    object(season, 'season');
    integer(season.season, 'season.year', 1);
    if (years.has(season.season)) fail('duplicate season');
    years.add(season.season);
    date(season.updatedDate, 'season.updatedDate');
    object(season.period, 'season.period');
    const { type, week, postseasonRound } = season.period;
    if (type === 'regular-season') {
      integer(week, 'period.week', 1);
      if (postseasonRound !== null) fail('period.postseasonRound');
    } else if (type === 'postseason') {
      if (week !== null || !['wild-card', 'divisional-round', 'conference-championship', 'super-bowl']
        .includes(postseasonRound)) fail('period.postseasonRound');
    } else fail('period.type');
    if (!Array.isArray(season.teams) || season.teams.length !== 32) fail('season.teams: expected 32');
    const ids = new Set();
    const abbreviations = new Set();
    const teams = season.teams.map(team => {
      object(team, 'team');
      for (const key of ['teamId', 'abbreviation', 'teamName']) string(team[key], `team.${key}`);
      if (ids.has(team.teamId) || abbreviations.has(team.abbreviation)) fail('duplicate team identity');
      ids.add(team.teamId); abbreviations.add(team.abbreviation);
      string(team.conference, 'team.conference');
      string(team.division, 'team.division');
      object(team.colors, 'team.colors');
      const colors = {};
      for (const key of ['primary', 'secondary', 'tertiary']) {
        const value = team.colors[key];
        if (!(key !== 'primary' && value === null)
          && (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value))) fail(`colors.${key}`);
        colors[key] = value;
      }
      object(team.record, 'team.record');
      const record = {};
      for (const key of ['wins', 'losses', 'ties', 'gamesPlayed']) {
        integer(team.record[key], `record.${key}`); record[key] = team.record[key];
      }
      if (record.gamesPlayed !== record.wins + record.losses + record.ties) fail('record.gamesPlayed');
      object(team.metrics, 'team.metrics');
      for (const id of required) if (!Object.hasOwn(team.metrics, id)) fail(`missing metric ${id}`);
      const metrics = Object.fromEntries(Object.entries(team.metrics).map(([id, metric]) => {
        object(metric, `metrics.${id}`);
        if (metric.value !== null && (typeof metric.value !== 'number' || !Number.isFinite(metric.value))) fail(`metrics.${id}.value`);
        if (metric.rank !== null) integer(metric.rank, `metrics.${id}.rank`, 1, 32);
        if (metric.sampleSize !== null) integer(metric.sampleSize, `metrics.${id}.sampleSize`);
        if (metric.value === null && metric.rank !== null) fail(`metrics.${id}.rank`);
        return [id, { value: metric.value, rank: metric.rank, sampleSize: metric.sampleSize }];
      }));
      return { teamId: team.teamId, abbreviation: team.abbreviation, teamName: team.teamName,
        conference: team.conference, division: team.division, colors, record, metrics };
    });
    return { season: season.season, updatedDate: season.updatedDate,
      period: { type, week, postseasonRound }, teams };
  });
  return deepFreeze({ schemaVersion: input.schemaVersion, datasetId: input.datasetId,
    generatedAt: input.generatedAt, source: { provider: input.source.provider, description: input.source.description },
    seasons: seasons.sort((a, b) => b.season - a.season) });
}
