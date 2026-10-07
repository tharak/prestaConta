import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { config } from '../site/config.js';
import { AccountStore, parseCsvStream, selectTables } from '../site/data.js';
import { ZipSource } from '../site/zip.js';
import { buildBenchmarks } from '../site/analytics.js';

export async function publishStore(store, destination) {
  await mkdir(destination, { recursive: true });
  const accounts = store.list();
  const index = { version: 1, year: store.year, scope: store.scope, updatedAt: store.loadedAt, source: store.source, tables: store.metadata(), options: store.options(), accounts: [] };
  if (store.scope === 'candidates') {
    index.benchmarks = 'benchmarks.json.gz';
    await writeFile(join(destination, index.benchmarks), gzipSync(JSON.stringify({ version: 1, year: store.year,
      updatedAt: store.loadedAt, cohorts: buildBenchmarks(store) })));
  }
  for (const info of accounts) {
    const filename = `${Buffer.from(info.id).toString('base64url')}.json.gz`;
    index.accounts.push({ ...info, filename });
    const account = store.accounts.get(info.id);
    const statements = info.statements.map((statement) => ({
      summary: store.summary(info.id, statement.id),
      records: Object.fromEntries(['receipts', 'contracted', 'paid'].map((kind) => [kind, account.statements.get(statement.id)[kind]])),
    }));
    await writeFile(join(destination, filename), gzipSync(JSON.stringify({ version: 1, accountId: info.id, updatedAt: store.loadedAt, statements }), { level: 6 }));
  }
  await writeFile(join(destination, 'index.json'), JSON.stringify(index));
  return index;
}
export async function refresh(destination = resolve('dist/data')) {
  const catalog = await fetch(`${config.api}?id=${config.dataset}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) });
  if (!catalog.ok) throw new Error(`Catálogo do TSE indisponível: HTTP ${catalog.status}.`);
  const payload = await catalog.json();
  if (!payload.success || !Array.isArray(payload.result?.resources)) throw new Error('Catálogo do TSE não reconhecido.');
  const manifest = { version: 1, year: config.year, updatedAt: new Date().toISOString(), scopes: {} };
  for (const scope of ['candidates', 'parties']) {
    const resource = payload.result.resources.find((item) => item.id === config.resourceIds[scope]);
    if (!resource?.url) throw new Error(`Recurso não encontrado: ${scope}.`);
    const source = new URL(resource.url);
    if (source.protocol !== 'https:' || source.hostname !== 'cdn.tse.jus.br' || !source.pathname.endsWith('.zip')) throw new Error('Arquivo fora da origem oficial do TSE.');
    console.log(`Consultando arquivo oficial: ${source.href}`);
    const zip = new ZipSource({ url: source.href, signal: AbortSignal.timeout(20 * 60_000) });
    const selected = selectTables(await zip.directory(), scope, config.year);
    // Uma publicação só acontece após a leitura e validação de ambas as bases.
    if (Object.keys(selected).length !== 3) throw new Error(`As três tabelas nacionais não estão disponíveis em ${scope}. A publicação anterior deve ser preservada.`);
    const store = new AccountStore(scope, config.year);
    store.source = source.href;
    for (const [kind, entry] of Object.entries(selected)) {
      console.log(`Processando ${entry.name}…`);
      await parseCsvStream(await zip.stream(entry), store.reader(kind, entry.name));
    }
    store.loadedAt = new Date().toISOString();
    const index = await publishStore(store, join(destination, scope));
    manifest.scopes[scope] = { updatedAt: index.updatedAt, source: index.source, accounts: index.accounts.length };
    console.log(`${index.accounts.length} contas publicadas, sem versionar dados eleitorais.`);
  }
  await writeFile(join(destination, 'manifest.json'), JSON.stringify(manifest));
  return manifest;
}
