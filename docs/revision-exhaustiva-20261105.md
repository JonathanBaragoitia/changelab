# Revisión del proyecto · 5 de noviembre de 2026

## Resultado y alcance

Se ha revisado código de negocio, autorización, persistencia, correo, IA, arquitectura, documentación y ejecución. Tres revisiones independientes por subagentes, seguidas de correcciones e integración. Las reproducciones y pruebas usan memoria o copias; no se han generado pedidos ni enviado correos externos. Las bases habituales se conservan.

No es una certificación de seguridad, accesibilidad, contabilidad ni ausencia de errores. Las pruebas verifican escenarios concretos. No se ha repetido en esta sesión el recorrido visual completo de todas las pantallas: el control del navegador integrado no estuvo disponible; la alternativa de escritorio no encontró otro navegador abierto. La revisión visual del 3/11 y las capturas del 5/11 son antecedentes, no evidencias de un nuevo recorrido completo.

## Hallazgos corregidos

| Problema reproducido                                                                        | Corrección y comprobación                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desactivar al último propietario restauraba permisos de revisión antiguos                   | La política exige Dirección mientras exista un propietario configurado, aunque esté inactivo. Prueba sobre cuenta y sesiones abiertas, reactivación y comportamiento de instalación antigua sin propietario. No permite iniciar sesión a la cuenta inactiva.                                 |
| El resumen diario aceptaba una tarea válida acompañada de un reembolso o entrega inventados | La IA devuelve exclusivamente IDs conocidos y únicos. La aplicación muestra títulos y detalles guardados, sin prosa libre del modelo. Respuestas con texto extra, IDs ajenos o duplicados usan respaldo por reglas. Esto garantiza procedencia del texto, no que la priorización sea óptima. |
| El evaluador consideraba fiel cualquier resumen que contuviera un ID                        | Ahora comprueba líneas factuales completas. Se conserva la distinción entre respuesta del modelo y respaldo; no se interpreta un resultado por reglas como acierto del modelo.                                                                                                               |
| Reintentar correo no registraba quién lo solicitó                                           | Cambio y auditoría comparten transacción. Se guarda responsable, pedido y estado anterior, sin copiar destinatario ni cuerpo al historial. Pruebas HTTP y reversión al fallar auditoría.                                                                                                     |
| Archivar proveedor o producto bloqueaba recibir una compra previamente autorizada           | La recepción interna vinculada admite referencias archivadas; la entrada libre y las nuevas compras mantienen sus restricciones. La API no acepta indicadores de excepción aportados por el usuario. Pruebas de cantidad, autorización y repetición sin doble stock.                         |
| Algunas previsiones de compra tomaban el día UTC en vez del de Madrid                       | Calendario compartido Europe/Madrid para compras y pedidos. Pruebas alrededor de medianoche, cambios de hora y fines de semana. Sigue sin incluir festivos regionales.                                                                                                                       |
| README exigía siempre otra persona revisora                                                 | Se documenta la decisión vigente: Dirección autoriza, incluida su propia propuesta por decisión explícita del usuario. La especificación inicial queda señalada como histórica.                                                                                                              |
| Los nuevos eventos de correo aparecían con claves técnicas                                  | Nombres y explicaciones en el historial distinguen solicitud, captura local, fallo y aceptación del proveedor. Aceptación no significa recepción en buzón.                                                                                                                                   |

## Arquitectura y buenas prácticas

El monolito modular es proporcional al despliegue local: no hay una necesidad demostrada de microservicios. Dominio y aplicación no importan SQLite ni adaptadores concretos; composición explícita, puertos y pruebas de casos de uso permiten sustituir mecanismos. Las escrituras de negocio y la cola de correo comparten transacción; la llamada externa queda fuera. Se mantienen controles de versión, digest e idempotencia.

La separación tiene límites: `server.ts` concentra composición, autorización HTTP y muchas rutas; `operations.ts` reúne varios casos de uso y utilidades; los errores del núcleo todavía incluyen códigos HTTP. Son deuda técnica, no equivalen a una arquitectura completamente independiente del transporte. Conviene extraer adaptadores HTTP por capacidad y después traducir errores en el borde, conservando contratos y pruebas. No se ha hecho una reescritura amplia durante esta corrección.

Se han añadido comentarios para explicar excepciones de negocio y decisiones de seguridad, evitando narrar instrucciones evidentes. Se conserva tipado estricto y validación de entradas desconocidas. El coste de los productos sigue sin contabilidad por lotes o coste medio: el margen mostrado no debe presentarse como beneficio contable definitivo.

## Evidencias de verificación

