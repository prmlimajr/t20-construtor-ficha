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
	/**
	 * Como a tela de magias: em cada seção, as perícias escolhidas viram cards (clique mostra os detalhes, com
	 * o botão de remover) e cada vaga que falta é um card "Escolher perícia", que abre a lista no slideout.
	 */
	async ctxPericias() {
		const e = this.estado;
		const r = this.regrasClasse;
		if (!r) return {};
		const card = (k, extra) => this.cardPericia(k, extra);
		const todas = ordenarPericias(Object.keys(CONFIG.T20?.pericias ?? {}));

		const fixas = ordenarPericias([...new Set([...r.fixas, ...this.periciasDePoderesClasse()])]).map((k) => card(k, { fixa: true }));
		const raciais = this.periciasRaciais();
		const daRaca = ordenarPericias([...raciais]).map((k) => card(k, { fixa: true }));
		const repetidas = r.fixas.filter((k) => raciais.has(k)).map(rotuloPericia);

		/**
		 * Seção de escolha: escolhidas (cards com o campo, para remover) + vagas que abrem o slideout.
		 * @param {string[]} escolhidas  as perícias já escolhidas no campo
		 * @param {string[]} opcoes      as que ainda podem ser escolhidas (sem as escolhidas)
		 * @param {number|null} qtd      vagas (null = sem limite: sempre uma vaga a mais)
		 */
		const secao = ({ titulo, campo, escolhidas, opcoes: todasOpcoes, qtd, tituloSlideout, nota = null }) => {
			const opcoes = todasOpcoes.filter((k) => !escolhidas.includes(k));
			const vagas = qtd === null ? (opcoes.length ? 1 : 0) : Math.max(0, qtd - escolhidas.length);
			return {
				titulo, campo, nota,
				contagem: qtd === null ? `${escolhidas.length}` : `${escolhidas.length}/${qtd}`,
				escolhidas: ordenarPericias(escolhidas).map((k) => card(k, { selecionado: true, campo })),
				vagas: Array.from({ length: opcoes.length ? vagas : 0 }, () => ({})),
				semOpcoes: vagas > 0 && !opcoes.length,
				lista: `pericias:${opcoes.join("|")}`,
				limite: qtd === null ? "" : qtd,
				tituloSlideout
			};
		};
		const secoes = [];

		// classe de suplemento sem as perícias registradas: o jogador indica as que a classe treina
		if (r.periciasManuais) {
			secoes.push(secao({
				titulo: "Perícias treinadas da classe", campo: "periciasFixasManuais", escolhidas: r.fixas,
				opcoes: todas.filter((k) => !raciais.has(k) && !r.fixas.includes(k)), qtd: null,
				tituloSlideout: "Perícia treinada pela classe",
				nota: "Esta classe de suplemento não tem as perícias registradas. Indique as perícias que a classe treina automaticamente, conforme o livro; as escolhas da classe vêm em seguida."
			}));
		}
		r.ou.forEach((g, i) => {
			const atual = e.periciasOu[i] || "";
			secoes.push(secao({
				titulo: "Escolha uma", campo: `periciasOu.${i}`, escolhidas: atual ? [atual] : [],
				// sem as já escolhidas em outra seção (da classe, por Inteligência)
				opcoes: ordenarPericias(expandirPericias(g)).filter((k) => k !== atual && !e.periciasClasse.includes(k) && !e.periciasInt.includes(k)), qtd: 1,
				tituloSlideout: "Escolha uma perícia"
			}));
		});
		const jaClasse = this.periciasTreinadas({ ate: "classe" });
		secoes.push(secao({
			titulo: `Perícias da classe`, campo: "periciasClasse", escolhidas: e.periciasClasse,
			// sem as já treinadas e sem as escolhidas por Inteligência (a mesma perícia não vale duas vezes)
			opcoes: ordenarPericias(expandirPericias(r.opcoes)).filter((k) => !jaClasse.has(k) && !e.periciasInt.includes(k)), qtd: r.numero,
			tituloSlideout: "Escolha uma perícia da classe"
		}));
		const jaInt = this.periciasTreinadas({ ate: "int" });
		const nInt = Math.max(0, this.atributoFinal("int"));
		const int = secao({
			titulo: "Perícias por Inteligência", campo: "periciasInt", escolhidas: e.periciasInt,
			opcoes: todas.filter((k) => !jaInt.has(k)), qtd: nInt,
			tituloSlideout: "Escolha uma perícia (qualquer uma)",
			nota: nInt ? `Inteligência ${sinal(this.atributoFinal("int"))}: ${nInt} perícia(s), qualquer uma.` : "Sua Inteligência não concede perícias adicionais."
		});
		secoes.push(int);
		const esp = this.ctxEspecialista();
		if (esp) {
			secoes.push(secao({
				titulo: "Especialista", campo: esp.campo, escolhidas: esp.escolhidas,
				opcoes: esp.treinadas.filter((k) => !esp.escolhidas.includes(k)), qtd: esp.qtd,
				tituloSlideout: "Escolha uma perícia treinada (Especialista)",
				nota: `Escolha ${esp.qtd} perícia(s) treinada(s): ao testá-las, você pode gastar 1 PM para dobrar o bônus de treinamento.`
			}));
		}

		let info = null;
		const k = this.focoPericia;
		if (k && CONFIG.T20?.pericias?.[k]) {
			const cfg = CONFIG.T20.pericias[k];
			const treinadas = this.periciasTreinadas({ ate: "origem" });
			// escolhida numa seção: o painel tem o botão de remover
			const campo = this.focoPericiaCampo;
			const valorCampo = campo ? foundry.utils.getProperty(this.estado, campo) : null;
			const removivel = campo && (Array.isArray(valorCampo) ? valorCampo.includes(k) : valorCampo === k);
			info = {
				nome: rotuloPericia(k),
				chave: k,
				atributo: NOMES_ATRIBUTOS[cfg.abl] ?? cfg.abl,
				somenteTreinado: !!cfg.trainedOnly,
				penalidade: !!cfg.armorPenalty,
				treinada: treinadas.has(k),
				campo: removivel ? campo : null,
				descricao: await this.descricaoPericia(k)
			};
		}

		return {
			fixas,
			daRaca,
			repetidas: repetidas.join(", "),
			manuais: !!r.periciasManuais,
			secoes,
			info
		};
	}

	/** Especialista (Ladino): escolhe perícias treinadas em número igual à Inteligência (mínimo 1). */
	ctxEspecialista() {
		const [x] = this.escolhasDeClasse(["especialista"]);
		if (!x) return null;
		const v = this.escolhaRacial(x.regra);
		const treinadas = ordenarPericias([...this.periciasTreinadas()]);
		return { campo: this.campoEscolha(x.regra), qtd: Math.min(this.qtdEspecialista, treinadas.length), escolhidas: v, treinadas };
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	/** Mostra os detalhes da perícia (com data-campo: escolhida numa seção, o painel permite remover). */
	static focarPericia(event, target) {
		this.focoPericia = target.dataset.valor;
		this.focoPericiaCampo = target.dataset.campo ?? "";
		this.render();
	}

	/** Botão "Remover perícia" do painel. */
	static removerPericia(event, target) {
		const { campo, valor } = target.dataset;
		const atual = foundry.utils.getProperty(this.estado, campo);
		this.focoPericiaCampo = "";
		if (Array.isArray(atual)) return this.definirCampo(campo, atual.filter((x) => x !== valor));
		return this.definirCampo(campo, "");
	}
}
