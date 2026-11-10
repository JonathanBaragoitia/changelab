# Hito 40 · Tarifas de proveedores y simulación de campañas

29/10/2026. El usuario acepta ambas funciones y solicita hacer después las pruebas guiadas juntos. Referencia conceptual M0001 Casos de uso,páginas2–3 consultadas: lógica/orquestación separadas de adaptadores y presentación. Decisiones y reglas de este incremento propias, no requisitos oficiales ni IA nueva demostrada.

## Tarifas

Nueva vista Tarifas de proveedores. Admite carga de archivo o texto CSV con cabecera sku;coste, BOM, fin de línea Windows y comillas dobles escapadas. Hasta100artículos y12.000caracteres; selector de archivo limita12KB y el servidor mantiene límite de cuerpo16KB. Decimal coma con separador punto y coma, o decimal entre comillas si el CSV usa coma. Sin miles/moneda/fórmulas. Match exacto por SKU sin distinguir mayúsculas; duplicados rechazados. No inferencia de columnas con LLM ni importación Excel/PDF en este incremento.

La cuenta editora prepara tarifa con proveedor activo y referencia. Se guarda una instantánea de diferencias, sin tocar productos. Muestra referencias nuevas/desconocidas, sin cambio o con cambio de coste. Un SKU desconocido bloquea aplicación completa: se debe crear manualmente con datos completos en Catálogo y preparar otro lote. No inventa nombre/categoría ni da altas automáticas. Sin cambios también queda no aplicable.

Otra cuenta revisora aplica el digest exacto. Revalida contenido guardado, proveedor, versiones/precios/costes y filas inicialmente sin cambio. Actualiza costes globales del catálogo e incrementa versión de los artículos afectados en transacción con evento/historial. No actualiza stock, precios de venta, valoraciones de compras ni pedidos históricos. Coste por proveedor es contexto de la tarifa, no un modelo multitarifa por producto. Costes reales pueden dejar márgenes inferiores al20%; se muestra aviso y precio mínimo matemático, sin ocultarlo con cambios automáticos.

Reintentar aplicación no duplica. Referencia por proveedor única; nueva versión o datos distintos requiere referencia nueva. Una modificación intermedia revierte todo el lote; se requiere nueva preparación. Las propuestas antiguas de precio quedan desactualizadas por versión/coste. Lotes persistidos en SQLite, últimos20visibles; sin paginación/cancelación de lote. Algunas lecturas JSON del nuevo adaptador conservan el límite de validación parcial de otros módulos, además de digest/revalidación al aplicar.

## Campañas

Nueva vista Campañas: título, una categoría, fechas de referencia de hasta un año, hasta3porcentajes distintos en rango±50%sin0y cantidades elegidas por producto. Ejemplo de−5/+5y10unidades por artículo, modificable y sin guardar. Compara ingresos netos y contribución bruta con las mismas cantidades y costes actuales. Reutiliza simulate/calculateScenario; conserva alternativas bloqueadas por margen para que se entiendan sus límites.

Por producto, unidades necesarias para conservar contribución bruta positiva=techo(cantidad base×contribución unitaria anterior/contribución unitaria nueva). Si alguna contribución unitaria no es positiva se muestra No calculable; cantidad0produce0. No estima demanda ni beneficio neto, no incluye gastos/impuestos ni limita escenarios al stock. Usa céntimos enteros y verificaciones de cantidades/cálculos existentes.

Edición puede convertir alternativa válida en propuesta de precios, con motivo y fechas de referencia. Servidor recalcula comparación y comprueba hash de productos; catálogo cambiado exige comparar de nuevo. Publicación sigue por otra persona y revalida como antes. Propuestas se guardan; comparaciones/cantidades quedan en la vista y no tienen historial persistente. Las fechas NO activan, retiran ni restauran precios automáticamente. No hay campañas recurrentes ni varias categorías por alternativa.

## Verificación

161/161 pruebas superadas, TypeScript, formato y sintaxis correctos. Nueve pruebas nuevas incluyen parser, permisos/autor distinto, digest/versión, referencias desconocidas, filas sin cambio, proveedor inactivo, rollback y conservación de precios/pedidos, invalidación de propuesta anterior, contribución/unidades/márgenes y contexto HTTP vigente. Las pruebas usan SQLite aislado y sesiones de fixture, no cuentas de usuario.

Vista previa reiniciada en127.0.0.1:4317porque no había proceso escuchando. Verificado menú nuevo y pantalla de acceso; sesión caducada. No se solicitó contraseña ni se cambió ningún coste/precio de la demo. Prueba autenticada en navegador queda para el usuario. Archivo examples/tarifa-proveedor-demo.csv y botones de ejemplo preparados. No afirmar recorrido visual completo de estas dos vistas todavía.

## Prueba guiada pendiente

1. Entrar con edición, abrir Tarifas, elegir proveedor activo y referencia nueva, cargar ejemplo y comparar. Comprobar que catálogo no cambia.
2. Revisar costes/márgenes. Añadir SKU desconocido en una prueba aparte para comprobar bloqueo, sin darlo de alta automáticamente.
3. Entrar con revisión distinta y aplicar la tarifa revisada. Comprobar costes/versiones, precios/pedidos intactos e Historial.
4. Volver a edición, abrir Campañas, cargar ejemplo−5/+5, elegir cantidades/fechas y comparar. Los bloqueos concretos dependen de los datos.
5. Preparar alternativa válida y revisar/publicar por el flujo habitual. Las fechas no programan cambios; confirmar efectos antes de publicar.
