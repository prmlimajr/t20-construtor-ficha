/**
 * Passo "Devoção" do construtor.
 */
import { poder } from "../../dados.js";

export const passo = {
	id: "devocao",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return [{ id: "devocao", titulo: "Devoção", dica: "Seu personagem é devoto de algum deus?" }];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		const forcada = this.devocaoForcada;
		const alt = this.alternativaDevocao;
		if (e.devoto === null && !forcada) {
			return alt ? `Escolha entre ser devoto de um deus ou ${alt.nome}.` : "Responda se o personagem é devoto.";
		}
		if (!e.devoto && !forcada) return null;
		if (!e.divindade) return "Escolha uma divindade.";
		const n = this.poderesConcedidosPermitidos();
		if (e.poderesConcedidos.length !== n) return `Escolha ${n} poder(es) concedido(s).`;
		return null;
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxDevocao();
	}
};

/** Tela deste passo: os métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações. */
export class Tela {
	async ctxDevocao() {
		const e = this.estado;
		const r = this.regrasClasse;
		const obrig = this.devocaoForcada;
		const alt = this.alternativaDevocao;
		const devoto = this.ehDevoto;
		const divindades = this.dados.divindades.map((d) => {
			const impedimento = this.impedimentoDivindade(d);
			return { nome: d.nome, titulo: d.titulo, menor: !!d.menor, selecionado: d.nome === e.divindade, bloqueado: !!impedimento, impedimento };
		});
		// mostra primeiro as permitidas
		divindades.sort((a, b) => Number(a.bloqueado) - Number(b.bloqueado));
		// O Panteão (os 20 deuses maiores) e, se houver, os deuses menores dos suplementos
		const gruposDivindades = [
			{ titulo: "O Panteão", divindades: divindades.filter((d) => !d.menor) },
			{ titulo: "Deuses Menores", divindades: divindades.filter((d) => d.menor) }
		].filter((g) => g.divindades.length);
		let info = null;
		const div = this.dados.divindades.find((d) => d.nome === (this.focoDivindade || e.divindade));
		if (devoto && div) {
			const poderes = [];
			for (const nome of div.poderes) {
				const p = poder(this.dados, nome);
				if (!p) continue;
				const impedido = this.impedimentoPoder(p);
				poderes.push({
					nome,
					selecionado: e.poderesConcedidos.includes(nome),
					bloqueado: !!impedido,
					motivo: impedido ?? "",
					info: await this.infoPoder(p)
				});
			}
			const impedimento = this.impedimentoDivindade(div);
			info = {
				nome: div.nome, titulo: div.titulo,
				descricao: div.descricao, crencas: div.crencas, simbolo: div.simbolo,
				energia: div.energia, arma: div.arma, devotosTexto: div.devotosTexto, obrigacoes: div.obrigacoes,
				escolhida: div.nome === e.divindade,
				impedimento,
				poderes, qtd: this.poderesConcedidosPermitidos(), escolhidos: e.poderesConcedidos.length,
				fundamentalista: !!e.fundamentalista
			};
		}
		const lista = r?.devocao?.divindades ? ` de ${r.devocao.divindades.join(", ")}` : "";
		return {
			obrigatoria: obrig,
			motivo: obrig ? `${this.classe.name}s precisam ser devotos${lista}.` : null,
			alternativa: alt ? {
				nome: alt.nome,
				descricao: alt.descricao,
				poder: alt.poder ? await this.infoPoder(poder(this.dados, alt.poder)) : null,
				aviso: lista
					? `Se for devoto de um deus, ${this.classe.name.toLowerCase()}s só podem seguir${lista.replace(/^ de/, "")}.`
					: `Como devoto de um deus, você recebe ${this.poderesConcedidosPermitidos()} poder(es) concedido(s); como ${alt.nome}, nenhum.`
			} : null,
			devoto,
			naoDevoto: !obrig && e.devoto === false,
			divindades,
			gruposDivindades,
			filtro: this.filtros?.divindade ?? "",
			info
		};
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	static focarDivindade(event, target) {
		this.focoDivindade = target.dataset.valor;
		this.render();
	}
}
