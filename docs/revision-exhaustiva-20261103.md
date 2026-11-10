# Revisión ampliada · 3 de noviembre de 2026

## Criterios y referencias

Se consultaron el inventario y los mapas del máster, el estado actual del proyecto y las extracciones M0001 (casos de uso y separación de responsabilidades), M0122 (mapa de pruebas), M0133 (formularios y revelación progresiva), M0135 (estado visible, prevención/recuperación de errores y accesibilidad), M0630 (seguridad de APIs). Los textos fueron suficientes para estos criterios; no se ejecutó ni modificó código docente. Las decisiones e implementaciones siguientes son propias del TFM, no requisitos oficiales ni certificaciones del curso.

## Alcance comprobado

- Revisión estática de autenticación/sesiones, permisos HTTP, CSRF/origen/host, límites de documentos, uso de IA, entradas/salidas y persistencia. Casos de uso de ventas, stock, compras, tarifas, devoluciones, caja y reclamaciones contrastados con las pruebas e invariantes documentadas.
- Los 35 scripts públicos pasaron comprobación sintáctica y todos tienen ruta en el servidor. TypeScript estricto y formato se comprueban por separado.
- Navegador: los 18 apartados de gestión consultados con rol revisor en oscuro y editor en claro. Ambas series se comprobaron también a 390 píxeles: 72 vistas, sin desbordamiento global detectado ni campos visibles sin etiqueta en las inspecciones registradas. Las comprobaciones de geometría no acreditan conformidad WCAG ni prueban todos los desplegables/teclados/lectores de pantalla.
- Formularios de creación principales desplegados donde estaban disponibles. La configuración de reposición anidada no se recorrió por completo. Tienda, carrito y pedidos propios revisados a 390 píxeles; ficha de producto comprobada además en escritorio. Sin compras ni pagos reales.
- Rol editor probado sobre copia privada de SQLite con cuenta sintética y cookie separada; la baja de una garrafa desde UI pasó stock de 18 a 17 y creó historial. Las bases habituales y del mes no recibieron esa operación.
- Recarga y botón Atrás conservaron Roturas en transporte. No hubo errores de consola observados en ese recorrido.

Las capturas y resultados están en `revision-exhaustiva-20261103/`: `pantallas.json`, `movil.json`, `editor.json`, `editor-movil.json`, `tienda-movil.json` y PNG asociados. Son evidencias de una ejecución local, no tests E2E automatizados persistentes.

## Hallazgos corregidos y razón

| Hallazgo                                                                  | Corrección y propósito                                                                                                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recargar devolvía a la entrada y Atrás no seguía los apartados            | Sección validada en la URL, historial del navegador y recuperación tras sesión. Lista cerrada; no admite destinos arbitrarios.                                                    |
| Historial decía 100 eventos mientras pintaba más de 800                   | Páginas de 25, filtros de fechas/referencia, cuenta visible y orden por fecha del hecho. No modifica secuencia/hash de auditoría.                                                 |
| Eventos nuevos mostraban claves internas y hashes siempre visibles        | Nombres de negocio para compras, transporte y ofertas; información técnica plegada.                                                                                               |
| Cabecera apretada, paneles contiguos y texto oscuro difícil de leer       | Separación y ajuste flexible de cabecera, margen entre paneles y contraste del texto del historial.                                                                               |
| Carrito vacío mostraba formulario de entrega y total cero                 | Mensaje vacío con acceso al catálogo; formulario solo con artículos. Título principal visible propio del carrito.                                                                 |
| Modelo devolvía solo un identificador como resumen                        | Para aceptar resumen debe citar ID y contenido de una tarea; en caso contrario se muestra respaldo por reglas, identificado. No se presenta ese respaldo como calidad del modelo. |
| Recomendación vacía tenía mensaje de selección genérico                   | Explica que no existe recomendación y propone concretar uso/superficie.                                                                                                           |
| PDF tenía límite por proceso pero podía abrir varios procesos entre rutas | Límite compartido de un lector PDF por proceso, 429 comprensible y liberación tras éxito/fallo. El texto manual sigue disponible.                                                 |
| Registro de transporte persistido se leía como JSON confiable             | Validación de identidad, cantidades, estados, fechas y resolución al leer; corrupción bloquea operación. Consulta por ID directa.                                                 |
| README describía capacidades/cifras antiguas                              | Actualizado con navegación, originales, mes separado y referencias actuales.                                                                                                      |

Se conservan las funciones con efectos distintos: compra/recepción, reclamación/baja, devolución/reembolso y propuesta/aprobación. No se elimina información histórica para hacer parecer más sencilla la aplicación.

## IA: qué se midió

Evaluación local con qwen3:4b-instruct, 15 casos sintéticos repetidos dos veces: selección/presupuesto, indisponibilidad, descripción no confiable, extracción literal/ambigua, incidentes y resúmenes. Informe final `evaluations/review-2026-11-03T12-04-33.625Z.json`.

Los 30 criterios del sistema pasaron, incluyendo respuestas por reglas y casos sin invocar modelo. El resumen diario usó respaldo en ambas repeticiones después de endurecer la validación. Por tanto, no significa 30 respuestas del modelo correctas ni 100 % de calidad de IA. Los borradores de reclamación todavía pueden sugerir actuaciones no acreditadas y exigen revisión humana; no se envían. Evaluación definida por el desarrollador, no independiente ni validación con usuarios.

## Datos, dependencias y ejecución

La auditoría de dependencias de producción del registro npm no encontró vulnerabilidades conocidas en esta consulta; no demuestra ausencia de vulnerabilidades nuevas o del código propio. Informe privado `data/dependency-audit.json`.

Se tomó copia SQLite consistente del escenario y se restauró en un destino nuevo. Ventas, pedidos, inventario, movimientos, auditoría, tarifas y roturas coincidieron fila a fila; SQLite íntegro. No se sustituyeron bases activas. Una copia en el mismo disco no protege ante pérdida del equipo.

Docker: objetivo de verificación construido; ejecución en proyecto `changelab-exhaustive-20261103`, puerto 4324 y volumen propio. Salud correcta, proceso UID 1000 y Node v24.22.2. El puerto 4317/4318 conserva su ejecución local. Se detiene el contenedor de revisión al terminar, conservando volumen. Sin publicación de imágenes ni despliegue externo.

## Cierre de las verificaciones

228/228 pruebas en Windows, TypeScript estricto correcto y comprobación global de formato correcta. La imagen del objetivo `verification` se reconstruyó con las correcciones y ejecutó sus comprobaciones Linux. El contenedor de ejecución separado respondió saludable y se detuvo conservando el volumen; el servidor QA y las pestañas de revisión también se cierran al terminar. Los servidores habituales permanecen disponibles.

Se conserva además el apartado al cambiar entre las dos bases locales. Las fechas del historial incluyen año para no confundir registros de ejercicios diferentes. Verificación sintáctica adicional de frontend tras ese ajuste.

## Límites pendientes

La revisión previa de negocio sigue vigente: coste real por lotes/coste medio, abonos y sustituciones de proveedores con seguimiento estructurado, devoluciones no aptas de clientes y rectificación parcial documental. Una reclamación cerrada no acredita abono ni recepción. Pagos, facturas y envíos siguen simulados o anotados manualmente. La IA no sustituye comprobación ni autorización.

No hay certificación de seguridad, accesibilidad, contabilidad/fiscalidad ni garantía de ausencia de errores. No se han probado todos los estados combinados, todos los dispositivos ni carga de producción. El valor de esta revisión está en hallazgos reproducibles, correcciones y evidencia trazable, no en afirmar perfección.
