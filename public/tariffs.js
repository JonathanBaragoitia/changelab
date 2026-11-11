import { mountTariffDocuments } from '/tariff-documents.js';
import { mountSupplierPrices } from '/supplier-prices.js';
let tariffSection = 'prices';
let openedDecisionTariff = '';

function renderDecision(decision, names, { esc, money }, open, target) {
  const { report, createdAt, createdBy, stale } = decision;
  const { source, rows, summary, findings } = report;
  const percent = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });
  const margin = (bps) => (bps == null ? '—' : percent.format(bps / 100) + ' %');
  const listFindings = (items) =>
    items.length
      ? '<ul>' + items.map((item) => '<li>' + esc(item.message) + '</li>').join('') + '</ul>'
      : '';
  const scenario = (value) =>
    (value.priceCents == null
      ? 'Fuera del rango admitido'
      : money(value.priceCents) + ' · margen ' + margin(value.marginBps)) +
    listFindings(value.findings);
  return (
    '<details class="commercial-disclosure"' +
    (open ? ' open' : '') +
    '><summary>Propuesta guardada · ' +
    esc(new Date(createdAt).toLocaleString('es-ES')) +
    '</summary><div class="disclosure-body">' +
    (stale
      ? '<p role="status"><strong>Propuesta desactualizada.</strong> Los datos de referencia han cambiado o ya no están disponibles. Recalcula la propuesta antes de tomar una decisión.</p>'
      : '') +
    '<p>Preparada por ' +
    esc(names[createdBy] ?? createdBy) +
    '. Tarifa ' +
    esc(source.reference) +
    ' de ' +
    esc(source.supplierName) +
    '.</p><p><strong>' +
    (summary.modelUsed ? 'Resumen seleccionado por IA' : 'Resumen seleccionado por reglas') +
    '</strong></p><p>' +
    esc(summary.text) +
    '</p><p>Importes unitarios sin IVA. ' +
    (target
      ? 'Los costes corresponden a la oferta del proveedor.'
      : 'Los costes corresponden al coste general del catálogo registrado en esta tarifa antigua.') +
    ' Los precios y márgenes de los escenarios son hipótesis para revisión. Preparar la propuesta no aplica cambios.</p>' +
    listFindings(findings) +
    (rows.length
      ? '<div class="table-wrap"><table><thead><tr><th>Artículo</th><th>' +
        (target ? 'Coste del proveedor' : 'Coste general del catálogo') +
        '</th><th>Situación de referencia</th><th>Mantener precio</th><th>Conservar margen de referencia</th></tr></thead><tbody>' +
        rows
          .map(
            (row) =>
              '<tr><td>' +
              esc(row.name) +
              '<small class="receipt-date">' +
              esc(row.sku) +
              '</small></td><td>' +
              money(row.beforeCostCents) +
              ' → ' +
              money(row.afterCostCents) +
              '</td><td>' +
              money(row.referencePriceCents) +
              ' · margen ' +
              margin(row.previousMarginBps) +
              '</td><td>' +
              scenario(row.absorb) +
              '</td><td>' +
              scenario(row.preserve) +
              '</td></tr>',
          )
          .join('') +
        '</tbody></table></div>'
      : '<p>No hay artículos disponibles para comparar.</p>') +
    '<details class="tariff-source"><summary>Evidencia de la tarifa</summary><p>Huella de la tarifa: <code>' +
    esc(source.digest) +
    '</code></p>' +
    (source.sourceId
      ? '<p><a href="/api/tariff-sources/' +
        encodeURIComponent(source.sourceId) +
        '" download>Descargar documento original</a></p>'
      : '<p>La evidencia procede de las filas guardadas de esta tarifa.</p>') +
    (source.sourceSha256
      ? '<p>Huella SHA-256 del archivo: <code>' + esc(source.sourceSha256) + '</code></p>'
      : '') +
    '</details></div></details>'
  );
}

