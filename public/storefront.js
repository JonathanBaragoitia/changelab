if (location.hash === '#orders') location.replace('/mis-pedidos');
if (location.hash === '#basket') location.replace('/carrito');
import { BASKET_LINE_LIMIT, basketPriceChanges, readBasket, saveBasket } from '/basket-storage.js';
import { searchProducts, mountCatalogAutocomplete } from '/catalog-search.js';
import { showPaymentSummary } from '/payment-summary.js';
import { deliveryEstimate } from '/order-tracking.js';
import '/disclosures.js';
import { mountShoppingAssistant } from '/shopping-assistant.js';
const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const money = (cents) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
let catalogState = 'loading',
  catalogError = '';
let products = [],
  cart = new Map(),
  csrf,
  busy = false,
  requestId = crypto.randomUUID();
const restoredBasket = readBasket();
if (restoredBasket) {
  cart = new Map(restoredBasket.lines.map((line) => [line.productId, line]));
  requestId = restoredBasket.requestId;
}
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
      'No se pudo conectar con la tienda local. Comprueba el servidor y vuelve a intentarlo.',
    );
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error('La tienda devolvió una respuesta no válida. Vuelve a cargar la página.');
  }
  if (!response.ok)
    throw Object.assign(new Error(value.message || 'No se pudo completar la operación.'), {
      code: value.error,
    });
  return value;
}
function addProduct(id, feedback = $('#message')) {
  if (busy || catalogState !== 'ready') return false;
  const product = products.find((p) => p.id === id);
  if (!product) return false;
  const previous = cart.get(id);
  const quantity = (previous?.quantity ?? 0) + 1;
  if (quantity > Math.min(100, product.quantity)) {
    feedback.textContent = 'No quedan más unidades disponibles.';
    return false;
  }
  if (!previous && cart.size >= BASKET_LINE_LIMIT) {
    feedback.textContent = 'El carrito admite hasta ' + BASKET_LINE_LIMIT + ' productos distintos.';
    return false;
  }
  cart.set(id, {
    productId: id,
    quantity,
    expectedPriceCents: previous?.expectedPriceCents ?? product.priceCents,
  });
  requestId = crypto.randomUUID();
  renderCart();
  $('#message').textContent = product.name + ' añadido al carrito.';
  return true;
}
function renderProducts() {
  if (catalogState !== 'ready') {
    $('#product-list').innerHTML =
      catalogState === 'loading'
        ? '<p role="status">Cargando catálogo…</p>'
        : '<div class="catalog-load-error" role="alert"><p>No se ha podido cargar el catálogo. Tus búsquedas no se han perdido.</p><p>' +
          esc(catalogError) +
          '</p><button type="button" id="retry-catalog" class="primary">Reintentar carga</button></div>';
    $('#retry-catalog')?.addEventListener('click', () =>
      refresh()
        .then(() => {
          $('#message').textContent = 'Catálogo actualizado.';
        })
        .catch((error) => {
          $('#message').textContent = error.message;
        }),
    );
    return;
  }
  const query = $('#search').value,
    category = $('#category').value;
  const matches = searchProducts(products, query, category);
  const openCategories = new Set(
    [...document.querySelectorAll('.catalog-category[open]')].map(
      (group) => group.dataset.category,
    ),
  );
  // Keep browsing folders open across cart updates; searches reveal their matches directly.
  $('#product-list').innerHTML =
    [...new Set(matches.map((p) => p.category))]
      .map((name) => {
        const items = matches.filter((p) => p.category === name);
        return (
          '<details class="catalog-category" data-category="' +
          esc(name) +
          '"' +
          (query.trim() || category || openCategories.has(name) ? ' open' : '') +
          '><summary><span>' +
          esc(name) +
          '</span><small>' +
          items.length +
          (items.length === 1 ? ' producto' : ' productos') +
          '</small></summary><div class="shop-products">' +
          items
            .map(
              (p) =>
                '<article class="shop-product"><small>' +
                esc(p.category) +
                '</small><h3>' +
                esc(p.name) +
                '</h3><p>' +
                esc(p.sku) +
                ' · ' +
                p.quantity +
                ' disponibles</p><p>' +
                (p.quantity
                  ? 'Entrega orientativa: 2–4 días laborables.'
                  : 'Sin stock; plazo no disponible.') +
                '</p><strong>' +
                money(p.priceCents) +
                ' sin IVA' +
                '</strong><button class="chip" data-details="' +
                esc(p.id) +
                '">Ver ficha del producto</button><button class="chip" data-add="' +
                esc(p.id) +
                '" ' +
                (!p.quantity || busy ? 'disabled' : '') +
                '>Añadir al carrito</button></article>',
            )
            .join('') +
          '</div></details>'
        );
      })
      .join('') || '<p>No hay resultados.</p>';

  document
    .querySelectorAll('[data-details]')
    .forEach((button) =>
      button.addEventListener('click', () => showProduct(button.dataset.details)),
    );
  document
    .querySelectorAll('[data-add]')
    .forEach((button) => button.addEventListener('click', () => addProduct(button.dataset.add)));
}
function renderCart() {
  const retained = saveBasket([...cart.values()], requestId);
  const count = [...cart.values()].reduce((sum, line) => sum + line.quantity, 0);
  document.querySelectorAll('[data-basket-link]').forEach((link) => {
    link.textContent = 'Carrito (' + count + ')';
  });
  if (!retained && cart.size)
    $('#message').textContent =
      'No se puede conservar el carrito al cambiar de página. Permite el almacenamiento del navegador para continuar.';
  const priceChanges =
    catalogState === 'ready' ? basketPriceChanges(cart.values(), products) : new Map();
  let total = 0,
    tax = 0;
  $('#cart').innerHTML =
    [...cart.values()]
      .map((line) => {
        const p = products.find((p) => p.id === line.productId);
        total += line.quantity * line.expectedPriceCents;
        tax += Math.round((line.quantity * line.expectedPriceCents * 21) / 100);
        return (
          '<div class="shop-cart-row"><strong>' +
          esc(p?.name || line.productId) +
          '</strong><p>' +
          line.quantity +
          ' × ' +
          money(line.expectedPriceCents) +
          '</p>' +
          (priceChanges.has(line.productId)
            ? '<p>Nuevo precio unitario: ' + money(priceChanges.get(line.productId)) + '</p>'
            : '') +
          '<button class="chip" data-increase="' +
          esc(line.productId) +
          '" ' +
          (busy || !p || line.quantity >= Math.min(100, p.quantity) ? 'disabled' : '') +
          '>Añadir una unidad</button><p>' +
          '</p><button class="chip" data-remove="' +
          esc(line.productId) +
          '" ' +
          (busy ? 'disabled' : '') +
          '>Quitar una unidad</button></div>'
        );
      })
      .join('') +
    '<p>Base sin IVA: ' +
    money(total) +
    '<br>IVA (21 %): ' +
    money(tax) +
    '</p><h3>Total: ' +
    money(total + tax) +
    '</h3>' +
    (priceChanges.size
      ? '<p role="status">Han cambiado precios. Revisa los nuevos importes antes de continuar.</p><button type="button" id="update-cart-prices" class="chip"' +
        (busy ? ' disabled' : '') +
        '>Actualizar precios del carrito</button>'
      : '');
  $('#confirm').disabled = busy || !cart.size || catalogState !== 'ready' || priceChanges.size > 0;
  $('#checkout').hidden = !cart.size;
  if (!cart.size)
    $('#cart').innerHTML =
      '<p>Tu carrito está vacío.</p><a class="chip" href="/tienda">Explorar catálogo</a>';
  $('#update-cart-prices')?.addEventListener('click', () => {
    if (busy || catalogState !== 'ready') return;
    for (const [id, price] of priceChanges) cart.get(id).expectedPriceCents = price;
    requestId = crypto.randomUUID();
    renderCart();
    $('#message').textContent = 'Precios actualizados. Comprueba el nuevo total.';
    $('#confirm').focus();
  });
  document
    .querySelectorAll('[data-increase]')
    .forEach((button) =>
      button.addEventListener('click', () => addProduct(button.dataset.increase)),
    );
  document.querySelectorAll('[data-remove]').forEach((button) =>
    button.addEventListener('click', () => {
      if (busy) return;
      const line = cart.get(button.dataset.remove);
      line.quantity--;
      if (!line.quantity) cart.delete(line.productId);
      requestId = crypto.randomUUID();
      renderCart();
    }),
  );
}
async function refresh() {
  catalogState = 'loading';
  autocomplete?.close();
  renderProducts();
  try {
    const data = await api('/api/shop');
    csrf = data.csrf;
    products = data.products;
    catalogState = 'ready';
    catalogError = '';
    renderAccount(data.account);
    const selected = $('#category').value;
    $('#category').innerHTML =
      '<option value="">Todas las categorías</option>' +
      [...new Set(products.map((p) => p.category))]
        .map((c) => '<option>' + esc(c) + '</option>')
        .join('');
    $('#category').value = selected;
    renderProducts();
    renderCart();
    autocomplete.refresh();
  } catch (error) {
    catalogState = 'error';
    catalogError = error.message;
    renderProducts();
    renderCart();
    throw error;
  }
}
const autocomplete = mountCatalogAutocomplete({
  input: $('#search'),
  list: $('#catalog-suggestions'),
  status: $('#catalog-search-status'),
  getProducts: () => products,
  getCategory: () => $('#category').value,
  isReady: () => catalogState === 'ready',
  onSelect: () => renderProducts(),
  money,
});
$('#search').addEventListener('input', renderProducts);
$('#category').addEventListener('change', () => {
  renderProducts();
  autocomplete.refresh();
});
$('#checkout').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || catalogState !== 'ready' || $('#confirm').disabled) return;
  const form = event.target;
  const customer = {
    name: form.elements.name.value,
    email: form.elements.email.value,
    address: form.elements.address.value,
  };
  const basket = [...cart.values()].map((line) => ({ ...line }));
  const checkoutRequest = requestId;
  showPaymentSummary({
    lines: [...cart.values()].map((line) => ({
      ...line,
      name: products.find((p) => p.id === line.productId)?.name ?? 'Producto',
    })),
    money,
    esc,
    onConfirm: async (method) => {
      if (busy) throw new Error('Hay otra operación en curso.');
      busy = true;
      renderCart();
      try {
        await api('/api/shop/orders', { requestId: checkoutRequest, lines: basket, customer });
        cart.clear();
        form.reset();
        requestId = crypto.randomUUID();
        $('#message').textContent =
          'Pedido confirmado. Pago simulado con ' + method + '; no se ha realizado ningún cobro.';
        try {
          await refresh();
          location.assign('/mis-pedidos');
        } catch {
          $('#message').textContent += ' No se pudo actualizar el catálogo; reintenta su carga.';
        }
      } catch (error) {
        if (error.code === 'PRICE_CHANGED') {
          try {
            await refresh();
          } catch {
            // The catalog displays a retry button if refreshing fails.
          }
        }
        throw error;
      } finally {
        busy = false;
        renderCart();
        renderProducts();
      }
    },
  });
});
renderCart();
refresh().catch((error) => {
  renderProducts();
  $('#message').textContent = error.message;
});

