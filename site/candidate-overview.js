import { alphabetic, fold } from './data.js';
import { accountGroups } from './chart-navigation.js';
import { buildFlow } from './flow-data.js';

export const candidateLabel = (account) => `${account.name || `Prestador ${account.prestador || account.id}`} · ${account.party} · ${account.number || 'Sem número'} · ${account.uf}`;
const sorted = (accounts) => [...accounts].sort((a, b) => alphabetic(a.name, b.name) || alphabetic(a.id, b.id));
const color = (id) => { let hash = 0; for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return `hsl(${hash % 360} 48% ${hash % 2 ? 43 : 36}%)`; };
const total = (accounts, kind) => accountGroups(accounts, kind, 'all')[0];
const shortName = (account) => (account.name || account.id).split(/\s+/).slice(0, 2).join(' ');

// Os grupos alfabéticos cobrem todas as contas. Nenhuma candidatura é removida
// por ter pouco dinheiro; os ids das contas distinguem inclusive homônimos.
export function candidateNodes(accounts, kind, stage = 'office') {
  if (stage === 'office' || stage === 'uf') return accountGroups(accounts, kind, stage).map((group) => ({ ...group,
    id: `${stage}:${group.id}`, level: stage === 'office' ? 'candidate-office' : 'candidate-uf', color: color(`${stage}:${group.id}`) }));
  const rows = sorted(accounts);
  if (rows.length <= 12) return rows.map((account) => ({ ...total([account], kind), id: account.id, label: candidateLabel(account), level: 'account', color: color(account.party) }));
  const size = Math.ceil(rows.length / 12), nodes = [];
  for (let start = 0; start < rows.length; start += size) {
    const members = rows.slice(start, start + size), id = `range:${members[0].id}:${members.at(-1).id}`;
    nodes.push({ ...total(members, kind), id, label: `${shortName(members[0])} → ${shortName(members.at(-1))} · ${members.length.toLocaleString('pt-BR')} candidaturas`, level: 'candidate-group', color: color(id) });
  }
  return nodes;
}
export function candidateContext(entry) {
  return { accounts: entry.accounts, stage: entry.level === 'candidate-office' ? 'uf' : entry.level === 'account' ? 'selected' : 'names', title: entry.label, expanded: [] };
}
export function candidateDimension(stage) {
  return stage === 'office' ? 'Candidaturas por cargo' : stage === 'uf' ? 'Candidaturas por estado' : 'Candidaturas';
}
export function findCandidates(accounts, query) {
  const terms = fold(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return sorted(accounts.filter((account) => {
    const text = fold(`${account.name} ${account.number} ${account.party} ${account.uf} ${account.office} ${account.prestador}`);
    return terms.every((term) => text.includes(term));
  }));
}
export function buildCandidateFlow(data, context) {
  const accounts = context.accounts || data.accounts;
  const groups = candidateNodes(accounts, 'receipts', context.stage || 'office');
  const labels = new Map(groups.map((entry) => [entry.id, entry.label]));
  const graph = buildFlow({ ...data, accounts: groups.flatMap((entry) => entry.accounts.map((account) => ({ ...account, party: entry.id }))) },
    { incoming: context.incoming, outgoing: context.outgoing, expanded: context.expanded, centerLabels: labels });
  const byId = new Map(groups.map((entry) => [entry.id, entry]));
  for (const entry of graph.columns[1]) entry.navigation = byId.get(entry.party);
  graph.centerSlot = ['office', 'uf'].includes(context.stage || 'office') ? 32 : 76;
  graph.centerTitle = context.stage === 'uf' ? 'Estados' : ['names', 'selected'].includes(context.stage) ? 'Candidaturas' : 'Cargos';
  return graph;
}
