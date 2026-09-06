import { createAppController } from './app-controller.js';
import { createDataRepository } from './data/data-repository.js';
import { calculateLeagueMetrics } from './data/league-metrics.js';
import { createStore, createInitialState } from './state/store.js';
import METRIC_CATALOG from './config/metric-catalog.js';
import { createRenderer } from './ui/renderer.js';
import { createInputController } from './ui/input-controller.js';
import { createCharts } from './ui/charts.js';
import { createBallDrop } from './ui/ball-drop.js';

function start() {
  let controller;
  let charts,ballDrop,ordinaryRenderer;
  try {
    const root = document.getElementById('app');
    for (const id of ['app','season','team-a','team-b','prediction','prediction-content','condition-groups','base-content','stats-content','announcer']) {
      if (!document.getElementById(id)) throw new Error(`Required UI element missing: ${id}`);
    }
    for (const key of ['fetch','AbortController','structuredClone']) {
      if (typeof globalThis[key] !== 'function') throw new Error(`Browser capability missing: ${key}`);
    }
    if (!globalThis.crypto?.getRandomValues) throw new Error('Secure random source unavailable');
    if (typeof globalThis.Chart !== 'function') throw new Error('Chart.js could not load. Check the network connection and reload.');
    ordinaryRenderer = createRenderer({ root });
    charts=createCharts({root,Chart:globalThis.Chart});
    ballDrop=createBallDrop({root,Matter:globalThis.Matter});
    const renderer={render(state,view){ordinaryRenderer.render(state,view);charts.render(view);ballDrop.render(view);},
      destroy(){charts.destroy();ballDrop.destroy();ordinaryRenderer.destroy();}};
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
    charts?.destroy();ballDrop?.destroy();ordinaryRenderer?.destroy();
    const target = document.getElementById('fatal-error') ?? document.body;
    target.hidden = false; target.textContent = typeof globalThis.Chart!=='function'
      ? 'Analytics could not load. Check your connection and reload the page.'
      : 'The NFL Simulator could not start. Reload the page or use a current browser.';
    document.querySelectorAll('button,select,input').forEach(control => { control.disabled = true; });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
