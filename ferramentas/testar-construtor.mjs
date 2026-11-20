/**
 * Teste do construtor (wizard de criação) fora do Foundry: carrega o wizard de verdade, com os dados
 * carregados pelo carregarDados real (compêndios do sistema lidos do disco e, se houver o cache, os do
 * Suplementos de Arton), preenche personagens de exemplo e compara com o retrato salvo:
 * passos, pendência de cada passo, plano final (o que vai para a ficha) e se cada tela monta sem erro.
 *
 * Uso: node ferramentas/testar-construtor.mjs [--atualizar] [--sistema=caminho do repositório Tormenta20] [-v]
 *   --atualizar  grava o retrato atual em ferramentas/retratos/construtor.json (depois de conferir a mudança)
 *   -v           mostra o plano de cada personagem
 *   --telas=arq  grava o contexto completo de cada tela em arq (JSON), para comparar duas versões
 * Não entra no module.zip. Serve de rede de segurança para refatorar o wizard: o retrato não pode mudar.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizModulo = path.resolve(aqui, "..");
const args = process.argv.slice(2);
const raizSistema = path.resolve(args.find((a) => a.startsWith("--sistema="))?.slice(10) ?? path.join(raizModulo, "../Tormenta20"));
const ATUALIZAR = args.includes("--atualizar");
const VERBOSO = args.includes("-v");
const ARQ_TELAS = args.find((a) => a.startsWith("--telas="))?.slice(8);
const contextos = {};

/** Contexto de tela em JSON estável: documentos viram uuid, funções e ciclos somem. */
function serializar(valor) {
	const vistos = new WeakSet();
	return JSON.parse(JSON.stringify(valor, (k, v) => {
		if (typeof v === "function") return undefined;
		if (v && typeof v === "object") {
			if (v.uuid && (v.documentName || v.system)) return `doc:${v.uuid}`;
			if (vistos.has(v)) return "[ciclo]";
			vistos.add(v);
			if (v instanceof Map) return Object.fromEntries(v);
			if (v instanceof Set) return [...v];
		}
		return v;
	}));
}
const MODULE_ID = "t20-construtor-ficha";
const SUPLEMENTO_ID = "suplementos-de-arton";

/* ==================== Foundry simulado (só o que o construtor usa) ==================== */

const getProperty = (o, k) => String(k).split(".").reduce((x, p) => x?.[p], o);
const setProperty = (o, k, v) => {
	const partes = String(k).split(".");
	const ult = partes.pop();
	const alvo = partes.reduce((x, p) => (x[p] ??= {}), o);
	alvo[ult] = v;
	return true;
};
const ehObjeto = (x) => x && typeof x === "object" && !Array.isArray(x);
function mergeObject(alvo, origem, { inplace = true } = {}) {
	const out = inplace ? alvo : structuredClone(alvo);
	for (const [k, v] of Object.entries(origem ?? {})) {
		if (ehObjeto(v) && ehObjeto(out[k])) out[k] = mergeObject(out[k], v, { inplace: true });
		else out[k] = structuredClone(v);
	}
	return out;
}
/** CONFIG que cria sozinho o que for acessado (o config do sistema mexe em várias partes do Foundry ao carregar). */
const automatico = () => new Proxy(function () {}, {
	get(t, k) {
		if (k === "push") return () => 0;
		if (k === Symbol.toPrimitive) return () => "";
		if (!(k in t)) t[k] = automatico();
		return t[k];
	},
	set(t, k, v) { t[k] = v; return true; },
	apply() { return automatico(); }
});

class ApplicationV2 {
	constructor(options = {}) { this.options = options; this.rendered = false; }
	render() { return this; }
	close() { return this; }
}
globalThis.foundry = {
	utils: {
		getProperty, setProperty, mergeObject,
		deepClone: (x) => structuredClone(x),
		debounce: (fn) => fn,
		escapeHTML: (t) => t
	},
	data: { fields: {} },
	applications: {
		api: { ApplicationV2, HandlebarsApplicationMixin: (B) => B, DialogV2: { confirm: async () => true } },
		ux: { TextEditor: { implementation: { enrichHTML: async (h) => h } } },
		handlebars: { loadTemplates: async () => {} },
		instances: new Map()
	}
};
globalThis.CONFIG = automatico();
globalThis.Hooks = { once() {}, on() {} };
globalThis.ui = { notifications: { info() {}, warn() {}, error() {} } };
globalThis.fromUuid = async () => null;

