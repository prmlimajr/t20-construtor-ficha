/**
 * Grava o plano montado pelo construtor na ficha do ator, de uma só vez.
 */
import { MODULE_ID, ATRIBUTOS } from "./regras.js";
import { equipamento } from "./dados.js";

export function doCompendio(doc) {
	// poder que o suplemento não traz, definido pelo construtor (dados.js → PODERES_DO_CONSTRUTOR)
	if (doc?.substituto) {
		const system = foundry.utils.deepClone(doc.system);
		// raça variante do construtor: as habilidades já vão como itens próprios; os "grants" apontariam
		// para poderes que não existem em compêndio nenhum
		if (doc.type === "race") system.grants = [];
		return { name: doc.name, type: doc.type, img: doc.img, system, effects: foundry.utils.deepClone(doc.effects ?? []) };
	}
	return game.items.fromCompendium(doc);
}

/** Resolve um item pelo nome no compêndio de equipamentos; se não existir, cria um item simples. */
async function itemPorNome(dados, { nome, qtd = 1, rotulo = null }) {
	const entrada = equipamento(dados, nome);
	let data;
	if (entrada) {
		data = doCompendio(entrada);
	} else {
		data = { name: nome, type: "tesouro" };
	}
	if (qtd > 1) foundry.utils.setProperty(data, "system.qtd", qtd);
	// nome específico da origem para um item do compêndio (ex.: "Manto camuflado (deserto)")
	if (rotulo) data.name = rotulo;
	return data;
}

function mudanca(key, value, type = "add") {
	return { key, value, type, phase: "initial", priority: null };
}

/** Efeito novo, no mesmo formato dos efeitos dos poderes do sistema. */
function novoEfeito(data, changes) {
	return {
		name: data.name, img: data.img, type: "base", transfer: true, disabled: false,
		system: { changes, onuse: false }
	};
}

/**
 * Aplica no poder racial a escolha feita no construtor:
 * imunidade (Fonte Elemental), redução de dano (Resistência Elemental), +2 em perícias
 * (Deformidade) e nomes das magias que recebem o redutor de –1 PM (Magia das Fadas etc.).
 */
