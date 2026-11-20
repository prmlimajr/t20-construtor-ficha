/**
 * Passo "Equipamento" do construtor.
 */
import { tipoMelhoria } from "../tela.js";

export const passo = {
	id: "equipamento",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return [{ id: "equipamento", titulo: "Equipamento", dica: "Escolha seu equipamento inicial." }];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		if (!e.equip.arma) return "Escolha sua arma simples.";
		if (this.temProficiencia("marcial") && !e.equip.armaMarcial) return "Escolha sua arma marcial.";
		return this.pendenciaEscolhas(this.escolhasDeClasse(["item", "prototipo"]));
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxEquipamento();
	}
};

/** Tela deste passo: os métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações. */
export class Tela {
	async ctxEquipamento() {
		const e = this.estado;
		const r = this.regrasClasse ?? {};
		const prof = this.proficiencias;
		const foco = this.focoEquip;
		const card = (nome, extra = {}) => {
			const f = this.fichaEquip(nome);
			return { nome: f.nome, img: f.img, sub: f.sub, foco: nome === foco, ...extra };
		};

		// Arma
		// Uma arma simples; quem tem proficiência com armas marciais escolhe também uma marcial
		const vendidosNomes = this.nomesVendidos();
		const cardEscolha = (nome, campo, atual) => {
			const vendido = atual === nome && vendidosNomes.has(nome);
			return card(nome, { campo, valor: nome, selecionado: atual === nome, vendido, ...(vendido ? { sub: "Vendida" } : {}) });
		};
		const armas = [{ titulo: "Arma simples", campo: "equip.arma", cat: "simples" }];
		if (prof.includes("marcial")) armas.push({ titulo: "Arma marcial", campo: "equip.armaMarcial", cat: "marcial" });
		for (const g of armas) {
			const atual = foundry.utils.getProperty(e, g.campo);
			g.cards = this.dados.armas.filter((a) => a.system.proficiencia === g.cat).map((a) => cardEscolha(a.name, g.campo, atual));
		}

		// Armadura
		const arm = this.dados.equipamento.armaduras ?? {};
		const armaduras = [
			{ nome: "Nenhuma", img: "icons/svg/cancel.svg", sub: "", campo: "equip.armadura", valor: "", selecionado: !e.equip.armadura },
			...[...(arm.leve ?? []), ...(prof.includes("pesada") ? arm.pesada ?? [] : [])]
				.map((n) => cardEscolha(n, "equip.armadura", e.equip.armadura))
		];

		// Itens que já recebe
		const recebidos = [];
		// itens vendidos saem da lista (uma ocorrência por venda)
		const aRemover = this.nomesVendidos({ lista: true });
		const grupo = (titulo, todos) => {
			const itens = todos.filter((x) => {
				const i = aRemover.indexOf(x.nome);
				if (i < 0) return true;
				aRemover.splice(i, 1);
				return false;
			});
			if (itens.length) recebidos.push({ titulo, cards: itens.map((x) => card(x.nome, { qtd: x.qtd > 1 ? x.qtd : null })) });
		};
		grupo("Todo aventureiro", (this.dados.equipamento.kitBase ?? []).map((n) => ({ nome: n, qtd: 1 })));
		grupo(`Classe (${this.classe?.name ?? ""})`, [
			...(r.equipamentoExtra ?? []).map((n) => ({ nome: n, qtd: 1 })),
			...(prof.includes("escudo") && this.dados.equipamento.escudo ? [{ nome: this.dados.equipamento.escudo, qtd: 1 }] : [])
		]);
		for (const o of this.origensAtivas()) grupo(`Origem (${o.def.nome})`, this.itensDaOrigem(o.def, o.estado));

		// Painel de detalhes
		let info = null;
		if (foco) {
			const f = this.fichaEquip(foco);
			info = {
				nome: f.nome, img: f.img,
				stats: f.stats.map(([rotulo, valor]) => ({ rotulo, valor })),
				descricao: f.doc ? await this.html(f.doc.uuid, f.doc.system?.description?.value) : ""
			};
		}
		const venda = this.ctxVenda();
		venda.bloqueado = !!this.pendencia({ id: "equipamento" });
		return { armas, armaduras, recebidos, info, itensClasse: this.ctxItensClasse(), venda, filtro: this.filtros?.equipamento ?? "" };
	}

	/**
	 * Nomes dos itens vendidos. `lista: true` devolve um nome por venda, sem os das escolhas
	 * (arma, armadura), que ficam marcadas como vendidas na própria seção.
	 */
	nomesVendidos({ lista = false } = {}) {
		const iniciais = this.plano({ semVendas: true }).itens;
		const nomes = this.vendas(iniciais).indices.map((i) => iniciais[i].nome);
		if (!lista) return new Set(nomes);
		const out = [...nomes];
		for (const n of Object.values(this.estado.equip ?? {})) {
			const i = typeof n === "string" && n ? out.indexOf(n) : -1;
			if (i >= 0) out.splice(i, 1);
		}
		return out;
	}

