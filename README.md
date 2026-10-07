# PrestaConta

Página em português para consultar contas eleitorais de 2026, uma conta por vez. **GitHub Actions busca os arquivos atuais no TSE diariamente**, processa as contas e publica uma versão datada no **GitHub Pages**. Nenhum dado eleitoral é gravado no histórico Git. Os dados processados existem apenas na publicação; o navegador carrega cada conta sob demanda.

Fonte primária: [Prestação de Contas Eleitorais — 2026, TSE](https://dadosabertos.tse.jus.br/dataset/prestacao-de-contas-eleitorais-2026). A fonte identifica a licença como Creative Commons Atribuição e o sistema de origem como SPCE.

## Executar

Requisitos: Python 3 e Node.js 22 ou mais recente. Não há dependências npm para instalar.

```sh
npm run dev
```

Abra http://127.0.0.1:8123 e abra o ZIP original baixado do portal oficial. A publicação automática fica disponível depois de executar o workflow. Para verificar e preparar os arquivos da página:

```sh
npm test
npm run build
```

## Atualização sem versionar dados

1. O workflow roda diariamente (08:17 UTC / 05:17 em Brasília), em cada alteração de código e quando acionado manualmente. A execução agendada pode atrasar; a página mostra as datas reais, sem prometer um horário exato.
2. O workflow consulta o catálogo CKAN do TSE usando os identificadores oficiais dos dois recursos. As URLs atuais dos ZIP vêm desse catálogo.
3. O processamento usa HTTP Range para baixar somente os CSV nacionais de receitas, despesas contratadas e despesas pagas. Arquivos estaduais e tabelas de doadores originários não são somados.
4. A leitura verifica CRC32, tamanho, estrutura do CSV e valores monetários. A publicação ocorre somente após leitura completa de ambas as bases; falhas preservam a publicação anterior.
5. Cada conta vira um JSON compactado separado, junto de um índice com nomes e metadados. Esses arquivos são gerados em `dist/data/`, ignorado pelo Git, e enviados somente como artefato de publicação. ZIP, CSV e JSON eleitorais não são commitados. O histórico contém apenas código, configuração e testes sintéticos.
6. A página consulta o índice publicado e carrega os dados de uma conta apenas quando ela é aberta. Mantém até cinco contas na memória da aba e rejeita dados de uma versão diferente do índice. Não há IndexedDB, localStorage ou service worker.

**Recarregar a publicação não força uma consulta nova ao TSE.** Os valores são os da última execução bem-sucedida, com data de obtenção e de geração dos CSV. Para atualizar imediatamente, execute o workflow **Publicar GitHub Pages** em Actions. O próprio TSE pode servir arquivos por cache; as datas de geração são preservadas.

Para gerar uma publicação completa localmente com acesso à rede:

```sh
npm run build -- --refresh
python3 -m http.server 8124 --bind 127.0.0.1 --directory dist
```

## Modo opcional de consulta ao vivo

O modo padrão é `mode: 'published'` em `site/config.js`. Para buscar diretamente do TSE a cada carregamento, use `mode: 'live'` e configure o relay abaixo quando necessário. Verificamos que o navegador bloqueia atualmente a consulta direta; GitHub Pages não consegue alterar o CORS do TSE.

No modo ao vivo, um Web Worker descompacta os CSV no navegador. Se não houver HTTP Range, aceita download completo até 300 MB. Arquivos maiores podem ser abertos localmente, sem upload. Em qualquer modo, é possível abrir o ZIP oficial no navegador, com processamento local e sem enviá-lo a um servidor. Uma falha nunca é substituída por dados fictícios.

## Relay opcional para CORS

`relay/worker.js` é um Cloudflare Worker separado da página. Ele descobre as URLs atuais no TSE e encaminha o ZIP em fluxo, incluindo solicitações Range. Não armazena arquivos, não aceita URLs arbitrárias, não recebe uploads e só permite os dois recursos oficiais de 2026. A origem da página deve constar em `ALLOWED_ORIGINS`.

Com uma conta Cloudflare autenticada e Wrangler disponível:

```sh
cd relay
npx wrangler deploy
```

Antes de publicar, ajuste `ALLOWED_ORIGINS` em `relay/wrangler.toml` para a origem real do site. Origens são informadas sem o caminho do repositório; por exemplo, `https://tharak.github.io`. Para desenvolvimento local, pode acrescentar `http://127.0.0.1:8123`, separado por vírgula.

Em `site/config.js`, defina `relayUrl` com a URL HTTPS publicada do Worker, sem barra final. Faça o deploy do GitHub Pages novamente. `/resources` expõe apenas metadados; `/archive?scope=candidates` e `/archive?scope=parties` encaminham os arquivos atuais do TSE. A página continua hospedada no GitHub Pages.

O relay é uma alternativa de infraestrutura, não um servidor hospedado automaticamente por este projeto. Sua publicação exige acesso à conta Cloudflare. Nenhum endpoint foi inventado ou configurado como se estivesse disponível.

## Publicar no GitHub Pages

O workflow `.github/workflows/pages.yml` verifica o processamento, consulta o TSE, prepara `dist/` e publica a página com os dados processados. **Não grava dados eleitorais no histórico Git.**

Para criar o repositório público solicitado, com GitHub CLI autenticado:

```sh
gh auth login
gh repo create prestaConta --public --source=. --remote=origin --push
```

Em **Settings → Pages → Build and deployment**, selecione **GitHub Actions**. Execute o workflow **Publicar GitHub Pages** ou envie um novo commit para `main`. O caminho previsto, para o usuário `tharak`, é `https://tharak.github.io/prestaConta/`; ele só estará disponível depois da criação do repositório e de uma publicação bem-sucedida.

## Interpretação

- Receitas, despesas contratadas e despesas pagas são bases distintas. Nunca somamos contratado e pago nem calculamos saldo a partir dessas tabelas.
- A classificação de fonte (`DS_FONTE_RECEITA`) é mantida separada da origem (`DS_ORIGEM_RECEITA`) e da natureza (`DS_NATUREZA_RECEITA`). Categorias oficiais desconhecidas continuam identificadas pelo texto original.
- “Outros recursos” não é automaticamente uma doação privada. Repasse de partido não identifica, sozinho, o fundo utilizado. Recursos de campanha não representam patrimônio pessoal.
- Cada conta usa `CD_ELEICAO` e `SQ_PRESTADOR_CONTAS`. Tipos, datas e turnos diferentes de prestação têm seleções separadas, sem somar parcial, final ou retificadora.
- O arquivo nacional `BRASIL` é escolhido uma única vez. CSV estaduais e tabelas de doadores originários não são somados novamente. Contas de diretórios e candidaturas são consultadas separadamente para evitar contar repasses como recursos novos.
- Identificadores são texto; valores monetários são inteiros em centavos. Formatos inesperados interrompem o carregamento com uma mensagem em português.
- Sem tabela é “não disponível”. Sem lançamentos para uma conta é “sem lançamentos”. Valor ausente não vira zero. Os totais com valores ausentes são marcados como incompletos.
- A lista inclui apenas contas presentes nas tabelas carregadas; não pretende enumerar todas as candidaturas registradas.
- Não há rankings, médias comparativas, pontuações ou inferências sobre riqueza pessoal. A navegação apresenta contas em ordem alfabética.
- O resumo CSV inclui fonte, identificador da conta, prestação, arquivos e datas de geração. Nomes e textos são escapados para evitar fórmulas em planilhas.

## Estrutura

`site/` contém a página, estilos, interface, parser, leitor ZIP e leitor de contas publicadas. `relay/` contém o encaminhamento opcional. `tests/` usa apenas registros sintéticos criados durante os testes, sem dados eleitorais reais. `scripts/build.mjs` prepara a página e `scripts/refresh-data.mjs` consulta e processa os arquivos oficiais.

Os testes de parser, integridade dos ZIP, associação de pagamentos, prestações separadas, atualização de publicação e relay são independentes da disponibilidade do TSE. Valide uma execução completa e o comportamento da página publicada antes de compartilhar o site.
