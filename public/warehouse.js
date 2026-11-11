import { groupWarehouseMovements } from '/warehouse-movements.js';
import {
  mountPreparation,
  mountWarehouseReceiving,
  mountWarehouseReturns,
} from '/warehouse-preparation.js';
export async function mountWarehouse(data, { api, esc, toast, reload, navigate }) {
  const screen = document.querySelector('#screen'),
    sales = data.sales,
    activeSuppliers = data.suppliers.filter((s) => s.active);
  let changing = false;
  screen.innerHTML =
    '<section class="heading"><div><div class="eyebrow">INVENTARIO Y MOVIMIENTOS</div><h1>Almacén.</h1><p>Revisa existencias, recepciones, ajustes y devoluciones físicas. No registra pagos ni rectifica documentos.</p></div></section>';
  screen.insertAdjacentHTML(
    'beforeend',
    '<section class="panel panel-body" id="warehouse-preparation"></section>',
  );
  if (data.actor.profile === 'warehouse')
    screen.querySelector('.heading p').textContent =
      'Prepara pedidos, recibe mercancía y confirma las recogidas. Comunica los daños en Roturas en transporte; oficina tramita los envíos y las reclamaciones.';
  mountPreparation(data, { api, esc, toast, reload, navigate });
  if (data.actor.profile === 'warehouse')
    mountWarehouseReturns(screen, data, { api, esc, toast, reload });
  const productName = (id) => data.products.find((product) => product.id === id)?.name ?? id;
  let purchases;
  try {
    const operations = await api(
      data.actor.profile === 'warehouse' ? '/api/warehouse/purchases' : '/api/operations',
    );
    if (
      !screen.querySelector('.heading h1') ||
      screen.querySelector('.heading h1').textContent !== 'Almacén.'
    )
      return;
    purchases = operations.purchases;
    if (data.actor.profile === 'warehouse')
      mountWarehouseReceiving(screen, purchases, { api, esc, reload, toast });
    if (data.actor.businessRole === 'owner')
      mountWarehouseReturns(
        screen,
        { ...data, goodsReturns: operations.returns },
        { api, esc, toast, reload },
      );
  } catch {
    purchases = null;
  }
  const shortDate = (value) =>
    new Date(value).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  screen.insertAdjacentHTML(
    'beforeend',
    '<section class="panel" data-area="warehouse"><div class="panel-title"><h2>Existencias y reposición</h2></div><div class="panel-body table-wrap"><p>Stock actual: unidades disponibles ahora. Pendiente: compras aprobadas aún sin recibir. Stock previsto: actual + pendiente. Lo recibido ya está incluido en el stock actual.</p>' +
      (purchases === null
        ? '<p role="alert">No se pudieron consultar las compras pendientes. Actualiza los datos para conocer la previsión.</p>'
        : '') +
      '<table><thead><tr><th>Producto</th><th>Stock actual</th><th>Pendiente de recibir</th><th>Recepción reciente</th><th>Stock previsto</th></tr></thead><tbody>' +
      data.inventory
        .filter((row) => data.products.some((p) => p.id === row.productId))
        .map((row) => {
          const pending =
            purchases === null
              ? null
              : purchases
                  .filter((p) => ['approved', 'sent', 'partially_received'].includes(p.status))
                  .flatMap((p) =>
                    p.lines.map((line) => ({
                      ...line,
                      quantity:
                        line.quantity -
                        (p.deliveries ?? [])
                          .flatMap((d) => d.lines)
                          .filter((r) => r.productId === line.productId && !r.cancelledReceiptId)
                          .reduce((sum, r) => sum + r.quantity, 0),
                    })),
                  )
                  .filter((line) => line.productId === row.productId)
                  .reduce((sum, line) => sum + line.quantity, 0);
          const receipt = data.receipts
            .filter((r) => r.productId === row.productId && !r.cancellation)
            .sort((a, b) => b.at.localeCompare(a.at))[0];
          return (
            '<tr><td>' +
            esc(productName(row.productId)) +
            '</td><td>' +
            esc(row.quantity) +
            '</td><td>' +
            (pending === null ? 'Sin datos' : esc(pending)) +
            '</td><td>' +
            (receipt
              ? '+' +
                esc(receipt.quantity) +
                '<small class="receipt-date">' +
                esc(shortDate(receipt.at)) +
                '</small>'
              : 'Sin recepción reciente') +
            '</td><td>' +
            (pending === null ? 'Sin datos' : esc(row.quantity + pending)) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div></section><section class="panel" data-area="warehouse"><div class="panel-title"><h2>Últimos movimientos del almacén</h2></div><div class="panel-body">' +
      (data.movements.length
        ? groupWarehouseMovements(data.movements, data.receipts)
            .map((group) => {
              const labels = {
                sale: 'Pedido · Venta',
                receipt: 'Recepción',
                cancellation: 'Cancelación de pedido',
                return: 'Devolución',
                'partial-return': 'Devolución parcial',
                'receipt-cancellation': 'Anulación de recepción',
                adjustment: 'Ajuste de stock',
              };
              return (
                '<details class="commercial-disclosure"><summary><span>' +
                esc(labels[group.kind] ?? group.kind) +
                ' · ' +
                group.rows.length +
                ' productos<small class="receipt-date">' +
                esc(shortDate(group.at)) +
                '</small></span><span class="disclosure-action">Abrir</span></summary><div class="disclosure-body"><p>Referencia: ' +
                esc(group.reference) +
                (group.supplier ? ' · ' + esc(group.supplier) : '') +
                '</p><table><thead><tr><th>Producto</th><th>Movimiento de unidades</th></tr></thead><tbody>' +
                group.rows
                  .map(
                    (row) =>
                      '<tr><td>' +
                      esc(productName(row.productId)) +
                      '</td><td>' +
                      (row.quantity > 0 ? '+' : '') +
                      esc(row.quantity) +
                      '</td></tr>',
                  )
                  .join('') +
                '</tbody></table></div></details>'
              );
            })
            .join('')
        : '<p>Los movimientos se registran desde este incremento; las ventas anteriores se conservan sin inventar registros retroactivos.</p>') +
      '</div></section>',
  );

  screen.insertAdjacentHTML(
    'beforeend',
    '<section class="panel" data-area="warehouse"><div class="panel-title"><h2>Registrar entrada de almacén</h2></div><div class="panel-body">' +
      ((data.actor.role === 'editor' && data.actor.businessRole !== 'office') ||
      (data.actor.permissions ?? []).includes('warehouse.receive')
        ? '<form id="receipt-form"><label class="field">Producto<select name="productId">' +
          data.products
            .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>')
            .join('') +
          '</select></label><label class="field">Unidades recibidas<input name="quantity" type="number" min="1" max="10000" step="1" required></label><label class="field">Proveedor<select name="supplierId"><option value="">Proveedor ocasional (escribir nombre)</option>' +
          activeSuppliers
            .map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>')
            .join('') +
          '</select></label><label class="field">Nombre del proveedor ocasional<input name="supplier" minlength="2" maxlength="120" placeholder="Solo si no seleccionas una ficha"></label><label class="field">Referencia del albarán<input name="reference" maxlength="100" placeholder="ALB-DEMO-001" required></label><button class="primary" type="submit">Registrar recepción</button><p class="hint">Aumenta el stock. No registra una factura, un pago ni cambia el coste del catálogo. Usa datos ficticios.</p></form>'
        : '<p>Necesitas una cuenta editora para registrar entradas.</p>') +
      '<h3>Últimas recepciones</h3>' +
      (data.receipts.length
        ? data.receipts
            .map(
              (receipt) =>
                '<article class="order"><strong>' +
                esc(productName(receipt.productId)) +
                ' · +' +
                esc(receipt.quantity) +
                '</strong><p>' +
                esc(receipt.supplier) +
                ' · Albarán ' +
                esc(receipt.reference) +
                ' · ' +
                esc(new Date(receipt.at).toLocaleString('es-ES')) +
                '</p>' +
                (receipt.cancellation
                  ? '<p>Anulada · ' +
                    esc(receipt.cancellation.reason) +
                    ' · ' +
                    esc(receipt.cancellation.at) +
                    '</p>'
                  : data.actor.role === 'editor' && data.actor.businessRole !== 'office'
                    ? '<form data-cancel-receipt="' +
                      esc(receipt.id) +
                      '" data-product="' +
                      esc(receipt.productId) +
                      '"><label>Motivo de anulación<input name="reason" minlength="5" maxlength="300" required></label><button>Anular recepción errónea</button></form>'
                    : '') +
                '</article>',
            )
            .join('')
        : '<p>Todavía no hay recepciones registradas.</p>') +
      '</div></section>',
  );
  screen.querySelectorAll('[data-cancel-receipt]').forEach((form) =>
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button');
      button.disabled = true;
      try {
        const row = data.inventory.find((row) => row.productId === form.dataset.product);
        const result = await api(
          '/api/inventory/receipts/' + encodeURIComponent(form.dataset.cancelReceipt) + '/cancel',
          { reason: form.elements.reason.value, expectedQuantity: Number(row?.quantity) },
        );
        await reload();
        toast(
          result.purchaseId
            ? 'Recepción anulada. Las unidades vuelven a quedar pendientes en la compra.'
            : 'Recepción anulada y stock corregido.',
        );
      } catch (error) {
        toast(error.message, true);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    }),
  );
  const receiptForm = screen.querySelector('#receipt-form');
  if (receiptForm && data.actor.profile === 'warehouse') {
    const exceptional = document.createElement('details');
    exceptional.className = 'commercial-disclosure';
    exceptional.innerHTML =
      '<summary>Registrar otra entrada sin compra vinculada</summary><div class="disclosure-body"><p>Para una compra registrada, usa Mercancía pendiente de recibir. Esta opción es para otras entradas justificadas; no vuelvas a registrar mercancía ya recibida.</p></div>';
    receiptForm.before(exceptional);
    exceptional.querySelector('.disclosure-body').append(receiptForm);
  }
  if (receiptForm) {
    let receiptRequest = crypto.randomUUID();
    receiptForm.addEventListener('input', () => {
      receiptRequest = crypto.randomUUID();
    });
    receiptForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (changing) return;
      changing = true;
      const button = receiptForm.querySelector('button');
      const payload = {
        requestId: receiptRequest,
        productId: receiptForm.elements.productId.value,
        quantity: Number(receiptForm.elements.quantity.value),
        supplier:
          activeSuppliers.find((s) => s.id === receiptForm.elements.supplierId.value)?.name ??
          receiptForm.elements.supplier.value,
        ...(receiptForm.elements.supplierId.value
          ? { supplierId: receiptForm.elements.supplierId.value }
          : {}),
        reference: receiptForm.elements.reference.value,
      };
      [...receiptForm.elements].forEach((control) => (control.disabled = true));
      try {
        await api('/api/inventory/receipts', payload);
        await reload();
        toast('Entrada registrada. Existencias actualizadas.');
      } catch (error) {
        toast(error.message, true);
      } finally {
        changing = false;
        if (button.isConnected)
          [...receiptForm.elements].forEach((control) => (control.disabled = false));
      }
    });
  }

  const shipped = sales.filter((sale) => sale.status === 'shipped');
  if (data.actor.role === 'editor' && data.actor.businessRole !== 'office') {
    screen.insertAdjacentHTML(
      'beforeend',
      '<section class="panel panel-body" data-area="warehouse"><h2>Ajustar existencias por recuento</h2><p>Para diferencias de inventario, roturas o pérdidas. Las recepciones de proveedor tienen su propio formulario. No cambia costes ni registra gastos.</p><form id="adjustment-form"><label class="field">Artículo<select name="productId">' +
        data.products
          .map(
            (p) =>
              '<option value="' +
              esc(p.id) +
              '">' +
              esc(p.name) +
              ' · stock revisado ' +
              esc(data.inventory.find((row) => row.productId === p.id)?.quantity ?? 0) +
              '</option>',
          )
          .join('') +
        '</select></label><label class="field">Variación de unidades (+ / −)<input type="number" name="delta" min="-10000" max="10000" step="1" required></label><label class="field">Motivo del ajuste<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><button class="chip">Registrar ajuste de existencias</button></form></section>' +
        '<section class="panel panel-body" data-area="warehouse"><h2>Recibir devolución completa</h2><p>Solo pedidos enviados y mercancía recibida apta para reponer. No gestiona reembolso ni rectificación documental; ambos quedan separados.</p>' +
        (shipped.length
          ? '<form id="return-form"><label class="field">Pedido enviado<select name="orderId">' +
            shipped
              .map((s) => '<option value="' + esc(s.id) + '">' + esc(s.id) + '</option>')
              .join('') +
            '</select></label><label class="field">Motivo de devolución<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><label><input name="confirmReceived" type="checkbox" required> He recibido todos los artículos y pueden volver al stock.</label><button class="chip">Registrar devolución completa</button></form>'
          : '<p>No hay pedidos enviados pendientes de devolución.</p>') +
        '</section>',
    );
    let adjustmentId = crypto.randomUUID();
    const form = screen.querySelector('#adjustment-form');
    form.addEventListener('input', () => (adjustmentId = crypto.randomUUID()));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (changing) return;
      changing = true;
      const f = form.elements,
        productId = f.productId.value,
        payload = {
          requestId: adjustmentId,
          productId,
          delta: Number(f.delta.value),
          expectedQuantity:
            data.inventory.find((row) => row.productId === productId)?.quantity ?? 0,
          reason: f.reason.value,
        };
      [...f].forEach((control) => (control.disabled = true));
      try {
        await api('/api/inventory/adjustments', payload);
        await reload();
        toast('Ajuste registrado con motivo y movimiento de almacén.');
      } catch (error) {
        toast(error.message, true);
      } finally {
        changing = false;
        if (form.isConnected) [...f].forEach((control) => (control.disabled = false));
      }
    });
    const returnForm = screen.querySelector('#return-form');
    if (returnForm)
      returnForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (changing) return;
        changing = true;
        const f = returnForm.elements,
          id = f.orderId.value,
          payload = { reason: f.reason.value, confirmReceived: f.confirmReceived.checked };
        [...f].forEach((control) => (control.disabled = true));
        try {
          await api('/api/orders/' + encodeURIComponent(id) + '/return', payload);
          await reload();
          toast(
            'Devolución recibida y stock repuesto. Revisa por separado documentos y reembolsos.',
          );
        } catch (error) {
          toast(error.message, true);
        } finally {
          changing = false;
          if (returnForm.isConnected) [...f].forEach((control) => (control.disabled = false));
        }
      });
  }
}