function showProduct(id) {
  const product = products.find((p) => p.id === id);
  if (!product) return;
  let dialog = document.querySelector('#product-dialog');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'product-dialog';
    dialog.className = 'product-dialog';
    document.body.append(dialog);
  }
  const descriptions = {
    'Lavado exterior':
      'Productos del catálogo destinados al lavado y la limpieza exterior del automóvil.',
    Interior: 'Productos destinados al cuidado de las superficies y tapicerías del habitáculo.',
    'Llantas y neumáticos': 'Productos para la limpieza y el acabado de llantas y neumáticos.',
    Cristales: 'Productos destinados a la limpieza y el cuidado de los cristales del automóvil.',
    'Protección de pintura': 'Productos del catálogo para el acabado y cuidado de la carrocería.',
    'Accesorios de limpieza':
      'Utensilios para acompañar las tareas de lavado y limpieza del vehículo.',
  };
  const format = product.name.includes(' · ')
    ? product.name.split(' · ').slice(1).join(' · ')
    : 'Según denominación del artículo';
  const tax = Math.round((product.priceCents * 21) / 100);
  dialog.innerHTML =
    '<form method="dialog"><button class="chip">Cerrar ficha</button></form><article><p class="eyebrow">' +
    esc(product.category) +
    '</p><h2 id="product-title">' +
    esc(product.name) +
    '</h2><p>' +
    esc(
      product.description ||
        descriptions[product.category] ||
        'Artículo del catálogo de limpieza del automóvil.',
    ) +
    '</p><dl><dt>Referencia</dt><dd>' +
    esc(product.sku) +
    '</dd><dt>Formato</dt><dd>' +
    esc(format) +
    '</dd><dt>Disponibilidad</dt><dd>' +
    product.quantity +
    ' unidades</dd><dt>Entrega estimada</dt><dd>' +
    esc(product.quantity ? deliveryEstimate : 'Sin stock. No hay plazo de entrega disponible.') +
    '</dd><dt>Precio sin IVA</dt><dd>' +
    money(product.priceCents) +
    '</dd><dt>IVA (21 %)</dt><dd>' +
    money(tax) +
    '</dd><dt>Precio por unidad con IVA</dt><dd><strong>' +
    money(product.priceCents + tax) +
    '</strong></dd></dl><p>Antes de utilizar el producto, consulta la etiqueta y la ficha técnica del fabricante. Sigue sus indicaciones de uso, compatibilidad con materiales y superficies, dosificación y precauciones de seguridad.</p><button class="primary" id="detail-add" ' +
    (!product.quantity || busy ? 'disabled' : '') +
    '>Añadir una unidad al carrito</button></article>';
  dialog.setAttribute('aria-labelledby', 'product-title');
  dialog.querySelector('#detail-add').addEventListener('click', () => {
    if (addProduct(id, dialog.querySelector('#detail-add'))) dialog.close();
  });
  dialog.showModal();
}

