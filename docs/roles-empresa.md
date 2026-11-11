# Roles de gestión

| Rol                   | Responsabilidades                                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Dirección (`owner`)   | Decide sobre compras, gastos, ofertas de proveedores y cambios de precio. Autoriza reembolsos, rectificaciones y anulaciones económicas. |
| Oficina (`office`)    | Prepara propuestas de tarifa, compras y gastos. Gestiona expediciones, justificantes de gastos autorizados, cobros y reclamaciones.      |
| Almacén (`warehouse`) | Consulta existencias. Prepara pedidos, confirma recogidas y registra recepciones, daños y devoluciones según el estado de la mercancía.  |

El servidor aplica los permisos de cada cuenta. Dirección puede aprobar una propuesta propia en una segunda acción explícita cuando el flujo lo permite. Se siguen comprobando la versión y el contenido de la propuesta, el margen y las reglas de cada operación.

## Coordinación

- En pedidos de clientes, Almacén confirma la preparación, Oficina registra el transportista y la referencia, y Almacén confirma la recogida.
- En compras a proveedores, Oficina prepara la solicitud, Dirección la aprueba o pide cambios, y Almacén registra las cantidades recibidas. Las recepciones parciales dejan el resto pendiente.
- En tarifas, Oficina coteja el documento y prepara la simulación. Dirección autoriza el nuevo coste del proveedor y decide por separado si corresponde cambiar el precio de venta.
- En devoluciones, Almacén registra la recepción y el estado de las unidades. Dirección decide las operaciones económicas correspondientes.

El panel de avisos muestra el responsable, la fecha y el enlace a la operación. El estado de lectura se guarda por cuenta. Consulta la [guía de correo saliente](correos-envios.md) para configurar las notificaciones de pedidos.
