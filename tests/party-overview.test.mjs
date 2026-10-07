import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore } from '../site/data.js';
import { createPartyOverview, aggregateParties, chartValue } from '../site/party-overview.js';
import { csv, receipt, contracted, paid } from './fixtures.mjs';
function ingest(store, kind, rows) { const parser = store.reader(kind, `${kind}.csv`); parser.push(csv(rows)); parser.finish(); }

test('variações de caixa do tipo unem receitas, contratos e pagamentos da mesma prestação', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [receipt({ TP_PRESTACAO_CONTAS: 'Parcial' })]);
  ingest(store, 'contracted', [contracted({ TP_PRESTACAO_CONTAS: 'PARCIAL' })]);
  ingest(store, 'paid', [paid({ TP_PRESTACAO_CONTAS: 'parcial' })]);
  const account = store.list()[0];
  assert.equal(account.statements.length, 1);
  const summary = store.summary(account.id, account.statements[0].id);
  assert.equal(summary.totals.receipts.cents, 123456);
  assert.equal(summary.totals.contracted.cents, 25000);
  assert.equal(summary.totals.paid.cents, 10000);
});
test('visão geral agrega órgãos por partido com apenas a última prestação de cada conta', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [
    receipt({ VR_RECEITA: '100,00', DS_ESFERA_PARTIDARIA: 'Nacional' }),
    receipt({ VR_RECEITA: '200,00', DT_PRESTACAO_CONTAS: '20/09/2026', DS_ESFERA_PARTIDARIA: 'Nacional' }),
    receipt({ VR_RECEITA: '300,00', DT_PRESTACAO_CONTAS: '05/10/2026', TP_PRESTACAO_CONTAS: 'Final', DS_ESFERA_PARTIDARIA: 'Nacional' }),
    receipt({ SQ_PRESTADOR_CONTAS: 'OUTRO-ORGAO', VR_RECEITA: '50,00', DS_ESFERA_PARTIDARIA: 'Municipal', SG_UF: 'RJ', DS_ORIGEM_RECEITA: 'Recursos de partido político' }),
    receipt({ SQ_PRESTADOR_CONTAS: 'OUTRO-PARTIDO', SG_PARTIDO: 'SIGLA B', VR_RECEITA: '20,00', DS_ESFERA_PARTIDARIA: 'Municipal' }),
  ]);
  const data = createPartyOverview(store); const result = aggregateParties(data);
  assert.equal(result.accounts, 3); assert.equal(result.parties.length, 2);
  assert.equal(result.totals.receipts.knownCents, 37000);
  const party = result.parties.find((p) => p.party === 'TESTE');
  assert.equal(party.accounts, 2); assert.equal(party.totals.receipts.knownCents, 35000);
  assert.equal(party.origins.find((g) => g.name === 'Recursos de partido político').cents, 5000);
  assert.equal(aggregateParties(data, { sphere: 'Nacional' }).totals.receipts.knownCents, 30000);
  assert.equal(aggregateParties(data, { uf: 'RJ' }).totals.receipts.knownCents, 5000);
  assert.equal(aggregateParties(data, { type: 'Parcial', sphere: 'Nacional' }).totals.receipts.knownCents, 20000);
  assert.equal(aggregateParties(data, { type: 'Final' }).accounts, 1);
});
test('empate de data prioriza final sem adicionar relatório financeiro ou parcial', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [receipt({ TP_PRESTACAO_CONTAS: 'RELATÓRIO FINANCEIRO', VR_RECEITA: '100,00' }), receipt({ VR_RECEITA: '200,00' }), receipt({ TP_PRESTACAO_CONTAS: 'FINAL', VR_RECEITA: '300,00' })]);
  const data = createPartyOverview(store);
  assert.equal(aggregateParties(data).totals.receipts.knownCents, 30000);
  assert.equal(aggregateParties(data, { type: 'Relatório Financeiro' }).totals.receipts.knownCents, 10000);
});
test('totais brutos preservam repasses declarados sem inferir recursos novos ou saldo', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [receipt({ VR_RECEITA: '100,00', DS_ORIGEM_RECEITA: 'Fundo Partidário' }), receipt({ SQ_PRESTADOR_CONTAS: 'RECEBEDOR', VR_RECEITA: '60,00', DS_ORIGEM_RECEITA: 'Recursos de partido político' })]);
  ingest(store, 'contracted', [contracted({ VR_DESPESA_CONTRATADA: '60,00' })]);
  ingest(store, 'paid', [paid({ VR_PAGTO_DESPESA: '60,00' })]);
  const result = aggregateParties(createPartyOverview(store));
  assert.equal(result.totals.receipts.knownCents, 16000);
  assert.equal(result.totals.contracted.knownCents, 6000);
  assert.equal(result.totals.paid.knownCents, 6000);
  assert.equal(Object.hasOwn(result, 'balance'), false);
});
test('ausência de tabela, valores incompletos, devoluções e categoria ausente permanecem distintos', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [receipt({ VR_RECEITA: '-10,00', DS_FONTE_RECEITA: '#NULO' }), receipt({ VR_RECEITA: '#NULO#', DS_ORIGEM_RECEITA: 'Outra origem' })]);
  const data = createPartyOverview(store); const party = aggregateParties(data).parties[0];
  assert.deepEqual(chartValue(party, { kind: 'receipts' }), { cents: -1000, missing: 1, empty: false });
  assert.deepEqual(chartValue(party, { kind: 'paid' }), { cents: null, missing: 0, empty: true });
  assert.equal(chartValue(party, { field: 'origins', name: 'Não presente' }).cents, null);
  assert.equal(party.sources.find((g) => g.name === 'Não informado').cents, -1000);
  const complete = new AccountStore('parties'); ingest(complete, 'receipts', [receipt({ VR_RECEITA: '0,00' })]);
  const completeParty = aggregateParties(createPartyOverview(complete)).parties[0];
  assert.equal(chartValue(completeParty, { field: 'origins', name: 'Não presente' }).cents, 0);
});
test('recorte vazio não é preenchido com valores inventados e candidaturas ficam fora', () => {
  const store = new AccountStore('parties'); ingest(store, 'receipts', [receipt()]);
  const result = aggregateParties(createPartyOverview(store), { uf: 'INEXISTENTE' });
  assert.equal(result.parties.length, 0); assert.equal(result.totals.receipts.count, 0);
  assert.throws(() => createPartyOverview(new AccountStore('candidates')), /órgãos partidários/);
});

