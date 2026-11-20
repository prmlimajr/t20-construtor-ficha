/**
 * Loja (compras no passo Dinheiro) e venda do equipamento inicial: contexto do slideout de venda e as ações.
 */
/** Métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações (this = janela). */
export class Tela {
	/** Slideout de venda: marcar vários itens iniciais, ver o total e confirmar de uma vez. */
	async ctxSlideoutVenda() {
		const so = this.slideout;
		const fmt = this.constructor.formatarTibares;
		const iniciais = this.plano({ semVendas: true }).itens;
		const sel = this.vendaRascunho ?? new Set();
		const cards = [];
		iniciais.forEach((it, i) => {
			const pv = this.precoVenda(it);
			if (!pv) return;
			const f = this.fichaEquip(it.nome);
			cards.push({
				indice: i, img: f.img,
				nome: it.qtd > 1 ? `${f.nome} ×${it.qtd}` : f.nome,
				sub: [`Vende por ${fmt(pv)}`, f.sub].filter(Boolean).join(" · "),
				selecionado: sel.has(i),
				foco: so.foco === i
			});
		});
		const total = Math.round([...sel].reduce((t, i) => t + (iniciais[i] ? this.precoVenda(iniciais[i]) : 0), 0) * 100) / 100;
		let info = null;
		const it = iniciais[so.foco];
		if (it && this.precoVenda(it)) {
			const f = this.fichaEquip(it.nome);
			info = {
				indice: so.foco, nome: f.nome, img: f.img,
				selecionado: sel.has(so.foco),
				stats: [
					{ rotulo: "Venda", valor: `${fmt(this.precoVenda(it))} (metade do preço)` },
					...f.stats.map(([rotulo, valor]) => ({ rotulo, valor }))
				],
				descricao: f.doc ? await this.html(f.doc.uuid, f.doc.system?.description?.value) : ""
			};
		}
		const atual = this.vendas(iniciais);
		const animar = so.animar;
		so.animar = false;
		const rolado = this.estado.dinheiro !== null;
		return {
			venda: true, titulo: so.titulo, cards, info, animar, filtro: so.filtro, longa: cards.length > 8,
			qtdSelecionados: sel.size,
			total: fmt(total),
			todos: sel.size === cards.length,
			mudou: !(sel.size === atual.indices.length && atual.indices.every((i) => sel.has(i))),
			// com o dinheiro já rolado, mostra como fica a carteira
			carteira: rolado ? fmt(this.saldo - atual.total + total) : null
		};
	}

	static lojaTipo(event, target) {
		this.lojaTipo = target.dataset.valor;
		this.lojaCategoria = "";
		this.render();
	}

	static lojaCategoria(event, target) {
		this.lojaCategoria = target.dataset.valor;
		this.render();
	}

	static focarLoja(event, target) {
		this.focoLoja = target.dataset.nome;
		this.render();
	}

	/** Compra (+1) ou devolve (−1) um item da loja, respeitando o saldo. */
	static comprar(event, target) {
		const nome = target.dataset.nome;
		const delta = Number(target.dataset.delta);
		const it = this.itemLoja(nome);
		if (!it) return;
		const compras = { ...(this.estado.compras ?? {}) };
		const atual = compras[nome] ?? 0;
		if (delta > 0 && Number(it.doc.system.preco) > this.saldo) {
			return ui.notifications.warn(`Tibares insuficientes para comprar ${nome}.`);
		}
		const novo = Math.max(0, atual + delta);
		if (novo) compras[nome] = novo;
		else delete compras[nome];
		this.focoLoja = nome;
		this.estado.compras = compras;
		this.mudou();
	}

	/** Abre o slideout de venda com os itens já vendidos marcados. */
	static abrirVenda() {
		const pend = this.pendencia({ id: "equipamento" });
		if (pend) return ui.notifications.warn(`Antes de vender: ${pend}`);
		const iniciais = this.plano({ semVendas: true }).itens;
		this.vendaRascunho = new Set(this.vendas(iniciais).indices);
		this.slideout = { tipo: "venda", titulo: "Vender itens", foco: null, animar: true, filtro: "" };
		this.render();
	}

	/** Marca/desmarca um item para vender (e mostra os detalhes dele). */
	static alternarVenda(event, target) {
		if (this.slideout?.tipo !== "venda") return;
		const i = Number(target.dataset.indice);
		this.vendaRascunho ??= new Set();
		if (this.vendaRascunho.has(i)) this.vendaRascunho.delete(i);
		else this.vendaRascunho.add(i);
		this.slideout.foco = i;
		this.render();
	}

	/** Marca todos os itens vendáveis, ou desmarca todos se já estavam marcados. */
	static marcarTodosVenda() {
		if (this.slideout?.tipo !== "venda") return;
		const iniciais = this.plano({ semVendas: true }).itens;
		const todos = iniciais.map((it, i) => (this.precoVenda(it) > 0 ? i : null)).filter((i) => i !== null);
		const marcados = this.vendaRascunho ?? new Set();
		this.vendaRascunho = todos.every((i) => marcados.has(i)) ? new Set() : new Set(todos);
		this.render();
	}

	/** Confirma a venda: os itens marcados saem do inventário e metade do preço vai para a carteira. */
	static confirmarVenda() {
		if (this.slideout?.tipo !== "venda") return;
		const iniciais = this.plano({ semVendas: true }).itens;
		const nomes = [...(this.vendaRascunho ?? [])].sort((a, b) => a - b).map((i) => iniciais[i]?.nome).filter(Boolean);
		this.slideout = null;
		this.vendaRascunho = null;
		this.definirCampo("vendas", nomes);
	}

	/** Protótipo: +1/−1 num item alquímico, respeitando 10 itens e T$ 500. */
	static ajustarAlquimico(event, target) {
		const [x] = this.escolhasDeClasse(["prototipo"]);
		if (!x) return;
		const { nome } = target.dataset;
		const delta = Number(target.dataset.delta);
		const v = this.escolhaRacial(x.regra);
		const alq = { ...v.alquimicos };
		const novo = Math.max(0, (alq[nome] ?? 0) + delta);
		if (novo) alq[nome] = novo;
		else delete alq[nome];
		const { qtd, preco } = this.totaisAlquimicos({ alquimicos: alq });
		if (delta > 0 && (qtd > x.regra.maxAlquimicos || preco > x.regra.precoMax)) {
			return ui.notifications.warn(`O protótipo permite até ${x.regra.maxAlquimicos} itens e T$ ${x.regra.precoMax}.`);
		}
		this.focoEquip = nome;
		this.definirCampo(`${this.campoEscolha(x.regra)}.alquimicos`, alq);
	}
}
