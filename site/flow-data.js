import { alphabetic } from './data.js';

const add = (a, b) => {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw new Error('Soma monetária excede o limite de precisão.');
  return result;
};

// Ligações são somas declaradas em cada lado do partido, não uma conciliação
// entre doação e pagamento. Receitas e despesas não precisam ter o mesmo total.
export function buildFlow(data, { party = null, incoming = 'origins', outgoing = 'paid', expanded = [] } = {}) {
  if (!['sources', 'origins'].includes(incoming) || !['paid', 'contracted'].includes(outgoing)) throw new Error('Medida de fluxo inválida.');
  const parties = new Map(), groups = [new Map(), new Map()], edges = new Map();
  const totals = { receipts: { cents: 0, count: 0, missing: 0, available: Boolean(data.tables.receipts) },
    outgoing: { cents: 0, count: 0, missing: 0, available: Boolean(data.tables[outgoing]) } };
  let categoriesUnavailable = false;
  for (const account of data.accounts) {
    if (party && account.party !== party) continue;
    const statement = account.statements[0]; if (!statement) continue;
    const center = parties.get(account.party) || { id: JSON.stringify(['party', account.party]), label: account.party, side: 'party', party: account.party, inCents: 0, outCents: 0, count: 0, missing: 0 };
    parties.set(account.party, center);
    for (const [side, kind, field, name] of [[0, 'receipts', incoming, 'receipts'], [1, outgoing, `${outgoing}Categories`, 'outgoing']]) {
      const total = statement.totals[kind];
      if (!total?.available) continue;
      totals[name].cents = add(totals[name].cents, total.knownCents); totals[name].count += total.count; totals[name].missing += total.missing;
      center[side ? 'outCents' : 'inCents'] = add(center[side ? 'outCents' : 'inCents'], total.knownCents); center.count += total.count; center.missing += total.missing;
      let rows = statement[field];
      if (!rows && total.count) {
        categoriesUnavailable = true;
        rows = [{ name: 'Categorias indisponíveis nesta publicação', cents: total.knownCents, count: total.count, missing: total.missing }];
      }
      for (const row of rows || []) {
        const label = row.name || 'Não informado', id = JSON.stringify([side, label]);
        const group = groups[side].get(label) || { id, label, side: side ? 'outgoing' : 'incoming', cents: 0, count: 0, missing: 0 };
        group.cents = add(group.cents, row.cents); group.count += row.count; group.missing += row.missing; groups[side].set(label, group);
        const key = JSON.stringify([side, account.party, label]);
        const edge = edges.get(key) || { id: key, source: side ? center.id : id, target: side ? id : center.id, party: account.party, cents: 0, count: 0, missing: 0 };
        edge.cents = add(edge.cents, row.cents); edge.count += row.count; edge.missing += row.missing; edges.set(key, edge);
      }
    }
  }
  let links = [...edges.values()];
  const hasNegative = links.some((link) => link.cents < 0) || groups.some((map) => [...map.values()].some((entry) => entry.cents < 0));
  const columns = groups.map((map, side) => {
    const rows = [...map.values()].sort((a, b) => b.cents - a.cents || alphabetic(a.label, b.label));
    if (rows.length <= 9 || expanded.includes(side)) return rows;
    const children = rows.slice(8), ids = new Set(children.map((entry) => entry.id));
    const rest = { id: JSON.stringify(['other', side]), label: `Outras ${side ? 'categorias' : incoming === 'sources' ? 'fontes' : 'origens'} (${children.length})`, side: side ? 'outgoing' : 'incoming', children, expandSide: side, cents: 0, count: 0, missing: 0 };
    for (const child of children) { rest.cents = add(rest.cents, child.cents); rest.count += child.count; rest.missing += child.missing; }
    // Reagrupar sem perder valores, sinais nem os registros incompletos.
    const grouped = new Map(), kept = [];
    for (const edge of links) {
      if (!ids.has(side ? edge.target : edge.source)) { kept.push(edge); continue; }
      const group = grouped.get(edge.party) || { ...edge, id: JSON.stringify(['other', side, edge.party]), source: side ? edge.source : rest.id, target: side ? rest.id : edge.target, cents: 0, count: 0, missing: 0 };
      group.cents = add(group.cents, edge.cents); group.count += edge.count; group.missing += edge.missing; grouped.set(edge.party, group);
    }
    links = [...kept, ...grouped.values()];
    return [...rows.slice(0, 8), rest];
  });
  const centers = [...parties.values()].sort((a, b) => alphabetic(a.label, b.label));
  const nodes = [...columns[0], ...centers, ...columns[1]];
  return { columns: [columns[0], centers, columns[1]], nodes, links, totals, categoriesUnavailable,
    hasNegative,
    missing: totals.receipts.missing + totals.outgoing.missing };
}
