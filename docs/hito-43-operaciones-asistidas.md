# Hito 43 · Compras, trabajo diario y asistencia comercial

29/10/2026. El usuario autoriza las siete ampliaciones propuestas. Primera versión integrada local; las pruebas guiadas con el usuario se dejan para después.

## Recorridos disponibles

| Función                | Uso y controles                                                                                                                                                                                                                                               | Límite de esta versión                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compras                | Propuesta de una o varias líneas con costes actuales; revisión por otra persona; recepción completa aumenta stock mediante el caso de uso existente. Versiones, comprobación de catálogo al aprobar y referencia de operación para reintentos del formulario. | No envía pedidos, genera gastos ni registra facturas del proveedor. Sin recepción parcial de una compra. Coste orientativo del catálogo, no oferta verificada del proveedor.                                                                                                                                                                         |
| Bandeja diaria         | Reúne pedidos pendientes, compras, incidencias, propuestas, stock y conciliación. Cada tarjeta abre su apartado. Resumen local opcional.                                                                                                                      | Priorización base por reglas. El resumen IA recibe hasta 30 tareas y no sustituye la lista completa. Si falla o no cita una tarea, se muestra un resumen por reglas identificado como tal.                                                                                                                                                           |
| Devoluciones parciales | Un artículo y cantidad por operación; repetir para varios artículos. Recepción confirmada de unidades aptas para reponer. Conserva pedido/precios originales; limita cantidades acumuladas y conserva cada registro.                                          | Reembolso independiente en caja. Registro comercial DEMO, no rectificación fiscal parcial. Una devolución completa posterior se realiza por las unidades restantes desde este apartado.                                                                                                                                                              |
| Asistente de tienda    | En /tienda, necesidad y presupuesto. Ollama selecciona hasta tres referencias disponibles; servidor comprueba IDs, duplicados y total orientativo con IVA demo. Muestra fichas originales.                                                                    | No añade artículos al carrito, garantiza compatibilidad ni inventa instrucciones de uso. Se selecciona una unidad por referencia. Sin memoria del usuario ni entrenamiento personalizado.                                                                                                                                                            |
| Resultados             | Mismos artículos afectados, ventanas de 14 días antes y después de publicar; unidades, ventas netas y margen. Informa periodo incompleto y cambios cercanos. Lectura IA opcional.                                                                             | No demuestra causalidad, controla estacionalidad ni reconstruye roturas históricas de stock. Devoluciones se atribuyen al periodo del pedido original. Se excluyen y cuentan pedidos históricos sin desglose fiscal, evitando mezclar precios brutos históricos con importes netos. No es una serie contable de movimientos por fecha de devolución. |
| Incidencias            | Pedido, tipo, descripción, seguimiento y resolución. Edición y versión controladas; conserva la descripción original. IA propone clasificación y borrador de respuesta.                                                                                       | La clasificación guardada no cambia por consultar IA. El borrador requiere revisión; no se envían mensajes ni se ejecutan reembolsos. No se reabren incidencias resueltas en esta versión.                                                                                                                                                           |
| Documentos             | PDF con texto, TXT, CSV o texto pegado. Extracción local; propuesta IA opcional con evidencia literal, cantidades/costes presentes en el fragmento. Corrección manual y confirmación antes de incorporar.                                                     | Máximo PDF 2 MB/10 páginas, texto 12.000 caracteres, 30 filas. Sin OCR, PDF cifrado ni garantía de interpretación semántica. Las referencias desconocidas se bloquean.                                                                                                                                                                               |

## Integración de documentos

Se guarda el texto extraído y su hash, no el PDF original. Para conservar una copia documental hay que guardar el original fuera de esta función. Los datos permanecen en la base local; las llamadas IA usan Ollama en loopback. No se distribuye esta base con el portfolio.

Una tarifa incorporada crea el lote existente: necesita revisión independiente para actualizar costes. Un albarán confirmado registra entradas mediante ReceiveStock, sin actualizar costes ni generar gasto. El documento solo se procesa una vez. Si una fila falla, se revierten las recepciones anteriores y el estado del documento.

Las filas extraídas pueden ser erróneas aunque contengan fragmentos literales: coincidencia numérica no acredita que un importe sea unitario o neto. La persona debe comprobar columnas, unidades y significado. Se ofrece modo manual cuando el modelo no está disponible o el documento no es interpretable.

## Consistencia de devoluciones y compras

Las devoluciones mantienen cantidades acumuladas por artículo y registros por operación. Se reparte el impuesto original de cada línea de forma acumulativa: devolver una línea en varias veces conserva hasta el último céntimo. Stock, informes comerciales/económicos y conciliación descuentan las unidades devueltas. Caja limita el reembolso al menor entre mercancía devuelta y cobros activos, descontando reembolsos previos. El saldo puede cobrarse después de un reembolso parcial sin duplicar importes.

