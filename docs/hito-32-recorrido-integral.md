# Hito 32 · Recorrido comercial integral · 28/10/2026

## Objetivo y criterios

Verificar conexiones reales entre tienda invitada, pedidos, almacén, documentos DEMO, caja y conciliación. Prueba HTTP con servidor real en puerto local efímero y SQLite en memoria, sin abrir la base comercial existente. No prueba visual ni pasarela/banco. Se fijan importes, identidades, estados e invariantes; no llama a IA.

## Recorrido comprobado

| Paso                                     | Resultado esperado y comprobado                                           |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Compra invitada de1champú                | Base79,90€, IVA16,78€, total96,68€; stock20→19; respuesta sin costes      |
| Reintentar compra                        | Mismo pedido, mismo descuento de stock; otro invitado no ve el pedido     |
| Preparar y enviar                        | confirmed→prepared→shipped                                                |
| Borrador y emisión DEMO                  | Mismo total96,68€; emisión repetida conserva documento único              |
| Anotar cobro total y reintentar          | Cobro activo único96,68€; conciliación sin diferencias detectadas         |
| Recibir devolución completa y reintentar | Stock19→20una vez; pedido returned; avisos documental y exceso de cobro   |
| Rectificar documento y reintentar        | Original conservado, una rectificación−96,68€, saldo documental0          |
| Consultar conciliación final             | Esperado0, documentos0, cobrado96,68€, aviso COLLECTION_EXCESS conservado |
| Consultar tienda cliente                 | Pedido propio returned; invitado no accede a conciliación interna         |

Aserciones finales: una venta, una emisión, una rectificación y una anotación de cobro; pedidos históricos intactos y cadena de eventos verificable. No se anula el cobro para simular una devolución. No hay reembolso registrado en este incremento: el aviso final es el resultado correcto del alcance actual. Prueba tests/commerce-journey.test.ts.

139/139 pruebas superadas, TypeScript y formato correctos. Pruebas anteriores cubren otros permisos, rollback y persistencia; este recorrido añade integración HTTP entre módulos, no cobertura de navegador completa ni resistencia a fallos externos/concurrencia total. Sin nuevos datos en la demo ni cambios visuales. Se ejecutó una vez dirigida y luego dentro de la suite completa, sin cambios tras el pase dirigido.

M0021 Testing en Clean Architecture,página2 consultada: distinguir pruebas de dominio/casos de uso, integración y E2E. Esta es integración por API contra adaptadores reales, no E2E de interfaz. Criterios propios del proyecto. No certificación fiscal ni de seguridad.

## Prioridades revisadas para continuar

1. Registro explícito de reembolsos de demostración, separado de anular un cobro erróneo: importe máximo según cobros activos menos reembolsos, motivo, reintentos y conciliación. No pasarela ni transferencias reales. Es el siguiente bloque funcional recomendado para cerrar este recorrido.
2. Revisar experiencia completa y estilos: navegación, formularios largos, errores, estados vacíos, filtros y móvil; el usuario ha aplazado diseño hasta completar funcionalidad.
3. Consolidar alcance/documentación: README vigente frente a notas históricas, diagrama, decisiones, límites IA y guion de vídeo. GitHub/licencia/presentación y vídeo siguen por completar, no afirmar publicados.
4. Revisar seguridad y despliegue antes de compartir: configuración, HTTPS, recuperación de acceso, copias/restauración, privacidad de datos y pruebas de uso. La demo local no acredita producción.
5. IA: los resultados del hito28 no muestran ventaja frente a ordenación determinista en esta tarea. No añadir agentes por apariencia; definir una tarea contextual con utilidad evaluable antes de ampliar autonomía. Evaluación externa/independiente sigue pendiente.

No ampliar ahora a contabilidad fiscal, lotes, devoluciones parciales, pagos reales o transporte sin acotar y probar cada bloque. Estas prioridades son propuesta de continuación coherente con el alcance aceptado, no requisitos oficiales del máster.
