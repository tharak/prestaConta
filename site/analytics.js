import { alphabetic, fold } from './data.js';

export const CATEGORIES = Object.freeze({
  sources: { kind: 'receipts', field: 'source', label: 'Receitas · fonte do recurso' },
  origins: { kind: 'receipts', field: 'origin', label: 'Receitas · origem do repasse' },
  natures: { kind: 'receipts', field: 'nature', label: 'Receitas · dinheiro ou bens e serviços estimáveis' },
  contractedCategories: { kind: 'contracted', field: 'origin', label: 'Despesas contratadas · categoria' },
  paidCategories: { kind: 'paid', field: 'origin', label: 'Despesas pagas · categoria' },
});

export function cohortKey(account, statement) {
  if (!account.uf || !account.office || !statement.turn || !statement.type || statement.type === 'Tipo não informado') return null;
  const election = account.id.split(':')[0];
  if (election === 'não informado') return null;
  return JSON.stringify([election, account.uf, account.office, statement.type, statement.turn]);
}
function sum(a, b) {
  const value = a + b;
  if (!Number.isSafeInteger(value)) throw new Error('Soma monetária excede o limite de precisão.');
  return value;
}
function sample() { return { sumCents: 0, count: 0, excluded: 0 }; }
function finish(value) { return { ...value, meanCents: value.count ? value.sumCents / value.count : null }; }

// Uma prestação por conta e grupo: a data mais recente daquele tipo e turno.
// As categorias usam todas as contas com a tabela completa como denominador.
export function buildBenchmarks(store) {
  const cohorts = new Map();
  if (store.scope !== 'candidates') return {};
  for (const account of store.accounts.values()) {
    const used = new Set();
    for (const info of store.statements(account)) {
      const key = cohortKey(account, info);
      if (!key || used.has(key) || !/^\d{2}\/\d{2}\/\d{4}$/.test(info.date)) continue;
      used.add(key);
      const statement = account.statements.get(info.id);
      let cohort = cohorts.get(key);
      if (!cohort) {
        cohort = { key, uf: account.uf, office: account.office, type: info.type, turn: info.turn, accounts: 0,
          totals: Object.fromEntries(['receipts', 'contracted', 'paid'].map((kind) => [kind, sample()])),
          categories: Object.fromEntries(Object.keys(CATEGORIES).map((field) => [field, new Map()])) };
        cohorts.set(key, cohort);
      }
      cohort.accounts++;
      for (const kind of ['receipts', 'contracted', 'paid']) {
        const total = cohort.totals[kind];
        const records = statement[kind];
        if (!store.tables[kind] || !records.length || records.some((row) => row.cents === null)) { total.excluded++; continue; }
        total.count++;
        for (const record of records) total.sumCents = sum(total.sumCents, record.cents);
        for (const [field, definition] of Object.entries(CATEGORIES)) {
          if (definition.kind !== kind) continue;
          const categories = cohort.categories[field];
          for (const record of records) {
            const name = record[definition.field] || 'Não informado';
            categories.set(name, sum(categories.get(name) || 0, record.cents));
          }
        }
      }
    }
  }
  return Object.fromEntries([...cohorts].map(([key, cohort]) => [key, {
    ...cohort, totals: Object.fromEntries(Object.entries(cohort.totals).map(([kind, value]) => [kind, finish(value)])),
    categories: Object.fromEntries(Object.entries(cohort.categories).map(([field, categories]) => [field,
      [...categories].sort(([a], [b]) => alphabetic(a, b)).map(([name, sumCents]) => ({ name,
        ...finish({ ...cohort.totals[CATEGORIES[field].kind], sumCents }) }))])),
  }]));
}

export function counterpartyGroups(records, filters = {}, page = 0, size = 20) {
  const groups = new Map();
  for (const record of records) {
    if (filters.origin && record.origin !== filters.origin) continue;
    if (filters.query && !fold(record.counterparty).includes(fold(filters.query))) continue;
    const name = record.counterparty || 'Não informado';
    const key = JSON.stringify([name, record.origin, record.source, record.nature]);
    const group = groups.get(key) || { name, origin: record.origin, source: record.source, nature: record.nature, cents: 0, missing: 0, count: 0 };
    group.count++;
    if (record.cents === null) group.missing++;
    else group.cents = sum(group.cents, record.cents);
    groups.set(key, group);
  }
  const rows = [...groups.values()].sort((a, b) => alphabetic(a.name, b.name) || alphabetic(a.origin, b.origin) || alphabetic(a.source, b.source) || alphabetic(a.nature, b.nature));
  return { rows: rows.slice(page * size, (page + 1) * size), count: rows.length };
}

export function sortedTransactions(records, order = 'original') {
  if (order === 'original') return records;
  const date = (value) => { const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})/); return match ? `${match[3]}${match[2]}${match[1]}` : ''; };
  if (!['amount-desc', 'amount-asc', 'date-desc', 'date-asc', 'name'].includes(order)) throw new Error('Ordenação desconhecida.');
  return [...records].sort((a, b) => {
    let comparison = 0;
    if (order.startsWith('amount')) {
      if (a.cents === null || b.cents === null) return a.cents === b.cents ? a.row - b.row : a.cents === null ? 1 : -1;
      comparison = (a.cents - b.cents) * (order === 'amount-desc' ? -1 : 1);
    } else if (order.startsWith('date')) {
      const da = date(a.date), db = date(b.date);
      if (!da || !db) return da === db ? a.row - b.row : !da ? 1 : -1;
      comparison = da.localeCompare(db) * (order === 'date-desc' ? -1 : 1);
    } else comparison = alphabetic(a.counterparty, b.counterparty);
    return comparison || a.row - b.row;
  });
}
