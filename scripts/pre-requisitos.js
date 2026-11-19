/**
 * Pré-requisitos de poderes, lidos do texto da descrição ("Pré-requisitos: For 1, treinado em Luta.")
 * e avaliados contra o estado da ficha (ficha-atual.js). Funções puras, sem Foundry.
 *
 * O que não é reconhecido não bloqueia: vira um aviso "confira" com o texto original.
 */
import { normalizar, chavePericia } from "./regras.js";

const SIGLAS = { for: "for", des: "des", con: "con", int: "int", sab: "sab", car: "car" };
const NUMEROS = { um: 1, uma: 1, outro: 1, outra: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };
const ESCOLAS = { abjuracao: "abj", adivinhacao: "adv", convocacao: "con", encantamento: "enc", evocacao: "evo", ilusao: "ilu", necromancia: "nec", transmutacao: "trm" };
const PROFICIENCIAS = {
	"armaduras pesadas": "pesada",
	escudos: "escudo",
	"armas marciais": "marcial",
	"armas exoticas": "exotica",
	"armas de fogo": "fogo"
};

/** Texto puro de um HTML de descrição. */
export function textoPuro(html) {
	return String(html ?? "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Trecho depois de "Pré-requisito(s):" até o fim da frase; null se o poder não tem pré-requisito. */
export function extrairPreRequisito(html) {
	const m = /pr[ée]-?\s?requisitos?\s*:\s*(.+?)(?:\.(?=\s|$)|$)/i.exec(textoPuro(html));
	return m ? m[1].trim() : null;
}

/** O poder pode ser escolhido mais de uma vez? ("Você pode escolher este poder outras vezes…") */
export function podeRepetir(html) {
	return /pode escolher (?:este|esse) poder (?:outras|v[áa]rias|mais de uma) vez/i.test(textoPuro(html));
}

/** Separa por vírgulas fora de parênteses. */
function clausulas(texto) {
	const out = [];
	let nivel = 0;
	let atual = "";
	for (const ch of texto) {
		if (ch === "(") nivel++;
		if (ch === ")") nivel = Math.max(0, nivel - 1);
		if (ch === "," && nivel === 0) {
			out.push(atual);
			atual = "";
		} else atual += ch;
	}
	out.push(atual);
	return out.map((c) => c.trim().replace(/\.$/, "")).filter(Boolean);
}

/**
 * Converte uma cláusula numa condição, ou null se não reconhecer.
 * ctx: { ehPoder(nome) → nome canônico|null, ehClasse(nome) → nome canônico|null, ehMagia(nome) → nome|null }
 */
function condicao(clausula, ctx) {
	const c = clausula.trim();
	const n = normalizar(c);
	let m;

	if ((m = /^(for|des|con|int|sab|car)\s+(-?\d+)$/.exec(n))) {
		return { tipo: "atributo", atributo: SIGLAS[m[1]], min: Number(m[2]), texto: c };
	}
	// "Car –1 ou menor"
	if ((m = /^(for|des|con|int|sab|car)\s+[-–](\d+) ou menor$/.exec(n))) {
		return { tipo: "atributoMax", atributo: SIGLAS[m[1]], max: -Number(m[2]), texto: c };
	}
	if (/^lancar magias$/.test(n)) return { tipo: "magias", texto: c };
	if ((m = /^lancar magias (arcanas|divinas)$/.exec(n))) return { tipo: "tipoMagia", tipoMagia: m[1] === "arcanas" ? "arc" : "div", texto: c };
	// "necromancia como uma de suas escolas de magia"
	if ((m = /^(\w+) como uma de suas escolas de magia$/.exec(n)) && ESCOLAS[m[1]]) return { tipo: "escola", escola: ESCOLAS[m[1]], texto: c };
	// "druida de Tenebra": devoto do deus ("druida de Arton" não tem deus: fica como aviso)
	if ((m = /^druida de (.+)$/.exec(n)) && m[1] !== "arton") return { tipo: "devotoDe", deus: m[1], texto: c };
	// "não possuir Forma Selvagem", "não humano"
	if ((m = /^nao possuir (.+)$/i.exec(normalizar(c)))) {
		const nome = ctx.ehPoder?.(c.replace(/^n[ãa]o possuir\s+/i, ""));
		if (nome) return { tipo: "naoPoder", nome, texto: c };
	}
	if ((m = /^nao (\S+)$/.exec(n)) && ctx.ehRaca?.(m[1])) return { tipo: "naoRaca", raca: ctx.ehRaca(m[1]), texto: c };
	// "outro poder de Combinação", "dois poderes de postura", "outra inovação qualquer", "outro poder de grupo"
	if ((m = /^(\w+) (?:outros? )?poder(?:es)? de (.+)$/.exec(n)) && (NUMEROS[m[1]] ?? Number(m[1]))) {
		return { tipo: "contaGrupo", grupo: m[2], min: NUMEROS[m[1]] ?? Number(m[1]), texto: c };
	}
	if ((m = /^outr[oa] (\w+) qualquer$/.exec(n))) return { tipo: "contaGrupo", grupo: m[1], min: 1, texto: c };
	if ((m = /^(\d+)[ºo°]?\s+nivel(?:\s+de\s+(.+))?$/.exec(n))) {
		const min = Number(m[1]);
		if (!m[2] || m[2] === "personagem") return { tipo: "nivel", min, classe: null, texto: c };
		const classe = ctx.ehClasse?.(m[2]);
		return classe ? { tipo: "nivel", min, classe, texto: c } : null;
	}
	if ((m = /^treinad[oa]s?\s+(?:em|na|no)\s+(.+)$/i.exec(c))) {
		// "treinado em A ou B" (qualquer uma) / "treinado em A e B" (as duas)
		const ou = /\s+ou\s+/i.test(m[1]);
		const chavesPericias = m[1].split(ou ? /\s+ou\s+/i : /\s+e\s+/i).map((p) => chavePericia(p.trim()));
		if (!chavesPericias.length || chavesPericias.some((k) => !k || k === "oficio")) return null;
		const conds = chavesPericias.map((k) => ({ tipo: "pericia", pericia: k, texto: c }));
		if (conds.length === 1) return conds[0];
		return ou ? { tipo: "ou", opcoes: conds, texto: c } : { tipo: "todas", condicoes: conds, texto: c };
	}
	if ((m = /^proficiencia com (.+)$/.exec(n))) {
		const prof = PROFICIENCIAS[m[1]];
		return prof ? { tipo: "proficiencia", prof, texto: c } : null;
	}
	if (/^habilidade de classe magias$/.test(n)) return { tipo: "magias", texto: c };
	// "um poder de armadilha", "qualquer poder de Missa": algum poder com esse prefixo ("Armadilha: Laço")
	if ((m = /^(?:um|qualquer) poder de (.+)$/.exec(n))) return { tipo: "prefixoPoder", prefixo: m[1], texto: c };
	// "devoto de uma divindade (exceto Lena e Marah)", "devoto de um deus maior"
	if ((m = /^devoto de (?:uma divindade|um deus(?: maior| menor)?)(?:\s*\(exceto (.+)\))?$/.exec(n))) {
		const exceto = m[1] ? m[1].split(/\s*,\s*|\s+e\s+|\s+ou\s+/).filter(Boolean) : [];
		// maior × menor não é verificável pela ficha (só o nome do deus)
		return { tipo: "devoto", exceto, texto: c, ...(/deus (?:maior|menor)/.test(n) ? { ressalva: c } : {}) };
	}
	if ((m = /^lancar magias de (\d)[ºo°]? circulo$/.exec(n))) return { tipo: "circulo", min: Number(m[1]), texto: c };
	if ((m = /^(?:(\w+)\s+)?outros?\s+poder(?:es)?\s+da tormenta$/.exec(n)) || (m = /^outro poder de (tormenta)$/.exec(n))) {
		const min = m[1] ? NUMEROS[m[1]] ?? Number(m[1]) : 1;
		return min ? { tipo: "contaPoderes", subtipo: "tormenta", min, texto: c } : null;
	}

	// nome de poder ou de magia (com ou sem complemento: "Especialização em Arma com a arma escolhida")
	const nomeDe = (t) => {
		const poder = ctx.ehPoder?.(t);
		if (poder) return { tipo: "poder", nome: poder, texto: c };
		const magia = ctx.ehMagia?.(t);
		if (magia) return { tipo: "magia", nome: magia, texto: c };
		return null;
	};
	const direto = nomeDe(c) ?? nomeDe(c.replace(/^habilidade\s+/i, ""));
	if (direto) return direto;
	// "Foco em Perícia (Enganação)", "Herança Superior (linhagem celestial)": o poder, com o complemento como aviso
	if ((m = /^(.+?)\s*\(([^)]+)\)$/.exec(c))) {
		const cond = nomeDe(m[1]);
		if (cond) return { ...cond, ressalva: c };
	}
	if ((m = /^(.+?)\s+com\s+(?:a|o|as|os)\s+.+$/i.exec(c))) {
		const cond = nomeDe(m[1]);
		// o complemento ("com a arma escolhida") não é verificável: avisa
		if (cond) return { ...cond, ressalva: c };
	}
	if (/\sou\s/i.test(c)) {
		const opcoes = c.replace(/^habilidade\s+/i, "").split(/\s+ou\s+/i).map((p) => condicao(p, ctx));
		if (opcoes.every(Boolean)) return { tipo: "ou", opcoes, texto: c };
	}
	return null;
}

/**
 * Interpreta o texto de pré-requisitos.
 * @returns {{texto: string, condicoes: object[], naoReconhecidos: string[]}}
 */
export function interpretarPreRequisito(texto, ctx = {}) {
	const condicoes = [];
	const naoReconhecidos = [];
	for (const cl of clausulas(String(texto ?? ""))) {
		const cond = condicao(cl, ctx);
		if (cond) condicoes.push(cond);
		else naoReconhecidos.push(cl);
	}
	return { texto: String(texto ?? ""), condicoes, naoReconhecidos };
}

/** Avalia uma condição contra a ficha (ver ficha-atual.js). */
function atende(cond, ficha) {
	switch (cond.tipo) {
		case "atributo": return (ficha.atributos[cond.atributo] ?? 0) >= cond.min;
		case "nivel": return (cond.classe ? ficha.niveisDeClasse(cond.classe) : ficha.nivel) >= cond.min;
		case "pericia": return ficha.pericias.has(cond.pericia);
		case "proficiencia": return ficha.proficiencias.has(cond.prof);
		case "magias": return ficha.temMagias;
		case "tipoMagia": return ficha.tiposMagia.has(cond.tipoMagia);
		case "escola": return ficha.escolasMagia.includes(cond.escola);
		case "atributoMax": return (ficha.atributos[cond.atributo] ?? 0) <= cond.max;
		case "devotoDe": return normalizar(ficha.divindade).startsWith(cond.deus);
		case "naoPoder": return !ficha.temPoder(cond.nome);
		case "naoRaca": return normalizar(ficha.raca) !== normalizar(cond.raca);
		case "contaGrupo": return ficha.contarGrupo(cond.grupo) >= cond.min;
		case "prefixoPoder": return ficha.temPoderComPrefixo(cond.prefixo);
		case "devoto": {
			const d = normalizar(ficha.divindade);
			return !!d && !cond.exceto.some((x) => d.startsWith(x));
		}
		case "circulo": return ficha.circuloMax >= cond.min;
		case "contaPoderes": return (ficha.poderesPorSubtipo.get(cond.subtipo) ?? 0) >= cond.min;
		case "poder": return ficha.temPoder(cond.nome);
		case "magia": return ficha.magias.has(normalizar(cond.nome));
		case "ou": return cond.opcoes.some((o) => atende(o, ficha));
		case "todas": return cond.condicoes.every((o) => atende(o, ficha));
		default: return false;
	}
}

/**
 * Resultado da avaliação: ok = todas as condições reconhecidas foram atendidas.
 * avisos = trechos não verificáveis (não bloqueiam).
 */
export function avaliarPreRequisito(req, ficha) {
	const falhas = [];
	const avisos = [];
	for (const cond of req?.condicoes ?? []) {
		if (!atende(cond, ficha)) falhas.push(cond.texto);
		else if (cond.ressalva) avisos.push(cond.ressalva);
	}
	avisos.push(...(req?.naoReconhecidos ?? []));
	return { ok: falhas.length === 0, falhas, avisos };
}
