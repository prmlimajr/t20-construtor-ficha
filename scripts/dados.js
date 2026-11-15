/**
 * Carrega e indexa os dados usados pelo construtor: compêndios do sistema Tormenta20
 * + arquivos JSON do módulo (regras de classe, origens, divindades, equipamento).
 */
import { MODULE_ID, normalizar } from "./regras.js";
import { carregarSuplementos, conteudoLigado } from "./suplementos.js";

const PACKS = {
	racas: "tormenta20.racas",
	classes: "tormenta20.classes",
	poderes: "tormenta20.poderes",
	magias: "tormenta20.magias",
	equipamentos: "tormenta20.equipamentos"
};

let cache = null;
/** Carregamento em andamento (evita carregar duas vezes se o construtor abrir durante o pré-carregamento). */
let emAndamento = null;

/** Descarta os dados carregados (ex.: quando o mestre muda as configurações dos suplementos). */
export function invalidarDados() {
	cache = null;
	emAndamento = null;
}

/** Os dados já estão em memória? (o construtor abre direto, sem tela de carregamento) */
export function dadosCarregados() {
	return !!cache;
}

/** Melhorias que exigem outra melhoria (ou material especial), impossíveis num item com uma só. */
const MELHORIAS_COM_PRE_REQUISITO = new Set(["Pungente", "Atroz", "Material Especial"]);

/** Pastas do compêndio de equipamentos que não entram na loja. */
const FORA_DA_LOJA = new Set(["Tesouro", "Itens de Origem"]);
/** Organização da loja: tipo → categorias, na ordem de exibição. */
const ESTRUTURA_LOJA = [
	{ tipo: "Armas e munições", categorias: ["Armas simples", "Armas marciais", "Armas exóticas", "Armas de fogo", "Munições"] },
	{ tipo: "Armaduras e escudos", categorias: ["Armaduras leves", "Armaduras pesadas", "Escudos"] },
	{ tipo: "Itens gerais", categorias: ["Equipamento de aventura", "Ferramentas", "Vestuário", "Esotérico", "Alquímicos", "Alimentação", "Animais", "Veículos"] }
];

const ARMAS_POR_PROFICIENCIA = { simples: "Armas simples", marcial: "Armas marciais", exotica: "Armas exóticas", fogo: "Armas de fogo" };
const ARMADURAS_POR_TIPO = { leve: "Armaduras leves", pesada: "Armaduras pesadas", escudo: "Escudos" };
const GERAIS_POR_PASTA = {
	"Equipamento de Aventura": "Equipamento de aventura",
	Ferramentas: "Ferramentas",
	Vestuários: "Vestuário",
	Esotérico: "Esotérico",
	Animais: "Animais",
	Veículos: "Veículos"
};

/**
 * Categoria da loja de um item. Usa a pasta do compêndio e, quando ela não basta, o tipo do item
 * (munições na raiz de Armas, o Pique na pasta Marciais, consumíveis por tipo).
 */
function categoriaLoja(doc, pasta) {
	const s = doc.system ?? {};
	if (pasta === "Armas") {
		if (doc.type === "arma") return ARMAS_POR_PROFICIENCIA[s.proficiencia] ?? "Armas exóticas";
		return "Munições";
	}
	if (pasta === "Armaduras & Escudos") return ARMADURAS_POR_TIPO[s.tipo] ?? "Armaduras leves";
	if (pasta === "Consumíveis") {
		if (s.tipo === "food") return "Alimentação";
		if (s.tipo === "material") return "Esotérico"; // componentes materiais de magias
		return "Alquímicos"; // preparados, catalisadores e venenos
	}
	return GERAIS_POR_PASTA[pasta] ?? "Equipamento de aventura";
}

/** Nome da pasta de primeiro nível de um documento de compêndio. */
function pastaRaiz(doc, pack) {
	let f = doc.folder ?? null;
	if (typeof f === "string") f = pack?.folders?.get(f) ?? null;
	while (f?.folder) f = typeof f.folder === "string" ? pack?.folders?.get(f.folder) : f.folder;
	return f?.name ?? "Outros";
}

async function lerJson(arquivo) {
	const resp = await fetch(`modules/${MODULE_ID}/data/${arquivo}`);
	if (!resp.ok) throw new Error(`${MODULE_ID} | não foi possível ler data/${arquivo}`);
	return resp.json();
}

async function documentos(chave) {
	const pack = game.packs.get(PACKS[chave]);
	if (!pack) {
		console.warn(`${MODULE_ID} | compêndio ${PACKS[chave]} não encontrado`);
		return [];
	}
	return pack.getDocuments();
}

function porNome(docs) {
	const mapa = new Map();
	for (const d of docs) {
		const k = normalizar(d.name);
		if (!mapa.has(k)) mapa.set(k, d);
	}
	return mapa;
}

export async function carregarDados() {
	if (cache) return cache;
	if (!emAndamento) {
		const promessa = carregar();
		emAndamento = promessa;
		promessa.then((dados) => {
			// só guarda se ninguém invalidou no meio do caminho (ex.: o mestre mudou uma configuração)
			if (emAndamento === promessa) cache = dados;
		}, () => {
			// a falha é tratada por quem chamou (tela de carregamento); aqui só não guarda nada
		}).finally(() => {
			if (emAndamento === promessa) emAndamento = null;
		});
	}
	return emAndamento;
}

