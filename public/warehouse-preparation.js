export function mountPreparation(data, { api, esc, toast, reload, navigate }) {
  const host = document.querySelector('#warehouse-preparation');
  const allowed =
    (data.actor.role !== 'viewer' || data.actor.profile === 'warehouse') &&
    (data.actor.permissions ?? []).includes('warehouse.prepare');
  const pickups = data.sales.filter((s) => s.status === 'prepared' && s.dispatch);
  const pending = data.sales.filter((s) => (s.status ?? 'confirmed') === 'confirmed');
  host.innerHTML =
    '<h2>Preparar pedidos de clientes</h2><p>Comprueba los artículos y las cantidades, prepara el paquete y confirma que está listo para enviar. El stock ya se descontó al confirmar la compra; preparar no vuelve a descontarlo.</p><label class="field">Buscar pedido para preparar<input type="search" id="preparation-search" placeholder="Referencia o cliente"></label><p id="preparation-count" role="status"></p><div id="preparation-list"></div><button type="button" class="chip" id="preparation-shipments">Ver paquetes listos en Envíos</button>';
  host.querySelector('#preparation-shipments').hidden = data.actor.profile === 'warehouse';
  host.querySelector('#preparation-shipments').onclick = () => navigate('shipping');
  const draw = () => {
    const q = host.querySelector('#preparation-search').value.trim().toLocaleLowerCase('es-ES');
    const filtered = pending.filter((s) =>
      (s.id + ' ' + (s.customer?.name ?? '')).toLocaleLowerCase('es-ES').includes(q),
    );
    host.querySelector('#preparation-count').textContent =
      filtered.length +
      ' pedidos pendientes' +
      (filtered.length > 15
        ? ' · se muestran los 15 primeros; usa el buscador para localizar otro.'
        : '.');
    host.querySelector('#preparation-list').innerHTML = filtered.length
      ? filtered
          .slice(0, 15)
          .map(
            (s, i) =>
              '<details class="commercial-disclosure" ' +
              (i === 0 ? 'open' : '') +
              '><summary>' +
              esc(s.customer?.name ?? 'Pedido') +
              ' · ' +
              esc(s.id.slice(0, 8)) +
              ' · ' +
              esc(new Date(s.createdAt).toLocaleString('es-ES')) +
              '</summary><div class="disclosure-body"><form data-prepare-order="' +
              esc(s.id) +
              '"><h3>Comprobación del paquete</h3>' +
              s.lines
                .map(
                  (l) =>
                    '<p><label><input type="checkbox" required ' +
                    (!allowed ? 'disabled' : '') +
                    '> ' +
                    esc(l.name) +
                    ' · ' +
                    l.quantity +
                    ' unidades comprobadas</label></p>',
                )
                .join('') +
              (allowed
                ? '<button class="primary" type="submit">Confirmar listo para enviar</button>'
                : '<p>Tu cuenta puede consultar este pedido. Para confirmar necesitas permiso de preparación de almacén.</p>') +
              '</form></div></details>',
          )
          .join('')
      : '<p>No hay pedidos pendientes de preparación con esta búsqueda.</p>';
    host.querySelectorAll('[data-prepare-order]').forEach((form) =>
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const button = form.querySelector('button');
        if (button.disabled) return;
        button.disabled = true;
        try {
          await api('/api/orders/' + encodeURIComponent(form.dataset.prepareOrder) + '/status', {
            status: 'prepared',
            expectedStatus: 'confirmed',
          });
          await reload();
          toast('Almacén ha confirmado el paquete. Ya aparece en Envíos.');
        } catch (error) {
          toast(error.message, true);
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      }),
    );
  };
  host.querySelector('#preparation-search').addEventListener('input', draw);
  draw();
  if (pickups.length) {
    const section = document.createElement('section');
    section.innerHTML =
      '<h2>Paquetes pendientes de recogida</h2><p>Envíos ha tramitado estos paquetes. Confirma solo cuando el transportista se los lleve.</p>' +
      pickups
        .map(
          (s) =>
            '<article class="order"><strong>' +
            esc(s.id.slice(0, 8)) +
            '</strong><p>' +
            esc(s.dispatch.carrier) +
            ' · ' +
            esc(s.dispatch.reference) +
            '</p>' +
            ((data.actor.permissions ?? []).includes('warehouse.handover')
              ? '<button class="chip" data-handover="' +
                esc(s.id) +
                '">Confirmar recogida del transportista</button>'
              : '<p>Pendiente de confirmación de Almacén.</p>') +
            '</article>',
        )
        .join('');
    host.append(section);
    section.querySelectorAll('[data-handover]').forEach(
      (button) =>
        (button.onclick = async () => {
          button.disabled = true;
          try {
            await api('/api/orders/' + encodeURIComponent(button.dataset.handover) + '/status', {
              status: 'shipped',
              expectedStatus: 'prepared',
            });
            await reload();
            toast('Recogida registrada. El cliente ya ve el pedido enviado.');
          } catch (error) {
            toast(error.message, true);
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        }),
    );
  }
}