La conciliación conserva advertencias de diferencias documentales: no oculta una factura original que requiere rectificación. La rectificación fiscal parcial no está implementada. Las métricas existentes son de demostración y no constituyen una liquidación tributaria.

La recepción de compra y su cambio de estado comparten transacción. Se incorporan savepoints para componer casos de uso que ya tenían transacciones, sin confirmar escrituras fuera de la operación exterior. Si se anula después una recepción vinculada, la compra histórica se conserva y aparece un aviso en Compras y Bandeja diaria.

## Arquitectura y materiales docentes

- M0001, Casos de uso: lógica de aplicación: orquestación sin Request/Response dentro de los servicios; puertos de repositorio y funciones puras.
- M0021, Testing en Clean Architecture: reglas, contratos, persistencia, idempotencia y adaptadores probados por separado.
- M0122, Setup y mapa de pruebas: distinguir pruebas de cálculo, integración SQLite/HTTP y prueba real de interfaz. La suite HTTP no se presenta como E2E visual.
- M0487, Evaluations: separar validación del contrato del modelo, fidelidad/utilidad de su salida y tests del programa.

Estos materiales se han consultado como referencia. El alcance comercial, límites, fórmulas y diseño son decisiones propias del proyecto; no requisitos oficiales del TFM. Los originales no se modifican ni se ejecutan.

Nuevos servicios: operations.ts, partial-returns.ts, workbench.ts, document-imports.ts y shopping-assistance.ts. Adaptadores: operation-store.ts, commercial-ai.ts y document-text.ts. La extracción PDF se ejecuta en proceso hijo con límite de memoria V8, salida y tiempo; esto no equivale a un aislamiento de seguridad completo. Interfaz de gestión encapsulada en operations.js; tienda en shopping-assistant.js. El servidor de composición sigue siendo grande y requiere refactorización posterior si continúa creciendo.

## Verificación y límites de la IA

Suite vigente: 184 pruebas. Se añaden 17 pruebas con cálculos de céntimos/unidades, transacciones anidadas, fallos y reversión, permisos, versiones, idempotencia, lectura de PDF real generado en memoria, límites de respuesta, CSRF público, recepción de compras, importación de tarifa sin aplicación y avisos al anular una recepción.

Diagnóstico real con qwen3:4b-instruct, casos ficticios:

- Primera ejecución: selección de cristales, dos filas explícitas y clasificación de envase dañado correctas en sus criterios limitados. El resumen diario afirmó incorrectamente que no había tareas. El informe conserva el fallo y la corrección de una rúbrica que inicialmente solo medía longitud.
- Segunda ejecución: seis respuestas aceptadas por los contratos; cinco cumplen los criterios limitados. El diagnóstico sin validación del resumen diario vuelve a fallar. El recorrido con validación cita una tarea real y se acepta. Tests adicionales comprueban el respaldo por reglas cuando omite evidencias o falla el modelo.
- El borrador de incidencia dice que se está evaluando el problema aunque el estado es abierto: revisión humana obligatoria antes de usarlo. Una clasificación correcta no demuestra que el texto sea fiel. El comentario de resultados es válido pero muy breve.

Informes: [primera ejecución](evaluations/operations-2026-10-29T11-17-14.369Z.json) y [segunda ejecución](evaluations/operations-2026-10-29T11-21-27.726Z.json). No es una evaluación independiente, de robustez adversarial o utilidad con usuarios. No se afirma que estas funciones estén listas para operar sin revisión.

Comandos: npm run check y npm run evaluate:operations. La revisión visual autenticada está pendiente: la herramienta de navegador devuelve browser.user is unavailable. No se han creado cuentas ni modificado pedidos, compras, documentos o stock de la demo para estas pruebas.

## Prueba guiada propuesta

1. Preparar una compra en edición, aprobarla con revisión y recibirla en edición; comprobar stock e historial.
2. Preparar/enviar un pedido de varias unidades; devolver una unidad, consultar el saldo y registrar solo el reembolso que corresponda.
3. Abrir una incidencia de ese pedido, consultar el borrador y registrar la resolución manual.
4. Importar texto de ejemplo como tarifa y comprobar que los costes no cambian hasta revisión independiente. Usar otra referencia para probar albarán.
5. Probar el asistente en /tienda con una necesidad y presupuesto; verificar las fichas antes de comprar.
6. Abrir Bandeja diaria y Resultados para comprobar enlaces, fuentes y periodos incompletos.
