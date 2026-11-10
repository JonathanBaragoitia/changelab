// This panel displays server calculations; it never writes prices or approves proposals.
const quantitiesByProposal = new Map();
export function clearImpactState() {
  quantitiesByProposal.clear();
}
export async function mountImpact(proposal, { api, esc, money }) {
  const root = document.querySelector('#impact-review');
  const percent = (value) =>
    value === null ? '—' : value.toLocaleString('es-ES', { maximumFractionDigits: 2 }) + ' %';
  const signedMoney = (value) => (value > 0 ? '+' : '') + money(value);
  try {
    const review = await api('/api/proposals/' + encodeURIComponent(proposal.id) + '/review');
    if (!root.isConnected) return false;
    root.innerHTML = `
      <div class="impact-summary" aria-label="Resumen del impacto">
        <div><strong>${review.affectedProducts}</strong><span>Productos afectados</span></div>
        <div><strong>${review.costSnapshotComplete ? review.belowMinimum : '—'}</strong><span>Bajo margen mínimo</span></div>
      </div>
      <div class="table-wrap"><table class="comparison-table">
        <caption>Datos guardados al simular · margen bruto sobre precio</caption>
        <thead><tr><th>Producto</th><th class="number">Precio antes</th><th class="number">Precio después</th><th class="number">Margen antes</th><th class="number">Margen después</th></tr></thead>
        <tbody>${review.rows
          .map(
            (row) => `<tr class="${row.belowMinimum ? 'risk-row' : ''}">
          <td>${esc(row.name)}${row.belowMinimum ? '<small class="risk-label">Bajo el mínimo del 20 %</small>' : ''}</td>
          <td class="number">${money(row.beforeCents)}</td><td class="number new-price">${money(row.afterCents)}</td>
          <td class="number">${percent(row.beforeMarginPercent)}</td><td class="number">${percent(row.afterMarginPercent)}</td>
        </tr>`,
          )
          .join('')}</tbody>
      </table></div>
      ${
        !review.costSnapshotComplete
          ? '<div class="notice">Esta propuesta antigua no conserva los costes. Sus márgenes y escenario económico no se pueden reconstruir. Crea una nueva simulación para incluirlos.</div>'
          : `
        <section class="scenario" aria-labelledby="scenario-title">
          <div class="eyebrow">ESCENARIO · NO ES UNA PREDICCIÓN</div>
          <h4 id="scenario-title">¿Qué pasaría con estas unidades?</h4>
          <p class="hint">Comparamos las mismas cantidades antes y después. Tú defines las unidades; no se estima la demanda.</p>
          <form id="scenario-form">
            <div class="quantity-grid">${review.rows.map((row) => `<label class="field">${esc(row.name)}<input type="number" min="0" max="100000" step="1" required data-quantity="${esc(row.productId)}" aria-label="Unidades de ${esc(row.name)}" value="${esc(quantitiesByProposal.get(proposal.id)?.[row.productId] ?? 0)}"></label>`).join('')}</div>
            <div class="scenario-actions"><button type="button" class="chip" id="scenario-example">Ejemplo: 10 unidades de cada producto</button><button type="submit" class="primary">Calcular escenario</button></div>
          </form>
          <div id="scenario-result" aria-live="polite"><p class="hint">Introduce cantidades y calcula para comparar los importes.</p></div>
          <p class="hint">Contribución bruta = ingresos − coste de los productos. No incluye impuestos ni otros gastos y no equivale al beneficio neto. Las cantidades y el cálculo no se guardan con la propuesta.</p>
        </section>`
      }
    `;
    if (!review.costSnapshotComplete) return true;
    const form = root.querySelector('#scenario-form');
    const result = root.querySelector('#scenario-result');
    const button = form.querySelector('[type=submit]');
    let revision = 0;
    const remember = () => {
      const quantities = Object.fromEntries(
        [...form.querySelectorAll('[data-quantity]')].map((input) => [
          input.dataset.quantity,
          input.value,
        ]),
      );
      quantitiesByProposal.set(proposal.id, quantities);
      revision++;
      result.innerHTML =
        '<p class="hint">Cantidades modificadas. Vuelve a calcular el escenario.</p>';
    };
    form.addEventListener('input', remember);
    root.querySelector('#scenario-example').addEventListener('click', () => {
      form.querySelectorAll('[data-quantity]').forEach((input) => {
        input.value = '10';
      });
      remember();
    });
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (button.disabled || !form.reportValidity()) return;
      const version = ++revision;
      const quantities = [...form.querySelectorAll('[data-quantity]')].map((input) => ({
        productId: input.dataset.quantity,
        quantity: Number(input.value),
      }));
      button.disabled = true;
      button.textContent = 'Calculando…';
      result.innerHTML = '<p class="hint">Calculando con los datos de esta simulación…</p>';
      try {
        const values = await api(
          '/api/proposals/' + encodeURIComponent(proposal.id) + '/scenario',
          { digest: proposal.digest, quantities },
        );
        if (!root.isConnected || version !== revision) return;
        result.innerHTML = `
          <div class="scenario-metrics"><div><span>Unidades del escenario</span><strong>${values.units.toLocaleString('es-ES')}</strong></div><div><span>Diferencia de ingresos</span><strong>${signedMoney(values.revenueDeltaCents)}</strong></div></div>
          <div class="table-wrap"><table><caption>Comparación del escenario · EUR</caption><thead><tr><th>Concepto</th><th class="number">Antes</th><th class="number">Después</th></tr></thead><tbody>
          <tr><td>Ingresos</td><td class="number">${money(values.beforeRevenueCents)}</td><td class="number">${money(values.afterRevenueCents)}</td></tr>
          <tr><td>Coste de productos</td><td class="number">${money(values.costCents)}</td><td class="number">${money(values.costCents)}</td></tr>
          <tr><td>Contribución bruta</td><td class="number">${money(values.beforeContributionCents)}</td><td class="number">${money(values.afterContributionCents)}</td></tr>
          <tr><td>Margen bruto agregado</td><td class="number">${percent(values.beforeMarginPercent)}</td><td class="number">${percent(values.afterMarginPercent)}</td></tr>
          </tbody></table></div>
          <p class="hint">Diferencia de contribución bruta: ${signedMoney(values.contributionDeltaCents)}. Comparación hipotética con las cantidades indicadas; no son ventas realizadas.</p>
        `;
      } catch (error) {
        if (root.isConnected && version === revision)
          result.innerHTML = '<div class="notice">' + esc(error.message) + '</div>';
      } finally {
        if (root.isConnected) {
          button.disabled = false;
          button.textContent = 'Calcular escenario';
        }
      }
    });
    return true;
  } catch (error) {
    if (root.isConnected)
      root.innerHTML =
        '<div class="notice">' +
        esc(error.message) +
        ' Puedes volver a seleccionar la propuesta para reintentar.</div>';
    return false;
  }
}
