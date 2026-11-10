# Cuentas locales y acceso

## Primera configuración

No se crean usuarios ni contraseñas predeterminados. En la carpeta changelab:

```powershell
.\create-user.cmd
```

Si tu terminal está en la carpeta superior del proyecto:

```powershell
.\changelab\create-user.cmd
```

También puedes ejecutar npm run users:create desde changelab.

La utilidad pregunta usuario, nombre, rol y contraseña repetida. La contraseña se escribe oculta, admite espacios y debe tener entre 9 y 128 caracteres. No la escribas en el chat, en un argumento del comando ni en el código. Usa una frase larga y exclusiva para esta aplicación.

Crea primero tu cuenta con rol editor. Para probar aprobación, repite la utilidad y crea una cuenta con rol reviewer. El rol viewer permite consultar y calcular escenarios, pero no crear ni publicar propuestas. Elige nombres de usuario en minúsculas de 3–64 caracteres; se admiten letras ASCII, números, punto, guion y guion bajo.

Si cambias CHANGELAB_DB, ejecuta la utilidad con el mismo archivo .env o entorno que usa el servidor. El comando carga .env si existe. La ruta por defecto es data/changelab.sqlite, relativa al proyecto incluso cuando se lanza desde otra carpeta.

## Uso

1. Abre ChangeLab y entra con la cuenta editora.
2. Prepara y simula una propuesta.
3. Cierra sesión. Otra cuenta con rol revisor puede entrar, revisar y publicar.
4. Cerrar sesión revoca el token en el servidor. La sesión caduca a las ocho horas; iniciar sesión otra vez desde el mismo navegador sustituye la cookie y revoca su sesión anterior.

La utilidad de cuentas es administración local: cualquiera que controle la máquina/base puede crear cuentas o alterar datos. La separación de cuentas no demuestra que existan dos personas físicas distintas.

## Controles implementados

- Contraseñas con scrypt de Node: N=131072, r=8, p=1, sal de 128 bits, clave derivada de 512 bits, comparación constante.
- Token aleatorio de sesión de 256 bits; SQLite guarda su hash SHA-256, no el token reutilizable.
- Cookie HttpOnly, SameSite=Strict, Path=/ y caducidad máxima de ocho horas. Se sirve exclusivamente por HTTP loopback; no usa Secure en este entorno.
- Token CSRF aleatorio ligado a sesión, conservado en memoria de la página, y origen exacto para POST. No hay credenciales en localStorage/sessionStorage.
- Roles y estado activo consultados desde SQLite en cada petición.
- X-Demo-User se ignora. No se aceptan roles o autores enviados por el navegador como autoridad.
- Límite persistente de cinco intentos por usuario y veinte por dirección en un minuto; cuenta también accesos correctos dentro de esa ventana. Un cálculo de contraseña simultáneo por proceso.
- Mensaje uniforme para usuario inexistente, contraseña incorrecta o cuenta desactivada.

## Compatibilidad y límites

Los autores elena/marcos/lucia de propuestas anteriores son identidades de la etapa de demostración, no cuentas verificadas. No se reasignan a tus nuevas cuentas ni se modifican sus hashes.

No se implementan todavía MFA, OIDC/SSO, recuperación de contraseña, cambio de contraseña, gestión web de usuarios, caducidad por inactividad ni auditoría completa de eventos de acceso. Las sesiones tienen caducidad absoluta y revocación al salir. No publicar esta instancia HTTP en Internet: antes se necesitan HTTPS, cookie Secure y revisión de la solución de identidad/despliegue.

Las bases contienen hashes de contraseñas y deben mantenerse fuera de Git y protegerse al realizar copias de seguridad. data/ está ignorada. La evaluación del TFM necesitará un entorno de prueba o instrucciones de configuración; no distribuir una contraseña personal como credencial de demostración.
