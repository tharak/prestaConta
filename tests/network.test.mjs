import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore } from '../site/data.js';
import { createAccountOverview } from '../site/party-overview.js';
import { buildFlow } from '../site/flow-data.js';
import { buildCandidateFlow, buildCandidateNetwork, expandCandidateNetwork, revealCandidateNetwork } from '../site/candidate-overview.js';
import { layoutNetwork, networkPath, networkLineWidths, networkNodeRadii } from '../site/network-layout.js';
import { csv, receipt, paid } from './fixtures.mjs';

function ingest(store, kind, records) { const reader = store.reader(kind, `${kind}.csv`); reader.push(csv(records)); reader.finish(); }

function candidateExample() {
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', Array.from({ length: 159 }, (_, i) => receipt({ SQ_PRESTADOR_CONTAS: String(i), SQ_CANDIDATO: String(i), NM_CANDIDATO: `Nome ${String(i).padStart(3, '0')}`, DS_CARGO: i < 120 ? 'Estadual' : 'Federal', SG_UF: i % 2 ? 'MS' : 'SP', VR_RECEITA: i === 0 ? '0,00' : i === 1 ? '#NULO#' : i === 2 ? '-1,00' : '10,00' })));
  ingest(store, 'paid', [paid({ SQ_PRESTADOR_CONTAS: '3', VR_PAGTO_DESPESA: '4,00' })]);
  return createAccountOverview(store);
}

test('expansão no grafo substitui somente o nó clicado e conserva todas as contas e totais', () => {
  const data = candidateExample(), root = { expanded: [] }, before = buildCandidateNetwork(data, root);
  const office = before.columns[1].find((entry) => entry.label === 'Estadual');
  const next = expandCandidateNetwork(data, root, office.navigation.id), after = buildCandidateNetwork(data, next);
  assert.equal(before.columns[1].length, 2); assert.equal(after.columns[1].length, 3);
  assert.ok(after.columns[1].some((entry) => entry.label === 'Federal'));
  assert.ok(after.columns[1].some((entry) => entry.navigation.accounts[0].uf === 'MS'));
  assert.deepEqual(after.totals, before.totals);
  const ids = after.columns[1].flatMap((entry) => entry.navigation.accounts.map((account) => account.id));
  assert.equal(ids.length, data.accounts.length); assert.equal(new Set(ids).size, data.accounts.length);
  assert.deepEqual(buildCandidateNetwork(data, root).totals, before.totals);
  assert.equal(root.groups, undefined);
  assert.equal(expandCandidateNetwork(data, next, office.navigation.id), next);
});

test('mais nós no centro e busca revelam candidatos sem remover grupos vizinhos nem misturar homônimos', () => {
  const data = candidateExample(), root = { expanded: [] }, id = data.accounts.find((account) => account.prestador === '3').id;
  const context = revealCandidateNetwork(data, root, id), graph = buildCandidateNetwork(data, context);
  assert.ok(graph.columns[1].length > 12);
  const candidate = graph.columns[1].find((entry) => entry.party === id);
  assert.equal(candidate.navigation.level, 'account'); assert.equal(candidate.navigation.accounts.length, 1);
  assert.equal(candidate.inCents, 1000); assert.equal(candidate.outCents, 400);
  assert.deepEqual(graph.totals, buildCandidateNetwork(data, root).totals);
  assert.ok(graph.columns[1].some((entry) => entry.label === 'Federal'));
  assert.equal(expandCandidateNetwork(data, context, id), context);
  assert.equal(revealCandidateNetwork(data, context, id), context);
  assert.equal(revealCandidateNetwork(data, context, 'ausente'), context);
  const allIds = context.groups.flatMap((entry) => entry.accounts.map((account) => account.id));
  assert.equal(allIds.length, 159); assert.equal(new Set(allIds).size, 159);
  const layout = layoutNetwork(graph); assert.ok(layout.width > 1280); assert.ok(layout.links.every((edge) => Number.isFinite(edge.cents)));
});

test('estados de cargos distintos permanecem separados ao expandir os dois grupos', () => {
  const data = candidateExample(), root = { expanded: [] };
  const first = expandCandidateNetwork(data, root, 'office:Estadual');
  const next = expandCandidateNetwork(data, first, 'office:Federal'), graph = buildCandidateNetwork(data, next);
  assert.equal(graph.columns[1].length, 4);
  assert.equal(new Set(graph.columns[1].map((entry) => entry.id)).size, 4);
  assert.ok(graph.columns[1].some((entry) => entry.label === 'Federal · MS'));
  assert.ok(graph.columns[1].some((entry) => entry.label === 'Estadual · MS'));
  const ids = graph.columns[1].flatMap((entry) => entry.navigation.accounts.map((account) => account.id));
  assert.equal(ids.length, 159); assert.equal(new Set(ids).size, 159);
  assert.deepEqual(graph.totals, buildCandidateNetwork(data, root).totals);
});

test('rede expandida mantém posições finitas e rótulos separados com centenas de candidaturas', () => {
  const data = candidateExample();
  let context = { expanded: [] };
  for (const account of data.accounts) context = revealCandidateNetwork(data, context, account.id);
  const graph = buildCandidateNetwork(data, context), layout = layoutNetwork(graph);
  assert.equal(graph.columns[1].length, 159);
  assert.ok(graph.columns[1].every((entry) => entry.navigation.level === 'account'));
  assert.deepEqual(graph.totals, buildCandidateNetwork(data, { expanded: [] }).totals);
  assert.deepEqual(layout, layoutNetwork(graph));
  for (const entry of layout.nodes) assert.ok(Number.isFinite(entry.x) && Number.isFinite(entry.y));
  for (let i = 0; i < layout.nodes.length; i++) for (let j = i + 1; j < layout.nodes.length; j++) {
    const a = layout.nodes[i], b = layout.nodes[j]; assert.ok(Math.abs(a.x - b.x) > 170 || Math.abs(a.y - b.y) > a.radius + b.radius + 60, `Sobreposição: ${a.label} e ${b.label}`);
  }
});

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
