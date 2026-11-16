// Formato del registro de auditoría: `node --test test/auditoria.test.js`
import assert from 'node:assert/strict';
import test from 'node:test';
import { maskValue, shapeRows } from '../api/_auditoria.js';

test('los DIP se enmascaran y el resto de valores no cambian', () => {
  assert.equal(maskValue('12345678Z'), '••••5678Z');
  assert.equal(maskValue('convenio'), 'convenio');
  assert.equal(maskValue(null), '');
});

test('cada entrada muestra persona enmascarada, acción traducida y sin valores anteriores', () => {
  const rows = shapeRows([
    { id: 1, created_at: '2027-01-02T10:00:00Z', actor_id: 'u1', action: 'consent', collection_path: 'convenios/2027/firmas', document_id: '12345678Z', ip: '10.0.0.1', before: { secreto: 'x' } },
    { id: 2, created_at: '2027-01-02T11:00:00Z', actor_id: null, action: 'update', collection_path: 'convenios', document_id: '2027', ip: null },
  ], [{ id: 'u1', dip: '12345678Z', nombre: 'Marta' }]);
  assert.equal(rows[0].persona, 'Marta · ••••5678Z');
  assert.equal(rows[0].accion, 'Firma');
  assert.equal(rows[0].documento, '••••5678Z');
  assert.equal('before' in rows[0], false, 'los valores anteriores no se exponen aquí');
  assert.equal(rows[1].persona, 'Sistema');
  assert.equal(rows[1].accion, 'Modificación');
  assert.equal(rows[1].ip, '—');
});
