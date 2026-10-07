import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutPie, slicePath } from '../site/pie-chart.js';
import { accountGroups, recordGroups, latestRecords } from '../site/pie-navigation.js';

test('pizza representa a soma conhecida sem alterar a ordem ou atribuir fatias a valores ausentes', () => {
  const values = [{ id: 'A', cents: 100, missing: 1 }, { id: 'B', cents: 0 }, { id: 'C', cents: null }, { id: 'D', cents: 300 }];
  const pie = layoutPie(values);
  assert.equal(pie.total, 400);
  assert.equal(pie.status, 'ready');
  assert.deepEqual(pie.slices.map(({ id, share, start, end }) => ({ id, share, start, end })), [{ id: 'A', share: .25, start: 0, end: .25 }, { id: 'D', share: .75, start: .25, end: 1 }]);
  assert.equal(pie.slices[0].missing, 1);
  assert.equal(values[0].share, undefined);
});

test('totais negativos não são descartados nem transformados em participações de uma pizza', () => {
  assert.deepEqual(layoutPie([{ cents: -20 }, { cents: 100 }]), { status: 'negative', total: 80, slices: [] });
  for (const values of [[], [{ cents: 0 }], [{ cents: null }]]) assert.equal(layoutPie(values).status, 'empty');
});

test('uma única fatia ocupa o círculo inteiro; duas fatias usam arcos proporcionais', () => {
  const full = slicePath(0, 1);
  assert.equal((full.match(/ A /g) || []).length, 2);
  assert.match(full, /160 30/);
  assert.match(full, /160 290/);
  assert.match(slicePath(0, .75), /0 1 1/);
  assert.match(slicePath(0, .25), /0 0 1/);
  assert.ok(!slicePath(.99, 1).includes('NaN'));
});

function account(id, sphere, uf, cents, olderCents = 99900) {
  return { id, sphere, uf, statements: [{ totals: { receipts: { available: true, count: cents === null ? 0 : 1, missing: 0, knownCents: cents ?? 0 } } }, { totals: { receipts: { available: true, count: 1, missing: 0, knownCents: olderCents } } }] };
}

test('zoom por esfera, estado e órgão conserva a soma e usa somente a última prestação', () => {
  const accounts = [account('1', 'Nacional', 'BR', 100), account('2', 'Municipal', 'SP', 200), account('3', 'Municipal', 'RJ', 300), account('4', 'Municipal', 'SP', null)];
  const spheres = accountGroups(accounts, 'receipts', 'sphere');
  assert.deepEqual(spheres.map((group) => [group.label, group.cents]), [['Municipal', 500], ['Nacional', 100]]);
  const states = accountGroups(spheres[0].accounts, 'receipts', 'uf');
  assert.deepEqual(states.map((group) => [group.label, group.cents]), [['RJ', 300], ['SP', 200]]);
  const organs = accountGroups(states[1].accounts, 'receipts', 'id');
  assert.equal(organs.reduce((sum, organ) => sum + (organ.cents ?? 0), 0), states[1].cents);
  assert.equal(organs[1].cents, null);
});

test('zoom nas fontes e origens conserva os valores conhecidos e os registros sem valor', () => {
  const records = [{ source: 'Fonte A', origin: 'Origem A', cents: 100 }, { source: 'Fonte A', origin: 'Origem B', cents: 200 }, { source: 'Fonte A', origin: 'Origem B', cents: null }, { source: 'Fonte B', origin: 'Origem C', cents: 400 }];
  const sources = recordGroups(records, 'source');
  const origins = recordGroups(sources[0].records, 'origin');
  assert.equal(sources[0].cents, 300);
  assert.equal(sources[0].missing, 1);
  assert.equal(origins.reduce((sum, origin) => sum + origin.cents, 0), 300);
  assert.equal(origins[1].missing, 1);
  assert.equal(recordGroups([{ cents: -10, origin: '' }], 'origin')[0].label, 'Não informado');
});

test('detalhes unificam variações de caixa sem reunir datas, turnos ou tipos distintos', () => {
  const statement = { type: 'Parcial', date: '10/09/2026', turn: '' };
  const entry = (changes, cents) => ({ summary: { statement: { ...statement, ...changes } }, records: { receipts: [{ cents }] } });
  const document = { statements: [entry({}, 100), entry({ type: 'PARCIAL' }, 200), entry({ date: '01/09/2026' }, 999), entry({ turn: '2' }, 999), entry({ type: 'Final' }, 999)] };
  assert.deepEqual(latestRecords(document, statement, 'receipts').map((row) => row.cents), [100, 200]);
});
