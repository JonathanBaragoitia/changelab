# Hito 41 · Reposición y oportunidades por artículo

29/10/2026. Ampliación solicitada por el usuario del análisis comercial.

## Funcionamiento

Análisis de los últimos 30 días naturales, con fechas de negocio Europe/Madrid. Cuenta pedidos confirmados, preparados y enviados; excluye cancelados y devueltos. Solo conoce operaciones registradas en esta aplicación. No conoce antigüedad del artículo, demanda perdida ni compras en tránsito.

Por artículo muestra existencias, unidades vendidas, cobertura estimada, punto de reposición y cantidad orientativa. Cada editora puede guardar plazo de suministro, días de seguridad, días objetivo y mínimo de unidades. Valores iniciales: 7, 3, 30 y 5 respectivamente; son hipótesis configurables, no plazos reales del proveedor.

- Ritmo diario = unidades vendidas / días observados.
- Punto de reposición = máximo entre mínimo configurado y redondeo superior del ritmo por plazo más seguridad.
- Objetivo = máximo entre punto de reposición y redondeo superior del ritmo por días objetivo.
- Cantidad sugerida = objetivo menos existencias, solo con ventas registradas y existencias en o por debajo del punto.
- Cobertura = existencias / ritmo diario; desconocida si no hay ventas.

Sin ventas no inventa una cantidad de compra. Con mínimo guardado puede avisar de revisar reposición, pero exige criterio humano. Advierte de muestra pequeña, exceso de cobertura, falta de ventas y margen bajo. Sugiere revisar visibilidad, fotos, packs o campañas; muestra hasta dos artículos de la misma categoría con más ventas y existencias. No garantiza que sean sustitutos compatibles ni que una promoción mejore ventas.

## Control e IA

Los criterios se guardan en SQLite con versión, permiso de edición, transacción y evento de historial. No cambian precios ni existencias. El menú muestra el número de artículos agotados o que requieren revisar reposición. Se recalcula al abrir/actualizar; no hay avisos externos ni vigilancia en segundo plano.

Los cálculos y mensajes son deterministas. Ollama prioriza señales existentes; no inventa cantidades ni ejecuta pedidos. Hasta 20 señales nuevas por artículo entran en el contexto del priorizador; todas siguen visibles en el análisis. El modelo puede seleccionar hasta cinco. Los cambios de criterios invalidan el contexto anterior. Una señal de reposición no permite generar directamente una rebaja de toda la categoría; las campañas se preparan explícitamente.

No se crean compras, descuentos ni pedidos automáticos. Verificar plazo real, pedidos pendientes y contexto comercial antes de actuar.

## Evidencias

167 pruebas automatizadas, incluidas seis de este incremento: fórmulas, ausencia de ventas, exclusiones y alternativas, permisos/versiones/rollback, límites de priorización y API con aviso de menú. TypeScript y formato comprobados. La prueba visual autenticada y la prueba guiada con el usuario siguen pendientes; no se han cambiado los datos comerciales de la demo para probarlo.

Evaluación real local con qwen3:4b-instruct: 14/14 comprobaciones válidas y 12/14 completas, incluidas dos comprobaciones vacías sin llamada al modelo. El caso nuevo de reposición se completa en ambas repeticiones; la categoría con instrucciones no fiables devuelve selección vacía en ambas. Son casos sintéticos de desarrollo, no evaluación independiente ni ventaja comercial demostrada. Ver [informe](evaluations/business-2026-10-29T10-46-26.463Z.md).

Referencia docente consultada: M0487, LLMOps, Que son las Evaluations. Separar tests del software, evaluación del modelo y utilidad real es una decisión de ingeniería aplicada al proyecto. Las reglas de stock y su alcance son propuestas propias; no requisitos oficiales del TFM. Material original intacto.
