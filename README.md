# ChangeLab · Norte AutoCare

ChangeLab reúne una tienda de productos para el automóvil y un panel de gestión de pedidos, almacén y proveedores. Oficina comprueba el documento y prepara una simulación. Dirección puede ver qué ocurre con el margen si conserva el precio de venta o si lo ajusta, y autoriza por separado los cambios comerciales.

## Arranque local

Requisitos: **Node.js 24.12 o posterior de la rama 24** y npm. Node ejecuta los archivos TypeScript directamente. La comprobación de tipos se hace en un paso aparte. [Soporte de TypeScript en Node](https://nodejs.org/docs/latest-v24.x/api/typescript.html).

Desde la carpeta de ChangeLab:

```sh
npm ci
npm start
```

Abre [gestión](http://127.0.0.1:4317/gestion) o [tienda](http://127.0.0.1:4317/tienda). En Windows, `start-local.cmd` ejecuta el mismo arranque. Para desarrollo, `npm run dev` reinicia el servidor al editar el código. En VS Code, `ChangeLab.code-workspace` abre el proyecto con una tarea de comprobación.

La instalación local escucha por defecto en `127.0.0.1:4317` y guarda SQLite en `data/changelab.sqlite`. `PORT` y `CHANGELAB_DB` permiten elegir otros valores. Usa `.env.example` como guía de configuración.

### Cuentas de gestión

`npm run users:create` (o `create-user.cmd` en Windows) crea cuentas con contraseña de al menos nueve caracteres. Elige `owner` para Dirección, `office` para Oficina y `warehouse` para Almacén. Los roles técnicos anteriores se conservan por compatibilidad. [Cuentas locales](docs/cuentas-locales.md) · [Roles de empresa](docs/roles-empresa.md).

### Ollama

Instala y arranca Ollama en el equipo y descarga el modelo:

```sh
ollama pull qwen3:4b-instruct
```

La aplicación consulta `http://127.0.0.1:11434` por defecto. `CHANGELAB_MODEL` selecciona el modelo local. Con Ollama inaccesible, la tienda conserva el catálogo y el buscador, y la propuesta de tarifa conserva el resumen por reglas. [Configuración de Ollama](docs/ollama-local.md).

## Recorrido de una tarifa

1. **Oficina** carga un PDF con texto, un CSV o el contenido de un correo. Si hay un importe ambiguo, puede escribir el coste unitario cotejado y conservar el original.
2. En **Tarifas de proveedores → Importar y revisar tarifas → Propuestas para Dirección** guarda una simulación con los dos escenarios por artículo. El código calcula los importes y Ollama selecciona qué resultado destacar entre opciones comprobadas.
3. **Dirección** consulta el documento, los márgenes y las versiones. Aprobar una tarifa actualiza la oferta del proveedor. Publicar un precio de venta es otra operación y exige su propia revisión. Si cambian los datos usados en la simulación, la propuesta queda marcada como desactualizada.

En la tienda, el asistente trabaja con el catálogo disponible y comprueba el presupuesto con IVA. Para tapicerías, solicita el material si falta y exige compatibilidad expresa en la ficha.

## Operaciones

| Área               | Qué permite                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Tienda             | Consultar fichas, usar el carrito y seguir pedidos propios como invitado o con cuenta.                                      |
| Almacén y envíos   | Preparar pedidos, registrar recogidas, recibir compras y reabrir cantidades al anular una recepción vinculada.              |
| Devoluciones       | Reponer unidades aptas y registrar por separado la cuarentena y la baja física de las dañadas.                              |
| Proveedores        | Tramitar compras y documentar abonos o reposiciones de reclamaciones. La reposición se vincula a una entrada ya registrada. |
| Facturación y caja | Gestionar borradores, documentos DEMO, anotaciones de cobro, reembolsos y conciliación.                                     |
| Control comercial  | Simular propuestas de precio y campañas, revisar existencias y consultar el historial.                                      |

## Arquitectura y comprobaciones

`src/domain` contiene reglas de catálogo. `src/application` coordina los casos de uso. `src/infrastructure` conecta SQLite y Ollama, y `src/server.ts` compone la aplicación y sus rutas. `public` contiene la interfaz y `tests` las pruebas. [Arquitectura](docs/arquitectura-actual.md).

La simulación conserva los precios de los pedidos anteriores. La publicación comprueba margen, versión y huella. La autenticación usa scrypt y cookies HttpOnly y SameSite, con comprobaciones de origen y CSRF para operaciones que cambian datos. El correo usa una cola transaccional en SQLite. El modo de vista previa queda asociado al mensaje al crearlo. [Correos y envíos](docs/correos-envios.md).

```sh
npm run check
npm run evaluate:review
```

`check` ejecuta TypeScript, formato y pruebas unitarias, de persistencia y HTTP. `test-local.cmd` ejecuta el mismo chequeo en Windows. `evaluate:review` usa Ollama y casos sintéticos, separados de las pruebas con dobles. Los informes de evaluación distinguen las respuestas del modelo y las rutas por reglas.

## Docker y datos

```sh
docker build --target verification -t changelab:verification .
docker compose up --build -d --wait
docker compose ps
docker compose stop
```

La imagen de verificación ejecuta `npm run check`. Compose publica el puerto 4320 en loopback y usa un volumen propio. El contenedor de ejecución usa un usuario sin privilegios y raíz de solo lectura. Para acceder a Ollama desde el contenedor usa `host.docker.internal:11434`. [Guía Docker](docs/docker-local.md) · [Arranque de Compose](https://docs.docker.com/compose/how-tos/startup-order/).

`npm run db:backup` crea una copia SQLite verificada. `npm run db:restore -- <copia> <destino-nuevo>` permite comprobar la recuperación en una ubicación nueva. [Copias y recuperación](docs/copias-locales.md).

## Límites operativos

El catálogo inicial contiene datos ficticios. Los pagos se simulan y los documentos fiscales carecen de validez. El abono de proveedor se registra como documento y el margen se calcula por artículo. Los PDF escaneados requieren texto obtenido mediante OCR externo.

[Dependencias de terceros](docs/dependencias-terceros.md).
