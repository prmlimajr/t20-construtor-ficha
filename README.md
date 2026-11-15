# T20 — Construtor de Ficha

Wizard passo a passo para criar personagens de **Tormenta20** (nível 1) no Foundry VTT.

Requer Foundry **v14** e o sistema **Tormenta20 ≥ 1.6.7**.

## Como usar

- **Diretório de Atores → "Criar personagem (wizard)"**: cria um personagem e abre o construtor.
- Criar um ator do tipo *Personagem* pelo botão padrão também abre o construtor (configurável).
- Na ficha de um personagem ainda sem raça/classe, o botão **Construtor** no cabeçalho reabre o wizard.
- As escolhas ficam salvas como rascunho no ator: dá para fechar e continuar depois.
- Nada é gravado na ficha até clicar em **Criar personagem** no último passo.

Jogadores precisam da permissão **"Criar novos atores"** (Configurações → Permissões do usuário). Para escolher retrato e token pelo navegador de arquivos, também precisam de **"Navegar por arquivos"** (e **"Enviar arquivos"** para subir imagens novas).

## Passos

1. **Raça**: painel com as raças do compêndio, modificadores e habilidades raciais; escolha dos +1 flexíveis (Humano, Lefou, Osteon, Sereia/Tritão) e das escolhas das habilidades raciais:
   - resistência/imunidade: *Fonte Elemental* (Golem), *Resistência Elemental* (Qareen);
   - magias: *Magia das Fadas* (Sílfide), *Canção dos Mares* (Sereia/Tritão), *Tatuagem Mística* (Qareen);
   - perícias ou poder: *Versátil* (Humano), *Híbrido* (Kliren), *Memória Póstuma* (Osteon), *Deformidade* (Lefou, +2 em perícias ou poder da Tormenta), *Propósito de Criação* (Golem, poder geral; o Golem não escolhe origem).

   Trocar de raça descarta essas escolhas. Na ficha, a escolha vira efeito no próprio poder (imunidade, redução 10, +2 nas perícias, redutor de –1 PM nas magias escolhidas); magias raciais (inclusive as fixas de Aggelus, Sulfure e Dahllan) entram com o atributo-chave da raça.
2. **Atributos**: compra de pontos (10 pontos, com placar), rolagem (4d6 descarta o menor, enviada ao chat, uma vez só) ou valores fixos. O mestre escolhe quais modalidades são permitidas.
3. **Classe**: PV, PM, perícias, proficiências e habilidades de 1º nível; escolhas como Caminho do Arcanista e Linhagem do Feiticeiro, e o que cada uma pede:
   - *Linhagem Dracônica*: tipo de dano (ácido, eletricidade, fogo ou frio) da redução 5;
   - *Linhagem Feérica*: Enganação treinada e 1 magia de 1º círculo de encantamento ou ilusão;
   - *Linhagem Rubra*: 1 poder da Tormenta;
   - *Mago*: 4 magias iniciais em vez de 3.

   Trocar classe, Caminho ou Linhagem descarta as escolhas que deixaram de valer. Outras escolhas de classe ficam nos passos delas: *Especialista* (Ladino) no passo Perícias; *Espólio* (Nobre, item de até T$ 2.000) e *Protótipo* (Inventor, item superior com uma melhoria ou até 10 itens alquímicos, total até T$ 500) no passo Equipamento.
4. **Magias** (classes conjuradoras): magias de 1º círculo do tipo da classe; Bardo e Druida escolhem 3 escolas antes.
5. **Perícias**: obrigatórias da classe, escolhas da classe e perícias extras pelo valor de Inteligência.
6. **Origem**: itens e 2 benefícios (perícias, poderes ou um poder de um grupo). Com o homebrew ligado: origem profissional + regional.
7. **Devoção**: opcional, ou obrigatória para Clérigo, Druida e Paladino (Druida só Aharadak, Allihanna, Megalokk, Oceano e Tenebra, ou Druida de Arton; Paladino só Azgher, Khalmyr, Lena, Lin-Wu, Marah, Tanna-Toh, Thyatis e Valkaria). Fora essas listas, qualquer raça ou classe pode seguir qualquer deus (os devotos de cada deus aparecem só como informação). 1 poder concedido (2 para Clérigo e Druida). Alternativas sem divindade e sem poder concedido: Paladino do Bem, Clérigo devoto do Panteão e Druida de Arton.
8. **Equipamento**: kit básico, itens da classe e da origem, uma arma simples e, com proficiência em armas marciais, também uma arma marcial; armadura de couro (ou brunea, com proficiência em armaduras pesadas); escudo leve automático com proficiência em escudos. O botão **Vender itens** (no cabeçalho, liberado depois de fazer todas as escolhas do passo) abre um slideout onde se marcam vários itens iniciais de uma vez, vendo o total que vai para a carteira (metade do preço de cada); **Confirmar venda** aplica e tira os itens da tela, e reabrir o slideout permite desmarcar.
9. **Dinheiro**: 4d6 T$, rolado no chat, uma vez só.
10. **Revisão**: nome, retrato e token (pelo navegador de arquivos do Foundry ou colando o caminho; o token pode usar o retrato) e resumo de tudo.

