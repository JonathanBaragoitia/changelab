export function auditPage(events, { from = '', to = '', query = '', page = 1, size = 25 } = {}) {
  const needle = query.trim().toLocaleLowerCase('es-ES');
  const filtered = events
    .filter((event) => {
      const day = new Date(event.at).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
      return (
        (!from || day >= from) &&
        (!to || day <= to) &&
        (!needle || JSON.stringify(event).toLocaleLowerCase('es-ES').includes(needle))
      );
    })
    .sort((a, b) => b.at.localeCompare(a.at) || b.seq - a.seq);
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const current = Math.max(1, Math.min(pages, page));
  return {
    events: filtered.slice((current - 1) * size, current * size),
    total: filtered.length,
    pages,
    page: current,
  };
}
export function auditRows(data, { esc, money, date }) {
  const actions = {
    'mail.retry-requested': 'Reintento de correo solicitado',
    'mail.queued': 'Correo guardado en la cola',
    'mail.preview': 'Correo preparado para revisión local',
    'mail.sent': 'Correo aceptado por el proveedor',
    'mail.failed': 'Intento de correo fallido',
    'mail.blocked': 'Correo bloqueado para revisión',
    'mail.uncertain': 'Estado del correo pendiente de comprobar',
    'order.dispatch-arranged': 'Expedición tramitada; pendiente de recogida',
    'account.order-permissions-granted': 'Permisos de almacén y envíos configurados',
    'purchase.created': 'Compra preparada',
    'purchase.approved': 'Compra aprobada',
    'purchase.sent': 'Envío al proveedor registrado',
    'purchase.partially_received': 'Recepción con unidades pendientes',
    'purchase.receipt-reopened': 'Unidades pendientes tras anular la recepción',
    'purchase.rejected': 'Compra rechazada',
    'purchase.changes_requested': 'Cambio de compra solicitado',
    'purchase.replenishment-created': 'Reposición conjunta preparada',
    'transport.damage-created': 'Rotura de transporte registrada',
    'transport.damage-resolved': 'Reclamación de transporte cerrada',
    'supplier.offer-saved': 'Precio de proveedor actualizado',
    'purchase.received': 'Compra recibida',
    'purchase.cancelled': 'Compra cancelada',
    'incident.created': 'Incidencia abierta',
    'incident.updated': 'Seguimiento de incidencia',
    'document.extracted': 'Documento extraído',
    'document.processed': 'Documento incorporado',
    'order.partial-returned': 'Devolución por unidades',
    'catalog.seeded': 'Catálogo de prueba creado',
    'catalog.updated': 'Catálogo actualizado: limpieza y cuidado del automóvil',
    'proposal.simulated': 'Propuesta simulada',
    'proposal.applied': 'Propuesta aprobada y publicada',
    'account.created': 'Cuenta creada',
    'supplier.created': 'Proveedor registrado',
    'supplier.updated': 'Ficha de proveedor actualizada',
    'catalog.product-created': 'Artículo creado',
    'catalog.product-edited': 'Datos de artículo actualizados',
    'order.goods-returned': 'Devolución completa recibida',
    'inventory.adjusted': 'Existencias ajustadas con motivo',
    'cash.reversed': 'Anotación de cobro o pago anulada',
    'cash.refund-reversed': 'Reembolso erróneo anulado',
    'stock.policy-updated': 'Criterios de reposición actualizados',
    'tariff.prepared': 'Tarifa preparada para revisión',
    'tariff.decision-prepared': 'Propuesta comercial de tarifa preparada',
    'tariff.applied': 'Costes de tarifa aplicados',
    'cash.refunded': 'Reembolso de demostración registrado',
    'cash.registered': 'Cobro o pago anotado manualmente',
    'inventory.receipt-cancelled': 'Recepción de almacén anulada',
    'expense.cancelled': 'Gasto operativo anulado',
    'expense.registered': 'Gasto operativo registrado',
    'billing.demo-corrected': 'Documento rectificativo emitido (demo)',
    'billing.demo-issued': 'Documento numerado emitido (solo demo)',
    'billing.draft-revised': 'Datos fiscales del borrador corregidos',
    'billing.draft-created': 'Borrador preparado (sin validez fiscal)',
    'inventory.received': 'Entrada de almacén registrada',
    'order.status-changed': 'Estado de pedido actualizado',
    'inventory.seeded': 'Existencias de demostración inicializadas',
    'order.confirmed': 'Pedido de prueba confirmado y existencias descontadas',
  };
  const legacy = {
    elena: 'Elena · identidad de demostración',
    marcos: 'Marcos · identidad de demostración',
    lucia: 'Lucía · identidad de demostración',
    system: 'Sistema',
    'local-admin': 'Administración local',
    'mail-service': 'Servicio de correo',
  };
  const name = (id) => data.identityNames?.[id] ?? legacy[id] ?? id;
  const percentage = (plan) =>
    (plan.basisPoints > 0 ? '+' : '') + (plan.basisPoints / 100).toLocaleString('es-ES') + ' %';
  return data.audit
    .map((event) => {
      const detail = event.summary;
      const proposalEvent =
        event.action === 'proposal.applied' || event.action === 'proposal.simulated';
      const published = event.action === 'proposal.applied';
      const rows = detail?.changes ?? [];
      return `<article class="audit-entry">
      <div class="audit-entry-heading"><span class="audit-symbol">${published ? '↗' : '◷'}</span><div><h3>${esc(actions[event.action] ?? event.action)}</h3>
      ${detail?.plan ? `<p class="audit-change">${esc(detail.plan.category)} · ${esc(percentage(detail.plan))} · ${rows.length} productos</p>` : ''}</div><time>${esc(date(event.at))}</time></div>
      <p><strong>${published ? 'Publicado por' : 'Realizado por'}:</strong> ${esc(detail?.actorName ?? name(event.actor))}${published && detail?.createdBy ? ' · <strong>Propuesto por:</strong> ' + esc(name(detail.createdBy)) : ''}</p>
      ${detail?.instruction ? '<p><strong>Motivo:</strong> ' + esc(detail.instruction) + '</p>' : ''}
      ${proposalEvent ? '<p class="audit-outcome">' + (published ? 'Se aplicaron los siguientes cambios de precio al catálogo.' : 'Solo se simuló el cambio; este evento no modificó los precios del catálogo.') + '</p>' : ''}
      ${rows.length ? `<details ${published ? 'open' : ''}><summary>Ver ${rows.length} cambios · antes y después</summary><div class="table-wrap"><table><thead><tr><th>Producto</th><th class="number">Antes</th><th class="number">Después</th><th class="number">Diferencia</th></tr></thead><tbody>${rows.map((row) => '<tr><td>' + esc(row.name) + '</td><td class="number">' + money(row.beforeCents) + '</td><td class="number">' + money(row.afterCents) + '</td><td class="number">' + (row.afterCents > row.beforeCents ? '+' : '') + money(row.afterCents - row.beforeCents) + '</td></tr>').join('')}</tbody></table></div></details>` : ''}
      ${detail?.findings?.length ? '<ul class="audit-findings">' + detail.findings.map((message) => '<li>' + esc(message) + '</li>').join('') + '</ul>' : ''}
      ${proposalEvent && !rows.length ? '<p class="hint">Este evento no contiene un detalle de precios recuperable.</p>' : ''}
      ${detail && !detail.available ? '<p class="hint">No se pudo interpretar el detalle guardado de este evento.</p>' : ''}
      <details><summary>Detalle técnico del registro</summary><p class="subtle">Registro ${esc(event.seq)} · Hash ${esc(event.hash)}</p></details>
    </article>`;
    })
    .join('');
}
