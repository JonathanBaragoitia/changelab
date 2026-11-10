export async function mountReconciliation(host, { api, esc, money, navigate }) {
  const guidance = {
    NO_DOCUMENT: {
      title: 'Falta el documento del pedido',
      description:
        'No hay un documento emitido. Si el pedido sigue en preparación, puede ser una tarea pendiente; un borrador todavía no cuenta como emitido.',
      area: 'billing',
      action: 'Revisar en Facturación',
    },
    PENDING_COLLECTION: {
      title: 'Queda importe por cobrar',
      description:
        'El importe del pedido supera los cobros netos registrados. Comprueba si el pago está pendiente o si falta anotarlo; no registres un cobro sin comprobarlo.',
      area: 'cash',
      action: 'Revisar en Cobros y pagos',
    },
    COLLECTION_EXCESS: {
      title: 'Hay más dinero anotado que el importe del pedido',
      description:
        'Puede haber un cobro duplicado, una devolución pendiente o una anotación incorrecta. Revisa los movimientos; no borres un cobro real para cuadrar el saldo.',
      area: 'cash',
      action: 'Revisar cobros y reembolsos',
    },
    DOCUMENT_DIFFERENCE: {
      title: 'Los documentos no coinciden con el pedido',
      description:
        'Compara lo emitido y las rectificaciones con el importe actual del pedido. Una cancelación o devolución puede requerir tratamiento documental.',
      area: 'billing',
      action: 'Revisar documentos',
    },
    LEGACY_TAX: {
      title: 'Pedido antiguo sin desglose de IVA',
      description:
        'El registro original no incluye el desglose. Revisa su documentación antes de emitir; esta pantalla no reconstruye la fiscalidad real.',
      area: 'billing',
      action: 'Revisar en Facturación',
    },
  };
  host.innerHTML =
    '<h2>¿Coinciden pedidos, documentos y cobros?</h2><p>Cargando comprobaciones…</p>';
  try {
    const { rows } = await api('/api/reconciliation');
    if (!host.isConnected) return;
    host.innerHTML =
      '<h2>¿Qué comprueba este apartado?</h2><p>Compara cuánto debe quedar en cada pedido, qué documentos se han emitido y cuánto dinero se ha anotado como cobrado, descontando reembolsos.</p><p>Por ejemplo: pedido de 100 €, con 60 € cobrados → quedan 40 € por cobrar. Un aviso puede ser una tarea pendiente, no necesariamente un error.</p><p>No cobra, modifica ni corrige nada automáticamente. No consulta bancos ni pasarelas de pago. Los documentos actuales son de demostración y no tienen validez fiscal.</p><label><input id="reconciliation-pending" type="checkbox" checked> Mostrar solo pedidos con avisos</label><div id="reconciliation-list"></div>';
    const render = () => {
      const selected = rows.filter(
        (row) => !host.querySelector('input').checked || row.findings.length,
      );
      host.querySelector('#reconciliation-list').innerHTML =
        '<p>' +
        selected.length +
        ' de ' +
        rows.length +
        ' pedidos · ' +
        rows.filter((r) => r.findings.length).length +
        ' con avisos.</p>' +
        selected
          .map(
            (row) =>
              '<article class="order"><h3>Pedido ' +
              esc(row.orderId) +
              '</h3><p>Estado: ' +
              esc(
                {
                  confirmed: 'Confirmado',
                  prepared: 'Preparado',
                  shipped: 'Enviado',
                  cancelled: 'Cancelado',
                  returned: 'Devuelto',
                }[row.status] ?? row.status,
              ) +
              '</p><details><summary>Ver desglose de importes y documentos</summary><p>Importe original ' +
              money(row.orderCents) +
              ' · Importe actual tras cancelaciones y devoluciones ' +
              money(row.expectedCents) +
              ' · Documentos emitidos menos rectificaciones ' +
              money(row.documentCents) +
              ' · Cobros registrados ' +
              money(row.collectedCents) +
              ' · Reembolsado ' +
              money(row.refundedCents) +
              ' · Cobrado menos reembolsos ' +
              money(row.netCollectedCents) +
              ' · Pendiente (negativo: revisar exceso) ' +
              money(row.pendingCents) +
              '</p><p>Documentos: ' +
              (row.documents
                .map(
                  (d) =>
                    '<a href="/borrador?id=' +
                    encodeURIComponent(d.draftId) +
                    '">' +
                    esc(d.number) +
                    '</a>',
                )
                .join(', ') || 'Ninguno emitido') +
              '</p><p>Rectificaciones: ' +
              (row.corrections.map((c) => esc(c.number)).join(', ') || 'Ninguna') +
              '</p></details>' +
              (row.findings.length
                ? row.findings
                    .map((f) => {
                      const help = guidance[f.code];
                      return (
                        '<div class="notice"><strong>' +
                        esc(help?.title ?? 'Revisión pendiente') +
                        '</strong><p>' +
                        esc(help?.description ?? f.message) +
                        '</p>' +
                        (help
                          ? '<button type="button" class="chip" data-check-area="' +
                            help.area +
                            '">' +
                            esc(help.action) +
                            '</button>'
                          : '') +
                        '</div>'
                      );
                    })
                    .join('')
                : '<p>Sin diferencias detectadas por estas comprobaciones.</p>') +
              '</article>',
          )
          .join('');
      host
        .querySelectorAll('[data-check-area]')
        .forEach((button) =>
          button.addEventListener('click', () => navigate(button.dataset.checkArea)),
        );
    };
    host.querySelector('input').addEventListener('change', render);
    render();
  } catch (error) {
    if (host.isConnected)
      host.textContent = 'No se pudo consultar la conciliación: ' + error.message;
  }
}
