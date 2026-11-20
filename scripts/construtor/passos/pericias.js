/**
 * Passo "Perícias" do construtor.
 */
import { NOMES_ATRIBUTOS, expandirPericias, sinal } from "../../regras.js";
import { rotuloPericia, ordenarPericias } from "../comum.js";

export const passo = {
	id: "pericias",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return [{ id: "pericias", titulo: "Perícias", dica: "Escolha suas perícias treinadas." }];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		const r = this.regrasClasse;
		if (!r) return "Escolha uma classe primeiro.";
		if (r.periciasManuais && !r.fixas.length) return "Indique as perícias treinadas da classe (consulte o livro).";
		if (r.ou.some((_, i) => !e.periciasOu[i])) return "Escolha as perícias obrigatórias da classe.";
		if (e.periciasClasse.length !== r.numero) {
			return `Escolha ${r.numero} perícias da classe (${e.periciasClasse.length} escolhidas).`;
		}
		const nInt = Math.max(0, this.atributoFinal("int"));
		if (e.periciasInt.length !== nInt) {
			return `Escolha ${nInt} perícias por Inteligência (${e.periciasInt.length} escolhidas).`;
		}
		return this.pendenciaEscolhas(this.escolhasDeClasse(["especialista"]));
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxPericias();
	}
};

/** Tela deste passo: os métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações. */
export class Tela {
	async ctxPericias() {
		const e = this.estado;
		const r = this.regrasClasse;
		if (!r) return {};
		const card = (k, extra) => this.cardPericia(k, extra);

		const fixas = ordenarPericias([...new Set([...r.fixas, ...this.periciasDePoderesClasse()])]).map((k) => card(k, { fixa: true }));
		const raciais = this.periciasRaciais();
		const daRaca = ordenarPericias([...raciais]).map((k) => card(k, { fixa: true }));
		const repetidas = r.fixas.filter((k) => raciais.has(k)).map(rotuloPericia);
		const grupos = r.ou.map((g, i) => ({
			campo: `periciasOu.${i}`,
			cards: ordenarPericias(expandirPericias(g)).map((k) => card(k, { selecionado: e.periciasOu[i] === k }))
		}));

		const jaClasse = this.periciasTreinadas({ ate: "classe" });
		const opcoesClasse = ordenarPericias(expandirPericias(r.opcoes)).map((k) => card(k, {
			selecionado: e.periciasClasse.includes(k),
			bloqueado: jaClasse.has(k) && !e.periciasClasse.includes(k)
		}));

		const jaInt = this.periciasTreinadas({ ate: "int" });
		const nInt = Math.max(0, this.atributoFinal("int"));
		const opcoesInt = ordenarPericias(Object.keys(CONFIG.T20?.pericias ?? {})).map((k) => card(k, {
			selecionado: e.periciasInt.includes(k),
			bloqueado: jaInt.has(k) && !e.periciasInt.includes(k)
		}));

		let info = null;
		const k = this.focoPericia;
		if (k && CONFIG.T20?.pericias?.[k]) {
			const cfg = CONFIG.T20.pericias[k];
			const treinadas = this.periciasTreinadas({ ate: "origem" });
			info = {
				nome: rotuloPericia(k),
				atributo: NOMES_ATRIBUTOS[cfg.abl] ?? cfg.abl,
				somenteTreinado: !!cfg.trainedOnly,
				penalidade: !!cfg.armorPenalty,
				treinada: treinadas.has(k),
				descricao: await this.descricaoPericia(k)
			};
		}

		return {
			fixas,
			daRaca,
			repetidas: repetidas.join(", "),
			especialista: this.ctxEspecialista(),
			manuais: r.periciasManuais ? {
				cards: ordenarPericias(Object.keys(CONFIG.T20?.pericias ?? {})).map((k) => card(k, {
					selecionado: r.fixas.includes(k),
					bloqueado: raciais.has(k) && !r.fixas.includes(k)
				})),
				qtd: r.fixas.length
			} : null,
			grupos,
			opcoesClasse,
			numeroClasse: r.numero,
			escolhidasClasse: e.periciasClasse.length,
			nInt,
			escolhidasInt: e.periciasInt.length,
			opcoesInt,
			intTotal: sinal(this.atributoFinal("int")),
			info
		};
	}

	/** Especialista (Ladino): escolhe perícias treinadas em número igual à Inteligência (mínimo 1). */
	ctxEspecialista() {
		const [x] = this.escolhasDeClasse(["especialista"]);
		if (!x) return null;
		const v = this.escolhaRacial(x.regra);
		const treinadas = ordenarPericias([...this.periciasTreinadas()]);
		const qtd = Math.min(this.qtdEspecialista, treinadas.length);
		return {
			campo: this.campoEscolha(x.regra),
			qtd,
			contagem: `${v.length}/${qtd}`,
			cards: treinadas.map((k) => ({ chave: k, nome: rotuloPericia(k), selecionado: v.includes(k) }))
		};
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	static focarPericia(event, target) {
		this.focoPericia = target.dataset.valor;
		this.render();
	}

	/** Seleciona/desmarca uma perícia e mostra os detalhes dela. */
	static escolherPericia(event, target) {
		const { campo, valor, modo } = target.dataset;
		this.focoPericia = valor;
		if (modo === "unica") {
			const atual = foundry.utils.getProperty(this.estado, campo);
			return this.definirCampo(campo, atual === valor ? "" : valor);
		}
		return this.constructor.alternar.call(this, event, target);
	}
}
