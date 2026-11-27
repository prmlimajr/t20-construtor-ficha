/**
 * Carrega e indexa os dados usados pelo construtor: compêndios do sistema Tormenta20
 * + arquivos JSON do módulo (regras de classe, origens, divindades, equipamento).
 */
import { MODULE_ID, normalizar } from "./regras.js";
import { carregarSuplementos, conteudoLigado } from "./suplementos.js";
import { ELEMENTOS, CIRCULO_MISTICO, nomeGuia } from "./afinidade.js";
import { ehMarca } from "./distincoes.js";

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
	// exclusivos por último: a busca por nome continua achando primeiro o do sistema ou do suplemento
	const todosPoderes = [
		...poderes,
		...doConstrutor.filter((p) => !p.exclusivo),
		...poderesMantidosDoSuplemento(sup.poderes, doConstrutor),
		...doConstrutor.filter((p) => p.exclusivo)
	];
	// itens: os do sistema primeiro (em nomes repetidos, vale o do livro básico)
	const equipPorNome = new Map([...indiceEquip].map((e) => [normalizar(e.name), e]));
	for (const { doc } of sup.itens) if (!equipPorNome.has(normalizar(doc.name))) equipPorNome.set(normalizar(doc.name), doc);

	// magias: em nomes repetidos (Conjurar Mortos-Vivos, Controlar Ar), vale a do livro básico
	const nomesMagias = new Set(magias.map((m) => normalizar(m.name)));

	const dados = {
		racas: [...racas, ...sup.racas, ...racasDoConstrutor(racas, todosPoderes)].sort(ordenar),
		classes: [...classes, ...sup.classes.map(comClasseReescrita), ...classesDoConstrutor(classes)].sort(ordenar),
		magias: [...magias, ...sup.magias.filter((m) => !nomesMagias.has(normalizar(m.name)))].sort(ordenar),
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
		/** Distinções do suplemento: poder → distinção e distinção → marcas (ver distincoes.js). */
		distincoes: comDistincoesDoConstrutor(sup.distincoes, doConstrutor),
		/** Poderes do suplemento só aparecem nas listas de escolha com a chave "Poderes" ligada. */
		poderesSuplementoSelecionaveis: conteudoLigado("Poderes"),
		/** Complicações (Heróis de Arton): [{doc, classe}] (classe null = geral). */
		complicacoes: sup.complicacoes ?? [],
		uuidsComplicacoes: new Set((sup.complicacoes ?? []).map((c) => c.doc.uuid)),
		/** Variantes de classes do suplemento → classe básica (para as complicações de classe). */
		variantes: { ...(configSuplementos.variantes ?? {}), ...VARIANTES_DO_CONSTRUTOR },
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
function efeitoAoUsar(nome, img, changes, { tipos = ["attack"], custo = null, aumenta = false, nomes = [], automatico = false, descricao = "" } = {}) {
	return {
		name: nome, img, type: "base", transfer: false, disabled: true,
		system: {
			changes: changes.map(([key, value, type = "add"]) => ({ key, value, type, phase: "initial", priority: null })),
			onuse: true,
			abilityUse: { description: descricao, automatic: automatico, aumenta, custo, names: nomes, types: tipos }
		}
	};
}

/**
 * Efeito aplicável de uma habilidade ativada (como o da Fúria): não vale sozinho na ficha; ao usar a
 * habilidade, o card do chat oferece aplicá-lo (no personagem ou nos alvos) com a duração da habilidade.
 */
function efeitoAplicavel(nome, img, changes) {
	return {
		name: nome, img, type: "base", transfer: false, disabled: false,
		system: { changes: changes.map(([key, value, type = "add"]) => ({ key, value, type, phase: "initial", priority: null })), onuse: false }
	};
}

/** Ativação no formato do sistema: execucao (action, move, full, reaction, free, hour, day, special) e custo em PM. */
const ativacao = (execucao, custo, { condicao = "", special = "" } = {}) => ({ execucao, custo, qtd: "", condicao, special });
const NA_CENA = { value: 0, units: "scene", special: "" };

/** Efeito "somar" no formato dos efeitos de poder do sistema (Foundry v14). */
function efeitoSomar(nome, img, changes) {
	return {
		name: nome, img, type: "base", transfer: true, disabled: false,
		system: { changes: changes.map(([key, value]) => ({ key, value, type: "add", phase: "initial", priority: null })), onuse: false }
	};
}

/**
 * Aviso de direitos autorais acrescentado às descrições que o construtor define (textos tirados dos
 * livros de Tormenta20): elas vão para a ficha, então o aviso vai junto.
 */
export const AVISO_DIREITOS = "Conteúdo de Tormenta20 protegido por direitos autorais da Jambô Editora. Uso pessoal: não compartilhe nem redistribua.";
const comAvisoDireitos = (html) => (String(html ?? "").includes("t20cf-direitos") ? html
	: `${html ?? ""}<p class="t20cf-direitos"><em>${AVISO_DIREITOS}</em></p>`);

/** Pasta dos ícones de habilidades de classe do sistema (usada pelas classes do construtor). */
const ICONES_CLASSE = "systems/tormenta20/icons/poderes/classes";

/* ---------- Místico (SDD/fontes/origem-mistico.pdf) ---------- */

/** Classe do suplemento reescrita pelo construtor: os poderes dela no suplemento (versão antiga) saem das listas. */
const CLASSES_REESCRITAS = new Set(["Místico"]);

const ICONE_MISTICO = "icons/magic/control/silhouette-aura-energy.webp";
const ICONE_AFINIDADE = "icons/magic/symbols/elements-air-earth-fire-water.webp";

/** Tabela "Os Seis Elementos" (parceiro-magia.pdf) e expressões naturais, na descrição da Afinidade Elemental. */
const NOMES_ESCOLAS = { abj: "Abjuração", con: "Convocação", enc: "Encantamento", ilu: "Ilusão", nec: "Necromancia", tra: "Transmutação" };
const NOMES_PERICIAS = { dipl: "Diplomacia (Car)", enga: "Enganação (Car)", acro: "Acrobacia (Des)", cura: "Cura (Sab)", inve: "Investigação (Int)", inti: "Intimidação (Car)" };
const QUADRO_ELEMENTOS = "<p><strong>Tabela: Os Seis Elementos</strong></p><table><thead><tr><th>Elemento</th><th>Energia</th><th>Escola de magia</th><th>Combate Elemental</th><th>Perícia</th><th>Pacto Elemental</th></tr></thead><tbody>"
	+ Object.values(ELEMENTOS).map((e) => `<tr><td>${e.nome}</td><td>${e.rotuloDano[0].toUpperCase()}${e.rotuloDano.slice(1)}</td><td>${NOMES_ESCOLAS[e.escola]}</td><td>${e.condicao[0].toUpperCase()}${e.condicao.slice(1)}${e.dano === "fogo" ? "*" : ""}</td><td>${NOMES_PERICIAS[e.pericia]}</td><td>${e.parceiros.slice(0, -1).join(", ")} ou ${e.parceiros.at(-1)}</td></tr>`).join("")
	+ "</tbody></table><p><em>*Não tem duração de uma rodada.</em></p>"
	+ "<p><strong>Expressão natural dos elementos.</strong> Alguns poderes fazem referência a expressões naturais de um elemento. Isso quer dizer uma manifestação do elemento que ocorra sem que seja alimentada de magia. Uma fogueira pode servir como uma expressão natural de fogo mesmo que tenha sido acesa com uma <em>Bola de Fogo</em>, mas um ber’baram ou outro elemental não poderia, bem como chamas da magia <em>Muralha Elemental</em>. Para luz, expressões naturais são ambientes iluminados e para trevas são ambientes desprovidos de iluminação. Para água, corpos de água como poças, lagos e rios são expressões naturais, desde que estejam limpos. Para terra, montanhas e extensões de terra fértil são expressões naturais. Para ar, ambientes com ar puro servem como expressões naturais; normalmente, em grandes cidades, elas são encontrados apenas em altitudes elevadas.</p>";

/** Regras gerais dos guias elementais (parceiro-magia.pdf), na descrição do Pacto Elemental e de cada guia. */
const REGRAS_GUIAS = "<p><strong>Guias elementais.</strong> Guias elementais são um tipo especial de parceiro. Além de atuarem como parceiros iniciantes normais (veja o tipo na tabela “Os Seis Elementos”: água, assassino, perseguidor ou vigilante; ar, ajudante, guardião ou médico; fogo, atirador, combatente ou fortão; luz, guardião, médico ou vigilante; terra, combatente, guardião ou montaria; trevas, assassino, magivocador ou perseguidor), eles usam as seguintes regras adicionais:</p><ul>"
	+ "<li>Um guia elemental deve ser invocado através de uma expressão natural do seu elemento de qualquer tamanho. Isso requer uma ação de movimento e 2 PM. O guia desaparece no final da cena. No 7º nível você pode gastar +1 PM para invocar seu guia como um parceiro veterano e no 15º nível você pode gastar +2 PM para invocar seu guia como um parceiro mestre.</li>"
	+ "<li>Em seu turno, você pode dar uma ordem para o guia usando uma ação de movimento. As opções de ordem de cada guia são apresentadas em sua descrição. Algumas destas ordens custam PM. Quaisquer bônus das ordens acumulam com os bônus de parceiro do guia, mas não com os bônus de outros parceiros. Todas essas ações são habilidades mágicas.</li>"
	+ "<li>Para alguns usos do guia, um teste será necessário. O bônus para testes do guia é igual à sua Sabedoria mais seu círculo máximo de magias. Para situações condizentes com a natureza do guia (como as ordens listadas para cada tipo), esse bônus aumenta em +2 por patamar do guia. Ordens além das listadas (como pedir a um elemental da água que apague um incêndio) também podem receber esse bônus, a critério do mestre. Para situações completamente avessas à natureza do guia (como pedir a um elemental da terra para se mover silenciosamente), aplique um redutor de mesmo valor.</li>"
	+ "<li>Se você tem um alikunhá, não precisa de uma expressão natural do seu elemento para invocar o guia. Em vez disso, você transforma o alikunhá no guia ao realizar o ritual.</li></ul>";

/** Ordens de cada guia elemental (parceiro-magia.pdf). */
const ORDENS_GUIAS = {
	agua: ["<em>Bolha.</em> O guia cria uma bolha esférica contendo ar, até o final da cena. A bolha tem um raio em metros igual à sua Sabedoria x3. Todas as criaturas no interior da bolha podem respirar normalmente, mesmo embaixo d’água. Você pode direcionar o elemental como uma ação de movimento, com deslocamento de natação 9m; além disso, pode gastar PM para aumentar esse deslocamento em +3m por PM (limitado pelo seu círculo máximo de magias) até o final da cena. A bolha estoura caso sofra qualquer dano.",
		"<em>Escudo Hídrico.</em> O guia se transforma em um disco de água rodopiante e o protege de ataques. Você recebe +2 na Defesa até o começo do seu próximo turno. Se uma criatura o atingir com um ataque corpo a corpo enquanto este efeito estiver ativo, você pode gastar 1 PM para fazer uma manobra de empurrar como reação.",
		"<em>Jato Hidráulico (1 PM).</em> O guia dispara um jato de água pressurizado em um alvo em alcance curto. O alvo sofre 3d6 pontos de dano de impacto (+1d6 por patamar acima de iniciante) e fica caído (Fortitude CD Sab reduz o dano à metade e evita a condição). Alternativamente, o jato pode empurrar uma criatura voluntária até 6m em uma direção à sua escolha."],
	ar: ["<em>Barreira Eólica.</em> Você recebe camuflagem contra ataques à distância e +2 em Reflexos por uma rodada.",
		"<em>Bons Ventos.</em> Ao contrário de outras ações do elemental, esta é uma reação; você pode lançar <em>Queda Suave</em>, mas apenas em você mesmo.",
		"<em>Planar (2 PM).</em> Uma criatura em alcance curto recebe deslocamento de voo 12m por uma rodada."],
	fogo: ["<em>Aura de Calor.</em> Até sua próxima rodada, inimigos que terminarem seus turnos adjacentes a você sofrem 2d6+2 pontos de dano de fogo.",
		"<em>Chicote de Chamas (2 PM).</em> O elemental acerta uma criatura em alcance curto com um jato de chamas que causa 4d6 pontos de dano de fogo (Reflexos CD Sab reduz à metade).",
		"<em>Labareda Propulsora.</em> Uma criatura em alcance curto recebe +10 em Atletismo para correr e saltar por uma rodada."],
	luz: ["<em>Brilhar.</em> Emite luz como uma tocha. Uma criatura dentro do alcance curto fica ofuscada por 1 rodada (Vontade CD Sab evita).",
		"<em>Curar (2 PM).</em> Uma criatura dentro do alcance curto cura 4d8 pontos de vida.",
		"<em>Cegar.</em> Uma criatura dentro do alcance curto fica cega por 1 rodada (apenas uma vez por cena; Vontade CD Sab evita)."],
	terra: ["<em>Arremesso de Rocha (2 PM).</em> O elemental arremessa um pedregulho contra um alvo em alcance médio, causando 5d6 pontos de dano de impacto (Reflexos CD Sab evita).",
		"<em>Muralha.</em> Você recebe resistência a corte, impacto e perfuração 10 por uma rodada.",
		"<em>Tunelar.</em> Uma criatura dentro do alcance curto recebe deslocamento de escalada 12m ou escavar 9m por uma rodada."],
	trevas: ["<em>Manto Sombrio.</em> Uma criatura dentro do alcance curto recebe +10 em Furtividade para se esconder por 1 rodada.",
		"<em>Tentáculo Obscuro (2 PM).</em> O elemental agarra uma criatura dentro do alcance médio com seu tentáculo.",
		"<em>Apavorar.</em> Uma criatura dentro do alcance curto fica abalada (Vontade CD Sab evita)."]
};

/* ---------- Distinções do construtor (SDD/fontes/distincoes.pdf) ---------- */

/**
 * Poder (ou marca) de uma distinção: só para quem tem a marca (distincoes.js). A "rolltag" faz o sistema
 * contar os itens da distinção (@Tag = marca + poderes), para os efeitos que crescem por poder.
 */
const distincao = (nomeDistincao, tag, nome, descricao, extra = {}) => ({
	nome, tipo: "distincao", subtipo: nomeDistincao, distincao: nomeDistincao, rolltags: [tag], descricao, ...extra
});

/** Vulnerabilidade a um tipo de dano (marcas do Gêmeo do Trovão e do Senhor das Chamas). */
function efeitoVulnerabilidade(nome, img, tipo) {
	return {
		name: nome, img, type: "base", transfer: true, disabled: false,
		system: { changes: [{ key: `system.tracos.resistencias.${tipo}.vulnerabilidade`, value: true, type: "override", phase: "initial", priority: null }], onuse: false }
	};
}

/** Habilidade de classe do místico (substitui a homônima da versão antiga, do suplemento). */
const habilidadeMistico = (nome, descricao, extra = {}) => ({
	nome, tipo: "ability", subtipo: "Místico", requerSuplemento: true, substituiSuplemento: true, img: ICONE_MISTICO, descricao, ...extra
});
/** Poder de místico (lista "Poder de Místico", 2º nível em diante). */
const poderMistico = (nome, descricao, extra = {}) => ({
	nome, tipo: "classe", subtipo: "Místico", requerSuplemento: true, substituiSuplemento: true, img: ICONE_MISTICO, descricao, ...extra
});
/** Ditame: as magias entram na ficha no nível de místico indicado ("No 6º nível, aprende…"). */
const ditame = (nome, descricao, magias, extra = {}) => poderMistico(nome, descricao, {
	magiasPorNivel: magias.map(([magia, nivel]) => ({ nome: magia, nivel })), ...extra
});

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
	// ---------- Místico, nova versão (SDD/fontes/origem-mistico.pdf) ----------
	// Substitui o místico do suplemento (Dragão Brasil #199): habilidades e poderes homônimos são trocados pelos
	// daqui, e os que não existem mais (Ataque Elemental, Golpes, Manifestações…) saem das listas (CLASSES_REESCRITAS).
	habilidadeMistico("Afinidade Elemental", `<p>Escolha um elemento entre água, ar, fogo, luz, terra e trevas. Uma vez feita, essa escolha não pode ser mudada. Você recebe redução 5 contra o tipo de dano associado ao seu elemento (veja o quadro) para cada círculo de magia que pode lançar. Além disso, cada elemento adiciona uma perícia à sua lista de perícias de classe (ver tabela “Os Seis Elementos”). Finalmente, cada elemento causa um efeito adicional quando você usa Combate Elemental.</p>${QUADRO_ELEMENTOS}`, { img: ICONE_AFINIDADE }),
	habilidadeMistico("Combate Elemental", "<p>Quando faz um ataque com uma arma corpo a corpo, você pode gastar PM para infundir a arma com seu elemento. Para cada PM gasto (limitado pelo seu círculo máximo de magias), você causa +1d6 pontos de dano extra do seu elemento. Se causar dano, também causa uma condição (ver tabela “Os Seis Elementos”) por 1 rodada. Se você lançou uma magia do seu elemento no turno em que fez o ataque, recebe um bônus nesse teste de ataque igual ao dobro do círculo da magia.</p>", {
		img: "icons/skills/melee/strike-blade-hooked-orange-blue.webp",
		// 1 PM: +1d6; cada PM a mais, +1d6 (como o Golpe Divino do paladino)
		efeitos: () => [
			efeitoAoUsar("Combate Elemental", "icons/svg/upgrade.svg", [["dano", "1d6"]], { custo: 1 }),
			efeitoAoUsar("Combate Elemental", "icons/svg/upgrade.svg", [["dano", "1d6", "custom"]], { custo: 1, aumenta: true })
		]
	}),
	habilidadeMistico("Magias (Místico)", "<p>Você pode lançar magias arcanas de 1º círculo de evocação, de uma segunda escola definida por seu elemento e de uma terceira escola à sua escolha (uma vez feita, essa escolha não pode ser mudada). À medida que sobe de nível, pode lançar magias de círculos maiores (2º círculo no 6º nível, 3º círculo no 10º nível e 4º círculo no 14º nível).</p><p>Você começa com <em>Criar Elementos</em> e duas magias de 1º círculo a sua escolha. A cada nível par (2º, 4º etc.), aprende uma magia de qualquer círculo e escola que possa lançar.</p><p>Você pode lançar essas magias vestindo armaduras leves sem precisar de testes de Misticismo.</p><p>Seu atributo-chave para lançar magias é Sabedoria e você soma sua Sabedoria no seu total de PM. Veja o Capítulo 4 de <em>Tormenta20</em> para as regras de magia.</p><p>Alguns poderes fazem referência a magias do seu elemento. Isso quer dizer magias que causem dano do tipo do seu elemento e magias da escola associada ao seu elemento.</p><p><strong>Ditames.</strong> O místico expande suas magias conhecidas através de ditames, conjuntos temáticos fechados. Ele não tem acesso a habilidades como Conhecimento Mágico, do arcanista, precisando seguir padrões e tradições estabelecidos há muito tempo e passados de geração a geração. Quando adquire um poder de ditame, se o místico já conhecer uma das magias indicadas, pode trocá-la por outra magia arcana de mesmo círculo, desde que essa magia seja de uma de suas escolas permitidas.</p>", { img: `${ICONES_CLASSE}/conjuradores/magias-a.webp` }),
	habilidadeMistico("Língua Primordial", "<p>No 2º nível, você pode se comunicar com qualquer espírito com quem compartilhe Afinidade Elemental. Você recebe +5 em testes de Carisma e de perícias originalmente baseadas em Carisma com essas criaturas.</p>", { img: "icons/skills/trades/music-singing-voice-blue.webp" }),
	habilidadeMistico("Moldar Elemento", "<p>No 3º nível, você pode usar a energia elemental do ambiente para fortalecer suas magias. Se estiver em contato com uma expressão natural do seu elemento de tamanho Grande, você pode gastar uma ação de movimento para aumentar seu limite de PM para magias do seu elemento em +1. Conforme sobe de nível, você precisa de expressões cada vez menores e obtém bônus cada vez maiores com essa habilidade (Médio, +2 no 8º nível; Pequeno, +3 no 15º nível; veja a tabela “O Místico”).</p>", {
		img: "icons/magic/control/silhouette-hold-beam-blue.webp", ativacao: ativacao("move", 0)
	}),
	habilidadeMistico("Tradição Oral", "<p>A partir do 3º nível, você pode fazer testes de Conhecimento mesmo sem ser treinado e, quando faz um teste de Conhecimento ou Misticismo, pode gastar 1 PM para rolá-lo novamente.</p>", { img: "icons/magic/control/mouth-smile-deception-purple.webp" }),
	habilidadeMistico("Sexto Sentido", "<p>No 4º nível, você pode somar sua Sabedoria, limitada pelo seu nível, à sua Defesa.</p>", {
		img: "icons/magic/control/silhouette-hold-change-blue.webp",
		efeitos: (img) => [efeitoSomar("Sexto Sentido", img, [["system.attributes.defesa.bonus", "min(@nvl.mistico, @sab)"]])]
	}),
	habilidadeMistico("Afinidade Concentrada", "<p>Afinidade Evoluída (6º nível). A CD para resistir a suas magias aumenta em +2. Além disso, magias de dano causam um dado de dano extra do mesmo tipo.</p>", {
		img: "icons/magic/control/debuff-energy-hold-levitate-blue-yellow.webp",
		efeitos: () => [efeitoAoUsar("Afinidade Concentrada", "icons/svg/upgrade.svg", [["cd", 2]], { tipos: ["spell"], automatico: true })]
	}),
	habilidadeMistico("Afinidade Expandida", "<p>Afinidade Evoluída (6º nível). Escolha um segundo elemento para sua habilidade Afinidade Elemental. Você se torna treinado na perícia relacionada ao segundo elemento e recebe todos os benefícios de Afinidade Elemental relativos a ele, incluindo redução de dano e acesso a sua escola associada. Para todos os sentidos, o segundo elemento também é considerado seu elemento.</p>", { img: "icons/magic/control/debuff-energy-hold-levitate-blue-yellow.webp" }),
	habilidadeMistico("Comunhão Suprema", "<p>No 20º nível, você desenvolve uma comunhão perfeita com seu elemento. Você se torna imune ao tipo de dano da sua Afinidade Elemental e pode usar Moldar Elemento como uma ação livre com uma expressão elemental Minúscula (+4). Além disso, uma vez por cena, você pode gastar uma ação de movimento para receber três poderes de magia que cumpra os pré-requisitos à sua escolha. Se também gastar 1 PM por poder, você não precisa cumprir seus pré-requisitos. Você mantém os poderes até o final da cena. Finalmente, você pode gastar o dobro de PM em Combate Elemental.</p>", { img: "icons/magic/control/silhouette-hold-beam-blue.webp" }),

	poderMistico("Absorver Elemento", "<p>Uma vez por cena, quando está em contato com uma expressão natural do seu elemento de tamanho Médio ou maior, você pode gastar uma ação de movimento para absorver energia mágica. Você adquire uma quantidade de PM temporários igual ao seu círculo máximo de magias. Esses PM duram por uma cena e não são cumulativos.</p>", { ativacao: ativacao("move", 0) }),
	poderMistico("Afinidade Maior", "<p>Escolha um terceiro elemento para sua habilidade Afinidade Elemental. Você se torna treinado na perícia relacionada ao terceiro elemento e recebe todos os benefícios de Afinidade Elemental relativos a ele, incluindo redução de dano e acesso a sua escola associada. Para todos os sentidos, o terceiro elemento também é considerado seu elemento. <em>Pré-requisitos:</em> 12º nível de místico, Afinidade Expandida.</p>"),
	poderMistico("Andar pelas Paredes", "<p>Você recebe deslocamento de escalada igual ao seu deslocamento padrão. Você não fica desprevenido enquanto escala desse modo. <em>Pré-requisito:</em> Afinidade Elemental (terra).</p>", {
		// deslocamento igual ao padrão (o de caminhada da ficha)
		efeitos: (img) => [efeitoSomar("Andar pelas Paredes", img, [["system.attributes.movement.climb.base", "@attributes.movement.walk.base"]])]
	}),
	poderMistico("Armadura Rochosa", "<p>Você pode usar uma ação de movimento e 1 PM para criar uma couraça ou uma meia armadura de terra e rocha que não atrapalha os gestos necessários para lançar magias arcanas. Você é proficiente com a armadura e ela dura por uma cena antes de se desfazer em poeira. Se estiver em contato com uma expressão natural de terra Grande ou maior, a penalidade da armadura diminui em 1. <em>Pré-requisitos:</em> 4º nível de místico, Afinidade Elemental (terra).</p>", { ativacao: ativacao("move", 1), duracao: NA_CENA }),
	poderMistico("Auréola Celeste", "<p>Quando usa uma magia de abjuração ou que cause dano de luz, você pode gastar uma ação de movimento e PM para fazer uma auréola surgir sobre a cabeça de um aliado em alcance curto. A auréola concede 5 PV temporários por PM gasto, desaparecendo quando acabarem os PV ou no final da cena. Além disso, enquanto a auréola durar, o aliado recebe +1 em testes de resistência. <em>Pré-requisito:</em> Afinidade Elemental (luz).</p>", { ativacao: ativacao("move", 1), duracao: NA_CENA }),
	poderMistico("Busca Mágica", "<p>Escolha uma magia de um círculo ao qual você tenha acesso (mesmo não tendo acesso a escola da magia ou acesso a magias divinas). Seu guia elemental vai buscar a magia e você a aprende e pode lançar por um dia. Seu parceiro atravessa os planos de existência para encontrar a magia, se ausentando por uma hora por círculo da magia requisitada, mais uma hora adicional caso a magia seja de uma escola à qual você não tenha acesso e outra hora adicional caso a magia seja divina. <em>Pré-requisito:</em> Pacto Elemental.</p>"),
	poderMistico("Contramágica Elemental", "<p>Você pode fazer contramágicas contra magias do seu elemento usando qualquer magia do mesmo círculo. Se usar uma magia do seu elemento para fazer uma contramágica, pode fazê-lo como reação.</p>"),
	poderMistico("Contramágica Poderosa", "<p>Quando faz contramágicas usando magias do seu elemento, você pode usar magias um círculo abaixo da magia que quer anular. <em>Pré-requisito:</em> Contramágica Elemental.</p>"),
	poderMistico("Corpo Elemental", "<p>Uma vez por cena, você pode gastar uma ação de movimento para fortalecer seu físico. Você adquire uma quantidade de PV temporários igual a 5 vezes seu círculo máximo de magias, ou o dobro disso se estiver em contato com uma expressão natural do seu elemento de tamanho Médio ou maior. Esses PV duram por uma cena e não são cumulativos.</p>", { ativacao: ativacao("move", 0) }),
	ditame("Ditame Absoluto", "<p>Você ganha acesso ao 5º círculo de magias e aprende uma magia de uma escola associada à sua Afinidade Elemental. Você não pode saber mais de uma magia de 5º círculo. <em>Pré-requisitos:</em> 17º nível de místico, dois poderes de ditame.</p>", []),
	ditame("Ditame do Breu", "<p>Você aprende a magia <em>Escuridão</em>. No 10º nível, aprende <em>Anular a Luz</em> e <em>Manto de Sombras</em>. <em>Pré-requisito:</em> Afinidade Elemental (trevas).</p>", [["Escuridão", 1], ["Anular a Luz", 10], ["Manto de Sombras", 10]]),
	ditame("Ditame das Brumas", "<p>Você aprende a magia <em>Névoa</em>. No 6º nível, aprende <em>Camuflagem Ilusória</em> e <em>Miasma Mefítico</em>. <em>Pré-requisito:</em> Afinidade Elemental (água ou ar).</p>", [["Névoa", 1], ["Camuflagem Ilusória", 6], ["Miasma Mefítico", 6]]),
	ditame("Ditame das Chamas", "<p>Você aprende a magia <em>Explosão de Chamas</em>. No 6º nível, aprende <em>Controlar Fogo</em>. No 10º nível, aprende <em>Muralha Elemental</em> (somente fogo). <em>Pré-requisito:</em> Afinidade Elemental (fogo).</p>", [["Explosão de Chamas", 1], ["Controlar Fogo", 6], ["Muralha Elemental", 10]]),
	ditame("Ditame da Chuva", "<p>Você aprende a magia <em>Área Escorregadia</em>. No 6º nível, aprende <em>Tempestade Divina</em>. No 10º nível, aprende <em>Controlar Água</em>. <em>Pré-requisito:</em> Afinidade Elemental (água).</p>", [["Área Escorregadia", 1], ["Tempestade Divina", 6], ["Controlar Água", 10]]),
	// "Crânio Voador de Vladislav" no livro: no compêndio do sistema a magia se chama Crânio Voador
	ditame("Ditame do Crepúsculo", "<p>Você aprende as magias <em>Consagrar</em> e <em>Profanar</em>. No 6º nível, aprende <em>Crânio Voador de Vladislav</em>. <em>Pré-requisito:</em> Afinidade Elemental (luz ou trevas).</p>", [["Consagrar", 1], ["Profanar", 1], ["Crânio Voador", 6]]),
	ditame("Ditame da Cura", "<p>Você aprende a magia <em>Curar Ferimentos</em>. No 6º nível, aprende <em>Purificação</em>. No 10º nível, aprende <em>Sopro da Salvação</em>. <em>Pré-requisito:</em> Afinidade Elemental (luz).</p>", [["Curar Ferimentos", 1], ["Purificação", 6], ["Sopro da Salvação", 10]]),
	ditame("Ditame do Espadachim", "<p>Você aprende a magia <em>Concentração de Combate</em>. No 6º nível, aprende <em>Velocidade</em>. No 10º nível, aprende <em>Transformação de Guerra</em>. <em>Pré-requisito:</em> treinado em Luta.</p>", [["Concentração de Combate", 1], ["Velocidade", 6], ["Transformação de Guerra", 10]]),
	ditame("Ditame da Manhã", "<p>Você aprende a magia <em>Luz</em> e tem acesso a todos os seus aprimoramentos, como se fosse um conjurador arcano e divino. No 6º nível, aprende <em>Raio Solar</em>. No 10º nível, aprende <em>Coluna de Chamas</em>. <em>Pré-requisito:</em> Afinidade Elemental (fogo ou luz).</p>", [["Luz", 1], ["Raio Solar", 6], ["Coluna de Chamas", 10]]),
	ditame("Ditame da Montanha", "<p>Você aprende a magia <em>Primor Atlético</em>. No 10º nível, você aprende a magia <em>Controlar Terra</em>. No 14º nível, aprende <em>Terremoto</em>. <em>Pré-requisito:</em> Afinidade Elemental (terra).</p>", [["Primor Atlético", 1], ["Controlar Terra", 10], ["Terremoto", 14]]),
	ditame("Ditame dos Portais", "<p>Você aprende a magia <em>Salto Dimensional</em>. A partir do 10º nível, você aprende a magia <em>Teletransporte</em>. A partir do 14º nível, você aprende a magia <em>Viagem Planar</em>. <em>Pré-requisito:</em> 6º nível de místico.</p>", [["Salto Dimensional", 1], ["Teletransporte", 10], ["Viagem Planar", 14]]),
	ditame("Ditame da Profecia", "<p>Você aprende a magia <em>Augúrio</em>. No 10º nível, aprende <em>Lendas &amp; Histórias</em> e <em>Vidência</em>. Se lançar <em>Augúrio</em> em contato com uma expressão natural do seu elemento de tamanho Grande ou maior, não há chance de falha. <em>Pré-requisito:</em> 6º nível de místico.</p>", [["Augúrio", 1], ["Lendas e Histórias", 10], ["Vidência", 10]]),
	ditame("Ditame dos Ventos", "<p>Você aprende a magia <em>Queda Suave</em>. No 6º nível, aprende <em>Controlar Ar</em>. No 14º nível, aprende <em>Controlar o Clima</em>. <em>Pré-requisito:</em> Afinidade Elemental (ar).</p>", [["Queda Suave", 1], ["Controlar Ar", 6], ["Controlar o Clima", 14]]),
	poderMistico("Disparo em Linha", "<p>Quando usa Disparo Elemental, você pode gastar 2 PM para atingir vários alvos. Faça um ataque à distância e compare-o com a Defesa de cada inimigo em uma linha de 9m. <em>Pré-requisito:</em> Disparo Elemental.</p>"),
	poderMistico("Disparo Elemental", "<p>Você pode usar Combate Elemental com armas de ataque à distância. <em>Pré-requisito:</em> treinado em Pontaria.</p>"),
	poderMistico("Elemento Indomável", "<p>Quando usa Elemento Penetrante, se gastar 5 PM, você também ignora a imunidade dos alvos. <em>Pré-requisito:</em> 17º nível de místico.</p>"),
	poderMistico("Elemento Penetrante", "<p>Quando causa dano do seu elemento, você pode gastar uma quantidade de PM limitada pelo seu círculo máximo de magias. Para cada PM gasto dessa forma, você ignora até 10 pontos da redução de dano dos alvos contra esse tipo de dano.</p>"),
	poderMistico("Elemento Poderoso", "<p>Quando lança uma magia do seu elemento, você pode gastar PM (limitado pelo seu círculo máximo de magias) para aumentar seu poder. Para cada PM gasto, a CD para resistir a sua magia aumenta em +1. <em>Pré-requisito:</em> 6º nível de místico.</p>", {
		// +1 na CD por PM gasto, ao lançar uma magia do seu elemento
		efeitos: () => [
			efeitoAoUsar("Elemento Poderoso", "icons/svg/upgrade.svg", [["cd", 1]], { tipos: ["spell"], custo: 1 }),
			efeitoAoUsar("Elemento Poderoso", "icons/svg/upgrade.svg", [["cd", 1]], { tipos: ["spell"], custo: 1, aumenta: true })
		]
	}),
	poderMistico("Empuxo", "<p>Você sempre flutua na superfície de qualquer corpo d’água ou fluido similar, e ganha deslocamento de natação igual ao seu deslocamento padrão. <em>Pré-requisito:</em> Afinidade Elemental (água ou ar).</p>", {
		// deslocamento igual ao padrão (o de caminhada da ficha)
		efeitos: (img) => [efeitoSomar("Empuxo", img, [["system.attributes.movement.swim.base", "@attributes.movement.walk.base"]])]
	}),
	poderMistico("Escavadeira", "<p>Você recebe deslocamento de escavar igual a seu deslocamento padrão. <em>Pré-requisitos:</em> Afinidade Elemental (terra).</p>", {
		// deslocamento igual ao padrão (o de caminhada da ficha)
		efeitos: (img) => [efeitoSomar("Escavadeira", img, [["system.attributes.movement.burrow.base", "@attributes.movement.walk.base"]])]
	}),
	poderMistico("Estabilidade Terrena", "<p>Você recebe um bônus igual ao seu círculo máximo de magias em testes de manobra para se defender. <em>Pré-requisito:</em> Afinidade Elemental (terra).</p>"),
	poderMistico("Escudo Elemental", "<p>Quando usa seu Combate Elemental, você recebe um bônus na Defesa e em testes de resistência igual à quantidade de PM gastos nele por 1 rodada. Se você lançou uma magia do seu elemento neste turno, também recebe redução de dano igual ao dobro do círculo da magia por 1 rodada.</p>"),
	// exclusivo: o suplemento tem um "Familiar Elemental" concedido por Wynna, que continua valendo pelo nome
	poderMistico("Familiar Elemental", "<p>Você recebe um familiar arcano (<em>Tormenta20 Jogo do Ano</em>, página 38). Seu familiar deve ser um elemental com quem você compartilhe Afinidade Elemental (veja <em>Ameaças de Arton</em>).</p>", { exclusivo: true, substituiSuplemento: false }),
	poderMistico("Flagelo Elemental", "<p>Quando usa Combate Elemental e faz um acerto crítico, seu dano extra fornecido por Combate Elemental é multiplicado junto do dano da arma. Se você lançou uma magia de 4º ou 5º círculo do seu elemento neste turno, aumente o multiplicador de crítico em 1.</p>"),
	poderMistico("Frenesi Elemental", "<p>Uma vez por rodada, quando faz um acerto crítico com uma arma corpo a corpo, você pode gastar 2 PM para lançar uma magia do seu elemento como parte da mesma ação. Essa magia não pode receber aprimoramentos.</p>"),
	poderMistico("Hidratação", "<p>Quando lança uma magia de encantamento ou que cause dano de frio, você pode gastar PM para se hidratar. Cada PM gasto cura 5 PV. <em>Pré-requisito:</em> Afinidade Elemental (água).</p>"),
	poderMistico("Oito Nuvens", "<p>Quando lança uma magia de ilusão ou que cause dano de eletricidade, você pode gastar uma ação de movimento e PM para ser rodeado por nuvens até o final da cena. Cada nuvem custa 1 PM e concede +1 na Defesa; enquanto tiver cinco nuvens ou mais, você tem camuflagem. Quando um ataque contra você erra, uma nuvem se dissipa. Você não pode ter mais que oito nuvens. <em>Pré-requisito:</em> Afinidade Elemental (ar).</p>", { ativacao: ativacao("move", 1), duracao: NA_CENA }),
	poderMistico("Pacto Cooperativo", "<p>Uma vez por rodada, você pode dar ordens para seu guia elemental como uma ação livre. Seu guia também fornece bônus por flanquear contra um inimigo por rodada. <em>Pré-requisito:</em> Pacto Elemental.</p>"),
	poderMistico("Pacto Elemental", `<p>Você cria um vínculo mágico com uma criatura primordial através de um ritual. Este guia elemental é do mesmo tipo da sua Afinidade Elemental, obedece às suas ordens e se arrisca para ajudá-lo. Para receber seus benefícios, você deve invocá-lo (veja a seção “Guias Elementais”). <em>Pré-requisito:</em> 6º nível de místico.</p>${REGRAS_GUIAS}<p><em>Ao escolher este poder, o construtor põe na ficha o guia do elemento escolhido, com as ordens dele.</em></p>`),
	// Guias elementais (parceiro-magia.pdf): entram na ficha com o Pacto Elemental (o do elemento escolhido)
	...Object.entries(ORDENS_GUIAS).map(([k, ordens]) => habilidadeMistico(nomeGuia(k), `<p>Guia elemental de ${ELEMENTOS[k].nome.toLowerCase()} (Pacto Elemental): parceiro iniciante ${ELEMENTOS[k].parceiros.slice(0, -1).join(", ")} ou ${ELEMENTOS[k].parceiros.at(-1)}, à sua escolha. Invocar: ação de movimento e 2 PM, a partir de uma expressão natural de ${ELEMENTOS[k].nome.toLowerCase()} (ou do seu alikunhá); some no fim da cena. No 7º nível, +1 PM para invocar como veterano; no 15º, +2 PM como mestre. Testes do guia: Sabedoria + círculo máximo de magias (+2 por patamar do guia nas situações condizentes com a natureza dele, ou –2 por patamar nas avessas).</p><p><strong>Ordens</strong> (ação de movimento; habilidades mágicas):</p><ul>${ordens.map((o) => `<li>${o}</li>`).join("")}</ul>${REGRAS_GUIAS}`, {
		img: "icons/magic/control/silhouette-hold-beam-blue.webp", ativacao: ativacao("move", 2), duracao: NA_CENA, substituiSuplemento: false
	})),
	poderMistico("Pacto Hábil", "<p>Você recebe um bônus de +2 nos testes do seu guia elemental. Este bônus aumenta em +1 por patamar acima de iniciante (+3 no 5º nível, +4 no 11º nível, +5 no 17º nível). <em>Pré-requisito:</em> Pacto Elemental.</p>"),
	poderMistico("Perícia Mística", "<p>Você recebe um bônus de +2 nos testes da perícia da sua Afinidade Elemental. Este bônus aumenta em +1 por patamar acima de iniciante, como Pacto Hábil.</p>", {
		// +2 no patamar iniciante, +1 por patamar acima (@patamar: 1 a 4); ligar ao testar a perícia do elemento
		efeitos: () => [efeitoAoUsar("Perícia Mística", "icons/svg/upgrade.svg", [["roll", "1+@patamar"]], { tipos: ["skill"] })]
	}),
	poderMistico("Propulsão", "<p>Você pode gastar 1 PM para adquirir deslocamento de voo 12m, mas cai se não encerrar seu movimento em uma superfície que sustente seu peso. A partir do 10º nível, você aprende e pode lançar <em>Voo</em>. <em>Pré-requisito:</em> Afinidade Elemental (ar ou fogo).</p>", {
		ativacao: ativacao("free", 1), magiasPorNivel: [{ nome: "Voo", nivel: 10 }]
	}),
	poderMistico("Resistência Tenebrosa", "<p>Quando faz um teste de resistência, você pode gastar 1 PM para receber um bônus igual ao círculo máximo de magia que pode lançar. <em>Pré-requisito:</em> Afinidade Elemental (trevas).</p>", {
		efeitos: () => [efeitoAoUsar("Resistência Tenebrosa", "icons/svg/upgrade.svg", [["roll", CIRCULO_MISTICO]], { tipos: ["skill"], custo: 1, nomes: ["Fortitude", "Reflexos", "Vontade"] })]
	}),
	poderMistico("Supernova", "<p>Quando lança uma magia instantânea que cause dano de fogo, você pode sofrer perda de vida (limitada a 5x seu círculo máximo de magia) para deixar as chamas brancas e mais perigosas. Cada 5 PV perdidos aumentam o dano em +1d12. <em>Pré-requisito:</em> Afinidade Elemental (fogo).</p>"),
	poderMistico("Sustento Primordial", "<p>Quando descansa em contato com uma expressão natural do seu elemento de tamanho Grande ou maior, suas condições de descanso melhoram em um passo.</p>"),
	poderMistico("Visão Noturna", "<p>Você recebe visão na penumbra. Se já tem visão na penumbra, em vez disso, recebe visão no escuro. Se já tem visão na penumbra e visão no escuro, em vez disso, quando faz ataques afetados por camuflagem leve ou total, a chance de falha é reduzida em 10% (camuflagem leve fica com 10% de chance e camuflagem total fica com 40%). <em>Pré-requisito:</em> Afinidade Elemental (trevas).</p>"),

	// Origens regionais de Ubani (SDD/fontes/origem-mistico.pdf). "periciasOrigem": treinadas pelo benefício.
	{
		// "(Ubani)": o Heróis de Arton tem um poder geral de qareen chamado Ajudante Nato
		nome: "Ajudante Nato (Ubani)",
		tipo: "origem", subtipo: "Ubani", regiao: "Ubani",
		img: "icons/skills/trades/academics-astronomy-navigation-purple.webp",
		descricao: "<p>Você abraçou perfeitamente os ideais comunitários de Ubani. Todos são capazes por conta própria, mas você consegue fazer todos cooperarem ainda mais para ter resultados melhores.</p><p><strong>Benefício.</strong> Você recebe +10 em testes de perícia para ajudar, e pode fazer testes para ajudar mesmo quando não é treinado na perícia. Além disso, você se torna treinado em uma perícia à sua escolha e recebe um alikunhá (ver <em>Atlas de Arton</em>, p. 471).</p><p><strong>Itens.</strong> Essência de mana x2, pergaminho com magia de 1º círculo, lança.</p>",
		itensOrigem: [{ nome: "Essência de mana", qtd: 2 }, { texto: "Pergaminho (magia de 1º círculo)" }, { nome: "Lança" }, { texto: "Alikunhá" }]
	},
	{
		nome: "Bori Enredado",
		tipo: "origem", subtipo: "Ubani", regiao: "Ubani",
		img: "icons/skills/trades/academics-astronomy-navigation-purple.webp",
		descricao: "<p>Você nasceu com grande potencial arcano, mas sob um mau agouro. As coisas costumam dar errado com você.</p><p><strong>Benefício.</strong> Você recebe +3 pontos de mana e +2 em Misticismo e a CD para resistir a suas magias aumenta em +1. Porém, quando faz um teste e o resultado do d20 é 2 ou 3, você falha automaticamente (como se tivesse tirado 1 natural).</p><p><strong>Itens.</strong> Essência de mana, um esotérico a sua escolha (até T$ 500) ou uma zipana.</p><p><strong>Zipana.</strong> Arma marcial leve • T$ 500 • Dano 1d4 • Crítico 19 • 1 espaço • Corte. Se for capaz de lançar magias arcanas e tiver redução de ácido, eletricidade, fogo, frio, luz ou trevas (inclusive por fontes temporárias como magias), você pode gastar 1 PM para borir uma zipana. Até o final da cena, a arma causa 1d8 pontos de dano do elemento ao qual você tem redução, em vez do seu dano normal. Um personagem deve ser treinado em Ofício (alquimia) para fabricar uma zipana. Esta arma não pode receber a melhoria material especial.</p>",
		itensOrigem: [{ nome: "Essência de mana" }, { texto: "Esotérico à sua escolha (até T$ 500) ou zipana" }],
		efeitos: (img) => [
			efeitoSomar("Bori Enredado", img, [["system.attributes.pm.bonus.total", 3], ["system.pericias.mist.bonus", 2]]),
			efeitoAoUsar("Bori Enredado: CD das magias", "icons/svg/upgrade.svg", [["cd", 1]], { tipos: ["spell"], automatico: true })
		]
	},
	{
		nome: "Celebrante da Vida",
		tipo: "origem", subtipo: "Ubani", regiao: "Ubani",
		img: "icons/skills/trades/academics-astronomy-navigation-purple.webp",
		descricao: "<p>Alguns habitantes de Ojumajele celebravam a vida. Eram oradores invejáveis, convidados para relembrar os falecidos nos aniversários de suas mortes. A visão de seus trajes pretos elaborados, cobertos de joias, trazia conforto aos corações dos que permaneciam. Ojumajele pode ter sido destruída, mas você ainda segue as tradições, glorifica a memória e convida para o amanhã.</p><p><strong>Benefício.</strong> Você se torna treinado em Diplomacia e Religião. Enquanto usa um traje da corte, recebe +5 em testes de Diplomacia para mudar atitude de ubaneris.</p><p><strong>Itens.</strong> Pergaminho de <em>Bênção</em>, poção de <em>Santuário</em>, símbolo sagrado (Allihanna, Kallyadranoch, Megalokk ou Wynna), traje da corte.</p>",
		periciasOrigem: ["dipl", "reli"],
		itensOrigem: [{ texto: "Pergaminho de Bênção" }, { texto: "Poção de Santuário" }, { nome: "Símbolo sagrado", rotulo: "Símbolo sagrado (Allihanna, Kallyadranoch, Megalokk ou Wynna)" }, { nome: "Traje da corte" }],
		// +5 em Diplomacia para mudar atitude de ubaneris, com traje da corte: opção ao testar
		efeitos: () => [efeitoAoUsar("Celebrante da Vida", "icons/svg/upgrade.svg", [["roll", 5]], { tipos: ["skill"], nomes: ["Diplomacia"] })]
	},
	{
		nome: "Verdugo da Morte",
		tipo: "origem", subtipo: "Ubani", regiao: "Ubani",
		img: "icons/skills/trades/academics-astronomy-navigation-purple.webp",
		descricao: "<p>Alguns habitantes de Ojumajele tratavam dos recém-mortos e dos desmortos descontrolados. A imagem de homens trajados de branco, usando colares de contas pretas e empunhando armas cortantes se tornou uma das mais agourentas da savana. Ojumajele não existe mais, mas você mantém viva a tradição dos verdugos, eliminando mortos-vivos e realizando ritos fúnebres.</p><p><strong>Benefício.</strong> Você se torna treinado em Religião e recebe proficiência com cimitarra e espada longa. Além disso, uma vez por rodada, quando acerta um alvo sangrando ou um morto-vivo com uma arma de corte, você pode gastar 1 PM para causar um dado de dano extra do mesmo tipo.</p><p><strong>Itens.</strong> Água benta x2, cimitarra ou espada longa, símbolo sagrado (Allihanna, Kallyadranoch, Megalokk ou Wynna), T$ 50 (pagamento por ritos fúnebres realizados).</p>",
		periciasOrigem: ["reli"],
		itensOrigem: [{ nome: "Água benta", qtd: 2 }, { texto: "Cimitarra ou espada longa (à escolha)" }, { nome: "Símbolo sagrado", rotulo: "Símbolo sagrado (Allihanna, Kallyadranoch, Megalokk ou Wynna)" }, { texto: "T$ 50 (pagamento por ritos fúnebres)" }]
	},
	// ---------- Distinções novas (SDD/fontes/distincoes.pdf) ----------
	// "distincao": nome da distinção (os poderes só aparecem para quem tem a marca; a marca entra pela admissão,
	// na subida de nível). "rolltags": o sistema conta os itens com a tag (@GemeoDoTrovao = marca + poderes),
	// então "por poder da distinção" = (@Tag - 1).
	// Gêmeo do Trovão
	distincao("Gêmeo do Trovão", "GemeoDoTrovao", "Comunhão Elétrica (Marca)", "<p><strong>Admissão.</strong> Uma verdadeira comunhão exige um elo muito forte entre o candidato e seu elemental. Não precisa ser necessariamente um alikunhá, mas a criatura deve estar presente constantemente, como um familiar, guia elemental ou melhor amigo. Além disso, o elo precisa transcender o comum: é uma conexão que transcende os limites do emocional e do espiritual. Isso pode ser demarcado com um sacrifício em prol do outro, mas nem sempre é necessário. O candidato ainda precisa, porém, demonstrar de alguma forma seus sentimentos sinceros e intensos pelo elemental.</p><p><strong>Comunhão Elétrica.</strong> Você tem redução de eletricidade 10, aumentando em 5 para cada poder da distinção obtido. Também recebe vulnerabilidade a ácido. Além disso, você pode alterar a CD dos poderes da distinção para o seu atributo-chave de magias, em vez de Con, caso deseje.</p>", {
		img: "icons/magic/air/air-wave-gust-blue.webp",
		efeitos: (img) => [efeitoSomar("Comunhão Elétrica", img, [
			["system.tracos.resistencias.eletricidade.bonus", "10 + 5 * (@GemeoDoTrovao - 1)"]
		]), efeitoVulnerabilidade("Comunhão Elétrica: vulnerabilidade", img, "acido")]
	}),
	distincao("Gêmeo do Trovão", "GemeoDoTrovao", "Dínamo Vivo", "<p><em>Ouça, meu povo, a história de Gilvir. Das lágrimas trouxe força, do luto trouxe união! Preencheu o vazio em seu coração com a fúria da tempestade.</em></p><p>Você pode gastar uma ação de movimento e PM para gerar eletricidade. Cada PM gasto concede uma carga elétrica, que dura até o final da cena. Você não pode ter mais cargas que o seu número de poderes da distinção + sua Constituição. Enquanto tiver cargas elétricas, seus ataques corpo a corpo com armas naturais ou armas de metal causam +1 ponto de dano extra de eletricidade para cada carga. Você pode gastar cargas como uma ação padrão para disparar raios. Um raio atinge todos os alvos em uma linha de 30m. Cada criatura na área sofre 1d6 pontos de dano de eletricidade por carga gasta e fica ofuscada por 1d4 rodadas (Ref CD Con reduz à metade e evita a condição). <em>Pré-requisitos:</em> treinado em Reflexos e Vontade.</p>", {
		img: "icons/magic/air/wind-tornado-cyclone-white.webp", ativacao: ativacao("move", 1), duracao: NA_CENA
	}),
	distincao("Gêmeo do Trovão", "GemeoDoTrovao", "Atração e Repulsão", "<p><em>Um gêmeo do trovão pode usar a eletricidade em seu corpo para atrair ou repelir objetos metálicos, de acordo com sua vontade.</em></p><p>Enquanto tiver uma carga elétrica, você pode usar uma ação de movimento e 1 PM para escolher um alvo no alcance curto. O alvo deve ser um objeto metálico ou uma criatura que esteja empunhando armas de metal, vestindo armaduras de metal ou que tenha metal na composição do corpo. Objetos soltos podem ser deslocados para qualquer lugar dentro do alcance curto, como se manipulados com Força igual à sua Constituição + número de poderes da distinção que você possui. Para outros alvos, faça uma manobra de combate, recebendo um bônus no teste de manobra igual a sua Constituição (ou seu atributo-chave de magias). No caso de manobras como desarmar ou empurrar, você decide se alvos são movidos na sua direção ou na direção contrária. Você pode gastar +1 PM para afetar humanoides e outras criaturas com ferro no sangue, independente de estarem portando itens metálicos.</p><p>Se usar uma ação padrão e gastar pelo menos uma carga elétrica, você pode emitir uma onda eletromagnética. Todas as criaturas e objetos em alcance curto sofrem dano de eletricidade e são empurradas para trás. Cada carga elétrica causa 1d6 pontos de dano de eletricidade e empurra 1,5m (Ref CD Con reduz o dano à metade e impede o empurrão). <em>Pré-requisitos:</em> Dínamo Vivo.</p>", {
		img: "icons/magic/air/wind-tornado-cyclone-white.webp", ativacao: ativacao("move", 1)
	}),
	distincao("Gêmeo do Trovão", "GemeoDoTrovao", "Escudo Cintilante", "<p><em>A proteção do espírito gêmeo toma a forma de uma camada de energia cintilante capaz de desviar ataques. Até mesmo quando o gêmeo do trovão é atingido, um lampejo de poder elemental absorve a energia do ataque e ofusca o atacante.</em></p><p>Quando usa Dínamo Vivo, você pode gastar +1 PM para se envolver em um campo de força defensivo. Você soma +1 na Defesa por cada carga que tiver. Além disso, quando um inimigo acerta você, fica ofuscado por 1d4 rodadas (Fortitude CD Con evita a condição) e você recebe uma carga elétrica. Finalmente, no seu turno, como uma ação livre, você pode gastar cargas para fortalecer seu campo de força. Cada carga gasta concede 5 PV temporários. <em>Pré-requisitos:</em> Dínamo Vivo.</p>", {
		img: "icons/magic/air/wind-tornado-cyclone-white.webp"
	}),
	distincao("Gêmeo do Trovão", "GemeoDoTrovao", "Salto Trovejante", "<p><em>Com um mero salto, o gêmeo do trovão pode cruzar os céus tal qual um pássaro.</em></p><p>Seu deslocamento aumenta em 1,5m por carga elétrica que você tiver. Além disso, você pode gastar 1 PM para voar 9m como uma ação livre. Este movimento deve terminar em uma superfície que possa suportar seu peso. Você pode gastar uma carga na decolagem ou na aterrissagem para causar um trovão e atordoar todas as criaturas a 1,5m de você (Fortitude CD Con evita a condição; uma criatura só pode ser atordoada por esse efeito uma vez por cena). <em>Pré-requisitos:</em> Atração e Repulsão.</p>", {
		img: "icons/magic/air/wind-tornado-cyclone-white.webp", ativacao: ativacao("free", 1)
	}),
	distincao("Gêmeo do Trovão", "GemeoDoTrovao", "Super Choque", "<p><em>O relâmpago é servo e arma daqueles capazes de emular Gilvir.</em></p><p>Quando usa Dínamo Vivo para disparar raios, você causa 1d12 pontos de dano de eletricidade por carga gasta e pode gastar +1 PM para ignorar a redução de eletricidade do alvo. Além disso, enquanto tiver cargas de eletricidade, seus acertos críticos corpo a corpo com armas naturais e armas metálicas deixam o alvo atordoado por uma rodada (apenas uma vez por cena; Fortitude CD Con evita). Finalmente, você pode usar Dínamo Vivo para gerar cargas de eletricidade como uma ação livre, uma vez por rodada. <em>Pré-requisitos:</em> Escudo Cintilante, Salto Trovejante.</p>", {
		img: "icons/magic/air/wind-tornado-cyclone-white.webp"
	}),

	// Retalhador Panzajiri
	distincao("Retalhador Panzajiri", "RetalhadorPanzajiri", "Instinto Assassino (Marca)", "<p><strong>Admissão.</strong> O candidato deve ser treinado por um retalhador experiente (como Gizachini Ojumajele, o Tio Giz, diretor da Escola de Etiqueta Elemental em Mirandege). Mesmo depois de ser treinado alguns meses por um mestre, o candidato deve realizar um ritual: medita com incensos especiais acesos, induzindo um estado de transe hipnótico, no qual contempla a própria mortalidade e a severidade do ato de matar. Aqueles que mantêm a perseverança se tornam retalhadores.</p><p><strong>Instinto Assassino.</strong> <em>Um retalhador panzajiri aprende a manter a parte agressiva da própria mente dissociada do seu dia a dia. Porém, ao sacar sua espada, esse instinto assassino aflora — e que a Mãe tenha piedade de seus inimigos.</em> Você recebe +2 em Furtividade e no dano de armas de corte corpo a corpo. Esses bônus aumentam em um para cada dois poderes da distinção que você possuir.</p>", {
		img: "icons/skills/melee/strike-sword-slashing-red.webp",
		efeitos: (img) => [
			efeitoSomar("Instinto Assassino", img, [["system.pericias.furt.bonus", "2 + floor((@RetalhadorPanzajiri - 1) / 2)"]]),
			// dano de armas de corte corpo a corpo: opção ao atacar (o sistema não filtra pelo tipo de dano)
			efeitoAoUsar("Instinto Assassino: dano (corte, corpo a corpo)", "icons/svg/upgrade.svg", [["dano", "2 + floor((@RetalhadorPanzajiri - 1) / 2)"]])
		]
	}),
	distincao("Retalhador Panzajiri", "RetalhadorPanzajiri", "Talho Tenebroso", "<p><em>Espada e sombra separados são perigosos. Quando combinados, são mortíferos.</em></p><p>Quando faz um ataque com uma arma de corte corpo a corpo, você pode gastar 1 PM para causar +1d8 pontos de dano extra de trevas. Esse dado de dano é multiplicado em acertos críticos e aumenta em um passo para cada dois poderes da distinção que você possuir. Além disso, vítimas do seu Talho Tenebroso não podem curar PV por 1 rodada. <em>Pré-requisitos:</em> proficiente com uma arma de corte corpo a corpo marcial, treinado em Furtividade e Luta.</p>", {
		img: "icons/skills/melee/strike-sword-slashing-red.webp",
		// +1d8 de trevas (o passo a mais a cada dois poderes fica no texto)
		efeitos: () => [efeitoAoUsar("Talho Tenebroso", "icons/svg/upgrade.svg", [["dano", "1d8[trevas]"]], { custo: 1 })]
	}),
	distincao("Retalhador Panzajiri", "RetalhadorPanzajiri", "Ardil da Lâmina", "<p><em>Um retalhador desaparece nas sombras projetadas pela própria espada.</em></p><p>Quando faz um um ataque com uma arma de corte corpo a corpo, se fizer um acerto crítico ou acertar um alvo desprevenido, você recebe camuflagem leve por escuridão contra o alvo. Esse efeito dura até o início do seu próximo turno ou até você fazer um ataque contra outro alvo. <em>Pré-requisitos:</em> Talho Tenebroso.</p>", {
		img: "icons/magic/perception/silhouette-stealth-shadow.webp"
	}),
	distincao("Retalhador Panzajiri", "RetalhadorPanzajiri", "Cortar Almas", "<p><em>O maior dique do rio da vida é a lâmina do retalhador.</em></p><p>Quando usa Talho Tenebroso, você ignora redução de dano e imunidade contra corte e trevas, exceto caso o alvo seja imune tanto a corte quanto a trevas. Além disso, quando usa Talho Tenebroso e faz um acerto crítico ou reduz o alvo a 0 PV, você recebe 1 PM temporário para cada poder da distinção. <em>Pré-requisitos:</em> Talho Tenebroso.</p>", {
		img: "icons/skills/melee/strike-sword-slashing-red.webp"
	}),
	distincao("Retalhador Panzajiri", "RetalhadorPanzajiri", "Mortalha Afiada", "<p><em>As sombras que rodeiam um retalhador escondem mais lâminas do que ele empunha.</em></p><p>Quando for alvo de um ataque, você pode gastar 1 PM para receber camuflagem leve por escuridão. Se já tinha camuflagem leve, recebe camuflagem total. Se o ataque errar, seu inimigo sofre dano de trevas igual ao seu dano extra de Talho Tenebroso. <em>Pré-requisitos:</em> Talho Tenebroso.</p>", {
		img: "icons/magic/perception/silhouette-stealth-shadow.webp", ativacao: ativacao("reaction", 1)
	}),
	distincao("Retalhador Panzajiri", "RetalhadorPanzajiri", "Passo Instantâneo", "<p><em>Um piscar de olhos é a única coisa que separa o retalhador de sua vítima.</em></p><p>Você recebe +3m de deslocamento e +2 em Acrobacia. Além disso, quando se move mais de seis metros, você pode gastar 1 PM para escolher um inimigo dentro de uma área com 9m de raio. Você pode fintar contra esse inimigo como uma ação livre, usando Furtividade em vez de Enganação. <em>Pré-requisitos:</em> treinado em Acrobacia, Ardil da Lâmina.</p>", {
		img: "icons/skills/movement/feet-winged-boots-glowing-yellow.webp",
		efeitos: (img) => [efeitoSomar("Passo Instantâneo", img, [["system.attributes.movement.walk.bonus", 3], ["system.pericias.acro.bonus", 2]])]
	}),

	// Senhor das Chamas
	distincao("Senhor das Chamas", "SenhorDasChamas", "Abraço da Chama (Marca)", "<p><strong>Admissão.</strong> Tornar-se um senhor das chamas exige longos períodos de treinamento em lugares de clima quente, verdadeiros infernos onde uma pessoa normal não sobreviveria mais que poucos dias (as areias escaldantes de Halak-Tûr, as regiões vulcânicas de Sckharshantallas e das Montanhas Sanguinárias). A última etapa do treinamento leva os candidatos a Pyra, mundo de Thyatis. Aqueles que sobrevivem à jornada voltam para casa como membros da distinção.</p><p><strong>Abraço da Chama.</strong> Você tem redução de fogo 10, aumentando em 5 para cada poder da distinção obtido. Também recebe vulnerabilidade a frio. Além disso, você pode alterar a CD dos poderes da distinção para o seu atributo-chave de magias, em vez de Con, caso deseje.</p>", {
		img: "icons/magic/fire/beam-strike-whip-red.webp",
		efeitos: (img) => [efeitoSomar("Abraço da Chama", img, [
			["system.tracos.resistencias.fogo.bonus", "10 + 5 * (@SenhorDasChamas - 1)"]
		]), efeitoVulnerabilidade("Abraço da Chama: vulnerabilidade", img, "frio")]
	}),
	distincao("Senhor das Chamas", "SenhorDasChamas", "Labaredas", "<p><em>Quando a chama é domada, se torna uma arma perigosa em qualquer distância.</em></p><p>Você pode gastar 1 PM para conceder o encanto flamejante às suas armas empunhadas e ataques desarmados até o final da cena. O dado de dano de fogo extra (d6) e cada dado de dano da bola de fogo (ou da magia homônima, se a tiver aprendido) aumentam em um passo para cada dois outros poderes da distinção: esse é o seu dado de labareda. Quando usa a bola de fogo do encanto flamejante ou a magia homônima, você pode optar por trocar o atributo da CD do teste de resistência para Con. Além disso, ao fazer a ação agredir, você também pode gastar 1 PM para disparar rajadas de fogo. Elas funcionam como uma arma à distância de disparo com alcance curto, causando dano igual a dois dados de labareda. Finalmente, enquanto tiver uma arma flamejante, você pode gastar uma ação de movimento para cauterizar ferimentos e remover a condição sangrando de você ou de outra criatura. <em>Pré-requisitos:</em> treinado em Fortitude e Sobrevivência.</p>", {
		img: "icons/magic/fire/beam-strike-whip-red.webp", ativacao: ativacao("free", 1), duracao: NA_CENA
	}),
	distincao("Senhor das Chamas", "SenhorDasChamas", "Contos nas Cinzas", "<p><em>Nas cinzas do passado, o senhor das chamas é capaz de enxergar fatos.</em></p><p>Você aprende e pode lançar <em>Augúrio</em> como uma magia simulada, usando cinzas para a adivinhação. Se tiver cinco poderes da distinção, você pode tocar as cinzas de uma criatura ou objeto para lançar <em>Lendas e Histórias</em> como uma magia simulada para obter informações sobre a criatura ou objeto queimados. Caso já tenha aprendido essas magias, seus custos diminuem em –1 PM (cumulativo com outros redutores de custo). <em>Pré-requisitos:</em> Labaredas.</p>", {
		img: "icons/magic/fire/flame-burning-campfire-red.webp"
	}),
	distincao("Senhor das Chamas", "SenhorDasChamas", "Em Chamas", "<p><em>A carne se desfaz em um inferno flamejante, fazendo os inimigos se arrependerem de agarrar o senhor das chamas.</em></p><p>Você pode gastar 2 PM e uma ação de movimento para imolar o próprio corpo. Você fica envolto em chamas, emitindo luz como uma tocha, até o fim da cena. Durante esse período, você recebe deslocamento de voo igual ao seu deslocamento padrão e pode rolar novamente seu dado de labareda se obtiver um resultado 1 ou 2. Além disso, qualquer criatura que comece seu turno a 1,5m de você sofre dano de fogo igual ao seu dado de labareda e fica em chamas (Reflexos CD Con evita o dano e a condição). <em>Pré-requisitos:</em> Labaredas.</p>", {
		img: "icons/magic/fire/barrier-wall-flame-ring-yellow.webp", ativacao: ativacao("move", 2), duracao: NA_CENA
	}),
	distincao("Senhor das Chamas", "SenhorDasChamas", "Moldar Fogo", "<p><em>Para o senhor das chamas, o fogo pode assumir qualquer forma.</em></p><p>Você pode lançar <em>Explosão de Chamas</em> e <em>Bola de Fogo</em> como magias simuladas. Se tiver cinco poderes da distinção, também pode lançar <em>Muralha Elemental</em> (somente fogo) como uma magia simulada. Caso já tenha aprendido essas magias, seus custos diminuem em –1 PM (cumulativo com outros redutores de custo). <em>Pré-requisitos:</em> Labaredas.</p>", {
		img: "icons/magic/fire/beam-strike-whip-red.webp"
	}),
	distincao("Senhor das Chamas", "SenhorDasChamas", "Obliterar", "<p><em>A chama mais intensa pode queimar absolutamente qualquer coisa.</em></p><p>Quando causa dano de fogo, você pode gastar PM para aumentar esse dano. Cada PM gasto aumenta o dano em um dado extra do mesmo tipo, limitado pela quantidade de poderes da distinção que possui. Você também pode gastar +1 PM para ignorar redução de fogo e +3 PM para ignorar imunidade a fogo. <em>Pré-requisitos:</em> Labaredas.</p>", {
		img: "icons/magic/fire/beam-strike-whip-red.webp"
	}),
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
		img: "systems/tormenta20/icons/magias/alterar-tamanho.webp",
		descricao: "<p>Você é uma categoria de tamanho menor que o padrão de sua raça (exceto se sua raça já for Minúscula; nesse caso, a mudança é apenas estética).</p>"
	},
	{
		nome: "Protegido dos Deuses",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "systems/tormenta20/icons/magias/protecao-divina.webp",
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
		img: "systems/tormenta20/icons/poderes/origem.webp",
		descricao: "<p>Você não recebe benefícios de origem. Você está apenas começando a viver os anos que definirão quem você será!</p>"
	},
	{
		nome: "Ímpeto Juvenil",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "systems/tormenta20/icons/itens/gerais/essencia-mana.webp",
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
		img: "systems/tormenta20/icons/svg/scroll-unfurled.svg",
		descricao: "<p>Você recebe apenas um benefício de origem, em vez de dois (se sua origem possuir um único benefício, comece com uma perícia treinada a menos por sua classe).</p>"
	},
	{
		nome: "Veterano Calejado",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "systems/tormenta20/icons/magias/lendas-historias.webp",
		descricao: "<p>Você começa o jogo com um nível adicional em relação aos personagens mais novos do grupo. Por exemplo, se o grupo vai começar no 1º nível, você começa no 2º. Contudo, essa experiência tem seu preço — você recebe duas complicações de idade.</p>"
	},
	{
		nome: "Ai Minhas Costas",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "systems/tormenta20/icons/conditions/lento.svg",
		descricao: "<p>Você começa o jogo com dois níveis adicionais. Contudo, perde 1 ponto em todos os atributos físicos (Força, Destreza e Constituição) e recebe três complicações de idade. Além disso, não pode escolher o poder Aumento de Atributo para nenhum atributo físico — infelizmente, os tempos de vigor ficaram para trás.</p>"
	},
	{
		nome: "O Inverno da Vida",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "systems/tormenta20/icons/itens/gerais/gelo-eterno.webp",
		descricao: "<p>Você começa o jogo com três níveis adicionais. Porém, perde 2 pontos em todos os atributos físicos (Força, Destreza e Constituição) e recebe quatro complicações de idade. Assim como velhos, você não pode escolher o poder Aumento de Atributo para atributos físicos.</p>"
	},
	{
		nome: "Já Vi Coisas",
		tipo: "ability", subtipo: "Idade", exclusivo: true,
		img: "systems/tormenta20/icons/poderes/classes/especialistas/olhos-costas.webp",
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
		// prioridade 60: aplica depois do deslocamento racial, que é um "override" (prioridade padrão 50)
		efeitos: (img) => [{
			name: "“Devagar, Jovem!”", img, type: "base", transfer: true, disabled: false,
			system: { changes: [
				{ key: "system.attributes.movement.walk.base", value: -3, type: "add", phase: "initial", priority: 60 }
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
	// Qareen ubaneri (variante de qareen, Dragão Brasil 233): Linhagem Kipane substitui Desejos; o ancestral
	// escolhido (uma das seis opções) entra na ficha como um poder à parte, com o bônus de perícia no efeito
	{
		nome: "Linhagem Kipane",
		tipo: "racial", subtipo: "Qareen Ubaneri",
		img: "systems/tormenta20/icons/racas/qareen.webp",
		descricao: "<p>Você herdou um talento da sua ancestral que derrotou uma dracofera primordial. Escolha um destes ancestrais: <em>Água</em>, <em>Ar</em>, <em>Fogo</em>, <em>Luz</em>, <em>Terra</em> ou <em>Trevas</em> (cada um é um poder: Linhagem Kipane - Água, - Ar…).</p>"
	},
	...[
		["Água", "acro", "<p>Como sua ancestral que driblou o kraken Kivulisi, você tem movimentos fluidos e ágeis. Recebe +2 em Acrobacia e, uma vez por rodada, pode gastar 1 PM para se mover 6m como uma ação livre.</p>",
			{ ativacao: { execucao: "free", custo: 1, qtd: "", condicao: "uma vez por rodada", special: "" } }],
		["Ar", "perc", "<p>Como sua ancestral que perseguiu o roca Mirandege, você tem sentidos aguçados e paciência considerável. Recebe +2 em Percepção, +2 em testes em que escolhe 10 e +5 em testes para manter a concentração em magias.</p>"],
		["Fogo", "dipl", "<p>Como sua ancestral que fez a salamandra Ejotó rir, você tem senso de humor afiado. Recebe +2 em Diplomacia e causa 1 ponto de dano adicional para cada dado de dano psíquico.</p>"],
		["Luz", "cava", "<p>Como sua ancestral que fez companhia ao unicórnio Darandaran, você trabalha bem em equipe. Recebe +2 em Cavalgar e aumenta o bônus de parceiro em 1. Se seu parceiro concede mais de um bônus, escolha um deles para aumentar (se fornece bônus em perícia, aumente em +1; se fornece bônus em rolagens de dano, aumente em +1; se fornece bônus na Defesa, aumente em +1; etc.).</p>"],
		["Terra", "atle", "<p>Como sua ancestral que superou o bulette Ardile em força bruta, você tem um físico robusto. Recebe +2 em Atletismo e manobras de combate.</p>"],
		["Trevas", "furt", "<p>Como sua ancestral que emboscou o basilisco Ojumajele, você é esquivo. Recebe +2 em Furtividade e testes de resistência contra venenos.</p>"]
	].map(([ancestral, pericia, descricao, extra = {}]) => ({
		nome: `Linhagem Kipane - ${ancestral}`,
		tipo: "racial", subtipo: "Qareen Ubaneri",
		img: "systems/tormenta20/icons/racas/qareen.webp",
		descricao,
		// o +2 na perícia vai para o efeito; o resto do texto (manobras, venenos, concentração…) é anotação
		efeitos: (img) => [efeitoSomar(`Linhagem Kipane - ${ancestral}`, img, [[`system.pericias.${pericia}.bonus`, 2]])],
		...extra
	})),
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
	},

	// ---------- Classes variantes da Dragão Brasil (SDD/fontes/capanga-cruzado.pdf e comandante-sentinela.pdf) ----------
	// Habilidades exclusivas de cada classe. Nomes que já existem em outra classe levam a classe entre
	// parênteses, como no sistema ("Direcionar" do treinador, "Presente dos Deuses" do clérigo no suplemento).
	// Capanga (ladino)
	{
		nome: "Ataque Furtivo Brutal",
		tipo: "ability", subtipo: "Capanga", exclusivo: true,
		img: `${ICONES_CLASSE}/especialistas/ataque-furtivo.webp`,
		descricao: "<p>Você sabe aproveitar a distração do inimigo para atingir seus pontos vitais. Uma vez por rodada, quando atinge uma criatura desprevenida com um ataque corpo a corpo, ou uma criatura que esteja flanqueando, você causa 1d8 pontos de dano extra. A cada dois níveis, esse dano aumenta em +1d8. Uma criatura imune a acertos críticos também é imune a ataques furtivos.</p>",
		// como o Ataque Furtivo do sistema: o efeito "ao usar" soma a rolagem do poder (atualizada a cada nível)
		efeitos: (img) => [efeitoAoUsar("Ataque Furtivo Brutal", img, [["dano", "roll"]])],
		rolls: [{ name: "Dano", key: "dano0", type: "dano", parts: [["1d8", "dano", ""]], versatil: "", adaptavel: "" }]
	},
	{
		nome: "Rápido e Rasteiro",
		tipo: "ability", subtipo: "Capanga", exclusivo: true,
		img: `${ICONES_CLASSE}/especialistas/audacia.webp`,
		descricao: "<p>No 3º nível, você recebe +2 em Iniciativa, Defesa e em rolagens de dano na primeira rodada de cada combate. Esse bônus aumenta para +4 no 7º nível e para +6 no 15º nível.</p>"
	},
	{
		nome: "Cara Feia",
		tipo: "ability", subtipo: "Capanga", exclusivo: true,
		img: `${ICONES_CLASSE}/especialistas/insolencia.webp`,
		descricao: "<p>No 4º nível, você recebe +5 em testes de resistência contra efeitos de medo e em testes de Vontade para resistir a intimidações.</p>"
	},
	{
		nome: "Flanquear Aprimorado",
		tipo: "ability", subtipo: "Capanga", exclusivo: true,
		img: `${ICONES_CLASSE}/especialistas/esquiva-sagaz.webp`,
		descricao: "<p>No 6º nível, o bônus que você recebe contra oponentes flanqueados aumenta para +4 (em vez de +2).</p>"
	},
	{
		nome: "Debulhar Inimigos",
		tipo: "ability", subtipo: "Capanga", exclusivo: true,
		img: `${ICONES_CLASSE}/combatentes/campeao.webp`,
		ativacao: ativacao("free", 5, { condicao: "ao fazer um ataque" }),
		// opção na janela de ataque: gasta 5 PM para o ataque furtivo valer sem desprevenido nem flanco
		efeitos: (img) => [efeitoAoUsar("Debulhar Inimigos", img, [], {
			custo: 5, descricao: "Ataque furtivo mesmo sem o alvo desprevenido ou flanqueado (marque também Ataque Furtivo Brutal)."
		})],
		descricao: "<p>No 20º nível, você já perdeu a paciência com inimigos cheios de truques ou que são resistentes às suas habilidades. Seus ataques furtivos ignoram imunidades de criaturas a acertos críticos. Além disso, você pode gastar 5 PM quando faz um ataque para usar seu ataque furtivo mesmo que o alvo não esteja desprevenido ou que você não o esteja flanqueando.</p>"
	},
	// Cruzado (clérigo)
	{
		nome: "Presente dos Deuses (Cruzado)",
		tipo: "ability", subtipo: "Cruzado", exclusivo: true,
		img: `${ICONES_CLASSE}/conjuradores/mao-divindade.webp`,
		// invocar o presente: ação de movimento e 2 PM, até o fim da cena
		ativacao: ativacao("move", 2, { condicao: "invocar o presente" }),
		duracao: NA_CENA,
		descricao: "<p>Você começa o jogo com uma arma superior com uma melhoria (exceto material especial) com preço total de até T$ 500. Preferencialmente, este item deve ser a arma preferida do seu deus, mas pode ser outra, de acordo com o mestre. Nos níveis 5, 8 e 11, esse item recebe, respectivamente, uma segunda, terceira e quarta melhorias à sua escolha. Nos níveis 9, 14 e 18, esse item recebe, respectivamente, um, dois e três encantos à sua escolha.</p><p>Seu presente dos deuses funciona como a versão mundana da arma, mas ele não ocupa espaços no inventário, pois você deve gastar uma ação de movimento e 2 PM para invocá-lo com um brilho de luz dourada — efeito que dura até o fim da cena, quando o item desaparece e volta para o mundo divino de onde veio.</p>"
	},
	{
		nome: "Alma Guerreira",
		tipo: "ability", subtipo: "Cruzado", exclusivo: true,
		img: `${ICONES_CLASSE}/combatentes/abencoado.webp`,
		descricao: "<p>No 2º nível, quando invoca seu presente dos deuses em um combate, você recebe uma quantidade de pontos de vida temporários igual a seu nível + sua Sabedoria.</p>"
	},
	{
		nome: "Fé Inabalável",
		tipo: "ability", subtipo: "Cruzado", exclusivo: true,
		img: `${ICONES_CLASSE}/combatentes/durao.webp`,
		descricao: "<p>No 3º nível, enquanto estiver empunhando seu presente dos deuses, você não fica inconsciente por estar com 0 PV ou menos (você ainda morre se chegar a um valor negativo igual à metade de seus pontos de vida máximos).</p>"
	},
	{
		nome: "Oração Marcial",
		tipo: "ability", subtipo: "Cruzado", exclusivo: true,
		img: `${ICONES_CLASSE}/conjuradores/devoto-c.webp`,
		ativacao: ativacao("hour", 5, { condicao: "1/dia" }),
		duracao: { value: 1, units: "day", special: "" },
		descricao: "<p>No 10º nível, você pode, uma vez por dia, gastar uma hora e 5 PM para rezar ao seu deus e pedir orientação em combate; então escolha um poder de clérigo, de guerreiro ou de combate cujos pré-requisitos cumpra. Você recebe os benefícios desse poder até o próximo dia.</p>"
	},
	{
		nome: "Guerreiro Santificado",
		tipo: "ability", subtipo: "Cruzado", exclusivo: true,
		img: `${ICONES_CLASSE}/combatentes/ataque-especial.webp`,
		descricao: "<p>No 20º nível, você torna-se tão formidável em combate quanto seus aliados combatentes. Você pode usar Ataque Especial como se fosse um guerreiro de 20º nível. Além disso, se usar essa habilidade em um ataque feito com o seu presente dos deuses, o custo para usá-la é reduzido em –1 PM.</p>"
	},
	// Comandante (nobre)
	{
		nome: "Coordenar",
		tipo: "ability", subtipo: "Comandante", exclusivo: true,
		img: `${ICONES_CLASSE}/especialistas/gritar-ordens.webp`,
		ativacao: ativacao("reaction", 1, { condicao: "1/rodada: substituir o teste de um aliado" }),
		alcance: "short",
		// no início do combate: 1d20 por patamar (iniciante 1d20, veterano 2d20…)
		rolls: [{ name: "Resultados do combate (1d20 por patamar)", key: "formula0", type: "formula", parts: [["(@patamar)d20", "", ""]], versatil: "", adaptavel: "" }],
		descricao: "<p>No início de um combate, role 1d20 por patamar (1d20 para iniciante, 2d20 para veterano e assim por diante) e anote os resultados. Uma vez por rodada, você pode gastar 1 PM para substituir a rolagem do teste de um aliado em alcance curto por um desses seus resultados. Após substituir uma rolagem, o resultado é perdido.</p><p>Além disso, você aprende e pode lançar <em>Comando</em> (atributo-chave Carisma). Esta não é uma habilidade mágica e provém de sua capacidade de impor suas vontades em outras criaturas.</p>",
		magias: ["Comando"],
		atributoMagias: "car"
	},
	{
		nome: "Direcionar (Comandante)",
		tipo: "ability", subtipo: "Comandante", exclusivo: true,
		img: `${ICONES_CLASSE}/especialistas/realeza.webp`,
		ativacao: ativacao("special", 1, { special: "ação do direcionamento; teste de Guerra (CD 15)" }),
		alcance: "short",
		descricao: "<p>Você pode gastar a ação do direcionamento e 1 PM para fazer um teste de Guerra (CD 15). Se passar, você usa um direcionamento em um aliado em alcance curto. Para cada 10 pontos acima da CD, você afeta um alvo adicional. Você começa com 2 direcionamentos. A cada quatro níveis, aprende um direcionamento adicional à sua escolha.</p><ul><li><strong>Aguenta Firme!</strong> (padrão). Os alvos recebem pontos de vida temporários iguais ao seu nível + seu Carisma.</li><li><strong>Carga!</strong> (completa). Faça uma investida. Se acertar e causar dano, os alvos podem usar uma reação para se movimentar o equivalente a uma ação de movimento, terminando mais próximos da criatura atingida.</li><li><strong>Em Frente!</strong> (reação). Após os testes de Iniciativa, mas antes do primeiro turno do combate, você desloca os alvos em até 6m.</li><li><strong>Encontrem Eles!</strong> (movimento). Até o fim do seu próximo turno, os alvos recebem +2 em testes de Percepção e Intuição.</li><li><strong>Lutem!</strong> (padrão). Os alvos podem usar uma reação para fazer um ataque contra um inimigo dentro do alcance deles.</li><li><strong>Parede de Escudos!</strong> (reação). Quando um aliado adjacente sofre um ataque, os alvos o protegem: ele recebe um bônus na Defesa igual a 1 + a quantidade de alvos.</li><li><strong>Peguem-no Vivo!</strong> (movimento). Até o fim do seu próximo turno, você e os alvos não sofrem a penalidade de –5 em testes de ataque para causar dano não letal.</li><li><strong>Para o Chão!</strong> (reação). Até o início do seu próximo turno, os alvos recebem um bônus em testes de resistência igual ao seu Carisma.</li><li><strong>Saiam Dessa!</strong> (movimento). Remove uma condição mental que estava afetando os alvos; para cada 10 pontos acima da CD, pode remover uma condição adicional em vez de afetar um alvo adicional.</li><li><strong>Vão, vão, vão!</strong> (padrão). Escolha um inimigo em alcance curto. Até o fim do seu próximo turno, você e os alvos recebem +2 em testes de ataque e rolagens de dano contra ele.</li></ul>"
	},
	{
		nome: "Replanejar",
		tipo: "ability", subtipo: "Comandante", exclusivo: true,
		img: `${ICONES_CLASSE}/especialistas/autoconfianca.webp`,
		ativacao: ativacao("reaction", 2, { condicao: "1/cena" }),
		alcance: "short",
		descricao: "<p>No 3º nível, uma vez por cena, quando um oponente em alcance curto acerta um ataque em um de seus aliados, ou quando um de seus aliados falha em um teste de resistência, você pode gastar 2 PM para fazer o oponente repetir o teste de ataque (escolhendo o pior entre os dois resultados) ou para fazer o aliado repetir o teste de resistência (escolhendo o melhor entre os dois resultados).</p>"
	},
	{
		nome: "Presença de Liderança",
		tipo: "ability", subtipo: "Comandante", exclusivo: true,
		img: `${ICONES_CLASSE}/especialistas/orgulho.webp`,
		descricao: "<p>A partir do 5º nível, você pode gastar 1 PM para seus aliados em alcance curto receberem +2 em testes de perícias baseadas em Carisma até o fim da cena. Além disso, você recebe +2 em testes de Intimidação.</p>",
		ativacao: ativacao("", 1),
		duracao: NA_CENA,
		alcance: "short",
		efeitos: (img) => [
			// sempre: +2 em Intimidação
			efeitoSomar("Presença de Liderança", img, [["system.pericias.inti.bonus", 2]]),
			// ao usar (1 PM): os aliados em alcance curto recebem +2 nas perícias de Carisma até o fim da cena
			efeitoAplicavel("Presença de Liderança (aliados)", img, ["ades", "atua", "dipl", "enga", "inti", "joga"].map((k) => [`system.pericias.${k}.bonus`, 2]))
		]
	},
	{
		nome: "Líder Nato",
		tipo: "ability", subtipo: "Comandante", exclusivo: true,
		img: `${ICONES_CLASSE}/especialistas/realeza.webp`,
		descricao: "<p>No 20º nível, uma vez por rodada, você pode usar Direcionar como ação livre, sem precisar fazer um teste e sem custo em PM. Além disso, uma criatura que seja reduzida a 0 PV por Palavras Afiadas não sofre este dano; em vez disso, passa a lutar ao seu lado pelo resto da cena.</p>"
	},
	// Sentinela (arcanista)
	{
		nome: "Caminho do Sentinela",
		tipo: "ability", subtipo: "Sentinela", exclusivo: true,
		img: `${ICONES_CLASSE}/conjuradores/caminho-arcanista-bruxo.webp`,
		descricao: "<p>Você lança magias misturando combate e feitiçaria. Para lançar uma magia em combate, você deve empunhar uma arma com a qual seja proficiente com uma mão (e gesticular com a outra) ou fazer um teste de Misticismo (CD 20 + o custo em PM da magia; se falhar, a magia não funciona, mas você gasta os PM mesmo assim). Fora de combate, deve pelo menos estar com uma das mãos sobre esta arma ou precisa fazer o mesmo teste. Você não precisa fazer testes de Misticismo para lançar magias arcanas se estiver usando uma armadura leve, e também recebe uma armadura leve como seu equipamento inicial no 1º nível. Seu atributo-chave para lançar magias é Inteligência.</p><p><em>Construtor:</em> o sentinela começa com 12 PV + Con e ganha 4 PV + Con por nível; o sistema calcula o 1º nível como 4× os PV por nível (16), então esta habilidade aplica –4 PV.</p>",
		efeitos: (img) => [efeitoSomar("Caminho do Sentinela", img, [["system.attributes.pv.bonus.total", -4]])]
	},
	{
		nome: "Gladiomancia",
		tipo: "ability", subtipo: "Sentinela", exclusivo: true,
		img: `${ICONES_CLASSE}/combatentes/ataque-especial.webp`,
		ativacao: ativacao("move", 2, { condicao: "arma corpo a corpo leve ou ágil empunhada" }),
		duracao: NA_CENA,
		// ao usar: Int no lugar de Des na Defesa e de For em Luta, e Int no dano corpo a corpo (limitado pelo nível)
		efeitos: (img) => [efeitoAplicavel("Gladiomancia", img, [
			["system.attributes.defesa.atributo", "int", "override"],
			["system.pericias.luta.atributo", "int", "override"],
			["system.modificadores.dano.cac", "min(@int, @nivel)"]
		])],
		descricao: "<p>Você pode gastar uma ação de movimento e 2 PM para evocar palavras de poder mágico e imbuir essência arcana em uma arma corpo a corpo leve ou ágil que esteja empunhando. Enquanto empunhar esta arma ou até o fim da cena (o que acontecer primeiro), você pode somar sua Inteligência em vez de Destreza na Defesa. Além disso, você usa Inteligência em testes de Luta, em vez de Força, e pode somar sua Inteligência em rolagens de dano usando esta arma (limitado pelo seu nível).</p>"
	},
	{
		nome: "Mago de Combate",
		tipo: "ability", subtipo: "Sentinela", exclusivo: true,
		img: `${ICONES_CLASSE}/conjuradores/alta-arcana.webp`,
		// opção na janela de ataque (com a arma sob Gladiomancia): + círculo máximo de magias no dano
		efeitos: (img) => [efeitoAoUsar("Mago de Combate", img, [["dano", "@circulo"]], { descricao: "Arma sob efeito de Gladiomancia: soma o círculo máximo de magias ao dano." })],
		descricao: "<p>Quando faz um ataque usando uma arma sob efeito de Gladiomancia, você soma o círculo máximo de magias que pode lançar à rolagem de dano. Além disso, a mão da arma é considerada livre para lançar magias.</p>"
	},
	{
		nome: "Mestre Arcano-combatente",
		tipo: "ability", subtipo: "Sentinela", exclusivo: true,
		img: `${ICONES_CLASSE}/conjuradores/alta-arcana.webp`,
		descricao: "<p>No 20º nível, você pode usar Gladiomancia como ação livre. Enquanto empunhar uma arma sob o efeito de Gladiomancia, suas habilidades de sentinela (incluindo magias) têm seu custo em PM reduzido pela metade (após aplicar aprimoramentos e quaisquer outros efeitos que reduzam custo).</p>"
	}
];

/**
 * Poderes do suplemento que continuam nas listas: sem os homônimos dos poderes do construtor marcados
 * "substituiSuplemento" e sem os das classes que o construtor reescreveu (CLASSES_REESCRITAS: a versão
 * antiga do místico tinha poderes que a nova não tem mais).
 */
export function poderesMantidosDoSuplemento(poderesSup, doConstrutor) {
	const substituidos = new Set(doConstrutor.filter((p) => p.substituiSuplemento).map((p) => p.name));
	return poderesSup.filter((p) => !substituidos.has(p.name) && !CLASSES_REESCRITAS.has(p.system?.subtipo));
}

/** Descrições das classes do suplemento reescritas pelo construtor (o item de classe vai para a ficha). */
const DESCRICOES_CLASSES_REESCRITAS = {
	"Místico": "<p>Os elementos primordiais existiam antes mesmo da criação da magia e da espada. Água, ar, fogo, luz, terra e trevas são considerados a essência da arte arcana na cultura artoniana, sendo utilizados pelos deuses como base para moldar o mundo de Arton e todos os demais componentes da criação. No entanto, para os místicos, os elementos vão além disso, sendo o foco e a dedicação de toda a sua prática mágica. Estes conjuradores especializados dominam as forças primordiais por meio de tradições ancestrais, sendo encontrados principalmente entre os ubaneri da Grande Savana, os sar-allan do Deserto da Perdição e os geomantes de Doherimm.</p><p><strong>Pontos de Vida.</strong> Um místico começa com 16 pontos de vida (+ Constituição) e ganha 4 PV (+ Constituição) por nível.</p><p><strong>Pontos de Mana.</strong> 4 PM por nível.</p><p><strong>Perícias.</strong> Misticismo (Int) e Vontade (Sab), mais 4 a sua escolha entre Atletismo (For), Conhecimento (Int), Fortitude (Con), Iniciativa (Des), Luta (For), Ofício (Int), Percepção (Sab), Pontaria (Des) e Reflexos (Des).</p><p><strong>Proficiências.</strong> Armas marciais.</p><p><strong>Habilidades de classe.</strong> Afinidade elemental, combate elemental e magias (1º nível); língua primordial (2º); moldar elemento e tradição oral (3º); sexto sentido (4º); afinidade evoluída (6º); comunhão suprema (20º); poder de místico a cada nível a partir do 2º.</p>"
};

/**
 * Classe do suplemento com a descrição da versão do construtor (ex.: o místico novo): vira um item do
 * construtor com a mesma estrutura (PV, PM, perícias) e o texto novo. As demais voltam como estão.
 */
function comClasseReescrita(doc) {
	const descricao = DESCRICOES_CLASSES_REESCRITAS[doc.name];
	if (!descricao) return doc;
	const sistema = typeof doc.system?.toObject === "function" ? doc.system.toObject() : structuredClone(doc.system);
	sistema.description = { ...(sistema.description ?? {}), value: comAvisoDireitos(descricao) };
	return {
		name: doc.name, type: "classe", img: doc.img,
		uuid: `${MODULE_ID}.classe.${doc.name}`, _id: null,
		substituto: true, fonteLivro: "Místico (nova versão)",
		effects: [], system: sistema
	};
}

export function poderesSubstitutos(sup) {
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
			// distinção do construtor (o índice de distinções, em carregar(), inclui estes poderes)
			distincao: x.distincao ?? null,
			regiao: x.regiao ?? null,
			itensOrigem: x.itensOrigem ?? [],
			// perícias treinadas pelo benefício de origem (ex.: Celebrante da Vida: Diplomacia e Religião)
			periciasOrigem: x.periciasOrigem ?? [],
			// magias que o poder ensina por nível da classe (ditames do místico): [{nome, nivel}]
			magiasPorNivel: x.magiasPorNivel ?? [],
			magiasConcedidas: x.magias ?? [],
			// atributo-chave dessas magias, se não for o da magia no compêndio (ex.: Comando do comandante: Carisma)
			atributoMagias: x.atributoMagias ?? null,
			effects: x.efeitos ? x.efeitos(x.img) : [],
			system: {
				tipo: x.tipo, subtipo: x.subtipo, description: { value: comAvisoDireitos(x.descricao) },
				...(x.ativacao ? { ativacao: x.ativacao } : {}),
				...(x.duracao ? { duracao: x.duracao } : {}),
				...(x.alcance ? { alcance: x.alcance } : {}),
				...(x.rolls ? { rolls: x.rolls } : {}),
				...(x.rolltags ? { rolltags: [...x.rolltags] } : {})
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
		// variante com atributos próprios: Sabedoria +1 e +1 em dois atributos (sem repetir a Sabedoria)
		nome: "Qareen Ubaneri",
		base: "Qareen",
		livro: "Dragão Brasil 233",
		atributos: { for: 0, des: 0, con: 0, int: 0, sab: 1, car: 0 },
		atributosDinamicos: "+1 em Dois Atributos Diferentes (exceto Sabedoria)",
		descricao: "<p>Qareen ubaneri (<em>Dragão Brasil</em> 233). Por influência de Kallyadranoch, a linhagem das kipane é uma variante da raça qareen. Usa as habilidades de qareen, mas os modificadores de atributos são Sabedoria +1 e +1 em dois atributos, e <em>Desejos</em> é substituída por <em>Linhagem Kipane</em>.</p>",
		troca: { "Desejos": "Linhagem Kipane" }
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
			sistema.description = { ...(sistema.description ?? {}), value: comAvisoDireitos(def.descricao) };
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
		// variante com atributos próprios (ex.: qareen ubaneri): fixos e os +1 à escolha
		if (def.atributos) sistema.atributos = { ...def.atributos };
		if (def.atributosDinamicos) sistema.atributosDinamicos = { value: [], description: def.atributosDinamicos };
		sistema.description = { ...(sistema.description ?? {}), value: comAvisoDireitos(def.descricao) };
		out.push({
			name: def.nome, type: "race", img: base.img,
			uuid: `${MODULE_ID}.raca.${def.nome}`, _id: null,
			substituto: true, varianteDe: def.base, fonteLivro: def.livro ?? "",
			effects: [], system: sistema
		});
	}
	return out;
}

/**
 * Classes variantes que nenhum compêndio traz (Dragão Brasil): copiam a classe básica do sistema
 * (estrutura, ícone, PV e PM) com nome, descrição e, se for o caso, PV/PM próprios. As regras de 1º nível
 * ficam em data/classes.json e a progressão em data/progressao.json, como as das outras classes.
 */
const CLASSES_DO_CONSTRUTOR = [
	{ nome: "Capanga", base: "Ladino", livro: "Dragão Brasil", descricao: "<p>Capanga, variante do ladino (<em>Dragão Brasil</em>): o ladino que trocou sutileza por força bruta. PV, PM e proficiências como o ladino básico.</p>" },
	{ nome: "Cruzado", base: "Clérigo", livro: "Dragão Brasil", descricao: "<p>Cruzado, variante do clérigo (<em>Dragão Brasil</em>): o sacerdote que vive com um pé no campo de batalha. PV e PM como o clérigo básico; proficiência com armas marciais, armaduras pesadas e escudos.</p>" },
	{ nome: "Comandante", base: "Nobre", livro: "Dragão Brasil", descricao: "<p>Comandante, variante do nobre (<em>Dragão Brasil</em>): a voz firme no calor da batalha. PV, PM e proficiências como o nobre básico.</p>" },
	{ nome: "Sentinela", base: "Arcanista", livro: "Dragão Brasil", pvPorNivel: 4, pmPorNivel: 5, descricao: "<p>Sentinela, variante do arcanista (<em>Dragão Brasil</em>): onde espada e feitiçaria se encontram. Começa com 12 PV + Constituição e ganha 4 PV + Constituição por nível; 5 PM por nível; proficiência com armas marciais.</p>" }
];

/** Variante → classe básica das classes do construtor. */
const VARIANTES_DO_CONSTRUTOR = Object.fromEntries(CLASSES_DO_CONSTRUTOR.map((c) => [c.nome, c.base]));

export function classesDoConstrutor(classes) {
	const out = [];
	for (const def of CLASSES_DO_CONSTRUTOR) {
		const base = classes.find((c) => c.name === def.base);
		if (!base) continue;
		const sistema = typeof base.system?.toObject === "function" ? base.system.toObject() : structuredClone(base.system);
		if (def.pvPorNivel) sistema.pvPorNivel = def.pvPorNivel;
		if (def.pmPorNivel) sistema.pmPorNivel = def.pmPorNivel;
		sistema.description = { ...(sistema.description ?? {}), value: comAvisoDireitos(def.descricao) };
		out.push({
			name: def.nome, type: "classe", img: base.img,
			uuid: `${MODULE_ID}.classe.${def.nome}`, _id: null,
			substituto: true, varianteDe: def.base, fonteLivro: def.livro,
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

/** Índice de distinções (do suplemento, se houver) com as distinções definidas pelo construtor. */
export function comDistincoesDoConstrutor(doSuplemento, doConstrutor) {
	const porPoder = new Map(doSuplemento?.porPoder ?? []);
	const marcas = new Map([...(doSuplemento?.marcas ?? [])].map(([k, v]) => [k, [...v]]));
	for (const p of doConstrutor.filter((x) => x.distincao)) {
		porPoder.set(p.uuid, p.distincao);
		if (ehMarca(p)) marcas.set(p.distincao, [...(marcas.get(p.distincao) ?? []), p.name]);
	}
	return { porPoder, marcas };
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