test('totais por origem e fonte respeitam o recorte e não somam prestações anteriores', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [
    receipt({ VR_RECEITA: '999,00', DT_PRESTACAO_CONTAS: '01/09/2026', DS_ORIGEM_RECEITA: 'Origem anterior' }),
    receipt({ VR_RECEITA: '100,00', DS_ORIGEM_RECEITA: 'Doações', DS_FONTE_RECEITA: 'Outros Recursos' }),
    receipt({ SQ_PRESTADOR_CONTAS: 'OUTRO-PARTIDO', SG_PARTIDO: 'SIGLA B', SG_UF: 'RJ', VR_RECEITA: '200,00', DS_ORIGEM_RECEITA: 'Doações', DS_FONTE_RECEITA: 'Outros Recursos' }),
    receipt({ SQ_PRESTADOR_CONTAS: 'OUTRO-PARTIDO', SG_PARTIDO: 'SIGLA B', SG_UF: 'RJ', VR_RECEITA: '-10,00', DS_ORIGEM_RECEITA: 'Repasses', DS_FONTE_RECEITA: 'Fundo Partidário' }),
    receipt({ SQ_PRESTADOR_CONTAS: 'OUTRO-PARTIDO', SG_PARTIDO: 'SIGLA B', SG_UF: 'RJ', VR_RECEITA: '#NULO#', DS_ORIGEM_RECEITA: 'Repasses', DS_FONTE_RECEITA: 'Fundo Partidário' }),
  ]);
  const data = createPartyOverview(store);
  const all = aggregateParties(data);
  assert.deepEqual(all.origins, [
    { name: 'Doações', cents: 30000, count: 2, missing: 0 },
    { name: 'Repasses', cents: -1000, count: 2, missing: 1 },
  ]);
  assert.equal(all.sources.find((group) => group.name === 'Outros Recursos').cents, 30000);
  assert.equal(all.sources.find((group) => group.name === 'Fundo Partidário').missing, 1);
  assert.equal(all.origins.reduce((sum, group) => sum + group.cents, 0), all.totals.receipts.knownCents);
  const filtered = aggregateParties(data, { uf: 'RJ' });
  assert.equal(filtered.origins.find((group) => group.name === 'Doações').cents, 20000);
  assert.equal(filtered.sources.find((group) => group.name === 'Outros Recursos').cents, 20000);
  const empty = aggregateParties(data, { uf: 'INEXISTENTE' });
  assert.deepEqual(empty.origins, []);
  assert.deepEqual(empty.sources, []);
});

