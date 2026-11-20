/**
 * Passo "Atributos" do construtor.
 */
import { ATRIBUTOS, NOMES_ATRIBUTOS, MIN_PONTOS, MAX_PONTOS, MODOS_VARIADOS, VALKARIA_INICIAL, converterNimb, converterRolagem, sinal, ARRANJOS_FIXOS, custoAtributo, pontosGastos } from "../../regras.js";

export const passo = {
	id: "atributos",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return [{ id: "atributos", titulo: "Atributos", dica: "Defina os valores dos seus atributos." }];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		if (!e.atrModo) return "Escolha a modalidade de atributos.";
		if (e.atrModo === "pontos") {
			const gastos = pontosGastos(e.atrPontos);
			if (gastos > this.pontosTotais) return `Você gastou ${gastos} pontos; o máximo é ${this.pontosTotais}.`;
			return null;
		}
		if (e.atrModo === "rolagem" && !e.atrRolagem.valores) return "Role seus atributos.";
		if (e.atrModo === "valkaria") {
			const v = e.atrVariados.valkaria;
			if (!v.dados) return "Role os 7d6.";
			const feitos = v.atribuicao.filter(Boolean).length;
			if (feitos < v.dados.length) return `Aplique todos os dados nos atributos (${feitos}/${v.dados.length}).`;
			return null;
		}
		const fonte = this.fonteValores();
		if (!fonte) return "Role seus atributos.";
		const atr = fonte.atribuicao;
		const usados = ATRIBUTOS.map((k) => atr[k]);
		if (usados.some((v) => v === "")) return "Atribua um valor a cada atributo.";
		if (new Set(usados).size !== usados.length) return "Cada valor só pode ser usado uma vez.";
		return null;
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxAtributos();
	}
};

/** Tela deste passo: os métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações. */
export class Tela {
	dado(i, valores) {
		const brutos = this.fonteValores()?.brutos ?? null;
		return {
			indice: i,
			valor: sinal(valores[i]),
			bruto: brutos?.[i] ?? null,
			selecionado: this.dadoSelecionado === i
		};
	}

