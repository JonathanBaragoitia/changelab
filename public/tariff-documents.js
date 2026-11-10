export function mountTariffDocuments(box, suppliers, { api, esc, toast, reload }) {
  box.insertAdjacentHTML(
    'afterbegin',
    '<details class="commercial-disclosure"><summary><span>Importar precios desde PDF, archivo o correo</span><span class="disclosure-action">Abrir</span></summary><div class="disclosure-body"><p>Sube el adjunto recibido por correo o pega su texto. Se extraen costes unitarios sin IVA y se prepara una tarifa; otra persona debe aprobarla antes de actualizar la oferta del proveedor. No se consulta tu buzón.</p><form id="tariff-document-form"><label class="field">Proveedor<select name="supplierId" required>' +
      suppliers
        .map((s) => '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>')
        .join('') +
      '</select></label><label class="field">Referencia de la nueva tarifa<input name="reference" required maxlength="100" placeholder="TARIFA-NOVIEMBRE-2026"></label><label class="field">Motivo del cambio<textarea name="reason" minlength="5" maxlength="500" required placeholder="Actualización de precios comunicada por el proveedor…"></textarea></label><label class="field">Origen (correo, remitente o asunto)<input name="origin" maxlength="300" placeholder="Adjunto recibido por correo del proveedor"></label><label class="field">Adjunto<input name="file" type="file" accept=".pdf,.csv,.txt"></label><label class="field">O pega el contenido del correo<textarea name="source" maxlength="12000" rows="6" placeholder="Precios unitarios sin IVA…"></textarea></label><label><input name="useAI" type="checkbox" checked> Interpretar documentos con formato libre cuando sea necesario</label><p>PDF con texto: hasta 2 MB y 10 páginas. No admite PDF escaneado sin OCR. Texto/CSV: hasta 12.000 caracteres.</p><button class="primary" type="submit">Extraer y preparar revisión</button><p role="status" id="tariff-document-status"></p></form></div></details>',
  );
  const form = box.querySelector('#tariff-document-form');
  form
    .querySelector('button[type="submit"]')
    .insertAdjacentHTML(
      'beforebegin',
      '<details><summary>Introducir costes cotejados con el original</summary><p>Si el documento presenta importes ambiguos, conserva el adjunto y escribe los costes unitarios sin IVA que hayas comprobado.</p><label class="field">CSV de costes revisados<textarea name="reviewedCsv" maxlength="12000" rows="4" placeholder="sku;coste"></textarea></label><label><input name="confirmReviewed" type="checkbox"> He cotejado cada coste con el documento original.</label></details>',
    );
  form.onsubmit = async (event) => {
    event.preventDefault();
    const f = form.elements,
      controls = [...f],
      file = f.file.files[0];
    const reviewedCsv = f.reviewedCsv.value.trim();
    if (reviewedCsv && !f.confirmReviewed.checked) {
      toast('Confirma que has cotejado los costes con el original.', true);
      return;
    }
    if (file && file.size > 2000000) {
      toast('Máximo 2 MB por PDF.', true);
      return;
    }
    if (file && !/\.(pdf|csv|txt)$/i.test(file.name)) {
      toast('Usa PDF, CSV o TXT.', true);
      return;
    }
    controls.forEach((c) => (c.disabled = true));
    const status = form.querySelector('[role="status"]');
    status.textContent = 'Leyendo el documento y preparando los cambios…';
    try {
      let source = f.source.value,
        format = 'text';
      if (file && /\.pdf$/i.test(file.name)) {
        format = 'pdf';
        source = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(Error('No se pudo leer el PDF.'));
          reader.readAsDataURL(file);
        });
      } else if (file) {
        if (file.size > 12000) throw Error('Texto/CSV: máximo 12 KB.');
        source = await file.text();
      }
      await api('/api/tariff-documents', {
        supplierId: f.supplierId.value,
        reference: f.reference.value,
        origin: f.origin.value,
        reason: f.reason.value,
        filename: file?.name ?? 'correo-pegado.txt',
        source,
        format,
        useAI: f.useAI.checked,
        ...(reviewedCsv ? { reviewedCsv, confirmReviewed: true } : {}),
      });
      toast('Documento guardado y tarifa preparada. Todavía no se han cambiado precios.');
      await reload();
    } catch (error) {
      status.textContent = error.message;
      toast(error.message, true);
    } finally {
      if (form.isConnected) controls.forEach((c) => (c.disabled = false));
    }
  };
}
