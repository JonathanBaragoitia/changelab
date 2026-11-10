export async function mountTransport(data, { api, esc, toast, reload }) {
  const screen = document.querySelector('#screen');
  screen.innerHTML =
    '<section class="heading"><div><h1>Roturas en transporte</h1><p>Registra daños y sigue las reclamaciones hasta documentar un abono o vincular la reposición recibida.</p></div></section><section id="transport-content" class="panel panel-body">Cargando…</section>';
  const box = screen.querySelector('#transport-content');
  try {
    const report = await api('/api/transport-damages');
    if (!box.isConnected) return;
    const eligible = report.purchases.filter((p) =>
      ['sent', 'partially_received', 'received'].includes(p.status),
    );
    const editor = data.actor.role === 'editor';
    const canCredit =
      data.actor.businessRole === 'owner' ||
      (editor && !data.actor.businessRole && !data.actor.ownerApprovalRequired);
    const canReport =
      (editor && data.actor.businessRole !== 'office') ||
      (data.actor.permissions ?? []).includes('warehouse.damage');
    const purchaseLabel = (p) => p.supplierName + ' · ' + (p.reference ?? p.id.slice(0, 8));
    box.innerHTML =
      (canReport && eligible.length
        ? '<details class="commercial-disclosure"><summary>Registrar rotura</summary><div class="disclosure-body"><form id="damage-form"><label class="field">Compra<select name="purchaseId">' +
          eligible
            .map((p) => '<option value="' + esc(p.id) + '">' + esc(purchaseLabel(p)) + '</option>')
            .join('') +
          '</select></label><label class="field">Producto<select name="productId"></select></label><label class="field">Unidades dañadas<input name="quantity" type="number" min="1" max="10000" step="1" required></label><label class="field">Referencia del albarán o reclamación<input name="reference" maxlength="100" required></label><label class="field">Situación<select name="stage"><option value="outside">No incorporadas al stock · solo reclamación</option><option value="inside">Ya incorporadas al stock · dar de baja</option></select></label><p id="damage-stock"></p><label class="field">Descripción del daño<textarea name="reason" minlength="5" maxlength="300" required></textarea></label><label><input name="confirm" type="checkbox" required> He comprobado las cantidades y si ya están incluidas en el stock.</label><p>La reclamación no modifica las cantidades pendientes de recibir. Una sustitución se registra al llegar; un abono se gestiona por separado.</p><button class="primary">Registrar incidencia</button></form></div></details>'
        : canReport
          ? '<p>No hay compras enviadas o recibidas para registrar daños.</p>'
          : '') +
      '<h2>Historial de roturas y reclamaciones</h2>' +
      (report.damages.length
        ? report.damages
            .map((d) => {
              const p = report.purchases.find((p) => p.id === d.purchaseId);
              const receipts = d.replacementCandidates ?? [];
              const outcome =
                d.outcome?.kind === 'credit'
                  ? d.outcome.amountCents === undefined
                    ? ''
                    : '<p>Abono neto: ' +
                      esc(
                        new Intl.NumberFormat('es-ES', {
                          style: 'currency',
                          currency: 'EUR',
                        }).format(d.outcome.amountCents / 100),
                      ) +
                      ' · ' +
                      esc(d.outcome.reference) +
                      '</p>'
                  : d.outcome?.kind === 'replacement'
                    ? '<p>Reposición recibida · ' + esc(d.outcome.reference) + '</p>'
                    : '';
              return (
                '<details class="commercial-disclosure"><summary>' +
                esc(data.products.find((p) => p.id === d.productId)?.name ?? d.productId) +
                ' · ' +
                d.quantity +
                ' uds. · ' +
                (d.status === 'open' ? 'Reclamación abierta' : 'Resuelta') +
                '<small class="receipt-date">' +
                esc(new Date(d.createdAt).toLocaleDateString('es-ES')) +
                '</small>' +
                '</summary><div class="disclosure-body"><p>' +
                esc(p ? purchaseLabel(p) : d.purchaseId) +
                ' · ' +
                esc(d.reference) +
                '</p><p>' +
                esc(d.reason) +
                '</p><p>' +
                esc(new Date(d.createdAt).toLocaleString('es-ES')) +
                ' · ' +
                esc(data.identityNames?.[d.createdBy] ?? d.createdBy) +
                '</p><p>' +
                (d.inStock
                  ? 'Baja registrada: −' + d.quantity + ' unidades.'
                  : 'Sin descuento de stock: mercancía no incorporada.') +
                '</p>' +
                (d.status === 'resolved'
                  ? '<p><strong>Resolución:</strong> ' +
                    esc(d.resolution) +
                    '</p><p>Cerrada el ' +
                    esc(new Date(d.resolvedAt).toLocaleString('es-ES')) +
                    ' · ' +
                    esc(data.identityNames?.[d.resolvedBy] ?? d.resolvedBy) +
                    '</p>' +
                    outcome
                  : editor
                    ? '<form data-resolve="' +
                      esc(d.id) +
                      '"><label class="field">Resultado<select name="kind"><option value="note">Cierre sin compensación registrada</option>' +
                      (canCredit ? '<option value="credit">Abono documentado</option>' : '') +
                      (receipts.length
                        ? '<option value="replacement">Reposición recibida</option>'
                        : '') +
                      '</select></label>' +
                      (canCredit
                        ? '<fieldset hidden disabled data-outcome="credit"><legend>Abono del proveedor</legend><label class="field">Referencia del abono<input name="creditReference" maxlength="100" required></label><label class="field">Importe neto en euros<input name="amount" type="number" min="0.01" step="0.01" max="1000000" required></label><p>Se guarda como justificante. No se registra un pago.</p></fieldset>'
                        : '') +
                      (receipts.length
                        ? '<fieldset hidden disabled data-outcome="replacement"><legend>Entrada de almacén</legend><label class="field">Albarán<select name="receiptId" required><option value="">Selecciona una entrada</option>' +
                          receipts
                            .map(
                              (r) =>
                                '<option value="' +
                                esc(r.id) +
                                '">' +
                                esc(r.reference) +
                                ' · ' +
                                esc(new Date(r.at).toLocaleDateString('es-ES')) +
                                '</option>',
                            )
                            .join('') +
                          '</select></label><p>Se vincula una entrada existente. El stock ya se actualizó al recibirla.</p></fieldset>'
                        : '') +
                      '<label class="field">Nota de cierre<textarea name="resolution" minlength="5" maxlength="300" required></textarea></label><button>Cerrar reclamación</button></form>'
                    : '') +
                '</div></details>'
              );
            })
            .join('')
        : '<p>No se han registrado roturas de transporte en este apartado.</p>');
    const form = box.querySelector('#damage-form');
    if (form) {
      let requestId = crypto.randomUUID();
      const update = () => {
        const p = eligible.find((p) => p.id === form.elements.purchaseId.value);
        form.elements.productId.innerHTML = p.lines
          .map((l) => '<option value="' + esc(l.productId) + '">' + esc(l.name) + '</option>')
          .join('');
        stock();
      };
      const stock = () => {
        box.querySelector('#damage-stock').textContent =
          'Stock actual del producto: ' +
          (data.inventory.find((r) => r.productId === form.elements.productId.value)?.quantity ??
            0) +
          ' unidades.';
      };
      form.elements.purchaseId.addEventListener('change', update);
      form.elements.productId.addEventListener('change', stock);
      form.addEventListener('input', () => (requestId = crypto.randomUUID()));
      update();
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const b = form.querySelector('button');
        if (b.disabled) return;
        b.disabled = true;
        try {
          const f = form.elements;
          await api('/api/transport-damages', {
            requestId,
            purchaseId: f.purchaseId.value,
            productId: f.productId.value,
            quantity: Number(f.quantity.value),
            inStock: f.stage.value === 'inside',
            expectedQuantity:
              data.inventory.find((r) => r.productId === f.productId.value)?.quantity ?? 0,
            reference: f.reference.value,
            reason: f.reason.value,
          });
          await reload();
          toast('Rotura registrada y stock tratado según la situación indicada.');
        } catch (error) {
          toast(error.message, true);
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      });
    }
    box.querySelectorAll('[data-resolve]').forEach((form) => {
      form.elements.kind.addEventListener('change', () => {
        form.querySelectorAll('[data-outcome]').forEach((fieldset) => {
          fieldset.hidden = fieldset.dataset.outcome !== form.elements.kind.value;
          fieldset.disabled = fieldset.hidden;
        });
      });
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const b = form.querySelector('button');
        if (b.disabled) return;
        b.disabled = true;
        try {
          const kind = form.elements.kind.value;
          await api('/api/transport-damages/resolve', {
            id: form.dataset.resolve,
            resolution: form.elements.resolution.value,
            kind,
            ...(kind === 'credit'
              ? {
                  creditReference: form.elements.creditReference.value,
                  amountCents: Math.round(Number(form.elements.amount.value) * 100),
                }
              : {}),
            ...(kind === 'replacement' ? { receiptId: form.elements.receiptId.value } : {}),
          });
          await reload();
          toast('Reclamación cerrada.');
        } catch (error) {
          toast(error.message, true);
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      });
    });
  } catch (error) {
    if (box.isConnected) box.textContent = error.message;
  }
}
