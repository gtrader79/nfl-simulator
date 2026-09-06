import MODEL_CONFIG from '../js/config/model-config.js';
import APP_CONFIG from '../js/config/app-config.js';
import METRIC_CATALOG from '../js/config/metric-catalog.js';
import { validateModelConfig } from '../js/model/model-config-validator.js';
import { validateDataset } from '../js/data/data-validator.js';
import { createDataRepository } from '../js/data/data-repository.js';
import { calculateLeagueMetrics } from '../js/data/league-metrics.js';
import { calculateBaseMatchup } from '../js/model/matchup-model.js';
import { createAppController } from '../js/app-controller.js';
import { createStore, createInitialState } from '../js/state/store.js';
import { selectCanRunSimulation } from '../js/state/selectors.js';
import { createRenderer } from '../js/ui/renderer.js';
import { createInputController } from '../js/ui/input-controller.js';
import { runScenarios } from '../js/model/scenario-engine.js';
import { probabilityChartConfig, contributionChartConfig, createCharts, wrapLabel } from '../js/ui/charts.js';
import { sampleVisualTeam, createBallDrop } from '../js/ui/ball-drop.js';
import { test, assert, assertEqual, assertApprox, assertThrows, assertDeepEqual } from './test-utils.js';

// Synthetic contract fixture. Never deploy this as NFL production data.
function fixture(years = [2024, 2025, 2023, 2022]) {
  return { schemaVersion: '1.0.0', datasetId: 'nfl-simulator', generatedAt: '2026-09-05T12:00:00Z',
    source: { provider: 'test', description: 'Synthetic integration fixture' },
    seasons: years.map(season => ({ season, updatedDate: '2026-09-05',
      period: { type: 'regular-season', week: 1, postseasonRound: null },
      teams: Array.from({ length: 32 }, (_, i) => ({
        teamId: `T${i}`, abbreviation: `T${i}`, teamName: `Synthetic team ${i}`,
        conference: i < 16 ? 'AFC' : 'NFC', division: 'East',
        colors: { primary: '#123456', secondary: null, tertiary: null },
        record: { wins: 0, losses: 0, ties: 0, gamesPlayed: 0 },
        metrics: Object.fromEntries(Object.keys(METRIC_CATALOG).map(id => [id,
          { value: i / 100, rank: i + 1, sampleSize: 100 }])),
      })),
    })),
  };
}
const firstId = Object.keys(METRIC_CATALOG)[0];
async function rejects(callback, code) {
  let caught;
  try { await callback(); } catch (error) { caught = error; }
  assert(caught, 'Expected rejection');
  assertEqual(caught.code ?? caught.name, code);
}

