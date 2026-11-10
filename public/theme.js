/* Runs before styles are painted; only a non-sensitive display preference is stored. */
(() => {
  const key = 'changelab-theme',
    valid = (value) => ['light', 'dark'].includes(value),
    root = document.documentElement;
  let preference = 'light';
  try {
    const saved = localStorage.getItem(key);
    if (valid(saved)) preference = saved;
  } catch {
    /* Storage can be disabled; the choice still works for this page. */
  }
  const apply = () => {
    root.dataset.theme = preference;
    document.querySelectorAll('[data-theme-select]').forEach((select) => {
      select.value = preference;
    });
  };
  apply();
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      apply();
      document.querySelectorAll('[data-theme-select]').forEach((select) =>
        select.addEventListener('change', () => {
          if (!valid(select.value)) return;
          preference = select.value;
          try {
            localStorage.setItem(key, preference);
          } catch {
            /* No storage access is required to switch themes. */
          }
          apply();
        }),
      );
    },
    { once: true },
  );
  window.addEventListener('storage', (event) => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue) ? event.newValue : 'light';
    apply();
  });
})();