function ajustarPoderRacial(data, ajuste) {
	data.effects ??= [];
	if (ajuste.imunidade) {
		data.effects.push(novoEfeito(data, [mudanca(`system.tracos.resistencias.${ajuste.imunidade}.imunidade`, true, "override")]));
	}
	if (ajuste.resistencia) {
		const chave = `system.tracos.resistencias.${ajuste.resistencia}.bonus`;
		const ef = data.effects.find((e) => e.system?.changes?.some((c) => c.key.includes("resistencias.???")));
		if (ef) {
			ef.system.changes = ef.system.changes.map((c) => (c.key.includes("resistencias.???") ? mudanca(chave, ajuste.valor) : c));
		} else {
			data.effects.push(novoEfeito(data, [mudanca(chave, ajuste.valor)]));
		}
	}
	if (ajuste.bonusPericias) {
		const changes = ajuste.bonusPericias.map((k) => mudanca(`system.pericias.${k}.bonus`, ajuste.bonus));
		// o efeito do sistema é genérico ("+2 em um teste de perícia", ao usar); vira bônus fixo
		data.effects = data.effects.filter((e) => !(e.system?.onuse && e.system?.abilityUse?.types?.includes("skill")));
		data.effects.push(novoEfeito(data, changes));
	}
	if (ajuste.nomesPericias?.length) {
		// Especialista: os efeitos "ao usar" passam a valer só para as perícias escolhidas
		for (const ef of data.effects) {
			if (ef.system?.onuse && ef.system.abilityUse?.types?.includes("skill")) ef.system.abilityUse.names = [...ajuste.nomesPericias];
		}
	}
	if (ajuste.anotacao) {
		// registra a escolha no topo da descrição do poder
		const desc = foundry.utils.getProperty(data, "system.description.value") ?? "";
		const nota = `<p><strong>Escolha (construtor):</strong> ${foundry.utils.escapeHTML?.(ajuste.anotacao) ?? ajuste.anotacao}</p>`;
		foundry.utils.setProperty(data, "system.description.value", nota + desc);
	}
	if (ajuste.tamanho) {
		// Tamanho Menor (Idades Variadas): sobrepõe o tamanho da raça (prioridade maior que a dos poderes raciais)
		data.effects.push(novoEfeito(data, [{ ...mudanca("system.tracos.tamanho", ajuste.tamanho, "override"), priority: 100 }]));
	}
	if (ajuste.nomesMagias?.length) {
		for (const ef of data.effects) {
			if (ef.system?.onuse && ef.system.abilityUse?.types?.includes("spell")) ef.system.abilityUse.names = [...ajuste.nomesMagias];
		}
	}
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
	// escolas de magia escolhidas (Bardo, Druida), usadas na subida de nível
	if (plano.escolasMagia?.length) update[`flags.${MODULE_ID}.escolasMagia`] = plano.escolasMagia;
	// Idades Variadas: níveis extras da faixa etária (o assistente de subir de nível mostra quantos faltam)
	if (plano.niveisExtras > 0) update[`flags.${MODULE_ID}.niveisExtras`] = plano.niveisExtras;
	// Idades Variadas: faixa etária (e níveis extras a subir) nas notas da ficha
	if (plano.idade) {
		const notas = String(actor.system?.detalhes?.info ?? "").trim();
		update["system.detalhes.info"] = notas ? `${notas} · ${plano.idade}` : plano.idade;
	}
	if (actor.prototypeToken?.name === actor.name) update["prototypeToken.name"] = plano.nome;
	if (plano.img) update.img = plano.img;
	if (plano.tokenImg) update["prototypeToken.texture.src"] = plano.tokenImg;
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

	// Poderes em grupos (raciais, origem, concedidos, classe): prefixo no nome e "sort" crescente,
	// que é a ordem usada pela lista de poderes da ficha do sistema.
	// Índices dos itens concedidos pela raça (poderes, poderes escolhidos e magias raciais)
	const daRaca = [];
	plano.gruposPoderes.forEach((grupo, g) => {
		grupo.poderes.forEach((p, i) => {
			const data = doCompendio(p);
			data.name = `${grupo.prefixo} - ${p.name}`;
			data.sort = (g + 1) * 100000 + i * 100;
			const ajuste = plano.ajustesRaciais?.[p.uuid];
			if (ajuste) ajustarPoderRacial(data, ajuste);
			if (grupo.raciais) daRaca.push(itens.length);
			itens.push(data);
		});
	});
	for (const m of plano.magias) {
		const data = doCompendio(m);
		// as magias do compêndio vêm com um atributo fixo (Int nas arcanas, Sab nas divinas): vale o da classe
		if (plano.conjuracao && data.system?.resistencia) data.system.resistencia.atributo = plano.conjuracao;
		itens.push(data);
	}
	for (const { doc } of plano.magiasPoderesClasse ?? []) itens.push(doCompendio(doc));
	for (const { doc, atributo } of plano.magiasRaciais ?? []) {
		const data = doCompendio(doc);
		// atributo-chave da habilidade racial (usado na CD da magia)
		if (atributo) foundry.utils.setProperty(data, "system.resistencia.atributo", atributo);
		daRaca.push(itens.length);
		itens.push(data);
	}
	// Itens superiores (Protótipo): a melhoria é aplicada pelo sistema ao atualizar system.upgrades
	const superiores = [];
	for (const it of plano.itens) {
		const data = await itemPorNome(dados, it);
		if (it.melhoria) {
			data.name = `${data.name} (${it.melhoriaNome})`;
			superiores.push({ indice: itens.length, uuid: it.melhoria });
		}
		itens.push(data);
	}

	const criados = await actor.createEmbeddedDocuments("Item", itens);

	// Mesmo vínculo que o sistema registra ao adicionar uma raça (para remover os poderes junto)
	const racaCriada = criados[0];
	const raciais = daRaca.map((i) => criados[i]?.id).filter(Boolean);
	if (racaCriada && raciais.length) {
		await racaCriada.update({ "flags.tormenta20.grantedItems": raciais });
	}

	for (const { indice, uuid } of superiores) {
		await criados[indice]?.update({ "system.upgrades.improvement": [uuid] });
	}

	// PV e PM atuais = máximos, que o sistema calcula com raça, classe, atributos e poderes já na ficha.
	// reset() recarrega os dados do zero antes de recalcular. NÃO usar prepareData(): ele aplica os
	// efeitos de novo por cima dos já aplicados, e bônus que se acumulam em lista (ex.: +3 PM do
	// Coração Heroico em pm.bonus.total) entram em dobro na leitura.
	actor.reset?.();
	const pv = actor.system?.attributes?.pv?.max;
	const pm = actor.system?.attributes?.pm?.max;
	const recursos = {};
	if (Number.isFinite(pv)) recursos["system.attributes.pv.value"] = pv;
	if (Number.isFinite(pm)) recursos["system.attributes.pm.value"] = pm;
	if (Object.keys(recursos).length) await actor.update(recursos);

	await actor.unsetFlag(MODULE_ID, "rascunho");
	await actor.setFlag(MODULE_ID, "concluido", true);
}
