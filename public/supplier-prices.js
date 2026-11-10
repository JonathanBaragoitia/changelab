export function supplierPriceRows(supplierId, offers, history, batches) {
  return offers
    .filter((offer) => offer.supplierId === supplierId)
    .map((offer) => {
      const changes = history
        .filter(
          (change) => change.supplierId === supplierId && change.productId === offer.productId,
        )
        .sort((a, b) => b.version - a.version || b.at.localeCompare(a.at));
      const last =
        changes.find(
          (change) => change.version === offer.version && change.afterCostCents === offer.costCents,
        ) ?? null;
      const pending = batches.filter(
        (batch) =>
          batch.target === 'supplier-offer' &&
          batch.supplierId === supplierId &&
          batch.status === 'ready' &&
          batch.changes.some((change) => change.productId === offer.productId),
      );
      return { offer, last, changes, pending };
    });
}
export function mountSupplierPrices(host, data, result, { esc, money }) {
  const who = (id) => data.identityNames[id] ?? id;
  const date = (value) => new Date(value).toLocaleString('es-ES');
  const changeLabel = (change) => {
    if (!change || change.beforeCostCents === null) return 'Sin comparación anterior registrada';
    const delta = change.afterCostCents - change.beforeCostCents;
    if (!delta) return 'Sin cambio de precio';
    const percentage =
      change.beforeCostCents > 0
        ? ' (' +
          (delta > 0 ? '+' : '') +
          ((delta * 100) / change.beforeCostCents).toLocaleString('es-ES', {
            maximumFractionDigits: 2,
          }) +
          ' %)'
        : '';
    return (delta > 0 ? 'Subida +' : 'Bajada −') + money(Math.abs(delta)) + percentage;
  };
  host.insertAdjacentHTML(
    'afterbegin',
    '<section><h2>Productos y precios vigentes por proveedor</h2><p>Costes de compra por unidad sin IVA. Solo los cambios aplicados actualizan estos precios; las tarifas pendientes se indican aparte.</p>' +
      result.suppliers
        .filter((s) => s.active || result.offers.some((o) => o.supplierId === s.id))
        .map((supplier, index) => {
          const rows = supplierPriceRows(
            supplier.id,
            result.offers,
            result.priceHistory ?? [],
            result.batches,
          );
          return (
            '<details class="commercial-disclosure"' +
            (index === 0 ? ' open' : '') +
            '><summary><span>' +
            esc(supplier.name) +
            (supplier.active ? '' : ' · Archivado') +
            ' · ' +
            rows.length +
            ' productos</span><span class="disclosure-action">' +
            (index === 0 ? 'Cerrar' : 'Abrir') +
            '</span></summary><div class="disclosure-body">' +
            (rows.length
              ? '<div class="table-wrap"><table><thead><tr><th>Producto</th><th>Precio anterior</th><th>Precio vigente</th><th>Último cambio aplicado</th><th>Lote / plazo</th><th>Historial y origen</th></tr></thead><tbody>' +
                rows
                  .map(
                    ({ offer, last, changes, pending }) =>
                      '<tr><td><button type="button" class="chip" data-price-product="' +
                      esc(offer.productId) +
                      '" data-price-supplier="' +
                      esc(supplier.id) +
                      '">' +
                      esc(
                        data.products.find((p) => p.id === offer.productId)?.name ??
                          offer.productId,
                      ) +
                      '</button><small class="receipt-date">' +
                      esc(
                        data.products.find((p) => p.id === offer.productId)?.sku ?? offer.productId,
                      ) +
                      '</small></td><td>' +
                      (last?.beforeCostCents != null
                        ? money(last.beforeCostCents)
                        : 'No registrado') +
                      '</td><td><strong>' +
                      money(offer.costCents) +
                      '</strong>' +
                      (pending.length
                        ? '<small class="receipt-date">' +
                          pending.length +
                          ' tarifa(s) pendiente(s), aún sin aplicar</small>'
                        : '') +
                      '</td><td>' +
                      esc(changeLabel(last)) +
                      (last
                        ? '<small class="receipt-date">' + esc(date(last.at)) + '</small>'
                        : '<small class="receipt-date">Precio inicial o sin historial de esta versión</small>') +
                      '</td><td>' +
                      offer.packUnits +
                      ' unidades<small class="receipt-date">' +
                      offer.leadDays +
                      ' días laborables orientativos</small></td><td>' +
                      (changes.length
                        ? '<details><summary>' +
                          changes.length +
                          ' cambio(s) registrado(s)</summary>' +
                          changes
                            .map(
                              (change) =>
                                '<p><strong>' +
                                esc(changeLabel(change)) +
                                '</strong><br>' +
                                (change.beforeCostCents === null
                                  ? 'Anterior no registrado'
                                  : money(change.beforeCostCents)) +
                                ' → ' +
                                money(change.afterCostCents) +
                                '<small class="receipt-date">' +
                                esc(date(change.at)) +
                                ' · ' +
                                esc(who(change.actor)) +
                                '</small></p><p>Origen: ' +
                                esc(change.origin) +
                                ' · ' +
                                esc(change.reference) +
                                (change.sourceId
                                  ? ' · <a href="/api/tariff-sources/' +
                                    encodeURIComponent(change.sourceId) +
                                    '">Ver original</a>'
                                  : '') +
                                '</p>',
                            )
                            .join('') +
                          '</details>'
                        : 'Sin cambios registrados') +
                      '</td></tr>',
                  )
                  .join('') +
                '</tbody></table></div>'
              : '<p>Este proveedor aún no tiene productos vinculados.</p>') +
            '</div></details>'
          );
        })
        .join('') +
      '</section>',
  );
  host.querySelectorAll('[data-price-product]').forEach((button) =>
    button.addEventListener('click', () => {
      const supplierId = button.dataset.priceSupplier,
        productId = button.dataset.priceProduct;
      const row = supplierPriceRows(
        supplierId,
        result.offers,
        result.priceHistory ?? [],
        result.batches,
      ).find((row) => row.offer.productId === productId);
      const product = data.products.find((p) => p.id === productId),
        supplier = result.suppliers.find((s) => s.id === supplierId);
      const dialog = document.createElement('dialog');
      dialog.className = 'product-dialog price-history-dialog';
      dialog.setAttribute('aria-labelledby', 'price-history-title');
      dialog.innerHTML =
        '<form method="dialog"><button class="chip">Cerrar</button></form><h2 id="price-history-title">' +
        esc(product?.name ?? productId) +
        '</h2><p>' +
        esc(supplier.name) +
        ' · ' +
        esc(product?.sku ?? productId) +
        '</p><h3>Precio vigente: ' +
        money(row.offer.costCents) +
        ' por unidad sin IVA</h3>' +
        (row.pending.length
          ? '<p>Hay tarifas pendientes de revisión. Todavía no se han aplicado a este precio.</p>'
          : '') +
        '<h3>Evolución del precio</h3>' +
        (row.changes.length
          ? '<ol class="price-timeline">' +
            [...row.changes]
              .sort((a, b) => a.version - b.version)
              .map(
                (change) =>
                  '<li><strong>' +
                  esc(date(change.at)) +
                  ' · ' +
                  esc(changeLabel(change)) +
                  '</strong><p>' +
                  (change.beforeCostCents === null
                    ? 'Precio anterior no registrado'
                    : money(change.beforeCostCents)) +
                  ' → ' +
                  money(change.afterCostCents) +
                  '</p><p><strong>Motivo:</strong> ' +
                  esc(
                    change.reason ?? 'No se registró un motivo específico en este cambio antiguo.',
                  ) +
                  '</p><p>Preparó: ' +
                  esc(who(change.createdBy)) +
                  ' · Aplicó: ' +
                  esc(who(change.actor)) +
                  '</p><p>Origen: ' +
                  esc(change.origin) +
                  ' · Referencia: ' +
                  esc(change.reference) +
                  (change.sourceId
                    ? ' · <a href="/api/tariff-sources/' +
                      encodeURIComponent(change.sourceId) +
                      '">Descargar original</a>'
                    : '') +
                  '</p></li>',
              )
              .join('') +
            '</ol>'
          : '<p>No hay cambios registrados para este producto y proveedor. El precio actual no permite deducir fechas ni motivos anteriores.</p>');
      document.body.append(dialog);
      dialog.addEventListener('close', () => dialog.remove(), { once: true });
      dialog.showModal();
    }),
  );
}
