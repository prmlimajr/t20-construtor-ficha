/**
 * Painel de uma magia (ficha resumida e aprimoramentos), usado pelo construtor e pelo assistente de
 * subir de nível. Precisa do Foundry só para traduzir os rótulos (CONFIG.T20 e game.i18n).
 */

/**
 * Aprimoramento sem custo em PM: é um truque (custo vazio no compêndio, ou texto "em vez do normal"),
 * exceto as automações "Maximiza..." e as variantes de efeito (ex.: formas de Animar Objetos, "+2 em Força").
 */
export function ehTruque(custo, html) {
	const texto = String(html ?? "").replace(/<[^>]+>/g, " ").trim();
	if (/^maximiza/i.test(texto)) return false;
	return custo === null || /^muda\b/i.test(texto) || /em vez d[oae]/i.test(texto);
}

/** Ficha resumida de uma magia (custo, execução, alcance, alvo, área, efeito, duração, resistência). */
export function statsMagia(m) {
	const s = m.system;
	const T = CONFIG.T20 ?? {};
	const loc = (mapa, k) => (k && mapa?.[k] ? game.i18n.localize(mapa[k]) : "");
	const stats = [];
	const custo = s.ativacao?.custo;
	if (custo) stats.push(["Custo", `${custo} PM`]);
	const exec = loc(T.abilityActivationTypes, s.ativacao?.execucao);
	if (exec) stats.push(["Execução", exec]);
	const alcance = loc(T.distanceUnits, s.alcance);
	if (alcance && s.alcance !== "none") stats.push(["Alcance", alcance]);
	if (s.alvo) stats.push(["Alvo", s.alvo]);
	if (s.area) stats.push(["Área", s.area]);
	if (s.efeito) stats.push(["Efeito", s.efeito]);
	const u = s.duracao?.units;
	let dur = loc(T.timePeriods, u);
	if (["round", "turn", "minute", "hour", "day"].includes(u) && s.duracao?.value) dur = `${s.duracao.value} ${dur.toLowerCase()}`;
	if (s.duracao?.special) dur = dur ? `${dur} (${s.duracao.special})` : s.duracao.special;
	if (dur) stats.push(["Duração", dur]);
	if (s.resistencia?.txt) stats.push(["Resistência", s.resistencia.txt]);
	return stats.map(([rotulo, valor]) => ({ rotulo, valor }));
}

/**
 * Aprimoramentos da magia: efeitos "ao usar" com custo em PM e descrição, do mais barato ao mais caro.
 * @param {object} m                  magia
 * @param {(chave: string, html: string) => Promise<string>} html  enriquece (e guarda em cache) um HTML
 * @param {number} circuloMax         maior círculo que o personagem lança: os que pedem mais ficam marcados
 */
export async function aprimoramentosMagia(m, html, circuloMax = 1) {
	const efeitos = [...(m.effects ?? [])]
		.map((ef, ordem) => ({ ef, ordem }))
		.filter(({ ef }) => ef.system?.onuse && (ef.description || ef.system?.abilityUse?.description));
	efeitos.sort((a, b) => (a.ef.system.abilityUse?.custo ?? 0) - (b.ef.system.abilityUse?.custo ?? 0) || a.ordem - b.ordem);
	const out = [];
	for (const { ef } of efeitos) {
		const original = ef.description || ef.system.abilityUse.description;
		const custo = ef.system.abilityUse?.custo ?? null;
		const texto = await html(`${m.uuid}.${ef.id ?? ef._id}`, original);
		const circulo = /Requer (\d)º círculo/i.exec(original)?.[1] ?? null;
		out.push({
			custo: custo ? `+${custo} PM` : (ehTruque(custo, original) ? "Truque" : "Variante"),
			texto,
			circulo,
			bloqueado: !!circulo && Number(circulo) > circuloMax
		});
	}
	return out;
}