async function carregar() {
	const inicio = performance.now();
	// arquivos JSON do módulo (pequenos) primeiro: o suplemento precisa das regras de classe
	const [regrasClasses, origens, regionais, divindades, equipamento, escolas, regrasRacas, regrasPoderesClasse, configSuplementos, idades] =
		await Promise.all([
			lerJson("classes.json"),
			lerJson("origens.json"),
			lerJson("origens-regionais.json"),
			lerJson("divindades.json"),
			lerJson("equipamento.json"),
			lerJson("escolas.json"),
			lerJson("racas.json"),
			lerJson("poderes-classe.json"),
			lerJson("suplementos.json"),
			lerJson("idades.json")
		]);

	// todos os compêndios ao mesmo tempo (é a parte demorada)
	const packEfeitos = game.packs.get("tormenta20.efeitos");
	const packEquip = game.packs.get(PACKS.equipamentos);
	const [racas, classes, poderes, magias, efeitos, indiceEquip, sup] = await Promise.all([
		documentos("racas"),
		documentos("classes"),
		documentos("poderes"),
		documentos("magias"),
		packEfeitos ? packEfeitos.getDocuments() : [],
		packEquip ? packEquip.getDocuments() : [],
		carregarSuplementos({
			regrasClasses, divindades: divindades.divindades ?? [], origensRegionais: regionais.origens ?? []
		}, configSuplementos)
	]);

	// Melhorias de itens superiores (efeitos do compêndio tormenta20.efeitos), para o Protótipo
	const melhorias = [...efeitos]
		.filter((e) => e.system?.upgrade?.type === "improvement" && !MELHORIAS_COM_PRE_REQUISITO.has(e.name))
		.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

	const ordenar = (a, b) => a.name.localeCompare(b.name, "pt-BR");
	const comCategoria = ({ doc, categoria }) => ({
		doc, categoria,
		tipo: ESTRUTURA_LOJA.find((t) => t.categorias.includes(categoria))?.tipo ?? "Itens gerais"
	});
	const doConstrutor = poderesSubstitutos(sup);
	// os poderes do construtor marcados "substituiSuplemento" tiram os homônimos do suplemento da lista
	const substituidos = new Set(doConstrutor.filter((p) => p.substituiSuplemento).map((p) => p.name));
	// exclusivos por último: a busca por nome continua achando primeiro o do sistema ou do suplemento
	const todosPoderes = [
		...poderes,
		...doConstrutor.filter((p) => !p.exclusivo),
		...sup.poderes.filter((p) => !substituidos.has(p.name)),
		...doConstrutor.filter((p) => p.exclusivo)
	];
	// itens: os do sistema primeiro (em nomes repetidos, vale o do livro básico)
	const equipPorNome = new Map([...indiceEquip].map((e) => [normalizar(e.name), e]));
	for (const { doc } of sup.itens) if (!equipPorNome.has(normalizar(doc.name))) equipPorNome.set(normalizar(doc.name), doc);

	const dados = {
		racas: [...racas, ...sup.racas, ...racasDoConstrutor(racas, todosPoderes)].sort(ordenar),
		classes: [...classes, ...sup.classes].sort(ordenar),
		magias: [...magias, ...sup.magias].sort(ordenar),
		poderes: todosPoderes,
		poderesPorNome: porNome(todosPoderes),
		equipPorNome,
		// só armas "de verdade": pasta Armas, com proficiência (exclui Ataque desarmado,
		// itens de origem como Rolo de macarrão e esotéricos como Cajado Arcano)
		armas: [...indiceEquip]
			.filter((e) => e.type === "arma" && e.system?.proficiencia
				&& normalizar(e.name) !== "ataque desarmado"
				&& pastaRaiz(e, packEquip) === "Armas")
			.concat(sup.itens.filter(({ doc }) => doc.type === "arma" && ["simples", "marcial"].includes(doc.system?.proficiencia)).map(({ doc }) => doc))
			.sort(ordenar),
		packEquip,
		loja: [...indiceEquip]
			.map((d) => ({ doc: d, pasta: pastaRaiz(d, packEquip) }))
			.filter(({ doc, pasta }) => !FORA_DA_LOJA.has(pasta) && Number(doc.system?.preco) > 0)
			.map(({ doc, pasta }) => comCategoria({ doc, categoria: configSuplementos.loja?.categorias?.[doc.name] ?? categoriaLoja(doc, pasta) }))
			.concat(sup.itens.map(comCategoria))
			.sort((a, b) => ordenar(a.doc, b.doc)),
		estruturaLoja: ESTRUTURA_LOJA,
		regrasClasses: { ...regrasClasses, ...sup.regrasClasses },
		origens: [...(origens.origens ?? []), ...(sup.origensMundanas ?? [])],
		origensRegionais: comOrigensDoConstrutor(sup.origensRegionais ?? regionais.origens ?? [], doConstrutor),
		divindades: sup.divindades ?? divindades.divindades ?? [],
		/** Conteúdo vindo dos Suplementos de Arton: uuid → nome do compêndio. */
		fonteSuplemento: sup.fonte,
		suplementoLigado: sup.ligado,
		/** Poderes do suplemento só aparecem nas listas de escolha com a chave "Poderes" ligada. */
		poderesSuplementoSelecionaveis: conteudoLigado("Poderes"),
		/** Complicações (Heróis de Arton): [{doc, classe}] (classe null = geral). */
		complicacoes: sup.complicacoes ?? [],
		uuidsComplicacoes: new Set((sup.complicacoes ?? []).map((c) => c.doc.uuid)),
		/** Variantes de classes do suplemento → classe básica (para as complicações de classe). */
		variantes: configSuplementos.variantes ?? {},
		equipamento,
		escolas: escolas.escolas ?? {},
		regrasRacas: regrasRacas.poderes ?? {},
		regrasPoderesClasse: comOpcoesDivindades(regrasPoderesClasse.poderes ?? {}, divindades.divindades ?? []),
		melhorias,
		/** Idades Variadas (regra opcional): faixas, longevidade por raça e complicações de idade. */
		idades
	};
	verificarReferencias(dados);
	console.info(`${MODULE_ID} | dados carregados em ${Math.round(performance.now() - inicio)} ms`);
	return dados;
}

/** Efeito "ao usar" (aplicado na rolagem, como a Marca da Presa do caçador). */
function efeitoAoUsar(nome, img, changes, { tipos = ["attack"], custo = null, aumenta = false, nomes = [], automatico = false } = {}) {
	return {
		name: nome, img, type: "base", transfer: false, disabled: true,
		system: {
			changes: changes.map(([key, value, type = "add"]) => ({ key, value, type, phase: "initial", priority: null })),
			onuse: true,
			abilityUse: { description: "", automatic: automatico, aumenta, custo, names: nomes, types: tipos }
		}
	};
}

/** Efeito "somar" no formato dos efeitos de poder do sistema (Foundry v14). */
function efeitoSomar(nome, img, changes) {
	return {
		name: nome, img, type: "base", transfer: true, disabled: false,
		system: { changes: changes.map(([key, value]) => ({ key, value, type: "add", phase: "initial", priority: null })), onuse: false }
	};
}

/**
 * Poderes que as regras usam mas o suplemento não traz: o construtor os define aqui, com
 * descrição e efeitos, no mesmo formato dos poderes do compêndio.
 */
