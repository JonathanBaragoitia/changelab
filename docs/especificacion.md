# Especificación inicial · 26/10/2026

> Documento histórico del primer incremento. Las identidades, la conexión de IA y los permisos descritos aquí evolucionaron. Para el funcionamiento vigente, consultar [roles de empresa](roles-empresa.md), [correo y envíos](correos-envios.md) y el README. Dirección puede autorizar sus propias propuestas por decisión explícita del usuario; Oficina las prepara y Almacén realiza las operaciones físicas.

## Decisión y objetivo

El usuario acepta iniciar la última propuesta: preparar cambios de datos con IA, simularlos, revisarlos y publicarlos con controles. El juego queda fuera. Nombre de trabajo: ChangeLab. No hay afirmación de novedad mundial ni demanda comercial validada.

Caso de estudio: catálogo de una empresa ficticia. Una editora propone una variación de tarifas por categoría y otra persona revisa y publica. Los pedidos confirmados guardan su precio original.

## Alcance del incremento 1

Una categoría y un porcentaje entre −50 % y +50 %, distinto de cero; plan con dos campos permitidos. Simulación determinista, comparación, bloqueo, aprobación y publicación atómica con datos persistentes. Una instancia local, un espacio de demostración, tres identidades seleccionables. Sin IA conectada ni autenticación real.

## Criterios de aceptación

- CA01: simular no cambia productos ni pedidos.
- CA02: un margen bruto inferior al 20 % bloquea la propuesta.
- CA03: solo el rol editor puede crear y solo reviewer puede publicar; el creador no aprueba su propuesta.
- CA04: el digest presentado debe corresponder a los cambios exactos revisados.
- CA05: una versión de producto desactualizada impide publicar; se requiere nueva simulación.
- CA06: un fallo de escritura revierte la operación completa.
- CA07: publicar dos veces no duplica efectos.
- CA08: los pedidos conservan su instantánea de precios.
- CA09: reiniciar conserva catálogo, propuestas e historial.
- CA10: el cliente muestra el estado, las diferencias y las limitaciones del planificador y las identidades.

CA01–CA09 se comprueban en tests/workflow.test.ts. CA10 requiere revisión en navegador, además de comprobar la entrega HTTP. Las pruebas con identidades demo no acreditan seguridad de autenticación.

## Decisiones de implementación

- Monolito modular: un solo proceso, dependencias dirigidas hacia dominio y puertos.
- TypeScript en servidor; HTML/CSS/JS en esta primera interfaz. React y un framework HTTP se decidirán al consolidar la aplicación, no se declaran implementados.
- SQLite local para tener persistencia y transacciones sin instalar servicios; PostgreSQL es una evolución prevista, no realizada.
- No usar un LLM como juez de reglas ni permitir SQL generado sin control. La simulación actual será el baseline para la evaluación de IA.
- Demostración local antes del despliegue: falta identidad real y agente, por lo que no se publica esta versión con datos o permisos reales.

## Encaje con el máster

Las referencias son conceptuales, no requisitos oficiales de stack:

- M0001: Casos de uso / Clean Architecture: puertos y orquestación.
- M0072: Monolito modular: límites y despliegue sencillo.
- M0159 y M0160: SDD: especificación, ejecución y verificación.
- M0123 y M0125: TDD e integración/E2E asistidos por IA.
- M0472: creación de un agente; integración prevista en siguientes hitos.
- M0646: seguridad GenAI; rechazos de instrucciones y límites de herramientas previstos.
- M0645: requisitos oficiales: aplicación, README, código GitHub, presentación y vídeo; despliegue recomendado.

## Evaluación prevista

Antes de incorporar IA se prepararán peticiones permitidas, ambiguas y maliciosas con resultados esperados. Medir validez de planes, selección de alcance, rechazos correctos, rechazos incorrectos, coste, latencia y operaciones indebidas que alcanzan el publicador. Conservar denominadores, versiones y ejemplos fallidos. No llamar «seguro» al sistema por pasar un conjunto finito de pruebas.

La utilidad empresarial y la mejora frente a otras herramientas están pendientes de evaluación. El primer incremento demuestra comportamiento técnico con datos ficticios.

## Ampliación aceptada · 27/10/2026