	ctxAtributos() {
		const e = this.estado;
		const modos = this.modosPermitidos();
		const nomesModos = {
			pontos: "Compra de pontos", rolagem: "Rolagem (4d6)", fixo: "Valores fixos",
			...Object.fromEntries(Object.entries(MODOS_VARIADOS).map(([k, m]) => [k, m.nome]))
		};
		const ctx = {
			modos: modos.map((m) => ({ id: m, nome: nomesModos[m], selecionado: e.atrModo === m })),
			variosModos: modos.length > 1,
			modo: e.atrModo,
			ehPontos: e.atrModo === "pontos",
			ehRolagem: e.atrModo === "rolagem",
			ehFixo: e.atrModo === "fixo",
			pontosTotais: this.pontosTotais,
			variados: this.atributosVariados
		};
		// Atributos Variados: descrição do método e, nos que rolam, o botão ou o resultado
		const mv = MODOS_VARIADOS[e.atrModo];
		const vEstado = e.atrVariados?.[e.atrModo];
		if (mv) {
			const rolavel = e.atrModo !== "khalmyr";
			const rolado = e.atrModo === "valkaria" ? !!vEstado?.dados : !!vEstado?.valores;
			ctx.variado = {
				nome: mv.nome,
				descricao: mv.descricao,
				rolavel,
				rolado,
				emOrdem: e.atrModo === "classica" && this.classicaEmOrdem,
				botao: { classica: "Rolar 3d6 seis vezes", epica: "Rolar 3d6 (−menor, +6) seis vezes", valkaria: "Rolar 7d6", nimb: "Rolar 7d20" }[e.atrModo],
				brutos: e.atrModo === "nimb" && rolado
					? `Rolados: ${[...vEstado.brutos, vEstado.descartado].join(", ")} (descartado: ${vEstado.descartado})` : null
			};
		}
		let valores = null;
		let atribuicao = null;
		const fonte = this.fonteValores();
		// Clássica em ordem (configuração do mestre): valores fixos nos atributos, sem distribuir
		const travado = e.atrModo === "classica" && this.classicaEmOrdem;
		if (fonte && e.atrModo !== "fixo" && e.atrModo !== "rolagem" && !travado) {
			valores = fonte.valores;
			atribuicao = fonte.atribuicao;
		}
		if (e.atrModo === "rolagem" && e.atrRolagem.valores) {
			valores = e.atrRolagem.valores;
			atribuicao = e.atrRolagem.atribuicao;
			const soma = valores.reduce((a, b) => a + b, 0);
			ctx.rolagem = {
				brutos: e.atrRolagem.brutos.map((b, i) => ({ total: b, valor: sinal(valores[i]) })),
				soma: sinal(soma),
				podeRerrolar: soma < 6 && !e.atrRolagem.rerrolou
			};
		}
		if (e.atrModo === "fixo") {
			valores = ARRANJOS_FIXOS[e.atrFixo.arranjo];
			atribuicao = e.atrFixo.atribuicao;
			ctx.arranjos = ARRANJOS_FIXOS.map((a, i) => ({
				indice: i, texto: a.map(sinal).join(", "), selecionado: i === e.atrFixo.arranjo
			}));
		}
		// Idades Variadas: coluna da faixa etária (só se a faixa mexe em algum atributo)
		ctx.colunaIdade = ATRIBUTOS.some((k) => this.idadeAtr(k));
		ctx.nomeFaixa = this.faixaIdade?.nome ?? "";
		ctx.linhas = ATRIBUTOS.map((k) => {
			const base = this.base(k);
			const linha = {
				chave: k,
				nome: NOMES_ATRIBUTOS[k],
				base: base === null ? "—" : sinal(base),
				racial: sinal(this.racial(k)),
				idade: sinal(this.idadeAtr(k)),
				total: base === null ? "—" : sinal(this.atributoFinal(k))
			};
			if (e.atrModo === "pontos") {
				const v = e.atrPontos[k];
				linha.custo = custoAtributo(v);
				linha.podeDiminuir = v > MIN_PONTOS;
				linha.podeAumentar = v < MAX_PONTOS;
			}
			if (e.atrModo === "valkaria" && vEstado?.dados) {
				const { dados, total } = this.valkariaAtributo(k);
				linha.valkaria = {
					dados: dados.map((d) => ({ indice: d.indice, valor: d.valor, selecionado: this.dadoSelecionado === d.indice })),
					conta: `${[VALKARIA_INICIAL, ...dados.map((d) => d.valor)].join(" + ")} = ${total}`,
					alvo: this.dadoSelecionado !== null
				};
			}
			if (valores) {
				const i = atribuicao[k];
				linha.dnd = true;
				linha.alvo = this.dadoSelecionado !== null;
				linha.slot = i === "" || i === undefined ? null : this.dado(Number(i), valores);
			}
			return linha;
		});
		if (valores) {
			const usados = new Set(ATRIBUTOS.map((k) => atribuicao[k]).filter((v) => v !== "").map(Number));
			ctx.dnd = true;
			ctx.pool = valores.map((_, i) => i).filter((i) => !usados.has(i)).map((i) => this.dado(i, valores));
			ctx.poolVazio = !ctx.pool.length;
		}
		if (e.atrModo === "valkaria" && vEstado?.dados) {
			ctx.dnd = true;
			ctx.ehValkaria = true;
			ctx.pool = vEstado.dados.map((d, i) => ({ indice: i, valor: d, bruto: null, selecionado: this.dadoSelecionado === i, valkaria: true }))
				.filter((d) => !vEstado.atribuicao[d.indice]);
			ctx.poolVazio = !ctx.pool.length;
		}
		if (e.atrModo === "pontos") {
			const gastos = pontosGastos(e.atrPontos);
			ctx.gastos = gastos;
			ctx.restantes = this.pontosTotais - gastos;
			ctx.estourou = gastos > this.pontosTotais;
		}
		return ctx;
	}

	/* Ações do passo (ApplicationV2 chama com this = janela). */