## Regras opcionais do sistema

- **Raças Abertas** (configuração do sistema Tormenta20): quando ligada, cada modificador de atributo da raça pode ir para qualquer atributo, no máximo um modificador por atributo (um anão distribui +2, +1 e −1; um aggelus, +2 e +1). Raças com +1 flexível entram com seus +1 nessa mesma distribuição (o lefou distribui +1, +1, +1 e −1). O construtor lê a configuração do sistema; nada a ligar no módulo.
- **Usar Complicações** (configuração do construtor, desligada por padrão; requer os Suplementos de Arton): acrescenta a etapa **Complicações**, depois da Devoção, com as complicações gerais e as da classe escolhida (variantes usam as da classe básica), lidas do Heróis de Arton. É opcional escolher uma; quem escolhe recebe também um poder geral. Na ficha, os dois entram com o prefixo "C - ", depois dos poderes de classe. Complicações nunca aparecem nas listas de poder geral.
- **Atributos Variados** (configuração do construtor, desligada por padrão): acrescenta às modalidades de atributos os métodos Clássica (3d6 por atributo), Épica (3d6, descarta o menor, +6), Valkaria (atributos começam em 8; 7d6 aplicados como o jogador quiser, vários dados no mesmo atributo), Khalmyr (3, 3, 2, 1, 0, −1) e Nimb (7d20 descartando o menor; 1–3 → −3, 18–19 → +4, 20 → +5). Todos convertem pela tabela de Tormenta20, p. 17, e as rolagens vão para o chat, uma vez só. A configuração **Clássica em ordem** faz a Clássica cair direto em For, Des, Con, Int, Sab, Car, sem distribuir.

## Dados

Raças, classes, poderes, magias e equipamentos vêm dos compêndios do sistema. O que o sistema não traz fica em `data/`:

| Arquivo | Conteúdo |
|---|---|
| `racas.json` | escolhas das habilidades raciais e magias raciais fixas |
| `poderes-classe.json` | escolhas das habilidades de classe de 1º nível |
| `suplementos.json` | Suplementos de Arton: variantes de classe, regras de classes e classes ignoradas |
| `classes.json` | perícias, proficiências, habilidades de 1º nível, magias iniciais, devoção, itens extras |
| `origens.json` | descrição, itens e benefícios das 35 origens do livro básico |
| `origens-regionais.json` | origens regionais (homebrew); ainda vazio |
| `divindades.json` | os 20 deuses maiores: descrição, crenças, símbolo, energia, arma, devotos, poderes e obrigações |
| `equipamento.json` | kit inicial, armaduras e escudo |

Todos os nomes são buscados nos compêndios. Ao carregar, o mestre vê no console qualquer nome que não exista mais.

Origens (p. 85–95), divindades (p. 96–105) e escolas de magia (p. 172) foram conferidas com o livro, incluindo descrições, devotos e obrigações.

> ⚠️ Ainda a conferir com o livro: equipamento inicial por classe, quantidade de magias iniciais e a regra de rolar novamente o menor atributo.

## Suplementos de Arton (opcional)

