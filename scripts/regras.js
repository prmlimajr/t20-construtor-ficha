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
