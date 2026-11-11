import { mountMail } from '/mail.js';
import { refreshStaffNotices } from '/staff-notices.js';
import '/disclosures.js';
import { sectionFromUrl, sectionUrl } from '/navigation.js';
import { mountApprovals } from '/approvals.js';
import { mountOperations } from '/operations.js';
import { mountTariffs } from '/tariffs.js';
import { mountCampaigns } from '/campaigns.js';
import { mountBilling } from '/billing.js';
import { mountWarehouse } from '/warehouse.js';
import { mountTransport } from '/transport.js';
import { mountReconciliation } from '/reconciliation.js';
import { mountBusiness } from '/business.js';
import { mountSuppliers } from '/suppliers.js';
import { mountCatalogManagement } from '/catalog-management.js';
import { mountCash } from '/cash.js';
import { mountEconomics } from '/economics.js';
import { mountOrders } from '/shop.js';
import { auditRows, auditPage } from '/audit.js';
import { mountImpact, clearImpactState } from '/review.js';
const $ = (s) => document.querySelector(s);
const esc = (v) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const money = (c) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(c / 100);
const date = (v) =>
  new Date(v).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
const labels = {
  ready: 'Lista para revisión',
  blocked: 'Bloqueada',
  applied: 'Publicada',
  stale: 'Datos desactualizados',
};
let data,
  tab = sectionFromUrl(location.href),
  selected = null,
  busy = false,
  toastTimer;
