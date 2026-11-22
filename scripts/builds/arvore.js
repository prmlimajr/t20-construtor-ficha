/**
 * Árvore de builds do personagem (planejador de builds): formato da flag, operações e a tradução das
 * escolhas entre nomes (como ficam guardadas) e o estado de EtapasNivel (uuids, como a janela usa).
 *
 * Flag do ator: flags.t20-construtor-ficha.builds = {
 *   versao: 1,
 *   base: 5,                  nível da ficha na última sincronização
 *   nos: [{ id, nivel, pai, nome, criado, escolhas, divergente, naoSeguido }],
 *   caminho: [id, …]          nós escolhidos, do primeiro nível planejado em diante
 * }
 * Os nós ficam numa lista (e não num objeto por id) porque o Foundry mescla objetos ao gravar flags:
 * um nó apagado continuaria lá. Listas são substituídas inteiras.
 *
 * escolhas (por nome, para resistir a reimportar os compêndios) = {
 *   classe: "Guerreiro" | "nova:Arcanista",
 *   poder: "Esgrimista (Guerreiro)" | null,
 *   anotacao: "",
 *   selecoes: { [id]: { nome } | { texto } },   escolha entre habilidades (nome da opção) ou anotada (texto)
 *   magias: ["Seta Infalível de Talude"],
 *   escolas: ["evo"]
 * }
 */
import { MODULE_ID, normalizar } from "../regras.js";
import { magiaPorNome } from "../dados.js";

export const VERSAO_BUILDS = 1;

/* ---------- Flag ---------- */

export function arvoreVazia(base = 0) {
	return { versao: VERSAO_BUILDS, base, nos: [], caminho: [] };
}

/** A árvore do ator (cópia), sempre no formato atual. */
export function lerArvore(actor) {
	const salva = actor.getFlag?.(MODULE_ID, "builds");
	if (!salva || typeof salva !== "object") return arvoreVazia(Number(actor.nivel) || 0);
	const a = structuredClone(salva);
	return {
		versao: VERSAO_BUILDS,
		base: Number(a.base) || 0,
		nos: Array.isArray(a.nos) ? a.nos.filter((n) => n?.id) : [],
		caminho: Array.isArray(a.caminho) ? a.caminho : []
	};
}

export async function gravarArvore(actor, arvore) {
	await actor.update({ [`flags.${MODULE_ID}.builds`]: structuredClone(arvore) });
}

/* ---------- Consultas ---------- */

export const noPorId = (arvore, id) => arvore.nos.find((n) => n.id === id) ?? null;
export const filhos = (arvore, pai) => arvore.nos.filter((n) => (n.pai ?? null) === (pai ?? null));

/** O nó e todos os descendentes. */
export function descendentes(arvore, id) {
	const out = [];
	const visitar = (pai) => {
		for (const f of filhos(arvore, pai)) {
			out.push(f);
			visitar(f.id);
		}
	};
	visitar(id);
	return out;
}

/** O nó do caminho escolhido para um nível (ou null). */
export function noDoCaminho(arvore, nivel) {
	return arvore.caminho.map((id) => noPorId(arvore, id)).find((n) => n?.nivel === nivel) ?? null;
}

/* ---------- Operações ---------- */

