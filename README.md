# T20 — Construtor de Ficha

Wizard passo a passo para criar personagens de **Tormenta20** (nível 1) no Foundry VTT.

Requer Foundry **v14** e o sistema **Tormenta20 ≥ 1.6.7**.

## Como usar

- **Diretório de Atores → "Criar personagem (wizard)"**: cria um personagem e abre o construtor.
- Criar um ator do tipo *Personagem* pelo botão padrão também abre o construtor (configurável).
- Na ficha de um personagem ainda sem raça/classe, o botão **Construtor** no cabeçalho reabre o wizard.
- As escolhas ficam salvas como rascunho no ator: dá para fechar e continuar depois.
- Nada é gravado na ficha até clicar em **Criar personagem** no último passo.

Jogadores precisam da permissão **"Criar novos atores"** (Configurações → Permissões do usuário).

## Passos

1. **Raça**: painel com as raças do compêndio, modificadores e habilidades raciais; escolha dos +1 flexíveis (Humano, Lefou, Osteon, Sereia/Tritão).
2. **Atributos**: compra de pontos (10 pontos, com placar), rolagem (4d6 descarta o menor, enviada ao chat, uma vez só) ou valores fixos. O mestre escolhe quais modalidades são permitidas.
3. **Classe**: PV, PM, perícias, proficiências e habilidades de 1º nível; escolhas como Caminho do Arcanista e Linhagem do Feiticeiro.
4. **Magias** (classes conjuradoras): magias de 1º círculo do tipo da classe; Bardo e Druida escolhem 3 escolas antes.
5. **Perícias**: obrigatórias da classe, escolhas da classe e perícias extras pelo valor de Inteligência.
6. **Origem**: itens e 2 benefícios (perícias, poderes ou um poder de um grupo). Com o homebrew ligado: origem profissional + regional.
7. **Devoção**: opcional, ou obrigatória para Clérigo, Druida e Paladino (Druida só Allihanna, Megalokk e Oceano). A raça ou a classe precisa estar entre os devotos do deus; humanos e clérigos podem seguir qualquer um. 1 poder concedido (2 para Clérigo e Druida).
8. **Equipamento**: kit básico, itens da classe e da origem, arma (simples, ou marcial se proficiente), armadura e escudo.
9. **Dinheiro**: 4d6 T$, rolado no chat, uma vez só.
10. **Revisão**: nome e resumo de tudo.

## Dados

Raças, classes, poderes, magias e equipamentos vêm dos compêndios do sistema. O que o sistema não traz fica em `data/`:

| Arquivo | Conteúdo |
|---|---|
| `classes.json` | perícias, proficiências, habilidades de 1º nível, magias iniciais, devoção, itens extras |
| `origens.json` | descrição, itens e benefícios das 35 origens do livro básico |
| `origens-regionais.json` | origens regionais (homebrew); ainda vazio |
| `divindades.json` | os 20 deuses maiores: descrição, crenças, símbolo, energia, arma, devotos, poderes e obrigações |
| `equipamento.json` | kit inicial, armaduras e escudo |

Todos os nomes são buscados nos compêndios. Ao carregar, o mestre vê no console qualquer nome que não exista mais.

Origens (p. 85–95), divindades (p. 96–105) e escolas de magia (p. 172) foram conferidas com o livro, incluindo descrições, devotos e obrigações.

> ⚠️ Ainda a conferir com o livro: equipamento inicial por classe, quantidade de magias iniciais e a regra de rolar novamente o menor atributo.

## Limitações conhecidas

- Somente nível 1.
- Somente conteúdo do livro básico (Jogo do Ano).
- Escolhas internas de alguns poderes (ex.: *Versátil* do Humano, *Especialista* do Ladino, *Protótipo* do Inventor) ficam a cargo do sistema e da ficha.
- Para não abrir o diálogo de atributos raciais do sistema, o módulo substitui `_onCreateOwnedRace` apenas para raças criadas pelo construtor.
