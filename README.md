# T20 — Construtor de Ficha

Wizard passo a passo para criar personagens de **Tormenta20** no Foundry VTT e assistente para **subir de nível** (habilidades, poderes, magias e multiclasse).

Requer Foundry **v14** e o sistema **Tormenta20 ≥ 1.6.7**.

> **Direitos autorais.** Tormenta20 e os textos dos livros reproduzidos neste módulo (descrições de origens, divindades, escolas de magia, idades, raças, classes e poderes definidos pelo construtor, incluindo conteúdo do *Bestiário de Arton*, do *Heróis de Arton* e da *Dragão Brasil*) são protegidos por direitos autorais da **Jambô Editora**. Este módulo é para uso pessoal: **não compartilhe nem redistribua esse conteúdo**. As descrições que o construtor grava na ficha levam o mesmo aviso.

## Como usar

- **Diretório de Atores → "Criar personagem (wizard)"**: cria um personagem e abre o construtor.
- Criar um ator do tipo _Personagem_ pelo botão padrão também abre o construtor (configurável).
- Na ficha de um personagem ainda sem raça/classe, o botão **Construtor** no cabeçalho reabre o wizard.
- As escolhas ficam salvas como rascunho no ator: dá para fechar e continuar depois.
- Nada é gravado na ficha até clicar em **Criar personagem** no último passo.
- Num personagem já criado, o botão **Subir de nível** no cabeçalho da ficha (ou o **+** ao lado da classe e nível) abre o assistente de subir de nível. Veja [Subir de nível](#subir-de-nível).

Jogadores precisam da permissão **"Criar novos atores"** (Configurações → Permissões do usuário). Para escolher retrato e token pelo navegador de arquivos, também precisam de **"Navegar por arquivos"** (e **"Enviar arquivos"** para subir imagens novas).

## Passos

1. **Raça**: painel com as raças do compêndio, modificadores e habilidades raciais; escolha dos +1 flexíveis (Humano, Lefou, Osteon, Sereia/Tritão) e das escolhas das habilidades raciais:
   - resistência/imunidade: _Fonte Elemental_ (Golem), _Resistência Elemental_ (Qareen);
   - magias: _Magia das Fadas_ (Sílfide), _Canção dos Mares_ (Sereia/Tritão), _Tatuagem Mística_ (Qareen);
   - perícias ou poder: _Versátil_ (Humano), _Híbrido_ (Kliren), _Memória Póstuma_ (Osteon), _Deformidade_ (Lefou, +2 em perícias ou poder da Tormenta), _Propósito de Criação_ (Golem, poder geral; o Golem não escolhe origem).

   Trocar de raça descarta essas escolhas. Na ficha, a escolha vira efeito no próprio poder (imunidade, redução 10, +2 nas perícias, redutor de –1 PM nas magias escolhidas); magias raciais (inclusive as fixas de Aggelus, Sulfure e Dahllan) entram com o atributo-chave da raça.

2. **Atributos**: compra de pontos (10 pontos, com placar), rolagem (4d6 descarta o menor, enviada ao chat, uma vez só) ou valores fixos. O mestre escolhe quais modalidades são permitidas.
3. **Classe**: PV, PM, perícias, proficiências e habilidades de 1º nível; escolhas como Caminho do Arcanista e Linhagem do Feiticeiro, e o que cada uma pede:
   - _Linhagem Dracônica_: tipo de dano (ácido, eletricidade, fogo ou frio) da redução 5;
   - _Linhagem Feérica_: Enganação treinada e 1 magia de 1º círculo de encantamento ou ilusão;
   - _Linhagem Rubra_: 1 poder da Tormenta;
   - _Linhagem Abençoada_ (nova): um deus maior, 1 magia divina de 1º círculo, e as magias divinas de 1º círculo passam a valer como magias de feiticeiro (o poder concedido do 2º nível fica na descrição);
   - _Mago_: 4 magias iniciais em vez de 3.

   Trocar classe, Caminho ou Linhagem descarta as escolhas que deixaram de valer. Outras escolhas de classe ficam nos passos delas: _Especialista_ (Ladino) no passo Perícias; _Espólio_ (Nobre, item de até T$ 2.000) e _Protótipo_ (Inventor, item superior com uma melhoria ou até 10 itens alquímicos, total até T$ 500) no passo Equipamento.

4. **Magias** (classes conjuradoras): magias de 1º círculo do tipo da classe; Bardo e Druida escolhem 3 escolas antes.
5. **Perícias**: obrigatórias da classe, escolhas da classe e perícias extras pelo valor de Inteligência.
6. **Origem**: itens e 2 benefícios (perícias, poderes ou um poder de um grupo). Com o homebrew ligado: origem profissional + regional.
7. **Devoção**: opcional, ou obrigatória para Clérigo, Druida e Paladino (Druida só Aharadak, Allihanna, Megalokk, Oceano e Tenebra, ou Druida de Arton; Paladino só Azgher, Khalmyr, Lena, Lin-Wu, Marah, Tanna-Toh, Thyatis e Valkaria). Fora essas listas, qualquer raça ou classe pode seguir qualquer deus (os devotos de cada deus aparecem só como informação). 1 poder concedido (2 para Clérigo e Druida). Alternativas sem divindade e sem poder concedido: Paladino do Bem, Clérigo (e Frade) devoto do Panteão e Druida de Arton; em compensação, recebem o poder **Devoção Ampla** (+2 PM por patamar, com a explicação dos patamares de jogo). Quem segue um deus pode ser **devoto fundamentalista**: escolhe um poder concedido extra, e a ficha registra a devoção como “Deus (fundamentalista)”.
8. **Equipamento**: kit básico, itens da classe e da origem, uma arma simples e, com proficiência em armas marciais, também uma arma marcial; armadura de couro (ou brunea, com proficiência em armaduras pesadas); escudo leve automático com proficiência em escudos. O botão **Vender itens** (no cabeçalho, liberado depois de fazer todas as escolhas do passo) abre um slideout onde se marcam vários itens iniciais de uma vez, vendo o total que vai para a carteira (metade do preço de cada); **Confirmar venda** aplica e tira os itens da tela, e reabrir o slideout permite desmarcar.
9. **Dinheiro**: 4d6 T$, rolado no chat, uma vez só.
10. **Revisão**: nome, retrato e token (pelo navegador de arquivos do Foundry ou colando o caminho; o token pode usar o retrato) e resumo de tudo.

Na ficha, poderes e magias recebem um prefixo com a origem: "R - " (raça), "O - " (origem), "D - " (concedidos pela divindade), "C - " (complicação), "I - " (idade) e "1 - " (classe, 1º nível). Uma magia dada por um poder leva o prefixo desse poder (ex.: a magia de uma habilidade racial entra como "R - ").

## Subir de nível

Assistente em passos, com a mesma barra lateral do construtor; só aparecem os passos que o nível tiver. Podem usar o mestre e o dono do personagem. Configuração **Subir de nível** (ligada por padrão); desligada, o **+** da ficha volta a abrir o compêndio de classes.

1. **Classe**: continuar numa classe que o personagem já tem ou começar uma nova (**multiclasse**). Não é possível ter uma classe básica e uma variante dela (as bloqueadas aparecem com o motivo). O 1º nível da classe nova dá os PV de um nível seguinte, não dá as perícias nem as proficiências dela e pede as escolhas de 1º nível (ex.: Caminho do Arcanista; a Linhagem só para o Feiticeiro).
2. **Nível**: PV, PM, bônus de perícia, círculo de magia novo, habilidades fixas do nível e os valores que crescem (ex.: Ataque Especial +8). Escolhas de habilidades: Caminho do Cavaleiro, Bênção da Justiça, Escola de Duelo, Lorde do vassalo… e escolhas anotadas que se acumulam (terreno do Explorador).
3. **Poder**: um poder de classe ou, no lugar, um poder geral. Os pré-requisitos são lidos das descrições dos poderes nos compêndios e conferidos na ficha (atributo, nível de classe ou de personagem, perícia, poder, magia, devoção, escola…); o que não dá para conferir aparece como aviso, sem bloquear. Poderes repetíveis ou com escolha ("escolha uma arma") têm um campo de anotação. Poderes gerais de outras raças não aparecem; poderes de distinção só aparecem para quem tem a marca da distinção (as marcas são postas à mão).
4. **Magias**: as magias que o nível ensina (Feiticeiro só em nível ímpar, Mago +1 do círculo novo, Bardo e Druida em nível par e só das suas escolas; Usurpar recebe todas as do círculo novo). Fichas criadas antes desta versão escolhem as escolas uma vez. As magias novas recebem o atributo-chave da classe.
5. **Revisão**: tudo o que vai entrar na ficha.

Poderes que ensinam magias ao serem escolhidos (Conhecimento Mágico, do arcanista, do clérigo e do frade, e Aumentar Repertório) abrem as vagas no passo Magias, mesmo num nível sem magia nova; as do Aumentar Repertório aceitam magias arcanas ou divinas. Classes que já aprendem todas as magias (Usurpar) não ganham vagas com eles. Eles podem ser escolhidos quantas vezes o jogador quiser; se restarem menos magias para aprender do que o poder ensina, ele abre só as vagas que dá para preencher. Poderes repetíveis são reconhecidos pelo texto ("outras vezes", "várias vezes", "quantas vezes quiser"…); os limitados ("duas vezes", "até três vezes") deixam de aparecer ao atingir o limite. Na ficha, os poderes e as magias ganhos recebem o nível como prefixo (`4 - Esgrimista (Guerreiro)`, `5 - Bola de Fogo`). Quando o sistema não faz um valor crescer sozinho, o assistente atualiza a rolagem do poder (Ataque Furtivo, Palavras Afiadas, Domar Criatura) ou anota o valor na descrição (Briga, Fabricar Item Superior). **Desfazer último nível** (na barra lateral) remove o que o nível acrescentou e restaura o que ele alterou, inclusive a classe nova da multiclasse; só o último nível pode ser desfeito. Ao subir, uma animação de "level up" aparece para quem subiu.

Classes com progressão: as 14 do livro básico, as variantes da *Dragão Brasil* (Capanga, Cruzado, Comandante e Sentinela, que funcionam sem o suplemento) e, com os Suplementos de Arton, Treinador, Frade, Samurai, Místico, Miragem e as 14 variantes do *Heróis de Arton*. Classes sem progressão cadastrada continuam subindo pelo sistema (botão **Outra classe (compêndio)**).

## Regras opcionais do sistema

- **Raças Abertas** (configuração do sistema Tormenta20): quando ligada, cada modificador de atributo da raça pode ir para qualquer atributo, no máximo um modificador por atributo (um anão distribui +2, +1 e −1; um aggelus, +2 e +1). Raças com +1 flexível entram com seus +1 nessa mesma distribuição (o lefou distribui +1, +1, +1 e −1). O construtor lê a configuração do sistema; nada a ligar no módulo.
- **Usar Complicações** (configuração do construtor, desligada por padrão; requer os Suplementos de Arton): acrescenta a etapa **Complicações**, depois da Devoção, com as complicações gerais e as da classe escolhida (variantes usam as da classe básica), lidas do Heróis de Arton. É opcional escolher uma; quem escolhe recebe também um poder geral. Na ficha, os dois entram com o prefixo "C - ", depois dos poderes de classe. Complicações nunca aparecem nas listas de poder geral.
- **Usar Idades Variadas** (configuração do construtor, desligada por padrão): acrescenta a etapa **Idade**, depois de Complicações, com as faixas etárias do Tormenta20 (cap. 4): Criança, Adolescente, Jovem (padrão, sem modificadores), Adulto, Maduro, Velho e Ancião. As idades de cada faixa são ajustadas pela raça (anões, meio-elfos e qareen ×2 a partir de adulto; elfos, dahllan, duendes, eiradaan, golens, osteon, sátiros e sílfides ×5; goblins e trogs ×0,7). Os modificadores de atributo da faixa entram no valor base (e aparecem na coluna "Idade" da tabela de atributos). **Criança**: Tamanho Menor (uma categoria abaixo da raça), Protegido dos Deuses (+2 Defesa, +5 em resistências) e Sem Origem (os passos de origem somem). **Adolescente**: Ímpeto Juvenil (+3 PM) e Origem em Construção (1 benefício; com origem mundana, uma perícia de classe a menos). **Adulto**: Já Vi Coisas, um poder geral opcional que traz uma complicação de idade. **Maduro/Velho/Ancião**: 2/3/4 complicações de idade obrigatórias, entre as 19 do livro (as numéricas já têm efeito na ficha, ex.: Catarata –5 em Percepção e Pontaria). A faixa e a idade em anos ficam nas Notas da ficha; os níveis extras da faixa são subidos no assistente de subir de nível, que abre ao terminar a criação e mostra quantos ainda faltam. Na ficha, as habilidades da faixa recebem o prefixo "I - " e as complicações de idade (e o poder de Já Vi Coisas), "C - ".
- **Atributos Variados** (configuração do construtor, desligada por padrão): acrescenta às modalidades de atributos os métodos Clássica (3d6 por atributo), Épica (3d6, descarta o menor, +6), Valkaria (atributos começam em 8; 7d6 aplicados como o jogador quiser, vários dados no mesmo atributo), Khalmyr (3, 3, 2, 1, 0, −1) e Nimb (7d20 descartando o menor; 1–3 → −3, 18–19 → +4, 20 → +5). Todos convertem pela tabela de Tormenta20, p. 17, e as rolagens vão para o chat, uma vez só. A configuração **Clássica em ordem** faz a Clássica cair direto em For, Des, Con, Int, Sab, Car, sem distribuir.

## Dados

Raças, classes, poderes, magias e equipamentos vêm dos compêndios do sistema. O que o sistema não traz fica em `data/`:

| Arquivo                  | Conteúdo                                                                                        |
| ------------------------ | ----------------------------------------------------------------------------------------------- |
| `racas.json`             | escolhas das habilidades raciais e magias raciais fixas                                         |
| `poderes-classe.json`    | escolhas das habilidades de classe de 1º nível                                                  |
| `progressao.json`        | subir de nível: habilidades, escolhas, valores e magias de cada nível (1–20) por classe         |
| `pre-requisitos.json`    | subir de nível: correções dos pré-requisitos lidos das descrições dos compêndios                |
| `suplementos.json`       | Suplementos de Arton: variantes de classe, regras de classes e classes ignoradas                |
| `classes.json`           | perícias, proficiências, habilidades de 1º nível, magias iniciais, devoção, itens extras        |
| `origens.json`           | descrição, itens e benefícios das 35 origens do livro básico                                    |
| `origens-regionais.json` | origens regionais (homebrew); ainda vazio                                                       |
| `divindades.json`        | os 20 deuses maiores: descrição, crenças, símbolo, energia, arma, devotos, poderes e obrigações |

Raças que os compêndios não trazem são montadas em `scripts/dados.js` → `RACAS_DO_CONSTRUTOR`: **Elfo-do-Gelo** (*Bestiário de Arton*; Sab +2, Des +1, Con –1; Graça de Beluhga — deslocamento 12m —, Herança Gélida — redução de frio 10 e +1d4 de frio no dano — e Sentidos Glaciais — visão na penumbra e +2 em Percepção e Sobrevivência), **Salamandra** (*Bestiário de Arton*; Con +2, Des +1, Car –1; Calor Natural — +1d6 de fogo nos ataques, como opção ao atacar —, Cauda — arma natural 1d6 de perfuração —, Cria das Chamas — tipo espírito, redução de fogo 10, visão no escuro — e Fraqueza Glacial), **Manotauro** (*Bestiário de Arton*; For +2, Con +1, Int –1, Sab –2; Cascos e Chifres — armas naturais 1d8 —, Corpulento — Grande, deslocamento 12m — e Medo de Altura; as habilidades são exclusivas da raça e não trocam os Chifres do minotauro nem os Cascos do centauro) e **Lâmia** (*Bestiário de Arton*; Car +2, Sab +1, Con –1; Corpo Felino — Grande, deslocamento 12m —, Magia das Lâmias — 2 magias entre Criar Ilusão, Compreensão, Disfarce Ilusório e Visão Mística, atributo-chave Carisma —, Natureza Predadora — tipo monstro, visão no escuro, +2 em Enganação e Furtividade — e Toque Psíquico — arma natural 1d6 psíquico), em um grupo próprio na lista de raças; e variantes a partir de uma raça do sistema: **Sahiri** (variante de dahllan: mesmos atributos e Empatia Selvagem; Animar Rochas — com _Conjurar Monstro_ na ficha e redutor de –1 PM — e Proteção da Terra no lugar de Amiga das Plantas e Armadura da Natureza). Poderes que os compêndios não trazem são definidos em `scripts/dados.js` → `PODERES_DO_CONSTRUTOR` (descrição, ícone, efeitos e restrições). Entre eles, os novos poderes de Caçador do `novo-mistico.pdf` (**Arsenal do Deserto**, com +2 no dano automático com azagaia, cimitarra e lança; **Escaramuça Distante**; **Passo Duplo**; **Passos Precisos**, com +2 na margem de ameaça ao atacar; **Tesouros da Natureza**), que substituem os homônimos do suplemento, as origens regionais de **Halak-Tûr** (Criança do Crepúsculo, Nascido nas Estepes, Nômade Ferani — cada uma com os seus itens, que entram no equipamento quando é escolhida; funcionam mesmo sem o suplemento, criando a região se o Atlas não estiver carregado) e o poder concedido **Canção da Pedra** (Allihanna e Megalokk; só druidas e variantes de druida podem escolher; dá _Transmutar Objetos_ na ficha e o redutor de –1 PM para _Transmutar Objetos_ e _Controlar Terra_).
| `equipamento.json` | kit inicial, armaduras e escudo |

Todos os nomes são buscados nos compêndios. Ao carregar, o mestre vê no console qualquer nome que não exista mais.

Origens (p. 85–95), divindades (p. 96–105) e escolas de magia (p. 172) foram conferidas com o livro, incluindo descrições, devotos e obrigações.

> ⚠️ Ainda a conferir com o livro: equipamento inicial por classe, quantidade de magias iniciais e a regra de rolar novamente o menor atributo.

## Suplementos de Arton (opcional)

Integração com o módulo [Suplementos de Arton](https://github.com/mobguilherme/Suplementos-de-Arton), **desligada por padrão**. O mestre liga em _Configurações → Construtor de Ficha_:

- **Suplementos de Arton: usar conteúdo** — chave geral. Só tem efeito com o módulo instalado e ativo; se ele estiver desativado, o mestre recebe um aviso e o construtor usa só o livro básico.
- Uma chave por tipo de conteúdo (todas ligadas por padrão, valem só com a chave geral ligada):
  - **Raças** (47): atributos e habilidades raciais, listadas por livro (básico, Heróis de Arton, Ameaças de Arton, demais) e com busca por nome. Quando a raça só traz o texto do +1 flexível ("+1 em dois atributos"), a regra é deduzida do texto e o painel avisa. Habilidades com escolha cadastradas em `racas.json`: Plurivalente (Minauro), Papel Tribal (Ceratops), Herança Dracônica (Kallyanach), Chassi (Mashin), Esperteza Vulpina e Sapiência (Moreau), Adaptável (Meio-Orc), Natureza Orgânica (Yidishan), Resquícios da Outra Vida (Vampiro), Terror Vivo (Kaijin), Infância entre os Pequenos (Galokk), Ambição Herdada (Meio-Elfo), Tabu, Presente, natureza e tamanho (Duende), material e fonte de energia (Golem de Ameaças); magias concedidas: Cura das Águas (Kappa), Instrumentista Mágico (Sátiro); Arte da Guerra (Hobgoblin) dá Guerra e proficiência com armas marciais. **Suraggel variante**: aggelus e sulfure (do livro básico) podem trocar Luz Sagrada / Sombras Profanas (e a magia delas) por uma das 22 heranças divinas do Heróis de Arton; a Herança de Drashantyr não está nos dados do suplemento e é definida pelo próprio construtor (`scripts/dados.js` → `PODERES_DO_CONSTRUTOR`), com descrição e efeitos (+1 PM e redução 5 de ácido, eletricidade, fogo, frio, luz e trevas); se o suplemento passar a trazê-la, vale a dele.
  - **Classes** (19): perícias e proficiências não existem nos dados do suplemento. As variantes de classes básicas listadas em `data/suplementos.json` herdam perícias e proficiências da classe base; A **Miragem** é substituída pela classe variante **Miragem (Caçador)**, cadastrada em `data/suplementos.json` → `classes`: PV como o caçador, 3 PM por nível, perícias da variante, proficiências do caçador e, no 1º nível, Dança da Areia (+1d4 no dano, aumentando com PM) e Rastreador; Cortina de Poeira, Passo do Deserto e Mestre do Deserto existem como poderes (níveis 7, 9 e 20). As demais 18 classes têm as perícias do livro cadastradas como texto em `data/suplementos.json` → `periciasClasses` (o construtor interpreta o texto, no mesmo formato do livro básico, e entende também "Como o <classe> básico" e "mas seu Ofício inicial é <ofício>"); nas variantes, as perícias vêm do texto e as proficiências da classe básica; classes sem nada cadastrado pedem ao jogador que indique as perícias treinadas no passo Perícias. Proficiências: só as básicas, salvo variantes. Habilidades de 1º nível, magias iniciais e devoção são deduzidas dos poderes da classe; habilidades alternativas ("Tipo: Animal", "Tipo: Monstro"…) viram uma escolha. O **Usurpador** não escolhe magias: como Usurpar permite lançar qualquer magia divina dos círculos acessíveis, o passo Magias lista todas as magias divinas (e universais) de 1º círculo e todas vão para a ficha, com Carisma como atributo-chave. O painel da classe mostra um aviso. Regras completas podem ser cadastradas em `data/suplementos.json` → `classes`, no formato de `classes.json`.
  - **Poderes**: poderes gerais dos suplementos nas listas de escolha (as habilidades de raças e classes dos suplementos funcionam mesmo com esta chave desligada).
  - **Magias** (61).
  - **Itens**: armas, armaduras e itens mundanos na loja e no equipamento inicial (itens mágicos, artefatos e itens litúrgicos ficam de fora). Ajustes manuais da loja ficam em `data/suplementos.json` → `loja` (`categorias` para trocar a categoria de um item, `incluir` para itens sem preço no compêndio, como a Trombeta do Cruzado).
  - **Divindades**: poderes concedidos novos para os deuses maiores e os deuses menores do _Guia de Deuses Menores_ (sem restrição de devotos, que não está nos dados).
  - **Origens mundanas** (Heróis de Arton, 30): aparecem no passo Origem, depois das do livro básico. Cada uma concede um único poder com as perícias que ele treina (cadastradas em `data/suplementos.json` → `origensMundanas`), sem itens nem escolha de benefícios; Citadino Abastado escolhe um Ofício e Menestrel uma Música de bardo. Ofícios que o sistema não tem como perícia (pescador, barbeiro, pedreiro, serviçal, coureiro, escriba) aparecem como anotação.
  - **Origens regionais**: o passo Origem regional (homebrew de origem dupla) passa a listar as regiões do _Atlas de Arton_, cada uma com seus poderes regionais.
- Mudar qualquer chave vale para os construtores abertos depois. Se o mestre desligar algo no meio de uma criação, as escolhas que vinham do suplemento são descartadas e o passo volta a pedir a escolha.
- Conteúdo de suplemento aparece com uma etiqueta do livro de origem (ex.: _Heróis de Arton_).

O suplemento foi feito para Foundry v13 / Tormenta20 1.5. O Foundry converte os dados ao carregar, mas vale conferir na ficha os efeitos dos poderes vindos dele. As _Distinções_ não entram: não são de 1º nível.

## Limitações conhecidas

- Subir de nível: escolhas internas de algumas habilidades não são pedidas (ex.: tipo de dano da Linhagem Dracônica na multiclasse, magias da Linhagem Rubra Aprimorada, truques do Melhor Amigo, Poder Capturado); itens concedidos por habilidades (item superior do Inventor, montarias) ficam só na descrição.
- Subir de nível com os Suplementos de Arton: muitos efeitos do suplemento (feito para Tormenta20 1.5) têm valores fixos que deveriam crescer; o valor da tabela vai para a descrição do poder. A Afinidade do místico não fica registrada, então os pré-requisitos "Afinidade (…)" são aviso.
- Classes da *Dragão Brasil* (Capanga, Cruzado, Comandante, Sentinela): nenhum compêndio as traz, então o construtor as define (`scripts/dados.js` → `CLASSES_DO_CONSTRUTOR` e `PODERES_DO_CONSTRUTOR`, regras em `classes.json` e `progressao.json`). Os 2 direcionamentos iniciais do comandante não são pedidos na criação (anote-os; os seguintes são pedidos ao subir de nível). O sentinela começa com 12 PV (o sistema calcula 16 a partir dos 4 PV por nível; o *Caminho do Sentinela* aplica –4 PV) — como classe adicional (multiclasse), esse –4 não deveria valer: ajuste à mão.
- Somente conteúdo do livro básico (Jogo do Ano), a menos que a integração com os Suplementos de Arton esteja ligada.
- Clérigo devoto do Panteão: a escolha entre energia positiva e negativa não é registrada.
- Foco do Bruxo e grimório do Mago não são adicionados como itens.
- _Espólio_ oferece só itens da loja do livro básico (não monta itens superiores).
- _Memória Póstuma_: a alternativa "osteon de outra raça" (ganhar uma habilidade dessa raça) não é oferecida.
- Para não abrir o diálogo de atributos raciais do sistema, o módulo substitui `_onCreateOwnedRace` apenas para raças criadas pelo construtor.

## Desenvolvimento

Ferramentas em `ferramentas/` (fora do `module.zip`):

- `node ferramentas/testar-nivel.mjs [Classe…] [-v]`: sobe cada classe de 1 a 20 com os compêndios do sistema (repositório Tormenta20 em `../Tormenta20`) e roda o código real de gravação e desfazer contra um ator simulado; também confere casos de pré-requisito e de multiclasse.
- `node ferramentas/testar-construtor.mjs [--atualizar] [-v] [--telas=arquivo]`: carrega o construtor de verdade (Foundry simulado, dados pelo `carregarDados` real), preenche 8 personagens de exemplo (incluindo um com o suplemento, Idades Variadas e complicação) e compara passos, pendências, o plano final, se cada tela monta e a cascata de invalidações ao trocar escolhas (raça, classe, origem, divindade…) com o retrato salvo (e confere que todo `data-action` dos templates tem ação registrada) em `ferramentas/retratos/construtor.json`. Qualquer mudança no resultado falha; depois de conferir que a mudança é a desejada, `--atualizar` grava o retrato novo. `--telas=arquivo` grava o contexto completo de cada tela, para comparar duas versões numa refatoração.
- `(cd ferramentas && npm install) && node ferramentas/extrair-suplemento.mjs`: extrai os compêndios do Suplementos de Arton (repositório em `../Suplementos-de-Arton`) para o cache usado pelo teste. Sem o cache, as classes do suplemento são puladas.
- `ferramentas/previa-animacao.html`: prévia da animação de subir de nível (sirva a pasta do módulo por HTTP).
