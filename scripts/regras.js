/**
 * Regras de criação de personagem (T20 Jogo do Ano) — funções puras, sem Foundry.
 */

export const MODULE_ID = "t20-construtor-ficha";

export const ATRIBUTOS = ["for", "des", "con", "int", "sab", "car"];

export const NOMES_ATRIBUTOS = {
	for: "Força",
	des: "Destreza",
	con: "Constituição",
	int: "Inteligência",
	sab: "Sabedoria",
	car: "Carisma"
};

export const OFICIOS = ["alfa", "alqu", "arme", "arte", "cozi", "enge"];

/* ---------------- Compra de pontos ---------------- */

export const PONTOS_TOTAIS = 10;
export const CUSTO_PONTOS = { "-1": -1, 0: 0, 1: 1, 2: 2, 3: 4, 4: 7 };
export const MIN_PONTOS = -1;
export const MAX_PONTOS = 4;

export function custoAtributo(valor) {
	return CUSTO_PONTOS[valor] ?? Infinity;
}

export function pontosGastos(base) {
	return ATRIBUTOS.reduce((soma, k) => soma + custoAtributo(base[k] ?? 0), 0);
}

/* ---------------- Rolagem ---------------- */

/** Converte o resultado de 4d6 (descartando o menor) em valor de atributo. */
export function converterRolagem(total) {
	if (total <= 7) return -2;
	if (total <= 9) return -1;
	if (total <= 11) return 0;
	if (total <= 13) return 1;
	if (total <= 15) return 2;
	if (total <= 17) return 3;
	return 4;
}

/* ---------------- Atributos Variados (regra opcional) ---------------- */

/** Métodos de "Atributos Variados", na ordem de exibição. */
export const MODOS_VARIADOS = {
	classica: { nome: "Clássica (3d6)", rolagem: "3d6", descricao: "Role 3d6 para cada atributo (sem descartar dados). Gera personagens mais fracos e desequilibrados, para histórias brutais em que os heróis surgem do povo comum." },
	epica: { nome: "Épica (3d6 − menor + 6)", rolagem: "3d6kh2 + 6", descricao: "Para cada atributo, role 3d6, descarte o menor dado e some 6. Gera personagens poderosos, quase sem pontos fracos, para heróis \u201cescolhidos\u201d." },
	valkaria: { nome: "Valkaria (7d6)", descricao: "Cada atributo começa em 8. Role 7d6 e aplique cada dado inteiro no atributo que quiser (vários dados podem ir no mesmo). No fim, cada atributo é convertido pela tabela (máximo +4)." },
	khalmyr: { nome: "Khalmyr (valores fixos)", valores: [3, 3, 2, 1, 0, -1], descricao: "Distribua 3, 3, 2, 1, 0 e −1, sem rolar nada. Personagens com pontos fortes e fracos, todos equilibrados entre si." },
	nimb: { nome: "Nimb (7d20)", descricao: "Role 7d20 e descarte o menor; aplique os seis valores nos atributos. Conversão: 1 a 3 → −3; 18 ou 19 → +4; 20 → +5. Pode gerar personagens muito fortes ou muito fracos." }
};

/** Valor base inicial de cada atributo no método Valkaria (antes de somar os dados). */
export const VALKARIA_INICIAL = 8;

/** Conversão do método Nimb: a tabela normal, com 1–3 → −3, 18–19 → 4 e 20 → 5. */
export function converterNimb(total) {
	if (total <= 3) return -3;
	if (total >= 20) return 5;
	return converterRolagem(total);
}

/* ---------------- Valores fixos ---------------- */

export const ARRANJOS_FIXOS = [
	[4, 2, 1, 1, 0, -1],
	[3, 3, 1, 1, 0, 0],
	[3, 2, 2, 1, 1, 0]
];

/* ---------------- Perícias ---------------- */

/** Expande o token "oficio" para as perícias de Ofício do sistema. */
export function expandirPericias(lista) {
	const out = [];
	for (const k of lista ?? []) {
		if (k === "oficio") out.push(...OFICIOS);
		// "todas": qualquer perícia (classes de suplemento sem lista cadastrada)
		else if (k === "todas") out.push(...Object.keys(globalThis.CONFIG?.T20?.pericias ?? {}));
		else out.push(k);
	}
	return [...new Set(out)];
}

/* ---------------- Perícias de classe a partir do texto do livro ---------------- */

