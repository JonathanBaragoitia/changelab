import { deliveryEstimate } from '/order-tracking.js';
export function showPaymentSummary({ lines, money, esc, onConfirm }) {
  document.querySelector('#payment-summary')?.remove();
  const dialog = document.createElement('dialog');
  dialog.id = 'payment-summary';
  dialog.className = 'product-dialog';
  dialog.setAttribute('aria-labelledby', 'payment-title');
  const base = lines.reduce((sum, line) => sum + line.quantity * line.expectedPriceCents, 0);
  const tax = lines.reduce(
    (sum, line) => sum + Math.round((line.quantity * line.expectedPriceCents * 21) / 100),
    0,
  );
  dialog.innerHTML =
    '<h2 id="payment-title">Revisa tu compra</h2><ul>' +
    lines
      .map(
        (line) =>
          '<li>' +
          esc(line.name) +
          ' · ' +
          line.quantity +
          ' × ' +
          money(line.expectedPriceCents) +
          '</li>',
      )
      .join('') +
    '</ul><p>Base: ' +
    money(base) +
    '<br>IVA (21 %): ' +
    money(tax) +
    '</p><h3>Total: ' +
    money(base + tax) +
    '</h3><p class="notice">Pago simulado para probar la compra. No se cobra dinero ni se solicitan datos bancarios.</p><form id="payment-form"><label class="field">Método de pago<select name="method"><option value="card">Tarjeta</option><option value="paypal">PayPal</option><option value="bizum">Bizum</option><option value="applepay">Apple Pay</option><option value="googlepay">Google Pay</option></select></label><details><summary>Opciones de la prueba</summary><label class="field">Resultado que quieres probar<select name="outcome"><option value="approved">Pago aceptado</option><option value="declined">Pago rechazado</option></select></label></details><p id="payment-result" role="status" aria-live="polite"></p><button type="submit" class="primary">Simular pago de ' +
    money(base + tax) +
    '</button> <button type="button" class="chip" id="payment-back">Volver al carrito</button></form>';
  document.body.append(dialog);
  const delivery = document.createElement('p');
  delivery.textContent = deliveryEstimate;
  dialog.querySelector('#payment-form').before(delivery);
  dialog.querySelector('#payment-back').addEventListener('click', () => dialog.close());
  let submitting = false;
  dialog.addEventListener('cancel', (event) => {
    if (submitting) event.preventDefault();
  });
  dialog.querySelector('#payment-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submitting) return;
    const form = event.target,
      result = dialog.querySelector('#payment-result');
    if (form.elements.outcome.value === 'declined') {
      result.textContent =
        'Pago rechazado en la simulación. Puedes cambiar el método o volver al carrito. No se ha creado ningún pedido.';
      return;
    }
    submitting = true;
    const controls = [...form.elements];
    const method = form.elements.method.selectedOptions[0].textContent;
    controls.forEach((control) => (control.disabled = true));
    result.textContent = 'Confirmando pedido…';
    try {
      await onConfirm(method);
      dialog.close();
    } catch (error) {
      result.textContent = error.message;
    } finally {
      submitting = false;
      controls.forEach((control) => (control.disabled = false));
    }
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  dialog.showModal();
}