- Windows: 253/253 pruebas, TypeScript estricto y formato correctos. Sin pruebas omitidas.
- Los 39 scripts públicos pasan comprobación sintáctica.
- Docker: objetivo `verification` construido con comprobaciones Linux; imagen de ejecución actual arranca con UID 1000, raíz de solo lectura, capacidades eliminadas y datos temporales aislados. Salud HTTP 200. Contenedor de revisión detenido al terminar; no usa el volumen de la aplicación.
- Copia y restauración independiente de las dos bases: 50 tablas comparadas en cada una, idénticas. Las bases activas no se sustituyeron. Evidencia privada en `data/review-20261105-snapshots.json`. Una copia en el mismo equipo no protege ante pérdida del equipo.
- Consulta npm de dependencias de producción: cero vulnerabilidades conocidas en ese momento. No acredita seguridad del código propio ni futuras vulnerabilidades.
- IA local: informe `evaluations/review-2026-11-05T11-48-05.222Z.json`, 30 criterios superados; 18 resultados con `modelUsed:true`. El resumen diario usa selección del modelo en ambas repeticiones y texto factual compuesto por la aplicación. Casos y criterios definidos por el desarrollador; sin evaluación externa ni validación con usuarios.

Los registros completos de comprobación y dependencias están en `data/` excluido de Git, sin necesidad de publicar bases, cuentas o datos personales.

## Seguridad y datos

Se revisaron sesiones, hashes de contraseña, revocación, origen/CSRF, separación de clientes, permisos de empresa y proyecciones sin importes para Almacén. No se encontró otro bypass reproducible en lo revisado. Esto no sustituye una prueba de penetración ni pruebas de carga. La política empresarial se apoya en propietarios configurados: manipular directamente la base no forma parte de una API autorizada y exige proteger el acceso al archivo.

Correo permanece en modo de revisión local. No hay claves ni proveedor real configurados. Las capturas antiguas nunca se convierten automáticamente en envíos al habilitar un proveedor. No se ha probado recepción real, rebotes o bandeja de entrada.

`data/` y `.env` se excluyen de Git; Docker usa fuentes explícitas. Quedan 139 PNG históricos en `docs/` pendientes de revisión visual de privacidad antes de publicar. No se ha demostrado que contengan secretos, pero tampoco se ha acreditado anonimización completa. La cadena de auditoría detecta alteraciones respecto a sus hashes; no es un anclaje externo contra un administrador capaz de reescribir toda la base.

## Límites funcionales que requieren decisión y desarrollo

1. Abonos y sustituciones de proveedor: cerrar una reclamación solo registra una explicación; no acredita devolución de dinero ni reposición. Las roturas pendientes no generan automáticamente esos efectos.
2. Devoluciones dañadas de clientes: falta cuarentena y decisión de destino. No deben registrarse como stock apto para venta.
3. Anular recepción no reabre las cantidades de la compra; requiere corrección trazable. El atajo heredado de recepción desde compra aprobada sigue existiendo por compatibilidad, aunque el recorrido operativo normal pasa por envío y recepción física.
4. Facturación fiscal, pagos y transportista siguen sin integración real. Los documentos actuales no se deben presentar como cumplimiento de Hacienda.
5. Borradores libres de IA requieren revisión humana y pueden contener afirmaciones incorrectas. La corrección factual estricta de esta revisión se aplica al resumen diario, no a toda generación de texto.
6. Pendientes para publicación: saneamiento de capturas, cuentas sintéticas de evaluación, revisión de licencias, GitHub y entregables del TFM. Para despliegue externo: TLS, gestión de secretos, recuperación fuera del equipo, observabilidad y pruebas de carga.

## Relación con el máster

Inventario actualizado: 695 archivos, 44 nuevos, de ellos 19 PDF; ningún archivo anterior cambió ni desapareció por comparación SHA-256. IDs anteriores conservados y nuevas extracciones por página. No se ejecutaron fuentes docentes ni se reutilizó código sin licencia.

Se contrastaron M0001 (casos de uso), M0122 (pruebas), M0133/M0135 (formularios/usabilidad), M0630 (seguridad), y los nuevos M0653 (límites de Clean Architecture), M0654 (aprobaciones y consistencia con outbox) y M0678 (delegación con verificación). Los textos fueron suficientes para estos criterios; no se afirma revisión visual completa de todos los PDF. Son referencias docentes, no una rúbrica oficial ni certificación de la implementación. M0693 es copia exacta de M0645, sin nuevos requisitos de entrega. Ver `outputs/novedades-2026-11-05.md` en el espacio de trabajo.
