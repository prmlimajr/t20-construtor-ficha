/**
 * Categoria de um poder nas listas de escolha (Combate, Destino, Magia, Tormenta…), pelo subtipo.
 * Usada pelo construtor e pelo assistente de subir de nível, para listar os poderes agrupados.
 * Funções puras, sem Foundry.
 */
import { normalizar } from "./regras.js";

/** Categorias dos poderes gerais do livro básico, nessa ordem; as demais vêm depois, em ordem alfabética. */
const PRINCIPAIS = ["Combate", "Destino", "Magia", "Tormenta"];
const OUTROS = "Outros";
/** Grafias diferentes da mesma categoria nos dados do suplemento. */
const APELIDOS = { parceiro: "Parceiros" };

/** "combate" → "Combate"; subtipos do suplemento vêm com maiúsculas e minúsculas misturadas. */
function comInicialMaiuscula(texto) {
	const t = String(texto ?? "").trim();
	return t ? t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1) : "";
}

/** Categoria de um poder: o subtipo (com a grafia das principais), "Origem" para poderes de origem, ou "Outros". */
export function categoriaPoder(poder) {
	if (poder?.system?.tipo === "origem") return "Origem";
	const sub = String(poder?.system?.subtipo ?? "").trim();
	if (!sub) return OUTROS;
	return PRINCIPAIS.find((c) => normalizar(c) === normalizar(sub)) ?? APELIDOS[normalizar(sub)] ?? comInicialMaiuscula(sub);
}

/** Ordem das categorias: as principais primeiro, depois as demais em ordem alfabética, "Outros" por último. */
export function compararCategorias(a, b) {
	const ia = PRINCIPAIS.indexOf(a);
	const ib = PRINCIPAIS.indexOf(b);
	if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
	if (a === OUTROS || b === OUTROS) return a === OUTROS ? 1 : -1;
	return a.localeCompare(b, "pt-BR");
}

/**
 * Agrupa itens por categoria: [{titulo, itens}] na ordem das categorias.
 * @param {object[]} itens
 * @param {(item: object) => string} categoria
 */
export function agruparPorCategoria(itens, categoria) {
	const grupos = new Map();
	for (const item of itens) {
		const c = categoria(item) || OUTROS;
		if (!grupos.has(c)) grupos.set(c, []);
		grupos.get(c).push(item);
	}
	return [...grupos.entries()].sort(([a], [b]) => compararCategorias(a, b)).map(([titulo, lista]) => ({ titulo, itens: lista }));
}
