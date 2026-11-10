import { mountReplenishment } from '/replenishment.js';
import { restockCandidates } from '/restock-candidates.js';
export async function mountOperations(area, data, { api, esc, money, toast, reload, navigate }) {
  const root = document.querySelector('#screen'),
    names = {
      daily: 'Tu bandeja de trabajo',
      purchases: 'Compras a proveedores',
      returns: 'Devoluciones de clientes',
      followup: 'Evolución tras cambiar precios',
      incidents: 'Reclamaciones de clientes',
      imports: 'Albaranes de entrada',
    };
  root.innerHTML =
    '<section class="heading"><div><div class="eyebrow">OPERACIONES</div><h1>' +
    names[area] +
    '</h1><p>Revisa los datos y confirma cada operación.</p></div></section><section class="panel panel-body" id="operations-content">Cargando…</section>';
  const box = root.querySelector('#operations-content'),
    editor = data.actor.role === 'editor';
  const groups = ['returns', 'incidents'].includes(area)
    ? [
        ['returns', 'Devoluciones', 'Artículos que el cliente devuelve'],
        ['incidents', 'Reclamaciones', 'Problemas de un pedido y su resolución'],
      ]
    : ['purchases', 'imports'].includes(area)
      ? [
          ['purchases', 'Compras', 'Pedidos a proveedores y recepciones'],
          ['imports', 'Leer albarán', 'Extraer unidades de un documento'],
        ]
      : area === 'followup'
        ? [
            ['business', 'Análisis comercial', 'Stock, ventas y ayuda IA'],
            ['followup', 'Evolución de precios', 'Comparar ventas antes y después'],
          ]
        : [];
  if (groups.length) {
    box.insertAdjacentHTML(
      'beforebegin',
      '<nav class="tariff-tabs" aria-label="Opciones del apartado">' +
        groups
          .map(
            ([key, title, subtitle]) =>
              '<button type="button" data-operation-section="' +
              key +
              '" aria-pressed="' +
              (key === area) +
              '"><span>' +
              title +
              '<small>' +
              subtitle +
              '</small></span></button>',
          )
          .join('') +
        '</nav>',
    );
    root
      .querySelectorAll('[data-operation-section]')
      .forEach((b) => (b.onclick = () => navigate(b.dataset.operationSection)));
  }
  const options = (items, label, value = 'id') =>
    items
      .map((p) => '<option value="' + esc(p[value]) + '">' + esc(label(p)) + '</option>')
      .join('');
  const details = (title, content) =>
    '<details class="commercial-disclosure"><summary><span>' +
    esc(title) +
    '</span><span class="disclosure-action">Abrir</span></summary><div class="disclosure-body">' +
    content +
    '</div></details>';
  const field = (label, name, extra = '') =>
    '<label class="field">' + label + '<input name="' + name + '" ' + extra + ' required></label>';
  const orderLabel = (id) => {
    const sale = data.sales.find((s) => s.id === id);
    return (
      (sale?.customer?.name ?? 'Pedido') +
      ' · ' +
      (sale ? new Date(sale.createdAt).toLocaleDateString('es-ES') + ' · ' : '') +
      id.slice(0, 8)
    );
  };
  const reason =
    '<label class="field">Motivo<textarea name="reason" minlength="5" maxlength="300" required></textarea></label>';
  const supplier =
    '<label class="field">Proveedor<select name="supplierId" required><option value="">Selecciona proveedor</option>' +
    options(
      data.suppliers.filter((s) => s.active),
      (s) => s.name,
    ) +
    '</select></label>';
  const statuses = {
    rejected: 'Rechazada',
    changes_requested: 'Cambios solicitados',
    draft: 'Pendiente de revisión',
    approved: 'Aprobada · pendiente de enviar al proveedor',
    sent: 'Enviada al proveedor',
    partially_received: 'Recibida parcialmente',
    received: 'Recibida',
    cancelled: 'Cancelada',
    open: 'Abierta',
    investigating: 'En estudio',
    resolved: 'Resuelta',
  };
  const bind = (form, handler) =>
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector('button[type="submit"],button:not([type])');
      if (button?.disabled) return;
      if (button) button.disabled = true;
      try {
        await handler(new FormData(form), form);
      } catch (e) {
        toast(e.message, true);
      } finally {
        if (button?.isConnected) button.disabled = false;
      }
    });
  try {
    const op = await api('/api/operations');
    if (!box.isConnected) return;
    if (area === 'daily') {
      box.innerHTML =
        '<div class="commercial-ai"><div><h2>' +
        op.tasks.length +
        ' asuntos por revisar</h2><p>Ordenados por reglas. Se actualizan al cargar los datos.</p></div><button id="daily-ai" class="primary">Preparar resumen IA</button></div><p id="daily-brief" class="ai-draft" aria-live="polite"></p><div class="signal-grid">' +
        op.tasks
          .map(
            (t) =>
              '<article class="commercial-signal"><h3>' +
              esc(t.title) +
              '</h3><p>' +
              esc(t.detail) +
              '</p><button data-task="' +
              esc(t.area) +
              '">Ir al apartado</button></article>',
          )
          .join('') +
        '</div>';
      if (!op.tasks.length) box.innerHTML += '<p>No hay asuntos pendientes detectados.</p>';
      box
        .querySelectorAll('[data-task]')
        .forEach((b) => (b.onclick = () => navigate(b.dataset.task)));
      box.querySelector('#daily-ai').onclick = async (event) => {
        const b = event.currentTarget;
        b.disabled = true;
        try {
          const r = await api('/api/daily/brief', {});
          if (box.isConnected)
            box.querySelector('#daily-brief').textContent =
              (r.modelUsed ? 'Borrador IA · revisar: ' : 'Resumen por reglas: ') +
              r.text +
              (r.warning ? '\n' + r.warning : '');
        } catch (e) {
          toast(e.message, true);
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      };
    }
    if (area === 'purchases') {
      const stock = await api('/api/stock-analysis');
      const supply = await api('/api/suppliers');
      const offers = supply.offers;
      const restock = restockCandidates(stock.rows, op.purchases);
      if (!box.isConnected) return;
      box.innerHTML =
        '<p>Prepara una compra con los costes actuales, pide una revisión independiente y registra después la recepción completa. No se envía al proveedor ni genera factura o gasto.</p>' +
        (!editor
          ? '<p class="notice">Tu cuenta es de ' +
            (data.actor.businessRole === 'owner' ||
            (!data.actor.businessRole &&
              !data.actor.ownerApprovalRequired &&
              data.actor.role === 'reviewer')
              ? 'revisión: puedes aprobar las compras que otra persona haya preparado. Para crear una compra, entra con una cuenta editora.'
              : 'consulta: puedes ver las compras existentes. Para crear una compra, entra con una cuenta editora.') +
            '</p>'
          : '') +
        (!op.purchases.length
          ? '<p>No hay propuestas todavía. Prepara productos y cantidades para que otra persona los revise.</p>'
          : '') +
        (editor
          ? details(
              'Preparar una compra',
              '<form id="purchase-create">' +
                supplier +
                reason +
                '<div id="purchase-lines"></div><button type="button" id="purchase-add">Añadir artículo</button><p id="purchase-total"></p><button class="primary" type="submit">Guardar para revisión</button></form>',
            )
          : '') +
        op.purchases
          .map((p) =>
            details(
              p.supplierName + ' · ' + statuses[p.status] + ' · ' + money(p.totalCents) + ' netos',
              '<p>' +
                esc(p.reason) +
                '</p>' +
                (p.replenishmentId
                  ? '<p>Reposición conjunta: ' + esc(p.replenishmentId) + '</p>'
                  : '') +
                (p.review
                  ? '<p><strong>Revisión:</strong> ' +
                    esc(p.review.reason) +
                    ' · ' +
                    esc(p.review.at) +
                    '</p>'
                  : '') +
                (p.replacesId ? '<p>Alternativa a: ' + esc(p.replacesId) + '</p>' : '') +
                (p.replacementId
                  ? '<p>Propuesta alternativa: ' + esc(p.replacementId) + '</p>'
                  : '') +
                (editor && ['changes_requested', 'rejected'].includes(p.status) && !p.replacementId
                  ? '<button type="button" data-alternative="' +
                    esc(p.id) +
                    '">Preparar alternativa</button>'
                  : '') +
                '<ul>' +
                p.lines
                  .map((l) => {
                    const row = stock.rows.find((r) => r.productId === l.productId);
                    const pending = op.purchases
                      .filter(
                        (other) =>
                          other.id !== p.id &&
                          ['draft', 'approved', 'sent', 'partially_received'].includes(
                            other.status,
                          ),
                      )
                      .flatMap((other) =>
                        other.lines.map((line) => ({
                          ...line,
                          quantity:
                            line.quantity -
                            (other.deliveries ?? [])
                              .flatMap((d) => d.lines)
                              .filter(
                                (r) => r.productId === line.productId && !r.cancelledReceiptId,
                              )
                              .reduce((sum, r) => sum + r.quantity, 0),
                        })),
                      )
                      .filter((line) => line.productId === l.productId)
                      .reduce((sum, line) => sum + line.quantity, 0);
                    return (
                      '<li>' +
                      esc(l.name) +
                      ' · Stock: ' +
                      (row?.stock ?? 'sin datos') +
                      ' · Ventas registradas: ' +
                      (row?.unitsSold ?? 'sin datos') +
                      ' · Otras compras pendientes: ' +
                      pending +
                      ' unidades</li>'
                    );
                  })
                  .join('') +
                '</ul>' +
                ((data.actor.businessRole === 'owner' ||
                  (!data.actor.businessRole &&
                    !data.actor.ownerApprovalRequired &&
                    data.actor.role === 'reviewer')) &&
                (p.createdBy !== data.actor.id || data.actor.businessRole === 'owner') &&
                p.status === 'draft'
                  ? '<form data-review-purchase="' +
                    esc(p.id) +
                    '"><label class="field">Motivo o alternativa propuesta<textarea name="reason" required minlength="5" maxlength="300" placeholder="Propongo otra cantidad, producto o proveedor porque…"></textarea></label><button name="action" value="request-changes">Pedir cambios</button><button name="action" value="reject">Rechazar</button></form>'
                  : '') +
                (p.receiptWarnings
                  ? '<p class="form-error">Hay ' +
                    p.receiptWarnings +
                    ' líneas de recepción anuladas. Revisa el almacén y prepara una compra corregida si corresponde.</p>'
                  : '') +
                '<p>Referencia interna: ' +
                esc(p.id) +
                '</p><ul>' +
                p.lines
                  .map(
                    (l) =>
                      '<li>' +
                      esc(l.sku + ' · ' + l.name) +
                      ' · ' +
                      l.quantity +
                      ' × ' +
                      money(l.costCents) +
                      '</li>',
                  )
                  .join('') +
                '</ul>' +
                (p.reference ? '<p>Albarán: ' + esc(p.reference) + '</p>' : '') +
                (p.sentAt
                  ? '<p>Envío registrado: ' +
                    esc(new Date(p.sentAt).toLocaleString('es-ES')) +
                    ' · Entrega orientativa: ' +
                    esc(p.expectedDate) +
                    ' (sin fines de semana; festivos no incluidos en el cálculo)</p>' +
                    (['sent', 'partially_received'].includes(p.status) &&
                    p.expectedDate <
                      new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
                      ? '<p class="notice">Fecha estimada superada. Consulta al proveedor; no implica una entrega confirmada.</p>'
                      : '')
                  : '') +
                (p.deliveries
                  ? '<details><summary>Entregas registradas</summary>' +
                    p.deliveries
                      .map(
                        (d) =>
                          '<p>' +
                          esc(d.reference) +
                          ' · ' +
                          esc(new Date(d.at).toLocaleString('es-ES')) +
                          '</p><ul>' +
                          d.lines
                            .map(
                              (l) =>
                                '<li>' +
                                esc(
                                  data.products.find((p) => p.id === l.productId)?.name ??
                                    l.productId,
                                ) +
                                ' · ' +
                                l.quantity +
                                (l.cancelledReceiptId ? ' · Anulada' : '') +
                                ' recibidas</li>',
                            )
                            .join('') +
                          '</ul>',
                      )
                      .join('') +
                    '</details>'
                  : '') +
                (p.status === 'draft' &&
                (data.actor.businessRole === 'owner' ||
                  (!data.actor.businessRole &&
                    !data.actor.ownerApprovalRequired &&
                    data.actor.role === 'reviewer')) &&
                (p.createdBy !== data.actor.id || data.actor.businessRole === 'owner')
                  ? '<button data-approve="' + esc(p.id) + '">Aprobar compra revisada</button>'
                  : '') +
                (p.status === 'approved' && editor
                  ? '<p>Marca el envío solo después de tramitarlo por tu cuenta. La aplicación no contacta al proveedor.</p><button type="button" data-send-purchase="' +
                    esc(p.id) +
                    '">Marcar enviado al proveedor</button>'
                  : '') +
                (['sent', 'partially_received'].includes(p.status) &&
                (editor || (data.actor.permissions ?? []).includes('warehouse.receive'))
                  ? '<form data-receive-purchase="' +
                    esc(p.id) +
                    '">' +
                    field('Albarán recibido', 'reference', 'maxlength="100"') +
                    p.lines
                      .map((l) => {
                        const received = (p.deliveries ?? [])
                          .flatMap((d) => d.lines)
                          .filter(
                            (line) => line.productId === l.productId && !line.cancelledReceiptId,
                          )
                          .reduce((s, line) => s + line.quantity, 0);
                        const remaining = l.quantity - received;
                        return (
                          '<label class="field">' +
                          esc(l.name) +
                          ' · Pedidas ' +
                          l.quantity +
                          ' · Recibidas ' +
                          received +
                          ' · Pendientes ' +
                          remaining +
                          '<input data-receipt-product="' +
                          esc(l.productId) +
                          '" type="number" min="0" max="' +
                          remaining +
                          '" step="1" value="0" required></label>'
                        );
                      })
                      .join('') +
                    '<label><input type="checkbox" required> Confirmo que estas unidades han llegado y son aptas para reponer</label><button type="submit">Registrar unidades recibidas</button></form>'
                  : '') +
                (['draft', 'approved'].includes(p.status) && editor
                  ? '<button data-cancel-purchase="' +
                    esc(p.id) +
                    '">Cancelar compra pendiente</button>'
                  : ''),
            ),
          )
          .join('');
      const form = box.querySelector('#purchase-create');
      const candidateCard = (row) =>
        '<article class="order"><h3>' +
        esc(row.name) +
        '</h3><p>Stock: <strong>' +
        row.stock +
        '</strong> · Ventas registradas: ' +
        row.unitsSold +
        ' · En compras pendientes: ' +
        row.pending +
        ' · En propuestas por revisar: ' +
        row.draft +
        '</p><p>' +
        esc(
          row.signals
            .filter((s) => ['out-of-stock', 'reorder'].includes(s.code))
            .map((s) => s.message)
            .join(' ') || 'Sin señal de reposición en este periodo.',
        ) +
        '</p><p>Cantidad adicional orientativa: <strong>' +
        (row.additional === null ? 'Sin datos suficientes' : row.additional) +
        '</strong></p>' +
        (row.draft
          ? '<p>Ya existe una propuesta para este producto. Revísala antes de preparar otra.</p>'
          : '') +
        (editor && row.additional > 0 && !row.draft
          ? '<label class="field">Proveedor para valorar<select data-restock-supplier="' +
            esc(row.productId) +
            '">' +
            offers
              .filter(
                (o) =>
                  o.productId === row.productId &&
                  data.suppliers.some((s) => s.id === o.supplierId && s.active),
              )
              .sort((a, b) => a.costCents - b.costCents)
              .map(
                (o) =>
                  '<option value="' +
                  esc(o.supplierId) +
                  '">' +
                  esc(data.suppliers.find((s) => s.id === o.supplierId).name) +
                  ' · ' +
                  money(o.costCents) +
                  '/unidad · Lote ' +
                  o.packUnits +
                  ' · ' +
                  o.leadDays +
                  ' días</option>',
              )
              .join('') +
            '</select></label><button type="button" data-restock="' +
            esc(row.productId) +
            '">Preparar propuesta</button>'
          : '') +
        '</article>';
      box.insertAdjacentHTML(
        'afterbegin',
        '<section class="panel panel-body"><h2>¿Qué conviene reponer?</h2><p>Orientación por reglas verificables, no una compra automática. Periodo: ' +
          esc(stock.from) +
          ' a ' +
          esc(stock.to) +
          '. Se restan las compras aprobadas aún pendientes de recibir. Los plazos y mínimos deben revisarse.</p>' +
          (restock.some((row) => row.attention)
            ? restock
                .filter((row) => row.attention)
                .map(candidateCard)
                .join('')
            : '<p>No se detectan productos sin stock o con señal de reposición en el periodo.</p>') +
          details(
            'Revisar el resto del catálogo',
            restock
              .filter((row) => !row.attention)
              .map(candidateCard)
              .join(''),
          ) +
          '</section>',
      );
      const groups = [...new Set(op.purchases.map((p) => p.replenishmentId).filter(Boolean))];
      if (groups.length)
        box.insertAdjacentHTML(
          'afterbegin',
          '<section><h2>Reposiciones conjuntas</h2>' +
            groups
              .map((id) => {
                const purchases = op.purchases.filter((p) => p.replenishmentId === id);
                return details(
                  purchases[0].reason +
                    ' · ' +
                    purchases.length +
                    ' proveedores · ' +
                    money(purchases.reduce((sum, p) => sum + p.totalCents, 0)) +
                    ' netos',
                  '<p>Preparada el ' +
                    esc(new Date(purchases[0].createdAt).toLocaleString('es-ES')) +
                    '</p><ul>' +
                    purchases
                      .map(
                        (p) =>
                          '<li>' +
                          esc(p.supplierName) +
                          ' · ' +
                          esc(statuses[p.status]) +
                          ' · ' +
                          money(p.totalCents) +
                          '</li>',
                      )
                      .join('') +
                    '</ul><p>Cada compra se gestiona individualmente en la lista inferior.</p>',
                );
              })
              .join('') +
            '</section>',
        );
      mountReplenishment(box, data, offers, { api, esc, money, toast, reload });
      if (form) {
        let purchaseRequestId = crypto.randomUUID();
        form.oninput = () => {
          purchaseRequestId = crypto.randomUUID();
        };
        const update = () => {
          let total = 0;
          form.querySelectorAll('[data-purchase-line]').forEach((row) => {
            const p = data.products.find((p) => p.id === row.querySelector('select').value),
              q = Number(row.querySelector('input').value);
            const offer = offers.find(
              (o) => o.supplierId === form.elements.supplierId.value && o.productId === p?.id,
            );
            total += (offer?.costCents ?? 0) * q;
            const r = stock.rows.find((r) => r.productId === p?.id);
            row.querySelector('small').textContent = r
              ? 'Stock ' +
                r.stock +
                ' · ' +
                r.unitsSold +
                ' ventas registradas · ' +
                (r.suggestedOrderUnits === null
                  ? 'Sin cantidad recomendada'
                  : 'Cantidad a valorar ' + r.suggestedOrderUnits)
              : '';
            row.querySelector('small').textContent += offer
              ? ' · Coste/unidad: ' +
                money(offer.costCents) +
                ' · Lote: ' +
                offer.packUnits +
                ' unidades · Plazo orientativo: ' +
                offer.leadDays +
                ' días laborables'
              : ' · Selecciona un proveedor y artículo disponible.';
          });
          form.querySelector('#purchase-total').textContent =
            'Total orientativo neto: ' + money(total);
        };
        const add = (id, quantity = 1) => {
          if (form.querySelectorAll('[data-purchase-line]').length >= 30) return;
          const row = document.createElement('div');
          row.className = 'purchase-line';
          row.dataset.purchaseLine = '';
          row.innerHTML =
            '<label class="field">Artículo<select name="product">' +
            options(
              data.products.filter((p) =>
                offers.some(
                  (o) => o.supplierId === form.elements.supplierId.value && o.productId === p.id,
                ),
              ),
              (p) => p.sku + ' · ' + p.name,
            ) +
            '</select></label><label class="field">Unidades<input type="number" min="1" max="10000" value="' +
            quantity +
            '" required></label><button type="button" aria-label="Quitar artículo">Quitar</button><small class="span-full"></small>';
          form.querySelector('#purchase-lines').append(row);
          if (id) row.querySelector('select').value = id;
          row.querySelector('select').required = true;
          const applyPack = () => {
            const offer = offers.find(
              (o) =>
                o.supplierId === form.elements.supplierId.value &&
                o.productId === row.querySelector('select').value,
            );
            const input = row.querySelector('input');
            input.step = String(offer?.packUnits ?? 1);
            input.min = input.step;
            input.value = String(
              Math.max(
                offer?.packUnits ?? 1,
                Math.ceil(Number(input.value) / (offer?.packUnits ?? 1)) * (offer?.packUnits ?? 1),
              ),
            );
          };
          applyPack();
          row.querySelector('select').addEventListener('change', () => {
            applyPack();
            update();
          });
          row.querySelector('button').onclick = () => {
            row.remove();
            purchaseRequestId = crypto.randomUUID();
            update();
          };
          row.oninput = update;
          update();
        };
        const suggested = restock
          .filter((r) => r.additional > 0 && !r.draft)
          .map((r) => ({ ...r, suggestedOrderUnits: r.additional }))
          .slice(0, 10);
        box.querySelectorAll('[data-restock]').forEach((button) =>
          button.addEventListener('click', () => {
            const productId = button.dataset.restock,
              row = restock.find((r) => r.productId === productId);
            const selected = box.querySelector('[data-restock-supplier="' + productId + '"]');
            const offer = offers.find(
              (o) => o.supplierId === selected.value && o.productId === productId,
            );
            if (!offer) {
              toast('Selecciona un proveedor con oferta disponible.', true);
              return;
            }
            if (
              form.elements.reason.value ||
              form.querySelector('[data-purchase-line] input')?.value > 1
            ) {
              toast(
                'Hay una compra en preparación. Guárdala o limpia sus líneas antes de trasladar otra sugerencia.',
                true,
              );
              return;
            }
            delete form.dataset.replaces;
            form.elements.supplierId.value = offer.supplierId;
            form.elements.reason.value =
              'Reposición de ' + row.name + '; stock ' + row.stock + ', pendiente ' + row.pending;
            form.querySelector('#purchase-lines').innerHTML = '';
            add(productId, Math.ceil(row.additional / offer.packUnits) * offer.packUnits);
            purchaseRequestId = crypto.randomUUID();
            form.closest('details').open = true;
            form.scrollIntoView({ block: 'start' });
          }),
        );
        box.querySelectorAll('[data-alternative]').forEach((button) =>
          button.addEventListener('click', () => {
            const original = op.purchases.find((p) => p.id === button.dataset.alternative);
            form.dataset.replaces = original.id;
            form.elements.supplierId.value = original.supplierId;
            form.elements.reason.value = 'Alternativa: ' + original.reason;
            form.querySelector('#purchase-lines').innerHTML = '';
            original.lines.forEach((line) => add(line.productId, line.quantity));
            purchaseRequestId = crypto.randomUUID();
            form.closest('details').open = true;
            form.scrollIntoView({ block: 'start' });
          }),
        );
        add();
        form.elements.supplierId.addEventListener('change', () => {
          form.querySelector('#purchase-lines').innerHTML = '';
          purchaseRequestId = crypto.randomUUID();
          const applicable = suggested.filter((r) =>
            offers.some(
              (o) => o.supplierId === form.elements.supplierId.value && o.productId === r.productId,
            ),
          );
          if (applicable.length) applicable.forEach((r) => add(r.productId, r.suggestedOrderUnits));
          else add();
        });
        form.querySelector('#purchase-add').onclick = () => {
          purchaseRequestId = crypto.randomUUID();
          add();
        };
        bind(form, async (f) => {
          await api('/api/purchases', {
            requestId: purchaseRequestId,
            ...(form.dataset.replaces ? { replacesId: form.dataset.replaces } : {}),
            supplierId: f.get('supplierId'),
            reason: f.get('reason'),
            lines: [...form.querySelectorAll('[data-purchase-line]')].map((r) => ({
              productId: r.querySelector('select').value,
              quantity: Number(r.querySelector('input').value),
            })),
          });
          toast('Compra preparada para revisión.');
          await reload();
        });
      }
      const transition = async (id, action, reference) => {
        const p = op.purchases.find((p) => p.id === id);
        await api('/api/purchases/' + id, {
          expectedVersion: p.version,
          action,
          ...(action === 'receive' ? { confirmReceived: true } : {}),
          ...(reference ? { reference } : {}),
        });
        toast('Compra actualizada.');
        await reload();
      };
      box.querySelectorAll('[data-review-purchase]').forEach((form) =>
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const controls = [...form.elements];
          controls.forEach((c) => (c.disabled = true));
          const p = op.purchases.find((p) => p.id === form.dataset.reviewPurchase);
          try {
            await api('/api/purchases/' + p.id, {
              action: event.submitter.value,
              expectedVersion: p.version,
              reason: form.elements.reason.value,
            });
            await reload();
            toast('Revisión guardada.');
          } catch (error) {
            toast(error.message, true);
          } finally {
            if (form.isConnected) controls.forEach((c) => (c.disabled = false));
          }
        }),
      );
      box.querySelectorAll('[data-approve],[data-cancel-purchase],[data-send-purchase]').forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            try {
              await transition(
                b.dataset.approve ?? b.dataset.cancelPurchase ?? b.dataset.sendPurchase,
                b.dataset.approve ? 'approve' : b.dataset.sendPurchase ? 'send' : 'cancel',
              );
            } catch (e) {
              toast(e.message, true);
              if (b.isConnected) b.disabled = false;
            }
          }),
      );
      box.querySelectorAll('[data-receive-purchase]').forEach((f) => {
        let requestId = crypto.randomUUID();
        f.addEventListener('input', () => {
          requestId = crypto.randomUUID();
        });
        bind(f, async (values) => {
          const p = op.purchases.find((p) => p.id === f.dataset.receivePurchase);
          const lines = [...f.querySelectorAll('[data-receipt-product]')]
            .map((input) => ({
              productId: input.dataset.receiptProduct,
              quantity: Number(input.value),
            }))
            .filter((line) => line.quantity > 0);
          if (!lines.length) throw Error('Indica al menos una unidad recibida.');
          await api('/api/purchases/' + p.id, {
            action: 'receive-partial',
            expectedVersion: p.version,
            requestId,
            reference: values.get('reference'),
            confirmReceived: true,
            lines,
          });
          requestId = crypto.randomUUID();
          toast('Unidades recibidas y stock actualizado.');
          await reload();
        });
      });
    }
    if (area === 'returns') {
      const eligible = data.sales.filter((s) => s.status === 'shipped');
      box.innerHTML =
        '<p>Consulta qué unidades volvieron a la tienda y en qué estado. Almacén repone las aptas y registra las dañadas por separado. El reembolso se gestiona en Cobros y pagos.</p>' +
        (editor && data.actor.businessRole !== 'office' && eligible.length
          ? details(
              'Registrar mercancía devuelta',
              '<form id="partial-return"><label class="field">Pedido<select name="orderId">' +
                options(eligible, (s) => orderLabel(s.id)) +
                '</select></label><div id="return-lines"></div>' +
                '<label class="field">Estado físico<select name="condition" required><option value="">Seleccionar estado</option><option value="sellable">Aptas para vender · reponer</option><option value="damaged">Dañadas · separar del stock vendible</option></select></label>' +
                reason +
                '<label><input name="received" type="checkbox" required> He recibido y comprobado las unidades</label><button type="submit" class="primary">Registrar devolución</button></form>',
            )
          : editor
            ? data.actor.businessRole === 'office'
              ? '<p>Almacén registra la recepción. Aquí puedes consultar su historial.</p>'
              : '<p>No hay pedidos enviados con artículos disponibles para devolver.</p>'
            : '<p>Consulta del historial. Una cuenta editora registra las devoluciones.</p>') +
        (!op.returns.length
          ? '<p>No hay devoluciones registradas en esta base. No es un error: aparecerán cuando se registre la recepción de artículos devueltos.</p>'
          : '') +
        op.returns
          .map((r) =>
            details(
              new Date(r.createdAt).toLocaleDateString('es-ES') +
                ' · ' +
                orderLabel(r.orderId) +
                ' · ' +
                money(r.grossCents),
              '<p>' +
                esc(data.products.find((p) => p.id === r.productId)?.name ?? r.productId) +
                ' · ' +
                r.quantity +
                ' unidades · ' +
                (r.condition === 'damaged'
                  ? r.disposal
                    ? 'Dañadas · baja física registrada'
                    : 'Dañadas · en cuarentena'
                  : 'Aptas · repuestas') +
                ' · ' +
                esc(r.reason) +
                '</p><p>Registrada por ' +
                esc(data.identityNames[r.createdBy] ?? r.createdBy) +
                ' · ' +
                esc(new Date(r.createdAt).toLocaleString('es-ES')) +
                '</p>' +
                (r.disposal
                  ? '<p>Baja física confirmada por ' +
                    esc(data.identityNames[r.disposal.by] ?? r.disposal.by) +
                    ' · ' +
                    esc(new Date(r.disposal.at).toLocaleString('es-ES')) +
                    ' · ' +
                    esc(r.disposal.reason) +
                    (r.disposal.reference ? ' · ' + esc(r.disposal.reference) : '') +
                    '</p>'
                  : '') +
                '<p>Importe de los artículos devueltos. Comprueba el reembolso por separado en Cobros y pagos.</p>',
            ),
          )
          .join('');
      const form = box.querySelector('#partial-return');
      if (form) {
        let requestId = crypto.randomUUID();
        const render = () => {
          const sale = eligible.find((s) => s.id === form.elements.orderId.value);
          form.querySelector('#return-lines').innerHTML =
            '<label class="field">Artículo<select name="productId">' +
            options(
              sale.lines.filter(
                (l) =>
                  l.quantity >
                  (sale.returnedQuantities?.find((r) => r.productId === l.productId)?.quantity ??
                    0),
              ),
              (l) =>
                l.name +
                ' · quedan ' +
                (l.quantity -
                  (sale.returnedQuantities?.find((r) => r.productId === l.productId)?.quantity ??
                    0)),
              'productId',
            ) +
            '</select></label>' +
            field('Unidades recibidas', 'quantity', 'type="number" min="1" max="100" value="1"');
        };
        form.elements.orderId.onchange = render;
        render();
        bind(form, async (f) => {
          const sale = eligible.find((s) => s.id === f.get('orderId'));
          await api('/api/partial-returns', {
            requestId,
            orderId: f.get('orderId'),
            productId: f.get('productId'),
            quantity: Number(f.get('quantity')),
            condition: f.get('condition'),
            expectedReturned:
              sale.returnedQuantities?.find((r) => r.productId === f.get('productId'))?.quantity ??
              0,
            reason: f.get('reason'),
            confirmReceived: f.get('received') === 'on',
          });
          toast(
            'Devolución registrada. Revisa si corresponde reembolso y rectificación del documento.',
          );
          await reload();
        });
        form.oninput = () => {
          requestId = crypto.randomUUID();
        };
      }
    }
    if (area === 'followup') {
      box.innerHTML =
        '<p>Sirve para revisar si cambian las ventas y el margen después de publicar nuevos precios de venta. Las tarifas de compra del proveedor no aparecen aquí: tienen su evolución propia en Tarifas. Compara los mismos artículos durante los 14 días anteriores y posteriores a cada publicación. Si el periodo posterior está incompleto, aún no hay una comparación equivalente. Las devoluciones se atribuyen al pedido original. Los cambios observados no demuestran causalidad.</p>' +
        op.followUp
          .map((r) =>
            details(
              r.category + ' · ' + new Date(r.appliedAt).toLocaleDateString('es-ES'),
              '<p>' +
                (r.complete
                  ? 'Ventanas de 14 días completas.'
                  : 'Periodo posterior incompleto: ' +
                    (r.observedDays < 1 ? 'menos de un día' : r.observedDays.toFixed(1) + ' días') +
                    ' de 14.') +
                '</p><div class="table-wrap"><table><thead><tr><th>Periodo</th><th>Unidades netas</th><th>Ventas netas</th><th>Margen bruto</th></tr></thead><tbody>' +
                [
                  ['Antes', r.before],
                  ['Después', r.after],
                ]
                  .map(
                    ([name, v]) =>
                      '<tr><td>' +
                      name +
                      '</td><td>' +
                      v.units +
                      '</td><td>' +
                      money(v.revenueCents) +
                      '</td><td>' +
                      money(v.marginCents) +
                      '</td></tr>',
                  )
                  .join('') +
                '</tbody></table></div><p>Pedidos históricos sin desglose excluidos: ' +
                (r.before.excludedHistoricalOrders + r.after.excludedHistoricalOrders) +
                '.</p><p>' +
                r.overlappingChanges +
                ' cambios cercanos sobre los mismos artículos. No controla estacionalidad, campañas ni roturas históricas de stock.</p><button data-followup-ai="' +
                esc(r.id) +
                '">Explicar estos resultados</button><p class="ai-draft" aria-live="polite"></p>',
            ),
          )
          .join('');
      box.querySelectorAll('[data-followup-ai]').forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            try {
              const r = await api('/api/follow-up/brief', { id: b.dataset.followupAi });
              if (b.isConnected)
                b.nextElementSibling.textContent =
                  (r.modelUsed ? 'Borrador IA · revisar: ' : 'Lectura de datos: ') + r.text;
            } catch (e) {
              toast(e.message, true);
            } finally {
              if (b.isConnected) b.disabled = false;
            }
          }),
      );
      if (!op.followUp.length)
        box.innerHTML += '<p>Publica y registra ventas para empezar a medir resultados.</p>';
    }
    if (area === 'incidents') {
      const kinds = {
        damage: 'Producto dañado',
        'wrong-item': 'Artículo incorrecto',
        delivery: 'Problema de entrega',
        other: 'Otro',
      };
      box.innerHTML =
        '<p>Para pedidos de clientes: artículo equivocado, paquete dañado o retraso. Registra lo ocurrido y cómo se resolvió. La IA puede ayudarte a redactar la respuesta, que debes revisar; no la envía. Los daños en compras a proveedores están en Roturas en transporte.</p>' +
        (!op.incidents.length
          ? '<p>No hay reclamaciones de clientes registradas en esta base.</p>'
          : '') +
        (editor && data.sales.length
          ? details(
              'Abrir incidencia',
              '<form id="incident-create"><label class="field">Pedido<select name="orderId">' +
                options(data.sales, (s) => orderLabel(s.id)) +
                '</select></label><label class="field">Tipo<select name="kind">' +
                Object.entries(kinds)
                  .map(([k, v]) => '<option value="' + k + '">' + v + '</option>')
                  .join('') +
                '</select></label><label class="field">Descripción<textarea name="description" required minlength="10" maxlength="1000"></textarea></label><button type="submit">Guardar incidencia</button></form>',
            )
          : '') +
        op.incidents
          .map((i) =>
            details(
              (kinds[i.kind] ?? i.kind) +
                ' · ' +
                statuses[i.status] +
                ' · ' +
                orderLabel(i.orderId),
              '<p>' +
                esc(i.description) +
                '</p><p>' +
                esc(i.resolution) +
                '</p>' +
                (editor && i.status !== 'resolved'
                  ? '<form data-incident-update="' +
                    esc(i.id) +
                    '"><label class="field">Estado<select name="status"><option value="investigating">En estudio</option><option value="resolved">Resuelta</option></select></label><label class="field">Actuación o resolución<textarea name="resolution" required minlength="5" maxlength="1000"></textarea></label><button type="submit">Guardar seguimiento</button></form>'
                  : '') +
                (editor
                  ? '<button data-incident-ai="' +
                    esc(i.id) +
                    '">Preparar borrador de respuesta IA</button><p class="ai-draft" data-draft="' +
                    esc(i.id) +
                    '" aria-live="polite"></p>'
                  : ''),
            ),
          )
          .join('');
      bind(box.querySelector('#incident-create'), async (f) => {
        await api('/api/incidents', Object.fromEntries(f));
        await reload();
        toast('Incidencia creada.');
      });
      box.querySelectorAll('[data-incident-update]').forEach((form) =>
        bind(form, async (f) => {
          const i = op.incidents.find((i) => i.id === form.dataset.incidentUpdate);
          await api('/api/incidents/' + i.id, {
            ...Object.fromEntries(f),
            expectedVersion: i.version,
          });
          await reload();
          toast('Seguimiento guardado.');
        }),
      );
      box.querySelectorAll('[data-incident-ai]').forEach(
        (b) =>
          (b.onclick = async () => {
            b.disabled = true;
            try {
              const r = await api('/api/incidents/draft', { id: b.dataset.incidentAi });
              if (b.isConnected)
                b.nextElementSibling.textContent =
                  'Clasificación sugerida: ' +
                  (kinds[r.kind] ?? r.kind) +
                  '. Borrador IA · revisa antes de usar: ' +
                  r.text;
            } catch (e) {
              toast(e.message, true);
            } finally {
              if (b.isConnected) b.disabled = false;
            }
          }),
      );
    }
    if (area === 'imports') {
      box.innerHTML =
        '<p>PDF con texto (2 MB, hasta 10 páginas), TXT o CSV. Revisa las filas antes de incorporarlas. Un PDF escaneado necesita OCR; esta versión no lo hace. Los archivos y el modelo se procesan en este equipo.</p>' +
        (editor
          ? details(
              'Leer un documento',
              '<form id="import-extract"><label class="field">Archivo opcional<input name="file" type="file" accept=".pdf,.txt,.csv"></label><label class="field">O pega el texto<textarea name="source" maxlength="12000" placeholder="SKU;cantidad;coste unitario neto"></textarea></label><label><input name="useAI" type="checkbox" checked> Proponer filas con IA local</label><p>Desmarca para extraer el texto y completar las filas manualmente.</p><button type="submit">Extraer para revisión</button></form>',
            )
          : '') +
        '<div id="import-preview"></div>' +
        op.imports
          .map((i) =>
            details(
              new Date(i.createdAt).toLocaleString('es-ES') +
                ' · ' +
                (i.status === 'processed' ? 'Procesado' : 'Pendiente de revisión'),
              '<p>' +
                i.rows.length +
                ' filas · ' +
                (i.modelUsed ? 'Extracción IA revisable' : 'Extracción de texto manual') +
                '</p><button data-import-open="' +
                esc(i.id) +
                '">Ver documento y filas</button>',
            ),
          )
          .join('');
      const show = async (id) => {
        const i = await api('/api/document-imports/' + id);
        if (!box.isConnected) return;
        const preview = box.querySelector('#import-preview');
        preview.innerHTML =
          '<section class="order"><h2>Revisar documento</h2><details><summary>Ver texto original</summary><pre class="document-source">' +
          esc(i.source) +
          '</pre></details>' +
          i.rows
            .map((r) => '<p><strong>' + esc(r.sku) + '</strong> · ' + esc(r.evidence) + '</p>')
            .join('') +
          (editor && i.status === 'review'
            ? '<form id="import-process">' +
              supplier +
              field('Referencia del proveedor', 'reference', 'maxlength="100"') +
              '<input type="hidden" name="kind" value="receipt"><p>Este documento registra unidades recibidas. Los PDF de precios se consultan y revisan en Tarifas de proveedores.</p><label class="field">Filas revisadas: SKU;cantidad;coste neto en euros<textarea name="rows" rows="7" required>' +
              esc(
                i.rows
                  .map(
                    (r) =>
                      r.sku +
                      ';' +
                      (r.quantity ?? '') +
                      ';' +
                      (r.costCents === null ? '' : (r.costCents / 100).toFixed(2)),
                  )
                  .join('\n'),
              ) +
              '</textarea></label><label><input name="confirmed" type="checkbox" required> He comprobado cada fila, proveedor e importes. Si es un albarán, he recibido la mercancía apta para reponer.</label><button type="submit" class="primary">Incorporar filas revisadas</button></form>'
            : '<p>Procesado. Consulta Tarifas o Almacén para sus efectos.</p>') +
          '</section>';
        preview.scrollIntoView({ block: 'start', behavior: 'smooth' });
        bind(preview.querySelector('#import-process'), async (f) => {
          const rows = String(f.get('rows'))
            .trim()
            .split(/\r?\n/)
            .map((line) => {
              const parts = line.split(';');
              if (parts.length !== 3) throw new Error('Cada fila necesita SKU;cantidad;coste.');
              return {
                sku: parts[0].trim(),
                quantity: parts[1].trim() ? Number(parts[1]) : null,
                costCents: parts[2].trim()
                  ? Math.round(Number(parts[2].replace(',', '.')) * 100)
                  : null,
              };
            });
          await api('/api/document-imports/' + i.id + '/process', {
            expectedVersion: i.version,
            confirmReviewed: f.get('confirmed') === 'on',
            kind: f.get('kind'),
            supplierId: f.get('supplierId'),
            reference: f.get('reference'),
            rows,
          });
          await reload();
          toast('Documento incorporado. Las tarifas requieren otra revisión para aplicar costes.');
        });
      };
      bind(box.querySelector('#import-extract'), async (f) => {
        let source = String(f.get('source')),
          format = 'text';
        const file = f.get('file');
        if (file?.size) {
          if (file.size > 2000000) throw new Error('El archivo supera 2 MB.');
          if (file.name.toLowerCase().endsWith('.pdf')) {
            format = 'pdf';
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = '';
            for (const byte of bytes) binary += String.fromCharCode(byte);
            source = btoa(binary);
          } else source = await file.text();
        }
        const i = await api('/api/document-imports/extract', {
          format,
          source,
          useAI: f.get('useAI') === 'on',
        });
        toast('Texto extraído. Revisa antes de guardar operaciones.');
        await show(i.id);
      });
      box
        .querySelectorAll('[data-import-open]')
        .forEach(
          (b) =>
            (b.onclick = () => show(b.dataset.importOpen).catch((e) => toast(e.message, true))),
        );
    }
  } catch (error) {
    if (box.isConnected) box.textContent = error.message;
  }
}
