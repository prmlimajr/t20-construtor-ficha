/**
 * Passo "Revisão" do construtor.
 */
import { ATRIBUTOS, NOMES_ATRIBUTOS, sinal } from "../../regras.js";
import { rotuloPericia } from "../comum.js";

export const passo = {
	id: "revisao",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return [{ id: "revisao", titulo: "Revisão", dica: "Confira tudo antes de criar a ficha." }];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		if (!e.nome?.trim()) return "Dê um nome ao personagem.";
		for (const p of this.passos()) {
			if (p.id === "revisao") continue;
			const pend = this.pendencia(p);
			if (pend) return `${p.titulo}: ${pend}`;
		}
		return this.pendenciaPreRequisitos();
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxRevisao();
	}
};

/** Métodos da tela deste passo; entram na janela (ConstrutorFicha), this = janela. */
export class Tela {
	ctxRevisao() {
		const plano = this.plano();
		const imagens = this.imagens;
		return {
			nome: this.estado.nome,
			imagens,
			tokenIgual: this.estado.tokenIgual,
			plano,
			racaNome: plano.raca?.name ?? "—",
			dinheiroTexto: (plano.gasto || plano.valorVendas)
				? [
					`${this.constructor.formatarTibares(plano.dinheiroRolado)} rolados`,
					plano.valorVendas ? ` + ${this.constructor.formatarTibares(plano.valorVendas)} em vendas` : "",
					plano.gasto ? ` − ${this.constructor.formatarTibares(plano.gasto)} em compras` : "",
					` = ${this.constructor.formatarTibares(plano.dinheiro)}`
				].join("")
				: this.constructor.formatarTibares(plano.dinheiro),
			listaVendidos: plano.vendidos.map((x) => (x.qtd > 1 ? `${x.nome} (×${x.qtd})` : x.nome)).join(", "),
			classeNome: plano.classe?.name ?? "—",
			listaPericias: plano.pericias.map(rotuloPericia).join(", "),
			gruposPoderes: plano.gruposPoderes.filter((g) => g.poderes.length).map((g) => ({
				nome: g.nome,
				lista: g.poderes.map((p) => `${g.prefixo} - ${p.name}`).join(", ")
			})),
			listaMagias: [
				...plano.magias.map((m) => m.name),
				...plano.magiasPoderesClasse.map((m) => m.doc.name),
				...plano.magiasRaciais.map((m) => `${m.doc.name} (raça)`)
			].join(", "),
			escolhasRaciais: plano.escolhasRaciais.join(" · "),
			escolhasClasse: plano.escolhasClasse.join(" · "),
			listaItens: plano.itens.map((x) => {
				const nome = x.melhoriaNome ? `${x.nome} (${x.melhoriaNome})` : x.nome;
				return x.qtd > 1 ? `${nome} (×${x.qtd})` : nome;
			}).join(", "),
			atributos: ATRIBUTOS.map((k) => ({ nome: NOMES_ATRIBUTOS[k], valor: sinal(this.atributoFinal(k)) }))
		};
	}
}
