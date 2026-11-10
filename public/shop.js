export function mountOrders(data, { esc, money, api, toast, reload, navigate }, mode = 'orders') {
  document.querySelector('#screen').innerHTML =
    '<section class="heading"><div><div class="eyebrow">GESTIÓN COMERCIAL</div><h1>' +
    (mode === 'shipping' ? 'Envíos.' : 'Pedidos.') +
    '</h1><p>' +
    (mode === 'shipping'
      ? 'Avisos internos de paquetes preparados. Registra el transportista y la referencia después de tramitar el envío por tu cuenta; Almacén confirmará la recogida real.'
      : 'Consulta las compras de clientes. Almacén prepara el paquete y confirma la recogida; Envíos tramita la expedición. Documentos y cobros tienen su propio seguimiento.') +
    '</p></div></section>' +
    '<div class="stats" data-area="shop"><article class="panel panel-body"><small>Pedidos registrados</small><h2>' +
    data.metrics.orders +
    '</h2></article><article class="panel panel-body"><small>Importes del escenario · incluye históricos</small><h2>' +
    money(data.metrics.revenueCents) +
    '</h2></article><article class="panel panel-body"><small>Margen del escenario · históricos sin fiscalidad</small><h2>' +
    money(data.metrics.grossCents) +
    '</h2></article></div><section class="panel" data-area="shop"><div class="panel-title"><h2>Pedidos recibidos</h2></div><div class="panel-body" id="shop-orders"></div></section>';
  const statusLabels = {
    confirmed: 'Confirmado',
    prepared: 'Listo para enviar · confirmado por Almacén',
    shipped: 'Enviado (demo)',
    cancelled: 'Cancelado',
    returned: 'Devuelto',
  };

  const fiscal = data.fiscalMetrics;
  document
    .querySelector('#screen')
    .insertAdjacentHTML(
      'beforeend',
      '<section class="panel panel-body" data-area="shop" id="shop-fiscal-summary"><h2>Nuevos pedidos con IVA guardado</h2><p>' +
        fiscal.orders +
        ' pedidos · Base: ' +
        money(fiscal.baseCents) +
        ' · IVA: ' +
        money(fiscal.taxCents) +
        ' · Total: ' +
        money(fiscal.totalCents) +
        ' · Margen bruto sin IVA: ' +
        money(fiscal.grossMarginCents) +
        '</p><p>' +
        fiscal.historicalOrders +
        ' pedidos históricos activos quedan fuera de este desglose. No es beneficio neto ni declaración tributaria.</p></section>',
    );
  const sales =
    mode === 'shipping'
      ? data.sales.filter((s) => ['prepared', 'shipped'].includes(s.status))
      : data.sales;
  const screen = document.querySelector('#screen');
  const canShip =
    data.actor.role !== 'viewer' && (data.actor.permissions ?? []).includes('orders.ship');
  if (mode === 'shipping') {
    screen.querySelector('.stats').remove();
    screen.querySelector('#shop-fiscal-summary').remove();
    screen.querySelector('.panel-title h2').textContent =
      'Avisos de Almacén y seguimiento de envíos';
    if (!canShip)
      screen.querySelector('.heading p').textContent +=
        ' Aquí puedes consultar la tramitación. La recogida del transportista se confirma en Almacén.';
  }
  let changing = false,
    page = 1;
  const pageSize = 15;
  const listHost = screen.querySelector('#shop-orders');
  listHost.insertAdjacentHTML(
    'beforebegin',
    '<div class="panel-body"><label class="field">Buscar pedido o cliente<input id="order-search" type="search" placeholder="Referencia, nombre o correo"></label><label class="field">Estado del pedido<select id="order-status"><option value="">Todos los estados</option>' +
      Object.entries(statusLabels)
        .filter(([value]) => mode !== 'shipping' || ['prepared', 'shipped'].includes(value))
        .map(([value, label]) => '<option value="' + value + '">' + esc(label) + '</option>')
        .join('') +
      '</select></label><label class="field">Pedidos desde<input id="order-from" type="date"></label><label class="field">Pedidos hasta<input id="order-to" type="date"></label><button class="chip" id="order-clear">Limpiar filtros</button><p>Los filtros afectan solo a la lista. Los indicadores mantienen su alcance general.</p><p id="order-filter-note" role="status"></p><div class="chips"><button class="chip" id="order-previous">Página anterior</button><button class="chip" id="order-next">Página siguiente</button></div></div>',
  );
  function renderList() {
    const query = screen.querySelector('#order-search').value.trim().toLocaleLowerCase('es');
    const status = screen.querySelector('#order-status').value,
      from = screen.querySelector('#order-from').value,
      to = screen.querySelector('#order-to').value;
    if (from && to && from > to) {
      screen.querySelector('#order-filter-note').textContent =
        'Periodo no válido. Se mantiene la última lista; corrige las fechas.';
      return;
    }
    const filtered = sales.filter((sale) => {
      const date = new Date(sale.createdAt).toLocaleDateString('sv-SE', {
        timeZone: 'Europe/Madrid',
      });
      return (
        (!status || (sale.status ?? 'confirmed') === status) &&
        (!from || date >= from) &&
        (!to || date <= to) &&
        (!query ||
          [sale.id, sale.customer?.name, sale.customer?.email]
            .filter(Boolean)
            .join(' ')
            .toLocaleLowerCase('es')
            .includes(query))
      );
    });
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    page = Math.min(page, pages);
    const pageSales = filtered.slice((page - 1) * pageSize, page * pageSize);
    screen.querySelector('#order-filter-note').textContent =
      filtered.length +
      ' pedidos encontrados · Página ' +
      page +
      ' de ' +
      pages +
      ' · hasta ' +
      pageSize +
      ' por página.';
    screen.querySelector('#order-previous').disabled = page === 1;
    screen.querySelector('#order-next').disabled = page >= pages;
    document.querySelector('#shop-orders').innerHTML = pageSales.length
      ? pageSales
          .map(
            (sale) =>
              '<article class="order"><h3>Pedido ' +
              esc(sale.id) +
              '</h3>' +
              (sale.customer
                ? '<p>Cliente: ' +
                  esc(sale.customer.name) +
                  ' · ' +
                  esc(sale.customer.email) +
                  '</p><p>Dirección: ' +
                  esc(sale.customer.address) +
                  '</p>'
                : '') +
              '<p>' +
              esc(new Date(sale.createdAt).toLocaleString('es-ES')) +
              ' · ' +
              esc(statusLabels[sale.status ?? 'confirmed']) +
              ' · ' +
              money(sale.tax?.totalCents ?? sale.totalCents) +
              '</p><ul>' +
              sale.lines
                .map(
                  (line) =>
                    '<li>' +
                    esc(line.name) +
                    ' · ' +
                    line.quantity +
                    ' × ' +
                    money(line.unitPriceCents) +
                    ((sale.returnedQuantities ?? []).some((r) => r.productId === line.productId)
                      ? ' · devueltas ' +
                        sale.returnedQuantities.find((r) => r.productId === line.productId).quantity
                      : '') +
                    '</li>',
                )
                .join('') +
              '</ul><p class="hint">Precio y coste conservados al confirmar. Consulta documentos y cobros en sus apartados.</p>' +
              (sale.preparedBy
                ? '<p>Almacén: listo el ' +
                  esc(new Date(sale.preparedBy.at).toLocaleString('es-ES')) +
                  ' · ' +
                  esc(data.identityNames[sale.preparedBy.by] ?? sale.preparedBy.by) +
                  '</p>'
                : '') +
              (sale.shippedBy
                ? '<p>Salida registrada el ' +
                  esc(new Date(sale.shippedBy.at).toLocaleString('es-ES')) +
                  ' · ' +
                  esc(data.identityNames[sale.shippedBy.by] ?? sale.shippedBy.by) +
                  '</p>'
                : '') +
              ((sale.status ?? 'confirmed') === 'confirmed'
                ? '<p>Pendiente de preparación del almacén.</p><button class="chip" data-go-warehouse>Ver preparación en Almacén</button>'
                : '') +
              (sale.status === 'prepared' && mode !== 'shipping'
                ? '<button class="chip" data-go-shipping>Gestionar en Envíos</button>'
                : '') +
              (sale.dispatch
                ? '<p><strong>Envío tramitado:</strong> ' +
                  esc(sale.dispatch.carrier) +
                  ' · ' +
                  esc(sale.dispatch.reference) +
                  ' · ' +
                  esc(data.identityNames[sale.dispatch.by] ?? sale.dispatch.by) +
                  ' · ' +
                  esc(new Date(sale.dispatch.at).toLocaleString('es-ES')) +
                  '</p>' +
                  (sale.status === 'prepared'
                    ? '<p>Pendiente de recogida del transportista. Almacén confirmará la salida.</p>'
                    : '')
                : '') +
              (sale.status === 'prepared' && !sale.dispatch && mode === 'shipping' && canShip
                ? '<form data-dispatch="' +
                  esc(sale.id) +
                  '"><label class="field">Transportista<input name="carrier" maxlength="100" required></label><label class="field">Referencia de expedición<input name="reference" maxlength="100" required></label><label class="field">Enlace de seguimiento del transportista (opcional)<input name="trackingUrl" type="url" placeholder="https://…" maxlength="2000"></label><button class="primary">Confirmar envío tramitado y avisar a Almacén</button></form>'
                : '') +
              (mode !== 'shipping' &&
              data.actor.role === 'editor' &&
              ['confirmed', 'prepared'].includes(sale.status ?? 'confirmed')
                ? '<div class="chips"><button class="chip" data-order="' +
                  esc(sale.id) +
                  '" data-status="cancelled">Cancelar y devolver existencias</button></div>'
                : '') +
              '</article>',
          )
          .join('')
      : '<p>No hay pedidos con estos filtros.</p>';
    screen
      .querySelectorAll('[data-go-warehouse]')
      .forEach((b) => (b.onclick = () => navigate('warehouse')));
    screen
      .querySelectorAll('[data-go-shipping]')
      .forEach((b) => (b.onclick = () => navigate('shipping')));

    screen.querySelectorAll('[data-dispatch]').forEach(
      (form) =>
        (form.onsubmit = async (event) => {
          event.preventDefault();
          const button = form.querySelector('button');
          if (button.disabled) return;
          button.disabled = true;
          try {
            await api('/api/orders/' + encodeURIComponent(form.dataset.dispatch) + '/status', {
              status: 'dispatch_ready',
              expectedStatus: 'prepared',
              carrier: form.elements.carrier.value,
              reference: form.elements.reference.value,
              trackingUrl: form.elements.trackingUrl.value,
            });
            await reload();
            toast('Expedición tramitada. Almacén tiene el aviso de recogida pendiente.');
          } catch (error) {
            toast(error.message, true);
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        }),
    );
    screen.querySelectorAll('[data-order]').forEach((button) =>
      button.addEventListener('click', async () => {
        if (changing) return;
        changing = true;
        screen.querySelectorAll('[data-order]').forEach((control) => (control.disabled = true));
        const sale = sales.find((sale) => sale.id === button.dataset.order);
        try {
          await api('/api/orders/' + encodeURIComponent(sale.id) + '/status', {
            status: button.dataset.status,
            expectedStatus: sale.status ?? 'confirmed',
          });
          await reload();
          toast(
            button.dataset.status === 'cancelled'
              ? 'Pedido cancelado. Existencias devueltas al almacén.'
              : 'Estado del pedido actualizado.',
          );
        } catch (error) {
          toast(error.message, true);
        } finally {
          changing = false;
          if (button.isConnected)
            screen
              .querySelectorAll('[data-order]')
              .forEach((control) => (control.disabled = false));
        }
      }),
    );
  }
  for (const id of ['order-search', 'order-status', 'order-from', 'order-to'])
    screen.querySelector('#' + id).addEventListener('input', () => {
      if (changing) return;
      page = 1;
      renderList();
    });
  screen.querySelector('#order-clear').addEventListener('click', () => {
    if (changing) return;
    for (const id of ['order-search', 'order-status', 'order-from', 'order-to'])
      screen.querySelector('#' + id).value = '';
    page = 1;
    renderList();
  });
  screen.querySelector('#order-previous').addEventListener('click', () => {
    if (changing) return;
    page--;
    renderList();
  });
  screen.querySelector('#order-next').addEventListener('click', () => {
    if (changing) return;
    page++;
    renderList();
  });
  renderList();
}
