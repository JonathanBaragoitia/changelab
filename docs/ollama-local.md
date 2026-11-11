# Configurar Ollama

Instala [Ollama](https://ollama.com/download), inicia el servicio y descarga el modelo usado por defecto.

```sh
ollama pull qwen3:4b-instruct
```

Norte Gestión consulta Ollama desde el servidor en `http://127.0.0.1:11434`. Usa `CHANGELAB_MODEL` para elegir otro modelo instalado y `CHANGELAB_OLLAMA_URL` si necesitas indicar la dirección del servicio. Para ejecutar Norte Gestión en Docker, consulta la [configuración de Compose](docker-local.md).

## Qué hace el modelo

El contexto depende de la función. Por ejemplo, el asistente de tienda recibe fichas del catálogo y la revisión de una tarifa recibe opciones calculadas por la aplicación. El servidor valida la salida del modelo. Las decisiones de publicación, permisos y cálculos de margen corresponden a la aplicación. Si Ollama no está disponible, la simulación de tarifas conserva el resumen por reglas.

## Evaluación local

```sh
npm run evaluate:local
npm run evaluate:review
npm run evaluate:operations
```

Las evaluaciones usan casos sintéticos. Guardan el modelo, los resultados por caso y la duración en `data/evaluations/`. El informe de revisión distingue las comprobaciones con modelo de las resueltas por reglas.
