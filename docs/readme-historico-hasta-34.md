# ChangeLab

Plataforma de propuestas de cambio de datos con simulación, validación y aprobación independiente. Proyecto de TFM iniciado el **26 de octubre de 2026**, tras la aceptación del usuario. Primera entrega local, funcional y limitada; no es un producto terminado.

## Estado real

- Catálogo ficticio Norte AutoCare con 18 productos de limpieza del automóvil en seis categorías.
- Tienda de demostración: búsqueda, carrito, pedidos persistentes, existencias y métricas de margen bruto. Consulta [hito-06-tienda.md](docs/hito-06-tienda.md). Sin cobros, cálculo de IVA ni facturas.
- Simulación por categoría y porcentaje, sin modificar el catálogo.
- Restricción de margen bruto mínimo del 20 %; importes en céntimos.
- Revisión del antes/después y publicación transaccional por un rol distinto.
- Comprobación de versiones y del hash exacto de la propuesta revisada.
- Persistencia SQLite e historial con hashes encadenados.
- Interfaz web adaptable con bandeja, catálogo, pedidos e historial.
- Revisión de precios y márgenes por producto, con costes capturados en nuevas simulaciones.
- Escenarios de cantidades explícitas: ingresos, coste, contribución bruta y margen agregado, sin escribir datos ni predecir demanda. Las propuestas antiguas sin coste no inventan márgenes. Ver docs/hito-04.md y docs/verificacion-hito-04.md.
- Adaptador de Ollama local, endpoint de interpretación y revisión del plan integrados. **Modelo local instalado y evaluado: 23/23 casos del conjunto de desarrollo con catalog-v6.** Si Ollama no está disponible, el asistente aparece desactivado y se conserva el modo manual.
- **Cuentas locales con contraseña y sesiones persistentes.** Los permisos se obtienen del servidor y X-Demo-User no concede acceso. No hay cuentas predeterminadas: configura las tuyas con create-user.cmd. No es todavía una solución de identidad preparada para despliegue público.

## Ejecutar

Requiere Node.js 24 LTS, versión 24.12 o posterior dentro de la rama 24. Verificado con 24.22.1. La ejecución usa módulos integrados de Node. Para desarrollar y comprobar tipos/formato, instala las dependencias fijadas con npm ci --ignore-scripts.

```sh
cd changelab
npm start
```

Abre http://127.0.0.1:4317. También se puede ejecutar directamente:

```sh
node src/server.ts
node --test tests/*.test.ts
```

La aplicación escucha exclusivamente en loopback. PORT permite cambiar el puerto. CHANGELAB_DB permite elegir otra ruta SQLite. Por defecto los datos quedan en data/changelab.sqlite (ignorado por Git). Para una demostración nueva, usa una ruta nueva de base de datos; no borres datos para reiniciar un escenario.

## Acceso y recorrido de demostración

Ejecuta create-user.cmd (o npm run users:create) y crea una cuenta editor y otra reviewer con contraseñas propias de 9–128 caracteres. La escritura de la contraseña se oculta. Consulta [cuentas-locales.md](docs/cuentas-locales.md).

1. Entra con la cuenta editora y prepara una subida del 5 % en Lavado exterior.
2. Simula y revisa precios, márgenes y un escenario de cantidades. Todavía no cambia el catálogo.
3. Cierra sesión. Entra con la cuenta revisora y publica después de revisar.
4. Comprueba el catálogo y el pedido PED-1042: el catálogo cambia; el pedido conserva sus importes.
5. Simula una rebaja del 25 %: queda bloqueada por margen insuficiente.
6. Una cuenta viewer puede consultar y calcular escenarios; el servidor deniega creación/publicación.

Las propuestas antiguas de Elena/Marcos/Lucía conservan identidades históricas de demostración. No se atribuyen automáticamente a tus cuentas.

Los precios se redondean al céntimo con Math.round. El margen bruto es (precio − coste) / precio, no el recargo sobre el coste. La regla de 20 % es una decisión del caso de estudio, no un requisito del máster ni asesoramiento comercial.

## Arquitectura y estructura

```text
src/domain/          Tipos y reglas puras del catálogo
src/application/     Casos de uso y puertos
src/infrastructure/  Repositorio SQLite e historial
src/server.ts        Adaptador HTTP y composición de dependencias
public/              Interfaz HTML, CSS y JavaScript
 tests/              Reglas, integración, transacciones y API
 docs/               Especificación, decisiones y evaluación
```

La aplicación depende de interfaces para persistencia, reloj, identificadores y digest. No depende de SQLite ni HTTP en dominio o casos de uso. El adaptador HTTP conecta las piezas. TypeScript se ejecuta con el soporte nativo de Node; esto **no realiza comprobación estática de tipos**. El comando npm run typecheck ejecuta ahora TypeScript estricto por separado. npm run format:check verifica el formato y npm test ejecuta las pruebas. npm run check reúne las tres comprobaciones.

## Frontera preparada para la IA

