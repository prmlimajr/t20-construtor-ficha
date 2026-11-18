/**
 * Poderes gerais ligados a uma raça (Heróis de Arton: "Arma Amada (Anão)", "Citadino (Humano)"…).
 * Nos compêndios eles são poderes gerais cujo subtipo é o nome da raça. Só aparecem nas listas
 * de escolha para personagens dessa raça. Funções puras, sem Foundry.
 */
import { normalizar } from "./regras.js";

/** Subtipos que valem para mais de uma raça. */
const GRUPOS_DE_RACAS = { suraggel: ["aggelus", "sulfure"] };

/**
 * Formas de nome pelas quais um subtipo pode se referir à raça:
 * "Nagah (Fêmea)" → "nagah"; "Moreau - Herança do Lobo" → "moreau do lobo" e "moreau".
 */
function formasDaRaca(nome) {
	const n = normalizar(nome);
	const formas = new Set([n]);
	const semParenteses = n.replace(/\s*\([^)]*\)\s*$/, "").trim();
	formas.add(semParenteses);
	const heranca = /^(.+?)\s*-\s*heranca\s+(d[aeo]s?\s+.+)$/.exec(semParenteses);
	if (heranca) {
		formas.add(`${heranca[1]} ${heranca[2]}`);
		formas.add(heranca[1]);
	}
	return formas;
}

const cache = new WeakMap();

/** Índice das raças conhecidas (sistema, suplemento e construtor), calculado uma vez por carga dos dados. */
function indice(dados) {
	if (cache.has(dados)) return cache.get(dados);
	const conhecidas = new Set(Object.keys(GRUPOS_DE_RACAS));
	for (const r of dados.racas ?? []) for (const f of formasDaRaca(r.name)) conhecidas.add(f);
	const idx = { conhecidas };
	cache.set(dados, idx);
	return idx;
}

/**
 * Raça a que o poder geral pertence (forma normalizada), ou null se não for um poder racial.
 * "Qareen de Luz" → "qareen de luz" não é raça, mas "qareen" é: o poder vale para qareen.
 */
export function racaDoPoder(dados, poder) {
	if (poder?.system?.tipo !== "geral") return null;
	const s = normalizar(poder.system?.subtipo);
	if (!s) return null;
	const { conhecidas } = indice(dados);
	if (conhecidas.has(s)) return s;
	const prefixo = /^(.+?)\s+d[aeo]s?\s+/.exec(s)?.[1];
	return prefixo && conhecidas.has(prefixo) ? prefixo : null;
}

/** Formas de nome da raça do personagem (inclui a raça base de variantes e grupos como Suraggel). */
function formasDoPersonagem(dados, raca) {
	if (!raca) return new Set();
	const nome = typeof raca === "string" ? raca : raca.name;
	const doc = typeof raca === "string" ? (dados.racas ?? []).find((r) => normalizar(r.name) === normalizar(nome)) : raca;
	const formas = formasDaRaca(nome);
	if (doc?.varianteDe) for (const f of formasDaRaca(doc.varianteDe)) formas.add(f);
	for (const [grupo, membros] of Object.entries(GRUPOS_DE_RACAS)) {
		if (membros.some((m) => formas.has(m))) formas.add(grupo);
	}
	return formas;
}

/**
 * O poder pode aparecer para um personagem dessa raça? Poderes que não são raciais sempre podem.
 * @param {object|string|null} raca  documento da raça, ou o nome; sem raça, nenhum poder racial aparece
 */
export function poderRacialPermitido(dados, poder, raca) {
	const dono = racaDoPoder(dados, poder);
	if (!dono) return true;
	return formasDoPersonagem(dados, raca).has(dono);
}
