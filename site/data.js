import { buildBenchmarks, cohortKey, counterpartyGroups, sortedTransactions } from './analytics.js';

export const TABLES = Object.freeze({
  receipts: { label: 'Receitas', prefix: 'receitas', amounts: ['VR_RECEITA'], dates: ['DT_RECEITA'] },
  contracted: { label: 'Despesas contratadas', prefix: 'despesas_contratadas', amounts: ['VR_DESPESA_CONTRATADA'], dates: ['DT_DESPESA', 'DT_CONTRATACAO'] },
  paid: { label: 'Despesas pagas', prefix: 'despesas_pagas', amounts: ['VR_PAGTO_DESPESA', 'VR_DESPESA_PAGA'], dates: ['DT_PAGTO_DESPESA', 'DT_PAGAMENTO'] },
});

const EMPTY = new Set(['', '#NULO#', '#NULO', '#NE#', '#NE', 'NULO', 'NULL', '-1', '-3', '-4']);
export function clean(value) {
  const text = String(value ?? '').trim();
  return EMPTY.has(text.toUpperCase()) ? '' : text;
}
export function fold(value) {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');
}
export const alphabetic = (a, b) => String(a).localeCompare(String(b), 'pt-BR', { sensitivity: 'base', numeric: true });
export function statementType(value) {
  const text = clean(value);
  return ({ parcial: 'Parcial', final: 'Final', 'relatorio financeiro': 'Relatório Financeiro' })[fold(text)] || text || 'Tipo não informado';
}

// Valores monetários são inteiros em centavos, nunca ponto flutuante acumulado.
export function moneyToCents(value) {
  const text = clean(value);
  if (!text) return null;
  if (!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(text)) {
    throw new Error(`Valor monetário fora do formato brasileiro: ${text.slice(0, 60)}.`);
  }
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = text.replace(/^-/, '').replaceAll('.', '').split(',');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents)) throw new Error('Valor monetário excede o limite de precisão.');
  return negative ? -cents : cents;
}

// Parser incremental: aspas escapadas e quebras de linha dentro de campos sobrevivem aos chunks.
export class CsvParser {
  constructor(onRow) {
    this.onRow = onRow;
    this.row = [];
    this.field = '';
    this.quoted = false;
    this.afterQuote = false;
    this.skipLF = false;
    this.rows = 0;
    this.firstCharacter = true;
  }
  finishField() { this.row.push(this.field); this.field = ''; this.afterQuote = false; }
  finishRow() {
    this.finishField();
    if (this.row.length !== 1 || this.row[0].trim()) this.onRow(this.row, ++this.rows);
    this.row = [];
  }
  push(text) {
    for (const char of text) {
      if (this.firstCharacter) { this.firstCharacter = false; if (char === '\uFEFF') continue; }
      if (this.skipLF) { this.skipLF = false; if (char === '\n') continue; }
      if (this.quoted) {
        if (char === '"') { this.quoted = false; this.afterQuote = true; }
        else this.field += char;
      } else if (this.afterQuote && char === '"') {
        this.field += '"'; this.quoted = true; this.afterQuote = false;
      } else if (char === ';') this.finishField();
      else if (char === '\r' || char === '\n') {
        this.finishRow(); this.skipLF = char === '\r';
      } else if (char === '"' && !this.field) this.quoted = true;
      else if (this.afterQuote && !/\s/.test(char)) throw new Error('CSV inválido: conteúdo após fechamento de aspas.');
      else if (!this.afterQuote) this.field += char;
      if (this.field.length > 2_000_000) throw new Error('Campo do CSV excede o tamanho suportado.');
    }
  }
  finish() {
    if (this.quoted) throw new Error('CSV incompleto: campo entre aspas não foi fechado.');
    if (this.row.length || this.field || this.afterQuote) this.finishRow();
  }
}

