/**
 * Grava um nível na ficha (e desfaz o último), mantendo um histórico em
 * flags.t20-construtor-ficha.niveis para o "Desfazer último nível".
 */
import { MODULE_ID, normalizar } from "./regras.js";
import { doCompendio, ajustarPoderRacial } from "./aplicar.js";
import { nomeBase } from "./ficha-atual.js";

/** Os poderes de classe da criação usam sort 600000+ (grupo "1"); cada nível vem depois do anterior. */
const SORT_CLASSE = 600000;
const CAMPO_DESCRICAO = "system.description.value";

const escapar = (t) => foundry.utils.escapeHTML?.(t) ?? t;

/** Descrição com uma linha "Escolha (Nº nível): …" no topo. */
function comAnotacao(desc, texto, nivel) {
	return `<p><strong>Escolha (${nivel}º nível):</strong> ${escapar(texto.trim())}</p>${desc ?? ""}`;
}

/** Descrição com a linha "Valor atual" trocada (ou acrescentada no topo). */
function comValor(desc, valor, nivel) {
	const linha = `<p class="t20cf-valor"><strong>Valor atual (${nivel}º nível):</strong> ${escapar(String(valor))}</p>`;
	const re = /<p class="t20cf-valor">.*?<\/p>/s;
	return re.test(desc ?? "") ? desc.replace(re, linha) : linha + (desc ?? "");
}

/** Rolagens com a fórmula da primeira parte trocada (ex.: Ataque Furtivo 1d6 → 3d6). */
function comRolagem(rolls, valor) {
	const copia = foundry.utils.deepClone(rolls ?? []);
	if (copia[0]?.parts?.[0]) copia[0].parts[0][0] = String(valor).replace(/^\+/, "");
	return copia;
}

/**
 * Corrige trechos das fórmulas dos efeitos (erros de dados do suplemento, ex.: Casca Grossa do atleta
 * usando @nvl.lutador). Vale para os dois formatos de efeito (changes no topo, da v13, e system.changes).
 */
function corrigirFormulas(data, trocas) {
	for (const ef of data.effects ?? []) {
		for (const lista of [ef.changes, ef.system?.changes]) {
			for (const c of lista ?? []) {
				if (typeof c.value !== "string") continue;
				for (const [de, para] of Object.entries(trocas)) c.value = c.value.split(de).join(para);
			}
		}
	}
}

/** Item da ficha com o poder, pelo nome (sem prefixo; com ou sem o complemento entre parênteses). */
function poderNaFicha(actor, nome) {
	const alvo = normalizar(nome);
	const semComplemento = (t) => t.replace(/\s*\([^)]*\)\s*$/, "").trim();
	const poderes = actor.items.filter((i) => i.type === "poder");
	return poderes.find((i) => normalizar(nomeBase(i.name)) === alvo)
		?? poderes.find((i) => semComplemento(normalizar(nomeBase(i.name))) === semComplemento(alvo))
		?? null;
}

/**
 * Dados de origem do item (objetos simples). No Foundry, item.system.rolls é uma lista de RollData
 * (modelos de dados): deepClone não os copia e alterar a cópia mexeria no item preparado em memória.
 */
function fonte(item, caminho) {
	return foundry.utils.getProperty(item.toObject?.() ?? item, caminho);
}

/**
 * Os efeitos "ao usar" que somam a rolagem do poder (valor "roll", ex.: Ataque Furtivo) buscam a fórmula
 * no item de `origin`; nos itens vindos do compêndio, ela aponta para fora da ficha (fórmula original).
 * Aponta para o próprio item, para valer a rolagem atualizada. Em itens que já estavam na ficha, registra
 * o valor anterior em `alteracoes` (para o desfazer).
 */