// traduções do sistema (lang/pt-BR.json, aninhado: "T20.SkillAcro" → T20 → SkillAcro)
const traducoes = JSON.parse(fs.readFileSync(path.join(raizSistema, "lang/pt-BR.json"), "utf8"));
const localize = (k) => {
	const v = String(k).split(".").reduce((x, p) => x?.[p], traducoes);
	return typeof v === "string" ? v : k;
};

// configurações do mundo (padrões de main.js), trocadas por cenário
const PADROES = {
	abrirAoCriar: true, modoPontos: true, modoRolagem: true, modoFixo: true, atributosVariados: false,
	atributosClassicaEmOrdem: false, complicacoes: false, idadesVariadas: false, origemDupla: false,
	beneficiosOrigemDupla: 1, suplementos: false, subirNivel: true
};
let configuracoes = { ...PADROES };

// compêndios do sistema lidos do disco (documentos com pasta, como o Foundry entrega)
function lerPackSistema(nome, tipoDoc = "Item") {
	const docs = [];
	const pastas = new Map();
	const andar = (d) => {
		for (const f of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, f.name);
			if (f.isDirectory()) andar(p);
			else if (f.name.endsWith(".json")) {
				const x = JSON.parse(fs.readFileSync(p, "utf8"));
				if (f.name.startsWith("Folder_")) pastas.set(x._id, { name: x.name, folder: x.folder ?? null });
				else if (x._id) docs.push({ ...x, id: x._id, uuid: `Compendium.tormenta20.${nome}.${tipoDoc}.${x._id}`, effects: x.effects ?? [] });
			}
		}
	};
	andar(path.join(raizSistema, "src/packs", nome));
	return pacote(`tormenta20.${nome}`, { packageName: "tormenta20", name: nome, label: nome }, docs, pastas);
}
function pacote(id, metadata, docs, pastas) {
	return { collection: id, metadata: { ...metadata, id }, documentName: "Item", folders: pastas, getDocuments: async () => docs, index: docs };
}
const packs = new Map();
for (const n of ["racas", "classes", "poderes", "magias", "equipamentos"]) packs.set(`tormenta20.${n}`, lerPackSistema(n));
packs.set("tormenta20.efeitos", lerPackSistema("efeitos", "ActiveEffect"));

// Suplementos de Arton (cache de ferramentas/extrair-suplemento.mjs), por compêndio
const caminhoSup = path.join(aqui, ".cache/suplemento.json");
const sup = fs.existsSync(caminhoSup) ? JSON.parse(fs.readFileSync(caminhoSup, "utf8")) : null;
if (sup) {
	const porPack = new Map();
	for (const i of sup.itens) {
		if (!porPack.has(i.pack)) porPack.set(i.pack, { label: i.rotuloPack, docs: [] });
		porPack.get(i.pack).docs.push({ ...i, id: i._id, effects: i.effects ?? [] });
	}
	for (const [nome, { label, docs }] of porPack) {
		const pastas = new Map(sup.pastas.filter((f) => f.pack === nome).map((f) => [f._id, { name: f.name, folder: f.folder ?? null }]));
		packs.set(`${SUPLEMENTO_ID}.${nome}`, pacote(`${SUPLEMENTO_ID}.${nome}`, { packageName: SUPLEMENTO_ID, name: nome, label }, docs, pastas));
	}
}
packs.filter = (fn) => [...packs.values()].filter(fn);

globalThis.game = {
	i18n: { localize, format: (k) => localize(k) },
	settings: { get: (modulo, chave) => (modulo === MODULE_ID ? configuracoes[chave] : false) },
	modules: { get: (id) => (id === SUPLEMENTO_ID ? { active: !!sup, version: sup?.versao ?? "" } : { id }) },
	user: { isGM: false, can: () => true },
	packs,
	items: { fromCompendium: (d) => structuredClone({ name: d.name, type: d.type, img: d.img, system: d.system, effects: d.effects ?? [] }) },
	system: { id: "tormenta20" }
};
// arquivos de data/ do módulo
globalThis.fetch = async (url) => {
	const m = /^modules\/[^/]+\/data\/(.+)$/.exec(String(url));
	const arquivo = m && path.join(raizModulo, "data", m[1]);
	if (!arquivo || !fs.existsSync(arquivo)) return { ok: false, json: async () => ({}) };
	return { ok: true, json: async () => JSON.parse(fs.readFileSync(arquivo, "utf8")) };
};

// config do sistema (CONFIG.T20: perícias, escolas, tipos de ação…) com o CONFIG automático
const { T20 } = await import(path.join(raizSistema, "module/config/T20.js"));
globalThis.CONFIG.T20 = T20;

