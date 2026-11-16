# Nexe

Maqueta funcional de convocatorias, banco de pruebas y expedientes.

## Reglas principales

- El registro exige un DIP válido (DNI/NIE) y el nombre.
- La identidad se valida mediante PlacetaID; nunca se debe exponer una clave secreta de Supabase al navegador.
- `23749931M` es el DIP reservado de presidencia. PlacetaID debe verificar esa identidad y el rol se asigna únicamente en el servidor después de registrar la aceptación legal vigente.
- Las pruebas del banco pueden asociarse a varias convocatorias. Una prueba enviada conserva su validez durante seis meses.
- La definición SQL y las políticas RLS están en [`supabase/schema.sql`](supabase/schema.sql).

## Producción

El inicio de sesión de PlacetaID se vincula al perfil de Nexe por DIP. La tabla
`nexe_profiles` no depende de `auth.users`: Nexe valida la cuenta en el servidor
y solo permite el acceso si existe un perfil activo.

1. Ejecuta la versión actual de [`supabase/schema.sql`](supabase/schema.sql) en
   el SQL Editor del proyecto Supabase que utiliza Nexe. Si aplicaste una
   versión anterior, vuelve a ejecutarla para crear `nexe_documents`.
   Para actualizar una instalación que ya tiene `nexe_profiles`, también puedes
   ejecutar la migración específica
   [`supabase/migrations/20261005_placetaid_sessions.sql`](supabase/migrations/20261005_placetaid_sessions.sql).
2. La persona inicia sesión con PlacetaID. Si todavía no tiene perfil, Nexe le
   muestra los [Términos y condiciones](legal/terminos.html) y la [Política de
   privacidad](legal/privacidad.html). Solo después de aceptar los términos y
   confirmar que ha leído la política se crea una cuenta activa. La identidad
   verificada `23749931M` recibe el rol reservado `presidencia`; las cuentas
   desactivadas siguen requiriendo intervención de Administración.
3. Configura `SUPABASE_URL` y `SUPABASE_SECRET_KEY` en las variables de entorno
   de producción de Vercel. El servidor usa esta clave para consultar perfiles
   aunque el inicio de sesión venga de PlacetaID; nunca la expongas al navegador.
4. Configura `PLACETAID_REDIRECT_URI` como
   `https://nexe.laplaceta.org/auth/callback` en Vercel y autoriza esa misma URL
   en la integración de PlacetaID. El inicio de sesión y el callback deben usar
   exactamente el mismo dominio.

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

## Convenio general y firma con DIP

El convenio general (edición 2027) se publica desde la pestaña **Convenio 2027**
(administración) y se firma desde esa misma pestaña por cada cargo designado.

1. **Publicación.** Administración carga el texto (.txt o .md) y los firmantes,
   uno por línea: `cargo; nombre; DIP`. El texto se guarda con su huella SHA-256.
   Cambiar el texto invalida las firmas anteriores. Un convenio aprobado no se
   puede volver a publicar.
2. **Firma.** Cada firmante debe cumplir, en el servidor:
   - sesión PlacetaID activa;
   - DIP/NIE con letra de control correcta;
   - DIP verificado frente al registro oficial (RSP), desde la propia pantalla;
   - aceptación de los textos legales vigentes;
   - estar en la lista de firmantes;
   - volver a escribir su propio DIP (confirmación reforzada).
3. **Recibo.** Cada firma genera un recibo con DIP, cargo, huella del texto, fecha,
   IP y navegador, firmado con `NEXE_SIGNING_SECRET`. Cualquier alteración del
   recibo lo invalida al leerlo. Las firmas quedan en el registro de auditoría.
4. **Aprobación.** Cuando firman todos los firmantes designados, el convenio pasa a
   estado *aprobado* con su fecha.

**Alcance jurídico.** Esta firma es una firma electrónica interna basada en
identidad verificada y recibo firmado por el servidor. No es una firma electrónica
cualificada (eIDAS) ni equivale a la firma manuscrita en registros públicos. Si se
necesita esa equivalencia, hay que añadir DNIe, Cl@ve o un proveedor cualificado.
El texto del convenio requiere revisión jurídica antes de aprobarse, en especial
los artículos sobre complementos en Pz y sobre la naturaleza de la colaboración.

**Variables nuevas.** `NEXE_SIGNING_SECRET` (mínimo 32 caracteres) y, opcionalmente,
`NEXE_PRESIDENT_DIP`.

**Migraciones.** No hay tablas nuevas para el convenio: usa `nexe_documents` y el
registro de auditoría de la migración `20261116_seguridad_auditoria.sql`.

## Pruebas

```
npm run test:unit   # seguridad, firma y permisos (sin dependencias)
npm run test:api    # endpoints del convenio con base de datos simulada
```

## Navegación por roles y experiencia móvil

La navegación la calcula el servidor (`capacidadesFor` en `api/_permissions.js`) y se envía
en la sesión. La interfaz solo dibuja lo que recibe: escritorio muestra la barra superior y
móvil, una barra inferior con las cuatro secciones principales y el botón **Más**, que abre
una hoja con el resto y la cuenta. Cada endpoint vuelve a comprobar los permisos, así que
ocultar un botón nunca es la única protección.

## Calendario y descansos

`/api/calendario` aplica las reglas del convenio: 30 festivos de 2027, 10 días individuales
por persona, siete días naturales de antelación (en la zona horaria de Madrid), sin solicitar
festivos ni días con actividad aceptada, y sin aceptar actividades en días con descanso aprobado.
Administración publica actividades y revisa solicitudes; al aprobar, vuelve a comprobar conflictos.

## Auditoría

`/api/auditoria` (solo presidencia) muestra las últimas operaciones con DIP enmascarados.
Ningún rol puede modificar el registro.

## Cabeceras y CSP

`vercel.json` contiene la Content-Security-Policy y las cabeceras de seguridad. La política
permite solo el script en línea de `maqueta.html` mediante su huella SHA-256. Tras cualquier
cambio en ese script ejecuta `npm run csp` y después `npm run test:unit`: la prueba
`headers.test.js` falla si la huella no coincide.
