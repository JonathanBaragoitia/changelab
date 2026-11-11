# Copias y restauración local

ChangeLab usa la API de copia en línea de SQLite a través de `node:sqlite`.

## Crear copia

```sh
npm run db:backup
```

Origen: CHANGELAB_DB o data/changelab.sqlite. Si no existe, falla y no crea base vacía. Destino predeterminado: carpeta única bajo data/backups. Una carpeta de destino existente se rechaza antes de escribirla. Manifest comienza incomplete y solo cambia a complete al terminar copia, PRAGMA quick_check y foreign_key_check. Guarda hashSHA256, tamaño, fecha y runtime. Si falla, se conserva carpeta incompleta para diagnóstico, no se anuncia éxito.

Puede indicarse una carpeta NUEVA cuyo padre exista:

```sh
npm run db:backup -- data/copia-nueva
```

En Linux, los archivos y carpetas de copia nuevos se crean con acceso restringido al propietario. En Windows se aplican los permisos de la carpeta de destino. Las copias existentes conservan sus permisos.

## Restaurar en otra base

```sh
npm run db:restore -- data/copia-nueva data/restaurada-nueva
```

Comprueba estado/hash e integridad de copia y crea otra instantánea en una carpeta nueva. Nunca reemplaza base activa, cambia entorno ni reinicia servidor. Para probar la restaurada se debe iniciar otra instancia/configuración consciente con CHANGELAB_DB apuntando al nuevo archivo y otro puerto, manteniendo el origen.

Las copias contienen todos los datos, incluidas cuentas, hashes y sesiones. Son locales, sin cifrado adicional ni caducidad automática. data/ está ignorado por Git; no subir estos archivos. El hash detecta diferencias respecto al manifiesto, no autentica al autor si alguien puede cambiar ambos archivos. No copia código, modelo ni .env y no sustituye copia externa, política de retención ni ensayo de recuperación operativa.
