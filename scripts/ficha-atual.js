/**
 * Estado atual de um personagem, lido da ficha, no formato usado pela subida de nível e pela
 * avaliação de pré-requisitos. Não depende do Foundry: recebe o ator (ou um objeto com o mesmo formato).
 */
import { ATRIBUTOS, MODULE_ID, normalizar } from "./regras.js";
import { ELEMENTOS } from "./afinidade.js";

/** Nome do poder ou magia sem o prefixo do construtor ("R - ", "1 - ", "12 - "…). */
export function nomeBase(nome) {
	return String(nome ?? "").replace(/^(?:[A-Z]|\d{1,2})\s+-\s+/, "").trim();
}

/** Chaves de busca de um nome: completo e sem o complemento entre parênteses ("Ambidestria (Guerreiro)"). */
function chaves(nome) {
	const k = normalizar(nomeBase(nome));
	const semParenteses = k.replace(/\s*\([^)]*\)\s*$/, "").trim();
	return semParenteses && semParenteses !== k ? [k, semParenteses] : [k];
}

/** Poderes do místico que dão um elemento à Afinidade Elemental. */
const PODERES_AFINIDADE = new Set(["afinidade elemental", "afinidade expandida", "afinidade maior"]);

const PROF_DO_SISTEMA = { pes: "pesada", esc: "escudo", marcial: "marcial", exotica: "exotica", fogo: "fogo" };

/**
 * @param {object} actor  ator do Foundry (ou objeto com items, system.atributos, system.pericias, system.tracos)
 * @param {object} opcoes { regrasClasses, variantes: {variante: classe básica} }
 */
export function lerFicha(actor, { regrasClasses = {}, variantes = {} } = {}) {
	const itens = [...(actor.items ?? [])];
	const sys = actor.system ?? {};
	const flags = actor.flags?.[MODULE_ID] ?? {};

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

	// Afinidade Elemental do místico: os elementos ficam anotados nos poderes pelo construtor
	// ("Escolha (construtor): Água (frio)") ou pelo jogador ao subir de nível ("Escolha (12º nível): terra",
	// no Afinidade Maior); poder de afinidade sem elemento anotado deixa a lista incompleta
	const afinidade = { elementos: new Set(), incompleta: false };
	for (const p of poderes) {
		if (!PODERES_AFINIDADE.has(normalizar(nomeBase(p.name)))) continue;
		const notas = [...String(p.system?.description?.value ?? "").matchAll(/Escolha \((?:construtor|\d+º nível)\):(?:\s*<\/strong>)?([^<]*)/g)].map((x) => x[1]).join(" ");
		const achados = [...normalizar(notas).matchAll(/\b(agua|ar|fogo|luz|terra|trevas)\b/g)].map((x) => x[1]);
		if (achados.length) achados.forEach((el) => afinidade.elementos.add(el));
		else afinidade.incompleta = true;
	}

	const magiasItens = itens.filter((i) => i.type === "magia");
	const magias = new Set(magiasItens.map((m) => normalizar(nomeBase(m.name))));
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
		/** Elementos da Afinidade Elemental (místico): { elementos: Set("agua", "fogo"…), incompleta }. */
		afinidade,
		/** Escolas de magia escolhidas (Bardo, Druida), gravadas pelo construtor; [] se não houver. */
		/** Escolas de magia de todas as classes (para pré-requisitos "X como uma de suas escolas"). */
		// (com as escolas dos elementos da Afinidade do místico, que valem além das gravadas)
		escolasMagia: [...new Set([...(flags.escolasMagia ?? []), ...Object.values(flags.escolasMagiaPorClasse ?? {}).flat(), ...[...afinidade.elementos].map((k) => ELEMENTOS[k].escola)])],
		/** Sentidos da ficha (penumbra, escuro, cegas, faro). */
		sentidos: new Set([...(sys.attributes?.sentidos?.value ?? [])]),
		/** Escolas de magia de uma classe: as gravadas para ela, ou as da criação se for a classe inicial. */
		escolasDe: (nome) => [...(flags.escolasMagiaPorClasse?.[nome] ?? (normalizar(inicial?.nome) === normalizar(nome) ? flags.escolasMagia ?? [] : []))],
		/** Idades Variadas: níveis extras da faixa etária, gravados na criação (0 se não houver). */
		niveisExtras: Number(flags.niveisExtras) || 0,
		/** Atributo-chave de magias da ficha (system.attributes.conjuracao). */
		conjuracao: sys.attributes?.conjuracao || null,
		/** Tipos das magias da ficha (arc, div, uni). */
		tiposMagia: new Set(magiasItens.map((m) => m.system?.tipo).filter(Boolean)),
		/** Nome da raça da ficha ou "". */
		raca: itens.find((i) => i.type === "race")?.name ?? "",
		contarGrupo,
		/** Nome da divindade na ficha ("Khalmyr", "Khalmyr (fundamentalista)") ou "". */
		divindade: String(sys.detalhes?.divindade ?? "").trim(),
		/** A ficha tem algum poder "Prefixo: …"? (ex.: "armadilha" → "Armadilha: Laço") */
		temPoderComPrefixo: (prefixo) => prefixos.has(normalizar(prefixo)),
		/**
		 * Níveis de personagem em que a ficha recebeu o poder com este nome exato (com o complemento:
		 * "Aumento de Atributo (Força)"), pela marca do construtor ou pelo prefixo "5 - "; null se não se sabe.
		 */
		niveisPoder(nome) {
			const alvo = normalizar(nome);
			return poderes.filter((p) => normalizar(nomeBase(p.name)) === alvo).map((p) => {
				const marca = Number(p.flags?.[MODULE_ID]?.nivel ?? p.getFlag?.(MODULE_ID, "nivel"));
				if (marca > 0) return marca;
				const prefixo = /^(\d{1,2})\s+-\s+/.exec(p.name ?? "");
				return prefixo ? Number(prefixo[1]) : null;
			});
		},
		/** Quantas vezes a ficha tem o poder (pelo nome, com ou sem prefixo e complemento). */
		vezesPoder: (nome) => Math.max(0, ...chaves(nome).map((k) => contagem.get(k) ?? 0)),
		temPoder(nome) {
			return this.vezesPoder(nome) > 0;
		}
	};
}
