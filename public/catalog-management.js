export async function mountCatalogManagement(data, { api, esc, toast, reload }) {
  const host = document.createElement('section');
  host.className = 'panel panel-body';
  host.innerHTML = '<h2>Gestión de artículos</h2><p>Cargando…</p>';
  document.querySelector('#screen').append(host);
  try {
    const result = await api('/api/catalog-management');
    if (!host.isConnected) return;
    if (data.actor.role !== 'editor' || data.actor.businessRole === 'office') {
      host.innerHTML =
        '<h2>Gestión de artículos</h2><p>La edición del catálogo corresponde a dirección. Prepara los cambios de precios en Propuestas o Tarifas para que Antonio los revise.</p>';
      return;
    }
    host.innerHTML =
      '<h2>Crear o editar artículo</h2><form id="catalog-editor"><label class="field">Artículo<select name="id"><option value="">Crear nuevo artículo</option>' +
      result.products
        .map(
          (p) =>
            '<option value="' +
            esc(p.id) +
            '">' +
            esc(p.sku) +
            ' · ' +
            esc(p.name) +
            (p.active ? '' : ' (archivado)') +
            '</option>',
        )
        .join('') +
      '</select></label><label class="field">SKU<input name="sku" pattern="[A-Z0-9-]{3,30}" required></label><label class="field">Nombre<input name="name" minlength="3" maxlength="160" required></label><label class="field">Categoría<select name="category">' +
      result.categories.map((c) => '<option>' + esc(c) + '</option>').join('') +
      '</select></label><label class="field">Descripción<textarea name="description" minlength="10" maxlength="2000" required></textarea></label><div id="initial-prices"><label class="field">Precio inicial sin IVA (€)<input name="price" type="number" min="0.01" step="0.01" required></label><label class="field">Coste inicial neto (€)<input name="cost" type="number" min="0.01" step="0.01" required></label></div><label><input name="active" type="checkbox" checked> Artículo activo en tienda</label><p>Los artículos nuevos empiezan sin existencias. Reponlos desde almacén. Los precios existentes se modifican con propuestas de ChangeLab.</p><button class="primary">Guardar artículo</button></form>';
    const form = host.querySelector('form'),
      f = form.elements;
    f.id.addEventListener('change', () => {
      const p = result.products.find((p) => p.id === f.id.value);
      f.sku.value = p?.sku ?? '';
      f.sku.disabled = !!p;
      f.name.value = p?.name ?? '';
      f.category.value = p?.category ?? result.categories[0];
      f.description.value = p?.description ?? '';
      f.active.checked = p ? !!p.active : true;
      f.active.disabled = !p;
      host.querySelector('#initial-prices').hidden = !!p;
      f.price.disabled = !!p;
      f.cost.disabled = !!p;
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      if (button.disabled) return;
      const p = result.products.find((p) => p.id === f.id.value);
      const payload = {
        name: f.name.value,
        category: f.category.value,
        description: f.description.value,
        ...(p
          ? { active: f.active.checked, expectedVersion: p.version }
          : {
              sku: f.sku.value,
              priceCents: Math.round(Number(f.price.value) * 100),
              costCents: Math.round(Number(f.cost.value) * 100),
            }),
      };
      [...f].forEach((c) => (c.disabled = true));
      try {
        await api(
          p ? '/api/catalog-management/' + encodeURIComponent(p.id) : '/api/catalog-management',
          payload,
        );
        await reload();
        toast('Artículo guardado. Los pedidos anteriores conservan sus datos.');
      } catch (error) {
        toast(error.message, true);
        [...f].forEach((c) => (c.disabled = false));
        f.sku.disabled = !!p;
        f.price.disabled = !!p;
        f.cost.disabled = !!p;
      }
    });
  } catch (error) {
    host.textContent = error.message;
  }
}