test('102 production metric catalog validates against approved configuration', () => {
  const result = validateModelConfig({ modelConfig: MODEL_CONFIG, metricCatalog: METRIC_CATALOG, appConfig: APP_CONFIG });
  assert(result.ok, JSON.stringify(result.issues));
});
test('103 dataset normalization is sorted, detached, immutable and preserves zero', () => {
  const raw = fixture(); const data = validateDataset(raw);
  assertDeepEqual(data.seasons.map(s => s.season), [2025, 2024, 2023, 2022]);
  raw.seasons[1].teams[0].metrics[firstId].value = 99;
  assertEqual(data.seasons[0].teams[0].metrics[firstId].value, 0);
  assert(Object.isFrozen(data.seasons[0].teams[0].metrics[firstId]));
});
test('104 missing metric differs from valid unavailable metric', () => {
  const raw = fixture([2025]); const metrics = raw.seasons[0].teams[0].metrics;
  metrics[firstId] = { value: null, rank: null, sampleSize: null };
  assertEqual(validateDataset(raw).seasons[0].teams[0].metrics[firstId].value, null);
  delete metrics[firstId]; assertThrows(() => validateDataset(raw), 'missing metric');
});
test('105 invalid finite values, ranks, samples and null ranks fail closed', () => {
  for (const metric of [{ value: NaN, rank: null, sampleSize: 0 },
    { value: Infinity, rank: null, sampleSize: 0 }, { value: '0', rank: 1, sampleSize: 0 },
    { value: null, rank: 1, sampleSize: 0 }, { value: 0, rank: 33, sampleSize: 0 },
    { value: 0, rank: 1, sampleSize: -1 }]) {
    const raw = fixture([2025]); raw.seasons[0].teams[0].metrics[firstId] = metric;
    assertThrows(() => validateDataset(raw));
  }
});
test('106 duplicate seasons, identity, team count and inconsistent records are rejected', () => {
  assertThrows(() => validateDataset(fixture([2025, 2025])), 'duplicate season');
  for (const mutate of [s => s.teams.pop(), s => { s.teams[1].teamId = 'T0'; },
    s => { s.teams[1].abbreviation = 'T0'; }, s => { s.teams[0].record.wins = 1; }]) {
    const raw = fixture([2025]); mutate(raw.seasons[0]); assertThrows(() => validateDataset(raw));
  }
});
test('107 schema, dates and season period are validated', () => {
  for (const mutate of [r => { r.schemaVersion = '2'; }, r => { r.generatedAt = '2026-02-30T00:00:00Z'; },
    r => { r.seasons[0].updatedDate = '2026-02-30'; }, r => { r.seasons[0].period.type = 'preseason'; }]) {
    const raw = fixture([2025]); mutate(raw); assertThrows(() => validateDataset(raw));
  }
  const raw = fixture([2025]); raw.seasons[0].period = { type: 'postseason', week: null, postseasonRound: 'super-bowl' };
  assertEqual(validateDataset(raw).seasons[0].period.postseasonRound, 'super-bowl');
});
test('108 league metrics use selected-season sample SD and preserve zero', () => {
  const teams = fixture([2025]).seasons[0].teams;
  const d = calculateLeagueMetrics(teams).metrics[firstId];
  assertEqual(d.validCount, 32); assertApprox(d.mean, 0.155);
  assertApprox(d.standardDeviation, Math.sqrt(0.0088)); assert(d.usable);
});
test('109 distribution coverage threshold and finite filtering are enforced', () => {
  const teams = fixture([2025]).seasons[0].teams;
  for (let i = 24; i < 32; i++) teams[i].metrics[firstId].value = i % 2 ? null : NaN;
  assert(calculateLeagueMetrics(teams).metrics[firstId].usable);
  teams[23].metrics[firstId].value = Infinity;
  assertEqual(calculateLeagueMetrics(teams).metrics[firstId].usable, false);
});
test('110 constant and empty distributions remain serializable and unusable', () => {
  const teams = fixture([2025]).seasons[0].teams;
  teams.forEach(t => { t.metrics[firstId].value = 0; });
  assertEqual(calculateLeagueMetrics(teams).metrics[firstId].usable, false);
  const empty = calculateLeagueMetrics([]);
  assertEqual(empty.metrics[firstId].mean, null);
  assertEqual(empty.metrics[firstId].standardDeviation, null);
  assert(Object.isFrozen(empty.metrics));
});
test('111 repository loads validated data and exposes only newest three seasons', async () => {
  let requested;
  const repo = createDataRepository({ fetchImpl: async (url) => {
    requested = url; return { ok: true, json: async () => fixture() };
  } });
  assertEqual(repo.getSeason(2025), null); await repo.load();
  assertEqual(requested, './data/nfl-simulator-data.json');
  assertDeepEqual(repo.getAvailableSeasons(), [2025, 2024, 2023]);
  assertEqual(repo.getSeason(2022), null); assertEqual(repo.getTeam(2025, 'T0').teamId, 'T0');
  assertEqual(repo.getTeam(2025, 'missing'), null);
});
test('112 load failures cannot expose stale or partially validated data', async () => {
  let mode = 'ok';
  const repo = createDataRepository({ fetchImpl: async () => ({ ok: mode !== 'http', status: 404,
    json: async () => mode === 'schema' ? {} : fixture() }) });
  await repo.load(); mode = 'http'; await rejects(() => repo.load(), 'DATA_LOAD_FAILED');
  assertEqual(repo.getAvailableSeasons().length, 0);
  mode = 'schema'; await rejects(() => repo.load(), 'DATA_SCHEMA_INVALID');
});
test('113 aborted or superseded loads cannot replace the current dataset', async () => {
  let resolveFirst; let calls = 0;
  const repo = createDataRepository({ fetchImpl: async () => ({ ok: true,
    json: () => ++calls === 1 ? new Promise(resolve => { resolveFirst = resolve; }) : fixture([2024]) }) });
  const first = repo.load(); await Promise.resolve(); await Promise.resolve();
  await repo.load(); resolveFirst(fixture([2025])); await rejects(() => first, 'AbortError');
  assertDeepEqual(repo.getAvailableSeasons(), [2024]);
  const abort = new AbortController(); abort.abort();
  await rejects(() => repo.load({ signal: abort.signal }), 'AbortError');
});
test('114 validated production boundary integrates with certified coverage and matchup model', () => {
  const data = validateDataset(fixture([2025])); const teams = data.seasons[0].teams;
  const result = calculateBaseMatchup({ teamA: teams[0], teamB: teams[31],
    leagueMetrics: calculateLeagueMetrics(teams), modelConfig: MODEL_CONFIG });
  assertEqual(result.status, 'ready');
});