let aiResult = null;
let aiInstruction = '';
let actor = null;
let proposalFilter = 'all';
let csrf = null;
let auditFilter = { from: '', to: '', query: '', page: 1 };
let loadSequence = 0;
sessionStorage.removeItem('changelab-actor');
async function api(path, body) {
  let response;
  try {
    response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(
      'No se pudo conectar con la aplicación local. Comprueba que el servidor siga abierto y vuelve a intentarlo.',
    );
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      'La aplicación devolvió una respuesta no válida. Actualiza los datos y vuelve a intentarlo.',
    );
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') showLogin(false);
    throw new Error(value.message || 'No se pudo completar la operación.');
  }
  return value;
}
function toast(message, error = false) {
  const box = $('#toast');
  clearTimeout(toastTimer);
  box.setAttribute('role', error ? 'alert' : 'status');
  box.textContent = message;
  box.className = error ? 'error' : '';
  box.hidden = false;
  toastTimer = setTimeout(() => {
    box.hidden = true;
  }, 6500);
}
async function load() {
  const sequence = ++loadSequence,
    next = await api('/api/workspace');
  if (sequence !== loadSequence || !csrf) return;
  data = next;
  $('#scenario-label').hidden = !data.scenario;
  $('#scenario-label').textContent = data.scenario ?? '';
  actor = data.actor.id;
  $('#account-name').removeAttribute('href');
  $('#account-name').classList.remove('chip');
  $('#account-name').textContent =
    data.actor.name +
    ' · ' +
    (data.actor.profile === 'warehouse'
      ? 'Almacén'
      : data.actor.businessRole === 'owner'
        ? 'Dirección'
        : data.actor.businessRole === 'office'
          ? 'Oficina'
          : { editor: 'Edición', reviewer: 'Revisión', viewer: 'Lectura' }[data.actor.role]);
  const dispatchNotices = data.sales.filter((s) => s.status === 'prepared' && !s.dispatch).length;
  $('#dispatch-notice-count').textContent = String(dispatchNotices);
  $('#dispatch-notice-count').hidden = !dispatchNotices;
  $('#logout').hidden = false;
  $('#refresh').disabled = false;
  document.querySelectorAll('[data-tab]').forEach((button) => (button.disabled = false));
  $('#stock-warning-count').textContent = String(data.stockReviewCount ?? 0);
  $('#stock-warning-count').hidden = !data.stockReviewCount;
  $('#avatar').textContent = data.actor.initials;
  $('#planner-status').textContent = data.planner.message;
  $('#nav-count').textContent = data.proposals.filter(
    (p) => p.status === 'ready' && !stale(p),
  ).length;
  const warehouseSections = ['warehouse', 'transport'];
  if (data.actor.profile === 'warehouse' && !warehouseSections.includes(tab)) tab = 'warehouse';
  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.hidden =
      data.actor.profile === 'warehouse' && !warehouseSections.includes(button.dataset.tab);
  });
  render();
  history.replaceState(null, '', sectionUrl(location.href, tab));
  await refreshNotices();
}
function stale(p) {
  return (
    p.status === 'ready' &&
    p.changes.some((c) => {
      const current = data.products.find((x) => x.id === c.productId);
      return (
        !current ||
        current.version !== c.baseVersion ||
        current.priceCents !== c.beforeCents ||
        (c.costCents !== undefined && current.costCents !== c.costCents)
      );
    })
  );
}
function badge(p) {
  const status = stale(p) ? 'stale' : p.status;
  return '<span class="badge ' + status + '">' + labels[status] + '</span>';
}
function heading(eyebrow, title, subtitle) {
  return (
    '<section class="heading"><div><div class="eyebrow">' +
    eyebrow +
    '</div><h1>' +
    title +
    '</h1><p>' +
    subtitle +
    '</p></div></section>'
  );
}
function stats() {
  const waiting = data.proposals.filter((p) => p.status === 'ready' && !stale(p)).length;
  return (
    '<section class="stats" aria-label="Resumen"><div class="stat"><div class="stat-label">◉ &nbsp; Pendientes de revisión</div><strong>' +
    waiting +
    '</strong><small>Propuestas con datos vigentes</small></div><div class="stat"><div class="stat-label">⊘ &nbsp; Bloqueadas por reglas</div><strong>' +
    data.proposals.filter((p) => p.status === 'blocked').length +
    '</strong><small>Sin cambios en el catálogo</small></div><div class="stat"><div class="stat-label">↗ &nbsp; Publicadas</div><strong>' +
    data.proposals.filter((p) => p.status === 'applied').length +
    '</strong><small>Con aprobación registrada</small></div></section>'
  );
}
function render() {
  document.querySelectorAll('[data-tab]').forEach((b) => {
    const parent = { incidents: 'returns', imports: 'purchases', followup: 'business' }[tab] ?? tab;
    b.classList.toggle('active', b.dataset.tab === parent);
    b.setAttribute('aria-current', b.dataset.tab === parent ? 'page' : 'false');
  });
  $('#crumb').textContent = {
    proposals: 'Propuestas',
    approvals: 'Solicitudes y aprobaciones',
    tariffs: 'Tarifas de proveedores',

    campaigns: 'Campañas',
    shop: 'Pedidos',
    shipping: 'Envíos',
    warehouse: 'Almacén',
    transport: 'Roturas en transporte',
    billing: 'Facturación',
    reconciliation: 'Comprobación de pedidos y cobros',
    cash: 'Cobros y pagos',
    economics: 'Control económico',
    suppliers: 'Proveedores',
    business: 'Análisis comercial IA',
    daily: 'Bandeja diaria',
    purchases: 'Compras',
    returns: 'Devoluciones y reclamaciones',
    followup: 'Resultados',
    incidents: 'Incidencias',
    imports: 'Albaranes de entrada',
    catalog: 'Catálogo',
    audit: 'Historial',
    mail: 'Correos a clientes',
  }[tab];
  if (['daily', 'purchases', 'returns', 'followup', 'incidents', 'imports'].includes(tab))
    return mountOperations(tab, data, {
      api,
      esc,
      money,
      toast,
      reload: load,
      navigate,
    });
  if (tab === 'mail') return mountMail(data, { api, esc, toast });
  if (tab === 'approvals') return mountApprovals(data, { api, esc, money, toast });
  if (tab === 'tariffs') return mountTariffs(data, { api, esc, money, toast, reload: load });
  if (tab === 'campaigns')
    return mountCampaigns(data, {
      api,
      esc,
      money,
      toast,
      navigate,
      onProposal: async (id) => {
        selected = id;
        tab = 'proposals';
        await load();
      },
    });
  if (tab === 'business')
    return mountBusiness(data, {
      navigate,
      reload: load,
      api,
      esc,
      toast,
      onProposal: async (id) => {
        tab = 'proposals';
        selected = id;
        await load();
      },
    });
  if (tab === 'suppliers') return mountSuppliers(data, { api, esc, toast, reload: load });
  if (tab === 'cash') return mountCash(data, { api, esc, money, toast });
  if (tab === 'economics') return mountEconomics(data, { api, esc, money, toast });
  if (tab === 'billing') return mountBilling(data, { api, esc, money, toast, reload: load });
  if (tab === 'transport') return mountTransport(data, { api, esc, toast, reload: load });
  if (tab === 'warehouse')
    return mountWarehouse(data, { api, esc, money, toast, reload: load, navigate });
  if (tab === 'reconciliation') {
    $('#screen').innerHTML =
      '<section class="heading"><div><div class="eyebrow">REVISIÓN COMERCIAL</div><h1>Comprobación de pedidos y cobros.</h1><p>Compara pedidos, documentos y cobros sin ejecutar correcciones.</p></div></section><section class="panel panel-body" id="reconciliation-host"></section>';
    return mountReconciliation($('#reconciliation-host'), { api, esc, money, navigate });
  }
  if (tab === 'shop' || tab === 'shipping')
    return mountOrders(
      data,
      {
        api,
        toast,
        reload: load,
        esc,
        money,
        navigate,
      },
      tab === 'shipping' ? 'shipping' : 'orders',
    );
  if (tab === 'catalog') return renderCatalog();
  if (tab === 'audit') return renderAudit();
  $('#screen').innerHTML =
    heading(
      'CONTROL DE CAMBIOS',
      'Cambios con criterio.',
      'Prepara una propuesta, comprueba su impacto y publica con una segunda revisión.',
    ) +
    stats() +
    '<div class="grid"><section class="panel"><div class="panel-title"><h2>Nueva propuesta</h2><span class="step">01 / PREPARAR</span></div><form id="proposal-form" class="panel-body">' +
    '<section class="ai-planner"><div class="eyebrow">ASISTENTE LOCAL</div><label class="field">Describe el cambio<textarea id="ai-instruction" maxlength="1000" placeholder="Ej.: Sube los precios de Lavado exterior un 5 %.">' +
    esc(aiInstruction) +
    '</textarea></label><button id="interpret" class="chip" type="button" ' +
    (!data.planner.available || data.actor.role !== 'editor' ? 'disabled' : '') +
    '>Interpretar con IA</button><p class="hint">' +
    esc(data.planner.message) +
    '</p><div id="ai-result" role="status" aria-live="polite"></div></section>' +
    '<label class="field">Motivo del cambio manual<textarea id="instruction" maxlength="1000" required placeholder="Ej.: Actualizar las tarifas de Lavado exterior para la próxima campaña."></textarea></label>' +
    '<div class="field-row"><label class="field">Categoría<select id="category">' +
    data.categories.map((c) => '<option>' + esc(c) + '</option>').join('') +
    '</select></label><label class="field">Variación (%)<input id="percentage" type="number" min="-50" max="50" step="0.01" value="5" required></label></div>' +
    '<p class="hint">Puedes completar estos campos manualmente o trasladar aquí un plan interpretado. Comprueba siempre categoría y porcentaje.</p>' +
    '<div class="chips"><button class="chip" type="button" data-example="safe">↗ Subida del 5 %</button><button class="chip" type="button" data-example="blocked">⊘ Probar rebaja del 25 %</button></div>' +
    '<button class="primary" type="submit" ' +
    (data.actor.role !== 'editor' ? 'disabled' : '') +
    '>Simular propuesta <span>→</span></button>' +
    '<p class="button-note">' +
    (data.actor.role === 'editor'
      ? 'La simulación no modifica los precios.'
      : 'Necesitas una cuenta con permiso de edición para crear propuestas.') +
    '</p>' +
    '<div class="rule-list"><h3>REGLAS ACTIVAS</h3><p><span class="rule-icon">✓</span><b>Margen bruto mínimo del 20 % por producto</b></p><p><span class="rule-icon">✓</span>Los pedidos confirmados conservan su precio</p><p><span class="rule-icon">✓</span>Publicación por una persona distinta del autor</p><p><span class="rule-icon">✓</span>Revalidación de datos antes de publicar</p></div></form></section>' +
    '<section class="panel"><div class="panel-title"><h2>Bandeja de propuestas</h2><span class="subtle">' +
    data.proposals.length +
    ' en total</span></div><div class="panel-body"><label class="field">Filtrar propuestas<select id="proposal-filter"><option value="all">Todas</option><option value="ready">Listas para revisión</option><option value="stale">Datos desactualizados</option><option value="blocked">Bloqueadas</option><option value="applied">Publicadas</option></select></label><p id="proposal-filter-count" role="status"></p></div><div class="list">' +
    (data.proposals.length
      ? data.proposals
          .map(
            (p) =>
              '<button class="proposal ' +
              (selected === p.id ? 'selected' : '') +
              '" data-proposal="' +
              esc(p.id) +
              '"><span><strong>' +
              esc(p.plan.category) +
              ' · ' +
              (p.plan.basisPoints > 0 ? '+' : '') +
              (p.plan.basisPoints / 100).toLocaleString('es-ES') +
              ' %</strong><small>' +
              p.changes.length +
              ' productos · ' +
              date(p.createdAt) +
              '</small></span>' +
              badge(p) +
              '</button>',
          )
          .join('')
      : '<div class="empty"><span class="empty-symbol">▧</span>Aún no hay propuestas.<br>Simula un cambio para ver el antes y el después.</div>') +
    '</div><div id="proposal-detail"></div></section></div>';
  const applyProposalFilter = () => {
    let visible = 0;
    document.querySelectorAll('[data-proposal]').forEach((button) => {
      const p = data.proposals.find((p) => p.id === button.dataset.proposal);
      const state = stale(p) ? 'stale' : p.status;
      button.hidden = proposalFilter !== 'all' && state !== proposalFilter;
      if (!button.hidden) visible++;
    });
    $('#proposal-filter-count').textContent =
      visible + ' de ' + data.proposals.length + ' propuestas';
  };
  $('#proposal-filter').value = proposalFilter;
  $('#proposal-filter').addEventListener('change', (event) => {
    proposalFilter = event.target.value;
    applyProposalFilter();
  });
  applyProposalFilter();
  $('#proposal-form').addEventListener('submit', submit);
  $('#ai-instruction').addEventListener('input', (e) => {
    aiInstruction = e.target.value;
    aiResult = null;
    renderAI();
  });
  $('#interpret').addEventListener('click', interpret);
  renderAI();
  document.querySelectorAll('[data-example]').forEach((b) =>
    b.addEventListener('click', () => {
      const safe = b.dataset.example === 'safe';
      $('#category').value = 'Lavado exterior';
      $('#percentage').value = safe ? '5' : '-25';
      $('#instruction').value = safe
        ? 'Actualizar las tarifas de Lavado exterior en un 5 % conservando los pedidos confirmados.'
        : 'Simular una rebaja del 25 % en Lavado exterior y comprobar el margen antes de publicarla.';
    }),
  );
  document.querySelectorAll('[data-proposal]').forEach((b) =>
    b.addEventListener('click', () => {
      if (busy) return;
      selected = b.dataset.proposal;
      document
        .querySelectorAll('[data-proposal]')
        .forEach((item) => item.classList.toggle('selected', item.dataset.proposal === selected));
      renderDetail();
    }),
  );
  renderDetail();
}
function renderAI() {
  const box = $('#ai-result');
  if (!box) return;
  if (!aiResult) {
    box.innerHTML = '';
    return;
  }
  if (aiResult.kind !== 'plan') {
    box.innerHTML = '<div class="notice">' + esc(aiResult.question || aiResult.reason) + '</div>';
    return;
  }
  box.innerHTML =
    '<div class="notice"><strong>1 · Interpretado · todavía sin guardar</strong><p>' +
    esc(aiResult.explanation) +
    '</p><p>' +
    esc(aiResult.plan.category) +
    ' · ' +
    esc((aiResult.plan.basisPoints / 100).toLocaleString('es-ES')) +
    ' %</p>' +
    (aiResult.status === 'blocked'
      ? '<p>La simulación detecta incumplimientos de margen. Se conservará bloqueada.</p>'
      : '') +
    '<button id="use-plan" type="button" class="chip">Trasladar al formulario</button></div>';
  $('#use-plan').addEventListener('click', () => {
    $('#instruction').value = aiInstruction;
    $('#category').value = aiResult.plan.category;
    $('#percentage').value = aiResult.plan.basisPoints / 100;
    toast('Plan trasladado. Revisa los campos y pulsa Simular propuesta.');
  });
}
async function interpret() {
  if (busy) return;
  aiInstruction = $('#ai-instruction').value;
  if (!aiInstruction.trim()) {
    toast('Describe el cambio que quieres preparar.', true);
    return;
  }
  busy = true;
  aiResult = null;
  renderAI();
  const button = $('#interpret');
  const startingActor = actor;
  const submittedInstruction = aiInstruction;
  $('#ai-instruction').disabled = true;
  $('#refresh').disabled = true;
  button.disabled = true;
  button.textContent = 'Interpretando en tu equipo…';
  $('#logout').disabled = true;
  try {
    const result = await api('/api/plans', { instruction: submittedInstruction });
    if (actor === startingActor && aiInstruction === submittedInstruction) {
      aiResult = result;
      renderAI();
    }
  } catch (error) {
    toast(error.message, true);
  } finally {
    busy = false;
    button.disabled = !data?.planner?.available || data?.actor?.role !== 'editor';
    button.textContent = 'Interpretar con IA';
    $('#logout').disabled = !actor;
    if ($('#ai-instruction')) $('#ai-instruction').disabled = false;
    $('#refresh').disabled = !actor;
  }
}
function renderDetail() {
  const p = data.proposals.find((p) => p.id === selected);
  if (!p) {
    $('#proposal-detail').innerHTML =
      '<div class="empty">Selecciona una propuesta para revisar su impacto.</div>';
    return;
  }
  const outdated = stale(p),
    canPublish =
      (data.actor.businessRole === 'owner' ||
        (!data.actor.businessRole &&
          !data.actor.ownerApprovalRequired &&
          data.actor.role === 'reviewer')) &&
      (p.createdBy !== data.actor.id || data.actor.businessRole === 'owner') &&
      p.status === 'ready' &&
      !outdated;
  const checks = p.findings
    .map((f) => '<div class="check bad"><span>⊘</span><span>' + esc(f.message) + '</span></div>')
    .join('');
  $('#proposal-detail').innerHTML =
    '<article class="detail"><div class="detail-head"><h3>Revisión del impacto</h3>' +
    badge(p) +
    '</div><ol class="review-stages" aria-label="Estado del cambio"><li>1 · Cambio definido</li><li>2 · Simulado</li><li>' +
    (p.status === 'applied'
      ? '3 · Publicado'
      : p.status === 'blocked'
        ? '3 · Bloqueado por reglas'
        : outdated
          ? '3 · Requiere nueva simulación'
          : '3 · Pendiente de publicación') +
    '</li></ol><p class="instruction">' +
    esc(p.instruction) +
    '</p>' +
    '<div id="impact-review"><p class="hint">Cargando comparación e impacto…</p></div>' +
    '<div class="checks">' +
    (checks ||
      '<div class="check"><span>✓</span>La simulación guardada no registró incumplimientos de margen.</div>') +
    '<div class="check"><span>✓</span>Los precios de los pedidos confirmados quedan fuera del cambio.</div>' +
    (outdated
      ? '<div class="check bad"><span>⊘</span>El catálogo ha cambiado. Es necesario crear una nueva simulación.</div>'
      : '') +
    '</div>' +
    (p.status === 'ready' &&
    !(
      data.actor.businessRole === 'owner' ||
      (!data.actor.businessRole &&
        !data.actor.ownerApprovalRequired &&
        data.actor.role === 'reviewer')
    )
      ? '<div class="notice">Para publicar, otra persona debe iniciar sesión con una cuenta revisora. Tu cuenta actual no puede aprobar esta propuesta.</div>'
      : '') +
    '<div class="detail-footer"><div class="digest">Versión revisada<br><code>' +
    esc(p.digest.slice(0, 16)) +
    '…</code><br>Autor: ' +
    esc(p.createdBy) +
    '</div><button id="publish" class="primary" ' +
    'disabled' +
    '>' +
    (p.status === 'applied' ? 'Publicada ✓' : 'Aprobar y publicar →') +
    '</button></div></article>';
  const publishButton = $('#publish');
  mountImpact(p, { api, esc, money }).then((loaded) => {
    if (publishButton.isConnected) publishButton.disabled = !loaded || !canPublish || busy;
  });
  $('#publish').addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    $('#publish').disabled = true;
    try {
      await api('/api/proposals/' + encodeURIComponent(p.id) + '/publish', { digest: p.digest });
      await load();
      toast('Propuesta publicada. El catálogo y el historial ya están actualizados.');
    } catch (e) {
      toast(e.message, true);
      try {
        await load();
      } catch {}
    } finally {
      busy = false;
    }
  });
}
async function submit(event) {
  event.preventDefault();
  if (busy) return;
  const percentage = Number($('#percentage').value);
  if (!Number.isFinite(percentage) || percentage === 0) {
    toast('Indica un porcentaje distinto de cero.', true);
    return;
  }
  const body = {
    instruction: $('#instruction').value,
    plan: { category: $('#category').value, basisPoints: Math.round(percentage * 100) },
  };
  busy = true;
  const button = $('#proposal-form button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Comprobando reglas…';
  try {
    const p = await api('/api/proposals', body);
    selected = p.id;
    await load();
    toast(
      p.status === 'blocked'
        ? 'Simulación bloqueada: revisa los márgenes. No se ha cambiado ningún precio.'
        : 'Simulación lista. Revisa los cambios antes de publicar.',
    );
  } catch (e) {
    toast(e.message, true);
    button.disabled = false;
    button.textContent = 'Simular propuesta →';
  } finally {
    busy = false;
  }
}
function renderCatalog() {
  $('#screen').innerHTML =
    heading(
      'DATOS DEL ESPACIO',
      'El catálogo, al día.',
      'Suministros para talleres y centros de detailing: lavado, interior, llantas, cristales y acabado.',
    ) +
    '<section class="panel"><div class="catalog-head"><p>' +
    data.products.length +
    ' productos · Importes en EUR</p><span class="step">CATÁLOGO FICTICIO</span></div><div class="catalog-table table-wrap"><table><thead><tr><th>Producto</th><th>Categoría</th><th class="number">Coste</th><th class="number">Precio</th><th class="number">Margen</th><th class="number">Versión</th></tr></thead><tbody>' +
    data.products
      .map(
        (p) =>
          '<tr><td>' +
          esc(p.name) +
          '<br><span class="sku">' +
          esc(p.sku) +
          '</span></td><td>' +
          esc(p.category) +
          '</td><td class="number">' +
          money(p.costCents) +
          '</td><td class="number new-price">' +
          money(p.priceCents) +
          '</td><td class="number">' +
          (((p.priceCents - p.costCents) * 100) / p.priceCents).toFixed(1) +
          ' %</td><td class="number">v' +
          p.version +
          '</td></tr>',
      )
      .join('') +
    '</tbody></table></div>' +
    data.orders
      .map(
        (o) =>
          '<article class="order"><h3>' +
          esc(o.id) +
          ' <span class="badge applied">Confirmado</span></h3><p>Estos importes se fijaron al confirmar el pedido. El pedido conserva los artículos archivados.</p><div class="table-wrap"><table><thead><tr><th>Producto</th><th class="number">Unidades</th><th class="number">Precio confirmado</th></tr></thead><tbody>' +
          o.lines
            .map(
              (l) =>
                '<tr><td>' +
                esc(l.productName) +
                '</td><td class="number">' +
                l.quantity +
                '</td><td class="number">' +
                money(l.unitPriceCents) +
                '</td></tr>',
            )
            .join('') +
          '</tbody></table></div></article>',
      )
      .join('') +
    '</section>';
  mountCatalogManagement(data, { api, esc, toast, reload: load });
}
function renderAudit() {
  $('#screen').innerHTML =
    heading(
      'TRAZABILIDAD',
      'Qué cambió y por qué.',
      'Filtra por fecha o referencia. Los hechos se ordenan por fecha, del más reciente al más antiguo. Se consultan hasta 1.000 registros disponibles.',
    ) +
    '<section class="panel"><div class="panel-title"><h2>Registro de actividad</h2><span class="badge ' +
    (data.auditValid ? 'ready' : 'blocked') +
    '">' +
    (data.auditValid ? 'Cadena de hashes coherente' : 'Integridad no válida') +
    '</span></div>' +
    '<div class="panel-body"><form id="audit-filter" class="field-row"><label class="field">Desde<input name="from" type="date" value="' +
    esc(auditFilter.from) +
    '"></label><label class="field">Hasta<input name="to" type="date" value="' +
    esc(auditFilter.to) +
    '"></label><label class="field">Referencia o texto<input name="query" maxlength="200" value="' +
    esc(auditFilter.query) +
    '"></label><button>Filtrar</button></form><p id="audit-count" aria-live="polite"></p><div id="audit-rows"></div><div class="audit-pages"><button id="audit-prev" type="button">Anterior</button><button id="audit-next" type="button">Siguiente</button></div><p class="hint">La cadena ayuda a detectar alteraciones locales. Una persona con control de toda la base podría recalcularla; no es una firma externa.</p></div></section>';
  const draw = () => {
    const result = auditPage(data.audit, auditFilter);
    auditFilter.page = result.page;
    $('#audit-rows').innerHTML = result.total
      ? auditRows({ ...data, audit: result.events }, { esc, money, date })
      : '<p>No hay registros para estos filtros.</p>';
    $('#audit-count').textContent =
      result.total + ' registros · página ' + result.page + ' de ' + result.pages;
    $('#audit-prev').disabled = result.page === 1;
    $('#audit-next').disabled = result.page === result.pages;
  };
  $('#audit-filter').onsubmit = (e) => {
    e.preventDefault();
    const f = e.currentTarget.elements;
    if (f.from.value && f.to.value && f.from.value > f.to.value) {
      toast('La fecha inicial debe ser anterior o igual a la final.', true);
      return;
    }
    auditFilter = { from: f.from.value, to: f.to.value, query: f.query.value, page: 1 };
    draw();
  };
  $('#audit-prev').onclick = () => {
    auditFilter.page--;
    draw();
  };
  $('#audit-next').onclick = () => {
    auditFilter.page++;
    draw();
  };
  draw();
}
$('#logout').addEventListener('click', async () => {
  if (busy) return;
  try {
    await api('/api/logout', {});
    showLogin(false);
  } catch (error) {
    toast(error.message, true);
  }
});
$('#refresh').addEventListener('click', async () => {
  if (busy) return;
  try {
    await load();
    toast('Datos actualizados.');
  } catch (e) {
    toast(e.message, true);
  }
});
$('#menu-toggle').addEventListener('click', () => {
  const sidebar = document.querySelector('.sidebar'),
    open = sidebar.toggleAttribute('data-menu-open');
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
  $('#menu-toggle').textContent = open ? 'Ocultar navegación' : 'Mostrar navegación';
});
async function navigate(area) {
  if (busy || !data) return;
  const previous = tab;
  tab = area;
  try {
    history.pushState(null, '', sectionUrl(location.href, area));
    await load();
    document.querySelector('.sidebar').removeAttribute('data-menu-open');
    $('#menu-toggle').setAttribute('aria-expanded', 'false');
    $('#menu-toggle').textContent = 'Mostrar navegación';
    $('#main').focus({ preventScroll: true });
  } catch (error) {
    tab = previous;
    history.replaceState(null, '', sectionUrl(location.href, previous));
    toast(error.message, true);
  }
}
window.addEventListener('popstate', async () => {
  tab = sectionFromUrl(location.href);
  if (data && csrf) {
    try {
      await load();
    } catch (error) {
      toast(error.message, true);
    }
  }
});
document
  .querySelectorAll('[data-tab]')
  .forEach((b) => b.addEventListener('click', () => navigate(b.dataset.tab)));
function showLogin(setupRequired) {
  $('#staff-notices').hidden = true;
  $('#staff-notices').innerHTML = '';

  loadSequence++;
  clearImpactState();
  actor = null;
  csrf = null;
  data = null;
  selected = null;
  aiResult = null;
  aiInstruction = '';
  tab = sectionFromUrl(location.href);
  proposalFilter = 'all';
  busy = false;
  $('#account-name').textContent = 'Iniciar sesión';
  $('#account-name').setAttribute('href', '/gestion?login=1');
  $('#account-name').classList.add('chip');
  $('#avatar').textContent = '—';
  $('#logout').hidden = true;
  $('#logout').disabled = false;
  $('#refresh').disabled = true;
  $('#nav-count').textContent = '0';
  $('#stock-warning-count').hidden = true;
  $('#planner-status').textContent = 'Inicia sesión para acceder al espacio.';
  document.querySelectorAll('[data-tab]').forEach((button) => (button.disabled = true));
  $('#screen').innerHTML =
    '<section class="login-panel panel"><div class="panel-title"><h1>Accede a Norte Gestión</h1></div><div class="panel-body"><p>Tu cuenta determina qué puedes preparar, consultar o aprobar.</p>' +
    (setupRequired
      ? '<div class="notice"><strong>Primera configuración</strong><p>Todavía no hay cuentas. Ejecuta create-user.cmd en la carpeta changelab. Crea una cuenta de Oficina (office) y otra de Dirección (owner) con tus propias contraseñas.</p></div>'
      : '') +
    '<form id="login-form"><label class="field">Usuario<input name="username" autocomplete="username" minlength="3" maxlength="64" required></label><label class="field">Contraseña<input name="password" type="password" autocomplete="current-password" maxlength="128" required></label><button type="submit" class="primary">Entrar</button><p id="login-error" role="alert"></p></form></div></section>';
  $('#login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target,
      button = form.querySelector('button');
    button.disabled = true;
    $('#login-error').textContent = '';
    try {
      const session = await api('/api/login', {
        username: form.elements.username.value,
        password: form.elements.password.value,
      });
      form.elements.password.value = '';
      csrf = session.csrf;
      await load();
    } catch (error) {
      form.elements.password.value = '';
      $('#login-error').textContent = error.message;
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  });
}
async function start() {
  const session = await api('/api/session');
  if (session.actor) {
    csrf = session.csrf;
    await load();
  } else showLogin(session.setupRequired);
}
function handleStartFailure(error) {
  // A failed initial request must never remove the way to sign in or retry.
  if (!$('#login-form')) showLogin(false);
  $('#login-error').textContent = error.message;
  toast(error.message, true);
}
$('#account-name').addEventListener('click', async (event) => {
  if (!event.currentTarget.hasAttribute('href')) return;
  event.preventDefault();
  try {
    await start();
    $('#login-form input[name="username"]')?.focus();
  } catch (error) {
    handleStartFailure(error);
  }
});
start().catch(handleStartFailure);

// Native validation remains authoritative in the browser; the server validates again.
document.addEventListener(
  'invalid',
  (event) => {
    const field = event.target,
      form = field.form;
    if (!form) return;
    field.setAttribute('aria-invalid', 'true');
    let summary = form.querySelector('[data-validation-summary]');
    if (!summary) {
      summary = document.createElement('p');
      summary.dataset.validationSummary = '';
      summary.setAttribute('role', 'alert');
      summary.className = 'form-error';
      form.prepend(summary);
    }
    summary.textContent = 'Revisa los campos marcados antes de guardar. ' + field.validationMessage;
  },
  true,
);
document.addEventListener('input', (event) => {
  const field = event.target;
  if (field.validity?.valid) field.removeAttribute('aria-invalid');
  const summary = field.form?.querySelector('[data-validation-summary]');
  if (summary) summary.textContent = '';
});

setInterval(() => {
  if (csrf && data) refreshNotices();
}, 30000);

async function refreshNotices() {
  const currentCsrf = csrf,
    currentActor = data?.actor.id;
  await refreshStaffNotices({
    api,
    esc,
    navigate,
    toast,
    actorId: currentActor,
    isCurrent: () => Boolean(csrf) && csrf === currentCsrf && data?.actor.id === currentActor,
  });
}
