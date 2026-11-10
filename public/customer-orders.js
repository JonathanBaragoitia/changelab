import { shippingDetails } from '/customer-shipping.js';
import { orderProgress } from '/order-tracking.js';
const $ = (s) => document.querySelector(s);
const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const money = (cents) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(cents / 100);
let loading = false;
async function loadOrders() {
  if (loading) return;
  loading = true;
  $('#refresh-orders').disabled = true;
  $('#orders-status').textContent = 'Actualizando pedidos…';
  try {
    const response = await fetch('/api/shop', { credentials: 'same-origin' });
    if (!response.ok) throw Error('No se pudieron cargar tus pedidos. Vuelve a intentarlo.');
    const data = await response.json();
    $('#order-list').innerHTML = data.orders.length
      ? data.orders
          .map(
            (order) =>
              '<article class="order"><h3>Pedido del ' +
              esc(new Date(order.createdAt).toLocaleString('es-ES')) +
              '</h3><p>' +
              esc(
                {
                  confirmed: 'Pedido recibido',
                  prepared: order.shipping
                    ? 'Pendiente de recogida del transportista'
                    : 'Preparado · listo para enviar',
                  shipped: 'Enviado',
                  cancelled: 'Cancelado',
                  returned: 'Devuelto',
                }[order.status] || order.status,
              ) +
              ' · ' +
              money(order.totalCents) +
              '</p>' +
              '<ol class="order-progress" aria-label="Seguimiento del pedido">' +
              orderProgress(order.status)
                .map(
                  (step) =>
                    '<li' +
                    (step.current ? ' aria-current="step"' : '') +
                    '>' +
                    (step.complete ? '✓ ' : '') +
                    step.label +
                    '</li>',
                )
                .join('') +
              '</ol>' +
              shippingDetails(order, esc) +
              (order.tax
                ? '<p>Base: ' +
                  money(order.tax.baseCents) +
                  ' · IVA 21 %: ' +
                  money(order.tax.taxCents) +
                  ' · Precios de líneas sin IVA.</p>'
                : '<p>Pedido histórico sin desglose fiscal.</p>') +
              '<ul>' +
              order.lines
                .map(
                  (line) =>
                    '<li>' +
                    esc(line.name) +
                    ' · ' +
                    line.quantity +
                    ' × ' +
                    money(line.unitPriceCents) +
                    ((order.returnedQuantities ?? []).some((r) => r.productId === line.productId)
                      ? ' · devueltas ' +
                        order.returnedQuantities.find((r) => r.productId === line.productId)
                          .quantity
                      : '') +
                    '</li>',
                )
                .join('') +
              '</ul>' +
              (['confirmed', 'prepared'].includes(order.status)
                ? '<button type="button" class="chip" data-cancel-order="' +
                  esc(order.id) +
                  '">Cancelar pedido</button>'
                : '') +
              '</article>',
          )
          .join('')
      : '<p>Todavía no tienes pedidos en esta sesión.</p>';

    document.querySelectorAll('[data-cancel-order]').forEach((button) =>
      button.addEventListener('click', () => {
        const order = data.orders.find((order) => order.id === button.dataset.cancelOrder);
        const dialog = document.createElement('dialog');
        dialog.className = 'product-dialog';
        dialog.setAttribute('aria-label', 'Cancelar pedido');
        dialog.innerHTML =
          '<h2>¿Cancelar este pedido?</h2><p>Se cancelarán todos los artículos y volverán a estar disponibles. Esta acción no se puede deshacer.</p><p role="status"></p><button type="button" data-confirm>Cancelar pedido</button> <button type="button" data-back>Conservar pedido</button>';
        document.body.append(dialog);
        dialog.showModal();
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        dialog.querySelector('[data-back]').onclick = () => dialog.close();
        let submitting = false;
        dialog.addEventListener('cancel', (event) => {
          if (submitting) event.preventDefault();
        });
        dialog.querySelector('[data-confirm]').onclick = async () => {
          if (submitting) return;
          submitting = true;
          dialog.querySelectorAll('button').forEach((control) => (control.disabled = true));
          try {
            const response = await fetch(
              '/api/shop/orders/' + encodeURIComponent(order.id) + '/cancel',
              {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': data.csrf },
                body: JSON.stringify({ expectedStatus: order.status }),
              },
            );
            const result = await response.json();
            if (!response.ok) throw Error(result.message || 'No se pudo cancelar el pedido.');
            dialog.close();
            await loadOrders();
            $('#orders-status').textContent = 'Pedido cancelado. Se conserva en tu historial.';
          } catch (error) {
            dialog.querySelector('[role="status"]').textContent = error.message;
          } finally {
            submitting = false;
            dialog.querySelectorAll('button').forEach((control) => (control.disabled = false));
          }
        };
      }),
    );
    $('#orders-status').textContent = 'Pedidos actualizados.';
  } catch (error) {
    $('#orders-status').textContent = error.message;
  } finally {
    loading = false;
    $('#refresh-orders').disabled = false;
  }
}
$('#refresh-orders').addEventListener('click', loadOrders);
loadOrders();
