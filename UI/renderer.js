import APP_CONFIG from '../config/app-config.js';
import METRIC_CATALOG from '../config/metric-catalog.js';

const FACTOR_LABELS = {
  venue: 'Venue', wind: 'Wind', precipitation: 'Precipitation', travel: 'West-to-east travel',
  teamARest: 'Team A rest', teamBRest: 'Team B rest', gameType: 'Game type', momentum: 'Momentum',
};
const OPTION_LABELS = {
  'team-a-home': 'Team A home', 'team-b-home': 'Team B home', neutral: 'Neutral',
  normal: '0–10 mph', moderate: '15–20 mph', high: '25+ mph', none: 'None', rain: 'Rain', snow: 'Snow',
  'team-a-traveled': 'Team A traveled', 'team-b-traveled': 'Team B traveled',
  short: 'Short: 4–5 days', standard: 'Standard: 6–8 days', extended: 'Extended / Bye: 10+ days',
  'regular-season': 'Regular Season', 'wild-card': 'Wild Card', 'divisional-round': 'Divisional Round',
  'conference-championship': 'Conference Championship', 'super-bowl': 'Super Bowl',
  'team-a': 'Team A', 'team-b': 'Team B',
};
const GROUPS = [
  ['Stadium & Weather', ['venue', 'wind', 'precipitation']],
  ['Fatigue', ['travel', 'teamARest', 'teamBRest']],
  ['Competitive Context', ['gameType', 'momentum']],
];
export const formatProbability = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'N/A';
export function formatMetric(metric, metadata) {
  return Number.isFinite(metric?.value)
    ? metadata.unit === 'rate' ? formatProbability(metric.value) : metric.value.toFixed(3) : 'N/A';
}
function teamLabel(text, teamA, teamB) {
  return text.replaceAll('Team A', teamA?.abbreviation ?? 'Team A').replaceAll('Team B', teamB?.abbreviation ?? 'Team B');
}