function addCents(a, b) {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new Error('Soma monetária excede o limite de precisão.');
  return value;
}
function dateKey(value) {
  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return match ? `${match[3]}${match[2]}${match[1]}` : '';
}
function groupRows(records, field) {
  const groups = new Map();
  for (const row of records) {
    const name = row[field] || 'Não informado';
    const group = groups.get(name) || { name, cents: 0, missing: 0, count: 0 };
    group.count++;
    if (row.cents === null) group.missing++;
    else group.cents = addCents(group.cents, row.cents);
    groups.set(name, group);
  }
  return [...groups.values()].sort((a, b) => alphabetic(a.name, b.name));
}

export class AccountStore {
  constructor(scope, year = 2026) {
    this.scope = scope;
    this.year = year;
    this.accounts = new Map();
    this.tables = {};
    this.loadedAt = '';
    this.source = '';
  }
  reader(kind, filename) {
    delete this.benchmarks;
    const definition = TABLES[kind];
    if (!definition) throw new Error('Tabela não reconhecida.');
    if (this.tables[kind]) throw new Error(`Tabela repetida: ${definition.label}.`);
    const meta = { filename, rows: 0, generations: new Set(), unknownAmounts: 0 };
    this.tables[kind] = meta;
    let columns;
    let amountColumn;
    let headers;
    return new CsvParser((values, rowNumber) => {
      if (!columns) {
        headers = values.map((v) => v.replace(/^\uFEFF/, '').trim().toUpperCase());
        if (new Set(headers).size !== headers.length) throw new Error(`${filename}: cabeçalhos repetidos.`);
        columns = new Map(headers.map((h, i) => [h, i]));
        for (const required of ['SQ_PRESTADOR_CONTAS', 'TP_PRESTACAO_CONTAS']) {
          if (!columns.has(required)) throw new Error(`${filename}: coluna obrigatória ausente (${required}). A estrutura do TSE pode ter mudado.`);
        }
        if (!columns.has('AA_ELEICAO') && !columns.has('ANO_ELEICAO')) throw new Error(`${filename}: coluna de ano ausente (AA_ELEICAO ou ANO_ELEICAO).`);
        amountColumn = definition.amounts.find((name) => columns.has(name));
        if (!amountColumn) throw new Error(`${filename}: coluna monetária não reconhecida (${definition.amounts.join(' ou ')}).`);
        return;
      }
      if (values.length !== headers.length) throw new Error(`${filename}, registro ${rowNumber}: número de campos inconsistente.`);
      const get = (...names) => {
        for (const name of names) {
          if (columns.has(name)) {
            const value = clean(values[columns.get(name)]);
            if (value) return value;
          }
        }
        return '';
      };
      if (get('AA_ELEICAO', 'ANO_ELEICAO') !== String(this.year)) throw new Error(`${filename}: arquivo de outro ano. Selecione a base de ${this.year}.`);
      const prestador = get('SQ_PRESTADOR_CONTAS');
      if (!prestador) throw new Error(`${filename}, registro ${rowNumber}: conta sem identificador.`);
      const election = get('CD_ELEICAO') || 'não informado';
      const id = `${election}:${prestador}`;
      let account = this.accounts.get(id);
      if (!account) {
        account = { id, prestador, candidateId: '', name: '', party: '', partyName: '', uf: '', office: '', number: '', sphere: '', locality: '', statements: new Map() };
        this.accounts.set(id, account);
      }
      const fields = {
        name: this.scope === 'candidates' ? get('NM_URNA_CANDIDATO', 'NM_CANDIDATO') : get('NM_PARTIDO'),
        candidateId: get('SQ_CANDIDATO'), party: get('SG_PARTIDO'), partyName: get('NM_PARTIDO'), uf: get('SG_UF'),
        office: get('DS_CARGO'), number: get('NR_CANDIDATO'),
        sphere: get('DS_ESFERA_PARTIDARIA', 'DS_ESFERA_PART_PRESTADOR', 'DS_ESFERA_PART'), locality: get('NM_UE'),
      };
      for (const [key, value] of Object.entries(fields)) if (value && !account[key]) account[key] = value;
      const type = statementType(get('TP_PRESTACAO_CONTAS'));
      const date = get('DT_PRESTACAO_CONTAS');
      const turn = get('ST_TURNO', 'NR_TURNO');
      const statementId = JSON.stringify([type, date, turn]);
      let statement = account.statements.get(statementId);
      if (!statement) {
        statement = { id: statementId, type, date, turn, receipts: [], contracted: [], paid: [] };
        account.statements.set(statementId, statement);
      }
      let cents;
      try { cents = moneyToCents(values[columns.get(amountColumn)]); }
      catch (error) { throw new Error(`${filename}, registro ${rowNumber}: ${error.message}`); }
      if (cents === null) meta.unknownAmounts++;
      const counterparty = kind === 'receipts' ? get('NM_DOADOR', 'NM_DOADOR_RFB') : get('NM_FORNECEDOR', 'NM_FORNECEDOR_RFB');
      statement[kind].push({
        date: get(...definition.dates), cents, counterparty,
        description: get(kind === 'receipts' ? 'DS_RECEITA' : 'DS_DESPESA', kind === 'receipts' ? 'DS_ORIGEM_RECEITA' : 'DS_ORIGEM_DESPESA'),
        source: get(kind === 'receipts' ? 'DS_FONTE_RECEITA' : 'DS_FONTE_DESPESA'),
        origin: get(kind === 'receipts' ? 'DS_ORIGEM_RECEITA' : 'DS_ORIGEM_DESPESA'),
        nature: get(kind === 'receipts' ? 'DS_NATUREZA_RECEITA' : 'DS_NATUREZA_DESPESA'),
        row: rowNumber,
      });
      meta.rows++;
      const generated = [get('DT_GERACAO'), get('HH_GERACAO')].filter(Boolean).join(' ');
      if (generated) meta.generations.add(generated);
    });
  }
  list(filters = {}) {
    const query = fold(filters.query || '');
    return [...this.accounts.values()].filter((a) =>
      (!filters.uf || a.uf === filters.uf) && (!filters.party || a.party === filters.party) &&
      (!filters.office || (this.scope === 'candidates' ? a.office : a.sphere) === filters.office) &&
      (!query || fold(`${a.name} ${a.partyName} ${a.party} ${a.number} ${a.prestador} ${a.locality}`).includes(query))
    ).map((a) => this.accountInfo(a)).sort((a, b) => alphabetic(a.name, b.name) || alphabetic(a.uf, b.uf) || alphabetic(a.locality, b.locality) || alphabetic(a.id, b.id));
  }
  accountInfo(account) {
    return { ...account, name: account.name || `Prestador ${account.prestador}`, statements: this.statements(account) };
  }
  statements(account) {
    return [...account.statements.values()].map(({ id, type, date, turn }) => ({ id, type, date, turn }))
      .sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)) || alphabetic(a.type, b.type));
  }
  options() {
    const list = [...this.accounts.values()];
    const unique = (field) => [...new Set(list.map((a) => a[field]).filter(Boolean))].sort(alphabetic);
    return { uf: unique('uf'), party: unique('party'), office: unique(this.scope === 'candidates' ? 'office' : 'sphere') };
  }
  summary(id, statementId) {
    const account = this.accounts.get(id);
    const statement = account?.statements.get(statementId);
    if (!statement) throw new Error('Prestação de contas não encontrada.');
    const totals = {};
    for (const kind of Object.keys(TABLES)) {
      let knownCents = 0;
      let missing = 0;
      for (const row of statement[kind]) {
        if (row.cents === null) missing++;
        else knownCents = addCents(knownCents, row.cents);
      }
      totals[kind] = { available: Boolean(this.tables[kind]), count: statement[kind].length, missing, knownCents,
        cents: this.tables[kind] && statement[kind].length && !missing ? knownCents : null };
    }
    return { account: this.accountInfo(account), statement: { id: statement.id, type: statement.type, date: statement.date, turn: statement.turn },
      totals, sources: groupRows(statement.receipts, 'source'), origins: groupRows(statement.receipts, 'origin'),
      natures: groupRows(statement.receipts, 'nature'), contractedCategories: groupRows(statement.contracted, 'origin'),
      paidCategories: groupRows(statement.paid, 'origin'), tables: this.metadata(), loadedAt: this.loadedAt, source: this.source };
  }
  benchmark(id, statementId) {
    const account = this.accounts.get(id);
    const statement = account?.statements.get(statementId);
    if (!statement) throw new Error('Prestação de contas não encontrada.');
    const key = cohortKey(account, statement);
    const latest = this.statements(account).find((s) => cohortKey(account, s) === key && /^\d{2}\/\d{2}\/\d{4}$/.test(s.date));
    if (this.scope !== 'candidates' || !key || latest?.id !== statementId) return null;
    this.benchmarks ??= buildBenchmarks(this);
    return this.benchmarks[key] || null;
  }
  counterparties(id, statementId, filters = {}, page = 0) {
    const statement = this.accounts.get(id)?.statements.get(statementId);
    if (!statement) throw new Error('Prestação de contas não encontrada.');
    return counterpartyGroups(statement.receipts, filters, page);
  }
  transactions(id, statementId, kind, page = 0, size = 20, order = 'original') {
    const statement = this.accounts.get(id)?.statements.get(statementId);
    if (!statement || !TABLES[kind]) throw new Error('Lançamentos não encontrados.');
    const records = sortedTransactions(statement[kind], order);
    return { rows: records.slice(page * size, (page + 1) * size), count: records.length, filename: this.tables[kind]?.filename || '' };
  }
  metadata() {
    return Object.fromEntries(Object.entries(this.tables).map(([kind, table]) => [kind, { ...table, generations: [...table.generations].sort(alphabetic) }]));
  }
}