	/** Venda de itens iniciais: botão para o slideout e lista do que já foi vendido. */
	ctxVenda() {
		const iniciais = this.plano({ semVendas: true }).itens;
		const vendas = this.vendas(iniciais);
		const vendidos = vendas.indices.map((i) => {
			const it = iniciais[i];
			return { nome: it.nome, rotulo: it.qtd > 1 ? `${it.nome} ×${it.qtd}` : it.nome, valor: this.constructor.formatarTibares(this.precoVenda(it)) };
		});
		const temItens = iniciais.some((it) => this.precoVenda(it) > 0);
		return {
			vendidos, total: this.constructor.formatarTibares(vendas.total), temVendas: vendidos.length > 0, podeVender: temItens,
			listaVendidos: vendidos.map((v) => v.rotulo).join(", ")
		};
	}

	/** Espólio (Nobre) e Protótipo (Inventor). */
	ctxItensClasse() {
		const out = [];
		const fmt = this.constructor.formatarTibares;
		for (const { poder: p, regra } of this.escolhasDeClasse(["item", "prototipo"])) {
			const campo = this.campoEscolha(regra);
			const v = this.escolhaRacial(regra);
			if (regra.tipo === "item") {
				out.push({
					titulo: regra.titulo, ehItem: true,
					texto: `Um item à sua escolha com preço de até ${fmt(regra.precoMax)}.`,
					abrir: { campo, lista: `lojaAte:${regra.precoMax}`, titulo: `${p.name} — até ${fmt(regra.precoMax)}`, escolhido: v }
				});
				continue;
			}
			const baseMax = regra.precoMax - regra.precoMelhoria;
			const itemDoc = v.item ? this.itemLoja(v.item)?.doc : null;
			const mel = this.dados.melhorias.find((x) => x.uuid === v.melhoria);
			const { qtd, preco } = this.totaisAlquimicos(v);
			const alquimicos = this.dados.loja
				.filter(({ doc }) => doc.type === "consumivel" && doc.system.tipo === "alchemy" && Number(doc.system.preco) <= regra.precoMax)
				.map(({ doc }) => {
					const n = v.alquimicos[doc.name] ?? 0;
					const pr = Number(doc.system.preco);
					return {
						nome: doc.name, img: doc.img, preco: fmt(pr), qtd: n,
						podeMais: qtd < regra.maxAlquimicos && preco + pr <= regra.precoMax,
						podeMenos: n > 0
					};
				});
			out.push({
				titulo: regra.titulo, ehPrototipo: true,
				campoModo: `${campo}.modo`,
				// sem alquímicos (Presente dos Deuses): só o item superior, sem escolher o modo
				modos: regra.semAlquimicos ? [] : [
					{ valor: "superior", nome: "Item superior", selecionado: v.modo === "superior" },
					{ valor: "alquimicos", nome: `Até ${regra.maxAlquimicos} itens alquímicos`, selecionado: v.modo === "alquimicos" }
				],
				superior: v.modo === "superior" ? {
					texto: `${regra.apenasArmas ? "Arma" : "Item"} de até ${fmt(baseMax)} com uma melhoria (+${fmt(regra.precoMelhoria)}), total até ${fmt(regra.precoMax)}.`,
					item: { campo: `${campo}.item`, lista: `itemSuperior:${baseMax}${regra.apenasArmas ? ":arma" : ""}`, titulo: `${p.name} — ${regra.apenasArmas ? "arma" : "item base"}`, escolhido: v.item },
					melhoria: itemDoc ? {
						campo: `${campo}.melhoria`, lista: `melhoria:${tipoMelhoria(itemDoc)}`,
						titulo: `${p.name} — melhoria (${v.item})`, escolhido: mel?.name ?? ""
					} : null
				} : null,
				alquimicos: v.modo === "alquimicos" ? {
					total: `${qtd}/${regra.maxAlquimicos} itens · ${fmt(preco)} de ${fmt(regra.precoMax)}`,
					itens: alquimicos
				} : null
			});
		}
		return out;
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	static focarEquip(event, target) {
		this.focoEquip = target.dataset.nome;
		this.render();
	}

	/** Escolhe um equipamento e mostra os detalhes dele no painel. */
	static escolherEquip(event, target) {
		const { campo, nome } = target.dataset;
		let valor = target.dataset.valor;
		if (target.dataset.tipo === "bool") valor = valor === "true";
		if (nome && nome !== "Nenhuma") this.focoEquip = nome;
		this.definirCampo(campo, valor);
	}
}
