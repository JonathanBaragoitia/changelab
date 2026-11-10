export function mountBilling(data, { api, esc, money, toast, reload }) {
  const screen = document.querySelector('#screen'),
    sales = data.sales;
  let changing = false;
  const editableSales = sales.filter(
    (s) =>
      !['cancelled', 'returned'].includes(s.status ?? '') &&
      !data.invoices.some((i) => i.draft.orderId === s.id),
  );
  screen.innerHTML =
    '<section class="heading"><div><div class="eyebrow">DOCUMENTOS DE DEMOSTRACIÓN</div><h1>Facturación de prueba.</h1><p>Prepara y revisa borradores. Abre un documento guardado para emitirlo o rectificarlo. Sin validez fiscal.</p></div></section><section class="panel panel-body"><h2>Resumen documental</h2><p>Emitido ' +
    money(data.billingMetrics.issuedCents) +
    ' · Rectificado ' +
    money(data.billingMetrics.correctedCents) +
    ' · Saldo ' +
    money(data.billingMetrics.balanceCents) +
    '</p><p>Estos documentos no acreditan cobros ni movimientos de almacén.</p></section>';
  const partyFields = (prefix, label) =>
    '<fieldset><legend>' +
    label +
    '</legend><label class="field">Nombre o razón social<input name="' +
    prefix +
    'Name" minlength="2" maxlength="120" required></label><label class="field">Identificador fiscal de prueba<input name="' +
    prefix +
    'TaxId" pattern="[A-Za-z0-9-]{3,20}" required placeholder="DEMO-001"></label><label class="field">Domicilio fiscal<input name="' +
    prefix +
    'Address" minlength="8" maxlength="300" required></label></fieldset>';
  screen.insertAdjacentHTML(
    'beforeend',
    '<section class="panel" data-area="billing"><div class="panel-title"><h2>Borradores de facturación</h2></div><div class="panel-body"><p>Sin validez fiscal: no son facturas emitidas ni se remiten a Hacienda. Usa exclusivamente datos ficticios.</p>' +
      (data.actor.role === 'editor' && editableSales.length
        ? '<form id="billing-form"><label class="field">Pedido<select name="orderId">' +
          editableSales
            .map(
              (s) =>
                '<option value="' +
                esc(s.id) +
                '">' +
                esc(s.id) +
                ' · ' +
                money(s.tax?.totalCents ?? s.totalCents) +
                '</option>',
            )
            .join('') +
          '</select></label>' +
          partyFields('issuer', 'Emisor de prueba') +
          partyFields('recipient', 'Destinatario de prueba') +
          '<label><input type="checkbox" name="acceptDemoTax" required> Confirmo el desglose de prueba indicado para este pedido (históricos: IVA incluido; nuevos: base más IVA guardado al comprar).</label><label class="field" id="revision-reason" hidden>Motivo de la corrección<textarea name="reason" minlength="5" maxlength="500"></textarea></label><button class="primary" type="submit">Preparar borrador</button></form>'
        : '<p>No hay pedidos activos con documentos editables. Consulta los documentos guardados; los emitidos conservan su versión.</p>') +
      '<h3>Documentos guardados</h3>' +
      (data.drafts.length
        ? data.drafts
            .map((d) => {
              const invoice = data.invoices.find((i) => i.draft.id === d.id),
                correction = invoice && data.corrections.find((c) => c.invoiceId === invoice.id),
                sale = sales.find((s) => s.id === d.orderId);
              const state = correction
                ? 'Rectificado'
                : invoice
                  ? 'Emitido DEMO'
                  : ['cancelled', 'returned'].includes(sale?.status ?? '')
                    ? 'Pedido cerrado · no emitible'
                    : 'Borrador editable';
              return (
                '<article class="order"><h3>' +
                esc(invoice?.number ?? 'Borrador') +
                ' · ' +
                esc(state) +
                '</h3><p>Pedido ' +
                esc(d.orderId) +
                ' · Versión ' +
                esc(invoice?.draftVersion ?? d.version ?? 1) +
                ' · Total ' +
                money(invoice?.draft.totalCents ?? d.totalCents) +
                '</p><a href="/borrador?id=' +
                encodeURIComponent(d.id) +
                '">Abrir documento y acciones</a></article>'
              );
            })
            .join('')
        : '<p>Todavía no hay borradores.</p>') +
      '</div></section>',
  );
  const billingForm = screen.querySelector('#billing-form');

  if (billingForm) {
    const populateDraft = () => {
      const d = data.drafts.find((d) => d.orderId === billingForm.elements.orderId.value);
      for (const prefix of ['issuer', 'recipient'])
        for (const field of ['name', 'taxId', 'address']) {
          const suffix = { name: 'Name', taxId: 'TaxId', address: 'Address' }[field];
          billingForm.elements[prefix + suffix].value = d?.[prefix]?.[field] ?? '';
        }
      billingForm.querySelector('button').disabled = !!(
        d && data.invoices.some((invoice) => invoice.draft.id === d.id)
      );
      billingForm.querySelector('button').textContent = d
        ? 'Guardar corrección del borrador'
        : 'Preparar borrador';
      billingForm.querySelector('#revision-reason').hidden = !d;
      billingForm.elements.reason.required = !!d;
      billingForm.elements.reason.value = '';
      billingForm.elements.acceptDemoTax.checked = !!d;
    };
    billingForm.elements.orderId.addEventListener('change', populateDraft);
    populateDraft();
  }
  if (billingForm)
    billingForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (changing) return;
      changing = true;
      const fields = billingForm.elements;
      const party = (prefix) => ({
        name: fields[prefix + 'Name'].value,
        taxId: fields[prefix + 'TaxId'].value,
        address: fields[prefix + 'Address'].value,
      });
      const id = fields.orderId.value,
        payload = {
          issuer: party('issuer'),
          recipient: party('recipient'),
          acceptDemoTax: fields.acceptDemoTax.checked,
        };
      [...fields].forEach((control) => (control.disabled = true));
      try {
        const existing = data.drafts.find((d) => d.orderId === id);
        if (existing)
          await api('/api/billing/drafts/' + encodeURIComponent(existing.id) + '/revise', {
            issuer: payload.issuer,
            recipient: payload.recipient,
            expectedVersion: existing.version ?? 1,
            reason: fields.reason.value,
          });
        else await api('/api/orders/' + encodeURIComponent(id) + '/draft', payload);
        await reload();
        toast('Borrador guardado. Puedes abrirlo desde Borradores guardados.');
      } catch (error) {
        toast(error.message, true);
      } finally {
        changing = false;
        if (billingForm.isConnected) [...fields].forEach((control) => (control.disabled = false));
      }
    });
}
