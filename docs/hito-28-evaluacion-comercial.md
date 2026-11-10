# Hito 28 · Evaluación del priorizador comercial · 28/10/2026

## Criterios definidos antes de ejecutar

Seis casos sintéticos fijados en business-cases.ts, dos repeticiones por caso: sin señales, única señal, tres prioridades mezcladas, más de5con empates, siete deigual prioridad y categoría con texto de instrucción no confiable. Prompt business-priority-v2 sin cambios durante el experimento. Se separan validez (reglas existentes), cobertura (min(5,señales)), latencia y consistencia de selección (Jaccard, no orden). La cobertura es una rúbrica de diagnóstico más exigente que el contrato actual, que permite listas parciales/vacías.

Referencia sin IA: ordenar por prioridad explícita, desempatar por ID y seleccionar hasta5. Prueba de software verifica que pasa los seis casos y cubre objetivo por construcción. No mide calidad de prioridades empresariales. No existe ventaja demostrada del LLM para una tarea ya definida por esas mismas reglas.

## Ejecución real

Informe y JSON: docs/evaluations/business-2026-10-28T10-58-57.615Z. Modelo local qwen3:4b-instruct; se conservan digest reportado por Ollama, opciones, runtime, hash del adaptador y dataset. Doce comprobaciones en total, diez llamadas al modelo; dos casos vacíos no lo invocan.12/12 resultados aceptados por el validador.10/12 completos según rúbrica; contando solo llamadas al modelo,8/10 completos. Caso con categoría de instrucción devolvió vacío en2/2; no cambió datos ni vulneró contrato. Es evidencia de incompletitud en ese caso, no una demostración causal universal ni una explotación de publicación. Resto de casos no vacíos completos2/2. Misma selección entre ambas repeticiones en los seis casos (incluye respuesta vacía repetida). Dos repeticiones no acreditan estabilidad general.

No se cambió el prompt ni se corrigieron respuestas para maquillar esta medida. Dataset construido por el mismo desarrollador, diagnóstico nuevo separado de los casos previos de planificación; NO evaluación independiente, usuarios reales ni validación comercial. Comparación no cubre latencia estadística, distintos modelos/semillas, hardware ni escenarios de negocio no observados. Latencias individuales guardadas. La referencia es más simple y por construcción completa; no se recomienda automatizar decisiones comerciales con estos resultados.

## Entrega y pruebas

Comando npm run evaluate:business; utiliza datos sintéticos y no abre ni escribe la base comercial. Guarda JSON tras cada caso para conservar parciales e informe Markdown final. Si proveedor no está disponible o hay fallo del contrato, finaliza con error; la incompletitud se refleja en métricas y no modifica el contrato ni el código de salida. No se mezcla esta evaluación con el historial de análisis de empleados. No hay nueva pantalla este hito.

127 pruebas de software, TypeScript y formato correctos. Nuevas pruebas de referencia, rúbrica y coincidencia. M0487 Qué son las Evaluations,página1 consultado: distinguir funcionamiento de supervisión y calidad. Diseño de experimento propio, no requisito oficial. Pendiente validación independiente, más casos y mejora de la tarea de IA si queremos aportar juicio contextual real. Siguiente bloque funcional pendiente: correcciones comerciales (gastos/recepciones y conciliación), conservando diseño aplazado.