const PODERES_DO_CONSTRUTOR = [
	{
		nome: "Herança de Drashantyr",
		tipo: "racial", subtipo: "Suraggel", requerSuplemento: true,
		img: "systems/tormenta20/icons/racas/suraggel.webp",
		descricao: "<p>Graças ao poder elemental dos dragões, você recebe +1 PM e redução de ácido, eletricidade, fogo, frio, luz e trevas 5.</p>",
		efeitos: (img) => [efeitoSomar("Herança de Drashantyr", img, [
			["system.attributes.pm.bonus.total", 1],
			...["acido", "eletricidade", "fogo", "frio", "luz", "trevas"].map((t) => [`system.tracos.resistencias.${t}.bonus`, 5])
		])]
	},
	// Miragem (Caçador), classe variante (SDD/fontes/novo-mistico.pdf). Dança da Areia e Cortina de
	// Poeira substituem as homônimas do suplemento (da Miragem antiga, que esta variante substitui).
	{
		nome: "Dança da Areia",
		tipo: "ability", subtipo: "Miragem", requerSuplemento: true, substituiSuplemento: true,
		img: "icons/magic/control/debuff-energy-hold-levitate-yellow.webp",
		ativacao: { execucao: "free", custo: 1, qtd: "", condicao: "", special: "" },
		descricao: "<p>Você pode gastar 1 PM para iniciar uma dança da areia. Enquanto executa essa dança, você recebe um bônus de +1d4 em suas rolagens de dano com armas contra alvos em alcance curto. A cada quatro níveis, você pode gastar +1 PM para aumentar o dado de bônus de dano em um passo (veja a tabela da classe). A dança termina ao final da cena ou se você passar uma rodada sem percorrer pelo menos 6m sem passar pelo mesmo espaço duas vezes. Esta habilidade exige liberdade de movimentos; você não pode usá-la se estiver de armadura pesada ou na condição imóvel.</p>",
		efeitos: () => [
			efeitoAoUsar("Dança da Areia", "icons/svg/upgrade.svg", [["dano", "1d4"]]),
			// +1 PM a cada quatro níveis: o dado sobe um passo (1d6 no 5º, 1d8 no 9º, 1d10 no 13º, 1d12 no 17º)
			efeitoAoUsar("Dança da Areia", "icons/svg/upgrade.svg", [["efeito.dano", ":1d6;1d8;1d10;1d12", "override"]], { tipos: ["self"], custo: 1, aumenta: true })
		]
	},
	{
		nome: "Cortina de Poeira",
		tipo: "ability", subtipo: "Miragem", requerSuplemento: true, substituiSuplemento: true,
		img: "icons/magic/air/fog-gas-smoke-dense-brown.webp",
		descricao: "<p>No 7º nível, você usa sua velocidade para criar uma nuvem de terra ou outros detritos para obscurecer a visão de seus inimigos. Quando usa Dança da Areia, você pode gastar +3 PM para receber camuflagem leve enquanto sua dança estiver ativa.</p>"
	},
	{
		nome: "Passo do Deserto",
		tipo: "ability", subtipo: "Miragem", requerSuplemento: true,
		img: "icons/magic/earth/barrier-stone-explosion-debris.webp",
		descricao: "<p>A partir do 9º nível, uma vez por rodada você pode gastar 3 PM para entrar no solo e sair em outro espaço desocupado no solo em alcance curto. Tanto o ponto de entrada quanto de saída devem estar em solo macio (como areia, terra ou equivalente) e devem estar conectados pelo mesmo tipo de terreno. Efeito Mágico.</p>"
	},
	{
		nome: "Mestre do Deserto",
		tipo: "ability", subtipo: "Miragem", requerSuplemento: true,
		img: "icons/magic/control/silhouette-aura-energy.webp",
		descricao: "<p>No 20º nível, enquanto estiver usando Dança da Areia, quando sofre dano você pode gastar 2 PM para receber RD 20 contra esse dano. Além disso, quando usa a ação agredir durante a Dança da Areia, você pode gastar 2 PM para fazer um ataque adicional.</p>"
	},
	// Novos poderes de Caçador (SDD/fontes/novo-mistico.pdf). Arsenal do Deserto, Passo Duplo e Passos
	// Precisos substituem os homônimos da Miragem antiga do suplemento.
	{
		nome: "Arsenal do Deserto",
		tipo: "classe", subtipo: "Caçador", substituiSuplemento: true,
		img: "icons/magic/movement/trail-streak-zigzag-yellow.webp",
		descricao: "<p>Você recebe +2 nas rolagens de dano com azagaias, cimitarras e lanças e considera essas armas como leves.</p>",
		// +2 no dano ao atacar com essas armas (o efeito vale pelo nome do item da arma)
		efeitos: () => [efeitoAoUsar("Arsenal do Deserto", "icons/svg/upgrade.svg", [["dano", 2]], { tipos: [], nomes: ["Azagaia", "Cimitarra", "Lança"], automatico: true })]
	},
	{
		nome: "Escaramuça Distante",
		tipo: "classe", subtipo: "Caçador",
		img: "icons/magic/movement/trail-streak-zigzag-yellow.webp",
		descricao: "<p>Você pode usar Escaramuça e Dança da Areia contra alvos em alcance médio.</p>"
	},
	{
		nome: "Passo Duplo",
		tipo: "classe", subtipo: "Caçador", substituiSuplemento: true,
		img: "icons/magic/movement/trail-streak-zigzag-yellow.webp",
		descricao: "<p>Uma vez por rodada, se estiver usando Escaramuça ou Dança da Areia e usar a ação agredir para fazer um ataque corpo a corpo com uma arma leve, você pode gastar 2 PM para fazer um ataque adicional. <em>Pré-requisito:</em> Dança da Areia ou Escaramuça, 5º nível de caçador.</p>"
	},
	{
		nome: "Passos Precisos",
		tipo: "classe", subtipo: "Caçador", substituiSuplemento: true,
		img: "icons/magic/movement/trail-streak-zigzag-yellow.webp",
		descricao: "<p>Enquanto estiver usando Escaramuça ou Dança da Areia, você recebe +2 na margem de ameaça de seus ataques.</p>",
		// +2 na margem de ameaça ao atacar (ligar enquanto usa Escaramuça ou Dança da Areia)
		efeitos: () => [efeitoAoUsar("Passos Precisos", "icons/svg/upgrade.svg", [["criticoM", -2]])]
	},
	{
		nome: "Tesouros da Natureza",
		tipo: "classe", subtipo: "Caçador",
		img: "icons/magic/movement/trail-streak-zigzag-yellow.webp",
		descricao: "<p>Sempre que for bem-sucedido em montar um acampamento em terreno natural, você encontra frutos, insetos ou outros recursos naturais que ajudam a recuperar as energias. Cada personagem acampado recupera 1 PM por patamar em que você está.</p>"
	},
	// Origens regionais de Halak-Tûr (poderes de origem; cada um traz os itens da origem)
	{
		nome: "Criança do Crepúsculo",
		tipo: "origem", subtipo: "Halak-Tûr", regiao: "Halak-Tûr",
		img: "icons/skills/trades/academics-astronomy-navigation-purple.webp",
		descricao: "<p>Você nasceu no Vale do Crepúsculo (veja <em>Atlas de Arton</em>, p. 380) e, por algum motivo, abandonou a segurança de sua terra natal em busca dos perigos e da aventura que o restante de Arton tem a oferecer.</p><p><strong>Benefício.</strong> Escolha duas de suas habilidades com um custo em PM, uma para dia, outra para noite. Quando usa a habilidade escolhida para dia enquanto sob luz solar ou equivalente, o custo dela diminui em –1 PM e o custo da outra habilidade aumenta em +1 PM. Quando usa a habilidade escolhida para noite sob efeito de escuridão, esses modificadores nos custos se invertem. Por fim, durante o crepúsculo, o custo de ambas as habilidades diminui em –1 PM. Uma vez por patamar acima de iniciante, você pode trocar as habilidades escolhidas. Este poder não pode ser escolhido por construtos ou mortos-vivos.</p><p><strong>Itens.</strong> Uma poção mágica contendo uma magia de 1º círculo (1 PM).</p>",
		itensOrigem: [{ texto: "Poção mágica (magia de 1º círculo, 1 PM)" }]
	},
	{
		nome: "Nascido nas Estepes",
		tipo: "origem", subtipo: "Halak-Tûr", regiao: "Halak-Tûr",
		img: "icons/skills/trades/academics-astronomy-navigation-purple.webp",
		descricao: "<p>Você cresceu entre os dai-kerat e foi criado na tênue linha entre os rigores do deserto e a sofisticação da herança tamuraniana.</p><p><strong>Benefício.</strong> Você recebe +2 em Cavalgar e Vontade e nas rolagens de dano com arcos curtos e katanas.</p><p><strong>Itens.</strong> Arco curto, cavalo de guerra, flecha x20, veste de seda.</p>",
		itensOrigem: [{ nome: "Arco curto" }, { texto: "Cavalo de guerra" }, { nome: "Flechas", qtd: 20 }, { nome: "Veste de Seda" }],
		efeitos: (img) => [
			efeitoSomar("Nascido nas Estepes", img, [["system.pericias.cava.bonus", 2], ["system.pericias.vont.bonus", 2]]),
			efeitoAoUsar("Nascido nas Estepes: dano", "icons/svg/upgrade.svg", [["dano", 2]], { tipos: [], nomes: ["Arco curto", "Katana"], automatico: true })
		]
	},
	{
		nome: "Nômade Ferani",
		tipo: "origem", subtipo: "Halak-Tûr", regiao: "Halak-Tûr",
		img: "icons/skills/trades/academics-astronomy-navigation-purple.webp",
		descricao: "<p>Trog ou não, você passou sua infância entre os ferani, aprendendo como percorrer os ermos de forma rápida e discreta.</p><p><strong>Benefício.</strong> Você recebe +2 em Fortitude e Furtividade e nas rolagens de dano contra criaturas desprevenidas. Além disso, pode atravessar terrenos difíceis sem sofrer redução em seu deslocamento — se já puder fazer isso por outra habilidade, em vez disso seu deslocamento aumenta em +3m.</p><p><strong>Itens.</strong> Lança, manto camuflado (deserto), ração de viagem x10.</p>",
		itensOrigem: [{ nome: "Lança" }, { nome: "Manto Camuflado", rotulo: "Manto camuflado (deserto)" }, { nome: "Ração de viagem", qtd: 10 }],
		efeitos: (img) => [
			efeitoSomar("Nômade Ferani", img, [["system.pericias.fort.bonus", 2], ["system.pericias.furt.bonus", 2]]),
			// +2 no dano contra desprevenidas: opção ao atacar
			efeitoAoUsar("Nômade Ferani: dano contra desprevenidos", "icons/svg/upgrade.svg", [["dano", 2]])
		]
	},
	// Recebido por quem segue uma alternativa sem deus (Devoto do Panteão, Druida de Arton, Paladino do Bem).
	// Substitui o poder geral homônimo do suplemento, que apareceria nas listas de poder geral.
	{
		nome: "Devoção Ampla",
		tipo: "concedido", subtipo: "", substituiSuplemento: true,
		img: "systems/tormenta20/icons/poderes/concedidos.webp",
		descricao: "<p>Clérigos e frades do Panteão, druidas de Arton e paladinos do bem não recebem poderes concedidos. Em compensação, por sua devoção ampla, recebem +2 PM por patamar.</p>",
		// +2 PM por patamar (o sistema calcula @patamar a partir do nível: 1 a 4)
		efeitos: (img) => [efeitoSomar("Devoção Ampla", img, [["system.attributes.pm.bonus.total", "2*@patamar"]])]
	},
	// Nova linhagem de feiticeiro
	{
		nome: "Linhagem Abençoada Básica",
		tipo: "ability", subtipo: "Arcanista",
		img: "systems/tormenta20/icons/poderes/classes/conjuradores/mao-divindade.webp",
		descricao: "<p>Escolha um deus maior. Uma vez feita, essa escolha não pode ser mudada. Você aprende uma magia divina de 1º círculo e pode aprender magias divinas de 1º círculo como magias de feiticeiro. No 2º nível, você recebe um poder concedido do deus escolhido, aprovado pelo mestre, sem precisar ser devoto dele (mas você ainda pode ser devoto desse ou de outro deus).</p>"
	},
	// Elfo-do-Gelo (Bestiário de Arton)
	{
		nome: "Graça de Beluhga",
		tipo: "racial", subtipo: "Elfo-do-Gelo",
		img: "systems/tormenta20/icons/racas/elfo.webp",
		descricao: "<p>Seu deslocamento é 12m (em vez de 9m) e não é reduzido por terreno difícil natural.</p>",
		efeitos: (img) => [{
			name: "Graça de Beluhga", img, type: "base", transfer: true, disabled: false,
			system: { changes: [{ key: "system.attributes.movement.walk.base", value: 12, type: "override", phase: "initial", priority: null }], onuse: false }
		}]
	},
	{
		nome: "Herança Gélida",
		tipo: "racial", subtipo: "Elfo-do-Gelo",
		img: "systems/tormenta20/icons/racas/elfo.webp",
		descricao: "<p>Você recebe redução de frio 10 e, quando causa dano, causa +1d4 pontos de dano de frio.</p>",
		efeitos: (img) => [
			efeitoSomar("Herança Gélida", img, [["system.tracos.resistencias.frio.bonus", 10]]),
			// +1d4 de frio em todo dano causado: aplicado automaticamente ao atacar
			efeitoAoUsar("Herança Gélida: +1d4 de frio", "icons/svg/upgrade.svg", [["dano", "1d4"]], { automatico: true })
		]
	},
	{
		nome: "Sentidos Glaciais",
		tipo: "racial", subtipo: "Elfo-do-Gelo",
		img: "systems/tormenta20/icons/racas/elfo.webp",
		descricao: "<p>Você recebe visão na penumbra e +2 em Percepção e Sobrevivência.</p>",
		efeitos: (img) => [efeitoSomar("Sentidos Glaciais", img, [
			["system.attributes.sentidos.value", "penumbra"],
			["system.pericias.perc.bonus", 2],
			["system.pericias.sobr.bonus", 2]
		])]
	},
	// Lâmia (Bestiário de Arton)
	{
		nome: "Corpo Felino",
		tipo: "racial", subtipo: "Lâmia",
		img: "icons/creatures/abilities/lion-roar-yellow.webp",
		descricao: "<p>Seu tamanho é Grande e seu deslocamento é 12m. Entretanto, devido ao porte de sua metade humanoide, você conta como Média para fins das armas que usa.</p>",
		efeitos: (img) => [{
			name: "Corpo Felino", img, type: "base", transfer: true, disabled: false,
			system: {
				changes: [
					{ key: "system.tracos.tamanho", value: "gra", type: "override", phase: "initial", priority: null },
					{ key: "system.attributes.movement.walk.base", value: 12, type: "override", phase: "initial", priority: null }
				],
				onuse: false
			}
		}]
	},
	{
		nome: "Magia das Lâmias",
		tipo: "racial", subtipo: "Lâmia",
		img: "icons/creatures/abilities/lion-roar-yellow.webp",
		descricao: "<p>Você pode lançar duas das magias a seguir (atributo-chave Carisma): <em>Criar Ilusão</em>, <em>Compreensão</em>, <em>Disfarce Ilusório</em> ou <em>Visão Mística</em>. Caso aprenda novamente essa magia, seu custo diminui em –1 PM. Efeito Mágico.</p>",
		// –1 PM nas magias escolhidas (o construtor preenche os nomes ao gravar)
		efeitos: () => [{
			name: "Magia das Lâmias", img: "icons/svg/upgrade.svg", type: "base", transfer: true, disabled: true,
			system: { changes: [], onuse: true, abilityUse: { description: "", automatic: false, aumenta: false, custo: -1, names: [], types: ["spell"] } }
		}]
	},
	{
		nome: "Natureza Predadora",
		tipo: "racial", subtipo: "Lâmia",
		img: "icons/creatures/abilities/lion-roar-yellow.webp",
		descricao: "<p>Você é uma criatura do tipo monstro e recebe visão no escuro e +2 em Enganação e Furtividade.</p>",
		efeitos: (img) => [{
			name: "Natureza Predadora", img, type: "base", transfer: true, disabled: false,
			system: {
				changes: [
					{ key: "system.detalhes.tipo", value: "mon", type: "override", phase: "initial", priority: null },
					{ key: "system.attributes.sentidos.value", value: "escuro", type: "add", phase: "initial", priority: null },
					{ key: "system.pericias.enga.bonus", value: 2, type: "add", phase: "initial", priority: null },
					{ key: "system.pericias.furt.bonus", value: 2, type: "add", phase: "initial", priority: null }
				],
				onuse: false
			}
		}]
	},
	{
		nome: "Toque Psíquico",
		tipo: "racial", subtipo: "Lâmia",
		img: "icons/creatures/abilities/lion-roar-yellow.webp",
		descricao: "<p>Você possui uma arma natural de toque psíquico (dano 1d6, crítico x2, psíquico). Uma vez por rodada, quando usa a ação agredir para atacar com outra arma, pode gastar 1 PM para fazer um ataque corpo a corpo extra com o toque psíquico, desde que tenha uma mão livre e ela não tenha sido usada para atacar neste turno.</p>",
		// arma natural, no mesmo formato dos Chifres do minotauro: ataque de Luta e dano 1d6 psíquico
		ativacao: { execucao: "", custo: 1, qtd: "", condicao: "", special: "" },
		rolls: [
			{ name: "Ataque", key: "ataque0", type: "ataque", parts: [["1d20", "", ""], ["luta", "", ""], ["", "", ""]], versatil: "", adaptavel: "" },
			{ name: "Dano", key: "dano1", type: "dano", parts: [["1d6+@for", "psiquico", ""]], versatil: "", adaptavel: "" }
		]
	},
	// Manotauro (Bestiário de Arton). "exclusivo": ligado só à raça pelo id; não troca os homônimos
	// do livro básico (Chifres do minotauro, 1d6) nem do suplemento (Cascos, Medo de Altura).
	{
		nome: "Cascos",
		tipo: "racial", subtipo: "Manotauro", exclusivo: true,
		img: "systems/tormenta20/icons/racas/minotauro.webp",
		descricao: "<p>Você possui uma arma natural de cascos (dano 1d8, crítico x2, impacto). Uma vez por rodada, quando usa a ação agredir para atacar com outra arma, pode gastar 1 PM para fazer um ataque corpo a corpo extra com os cascos.</p>",
		ativacao: { execucao: "", custo: 1, qtd: "", condicao: "", special: "" },
		rolls: [
			{ name: "Ataque", key: "ataque0", type: "ataque", parts: [["1d20", "", ""], ["luta", "", ""], ["", "", ""]], versatil: "", adaptavel: "" },
			{ name: "Dano", key: "dano1", type: "dano", parts: [["1d8+@for", "impacto", ""]], versatil: "", adaptavel: "" }
		]
	},
	{
		nome: "Chifres",
		tipo: "racial", subtipo: "Manotauro", exclusivo: true,
		img: "systems/tormenta20/icons/racas/minotauro.webp",
		descricao: "<p>Você possui uma arma natural de chifres (dano 1d8, crítico x2, perfuração). Uma vez por rodada, quando usa a ação agredir para atacar com outra arma, pode gastar 1 PM para fazer um ataque corpo a corpo extra com os chifres.</p>",
		ativacao: { execucao: "", custo: 1, qtd: "", condicao: "", special: "" },
		rolls: [
			{ name: "Ataque", key: "ataque0", type: "ataque", parts: [["1d20", "", ""], ["luta", "", ""], ["", "", ""]], versatil: "", adaptavel: "" },
			{ name: "Dano", key: "dano1", type: "dano", parts: [["1d8+@for", "perfuracao", ""]], versatil: "", adaptavel: "" }
		]
	},
	{
		nome: "Corpulento",
		tipo: "racial", subtipo: "Manotauro", exclusivo: true,
		img: "systems/tormenta20/icons/racas/minotauro.webp",
		descricao: "<p>Seu tamanho é Grande e seu deslocamento é 12m. Entretanto, você não pode se beneficiar de uma montaria e, se estiver carregando um cavaleiro, sofre −2 em testes (além das penalidades de sobrecarga, se houver) e é considerado em condição ruim para lançar magias.</p>",
		efeitos: (img) => [{
			name: "Corpulento", img, type: "base", transfer: true, disabled: false,
			system: {
				changes: [
					{ key: "system.tracos.tamanho", value: "gra", type: "override", phase: "initial", priority: null },
					{ key: "system.attributes.movement.walk.base", value: 12, type: "override", phase: "initial", priority: null }
				],
				onuse: false
			}
		}]
	},
	{
		nome: "Medo de Altura",
		tipo: "racial", subtipo: "Manotauro", exclusivo: true,
		img: "systems/tormenta20/icons/racas/minotauro.webp",
		descricao: "<p>Se estiver adjacente a uma queda de 3m ou mais (como um buraco ou penhasco), você fica abalado.</p>"
	},
	// Salamandra (Bestiário de Arton)
	{
		nome: "Calor Natural",
		tipo: "racial", subtipo: "Salamandra", exclusivo: true,
		img: "icons/creatures/reptiles/lizard-iguana-green.webp",
		descricao: "<p>Você recebe +2 em Ofício (ferreiro) e pode gastar 2 PM para causar +1d6 pontos de dano de fogo com seus ataques até o fim da cena.</p>",
		// +1d6 de fogo nos ataques: opção ao atacar (o jogador marca enquanto o efeito de 2 PM estiver ativo)
		efeitos: () => [efeitoAoUsar("Calor Natural: +1d6 de fogo", "icons/svg/upgrade.svg", [["dano", "1d6"]])]
	},
	{
		nome: "Cauda",
		tipo: "racial", subtipo: "Salamandra", exclusivo: true,
		img: "icons/creatures/reptiles/lizard-iguana-green.webp",
		descricao: "<p>Você possui uma arma natural de cauda (dano 1d6, crítico x2, perfuração). Uma vez por rodada, quando usa a ação agredir para atacar com outra arma, pode gastar 1 PM para fazer um ataque corpo a corpo extra com a cauda.</p>",
		ativacao: { execucao: "", custo: 1, qtd: "", condicao: "", special: "" },
		rolls: [
			{ name: "Ataque", key: "ataque0", type: "ataque", parts: [["1d20", "", ""], ["luta", "", ""], ["", "", ""]], versatil: "", adaptavel: "" },
			{ name: "Dano", key: "dano1", type: "dano", parts: [["1d6+@for", "perfuracao", ""]], versatil: "", adaptavel: "" }
		]
	},
	{
		nome: "Cria das Chamas",
		tipo: "racial", subtipo: "Salamandra", exclusivo: true,
		img: "icons/creatures/reptiles/lizard-iguana-green.webp",
		descricao: "<p>Você é uma criatura do tipo espírito e recebe redução de fogo 10 e visão no escuro.</p>",
		efeitos: (img) => [{
			name: "Cria das Chamas", img, type: "base", transfer: true, disabled: false,
			system: {
				changes: [
					{ key: "system.detalhes.tipo", value: "esp", type: "override", phase: "initial", priority: null },
					{ key: "system.tracos.resistencias.fogo.bonus", value: 10, type: "add", phase: "initial", priority: null },
					{ key: "system.attributes.sentidos.value", value: "escuro", type: "add", phase: "initial", priority: null }
				],
				onuse: false
			}
		}]
	},
	{
		nome: "Fraqueza Glacial",
		tipo: "racial", subtipo: "Salamandra", exclusivo: true,
		img: "icons/creatures/reptiles/lizard-iguana-green.webp",
		descricao: "<p>Você sofre –5 em testes contra efeitos de frio e sofre 1 ponto de dano adicional por dado de dano de frio.</p>"
	},
	// Idades Variadas (Tormenta20, cap. 4): habilidades das faixas etárias e complicações de idade
	{
		nome: "Tamanho Menor",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "icons/svg/hourglass.svg",
		descricao: "<p>Você é uma categoria de tamanho menor que o padrão de sua raça (exceto se sua raça já for Minúscula; nesse caso, a mudança é apenas estética).</p>"
	},
	{
		nome: "Protegido dos Deuses",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "icons/svg/hourglass.svg",
		descricao: "<p>Você recebe +2 na Defesa e +5 em todos os testes de resistência. Isso é uma mistura de sorte sobrenatural com o fato de que inimigos normalmente ignoram crianças, justamente por serem menos perigosas.</p>",
		efeitos: (img) => [{
			name: "Protegido dos Deuses", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.attributes.defesa.bonus", value: 2, type: "add", phase: "initial", priority: null },
				{ key: "system.modificadores.pericias.resistencia", value: 5, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Sem Origem",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "icons/svg/hourglass.svg",
		descricao: "<p>Você não recebe benefícios de origem. Você está apenas começando a viver os anos que definirão quem você será!</p>"
	},
	{
		nome: "Ímpeto Juvenil",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "icons/svg/hourglass.svg",
		descricao: "<p>Você recebe +3 pontos de mana. Adolescentes acham que podem fazer qualquer coisa, e essa confiança os torna mais heroicos.</p>",
		efeitos: (img) => [{
			name: "Ímpeto Juvenil", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.attributes.pm.bonus.total", value: 3, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Origem em Construção",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "icons/svg/hourglass.svg",
		descricao: "<p>Você recebe apenas um benefício de origem, em vez de dois (se sua origem possuir um único benefício, comece com uma perícia treinada a menos por sua classe).</p>"
	},
	{
		nome: "Veterano Calejado",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "icons/svg/hourglass.svg",
		descricao: "<p>Você começa o jogo com um nível adicional em relação aos personagens mais novos do grupo. Por exemplo, se o grupo vai começar no 1º nível, você começa no 2º. Contudo, essa experiência tem seu preço — você recebe duas complicações de idade.</p>"
	},
	{
		nome: "Ai Minhas Costas",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "icons/svg/hourglass.svg",
		descricao: "<p>Você começa o jogo com dois níveis adicionais. Contudo, perde 1 ponto em todos os atributos físicos (Força, Destreza e Constituição) e recebe três complicações de idade. Além disso, não pode escolher o poder Aumento de Atributo para nenhum atributo físico — infelizmente, os tempos de vigor ficaram para trás.</p>"
	},
	{
		nome: "O Inverno da Vida",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "icons/svg/hourglass.svg",
		descricao: "<p>Você começa o jogo com três níveis adicionais. Porém, perde 2 pontos em todos os atributos físicos (Força, Destreza e Constituição) e recebe quatro complicações de idade. Assim como velhos, você não pode escolher o poder Aumento de Atributo para atributos físicos.</p>"
	},
	{
		nome: "Já Vi Coisas",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "icons/svg/hourglass.svg",
		descricao: "<p>Você pode receber um poder geral. Nesse caso, também recebe uma complicação de idade.</p>"
	},
	{
		nome: "Abatido",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Seu vigor se foi. Você recebe –2 PV por nível.</p>",
		efeitos: (img) => [{
			name: "Abatido", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.attributes.pv.bonus.nivel", value: -2, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Catarata",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Seus olhos já não são os mesmos. Você sofre –5 em Percepção e Pontaria.</p>",
		efeitos: (img) => [{
			name: "Catarata", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.pericias.perc.bonus", value: -5, type: "add", phase: "initial", priority: null },
				{ key: "system.pericias.pont.bonus", value: -5, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Dedos Trêmulos",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você sofre –2 em Luta e Pontaria. Além disso, quando usa um item que esteja empunhando, role 1d4. Em um resultado 1, você derruba esse item.</p>",
		efeitos: (img) => [{
			name: "Dedos Trêmulos", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.pericias.luta.bonus", value: -2, type: "add", phase: "initial", priority: null },
				{ key: "system.pericias.pont.bonus", value: -2, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Definhamento",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>A idade roubou seu peso, deixando-o um fiapo do que era antes. Você sofre –5 em Fortitude e em testes de manobras de combate.</p>",
		efeitos: (img) => [{
			name: "Definhamento", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.pericias.fort.bonus", value: -5, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Desatento",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você já não é mais tão atento quanto outrora. Na primeira rodada de qualquer cena de ação, role um dado. Em um resultado ímpar, você fica surpreendido (mesmo que um efeito possa evitar isso).</p>"
	},
	{
		nome: "“Devagar, Jovem!”",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você já não anda no mesmo ritmo que antes. Seu deslocamento diminui em –3m e você não pode correr ou fazer investidas.</p>",
		efeitos: (img) => [{
			name: "“Devagar, Jovem!”", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.attributes.movement.walk.base", value: -3, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Gota",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Sempre que faz um teste de Destreza ou de perícias baseadas nesse atributo você perde 1d6 pontos de vida. Você só pode recuperar esses PV com descanso.</p>"
	},
	{
		nome: "Juntas Duras",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Suas articulações doem. Você sofre –5 em testes de Acrobacia e Reflexos.</p>",
		efeitos: (img) => [{
			name: "Juntas Duras", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.pericias.acro.bonus", value: -5, type: "add", phase: "initial", priority: null },
				{ key: "system.pericias.refl.bonus", value: -5, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Melancólico",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você já não tem mais tanta motivação para realizar grandes façanhas. Você perde 1 PM por nível.</p>",
		efeitos: (img) => [{
			name: "Melancólico", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.attributes.pm.bonus.nivel", value: -1, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Memórias Tristes",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você passou por um trauma, como a perda de um ente querido ou a culpa por um erro que cometeu e pelo qual nunca se perdoou. Sempre que rola um resultado 1 natural em qualquer teste, você fica pasmo por 1 rodada e frustrado até o fim do dia (cumulativo).</p>"
	},
	{
		nome: "“No Meu Tempo...”",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você se prende a visões idealizadas de um passado que nunca existiu e se torna presa fácil para manipulação. Você sofre –5 em Intuição e Vontade.</p>",
		efeitos: (img) => [{
			name: "“No Meu Tempo...”", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.pericias.intu.bonus", value: -5, type: "add", phase: "initial", priority: null },
				{ key: "system.pericias.vont.bonus", value: -5, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Pulmão Ruim",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Quando corre ou prende a respiração, você precisa fazer testes de Fortitude para não ficar fatigado a partir da primeira rodada (normalmente, personagens só precisam fazer esses testes após um número de rodadas igual a sua Constituição +1). Além disso, sempre que faz uma investida, você fica fatigado até o fim da cena.</p>"
	},
	{
		nome: "Rabugento",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você reclama de tudo. Você sofre –5 em testes de Carisma e de perícias baseadas nesse atributo, exceto Intimidação.</p>",
		efeitos: (img) => [{
			name: "Rabugento", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.pericias.ades.bonus", value: -5, type: "add", phase: "initial", priority: null },
				{ key: "system.pericias.atua.bonus", value: -5, type: "add", phase: "initial", priority: null },
				{ key: "system.pericias.dipl.bonus", value: -5, type: "add", phase: "initial", priority: null },
				{ key: "system.pericias.enga.bonus", value: -5, type: "add", phase: "initial", priority: null },
				{ key: "system.pericias.joga.bonus", value: -5, type: "add", phase: "initial", priority: null }
			], onuse: false }
		}]
	},
	{
		nome: "Recurvado",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>A idade dobrou suas costas. Você conta como uma categoria de tamanho menor para alcance natural, modificador de manobras e armas que pode empunhar (mas não para espaço ocupado, modificador de Furtividade ou dano de armas naturais).</p>"
	},
	{
		nome: "Sono Ruim",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você acorda várias vezes no meio da noite, o que atrapalha seu descanso. Sua recuperação de PM e PV é sempre uma categoria pior. Se a condição de descanso já é ruim, você recupera apenas 1 PM e 1 PV, independentemente do seu nível. Se já recupera apenas 1 PM e 1 PV, não recupera nada!</p>"
	},
	{
		nome: "Teimoso",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Sempre que falha em um teste de atributo ou de perícia que possa tentar novamente, você é obrigado a tentar pelo menos mais uma vez (mesmo que isso possa prejudicá-lo). Teimoso é quem teima com você!</p>"
	},
	{
		nome: "Tosse",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Em cenas de ação, role 1d6 no início de cada rodada. Num resultado 1, você tem uma crise de tosse e fica atordoado por 1 rodada. Em cenas de interpretação, role 1d6 sempre que fizer um teste de perícia baseada em Carisma. Num resultado 1, você tem uma crise de tosse e sofre uma penalidade de –5 nesse teste.</p>"
	},
	{
		nome: "Turrão",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você faz tudo sempre do seu jeito e tem dificuldade de lidar com coisas nas quais não é perito. Você não recebe o bônus de metade do nível em perícias nas quais não é treinado.</p>"
	},
	{
		nome: "Velha Ferida",
		tipo: "complicacao", subtipo: "Idade", exclusivo: true,
		img: "icons/magic/control/voodoo-doll-pain-damage-purple.webp",
		descricao: "<p>Você tem um machucado antigo, que nunca cicatrizou direito. Sempre que você sofre um acerto crítico, o multiplicador de dano aumenta em +1 e você fica fraco (mesmo que seja imune, cumulativo).</p>"
	},
	// Sahiri (variante de dahllan): substituem Amiga das Plantas e Armadura da Natureza
	{
		nome: "Animar Rochas",
		tipo: "racial", subtipo: "Sahiri",
		img: "systems/tormenta20/icons/racas/dahllan.webp",
		descricao: "<p>Você pode usar magia para transformar rochas em criaturas sob seu controle. Isso funciona como a magia <em>Conjurar Monstro</em>, exceto que você precisa ter acesso a uma porção de terra ou rocha equivalente a uma criatura Pequena. Caso aprenda essa magia, seu custo diminui em –1 PM. Efeito Mágico.</p>",
		efeitos: () => [{
			name: "Animar Rochas", img: "icons/svg/upgrade.svg", type: "base", transfer: true, disabled: true,
			system: {
				changes: [], onuse: true,
				abilityUse: { description: "", automatic: false, aumenta: false, custo: -1, names: ["Conjurar Monstro"], types: ["spell"] }
			}
		}]
	},
	{
		nome: "Proteção da Terra",
		tipo: "racial", subtipo: "Sahiri",
		img: "systems/tormenta20/icons/racas/dahllan.webp",
		descricao: "<p>Quando sofre dano enquanto está em contato com terra ou pedra, você pode gastar 1 PM para reduzir esse dano em 5.</p>"
	},
	// Poder concedido de Allihanna e Megalokk (livro básico: funciona sem o suplemento)
	{
		nome: "Canção da Pedra",
		tipo: "concedido", subtipo: "Allihanna, Megalokk",
		img: "icons/magic/earth/strike-body-stone-crumble.webp",
		// "Apenas druidas podem escolher este poder" (variantes de druida também)
		apenasClasses: ["Druida"],
		// magias que o poder dá na ficha no 1º nível (Controlar Terra só com magias divinas de 3º círculo)
		magias: ["Transmutar Objetos"],
		descricao: "<p>Você pode usar Religião em vez de Ofício para testes relacionados a grandes estruturas de pedra, como veículos e construções, e no lugar de Pilotagem para conduzir veículos de pedra. Além disso, aprende e pode lançar <em>Transmutar Objetos</em> (apenas em objetos de pedra) e, se puder lançar magias divinas de 3º círculo, aprende e pode lançar <em>Controlar Terra</em>. Caso aprenda novamente essas magias, seu custo diminui em –1 PM. Apenas druidas podem escolher este poder. Efeito Mágico.</p>",
		efeitos: () => [{
			name: "Canção da Pedra", img: "icons/svg/upgrade.svg", type: "base", transfer: true, disabled: true,
			system: {
				changes: [], onuse: true,
				abilityUse: { description: "", automatic: false, aumenta: false, custo: -1, names: ["Transmutar Objetos", "Controlar Terra"], types: ["spell"] }
			}
		}]
	}
];

function poderesSubstitutos(sup) {
	return PODERES_DO_CONSTRUTOR
		.filter((x) => !x.requerSuplemento || sup.ligado)
		// se o suplemento passar a ter o poder, vale o dele (a menos que o do construtor o substitua de
		// propósito, ou seja exclusivo de uma raça do construtor e ligado a ela só pelo id)
		.filter((x) => x.substituiSuplemento || x.exclusivo || !sup.poderes.some((p) => p.name === x.nome))
		.map((x) => ({
			name: x.nome,
			type: "poder",
			img: x.img,
			// exclusivos levam a raça no id, para não colidir com o homônimo de outra raça do construtor
			uuid: x.exclusivo ? `${MODULE_ID}.poder.${x.subtipo}.${x.nome}` : `${MODULE_ID}.poder.${x.nome}`,
			_id: null,
			substituto: true,
			substituiSuplemento: !!x.substituiSuplemento,
			exclusivo: !!x.exclusivo,
			apenasClasses: x.apenasClasses ?? null,
			regiao: x.regiao ?? null,
			itensOrigem: x.itensOrigem ?? [],
			magiasConcedidas: x.magias ?? [],
			effects: x.efeitos ? x.efeitos(x.img) : [],
			system: {
				tipo: x.tipo, subtipo: x.subtipo, description: { value: x.descricao },
				...(x.ativacao ? { ativacao: x.ativacao } : {}),
				...(x.rolls ? { rolls: x.rolls } : {})
			}
		}));
}

/** Regras com "opcoesDivindades": as opções são os deuses maiores (os do livro básico). */
function comOpcoesDivindades(regras, divindades) {
	const opcoes = divindades.map((d) => ({ valor: d.nome, nome: d.nome }));
	const preencher = (r) => (r?.opcoesDivindades ? { ...r, opcoes } : r);
	return Object.fromEntries(Object.entries(regras).map(([k, r]) => [k, r && typeof r === "object"
		? { ...preencher(r), ...(r.extras ? { extras: r.extras.map(preencher) } : {}) } : r]));
}

/**
 * Raças variantes definidas pelo construtor: copiam uma raça do sistema (atributos, ícone e
 * habilidades) trocando algumas habilidades por poderes de PODERES_DO_CONSTRUTOR.
 */
const RACAS_DO_CONSTRUTOR = [
	{
		nome: "Salamandra",
		modelo: "Elfo",
		livro: "Bestiário de Arton",
		img: "icons/creatures/reptiles/lizard-iguana-green.webp",
		atributos: { for: 0, des: 1, con: 2, int: 0, sab: 0, car: -1 },
		habilidades: ["Calor Natural", "Cauda", "Cria das Chamas", "Fraqueza Glacial"],
		descricao: "<p>Salamandra (<em>Bestiário de Arton</em>). Constituição +2, Destreza +1, Carisma –1.</p>"
	},
	{
		nome: "Manotauro",
		modelo: "Elfo",
		livro: "Bestiário de Arton",
		img: "systems/tormenta20/icons/racas/minotauro.webp",
		atributos: { for: 2, des: 0, con: 1, int: -1, sab: -2, car: 0 },
		habilidades: ["Cascos", "Chifres", "Corpulento", "Medo de Altura"],
		descricao: "<p>Manotauro (<em>Bestiário de Arton</em>). Força +2, Constituição +1, Inteligência –1, Sabedoria –2.</p>"
	},
	{
		nome: "Lâmia",
		modelo: "Elfo",
		livro: "Bestiário de Arton",
		img: "icons/creatures/abilities/lion-roar-yellow.webp",
		atributos: { for: 0, des: 0, con: -1, int: 0, sab: 1, car: 2 },
		habilidades: ["Corpo Felino", "Magia das Lâmias", "Natureza Predadora", "Toque Psíquico"],
		descricao: "<p>Lâmia (<em>Bestiário de Arton</em>). Carisma +2, Sabedoria +1, Constituição –1.</p>"
	},
	{
		// raça nova: usa a estrutura de dados de uma raça do sistema ("modelo"), com atributos e habilidades próprios
		nome: "Elfo-do-Gelo",
		modelo: "Elfo",
		livro: "Bestiário de Arton",
		img: "systems/tormenta20/icons/racas/elfo.webp",
		atributos: { for: 0, des: 1, con: -1, int: 0, sab: 2, car: 0 },
		habilidades: ["Graça de Beluhga", "Herança Gélida", "Sentidos Glaciais"],
		descricao: "<p>Elfo-do-gelo (<em>Bestiário de Arton</em>). Sabedoria +2, Destreza +1, Constituição –1.</p>"
	},
	{
		nome: "Sahiri",
		base: "Dahllan",
		descricao: "<p>Sahiri é uma variante da raça dahllan. Usa as habilidades de dahllan, mas <em>Amiga das Plantas</em> e <em>Armadura de Allihanna</em> são substituídas por <em>Animar Rochas</em> e <em>Proteção da Terra</em>.</p>",
		troca: { "Amiga das Plantas": "Animar Rochas", "Armadura da Natureza": "Proteção da Terra" }
	}
];

function racasDoConstrutor(racas, poderes) {
	const out = [];
	for (const def of RACAS_DO_CONSTRUTOR) {
		const base = racas.find((r) => r.name === (def.base ?? def.modelo));
		if (!base) continue;
		const sistema = typeof base.system?.toObject === "function" ? base.system.toObject() : structuredClone(base.system);
		// habilidades da raça: primeiro as exclusivas dela, depois as do construtor, por fim qualquer homônima
		const uuidDe = (nome) => (poderes.find((p) => p.name === nome && p.substituto && p.system?.subtipo === def.nome)
			?? poderes.find((p) => p.name === nome && p.substituto)
			?? poderes.find((p) => p.name === nome))?.uuid ?? null;
		if (!def.base) {
			// raça nova: atributos e habilidades próprios, sem +1 flexível
			sistema.atributos = { ...def.atributos };
			sistema.atributosDinamicos = { value: [], description: "+1 em Três Atributos Diferentes" };
			sistema.grants = [{ title: "", desc: "", type: "multi", choices: def.habilidades.map(uuidDe).filter(Boolean).map((uuid) => ({ uuid })) }];
			sistema.description = { ...(sistema.description ?? {}), value: def.descricao };
			out.push({
				name: def.nome, type: "race", img: def.img ?? base.img,
				uuid: `${MODULE_ID}.raca.${def.nome}`, _id: null,
				substituto: true, fonteLivro: def.livro ?? "",
				effects: [], system: sistema
			});
			continue;
		}
		sistema.grants = (sistema.grants ?? []).map((g) => ({
			...g,
			choices: (g.choices ?? []).map((c) => {
				const nome = poderes.find((p) => p.uuid === c.uuid)?.name;
				const novo = def.troca[nome] ? uuidDe(def.troca[nome]) : null;
				return novo ? { ...c, uuid: novo } : c;
			})
		}));
		sistema.description = { ...(sistema.description ?? {}), value: def.descricao };
		out.push({
			name: def.nome, type: "race", img: base.img,
			uuid: `${MODULE_ID}.raca.${def.nome}`, _id: null,
			substituto: true, varianteDe: def.base,
			effects: [], system: sistema
		});
	}
	return out;
}

/**
 * Acrescenta às origens regionais os poderes de origem do construtor (ex.: Halak-Tûr): entram na
 * região de mesmo nome (a do Atlas, se existir) ou criam a região.
 */
function comOrigensDoConstrutor(origens, doConstrutor) {
	const lista = origens.map((o) => ({ ...o, poderes: [...(o.poderes ?? [])] }));
	for (const p of doConstrutor.filter((x) => x.regiao)) {
		let o = lista.find((x) => normalizar(x.nome) === normalizar(p.regiao));
		if (!o) {
			o = { nome: p.regiao, descricao: `Origem regional de ${p.regiao}. Escolha um dos poderes regionais abaixo.`, itens: [], pericias: [], poderes: [], grupos: [] };
			lista.push(o);
		}
		if (!o.poderes.includes(p.name)) o.poderes.push(p.name);
	}
	return lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** O poder pode aparecer nas listas de escolha? (do sistema, ou do suplemento com a chave "Poderes" ligada) */
export function poderSelecionavel(dados, p) {
	// complicações nunca entram nas listas de poder geral (algumas vêm com tipo "geral" no suplemento)
	if (dados.uuidsComplicacoes?.has(p.uuid)) return false;
	return !dados.fonteSuplemento?.has(p.uuid) || dados.poderesSuplementoSelecionaveis;
}

/** Nome do compêndio do suplemento de onde veio o documento (ou ""). */
export function fonteDe(dados, doc) {
	return dados.fonteSuplemento?.get(doc?.uuid) ?? doc?.fonteLivro ?? "";
}

/** Busca um poder pelo nome; avisa no console quando o nome não existe no compêndio. */
export function poder(dados, nome) {
	return dados.poderesPorNome.get(normalizar(nome)) ?? null;
}

/** Poderes gerais de um grupo (Combate, Destino, Magia, Tormenta). */
export function poderesDoGrupo(dados, grupo) {
	const g = normalizar(grupo);
	return dados.poderes
		.filter((p) => poderSelecionavel(dados, p))
		.filter((p) => p.system.tipo === "geral" && normalizar(p.system.subtipo) === g)
		.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function magiaPorNome(dados, nome) {
	const n = normalizar(nome);
	return dados.magias.find((m) => normalizar(m.name) === n) ?? null;
}

export function equipamento(dados, nome) {
	return dados.equipPorNome.get(normalizar(nome)) ?? null;
}

/** Avisa (só para o mestre) sobre nomes dos JSONs que não existem nos compêndios. */
function verificarReferencias(d) {
	if (!game.user.isGM) return;
	const faltando = new Set();
	const checarPoder = (n) => { if (!poder(d, n)) faltando.add(`poder "${n}"`); };
	const checarEquip = (n) => { if (!equipamento(d, n)) faltando.add(`item "${n}"`); };

	for (const [classe, r] of Object.entries(d.regrasClasses)) {
		if (classe.startsWith("_")) continue;
		r.habilidades?.forEach(checarPoder);
		r.escolhas?.forEach((e) => e.opcoes.forEach((o) => checarPoder(o.poder)));
		r.equipamentoExtra?.forEach(checarEquip);
	}
	for (const o of [...d.origens, ...d.origensRegionais]) {
		o.poderes?.forEach(checarPoder);
		for (const it of o.itens ?? []) {
			if (typeof it === "string") checarEquip(it);
			else if (it.nome) checarEquip(it.nome);
			else if (it.escolha) it.escolha.forEach(checarEquip);
		}
	}
	for (const div of d.divindades) div.poderes.forEach(checarPoder);
	d.equipamento.kitBase?.forEach(checarEquip);
	Object.values(d.equipamento.armaduras ?? {}).flat().forEach(checarEquip);
	if (d.equipamento.escudo) checarEquip(d.equipamento.escudo);
	const checarLista = (regra) => {
		const lista = regra?.poder?.lista ?? "";
		if (lista.startsWith("poderes:")) lista.slice(8).split("|").forEach(checarPoder);
	};
	for (const [nome, r] of [...Object.entries(d.regrasRacas), ...Object.entries(d.regrasPoderesClasse)]) {
		// regras de suplemento só são conferidas com o suplemento carregado
		const doSuplemento = r.somenteSuplemento || r.requerSuplemento || r.escolhas?.some((x) => x.somenteSuplemento || x.requerSuplemento);
		if (doSuplemento && !d.suplementoLigado) continue;
		// sem o suplemento, as regras das raças dele (Plurivalente, Tabu...) não têm o que conferir
		if (!d.suplementoLigado && !nome.startsWith("raca:") && !poder(d, nome)) continue;
		(r.escolhas ?? []).forEach(checarLista);
		checarLista(r);
		if (nome.startsWith("raca:")) continue;
		checarPoder(nome);
		for (const m of [...(r.nomes ?? []), ...(r.magiasFixas ?? [])]) {
			if (!magiaPorNome(d, m)) faltando.add(`magia "${m}"`);
		}
	}

	if (faltando.size) {
		console.warn(`${MODULE_ID} | referências não encontradas nos compêndios (serão criadas como itens simples ou ignoradas):`, [...faltando]);
	}
}
