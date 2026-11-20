/**
 * Passo "Magias" do construtor.
 */
import { circuloMagia } from "../comum.js";
import { rotuloEscola } from "../tela.js";

export const passo = {
	id: "magias",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return m.conjurador ? [{ id: "magias", titulo: "Magias", dica: "Escolha as magias que você conhece." }] : [];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		const c = this.conjurador;
		if (!c || c.todas) return null;
		if (c.escolas && e.magiasEscolas.length !== c.escolas) return `Escolha ${c.escolas} escolas de magia.`;
		if (e.magias.length !== c.quantidade) return `Escolha ${c.quantidade} magias (${e.magias.length} escolhidas).`;
		return null;
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxMagias();
	}
};

/** Tela deste passo: os métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações. */
export class Tela {
	async ctxMagias() {
		const e = this.estado;
		const c = this.conjurador;
		const tipos = this.tiposMagiaClasse();
		const daClasse = (k) => this.dados.magias.filter((m) => circuloMagia(m) === 1 && m.system.escola === k && tipos.includes(m.system.tipo));
		const cheioEscolas = e.magiasEscolas.length >= c.escolas;

		const escolas = c.escolas ? Object.keys(CONFIG.T20?.spellSchools ?? {}).map((k) => {
			const qtd = daClasse(k).length;
			return {
				chave: k,
				nome: rotuloEscola(k),
				sigla: this.dados.escolas[k]?.sigla ?? "",
				qtdMagias: qtd,
				vazia: qtd === 0,
				selecionado: e.magiasEscolas.includes(k),
				foco: k === this.focoEscola
			};
		}) : null;

		// Usurpador (Usurpar): todas as magias do tipo de 1º círculo, sem escolha
		const conhecidas = c.todas ? this.magiasDisponiveis().sort((a, b) => a.name.localeCompare(b.name, "pt-BR")) : this.dados.magias.filter((m) => e.magias.includes(m.uuid));
		const escolhidas = conhecidas.map((m) => ({
			uuid: m.uuid, nome: m.name, img: m.img,
			sub: `${rotuloEscola(m.system.escola)} · ${m.system.tipo === "uni" ? "Universal" : (m.system.tipo === "arc" ? "Arcana" : "Divina")}`,
			foco: m.uuid === this.focoMagia
		}));
		const precisaEscolas = !!c.escolas && e.magiasEscolas.length !== c.escolas;
		const vagas = Math.max(0, c.quantidade - escolhidas.length);

		// painel de detalhes: escola ou magia em foco
		let infoEscola = null;
		let infoMagia = null;
		if (this.focoEscola && escolas) {
			const k = this.focoEscola;
			const sel = e.magiasEscolas.includes(k);
			const lista = daClasse(k);
			infoEscola = {
				chave: k,
				nome: rotuloEscola(k),
				sigla: this.dados.escolas[k]?.sigla ?? "",
				descricao: this.dados.escolas[k]?.descricao ?? "",
				selecionado: sel,
				podeEscolher: sel || (!cheioEscolas && lista.length > 0),
				motivo: !sel && !lista.length ? `Não há magias ${c.tipo === "arc" ? "arcanas" : "divinas"} de 1º círculo nesta escola.`
					: (!sel && cheioEscolas ? `Você já escolheu ${c.escolas} escolas. Remova uma para trocar.` : ""),
				magias: lista.map((m) => ({ uuid: m.uuid, nome: m.name, img: m.img }))
			};
		} else if (this.focoMagia) {
			const m = this.dados.magias.find((x) => x.uuid === this.focoMagia);
			if (m) infoMagia = await this.infoMagia(m);
		}

		return {
			conj: c,
			escolas,
			qtdEscolas: c.escolas,
			escolasEscolhidas: e.magiasEscolas.length,
			precisaEscolas,
			escolhidas,
			vagas: Array.from({ length: precisaEscolas ? 0 : vagas }, (_, i) => i),
			qtd: c.todas ? escolhidas.length : c.quantidade,
			qtdEscolhidas: escolhidas.length,
			todas: !!c.todas,
			infoEscola,
			infoMagia
		};
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	static focarEscola(event, target) {
		this.focoEscola = target.dataset.valor;
		this.focoMagia = "";
		this.render();
	}

	static focarMagia(event, target) {
		this.focoMagia = target.dataset.uuid;
		this.focoEscola = "";
		this.render();
	}
}
