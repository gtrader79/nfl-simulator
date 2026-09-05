import APP_CONFIG from '../config/app-config.js';
import MODEL_CONFIG from '../config/model-config.js';
import { validateDataset } from './data-validator.js';

export function createDataRepository({ url = APP_CONFIG.dataset.url,
  fetchImpl = globalThis.fetch, modelConfig = MODEL_CONFIG } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function.');
  let dataset = null;
  let request = 0;
  const abortError = () => Object.assign(new Error('Data loading was canceled.'), { name: 'AbortError' });
  return Object.freeze({
    async load({ signal } = {}) {
      const current = ++request;
      dataset = null;
      try {
        if (signal?.aborted) throw abortError();
        const response = await fetchImpl(url, { signal, cache: 'no-cache' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const raw = await response.json();
        if (signal?.aborted || current !== request) throw abortError();
        const validated = validateDataset(raw, modelConfig);
        dataset = validated;
        return validated;
      } catch (error) {
        if (error.name === 'AbortError' || error.code === 'DATA_SCHEMA_INVALID') throw error;
        throw Object.assign(new Error('NFL season data could not be loaded.'),
          { code: 'DATA_LOAD_FAILED', cause: error });
      }
    },
    getAvailableSeasons() {
      return Object.freeze((dataset?.seasons ?? []).slice(0, APP_CONFIG.dataset.exposedSeasonCount).map(s => s.season));
    },
    getSeason(year) {
      return dataset?.seasons.slice(0, APP_CONFIG.dataset.exposedSeasonCount).find(s => s.season === year) ?? null;
    },
    getTeam(year, teamId) {
      return this.getSeason(year)?.teams.find(t => t.teamId === teamId) ?? null;
    },
  });
}
