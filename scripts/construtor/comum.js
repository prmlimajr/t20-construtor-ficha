/**
 * Funções usadas pela regra do construtor (modelo.js) e pela tela (wizard.js).
 */

/**
 * Círculo da magia como número. Magias de suplementos feitos para o Tormenta20 1.5 (ex.: Heróis de
 * Arton) guardam o círculo como texto ("1"); sem converter, elas sumiriam das listas por círculo.
 */
export function circuloMagia(m) {
	return Number(m?.system?.circulo);
}

export function rotuloPericia(k) {
	const label = CONFIG.T20?.pericias?.[k]?.label ?? k;
	return game.i18n.localize(label);
}

export function ordenarPericias(keys) {
	return [...keys].sort((a, b) => rotuloPericia(a).localeCompare(rotuloPericia(b), "pt-BR"));
}

/**
 * Agrupa cards pelo livro (campo fonte; "" = livro básico): o básico primeiro, depois Heróis de Arton e
 * os demais em ordem alfabética. Usado na escolha de classe do construtor e do subir de nível.
 * @returns {{titulo: string, itens: object[]}[]}
 */
export function agruparPorLivro(cards) {
	const ORDEM = ["", "Heróis de Arton"];
	const porLivro = new Map();
	for (const card of cards) {
		const fonte = card.fonte ?? "";
		if (!porLivro.has(fonte)) porLivro.set(fonte, []);
		porLivro.get(fonte).push(card);
	}
	return [...porLivro.entries()]
		.sort(([a], [b]) => {
			const ia = ORDEM.indexOf(a), ib = ORDEM.indexOf(b);
			if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
			return a.localeCompare(b, "pt-BR");
		})
		.map(([fonte, itens]) => ({ titulo: fonte || "Tormenta20 — Jogo do Ano", itens }));
}
