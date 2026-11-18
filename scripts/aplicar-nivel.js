/**
 * Grava um nível na ficha (e desfaz o último), mantendo um histórico em
 * flags.t20-construtor-ficha.niveis para o "Desfazer último nível".
 */
import { MODULE_ID } from "./regras.js";
import { doCompendio } from "./aplicar.js";

/** Os poderes de classe da criação usam sort 600000+ (grupo "1"); cada nível vem depois do anterior. */
const SORT_CLASSE = 600000;

function anotar(data, texto) {
	if (!texto?.trim()) return;
	const desc = foundry.utils.getProperty(data, "system.description.value") ?? "";
	const nota = `<p><strong>Escolha:</strong> ${foundry.utils.escapeHTML?.(texto.trim()) ?? texto.trim()}</p>`;
	foundry.utils.setProperty(data, "system.description.value", nota + desc);
}

export function historico(actor) {
	return foundry.utils.deepClone(actor.getFlag(MODULE_ID, "niveis") ?? []);
}

/** O último nível aplicado pelo construtor pode ser desfeito? (só o último, uma vez) */
export function podeDesfazer(actor) {
	const ultimo = historico(actor).at(-1);
	return !!ultimo && !actor.getFlag(MODULE_ID, "ultimoDesfeito") && actor.nivel === ultimo.nivel;
}

/**
 * @param {Actor} actor
 * @param {object} plano { classeId, nivelPersonagem, nivelClasse, habilidades: [doc], poder: doc|null, anotacao }
 */
export async function aplicarNivel(actor, plano) {
	const classe = actor.items.get(plano.classeId);
	if (!classe) throw new Error("classe não encontrada na ficha");
	if (actor.nivel + 1 !== plano.nivelPersonagem) throw new Error("a ficha mudou desde que a janela foi aberta");

	const pvAntes = actor.system.attributes?.pv?.max ?? 0;
	const pmAntes = actor.system.attributes?.pm?.max ?? 0;

	const n = plano.nivelPersonagem;
	const itens = [];
	const adicionar = (doc, anotacao) => {
		const data = doCompendio(doc);
		data.name = `${n} - ${doc.name}`;
		data.sort = SORT_CLASSE + n * 1000 + itens.length * 10;
		anotar(data, anotacao);
		foundry.utils.setProperty(data, `flags.${MODULE_ID}.nivel`, n);
		itens.push(data);
	};
	for (const doc of plano.habilidades) adicionar(doc);
	if (plano.poder) adicionar(plano.poder, plano.anotacao);

	// a classe primeiro: o sistema atualiza o nível do personagem ao mudar system.niveis
	await classe.update({ "system.niveis": plano.nivelClasse });
	const criados = itens.length ? await actor.createEmbeddedDocuments("Item", itens) : [];

	// PV e PM atuais sobem o mesmo que os máximos (que o sistema recalcula com a classe e os poderes novos).
	// reset() em vez de prepareData(): ver o comentário em aplicar.js.
	actor.reset?.();
	const pv = (actor.system.attributes?.pv?.max ?? 0) - pvAntes;
	const pm = (actor.system.attributes?.pm?.max ?? 0) - pmAntes;
	const update = {};
	if (pv) update["system.attributes.pv.value"] = (actor.system.attributes.pv.value ?? 0) + pv;
	if (pm) update["system.attributes.pm.value"] = (actor.system.attributes.pm.value ?? 0) + pm;

	const lista = historico(actor);
	lista.push({
		nivel: n,
		classeId: classe.id,
		classe: classe.name,
		nivelClasse: plano.nivelClasse,
		itens: criados.map((i) => i.id),
		pv,
		pm,
		data: Date.now()
	});
	update[`flags.${MODULE_ID}.niveis`] = lista;
	update[`flags.${MODULE_ID}.ultimoDesfeito`] = false;
	await actor.update(update);
	return { pv, pm, itens: criados };
}

/** Desfaz o último nível aplicado pelo construtor: remove os itens criados e volta a classe um nível. */
export async function desfazerUltimoNivel(actor) {
	if (!podeDesfazer(actor)) throw new Error("não há nível para desfazer");
	const lista = historico(actor);
	const ultimo = lista.pop();

	const existentes = ultimo.itens.filter((id) => actor.items.has(id));
	if (existentes.length) await actor.deleteEmbeddedDocuments("Item", existentes);
	const classe = actor.items.get(ultimo.classeId);
	if (classe) await classe.update({ "system.niveis": Math.max(1, ultimo.nivelClasse - 1) });

	const attrs = actor.system.attributes ?? {};
	await actor.update({
		"system.attributes.pv.value": (attrs.pv?.value ?? 0) - (ultimo.pv ?? 0),
		"system.attributes.pm.value": Math.max(0, (attrs.pm?.value ?? 0) - (ultimo.pm ?? 0)),
		[`flags.${MODULE_ID}.niveis`]: lista,
		[`flags.${MODULE_ID}.ultimoDesfeito`]: true
	});
	return ultimo;
}
