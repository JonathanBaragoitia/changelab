> Estado actual: [Roles de empresa](roles-empresa.md). El reparto inicial descrito a continuación se conserva como historial; Ana ahora es Oficina y Antonio es Dirección.

# Preparación de almacén y envíos · 04/11/2026

El rol de aprobación y las responsabilidades logísticas son independientes. Una cuenta revisora puede tener permiso de preparar, de enviar o ambos sin adquirir edición comercial. La tabla `user_order_permissions` guarda `warehouse.prepare` y `orders.ship` por persona; el servidor consulta los permisos vigentes con la sesión, sin confiar en campos enviados por el navegador. Lectura no puede operar aunque se introdujese accidentalmente un permiso.

Se conservan los permisos logísticos anteriores de las cuentas editoras en una migración inicial atómica; las nuevas cuentas editoras reciben esa misma compatibilidad. La migración no repone permisos revocados al reiniciar. Las nuevas revisoras no los reciben automáticamente. Ana y Antonio tienen ambos permisos en las dos bases locales, conforme a la petición del usuario; se hicieron copias verificadas antes de migrar y se auditaron esas concesiones. No hay todavía pantalla administrativa de concesión/revocación: la configuración se mantiene en la base y requiere administración local.

## Recorrido

1. **Pedidos** permite consultar y, con edición, cancelar cuando corresponda. Para un confirmado indica que debe prepararse en Almacén; para un preparado ofrece acceso a Envíos.
2. **Almacén → Preparar pedidos de clientes** muestra confirmados, buscador y hasta 15 resultados. Se comprueban las unidades de cada artículo antes de confirmar **Listo para enviar**. Los demás pedidos siguen accesibles por búsqueda. La confirmación queda guardada con persona y fecha.
3. **Envíos** lista solo preparados y enviados. Con permiso de envíos se registra la salida de paquetes ya preparados. No se puede enviar un confirmado directamente, tampoco por HTTP.
4. **Mis pedidos** muestra preparado/listo para enviar y posteriormente enviado. La bandeja dirige los confirmados a Almacén y los preparados a Envíos.

Preparar y enviar no vuelven a descontar stock; la disponibilidad ya se descontó al confirmar. Los reintentos conservan la primera autoría y no generan movimientos repetidos. Cancelaciones, permisos comerciales y revisión independiente de compras/tarifas conservan sus reglas. Las fechas nuevas respetan el reloj inyectado en los generadores de escenarios. Los registros históricos sin autoría logística explícita se conservan sin inventarla.

## Verificación y límites

231/231 pruebas en la ejecución completa. TypeScript correcto. Las nuevas pruebas cubren permisos separados, revocación, rol conservado, envío sin preparación bloqueado, autoría y stock intacto; recorrido HTTP con revisor habilitado para preparación y después envío. Tras añadir reloj inyectable se repitieron cuatro pruebas de permisos/cancelación, correctas.

Navegador con Ana · Revisión en localhost:4318: el pedido nuevo `d8e6c0e7` aparece primero en Almacén con sus cuatro artículos y botón de confirmación; Envíos muestra tres pedidos previamente preparados con acción de salida. El pedido del usuario no se ha preparado ni enviado durante esta comprobación. Capturas revision-20261104/preparacion.png y envios.png.

La salida es una anotación manual: no contrata transportista ni produce envío real. No se han añadido transportista ni número de seguimiento. La separación actual distingue autorización, preparación física y salida registrada, sin atribuir al modelo IA esas decisiones.

## Actualización: Mario en Almacén y Ana en Envíos

Esta actualización sustituye la distribución anterior que permitía preparar a Ana. Mario es una cuenta individual con perfil operativo de almacén sobre el rol base de lectura; no se le concede edición comercial. En ambas bases locales se crea el usuario `mario`, con la contraseña solicitada por el usuario, almacenada mediante scrypt. La contraseña no se incluye en código ni documentación. Se conserva el rol reviewer de Ana; se retira su permiso de preparación y mantiene `orders.ship`. Antonio conserva sus permisos existentes y la capacidad operativa de recogida de las cuentas editoras.

Flujo:

1. Compra confirmada: el stock ya queda descontado.
2. Mario comprueba las líneas en Almacén y confirma preparado. Se conserva responsable y fecha. El pedido aparece como aviso interno pendiente en Envíos y su contador. No es correo ni notificación externa; se ve al actualizar los datos.
3. Ana tramita el transporte por fuera de la aplicación y registra transportista y referencia de expedición. El pedido sigue preparado. La expedición queda persistida y auditada, y aparece en Almacén como pendiente de recogida.
4. Mario confirma la recogida física. Solo entonces pasa a enviado, con responsable y fecha propios. No se descuenta stock de nuevo.

Mario puede registrar entradas de almacén, recepciones de compras enviadas (completas o parciales) y roturas. No aprueba compras, no tramita expediciones, no modifica precios y no cierra reclamaciones económicas ni realiza ajustes arbitrarios. Las bajas por rotura incorporada se derivan exclusivamente de una incidencia validada, en la misma transacción. La navegación se reduce a Almacén y Roturas. La recepción de compras enviadas se integra dentro de Almacén; la tramitación de compras y envíos queda fuera de su espacio. El servidor aplica una lista explícita de rutas permitidas y bloquea las demás. El espacio de Mario no incluye importes, costes, facturas, cobros, márgenes, correos ni direcciones de clientes. Las respuestas de escritura devuelven solo confirmaciones operativas, sin el documento comercial completo.

Los pedidos históricos mantienen sus autores y estados. No se atribuyen a Mario preparaciones anteriores. Los preparados antiguos pueden tramitarse y recogerse con el nuevo flujo. Las cancelaciones antes de recoger siguen retirando el pedido de las colas y devolviendo existencias una sola vez.

Validación: 233/233 pruebas completas, TypeScript y formato. Pruebas nuevas de perfil, entrada repetida sin doble stock, prohibición comercial, recogida antes de tramitación bloqueada y roturas sin facultad de cierre/ajuste arbitrario. Recorrido visual sobre copia QA con cookie separada: Mario prepara pedido ficticio, Ana tramita con servicio de aplicación, Mario confirma recogida por interfaz; autores y fechas se conservan. El pedido real de la prueba del usuario no se modifica. Copias SQLite verificadas antes de crear las cuentas en datos habituales y mes simulado. Evidencia visual: `revision-20261104/flujo-mario.png`.

Para crear futuras cuentas equivalentes, la utilidad local de usuarios acepta `warehouse`. No existe un endpoint público que permita asignarse este perfil.

### Restricción de acceso y menú exclusivos

Comprobación del 04/11: además del menú reducido, denegación por defecto para el perfil warehouse en la frontera HTTP. Solo se permiten consultar el espacio operativo, compras proyectadas para recibir y roturas; registrar entradas y daños, recibir compras y preparar/confirmar recogidas con los permisos vigentes. Cerrar sesión sigue permitido. Las rutas comerciales devuelven 403. Abrir una sección comercial de la interfaz reconduce a Almacén; esto complementa la autorización del servidor, sin sustituirla.

Pruebas: suite completa 233/233; ampliación dirigida de permisos 4/4, incluyendo GET comerciales bloqueados, campos sensibles ausentes, respuesta de preparación sin importes y recepción vinculada sin precios ni doble stock. Verificación visual con sesión Mario en el mes activo, sin modificar pedidos ni existencias. TypeScript, formato y sintaxis comprobados. Evidencia: `revision-20261104/menu-mario-almacen.png`. Este apartado sustituye la limitación anterior sobre ausencia de confidencialidad adicional para el perfil warehouse.
