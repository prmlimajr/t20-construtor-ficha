/**
 * Passo "Complicações" do construtor.
 */
import { poder } from "../../dados.js";

export const passo = {
	id: "complicacoes",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return m.usarComplicacoes ? [{ id: "complicacoes", titulo: "Complicações", dica: "Uma complicação opcional: em troca, você recebe um poder geral." }] : [];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		if (this.complicacao && !e.complicacaoPoder) return "Escolha o poder geral concedido pela complicação.";
		return null;
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxComplicacoes();
	}
};

/** Tela deste passo: os métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações. */
export class Tela {
	/**
	 * Complicações: lista à esquerda (as da classe e as gerais) e painel à direita com a complicação
	 * em foco, o botão de escolher/desistir e, para a escolhida, o seletor do poder geral.
	 */
	async ctxComplicacoes() {
		const e = this.estado;
		const escolhida = this.complicacao;
		const disponiveis = this.complicacoesDisponiveis();
		// foco: a clicada por último; se nenhuma, a escolhida
		if (!disponiveis.some((c) => c.doc.uuid === this.focoComplicacao)) this.focoComplicacao = escolhida?.uuid ?? "";
		const resumo = (doc) => {
			const t = String(doc.system?.description?.value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
			return t.length > 90 ? `${t.slice(0, 90).replace(/\s+\S*$/, "")}…` : t;
		};
		const card = (c) => ({
			uuid: c.doc.uuid, nome: c.doc.name, img: c.doc.img,
			sub: resumo(c.doc),
			selecionado: escolhida?.uuid === c.doc.uuid,
			foco: this.focoComplicacao === c.doc.uuid
		});
		const classe = this.classe?.name ?? "";
		const grupos = [
			{ titulo: `Complicações de ${classe}`, cards: disponiveis.filter((c) => c.classe).map(card) },
			{ titulo: "Complicações gerais", cards: disponiveis.filter((c) => !c.classe).map(card) }
		].filter((g) => g.cards.length);

		let info = null;
		const foco = disponiveis.find((c) => c.doc.uuid === this.focoComplicacao);
		if (foco) {
			const ehEscolhida = escolhida?.uuid === foco.doc.uuid;
			info = {
				uuid: foco.doc.uuid,
				nome: foco.doc.name, img: foco.doc.img,
				tipo: foco.classe ? `Complicação de ${classe}` : "Complicação geral",
				descricao: await this.html(foco.doc.uuid, foco.doc.system?.description?.value),
				escolhida: ehEscolhida,
				outraEscolhida: escolhida && !ehEscolhida ? escolhida.name : null,
				poder: ehEscolhida ? {
					campo: "complicacaoPoder",
					lista: "poderGeralComplicacao",
					titulo: `Poder geral concedido por ${foco.doc.name}`,
					escolhido: e.complicacaoPoder ?? ""
				} : null,
				poderInfo: ehEscolhida && e.complicacaoPoder ? await this.infoPoder(poder(this.dados, e.complicacaoPoder)) : null
			};
		}
		return { grupos, info, escolhidaNome: escolhida?.name ?? "" };
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	/** Complicações: mostra a clicada no painel lateral (não escolhe). */
	static focarComplicacao(event, target) {
		this.focoComplicacao = target.dataset.valor;
		this.render();
	}

	static escolherComplicacao(event, target) {
		const uuid = target.dataset.valor;
		const atual = this.estado.complicacoes?.[0];
		this.focoComplicacao = uuid;
		this.definirCampo("complicacoes", atual === uuid ? [] : [uuid]);
	}
}
