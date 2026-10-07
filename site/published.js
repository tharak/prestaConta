import { AccountStore } from './data.js';
import { cohortKey, counterpartyGroups, sortedTransactions } from './analytics.js';

export async function json(url, signal) {
  let response;
  try { response = await fetch(url, { signal, cache: 'no-store', credentials: 'omit' }); }
  catch { throw new Error('Não foi possível carregar a publicação. Verifique sua conexão e tente novamente.'); }
  if (!response.ok) throw new Error(response.status === 404 ? 'A primeira publicação dos dados ainda não está disponível. Você pode abrir o ZIP oficial pela opção abaixo.' : `Publicação indisponível (HTTP ${response.status}). Tente novamente mais tarde.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export class PublishedStore extends AccountStore {
  constructor(scope, year, index, root) {
    super(scope, year);
    this.root = root;
    this.publishedAt = index.updatedAt;
    this.source = index.source;
    this.tables = Object.fromEntries(Object.entries(index.tables).map(([kind, table]) => [kind, { ...table, generations: new Set(table.generations) }]));
    this.loadedAt = new Date().toISOString();
    this.cache = new Map();
    this.files = new Map();
    this.benchmarkFile = index.benchmarks === 'benchmarks.json.gz' ? index.benchmarks : null;
    for (const account of index.accounts) {
      if (!/^[A-Za-z0-9_-]+\.json\.gz$/.test(account.filename)) throw new Error('Nome de arquivo inválido na publicação.');
      this.files.set(account.id, account.filename);
      this.accounts.set(account.id, { ...account, statements: new Map(account.statements.map((statement) => [statement.id, statement])) });
    }
  }
  async accountData(id) {
    if (!this.files.has(id)) throw new Error('Conta não encontrada na publicação.');
    if (this.cache.has(id)) return this.cache.get(id);
    const value = await json(new URL(this.files.get(id), this.root));
    if (value.accountId !== id || value.version !== 1 || value.updatedAt !== this.publishedAt) throw new Error('A publicação foi atualizada durante a consulta. Recarregue a base para ler uma versão completa.');
    this.cache.set(id, value);
    if (this.cache.size > 5) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
  async summary(id, statementId) {
    const account = await this.accountData(id);
    const statement = account.statements.find((s) => s.summary.statement.id === statementId);
    if (!statement) throw new Error('Prestação não encontrada na publicação.');
    return { ...statement.summary, loadedAt: this.loadedAt, publishedAt: this.publishedAt, sourceMode: 'published' };
  }
  async transactions(id, statementId, kind, page = 0, size = 20, order = 'original') {
    const account = await this.accountData(id);
    const statement = account.statements.find((s) => s.summary.statement.id === statementId);
    if (!statement || !Object.hasOwn(statement.records, kind)) throw new Error('Lançamentos não encontrados.');
    const records = sortedTransactions(statement.records[kind], order);
    return { rows: records.slice(page * size, (page + 1) * size), count: records.length, filename: this.tables[kind]?.filename || '' };
  }
  async benchmark(id, statementId) {
    if (!this.benchmarkFile || this.scope !== 'candidates') return null;
    const account = this.accounts.get(id);
    const statement = account?.statements.get(statementId);
    if (!statement) throw new Error('Prestação não encontrada.');
    const key = cohortKey(account, statement);
    const latest = this.statements(account).find((s) => cohortKey(account, s) === key && /^\d{2}\/\d{2}\/\d{4}$/.test(s.date));
    if (!key || latest?.id !== statementId) return null;
    if (!this.benchmarkData) {
      const value = await json(new URL(this.benchmarkFile, this.root));
      if (value.version !== 1 || value.year !== this.year || value.updatedAt !== this.publishedAt) throw new Error('As médias foram atualizadas durante a consulta. Recarregue a base.');
      this.benchmarkData = value;
    }
    return this.benchmarkData.cohorts[key] || null;
  }
  async counterparties(id, statementId, filters = {}, page = 0) {
    const account = await this.accountData(id);
    const statement = account.statements.find((s) => s.summary.statement.id === statementId);
    if (!statement) throw new Error('Prestação não encontrada.');
    return counterpartyGroups(statement.records.receipts, filters, page);
  }
}
export async function loadPublished(scope, year, signal) {
  const root = new URL('./data/', import.meta.url);
  const manifest = await json(new URL('manifest.json', root), signal);
  if (manifest.version !== 1 || manifest.year !== year || !manifest.scopes?.[scope]) throw new Error('Publicação de dados incompatível com a página. Recarregue o site.');
  const index = await json(new URL(`${scope}/index.json`, root), signal);
  if (index.version !== 1 || index.year !== year || index.scope !== scope) throw new Error('Índice da base não reconhecido.');
  return new PublishedStore(scope, year, index, new URL(`${scope}/`, root));
}
