/**
 * Ficha virtual (planejador de builds): um personagem em memória, nunca salvo, onde os níveis planejados
 * são aplicados pelo mesmo código da subida de nível de verdade (aplicarNivel).
 *
 * AtorVirtual guarda os dados de origem do ator (toObject) e, a cada alteração, monta de novo um documento
 * não salvo (`new Actor.implementation(fonte)`): é o sistema que prepara PV, PM, Defesa, perícias e os
 * efeitos dos poderes, como faria com o ator real. Por fora, ele tem a parte da interface de Actor que a
 * gravação e a leitura da ficha usam (items, system, flags, nivel, getFlag, reset, update,
 * create/update/deleteEmbeddedDocuments); os itens são "alças" (ItemVirtual) com update e
 * updateEmbeddedDocuments de efeitos.
 *
 * O documento preparado (`ator.doc`) é o que vai para a prévia da ficha.
 */
import { EtapasNivel } from "./etapas-nivel.js";
import { aplicarNivel } from "./aplicar-nivel.js";

const clonar = (x) => (x === undefined ? undefined : structuredClone(x));

/**
 * Aplica alterações no formato do update do Foundry com caminhos ("system.niveis", "flags.mod.niveis")
 * num objeto de origem. "-=" no último trecho remove a chave. Objetos sem caminho são mesclados.
 */
export function aplicarAlteracoes(alvo, alteracoes) {
	for (const [caminho, valor] of Object.entries(alteracoes ?? {})) {
		if (caminho === "_id") continue;
		const partes = caminho.split(".");
		const ultimo = partes.pop();
		const pai = partes.reduce((o, p) => (o[p] ??= {}), alvo);
		if (ultimo.startsWith("-=")) delete pai[ultimo.slice(2)];
		else if (valor && typeof valor === "object" && !Array.isArray(valor) && pai[ultimo] && typeof pai[ultimo] === "object" && !Array.isArray(pai[ultimo])) {
			aplicarAlteracoes(pai[ultimo], valor);
		} else pai[ultimo] = clonar(valor);
	}
	return alvo;
}

let contador = 0;
/** Id de 16 caracteres, como os do Foundry. */
function novoId() {
	const r = foundry.utils?.randomID?.();
	if (r) return r;
	contador++;
	return `v${Date.now().toString(36)}${contador.toString(36)}`.padEnd(16, "0").slice(0, 16);
}

/** Alça de um item do ator virtual: lê do documento preparado, grava nos dados de origem. */
class ItemVirtual {
	constructor(ator, id) {
		this.ator = ator;
		this.id = id;
		this._id = id;
	}

	get doc() { return this.ator.doc.items.get(this.id); }
	get #fonte() { return this.ator.fonte.items.find((i) => i._id === this.id); }