test('115 controller initializes and enables a matchup using real data modules', async () => {
  const repository = createDataRepository({ fetchImpl: async () => ({ ok: true, json: async () => fixture() }) });
  const store = createStore({ initialState: createInitialState() });
  let handlers;
  const controller = createAppController({ store, repository, metricCatalog: METRIC_CATALOG,
    calculateLeagueMetrics, renderer: { render() {}, destroy() {} },
    createInputController: options => {
      handlers = options.handlers;
      return { bind() {}, setEnabledState() {}, destroy() {} };
    },
  });
  assertEqual(await controller.initialize(), true);
  assertEqual(store.getState().data.selectedSeason, 2025);
  handlers.onTeamAChange('T0'); handlers.onTeamBChange('T31');
  assertEqual(selectCanRunSimulation(store.getState(), repository), true);
  handlers.onSeasonChange(2024);
  assertEqual(store.getState().data.selectedSeason, 2024);
  assertEqual(selectCanRunSimulation(store.getState(), repository), false);
  controller.destroy();
});

test('116 uploaded production dataset validates and covers every distinct matchup in all seasons', async () => {
  const response = await fetch(new URL('../data/nfl-simulator-data.json', import.meta.url));
  assert(response.ok); const data = validateDataset(await response.json());
  assertEqual(data.seasons.length, 3);
  for (const season of data.seasons) {
    assertEqual(season.teams.length, 32); const leagueMetrics = calculateLeagueMetrics(season.teams);
    for (let a = 0; a < 32; a++) for (let b = a + 1; b < 32; b++) {
      assert(calculateBaseMatchup({ teamA: season.teams[a], teamB: season.teams[b],
        leagueMetrics, modelConfig: MODEL_CONFIG }).eligible, `Insufficient coverage in ${season.season}`);
    }
  }
});

