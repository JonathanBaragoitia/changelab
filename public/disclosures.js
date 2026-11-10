// Native details remain keyboard-accessible; only the visual action label changes.
document.addEventListener(
  'toggle',
  (event) => {
    if (!(event.target instanceof HTMLDetailsElement)) return;
    const action = event.target.querySelector(':scope > summary .disclosure-action');
    if (!action) return;
    action.dataset.closedLabel ??= action.textContent;
    action.textContent = event.target.open ? 'Cerrar' : action.dataset.closedLabel;
  },
  true,
);
