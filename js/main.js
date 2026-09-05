import { createAppController } from './app-controller.js';
import { createDataRepository } from './data/data-repository.js';
import { calculateLeagueMetrics } from './data/league-metrics.js';
import { createStore, createInitialState } from './state/store.js';
import METRIC_CATALOG from './config/metric-catalog.js';
import { createRenderer } from './ui/renderer.js';
import { createInputController } from './ui/input-controller.js';

function start() {
  let controller;
  try {
    const root = document.getElementById('app');
    for (const id of ['app','season','team-a','team-b','prediction','prediction-content','condition-groups','base-content','stats-content','announcer']) {
      if (!document.getElementById(id)) throw new Error(`Required UI element missing: ${id}`);
    }
    for (const key of ['fetch','AbortController','structuredClone']) {
      if (typeof globalThis[key] !== 'function') throw new Error(`Browser capability missing: ${key}`);
    }
    if (!globalThis.crypto?.getRandomValues) throw new Error('Secure random source unavailable');
    const renderer = createRenderer({ root });
    controller = createAppController({
      store: createStore({ initialState: createInitialState() }), repository: createDataRepository(),
      calculateLeagueMetrics, metricCatalog: METRIC_CATALOG, renderer,
      createInputController: ({ handlers }) => createInputController({ root, handlers }),
    });
    void controller.initialize();
    window.addEventListener('pagehide', () => controller.destroy(), { once: true });
    window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
  } catch (error) {
    controller?.destroy(); console.error({ code: 'BOOTSTRAP_FAILED', module: 'main', cause: error });
    const target = document.getElementById('fatal-error') ?? document.body;
    target.hidden = false; target.textContent = 'The NFL Simulator could not start. Reload the page or use a current browser.';
    document.querySelectorAll('button,select,input').forEach(control => { control.disabled = true; });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
