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
