// Reglas del calendario y descansos: `node --test test/calendario.test.js`
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FESTIVOS, festivosOf, isIsoDate, todayIso, daysBetween, motivoSolicitud,
  motivoAceptarActividad, resumenDescansos, DESCANSOS_POR_PERSONA,
} from '../api/_calendario.js';

const FEST = new Set(festivosOf(2027).map(([f]) => f));
const base = { ano: '2027', hoy: '2026-11-16', usados: 0, yaSolicitado: false, actividadesAceptadas: new Set(), festivos: FEST };

test('el convenio fija 30 festivos únicos en 2027', () => {
  assert.equal(FESTIVOS[2027].length, 30);
  assert.equal(new Set(FESTIVOS[2027].map(x => x[0])).size, 30);
  assert.ok(FESTIVOS[2027].every(([f]) => f.startsWith('2027-') && isIsoDate(f)));
});

test('fechas: validación real del calendario', () => {
  assert.equal(isIsoDate('2027-02-29'), false, '2027 no es bisiesto');
  assert.equal(isIsoDate('2028-02-29'), true);
  assert.equal(isIsoDate('2027-13-01'), false);
  assert.equal(isIsoDate('27-01-01'), false);
});

test('hoy se calcula en la zona horaria de la asociación', () => {
  // 23:30 UTC del 16 de noviembre es ya 17 de noviembre en Madrid.
  assert.equal(todayIso(Date.parse('2026-11-16T23:30:00Z')), '2026-11-17');
  assert.equal(todayIso(Date.parse('2026-11-16T10:00:00Z')), '2026-11-16');
});

test('antelación de siete días naturales', () => {
  assert.equal(daysBetween('2026-11-16', '2026-11-23'), 7);
  assert.equal(motivoSolicitud({ ...base, hoy: '2027-03-02', fecha: '2027-03-09' }), null, 'exactamente siete días');
  assert.equal(motivoSolicitud({ ...base, hoy: '2027-03-02', fecha: '2027-03-08' }), 'antelacion_insuficiente', 'seis días: la antelación se comprueba antes');
});

test('no se solicita con menos de siete días de antelación', () => {
  assert.equal(motivoSolicitud({ ...base, hoy: '2027-03-02', fecha: '2027-03-06' }), 'antelacion_insuficiente', 'cuatro días');
  assert.equal(motivoSolicitud({ ...base, hoy: '2027-03-02', fecha: '2027-03-08' }), 'antelacion_insuficiente', 'seis días: la antelación se comprueba antes');
});

test('no se solicitan festivos ni fechas de otro año', () => {
  assert.equal(motivoSolicitud({ ...base, hoy: '2027-02-01', fecha: '2027-03-08' }), 'es_festivo');
  assert.equal(motivoSolicitud({ ...base, fecha: '2028-01-10' }), 'fecha_invalida');
  assert.equal(motivoSolicitud({ ...base, ano: '2030', fecha: '2030-01-10' }), 'ano_no_configurado');
});

test('diez días por persona y sin duplicados', () => {
  assert.equal(motivoSolicitud({ ...base, fecha: '2027-05-10', usados: DESCANSOS_POR_PERSONA - 1 }), null, 'último día disponible');
  assert.equal(motivoSolicitud({ ...base, fecha: '2027-05-10', usados: DESCANSOS_POR_PERSONA }), 'sin_saldo');
  assert.equal(motivoSolicitud({ ...base, fecha: '2027-05-10', yaSolicitado: true }), 'ya_solicitado');
});

test('un día individual no puede coincidir con una actividad aceptada', () => {
  const actividadesAceptadas = new Set(['2027-05-10']);
  assert.equal(motivoSolicitud({ ...base, fecha: '2027-05-10', actividadesAceptadas }), 'conflicto_actividad');
  assert.equal(motivoAceptarActividad({ fecha: '2027-05-10', descansosAprobados: new Set(['2027-05-10']) }), 'conflicto_descanso');
  assert.equal(motivoAceptarActividad({ fecha: '2027-05-11', descansosAprobados: new Set(['2027-05-10']) }), null);
});

test('resumen de saldo: pendientes y aprobados reservan días; rechazadas y canceladas no', () => {
  const r = resumenDescansos([
    { estado: 'aprobada' }, { estado: 'pendiente' }, { estado: 'rechazada' }, { estado: 'cancelada' },
  ]);
  assert.equal(r.usados, 2);
  assert.equal(r.disponibles, 8);
  assert.equal(r.pendientes, 1);
  assert.equal(r.aprobados, 1);
});
