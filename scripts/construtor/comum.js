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
