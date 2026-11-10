# Preparación de la defensa

Respuestas para estudiar y contrastar con el código. No memorizar afirmaciones que no puedas demostrar. La asistencia de IA en el desarrollo debe explicarse según las normas del centro.

## ¿Qué aporta el proyecto frente a una tienda convencional?

El caso principal controla cambios de precios propuestos con ayuda de un modelo. El interés técnico está en separar interpretación, simulación y publicación, conservar pedidos y enlazar consecuencias comerciales. La tienda proporciona un entorno funcional para demostrar esas decisiones. No se ha acreditado novedad mundial ni demanda del producto.

## ¿Qué hace exactamente la IA?

El intérprete transforma una petición acotada en categoría y porcentaje o pide aclaración/rechaza. El adaptador local devuelve JSON que la aplicación valida. El análisis comercial puede seleccionar señales calculadas por el servidor. No genera SQL ni tiene herramientas para publicar. La comprobación de margen y versiones es determinista.

## ¿Por qué usar reglas además del modelo?

La salida del modelo puede ser incorrecta, ambigua o incompleta. La gramática limita formato, pero no garantiza significado. Un descuento formalmente válido puede incumplir margen, y una respuesta vacía puede cumplir esquema sin resultar útil. Los casos de uso aplican reglas antes de permitir efectos.

## ¿Qué significa el margen mínimo del20%?

Margen bruto sobre precio=(precio−coste)/precio. No es recargo sobre coste ni beneficio neto. Precio/coste son céntimos enteros; el descuento se redondea al céntimo. La regla es propia del caso de estudio, no un requisito docente ni recomendación comercial.

## ¿Cómo se evita publicar datos antiguos?

La propuesta conserva cambios, versiones y digest del contenido revisado. El servidor comprueba identidad revisora distinta del autor y revalida cada producto al publicar. Si cambian precio/versión/coste o el digest no coincide, rechaza. La operación es transaccional para no aplicar una parte.

## ¿Qué diferencia hay entre devolver mercancía, rectificar y reembolsar?

La devolución física repone stock y cambia estado. La rectificación conserva documento original y crea un importe contrario de prueba. El reembolso es otra anotación de caja que conserva el cobro. La conciliación muestra consecuencias separadas. Ninguna anotación transfiere dinero real.

## ¿Qué ocurre si se repite una petición?

RequestId, referencias y estados controlan efectos duplicados según el caso de uso. Mismo contenido devuelve operación existente; un reuso incompatible se rechaza. No es una garantía global de procesamiento exactamente una vez con sistemas externos. Mostrar el test integral y un caso de rollback.

## ¿Por qué SQLite y un monolito?

Permiten transacciones y operación local con poca infraestructura para este alcance. Puertos separan casos de uso de adaptadores. La elección reduce trabajo operativo, pero no demuestra capacidad para múltiples instancias distribuidas. Hay consultas y módulos de composición aún mejorables.

## ¿Qué prueban las152pruebas?

Comprueban reglas seleccionadas, roles, transacciones, reintentos, persistencia, lectura de registros y recorrido HTTP. No demuestran ausencia de errores ni sustituyen pruebas de usuarios, móvil real, auditoría de seguridad o validación fiscal. Las pruebas con dobles y las evaluaciones reales del modelo son diferentes.

## ¿Qué resultado de IA conviene mostrar aunque sea desfavorable?

En diez llamadas reales del diagnóstico comercial, diez pasaron validador y ocho cubrieron todas las señales esperadas. Hubo además dos comprobaciones vacías sin llamada al modelo. La categoría con texto de instrucción produjo vacío en ambas repeticiones. No se corrigió el prompt durante esa evaluación. Ordenar prioridades ya fijadas no mostró ventaja del modelo frente a reglas.

## ¿Cómo se recuperan datos?

La copia online usa SQLite y crea un destino nuevo con manifiesto, hash e integridad. La restauración valida y crea otra base, sin reemplazar la activa. Se probaron WAL, alteración posterior y copia inconsistente. Es una herramienta local, sin cifrado añadido, almacenamiento externo ni política de retención.

## ¿Qué falta antes de ofrecerlo a clientes?

Revisión de seguridad/despliegue, privacidad, recuperación de cuentas, operación compartida, móvil y evaluación con usuarios. El producto no factura fiscalmente ni conecta con bancos. Para la entrega académica faltan revisar la presentación, grabar vídeo y preparar GitHub/licencia con datos ficticios.