El usuario acepta evolucionar hacia tienda y gestión comercial de Norte AutoCare, manteniendo ChangeLab como control de cambios. El alcance histórico anterior no describe todo el estado actual. Hito 06 entrega carrito, pedido, stock y margen bruto de demostración; criterios, referencias, límites y siguientes fases en hito-06-tienda.md. Facturación y adaptación fiscal pendientes; no generar ni presentar documentos como facturas válidas todavía.

## Hito 27 · Historial comercial IA

Seguimiento persistente de priorizaciones: contexto/hash, modelo configurado, prompt, duración y resultados validados/rechazados/fallidos/cambio de datos/sin terminar. No guarda salida bruta ni PII de clientes. Últimas20 visibles en Análisis comercial IA, solo empleados.124 pruebas; llamada real5959ms seleccionó un agotado, no utilidad probada. Ver docs/hito-27-historial-ia.md. No registra aún intérprete de propuestas ni acredita pesos inmutables. Diseño aplazado; evaluación independiente sigue pendiente.

## Hito 28 · Evaluación comercial IA

Diagnóstico sintético6casos×2, prompt sin modificar:12/12 aceptados,10/12 cobertura completa;10 llamadas reales,8/10 completas. Categoría con texto de instrucción devuelve vacío2/2. Comparador determinista cubre6/6 por construcción; valor adicional de IA no demostrado. No evaluación independiente.127 pruebas. Ver docs/hito-28-evaluacion-comercial.md e informe docs/evaluations/business-2026-10-28T10-58-57.615Z.md. npm run evaluate:business, sin base comercial ni nueva UI. Diseño aplazado. Siguiente funcional: correcciones comerciales.

## Hito 29 · Anulación de gastos

Cuenta editora puede anular gasto erróneo con motivo conservando original/evento. Bloquea con pagos activos, excluye resultado y nuevos pagos. Reintentos y rollback.131 pruebas; gasto ficticio1€ creado/anulado visualmente, gasto previo10€ intacto. Ver docs/hito-29-anulacion-gastos.md. No devolución de dinero ni cierre contable histórico. Diseño aplazado. Siguiente pendiente: corrección de recepciones.

## Hito 30 · Corrección de recepciones

Anulación total de entrada errónea con motivo, stock revisado, original/movimiento/evento conservados y descuento único. Bloqueos por insuficiencia/cambio de existencias, roles y rollback.134 pruebas; entrada ficticia+2 anulada, nc1 vuelve23. Ver docs/hito-30-anulacion-recepciones.md. No devolución física a proveedor ni ajustes financieros/lotes. Diseño aplazado. Siguiente: consulta de conciliación pedido/documentos/caja.

## Hito 31 · Conciliación comercial

Consulta de solo lectura en Pedidos y resultados une estado/importe pedido, saldo documental DEMO y cobros activos. Avisos/filtro/enlace documental, sin correcciones automáticas.138 pruebas y navegador3pedidos/2avisos; pedido confirmado79,90rectificado a0señalado. Ver docs/hito-31-conciliacion.md. No conciliación bancaria/fiscal, reembolsos ni documentos huérfanos. Diseño aplazado. Siguiente recomendado: recorrido integral y revisión de pendientes antes de ampliar alcance.

## Hito 32 · Recorrido integral HTTP

Compra invitada→preparar/enviar→emisión DEMO→cobro→devolución→rectificación comprobados en SQLite aislado. Reintentos no duplican; privacidad de pedidos y stock/históricos conservados.139 pruebas. Aviso final por96,68€cobrados se mantiene: no reembolso implementado ni cobro anulado para ocultarlo. Sin cambio visual/datos demo. Ver docs/hito-32-recorrido-integral.md. Siguiente: registro separado de reembolsos de demostración; después UX/documentación/entrega y revisión de despliegue. IA sin ventaja comercial demostrada.

## Hito 33 · Reembolsos de demostración

Registro separado de cobro para cancelados/devueltos, parcial/total limitado a cobros activos menos previos. Caja/conciliación netas, originales conservados y protección de reversión del cobro de respaldo.142 pruebas y recorrido HTTP integral con saldo final0. UI verificada vacía (sin destinos elegibles actuales), sin cambios demo. Ver docs/hito-33-reembolsos.md. No transferencia real ni corrección de reembolso aún. Siguiente: UX/navegación y consolidar documentación; no ampliar automáticamente alcance fiscal.