const PERICIAS_POR_NOME = {
	acrobacia: "acro", adestramento: "ades", atletismo: "atle", atuacao: "atua", cavalgar: "cava",
	conhecimento: "conh", cura: "cura", diplomacia: "dipl", enganacao: "enga", fortitude: "fort",
	furtividade: "furt", guerra: "guer", iniciativa: "inic", intimidacao: "inti", intuicao: "intu",
	investigacao: "inve", jogatina: "joga", ladinagem: "ladi", luta: "luta", misticismo: "mist",
	nobreza: "nobr", oficio: "oficio", percepcao: "perc", pilotagem: "pilo", pontaria: "pont",
	reflexos: "refl", religiao: "reli", sobrevivencia: "sobr", vontade: "vont"
};

/** Ofícios que o sistema tem como perícia própria. */
const OFICIOS_POR_NOME = { alfaiate: "alfa", alquimista: "alqu", armeiro: "arme", artesao: "arte", cozinheiro: "cozi", engenhoqueiro: "enge" };
const SIGLAS_ATRIBUTO = new Set(["for", "des", "con", "int", "sab", "car"]);

/**
 * Chave da perícia a partir do nome do livro; null se não reconhecer.
 * "Ofício (Int)" ou "Ofício" → "oficio" (um Ofício à escolha); "Ofício (alquimista)" → "alqu".
 */
export function chavePericia(nome, naoReconhecidas = []) {
	const entre = /\(([^)]*)\)/.exec(nome)?.[1]?.trim() ?? "";
	const base = PERICIAS_POR_NOME[normalizar(nome.replace(/\([^)]*\)/g, "")).replace(/[^a-z]/g, "")] ?? null;
	if (base === "oficio" && entre && !SIGLAS_ATRIBUTO.has(normalizar(entre))) {
		const k = OFICIOS_POR_NOME[normalizar(entre)];
		if (k) return k;
		// Ofício que o sistema não tem como perícia (ex.: barbeiro): vira um Ofício à escolha, com aviso
		naoReconhecidas.push(nome);
	}
	return base;
}

/** Separa uma lista do livro: "A, B e C" → ["A", "B", "C"]. */
function separarLista(texto) {
	return texto
		// tolera vírgula faltando entre itens: "Adestramento (Car) Atletismo (For)"
		.replace(/\)\s+(?=\p{Lu})/gu, "), ")
		.split(/,\s*|\s+e\s+/).map((x) => x.trim().replace(/\.$/, "")).filter(Boolean);
}

/**
 * Interpreta o texto de perícias de uma classe no formato do livro:
 * "Luta (For) ou Pontaria (Des) e Acrobacia (Des), mais 2 a sua escolha entre A (Des), B (For) e C (Int)."
 * Retorna { fixas, ou, opcoes, numero, naoReconhecidas } no formato de data/classes.json.
 */
export function interpretarPericiasClasse(texto) {
	const limpo = String(texto ?? "").replace(/\s+/g, " ").trim();
	const m = /^(.*?),?\s*mais (\d+|\w+) (?:a|à) sua escolha entre (.*)$/i.exec(limpo);
	if (!m) return null;
	const numero = Number(m[2]) || ({ um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, oito: 8 })[normalizar(m[2])] || 0;
	const naoReconhecidas = [];
	const chave = (nome) => {
		const k = chavePericia(nome, naoReconhecidas);
		if (!k) naoReconhecidas.push(nome);
		return k;
	};
	const fixas = [];
	const ou = [];
	for (const parte of separarLista(m[1])) {
		if (/\sou\s/i.test(parte)) ou.push(parte.split(/\s+ou\s+/i).map(chave).filter(Boolean));
		else {
			const k = chave(parte);
			// "Ofício" entre as fixas é um Ofício à escolha (não os seis)
			if (k === "oficio") ou.push(["oficio"]);
			else if (k) fixas.push(k);
		}
	}
	const opcoes = [...new Set(separarLista(m[3]).map(chave).filter(Boolean))];
	return { fixas, ou, opcoes, numero, naoReconhecidas };
}

/* ---------------- Utilitários ---------------- */

export function normalizar(texto) {
	return String(texto ?? "")
		.normalize("NFD")
		.replace(/\p{Diacritic}/gu, "")
		.toLowerCase()
		.trim();
}

export function sinal(n) {
	return n > 0 ? `+${n}` : `${n}`;
}
