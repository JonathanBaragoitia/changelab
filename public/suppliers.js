export async function mountSuppliers(data, { api, esc, toast, reload }) {
  const root = document.querySelector('#screen');
  root.innerHTML =
    '<section class="heading"><div><div class="eyebrow">PROVEEDORES</div><h1>Contactos y recepciones.</h1><p>Gestiona fichas de proveedor para seleccionarlas al registrar entradas. No se envían mensajes ni se realizan pedidos a terceros.</p></div></section><div id="supplier-body"></div>';
  async function refresh() {
    try {
      const result = await api('/api/suppliers'),
        box = root.querySelector('#supplier-body');
      if (!box) return;
      box.innerHTML =
        '<section class="panel panel-body"><h2>Proveedores registrados</h2>' +
        result.suppliers
          .map(
            (s) =>
              '<article class="order"><strong>' +
              esc(s.name) +
              ' · ' +
              (s.active ? 'Activo' : 'Archivado') +
              '</strong><p>' +
              esc(s.email) +
              ' · ' +
              esc(s.phone) +
              '</p><details><summary>Productos, precios y plazos</summary><p>Ofertas ficticias para comparar proveedores; precio por unidad sin IVA. Lote = múltiplo mínimo de compra.</p><ul>' +
              result.offers
                .filter((o) => o.supplierId === s.id)
                .map(
                  (o) =>
                    '<li>' +
                    esc(data.products.find((p) => p.id === o.productId)?.name ?? o.productId) +
                    ' · ' +
                    (o.costCents / 100).toLocaleString('es-ES', {
                      style: 'currency',
                      currency: 'EUR',
                    }) +
                    ' /unidad · Lote ' +
                    o.packUnits +
                    ' unidades · ' +
                    o.leadDays +
                    ' días laborables orientativos</li>',
                )
                .join('') +
              '</ul></details></article>',
          )
          .join('') +
        '</section>' +
        (data.actor.role === 'editor'
          ? '<section class="panel panel-body"><h2>Crear o editar ficha</h2><form id="supplier-form"><label class="field">Ficha<select name="id"><option value="">Nuevo proveedor</option>' +
            result.suppliers
              .map(
                (s) =>
                  '<option value="' +
                  esc(s.id) +
                  '">' +
                  esc(s.name) +
                  (s.active ? '' : ' (archivado)') +
                  '</option>',
              )
              .join('') +
            '</select></label><label class="field">Nombre del proveedor<input name="name" minlength="2" maxlength="120" required></label><label class="field">Correo de contacto<input name="email" type="email" maxlength="150"></label><label class="field">Teléfono de contacto<input name="phone" maxlength="40"></label><label><input name="active" type="checkbox" checked> Proveedor activo para nuevas recepciones</label><button class="primary">Guardar proveedor</button></form></section>'
          : '');
      const form = box.querySelector('form');
      if (data.actor.role === 'editor' && data.actor.businessRole !== 'office') {
        box.insertAdjacentHTML(
          'beforeend',
          '<section class="panel panel-body"><h2>Oferta de producto por proveedor</h2><p>Precio unitario sin IVA. Cantidad de compra en múltiplos del lote. Los cambios requieren volver a revisar propuestas pendientes.</p><form id="offer-form"><label class="field">Proveedor<select name="supplierId">' +
            result.suppliers
              .filter((s) => s.active)
              .map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>')
              .join('') +
            '</select></label><label class="field">Producto<select name="productId">' +
            data.products
              .map((p) => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>')
              .join('') +
            '</select></label><label class="field">Coste por unidad (€)<input name="cost" type="number" min="0.01" max="1000000" step="0.01" required></label><label class="field">Lote (unidades)<input name="pack" type="number" min="1" max="10000" step="1" required></label><label class="field">Plazo orientativo (días laborables)<input name="days" type="number" min="1" max="365" step="1" required></label><label class="field">Motivo del cambio<textarea name="reason" minlength="5" maxlength="500" required></textarea></label><button>Guardar oferta</button></form></section>',
        );
        const offerForm = box.querySelector('#offer-form'),
          fields = offerForm.elements;
        const selected = () =>
          result.offers.find(
            (o) =>
              o.supplierId === fields.supplierId.value && o.productId === fields.productId.value,
          );
        const fill = () => {
          const offer = selected();
          fields.cost.value = offer ? offer.costCents / 100 : '';
          fields.pack.value = offer?.packUnits ?? 1;
          fields.days.value = offer?.leadDays ?? 3;
        };
        fields.supplierId.onchange = fill;
        fields.productId.onchange = fill;
        fill();
        offerForm.onsubmit = async (event) => {
          event.preventDefault();
          const button = offerForm.querySelector('button');
          if (button.disabled) return;
          button.disabled = true;
          try {
            await api('/api/supplier-offers', {
              supplierId: fields.supplierId.value,
              productId: fields.productId.value,
              costCents: Math.round(Number(fields.cost.value) * 100),
              packUnits: Number(fields.pack.value),
              leadDays: Number(fields.days.value),
              expectedVersion: selected()?.version ?? 0,
              reason: fields.reason.value,
            });
            toast('Oferta guardada.');
            await refresh();
          } catch (error) {
            toast(error.message, true);
          } finally {
            if (button.isConnected) button.disabled = false;
          }
        };
      }
      if (!form) return;
      const f = form.elements;
      f.id.addEventListener('change', () => {
        const s = result.suppliers.find((s) => s.id === f.id.value);
        f.name.value = s?.name ?? '';
        f.email.value = s?.email ?? '';
        f.phone.value = s?.phone ?? '';
        f.active.checked = s ? !!s.active : true;
      });
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button');
        if (button.disabled) return;
        const s = result.suppliers.find((s) => s.id === f.id.value),
          payload = {
            name: f.name.value,
            email: f.email.value,
            phone: f.phone.value,
            active: f.active.checked,
            ...(s ? { expectedVersion: s.version } : {}),
          };
        [...f].forEach((c) => (c.disabled = true));
        try {
          await api('/api/suppliers' + (s ? '/' + encodeURIComponent(s.id) : ''), payload);
          await reload();
          toast('Proveedor guardado. Recepciones anteriores conservadas.');
        } catch (error) {
          toast(error.message, true);
          [...f].forEach((c) => (c.disabled = false));
        }
      });
    } catch (error) {
      toast(error.message, true);
    }
  }
  refresh();
}