## Hito 34 · Navegación por tareas

Menú Pedidos/Almacén/Facturación/Conciliación separado; Catálogo renombrado, rutas/explicaciones corregidas. Presentación por data-area/hidden dentro del módulo comercial compartido, permisos siempre servidor.142 pruebas y verificación visual cuatro vistas; Actualizar conserva apartado. Sin operaciones/datos modificados. Ver docs/hito-34-navegacion.md. Pendientes móvil/accesibilidad/diseño tienda. Siguiente UX: simplificar facturación/formularios; después consolidar documentación.

## Hito 35 · UX y documentación vigente

Facturación sin editar emitidos, tarjetas con estados, propuestas filtrables y selección que conserva formulario. Mensajes/teclado/CSS móvil mejorados; viewport móvil real pendiente. README consolidado, histórico archivado y arquitectura/guion/entrega documentados.142 pruebas y sintaxis/TS/formato correctos; navegador sin nuevas operaciones. Ver docs/hito-35-ux-documentacion.md. Autorización de trabajo continuo con reserva10%; no cuota diaria disponible, consultar5h. Pendientes corrección reembolso erróneo, persistencia/contratos y móvil real.

## Hitos 36–39 · Sesión de avance continuo del 28/10

36: corrección de reembolsos con original conservado, activeRefunds y lecturas de caja validadas.148 pruebas. Recorrido visual nuevo completo pedido47c62cf4-8eca-4918-937b-890a0a84f2f7, documento DEMO-2026-000002/rectificación DEMO-R-2026-000002, cobro1€, reembolso original anulado y corregido1€, conciliación0. Ver docs/hito-36-correccion-reembolsos.md.
37: copia SQLite online y restauración a carpeta nueva, manifiesto/hash/integridad y rechazo de destinos existentes.152 pruebas. Copia real local y recuperación aislada verificadas sin sustituir base activa. Ver docs/copias-locales.md. Contiene datos sensibles locales; no publicar data/.
38: billing.js/warehouse.js separados de shop.js, conciliación propia, ya no se construyen formularios ocultos de otras vistas. Ver docs/hito-38-modulos-interfaz.md.
39: presentación viva de10diapositivas, artifact_6Va8uBblROn24Jvk3nu31v08dSwsaeoG, revisadas renderizaciones. Es borrador, no entrega final ni PowerPoint exportado. Ver docs/presentacion-tfm.md y montaje. README actual consolidado y preguntas/evidencias de defensa preparadas. GitHub/licencia/vídeo/despliegue siguen pendientes. Móvil con CSS revisado, sin viewport real comprobado. Reserva solicitada10% sobre ventana5h (no existe cuota diaria expuesta); no usar reinicios.

## Hito 40 · Tarifas y campañas · 29/10/2026

Usuario acepta ambas funciones, prueba guiada conjunta después. CSVsku/coste compara y guarda lote sin tocar catálogo; revisión distinta aplica costes/versiones con digest/revalidación/atomicidad, desconocidos bloquean y precios/pedidos permanecen. Campañas compara1categoría/hasta3porcentajes/cantidades/fechas de referencia y prepara propuesta con catálogo vigente. Sin programación automática ni LLM para interpretar CSV; comparaciones no persistidas.161pruebas, TS/formato/sintaxis correctos. Menú actualizado accesible, sesión caducada: prueba autenticada pendiente con usuario, sin cambios demo. Leer docs/hito-40-tarifas-campanas.md. Ejemplos preparados. Servidor local reiniciado4317.

## Hito 41 · Stock y análisis comercial · 29/10/2026

Reposición por artículo con ventas registradas de30días, cobertura, punto y cantidad orientativa; parámetros guardados/versionados/auditados. Sin ventas no recomienda cantidad. Avisos de poca salida/exceso/margen y alternativas de categoría, sin asegurar sustitución. Badge de agotados/reposición. Cálculos deterministas; Ollama prioriza hasta20señales de producto y selecciona hasta5, sin comprar ni rebajar automáticamente.167pruebas. Evaluación real14/14válidas12/14completas (dos vacías sin modelo), nuevo caso completo dos veces; no utilidad superior demostrada. Prueba visual autenticada y guiada pendiente con usuario. Ver docs/hito-41-stock-comercial.md.

