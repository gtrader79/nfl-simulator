/** Display metadata only; fitted weights and directions remain in MODEL_CONFIG. */
import MODEL_CONFIG from './model-config.js';

const labels = {
  pass_efficiency: ['Passing EPA per dropback', 'Passing EPA allowed per dropback'],
  rush_efficiency: ['Rushing EPA per attempt', 'Rushing EPA allowed per attempt'],
  success_rate: ['Offensive success rate', 'Success rate allowed'],
  pressure: ['Pressure allowed rate', 'Pressure generated rate'],
  explosiveness: ['Explosive play rate', 'Explosive play rate allowed'],
  interceptions: ['Interception rate', 'Interception forced rate'],
  fumbles: ['Fumble rate', 'Fumble forced rate'],
};

export const METRIC_CATALOG = Object.freeze(Object.fromEntries(
  MODEL_CONFIG.metricPairs.flatMap((pair) => [pair.offenseMetric, pair.defenseMetric]
    .map((id, index) => [id, Object.freeze({
      id, label: labels[pair.id][index], group: index === 0 ? 'offense' : 'defense',
      unit: pair.id === 'pass_efficiency' ? 'epa-per-dropback'
        : pair.id === 'rush_efficiency' ? 'epa-per-rush' : 'rate',
      higherIsBetter: MODEL_CONFIG.metricDirections[id].higherIsBetter,
    })])),
));

export default METRIC_CATALOG;