El caso de uso PreparePlan recibe un generador asíncrono que devuelve datos desconocidos. Valida tres respuestas posibles: plan, petición de aclaración o rechazo. Un plan solo permite categoría y porcentaje; se vuelve a simular con los datos actuales y no se guarda ni publica automáticamente. El generador recibe exclusivamente instrucción y categorías, sin conexión a SQLite.

El hito 03 conecta esta pieza a POST /api/plans y al asistente del formulario mediante un adaptador HTTP real de Ollama. El resultado se revisa y se traslada al formulario antes de simular. No persiste ni aprueba automáticamente. Un formato correcto tampoco prueba que el plan refleje lo pedido; la primera evaluación real está documentada en docs/correccion-interpretacion.md, con sus límites. Consulta docs/hito-03.md y docs/ollama-local.md.

## Límites de seguridad

Es una aplicación local con cuentas y permisos de servidor, sin auditoría externa de seguridad. La cadena de hashes detecta alteraciones sin recomputar los hashes; no protege frente a un administrador que controle toda la base de datos y puede recalcularla. No hay firma externa, sellado temporal ni control externo de integridad. La interfaz avisa de ello.

La publicación vuelve a comprobar los precios, costes y versiones, y aplica todas las escrituras dentro de BEGIN IMMEDIATE. Un fallo revierte catálogo, propuesta y evento de publicación. No existe endpoint para ejecutar SQL ni modificar pedidos. La protección de pedidos se basa en su instantánea y en excluirlos de las operaciones permitidas; los nuevos pedidos de demostración usan tablas separadas con stock y costes capturados; no hay todavía gestión completa del ciclo comercial.

## Siguientes hitos

1. Contratos OpenAPI y validación de lecturas de persistencia; valorar PostgreSQL con migraciones cuando el alcance lo requiera.
2. Evaluar proveedor de identidad, recuperación de cuenta, pertenencia a espacios y despliegue HTTPS.
3. Ampliar la evaluación del modelo con un conjunto independiente y medir variabilidad; mantener regresiones.
4. Pruebas de navegador automatizadas, CI y despliegue privado con secretos gestionados.
5. Evaluación de utilidad, rendimiento y errores; memoria, presentación y vídeo.

## Atribución y licencia

Código nuevo preparado en esta conversación con asistencia de IA. No se ha copiado ni ejecutado código docente. Los materiales del máster se citan como referencia conceptual en docs/especificacion.md. Sin licencia de redistribución elegida todavía; decidirla antes de publicar el repositorio. No se ha creado ni subido ningún repositorio remoto.

## Accesos para Windows

start-local.cmd inicia el servidor con el Node incluido en Codex si está disponible, o con el Node instalado en PATH. test-local.cmd ejecuta la suite. No instalan software ni cambian la política de ejecución. Cierra el servidor con Ctrl+C.

## Hito 07 · Tienda independiente

Tienda cliente local en /tienda, separada de la gestión en /. Compra invitada con datos ficticios y pedidos propios por sesión durante 7 días. Sin costes/márgenes ni pedidos ajenos en API cliente. Leer docs/hito-07-clientes.md. 73 pruebas superadas. Ficha individual, cuentas recuperables, estados de gestión, facturación y pagos pendientes.

## Hito 08 · Estados y movimientos

Estados preparado/enviado/cancelado, cancelación atómica con reposición y movimientos, métricas que excluyen cancelados y estado visible al cliente. Solo editor gestiona, con expectedStatus. 78 pruebas superadas. Leer docs/hito-08-pedidos.md. Recepciones de proveedor, devoluciones tras envío y facturación siguen pendientes.

## Hito 09 · Recepciones de almacén

Entrada con producto/unidades/proveedor/albarán, transacción de stock/movimiento/recepción/auditoría, reintentos sin duplicación y bloqueo de albarán-artículo duplicado. Solo editor. 81 pruebas superadas. Leer docs/hito-09-recepciones.md. No confundir recepción con factura, pago, gasto o actualización del coste de catálogo.

## Hito 10 · Borradores sin validez fiscal

Borrador por pedido con datos fiscales ficticios y vista imprimible. Hipótesis explícita de total con IVA 21 % incluido; no cambia pedidos ni métricas existentes. Sin numeración/emisión fiscal ni cumplimiento declarado. 86 pruebas. Leer docs/hito-10-borradores.md; faltan edición de borrador y fiscalidad coherente desde compra antes de emisión.

## Hito 11 · Revisiones de borradores

Corrección de datos fiscales con motivo, versiones conservadas y bloqueo de edición desactualizada. Solo editor, sin cambiar importes/pedidos/stock. 88 pruebas superadas. Leer docs/hito-11-revisiones.md. Sigue sin emisión ni validez fiscal. El usuario pide aplazar retoques visuales.

## Hito 12 · IVA desde compra

Nuevos pedidos demo-net-v1 con snapshot base/IVA21/total; catálogo y costes netos. Sale.totalCents conserva base por compatibilidad, Sale.tax.totalCents y customerView.totalCents incluyen IVA. Históricos intactos, fiscalMetrics separado. 89 pruebas. Leer docs/hito-12-iva.md. Sin emisión fiscal.

## Hito 13 · Emisión DEMO

