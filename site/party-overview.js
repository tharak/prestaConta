import { alphabetic, TABLES } from './data.js';

const dateKey = (value) => { const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return match ? `${match[3]}${match[2]}${match[1]}` : ''; };
const priority = (type) => ({ Final: 3, Parcial: 2, 'Relatório Financeiro': 1 })[type] || 0;
const add = (a, b) => { const value = a + b; if (!Number.isSafeInteger(value)) throw new Error('Soma monetária excede o limite de precisão.'); return value; };

export function createPartyOverview(store) {
  if (store.scope !== 'parties') throw new Error('A visão geral exige a base de órgãos partidários.');
  const accounts = store.list().map((account) => ({ id: account.id, party: account.party || 'Não informado',
    partyName: account.partyName, uf: account.uf || 'Não informado', sphere: account.sphere || 'Não informada',
    statements: account.statements.map((statement) => {
      const summary = store.summary(account.id, statement.id);
      return { ...statement, totals: summary.totals, sources: summary.sources, origins: summary.origins };
    }).sort((a, b) => dateKey(b.date).localeCompare(dateKey(a.date)) || priority(b.type) - priority(a.type) || alphabetic(a.id, b.id)),
  }));
  const unique = (values) => [...new Set(values)].sort(alphabetic);
  return { version: 1, year: store.year, scope: 'parties', updatedAt: store.loadedAt, source: store.source, tables: store.metadata(),
    options: { uf: unique(accounts.map((a) => a.uf)), sphere: unique(accounts.map((a) => a.sphere)),
      type: unique(accounts.flatMap((a) => a.statements.map((s) => s.type))), turn: unique(accounts.flatMap((a) => a.statements.map((s) => s.turn))) }, accounts };
}

function total(available) { return { available, knownCents: 0, count: 0, missing: 0, accountsWithRecords: 0, accountsWithoutRecords: 0 }; }
function collect(target, value) {
  target.knownCents = add(target.knownCents, value.knownCents);
  target.count += value.count; target.missing += value.missing;
  if (value.count) target.accountsWithRecords++; else target.accountsWithoutRecords++;
}
function collectGroups(target, groups) {
  for (const value of groups) {
    const group = target.get(value.name) || { name: value.name, cents: 0, count: 0, missing: 0 };
    group.cents = add(group.cents, value.cents); group.count += value.count; group.missing += value.missing;
    target.set(value.name, group);
  }
}

// Valores brutos: repasses entre órgãos continuam na movimentação declarada.
// Não inferimos receita líquida nem subtraímos transferências sem conciliação.
export function aggregateParties(data, filters = {}) {
  const minimum = filters.minimumCents ?? 0;
  const minimumKind = filters.minimumKind || 'receipts';
  if (!Number.isSafeInteger(minimum) || minimum < 0 || !Object.hasOwn(TABLES, minimumKind)) throw new Error('Filtro de valor mínimo inválido.');
  if (minimum > 0) {
    const { minimumCents, minimumKind: selectedKind, ...scope } = filters;
    const overview = aggregateParties(data, scope);
    const included = new Set(overview.parties.filter((party) => {
      const value = chartValue(party, { kind: minimumKind });
      return value.cents !== null && value.cents >= minimum;
    }).map((party) => party.party));
    return aggregateParties({ ...data, accounts: data.accounts.filter((account) => included.has(account.party)) }, scope);
  }
  const parties = new Map();
  const totals = Object.fromEntries(Object.keys(TABLES).map((kind) => [kind, total(Boolean(data.tables[kind]))]));
  const origins = new Map(), sources = new Map();
  const types = new Map(); const dates = new Set(); let accounts = 0; let undated = 0;
  for (const account of data.accounts) {
    if ((filters.uf && account.uf !== filters.uf) || (filters.sphere && account.sphere !== filters.sphere)) continue;
    const statement = account.statements.find((s) => (!filters.type || filters.type === 'latest' || s.type === filters.type) && (filters.turn === undefined || s.turn === filters.turn));
    if (!statement) continue;
    const party = parties.get(account.party) || { party: account.party, partyName: account.partyName, accounts: 0,
      totals: Object.fromEntries(Object.keys(TABLES).map((kind) => [kind, total(Boolean(data.tables[kind]))])), sources: new Map(), origins: new Map() };
    accounts++; party.accounts++;
    types.set(statement.type, (types.get(statement.type) || 0) + 1);
    if (dateKey(statement.date)) dates.add(statement.date); else undated++;
    for (const kind of Object.keys(TABLES)) { collect(party.totals[kind], statement.totals[kind]); collect(totals[kind], statement.totals[kind]); }
    collectGroups(party.sources, statement.sources); collectGroups(party.origins, statement.origins);
    collectGroups(sources, statement.sources); collectGroups(origins, statement.origins);
    parties.set(account.party, party);
  }
  const rows = [...parties.values()].sort((a, b) => alphabetic(a.party, b.party)).map((party) => ({ ...party,
    sources: [...party.sources.values()].sort((a, b) => alphabetic(a.name, b.name)), origins: [...party.origins.values()].sort((a, b) => alphabetic(a.name, b.name)) }));
  const sortedDates = [...dates].sort((a, b) => dateKey(a).localeCompare(dateKey(b)));
  return { parties: rows, totals, accounts, undated, types: Object.fromEntries(types),
    origins: [...origins.values()].sort((a, b) => alphabetic(a.name, b.name)),
    sources: [...sources.values()].sort((a, b) => alphabetic(a.name, b.name)),
    firstDate: sortedDates[0] || '', lastDate: sortedDates.at(-1) || '',
    categories: { sources: [...new Set(rows.flatMap((p) => p.sources.map((g) => g.name)))].sort(alphabetic),
      origins: [...new Set(rows.flatMap((p) => p.origins.map((g) => g.name)))].sort(alphabetic) } };
}

export function chartValue(party, series) {
  const total = party.totals[series.kind || 'receipts'];
  if (!total.available || !total.count) return { cents: null, missing: 0, empty: true };
  if (series.kind) return { cents: total.knownCents, missing: total.missing, empty: false };
  const group = party[series.field].find((g) => g.name === series.name);
  if (!group && total.missing) return { cents: null, missing: total.missing, empty: false };
  return { cents: group?.cents || 0, missing: group?.missing || 0, empty: false };
}
