import MODEL_CONFIG from '../config/model-config.js';
import { deepFreeze } from './data-validator.js';

/** Values are already shrunk upstream. Use selected-season sample SD (n - 1). */
export function calculateLeagueMetrics(teams, modelConfig = MODEL_CONFIG) {
  if (!Array.isArray(teams)) throw new TypeError('teams must be an array.');
  const ids = [...new Set(modelConfig.metricPairs.flatMap(p => [p.offenseMetric, p.defenseMetric]))];
  const metrics = Object.fromEntries(ids.map(id => {
    const values = teams.map(t => t?.metrics?.[id]?.value)
      .filter(v => typeof v === 'number' && Number.isFinite(v));
    const validCount = values.length;
    const distinctValueCount = new Set(values).size;
    const mean = validCount ? values.reduce((sum, v) => sum + v / validCount, 0) : null;
    const deviation = validCount > 1
      ? Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2 / (validCount - 1), 0)) : null;
    const standardDeviation = Number.isFinite(deviation) ? deviation : null;
    const finiteMean = Number.isFinite(mean) ? mean : null;
    return [id, { mean: finiteMean, standardDeviation, validCount, distinctValueCount,
      usable: validCount >= 24 && distinctValueCount >= 2 && finiteMean !== null
        && standardDeviation !== null && standardDeviation > 0 }];
  }));
  // Ready describes completed calculation; coverage decides matchup eligibility.
  return deepFreeze({ status: 'ready', metrics });
}
