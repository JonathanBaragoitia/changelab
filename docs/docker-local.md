# Ejecutar ChangeLab con Docker

Revisión cerrada el 30/10/2026. Docker es una alternativa al arranque habitual, no una publicación en internet.

## Arranque

Desde la carpeta changelab, con Docker Desktop y Ollama iniciados:

```sh
docker compose up --build -d --wait
```

Abre gestión en http://127.0.0.1:4320/ y tienda en http://127.0.0.1:4320/tienda. El puerto 4320 evita interferir con la aplicación habitual de 4317. El volumen Docker empieza con datos de demostración y sin cuentas; no importa tu SQLite actual.

Crea tus propias cuentas de edición y revisión, sin contraseñas predeterminadas:

```sh
docker compose exec app npm run users:create
```

La contraseña se introduce de forma interactiva. No la pongas en comandos, capturas, README o repositorio.

## Configuración y protección de datos

- Imagen oficial Node 24 fijada por digest; la versión comprobada dentro del contenedor es 24.22.2.
- Usuario node (UID 1000), raíz de solo lectura y escritura limitada al volumen de datos y /tmp.
- Solo se publica 127.0.0.1:4320. La escucha 0.0.0.0 está dentro del contenedor; la instalación normal conserva 127.0.0.1.
- La imagen se construye con lista permitida de fuentes. No incorpora data/, .env, credenciales locales, materiales del máster ni el programa temporal de revisión.
- La conexión a Ollama usa host.docker.internal:11434; comprobada en este equipo. CHANGELAB_OLLAMA_URL permite localhost, loopback, host.docker.internal o el servicio ollama; se rechazan direcciones remotas y modelos cloud.
- En otro equipo, la conectividad con Ollama debe comprobarse. No hace falta abrir Ollama a internet; el modo manual sigue disponible.

CHANGELAB_HTTP_PORT cambia el puerto publicado. CHANGELAB_MODEL elige un modelo local instalado y requiere repetir la evaluación. Una variable CHANGELAB_OLLAMA_URL en .env sustituye el valor de Compose; 127.0.0.1 dentro del contenedor no es el Ollama del equipo.

## Verificación reproducible

```sh
docker build --target verification -t changelab:verification .
docker compose ps
docker compose logs --tail=50 app
```

El objetivo verification ejecuta TypeScript, formato y todas las pruebas, incluidos HTTP, SQLite y extracción PDF. El objetivo runtime instala solo dependencias de ejecución; construir runtime por sí solo no ejecuta la suite.

## Copias y parada

```sh
docker compose exec app npm run db:backup
docker compose stop
```

La copia se guarda dentro de /app/data/backups y comparte el volumen de datos. Hay que extraer copias a otro soporte para protegerse de la pérdida de ese volumen. Una copia dentro del mismo volumen no es recuperación ante pérdida del equipo.

La restauración admite solo un destino nuevo, sin sustituir la base activa. Para usarla dentro del contenedor, proporciona un destino dentro de /app/data. Consulta copias-locales.md y conserva el manifiesto con el SQLite.

Parar y recrear el contenedor conserva el volumen; eliminar un volumen elimina sus datos. Las cuentas y operaciones de la instalación habitual de 4317 no se trasladan automáticamente.

## Evidencias de esta revisión

Se utilizó el proyecto de prueba changelab-review, independiente del volumen que creará el arranque normal. Se comprobó arranque saludable, UID 1000, conexión con Ollama y su digest, copia SQLite, persistencia tras reinicio y ausencia de cuentas predeterminadas. Ver [registro](revision-20261029/docker.json). Al cerrar la revisión se para ese proyecto; los volúmenes se conservan.

Referencia docente: M0458, Docker Hub, y la unidad de contenerización inventariada. Configuración contrastada con [servicios de Compose](https://docs.docker.com/reference/compose-file/services/) y [redes de Compose](https://docs.docker.com/compose/how-tos/networking/). No se ha hecho push de imágenes ni publicado un repositorio.
