import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore } from '../site/data.js';
import { PublishedStore } from '../site/published.js';
import { publishStore } from '../scripts/refresh-data.mjs';
import { csv, receipt, paid } from './fixtures.mjs';

test('publicação compactada preserva valores, prestação, fonte e linhas auditáveis', async () => {
  const destination = await mkdtemp(join(tmpdir(), 'prestaconta-publication-'));
  const originalFetch = globalThis.fetch;
  try {
    const store = new AccountStore('candidates');
    for (const [kind, records] of Object.entries({ receipts: [receipt(), receipt({ SQ_PRESTADOR_CONTAS: 'OUTRA-CONTA', VR_RECEITA: '0,00' })], paid: [paid()] })) {
      const parser = store.reader(kind, `${kind}.csv`); parser.push(csv(records)); parser.finish();
    }
    store.loadedAt = '2026-10-07T08:00:00.000Z'; store.source = 'https://cdn.tse.jus.br/estatistica/teste.zip';
    const index = await publishStore(store, destination);
    globalThis.fetch = async (url) => new Response(await readFile(join(destination, new URL(url).pathname.split('/').pop())));
    const published = new PublishedStore('candidates', 2026, index, new URL('https://teste.invalid/candidates/'));
    const account = published.list()[0];
    const summary = await published.summary(account.id, account.statements[0].id);
    assert.equal(summary.totals.receipts.cents, 123456);
    assert.equal(summary.totals.paid.cents, 10000);
    assert.equal(summary.publishedAt, store.loadedAt);
    assert.equal(summary.source, store.source);
    assert.equal(summary.sourceMode, 'published');
    const transactions = await published.transactions(account.id, account.statements[0].id, 'receipts');
    assert.equal(transactions.rows[0].row, 2);
    assert.equal(transactions.filename, 'receipts.csv');
    const benchmark = await published.benchmark(account.id, account.statements[0].id);
    assert.equal(benchmark.totals.receipts.meanCents, 61728);
    assert.equal(benchmark.totals.receipts.count, 2);
    const contributors = await published.counterparties(account.id, account.statements[0].id);
    assert.equal(contributors.rows[0].name, 'DOADOR SINTÉTICO');
    assert.equal(contributors.rows[0].cents, 123456);
  } finally { globalThis.fetch = originalFetch; await rm(destination, { recursive: true, force: true }); }
});
test('publicação atualizada durante a leitura não mistura versões', async () => {
  const store = new AccountStore('candidates'); const parser = store.reader('receipts', 'receitas.csv'); parser.push(csv([receipt()])); parser.finish();
  const account = store.list()[0];
  const index = { updatedAt: '2026-10-07T08:00:00Z', source: 'Fonte sintética', tables: store.metadata(), accounts: [{ ...account, filename: 'teste.json.gz' }] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ version: 1, accountId: account.id, updatedAt: '2026-10-07T09:00:00Z', statements: [] });
  try {
    const published = new PublishedStore('candidates', 2026, index, new URL('https://teste.invalid/'));
    await assert.rejects(published.summary(account.id, account.statements[0].id), /atualizada/);
    assert.equal(published.cache.size, 0);
  } finally { globalThis.fetch = originalFetch; }
});
test('arquivos publicados não podem redirecionar a leitura para outra origem', () => {
  assert.throws(() => new PublishedStore('candidates', 2026, { tables: {}, accounts: [{ id: 'teste', filename: '../outra.json.gz' }] }, new URL('https://teste.invalid/')), /inválido/);
});
test('médias de outra atualização são rejeitadas antes de comparar valores', async () => {
  const store = new AccountStore('candidates');
  const parser = store.reader('receipts', 'receitas.csv'); parser.push(csv([receipt()])); parser.finish();
  const account = store.list()[0];
  const index = { updatedAt: '2026-10-07T08:00:00Z', source: 'Fonte sintética', tables: store.metadata(),
    benchmarks: 'benchmarks.json.gz', accounts: [{ ...account, filename: 'teste.json.gz' }] };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ version: 1, year: 2026, updatedAt: '2026-10-07T09:00:00Z', cohorts: {} });
  try {
    const published = new PublishedStore('candidates', 2026, index, new URL('https://teste.invalid/'));
    await assert.rejects(published.benchmark(account.id, account.statements[0].id), /atualizadas/);
    assert.equal(published.benchmarkData, undefined);
  } finally { globalThis.fetch = originalFetch; }
});