	get name() { return this.doc?.name ?? this.#fonte?.name; }
	get type() { return this.doc?.type ?? this.#fonte?.type; }
	get img() { return this.doc?.img ?? this.#fonte?.img; }
	get system() { return this.doc?.system ?? this.#fonte?.system; }
	get flags() { return this.doc?.flags ?? this.#fonte?.flags ?? {}; }
	get effects() { return this.doc?.effects ?? (this.#fonte?.effects ?? []).map((e) => ({ ...e, id: e._id })); }
	get sort() { return this.doc?.sort ?? this.#fonte?.sort; }
	get uuid() { return this.doc?.uuid ?? `${this.ator.uuid}.Item.${this.id}`; }
	getFlag(escopo, chave) { return foundry.utils.getProperty(this.flags, `${escopo}.${chave}`); }
	toObject() { return clonar(this.#fonte); }

	async update(alteracoes) {
		aplicarAlteracoes(this.#fonte, alteracoes);
		this.ator.reset();
		return this;
	}

	/** Só efeitos ativos (é o que a gravação de nível altera nos itens). */
	async updateEmbeddedDocuments(tipo, lista) {
		if (tipo !== "ActiveEffect") throw new Error(`ficha virtual: updateEmbeddedDocuments("${tipo}") num item não é suportado`);
		const efeitos = this.#fonte.effects ?? [];
		for (const { _id, ...resto } of lista) {
			const ef = efeitos.find((e) => e._id === _id);
			if (ef) aplicarAlteracoes(ef, resto);
		}
		this.ator.reset();
		return lista;
	}
}

export class AtorVirtual {
	/**
	 * @param {object} fonte  dados de origem do ator (actor.toObject()); são copiados
	 * @param {object} [opcoes]
	 * @param {(fonte: object) => object} [opcoes.criarDocumento]  monta o documento preparado (padrão:
	 *   `new Actor.implementation(fonte)`); os testes em Node passam um simulado
	 */
	constructor(fonte, { criarDocumento = (f) => new Actor.implementation(f) } = {}) {
		this.fonte = clonar(fonte);
		this.fonte.items ??= [];
		for (const i of this.fonte.items) i._id ??= novoId();
		this.criarDocumento = criarDocumento;
		this.virtual = true;
		this.reset();
	}

	/** Cópia em memória de um ator (real ou virtual). */
	static de(actor, opcoes) {
		return new AtorVirtual(actor.toObject(), opcoes);
	}

	/** Remonta o documento preparado a partir dos dados de origem (depois de cada alteração). */
	reset() {
		this.doc = this.criarDocumento(clonar(this.fonte));
		this._itens = null;
	}

	get id() { return this.fonte._id ?? null; }
	get name() { return this.doc?.name ?? this.fonte.name; }
	get type() { return this.doc?.type ?? this.fonte.type; }
	get img() { return this.doc?.img ?? this.fonte.img; }
	get uuid() { return this.doc?.uuid ?? `Actor.${this.id}`; }
	get system() { return this.doc.system; }
	get flags() { return this.doc.flags ?? this.fonte.flags ?? {}; }
	/** Nível do personagem: a soma dos níveis das classes (como o getter do sistema). */
	get nivel() {
		return this.doc.nivel ?? this.fonte.items.filter((i) => i.type === "classe").reduce((s, c) => s + (Number(c.system?.niveis) || 0), 0);
	}

	getFlag(escopo, chave) { return foundry.utils.getProperty(this.fonte.flags ?? {}, `${escopo}.${chave}`); }

	/** Itens como lista de alças, com get/has (como a coleção do Foundry). */
	get items() {
		if (!this._itens) {
			const lista = this.fonte.items.map((i) => new ItemVirtual(this, i._id));
			this._itens = Object.assign(lista, {
				get: (id) => lista.find((i) => i.id === id),
				has: (id) => lista.some((i) => i.id === id),
				get size() { return lista.length; }
			});
		}
		return this._itens;
	}

	toObject() { return clonar(this.fonte); }

	async update(alteracoes) {
		aplicarAlteracoes(this.fonte, alteracoes);
		this.reset();
		return this;
	}

	async setFlag(escopo, chave, valor) { return this.update({ [`flags.${escopo}.${chave}`]: valor }); }
	async unsetFlag(escopo, chave) { return this.update({ [`flags.${escopo}.-=${chave}`]: null }); }

	async createEmbeddedDocuments(tipo, lista) {
		if (tipo !== "Item") throw new Error(`ficha virtual: createEmbeddedDocuments("${tipo}") não é suportado`);
		const ids = [];
		for (const data of lista) {
			const item = clonar(data);
			item._id = item._id && !this.fonte.items.some((i) => i._id === item._id) ? item._id : novoId();
			this.fonte.items.push(item);
			ids.push(item._id);
		}
		this.reset();
		return ids.map((id) => this.items.get(id));
	}

	async updateEmbeddedDocuments(tipo, lista) {
		if (tipo !== "Item") throw new Error(`ficha virtual: updateEmbeddedDocuments("${tipo}") não é suportado`);
		for (const { _id, ...resto } of lista) {
			const item = this.fonte.items.find((i) => i._id === _id);
			if (item) aplicarAlteracoes(item, resto);
		}
		this.reset();
		return lista;
	}

	async deleteEmbeddedDocuments(tipo, ids) {
		if (tipo !== "Item") throw new Error(`ficha virtual: deleteEmbeddedDocuments("${tipo}") não é suportado`);
		const fora = new Set(ids);
		this.fonte.items = this.fonte.items.filter((i) => !fora.has(i._id));
		this.reset();
		return ids;
	}
}

/**
 * Aplica um nível ao ator virtual com as escolhas dadas (no formato do estado de EtapasNivel:
 * uuids nas seleções, no poder e nas magias). A tradução de nomes para uuids (nós da build) é feita antes.
 *
 * @param {AtorVirtual} ator
 * @param {object} escolhas  { classeAlvo, escolha, anotacao, selecoes, magias, escolas }
 * @param {object} fontes    { dados, progressao, lerPreRequisito }
 * @returns {Promise<{ok: true, nivel: number, classe: string, pv: number, pm: number} | {ok: false, motivo: string}>}
 */
export async function aplicarEscolhas(ator, escolhas, fontes) {
	const etapas = new EtapasNivel(ator, fontes);
	Object.assign(etapas, {
		classeAlvo: escolhas.classeAlvo ?? null,
		escolha: escolhas.escolha ?? null,
		anotacao: escolhas.anotacao ?? "",
		selecoes: { ...(escolhas.selecoes ?? {}) },
		magias: [...(escolhas.magias ?? [])],
		escolas: [...(escolhas.escolas ?? [])]
	});
	const r = etapas.planoDoNivel();
	if (r.bloqueio) return { ok: false, motivo: r.bloqueio };
	if (r.pendencia) return { ok: false, motivo: r.pendencia };
	// classe nova: o nome pedido tem de ser o que a conta escolheu (senão a classe pedida não podia ser escolhida)
	const pedida = escolhas.classeAlvo?.startsWith("nova:") ? escolhas.classeAlvo.slice(5) : null;
	if (pedida && r.classe.nome !== pedida) return { ok: false, motivo: `${pedida} não pode ser escolhida como classe nova neste nível.` };
	if (!pedida && escolhas.classeAlvo && r.classe.id !== escolhas.classeAlvo) return { ok: false, motivo: "A classe escolhida não está mais na ficha." };
	const g = await aplicarNivel(ator, r.plano);
	return { ok: true, nivel: r.nivel.nivelPersonagem, classe: r.classe.nome, pv: g.pv, pm: g.pm };
}
