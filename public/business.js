import { mountStockAnalysis } from '/stock-analysis.js';
export async function mountBusiness(data, { api, esc, toast, onProposal, reload, navigate }) {
  const root = document.querySelector('#screen');
  root.innerHTML =
    '<section class="heading"><div><div class="eyebrow">IA CON CONTEXTO DEL NEGOCIO</div><h1>Análisis comercial.</h1><p>Stock, ventas y oportunidades. Revisa lo importante y abre los detalles cuando los necesites.</p></div></section><section id="business-body" class="panel panel-body">Cargando datos…</section>';
  try {
    root
      .querySelector('.heading')
      .insertAdjacentHTML(
        'afterend',
        '<nav class="tariff-tabs" aria-label="Opciones de análisis"><button type="button" aria-pressed="true"><span>Análisis comercial<small>Stock, ventas y ayuda IA</small></span></button><button type="button" id="business-followup"><span>Evolución tras cambiar precios<small>Comparar ventas antes y después</small></span></button></nav>',
      );
    root.querySelector('#business-followup').onclick = () => navigate('followup');
    const result = await api('/api/business-context'),
      box = root.querySelector('#business-body');
    if (!box) return;
    const c = result.context;
    const history = document.createElement('section');
    const renderHistory = async () => {
      try {
        const response = await api('/api/business-runs');
        if (!history.isConnected) return;
        const labels = {
          running: 'Sin terminar',
          accepted: 'Validado por reglas',
          rejected: 'Respuesta rechazada',
          failed: 'Fallo del análisis',
          stale: 'Datos cambiaron',
          skipped: 'Sin señales · modelo no invocado',
        };
        history.innerHTML =
          '<details class="commercial-disclosure"><summary><span>Historial de análisis IA</span><span class="disclosure-action">Ver ejecuciones</span></summary><div class="disclosure-body"><p>Últimas 20 ejecuciones. Validado por reglas no significa recomendación útil ni resultado comercial demostrado. Una ejecución sin terminar puede haber sido interrumpida.</p>' +
          response.runs
            .map(
              (run) =>
                '<details class="order"><summary>' +
                esc(new Date(run.createdAt).toLocaleString('es-ES')) +
                ' · ' +
                esc(labels[run.status] ?? run.status) +
                '</summary><p>Modelo configurado: ' +
                esc(run.model) +
                ' · ' +
                esc(run.promptVersion) +
                ' · ' +
                (run.durationMs === null ? 'Duración pendiente' : esc(run.durationMs) + ' ms') +
                '</p><p>Periodo: ' +
                esc(run.context.from) +
                ' — ' +
                esc(run.context.to) +
                ' · Contexto ' +
                esc(run.contextHash) +
                (run.contextHash === result.contextHash
                  ? ' · Coincide con los datos al abrir esta vista'
                  : ' · Instantánea histórica') +
                '</p><p>Resultado: ' +
                esc(run.errorCode ?? (run.ids.length ? 'Señales seleccionadas' : 'Sin selección')) +
                '</p>' +
                run.ids
                  .map((id) => {
                    const signal = run.context.opportunities.find((o) => o.id === id);
                    return (
                      '<p>' + esc(signal ? signal.category + ' · ' + signal.message : id) + '</p>'
                    );
                  })
                  .join('') +
                '<details><summary>Señales disponibles en esa ejecución</summary>' +
                run.context.opportunities
                  .map((o) => '<p>' + esc(o.id + ' · ' + o.category + ' · ' + o.message) + '</p>')
                  .join('') +
                '</details></details>',
            )
            .join('');
        if (!response.runs.length)
          history.innerHTML += '<p>Todavía no hay ejecuciones registradas.</p>';
        history.innerHTML += '</div></details>';
      } catch (error) {
        if (history.isConnected)
          history.textContent = 'No se pudo cargar el historial: ' + error.message;
      }
    };
    const rows = (items) =>
      items
        .map(
          (o, i) =>
            '<article class="commercial-signal"><h3>' +
            (i + 1) +
            '. ' +
            esc(o.category) +
            '</h3><p>' +
            esc(o.message) +
            '</p><details class="signal-source"><summary>Ver referencia</summary><small>Señal: ' +
            esc(o.id) +
            '</small></details></article>',
        )
        .join('') || '<p>No hay señales seleccionadas.</p>';
    box.innerHTML =
      '<details class="commercial-disclosure"><summary><span>Resumen por categoría</span><span class="disclosure-action">Ver datos</span></summary><div class="disclosure-body"><p>Periodo: ' +
      esc(c.from) +
      ' — ' +
      esc(c.to) +
      '. ' +
      esc(c.scope) +
      '</p><div class="table-wrap"><table><thead><tr><th>Categoría</th><th>Stock</th><th>Unidades vendidas</th><th>Artículos agotados</th></tr></thead><tbody>' +
      c.categories
        .map(
          (row) =>
            '<tr><td>' +
            esc(row.category) +
            '</td><td>' +
            row.stock +
            '</td><td>' +
            row.unitsSold +
            '</td><td>' +
            row.outOfStock +
            '</td></tr>',
        )
        .join('') +
      '</tbody></table></div></div></details><details class="commercial-disclosure"><summary><span>Señales comerciales <span class="commercial-count">' +
      c.opportunities.length +
      '</span></span><span class="disclosure-action">Abrir señales</span></summary><div class="disclosure-body signal-grid">' +
      rows(c.opportunities) +
      '</div></details><section class="commercial-ai"><div><h2>Prioriza tu próxima revisión</h2><p>Ordena las señales con el modelo local.</p></div><div>' +
      '<button id="business-rank" class="primary" ' +
      (!data.planner.available || !c.opportunities.length ? 'disabled' : '') +
      '>Priorizar con IA local</button><p>' +
      esc(data.planner.message) +
      '</p></div></section><div id="business-priorities" aria-live="polite"></div>';
    const eligible = c.opportunities.filter((o) =>
      ['stock-without-recorded-sales', 'margin-under-25'].includes(o.code),
    );
    if (data.actor.role === 'editor' && eligible.length) {
      const section = document.createElement('section');
      section.innerHTML =
        '<details class="commercial-disclosure simulation-builder"><summary><span>Simular un cambio de precios<small>Compara el efecto antes de tomar una decisión.</small></span><span class="disclosure-action">Preparar simulación</span></summary><div class="disclosure-body"><p>El cambio afecta a todos los artículos activos de la categoría. Comprobaremos los márgenes antes de continuar.</p><form id="business-simulate" class="commercial-form"><label class="span-full">1. Qué quieres revisar<select name="signalId" required>' +
        eligible
          .map(
            (o) =>
              '<option value="' +
              esc(o.id) +
              '">' +
              esc(
                o.category +
                  ' · ' +
                  (o.code === 'margin-under-25'
                    ? 'Revisar margen'
                    : 'Revisar artículos sin ventas'),
              ) +
              '</option>',
          )
          .join('') +
        '</select></label><label>2. Variación de precio (%)<input name="percent" type="number" min="-50" max="50" step="0.01" required placeholder="Por ejemplo, -5"></label><label>3. Motivo de la revisión<textarea rows="3" placeholder="Explica qué quieres comprobar…" name="reason" minlength="5" maxlength="300" required></textarea></label><div class="simulation-footer span-full"><small>Una simulación no cambia los precios ni garantiza más ventas.</small><button class="primary" type="submit">Crear simulación</button></div></form><div id="business-created" aria-live="polite"></div></div></details>';
      box.append(section);
      section.querySelector('form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget,
          button = form.querySelector('button'),
          values = new FormData(form);
        button.disabled = true;
        section.querySelector('#business-created').textContent = '';
        try {
          const proposal = await api('/api/business-proposals', {
            contextHash: result.contextHash,
            signalId: values.get('signalId'),
            basisPoints: Math.round(Number(values.get('percent')) * 100),
            reason: values.get('reason'),
          });
          if (!section.isConnected) return;
          const output = section.querySelector('#business-created');
          output.innerHTML =
            '<p>Simulación creada. ' +
            (proposal.status === 'blocked'
              ? 'Bloqueada por las comprobaciones de seguridad.'
              : 'Pendiente de revisión.') +
            ' Los precios siguen sin cambiar.</p><button type="button">Revisar propuesta</button>';
          output.querySelector('button').onclick = () => onProposal(proposal.id);
        } catch (error) {
          toast(error.message, true);
        } finally {
          if (button.isConnected) button.disabled = false;
        }
      });
    }
    const stockPanel = document.createElement('section');
    stockPanel.className = 'panel panel-body';
    box.before(stockPanel);
    mountStockAnalysis(stockPanel, {
      api,
      esc,
      toast,
      editor: data.actor.role === 'editor',
      onChanged: reload,
    });
    box.append(history);
    await renderHistory();
    box.querySelector('#business-rank').addEventListener('click', async (event) => {
      const button = event.target;
      button.disabled = true;
      box.querySelector('#business-priorities').innerHTML = '';
      button.textContent = 'Priorizando con el modelo local…';
      try {
        const ranked = await api('/api/business-priorities', { contextHash: result.contextHash });
        if (!box.isConnected) return;
        box.querySelector('#business-priorities').innerHTML =
          '<h2>Orden propuesto por IA · revisar antes de actuar</h2>' +
          rows(ranked.opportunities) +
          '<p>Las descripciones y cifras proceden del servidor. El modelo solo selecciona y ordena señales. No ha demostrado mejorar decisiones comerciales.</p>';
      } catch (error) {
        toast(error.message, true);
      } finally {
        await renderHistory();
        if (button.isConnected) {
          button.disabled = false;
          button.textContent = 'Priorizar con IA local';
        }
      }
    });
  } catch (error) {
    const box = root.querySelector('#business-body');
    if (box) box.textContent = error.message;
  }
}
