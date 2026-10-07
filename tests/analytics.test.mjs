import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore } from '../site/data.js';
import { buildBenchmarks, counterpartyGroups, sortedTransactions } from '../site/analytics.js';
import { csv, receipt, contracted } from './fixtures.mjs';

function ingest(store, kind, rows) {
  const parser = store.reader(kind, `${kind}.csv`); parser.push(csv(rows)); parser.finish();
}
test('médias usam uma prestação por conta e categoria sem repasse entra como zero', () => {
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', [
    receipt({ VR_RECEITA: '100,00', DS_ORIGEM_RECEITA: 'Recursos próprios' }),
    receipt({ VR_RECEITA: '300,00', DT_PRESTACAO_CONTAS: '20/09/2026', DS_ORIGEM_RECEITA: 'Recursos próprios' }),
    receipt({ VR_RECEITA: '100,00', SQ_PRESTADOR_CONTAS: 'CONTA-2', DS_ORIGEM_RECEITA: 'Recursos de partido político', SG_PARTIDO: 'OUTRA' }),
    receipt({ VR_RECEITA: '900,00', SQ_PRESTADOR_CONTAS: 'OUTRO-ESTADO', SG_UF: 'RJ' }),
    receipt({ VR_RECEITA: '900,00', SQ_PRESTADOR_CONTAS: 'OUTRO-CARGO', DS_CARGO: 'Outro cargo' }),
    receipt({ VR_RECEITA: '900,00', SQ_PRESTADOR_CONTAS: 'OUTRO-TURNO', ST_TURNO: '2' }),
    receipt({ VR_RECEITA: '900,00', SQ_PRESTADOR_CONTAS: 'OUTRO-TIPO', TP_PRESTACAO_CONTAS: 'Final' }),
    receipt({ VR_RECEITA: '900,00', SQ_PRESTADOR_CONTAS: 'OUTRA-ELEICAO', CD_ELEICAO: 'OUTRA' }),
  ]);
  const account = store.list().find((a) => a.prestador === '90000000000000001');
  const group = store.benchmark(account.id, account.statements[0].id);
  assert.equal(group.accounts, 2);
  assert.equal(group.totals.receipts.count, 2);
  assert.equal(group.totals.receipts.meanCents, 20000);
  assert.equal(group.categories.origins.find((g) => g.name === 'Recursos próprios').meanCents, 15000);
  assert.equal(group.categories.origins.find((g) => g.name === 'Recursos de partido político').meanCents, 5000);
  assert.equal(store.benchmark(account.id, account.statements[1].id), null);
});
test('tabela sem lançamentos e valor ausente são excluídos, zero explícito é incluído', () => {
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', [receipt({ VR_RECEITA: '100,00' }), receipt({ SQ_PRESTADOR_CONTAS: 'ZERO', VR_RECEITA: '0,00' }),
    receipt({ SQ_PRESTADOR_CONTAS: 'AUSENTE', VR_RECEITA: '#NULO#' }), receipt({ SQ_PRESTADOR_CONTAS: 'RETIFICADA', VR_RECEITA: '100,00' }),
    receipt({ SQ_PRESTADOR_CONTAS: 'RETIFICADA', DT_PRESTACAO_CONTAS: '20/09/2026', VR_RECEITA: '#NULO#' })]);
  ingest(store, 'contracted', [contracted({ SQ_PRESTADOR_CONTAS: 'SEM-RECEITAS', VR_DESPESA_CONTRATADA: '200,00' })]);
  const account = store.list().find((a) => a.prestador === '90000000000000001');
  const group = store.benchmark(account.id, account.statements[0].id);
  assert.equal(group.accounts, 5);
  assert.deepEqual(group.totals.receipts, { sumCents: 10000, count: 2, excluded: 3, meanCents: 5000 });
  assert.equal(group.totals.contracted.count, 1);
  assert.equal(group.totals.paid.count, 0);
  assert.equal(group.categories.origins[0].count, 2);
});
test('metadados insuficientes e órgãos partidários não ganham um grupo de candidaturas', () => {
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', [receipt({ ST_TURNO: '' })]);
  assert.deepEqual(buildBenchmarks(store), {});
  const parties = new AccountStore('parties'); ingest(parties, 'receipts', [receipt()]);
  assert.deepEqual(buildBenchmarks(parties), {});
});
test('agrupamento de remetentes mantém fonte, origem, natureza e incompletude sem misturar fornecedores', () => {
  const records = [
    { counterparty: 'Pessoa sintética', cents: 100, origin: 'Pessoas físicas', source: 'Outros', nature: 'Financeiro' },
    { counterparty: 'Pessoa sintética', cents: null, origin: 'Pessoas físicas', source: 'Outros', nature: 'Financeiro' },
    { counterparty: 'Pessoa sintética', cents: 200, origin: 'Partido político', source: 'Fundo', nature: 'Financeiro' },
  ];
  const groups = counterpartyGroups(records, { query: 'sintetica', origin: 'Pessoas físicas' });
  assert.equal(groups.count, 1); assert.equal(groups.rows[0].count, 2);
  assert.equal(groups.rows[0].missing, 1); assert.equal(groups.rows[0].cents, 100);
  assert.equal(counterpartyGroups(records).count, 2);
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', [receipt()]); ingest(store, 'contracted', [contracted()]);
  const account = store.list()[0];
  assert.equal(store.counterparties(account.id, account.statements[0].id).rows[0].name, 'DOADOR SINTÉTICO');
});
test('ordenação cobre a lista inteira antes da paginação, com valores ausentes no final', () => {
  const rows = [
    { row: 2, cents: 100, date: '01/09/2026', counterparty: 'B' },
    { row: 3, cents: null, date: '', counterparty: 'C' },
    { row: 4, cents: 300, date: '02/08/2026', counterparty: 'A' },
    { row: 5, cents: -100, date: '05/10/2026', counterparty: 'D' },
  ];
  assert.deepEqual(sortedTransactions(rows, 'amount-desc').map((r) => r.row), [4, 2, 5, 3]);
  assert.deepEqual(sortedTransactions(rows, 'amount-asc').map((r) => r.row), [5, 2, 4, 3]);
  assert.deepEqual(sortedTransactions(rows, 'date-desc').map((r) => r.row), [5, 2, 4, 3]);
  assert.deepEqual(sortedTransactions(rows, 'date-asc').map((r) => r.row), [4, 2, 5, 3]);
  assert.deepEqual(sortedTransactions(rows, 'name').map((r) => r.row), [4, 2, 3, 5]);
  assert.equal(sortedTransactions(rows), rows);
  assert.throws(() => sortedTransactions(rows, 'invalid'), /desconhecida/);
  const store = new AccountStore('candidates'); ingest(store, 'receipts', [receipt({ VR_RECEITA: '1,00' }), receipt({ VR_RECEITA: '9,00' })]);
  const account = store.list()[0];
  assert.equal(store.transactions(account.id, account.statements[0].id, 'receipts', 0, 1, 'amount-desc').rows[0].cents, 900);
});