test('valor mínimo considera o total do partido no recorte e recalcula a cobertura e as receitas', () => {
  const store = new AccountStore('parties');
  const second = { SQ_PRESTADOR_CONTAS: 'OUTRO-PARTIDO', SG_PARTIDO: 'SIGLA B', TP_PRESTACAO_CONTAS: 'Final', DT_PRESTACAO_CONTAS: '05/10/2026' };
  ingest(store, 'receipts', [
    receipt({ VR_RECEITA: '500,00', DT_PRESTACAO_CONTAS: '01/09/2026' }),
    receipt({ VR_RECEITA: '40,00' }),
    receipt({ SQ_PRESTADOR_CONTAS: 'DIRETORIO-RJ', SG_UF: 'RJ', VR_RECEITA: '30,00', DS_ORIGEM_RECEITA: 'Repasses' }),
    receipt({ ...second, VR_RECEITA: '60,00' }),
  ]);
  ingest(store, 'contracted', [contracted(), contracted({ ...second, VR_DESPESA_CONTRATADA: '500,00' })]);
  ingest(store, 'paid', [paid(), paid({ ...second, VR_PAGTO_DESPESA: '400,00' })]);
  const data = createPartyOverview(store);
  const filtered = aggregateParties(data, { minimumCents: 7000 });
  assert.deepEqual(filtered.parties.map((party) => party.party), ['TESTE']);
  assert.equal(filtered.accounts, 2);
  assert.equal(filtered.totals.receipts.knownCents, 7000);
  assert.equal(filtered.totals.contracted.knownCents, 25000);
  assert.equal(filtered.totals.paid.knownCents, 10000);
  assert.equal(filtered.origins.find((group) => group.name === 'Repasses').cents, 3000);
  assert.equal(filtered.sources[0].cents, 7000);
  assert.deepEqual(filtered.types, { Parcial: 2 });
  assert.equal(filtered.firstDate, '12/09/2026');
  assert.equal(filtered.lastDate, '12/09/2026');
  assert.equal(aggregateParties(data, { uf: 'SP', minimumCents: 7000 }).parties.length, 0);
  assert.deepEqual(aggregateParties(data, { minimumCents: 30000, minimumKind: 'contracted' }).parties.map((party) => party.party), ['SIGLA B']);
  assert.equal(aggregateParties(data, { minimumCents: 30000, minimumKind: 'paid' }).totals.receipts.knownCents, 6000);
});

test('valor mínimo preserva somas parciais e não trata tabela ausente como zero', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [receipt({ VR_RECEITA: '20,00' }), receipt({ VR_RECEITA: '#NULO#' }), receipt({ SQ_PRESTADOR_CONTAS: 'SEM-VALOR', SG_PARTIDO: 'SIGLA B', VR_RECEITA: '#NULO#' })]);
  const data = createPartyOverview(store);
  const partial = aggregateParties(data, { minimumCents: 2000 });
  assert.equal(partial.parties.length, 1);
  assert.equal(partial.totals.receipts.missing, 1);
  assert.equal(partial.totals.receipts.knownCents, 2000);
  assert.equal(aggregateParties(data, { minimumCents: 2001 }).accounts, 0);
  assert.equal(aggregateParties(data, { minimumCents: 1, minimumKind: 'paid' }).accounts, 0);
  assert.deepEqual(aggregateParties(data, { minimumCents: 0 }), aggregateParties(data));
  for (const filters of [{ minimumCents: -1 }, { minimumCents: 1.5 }, { minimumCents: Number.MAX_SAFE_INTEGER + 1 }, { minimumKind: 'outra' }]) assert.throws(() => aggregateParties(data, filters), /mínimo inválido/);
});
