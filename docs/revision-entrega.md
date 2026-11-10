# Revisión de ChangeLab para la entrega

10 de noviembre de 2026. La revisión cubrió los recorridos de la tienda y de gestión, los permisos, la persistencia, la IA y el arranque. Las operaciones de prueba usaron datos ficticios o copias independientes.

## Correcciones

| Hallazgo                                                                               | Comportamiento comprobado                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Un correo pendiente podía cambiar de tratamiento tras reiniciar con otro proveedor.    | El modo de vista previa se guarda junto con el pedido. El escenario mensual y la demo fuerzan ese modo. Los pendientes históricos anteriores a esta corrección se deben revisar antes de habilitar un proveedor. |
| Un editor heredado podía acceder a la recepción física a través de un albarán.         | La autorización se comprueba en el caso de uso. La ruta directa y la documental bloquean el mismo actor.                                                                                                         |
| Cancelar una venta o devolver mercancía apta podía rebasar el límite de stock.         | Ambas operaciones se revierten si la reposición superaría el límite. Las unidades dañadas se registran por separado.                                                                                             |
| El orden de los campos JSON podía impedir un reintento de recepción.                   | Se compara la misma entrega por sus datos. Un cambio en cantidad o referencia sigue produciendo un conflicto.                                                                                                    |
| Una petición directa sobre cuero podía acabar en una recomendación sin compatibilidad. | El comprador exige una ficha con compatibilidad explícita, también si la consulta menciona el material directamente.                                                                                             |
| Los borradores y el seguimiento podían incluir afirmaciones libres del modelo.         | Incidencias usa una categoría sugerida y una plantilla revisable. El seguimiento presenta cifras calculadas. Si una fila de tarifa tiene etiquetas de coste duplicadas, se deja para revisión.                   |

## Qué se probó

- Windows con Node 24.14.1. El acceso `test-local.cmd` ejecutó TypeScript, Prettier y 265 pruebas. `start-local.cmd` respondió en el puerto aislado de prueba y sirvió la tienda con CSP. Se ejecutaron copia y restauración SQLite con destino nuevo.
- Docker. El objetivo `verification` superó las 265 pruebas. Compose arrancó un servicio independiente, saludable y con usuario `node` y raíz de solo lectura. La copia siguió disponible tras reiniciar y se restauró en el volumen de prueba. Desde el contenedor se comprobó que Ollama enumeraba el modelo configurado.
- Navegador. Se abrieron los 20 apartados de Dirección sin desbordamiento global en el tamaño de escritorio usado. Se revisaron cuatro apartados de Oficina y el menú restringido de Almacén. En tienda se repitieron la aclaración del material, la ausencia de ficha compatible y la recomendación de cristales con Ollama. El recorrido de PDF, la aprobación separada del coste y el recálculo se habían comprobado en navegador en el mismo ciclo de entrega.
- Ollama local. `qwen3:4b-instruct` superó 32 criterios de [revisión](evaluations/review-2026-11-10T10-55-27.187Z.json) y 6 de [operaciones](evaluations/operations-2026-11-10T10-55-28.748Z.json). La revisión incluyó 22 invocaciones al modelo y 10 comprobaciones por reglas. Operaciones incluyó cuatro invocaciones y dos comprobaciones por reglas.
- Dependencias. La consulta `npm audit` devolvió cero vulnerabilidades conocidas del conjunto consultado. El paquete candidato se construye con una lista positiva y se compara con su manifiesto SHA-256. Las bases, capturas históricas, archivos de entorno reales y dependencias instaladas quedan fuera del paquete.

## Referencias del máster y alcance

M0653 sirve de referencia para separar las reglas de los adaptadores. M0654 explica la consistencia entre operación y notificación mediante transacción y cola. M0122 orienta la separación de pruebas de reglas, integración y navegador. M0487 aporta el criterio de medir las respuestas de IA con casos repetibles. M0630 orienta la comprobación de permisos en la API.

El nuevo material de skills y MCP se consultó para distinguir las herramientas de desarrollo del código de la tienda. ChangeLab mantiene pasos, permisos y responsables definidos en sus casos de uso. Los originales docentes se consultaron en lectura.

Las comprobaciones de navegador cubren apertura y recorridos seleccionados. Los ensayos de IA son sintéticos. Los pagos y documentos son de demostración. La entrega todavía requiere la grabación del alumno y la publicación del repositorio elegido.