/* ==================== Construtor ==================== */

const dadosMod = await import("../scripts/dados.js");
const { aplicarNaFicha } = await import("../scripts/aplicar.js");
const { ConstrutorFicha } = await import("../scripts/wizard.js");
const { ModeloConstrutor } = await import("../scripts/construtor/modelo.js");

let falhas = 0;
const conferir = (cond, msg) => {
	if (!cond) {
		falhas++;
		console.log(`  ✗ ${msg}`);
	}
	return cond;
};

/** Carrega os dados com as configurações do cenário (o cache do módulo é por configuração). */
async function dadosCom(config) {
	configuracoes = { ...PADROES, ...config };
	dadosMod.invalidarDados();
	return dadosMod.carregarDados();
}

const ator = (nome) => ({
	id: `ator${nome.replace(/\W/g, "")}`, name: nome, type: "character",
	items: [], system: {}, flags: {}, prototypeToken: { name: nome },
	getFlag: () => undefined, setFlag: async () => {}, unsetFlag: async () => {}, isOwner: true
});

/* ---------- Personagens de exemplo ---------- */

/** Busca um documento pelo nome (falha alto se o nome não existir: o cenário ficou desatualizado). */
function porNome(lista, nome, tipo) {
	const d = lista.find((x) => x.name === nome);
	if (!d) throw new Error(`${tipo} "${nome}" não encontrado`);
	return d;
}

/** Os n primeiros por nome (determinístico). */
const primeiros = (lista, n) => [...lista].sort((a, b) => String(a.name ?? a).localeCompare(String(b.name ?? b), "pt-BR")).slice(0, n);
/** Magias que o wizard oferece para a classe (respeita tipo, círculo e escolas escolhidas). */
const magiasDe = (wiz, n) => primeiros(wiz.magiasDisponiveis(), n).map((m) => m.uuid);
/** Perícias da lista da classe ainda não treinadas (sem o "oficio" genérico). */
function periciasDaClasse(wiz, n) {
	const r = wiz.regrasClasse;
	const ja = wiz.periciasTreinadas();
	return r.opcoes.filter((k) => k !== "oficio" && !ja.has(k) && !r.fixas.includes(k)).sort().slice(0, n);
}
/** Perícias extras por Inteligência (qualquer uma ainda não treinada); sem n, a quantidade do Int final. */
function periciasPorInt(wiz, n = Math.max(0, wiz.atributoFinal("int"))) {
	const ja = wiz.periciasTreinadas();
	return Object.keys(CONFIG.T20.pericias).filter((k) => !ja.has(k) && !["ofic", "oficio"].includes(k)).sort().slice(0, n);
}
const concedidos = (d, deus, n) => d.divindades.find((x) => x.nome === deus).poderes.slice(0, n);
const arma = (d, prof) => primeiros(d.armas.filter((a) => a.system.proficiencia === prof), 1)[0].name;
const melhoriaDeArma = (d) => primeiros(d.melhorias.filter((m) => [...(m.system.upgrade.itemType ?? [])].includes("weapon")), 1)[0].uuid;
const poderGeral = (d, grupo) => primeiros(d.poderes.filter((p) => p.system?.tipo === "geral" && p.system?.subtipo === grupo && !/pr[ée]-?requisito/i.test(p.system?.description?.value ?? "")), 1)[0].name;
/** A n-ésima magia de 1º círculo do tipo, por nome (n > 0 evita coincidir com as primeiras que a classe aprende). */
const magiaDoTipo = (d, tipo, n = 0) => primeiros(d.magias.filter((m) => Number(m.system.circulo) === 1 && m.system.tipo === tipo), n + 1)[n].uuid;
/** Origem com os 2 primeiros benefícios de perícia (sem itens a escolher). */
const origem = (nome, pericias) => ({ principal: { nome, beneficios: pericias.map((k) => `pericia:${k}`), grupos: {}, itens: {} } });

/**
 * Personagens de exemplo: estado(d) preenche as escolhas diretas; depois(d, wiz) as que dependem do que
 * o wizard calcula (magias disponíveis, perícias da classe, Inteligência…).
 */
