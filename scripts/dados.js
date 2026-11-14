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
	const [regrasClasses, origens, regionais, divindades, equipamento, escolas, regrasRacas, regrasPoderesClasse, configSuplementos] =
		await Promise.all([
			lerJson("classes.json"),
			lerJson("origens.json"),
			lerJson("origens-regionais.json"),
			lerJson("divindades.json"),
			lerJson("equipamento.json"),
			lerJson("escolas.json"),
			lerJson("racas.json"),
			lerJson("poderes-classe.json"),
			lerJson("suplementos.json")
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
	const todosPoderes = [...poderes, ...sup.poderes];
	// itens: os do sistema primeiro (em nomes repetidos, vale o do livro básico)
	const equipPorNome = new Map([...indiceEquip].map((e) => [normalizar(e.name), e]));
	for (const { doc } of sup.itens) if (!equipPorNome.has(normalizar(doc.name))) equipPorNome.set(normalizar(doc.name), doc);

	const dados = {
		racas: [...racas, ...sup.racas].sort(ordenar),
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
			.map(({ doc, pasta }) => comCategoria({ doc, categoria: categoriaLoja(doc, pasta) }))
			.concat(sup.itens.map(comCategoria))
			.sort((a, b) => ordenar(a.doc, b.doc)),
		estruturaLoja: ESTRUTURA_LOJA,
		regrasClasses: { ...regrasClasses, ...sup.regrasClasses },
		origens: [...(origens.origens ?? []), ...(sup.origensMundanas ?? [])],
		origensRegionais: sup.origensRegionais ?? regionais.origens ?? [],
		divindades: sup.divindades ?? divindades.divindades ?? [],
		/** Conteúdo vindo dos Suplementos de Arton: uuid → nome do compêndio. */
		fonteSuplemento: sup.fonte,
		suplementoLigado: sup.ligado,
		/** Poderes do suplemento só aparecem nas listas de escolha com a chave "Poderes" ligada. */
		poderesSuplementoSelecionaveis: conteudoLigado("Poderes"),
		equipamento,
		escolas: escolas.escolas ?? {},
		regrasRacas: regrasRacas.poderes ?? {},
		regrasPoderesClasse: regrasPoderesClasse.poderes ?? {},
		melhorias
	};
	verificarReferencias(dados);
	console.info(`${MODULE_ID} | dados carregados em ${Math.round(performance.now() - inicio)} ms`);
	return dados;
}

/** O poder pode aparecer nas listas de escolha? (do sistema, ou do suplemento com a chave "Poderes" ligada) */
export function poderSelecionavel(dados, p) {
	return !dados.fonteSuplemento?.has(p.uuid) || dados.poderesSuplementoSelecionaveis;
}

/** Nome do compêndio do suplemento de onde veio o documento (ou ""). */
export function fonteDe(dados, doc) {
	return dados.fonteSuplemento?.get(doc?.uuid) ?? "";
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
		const doSuplemento = r.somenteSuplemento || r.escolhas?.some((x) => x.somenteSuplemento);
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
