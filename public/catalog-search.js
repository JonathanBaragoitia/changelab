export function normalizeSearch(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}
export function searchProducts(products, query, category = '') {
  const terms = normalizeSearch(query).split(' ').filter(Boolean);
  return products.filter(
    (p) =>
      (!category || p.category === category) &&
      terms.every((term) =>
        normalizeSearch(p.name + ' ' + p.sku + ' ' + p.category).includes(term),
      ),
  );
}
export function catalogSuggestions(products, query, category = '') {
  const q = normalizeSearch(query);
  if (!q) return [];
  return searchProducts(products, query, category)
    .map((p, index) => ({
      p,
      index,
      rank: normalizeSearch(p.name).startsWith(q) || normalizeSearch(p.sku).startsWith(q) ? 0 : 1,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, 6)
    .map((r) => r.p);
}
export function mountCatalogAutocomplete({
  input,
  list,
  status,
  getProducts,
  getCategory,
  isReady,
  onSelect,
  money,
}) {
  let matches = [],
    active = -1;
  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  };
  const activate = (index) => {
    active = index;
    [...list.children].forEach((row, i) => row.setAttribute('aria-selected', String(i === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', list.children[active].id);
      list.children[active].scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const select = (index) => {
    const p = matches[index];
    if (!p) return;
    input.value = p.name;
    close();
    onSelect(p);
    status.textContent = 'Seleccionado: ' + p.name;
  };
  const show = () => {
    close();
    if (!isReady()) return;
    matches = catalogSuggestions(getProducts(), input.value, getCategory());
    list.replaceChildren();
    if (!normalizeSearch(input.value)) {
      status.textContent = '';
      return;
    }
    status.textContent = matches.length
      ? matches.length + ' sugerencias disponibles. Usa las flechas y Enter para elegir.'
      : 'No hay sugerencias para esa búsqueda.';
    matches.forEach((p, index) => {
      const row = document.createElement('li');
      row.id = 'catalog-option-' + index;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', 'false');
      const title = document.createElement('strong'),
        detail = document.createElement('span');
      title.textContent = p.name;
      detail.textContent =
        p.sku +
        ' · ' +
        money(p.priceCents) +
        ' sin IVA · ' +
        (p.quantity ? p.quantity + ' disponibles' : 'Agotado');
      row.append(title, detail);
      row.addEventListener('pointerdown', (e) => e.preventDefault());
      row.addEventListener('click', () => select(index));
      list.append(row);
    });
    list.hidden = !matches.length;
    input.setAttribute('aria-expanded', String(!!matches.length));
  };
  input.addEventListener('input', show);
  input.addEventListener('focus', show);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) show();
      if (list.hidden) return;
      activate(
        event.key === 'ArrowDown'
          ? (active + 1) % matches.length
          : active <= 0
            ? matches.length - 1
            : active - 1,
      );
    } else if (event.key === 'Enter' && !list.hidden && active >= 0) {
      event.preventDefault();
      select(active);
    } else if (event.key === 'Tab') close();
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.target !== input && !list.contains(event.target)) close();
  });
  return {
    close,
    refresh: () => {
      if (document.activeElement === input) show();
      else close();
    },
  };
}