export function selectTables(entries, scope, year = 2026) {
  const suffix = scope === 'candidates' ? 'candidatos' : 'orgaos_partidarios';
  const selected = {};
  for (const [kind, table] of Object.entries(TABLES)) {
    const filename = `${table.prefix}_${suffix}_${year}_BRASIL.csv`.toLowerCase();
    const matches = entries.filter((entry) => entry.name.split('/').pop().toLowerCase() === filename);
    if (matches.length > 1) throw new Error(`O ZIP contém mais de uma cópia de ${filename}.`);
    if (matches.length) selected[kind] = matches[0];
  }
  if (!Object.keys(selected).length) throw new Error(`Este ZIP não contém os CSV nacionais de ${year} para ${scope === 'candidates' ? 'candidaturas' : 'órgãos partidários'}.`);
  return selected;
}

export async function parseCsvStream(stream, parser, onProgress = () => {}) {
  const reader = stream.getReader();
  let decoder;
  let prefix = new Uint8Array(0);
  let bytes = 0;
  let nextProgress = 1_000_000;
  const decode = (chunk) => parser.push(decoder.decode(chunk, { stream: true }));
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (!decoder) {
        const joined = new Uint8Array(prefix.length + value.length);
        joined.set(prefix); joined.set(value, prefix.length);
        prefix = joined;
        if (prefix.length < 3) continue;
        decoder = new TextDecoder(prefix[0] === 0xef && prefix[1] === 0xbb && prefix[2] === 0xbf ? 'utf-8' : 'windows-1252', { fatal: true });
        decode(prefix); prefix = new Uint8Array(0);
      } else decode(value);
      if (bytes >= nextProgress) { onProgress(bytes, parser.rows - 1); nextProgress = bytes + 1_000_000; }
    }
    if (!decoder) { decoder = new TextDecoder('windows-1252'); decode(prefix); }
    parser.push(decoder.decode());
    parser.finish();
    if (!parser.rows) throw new Error('Arquivo CSV vazio, sem cabeçalho.');
    onProgress(bytes, Math.max(0, parser.rows - 1));
    return bytes;
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

export function csvCell(value) {
  let text = String(value ?? '');
  // Impede fórmulas quando o CSV é aberto em um programa de planilhas.
  if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
