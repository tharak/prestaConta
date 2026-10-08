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
export function candidateNodes(accounts, kind, stage = 'office', limit = 12) {
  if (stage === 'office' || stage === 'uf') return accountGroups(accounts, kind, stage).map((group) => ({ ...group,
    id: `${stage}:${group.id}`, level: stage === 'office' ? 'candidate-office' : 'candidate-uf', color: color(`${stage}:${group.id}`) }));
  const rows = sorted(accounts);
  if (rows.length <= limit) return rows.map((account) => ({ ...total([account], kind), id: account.id, label: candidateLabel(account), level: 'account', color: color(account.party) }));
  const size = Math.ceil(rows.length / limit), nodes = [];
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
  const graph = candidateFlowForGroups(data, context, groups);
  graph.centerSlot = ['office', 'uf'].includes(context.stage || 'office') ? 32 : 76;
  graph.centerTitle = context.stage === 'uf' ? 'Estados' : ['names', 'selected'].includes(context.stage) ? 'Candidaturas' : 'Cargos';
  return graph;
}

function candidateFlowForGroups(data, context, groups) {
  const labels = new Map(groups.map((entry) => [entry.id, entry.label]));
  const graph = buildFlow({ ...data, accounts: groups.flatMap((entry) => entry.accounts.map((account) => ({ ...account, party: entry.id }))) },
    { incoming: context.incoming, outgoing: context.outgoing, expanded: context.expanded, centerLabels: labels });
  const byId = new Map(groups.map((entry) => [entry.id, entry]));
  for (const entry of graph.columns[1]) entry.navigation = byId.get(entry.party);
  return graph;
}

const networkGroups = (data, context) => context.groups || candidateNodes(data.accounts, 'receipts');
export function buildCandidateNetwork(data, context) {
  const groups = networkGroups(data, context), graph = candidateFlowForGroups(data, context, groups);
  graph.centerTitle = groups.every((entry) => entry.level === 'candidate-office') ? 'Cargos' : 'Candidaturas e grupos';
  graph.centerColumns = Math.min(12, Math.max(3, Math.ceil(Math.sqrt(groups.length * .7))));
  return graph;
}

// Trocar apenas a parcela clicada mantém todas as contas no grafo. Nenhum
// recurso é duplicado: os filhos substituem o pai na soma e nas ligações.
export function expandCandidateNetwork(data, context, id) {
  const groups = networkGroups(data, context), index = groups.findIndex((entry) => entry.id === id);
  if (index < 0 || groups[index].level === 'account') return context;
  const entry = groups[index], stage = entry.level === 'candidate-office' ? 'uf' : 'names';
  let children = candidateNodes(entry.accounts, 'receipts', stage, 48);
  // Abrir um grupo de uma parcela chega diretamente à próxima subdivisão.
  while (children.length === 1 && children[0].level !== 'account') children = candidateNodes(children[0].accounts, 'receipts', 'names', 48);
  children = children.map((child) => child.level === 'account' ? child : { ...child,
    id: JSON.stringify([entry.id, child.id]), label: child.level === 'candidate-uf' ? `${entry.label} · ${child.label}` : child.label });
  return { ...context, groups: [...groups.slice(0, index), ...children, ...groups.slice(index + 1)], title: 'Todas as candidaturas' };
}

export function revealCandidateNetwork(data, context, id) {
  let next = context;
  for (;;) {
    const entry = networkGroups(data, next).find((group) => group.accounts.some((account) => account.id === id));
    if (!entry || entry.level === 'account') return next;
    next = expandCandidateNetwork(data, next, entry.id);
  }
}
