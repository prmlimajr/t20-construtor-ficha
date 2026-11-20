/**
 * Distribuição de atributos: arrastar e soltar (ou clicar) os valores rolados nos atributos.
 */
import { ATRIBUTOS } from "../../regras.js";

/** Métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações (this = janela). */
export class Tela {
	get atribuicao() {
		return this.fonteValores()?.atribuicao ?? null;
	}

	/** Coloca o dado `indice` no atributo `alvo` (troca com o que estava lá). alvo vazio = devolve ao monte. */
	moverDado(indice, alvo) {
		// Valkaria: vários dados podem ir no mesmo atributo; o dado só muda de lugar (sem troca)
		if (this.estado.atrModo === "valkaria") {
			const v = this.estado.atrVariados.valkaria;
			if (!v.dados || !Number.isInteger(indice) || indice < 0 || indice >= v.dados.length) return;
			v.atribuicao[indice] = alvo || "";
			this.dadoSelecionado = null;
			return this.mudou();
		}
		const atr = this.atribuicao;
		if (!atr || !Number.isInteger(indice)) return;
		const origem = ATRIBUTOS.find((k) => atr[k] !== "" && Number(atr[k]) === indice) ?? null;
		if (!alvo) {
			if (origem) atr[origem] = "";
		} else if (origem !== alvo) {
			const anterior = atr[alvo];
			atr[alvo] = String(indice);
			if (origem) atr[origem] = anterior ?? "";
		}
		this.dadoSelecionado = null;
		this.mudou();
	}

	ativarArrastar() {
		const root = this.element;
		const dados = root.querySelectorAll(".cf-dnd [data-dado]");
		if (!dados.length) return;
		for (const el of dados) {
			el.addEventListener("dragstart", (ev) => {
				ev.dataTransfer.setData("text/plain", el.dataset.dado);
				ev.dataTransfer.effectAllowed = "move";
				el.classList.add("arrastando");
			});
			el.addEventListener("dragend", () => el.classList.remove("arrastando"));
		}
		for (const alvo of root.querySelectorAll(".cf-dnd [data-soltar]")) {
			alvo.addEventListener("dragover", (ev) => {
				ev.preventDefault();
				ev.dataTransfer.dropEffect = "move";
				alvo.classList.add("sobre");
			});
			alvo.addEventListener("dragleave", () => alvo.classList.remove("sobre"));
			alvo.addEventListener("drop", (ev) => {
				ev.preventDefault();
				alvo.classList.remove("sobre");
				const indice = Number(ev.dataTransfer.getData("text/plain"));
				this.moverDado(indice, alvo.dataset.soltar);
			});
		}
	}

	/** Clique num dado: seleciona (ou desseleciona) para depois clicar no atributo. */
	static selecionarDado(event, target) {
		const i = Number(target.dataset.dado);
		const slot = target.closest("[data-soltar]")?.dataset.soltar;
		// outro dado já selecionado + clique num dado que está num atributo = troca
		if (this.dadoSelecionado !== null && this.dadoSelecionado !== i && slot) {
			return this.moverDado(this.dadoSelecionado, slot);
		}
		this.dadoSelecionado = this.dadoSelecionado === i ? null : i;
		this.render();
	}

	/** Clique num atributo/monte com um dado selecionado. */
	static colocarDado(event, target) {
		if (this.dadoSelecionado === null) return;
		this.moverDado(this.dadoSelecionado, target.dataset.soltar);
	}
}
