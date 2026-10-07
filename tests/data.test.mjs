import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStore, CsvParser, moneyToCents, parseCsvStream, selectTables, csvCell } from '../site/data.js';
import { csv, receipt, contracted, paid } from './fixtures.mjs';

function ingest(store, kind, records) {
  const parser = store.reader(kind, `${kind}.csv`);
  parser.push(csv(records)); parser.finish();
}
test('dinheiro brasileiro é preservado em centavos, inclusive devoluções', () => {
  assert.equal(moneyToCents('1.234.567,89'), 123456789);
  assert.equal(moneyToCents('0,10'), 10);
  assert.equal(moneyToCents('0'), 0);
  assert.equal(moneyToCents('-25,50'), -2550);
  for (const empty of ['', '#NULO#', '#NE#', '-1', '-3', '-4']) assert.equal(moneyToCents(empty), null);
  for (const wrong of ['1,234.56', '12.34', '1,999', 'R$ 2,00', '900719925474099,91']) assert.throws(() => moneyToCents(wrong));
});
test('CSV preserva campos com aspas, ponto e vírgula e novas linhas entre chunks', () => {
  const rows = [];
  const parser = new CsvParser((row) => rows.push(row));
  const source = '\uFEFF"A";"B"\r\n"ação; teste";"uma ""citação""\nsegunda linha"\r\n';
  for (const char of source) parser.push(char);
  parser.finish();
  assert.deepEqual(rows, [['A', 'B'], ['ação; teste', 'uma "citação"\nsegunda linha']]);
});
test('CSV truncado e conteúdo após aspas são rejeitados', () => {
  const parser = new CsvParser(() => {}); parser.push('A;"campo'); assert.throws(() => parser.finish(), /incompleto/);
  assert.throws(() => new CsvParser(() => {}).push('"A"conteúdo;B'), /após/);
});
test('pagamentos sem nome são associados pelo prestador e não somados aos contratos', () => {
  const store = new AccountStore('candidates');
  ingest(store, 'paid', [paid(), paid({ SQ_PARCELAMENTO_DESPESA: '2', VR_PAGTO_DESPESA: '50,00' })]);
  ingest(store, 'contracted', [contracted()]);
  ingest(store, 'receipts', [receipt()]);
  const account = store.list()[0];
  assert.equal(account.name, 'CONTA SINTÉTICA DE TESTE');
  assert.equal(account.prestador, '90000000000000001');
  assert.equal(store.accounts.size, 1);
  const summary = store.summary(account.id, account.statements[0].id);
  assert.equal(summary.totals.receipts.cents, 123456);
  assert.equal(summary.totals.contracted.cents, 25000);
  assert.equal(summary.totals.paid.cents, 15000);
  assert.equal(summary.totals.paid.count, 2);
});
test('parcial, final, datas de retificação e turnos ficam em prestações separadas', () => {
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', [receipt(), receipt({ TP_PRESTACAO_CONTAS: 'Final', DT_PRESTACAO_CONTAS: '05/10/2026', VR_RECEITA: '2.000,00' }), receipt({ TP_PRESTACAO_CONTAS: 'Final', DT_PRESTACAO_CONTAS: '06/10/2026', VR_RECEITA: '2.100,00' }), receipt({ ST_TURNO: '2', VR_RECEITA: '300,00' })]);
  const account = store.list()[0];
  assert.equal(account.statements.length, 4);
  const final = account.statements.find((s) => s.date === '05/10/2026');
  assert.equal(store.summary(account.id, final.id).totals.receipts.cents, 200000);
});
test('valores ausentes, tabela ausente e zero declarado são situações diferentes', () => {
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', [receipt({ VR_RECEITA: '#NULO#' }), receipt({ VR_RECEITA: '0,00' })]);
  const account = store.list()[0];
  const summary = store.summary(account.id, account.statements[0].id);
  assert.equal(summary.totals.receipts.cents, null);
  assert.equal(summary.totals.receipts.missing, 1);
  assert.equal(summary.totals.contracted.available, false);
  assert.equal(summary.totals.paid.count, 0);
  assert.equal(summary.sources[0].missing, 1);
});
test('fonte, origem e natureza mantêm categorias oficiais desconhecidas', () => {
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', [receipt({ DS_FONTE_RECEITA: 'Categoria desconhecida', DS_ORIGEM_RECEITA: 'Recursos de partido político', DS_NATUREZA_RECEITA: 'Estimável' })]);
  const account = store.list()[0]; const summary = store.summary(account.id, account.statements[0].id);
  assert.equal(summary.sources[0].name, 'Categoria desconhecida');
  assert.equal(summary.origins[0].name, 'Recursos de partido político');
  assert.equal(summary.natures[0].name, 'Estimável');
});
test('seleção nacional não soma CSV estaduais ou doadores originários', () => {
  const entries = ['receitas_candidatos_2026_SP.csv', 'pasta/receitas_candidatos_2026_BRASIL.csv', 'receitas_candidatos_doador_originario_2026_BRASIL.csv', 'despesas_pagas_candidatos_2026_BRASIL.csv'].map((name) => ({ name }));
  const selected = selectTables(entries, 'candidates');
  assert.equal(Object.keys(selected).length, 2);
  assert.equal(selected.receipts.name, entries[1].name);
  assert.throws(() => selectTables(entries, 'parties'), /não contém/);
  assert.throws(() => selectTables([...entries, entries[1]], 'candidates'), /mais de uma cópia/);
});
test('esquema e ano inesperados interrompem a importação', () => {
  assert.throws(() => ingest(new AccountStore('candidates'), 'receipts', [receipt({ AA_ELEICAO: '2022' })]), /outro ano/);
  assert.throws(() => ingest(new AccountStore('candidates'), 'receipts', [receipt({ SQ_PRESTADOR_CONTAS: '' })]), /sem identificador/);
  const store = new AccountStore('candidates'); const parser = store.reader('receipts', 'arquivo.csv');
  assert.throws(() => parser.push('A;B\n'), /obrigatória ausente/);
});
test('órgãos mantêm contas distintas por prestador, sem agregar diretórios', () => {
  const store = new AccountStore('parties');
  ingest(store, 'receipts', [receipt({ DS_ESFERA_PARTIDARIA: 'Estadual' }), receipt({ SQ_PRESTADOR_CONTAS: 'OUTRO', DS_ESFERA_PARTIDARIA: 'Municipal' })]);
  assert.equal(store.list().length, 2);
  assert.deepEqual(store.options().office, ['Estadual', 'Municipal']);
  assert.equal(store.list({ office: 'Municipal' }).length, 1);
});
test('busca não diferencia acentos e paginação preserva a ordem do arquivo', () => {
  const store = new AccountStore('candidates');
  ingest(store, 'receipts', [receipt(), receipt({ VR_RECEITA: '5,00' }), receipt({ VR_RECEITA: '3,00' })]);
  const accounts = store.list({ query: 'sintetica' }); assert.equal(accounts.length, 1);
  const transactions = store.transactions(accounts[0].id, accounts[0].statements[0].id, 'receipts', 1, 1);
  assert.equal(transactions.rows[0].cents, 500);
  assert.equal(transactions.rows[0].row, 3);
});
test('decodificação Windows-1252 e UTF-8 BOM funciona com chunks de um byte', async () => {
  for (const [encoding, bom] of [['latin1', ''], ['utf8', '\uFEFF']]) {
    const data = Buffer.from(bom + csv([receipt()]), encoding);
    const store = new AccountStore('candidates');
    await parseCsvStream(new ReadableStream({ start(controller) { for (const byte of data) controller.enqueue(new Uint8Array([byte])); controller.close(); } }), store.reader('receipts', 'receitas.csv'));
    assert.equal(store.list()[0].name, 'CONTA SINTÉTICA DE TESTE');
  }
});
test('CSV exportado escapa fórmulas e aspas', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell('Teste "A"'), '"Teste ""A"""');
  assert.equal(csvCell('Texto comum'), '"Texto comum"');
});
