/** Semantic DOM events only; all state transitions belong to app-controller. */
export function createInputController({ root, handlers }) {
  let bound = false;
  function change(event) {
    const target = event.target;
    if (target.disabled) return;
    if (target.dataset.factor) handlers.onFactorChange(target.dataset.factor, target.value);
    else if (target.dataset.input === 'season') handlers.onSeasonChange(Number(target.value));
    else if (target.dataset.input === 'teamA') handlers.onTeamAChange(target.value || null);
    else if (target.dataset.input === 'teamB') handlers.onTeamBChange(target.value || null);
  }
  function click(event) {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    if (button.dataset.action === 'run') void handlers.onRun();
    if (button.dataset.action === 'reset' && handlers.onReset()) {
      root.querySelectorAll('details').forEach(details => { details.open = false; });
      root.querySelector('#season').focus();
      root.querySelector('#matchup-heading').scrollIntoView({ block: 'start' });
      root.querySelector('#announcer').textContent = 'Simulator reset';
    }
    if (button.dataset.action === 'reload') globalThis.location.reload();
  }
  return Object.freeze({
    bind() {
      if (bound) return;
      bound = true; root.addEventListener('change', change); root.addEventListener('click', click);
    },
    setEnabledState(view) {
      const editable = view.lifecycleStatus === 'ready' && view.simulationStatus !== 'running';
      root.querySelectorAll('[data-input], [data-factor]').forEach(control => { control.disabled = !editable; });
      root.querySelectorAll('[data-action="run"]').forEach(button => { button.disabled = !view.canRunSimulation; });
      root.querySelectorAll('[data-action="reset"]').forEach(button => { button.disabled = view.lifecycleStatus !== 'ready'; });
    },
    destroy() { root.removeEventListener('change', change); root.removeEventListener('click', click); bound = false; },
  });
}
