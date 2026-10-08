import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore } from '../site/data.js';
import { createAccountOverview } from '../site/party-overview.js';
import { buildFlow } from '../site/flow-data.js';
import { buildCandidateFlow } from '../site/candidate-overview.js';
import { layoutNetwork, networkPath } from '../site/network-layout.js';
import { csv, receipt, paid } from './fixtures.mjs';

function ingest(store, kind, records) { const reader = store.reader(kind, `${kind}.csv`); reader.push(csv(records)); reader.finish(); }

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
