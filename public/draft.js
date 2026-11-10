const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const money = (c) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(c / 100);
async function load() {
  const id = new URL(location.href).searchParams.get('id');
  if (!id || !/^[\w-]{1,80}$/.test(id)) throw new Error('Referencia de borrador no válida.');
  const response = await fetch('/api/billing/drafts/' + encodeURIComponent(id), {
    credentials: 'same-origin',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message);
  const d = result.invoice?.draft ?? result.draft;
  const party = (label, p) =>
    '<section><h2>' +
    label +
    '</h2><p>' +
    esc(p.name) +
    '<br>Identificador fiscal: ' +
    esc(p.taxId) +
    '<br>' +
    esc(p.address) +
    '</p></section>';
  document.querySelector('#document').innerHTML =
    '<h1>BORRADOR · SIN VALIDEZ FISCAL</h1><div class="draft-warning">No es una factura emitida. Documento de prueba, sin numeración fiscal ni remisión a Hacienda.' +
    (result.orderCancelled ? ' PEDIDO CANCELADO: no utilizar para facturar.' : '') +
    '</div><p>Referencia interna: ' +
    esc(d.id) +
    ' · Versión ' +
    esc(d.version ?? 1) +
    '<br>Pedido: ' +
    esc(d.orderId) +
    '<br>Preparado: ' +
    esc(new Date(d.createdAt).toLocaleString('es-ES')) +
    '</p><div class="draft-parties">' +
    party('Emisor (datos de prueba)', d.issuer) +
    party('Destinatario (datos de prueba)', d.recipient) +
    '</div><p>' +
    (d.pricing === 'demo-net-v1'
      ? 'Desglose guardado al comprar: precios sin IVA y 21 % añadido.'
      : 'Pedido histórico: hipótesis aceptada de IVA del 21 % incluido.') +
    '</p><div class="table-wrap"><table><thead><tr><th>Concepto</th><th>Ud.</th><th>Precio del pedido</th><th>Base</th><th>IVA 21 %</th><th>Total</th></tr></thead><tbody>' +
    d.lines
      .map(
        (l) =>
          '<tr><td>' +
          esc(l.name) +
          '</td><td>' +
          l.quantity +
          '</td><td>' +
          money(l.unitPriceCents) +
          '</td><td>' +
          money(l.baseCents) +
          '</td><td>' +
          money(l.taxCents) +
          '</td><td>' +
          money(l.totalCents) +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table></div><div class="draft-totals"><p>Base: ' +
    money(d.baseCents) +
    '<br>IVA: ' +
    money(d.taxCents) +
    '<br><strong>Total: ' +
    money(d.totalCents) +
    '</strong></p></div><p>Desglose redondeado por línea al céntimo; cuota = total de línea − base. No acredita cobro ni verifica el identificador fiscal.</p>';

  document
    .querySelector('#document')
    .insertAdjacentHTML(
      'beforeend',
      '<section class="no-print"><h2>Historial de versiones del borrador</h2>' +
        (result.revisions?.length
          ? result.revisions
              .map(
                (row) =>
                  '<details><summary>Versión ' +
                  esc(row.version) +
                  ' · ' +
                  esc(row.reason) +
                  '</summary><p>' +
                  esc(row.at) +
                  ' · Usuario ' +
                  esc(row.actorId) +
                  '</p><p>Emisor: ' +
                  esc(row.document.issuer.name) +
                  ' · ' +
                  esc(row.document.issuer.taxId) +
                  ' · ' +
                  esc(row.document.issuer.address) +
                  '</p><p>Destinatario: ' +
                  esc(row.document.recipient.name) +
                  ' · ' +
                  esc(row.document.recipient.taxId) +
                  ' · ' +
                  esc(row.document.recipient.address) +
                  '</p></details>',
              )
              .join('')
          : '<p>Versión inicial, todavía sin correcciones.</p>') +
        '</section>',
    );

  const doc = document.querySelector('#document');
  if (result.invoice) {
    doc.querySelector('h1').textContent = 'DOCUMENTO EMITIDO · SOLO DEMOSTRACIÓN';
    doc.querySelector('.draft-warning').textContent =
      'SIN VALIDEZ FISCAL · No es una factura para Hacienda. Documento de prueba fijo; no acredita cobro.';
    doc.insertAdjacentHTML(
      'afterbegin',
      '<p><strong>' +
        esc(result.invoice.number) +
        '</strong> · Emitido: ' +
        esc(new Date(result.invoice.issuedAt).toLocaleString('es-ES')) +
        '</p>',
    );
  } else if (result.actor?.role === 'editor' && !result.orderCancelled) {
    doc.insertAdjacentHTML(
      'beforeend',
      '<section class="no-print"><h2>Emisión de demostración</h2><p>Fija esta versión, asigna un número DEMO y bloquea su edición. No genera una factura válida ni comunica con Hacienda.</p><label><input id="issue-confirm" type="checkbox"> He revisado esta versión y quiero emitirla solo en demostración.</label><button id="issue" class="chip">Emitir documento de prueba</button><p id="issue-error" role="status"></p></section>',
    );
    document.querySelector('#issue').addEventListener('click', async () => {
      if (!document.querySelector('#issue-confirm').checked) {
        document.querySelector('#issue-error').textContent =
          'Confirma que has revisado el documento.';
        return;
      }
      const button = document.querySelector('#issue');
      button.disabled = true;
      try {
        const session = await (await fetch('/api/session', { credentials: 'same-origin' })).json();
        const response = await fetch('/api/billing/drafts/' + encodeURIComponent(d.id) + '/issue', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
          body: JSON.stringify({ expectedVersion: d.version ?? 1, confirmDemo: true }),
        });
        const value = await response.json();
        if (!response.ok) throw new Error(value.message);
        await load();
      } catch (error) {
        document.querySelector('#issue-error').textContent = error.message;
        button.disabled = false;
      }
    });
  }

  if (result.invoice) {
    if (result.correction) {
      const credit = result.correction;
      doc.insertAdjacentHTML(
        'beforeend',
        '<section class="draft-warning"><h2>RECTIFICACIÓN TOTAL · SOLO DEMO</h2><p><strong>' +
          esc(credit.number) +
          '</strong> · ' +
          esc(new Date(credit.at).toLocaleString('es-ES')) +
          '</p><p>Rectifica ' +
          esc(credit.originalNumber) +
          ' sin borrar ni sustituir el original.</p><p>Motivo: ' +
          esc(credit.reason) +
          '</p><p>Base: ' +
          money(credit.baseCents) +
          ' · IVA: ' +
          money(credit.taxCents) +
          ' · Total: ' +
          money(credit.totalCents) +
          '</p><p>Saldo documental conjunto: ' +
          money(result.invoice.draft.totalCents + credit.totalCents) +
          '. No implica reembolso, cancelación del pedido ni devolución al almacén. Sin validez fiscal.</p></section>',
      );
    } else if (result.actor?.role === 'editor' && result.actor.businessRole !== 'office') {
      doc.insertAdjacentHTML(
        'beforeend',
        '<section class="no-print"><h2>Rectificación total de demostración</h2><p>Genera otro documento por el importe negativo íntegro. Conserva el original. No mueve stock ni devuelve dinero.</p><form id="correction-form"><label class="field">Motivo de rectificación<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><label><input type="checkbox" name="confirmDemo" required> Confirmo la rectificación total solo de demostración.</label><button class="chip" type="submit">Emitir rectificación de prueba</button><p id="correction-error" role="status"></p></form></section>',
      );
      document.querySelector('#correction-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.target,
          button = form.querySelector('button');
        if (button.disabled) return;
        button.disabled = true;
        try {
          const session = await (
            await fetch('/api/session', { credentials: 'same-origin' })
          ).json();
          const response = await fetch(
            '/api/billing/invoices/' + encodeURIComponent(result.invoice.id) + '/rectify',
            {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf },
              body: JSON.stringify({
                reason: form.elements.reason.value,
                confirmDemo: form.elements.confirmDemo.checked,
                expectedNumber: result.invoice.number,
              }),
            },
          );
          const value = await response.json();
          if (!response.ok) throw new Error(value.message);
          await load();
        } catch (error) {
          document.querySelector('#correction-error').textContent = error.message;
          button.disabled = false;
        }
      });
    }
  }

  document.querySelector('#print').disabled = false;
}
document.querySelector('#print').addEventListener('click', () => window.print());
load().catch((error) => {
  document.querySelector('#document').textContent = error.message;
});
