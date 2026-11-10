export async function mountStockAnalysis(host, { api, esc, toast, editor, onChanged }) {
  host.innerHTML = '<h2>Reposición y oportunidades por artículo</h2><p>Cargando existencias…</p>';
  try {
    const report = await api('/api/stock-analysis');
    if (!host.isConnected) return;
    host.innerHTML =
      '<details class="commercial-disclosure stock-overview"><summary><span>Stock y reposición<small>' +
      report.rows.filter((r) => r.signals.length).length +
      ' artículos con avisos · ' +
      report.rows.length +
      ' en catálogo</small></span><span class="disclosure-action">Explorar artículos</span></summary><div class="disclosure-body"><details class="analysis-method"><summary>Periodo y criterios del análisis</summary><p>' +
      esc(report.from) +
      ' — ' +
      esc(report.to) +
      ' · ' +
      esc(report.scope) +
      '</p><p>Los avisos se recalculan al abrir o actualizar datos. No se envían notificaciones externas ni se generan pedidos de compra.</p></details><div class="stock-filters"><label class="field">Buscar artículo<input id="stock-search" type="search" placeholder="Nombre o SKU"></label><label><input id="stock-only-alerts" type="checkbox" checked> Mostrar solo artículos con avisos</label></div><div id="stock-product-list"></div></div></details>';
    const labels = {
      'out-of-stock': 'Agotado',
      reorder: 'Revisar reposición',
      'no-recorded-sales': 'Sin ventas registradas',
      'high-coverage': 'Cobertura elevada',
      'low-margin': 'Margen reducido',
    };
    const render = () => {
      const query = host.querySelector('#stock-search').value.toLowerCase(),
        only = host.querySelector('#stock-only-alerts').checked,
        selected = report.rows.filter(
          (r) =>
            (!only || r.signals.length) && (r.name + ' ' + r.sku).toLowerCase().includes(query),
        );
      host.querySelector('#stock-product-list').innerHTML =
        '<p>' +
        selected.length +
        ' de ' +
        report.rows.length +
        ' artículos. Cálculos orientativos, no predicción.</p>' +
        selected
          .map(
            (row) =>
              '<details class="order"><summary>' +
              esc(row.sku + ' · ' + row.name) +
              ' · stock ' +
              row.stock +
              ' · ' +
              esc(row.signals.map((s) => labels[s.code] ?? s.code).join(', ') || 'Sin avisos') +
              '</summary><p>' +
              row.unitsSold +
              ' unidades vendidas registradas en ' +
              row.observedDays +
              ' días · cobertura estimada ' +
              (row.coverageDays === null
                ? 'No calculable sin ventas'
                : row.coverageDays.toFixed(1) + ' días') +
              '</p><p>Punto de pedido ' +
              row.reorderPoint +
              ' unidades · objetivo ' +
              row.targetUnits +
              ' unidades · cantidad a valorar ' +
              (row.suggestedOrderUnits === null
                ? 'Sin recomendación de compra'
                : row.suggestedOrderUnits + ' unidades') +
              '</p><p>' +
              (row.policyIsDefault
                ? 'Parámetros de ejemplo sin confirmar:'
                : 'Parámetros guardados:') +
              ' plazo ' +
              row.policy.leadDays +
              ' días, reserva ' +
              row.policy.safetyDays +
              ' días, cobertura objetivo ' +
              row.policy.targetDays +
              ' días y mínimo ' +
              row.policy.minimumUnits +
              ' unidades.</p>' +
              row.signals.map((s) => '<p>' + esc(s.message) + '</p>').join('') +
              (row.unitsSold < 3
                ? '<p>Muestra escasa: unas pocas operaciones no permiten estimar demanda estable.</p>'
                : '') +
              '<ul>' +
              row.actions.map((a) => '<li>' + esc(a) + '</li>').join('') +
              '</ul>' +
              (row.alternatives.length
                ? '<p>Otros artículos de la categoría con más ventas registradas: ' +
                  row.alternatives
                    .map((a) => esc(a.sku + ' · ' + a.name) + ' (' + a.unitsSold + ' unidades)')
                    .join('; ') +
                  '. Esto no demuestra que sean sustitutos compatibles.</p>'
                : '') +
              (editor
                ? '<details><summary>Configurar reposición de este artículo</summary><form data-stock-policy="' +
                  esc(row.productId) +
                  '"><label class="field">Plazo de entrega (días)<input name="leadDays" type="number" min="0" max="180" step="1" required value="' +
                  row.policy.leadDays +
                  '"></label><label class="field">Días de reserva<input name="safetyDays" type="number" min="0" max="90" step="1" required value="' +
                  row.policy.safetyDays +
                  '"></label><label class="field">Cobertura objetivo (días)<input name="targetDays" type="number" min="1" max="365" step="1" required value="' +
                  row.policy.targetDays +
                  '"></label><label class="field">Mínimo de unidades<input name="minimumUnits" type="number" min="0" max="1000000" step="1" required value="' +
                  row.policy.minimumUnits +
                  '"></label><button>Guardar criterios de reposición</button></form></details>'
                : '') +
              '</details>',
          )
          .join('');
      host.querySelectorAll('[data-stock-policy]').forEach(
        (form) =>
          (form.onsubmit = async (event) => {
            event.preventDefault();
            const row = report.rows.find((r) => r.productId === form.dataset.stockPolicy),
              body = { expectedVersion: row.policy.version };
            for (const key of ['leadDays', 'safetyDays', 'targetDays', 'minimumUnits'])
              body[key] = Number(form.elements[key].value);
            const button = form.querySelector('button');
            button.disabled = true;
            try {
              await api('/api/stock-policies/' + encodeURIComponent(row.productId), body);
              await onChanged();
              toast(
                'Criterios guardados. Revisa los avisos recalculados; no se ha comprado mercancía.',
              );
            } catch (e) {
              toast(e.message, true);
            } finally {
              if (button.isConnected) button.disabled = false;
            }
          }),
      );
    };
    host.querySelector('#stock-search').oninput = render;
    host.querySelector('#stock-only-alerts').onchange = render;
    render();
  } catch (error) {
    if (host.isConnected)
      host.textContent = 'No se pudo cargar el análisis de existencias: ' + error.message;
  }
}
