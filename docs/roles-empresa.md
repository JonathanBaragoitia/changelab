# Responsabilidades de dirección, oficina y almacén

Estado: 04/11/2026. Reparto solicitado por el usuario. Sustituye la distribución anterior Antonio/editor y Ana/reviewer.

| Persona | Perfil                | Responsabilidad                                                                                                                                                                                                                                     |
| ------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Antonio | Dirección (`owner`)   | Acceso a todos los apartados. Decide precios, tarifas, compras, gastos, reembolsos, rectificaciones y anulaciones económicas. Puede preparar con IA y aprobar de forma explícita.                                                                   |
| Ana     | Oficina (`office`)    | Prepara propuestas y documentos con IA, solicita gastos, prepara compras, tramita expediciones, registra justificantes ya autorizados, cobros y pagos de gastos autorizados, y gestiona reclamaciones. No aplica precios ni aprueba compras/gastos. |
| Mario   | Almacén (`warehouse`) | Existencias, recepciones, reporte de daños, preparación, recogidas y recepción de devoluciones aptas para vender. No consulta importes comerciales ni decide reembolsos.                                                                            |

Las responsabilidades se guardan en servidor por cuenta, no por nombre visible. Antonio y Ana conservan un rol técnico de edición, complementado por el perfil de empresa. Mario conserva lectura con permisos físicos explícitos. Una vez configurada dirección, las cuentas antiguas de revisión dejan de autorizar cambios comerciales: se comprueba `ownerApprovalRequired` en cada sesión.

## Flujos

- Pedido: compra → Mario prepara → aviso a Ana → Ana registra transportista/referencia tras tramitarlo → aviso a Mario → Mario confirma recogida → estado enviado y aviso a oficina. Preparar o recoger no descuenta stock otra vez.
- Compra a proveedor: Ana prepara → Antonio aprueba o pide cambios → Ana tramita → Mario recibe las cantidades reales. Las entregas parciales mantienen el resto pendiente. Las roturas se registran aparte sin inventar pagos ni reposiciones.
- Precio: Ana importa el documento o prepara una simulación/tarifa → Antonio revisa la versión exacta y aplica. Ana no tiene una ruta alternativa para modificar ofertas o crear precios iniciales del catálogo.
- Gasto: Ana solicita el importe real → Antonio decide → Ana registra el justificante del importe autorizado. Para las cuentas de empresa se elimina la aprobación automática de gastos pequeños. Las solicitudes históricas conservan su decisión; una aprobación antigua automática no habilita a Ana para ejecutar un gasto nuevo sin dirección.
- Devolución: Mario comprueba y registra únicamente unidades recibidas aptas para vender → se repone stock una vez y se avisa a oficina. Reembolso/rectificación son decisiones separadas de dirección. La recepción de devoluciones dañadas todavía necesita un circuito específico de cuarentena; no se deben registrar como mercancía vendible.

## Avisos internos

Panel desplegable compartido, actualizado al cargar y cada 30 segundos, con responsable, fecha, enlace al apartado y lectura individual persistente. Los leídos quedan plegados. Se derivan de hechos auditados y no se duplican al repetir una operación. Mario solo recibe avisos destinados al almacén; Ana, los de oficina; dirección puede supervisar todos. El servidor valida también marcar como leído, no solo la interfaz.

Los avisos nuevos empiezan en el evento auditado de configuración del reparto; no reinterpretan preparaciones o aprobaciones antiguas como si las hubiesen hecho Mario o Antonio. El historial original sigue intacto. La consulta actual examina hasta 5.000 hechos posteriores al reparto y muestra hasta 100 avisos; no es un servicio externo de mensajería con garantía de entrega ilimitada.

## Decisiones y límites

El propietario es el único responsable comercial configurado y puede aprobar también una propuesta que haya preparado él, mediante una segunda acción explícita. Esta es una decisión de negocio del usuario que sustituye el criterio original de separación de autores para el perfil propietario. Las cuentas de oficina y almacén no obtienen esta excepción. Se conservan validación de versión, digest, margen mínimo, transacciones, idempotencia y autoría: la IA no publica por sí sola.

Los correos reales no están conectados. La carga manual de PDF/tarifas y su revisión funcionan con el perfil de oficina; recibir un buzón y enviar mensajes requiere integrar una cuenta de correo y definir destinatarios/plantillas. Esta revisión no ha leído ni enviado correo externo. Pagos, transporte y documentos fiscales siguen teniendo las limitaciones de demostración documentadas en el proyecto.

## Validación y referencia docente

237/237 pruebas completas; 8/8 dirigidas después de ordenar los mensajes de permisos. Casos: gastos pequeños pendientes, oficina incapaz de aprobar/publicar/modificar ofertas, dirección aplica propuestas, justificante conserva importe autorizado, almacén recibe devoluciones sin doble stock ni datos económicos, avisos entre perfiles con lectura individual, corte del historial y bloqueo de revisores antiguos. TypeScript, formato y sintaxis de 37 scripts comprobados.

Prueba visual de oficina sobre copia SQLite aislada: pedido ficticio preparado por Mario, aviso recibido por Ana, marcado como leído y traslado al historial. Pantalla de Mario revisada en lectura, con tareas agrupadas y formulario excepcional de entrada plegado. No se han modificado pedidos ni stock reales. Copias SQLite verificadas antes de cambiar perfiles en las dos bases.

Evidencias: `revision-20261104/aviso-mario-ana.png` y `revision-20261104/almacen-roles-final.png`.

Aplicación del material: [M0001, casos de uso](../../outputs/textos/M0001.txt), [M0122, pruebas](../../outputs/textos/M0122.txt), [M0135, usabilidad](../../outputs/textos/M0135.txt), [M0630, seguridad de APIs](../../outputs/textos/M0630.txt). Los perfiles concretos y su matriz de decisión son requisitos del usuario, no requisitos oficiales del máster.

Comprobación final de datos: `inventory`, `sales` y `products` coinciden mediante huella con las copias previas en ambas bases; quick_check correcto, cero referencias rotas y cadena de auditoría válida. La bandeja identifica al destinatario y evita mostrar avisos de otra cuenta si se cambia de sesión en otra pestaña; pide actualizar la vista en ese caso.

## Actualización del 05/11/2026 · Correo saliente

El [servicio de correo](correos-envios.md) ya prepara confirmaciones, envíos y cancelaciones con cola persistente y revisión en oficina. Sigue sin cuenta externa configurada; no hay envíos reales ni recepción de buzón. Mis pedidos incorpora datos de expedición y estimación desde la recogida.248/248 pruebas.
