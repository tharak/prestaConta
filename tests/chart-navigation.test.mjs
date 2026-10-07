import test from 'node:test';
import assert from 'node:assert/strict';
import { accountGroups, recordGroups, latestRecords, zoomFrame } from '../site/chart-navigation.js';

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

test('zoom pula níveis com uma só parcela e conserva a composição e o contexto selecionado', async () => {
  const entry = { id: 'A', label: 'Seleção inicial', level: 'party', cents: 300 };
  const sphere = { id: 'S', level: 'sphere', cents: 300 };
  const frame = { title: 'Esfera única', dimension: 'Órgãos por estado', nodes: [{ id: 'SP', level: 'uf', cents: 100 }, { id: 'RJ', level: 'uf', cents: 200 }] };
  const calls = [];
  const result = await zoomFrame(entry, async (part) => { calls.push(part.id); return part === entry ? { nodes: [sphere, { cents: 0 }, { cents: null }] } : frame; });
  assert.deepEqual(calls, ['A', 'S']);
  assert.equal(result.title, 'Seleção inicial');
  assert.equal(result.dimension, frame.dimension);
  assert.equal(result.nodes, frame.nodes);
});

test('zoom não cria gráfico para uma cadeia sem subdivisões, folhas ou ausência de valores', async () => {
  const entry = { id: 'A', label: 'A', level: 'origin', cents: 100, missing: 1 };
  assert.equal(await zoomFrame(entry, async () => ({ nodes: [{ level: 'leaf', cents: 100, missing: 1 }] })), null);
  assert.equal(await zoomFrame(entry, async () => ({ nodes: [{ cents: 0 }, { cents: null }] })), null);
  assert.equal(await zoomFrame(entry, async () => null), null);
  const never = async () => { throw new Error('Não deve procurar filhos'); };
  assert.equal(await zoomFrame({ ...entry, level: 'leaf' }, never), null);
  assert.equal(await zoomFrame({ ...entry, cents: 0 }, never), null);
});

test('zoom não esconde categorias negativas ou parcelas incompletas ao pular níveis', async () => {
  const entry = { label: 'A', level: 'account', cents: 100 };
  for (const nodes of [[{ cents: 120 }, { cents: -20 }], [{ cents: 100 }, { cents: 0, missing: 1 }]]) {
    const frame = { dimension: 'Categorias', nodes };
    assert.equal((await zoomFrame(entry, async () => frame)).nodes, nodes);
  }
});
