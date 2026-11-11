# Especificación de ChangeLab

ChangeLab conecta una tienda de cuidado del automóvil con el panel de gestión de la empresa. Su caso principal es revisar una tarifa de proveedor, simular su efecto sobre el margen y decidir si se aplica el nuevo coste o se propone un cambio en el precio de venta.

## Flujo principal

1. Oficina importa un PDF o CSV de tarifa y coteja las referencias y los costes unitarios con el documento original.
2. La aplicación calcula el margen unitario con el precio neto vigente y el precio que conservaría el margen de referencia. Ollama puede seleccionar y explicar un resultado respaldado por esos cálculos. Si el modelo falla, la aplicación presenta un resumen por reglas.
3. Dirección revisa y autoriza el cambio de coste. La publicación de un precio de venta requiere una decisión separada y una simulación vigente.
4. El historial conserva quién actuó, cuándo y qué valores cambiaron. Los pedidos anteriores mantienen los importes guardados al comprarlos.

## Operación de la tienda

La tienda permite consultar productos, gestionar una cuenta, realizar pedidos de demostración y ver su seguimiento. Oficina coordina compras y envíos. Almacén recibe mercancía, registra incidencias y confirma la preparación y recogida de pedidos. Dirección autoriza los cambios económicos según la matriz de permisos.

## Criterios de aceptación

| ID   | Comportamiento esperado                                                                    |
| ---- | ------------------------------------------------------------------------------------------ |
| CA01 | Simular conserva el catálogo y los pedidos.                                                |
| CA02 | El publicador bloquea los cambios por debajo del margen mínimo configurado.                |
| CA03 | El servidor comprueba los permisos y separa al autor del revisor cuando el flujo lo exige. |
| CA04 | La aprobación queda vinculada al contenido revisado.                                       |
| CA05 | La publicación rechaza simulaciones desactualizadas.                                       |
| CA06 | Los cambios relacionados se guardan en una misma transacción.                              |
| CA07 | Repetir una publicación no duplica sus efectos.                                            |
| CA08 | Los pedidos conservan su instantánea de precios.                                           |
| CA09 | Los datos persistentes se pueden recuperar al volver a abrir la base.                      |
| CA10 | La interfaz muestra los estados y los límites del flujo.                                   |

## Límites operativos

El catálogo inicial contiene datos ficticios. Los pagos se simulan, los documentos fiscales son ejemplos y el correo funciona en vista previa. Los cálculos comerciales muestran margen unitario bruto. La evaluación del modelo usa casos sintéticos.

[Arquitectura](arquitectura-actual.md) · [Roles](roles-empresa.md)
