export async function mountApprovals(data, { api, esc, money, toast }) {
  const root = document.querySelector('#screen');
  root.innerHTML =
    '<section class="heading"><h1>Solicitudes y aprobaciones</h1></section><section class="panel panel-body"><p>Ana prepara las solicitudes y Antonio decide si autoriza el gasto. Gastos personales: rechazados. Aprobar no registra un gasto ni paga una compra.</p><div id="approval-create"></div></section><section class="panel panel-body"><h2>Solicitudes recientes</h2><div id="approval-list">Cargando…</div></section><section class="panel panel-body"><h2>Tus notificaciones</h2><div id="approval-notices"></div></section>';
  const list = root.querySelector('#approval-list');
  let requestId = crypto.randomUUID();
  if (data.actor.role === 'editor')
    root.querySelector('#approval-create').innerHTML =
      '<form id="approval-form"><label class="field">Tipo<select name="kind"><option value="expense">Gasto operativo</option></select></label><label class="field">Categoría<select name="category"><option>Alquiler</option><option>Suministros</option><option>Servicios</option><option>Otros gastos operativos</option><option>Personal</option></select></label><label class="field">Descripción<input name="description" required minlength="5" maxlength="300"></label><label class="field">Importe sin IVA (€)<input name="amount" type="number" min="0.01" max="1000000" step="0.01" required></label><button class="primary">Presentar solicitud</button></form>';
  async function refresh() {
    const result = await api('/api/approvals');
    if (!list.isConnected) return;
    list.innerHTML =
      result.requests
        .map(
          (r) =>
            '<article class="order"><h3>' +
            esc(r.description) +
            '</h3><p>' +
            esc(r.category) +
            ' · ' +
            money(r.cents) +
            ' · ' +
            { pending: 'Pendiente', approved: 'Aprobada', rejected: 'Rechazada' }[r.status] +
            '</p><p>Solicitante: ' +
            esc(r.author) +
            ' · ' +
            esc(r.at) +
            '</p>' +
            (r.decision
              ? '<p>Decisión: ' +
                esc(r.decision.reason) +
                ' · ' +
                esc(r.decision.actor) +
                ' · ' +
                esc(r.decision.at) +
                '</p>'
              : '') +
            (r.status === 'pending' &&
            (data.actor.businessRole === 'owner' ||
              (!data.actor.businessRole &&
                !data.actor.ownerApprovalRequired &&
                data.actor.role === 'reviewer')) &&
            (r.author !== data.actor.id || data.actor.businessRole === 'owner')
              ? '<form data-decide="' +
                esc(r.id) +
                '"><label class="field">Motivo<input name="reason" required minlength="5" maxlength="300"></label><button name="status" value="approved">Aprobar</button><button name="status" value="rejected">Rechazar</button></form>'
              : '') +
            (r.expenseId
              ? '<p>Gasto registrado: ' + esc(r.expenseId) + '</p>'
              : r.status === 'approved' && r.kind === 'expense' && data.actor.role === 'editor'
                ? '<details><summary>Registrar gasto realizado</summary><form data-execute="' +
                  esc(r.id) +
                  '"><label class="field">Fecha<input name="date" type="date" required></label><label class="field">Referencia del justificante<input name="reference" required maxlength="100"></label><label class="field">IVA<select name="vatRate"><option value="21">21 %</option><option value="0">0 %</option></select></label><button>Registrar en control económico</button></form></details>'
                : r.kind === 'purchase'
                  ? r.purchaseId
                    ? '<p>Vinculada a la compra ' +
                      esc(r.purchaseId) +
                      '. No puede reutilizarse.</p>'
                    : '<p>Autorización histórica. Las nuevas reposiciones se preparan y revisan directamente en Compras.</p>'
                  : '') +
            '</article>',
        )
        .join('') || '<p>No hay solicitudes.</p>';
    root.querySelector('#approval-notices').innerHTML =
      (result.deliveryPending
        ? '<p>Hay avisos pendientes de entrega. Se reintentará al volver a consultar.</p>'
        : '') +
      (result.notifications
        .map((n) => '<p>' + esc(n.requestId) + ' · ' + esc(n.reason) + '</p>')
        .join('') || '<p>Sin notificaciones.</p>');
    list.querySelectorAll('form').forEach((form) =>
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const controls = [...form.elements];
        const payload = form.dataset.decide
          ? { status: event.submitter.value, reason: form.elements.reason.value }
          : {
              date: form.elements.date.value,
              reference: form.elements.reference.value,
              vatRate: Number(form.elements.vatRate.value),
            };
        controls.forEach((c) => (c.disabled = true));
        try {
          await api(
            '/api/approvals/' +
              encodeURIComponent(form.dataset.decide || form.dataset.execute) +
              (form.dataset.execute ? '/expense' : ''),
            payload,
          );
          await refresh();
          toast('Operación guardada.');
        } catch (error) {
          toast(error.message, true);
        } finally {
          if (form.isConnected) controls.forEach((c) => (c.disabled = false));
        }
      }),
    );
  }
  root.querySelector('#approval-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target,
      f = form.elements,
      button = form.querySelector('button');
    button.disabled = true;
    try {
      await api('/api/approvals', {
        id: requestId,
        kind: f.kind.value,
        category: f.category.value,
        description: f.description.value,
        cents: Math.round(Number(f.amount.value) * 100),
      });
      requestId = crypto.randomUUID();
      form.reset();
      await refresh();
      toast('Solicitud guardada.');
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  try {
    await refresh();
  } catch (error) {
    if (list.isConnected) list.textContent = error.message;
  }
}
