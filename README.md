# PrestaConta

Página em português com visões gerais dos órgãos partidários e dos candidatos nas eleições de 2026. O gráfico inicial reúne os totais de cada partido e as categorias de origem das receitas; a visão dos candidatos fica em `candidatos.html` e a consulta individual de contas em `contas.html`. **GitHub Actions busca os arquivos atuais no TSE diariamente**, processa as contas e publica uma versão datada no **GitHub Pages**. Nenhum dado eleitoral é gravado no histórico Git. Os dados processados existem apenas na publicação. As duas visões consultam resumos compactados de suas respectivas bases; a consulta individual carrega cada conta sob demanda.

Fonte primária: [Prestação de Contas Eleitorais — 2026, TSE](https://dadosabertos.tse.jus.br/dataset/prestacao-de-contas-eleitorais-2026). A fonte identifica a licença como Creative Commons Atribuição e o sistema de origem como SPCE.

## Executar

Requisitos: Python 3 e Node.js 24 ou mais recente. Não há dependências npm para instalar.

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
5. Cada conta vira um JSON compactado separado, junto de um índice com nomes e metadados, um arquivo de médias agregadas por grupo e `parties/overview.json.gz`, o resumo dos órgãos com totais por prestação, fonte e origem. Esses arquivos são gerados em `dist/data/`, ignorado pelo Git, e enviados somente como artefato de publicação. ZIP, CSV e JSON eleitorais não são commitados. O histórico contém apenas código, configuração e testes sintéticos.
6. A página inicial carrega automaticamente o manifesto e o resumo dos órgãos partidários. Em `contas.html`, os índices de candidaturas e órgãos são carregados em paralelo, e os dados de uma conta só quando ela é aberta. Mantém até cinco contas na memória da aba e rejeita dados de uma versão diferente do índice. Não há IndexedDB, localStorage ou service worker.

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

## Visão geral dos partidos

A página inicial contém um único painel com as abas Mosaico, Fluxo e Grafo. O mosaico tem três medidas: receitas declaradas, despesas contratadas e despesas pagas. O primeiro nível inclui todo o Brasil e todas as esferas, usando a última prestação de cada órgão, sem filtros. A legenda inclui todos os partidos em ordem alfabética e permite acessar blocos pequenos e itens sem área.

O mosaico é um mapa de retângulos inspirado no Coin360. A área de cada bloco é proporcional ao valor conhecido da medida selecionada. As cores identificam os partidos, sem atribuir variações temporais aos dados. Os blocos mostram sigla, valor e participação conforme o espaço disponível; toque, foco ou mouse revelam o valor exato. Um botão pequeno no canto superior esquerdo volta um nível, ficando desabilitado na visão geral. O caminho ao lado permite retornar diretamente a um nível anterior; o total aparece à direita. Cada medida conserva sua navegação durante a alternância. O mosaico se adapta à largura da tela sem alterar as proporções financeiras.

O clique em um bloco abre suas subdivisões: partido → esfera → estado → conta do órgão. Na conta, receitas se dividem por fonte, depois origem e remetente; despesas se dividem por categoria e fornecedor declarado. Os nomes seguem os arquivos oficiais; valores sem nome aparecem como “Não informado”. Níveis com uma única parcela são pulados até a próxima subdivisão. Quando não existem subparcelas, o clique apenas mostra o valor e mantém o gráfico atual. Categorias negativas e parcelas incompletas continuam acessíveis. Blocos e itens da legenda respondem ao mouse, ao toque e ao teclado, mostrando valores exatos, participações e somas parciais. A fonte e a data da publicação ficam discretamente no painel, com um botão para atualizar.

Os detalhes das contas são carregados sob demanda e precisam ter a mesma data de publicação do resumo. Variações de caixa no tipo da prestação são reunidas somente quando data e turno também coincidem, preservando os totais do resumo. Cada nível usa a soma conhecida como denominador. Valores zero e contas sem lançamentos não recebem área; registros sem valor continuam identificados. Se houver totais negativos, os valores permanecem acessíveis na legenda e nos detalhes da seleção.

A aba **Fluxo** mostra um diagrama com origens (ou fontes) dos recursos → partidos → categorias das despesas. As saídas alternam entre pagamentos e contratos, usando a mesma escala monetária que as entradas. Os dois lados conservam seus totais declarados, sem criar um saldo para igualá-los e sem atribuir uma doação a um fornecedor. Clique em um partido para focar suas entradas e despesas; o botão de voltar retorna um passo. Categorias menores ficam em um grupo expansível, preservando os valores. Mouse, toque e teclado revelam valores exatos e destacam as ligações relacionadas. A navegação é mantida ao alternar as abas; telas pequenas permitem rolar o gráfico horizontalmente.

As categorias de despesas são incluídas no resumo compactado durante a publicação, com a última prestação de cada conta, dispensando o carregamento das contas individuais para desenhar o fluxo. Publicações anteriores sem essas categorias mostram explicitamente a ausência do detalhamento, mantendo os totais conhecidos. Valores negativos impedem o desenho de ligações que esconderiam seus sinais; valores e registros incompletos continuam acessíveis nos itens.

O agrupamento inclui todos os órgãos por padrão. São valores **brutos de movimentação**, não uma consolidação de recursos novos: transferências entre diretórios podem reaparecer como receita. Não se deduzem repasses sem conciliação. A navegação pelos blocos permite entrar na esfera nacional ou em outra esfera. Candidaturas não entram nesses totais.

Por conta, considera-se apenas a prestação mais recente compatível com o recorte, pela data; em empate, final precede parcial e relatório financeiro. A opção inicial pode reunir tipos e datas diferentes entre órgãos; a cobertura é explicitada. `Parcial` e `PARCIAL` são unificados para associar os três CSV da mesma prestação. Datas e turnos distintos permanecem separados na consulta individual. Valores ausentes são identificados e a soma conhecida é marcada como parcial; tabelas sem lançamentos não viram zero. Categorias sem lançamentos não recebem zero presumido quando o total de receitas é incompleto.

## Visão dos candidatos

`candidatos.html` reutiliza o painel de mosaico, fluxo e grafo, com navegação entre Partidos e Candidatos. O mosaico mostra receitas declaradas, despesas contratadas ou despesas pagas. A visão geral agrupa por cargo; o clique abre os estados e depois as candidaturas. Quando um estado contém muitas contas, grupos alfabéticos de até 12 blocos por nível permitem chegar a cada candidatura sem excluir nomes por valor. A busca por nome, número, partido, cargo ou UF dá acesso direto, com resultados paginados e homônimos mantidos em contas distintas. Itens sem área permanecem acessíveis pela legenda e pela busca.

Os detalhes seguem fontes → origens → remetentes nas receitas e categorias → fornecedores nas despesas, carregados sob demanda. O botão de voltar retorna um nível; cada medida mantém seu caminho. O fluxo segue a mesma navegação por cargo, estado, grupo e candidatura e mostra origens/fontes → candidaturas → categorias das despesas, com pagamentos separados dos contratos. As categorias pequenas são expansíveis. Não são criadas ligações entre as bases de partidos e candidatos nesta etapa.

O resumo dos candidatos é publicado com os mesmos totais, categorias e data dos arquivos individuais. Usa somente a última prestação de cada conta, incluindo a normalização de maiúsculas e minúsculas no tipo; datas e turnos distintos continuam separados. Identificadores de eleição, prestador e candidatura, nome, número, cargo, UF e partido são preservados para a consulta. Os totais abrangem apenas contas presentes nos arquivos oficiais, e não um cadastro completo de candidatos registrados.

## Grafo de relações financeiras

A aba **Grafo**, disponível nas duas bases, conecta origens ou fontes dos recursos → partidos ou grupos de candidaturas → categorias das despesas. Setas indicam a direção dos lançamentos. Nós e linhas têm tamanho constante: selecionar um nó mostra os totais; selecionar uma ligação mostra o valor declarado daquela relação, incluindo registros sem valor. Categorias negativas permanecem no grafo com linhas tracejadas e o sinal explícito nos detalhes. Os totais são os mesmos do fluxo, mantendo contratos e pagamentos separados.

Arraste os nós para reorganizar a rede ou o fundo para mover a visão. Use os botões de zoom, a roda do mouse ou dois dedos no celular; “Ajustar” enquadra a rede inteira. O teclado permite selecionar nós e ligações, ampliar com +/−, mover com as setas e ajustar com 0. Nós com + abrem o partido, cargo, estado, grupo de candidaturas ou categorias agrupadas; o botão de voltar retorna um passo. Busca e legenda também abrem a seleção no grafo. Histórico, zoom e posições são preservados ao alternar as abas; a atualização da publicação reinicia a navegação. Não há conciliação automática de doações entre as duas bases.

## Interpretação

- Receitas, despesas contratadas e despesas pagas são bases distintas. Nunca somamos contratado e pago nem calculamos saldo a partir dessas tabelas.
- A classificação de fonte (`DS_FONTE_RECEITA`) é mantida separada da origem (`DS_ORIGEM_RECEITA`) e da natureza (`DS_NATUREZA_RECEITA`). Categorias oficiais desconhecidas continuam identificadas pelo texto original.
- “Outros recursos” não é automaticamente uma doação privada. Repasse de partido não identifica, sozinho, o fundo utilizado. Recursos de campanha não representam patrimônio pessoal.
- Cada conta usa `CD_ELEICAO` e `SQ_PRESTADOR_CONTAS`. Tipos, datas e turnos diferentes de prestação têm seleções separadas, sem somar parcial, final ou retificadora.
- O arquivo nacional `BRASIL` é escolhido uma única vez. CSV estaduais e tabelas de doadores originários não são somados novamente. Contas de diretórios e candidaturas são consultadas separadamente para evitar contar repasses como recursos novos.
- Identificadores são texto; valores monetários são inteiros em centavos. Formatos inesperados interrompem o carregamento com uma mensagem em português.
- Sem tabela é “não disponível”. Sem lançamentos para uma conta é “sem lançamentos”. Valor ausente não vira zero. Os totais com valores ausentes são marcados como incompletos.
- A lista inclui apenas contas presentes nas tabelas carregadas; não pretende enumerar todas as candidaturas registradas.
- Médias aritméticas agrupam contas pela mesma eleição, UF, cargo, tipo de prestação e turno. Usa-se apenas a prestação mais recente daquele tipo/turno por conta. A média inclui a conta selecionada, exige duas contas válidas e não depende dos filtros da lista. Datas podem diferir entre contas; a média não representa limite legal, gasto ideal nem patrimônio pessoal.
- Por tabela, contas sem lançamentos ou com valores monetários ausentes são excluídas. Categorias ausentes valem zero apenas nas contas com lançamentos completos da tabela. As médias por categoria usam o mesmo denominador da tabela, incluindo contas sem lançamentos naquela categoria. O número de contas e as exclusões são exibidos; a consulta a prestações anteriores não mostra comparação.
- Os nomes dos remetentes são agrupados pela combinação exata de nome, origem, fonte e natureza; homônimos podem existir. Não publicamos CPF/CNPJ dos doadores. Fornecedores não são incluídos como doadores; doações de empresas são proibidas, conforme a [explicação oficial do TSE para 2026](https://www.tse.jus.br/comunicacao/noticias/2026/Maio/por-dentro-das-eleicoes-saiba-de-onde-podem-vir-os-recursos-de-campanha).
- A navegação apresenta contas em ordem alfabética. Os lançamentos podem ser ordenados por valor, data ou nome; valores e datas ausentes ficam no final, e a paginação acontece depois da ordenação. A busca é a primeira etapa, com a escolha da base e a data de atualização. Não existe painel separado de carregamento. As etapas são verticais e “Como ler os dados” abre um diálogo acessível, que também contém os controles de recarregar e importar ZIP.
- O botão de baixar resumo foi removido. As fontes, arquivos, datas e identificadores das contas continuam disponíveis na tela.

## Estrutura

`site/` contém a página, estilos, interface, parser, leitor ZIP, estatísticas por grupo e leitor de contas publicadas. `relay/` contém o encaminhamento opcional. `tests/` usa apenas registros sintéticos criados durante os testes, sem dados eleitorais reais. `scripts/build.mjs` prepara a página e `scripts/refresh-data.mjs` consulta e processa os arquivos oficiais.

Os testes de parser, integridade dos ZIP, associação de pagamentos, prestações separadas, atualização de publicação e relay são independentes da disponibilidade do TSE. Valide uma execução completa e o comportamento da página publicada antes de compartilhar o site.

Validação local realizada com os arquivos oficiais obtidos em 7 de outubro de 2026: processamento das duas bases, 70 testes automatizados e navegação de candidaturas e órgãos partidários no navegador, incluindo mosaico, fluxo e grafo por partido e candidatura, zoom e arraste da rede, expansão de categorias, gestos de dois dedos no celular, busca e grupos alfabéticos de candidatos, proporções e ausência de sobreposição dos retângulos, alternância de medidas e abas, navegação por blocos até fontes, origens e contrapartes, conservação dos totais entre níveis, legenda, retorno de um nível pelo botão e pelo caminho de navegação, consulta de contas, tela móvel e texto ampliado em 200%. O navegador de verificação não ofereceu WebMCP; a validação dessa integração opcional ficou indisponível, sem afetar a interface.
