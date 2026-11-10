export async function mountMail(data, { api, esc, toast }) {
  const screen = document.querySelector('#screen');
  screen.innerHTML =
    '<section class="heading"><div><h1>Correos a clientes</h1><p>Confirmaciones de compra, salida del transportista y cancelaciones. Cada mensaje conserva su contenido y el estado de tramitación.</p></div></section><section class="panel panel-body" id="mail-content">Cargando…</section>';
  const box = screen.querySelector('#mail-content');
  try {
    const report = await api('/api/mail');
    if (!box.isConnected) return;
    const labels = {
      pending: 'Pendiente',
      preview: 'Guardado para revisar · sin envío externo',
      sending: 'Tramitando',
      sent: 'Aceptado por el proveedor',
      failed: 'Error · admite reintento',
      blocked: 'Bloqueado · requiere revisión',
      uncertain: 'Resultado incierto · revisar proveedor antes de reenviar',
    };
    const orders = data.sales.filter((s) => s.customer?.email);
    box.innerHTML =
      '<p role="status">' +
      esc(report.message) +
      '</p><p>La aceptación por el proveedor no demuestra que el correo haya llegado al buzón. Los mensajes guardados para revisar no se envían automáticamente al activar un proveedor.</p><details class="commercial-disclosure"><summary>Preparar una copia de un pedido anterior</summary><div class="disclosure-body"><p>Genera una copia para revisar, nunca un envío real. No modifica el pedido.</p><form id="mail-capture"><label class="field">Pedido<select name="orderId">' +
      orders
        .slice(0, 200)
        .map(
          (s) =>
            '<option value="' +
            esc(s.id) +
            '">' +
            esc(s.id.slice(0, 8)) +
            ' · ' +
            esc(s.customer.name) +
            '</option>',
        )
        .join('') +
      '</select></label><button class="chip"' +
      (!orders.length ? ' disabled' : '') +
      '>Preparar copia</button></form></div></details><h2>Historial de correos</h2>' +
      (report.jobs.length
        ? report.jobs
            .map(
              (j) =>
                '<details class="commercial-disclosure"><summary>' +
                esc(j.subject) +
                ' · ' +
                esc(labels[j.status] ?? j.status) +
                '</summary><div class="disclosure-body"><p>Para: ' +
                esc(j.to) +
                ' · ' +
                esc(new Date(j.createdAt).toLocaleString('es-ES')) +
                '</p><p>Intentos de procesamiento: ' +
                j.attempts +
                '</p>' +
                (j.error ? '<p role="status">Incidencia: ' + esc(j.error) + '</p>' : '') +
                '<pre class="mail-preview">' +
                esc(j.text) +
                '</pre><div class="chips"><a class="chip" href="/api/mail/' +
                encodeURIComponent(j.id) +
                '/preview">Descargar correo (.eml)</a>' +
                (j.status === 'failed'
                  ? '<button class="chip" data-mail-retry="' + esc(j.id) + '">Reintentar</button>'
                  : '') +
                '</div></div></details>',
            )
            .join('')
        : '<p>Todavía no se han preparado correos.</p>');
    const form = box.querySelector('#mail-capture');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const b = form.querySelector('button');
      b.disabled = true;
      try {
        await api('/api/mail/capture', { orderId: form.elements.orderId.value });
        await mountMail(data, { api, esc, toast });
        toast('Correo disponible para revisar. No se ha ordenado un nuevo envío.');
      } catch (err) {
        toast(err.message, true);
        b.disabled = false;
      }
    };
    box.querySelectorAll('[data-mail-retry]').forEach(
      (b) =>
        (b.onclick = async () => {
          b.disabled = true;
          try {
            await api('/api/mail/' + encodeURIComponent(b.dataset.mailRetry) + '/retry', {});
            await mountMail(data, { api, esc, toast });
          } catch (err) {
            toast(err.message, true);
            b.disabled = false;
          }
        }),
    );
  } catch (error) {
    if (box.isConnected) box.textContent = error.message;
  }
}
