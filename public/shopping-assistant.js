export function mountShoppingAssistant({ api, esc, money, showProduct, addProduct }) {
  const host = document.querySelector('#shopping-assistant');
  if (!host) return;
  host.innerHTML =
    '<details class="commercial-disclosure"><summary><span>¿Qué necesitas para cuidar tu coche?</span><span class="disclosure-action">Consultar asistente</span></summary><div class="disclosure-body"><p>Describe qué quieres limpiar y la superficie. El asistente selecciona artículos disponibles del catálogo; comprueba siempre su ficha.</p><form id="shopping-advice"><label class="field">Qué necesitas<textarea name="need" minlength="5" maxlength="700" required placeholder="Quiero limpiar los cristales interiores…"></textarea></label><label class="field">Presupuesto máximo, IVA incluido (€)<input name="budget" type="number" min="0.01" max="10000" step="0.01" required value="30"></label><label class="field">Qué selección prefieres<select name="maxItems"><option value="1">Un producto</option><option value="3">Un conjunto de hasta tres productos</option></select></label><button type="submit" class="primary">Buscar opciones</button></form><div id="shopping-answer" aria-live="polite"></div></div></details>';
  const form = host.querySelector('form');
  const search = async (upholsteryMaterial) => {
    const button = form.querySelector('button'),
      answer = host.querySelector('#shopping-answer');
    if (button.disabled) return;
    button.disabled = true;
    answer.textContent = 'Buscando opciones en el catálogo…';
    try {
      const f = new FormData(form),
        r = await api('/api/shop/advice', {
          need: f.get('need'),
          maxItems: Number(f.get('maxItems')),
          budgetCents: Math.round(Number(f.get('budget')) * 100),
          ...(upholsteryMaterial ? { upholsteryMaterial } : {}),
        });
      answer.innerHTML =
        '<p>' +
        esc(r.notice) +
        '</p>' +
        r.products
          .map(
            (p) =>
              '<article class="order"><h3>' +
              esc(p.name) +
              '</h3><p>' +
              esc(p.description) +
              '</p><strong>' +
              money(p.totalCents) +
              ' IVA incluido</strong><p>Referencia ' +
              esc(p.sku) +
              ' · ' +
              p.quantity +
              ' disponibles</p><button type="button" class="chip" data-advice-details="' +
              esc(p.id) +
              '">Ver ficha del producto</button> <button type="button" class="chip" data-advice-add="' +
              esc(p.id) +
              '"' +
              (p.quantity ? '' : ' disabled') +
              '>Añadir al carrito</button></article>',
          )
          .join('');
      answer
        .querySelectorAll('[data-advice-details]')
        .forEach((button) =>
          button.addEventListener('click', () => showProduct(button.dataset.adviceDetails)),
        );
      answer.querySelectorAll('[data-advice-add]').forEach((button) =>
        button.addEventListener('click', () => {
          if (addProduct(button.dataset.adviceAdd)) button.textContent = 'Añadido · Añadir otro';
        }),
      );
      for (const material of r.materials ?? []) {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.className = 'chip';
        choice.textContent = material.label;
        choice.addEventListener('click', () => {
          if (form.reportValidity())
            void search(form.elements.need.value === f.get('need') ? material.id : undefined);
        });
        answer.append(choice, ' ');
      }
    } catch (e) {
      answer.textContent = e.message;
      const catalog = document.createElement('a');
      catalog.href = '#products';
      catalog.textContent = 'Ir al catálogo';
      answer.append(' ', catalog);
    } finally {
      button.disabled = false;
    }
  };
  form.onsubmit = (event) => {
    event.preventDefault();
    void search();
  };
}
