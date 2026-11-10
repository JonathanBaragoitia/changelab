export function mountEconomics(data, { api, esc, money, toast }) {
  const root = document.querySelector('#screen');
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  root.innerHTML =
    '<section class="heading"><div><div class="eyebrow">CONTROL ECONÓMICO · DEMOSTRACIÓN</div><h1>Resultados por periodo.</h1><p>Ventas netas y gastos registrados. El margen usa el coste de catálogo guardado al vender: todavía no valora lotes ni recalcula costes desde las compras reales. No representa cobros, pagos, contabilidad completa ni beneficio neto.</p></div></section><section class="panel panel-body"><form id="period-form"><label class="field">Desde<input name="from" type="date" value="' +
    esc(data.scenarioPeriod?.from ?? today.slice(0, 7) + '-01') +
    '" required></label><label class="field">Hasta<input name="to" type="date" value="' +
    esc(data.scenarioPeriod?.to ?? today) +
    '" required></label><button class="chip">Consultar periodo</button></form><div id="economic-results" aria-live="polite"></div></section>' +
    (data.actor.role === 'editor' && data.actor.businessRole !== 'office'
      ? '<section class="panel panel-body"><h2>Registrar gasto operativo</h2><p>No uses este formulario para compras de existencias: su coste ya se contempla al vender los artículos. La elección de IVA es de prueba y no verifica deducibilidad.</p><form id="expense-form"><label class="field">Fecha<input name="date" type="date" value="' +
        today +
        '" required></label><label class="field">Referencia única<input name="reference" maxlength="100" required placeholder="GASTO-DEMO-001"></label><label class="field">Categoría<select name="category"><option>Alquiler</option><option>Suministros</option><option>Servicios</option><option>Otros gastos operativos</option></select></label><label class="field">Concepto<input name="description" minlength="5" maxlength="300" required></label><label class="field">Base sin IVA (€)<input name="amount" type="number" min="0.01" max="1000000" step="0.01" required></label><label class="field">IVA de prueba<select name="vatRate"><option value="21">21 %</option><option value="0">0 % (solo escenario de prueba)</option></select></label><button class="primary">Registrar gasto</button></form></section>'
      : data.actor.businessRole === 'office'
        ? '<section class="panel panel-body"><h2>Gastos sujetos a autorización</h2><p>Prepara el gasto en Solicitudes y aprobaciones. Antonio lo revisa y, cuando esté aprobado, podrás registrar el justificante.</p></section>'
        : '');
  let requestId = crypto.randomUUID(),
    saving = false,
    queryVersion = 0;
  async function report() {
    const form = root.querySelector('#period-form'),
      version = ++queryVersion;
    try {
      const r = await api(
        '/api/economics?from=' +
          encodeURIComponent(form.elements.from.value) +
          '&to=' +
          encodeURIComponent(form.elements.to.value),
      );
      if (!root.querySelector('#economic-results') || version !== queryVersion) return;
      root.querySelector('#economic-results').innerHTML =
        '<h2>Resumen del periodo</h2><p>' +
        r.orders +
        ' pedidos incluidos · ' +
        r.excludedHistoricalOrders +
        ' históricos sin desglose excluidos.</p><table><tbody>' +
        [
          ['Ventas sin IVA', r.revenueCents],
          ['Coste de referencia de artículos vendidos', r.costCents],
          ['Margen bruto estimado', r.grossMarginCents],
          ['Gastos operativos sin IVA', r.expenseCents],
          ['Resultado operativo estimado y parcial', r.operatingResultCents],
        ]
          .map(([label, value]) => '<tr><th>' + label + '</th><td>' + money(value) + '</td></tr>')
          .join('') +
        '</tbody></table><h3>Gastos del periodo</h3>' +
        r.expenses
          .map(
            (e) =>
              '<article class="order"><strong>' +
              esc(e.reference) +
              ' · ' +
              esc(e.category) +
              '</strong><p>' +
              esc(e.date) +
              ' · ' +
              esc(e.description) +
              ' · Base ' +
              money(e.baseCents) +
              ' · IVA ' +
              money(e.taxCents) +
              ' · Total ' +
              money(e.totalCents) +
              '</p>' +
              (data.actor.role === 'editor' && data.actor.businessRole !== 'office'
                ? '<form data-cancel-expense="' +
                  esc(e.requestId) +
                  '"><label>Motivo de anulación<input name="reason" required minlength="5" maxlength="300"></label><button>Anular gasto erróneo</button></form>'
                : '') +
              '</article>',
          )
          .join('') +
        '<h3>Gastos anulados del periodo</h3><p>Conservados para consulta; excluidos del resultado. No implica devolución de dinero.</p>' +
        r.cancelledExpenses
          .map(
            (e) =>
              '<article class="order"><strong>' +
              esc(e.reference) +
              ' · Anulado</strong><p>Base original ' +
              money(e.baseCents) +
              ' · Motivo: ' +
              esc(e.cancellation.reason) +
              ' · ' +
              esc(e.cancellation.createdAt) +
              '</p></article>',
          )
          .join('');
      root.querySelectorAll('[data-cancel-expense]').forEach((form) =>
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          const button = form.querySelector('button');
          button.disabled = true;
          try {
            await api(
              '/api/expenses/' + encodeURIComponent(form.dataset.cancelExpense) + '/cancel',
              { reason: form.elements.reason.value },
            );
            await report();
            toast('Gasto anulado. Original conservado.');
          } catch (error) {
            toast(error.message, true);
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        }),
      );
    } catch (error) {
      toast(error.message, true);
    }
  }
  root.querySelector('#period-form').addEventListener('submit', (event) => {
    event.preventDefault();
    report();
  });
  const form = root.querySelector('#expense-form');
  if (form) {
    form.addEventListener('input', () => (requestId = crypto.randomUUID()));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      saving = true;
      const f = form.elements,
        payload = {
          requestId,
          date: f.date.value,
          reference: f.reference.value,
          category: f.category.value,
          description: f.description.value,
          baseCents: Math.round(Number(f.amount.value) * 100),
          vatRate: Number(f.vatRate.value),
        };
      [...f].forEach((control) => (control.disabled = true));
      try {
        await api('/api/expenses', payload);
        form.reset();
        f.date.value = today;
        requestId = crypto.randomUUID();
        await report();
        toast('Gasto registrado. No implica que esté pagado.');
      } catch (error) {
        toast(error.message, true);
      } finally {
        saving = false;
        [...f].forEach((control) => (control.disabled = false));
      }
    });
  }
  report();
}
