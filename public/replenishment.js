export function mountReplenishment(host, data, offers, { api, esc, money, toast, reload }) {
  if (data.actor.role !== 'editor') return;
  host.insertAdjacentHTML(
    'afterbegin',
    '<details class="commercial-disclosure"><summary><span>Preparar reposición de varios proveedores</span><span class="disclosure-action">Abrir</span></summary><div class="disclosure-body"><p>Se creará una compra pendiente por proveedor. Se revisarán y recibirán por separado; guardar no aumenta el stock ni envía pedidos.</p><form id="replenishment-form"><label class="field">Motivo común<textarea name="reason" required minlength="5" maxlength="300"></textarea></label><div id="replenishment-lines"></div><button type="button" id="replenishment-add">Añadir producto y proveedor</button><div id="replenishment-preview" aria-live="polite"></div><button type="submit" class="primary">Guardar reposición para revisión</button></form></div></details>',
  );
  const form = host.querySelector('#replenishment-form');
  let requestId = crypto.randomUUID(),
    busy = false;
  const supplierOptions = data.suppliers.filter(
    (s) => s.active && offers.some((o) => o.supplierId === s.id),
  );
  const rows = () => [...form.querySelectorAll('[data-replenishment-line]')];
  const preview = () => {
    requestId = crypto.randomUUID();
    const totals = new Map();
    for (const row of rows()) {
      const supplierId = row.querySelector('[name="supplier"]').value,
        productId = row.querySelector('[name="product"]').value;
      const offer = offers.find((o) => o.supplierId === supplierId && o.productId === productId);
      totals.set(
        supplierId,
        (totals.get(supplierId) ?? 0) +
          (offer?.costCents ?? 0) * Number(row.querySelector('[name="quantity"]').value),
      );
    }
    form.querySelector('#replenishment-preview').innerHTML =
      '<h3>Compras que se prepararán</h3>' +
      [...totals]
        .map(
          ([id, total]) =>
            '<p>' +
            esc(data.suppliers.find((s) => s.id === id)?.name ?? id) +
            ' · ' +
            money(total) +
            ' sin IVA</p>',
        )
        .join('') +
      '<strong>Total: ' +
      money([...totals.values()].reduce((a, b) => a + b, 0)) +
      ' sin IVA</strong>';
  };
  const add = () => {
    if (rows().length >= 60) return;
    const row = document.createElement('div');
    row.className = 'purchase-line';
    row.dataset.replenishmentLine = '';
    row.innerHTML =
      '<label class="field">Proveedor<select name="supplier" required>' +
      supplierOptions
        .map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>')
        .join('') +
      '</select></label><label class="field">Producto<select name="product" required></select></label><label class="field">Unidades<input name="quantity" type="number" max="10000" required></label><button type="button">Quitar</button><small class="span-full"></small>';
    form.querySelector('#replenishment-lines').append(row);
    const supplier = row.querySelector('[name="supplier"]'),
      product = row.querySelector('[name="product"]'),
      quantity = row.querySelector('input');
    const productChanged = () => {
      const offer = offers.find(
        (o) => o.supplierId === supplier.value && o.productId === product.value,
      );
      quantity.min = quantity.step = String(offer?.packUnits ?? 1);
      quantity.value = String(offer?.packUnits ?? 1);
      row.querySelector('small').textContent = offer
        ? money(offer.costCents) +
          ' por unidad · Lote ' +
          offer.packUnits +
          ' · ' +
          offer.leadDays +
          ' días laborables orientativos'
        : 'Sin oferta';
      preview();
    };
    const supplierChanged = () => {
      product.innerHTML = offers
        .filter((o) => o.supplierId === supplier.value)
        .map(
          (o) =>
            '<option value="' +
            esc(o.productId) +
            '">' +
            esc(data.products.find((p) => p.id === o.productId)?.name ?? o.productId) +
            '</option>',
        )
        .join('');
      productChanged();
    };
    supplier.onchange = supplierChanged;
    product.onchange = productChanged;
    quantity.oninput = preview;
    row.querySelector('button').onclick = () => {
      row.remove();
      preview();
    };
    supplierChanged();
  };
  form.querySelector('#replenishment-add').onclick = add;
  form.elements.reason.oninput = () => {
    requestId = crypto.randomUUID();
  };
  add();
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const payload = {
      requestId,
      reason: form.elements.reason.value,
      lines: rows().map((row) => ({
        supplierId: row.querySelector('[name="supplier"]').value,
        productId: row.querySelector('[name="product"]').value,
        quantity: Number(row.querySelector('input').value),
      })),
    };
    const controls = [...form.elements];
    controls.forEach((c) => (c.disabled = true));
    try {
      const created = await api('/api/replenishments', payload);
      requestId = crypto.randomUUID();
      toast('Reposición guardada: ' + created.length + ' compras pendientes.');
      await reload();
    } catch (error) {
      toast(error.message, true);
    } finally {
      busy = false;
      if (form.isConnected) controls.forEach((c) => (c.disabled = false));
    }
  };
}
