/**
 * Auxiliares usados pela janela do construtor (wizard.js) e pelas telas dos passos.
 */
/** Categoria de melhoria (system.upgrade.itemType) de um item do compêndio de equipamentos. */
export function tipoMelhoria(doc) {
	if (doc?.type === "arma") return "weapon";
	if (doc?.type !== "equipamento") return null;
	return { leve: "armor", pesada: "armor", escudo: "shield", esoterico: "esoteric", ferramenta: "tool", traje: "clothing" }[doc.system?.tipo] ?? null;
}

export function rotuloEscola(k) {
	return game.i18n.localize(CONFIG.T20?.spellSchools?.[k] ?? k);
}

/**
 * Remove @Embed/@UUID que apontam para compêndios não instalados. Ex.: as descrições de raça do
 * sistema incorporam páginas de "tormenta20-dev-env", compêndio que não é distribuído.
 */
export function limparReferenciasIndisponiveis(html) {
	return String(html ?? "")
		.replace(/@(embed|uuid)\[([^\]]+)\](\{[^}]*\})?/gi, (trecho, tipo, uuid, rotulo) => {
			const m = /^Compendium\.([^.]+)\.([^.]+)\./.exec(uuid);
			if (!m || game.packs.get(`${m[1]}.${m[2]}`)) return trecho;
			// link quebrado vira só o texto do rótulo; embed quebrado some
			return tipo.toLowerCase() === "uuid" && rotulo ? rotulo.slice(1, -1) : "";
		})
		.replace(/<p[^>]*>\s*<\/p>/gi, "")
		.trim();
}

export async function enriquecer(html) {
	const limpo = limparReferenciasIndisponiveis(html);
	if (!limpo) return "";
	return foundry.applications.ux.TextEditor.implementation.enrichHTML(limpo, { async: true });
}

/** Listas de slideout com poderes gerais (pré-requisito conferido; ver #ctxSlideout). */
export const LISTAS_PODERES_GERAIS = new Set(["grupo", "poderGeral", "poderes", "poderGeralOrigem", "poderGeralComplicacao", "poderGeralIdade"]);
