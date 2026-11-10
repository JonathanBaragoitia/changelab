export function mountCampaigns(data, { api, esc, money, toast, onProposal }) {
  const root = document.querySelector('#screen'),
    today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  root.innerHTML =
    '<section class="heading"><div><h1>Comparar campañas.</h1><p>Compara hasta tres alternativas usando cantidades elegidas. No predice ventas ni programa la activación o retirada de precios.</p></div></section><section class="panel panel-body"><form id="campaign-form"><label class="field">Nombre de campaña<input name="title" minlength="5" maxlength="150" required placeholder="Campaña de interior"></label><label class="field">Categoría<select name="category">' +
    data.categories.map((c) => '<option>' + esc(c) + '</option>').join('') +
    '</select></label><label class="field">Desde<input name="from" type="date" value="' +
    today +
    '" required></label><label class="field">Hasta<input name="to" type="date" value="' +
    today +
    '" required></label><div class="field-row">' +
    [1, 2, 3]
      .map(
        (i) =>
          '<label class="field">Alternativa ' +
          i +
          ' (%)<input name="percent' +
          i +
          '" type="number" min="-50" max="50" step="0.01" ' +
          (i === 1 ? 'required' : '') +
          ' placeholder="' +
          (i === 1 ? '-5' : i === 2 ? '-10' : 'Opcional') +
          '"></label>',
      )
      .join('') +
    '</div><h2>Cantidades del escenario</h2><p>El ejemplo propone 10 unidades por artículo. Cámbialas para representar tu hipótesis.</p><div id="campaign-quantities"></div><button type="button" class="chip" id="campaign-example">Cargar ejemplo sin guardar</button><button class="primary" type="submit">Comparar sin publicar</button></form></section><section class="panel panel-body" id="campaign-results" aria-live="polite"><p>Completa alternativas y cantidades para ver la comparación.</p></section>';
  const form = root.querySelector('#campaign-form'),
    output = root.querySelector('#campaign-results');
  const quantities = () => {
    root.querySelector('#campaign-quantities').innerHTML = data.products
      .filter((p) => p.category === form.elements.category.value)
      .map(
        (p) =>
          '<label class="field">' +
          esc(p.name) +
          '<input data-campaign-product="' +
          esc(p.id) +
          '" type="number" min="0" max="100000" step="1" value="10" required></label>',
      )
      .join('');
    output.innerHTML = '<p>Vuelve a comparar tras cambiar la categoría.</p>';
  };
  root.querySelector('#campaign-example').onclick = () => {
    form.elements.title.value = 'Comparativa de precios de prueba';
    form.elements.percent1.value = '-5';
    form.elements.percent2.value = '5';
    form.elements.percent3.value = '';
    quantities();
  };
  form.elements.category.onchange = quantities;
  quantities();
  let comparing = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (comparing) return;
    comparing = true;
    const payload = {
      title: form.elements.title.value,
      category: form.elements.category.value,
      from: form.elements.from.value,
      to: form.elements.to.value,
      alternatives: [1, 2, 3]
        .map((i) => form.elements['percent' + i].value)
        .filter((v) => v !== '')
        .map((v) => Math.round(Number(v) * 100)),
      quantities: [...form.querySelectorAll('[data-campaign-product]')].map((c) => ({
        productId: c.dataset.campaignProduct,
        quantity: Number(c.value),
      })),
    };
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    output.textContent = 'Calculando escenarios…';
    try {
      const report = await api('/api/campaigns/compare', payload);
      if (!output.isConnected) return;
      output.innerHTML =
        '<h2>' +
        esc(report.title) +
        '</h2><p>' +
        esc(report.from) +
        ' — ' +
        esc(report.to) +
        ' · ' +
        esc(report.scope) +
        '</p>' +
        report.alternatives
          .map(
            (a, index) =>
              '<article class="order"><h3>Alternativa ' +
              (index + 1) +
              ' · ' +
              a.basisPoints / 100 +
              ' % · ' +
              (a.findings.length ? 'Bloqueada por reglas' : 'Simulación válida') +
              '</h3><p>Con las mismas ' +
              a.totals.units +
              ' unidades: ingresos netos ' +
              money(a.totals.beforeRevenueCents) +
              ' → ' +
              money(a.totals.afterRevenueCents) +
              '; contribución bruta ' +
              money(a.totals.beforeContributionCents) +
              ' → ' +
              money(a.totals.afterContributionCents) +
              '</p>' +
              a.findings.map((f) => '<p>' + esc(f.message) + '</p>').join('') +
              '<div class="table-wrap"><table><thead><tr><th>Artículo</th><th>Precio antes</th><th>Precio simulado</th><th>Unidades de partida</th><th>Unidades para mantener contribución bruta positiva</th></tr></thead><tbody>' +
              a.rows
                .map(
                  (row) =>
                    '<tr><td>' +
                    esc(row.name) +
                    '</td><td>' +
                    money(row.beforeCents) +
                    '</td><td>' +
                    money(row.afterCents) +
                    '</td><td>' +
                    row.quantity +
                    '</td><td>' +
                    (row.unitsToMaintainGross === null
                      ? 'No calculable'
                      : row.unitsToMaintainGross) +
                    '</td></tr>',
                )
                .join('') +
              '</tbody></table></div><p>No incluye gastos ni impuestos. Las unidades necesarias no son una estimación de demanda.</p>' +
              (data.actor.role === 'editor' && !a.findings.length
                ? '<form data-campaign-alternative="' +
                  index +
                  '"><label class="field">Motivo para preparar propuesta<textarea name="reason" required minlength="5" maxlength="300"></textarea></label><button>Preparar propuesta para revisión</button></form>'
                : '') +
              '</article>',
          )
          .join('') +
        '<div id="campaign-created" role="status"></div>';
      output.querySelectorAll('[data-campaign-alternative]').forEach(
        (f) =>
          (f.onsubmit = async (event) => {
            event.preventDefault();
            const button = f.querySelector('button');
            button.disabled = true;
            try {
              const p = await api('/api/campaigns/proposal', {
                campaign: payload,
                contextHash: report.contextHash,
                index: Number(f.dataset.campaignAlternative),
                reason: f.elements.reason.value,
              });
              const result = output.querySelector('#campaign-created');
              result.innerHTML =
                '<p>Propuesta guardada sin publicar. Las fechas no programan cambios automáticos.</p><button>Revisar propuesta creada</button>';
              result.querySelector('button').onclick = () => onProposal(p.id);
              button.textContent = 'Propuesta preparada';
            } catch (e) {
              toast(e.message, true);
              button.disabled = false;
            }
          }),
      );
    } catch (e) {
      if (output.isConnected) output.textContent = e.message;
    } finally {
      comparing = false;
      if (button.isConnected) button.disabled = false;
    }
  };
}
