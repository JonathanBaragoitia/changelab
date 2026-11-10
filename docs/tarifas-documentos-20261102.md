# Tarifas desde documentos y correo · 02/11/2026

## Recorrido

En Tarifas de proveedores, editor abre «Importar precios desde PDF, archivo o correo». Selecciona proveedor, referencia única, origen declarado y archivo PDF/CSV/TXT o texto del correo. Descargar un adjunto del correo y subirlo no requiere conexión de buzón. No se consulta ni recibe correo automáticamente. Tampoco se envían correos.

Se extrae una tabla estructurada sin modelo cuando el formato es reconocible. Si no lo es y la opción está activa, se solicita interpretación al modelo local. Se comprueban SKU, importes, duplicados y evidencias literales. Los costes deben ser unitarios netos, sin IVA; un formato ambiguo requiere revisión, no se afirma extracción exhaustiva o infalible. PDF de hasta2MB y10páginas, proceso aislado limitado; texto hasta12000caracteres. No hay OCR para escaneos. Un único documento se procesa simultáneamente por servidor.

La importación conserva bytes originales en SQLite privado, nombre, origen declarado, fecha de subida, autor, texto extraído, uso de modelo y huella SHA-256. Se prepara tarifa con comparación antes/después. Aún no cambia precios. Revisor distinto contrasta original, marca revisión y aplica la versión exacta. Fuente/digest corruptos, oferta obsoleta o proveedor inactivo bloquean la aplicación; transacción evita cambios parciales. Una misma referencia/documento se devuelve sin duplicar.

## Qué cambia

Las importaciones nuevas actualizan supplier_offers del proveedor, respetando lote/plazo existentes e incrementando versión. No cambian coste global del catálogo, precios de venta, inventario ni compras anteriores. Las compras pendientes con versión de oferta anterior requieren revisión nueva. Las tarifas antiguas siguen usando su destino histórico de coste general y se identifican como tales en pantalla; no se reinterpreta el historial.

Tarifas recibidas muestra creador, fechas, aprobación y origen. Historial de precios de compra muestra los100últimos cambios aplicados de las200tarifas más recientes, coste anterior/nuevo, producto/proveedor, fuente, preparador y revisor. Ediciones manuales desde Proveedores mantienen su auditoría habitual; esta tabla recoge tarifas, no todo evento de edición del proveedor.

## Ejemplos

Archivos propios ficticios en outputs/ejemplos-tarifas (fuera de changelab): PDF Bruma, CSV equivalente y correo TXT Lustre. PDF generado con ReportLab, renderizado y revisado con PDFium. Fixture de test propia en tests/fixtures/tariff-bruma.pdf, sin código o documentos docentes reutilizados.

src/scenarios/tariff-examples.ts solo admite la base bajo data/scenarios indicada en ultimo-mes.json. Se ejecutó una vez dejando EJEMPLO-BRUMA-PDF-APLICADA (tres cambios, aprobado sintéticamente con las identidades copiadas del escenario) y EJEMPLO-LUSTRE-CORREO-PENDIENTE (tres cambios sin aplicar). No se alteraron tarifas habituales de4317.

## Verificación

218/218 pruebas, TypeScript, formato y sintaxis. Casos: fuente íntegra/manipulada, cambio por proveedor sin alterar ventas/catálogo, autor no aprueba, aplicación repetida, fila inválida no omitida, extracción sin evidencia rechazada, subida real PDF por HTTP, descarga autenticada y bytes iguales al original. Un correo ficticio con formato libre se probó con el modelo local: devolvió NA-001=5250c y NA-002=2650c, aceptados por la validación; es una prueba limitada, no evaluación general de PDFs.

Revisión visual autenticada con Ana en escenario: tarifa pendiente y aplicada, autor/revisor, costes, original desplegable y botón de aprobación visibles. No se pulsó aprobación en esa revisión. Captura revision-20261102/tarifas-origen.png. Revisión visual de carga con editora pendiente. Reconstruir Docker antes de usarlo en contenedor.

Referencias docentes coherentes con el proyecto: M0630 (seguridad APIs), M0122 (pruebas), separación aplicación/infraestructura y revisión independiente. Materiales fuente intactos.