let contador = 0;
function novoIdNo() {
	contador++;
	return `n${Date.now().toString(36)}${contador.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Nome automático do nó: o poder escolhido, ou "Arcanista 1" (classe nova), ou "Nível N". */
export function nomeAutomatico(escolhas, nivel) {
	if (escolhas?.poder) return escolhas.poder;
	if (escolhas?.classe?.startsWith("nova:")) return `${escolhas.classe.slice(5)} 1`;
	return `Nível ${nivel}`;
}

/** Duas escolhas são a mesma build? (ignora maiúsculas, acentos e a ordem das magias e escolas) */
export function mesmasEscolhas(a, b) {
	const norm = (e) => JSON.stringify({
		classe: normalizar(e?.classe ?? ""),
		poder: normalizar(e?.poder ?? ""),
		anotacao: (e?.anotacao ?? "").trim(),
		selecoes: Object.entries(e?.selecoes ?? {}).sort(([x], [y]) => x.localeCompare(y))
			.map(([k, v]) => [k, v?.nome ? normalizar(v.nome) : (v?.texto ?? "")]),
		magias: (e?.magias ?? []).map(normalizar).sort(),
		escolas: [...(e?.escolas ?? [])].sort()
	});
	return norm(a) === norm(b);
}

/**
 * Acrescenta um nó (filho de `pai`, ou raiz). Se já existe um irmão com as mesmas escolhas, devolve esse.
 * @returns {object} o nó
 */
export function adicionarNo(arvore, { nivel, pai = null, escolhas, nome = null }) {
	const igual = filhos(arvore, pai).find((n) => n.nivel === nivel && !n.naoSeguido && mesmasEscolhas(n.escolhas, escolhas));
	if (igual) return igual;
	const no = {
		id: novoIdNo(), nivel, pai, nome: nome?.trim() || nomeAutomatico(escolhas, nivel), criado: Date.now(),
		escolhas: structuredClone(escolhas), divergente: null, naoSeguido: null
	};
	arvore.nos.push(no);
	return no;
}

/**
 * Escolhe um nó: o caminho passa a ser os ancestrais dele, ele e, abaixo, os nós do caminho anterior
 * que descendem dele (os outros saem).
 */
export function escolherNo(arvore, id) {
	const no = noPorId(arvore, id);
	if (!no) return;
	const acima = [];
	for (let n = no; n; n = n.pai ? noPorId(arvore, n.pai) : null) acima.unshift(n.id);
	const abaixo = [];
	let atual = no.id;
	for (const idAnt of arvore.caminho) {
		const n = noPorId(arvore, idAnt);
		if (n?.pai === atual) {
			abaixo.push(n.id);
			atual = n.id;
		}
	}
	arvore.caminho = [...acima, ...abaixo];
}

/** Apaga o nó e os descendentes. @returns {number} quantos nós saíram */
export function apagarNo(arvore, id) {
	const fora = new Set([id, ...descendentes(arvore, id).map((n) => n.id)]);
	const antes = arvore.nos.length;
	arvore.nos = arvore.nos.filter((n) => !fora.has(n.id));
	const i = arvore.caminho.findIndex((x) => fora.has(x));
	if (i >= 0) arvore.caminho = arvore.caminho.slice(0, i);
	return antes - arvore.nos.length;
}

export function renomearNo(arvore, id, nome) {
	const no = noPorId(arvore, id);
	if (no && nome?.trim()) no.nome = nome.trim();
}

/** Resumo das escolhas para os avisos ("Ataque Reflexo", "Arcanista 1"). */
const resumoEscolhas = (e, nivel) => nomeAutomatico(e, nivel);

/**
 * O personagem subiu para `nivel` com as escolhas `aplicadas` (por nome). O nó raiz desse nível com as
 * mesmas escolhas sai da árvore e os filhos dele viram as novas raízes; os outros nós desse nível (e os
 * ramos deles) ficam como "não seguidos". Sem nó igual, todos os do nível ficam não seguidos.
 * @returns {object|null} o nó seguido (já fora da árvore), se houver
 */
export function registrarSubida(arvore, nivel, aplicadas) {
	const raizes = arvore.nos.filter((n) => !n.pai && n.nivel === nivel && !n.naoSeguido);
	const seguido = raizes.find((n) => mesmasEscolhas(n.escolhas, aplicadas)) ?? null;
	const marca = { nivel, escolhido: resumoEscolhas(aplicadas, nivel) };
	for (const r of raizes) {
		if (r === seguido) continue;
		for (const n of [r, ...descendentes(arvore, r.id)]) n.naoSeguido ??= { ...marca };
	}
	if (seguido) {
		for (const f of filhos(arvore, seguido.id)) f.pai = null;
		arvore.nos = arvore.nos.filter((n) => n !== seguido);
		arvore.caminho = arvore.caminho[0] === seguido.id ? arvore.caminho.slice(1) : [];
	} else arvore.caminho = [];
	arvore.base = nivel;
	return seguido;
}

/**
 * Acerta a árvore com o nível atual da ficha quando ele mudou sem passar por registrarSubida (ficha editada
 * à mão, nível subido fora do assistente): raízes de níveis que a ficha já passou ficam não seguidas.
 * Desfazer um nível não mexe na árvore. @returns {boolean} se mudou algo
 */
export function sincronizar(arvore, nivelFicha) {
	if (arvore.base === nivelFicha) return false;
	if (nivelFicha > arvore.base) {
		for (const r of arvore.nos.filter((n) => !n.pai && n.nivel <= nivelFicha && !n.naoSeguido)) {
			for (const n of [r, ...descendentes(arvore, r.id)]) n.naoSeguido ??= { nivel: r.nivel, escolhido: null, fora: true };
		}
		arvore.caminho = arvore.caminho.filter((id) => (noPorId(arvore, id)?.nivel ?? 0) > nivelFicha && !noPorId(arvore, id)?.naoSeguido);
	}
	arvore.base = nivelFicha;
	return true;
}

/** Texto do aviso de um nó não seguido. */
export function textoNaoSeguido(no) {
	const ns = no?.naoSeguido;
	if (!ns) return null;
	if (ns.fora) return `Este nó não foi seguido: o personagem passou do ${ns.nivel}º nível fora do planejador.`;
	return `Este nó não foi seguido: no ${ns.nivel}º nível o personagem escolheu ${ns.escolhido}.`;
}

/* ---------- Escolhas: nomes ↔ estado das etapas ---------- */

/**
 * As escolhas atuais das etapas, por nome.
 * @param {EtapasNivel} etapas
 * @param {object} calculo  etapas.calcular() (com nivel)
 */
export function paraNomes(etapas, calculo) {
	const { classe, nivel } = calculo;
	const selecoes = {};
	for (const e of nivel.escolhas ?? []) {
		const v = etapas.selecoes[e.id];
		const op = v ? e.opcoes.find((o) => o.doc.uuid === v) : null;
		if (op) selecoes[e.id] = { nome: op.nome };
	}
	// escolhas anotadas e internas dos poderes (deus da Linhagem Abençoada…): o valor em texto
	for (const a of [...(nivel.anotadas ?? []), ...(nivel.internas ?? []).filter((i) => i.tipo === "opcao")]) {
		const v = etapas.selecoes[a.id];
		if (v) selecoes[a.id] = { texto: v };
	}
	return {
		classe: classe.nova ? `nova:${classe.nome}` : classe.nome,
		poder: etapas.poderEscolhido(nivel)?.nome ?? null,
		anotacao: (etapas.anotacao ?? "").trim(),
		selecoes,
		magias: etapas.magiasEscolhidas().map((m) => m.name),
		escolas: [...(etapas.escolas ?? [])]
	};
}

/**
 * Põe as escolhas (por nome) no estado das etapas. O que não existe mais (classe, poder, opção, magia)
 * vira um problema; o resto entra assim mesmo.
 * @returns {{problemas: string[], calculo: object}}
 */
export function paraEtapas(etapas, escolhas) {
	etapas.limparEscolhas();
	const problemas = [];
	const pedida = escolhas.classe ?? "";
	if (pedida.startsWith("nova:")) etapas.classeAlvo = pedida;
	else if (pedida) {
		const { ficha } = etapas.calcular();
		const c = ficha.classes.find((x) => normalizar(x.nome) === normalizar(pedida));
		if (c) etapas.classeAlvo = c.id;
		else problemas.push(`A ficha não tem a classe ${pedida}.`);
	}
	const calculo = etapas.calcular();
	if (calculo.bloqueio) return { problemas: [...problemas, calculo.bloqueio], calculo };
	if (!calculo.nivel) return { problemas: [...problemas, calculo.erroClasse ?? `Não dá para subir em ${calculo.classe?.nome}.`], calculo };
	if (pedida.startsWith("nova:") && calculo.classe.nome !== pedida.slice(5)) {
		problemas.push(`${pedida.slice(5)} não pode ser escolhida como classe nova.`);
	}
	const { nivel } = calculo;

	for (const [id, v] of Object.entries(escolhas.selecoes ?? {})) {
		if (v?.texto !== undefined) {
			etapas.selecoes[id] = v.texto;
			continue;
		}
		const e = (nivel.escolhas ?? []).find((x) => x.id === id);
		const op = e?.opcoes.find((o) => normalizar(o.nome) === normalizar(v?.nome ?? ""));
		if (op) etapas.selecoes[id] = op.doc.uuid;
		else problemas.push(`A opção ${v?.nome} não está mais disponível${e ? ` em ${e.titulo}` : ""}.`);
	}
	if (escolhas.poder) {
		const op = [...nivel.poderesClasse, ...nivel.poderesGerais].find((o) => normalizar(o.nome) === normalizar(escolhas.poder));
		if (!op) problemas.push(`O poder ${escolhas.poder} não está nas listas deste nível.`);
		else if (!op.disponivel) problemas.push(`${escolhas.poder}: ${op.motivo}`);
		else etapas.escolha = op.doc.uuid;
	}
	etapas.anotacao = escolhas.anotacao ?? "";
	etapas.escolas = [...(escolhas.escolas ?? [])];
	for (const nome of escolhas.magias ?? []) {
		const m = magiaPorNome(etapas.dados, nome);
		if (m) etapas.magias.push(m.uuid);
		else problemas.push(`A magia ${nome} não existe mais nos compêndios.`);
	}
	return { problemas, calculo: etapas.calcular() };
}
