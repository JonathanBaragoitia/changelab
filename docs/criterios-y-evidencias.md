# Criterios y evidencias

La especificación inicial conserva CA01–CA10. Esta tabla orienta la defensa; consultar los nombres actuales de pruebas, no números de línea que pueden cambiar.

| Criterio                                  | Evidencia                                                        |
| ----------------------------------------- | ---------------------------------------------------------------- |
| CA01 Simular sin cambiar catálogo/pedidos | tests/workflow.test.ts y tests/business.test.ts                  |
| CA02 Margen inferior al20bloquea          | tests/workflow.test.ts y dominio catalog.ts                      |
| CA03 Roles y autor/revisor distintos      | tests/auth.test.ts, workflow.test.ts y proposals.ts              |
| CA04 Aprobar contenido revisado           | pruebas de digest y cambio de motivo en workflow.test.ts         |
| CA05 Rechazar versión desactualizada      | pruebas de dos propuestas y costes cambiados en workflow.test.ts |
| CA06 Escrituras atómicas                  | fallos intermedios/eventos en workflow, cash, refunds y commerce |
| CA07 Publicación repetida sin duplicados  | workflow.test.ts y endpoint publish                              |
| CA08 Pedidos conservan instantánea        | commerce.test.ts y recorrido integral                            |
| CA09 Persistencia al reabrir              | auth, workflow y cash-records; copias en db-snapshots            |
| CA10 Estados/límites visibles             | comprobaciones de navegador en hitos35/36/38                     |

Ampliación comercial: commerce-journey.test.ts conecta compra invitada, stock, estados, documento, cobro, devolución, rectificación, reembolso/corrección y conciliación. Usa puerto efímero y base aislada. No equivale a una prueba automática de todas las interacciones visuales.

Requisitos oficiales de entrega y pendientes: entrega-tfm.md. Conceptos docentes aplicados y decisiones propias: arquitectura-actual.md y el índice de materiales en ../outputs del espacio superior. Los requisitos fiscales o de producción no se deducen de esta matriz.
