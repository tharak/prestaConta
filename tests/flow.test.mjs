import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore } from '../site/data.js';
import { createPartyOverview } from '../site/party-overview.js';
import { buildFlow } from '../site/flow-data.js';
import { layoutFlow } from '../site/flow-layout.js';
import { csv, receipt, contracted, paid } from './fixtures.mjs';

function ingest(store, kind, records) { const parser = store.reader(kind, `${kind}.csv`); parser.push(csv(records)); parser.finish(); }
function example() {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [receipt({ VR_RECEITA: '900,00', DT_PRESTACAO_CONTAS: '01/09/2026' }), receipt({ VR_RECEITA: '100,00', DS_ORIGEM_RECEITA: 'Doações' }), receipt({ VR_RECEITA: '50,00', SQ_PRESTADOR_CONTAS: 'B', SG_PARTIDO: 'SIGLA B', DS_ORIGEM_RECEITA: 'Repasses' })]);
  ingest(store, 'contracted', [contracted({ VR_DESPESA_CONTRATADA: '70,00', SQ_DESPESA: 'DESPESA-TESTE' }), contracted({ VR_DESPESA_CONTRATADA: '40,00', SQ_DESPESA: 'DESPESA-TESTE', SQ_PRESTADOR_CONTAS: 'B', SG_PARTIDO: 'SIGLA B' })]);
  ingest(store, 'paid', [paid({ VR_PAGTO_DESPESA: '30,00', DS_ORIGEM_DESPESA: 'Categoria de teste' }), paid({ VR_PAGTO_DESPESA: '20,00', DS_ORIGEM_DESPESA: 'Categoria de teste', SQ_PRESTADOR_CONTAS: 'B', SG_PARTIDO: 'SIGLA B' })]);
  return createPartyOverview(store);
}

test('fluxo usa somente a última prestação e mantém pagamentos separados de contratos', () => {
  const data = example(), graph = buildFlow(data);
  assert.equal(graph.totals.receipts.cents, 15000);
  assert.equal(graph.totals.outgoing.cents, 5000);
  assert.equal(graph.links.filter((edge) => graph.columns[0].some((node) => node.id === edge.source)).reduce((sum, edge) => sum + edge.cents, 0), 15000);
  assert.equal(graph.links.filter((edge) => graph.columns[2].some((node) => node.id === edge.target)).reduce((sum, edge) => sum + edge.cents, 0), 5000);
  assert.equal(buildFlow(data, { outgoing: 'contracted' }).totals.outgoing.cents, 11000);
  const selected = buildFlow(data, { party: 'TESTE' });
  assert.equal(selected.totals.receipts.cents, 10000); assert.equal(selected.totals.outgoing.cents, 3000);
  assert.deepEqual(selected.columns[1].map((entry) => entry.party), ['TESTE']);
  assert.equal(selected.columns[2][0].label, 'Categoria de teste');
  assert.equal(buildFlow(data, { incoming: 'sources' }).columns[0][0].label, 'Outros Recursos');
});

test('categorias agrupadas conservam somas e podem ser expandidas sem mudar os totais', () => {
  const store = new AccountStore('parties');
  ingest(store, 'contracted', Array.from({length:12}, (_, index) => contracted({SQ_DESPESA:String(index), DS_ORIGEM_DESPESA:`Categoria ${index}`, VR_DESPESA_CONTRATADA:`${index+1},00`} )));
  const data = createPartyOverview(store), grouped = buildFlow(data, {outgoing:'contracted'}), expanded = buildFlow(data, {outgoing:'contracted',expanded:[1]});
  assert.equal(grouped.columns[2].length, 9); assert.equal(expanded.columns[2].length, 12);
  const rest = grouped.columns[2].find((entry) => entry.children);
  assert.equal(rest.children.length, 4); assert.equal(rest.cents, 1000);
  assert.equal(grouped.columns[2].reduce((sum, entry) => sum + entry.cents,0), expanded.totals.outgoing.cents);
  assert.equal(grouped.links.reduce((sum, edge) => sum + edge.cents,0), expanded.links.reduce((sum, edge) => sum + edge.cents,0));
  assert.deepEqual(grouped.totals, expanded.totals);
});

test('espessuras usam a mesma escala nas entradas e saídas sem inventar saldo para conciliá-las', () => {
  const graph = buildFlow(example()), layout = layoutFlow(graph);
  for (const edge of layout.links) assert.equal(edge.thickness, edge.cents * layout.scale);
  for (const party of layout.nodes.filter((node) => node.side === 'party')) assert.equal(party.height, Math.max(party.inCents, party.outCents) * layout.scale);
  assert.equal(layout.links.length, graph.links.length);
  const positioned = new Map(layout.nodes.map((entry) => [entry.id, entry]));
  for (const entry of layout.nodes) { assert.ok(entry.y >= 0); assert.ok(entry.y + entry.height <= layout.height); }
  for (const edge of layout.links) { assert.ok(positioned.has(edge.source)); assert.ok(positioned.has(edge.target)); assert.ok(!edge.path.includes('NaN')); }
  assert.equal(graph.nodes.some((entry) => /saldo|diferença/i.test(entry.label)), false);
});

test('valores ausentes, zero, devoluções e tabelas indisponíveis não recebem fluxos fabricados', () => {
  const store = new AccountStore('parties');
  ingest(store,'receipts',[receipt({VR_RECEITA:'0,00'}),receipt({VR_RECEITA:'#NULO#'})]);
  let graph = buildFlow(createPartyOverview(store));
  assert.equal(graph.missing,1); assert.equal(graph.totals.receipts.cents,0); assert.equal(graph.totals.outgoing.available,false); assert.equal(layoutFlow(graph).links.length,0);
  const withReturn = new AccountStore('parties');
  ingest(withReturn,'receipts',[receipt({VR_RECEITA:'0,00'}),receipt({VR_RECEITA:'#NULO#'}),receipt({VR_RECEITA:'-10,00',DS_ORIGEM_RECEITA:'Devolução'})]);
  graph = buildFlow(createPartyOverview(withReturn));
  assert.equal(graph.hasNegative,true); assert.equal(graph.totals.receipts.cents,-1000); assert.equal(layoutFlow(graph).links.length,0);
  assert.equal(graph.columns[0].find((entry)=>entry.label==='Devolução').cents,-1000);
});

test('negativos em grupos pequenos não desaparecem ao juntar outras categorias', () => {
  const store = new AccountStore('parties');
  ingest(store,'receipts',Array.from({length:11},(_,index)=>receipt({VR_RECEITA:index===10?'-1,00':`${index+1},00`,DS_ORIGEM_RECEITA:`Origem ${index}`})));
  const graph = buildFlow(createPartyOverview(store));
  assert.equal(graph.hasNegative,true); assert.equal(layoutFlow(graph).links.length,0);
  assert.equal(graph.columns[0].find((entry)=>entry.children).children.some((entry)=>entry.cents<0),true);
});

test('publicação antiga identifica categorias ausentes sem trocar o total por zero', () => {
  const data=example(); for(const account of data.accounts)for(const statement of account.statements)delete statement.paidCategories;
  const graph=buildFlow(data);
  assert.equal(graph.categoriesUnavailable,true); assert.equal(graph.totals.outgoing.cents,5000);
  assert.equal(graph.columns[2][0].label,'Categorias indisponíveis nesta publicação');
  assert.equal(graph.columns[2][0].cents,5000);
  assert.throws(()=>buildFlow(data,{outgoing:'receipts'}),/inválida/);
  assert.throws(()=>layoutFlow(graph,0),/inválida/);
});
