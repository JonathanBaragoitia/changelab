export function mountRefunds(box, report, { api, esc, money, toast, refresh, editor }) {
  const section = document.createElement('section');
  section.className = 'panel panel-body';
  const eligible = report.targets.filter(
    (t) => t.kind === 'collection' && (t.refundableCents ?? (!t.enabled ? t.settledCents : 0)) > 0,
  );
  section.innerHTML =
    '<h2>Reembolsos de demostración</h2><p>Anota una devolución de dinero de un pedido cancelado o con mercancía devuelta, incluidas devoluciones parciales. Conserva los cobros originales. No realiza transferencias ni rectifica documentos.</p><p>Total reembolsado: ' +
    money(report.refundedCents) +
    '</p>' +
    report.refunds
      .map(
        (r) =>
          '<p>' +
          esc(r.date) +
          ' · ' +
          esc(r.reference) +
          ' · Pedido ' +
          esc(r.orderId) +
          ' · ' +
          money(r.amountCents) +
          ' · ' +
          esc(r.reason) +
          (r.reversal
            ? ' · ANULADO: ' + esc(r.reversal.reason) + ' · ' + esc(r.reversal.at)
            : ' · Vigente') +
          '</p>' +
          (editor && !r.reversal
            ? '<form data-reverse-refund="' +
              esc(r.requestId) +
              '"><label>Motivo de corrección<input name="reason" minlength="5" maxlength="300" required></label><button>Anular reembolso erróneo</button></form>'
            : ''),
      )
      .join('') +
    (editor && eligible.length
      ? '<form id="refund-form"><label>Pedido<select name="orderId">' +
        eligible
          .map(
            (t) =>
              '<option value="' +
              esc(t.id) +
              '">' +
              esc(t.label) +
              ' · máximo ' +
              money(t.refundableCents ?? t.settledCents) +
              '</option>',
          )
          .join('') +
        '</select></label><label>Importe a reembolsar (€)<input name="amount" type="number" min="0.01" step="0.01" required></label><label>Fecha de reembolso<input name="date" type="date" required></label><label>Referencia del reembolso<input name="reference" required maxlength="100"></label><label>Motivo del reembolso<textarea name="reason" required minlength="5" maxlength="300"></textarea></label><button>Registrar reembolso de prueba</button></form>'
      : '<p>No hay pedidos disponibles para registrar un reembolso con esta cuenta.</p>');
  box.append(section);
  section.querySelectorAll('[data-reverse-refund]').forEach((form) =>
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const controls = [...form.elements];
      controls.forEach((c) => (c.disabled = true));
      try {
        await api('/api/refunds/' + encodeURIComponent(form.dataset.reverseRefund) + '/reverse', {
          reason: form.elements.reason.value,
        });
        await refresh();
        toast('Anotación de reembolso anulada. No mueve dinero.');
      } catch (error) {
        toast(error.message, true);
      } finally {
        if (form.isConnected) controls.forEach((c) => (c.disabled = false));
      }
    }),
  );
  const form = section.querySelector('#refund-form');
  if (!form) return;
  let requestId = crypto.randomUUID(),
    busy = false;
  form.elements.date.value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  form.addEventListener('input', () => {
    requestId = crypto.randomUUID();
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const f = form.elements;
    const payload = {
      requestId,
      orderId: f.orderId.value,
      amountCents: Math.round(Number(f.amount.value) * 100),
      date: f.date.value,
      reference: f.reference.value,
      reason: f.reason.value,
    };
    [...f].forEach((c) => (c.disabled = true));
    try {
      await api('/api/refunds', payload);
      await refresh();
      toast('Reembolso anotado. No se ha movido dinero real.');
    } catch (error) {
      toast(error.message, true);
    } finally {
      busy = false;
      if (form.isConnected) [...f].forEach((c) => (c.disabled = false));
    }
  });
}
