// Calendario institucional y días individuales de descanso (convenio 2027,
// capítulo VI). Funciones puras: sin base de datos.

export const DESCANSOS_POR_PERSONA = 10;
export const ANTELACION_DIAS = 7;
export const ANOS_CONFIGURADOS = Object.freeze(['2027']);
const TZ = 'Europe/Madrid';

// Treinta festivos institucionales de 2027 (art. 32 del convenio).
export const FESTIVOS = Object.freeze({
  2027: Object.freeze([
    ['2027-01-01', 'Año Nuevo'],
    ['2027-01-17', 'Festivo institucional'],
    ['2027-02-06', 'Festivo institucional'],
    ['2027-02-21', 'Festivo institucional'],
    ['2027-03-08', 'Día Internacional de la Mujer'],
    ['2027-03-19', 'Día del Padre'],
    ['2027-03-23', 'Día de la Constitución de La Placeta como asociación'],
    ['2027-03-29', 'Festivo institucional'],
    ['2027-04-05', 'Festivo institucional'],
    ['2027-04-23', 'Quinto Aniversario de La Placeta'],
    ['2027-04-30', 'Festivo institucional'],
    ['2027-05-02', 'Día de la Madre'],
    ['2027-05-16', 'Festivo institucional'],
    ['2027-06-06', 'Festivo institucional'],
    ['2027-06-24', 'Festividad de San Juan'],
    ['2027-07-05', 'Festivo institucional'],
    ['2027-07-18', 'Festivo institucional'],
    ['2027-07-30', 'Festivo institucional'],
    ['2027-08-09', 'Festivo institucional'],
    ['2027-08-15', 'Festivo institucional'],
    ['2027-09-06', 'Festivo institucional'],
    ['2027-09-11', 'Diada de Catalunya'],
    ['2027-10-04', 'Festivo institucional'],
    ['2027-10-17', 'Festivo institucional'],
    ['2027-11-01', 'Todos los Santos'],
    ['2027-11-09', 'Jornada de Aprobación de los Primeros Objetivos Institucionales para 2028'],
    ['2027-11-14', 'Festivo institucional'],
    ['2027-12-06', 'Festivo institucional'],
    ['2027-12-13', 'Festivo institucional'],
    ['2027-12-24', 'Nochebuena'],
  ]),
});

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value) {
  const m = ISO.exec(String(value || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

// Fecha de hoy en la zona horaria de la asociación, como YYYY-MM-DD.
export function todayIso(now = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now));
  const get = t => parts.find(p => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function daysBetween(fromIso, toIso) {
  const a = Date.UTC(...fromIso.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  const b = Date.UTC(...toIso.split('-').map((v, i) => (i === 1 ? Number(v) - 1 : Number(v))));
  return Math.round((b - a) / 86400000);
}

export function festivosOf(ano) {
  return FESTIVOS[String(ano)] || [];
}

// Motivo por el que no puede solicitarse un día individual, o null si se puede.
// `usados`: días individuales ya reservados (pendientes o aprobados) este año.
// `actividadesAceptadas`: fechas en las que la persona ya tiene una actividad aceptada.
export function motivoSolicitud({ ano, fecha, hoy, usados, yaSolicitado, actividadesAceptadas, festivos }) {
  if (!ANOS_CONFIGURADOS.includes(String(ano))) return 'ano_no_configurado';
  if (!isIsoDate(fecha) || !fecha.startsWith(`${ano}-`)) return 'fecha_invalida';
  if (daysBetween(hoy, fecha) < ANTELACION_DIAS) return 'antelacion_insuficiente';
  if (festivos.has(fecha)) return 'es_festivo';
  if (yaSolicitado) return 'ya_solicitado';
  if (usados >= DESCANSOS_POR_PERSONA) return 'sin_saldo';
  if (actividadesAceptadas.has(fecha)) return 'conflicto_actividad';
  return null;
}

// Una actividad no puede aceptarse en una fecha con descanso aprobado (art. 38).
export function motivoAceptarActividad({ fecha, descansosAprobados }) {
  if (descansosAprobados.has(fecha)) return 'conflicto_descanso';
  return null;
}

export function resumenDescansos(solicitudes) {
  const activas = solicitudes.filter(s => s.estado === 'pendiente' || s.estado === 'aprobada');
  return {
    total: DESCANSOS_POR_PERSONA,
    usados: activas.length,
    pendientes: solicitudes.filter(s => s.estado === 'pendiente').length,
    aprobados: solicitudes.filter(s => s.estado === 'aprobada').length,
    disponibles: Math.max(0, DESCANSOS_POR_PERSONA - activas.length),
  };
}
