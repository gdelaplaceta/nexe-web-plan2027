# Nexe · Estado frente al documento de diseño y al convenio 2027

Fecha de referencia: 16 de noviembre de 2026.

## Modelo de roles (confirmado)

- Toda persona activa es **aspirante**.
- Una **plaza** adjudicada en una convocatoria concede el rol que esa convocatoria indica en `rolConcedido` (por defecto, colaborador). Quitar la plaza retira el rol en la siguiente petición.
- Una persona puede tener **varios roles a la vez** (multirol). El rol principal para mostrar es el de mayor jerarquía.
- **Presidencia** no se concede por plaza: la identifica el DIP reservado y exige haber aceptado los textos legales vigentes. Una convocatoria no puede conceder presidencia (el servidor lo rechaza).
- Los roles se calculan en el servidor en cada sesión. La interfaz solo dibuja lo que el servidor envía.

## Hecho y verificado

| Área | Qué hay | Cómo se verifica |
|---|---|---|
| Roles multirol | Cálculo desde plazas, capacidades combinadas, revocación inmediata | `test/roles.test.js` |
| Permisos por persona | Lectura y escritura filtradas por DIP, tablero por proyecto | `test/permisos.test.js` |
| Firma del convenio | DIP con letra de control, RSP, legal aceptado, confirmación del DIP, recibo firmado | `test/convenio.test.js`, `test/convenio-api.test.js` |
| CSV (código seguro de verificación) | Código por firma y por convenio aprobado, unido al recibo firmado; verificación pública sin sesión | `test/verificacion.test.js`; página `/verificar` |
| Calendario y descansos | 30 festivos, 10 días individuales, antelación de 7 días, incompatibilidades | `test/calendario.test.js`, `test/calendario-api.test.js` |
| Auditoría | Registro de solo lectura (trigger), vista para presidencia | `test/auditoria.test.js`; migración **no** ejecutada |
| Archivo de presidencia | Lista de todas las personas con roles, plazas y firmas; ficha por persona | `test/verificacion.test.js` (formato); captura en Chromium |
| Seguridad web | CSP con huella del script, HSTS, X-Frame-Options, aislamiento de origen, API sin caché | `test/headers.test.js`; CSP ejecutada en Chromium |
| Experiencia móvil | Barra inferior, barra de aplicación, hoja «Más» con roles y cuenta | Capturas a 390 px y 1280 px |

## Pendiente

- **Ejecutar la migración** `20261116_seguridad_auditoria.sql` en Supabase de pruebas y comprobar el trigger de solo lectura y las funciones SQL. En este entorno no hay Postgres.
- **Probar con base de datos real** el cálculo de roles (`plazaRolesOf`), el archivo y la verificación. Hoy solo están probadas las funciones puras y los endpoints con base simulada.
- **Auditar las consultas del archivo.** Hoy leer el archivo no deja rastro en el registro, porque la restricción de acciones no incluye «lectura». Hace falta ampliar la migración.
- **Limitar la verificación pública.** `/api/verificar` no tiene límite de peticiones. Con 60 bits de código no es viable adivinarlo, pero conviene limitar el tráfico en Vercel.
- **Configurar** `RSP_VERIFY_URL`, `RSP_API_KEY` y `NEXE_SIGNING_SECRET` en Vercel. Sin RSP nadie puede firmar.
- **Ejecutar las dos pruebas antiguas** (`placetaid-registration`, `banco-nominas`) con las dependencias instaladas.
- **Juntas y mandatos** (dos años, renovaciones anuales, avisos). No construido.
- **Departamentos y proyectos** con paneles propios y presupuestos. Solo tablas base.
- **Reuniones, convocatorias y actas.** No construido. El rol de secretaría ya tiene capacidad reservada para redactar actas.
- **Documentación y certificados.** No construido.
- **Recursos digitales.** No construido.
- **Economía interna y quema de Placetas.** No construido. El artículo 29 del convenio exige revisión jurídica antes de activar cualquier complemento.
- **Formación e informes.** No construido.
- **Convenios anteriores.** Las aceptaciones sin recibo no pasan la validación nueva.
- **Revisión jurídica** del convenio (artículos 29, 41, 42 y 60).

## Decisiones que conviene revisar

- **Administración concedida por plaza.** Una convocatoria puede conceder el rol de administración, que da control total de la aplicación. Conviene que solo presidencia pueda crear convocatorias con ese rol. Hoy lo puede hacer cualquier administración.
- **Administración lee todos los registros** a través de la API de documentos, igual que presidencia. El archivo de presidencia añade la vista ordenada por persona.
- **La firma del convenio es una firma electrónica interna**, no cualificada eIDAS. El CSV permite verificar que un documento es auténtico, pero no equivale a la firma manuscrita en registros públicos.
- **El CSV es público.** La verificación muestra nombre, cargo y fecha del firmante, nunca el DIP completo, la IP ni el navegador.