export async function mountTariffs(data, { api, esc, money, toast, reload }) {
  const root = document.querySelector('#screen');
  root.innerHTML =
    '<section class="heading"><div><h1>Tarifas de proveedores.</h1><p>Importa costes netos por SKU. La importación prepara cambios de la oferta del proveedor. Otra persona los revisa y aprueba; no cambia precios de venta ni compras anteriores.</p></div></section><section class="panel panel-body" id="tariff-body">Cargando…</section>';
  try {
    const result = await api('/api/tariffs'),
      box = root.querySelector('#tariff-body');
    if (!box) return;
    box.insertAdjacentHTML(
      'beforebegin',
      '<nav class="tariff-tabs" aria-label="Opciones de tarifas"><button type="button" id="tariff-prices-tab" aria-pressed="true"><span class="tariff-tab-icon" aria-hidden="true">€</span><span>Precios y evolución<small>Productos, importes e historial</small></span></button><button type="button" id="tariff-imports-tab" aria-pressed="false"><span class="tariff-tab-icon" aria-hidden="true">↥</span><span>Importar y revisar tarifas<small>Documentos y cambios pendientes</small></span></button><button type="button" id="tariff-documents-tab" aria-pressed="false"><span>Documentos originales<small>PDF, CSV y correos recibidos</small></span></button></nav><section class="panel panel-body" id="tariff-prices"></section><section class="panel panel-body" id="tariff-originals" hidden></section>',
    );
    const prices = root.querySelector('#tariff-prices');
    mountSupplierPrices(prices, data, result, { esc, money });
    box.hidden = true;
    const originals = root.querySelector('#tariff-originals');
    const sources = result.batches
      .filter((b) => b.source)
      .sort((a, b) => b.source.uploadedAt.localeCompare(a.source.uploadedAt));
    originals.innerHTML =
      '<h2>Documentos originales de tarifas</h2><p>Son los archivos de origen de los precios, no albaranes de mercancía. Descargar un documento no cambia precios ni stock.</p>' +
      (sources.length
        ? '<div class="table-wrap"><table><thead><tr><th>Documento y proveedor</th><th>Fecha y responsable</th><th>Revisión</th><th>Original</th></tr></thead><tbody>' +
          sources
            .map(
              (b) =>
                '<tr><td>' +
                esc(b.source.filename) +
                '<small class="receipt-date">' +
                esc(b.supplierName) +
                ' · ' +
                esc(b.reference) +
                '</small></td><td>' +
                esc(new Date(b.source.uploadedAt).toLocaleString('es-ES')) +
                '<small class="receipt-date">' +
                esc(data.identityNames[b.source.uploadedBy] ?? b.source.uploadedBy) +
                '</small></td><td>' +
                esc({ ready: 'Pendiente', applied: 'Aplicada', blocked: 'Bloqueada' }[b.status]) +
                '</td><td><a class="chip" href="/api/tariff-sources/' +
                encodeURIComponent(b.source.id) +
                '" download>Descargar ' +
                esc(b.source.format.toUpperCase()) +
                '</a></td></tr>',
            )
            .join('') +
          '</tbody></table></div>'
        : '<p>No hay archivos de tarifas guardados en esta base. Las tarifas introducidas manualmente no tienen un PDF original. Importa un archivo para conservar el documento original.</p>');
    const selectTab = (section) => {
      tariffSection = section;
      prices.hidden = section !== 'prices';
      box.hidden = section !== 'imports';
      originals.hidden = section !== 'documents';
      for (const key of ['prices', 'imports', 'documents'])
        root
          .querySelector('#tariff-' + key + '-tab')
          .setAttribute('aria-pressed', String(section === key));
    };
    root.querySelector('#tariff-prices-tab').onclick = () => selectTab('prices');
    root.querySelector('#tariff-imports-tab').onclick = () => selectTab('imports');
    root.querySelector('#tariff-documents-tab').onclick = () => selectTab('documents');
    selectTab(tariffSection);
    const suppliers = result.suppliers.filter((s) => s.active);
    const decisions = new Map(
      (result.decisions ?? []).map((decision) => [decision.tariffId, decision]),
    );
    box.innerHTML =
      (data.actor.role === 'editor'
        ? '<h2>Preparar tarifa CSV</h2><p>Cabecera <code>sku;coste</code>. Hasta 100 filas y 12 KB, euros sin IVA, sin separadores de miles. También admite CSV con coma y decimales entre comillas. Las referencias deben existir en el catálogo y estar vinculadas a este proveedor.</p><form id="tariff-form"><label class="field">Proveedor<select name="supplierId" required>' +
          suppliers
            .map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>')
            .join('') +
          '</select></label><label class="field">Referencia de tarifa<input name="reference" required maxlength="100" placeholder="TARIFA-2026-01"></label><label class="field">Motivo del cambio<textarea name="reason" minlength="5" maxlength="500" required placeholder="Nueva tarifa comunicada por el proveedor…"></textarea></label><label class="field">Archivo CSV<input id="tariff-file" type="file" accept=".csv,text/csv"></label><label class="field">Contenido CSV<textarea name="csv" required maxlength="12000" rows="7" placeholder="sku;coste"></textarea></label><button type="button" id="tariff-example" class="chip">Cargar ejemplo sin guardar</button><button class="primary" ' +
          (!suppliers.length ? 'disabled' : '') +
          '>Comparar y guardar para revisión</button></form>' +
          (!suppliers.length ? '<p>Crea primero un proveedor activo.</p>' : '')
        : '<p>Solo edición prepara archivos. Revisión puede aplicar las tarifas guardadas.</p>') +
      '<h2>Tarifas recibidas y revisiones</h2>' +
      (!result.batches.length
        ? '<p>Todavía no hay tarifas. Cargar el ejemplo no guarda ni aplica cambios.</p>'
        : result.batches
            .map(
              (batch) =>
                '<article class="order"><h3>' +
                esc(batch.reference) +
                ' · ' +
                esc(
                  { ready: 'Pendiente de revisión', blocked: 'Bloqueada', applied: 'Aplicada' }[
                    batch.status
                  ],
                ) +
                '</h3><p>' +
                esc(batch.supplierName) +
                ' · ' +
                esc(new Date(batch.createdAt).toLocaleString('es-ES')) +
                '</p>' +
                '<p>Preparada por: ' +
                esc(data.identityNames[batch.createdBy] ?? batch.createdBy) +
                ' · Destino: ' +
                (batch.target
                  ? 'oferta de este proveedor'
                  : 'coste general del catálogo (tarifa antigua)') +
                '</p>' +
                (batch.appliedBy
                  ? '<p>Aprobada por: ' +
                    esc(data.identityNames[batch.appliedBy] ?? batch.appliedBy) +
                    ' · ' +
                    esc(new Date(batch.appliedAt).toLocaleString('es-ES')) +
                    '</p>'
                  : '') +
                (batch.source
                  ? '<details class="tariff-source"><summary>Ver documento y origen de los precios</summary><p>Archivo: ' +
                    esc(batch.source.filename) +
                    ' · Origen declarado: ' +
                    esc(batch.source.origin || 'Carga manual') +
                    '</p><p>Recibido en la aplicación: ' +
                    esc(new Date(batch.source.uploadedAt).toLocaleString('es-ES')) +
                    ' · Extracción: ' +
                    (batch.source.reviewedManually
                      ? 'costes cotejados manualmente'
                      : batch.source.modelUsed
                        ? 'asistida; requiere revisión'
                        : 'tabla estructurada') +
                    '</p><a href="/api/tariff-sources/' +
                    encodeURIComponent(batch.source.id) +
                    '">Descargar original</a><pre>' +
                    esc(batch.source.text) +
                    '</pre><small>Huella SHA-256: ' +
                    esc(batch.source.sha256) +
                    '</small></details>'
                  : '<p>Origen: CSV introducido en el formulario.</p>') +
                (batch.status === 'blocked'
                  ? '<p>Hay SKU desconocidos o ningún coste cambia. Corrige el archivo y utiliza una referencia nueva.</p>'
                  : '') +
                '<div class="table-wrap"><table><thead><tr><th>SKU</th><th>Estado</th><th>Coste anterior</th><th>Coste nuevo</th><th>Margen con precio actual</th><th>Precio mínimo para 20 %</th></tr></thead><tbody>' +
                batch.rows
                  .map((row) => {
                    const c = batch.changes.find((c) => c.sku.toUpperCase() === row.sku);
                    return (
                      '<tr><td>' +
                      esc(row.sku) +
                      '</td><td>' +
                      esc(
                        {
                          new: 'Referencia desconocida',
                          same: 'Sin cambios',
                          changed: 'Cambio de coste',
                        }[row.state],
                      ) +
                      '</td><td>' +
                      (c ? money(c.beforeCostCents) : '—') +
                      '</td><td>' +
                      money(row.costCents) +
                      '</td><td>' +
                      (c
                        ? new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(
                            ((c.priceCents - row.costCents) * 100) / c.priceCents,
                          ) +
                          ' %' +
                          (c.priceCents * 80 < row.costCents * 100 ? ' · Bajo mínimo' : '')
                        : '—') +
                      '</td><td>' +
                      money(Math.ceil((row.costCents * 100) / 80)) +
                      '</td></tr>'
                    );
                  })
                  .join('') +
                '</tbody></table></div><p>El coste real puede dejar un margen inferior al mínimo; revisa después los precios. No se actualizan automáticamente.</p>' +
                ((data.actor.role === 'editor' && ['ready', 'applied'].includes(batch.status)) ||
                decisions.has(batch.id)
                  ? '<details class="commercial-disclosure"' +
                    (openedDecisionTariff === batch.id ? ' open' : '') +
                    '><summary>Propuestas para Dirección' +
                    (decisions.get(batch.id)?.stale ? ' · Desactualizada' : '') +
                    '</summary><div class="disclosure-body">' +
                    (data.actor.role === 'editor' && ['ready', 'applied'].includes(batch.status)
                      ? '<button type="button" data-tariff-decision="' +
                        esc(batch.id) +
                        '" class="primary">' +
                        (decisions.get(batch.id)?.stale
                          ? 'Recalcular propuesta para Dirección'
                          : 'Preparar propuesta para Dirección') +
                        '</button>'
                      : '') +
                    (decisions.has(batch.id)
                      ? renderDecision(
                          decisions.get(batch.id),
                          data.identityNames,
                          { esc, money },
                          openedDecisionTariff === batch.id,
                          batch.target,
                        )
                      : '') +
                    '</div></details>'
                  : '') +
                (batch.status === 'ready' &&
                (data.actor.businessRole === 'owner' ||
                  (!data.actor.businessRole &&
                    !data.actor.ownerApprovalRequired &&
                    data.actor.role === 'reviewer')) &&
                (data.actor.id !== batch.createdBy || data.actor.businessRole === 'owner')
                  ? '<form data-apply-tariff="' +
                    esc(batch.id) +
                    '"><label><input name="reviewed" type="checkbox" required> He revisado todos los costes y sus márgenes.</label><button>Aplicar costes revisados</button></form>'
                  : '') +
                '</article>',
            )
            .join(''));
    const form = box.querySelector('#tariff-form');
    const history = result.batches
      .filter((batch) => batch.status === 'applied')
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
      .flatMap((batch) => batch.changes.map((change) => ({ batch, change })))
      .slice(0, 100);
    box.insertAdjacentHTML(
      'beforeend',
      '<details class="commercial-disclosure"><summary><span>Historial de precios de compra · últimos 100 cambios aplicados</span><span class="disclosure-action">Abrir</span></summary><div class="disclosure-body">' +
        (history.length
          ? '<div class="table-wrap"><table><thead><tr><th>Producto / proveedor</th><th>Anterior</th><th>Nuevo</th><th>Origen</th><th>Preparó / aprobó</th><th>Fecha de aplicación</th></tr></thead><tbody>' +
            history
              .map(
                ({ batch, change }) =>
                  '<tr><td>' +
                  esc(change.name) +
                  '<small class="receipt-date">' +
                  esc(batch.supplierName) +
                  (batch.target ? '' : ' · Coste general antiguo') +
                  '</small></td><td>' +
                  money(change.beforeCostCents) +
                  '</td><td>' +
                  money(change.afterCostCents) +
                  '</td><td>' +
                  esc(batch.reference) +
                  (batch.source
                    ? '<small class="receipt-date">' +
                      esc(batch.source.filename) +
                      ' · ' +
                      esc(batch.source.origin) +
                      '</small>'
                    : ' · CSV manual') +
                  '</td><td>' +
                  esc(data.identityNames[batch.createdBy] ?? batch.createdBy) +
                  ' / ' +
                  esc(data.identityNames[batch.appliedBy] ?? batch.appliedBy) +
                  '</td><td>' +
                  esc(new Date(batch.appliedAt).toLocaleString('es-ES')) +
                  '</td></tr>',
              )
              .join('') +
            '</tbody></table></div>'
          : '<p>Aún no hay cambios aprobados.</p>') +
        '</div></details>',
    );
    if (data.actor.role === 'editor')
      mountTariffDocuments(box, suppliers, { api, esc, toast, reload });
    if (form) {
      box.querySelector('#tariff-example').onclick = () => {
        form.elements.csv.value =
          'sku;coste\n' +
          data.products
            .filter((p) =>
              result.offers.some(
                (o) => o.supplierId === form.elements.supplierId.value && o.productId === p.id,
              ),
            )
            .slice(0, 3)
            .map(
              (p) =>
                p.sku +
                ';' +
                (
                  Math.round(
                    result.offers.find(
                      (o) =>
                        o.supplierId === form.elements.supplierId.value && o.productId === p.id,
                    ).costCents * 1.1,
                  ) / 100
                )
                  .toFixed(2)
                  .replace('.', ','),
            )
            .join('\n');
      };
      box.querySelector('#tariff-file').onchange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;
        if (file.size > 12000) {
          toast('Archivo demasiado grande: máximo 12 KB.', true);
          event.target.value = '';
          return;
        }
        form.elements.csv.value = await file.text();
      };
      form.onsubmit = async (event) => {
        event.preventDefault();
        const controls = [...form.elements];
        controls.forEach((c) => (c.disabled = true));
        try {
          await api('/api/tariffs', {
            supplierId: form.elements.supplierId.value,
            reference: form.elements.reference.value,
            csv: form.elements.csv.value,
            target: 'supplier-offer',
            reason: form.elements.reason.value,
          });
          await reload();
          toast('Tarifa guardada para revisión. El catálogo no ha cambiado.');
        } catch (e) {
          toast(e.message, true);
        } finally {
          if (form.isConnected) controls.forEach((c) => (c.disabled = false));
        }
      };
    }
    box.querySelectorAll('[data-apply-tariff]').forEach(
      (form) =>
        (form.onsubmit = async (event) => {
          event.preventDefault();
          const batch = result.batches.find((b) => b.id === form.dataset.applyTariff),
            button = form.querySelector('button');
          button.disabled = true;
          try {
            await api('/api/tariffs/' + encodeURIComponent(batch.id) + '/apply', {
              digest: batch.digest,
            });
            await reload();
            toast('Costes aplicados. Los precios de venta no han cambiado.');
          } catch (e) {
            toast(e.message, true);
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        }),
    );
    box.querySelectorAll('[data-tariff-decision]').forEach((button) => {
      button.onclick = async () => {
        const batch = result.batches.find((b) => b.id === button.dataset.tariffDecision);
        const actionLabel = button.textContent;
        button.disabled = true;
        button.textContent = 'Preparando propuesta…';
        try {
          await api('/api/tariffs/' + encodeURIComponent(batch.id) + '/decision', {
            digest: batch.digest,
          });
          openedDecisionTariff = batch.id;
          await reload();
          toast('Propuesta guardada para Dirección.');
        } catch (error) {
          toast(error.message, true);
        } finally {
          if (button.isConnected) {
            button.disabled = false;
            button.textContent = actionLabel;
          }
        }
      };
    });
  } catch (e) {
    const box = root.querySelector('#tariff-body');
    if (box) box.textContent = e.message;
  }
}
