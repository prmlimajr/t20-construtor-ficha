/**
 * Passo "Dinheiro (rolagem e loja)" do construtor.
 */
export const passo = {
	id: "dinheiro",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return [{ id: "dinheiro", titulo: "Dinheiro", dica: "Role 4d6 para definir seus tibares iniciais." }];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		if (e.dinheiro === null) return "Role seus tibares iniciais.";
		if (this.saldo < 0) return "Saldo negativo: devolva algumas compras.";
		return null;
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxDinheiro();
	}
};

/** Tela deste passo: os métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações. */
export class Tela {
	async ctxDinheiro() {
		const e = this.estado;
		const fmt = this.constructor.formatarTibares;
		const extras = this.origensAtivas().filter((o) => o.def.tibares).map((o) => `${o.def.tibares} (${o.def.nome})`);
		const ctx = { dinheiro: e.dinheiro, rolado: e.dinheiro !== null, extras: extras.join(" + ") };
		if (!ctx.rolado) return ctx;
		const saldo = this.saldo;
		// tipo (Armas e munições, Armaduras e escudos, Itens gerais) → categoria; só os que têm itens
		const presentes = new Set(this.dados.loja.map((x) => x.categoria));
		const tipos = this.dados.estruturaLoja
			.map((t) => ({ ...t, categorias: t.categorias.filter((c) => presentes.has(c)) }))
			.filter((t) => t.categorias.length);
		let tipo = tipos.find((t) => t.tipo === this.lojaTipo) ?? tipos[0];
		this.lojaTipo = tipo?.tipo;
		if (!tipo?.categorias.includes(this.lojaCategoria)) this.lojaCategoria = tipo?.categorias[0];
		const cards = this.dados.loja.filter((x) => x.categoria === this.lojaCategoria).map(({ doc }) => {
			const f = this.fichaEquip(doc.name);
			const preco = Number(doc.system.preco);
			const n = e.compras[doc.name] ?? 0;
			return {
				nome: doc.name, img: doc.img,
				preco: fmt(preco),
				sub: [fmt(preco), f.sub].filter(Boolean).join(" · "),
				qtd: n,
				caro: preco > saldo && !n,
				foco: doc.name === this.focoLoja,
				busca: `${doc.name} ${f.sub}`
			};
		});
		const carrinho = Object.entries(e.compras).filter(([, n]) => n > 0).map(([nome, n]) => {
			const it = this.itemLoja(nome);
			const preco = Number(it?.doc.system.preco ?? 0);
			return { nome, qtd: n, multiplo: n > 1, total: fmt(preco * n) };
		});
		let info = null;
		const foco = this.itemLoja(this.focoLoja);
		if (foco) {
			const f = this.fichaEquip(foco.doc.name);
			const preco = Number(foco.doc.system.preco);
			const n = e.compras[foco.doc.name] ?? 0;
			const pacote = Number(foco.doc.system.qtd) > 1 ? Number(foco.doc.system.qtd) : null;
			info = {
				nome: f.nome, img: f.img,
				preco: fmt(preco),
				pacote,
				stats: f.stats.map(([rotulo, valor]) => ({ rotulo, valor })),
				descricao: await this.html(foco.doc.uuid, foco.doc.system?.description?.value),
				qtd: n,
				podeComprar: preco <= saldo,
				podeRemover: n > 0
			};
		}
		return {
			...ctx,
			fmtRolado: fmt(e.dinheiro),
			fmtGasto: fmt(this.gastoCompras),
			fmtVendas: this.valorVendas ? fmt(this.valorVendas) : "",
			fmtSaldo: fmt(saldo),
			tipos: tipos.map((t) => ({ nome: t.tipo, selecionado: t.tipo === this.lojaTipo })),
			categorias: (tipo?.categorias ?? []).map((c) => ({
				nome: c, selecionado: c === this.lojaCategoria,
				qtd: this.dados.loja.filter((x) => x.categoria === c).length
			})),
			cards,
			carrinho,
			info,
			filtro: this.lojaFiltro
		};
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	static async rolarDinheiro() {
		if (this.estado.dinheiro !== null) return;
		const extras = this.origensAtivas().map((o) => o.def.tibares).filter(Boolean);
		const roll = await new Roll(["4d6", ...extras].join(" + ")).evaluate();
		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			flavor: `Construtor de Personagem — tibares iniciais (T$)${extras.length ? ` (4d6 + ${extras.join(" + ")} da origem)` : ""}`
		});
		this.estado.dinheiro = roll.total;
		this.mudou();
	}
}