/** Ordinary DOM output only. All probabilities and contributions arrive calculated. */
export function createRenderer({ root, metricCatalog = METRIC_CATALOG }) {
  const doc = root.ownerDocument;
  const find = id => root.querySelector(`#${id}`);
  function node(tag, text, className) {
    const element = doc.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }
  let previous = null;
  let lastResult = null;
  let lastBase = null;
  let lastTeams = '';
  let lastSeason = null;
  const groupSummaries = [];
  const weatherFrame = node('iframe', undefined, 'weather-frame');
  weatherFrame.title = 'NFL game day weather — informational only';
  weatherFrame.setAttribute('sandbox', 'allow-scripts');
  weatherFrame.referrerPolicy = 'no-referrer';
  const weatherStatus = node('p', 'Open the weather panel to load the current-week report.', 'muted');
  let weatherStarted = false;
  let weatherTimer;
  function weatherMessage(event) {
    if (event.source !== weatherFrame.contentWindow || !['nfl-weather-loaded', 'nfl-weather-failed'].includes(event.data)) return;
    clearTimeout(weatherTimer);
    weatherStatus.textContent = event.data === 'nfl-weather-loaded'
      ? 'Current-week weather report. Historical and hypothetical matchups may not appear.'
      : 'Weather report unavailable. You can still choose simulation weather manually.';
  }
  doc.defaultView.addEventListener('message', weatherMessage);
  for (const [groupName, factors] of GROUPS) {
    const disclosure = node('details');
    const summary = node('summary', groupName);
    const summaryText = node('small'); summary.append(summaryText);
    groupSummaries.push([summaryText, factors]); disclosure.append(summary);
    for (const factor of factors) {
      if (factor === 'gameType') {
        const label = node('label', FACTOR_LABELS[factor]); label.htmlFor = 'game-type';
        const select = node('select'); select.id = 'game-type'; select.dataset.factor = factor;
        for (const value of APP_CONFIG.factors.options[factor]) {
          const option = node('option', OPTION_LABELS[value]); option.value = value; select.append(option);
        }
        disclosure.append(label, select);
      } else {
        const fieldset = node('fieldset'); const legend = node('legend', FACTOR_LABELS[factor]);
        legend.dataset.legend = factor; fieldset.append(legend);
        const options = node('div', undefined, 'radio-options');
        for (const value of APP_CONFIG.factors.options[factor]) {
          const label = node('label'); const input = node('input');
          input.type = 'radio'; input.name = factor; input.value = value; input.dataset.factor = factor;
          const text = node('span', OPTION_LABELS[value]); text.dataset.optionLabel = value;
          label.append(input, text); options.append(label);
        }
        fieldset.append(options); disclosure.append(fieldset);
      }
    }
    if (groupName === 'Stadium & Weather') {
      const weather = node('details'); weather.append(node('summary', 'Game Day Weather — Informational'));
      weather.append(node('p', 'Informational only — choose simulation weather manually above'), weatherStatus);
      const link = node('a', 'Open NFL Weather'); link.href = 'https://nflweather.com/'; link.target = '_blank'; link.rel = 'noopener noreferrer';
      weather.append(link, weatherFrame);
      weather.addEventListener('toggle', () => {
        if (!weather.open || weatherStarted) return;
        weatherStarted = true;
        weatherStatus.textContent = 'Loading weather report…';
        // Isolate the legacy third-party widget, including any document.write, from application state.
        weatherFrame.srcdoc = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'
          + '<script id="current_week_widget" data-color="132e2c" data-size="500" data-background="ffffff" src="https://nflweather.com/widgets/current_week.js" onload="parent.postMessage(\'nfl-weather-loaded\',\'*\')" onerror="parent.postMessage(\'nfl-weather-failed\',\'*\')"><\/script></body></html>';
        weatherTimer = setTimeout(() => { weatherStatus.textContent = 'Weather report unavailable or still loading. Manual conditions remain available.'; }, 12000);
      });
      disclosure.append(weather);
    }
    find('condition-groups').append(disclosure);
  }
  function options(select, rows, placeholder) {
    const items = placeholder ? [Object.assign(node('option', placeholder), { value: '' })] : [];
    rows.forEach(([value, label]) => items.push(Object.assign(node('option', label), { value: String(value) })));
    select.replaceChildren(...items);
  }
  function table(headers, rows, caption, className = '') {
    const wrapper = node('div', undefined, 'table-wrap'); const t = node('table', undefined, className);
    t.append(node('caption', caption)); const head = node('thead'); const tr = node('tr');
    headers.forEach(text => { const th = node('th', text); th.scope = 'col'; tr.append(th); }); head.append(tr);
    const body = node('tbody'); rows.forEach(values => {
      const row = node('tr'); values.forEach((text, index) => {
        const cell = node(index === 0 ? 'th' : 'td', text); if (index === 0) cell.scope = 'row'; row.append(cell);
      }); body.append(row);
    }); t.append(head, body); wrapper.append(t); return wrapper;
  }
  function identities(view) {
    const cards = [view.teamA, view.teamB].map((team, index) => {
      const card = node('div', undefined, 'team-identity');
      card.append(node('p', `Team ${index === 0 ? 'A' : 'B'}`, 'eyebrow'));
      if (team) {
        card.style.setProperty('--team-color', team.colors.primary);
        card.append(node('strong', team.teamName), node('p', team.abbreviation));
        card.append(node('p', `${team.record.wins}–${team.record.losses}–${team.record.ties} · ${team.record.gamesPlayed} games`, 'muted'));
      } else card.append(node('p', 'Choose a team above', 'muted'));
      return card;
    }); find('team-identities').replaceChildren(...cards);
  }
  function stats(view) {
    const container = find('stats-content');
    if (!view.isValidMatchup) { container.textContent = 'Select two different teams to compare statistics.'; return; }
    container.replaceChildren();
    for (const group of ['offense', 'defense']) {
      const detail = node('details'); detail.open = true;
      detail.append(node('summary', group === 'offense' ? 'Offense' : 'Defense'));
      for (const metadata of Object.values(metricCatalog).filter(m => m.group === group)) {
        const a = view.teamA.metrics[metadata.id]; const b = view.teamB.metrics[metadata.id];
        const row = node('div', undefined, 'stats-row'); row.append(node('div', metadata.label, 'stats-label'));
        for (const [team, metric] of [[view.teamA, a], [view.teamB, b]]) {
          const cell = node('div'); cell.append(node('span', team.abbreviation, 'stats-team-label'), node('strong', formatMetric(metric, metadata)),
            node('span', metric?.rank == null ? 'Rank N/A' : `Rank ${metric.rank} of 32`, 'stats-rank')); row.append(cell);
        }
        let edge = 'Edge unavailable';
        if (Number.isFinite(a?.value) && Number.isFinite(b?.value)) edge = a.value === b.value ? 'Even'
          : `${(a.value > b.value) === metadata.higherIsBetter ? view.teamA.abbreviation : view.teamB.abbreviation} edge`;
        row.append(node('span', edge, 'edge')); detail.append(row);
      }
      container.append(detail);
    }
  }
  function base(view) {
    const container = find('base-content'); container.replaceChildren();
    if (!view.baseAnalytics) {
      container.append(node('p', view.baseAnalyticsStatus === 'insufficient-data'
        ? APP_CONFIG.messages.INSUFFICIENT_COVERAGE : 'Select two different teams to compare offense and defense.', 'card')); return;
    }
    for (const [direction, offense, defense] of [
      [view.baseAnalytics.teamAOffenseVsTeamBDefense, view.teamA, view.teamB],
      [view.baseAnalytics.teamBOffenseVsTeamADefense, view.teamB, view.teamA],
    ]) {
      const card = node('article', undefined, 'card');
      card.append(node('h3', `${offense.abbreviation} Offense vs. ${defense.abbreviation} Defense`));
      card.append(node('p', `Positive favors ${offense.abbreviation} offense; negative favors ${defense.abbreviation} defense.`, 'muted'));
      const rows = direction.contributions.map(c => [metricCatalog[c.offenseMetric]?.label ?? c.pairId,
        c.available ? `${c.contribution > 0 ? '+' : ''}${c.contribution.toFixed(3)}` : c.active ? 'Unavailable' : 'Inactive in model']);
      card.append(table(['Metric', 'Contribution'], rows, 'Base matchup contributions'));
      const available = direction.contributions.filter(c => c.available);
      const positive = [...available].filter(c => c.contribution > 0).sort((a,b) => b.contribution-a.contribution)[0];
      const negative = [...available].filter(c => c.contribution < 0).sort((a,b) => a.contribution-b.contribution)[0];
      card.append(node('p', `Strongest offense advantage: ${positive ? metricCatalog[positive.offenseMetric].label : 'None'}. Strongest defense advantage: ${negative ? metricCatalog[negative.offenseMetric].label : 'None'}.`, 'coverage'));
      card.append(node('p', 'Chart view is unavailable. The contribution table remains available.', 'muted'));
      container.append(card);
    }
  }
  function prediction(view) {
    const content = find('prediction-content'); const progression = find('progression-content');
    const result = view.simulationResult;
    if (!result) {
      content.replaceChildren(node('h3', view.isValidMatchup ? `Ready to simulate ${view.teamA.abbreviation} vs. ${view.teamB.abbreviation}` : 'Prediction not run'),
        node('p', 'Select two teams, review game conditions, and run the simulation.'));
      progression.replaceChildren(); find('progression-empty').hidden = false;
      find('visual-message').textContent = 'Run the simulation before playing the visual.'; return;
    }
    const snapshot = result.inputSnapshot; const { teamA, teamB, factors } = snapshot;
    const final = result.scenarios.find(s => s.id === result.finalScenarioId);
    const cards = node('div', undefined, 'result-teams');
    for (const [team, values] of [[teamA, final.probabilitySummary.teamA], [teamB, final.probabilitySummary.teamB]]) {
      const card = node('div', undefined, 'result-team'); card.style.setProperty('--team-color', team.colors.primary);
      card.append(node('h3', `${team.teamName} · ${team.abbreviation}`), node('span', formatProbability(values.mean), 'probability'),
        node('p', `${formatProbability(values.p5)}–${formatProbability(values.p95)} · 5th–95th uncertainty`, 'range')); cards.append(card);
    }
    const mean = final.probabilitySummary.teamA.mean;
    const favored = mean === .5 ? 'Neither team is favored.' : `${mean > .5 ? teamA.teamName : teamB.teamName} favored`;
    content.replaceChildren(node('p', `${snapshot.season} · ${teamA.abbreviation} vs. ${teamB.abbreviation} · Competitive Factors`, 'muted'), cards,
      node('p', favored, 'favored'));
    const description = Object.entries(FACTOR_LABELS).map(([key,label]) => `${teamLabel(label,teamA,teamB)}: ${teamLabel(OPTION_LABELS[factors[key]],teamA,teamB)}`);
    if (snapshot.isDivisionalMatchup) description.push('Divisional matchup');
    content.append(node('p', description.join(' · '), 'result-meta'));
    const rows = result.scenarios.map(s => [APP_CONFIG.scenarios.find(c => c.id === s.id).label,
      formatProbability(s.probabilitySummary.teamA.mean), `${formatProbability(s.probabilitySummary.teamA.p5)}–${formatProbability(s.probabilitySummary.teamA.p95)}`,
      formatProbability(s.probabilitySummary.teamB.mean), `${formatProbability(s.probabilitySummary.teamB.p5)}–${formatProbability(s.probabilitySummary.teamB.p95)}`]);
    progression.replaceChildren(table(['Stage', `${teamA.abbreviation} average`, `${teamA.abbreviation} range`, `${teamB.abbreviation} average`, `${teamB.abbreviation} range`], rows,
      `${snapshot.season} · ${teamA.abbreviation} vs. ${teamB.abbreviation} · Simulation snapshot`, 'scenario-table'));
    find('progression-empty').hidden = true;
    find('visual-message').textContent = 'Visual Simulation is temporarily unavailable. Your prediction and matchup analysis remain available above.';
  }
  return Object.freeze({
    render(state, view) {
      const running = view.simulationStatus === 'running';
      find('freshness').textContent = view.freshness?.text ?? (view.fatalError ? 'NFL season data unavailable' : 'Loading NFL season data…');
      const fatal = find('fatal-error'); fatal.hidden = !view.fatalError;
      if (view.fatalError) {
        fatal.replaceChildren(node('p', view.fatalError.message)); const reload = node('button', 'Reload'); reload.dataset.action = 'reload'; fatal.append(reload);
      }
      find('workspace').hidden = Boolean(view.fatalError); find('mobile-actions').hidden = Boolean(view.fatalError);
      if (lastSeason !== view.selectedSeason) {
        options(find('season'), view.availableSeasons.map(y => [y,y]));
        const teams = [...(view.selectedSeason?.teams ?? [])].sort((a,b) => a.teamName.localeCompare(b.teamName));
        options(find('team-a'), teams.map(t => [t.teamId,t.teamName]), 'Choose Team A');
        options(find('team-b'), teams.map(t => [t.teamId,t.teamName]), 'Choose Team B');
        lastSeason = view.selectedSeason;
      }
      find('season').value = String(view.selectedSeason?.season ?? '');
      find('team-a').value = view.teamA?.teamId ?? ''; find('team-b').value = view.teamB?.teamId ?? '';
      for (const [id,other] of [['team-a',view.teamB],['team-b',view.teamA]]) {
        [...find(id).options].forEach(option => { option.disabled = Boolean(other && option.value === other.teamId); });
      }
      root.querySelectorAll('[data-factor]').forEach(input => {
        if (input.type === 'radio') input.checked = input.value === view.factors[input.dataset.factor];
        else input.value = view.factors[input.dataset.factor];
      });
      root.querySelectorAll('[data-option-label]').forEach(span => { span.textContent = teamLabel(OPTION_LABELS[span.dataset.optionLabel],view.teamA,view.teamB); });
      root.querySelectorAll('[data-legend]').forEach(legend => { legend.textContent = teamLabel(FACTOR_LABELS[legend.dataset.legend],view.teamA,view.teamB); });
      for (const [summary,factors] of groupSummaries) summary.textContent = factors.map(k => teamLabel(OPTION_LABELS[view.factors[k]],view.teamA,view.teamB)).join(' · ');
      find('conditions-summary').textContent = `Optional · ${teamLabel(OPTION_LABELS[view.factors.venue],view.teamA,view.teamB)} venue · ${OPTION_LABELS[view.factors.gameType]}`;
      find('division-indicator').hidden = !view.isDivisionalMatchup;
      find('selection-guidance').textContent = view.isValidMatchup ? 'Matchup selected. Review conditions or run with these settings.' : view.teamA || view.teamB ? 'Choose the second team to continue.' : 'Select two teams to begin.';
      const notice = find('notice'); notice.hidden = !view.notice; notice.textContent = view.notice?.message ?? '';
      const teamsKey = `${view.selectedSeason?.season}|${view.teamA?.teamId}|${view.teamB?.teamId}`;
      if (teamsKey !== lastTeams) { identities(view); stats(view); lastTeams = teamsKey; }
      if (view.baseAnalytics !== lastBase || teamsKey !== previous?.teamsKey) { base(view); lastBase = view.baseAnalytics; }
      if (view.simulationResult !== lastResult || !view.simulationResult) { prediction(view); }
      find('stale-banner').hidden = !view.areResultsStale;
      find('prediction').setAttribute('aria-busy', String(running));
      find('running-message').hidden = !running;
      find('running-message').textContent = view.simulationResult ? 'Updating…' : 'Running Simulation…';
      root.querySelectorAll('[data-action="run"]').forEach(button => { button.textContent = running ? 'Running Simulation…' : view.areResultsStale ? 'Run Again' : 'Run Simulation'; });
      find('mobile-status').textContent = running ? 'Calculating' : view.areResultsStale ? 'Inputs changed' : view.isValidMatchup ? `${view.teamA.abbreviation} vs. ${view.teamB.abbreviation}` : 'Choose two teams';
      let announcement = '';
      if (view.fatalError && view.fatalError !== previous?.fatalError) { announcement = view.fatalError.message; fatal.focus(); }
      else if (view.notice && view.notice !== previous?.notice) { announcement = view.notice.message; notice.focus(); }
      else if (running && !previous?.running) announcement = 'Simulation started';
      else if (view.simulationResult && view.simulationResult !== lastResult) { announcement = 'Simulation completed'; find('prediction-heading').focus(); }
      else if (view.areResultsStale && !previous?.stale) announcement = 'Inputs changed — Run Simulation to update results.';
      else if (view.lifecycleStatus === 'ready' && previous?.lifecycleStatus !== 'ready') announcement = 'NFL season data loaded';
      if (announcement) find('announcer').textContent = announcement;
      lastResult = view.simulationResult;
      previous = { teamsKey, fatalError: view.fatalError, notice: view.notice, running, stale: view.areResultsStale, lifecycleStatus: view.lifecycleStatus };
    },
    destroy() { clearTimeout(weatherTimer); doc.defaultView.removeEventListener('message', weatherMessage); weatherFrame.remove(); },
  });
}
