# Nexe · Estado frente al documento de diseño y al convenio 2027

Fecha de referencia: 16 de noviembre de 2026.

## Hecho y verificado

| Área | Qué hay | Cómo se verifica |
|---|---|---|
| Sesión y roles | Cookie firmada, roles con mínimo privilegio, capacidades por rol calculadas en el servidor | `test/security.test.js`, `test/permisos.test.js` |
| Permisos por persona | Lectura y escritura filtradas por DIP, tablero de tareas por proyecto | `test/permisos.test.js` |
| Auditoría | Registro inmutable (trigger que impide UPDATE, DELETE y TRUNCATE), escrituras atómicas con auditoría | `test/auditoria.test.js` (formato); la migración **no** se ha ejecutado |
| Convenio general 2027 | Publicación por administración, firma con DIP validado (letra de control, RSP, legal aceptado, confirmación), recibo firmado | `test/convenio.test.js`, `test/convenio-api.test.js` |
| Calendario y descansos | 30 festivos, 10 días individuales, antelación de 7 días naturales, incompatibilidades con actividades | `test/calendario.test.js`, `test/calendario-api.test.js` |
| Seguridad web | CSP con huella del script, HSTS, X-Frame-Options, aislamiento de origen, API sin caché, fuentes autohospedadas | `test/headers.test.js`; la CSP se ha ejecutado en Chromium sin errores |
| Experiencia móvil | Barra inferior, barra de aplicación, hoja «Más», cuenta; escritorio sin cambios de comportamiento | Capturas en Chromium a 390 px y 1280 px |
| Auditoría para presidencia | Vista de solo lectura con DIP enmascarados | `test/auditoria.test.js`, captura de presidencia |

## Pendiente

- **Ejecutar la migración** `20261116_seguridad_auditoria.sql` en un entorno de pruebas de Supabase y comprobar el trigger de solo lectura y las funciones SQL. En este entorno no hay Postgres.
- **Configurar** `RSP_VERIFY_URL`, `RSP_API_KEY` y `NEXE_SIGNING_SECRET` en Vercel. Sin RSP, nadie puede firmar el convenio.
- **Ejecutar las dos pruebas antiguas** (`placetaid-registration`, `banco-nominas`) con las dependencias instaladas. Necesitan `@supabase/supabase-js`.
- **Probar el flujo completo** con Supabase real: publicar, firmar, aprobar.
- **Juntas y mandatos.** Presidencia, Vicepresidencia, Secretaría y vocalías con mandato de dos años, y renovaciones anuales de nombramientos ordinarios con avisos. No está construido.
- **Departamentos y proyectos** con paneles propios, presupuestos y objetivos. Solo existen las tablas base.
- **Reuniones, convocatorias y actas**, con acuerdos vinculados al órgano competente. No está construido.
- **Documentación y certificados** generados desde el historial, con identificador de verificación. No está construido.
- **Recursos digitales.** Inventario de licencias, almacenamiento y permisos. No está construido.
- **Economía interna.** Cuentas, emisiones, complementos con límites, quema de Placetas (objetivo de 50.000 Pz). No está construido, y el artículo 29 del convenio exige revisión jurídica antes de activar cualquier asignación.
- **Formación, incidencias ampliadas e informes** con cuadros de mando.
- **Gestión de convenios anteriores.** Las aceptaciones guardadas sin recibo no pasan la validación nueva.
- **Revisión jurídica** del convenio (artículos 29, 41, 42 y 60).

## Decisiones tomadas

- Administración puede leer todos los registros a través de la API de documentos, igual que presidencia.
- Los roles nuevos (colaborador, dirección, secretaría, vicepresidencia) se tratan como aspirante hasta definir sus permisos.
- El calendario y el convenio solo se acceden por sus endpoints dedicados, nunca por la API genérica de documentos, ni siquiera para administración.
- La firma con DIP es una firma electrónica interna. No es una firma cualificada eIDAS.