const CENARIOS = [
	{
		nome: "Humano guerreiro (Versátil, origem, arma marcial)",
		config: {},
		estado: (d) => ({
			nome: "Valen",
			raca: porNome(d.racas, "Humano", "raça").uuid,
			racaAtributos: ["for", "con", "des"],
			racaEscolhas: { versatil: { pericias: ["atle", "inti"], poderes: [] } },
			atrModo: "pontos",
			atrPontos: { for: 3, des: 2, con: 2, int: 0, sab: 0, car: -1 },
			classe: porNome(d.classes, "Guerreiro", "classe").uuid,
			periciasOu: ["luta"],
			origens: origem("Acólito", ["cura", "reli"]),
			devoto: false,
			equip: { arma: arma(d, "simples"), armaMarcial: arma(d, "marcial"), armadura: "" },
			dinheiro: 12
		}),
		depois: (d, wiz) => ({ periciasClasse: periciasDaClasse(wiz, 2) })
	},
	{
		nome: "Anão clérigo de Khalmyr (devoção, magias divinas)",
		config: {},
		estado: (d) => ({
			nome: "Borin",
			raca: porNome(d.racas, "Anão", "raça").uuid,
			atrModo: "pontos",
			atrPontos: { for: 1, des: 0, con: 2, int: 0, sab: 4, car: 0 },
			classe: porNome(d.classes, "Clérigo", "classe").uuid,
			origens: origem("Acólito", ["cura", "vont"]),
			devoto: true,
			divindade: "Khalmyr",
			poderesConcedidos: concedidos(d, "Khalmyr", 2),
			equip: { arma: arma(d, "simples"), armaMarcial: "", armadura: "" },
			dinheiro: 9
		}),
		depois: (d, wiz) => ({ magias: magiasDe(wiz, 3), periciasClasse: periciasDaClasse(wiz, 2) })
	},
	{
		nome: "Elfo arcanista Mago (Caminho, perícias por Inteligência)",
		config: {},
		estado: (d) => ({
			nome: "Lyra",
			raca: porNome(d.racas, "Elfo", "raça").uuid,
			atrModo: "pontos",
			atrPontos: { for: -1, des: 1, con: 1, int: 4, sab: 1, car: 0 },
			classe: porNome(d.classes, "Arcanista", "classe").uuid,
			escolhasClasse: { caminho: "Caminho do Arcanista: Mago" },
			origens: origem("Acólito", ["cura", "reli"]),
			devoto: false,
			equip: { arma: arma(d, "simples"), armaMarcial: "", armadura: "" },
			dinheiro: 14
		}),
		depois: (d, wiz) => {
			const periciasClasse = periciasDaClasse(wiz, 2);
			wiz.estado.periciasClasse = periciasClasse;
			return { magias: magiasDe(wiz, 4), periciasClasse, periciasInt: periciasPorInt(wiz) };
		}
	},
	{
		nome: "Qareen feiticeira Linhagem Rubra (sub-escolhas, escolhas raciais)",
		config: {},
		estado: (d) => ({
			nome: "Zafira",
			raca: porNome(d.racas, "Qareen", "raça").uuid,
			// a magia racial precisa ser outra que não as que a classe ensina (repetida, fica só a da classe)
			racaEscolhas: { resistenciaElemental: "fogo", tatuagemMistica: [magiaDoTipo(d, "arc", 10)] },
			atrModo: "pontos",
			atrPontos: { for: 0, des: 2, con: 1, int: 0, sab: 0, car: 4 },
			classe: porNome(d.classes, "Arcanista", "classe").uuid,
			escolhasClasse: { caminho: "Caminho do Arcanista: Feiticeiro", linhagem: "Linhagem Rubra Básica" },
			classePoderEscolhas: { linhagemRubra: { pericias: [], poderes: [poderGeral(d, "Tormenta")] } },
			origens: origem("Acólito", ["cura", "reli"]),
			devoto: false,
			equip: { arma: arma(d, "simples"), armaMarcial: "", armadura: "" },
			dinheiro: 7
		}),
		depois: (d, wiz) => {
			const periciasClasse = periciasDaClasse(wiz, 2);
			wiz.estado.periciasClasse = periciasClasse;
			return { magias: magiasDe(wiz, 3), periciasClasse, periciasInt: periciasPorInt(wiz) };
		}
	},
	{
		nome: "Goblin bardo (escolas de magia)",
		config: {},
		estado: (d) => ({
			nome: "Pip",
			raca: porNome(d.racas, "Goblin", "raça").uuid,
			atrModo: "pontos",
			atrPontos: { for: -1, des: 2, con: 1, int: 1, sab: 0, car: 3 },
			classe: porNome(d.classes, "Bardo", "classe").uuid,
			magiasEscolas: ["enc", "ilu", "adv"],
			origens: origem("Acólito", ["cura", "reli"]),
			devoto: false,
			equip: { arma: arma(d, "simples"), armaMarcial: arma(d, "marcial"), armadura: "" },
			dinheiro: 15
		}),
		depois: (d, wiz) => {
			const periciasClasse = periciasDaClasse(wiz, 6);
			wiz.estado.periciasClasse = periciasClasse;
			return { magias: magiasDe(wiz, 2), periciasClasse, periciasInt: periciasPorInt(wiz) };
		}
	},
	{
		nome: "Golem inventor (sem origem, Protótipo)",
		config: {},
		estado: (d) => ({
			nome: "Engrenagem",
			raca: porNome(d.racas, "Golem", "raça").uuid,
			racaEscolhas: { fonteElemental: "fogo", propositoCriacao: { pericias: [], poderes: [poderGeral(d, "Destino")] } },
			atrModo: "pontos",
			atrPontos: { for: 2, des: 0, con: 1, int: 3, sab: 0, car: -1 },
			classe: porNome(d.classes, "Inventor", "classe").uuid,
			classePoderEscolhas: { prototipo: { modo: "superior", item: arma(d, "simples"), melhoria: melhoriaDeArma(d), alquimicos: {} } },
			devoto: false,
			equip: { arma: arma(d, "simples"), armaMarcial: "", armadura: "" },
			dinheiro: 11
		}),
		depois: (d, wiz) => {
			const periciasClasse = periciasDaClasse(wiz, 4);
			wiz.estado.periciasClasse = periciasClasse;
			return { periciasOu: [wiz.regrasClasse.ou?.[0]?.[0] ?? ""].filter(Boolean), periciasClasse, periciasInt: periciasPorInt(wiz) };
		}
	},
	{
		nome: "Humano cruzado (Dragão Brasil: Presente dos Deuses, devoção restrita)",
		config: {},
		estado: (d) => ({
			nome: "Aldric",
			raca: porNome(d.racas, "Humano", "raça").uuid,
			racaAtributos: ["for", "sab", "con"],
			racaEscolhas: { versatil: { pericias: ["atle", "inti"], poderes: [] } },
			atrModo: "pontos",
			atrPontos: { for: 3, des: 0, con: 2, int: 0, sab: 2, car: 0 },
			classe: porNome(d.classes, "Cruzado", "classe").uuid,
			periciasOu: ["luta"],
			classePoderEscolhas: { presenteDeuses: { modo: "superior", item: arma(d, "marcial"), melhoria: melhoriaDeArma(d), alquimicos: {} } },
			origens: origem("Acólito", ["cura", "vont"]),
			devoto: true,
			divindade: "Khalmyr",
			poderesConcedidos: concedidos(d, "Khalmyr", 2),
			equip: { arma: arma(d, "simples"), armaMarcial: arma(d, "marcial"), armadura: "" },
			dinheiro: 10
		}),
		depois: (d, wiz) => ({ magias: magiasDe(wiz, 3), periciasClasse: periciasDaClasse(wiz, 2) })
	},
	{
		nome: "Humano ladino velho com complicação (suplemento, Idades Variadas)",
		precisaSuplemento: true,
		config: { suplementos: true, complicacoes: true, idadesVariadas: true },
		estado: (d) => ({
			nome: "Velho Corvo",
			raca: porNome(d.racas, "Humano", "raça").uuid,
			racaAtributos: ["des", "int", "car"],
			racaEscolhas: { versatil: { pericias: ["atle", "inti"], poderes: [] } },
			atrModo: "pontos",
			atrPontos: { for: 0, des: 3, con: 1, int: 2, sab: 1, car: 0 },
			classe: porNome(d.classes, "Ladino", "classe").uuid,
			origens: origem("Acólito", ["cura", "reli"]),
			devoto: false,
			complicacoes: [primeiros(d.complicacoes.filter((c) => !c.classe).map((c) => c.doc), 1)[0].uuid],
			complicacaoPoder: poderGeral(d, "Destino"),
			idade: { faixa: "velho", anos: "70", complicacoes: d.idades.complicacoes.slice(0, 3), poderGeral: "" },
			equip: { arma: arma(d, "simples"), armaMarcial: "", armadura: "" },
			dinheiro: 8
		}),
		depois: (d, wiz) => {
			const periciasClasse = periciasDaClasse(wiz, 8);
			wiz.estado.periciasClasse = periciasClasse;
			wiz.estado.periciasInt = periciasPorInt(wiz);
			const especialista = [...wiz.periciasTreinadas()].sort().slice(0, wiz.qtdEspecialista);
			return { periciasClasse, periciasInt: wiz.estado.periciasInt, classePoderEscolhas: { especialista } };
		}
	}
];

