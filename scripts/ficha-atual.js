/**
 * Estado atual de um personagem, lido da ficha, no formato usado pela subida de nível e pela
 * avaliação de pré-requisitos. Não depende do Foundry: recebe o ator (ou um objeto com o mesmo formato).
 */
import { ATRIBUTOS, MODULE_ID, normalizar } from "./regras.js";

/** Nome do poder sem o prefixo do construtor ("R - ", "1 - ", "12 - "…). */
export function nomeBase(nome) {
	return String(nome ?? "").replace(/^(?:[A-Z]|\d{1,2})\s+-\s+/, "").trim();
}

/** Chaves de busca de um nome: completo e sem o complemento entre parênteses ("Ambidestria (Guerreiro)"). */
function chaves(nome) {
	const k = normalizar(nomeBase(nome));
	const semParenteses = k.replace(/\s*\([^)]*\)\s*$/, "").trim();
	return semParenteses && semParenteses !== k ? [k, semParenteses] : [k];
}

const PROF_DO_SISTEMA = { pes: "pesada", esc: "escudo", marcial: "marcial", exotica: "exotica", fogo: "fogo" };

/**
 * @param {object} actor  ator do Foundry (ou objeto com items, system.atributos, system.pericias, system.tracos)
 * @param {object} opcoes { regrasClasses, variantes: {variante: classe básica} }
 */
export function lerFicha(actor, { regrasClasses = {}, variantes = {} } = {}) {
	const itens = [...(actor.items ?? [])];
	const sys = actor.system ?? {};

	const classes = itens
		.filter((i) => i.type === "classe")
		.map((i) => ({ id: i.id ?? i._id, nome: i.name, niveis: Number(i.system?.niveis) || 0, inicial: !!i.system?.inicial, item: i }));
	const nivel = classes.reduce((s, c) => s + c.niveis, 0);
	// a variante conta como a classe básica para pré-requisitos ("6º nível de guerreiro")
	const basica = (nome) => normalizar(variantes[nome] ?? nome);
	const niveisDeClasse = (nome) => classes
		.filter((c) => normalizar(c.nome) === normalizar(nome) || basica(c.nome) === normalizar(nome))
		.reduce((s, c) => s + c.niveis, 0);

	const atributos = {};
	for (const k of ATRIBUTOS) {
		const a = sys.atributos?.[k] ?? {};
		atributos[k] = Number.isFinite(a.value) ? a.value : (Number(a.base) || 0) + (Number(a.racial) || 0) + (Number(a.bonus) || 0);
	}

	const pericias = new Set(Object.entries(sys.pericias ?? {}).filter(([, p]) => p?.treinado).map(([k]) => k));

	const proficiencias = new Set();
	for (const v of [...(sys.tracos?.profArmas?.value ?? []), ...(sys.tracos?.profArmaduras?.value ?? [])]) {
		if (PROF_DO_SISTEMA[v]) proficiencias.add(PROF_DO_SISTEMA[v]);
	}
	// o construtor não grava as proficiências na ficha: vêm das regras da classe inicial
	const inicial = classes.find((c) => c.inicial) ?? classes[0];
	for (const p of regrasClasses[inicial?.nome]?.proficiencias ?? []) proficiencias.add(p);

	const poderes = itens.filter((i) => i.type === "poder");
	const contagem = new Map();
	for (const p of poderes) for (const k of chaves(p.name)) contagem.set(k, (contagem.get(k) ?? 0) + 1);
	const poderesPorSubtipo = new Map();
	for (const p of poderes) {
		const s = normalizar(p.system?.subtipo);
		if (s) poderesPorSubtipo.set(s, (poderesPorSubtipo.get(s) ?? 0) + 1);
	}

	// prefixos de poderes com "Prefixo: Nome" (ex.: "Armadilha: Laço" → "armadilha")
	// poderes de um grupo: pelo subtipo ("Grupo") ou pelo começo do nome ("Combinação: …", "Brado: …", "Ditame da …")
	const contarGrupo = (grupo) => {
		const g = normalizar(grupo).replace(/s$/, "");
		return poderes.filter((p) => normalizar(p.system?.subtipo) === g || normalizar(nomeBase(p.name)).startsWith(g)).length;
	};
	const prefixos = new Set(poderes.map((p) => normalizar(nomeBase(p.name))).filter((n) => n.includes(":")).map((n) => n.split(":")[0].trim()));

	const magiasItens = itens.filter((i) => i.type === "magia");
	const magias = new Set(magiasItens.map((m) => normalizar(m.name)));
	const circuloMax = magiasItens.reduce((max, m) => Math.max(max, Number(m.system?.circulo) || 0), 0);
	const temMagias = magiasItens.length > 0 || poderes.some((p) => /^magias\b/.test(normalizar(nomeBase(p.name))));

	return {
		classes,
		nivel,
		niveisDeClasse,
		atributos,
		pericias,
		proficiencias,
		magias,
		circuloMax,
		temMagias,
		poderesPorSubtipo,
		/** Escolas de magia escolhidas (Bardo, Druida), gravadas pelo construtor; [] se não houver. */
		escolasMagia: [...(actor.flags?.[MODULE_ID]?.escolasMagia ?? [])],
		/** Tipos das magias da ficha (arc, div, uni). */
		tiposMagia: new Set(magiasItens.map((m) => m.system?.tipo).filter(Boolean)),
		/** Nome da raça da ficha ou "". */
		raca: itens.find((i) => i.type === "race")?.name ?? "",
		contarGrupo,
		/** Nome da divindade na ficha ("Khalmyr", "Khalmyr (fundamentalista)") ou "". */
		divindade: String(sys.detalhes?.divindade ?? "").trim(),
		/** A ficha tem algum poder "Prefixo: …"? (ex.: "armadilha" → "Armadilha: Laço") */
		temPoderComPrefixo: (prefixo) => prefixos.has(normalizar(prefixo)),
		/** Quantas vezes a ficha tem o poder (pelo nome, com ou sem prefixo e complemento). */
		vezesPoder: (nome) => Math.max(0, ...chaves(nome).map((k) => contagem.get(k) ?? 0)),
		temPoder(nome) {
			return this.vezesPoder(nome) > 0;
		}
	};
}