export function mountWarehouseReceiving(screen, purchases, { api, esc, reload, toast }) {
  const pending = purchases.filter((p) => ['sent', 'partially_received'].includes(p.status));
  const section = document.createElement('section');
  section.className = 'panel panel-body';
  section.innerHTML =
    '<h2>Mercancía pendiente de recibir</h2><p>Registra únicamente las unidades que han llegado en buen estado. Los daños se comunican en Roturas en transporte. No se muestran importes ni opciones de compra.</p>' +
    (pending.length
      ? pending
          .map(
            (p) =>
              '<details class="commercial-disclosure"><summary>' +
              esc(p.supplierName) +
              ' · ' +
              esc(p.reference ?? p.id.slice(0, 8)) +
              '</summary><div class="disclosure-body"><form data-receive-warehouse="' +
              esc(p.id) +
              '"><label class="field">Referencia del albarán<input name="reference" required maxlength="100"></label>' +
              p.lines
                .map((l) => {
                  const received = (p.deliveries ?? [])
                    .flatMap((d) => d.lines)
                    .filter((r) => r.productId === l.productId && !r.cancelledReceiptId)
                    .reduce((n, r) => n + r.quantity, 0);
                  const remaining = l.quantity - received;
                  return remaining > 0
                    ? '<label class="field">' +
                        esc(l.name) +
                        ' · pendientes ' +
                        remaining +
                        '<input type="number" data-product="' +
                        esc(l.productId) +
                        '" min="0" max="' +
                        remaining +
                        '" step="1" value="0" required></label>'
                    : '';
                })
                .join('') +
              '<button class="primary">Confirmar unidades recibidas</button></form></div></details>',
          )
          .join('')
      : '<p>No hay mercancía enviada por proveedores pendiente de recepción.</p>');
  screen.append(section);
  section.querySelectorAll('[data-receive-warehouse]').forEach((form) => {
    let requestId = crypto.randomUUID();
    form.addEventListener('input', () => {
      requestId = crypto.randomUUID();
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      if (button.disabled) return;
      const p = purchases.find((p) => p.id === form.dataset.receiveWarehouse);
      const lines = [...form.querySelectorAll('[data-product]')]
        .map((i) => ({ productId: i.dataset.product, quantity: Number(i.value) }))
        .filter((l) => l.quantity > 0);
      if (!lines.length) {
        toast('Indica al menos una unidad recibida.', true);
        return;
      }
      button.disabled = true;
      try {
        await api('/api/purchases/' + encodeURIComponent(p.id), {
          action: 'receive-partial',
          expectedVersion: p.version,
          requestId,
          reference: form.elements.reference.value,
          confirmReceived: true,
          lines,
        });
        await reload();
        toast('Recepción registrada. Stock actualizado.');
      } catch (error) {
        toast(error.message, true);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    };
  });
}

export function mountWarehouseReturns(screen, data, { api, esc, toast, reload }) {
  const canReceive =
    data.actor.businessRole === 'owner' ||
    (data.actor.businessRole !== 'office' &&
      (data.actor.permissions ?? []).includes('warehouse.receive'));
  const canDispose =
    data.actor.businessRole === 'owner' ||
    (data.actor.businessRole !== 'office' &&
      (data.actor.permissions ?? []).includes('warehouse.damage'));
  const returns = data.goodsReturns ?? [];
  const quarantined = returns.filter((r) => r.condition === 'damaged' && !r.disposal);
  const productName = (r) => data.products.find((p) => p.id === r.productId)?.name ?? r.productId;
  const eligible = data.sales.filter(
    (s) =>
      s.status === 'shipped' &&
      s.lines.some(
        (l) =>
          l.quantity >
          (s.returnedQuantities?.find((r) => r.productId === l.productId)?.quantity ?? 0),
      ),
  );
  const section = document.createElement('section');
  section.className = 'panel panel-body';
  section.innerHTML =
    '<details class="commercial-disclosure"><summary>Devoluciones de clientes · recepción física</summary><div class="disclosure-body"><p>Comprueba las unidades recibidas y separa las dañadas. Si un artículo llega en ambos estados, regístralos en dos operaciones. Oficina recibirá un aviso para revisar los siguientes pasos.</p>' +
    (!canReceive
      ? ''
      : eligible.length
        ? '<form id="warehouse-return"><label class="field">Pedido enviado<select name="orderId">' +
          eligible
            .map(
              (s) =>
                '<option value="' +
                esc(s.id) +
                '">' +
                esc(s.id.slice(0, 8)) +
                ' · ' +
                esc(s.customer?.name ?? 'Pedido') +
                '</option>',
            )
            .join('') +
          '</select></label><label class="field">Producto<select name="productId"></select></label><label class="field">Unidades recibidas<input name="quantity" type="number" min="1" max="100" value="1" required></label><label class="field">Estado físico<select name="condition" required><option value="">Seleccionar estado</option><option value="sellable">Aptas para vender · reponer</option><option value="damaged">Dañadas · separar del stock vendible</option></select></label><label class="field">Motivo<textarea name="reason" minlength="5" maxlength="300" required></textarea></label><label><input name="confirm" type="checkbox" required> He recibido y comprobado las unidades.</label><p><button class="primary">Registrar devolución recibida</button></p></form>'
        : '<p>No hay pedidos enviados con unidades pendientes de devolver.</p>') +
    '<h3>Mercancía en cuarentena</h3><p>Registra la baja cuando retires todas las unidades de una devolución. El stock vendible y los reembolsos se gestionan por separado.</p>' +
    (quarantined
      .map(
        (r) =>
          '<details class="commercial-disclosure"><summary>Pedido ' +
          esc(r.orderId.slice(0, 8)) +
          ' · ' +
          esc(productName(r)) +
          ' · ' +
          r.quantity +
          ' unidades</summary><div class="disclosure-body"><p>' +
          esc(r.reason) +
          '</p>' +
          (canDispose
            ? '<form class="warehouse-disposal" data-return="' +
              esc(r.id) +
              '"><label class="field">Motivo de baja<textarea name="reason" minlength="5" maxlength="300" required></textarea></label><label class="field">Referencia del justificante (opcional)<input name="reference" maxlength="100"></label><label><input name="confirm" type="checkbox" required> He retirado físicamente las ' +
              r.quantity +
              ' unidades.</label><p><button class="primary">Registrar baja física</button></p></form>'
            : '') +
          '</div></details>',
      )
      .join('') || '<p>No hay devoluciones pendientes de baja.</p>') +
    '<h3>Últimas devoluciones recibidas</h3>' +
    (returns
      .slice(0, 20)
      .map(
        (r) =>
          '<p>' +
          esc(r.orderId.slice(0, 8)) +
          ' · ' +
          esc(productName(r)) +
          ' · ' +
          r.quantity +
          ' unidades · ' +
          (r.condition === 'damaged'
            ? r.disposal
              ? 'Dañadas · baja física registrada'
              : 'Dañadas · en cuarentena'
            : 'Aptas · repuestas') +
          '<small class="receipt-date">' +
          esc(new Date(r.createdAt).toLocaleString('es-ES')) +
          ' · ' +
          esc(data.identityNames[r.createdBy] ?? r.createdBy) +
          '</small>' +
          (r.disposal
            ? '<small class="receipt-date">Baja · ' +
              esc(new Date(r.disposal.at).toLocaleString('es-ES')) +
              ' · ' +
              esc(data.identityNames[r.disposal.by] ?? r.disposal.by) +
              ' · ' +
              esc(r.disposal.reason) +
              (r.disposal.reference ? ' · ' + esc(r.disposal.reference) : '') +
              '</small>'
            : '') +
          '</p>',
      )
      .join('') || '<p>No hay devoluciones recibidas.</p>') +
    '</div></details>';
  screen.append(section);
  for (const form of section.querySelectorAll('.warehouse-disposal')) {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      if (button.disabled) return;
      const item = quarantined.find((r) => r.id === form.dataset.return);
      const reference = form.elements.reference.value.trim();
      button.disabled = true;
      try {
        await api('/api/partial-returns/' + encodeURIComponent(item.id) + '/disposal', {
          expectedVersion: item.version,
          reason: form.elements.reason.value,
          ...(reference ? { reference } : {}),
          confirmDisposed: form.elements.confirm.checked,
        });
        await reload();
        toast('Baja física registrada. Oficina recibirá un aviso.');
      } catch (error) {
        toast(error.message, true);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    };
  }
  const form = section.querySelector('#warehouse-return');
  if (!form) return;
  let requestId = crypto.randomUUID();
  const update = () => {
    const s = eligible.find((s) => s.id === form.elements.orderId.value);
    form.elements.productId.innerHTML = s.lines
      .filter(
        (l) =>
          l.quantity >
          (s.returnedQuantities?.find((r) => r.productId === l.productId)?.quantity ?? 0),
      )
      .map(
        (l) =>
          '<option value="' +
          esc(l.productId) +
          '">' +
          esc(l.name) +
          ' · pendientes ' +
          (l.quantity -
            (s.returnedQuantities?.find((r) => r.productId === l.productId)?.quantity ?? 0)) +
          '</option>',
      )
      .join('');
  };
  form.elements.orderId.onchange = update;
  update();
  form.addEventListener('input', () => {
    requestId = crypto.randomUUID();
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = form.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    const s = eligible.find((s) => s.id === form.elements.orderId.value),
      productId = form.elements.productId.value;
    try {
      await api('/api/partial-returns', {
        requestId,
        orderId: s.id,
        productId,
        quantity: Number(form.elements.quantity.value),
        condition: form.elements.condition.value,
        expectedReturned:
          s.returnedQuantities?.find((r) => r.productId === productId)?.quantity ?? 0,
        reason: form.elements.reason.value,
        confirmReceived: form.elements.confirm.checked,
      });
      await reload();
      toast(
        form.elements.condition.value === 'damaged'
          ? 'Devolución dañada registrada. Mercancía separada y oficina avisada.'
          : 'Devolución recibida. Stock actualizado y oficina avisada.',
      );
    } catch (error) {
      toast(error.message, true);
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  };
}
