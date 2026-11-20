/**
 * Passo "Raça" do construtor.
 */
import { fonteDe } from "../../dados.js";
import { ATRIBUTOS, NOMES_ATRIBUTOS, sinal } from "../../regras.js";
import { atributosDinamicosRaca } from "../../suplementos.js";

export const passo = {
	id: "raca",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return [{ id: "raca", titulo: "Raça", dica: "Escolha a raça do seu personagem." }];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		const r = this.raca;
		if (!r) return "Escolha uma raça.";
		if (this.racasAbertas) {
			const mods = this.modificadoresRaca(r);
			const feitos = mods.filter((_, i) => e.racaAbertos?.[i]).length;
			if (feitos < mods.length) return `Distribua os modificadores da raça (${feitos}/${mods.length}).`;
			return this.pendenciaEscolhas(this.escolhasRaciais());
		}
		const din = atributosDinamicosRaca(r);
		if (din.lista.length && e.racaAtributos.length !== Math.min(din.qtd, din.lista.length)) {
			return `Escolha ${Math.min(din.qtd, din.lista.length)} atributos para receber +1.`;
		}
		return this.pendenciaEscolhas(this.escolhasRaciais());
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxRaca();
	}
};

/** Tela deste passo: os métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações. */
export class Tela {
	textoAtributosRaca(r) {
		if (this.racasAbertas) {
			const mods = this.modificadoresRaca(r);
			return mods.length ? `Modificadores livres: ${mods.map(sinal).join(", ")}` : "—";
		}
		const partes = ATRIBUTOS.filter((k) => r.system.atributos?.[k])
			.map((k) => `${NOMES_ATRIBUTOS[k]} ${sinal(r.system.atributos[k])}`);
		const din = atributosDinamicosRaca(r);
		if (din.lista.length) {
			const excluidos = ATRIBUTOS.filter((k) => !din.lista.includes(k)).map((k) => NOMES_ATRIBUTOS[k]);
			const qtd = { 1: "um", 2: "dois", 3: "três", 4: "quatro" }[din.qtd] ?? din.qtd;
			partes.unshift(`+1 em ${qtd} atributos${excluidos.length ? ` (exceto ${excluidos.join(", ")})` : ""}`);
		}
		return partes.join(", ") || "—";
	}

	async ctxRaca() {
		const e = this.estado;
		const racas = this.dados.racas.map((r) => ({
			uuid: r.uuid, nome: r.name, img: r.img,
			resumo: this.textoAtributosRaca(r),
			fonte: fonteDe(this.dados, r),
			selecionado: r.uuid === e.raca
		}));
		// agrupadas por livro: o básico primeiro, depois Heróis de Arton, Ameaças de Arton e os demais
		const ORDEM = ["", "Heróis de Arton", "Ameaças de Arton"];
		const porLivro = new Map();
		for (const card of racas) (porLivro.get(card.fonte) ?? porLivro.set(card.fonte, []).get(card.fonte)).push(card);
		const grupos = [...porLivro.entries()]
			.sort(([a], [b]) => {
				const ia = ORDEM.indexOf(a), ib = ORDEM.indexOf(b);
				if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
				return a.localeCompare(b, "pt-BR");
			})
			.map(([fonte, lista]) => ({ titulo: fonte || "Tormenta20 — Jogo do Ano", racas: lista }));

		let info = null;
		const r = this.raca;
		if (r) {
			const poderes = [];
			for (const { poder: p, regra, daRaca } of this.poderesDaRaca()) {
				// escolha da própria raça (sem habilidade associada): só o título e os controles
				const info = daRaca ? { nome: regra.titulo, escolhaDaRaca: true } : await this.infoPoder(p);
				if (regra?.tipo) {
					info.escolha = this.ctxEscolhaRacial(p, regra);
					info.aberto = !!info.escolha.pendente;
				}
				if (regra?.magiasFixas) {
					info.magiasFixas = regra.atributo
						? `${regra.magiasFixas.join(", ")} (atributo-chave ${NOMES_ATRIBUTOS[regra.atributo]})`
						: regra.magiasFixas.join(", ");
				}
				poderes.push(info);
			}
			const din = atributosDinamicosRaca(r);
			info = {
				nome: r.name, img: r.img, fonte: fonteDe(this.dados, r),
				doSuplemento: !!this.dados.fonteSuplemento?.has(r.uuid),
				atributos: this.textoAtributosRaca(r),
				descricao: await this.html(r.uuid, r.system.description?.value),
				poderes,
				abertos: this.racasAbertas ? this.ctxRacaAberta(r) : null,
				dinamicos: din.lista.length && !this.racasAbertas
					? din.lista.map((k) => ({
						chave: k, nome: NOMES_ATRIBUTOS[k],
						selecionado: e.racaAtributos.includes(k)
					}))
					: null,
				qtdDinamicos: Math.min(din.qtd, din.lista.length),
				dinamicosDeduzidos: din.deduzido,
				semOrigem: this.racaSemOrigem
			};
		}
		return { racas, grupos, variosGrupos: grupos.length > 1, filtro: this.filtros?.raca ?? "", info };
	}

	/** Raças abertas: uma linha por modificador, com os seis atributos para escolher. */
	ctxRacaAberta(r) {
		const usados = this.estado.racaAbertos ?? [];
		const mods = this.modificadoresRaca(r);
		return {
			linhas: mods.map((v, i) => ({
				indice: i,
				valor: sinal(v),
				negativo: v < 0,
				atributos: ATRIBUTOS.map((k) => ({
					chave: k, nome: NOMES_ATRIBUTOS[k],
					selecionado: usados[i] === k,
					// um modificador por atributo: os já usados por outra linha ficam bloqueados
					bloqueado: usados.some((x, j) => j !== i && x === k)
				}))
			})),
			feitos: mods.filter((_, i) => usados[i]).length,
			total: mods.length
		};
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	/** Raças abertas: põe o modificador `indice` no atributo clicado (clicar de novo tira). */
	static atribuirAberto(event, target) {
		const i = Number(target.dataset.indice);
		const k = target.dataset.valor;
		const lista = [...(this.estado.racaAbertos ?? [])];
		lista[i] = lista[i] === k ? "" : k;
		this.definirCampo("racaAbertos", lista);
	}
}
