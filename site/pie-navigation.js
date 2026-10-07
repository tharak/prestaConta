import { alphabetic, fold } from './data.js';

export function accountGroups(accounts, kind, field) {
  const groups = new Map();
  for (const account of accounts) {
    const label = field === 'id' ? account.id : account[field] || 'Não informado';
    const group = groups.get(label) || { id: label, label, accounts: [], cents: null, missing: 0, count: 0 };
    group.accounts.push(account);
    const total = account.statements[0]?.totals[kind];
    if (total?.available && total.count) {
      group.cents = (group.cents ?? 0) + total.knownCents;
      group.missing += total.missing; group.count += total.count;
    }
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => alphabetic(a.label, b.label));
}

export function recordGroups(records, field) {
  const groups = new Map();
  for (const record of records) {
    const label = record[field] || 'Não informado';
    const group = groups.get(label) || { id: label, label, records: [], cents: 0, missing: 0, count: 0 };
    group.records.push(record); group.count++;
    if (record.cents === null) group.missing++; else group.cents += record.cents;
    groups.set(label, group);
  }
  return [...groups.values()].sort((a, b) => alphabetic(a.label, b.label));
}

// O resumo unifica variações de caixa no tipo. Os arquivos individuais
// preservam essas prestações separadas; reunimos apenas as da mesma data/turno.
export function latestRecords(document, statement, kind) {
  return document.statements.filter(({ summary }) => {
    const current = summary.statement;
    return fold(current.type) === fold(statement.type) && current.date === statement.date && current.turn === statement.turn;
  }).flatMap((entry) => entry.records[kind] || []);
}
