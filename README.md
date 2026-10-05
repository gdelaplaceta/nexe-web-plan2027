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

1. Ejecuta [`supabase/schema.sql`](supabase/schema.sql) en el SQL Editor del
   proyecto Supabase que utiliza Nexe.
2. Registra en `public.nexe_profiles` cada cuenta autorizada con su DIP validado,
   nombre, rol y `activo = true`. No se crean ni activan perfiles durante el
   callback OAuth.
3. Configura `SUPABASE_URL` y `SUPABASE_SECRET_KEY` en las variables de entorno
   de producción de Vercel. El servidor usa esta clave para consultar perfiles
   aunque el inicio de sesión venga de PlacetaID; nunca la expongas al navegador.

Las rutas API usan una cookie de sesión propia de Nexe. Las consultas de registros
se filtran por el perfil autenticado; presidencia puede consultar los registros
de todas las cuentas.

## Desarrollo

Nexe no usa `localStorage` como modo de funcionamiento. PlacetaID autentica al
usuario y el servidor valida el perfil autorizado en Supabase; si falta el
perfil o está inactivo, el acceso se deniega en lugar de crear una cuenta
automáticamente. La maqueta HTML aún espera el adaptador anfitrión
`window.claude.use('db')` / `window.claude.use('user')`; el despliegue debe
proporcionar ese adaptador o conectar esa UI a las rutas API antes de usar sus
funciones de datos. `SUPABASE_SECRET_KEY` solo debe usarse en el servidor; la
clave publishable/anon no la sustituye en estas rutas.
