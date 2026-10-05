# Nexe

Maqueta funcional de convocatorias, banco de pruebas y expedientes.

## Reglas principales

- El registro exige un DIP válido (DNI/NIE) y el nombre.
- La verificación definitiva del DIP debe hacerla el servidor contra RSP; nunca se debe exponer una `service_role key` en el navegador.
- `23749931M` es el DIP reservado de presidencia. El rol no se elige desde el formulario.
- Las pruebas del banco pueden asociarse a varias convocatorias. Una prueba enviada conserva su validez durante seis meses.
- La definición SQL y las políticas RLS están en [`supabase/schema.sql`](supabase/schema.sql).

## Producción

El inicio de sesión de PlacetaID se vincula al perfil de Nexe por DIP. La tabla
`nexe_profiles` no depende de `auth.users`: Nexe valida la cuenta en el servidor
y solo permite el acceso si existe un perfil activo.

1. Ejecuta la versión actual de [`supabase/schema.sql`](supabase/schema.sql) en
   el SQL Editor del proyecto Supabase que utiliza Nexe. Si aplicaste una
   versión anterior, vuelve a ejecutarla para crear `nexe_documents`.
2. La persona inicia sesión con PlacetaID. Si todavía no tiene perfil, Nexe le
   muestra los [Términos y condiciones](legal/terminos.html) y la [Política de
   privacidad](legal/privacidad.html). Solo después de aceptar los términos y
   confirmar que ha leído la política se crea una cuenta activa de tipo
   `aspirante`. Las cuentas desactivadas siguen requiriendo intervención de
   Administración.
3. Configura `SUPABASE_URL` y `SUPABASE_SECRET_KEY` en las variables de entorno
   de producción de Vercel. El servidor usa esta clave para consultar perfiles
   aunque el inicio de sesión venga de PlacetaID; nunca la expongas al navegador.

Nexe guarda la versión y fecha de aceptación de los términos y la versión y fecha
de lectura de la política. Las rutas API usan una cookie de sesión propia de
Nexe. Las consultas de registros se filtran por el perfil autenticado;
presidencia puede consultar los registros de todas las cuentas.

Los documentos legales de Nexe son textos iniciales preparados para este flujo y
deben revisarse jurídicamente antes de tratarlos como asesoramiento o garantía de
cumplimiento normativo.

## Desarrollo

Nexe no usa `localStorage` como modo de funcionamiento. PlacetaID autentica al
usuario y el servidor valida el perfil en Supabase; si falta, la persona puede
crearlo tras aceptar los términos y confirmar la lectura de privacidad. Los
perfiles desactivados no se reactivan durante el login. La UI consulta
`/api/placetaid-session` y usa las rutas API del servidor para sus documentos.
`SUPABASE_SECRET_KEY` solo debe usarse en el servidor; la clave publishable/anon
no la sustituye en estas rutas.
