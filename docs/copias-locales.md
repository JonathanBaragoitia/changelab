# Copias y restauración local

Implementado y comprobado el28/10/2026 con Node24.14.1. Sin dependencias adicionales. Usa la API de copia online de SQLite, que la documentación de [Node24.14.1](https://github.com/nodejs/node/blob/v24.14.1/doc/api/sqlite.md#sqlitebackupsourceDb-path-options) expone mediante node:sqlite.

## Crear copia

```sh
npm run db:backup
```

Origen: CHANGELAB_DB o data/changelab.sqlite. Si no existe, falla y no crea base vacía. Destino predeterminado: carpeta única bajo data/backups. Una carpeta de destino existente se rechaza antes de escribirla. Manifest comienza incomplete y solo cambia a complete al terminar copia, PRAGMA quick_check y foreign_key_check. Guarda hashSHA256, tamaño, fecha y runtime. Si falla, se conserva carpeta incompleta para diagnóstico, no se anuncia éxito.

Puede indicarse una carpeta NUEVA cuyo padre exista:

```sh
npm run db:backup -- data/copia-nueva
```

## Restaurar en otra base

```sh
npm run db:restore -- data/copia-nueva data/restaurada-nueva
```

Comprueba estado/hash e integridad de copia y crea otra instantánea en una carpeta nueva. Nunca reemplaza base activa, cambia entorno ni reinicia servidor. Para probar la restaurada se debe iniciar otra instancia/configuración consciente con CHANGELAB_DB apuntando al nuevo archivo y otro puerto, manteniendo el origen.

Las copias contienen todos los datos, incluidas cuentas, hashes y sesiones. Son locales, sin cifrado adicional ni caducidad automática. data/ está ignorado por Git; no subir estos archivos. El hash detecta diferencias respecto al manifiesto, no autentica al autor si alguien puede cambiar ambos archivos. No copia código, modelo ni .env y no sustituye copia externa, política de retención ni ensayo de recuperación operativa.

## Evidencia

Cuatro pruebas nuevas: copia con WAL/restauración conserva instantánea pese a cambios posteriores; destino existente intacto; manifiesto/hash inválidos bloqueados; referencias SQLite rotas dejan estado incompleto. Inicialmente falló la preparación del caso corrupto porque SQLite impidió crearlo; el fixture aislado desactiva FK para simular una base dañada. Protección de aplicación intacta.

Copia real local verificada en data/backups/2026-10-28T11-47-56.933Z-37a4840c; restauración aislada data/recovery-check-20261028-37. quick_checkok,4ventas,2reembolsos y1corrección conservados. Sin sustitución de la aplicación activa. No prueba de interrupción física de disco ni banco. Suite152pruebas.
