import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore } from '../site/data.js';
import { createAccountOverview } from '../site/party-overview.js';
import { buildFlow } from '../site/flow-data.js';
import { buildCandidateFlow } from '../site/candidate-overview.js';
import { layoutNetwork, networkPath, networkLineWidths, networkNodeRadii } from '../site/network-layout.js';
import { csv, receipt, paid } from './fixtures.mjs';

function ingest(store, kind, records) { const reader = store.reader(kind, `${kind}.csv`); reader.push(csv(records)); reader.finish(); }

test('área dos círculos representa receitas recebidas, sem misturar despesas ou fabricar entradas ausentes', () => {
  const nodes = [{ id: 'maior', inCents: 10000, outCents: 0 }, { id: 'menor', inCents: 2500, outCents: 999999 }, { id: 'zero', inCents: 0 }, { id: 'negativo', inCents: -10000 }, { id: 'pequeno', inCents: 1 }];
  const before = structuredClone(nodes), { maxCents, radii } = networkNodeRadii(nodes);
  assert.equal(maxCents, 10000); assert.equal(radii.get('maior'), 32); assert.equal(radii.get('menor'), 16);
  assert.equal(radii.get('maior') ** 2 / radii.get('menor') ** 2, 4);
  for (const id of ['zero', 'negativo', 'pequeno']) assert.equal(radii.get(id), 6);
  assert.deepEqual(nodes, before);
  assert.equal(networkNodeRadii([{ id: 'sem-receita', inCents: 0, outCents: 200 }]).radii.get('sem-receita'), 6);
  assert.equal(networkNodeRadii([]).maxCents, 0);
});

test('espessura usa uma escala comum para receitas e despesas e conserva zero, sinais e valores pequenos', () => {
  const links = [{ id: 'receita', cents: 100000 }, { id: 'despesa', cents: 50000 }, { id: 'igual', cents: 100000 }, { id: 'devolucao', cents: -50000 }, { id: 'pequeno', cents: 1 }, { id: 'zero', cents: 0, missing: 1 }];
  const before = structuredClone(links), { maxCents, widths } = networkLineWidths(links);
  assert.equal(maxCents, 100000);
  assert.equal(widths.get('receita'), 12); assert.equal(widths.get('igual'), 12);
  assert.equal(widths.get('despesa'), 6); assert.equal(widths.get('devolucao'), 6);
  assert.equal(widths.get('pequeno'), .75); assert.equal(widths.get('zero'), 0);
  assert.deepEqual(links, before);
  assert.equal(networkLineWidths([{ id: 'zero', cents: 0 }]).widths.get('zero'), 0);
  assert.equal(networkLineWidths([]).maxCents, 0);
});

test('grafo preserva nós, direções, sinais e valores parciais do resumo', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [receipt({ VR_RECEITA: '100,00' }), receipt({ VR_RECEITA: '-10,00', DS_ORIGEM_RECEITA: 'Devolução' }), receipt({ VR_RECEITA: '#NULO#' })]);
  ingest(store, 'paid', [paid({ VR_PAGTO_DESPESA: '30,00' })]);
  const graph = buildFlow(createAccountOverview(store)), layout = layoutNetwork(graph);
  assert.equal(graph.totals.receipts.cents, 9000); assert.equal(graph.totals.outgoing.cents, 3000);
  assert.equal(graph.missing, 1);
  assert.deepEqual(layout.links, graph.links);
  assert.deepEqual(layout.nodes.map((node) => node.id), graph.nodes.map((node) => node.id));
  const byId = new Map(layout.nodes.map((node) => [node.id, node]));
  assert.ok(layout.links.some((edge) => edge.cents < 0));
  for (const edge of layout.links) {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    assert.ok(source.side === 'incoming' && target.side === 'party' || source.side === 'party' && target.side === 'outgoing');
    assert.match(networkPath(source, target), /^M .+ Q /);
    assert.ok(!/NaN|Infinity/.test(networkPath(source, target)));
  }
});

test('disposição do grafo é determinística, não altera valores e comporta todas as categorias expandidas', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', Array.from({ length: 40 }, (_, index) => receipt({ SG_PARTIDO: `TESTE ${index}`, SQ_PRESTADOR_CONTAS: String(index), DS_ORIGEM_RECEITA: `Origem ${index % 15}`, VR_RECEITA: `${index},00` })));
  const graph = buildFlow(createAccountOverview(store), { expanded: [0] }), before = structuredClone(graph);
  const layout = layoutNetwork(graph);
  assert.deepEqual(layout, layoutNetwork(graph)); assert.deepEqual(graph, before);
  assert.equal(layout.nodes.length, 55);
  for (const entry of layout.nodes) { assert.ok(Number.isFinite(entry.x) && Number.isFinite(entry.y)); assert.ok(entry.x >= 100 && entry.x <= layout.width - 100); assert.ok(entry.y >= 40 && entry.y <= layout.height - 80); }
  for (let i = 0; i < layout.nodes.length; i++) for (let j = i + 1; j < layout.nodes.length; j++) {
    const a = layout.nodes[i], b = layout.nodes[j]; assert.ok(Math.abs(a.x - b.x) > 170 || Math.abs(a.y - b.y) > 72, `Rótulos sobrepostos: ${a.label} e ${b.label}`);
  }
});

test('grafo dos candidatos conserva contas distintas e receitas/despesas independentes', () => {
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', [receipt({ SQ_PRESTADOR_CONTAS: 'A', NM_CANDIDATO: 'Nome igual', VR_RECEITA: '0,00' }), receipt({ SQ_PRESTADOR_CONTAS: 'B', NM_CANDIDATO: 'Nome igual', VR_RECEITA: '50,00' })]);
  const data = createAccountOverview(store), graph = buildCandidateFlow(data, { stage: 'names' }), layout = layoutNetwork(graph);
  assert.equal(layout.nodes.filter((entry) => entry.side === 'party').length, 2);
  assert.equal(new Set(layout.nodes.map((entry) => entry.id)).size, layout.nodes.length);
  assert.equal(graph.totals.receipts.cents, 5000); assert.equal(graph.totals.outgoing.available, false);
  const zero = layout.nodes.find((entry) => entry.side === 'party' && entry.inCents === 0); assert.ok(zero); assert.equal(zero.navigation.accounts.length, 1);
  assert.deepEqual(layoutNetwork({ columns: [[], [], []], nodes: [], links: [] }).nodes, []);
  assert.equal(networkPath({ x: 0, y: 0, radius: 8 }, { x: 0, y: 0, radius: 8 }), '');
  assert.throws(() => layoutNetwork({ columns: [[], [], []], links: [{ source: 'x', target: 'y' }] }), /sem nó/);
});