	static ajustarPonto(event, target) {
		const k = target.dataset.atributo;
		const delta = Number(target.dataset.delta);
		const v = Math.clamp((this.estado.atrPontos[k] ?? 0) + delta, MIN_PONTOS, MAX_PONTOS);
		this.definirCampo(`atrPontos.${k}`, v);
	}

	/** Atributos Variados: rola o método atual (Clássica, Épica, Valkaria ou Nimb) e envia ao chat. Uma vez só. */
	static async rolarVariado() {
		const e = this.estado;
		const modo = e.atrModo;
		const v = e.atrVariados?.[modo];
		const mv = MODOS_VARIADOS[modo];
		if (!v || !mv) return;
		if (v.valores || v.dados) return;
		const falar = (rolls, conteudo) => ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			flavor: `Construtor de Personagem — atributos, método ${mv.nome}`,
			content: conteudo,
			rolls
		});
		const resultados = (roll) => roll.dice.flatMap((d) => d.results.filter((r) => r.active !== false).map((r) => r.result));
		if (modo === "classica" || modo === "epica") {
			const rolls = [];
			for (let i = 0; i < 6; i++) rolls.push(await new Roll(mv.rolagem).evaluate());
			v.brutos = rolls.map((r) => r.total);
			v.valores = v.brutos.map(converterRolagem);
			if (modo === "classica" && this.classicaEmOrdem) {
				ATRIBUTOS.forEach((k, i) => { v.atribuicao[k] = String(i); });
			}
			const nomes = modo === "classica" && this.classicaEmOrdem ? ATRIBUTOS.map((k) => `${NOMES_ATRIBUTOS[k]}: `) : ATRIBUTOS.map(() => "");
			await falar(rolls, `<p>${v.brutos.map((b, i) => `${nomes[i]}${b} → <b>${sinal(v.valores[i])}</b>`).join("<br>")}</p>`);
		} else if (modo === "valkaria") {
			const roll = await new Roll("7d6").evaluate();
			v.dados = resultados(roll).slice(0, 7);
			v.atribuicao = v.dados.map(() => "");
			await falar([roll], `<p>Dados: <b>${v.dados.join(", ")}</b>. Cada atributo começa em ${VALKARIA_INICIAL}; aplique os dados no construtor.</p>`);
		} else if (modo === "nimb") {
			const roll = await new Roll("7d20").evaluate();
			const dados = resultados(roll).slice(0, 7);
			const menor = dados.indexOf(Math.min(...dados));
			v.descartado = dados[menor];
			v.brutos = dados.filter((_, i) => i !== menor);
			v.valores = v.brutos.map(converterNimb);
			await falar([roll], `<p>${dados.join(", ")} (descarta ${v.descartado})<br>${v.brutos.map((b, i) => `${b} → <b>${sinal(v.valores[i])}</b>`).join("<br>")}</p>`);
		}
		this.mudou();
	}

	static async rolarAtributos() {
		const r = this.estado.atrRolagem;
		if (r.valores) return;
		const rolagens = [];
		for (let i = 0; i < 6; i++) rolagens.push(await new Roll("4d6kh3").evaluate());
		r.brutos = rolagens.map((x) => x.total);
		r.valores = r.brutos.map(converterRolagem);
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			flavor: `Construtor de Personagem — atributos (4d6, descarta o menor)`,
			content: `<p>${r.brutos.map((b, i) => `${b} → <b>${sinal(r.valores[i])}</b>`).join("<br>")}</p>`,
			rolls: rolagens
		});
		this.mudou();
	}

	static async rerrolarMenor() {
		const r = this.estado.atrRolagem;
		if (!r.valores || r.rerrolou) return;
		const soma = r.valores.reduce((a, b) => a + b, 0);
		if (soma >= 6) return;
		const i = r.brutos.indexOf(Math.min(...r.brutos));
		const roll = await new Roll("4d6kh3").evaluate();
		r.brutos[i] = roll.total;
		r.valores[i] = converterRolagem(roll.total);
		r.rerrolou = true;
		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			flavor: "Construtor de Personagem — nova rolagem do menor atributo"
		});
		this.mudou();
	}
}