Emisión numerada solo de prueba, snapshot fijo, contador transaccional, reintentos sin duplicar. Bloquea edición de borrador emitido y cancelación ordinaria de su pedido. 91 pruebas. Leer docs/hito-13-emision-demo.md. Sin validez fiscal; rectificación pendiente. Diseño aplazado.

## Hito 14 · Rectificación total DEMO

Documento negativo con serie DEMO-R, motivo y referencia original; conserva original. Sin stock, cancelación, cobro ni reembolso automático. billingMetrics separado de ventas. 93 pruebas. Leer docs/hito-14-rectificacion.md. Siguiente bloque: control económico/gastos/cobros por periodo. Sin validez fiscal; diseño aplazado.

## Hito 15 · Control económico

Gastos operativos y resultados netos por periodo (Europe/Madrid), excluye históricos sin fiscalidad y cancelados actuales. Resultado parcial, no beneficio neto ni caja. Registro de gastos solo editor, duplicados/reintentos controlados. 97 pruebas. Leer docs/hito-15-economia.md. Próximo: cobros/pagos y pendientes. Diseño aplazado.

## Hito 16 · Cobros y pagos manuales

Anotaciones parciales/completas en pedidos/gastos, pendientes acumulados, límite transaccional y duplicados. Solo editor. 101 pruebas. Leer docs/hito-16-cobros.md. No mueve dinero, no conciliación bancaria/documental ni reversión todavía. Próximo: cierre de gestión comercial/correcciones. Diseño aplazado.

## Hito 17 · Anulación de anotaciones erróneas

Reversión lógica con motivo/autor/fecha, original conservado y pendientes recalculados; no reembolso. Solo editor, reintentos sin duplicar. 103 pruebas. Leer docs/hito-17-anulacion.md. Próximo: devoluciones físicas/ajustes de almacén. Diseño aplazado.

## Hito 18 · Devoluciones y ajustes

Warehouse: devolución total de enviado apta para reponer, estado returned terminal, stock una vez; ajustes con expectedQuantity y motivo. Returned excluido de ventas, bloquea nuevos cobros/borradores/emisión. Sin reembolso/rectificación automática. 106 pruebas. Leer docs/hito-18-almacen.md. Diseño aplazado.

## Hito 19 · Fichas de producto

Ficha modal de tienda con formato/referencia/stock/desglose y añadir al carrito. Navegador comprobado sin confirmar compra. Ver docs/hito-19-fichas.md. Imágenes/diseño/cuentas recuperables y pendientes de gestión comercial siguen abiertos.

## Hito 20 · Cuentas de cliente

Registro/login/logout local separado de employees, scrypt, rotación de sesión/CSRF y rate10/IP/min. Registro conserva pedidos del invitado actual; login no migra otros invitados.107 pruebas. Leer docs/hito-20-cuentas-cliente.md. Sin verificación/reset/MFA/direcciones, no crear credenciales reales sin usuario. Diseño aplazado.

## Hito 21 · Dirección habitual

Guardar/quitar una dirección de entrega por cuenta cliente, precarga checkout y pedidos conservan instantánea. Cambiar identidad limpia datos del formulario.109 pruebas. Leer docs/hito-21-direcciones.md. Sin libreta múltiple ni verificación postal, UI autenticada no comprobada manualmente. Diseño aplazado.

## Hito 22 · Gestión de catálogo

Alta artículo con precio/coste inicial y stock0; edición de metadatos/archivo/reactivación con versión. Precios existentes siguen por ChangeLab. Descripción propia en ficha.111 pruebas. Demo ahora19artículos tras alta NA-019 aplicador de espuma. Leer docs/hito-22-catalogo.md. Diseño aplazado.

## Hito 23 · Consulta de pedidos

Búsqueda cliente/referencia, estado/fechas y páginas visuales de15. Indicadores globales separados. Navegador comprobado con3pedidos; no paginación SQL ni prueba multipágina. Ver docs/hito-23-consulta-pedidos.md. Diseño aplazado.

## Hito 24 · Proveedores

Fichas de contacto con versión/archivo/reactivación y selección activa en recepciones. SupplierId y nombre snapshot, históricos intactos, duplicados controlados tras renombrar.114 pruebas. Proveedor ficticio Suministros de Limpieza Demo creado visualmente. Leer docs/hito-24-proveedores.md. Preview reiniciado; diseño aplazado.

## Hito 25 · Contexto comercial y priorización IA

Señales deterministas por categoría sobre30d y ranking local Ollama de IDs existentes, sin PII ni escritura. Valida prioridad/IDs y snapshot vigente.117 pruebas y prueba real corregida tras omisión inicial. Leer docs/hito-25-analisis-ia.md. No mejora comercial demostrada ni predicción. Siguiente: enlazar señal con simulación explícita. Diseño aplazado.

## Hito 26 · Señal a simulación

Análisis comercial permite a edición elegir señal, porcentaje y motivo y crear propuesta por el flujo existente. Contexto/hash con productos y versiones, agotados excluidos, sin publicación automática.119 pruebas. Prueba visual Interior−5% guardada pendiente, precios intactos. Ver docs/hito-26-simulacion-comercial.md. Diseño aplazado; beneficio comercial no demostrado.

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
