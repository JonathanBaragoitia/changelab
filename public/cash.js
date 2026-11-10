import { mountRefunds } from '/refunds.js';
export function mountCash(data, { api, esc, money, toast }) {
  const root = document.querySelector('#screen');
  root.innerHTML =
    '<section class="heading"><div><div class="eyebrow">TESORERÍA DE DEMOSTRACIÓN</div><h1>Cobros, pagos y pendientes.</h1><p>Anotaciones manuales, sin conexión bancaria ni movimiento de dinero. Saldo acumulado de anotaciones; no es saldo bancario ni beneficio.</p></div></section><div id="cash-data"></div>';
  let busy = false,
    requestId = crypto.randomUUID();
  async function refresh() {
    try {
      const report = await api('/api/cash');
      const box = root.querySelector('#cash-data');
      if (!box) return;
      const decisions =
        data.actor.businessRole === 'office' ? (await api('/api/approvals')).requests : [];
      const available = report.targets.filter(
        (t) =>
          t.enabled &&
          t.pendingCents > 0 &&
          (data.actor.businessRole !== 'office' ||
            t.kind !== 'payment' ||
            decisions.some(
              (r) => r.id === t.id && r.status === 'approved' && r.decision?.actor !== 'policy',
            )),
      );
      box.innerHTML =
        '<section class="panel panel-body"><p>Cobros anotados: ' +
        money(report.collectedCents) +
        ' · Pagos anotados: ' +
        money(report.paidCents) +
        ' · Reembolsos anotados: ' +
        money(report.refundedCents) +
        ' · Diferencia: ' +
        money(report.balanceCents) +
        '</p><h2>Pendientes acumulados</h2><div class="table-wrap"><table><thead><tr><th>Destino</th><th>Total</th><th>Neto anotado</th><th>Pendiente</th></tr></thead><tbody>' +
        report.targets
          .map(
            (t) =>
              '<tr><td>' +
              esc(t.label) +
              (t.pendingCents < 0 ? ' · Requiere revisión/devolución' : '') +
              '</td><td>' +
              money(t.totalCents) +
              '</td><td>' +
              money(t.settledCents) +
              '</td><td>' +
              money(t.pendingCents) +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div></section>' +
        (data.actor.role === 'editor' && available.length
          ? '<section class="panel panel-body"><h2>Registrar cobro o pago manual</h2><form id="cash-form"><label class="field">Destino<select name="target">' +
            available
              .map(
                (t, i) =>
                  '<option value="' +
                  i +
                  '">' +
                  (t.kind === 'collection' ? 'Cobrar · ' : 'Pagar · ') +
                  esc(t.label) +
                  ' · pendiente ' +
                  money(t.pendingCents) +
                  '</option>',
              )
              .join('') +
            '</select></label><label class="field">Importe (€)<input name="amount" type="number" min="0.01" max="1000000" step="0.01" required></label><label class="field">Fecha<input name="date" type="date" required></label><label class="field">Referencia única<input name="reference" maxlength="100" required></label><label class="field">Medio<select name="method"><option>Transferencia</option><option>Tarjeta</option><option>Efectivo</option><option>Otro</option></select></label><button class="primary">Guardar anotación</button></form></section>'
          : '') +
        '<section class="panel panel-body"><h2>Movimientos anotados</h2>' +
        report.entries
          .map(
            (e) =>
              '<p>' +
              esc(e.date) +
              ' · ' +
              (e.kind === 'collection' ? 'Cobro' : 'Pago') +
              ' · ' +
              money(e.amountCents) +
              ' · ' +
              esc(e.method) +
              ' · ' +
              esc(e.reference) +
              (e.reversal ? ' · ANULADA (excluida de totales)' : ' · Vigente') +
              '</p>',
          )
          .join('') +
        '</section>';

      mountRefunds(box, report, {
        api,
        esc,
        money,
        toast,
        refresh,
        editor: data.actor.role === 'editor' && data.actor.businessRole !== 'office',
      });
      const reversible = report.entries.filter(
        (entry) =>
          !entry.reversal &&
          !(
            entry.kind === 'collection' &&
            report.refunds.some((r) => !r.reversal && r.orderId === entry.targetId)
          ),
      );
      if (
        data.actor.role === 'editor' &&
        data.actor.businessRole !== 'office' &&
        reversible.length
      ) {
        box.insertAdjacentHTML(
          'beforeend',
          '<section class="panel panel-body"><h2>Corregir una anotación errónea</h2><p>Anula el registro y recalcula pendientes. No sirve para simular que se ha devuelto dinero: no realiza reembolsos. El original queda en el historial.</p><form id="reversal-form"><label class="field">Anotación a anular<select name="entryId">' +
            reversible
              .map(
                (entry) =>
                  '<option value="' +
                  esc(entry.requestId) +
                  '">' +
                  esc(entry.reference) +
                  ' · ' +
                  money(entry.amountCents) +
                  '</option>',
              )
              .join('') +
            '</select></label><label class="field">Motivo de anulación<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><button class="chip">Anular anotación errónea</button></form></section>',
        );
        const reversalForm = box.querySelector('#reversal-form');
        reversalForm.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (busy) return;
          busy = true;
          const f = reversalForm.elements,
            id = f.entryId.value,
            reason = f.reason.value;
          [...f].forEach((control) => (control.disabled = true));
          try {
            await api('/api/cash/' + encodeURIComponent(id) + '/reverse', { reason });
            await refresh();
            toast('Anotación anulada. Original conservado y pendientes recalculados.');
          } catch (error) {
            toast(error.message, true);
          } finally {
            busy = false;
            if (reversalForm.isConnected) [...f].forEach((control) => (control.disabled = false));
          }
        });
      }
      if (report.entries.some((entry) => entry.reversal))
        box.insertAdjacentHTML(
          'beforeend',
          '<section class="panel panel-body"><h2>Anotaciones anuladas</h2>' +
            report.entries
              .filter((entry) => entry.reversal)
              .map(
                (entry) =>
                  '<p>' +
                  esc(entry.reference) +
                  ' · ' +
                  money(entry.amountCents) +
                  ' · ANULADA · ' +
                  esc(entry.reversal.reason) +
                  ' · ' +
                  esc(entry.reversal.at) +
                  '</p>',
              )
              .join('') +
            '</section>',
        );

      const form = box.querySelector('#cash-form');
      if (form) {
        form.elements.date.value = new Date().toLocaleDateString('sv-SE', {
          timeZone: 'Europe/Madrid',
        });
        form.addEventListener('input', () => (requestId = crypto.randomUUID()));
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (busy) return;
          busy = true;
          const f = form.elements,
            target = available[Number(f.target.value)],
            payload = {
              requestId,
              kind: target.kind,
              targetId: target.id,
              amountCents: Math.round(Number(f.amount.value) * 100),
              date: f.date.value,
              reference: f.reference.value,
              method: f.method.value,
            };
          [...f].forEach((control) => (control.disabled = true));
          try {
            await api('/api/cash', payload);
            requestId = crypto.randomUUID();
            await refresh();
            toast('Anotación guardada. No se ha movido dinero real.');
          } catch (error) {
            toast(error.message, true);
          } finally {
            busy = false;
            if (form.isConnected) [...f].forEach((control) => (control.disabled = false));
          }
        });
      }
    } catch (error) {
      toast(error.message, true);
    }
  }
  refresh();
}