/* ---------- Retrato de um personagem ---------- */

/**
 * Cascata de definirCampo: a partir do personagem completo, cada caso muda um campo (ou uma sequência)
 * pela janela, como o jogador faria, e o retrato guarda o que mudou no estado (e nos campos de tela).
 * Cada caso começa do mesmo estado. Um caso que devolve null não se aplica ao personagem.
 */
const outro = (lista, atual) => primeiros(lista.filter((x) => x.uuid !== atual), 1)[0].uuid;
const CASCATA = {
	raca: (d, w) => [["raca", outro(d.racas, w.estado.raca)]],
	racaEscolhas: () => [["racaEscolhas.versatil.pericias", ["acro", "atle"]]],
	classe: (d, w) => [["classe", outro(d.classes, w.estado.classe)]],
	escolhaClasse: (d, w) => {
		const esc = w.escolhasAtivas()[0];
		const op = esc?.opcoes.map((o) => o.poder).find((o) => o !== w.estado.escolhasClasse[esc.id]);
		return op ? [[`escolhasClasse.${esc.id}`, op]] : null;
	},
	escolhaClasseInvalida: () => [["escolhasClasse.inexistente", "x"]],
	magiasEscolas: () => [["magiasEscolas", ["ench"]]],
	periciasFixasManuais: (d, w) => [["periciasFixasManuais", w.estado.periciasClasse.slice(0, 1)]],
	periciasOu: () => [["periciasOu.0", "pont"]],
	origem: () => [["origens.principal.nome", "Artista"]],
	divindade: () => [["divindade", "Azgher"]],
	complicacoes: () => [["complicacoes", []]],
	faixa: (d, w) => [["idade.faixa", w.estado.idade.faixa === "velho" ? "crianca" : "velho"]],
	poderGeralIdade: () => [["idade.poderGeral", "Atlético"], ["idade.poderGeral", ""]],
	itemSuperior: (d, w) => {
		const k = Object.keys(w.estado.classePoderEscolhas).find((k) => w.estado.classePoderEscolhas[k]?.item !== undefined) ?? "teste";
		return [[`classePoderEscolhas.${k}.melhoria`, "m"], [`classePoderEscolhas.${k}.item`, "Outro item"]];
	},
	devoto: () => [["devoto", false]],
	fundamentalista: (d, w) => {
		const deus = d.divindades.find((x) => x.nome === (w.estado.divindade || "Khalmyr"));
		return [["fundamentalista", true], ["poderesConcedidos", deus.poderes.slice(0, w.poderesConcedidosPermitidos() + 1)], ["fundamentalista", false]];
	},
	vendas: (d, w) => [["vendas", [w.estado.equip.arma]], ["equip.arma", arma(d, "simples") === w.estado.equip.arma ? primeiros(d.armas.filter((a) => a.system.proficiencia === "simples"), 2)[1].name : arma(d, "simples")]],
	atrModo: () => [["atrModo", "rolagem"]],
	arranjo: () => [["atrFixo.arranjo", 1]],
	inteligencia: () => [["atrPontos.int", -1]],
	semMudanca: (d, w) => [["nome", w.estado.nome]]
};

