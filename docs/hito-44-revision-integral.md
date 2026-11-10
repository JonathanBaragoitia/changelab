# Hito 44 · Revisión integral antes de GitHub

Pruebas realizadas el 29/10/2026; comprobación final y cierre el 30/10/2026. Este estado sustituye las notas de revisión visual pendiente de los hitos 40–43.

## Entorno y evidencia

Se recuperó el control del navegador creando una pestaña mediante la API directa de pestañas. Se creó una copia SQLite bajo data/qa-review-20261029, servida en localhost:4318, con cuentas exclusivas de prueba. La instalación habitual 127.0.0.1:4317 y su sesión permanecieron separadas. Las pruebas no enviaron mensajes, compras a proveedores, pagos ni documentos tributarios reales.

| Recorrido manual    | Resultado observado                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compra a proveedor  | Preparación en edición, aprobación con otra cuenta y recepción de 4 limpiacristales. Stock pasó de 20 a 24.                                           |
| Pedido de cliente   | Dos limpiacristales y un pack de paños: base 27,70 €, IVA demo 5,82 €, total 33,52 €. Preparado, enviado y cobro ficticio anotado.                    |
| Devolución parcial  | Una unidad recibida; reembolso máximo 10,77 €. Tras anotarlo, total y neto 22,75 €, pendiente 0 €. Pedido y precios originales conservados.           |
| Incidencia          | Vinculada al pedido, borrador consultado y resolución manual guardada. Sin envío al cliente.                                                          |
| Tarifa              | Dos filas con evidencia, importadas sin cambiar costes. Otra cuenta revisó y aplicó costes de 4,10 € y 5,20 €.                                        |
| PDF                 | Archivo sintético subido por el selector real, texto extraído y filas corregidas manualmente. Albarán incorporado y aumento de 2 unidades comprobado. |
| Campañas            | Comparación de alternativas −5 % y +5 %, sin publicar por comparar.                                                                                   |
| Simulación estrecha | Formulario completado a 390 px; propuesta creada, precios sin cambios. Posteriormente otra cuenta publicó en la copia de revisión.                    |
| Carrito antiguo     | Rechazado tras cambiar el precio. Al recargar, pedido correcto con precio nuevo.                                                                      |
| Seguimiento         | Venta posterior: una unidad, 23,66 € netos y 11,66 € de margen. Periodo incompleto indicado.                                                          |
| Permisos            | Cuenta lectora sin controles para crear compras ni extraer documentos. Revisión independiente comprobada con cuentas distintas.                       |
| Criterios de stock  | Rechazo de objetivo menor que plazo más reserva; configuración válida guardada después, sin comprar mercancía.                                        |

Referencias de la copia: pedido 57075706-c0b6-4719-ae3e-f335ad77235c y venta posterior 24996330-374f-4ebb-b08c-15d28c2b527e. No son operaciones de la instalación habitual.

## Correcciones encontradas

1. El asistente recibía artículos filtrados individualmente por precio, pero no el presupuesto total. Ahora recibe presupuesto y máximo de referencias; el servidor valida ambos. La interfaz permite producto único o conjunto. Repetición manual: limpiacristales de 10,77 € dentro de 20 €.
2. Al navegar se reutilizaban datos anteriores y un pedido creado en otra pestaña no aparecía hasta actualizar. La navegación vuelve a cargar el espacio y descarta respuestas antiguas; conservar la sesión y los permisos sigue siendo responsabilidad del servidor.
3. Actualizar criterios de stock vuelve a cargar también el espacio, para mantener al día su contador de avisos.
4. La bandeja identifica propuestas desactualizadas y traduce los estados. Se corrigieron etiquetas de devolución parcial y formato de porcentajes.
5. En pantallas pequeñas el menú puede abrirse/cerrarse y se cierra al elegir una tarea. En escritorio la identidad queda visible y la lista de tareas desplaza su propia zona. Los paneles abiertos muestran Cerrar.
6. La IA describió cambios solapados pese a haber cero y repitió nombres internos de campos. Para periodos incompletos la explicación utiliza datos calculados y no llama al modelo. La lectura IA de periodos completos conserva revisión humana y contexto expresado con más claridad.

## Código y datos

Rutas operativas extraídas a src/http/operations-routes.ts, después del control de sesión y CSRF. Nuevos registros persistidos se validan al leer: identificadores, versión, estados, cantidades, total de compras, autor/revisor y hash del texto original. Una inconsistencia se rechaza antes de operar. Otros adaptadores antiguos conservan validación parcial; esto no acredita revisión exhaustiva de toda la seguridad.

La copia de recuperación conservó compras, incidencias, devoluciones parciales y documentos importados; hash de copia y restauración coincidentes e historial válido. [Evidencia](revision-20261029/recuperacion.json). El punto restaurado es una instantánea de la revisión, no una copia de cada operación posterior.

## Interfaz y móvil

El cambio de viewport de la herramienta no se aplicaba realmente. Se comprobó el ancho mediante un marco de prueba de 390 px que cargaba el HTML, CSS y módulos reales, en el servidor aislado. Se midieron 390 px de viewport y un ancho de documento de 375 px, sin desbordamiento horizontal del contenido. Menú y simulador funcionaron. Esto es una comprobación de layout e interacción, no una prueba en un teléfono ni una auditoría completa de accesibilidad.

[Análisis comercial](revision-20261029/analisis-comercial.png) · [Simulador a 390 px](revision-20261029/movil-390.png) · [Seguimiento corregido](revision-20261029/resultados.png).

## Evaluación de IA

15 casos con dos repeticiones: 30/30 respuestas cumplen los criterios automáticos limitados. Seis comprobaciones no invocan el modelo (sin candidatos, sin stock o bandeja vacía); no deben contarse como llamadas correctas de IA. Se guardan modelo, digest, entradas, hashes, duración y salidas. [Informe](evaluations/review-2026-10-29T11-49-55.778Z.json).

La lectura humana detectó actuaciones en curso y contacto futuro no confirmados en borradores de incidencias, aunque pasaban las palabras clave. Se conserva esa conclusión. El éxito de la clasificación y del contrato JSON no demuestra fidelidad del texto ni utilidad con usuarios. El diagnóstico del periodo incompleto precede al cambio que lo resuelve por reglas; su versión corregida se comprueba con regresión y recorrido manual. No hay evaluación externa independiente.

## Comprobación final

192 pruebas, TypeScript y formato correctos en Windows; mismo conjunto comprobado en la imagen de verificación Linux. Ocho regresiones nuevas respecto a las 184 pruebas del hito 43. Docker runtime saludable, sin privilegios de root, conectado a Ollama y con persistencia comprobada. [Arranque y límites de Docker](docker-local.md).

Materiales consultados: M0001 (casos de uso), M0021/M0122 (pruebas), M0487 (evaluaciones) y M0458 (contenedores). Son referencias docentes; decisiones de pruebas y alcance son propias. Originales intactos.

## Pendientes reales

Validación del usuario sobre los flujos; prueba en dispositivo físico y accesibilidad más amplia; evaluación con usuarios/datos reales; paginación de servidor y validación de adaptadores antiguos; operación compartida, recuperación de cuentas y seguridad para despliegue público. Siguen pendientes licencia, repositorio GitHub, presentación final y vídeo. Los documentos fiscales, cobros y envíos siguen siendo de demostración. No se ha publicado nada en GitHub.
