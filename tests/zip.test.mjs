import test from 'node:test';
import assert from 'node:assert/strict';
import { ZipSource, crc32 } from '../site/zip.js';
import { AccountStore, parseCsvStream, selectTables } from '../site/data.js';
import { candidateZip, makeZip } from './fixtures.mjs';

test('CRC32 corresponde ao vetor padrão e suporta atualização incremental', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
  assert.equal(crc32(Buffer.from('56789'), crc32(Buffer.from('1234'))), 0xcbf43926);
});
test('ZIP deflate e sem compressão passam pela leitura e integridade', async () => {
  for (const stored of [false, true]) {
    const zip = new ZipSource({ blob: new Blob([makeZip({ 'texto.csv': 'A;B\n1;2\n' }, { stored })]) });
    const entries = await zip.directory();
    assert.equal(await new Response(await zip.stream(entries[0])).text(), 'A;B\n1;2\n');
  }
});
test('arquivo nacional passa pela cadeia ZIP, CSV e associação de pagamentos', async () => {
  const zip = new ZipSource({ blob: new Blob([candidateZip()]) });
  const selected = selectTables(await zip.directory(), 'candidates');
  const store = new AccountStore('candidates');
  for (const [kind, entry] of Object.entries(selected)) await parseCsvStream(await zip.stream(entry), store.reader(kind, entry.name));
  assert.equal(store.accounts.size, 2);
  assert.equal(store.tables.receipts.rows, 5);
  const account = store.list().find((a) => a.name === 'CONTA SINTÉTICA DE TESTE');
  const partial = account.statements.find((s) => s.type === 'Parcial');
  const summary = store.summary(account.id, partial.id);
  assert.equal(summary.totals.receipts.cents, 180956);
  assert.equal(summary.totals.paid.cents, 15000);
  assert.equal(summary.totals.contracted.cents, 25000);
});
test('corrupção no CRC impede a aceitação dos dados', async () => {
  const buffer = makeZip({ 'texto.csv': 'A;B\n1;2\n' }, { stored: true });
  buffer[30 + 'texto.csv'.length] ^= 1;
  const zip = new ZipSource({ blob: new Blob([buffer]) });
  const entries = await zip.directory();
  await assert.rejects(new Response(await zip.stream(entries[0])).text(), /integridade/);
});
test('ZIP truncado e arquivos não ZIP são rejeitados', async () => {
  await assert.rejects(new ZipSource({ blob: new Blob(['Não é um ZIP']) }).directory(), /inválido/);
  const buffer = makeZip({ 'A': 'abc' });
  await assert.rejects(new ZipSource({ blob: new Blob([buffer.subarray(0, buffer.length - 1)]) }).directory(), /inválido/);
});
test('leitura HTTP Range não baixa o arquivo inteiro', async () => {
  const buffer = makeZip({ 'texto.csv': 'A;B\n1;2\n' });
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (_url, options) => {
    const requested = options.headers.Range;
    calls.push(requested);
    const match = requested.match(/^bytes=(\d*)-(\d*)$/);
    const start = match[1] ? Number(match[1]) : Math.max(0, buffer.length - Number(match[2]));
    const end = match[1] ? Number(match[2]) : buffer.length - 1;
    return new Response(buffer.subarray(start, end + 1), { status: 206, headers: { ETag: '"fixture"', 'Content-Range': `bytes ${start}-${end}/${buffer.length}` } });
  };
  try {
    const zip = new ZipSource({ url: 'https://fixture.invalid/archive' });
    const entries = await zip.directory();
    assert.equal(await new Response(await zip.stream(entries[0])).text(), 'A;B\n1;2\n');
    assert.equal(calls.length, 4);
    assert.equal(zip.blob, undefined);
  } finally { globalThis.fetch = originalFetch; }
});
test('servidor sem Range usa download completo uma única vez', async () => {
  const buffer = makeZip({ 'texto.csv': 'A;B\n1;2\n' });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(buffer, { headers: { 'Content-Length': buffer.length } }); };
  try {
    const zip = new ZipSource({ url: 'https://fixture.invalid/archive' });
    const entries = await zip.directory();
    assert.equal(await new Response(await zip.stream(entries[0])).text(), 'A;B\n1;2\n');
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
test('mudança de versão e download completo grande demais são rejeitados', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(new Uint8Array([1]), { status: 206, headers: { ETag: '"novo"' } });
  try {
    const zip = new ZipSource({ url: 'https://fixture.invalid/archive' }); zip.etag = '"anterior"';
    await assert.rejects(zip.bytes(0, 0), /mudou/);
    globalThis.fetch = async () => new Response('conteúdo', { headers: { 'Content-Length': String(301 * 1024 * 1024) } });
    await assert.rejects(new ZipSource({ url: 'https://fixture.invalid/archive' }).directory(), /grande demais/);
  } finally { globalThis.fetch = originalFetch; }
});