/** Folhas que mudaram entre dois objetos (arrays comparados inteiros). */
function diferencas(a, b, base = "", out = {}) {
	const ehObj = (v) => v && typeof v === "object" && !Array.isArray(v);
	if (ehObj(a) && ehObj(b)) {
		for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) diferencas(a[k], b[k], base ? `${base}.${k}` : k, out);
	} else if (JSON.stringify(a) !== JSON.stringify(b)) out[base] = b === undefined ? "(removido)" : b;
	return out;
}

function retratarCascata(wiz, dados) {
	const base = structuredClone(wiz.estado);
	const out = {};
	for (const [nome, caso] of Object.entries(CASCATA)) {
		wiz.estado = structuredClone(base);
		const mudancas = caso(dados, wiz);
		if (!mudancas) { out[nome] = null; continue; }
		const tela = () => ({ indice: wiz.indice, dadoSelecionado: wiz.dadoSelecionado, focoDivindade: wiz.focoDivindade });
		Object.assign(wiz, { dadoSelecionado: 0, focoDivindade: "Khalmyr", indice: 2 });
		const antesTela = tela();
		for (const [campo, valor] of mudancas) wiz.definirCampo(campo, structuredClone(valor));
		out[nome] = { mudancas, estado: diferencas(base, wiz.estado), tela: diferencas(antesTela, tela()) };
	}
	wiz.estado = base;
	return out;
}