// Exercise real shell + DOM adapters + controller without third-party charts or weather.
async function withUI(callback, { raw = fixture(), failLoad = false } = {}) {
  const response = await fetch(new URL('../index.html', import.meta.url));
  assert(response.ok);
  const parsed = new DOMParser().parseFromString(await response.text(), 'text/html');
  const root = document.importNode(parsed.querySelector('#app'), true);
  root.style.cssText = 'position:absolute;left:-10000px;width:1000px;';
  document.body.append(root);
  const store = createStore({ initialState: createInitialState() });
  let calls = 0;
  let failRun = false;
  const controller = createAppController({ store,
    repository: createDataRepository({ fetchImpl: async () => {
      if (failLoad) throw new Error('Synthetic network failure');
      return { ok: true, json: async () => raw };
    } }), metricCatalog: METRIC_CATALOG, calculateLeagueMetrics,
    renderer: createRenderer({ root }), createInputController: ({ handlers }) => createInputController({ root, handlers }),
    yieldFrame: async () => {}, randomSourceFactory: () => () => 0.5,
    model: { calculateBaseMatchup, runScenarios: args => {
      calls++; if (failRun) throw new Error('Synthetic rerun failure'); return runScenarios(args);
    } }, logger: { error() {} },
  });
  const q = selector => root.querySelector(selector);
  function change(selector, value) {
    const control = q(selector); control.value = value;
    control.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const selectTeams = () => { change('#team-a','T0'); change('#team-b','T31'); };
  const run = async () => { q('.desktop-run').click(); await new Promise(resolve => setTimeout(resolve, 0)); };
  try {
    await controller.initialize();
    await callback({ root, q, store, controller, change, selectTeams, run,
      calls: () => calls, failRun: () => { failRun = true; } });
  } finally { controller.destroy(); root.remove(); }
}

test('117 UI starts on latest season, clears teams, sorts options and disables Run', async () => withUI(({ q, root, calls }) => {
  assertEqual(q('#season').value, '2025'); assertEqual(q('#team-a').value, '');
  assert(q('.desktop-run').disabled); assertEqual(calls(), 0);
  const labels = [...q('#team-a').options].slice(1).map(o => o.textContent);
  assertDeepEqual(labels, [...labels].sort((a,b) => a.localeCompare(b)));
  assertEqual(root.querySelectorAll('select[data-input="season"]').length, 1);
  assert([...root.querySelectorAll('#condition-groups > details')].every(d => !d.open));
}));
test('118 selecting teams immediately populates stats, base contributions and run eligibility', async () => withUI(({ root, q, selectTeams, calls }) => {
  selectTeams(); assertEqual(root.querySelectorAll('.stats-row').length, 14);
  assertEqual(root.querySelectorAll('#base-content tbody tr').length, 14);
  assertEqual(q('.desktop-run').disabled, false); assertEqual(calls(), 0);
}));
test('119 UI Run displays five model summaries and focuses Prediction', async () => withUI(async ({ root, q, selectTeams, run, store, calls }) => {
  selectTeams(); await run(); assertEqual(calls(), 1);
  assertEqual(store.getState().simulation.status, 'complete');
  assertEqual(root.querySelectorAll('.probability').length, 2);
  assertEqual(root.querySelectorAll('#progression-content tbody tr').length, 5);
  assertEqual(document.activeElement, q('#prediction-heading'));
  assertEqual(q('#announcer').textContent, 'Simulation completed');
}));
test('120 condition edits preserve base analytics and show stale result without rerunning', async () => withUI(async ({ q, selectTeams, run, change, calls }) => {
  selectTeams(); await run(); const before = q('#prediction-content').textContent;
  const baseBefore = q('#base-content').textContent;
  change('[data-factor="venue"][value="team-a-home"]','team-a-home');
  assertEqual(q('#stale-banner').hidden, false); assertEqual(q('#prediction-content').textContent, before);
  assertEqual(q('#base-content').textContent, baseBefore); assertEqual(calls(), 1);
}));
test('121 changing teams never relabels the previous prediction snapshot', async () => withUI(async ({ q, selectTeams, run, change }) => {
  selectTeams(); await run(); const before = q('#prediction-content').textContent;
  change('#team-a','T1'); assertEqual(q('#prediction-content').textContent, before);
  assert(q('#base-content').textContent.includes('T1 Offense'));
  assertEqual(q('#stale-banner').hidden, false);
}));
test('122 UI reset returns to latest season, clears results, restores defaults and focuses setup', async () => withUI(async ({ q, selectTeams, run, change, store }) => {
  change('#season','2024'); selectTeams(); await run(); q('[data-action="reset"]').click();
  assertEqual(q('#season').value,'2025'); assertEqual(q('#team-a').value,'');
  assertEqual(store.getState().simulation.result,null); assertEqual(q('#stale-banner').hidden,true);
  assertDeepEqual(store.getState().factors,APP_CONFIG.factors.defaults);
  assertEqual(document.activeElement,q('#season')); assertEqual(q('#announcer').textContent,'Simulator reset');
}));
test('123 season changes clear teams and results while retaining valid season options', async () => withUI(async ({ q, selectTeams, run, change, store }) => {
  selectTeams(); await run(); change('#season','2023');
  assertEqual(q('#season').value,'2023'); assertEqual(q('#team-a').value,'');
  assertEqual(store.getState().simulation.result,null); assert(q('.desktop-run').disabled);
}));
test('124 fatal load errors disable controls and expose a reload action', async () => withUI(({ q }) => {
  assertEqual(q('#fatal-error').hidden,false); assert(q('#fatal-error [data-action="reload"]'));
  assert(q('#team-a').disabled); assert(q('.desktop-run').disabled); assert(q('#mobile-actions').hidden);
}, { failLoad: true }));
test('125 unavailable metrics render N/A, legitimate zero renders zero and names are safe text', async () => {
  const raw = fixture(); raw.seasons[1].teams[0].teamName = '<img src=x onerror=alert(1)>';
  raw.seasons[1].teams[0].metrics[firstId] = { value: null, rank: null, sampleSize: null };
  await withUI(({ q, selectTeams }) => {
    selectTeams(); assertEqual(q('#team-identities img'),null);
    assert(q('#team-identities').textContent.includes('<img'));
    assert(q('#stats-content').textContent.includes('N/A'));
    assert(q('#stats-content').textContent.includes('0.0%'));
  }, { raw });
});
test('126 duplicate team selections are rejected inline', async () => withUI(({ q, change, store }) => {
  change('#team-a','T0'); change('#team-b','T0');
  assertEqual(store.getState().matchup.teamBId,null); assert(q('.desktop-run').disabled);
  assertEqual(q('#notice').hidden,false);
}));
test('127 failed rerun preserves the previous prediction and offers Run Again', async () => withUI(async ({ q, selectTeams, run, change, failRun }) => {
  selectTeams(); await run(); const before = q('#prediction-content').textContent;
  change('[data-factor="momentum"][value="team-a"]','team-a'); failRun(); await run();
  assertEqual(q('#prediction-content').textContent,before); assertEqual(q('#stale-banner').hidden,false);
  assertEqual(q('#notice').hidden,false); assertEqual(q('.desktop-run').textContent,'Run Again');
}));
test('128 teardown removes input handlers and prevents further state changes', async () => withUI(({ controller, store, change }) => {
  controller.destroy(); const before = store.getState(); change('#team-a','T0'); assertEqual(store.getState(),before);
}));
test('129 probability hero matches the final model summary and names the canonical postseason round', async () => {
  const raw=fixture(); raw.seasons[1].period={type:'postseason',week:null,postseasonRound:'super-bowl'};
  await withUI(async ({ q, selectTeams, run, store }) => {
    assert(q('#freshness').textContent.includes('Super Bowl')); selectTeams(); await run();
    const result=store.getState().simulation.result;
    const final=result.scenarios.find(s=>s.id===result.finalScenarioId);
    assertEqual(q('.probability').textContent,`${(final.probabilitySummary.teamA.mean*100).toFixed(1)}%`);
  },{raw});
});

function visualView(store) {
  const state=store.getState(),result=state.simulation.result;
  return {simulationResult:result,simulationStatus:state.simulation.status,areResultsStale:state.simulation.isStale,
    baseAnalytics:state.matchup.baseAnalytics,teamA:result?.inputSnapshot.teamA,teamB:result?.inputSnapshot.teamB};
}
test('130 progression chart uses the five existing summaries and exact uncertainty endpoints',async()=>withUI(async h=>{
  h.selectTeams();await h.run();const result=h.store.getState().simulation.result,c=probabilityChartConfig(result);
  assertEqual(c.data.labels.length,5);assertDeepEqual(c.data.datasets[0].data,result.scenarios.map(s=>s.probabilitySummary.teamA.p5*100));
  assertDeepEqual(c.data.datasets[1].data,result.scenarios.map(s=>s.probabilitySummary.teamA.p95*100));
  assertDeepEqual(c.data.datasets[2].data,result.scenarios.map(s=>s.probabilitySummary.teamA.mean*100));
  assert(c.data.datasets[5].borderDash.length>0);assert(c.data.datasets[6].data.every(x=>x===50));
}));
test('131 base chart omits inactive metrics and has a symmetric zero-centered scale',async()=>withUI(async h=>{
  h.selectTeams();await h.run();const result=h.store.getState().simulation.result;
  const d=result.baseMatchup.teamAOffenseVsTeamBDefense;
  const c=contributionChartConfig(d,result.inputSnapshot.teamA,result.inputSnapshot.teamB);
  assertDeepEqual(c.data.datasets[0].data,d.contributions.filter(x=>x.available).map(x=>x.contribution));
  assertEqual(c.options.scales.x.min,-c.options.scales.x.max);assertEqual(c.options.indexAxis,'y');
}));
test('132 chart labels wrap without clipping words',()=>{
  assertDeepEqual(wrapLabel('Monte Carlo Variance',16),['Monte Carlo','Variance']);
  assertEqual(wrapLabel('Statistical Matchup',16).join(' '),'Statistical Matchup');
});
test('133 chart lifecycle avoids duplicates, defers hidden hosts, and clears on reset',async()=>withUI(async h=>{
  h.selectTeams();await h.run();let creates=0,destroys=0;let width=0;const observers=[];
  h.root.querySelectorAll('[data-chart]').forEach(host=>{host.getBoundingClientRect=()=>({width,height:300});});
  class FakeChart{constructor(){creates++;}destroy(){destroys++;}}
  class Observer{constructor(cb){this.cb=cb;observers.push(this);}observe(){}disconnect(){this.disconnected=true;}}
  const charts=createCharts({root:h.root,Chart:FakeChart,ResizeObserverImpl:Observer});
  try{const view=visualView(h.store);charts.render(view);assertEqual(creates,0);width=600;
    observers.forEach(o=>o.cb());assertEqual(creates,3);charts.render(view);assertEqual(creates,3);
    charts.render({...view,simulationResult:null,baseAnalytics:null});assertEqual(destroys,3);
    assert(observers.every(o=>o.disconnected));
  }finally{charts.destroy();}
}));
test('134 a chart construction failure preserves analytical tables and reports locally',async()=>withUI(async h=>{
  h.selectTeams();await h.run();h.root.querySelectorAll('[data-chart]').forEach(host=>{host.getBoundingClientRect=()=>({width:600,height:300});});
  let failures=0;class BrokenChart{constructor(){throw new Error('Synthetic chart failure');}}
  const charts=createCharts({root:h.root,Chart:BrokenChart,ResizeObserverImpl:null,onError:()=>failures++});
  try{charts.render(visualView(h.store));assertEqual(failures,3);assertEqual(h.root.querySelectorAll('#progression-content tbody tr').length,5);
    assert(h.root.querySelector('[data-chart-status]').textContent.includes('unavailable'));
  }finally{charts.destroy();}
}));
test('135 visual sampling selects a final distribution value then a Bernoulli team outcome',()=>{
  let draws=[.1,.7];assertEqual(sampleVisualTeam([.8,.1],()=>draws.shift()),'teamA');
  draws=[.9,.7];assertEqual(sampleVisualTeam([.8,.1],()=>draws.shift()),'teamB');
  assertEqual(sampleVisualTeam([0],()=>0),'teamB');assertEqual(sampleVisualTeam([1],()=>.999),'teamA');
  assertThrows(()=>sampleVisualTeam([]));assertThrows(()=>sampleVisualTeam([NaN]));
  assertThrows(()=>sampleVisualTeam([.5],()=>1));
});
function fakeMatter(doc) {
  const counts={engines:0,clears:0,runnerStops:0,renderStops:0,balls:0};
  const Matter={Engine:{create:()=>{counts.engines++;return {world:{}};},clear:()=>counts.clears++},
    Render:{create:({element})=>{const canvas=doc.createElement('canvas');element.append(canvas);return {canvas,textures:{}};},run(){},stop(){counts.renderStops++;}},
    Runner:{create:()=>({}),run(){},stop(){counts.runnerStops++;}},
    Bodies:{rectangle:()=>({}),circle:(x,y,r)=>{if(r===7)counts.balls++;return {};}},Composite:{add(){},clear(){}},};
  return {Matter,counts};
}
test('136 Matter initializes only on Play, stops, replays and never reruns analytics',async()=>withUI(async h=>{
  h.selectTeams();await h.run();const {Matter,counts}=fakeMatter(document);
  h.q('#ball-drop').getBoundingClientRect=()=>({width:600,height:360});
  const visual=createBallDrop({root:h.root,Matter,ResizeObserverImpl:null,randomSource:()=>.5,motionQuery:{matches:false}});
  try{visual.render(visualView(h.store));assertEqual(counts.engines,0);h.q('#visual-play').click();
    assertEqual(counts.engines,1);assertEqual(counts.balls,1);assertEqual(h.q('#visual-stop').hidden,false);
    h.q('#visual-stop').click();assertEqual(counts.runnerStops,1);h.q('#visual-play').click();
    assertEqual(counts.engines,2);assertEqual(h.root.querySelectorAll('#ball-drop canvas').length,1);assertEqual(h.calls(),1);
  }finally{visual.destroy();}assertEqual(h.root.querySelectorAll('#ball-drop canvas').length,0);
}));
test('137 missing Matter is recoverable and retains the final probability',async()=>withUI(async h=>{
  h.selectTeams();await h.run();const visual=createBallDrop({root:h.root,Matter:null});
  try{visual.render(visualView(h.store));assert(h.q('#visual-play').disabled);
    assert(h.q('#visual-message').textContent.includes('Analytical results are still valid'));assert(h.q('.probability'));
  }finally{visual.destroy();}
}));
test('138 reduced motion stays static until explicit Play and reset clears the world',async()=>withUI(async h=>{
  h.selectTeams();await h.run();const {Matter,counts}=fakeMatter(document);
  h.q('#ball-drop').getBoundingClientRect=()=>({width:600,height:360});
  const visual=createBallDrop({root:h.root,Matter,ResizeObserverImpl:null,motionQuery:{matches:true}});
  try{visual.render(visualView(h.store));assertEqual(counts.engines,0);assert(h.q('#visual-message').textContent.includes('Reduced motion'));
    h.q('#visual-play').click();visual.render({simulationResult:null});assertEqual(counts.clears,1);
    assertEqual(h.root.querySelectorAll('#ball-drop canvas').length,0);assert(h.q('#visual-play').disabled);
  }finally{visual.destroy();}
}));
test('139 stale inputs stop animation and prevent replay until rerun',async()=>withUI(async h=>{
  h.selectTeams();await h.run();const {Matter,counts}=fakeMatter(document);h.q('#ball-drop').getBoundingClientRect=()=>({width:600,height:360});
  const visual=createBallDrop({root:h.root,Matter,ResizeObserverImpl:null});
  try{const view=visualView(h.store);visual.render(view);h.q('#visual-play').click();visual.render({...view,areResultsStale:true});
    assertEqual(counts.clears,1);assert(h.q('#visual-play').disabled);assert(h.q('#visual-summary').textContent.includes('T0'));
  }finally{visual.destroy();}
}));
