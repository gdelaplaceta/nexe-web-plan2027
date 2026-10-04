# Nexe

Maqueta funcional de convocatorias, banco de pruebas y expedientes.

## Reglas principales

- El registro exige un DIP válido (DNI/NIE) y el nombre.
- La verificación definitiva del DIP debe hacerla el servidor contra RSP; nunca se debe exponer una `service_role key` en el navegador.
- `23749931M` es el DIP reservado de presidencia. El rol no se elige desde el formulario.
- Las pruebas del banco pueden asociarse a varias convocatorias. Una prueba enviada conserva su validez durante seis meses.
- La definición SQL y las políticas RLS están en [`supabase/schema.sql`](supabase/schema.sql).

## Desarrollo

Nexe ya no usa `localStorage` como modo de funcionamiento. En producción necesita sesión Supabase/RSP y las variables de `.env.example`; si faltan, bloquea el acceso en lugar de crear una cuenta local insegura.

El archivo HTML conserva el adaptador de la maqueta para el contenedor autenticado de la plataforma, pero el despliegue público debe proporcionar el proveedor de sesión que exponga `window.claude.use('db')` y `window.claude.use('user')`, o sustituirse por el adaptador Supabase de la aplicación anfitriona. No se debe publicar `SUPABASE_SERVICE_KEY`.