const nomes = (lista) => (lista ?? []).map((x) => x?.name ?? x?.doc?.name ?? x).filter(Boolean);

async function retratar(cenario) {
	const dados = await dadosCom(cenario.config);
	const wiz = new ConstrutorFicha(ator(cenario.nome));
	await wiz._prepareContext();
	wiz.estado = mergeObject(wiz.estado, cenario.estado(dados));
	if (cenario.depois) wiz.estado = mergeObject(wiz.estado, cenario.depois(dados, wiz));

	const passos = wiz.passos();
	const pendencias = {};
	const telas = {};
	for (const [i, p] of passos.entries()) {
		const id = p.sub ? `${p.id}:${p.sub}` : p.id;
		pendencias[id] = wiz.pendencia(p);
		// cada tela precisa montar sem erro
		wiz.indice = i;
		wiz.estado.alcancado = passos.length;
		try {
			const ctx = await wiz._prepareContext();
			telas[id] = ctx?.passo ? "ok" : "sem passo";
			if (ARQ_TELAS) contextos[`${cenario.nome} | ${id}`] = serializar(ctx);
		} catch (err) {
			telas[id] = `ERRO: ${err.message}`;
		}
	}
	const plano = wiz.plano();

	// a regra sem a janela: o modelo sozinho, com o mesmo estado, dá o mesmo plano e as mesmas pendências
	const modelo = new ModeloConstrutor(wiz.actor);
	Object.assign(modelo, { dados: wiz.dados, estado: structuredClone(wiz.estado), dadosNivel: wiz.dadosNivel, lerPreRequisito: wiz.lerPreRequisito });
	const resumo = (pl) => JSON.stringify({ ...pl, raca: pl.raca?.uuid, classe: pl.classe?.uuid, gruposPoderes: pl.gruposPoderes.map((g) => [g.prefixo, nomes(g.poderes)]),
		magias: nomes(pl.magias), magiasRaciais: nomes(pl.magiasRaciais), magiasPoderesClasse: nomes(pl.magiasPoderesClasse), poderesRaciais: nomes(pl.poderesRaciais), poderes: nomes(pl.poderes) });
	conferir(resumo(modelo.plano()) === resumo(plano), `${cenario.nome}: o modelo sem a janela deu outro plano`);
	conferir(JSON.stringify(modelo.passos().map((p) => modelo.pendencia(p))) === JSON.stringify(passos.map((p) => wiz.pendencia(p))), `${cenario.nome}: o modelo sem a janela deu outras pendências`);

	const cascata = retratarCascata(wiz, dados);

	// gravação na ficha (ator simulado que só guarda os itens criados): nomes das magias, com o prefixo da fonte
	const criados = [];
	const atorFicha = {
		...ator(cenario.nome), system: { detalhes: {}, attributes: {} },
		update: async () => {}, setFlag: async () => {}, unsetFlag: async () => {},
		createEmbeddedDocuments: async (tipo, lista) => { criados.push(...lista); return lista.map((d) => ({ ...d, update: async () => {} })); }
	};
	await aplicarNaFicha(atorFicha, plano, dados);
	const magiasNaFicha = criados.filter((i) => i.type === "magia").map((i) => i.name).sort((a, b) => a.localeCompare(b, "pt-BR"));
	for (const nome of magiasNaFicha) conferir(/^(?:[A-Z]|\d{1,2}) - /.test(nome), `${cenario.nome}: magia sem prefixo na ficha: ${nome}`);

	return {
		passos: passos.map((p) => (p.sub ? `${p.id}:${p.sub}` : p.id)),
		pendencias,
		telas,
		plano: {
			nome: plano.nome,
			raca: plano.raca?.name ?? null,
			classe: plano.classe?.name ?? null,
			atributos: plano.atributos,
			pericias: plano.pericias,
			poderes: plano.gruposPoderes.map((g) => ({ grupo: g.prefixo, poderes: nomes(g.poderes) })).filter((g) => g.poderes.length),
			magias: nomes(plano.magias),
			magiasRaciais: nomes(plano.magiasRaciais),
			magiasPoderesClasse: nomes(plano.magiasPoderesClasse),
			itens: (plano.itens ?? []).map((i) => `${i.nome}${i.qtd > 1 ? ` ×${i.qtd}` : ""}${i.melhoriaNome ? ` (${i.melhoriaNome})` : ""}`),
			conjuracao: plano.conjuracao ?? null,
			escolasMagia: plano.escolasMagia ?? null,
			origem: plano.origem,
			divindade: plano.divindade,
			idade: plano.idade ?? null,
			niveisExtras: plano.niveisExtras ?? 0,
			dinheiro: plano.dinheiro,
			escolhasRaciais: plano.escolhasRaciais ?? null,
			escolhasClasse: plano.escolhasClasse ?? null
		},
		magiasNaFicha,
		cascata
	};
}

