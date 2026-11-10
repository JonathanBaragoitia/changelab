# IA local de ChangeLab

## Estado actual

El usuario instaló Ollama y descargó qwen3:4b-instruct. Se corrigió el contrato de salida y se comprobó la interpretación en navegador. Evaluación de desarrollo: 23/23, con catalog-v6. Consultar correccion-interpretacion.md para evidencia y límites.

## Estado histórico antes de la instalación

El usuario ha elegido Ollama local. El adaptador, endpoint y formulario están implementados. No se encontró ejecutable Ollama en PATH ni en sus ubicaciones habituales; el puerto 11434 no respondió.

Se descargó el instalador oficial en ../work/OllamaSetup.exe y se verificó su firma: válida, Ollama Inc. No se ejecutó. El permiso concedido solo añadió escritura en la carpeta de modelos, no en las carpetas de instalación. La revisión automática rechazó después la consulta para preparar una alternativa portátil, por requerir una aprobación no disponible. La instalación y la evaluación real quedan pendientes; no se atribuyen resultados de un doble al modelo.

## Puesta en marcha

1. Instala Ollama desde https://ollama.com/download/windows o ejecuta el instalador oficial ya descargado.
2. Abre una terminal y descarga el modelo:

```sh
ollama pull qwen3:4b-instruct
```

3. Mantén Ollama iniciado. Si su servicio no está activo, ejecuta ollama serve.
4. En ChangeLab pulsa Actualizar. El asistente comprueba que el modelo figure en el catálogo de Ollama.
5. Escribe «Sube los precios de Protección un 5 %». Pulsa Interpretar con IA, revisa la categoría y el porcentaje y usa Trasladar al formulario. Pulsa Simular propuesta para crearla; publicar sigue requiriendo al revisor.

La etiqueta qwen3:4b-instruct descarga aproximadamente 2,5 GB. Se eligió como candidato inicial, no como modelo validado ni garantía de velocidad en este equipo. No se pudo consultar la RAM/GPU mediante CIM por restricciones del entorno. La etiqueta puede cambiar con el tiempo; registra la versión y el digest del modelo al evaluar. Fuente: https://ollama.com/library/qwen3:4b-instruct (licencia indicada: Apache 2.0).

## Configuración

Sin configuración se usa qwen3:4b-instruct. Para cambiarlo, copia .env.example a .env y fija CHANGELAB_MODEL a un modelo local instalado. Reinicia ChangeLab con start-local.cmd o npm start; ambos cargan el archivo .env si existe.

El servidor llama exclusivamente a http://127.0.0.1:11434. El navegador no accede a Ollama directamente. No se configuran claves ni servicios cloud. La instrucción y las categorías se envían al servicio local; pedidos, costes y conexiones SQL no forman parte de su contexto.

## Límites operativos

Una generación simultánea por proceso, petición de 120 segundos como máximo, respuesta limitada a 64 KiB y salida truncada o inválida rechazada. No hay reintentos automáticos. El estado de disponibilidad usa un límite de 1,5 segundos y no significa que el modelo haya pasado las evaluaciones.

Los permisos actuales son identidades de demostración. No exponer esta versión a Internet. Un esquema válido y un prompt restrictivo no garantizan que el modelo represente la intención; la revisión humana sigue siendo necesaria.

## Evaluación real

```sh
npm run evaluate:local
```

Ejecuta veintitrés instrucciones versionadas sobre una base separada en memoria. Compara tipo de decisión y categoría/porcentaje exactos, registra duración y guarda el informe bajo data/evaluations/. No escribe sobre la base de demostración. Una discrepancia o error produce salida con código distinto de cero.

El conjunto es pequeño y diseñado por nosotros: no demuestra utilidad comercial ni resistencia completa a ataques. Antes de presentar, ampliar con casos nuevos no usados para ajustar el prompt y documentar sus resultados. Un fallo del evaluador es información sobre el modelo, no una razón para relajar las reglas del publicador.