async function origemNoProprioItem(item, alteracoes = null) {
	if (!item?.effects || !item.uuid) return;
	const efeitos = [...item.effects].filter((e) => e.origin !== item.uuid
		&& (e.system?.changes ?? e.changes ?? []).some((c) => c.value === "roll"));
	if (!efeitos.length) return;
	for (const e of efeitos) alteracoes?.push({ id: item.id, efeito: e.id, caminho: "origin", antes: e.origin ?? null });
	await item.updateEmbeddedDocuments("ActiveEffect", efeitos.map((e) => ({ _id: e.id, origin: item.uuid })));
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
 * @param {object} plano {
 *   classeId, nivelPersonagem, nivelClasse,
 *   habilidades: [{doc, valor?, modo?}],   habilidades novas (com o valor da tabela, se houver)
 *   escolhidas: [doc],                     opções escolhidas (Caminho do Cavaleiro…)
 *   anotadas: [{doc, texto}],              escolhas anotadas (terreno do Explorador…); atualiza o item se já existe
 *   valores: [{nome, para, modo}],         valores da tabela em habilidades que a ficha já tem
 *   poder: doc|null, anotacao,             poder escolhido e a anotação dele
 *   magias: [doc],                         magias novas
 *   escolasMagia: [chave]|null,            escolas de magia escolhidas agora (ficha sem as escolas gravadas)
 *   ajustes: {uuid: ajuste} }              escolhas internas dos poderes novos (deus da Linhagem Abençoada…)
 */
export async function aplicarNivel(actor, plano) {
	const classeExistente = plano.classeNova ? null : actor.items.get(plano.classeId);
	if (!plano.classeNova && !classeExistente) throw new Error("classe não encontrada na ficha");
	if (actor.nivel + 1 !== plano.nivelPersonagem) throw new Error("a ficha mudou desde que a janela foi aberta");

	const pvAntes = actor.system.attributes?.pv?.max ?? 0;
	const pmAntes = actor.system.attributes?.pm?.max ?? 0;

	const n = plano.nivelPersonagem;
	const itens = [];
	const adicionar = (doc, { anotacao = "", valor = null, modo = null, corrigir = null } = {}) => {
		const data = doCompendio(doc);
		if (corrigir) corrigirFormulas(data, corrigir);
		// escolha interna do poder (como no construtor): efeitos ajustados e a escolha anotada na descrição
		const ajuste = plano.ajustes?.[doc.uuid];
		if (ajuste) {
			const { anotacao: escolha, ...efeitos } = ajuste;
			ajustarPoderRacial(data, efeitos);
			if (escolha) anotacao = anotacao?.trim() ? `${escolha}; ${anotacao}` : escolha;
		}
		data.name = `${n} - ${doc.name}`;
		data.sort = SORT_CLASSE + n * 1000 + itens.length * 10;
		if (anotacao?.trim()) foundry.utils.setProperty(data, CAMPO_DESCRICAO, comAnotacao(foundry.utils.getProperty(data, CAMPO_DESCRICAO), anotacao, n));
		if (valor && modo === "rolagem") {
			data.system.rolls = comRolagem(data.system.rolls, valor);
			comRolagemAtualizada.add(itens.length);
		}
		if (valor && modo === "anotacao") foundry.utils.setProperty(data, CAMPO_DESCRICAO, comValor(foundry.utils.getProperty(data, CAMPO_DESCRICAO), valor, n));
		foundry.utils.setProperty(data, `flags.${MODULE_ID}.nivel`, n);
		itens.push(data);
	};

	// alterações em itens que já estão na ficha: guardam o valor anterior para o desfazer
	const alteracoes = [];
	const atualizacoes = new Map();
	const alterar = (item, caminho, valor) => {
		if (!atualizacoes.has(item.id)) atualizacoes.set(item.id, { _id: item.id });
		const atual = atualizacoes.get(item.id);
		if (!alteracoes.some((a) => a.id === item.id && a.caminho === caminho)) {
			alteracoes.push({ id: item.id, caminho, antes: foundry.utils.deepClone(fonte(item, caminho) ?? null) });
		}
		atual[caminho] = valor;
	};
	const valorAtual = (item, caminho) => atualizacoes.get(item.id)?.[caminho] ?? fonte(item, caminho);
	const comRolagemAtualizada = new Set(); // ids (existentes) e índices (novos) de itens com a rolagem trocada

	for (const h of plano.habilidades ?? []) adicionar(h.doc, { valor: h.valor, modo: h.modo, corrigir: h.corrigir });
	for (const doc of plano.escolhidas ?? []) adicionar(doc);
	for (const a of plano.anotadas ?? []) {
		const item = poderNaFicha(actor, a.doc.name);
		if (item) alterar(item, CAMPO_DESCRICAO, comAnotacao(valorAtual(item, CAMPO_DESCRICAO), a.texto, n));
		else adicionar(a.doc, { anotacao: a.texto });
	}
	for (const v of plano.valores ?? []) {
		if (!v.modo) continue;
		const item = poderNaFicha(actor, v.nome);
		if (!item) continue;
		if (v.modo === "rolagem") {
			alterar(item, "system.rolls", comRolagem(valorAtual(item, "system.rolls"), v.para));
			comRolagemAtualizada.add(item.id);
		}
		else if (v.modo === "anotacao") alterar(item, CAMPO_DESCRICAO, comValor(valorAtual(item, CAMPO_DESCRICAO), v.para, n));
	}
	if (plano.poder) adicionar(plano.poder, { anotacao: plano.anotacao });
	for (const doc of plano.magias ?? []) {
		const data = doCompendio(doc);
		// prefixo do nível, como os poderes ("5 - Bola de Fogo")
		data.name = `${n} - ${doc.name}`;
		// as magias do compêndio vêm com um atributo fixo (Int nas arcanas, Sab nas divinas): vale o da classe
		if (plano.atributoMagia && data.system?.resistencia) data.system.resistencia.atributo = plano.atributoMagia;
		foundry.utils.setProperty(data, `flags.${MODULE_ID}.nivel`, n);
		itens.push(data);
	}

	// a classe primeiro: o sistema atualiza o nível do personagem ao mudar system.niveis; a classe nova
	// (multiclasse) entra com 1 nível e sem ser a inicial (PV de nível seguinte)
	let classe = classeExistente;
	if (plano.classeNova) {
		const data = doCompendio(plano.classeNova);
		foundry.utils.setProperty(data, "system.niveis", 1);
		foundry.utils.setProperty(data, "system.inicial", false);
		foundry.utils.setProperty(data, `flags.${MODULE_ID}.nivel`, n);
		[classe] = await actor.createEmbeddedDocuments("Item", [data]);
	} else {
		await classe.update({ "system.niveis": plano.nivelClasse });
	}
	const criados = itens.length ? await actor.createEmbeddedDocuments("Item", itens) : [];
	if (atualizacoes.size) await actor.updateEmbeddedDocuments("Item", [...atualizacoes.values()]);
	for (const chave of comRolagemAtualizada) {
		// itens novos são apagados no desfazer: não precisam do registro
		if (typeof chave === "number") await origemNoProprioItem(criados[chave]);
		else await origemNoProprioItem(actor.items.get(chave), alteracoes);
	}

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
		alteracoes,
		...(plano.classeNova ? { classeNova: true } : {}),
		...(plano.escolasMagia ? { escolasDefinidas: plano.classe ?? true } : {}),
		pv,
		pm,
		data: Date.now()
	});
	update[`flags.${MODULE_ID}.niveis`] = lista;
	update[`flags.${MODULE_ID}.ultimoDesfeito`] = false;
	// escolas por classe (multiclasse com dois conjuradores de escolas); a da classe inicial também no campo antigo
	if (plano.escolasMagia) {
		update[`flags.${MODULE_ID}.escolasMagiaPorClasse.${plano.classe}`] = [...plano.escolasMagia];
		if (classe.system?.inicial) update[`flags.${MODULE_ID}.escolasMagia`] = [...plano.escolasMagia];
	}
	// criar uma classe não atualiza o nível do personagem no sistema (só mudar system.niveis)
	update["system.attributes.nivel.value"] = actor.nivel;
	await actor.update(update);
	return { pv, pm, itens: criados };
}