/* ---------- Comparação com o retrato salvo ---------- */

const caminhoRetrato = path.join(aqui, "retratos/construtor.json");
const salvo = fs.existsSync(caminhoRetrato) ? JSON.parse(fs.readFileSync(caminhoRetrato, "utf8")) : {};
const atual = {};
// todo data-action dos templates do construtor tem uma ação registrada (as ações vêm de vários arquivos)
{
	const acoes = ConstrutorFicha.DEFAULT_OPTIONS.actions;
	const tpl = path.join(raizModulo, "templates");
	const arquivos = ["wizard.hbs", ...fs.readdirSync(path.join(tpl, "passos")).map((f) => `passos/${f}`),
		...["poder", "abrir", "aprimoramentos", "escolha-racial", "poder-escolha", "venda", "poder-selecionavel"].map((f) => `partes/${f}.hbs`)];
	const usadas = new Set(arquivos.flatMap((f) => [...fs.readFileSync(path.join(tpl, f), "utf8").matchAll(/data-action="([^"]+)"/g)].map((m) => m[1])));
	for (const a of usadas) conferir(typeof acoes[a] === "function", `ação "${a}" usada nos templates não está registrada`);
	for (const a of Object.keys(acoes)) conferir(usadas.has(a), `ação "${a}" registrada mas não usada nos templates`);
}

for (const c of CENARIOS) {
	if (c.precisaSuplemento && !sup) {
		console.log(`${c.nome}: pulado (sem o cache do Suplementos de Arton; rode ferramentas/extrair-suplemento.mjs)`);
		if (salvo[c.nome]) atual[c.nome] = salvo[c.nome];
		continue;
	}
	let r;
	try {
		r = await retratar(c);
	} catch (err) {
		conferir(false, `${c.nome}: ${err.stack}`);
		continue;
	}
	atual[c.nome] = r;
	const erros = Object.entries(r.telas).filter(([, v]) => v !== "ok");
	erros.forEach(([id, v]) => conferir(false, `${c.nome}: tela ${id}: ${v}`));
	const pend = Object.entries(r.pendencias).filter(([, v]) => v);
	console.log(`${c.nome}: ${r.passos.length} passos, ${Object.keys(r.telas).length - erros.length} telas ok${pend.length ? `, pendências: ${pend.map(([id, v]) => `${id} (${v})`).join("; ")}` : ", sem pendências"}`);
	if (VERBOSO) console.log(JSON.stringify(r.plano, null, 2));
	if (!ATUALIZAR) {
		if (!salvo[c.nome]) conferir(false, `${c.nome}: sem retrato salvo (rode com --atualizar)`);
		else if (JSON.stringify(salvo[c.nome]) !== JSON.stringify(r)) {
			const diff = Object.keys(r).filter((k) => JSON.stringify(salvo[c.nome][k]) !== JSON.stringify(r[k]));
			for (const k of diff) {
				if (k === "plano") {
					for (const pk of Object.keys(r.plano)) {
						if (JSON.stringify(salvo[c.nome].plano?.[pk]) !== JSON.stringify(r.plano[pk])) {
							conferir(false, `${c.nome}: plano.${pk} mudou\n      antes: ${JSON.stringify(salvo[c.nome].plano?.[pk])}\n      agora: ${JSON.stringify(r.plano[pk])}`);
						}
					}
				} else conferir(false, `${c.nome}: ${k} mudou\n      antes: ${JSON.stringify(salvo[c.nome][k])}\n      agora: ${JSON.stringify(r[k])}`);
			}
		}
	}
}
if (ATUALIZAR) {
	fs.mkdirSync(path.dirname(caminhoRetrato), { recursive: true });
	fs.writeFileSync(caminhoRetrato, JSON.stringify(atual, null, 2) + "\n");
	console.log(`\nRetrato gravado em ${path.relative(process.cwd(), caminhoRetrato)} (${Object.keys(atual).length} personagens).`);
}
if (ARQ_TELAS) fs.writeFileSync(ARQ_TELAS, JSON.stringify(contextos, null, 1));
console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