Integração com o módulo [Suplementos de Arton](https://github.com/mobguilherme/Suplementos-de-Arton), **desligada por padrão**. O mestre liga em *Configurações → Construtor de Ficha*:

- **Suplementos de Arton: usar conteúdo** — chave geral. Só tem efeito com o módulo instalado e ativo; se ele estiver desativado, o mestre recebe um aviso e o construtor usa só o livro básico.
- Uma chave por tipo de conteúdo (todas ligadas por padrão, valem só com a chave geral ligada):
  - **Raças** (47): atributos e habilidades raciais, listadas por livro (básico, Heróis de Arton, Ameaças de Arton, demais) e com busca por nome. Quando a raça só traz o texto do +1 flexível ("+1 em dois atributos"), a regra é deduzida do texto e o painel avisa. Habilidades com escolha cadastradas em `racas.json`: Plurivalente (Minauro), Papel Tribal (Ceratops), Herança Dracônica (Kallyanach), Chassi (Mashin), Esperteza Vulpina e Sapiência (Moreau), Adaptável (Meio-Orc), Natureza Orgânica (Yidishan), Resquícios da Outra Vida (Vampiro), Terror Vivo (Kaijin), Infância entre os Pequenos (Galokk), Ambição Herdada (Meio-Elfo), Tabu, Presente, natureza e tamanho (Duende), material e fonte de energia (Golem de Ameaças); magias concedidas: Cura das Águas (Kappa), Instrumentista Mágico (Sátiro); Arte da Guerra (Hobgoblin) dá Guerra e proficiência com armas marciais. **Suraggel variante**: aggelus e sulfure (do livro básico) podem trocar Luz Sagrada / Sombras Profanas (e a magia delas) por uma das 22 heranças divinas do Heróis de Arton; a Herança de Drashantyr não está nos dados do suplemento e entra só com o nome e um aviso para consultar o livro.
  - **Classes** (19): perícias e proficiências não existem nos dados do suplemento. As variantes de classes básicas listadas em `data/suplementos.json` herdam perícias e proficiências da classe base; Frade, Samurai, Místico, Miragem, Inovador, Magimarcialista, Treinador e Ventanista têm as perícias do livro cadastradas como texto em `data/suplementos.json` → `periciasClasses` (o construtor interpreta o texto, no mesmo formato do livro básico); classes sem nada cadastrado pedem ao jogador que indique as perícias treinadas no passo Perícias. Proficiências: só as básicas, salvo variantes. Habilidades de 1º nível, magias iniciais e devoção são deduzidas dos poderes da classe; habilidades alternativas ("Tipo: Animal", "Tipo: Monstro"…) viram uma escolha. O painel da classe mostra um aviso. Regras completas podem ser cadastradas em `data/suplementos.json` → `classes`, no formato de `classes.json`.
  - **Poderes**: poderes gerais dos suplementos nas listas de escolha (as habilidades de raças e classes dos suplementos funcionam mesmo com esta chave desligada).
  - **Magias** (61).
  - **Itens**: armas, armaduras e itens mundanos na loja e no equipamento inicial (itens mágicos, artefatos e itens litúrgicos ficam de fora).
  - **Divindades**: poderes concedidos novos para os deuses maiores e os deuses menores do *Guia de Deuses Menores* (sem restrição de devotos, que não está nos dados).
  - **Origens mundanas** (Heróis de Arton, 30): aparecem no passo Origem, depois das do livro básico. Cada uma concede um único poder com as perícias que ele treina (cadastradas em `data/suplementos.json` → `origensMundanas`), sem itens nem escolha de benefícios; Citadino Abastado escolhe um Ofício e Menestrel uma Música de bardo. Ofícios que o sistema não tem como perícia (pescador, barbeiro, pedreiro, serviçal, coureiro, escriba) aparecem como anotação.
  - **Origens regionais**: o passo Origem regional (homebrew de origem dupla) passa a listar as regiões do *Atlas de Arton*, cada uma com seus poderes regionais.
- Mudar qualquer chave vale para os construtores abertos depois. Se o mestre desligar algo no meio de uma criação, as escolhas que vinham do suplemento são descartadas e o passo volta a pedir a escolha.
- Conteúdo de suplemento aparece com uma etiqueta do livro de origem (ex.: *Heróis de Arton*).

O suplemento foi feito para Foundry v13 / Tormenta20 1.5. O Foundry converte os dados ao carregar, mas vale conferir na ficha os efeitos dos poderes vindos dele. As *Distinções* não entram: não são de 1º nível.

## Limitações conhecidas

- Somente nível 1.
- Somente conteúdo do livro básico (Jogo do Ano), a menos que a integração com os Suplementos de Arton esteja ligada.
- Clérigo devoto do Panteão: a escolha entre energia positiva e negativa não é registrada.
- Foco do Bruxo e grimório do Mago não são adicionados como itens.
- *Espólio* oferece só itens da loja do livro básico (não monta itens superiores).
- *Memória Póstuma*: a alternativa "osteon de outra raça" (ganhar uma habilidade dessa raça) não é oferecida.
- Para não abrir o diálogo de atributos raciais do sistema, o módulo substitui `_onCreateOwnedRace` apenas para raças criadas pelo construtor.
