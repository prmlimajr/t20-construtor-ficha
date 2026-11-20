/**
 * Passo "Idade" do construtor.
 */
import { poder } from "../../dados.js";
import { ATRIBUTOS, NOMES_ATRIBUTOS, sinal } from "../../regras.js";

export const passo = {
	id: "idade",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return m.usarIdades ? [{ id: "idade", titulo: "Idade", dica: "Escolha a faixa etária do seu personagem." }] : [];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		const f = this.faixaIdade;
		if (!f) return null;
		const n = this.complicacoesIdadeExigidas();
		const tem = e.idade?.complicacoes?.length ?? 0;
		if (tem !== n) return n ? `Escolha ${n === 1 ? "1 complicação" : `${n} complicações`} de idade (${tem} escolhida${tem === 1 ? "" : "s"}).` : "Desmarque as complicações de idade.";
		return null;
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxIdade();
	}
};

/** Tela deste passo: os métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações. */
export class Tela {
	/** Idades Variadas: lista de faixas etárias e painel com a faixa em foco (escolha, poderes e complicações). */
	async ctxIdade() {
		const e = this.estado;
		const atual = this.faixaIdade;
		const faixasDef = this.dados.idades.faixas;
		if (!faixasDef.some((f) => f.id === this.focoIdade)) this.focoIdade = atual?.id ?? "";
		const faixas = faixasDef.map((f) => ({
			id: f.id, nome: f.nome, resumo: f.resumo,
			idades: this.rotuloIdades(f.id),
			selecionado: f.id === atual?.id,
			foco: f.id === this.focoIdade
		}));
		const longevidade = this.idadesDaRaca()[0]?.multiplicador ?? 1;
		const f = faixasDef.find((x) => x.id === this.focoIdade);
		let info = null;
		if (f) {
			const escolhida = f.id === atual?.id;
			const poderes = await Promise.all((f.poderes ?? []).map((n) => this.infoPoder(poder(this.dados, n))));
			const atributos = ATRIBUTOS.filter((k) => f.atributos?.[k]).map((k) => `${NOMES_ATRIBUTOS[k]} ${sinal(f.atributos[k])}`);
			const qtd = escolhida ? this.complicacoesIdadeExigidas() : Number(f.complicacoes ?? 0);
			const marcadas = escolhida ? e.idade?.complicacoes ?? [] : [];
			const complicacoes = await Promise.all(marcadas.map(async (nome) => {
				const p = poder(this.dados, nome);
				return { nome, img: p?.img, descricao: p ? await this.html(p.uuid, p.system.description?.value) : "" };
			}));
			info = {
				id: f.id, nome: f.nome, escolhida,
				idades: this.rotuloIdades(f.id),
				descricao: f.descricao,
				atributos: atributos.join(", "),
				poderes: poderes.filter(Boolean),
				niveisExtras: f.niveisExtras ?? 0,
				anos: e.idade?.anos ?? "",
				semOrigem: f.beneficiosOrigem === 0,
				umBeneficio: f.beneficiosOrigem === 1,
				menosPericia: escolhida && this.menosPericiaPorIdade,
				trocaZera: !escolhida && ((e.idade?.complicacoes?.length ?? 0) > 0 || !!e.idade?.poderGeral),
				qtdComplicacoes: qtd,
				qtdEscolhidas: marcadas.length,
				completas: marcadas.length >= qtd,
				complicacoes,
				poderGeral: escolhida && f.poderGeralOpcional ? {
					campo: "idade.poderGeral",
					lista: "poderGeralIdade",
					titulo: "Já Vi Coisas — poder geral (traz uma complicação de idade)",
					escolhido: e.idade?.poderGeral ?? ""
				} : null,
				poderGeralOpcional: !!f.poderGeralOpcional,
				poderGeralInfo: escolhida && f.poderGeralOpcional && e.idade?.poderGeral ? await this.infoPoder(poder(this.dados, e.idade.poderGeral)) : null
			};
		}
		return {
			faixas,
			raca: this.raca?.name ?? "",
			longevidade: longevidade !== 1 ? (longevidade > 1 ? `Raça longeva: idades ×${longevidade} a partir de adulto.` : `Raça de vida curta: idades ×${String(longevidade).replace(".", ",")}.`) : "",
			escolhidaNome: atual?.nome ?? "",
			info
		};
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	/** Complicações: escolhe a complicação em foco, ou desiste dela se já for a escolhida. */
	/** Idades Variadas: clicar numa faixa só mostra os detalhes; a escolha é pelo botão do painel. */
	static focarIdade(event, target) {
		this.focoIdade = target.dataset.valor;
		this.render();
	}

	static escolherIdade(event, target) {
		const id = target.dataset.valor;
		this.focoIdade = id;
		if (this.estado.idade?.faixa === id) return this.render();
		this.definirCampo("idade.faixa", id);
	}
}