function renderAccount(account) {
  const box = $('#customer-account');
  box.hidden = location.hash !== '#customer-account';
  $('#customer-account-link').textContent = account ? account.name : 'Iniciar sesión';
  $('#customer-account-link').setAttribute(
    'aria-label',
    account ? 'Abrir cuenta de ' + account.name : 'Iniciar sesión',
  );
  if (account) {
    box.innerHTML =
      '<h2>Tu cuenta</h2><p>' +
      esc(account.name) +
      ' · ' +
      esc(account.email) +
      '</p><button class="chip" id="customer-logout">Cerrar sesión de cliente</button>';
    box.insertAdjacentHTML(
      'beforeend',
      '<form id="customer-profile"><h3>Datos de tu cuenta</h3><label class="field">Nombre<input name="name" required minlength="2" maxlength="100" autocomplete="name" value="' +
        esc(account.name) +
        '"></label><label class="field">Correo<input name="email" type="email" required maxlength="150" autocomplete="email" value="' +
        esc(account.email) +
        '"></label><label class="field">Contraseña actual para confirmar cambios<input name="currentPassword" type="password" required maxlength="128" autocomplete="current-password"></label><label class="field">Nueva contraseña (opcional)<input name="newPassword" type="password" minlength="9" maxlength="128" autocomplete="new-password"></label><button class="chip">Guardar datos</button><p id="profile-result" role="status"></p></form>',
    );
    box.querySelector('#customer-profile').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target,
        fields = form.elements;
      const payload = {
        name: fields.name.value,
        email: fields.email.value,
        currentPassword: fields.currentPassword.value,
        ...(fields.newPassword.value ? { newPassword: fields.newPassword.value } : {}),
      };
      fields.currentPassword.value = '';
      fields.newPassword.value = '';
      form.querySelector('button').disabled = true;
      try {
        const result = await api('/api/shop/profile', payload);
        csrf = result.csrf;
        renderAccount(result.account);
        $('#profile-result').textContent = 'Datos actualizados. Las otras sesiones se han cerrado.';
      } catch (error) {
        $('#profile-result').textContent = error.message;
      } finally {
        if (form.isConnected) form.querySelector('button').disabled = false;
      }
    });
    box.querySelector('#customer-logout').addEventListener('click', async () => {
      try {
        const result = await api('/api/shop/logout', {});
        csrf = result.csrf;
        cart.clear();
        document.querySelector('#checkout').reset();
        requestId = crypto.randomUUID();
        await refresh();
        $('#message').textContent = 'Sesión de cliente cerrada.';
      } catch (error) {
        $('#message').textContent = error.message;
      }
    });

    box.insertAdjacentHTML(
      'beforeend',
      '<form id="customer-address"><h3>Dirección habitual de entrega</h3><label class="field">Dirección guardada<textarea name="address" minlength="8" maxlength="300">' +
        esc(account.address ?? '') +
        '</textarea></label><button class="chip">Guardar dirección</button><p>Puedes dejarla vacía para quitarla. Los pedidos anteriores conservan la dirección con la que se confirmaron.</p><p id="address-result" role="status"></p></form>',
    );
    const checkout = $('#checkout');
    if (!checkout.elements.name.value) checkout.elements.name.value = account.name;
    if (!checkout.elements.email.value) checkout.elements.email.value = account.email;
    if (!checkout.elements.address.value) checkout.elements.address.value = account.address ?? '';
    const addressForm = box.querySelector('#customer-address');
    addressForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = addressForm.querySelector('button');
      if (button.disabled) return;
      button.disabled = true;
      try {
        const response = await api('/api/shop/address', {
          address: addressForm.elements.address.value,
        });
        checkout.elements.address.value = response.account.address;
        box.querySelector('#address-result').textContent =
          'Dirección guardada. Se usará en la próxima compra.';
      } catch (error) {
        box.querySelector('#address-result').textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });
    return;
  }
  box.innerHTML =
    '<h2>Cuenta de cliente</h2><p>Puedes comprar como invitado. Al registrarte se conservarán en tu cuenta los pedidos de esta sesión.</p><form id="customer-access"><label class="field">Nombre (para crear cuenta)<input name="name" maxlength="100" autocomplete="name"></label><label class="field">Correo de la cuenta<input name="email" type="email" maxlength="150" autocomplete="username" required></label><label class="field">Contraseña de la cuenta<input name="password" type="password" minlength="9" maxlength="128" autocomplete="current-password" required></label><button class="chip" type="submit" value="login">Iniciar sesión</button><button class="chip" type="submit" value="register">Crear cuenta</button><p class="hint">Al entrar en una cuenta existente, los pedidos anteriores de invitado no se trasladan a esa cuenta.</p><p id="customer-access-error" role="alert"></p></form>';
  const form = box.querySelector('form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const mode = event.submitter.value,
      fields = form.elements;
    const payload = {
      email: fields.email.value,
      password: fields.password.value,
      ...(mode === 'register' ? { name: fields.name.value } : {}),
    };
    [...fields].forEach((control) => (control.disabled = true));
    try {
      const result = await api('/api/shop/' + mode, payload);
      csrf = result.csrf;
      fields.password.value = '';
      cart.clear();
      document.querySelector('#checkout').reset();
      requestId = crypto.randomUUID();
      await refresh();
      $('#message').textContent = 'Sesión de cliente iniciada.';
    } catch (error) {
      fields.password.value = '';
      box.querySelector('#customer-access-error').textContent = error.message;
    } finally {
      if (form.isConnected) [...fields].forEach((control) => (control.disabled = false));
    }
  });
}

$('#customer-account-link').addEventListener('click', () => {
  $('#customer-account').hidden = false;
  const target = $('#customer-access input[name="email"]') || $('#customer-account h2');
  if (!target) return;
  if (target.tagName === 'H2') target.tabIndex = -1;
  target.focus({ preventScroll: true });
});
window.addEventListener('hashchange', () => {
  $('#customer-account').hidden = location.hash !== '#customer-account';
});
mountShoppingAssistant({
  api,
  esc,
  money,
  showProduct,
  addProduct,
});
