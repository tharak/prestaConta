// Se o TSE bloquear consultas entre origens, configure o relay descrito no README.
// Nenhum dado eleitoral é armazenado no repositório ou no relay.
export const config = Object.freeze({
  year: 2026,
  // published: atualização diária por GitHub Actions, sem dados versionados.
  // live: leitura direta do TSE (pode exigir relayUrl por causa de CORS).
  mode: 'published',
  dataset: 'prestacao-de-contas-eleitorais-2026',
  portal: 'https://dadosabertos.tse.jus.br/dataset/prestacao-de-contas-eleitorais-2026',
  api: 'https://dadosabertos.tse.jus.br/api/3/action/package_show',
  relayUrl: '',
  resourceIds: {
    candidates: 'dc8c1c26-7df0-4d90-a6da-f567b3f6cc00',
    parties: '4b60ada3-66d9-474d-ba3f-a42a7bbcf90d',
  },
});
