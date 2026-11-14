/**
 * Grava o plano montado pelo construtor na ficha do ator, de uma só vez.
 */
import { MODULE_ID, ATRIBUTOS } from "./regras.js";
import { equipamento } from "./dados.js";

function doCompendio(doc) {
	return game.items.fromCompendium(doc);
}

/** Resolve um item pelo nome no compêndio de equipamentos; se não existir, cria um item simples. */
async function itemPorNome(dados, { nome, qtd = 1 }) {
	const entrada = equipamento(dados, nome);
	let data;
	if (entrada) {
		data = doCompendio(entrada);
	} else {
		data = { name: nome, type: "tesouro" };
	}
	if (qtd > 1) foundry.utils.setProperty(data, "system.qtd", qtd);
	return data;
}

export async function aplicarNaFicha(actor, plano, dados) {
	const { raca, classe } = plano;

	/* ---------- Atualização do ator ---------- */
	const update = {
		name: plano.nome,
		"system.detalhes.raca": raca?.name ?? "",
		"system.detalhes.origem": plano.origem,
		"system.detalhes.divindade": plano.divindade,
		// T$ inteiros em prata; a fração vira cobre (T$ 1 = 10 TC)
		"system.dinheiro.tp": Math.floor(plano.dinheiro),
		"system.dinheiro.tc": Math.round((plano.dinheiro - Math.floor(plano.dinheiro)) * 10)
	};
	for (const k of ATRIBUTOS) {
		update[`system.atributos.${k}.base`] = plano.atributos[k].base;
		update[`system.atributos.${k}.racial`] = plano.atributos[k].racial;
	}
	for (const k of plano.pericias) update[`system.pericias.${k}.treinado`] = true;
	if (plano.conjuracao) update["system.attributes.conjuracao"] = plano.conjuracao;
	if (actor.prototypeToken?.name === actor.name) update["prototypeToken.name"] = plano.nome;
	await actor.update(update);

	/* ---------- Itens ---------- */
	const itens = [];

	// Raça — a flag faz o módulo pular o diálogo de atributos e a importação automática de poderes do sistema
	const dadosRaca = doCompendio(raca);
	foundry.utils.setProperty(dadosRaca, `flags.${MODULE_ID}.construtor`, true);
	itens.push(dadosRaca);

	const dadosClasse = doCompendio(classe);
	foundry.utils.setProperty(dadosClasse, "system.niveis", 1);
	foundry.utils.setProperty(dadosClasse, "system.inicial", true);
	itens.push(dadosClasse);

	const inicioRaciais = itens.length;
	for (const p of plano.poderesRaciais) itens.push(doCompendio(p));
	const fimRaciais = itens.length;

	for (const p of plano.poderes) itens.push(doCompendio(p));
	for (const m of plano.magias) itens.push(doCompendio(m));
	for (const it of plano.itens) itens.push(await itemPorNome(dados, it));

	const criados = await actor.createEmbeddedDocuments("Item", itens);

	// Mesmo vínculo que o sistema registra ao adicionar uma raça (para remover os poderes junto)
	const racaCriada = criados[0];
	const raciais = criados.slice(inicioRaciais, fimRaciais).map((i) => i.id);
	if (racaCriada && raciais.length) {
		await racaCriada.update({ "flags.tormenta20.grantedItems": raciais });
	}

	await actor.unsetFlag(MODULE_ID, "rascunho");
	await actor.setFlag(MODULE_ID, "concluido", true);
}