## Hito 43 · Siete ampliaciones autorizadas · 29/10/2026

Usuario pide implementar todas. Compras con revisión independiente/recepción completa; bandeja diaria con enlaces y resumen IA validado o respaldo por reglas; devoluciones parciales con conservación de céntimos, límites de reembolso, stock e informes; asistente público de compra con catálogo/presupuesto; seguimiento14d antes/después y lectura IA; incidencias con seguimiento, clasificación sugerida y borrador; PDF/TXT/CSV con texto/evidencia, revisión y paso a tarifa o recepción. Sin envío externo ni facturación parcial válida ni OCR. Ver docs/hito-43-operaciones-asistidas.md para alcance y pruebas.

184pruebas,17nuevas. Ollama real: diagnóstico diario sin validar falla (omitía tareas), se conserva y se protege con citas de IDs/respaldo identificado; textos libres requieren revisión, incidencia afirma actuación no confirmada. No afirmar evaluación independiente ni calidad garantizada. Segundo diagnóstico6respuestas aceptadas5criterios limitados. Navegador sigue fallando browser.user is unavailable, revisión visual guiada pendiente; datos demo no alterados por pruebas. pdfjs-dist6.4.299 Apache2 instalado y fijado; Node24 compatible (probado24.14.1, mínimo del proyecto24.12). Ver docs/dependencias-terceros.md. Savepoints añadidos para composición transaccional. Nuevas tablas operation_documents creadas sin credenciales nuevas. Documentos conservan texto/hash, no archivo PDF. Materiales consultados M0001/M0021/M0122/M0487 intactos.

## Hito 44 · Revisión integral cerrada · 30/10/2026

Consultar docs/hito-44-revision-integral.md y docs/docker-local.md. Se recuperó navegador con browser.tabs.new; recorridos manuales completos en copia data/qa-review-20261029, localhost4318, cuentas QA aisladas. Compra/aprobación/recepción, pedido33,52€, devolución/reembolso10,77€ con saldo22,75€ y pendiente0, incidencias, tarifa y PDF, campaña, publicación, carrito antiguo rechazado y seguimiento comprobados. Layout390px probado en iframe de HTML/módulos reales (no dispositivo físico), sin desbordamiento. Capturas docs/revision-20261029.

192pruebas (8 nuevas), TS/formato y Linux Docker. Dockerfile/Compose/.dockerignore añadidos, imagenNode24 fijada por digest, runtime24.22.2 UID1000, raízreadonly, volumen separado, publicaciónloopback4320, Ollama host.docker.internal comprobado; no cuentas predeterminadas. Persistencia y backup Docker probados. Datos habituales4317 conservados, materiales originales intactos; no GitHub ni push.

Corregidos presupuesto/límite de referencias en asistente, navegación con datos frescos/respuestas antiguas descartadas, contador tras criterios stock, propuestas desactualizadas y etiquetas, menú móvil y paneles Cerrar. Rutas operativas en src/http/operations-routes.ts; lectura validada en operation-records.ts. IA:30/30 criterios limitados en15casos×2,6sinmodelo; lectura humana detecta afirmaciones no confirmadas en incidencias. Periodos incompletos ahora se explican por reglas sin modelo; no afirmar fiabilidad total ni evaluación independiente. Recuperación de copia con4tipos operativos e historial válido comprobada.

Pendientes: validación usuario, móvil físico/accesibilidad completa, evaluación externa, antiguos adaptadores/paginación, preparación despliegue público/cuentas, licencia/GitHub/vídeo/presentación final. Fiscalidad DEMO sin validez real. El helper temporal QA se retira al cerrar; bases/copias QA quedan privadas en data/ e ignoradas. Proyecto Docker de prueba changelab-review se detiene conservando su volumen; arranque normal descrito en docker-local.md.

## Revisión de responsabilidades del 04/11/2026

[Roles de empresa](roles-empresa.md) define el estado actual: Antonio decide como propietario, Ana prepara y tramita como oficina y Mario registra las operaciones físicas. El criterio inicial CA03 de autores distintos sigue aplicado a los roles técnicos heredados, pero el usuario ha autorizado que dirección pueda decidir sobre sus propias propuestas mediante aprobación explícita. Esa excepción no permite omitir controles de integridad, versión o margen, ni que la IA publique sin una decisión humana.