/** Desfaz o último nível aplicado pelo construtor: remove os itens criados, restaura os alterados e volta a classe um nível. */
export async function desfazerUltimoNivel(actor) {
	if (!podeDesfazer(actor)) throw new Error("não há nível para desfazer");
	const lista = historico(actor);
	const ultimo = lista.pop();

	// 1º nível de uma classe (multiclasse): a classe sai junto
	const existentes = [...ultimo.itens, ...(ultimo.classeNova ? [ultimo.classeId] : [])].filter((id) => actor.items.has(id));
	if (existentes.length) await actor.deleteEmbeddedDocuments("Item", existentes);
	const restaurar = new Map();
	const efeitos = new Map(); // item → [{_id, campo: valor}] (alterações em efeitos do item)
	for (const a of ultimo.alteracoes ?? []) {
		if (!actor.items.has(a.id)) continue;
		if (a.efeito) {
			if (!efeitos.has(a.id)) efeitos.set(a.id, []);
			efeitos.get(a.id).push({ _id: a.efeito, [a.caminho]: a.antes });
			continue;
		}
		if (!restaurar.has(a.id)) restaurar.set(a.id, { _id: a.id });
		restaurar.get(a.id)[a.caminho] = a.antes;
	}
	if (restaurar.size) await actor.updateEmbeddedDocuments("Item", [...restaurar.values()]);
	for (const [id, lista] of efeitos) await actor.items.get(id)?.updateEmbeddedDocuments("ActiveEffect", lista);
	const classe = ultimo.classeNova ? null : actor.items.get(ultimo.classeId);
	if (classe) await classe.update({ "system.niveis": Math.max(1, ultimo.nivelClasse - 1) });

	const attrs = actor.system.attributes ?? {};
	// escolas escolhidas no nível desfeito voltam a ficar em aberto
	if (ultimo.escolasDefinidas) {
		const porClasse = typeof ultimo.escolasDefinidas === "string" ? { [`flags.${MODULE_ID}.escolasMagiaPorClasse.-=${ultimo.escolasDefinidas}`]: null } : {};
		const inicial = !ultimo.classeNova && actor.items.get(ultimo.classeId)?.system?.inicial;
		await actor.update({ ...porClasse, ...(inicial || typeof ultimo.escolasDefinidas !== "string" ? { [`flags.${MODULE_ID}.-=escolasMagia`]: null } : {}) });
	}
	await actor.update({
		"system.attributes.nivel.value": actor.nivel,
		"system.attributes.pv.value": (attrs.pv?.value ?? 0) - (ultimo.pv ?? 0),
		"system.attributes.pm.value": Math.max(0, (attrs.pm?.value ?? 0) - (ultimo.pm ?? 0)),
		[`flags.${MODULE_ID}.niveis`]: lista,
		[`flags.${MODULE_ID}.ultimoDesfeito`]: true
	});
	return ultimo;
}
