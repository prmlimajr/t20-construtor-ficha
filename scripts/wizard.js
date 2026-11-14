/**
 * Janela do construtor de ficha (ApplicationV2). Mantém todo o estado em memória
 * (com rascunho salvo numa flag do ator) e só grava a ficha no "Finalizar".
 */
import {
	MODULE_ID, ATRIBUTOS, NOMES_ATRIBUTOS, OFICIOS, PONTOS_TOTAIS, MIN_PONTOS, MAX_PONTOS,
	ARRANJOS_FIXOS, custoAtributo, pontosGastos, converterRolagem, expandirPericias, normalizar, sinal
} from "./regras.js";
import { carregarDados, poder, poderesDoGrupo, equipamento } from "./dados.js";
import { aplicarNaFicha } from "./aplicar.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TPL = `modules/${MODULE_ID}/templates`;

export const TEMPLATES_PASSOS = [
	"raca", "atributos", "classe", "magias", "pericias", "origem", "devocao", "equipamento", "dinheiro", "revisao"
].map((p) => `${TPL}/passos/${p}.hbs`).concat(`${TPL}/partes/poder.hbs`, `${TPL}/partes/abrir.hbs`, `${TPL}/partes/aprimoramentos.hbs`);

const ATRIBUTOS_DINAMICOS = 3;

function estadoInicial(actor) {
	const zeros = Object.fromEntries(ATRIBUTOS.map((k) => [k, 0]));
	const vazio = Object.fromEntries(ATRIBUTOS.map((k) => [k, ""]));
	const origem = () => ({ nome: "", beneficios: [], grupos: {}, itens: {}, amnPericia: "", amnPoder: "" });
	return {
		versao: 1,
		alcancado: 0,
		nome: actor.name,
		raca: "",
		racaAtributos: [],
		atrModo: "",
		atrPontos: { ...zeros },
		atrPontosTotal: PONTOS_TOTAIS,
		atrRolagem: { brutos: null, valores: null, rerrolou: false, atribuicao: { ...vazio } },
		atrFixo: { arranjo: 0, atribuicao: { ...vazio } },
		classe: "",
		escolhasClasse: {},
		magiasEscolas: [],
		magias: [],
		periciasOu: [],
		periciasClasse: [],
		periciasInt: [],
		origens: { principal: origem(), regional: origem() },
		devoto: null,
		divindade: "",
		poderesConcedidos: [],
		equip: { arma: "", armadura: "", escudo: false },
		dinheiro: null,
		compras: {}
	};
}

/**
 * Remove @Embed/@UUID que apontam para compêndios não instalados. Ex.: as descrições de raça do
 * sistema incorporam páginas de "tormenta20-dev-env", compêndio que não é distribuído.
 */
function limparReferenciasIndisponiveis(html) {
	return String(html ?? "")
		.replace(/@(embed|uuid)\[([^\]]+)\](\{[^}]*\})?/gi, (trecho, tipo, uuid, rotulo) => {
			const m = /^Compendium\.([^.]+)\.([^.]+)\./.exec(uuid);
			if (!m || game.packs.get(`${m[1]}.${m[2]}`)) return trecho;
			// link quebrado vira só o texto do rótulo; embed quebrado some
			return tipo.toLowerCase() === "uuid" && rotulo ? rotulo.slice(1, -1) : "";
		})
		.replace(/<p[^>]*>\s*<\/p>/gi, "")
		.trim();
}

async function enriquecer(html) {
	const limpo = limparReferenciasIndisponiveis(html);
	if (!limpo) return "";
	return foundry.applications.ux.TextEditor.implementation.enrichHTML(limpo, { async: true });
}

function rotuloPericia(k) {
	const label = CONFIG.T20?.pericias?.[k]?.label ?? k;
	return game.i18n.localize(label);
}

function rotuloEscola(k) {
	return game.i18n.localize(CONFIG.T20?.spellSchools?.[k] ?? k);
}

function ordenarPericias(keys) {
	return [...keys].sort((a, b) => rotuloPericia(a).localeCompare(rotuloPericia(b), "pt-BR"));
}

/* ==================================================================== */

export class ConstrutorFicha extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(actor, options = {}) {
		super({ id: `t20cf-${actor.id}`, ...options });
		this.actor = actor;
		this.dados = null;
		this.estado = null;
		this.indice = 0;
		this.focoMagia = "";
		this.focoEquip = "";
		this.focoPericia = "";
		this.focoDivindade = "";
		this.focoEscola = "";
		/** Slideout aberto: { campo, lista, titulo, foco, animar, filtro } */
		this.slideout = null;
		/** Dado escolhido por clique (alternativa ao arrastar). */
		this.dadoSelecionado = null;
		this.lojaCategoria = "Armas";
		this.focoLoja = "";
		this.lojaFiltro = "";
		this._cacheHtml = new Map();
		this._salvarRascunho = foundry.utils.debounce(() => this.#salvarRascunho(), 500);
	}

	static DEFAULT_OPTIONS = {
		classes: ["t20-construtor"],
		tag: "div",
		window: { icon: "fa-solid fa-hat-wizard", resizable: true },
		position: { width: 1040, height: 760 },
		actions: {
			avancar: ConstrutorFicha.#avancar,
			voltar: ConstrutorFicha.#voltar,
			irPara: ConstrutorFicha.#irPara,
			definir: ConstrutorFicha.#definir,
			alternar: ConstrutorFicha.#alternar,
			ajustarPonto: ConstrutorFicha.#ajustarPonto,
			rolarAtributos: ConstrutorFicha.#rolarAtributos,
			rerrolarMenor: ConstrutorFicha.#rerrolarMenor,
			focarMagia: ConstrutorFicha.#focarMagia,
			focarEquip: ConstrutorFicha.#focarEquip,
			escolherPericia: ConstrutorFicha.#escolherPericia,
			abrirSlideout: ConstrutorFicha.#abrirSlideout,
			selecionarDado: ConstrutorFicha.#selecionarDado,
			lojaCategoria: ConstrutorFicha.#lojaCategoria,
			focarLoja: ConstrutorFicha.#focarLoja,
			comprar: ConstrutorFicha.#comprar,
			colocarDado: ConstrutorFicha.#colocarDado,
			fecharSlideout: ConstrutorFicha.#fecharSlideout,
			focarSlideout: ConstrutorFicha.#focarSlideout,
			confirmarSlideout: ConstrutorFicha.#confirmarSlideout,
			focarPericia: ConstrutorFicha.#focarPericia,
			focarDivindade: ConstrutorFicha.#focarDivindade,
			focarEscola: ConstrutorFicha.#focarEscola,
			escolherEquip: ConstrutorFicha.#escolherEquip,
			rolarDinheiro: ConstrutorFicha.#rolarDinheiro,
			finalizar: ConstrutorFicha.#finalizar,
			recomecar: ConstrutorFicha.#recomecar
		}
	};

	static PARTS = {
		main: {
			template: `${TPL}/wizard.hbs`,
			scrollable: [".cf-lista", ".cf-info", ".cf-conteudo", ".cf-slideout .cf-lista", ".cf-slideout .cf-info", ".cf-loja .cf-lista", ".cf-loja .cf-info"]
		}
	};

	get title() {
		return `Construtor de Personagem — ${this.actor.name}`;
	}

	/* ---------------- Dados derivados ---------------- */

	get raca() {
		return this.dados.racas.find((r) => r.uuid === this.estado.raca) ?? null;
	}

	get classe() {
		return this.dados.classes.find((c) => c.uuid === this.estado.classe) ?? null;
	}

	get regrasClasse() {
		const c = this.classe;
		return c ? this.dados.regrasClasses[c.name] ?? null : null;
	}

	get conjurador() {
		return this.regrasClasse?.conjurador ?? null;
	}

	get origemDupla() {
		return game.settings.get(MODULE_ID, "origemDupla");
	}

	get beneficiosPorOrigem() {
		return this.origemDupla ? game.settings.get(MODULE_ID, "beneficiosOrigemDupla") : 2;
	}

	/** Total de pontos da compra de pontos (editável pelo jogador; padrão 10). */
	get pontosTotais() {
		const n = Number(this.estado.atrPontosTotal);
		return Number.isFinite(n) && n >= 0 ? Math.floor(n) : PONTOS_TOTAIS;
	}

	modosPermitidos() {
		const modos = [];
		if (game.settings.get(MODULE_ID, "modoPontos")) modos.push("pontos");
		if (game.settings.get(MODULE_ID, "modoRolagem")) modos.push("rolagem");
		if (game.settings.get(MODULE_ID, "modoFixo")) modos.push("fixo");
		return modos.length ? modos : ["pontos"];
	}

	/** Modificador racial final (fixo + escolhas de +1). */
	racial(k) {
		const r = this.raca;
		if (!r) return 0;
		return (r.system.atributos?.[k] ?? 0) + (this.estado.racaAtributos.includes(k) ? 1 : 0);
	}

	/** Valor base do atributo segundo a modalidade escolhida (null = ainda não definido). */
	base(k) {
		const e = this.estado;
		switch (e.atrModo) {
			case "pontos": return e.atrPontos[k] ?? 0;
			case "rolagem": {
				const i = e.atrRolagem.atribuicao[k];
				return i === "" || !e.atrRolagem.valores ? null : e.atrRolagem.valores[Number(i)];
			}
			case "fixo": {
				const i = e.atrFixo.atribuicao[k];
				return i === "" ? null : ARRANJOS_FIXOS[e.atrFixo.arranjo][Number(i)];
			}
		}
		return null;
	}

	atributoFinal(k) {
		return (this.base(k) ?? 0) + this.racial(k);
	}

	/** Perícias treinadas até determinada etapa (exclusive). */
	periciasTreinadas({ ate = "fim" } = {}) {
		const e = this.estado;
		const r = this.regrasClasse;
		const set = new Set();
		if (r) {
			r.fixas.forEach((k) => set.add(k));
			e.periciasOu.forEach((k) => k && set.add(k));
		}
		if (ate === "classe") return set;
		e.periciasClasse.forEach((k) => set.add(k));
		if (ate === "int") return set;
		e.periciasInt.forEach((k) => set.add(k));
		if (ate === "origem") return set;
		for (const o of this.origensAtivas()) {
			for (const b of o.estado.beneficios) if (b.startsWith("pericia:")) set.add(b.slice(8));
			if (o.estado.amnPericia) set.add(o.estado.amnPericia);
		}
		return set;
	}

	origensAtivas() {
		const out = [];
		const p = this.estado.origens.principal;
		const def = this.dados.origens.find((o) => o.nome === p.nome);
		if (def) out.push({ chave: "principal", def, estado: p });
		if (this.origemDupla) {
			const r = this.estado.origens.regional;
			const defR = this.dados.origensRegionais.find((o) => o.nome === r.nome);
			if (defR) out.push({ chave: "regional", def: defR, estado: r });
		}
		return out;
	}

	/**
	 * Motivo pelo qual o personagem não pode ser devoto da divindade (null = pode).
	 * Regra do livro: a raça OU a classe precisa estar entre os devotos; humanos e clérigos podem
	 * seguir qualquer divindade. Druidas só seguem as divindades listadas em classes.json.
	 */
	impedimentoDivindade(d) {
		const r = this.regrasClasse;
		const raca = this.raca?.name;
		const classe = this.classe?.name;
		if (r?.devocao?.divindades && !r.devocao.divindades.includes(d.nome)) {
			return `${classe}s só podem ser devotos de ${r.devocao.divindades.join(", ")}.`;
		}
		if (raca === "Humano" || classe === "Clérigo") return null;
		const dev = d.devotos ?? {};
		const temLista = dev.racas?.length || dev.classes?.length;
		if (!temLista) return null;
		if (dev.racas?.includes(raca) || dev.classes?.includes(classe)) return null;
		return "Sua raça e sua classe não estão entre os devotos desta divindade.";
	}

	divindadesDisponiveis() {
		return this.dados.divindades.filter((d) => !this.impedimentoDivindade(d));
	}

	/** Alternativa à devoção oferecida pela classe (ex.: Paladino do Bem). */
	get alternativaDevocao() {
		return this.regrasClasse?.devocao?.alternativa ?? null;
	}

	/** A classe obriga a ser devoto de um deus, sem alternativa. */
	get devocaoForcada() {
		return !!this.regrasClasse?.devocao?.obrigatoria && !this.alternativaDevocao;
	}

	get ehDevoto() {
		return this.devocaoForcada || this.estado.devoto === true;
	}

	/** Nome gravado em "divindade" na ficha. */
	get textoDivindade() {
		if (this.ehDevoto) return this.estado.divindade;
		if (this.estado.devoto === false && this.alternativaDevocao) return this.alternativaDevocao.nome;
		return "";
	}

	poderesConcedidosPermitidos() {
		return this.regrasClasse?.devocao?.poderes ?? 1;
	}

	/* ---------------- Passos ---------------- */

	passos() {
		const lista = [
			{ id: "raca", titulo: "Raça", dica: "Escolha a raça do seu personagem." },
			{ id: "atributos", titulo: "Atributos", dica: "Defina os valores dos seus atributos." },
			{ id: "classe", titulo: "Classe", dica: "Escolha a classe do seu personagem." }
		];
		if (this.conjurador) lista.push({ id: "magias", titulo: "Magias", dica: "Escolha as magias que você conhece." });
		lista.push({ id: "pericias", titulo: "Perícias", dica: "Escolha suas perícias treinadas." });
		lista.push({
			id: "origem", sub: "principal",
			titulo: this.origemDupla ? "Origem profissional" : "Origem",
			dica: "Escolha sua origem e os benefícios que ela fornece."
		});
		if (this.origemDupla) {
			lista.push({ id: "origem", sub: "regional", titulo: "Origem regional", dica: "Escolha sua origem regional." });
		}
		lista.push(
			{ id: "devocao", titulo: "Devoção", dica: "Seu personagem é devoto de algum deus?" },
			{ id: "equipamento", titulo: "Equipamento", dica: "Escolha seu equipamento inicial." },
			{ id: "dinheiro", titulo: "Dinheiro", dica: "Role 4d6 para definir seus tibares iniciais." },
			{ id: "revisao", titulo: "Revisão", dica: "Confira tudo antes de criar a ficha." }
		);
		return lista;
	}

	/** Retorna a pendência do passo (texto) ou null se estiver completo. */
	pendencia(passo) {
		const e = this.estado;
		switch (passo.id) {
			case "raca": {
				const r = this.raca;
				if (!r) return "Escolha uma raça.";
				const din = [...(r.system.atributosDinamicos?.value ?? [])];
				if (din.length && e.racaAtributos.length !== ATRIBUTOS_DINAMICOS) {
					return `Escolha ${ATRIBUTOS_DINAMICOS} atributos para receber +1.`;
				}
				return null;
			}
			case "atributos": {
				if (!e.atrModo) return "Escolha a modalidade de atributos.";
				if (e.atrModo === "pontos") {
					const gastos = pontosGastos(e.atrPontos);
					if (gastos > this.pontosTotais) return `Você gastou ${gastos} pontos; o máximo é ${this.pontosTotais}.`;
					return null;
				}
				if (e.atrModo === "rolagem" && !e.atrRolagem.valores) return "Role seus atributos.";
				const atr = e.atrModo === "rolagem" ? e.atrRolagem.atribuicao : e.atrFixo.atribuicao;
				const usados = ATRIBUTOS.map((k) => atr[k]);
				if (usados.some((v) => v === "")) return "Atribua um valor a cada atributo.";
				if (new Set(usados).size !== usados.length) return "Cada valor só pode ser usado uma vez.";
				return null;
			}
			case "classe": {
				if (!this.classe) return "Escolha uma classe.";
				for (const esc of this.escolhasAtivas()) {
					if (!e.escolhasClasse[esc.id]) return `Escolha: ${esc.titulo}.`;
				}
				return null;
			}
			case "magias": {
				const c = this.conjurador;
				if (!c) return null;
				if (c.escolas && e.magiasEscolas.length !== c.escolas) return `Escolha ${c.escolas} escolas de magia.`;
				if (e.magias.length !== c.quantidade) return `Escolha ${c.quantidade} magias (${e.magias.length} escolhidas).`;
				return null;
			}
			case "pericias": {
				const r = this.regrasClasse;
				if (!r) return "Escolha uma classe primeiro.";
				if (r.ou.some((_, i) => !e.periciasOu[i])) return "Escolha as perícias obrigatórias da classe.";
				if (e.periciasClasse.length !== r.numero) {
					return `Escolha ${r.numero} perícias da classe (${e.periciasClasse.length} escolhidas).`;
				}
				const nInt = Math.max(0, this.atributoFinal("int"));
				if (e.periciasInt.length !== nInt) {
					return `Escolha ${nInt} perícias por Inteligência (${e.periciasInt.length} escolhidas).`;
				}
				return null;
			}
			case "origem": {
				const o = e.origens[passo.sub];
				const lista = passo.sub === "regional" ? this.dados.origensRegionais : this.dados.origens;
				if (passo.sub === "regional" && !lista.length) return null; // sem dados: passo opcional
				const def = lista.find((x) => x.nome === o.nome);
				if (!def) return "Escolha uma origem.";
				if (def.especial === "amnesico") {
					if (!o.amnPericia || !o.amnPoder) return "Escolha a perícia e o poder (definidos pelo mestre).";
				} else {
					const n = this.beneficiosPorOrigem;
					if (o.beneficios.length !== n) return `Escolha ${n} benefícios (${o.beneficios.length} escolhidos).`;
					for (const b of o.beneficios) {
						if (b.startsWith("grupo:") && !o.grupos[b.slice(6)]) return `Escolha o poder de ${b.slice(6)}.`;
					}
				}
				const itens = def.itens ?? [];
				for (let i = 0; i < itens.length; i++) {
					if ((itens[i].escolha || itens[i].arma) && !o.itens[i]) return "Escolha os itens da origem.";
				}
				return null;
			}
			case "devocao": {
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
			}
			case "equipamento":
				if (!e.equip.arma) return "Escolha sua arma inicial.";
				return null;
			case "dinheiro":
				return e.dinheiro === null ? "Role seus tibares iniciais." : null;
			case "revisao": {
				if (!e.nome?.trim()) return "Dê um nome ao personagem.";
				for (const p of this.passos()) {
					if (p.id === "revisao") continue;
					const pend = this.pendencia(p);
					if (pend) return `${p.titulo}: ${pend}`;
				}
				return null;
			}
		}
		return null;
	}

	escolhasAtivas() {
		const r = this.regrasClasse;
		if (!r) return [];
		const ativas = [];
		const subs = new Set();
		for (const esc of r.escolhas ?? []) {
			if (esc.somenteSub && !subs.has(esc.id)) continue;
			ativas.push(esc);
			const escolhida = esc.opcoes.find((o) => o.poder === this.estado.escolhasClasse[esc.id]);
			if (escolhida?.subescolha) subs.add(escolhida.subescolha);
		}
		return ativas;
	}

	/* ---------------- Ciclo de vida ---------------- */

	/**
	 * Carrega dados e rascunho uma única vez. Chamado no início de _prepareContext, porque o
	 * ApplicationV2 prepara o contexto antes de _preFirstRender.
	 */
	async #inicializar() {
		if (this.dados && this.estado) return;
		this.dados = await carregarDados();
		const salvo = this.actor.getFlag(MODULE_ID, "rascunho");
		let estado = null;
		if (salvo) {
			try { estado = JSON.parse(salvo); } catch (err) { estado = null; }
		}
		this.estado = foundry.utils.mergeObject(estadoInicial(this.actor), estado ?? {}, { inplace: false });
		const modos = this.modosPermitidos();
		if (!modos.includes(this.estado.atrModo)) this.estado.atrModo = modos.length === 1 ? modos[0] : "";
		this.indice = Math.min(this.estado.alcancado ?? 0, this.passos().length - 1);
	}

	async _prepareContext(options) {
		await this.#inicializar();
		const passos = this.passos();
		this.indice = Math.min(this.indice, passos.length - 1);
		const atual = passos[this.indice];
		const ctx = {
			passos: passos.map((p, i) => ({
				...p,
				indice: i,
				numero: i + 1,
				atual: i === this.indice,
				feito: i < this.indice || (i <= this.estado.alcancado && !this.pendencia(p)),
				acessivel: i <= this.estado.alcancado
			})),
			passo: { ...atual, template: `${TPL}/passos/${atual.id}.hbs` },
			primeiro: this.indice === 0,
			ultimo: atual.id === "revisao",
			pendencia: this.pendencia(atual),
			resumoLateral: this.#resumoLateral()
		};
		Object.assign(ctx, await this.#contextoPasso(atual));
		ctx.slideout = await this.#ctxSlideout();
		return ctx;
	}

	_onRender(context, options) {
		super._onRender(context, options);
		this.#ativarArrastar();
		const filtro = this.element.querySelector(".cf-slideout .cf-filtro");
		if (filtro) {
			const aplicar = () => {
				const termo = normalizar(filtro.value);
				if (this.slideout) this.slideout.filtro = filtro.value;
				for (const card of this.element.querySelectorAll(".cf-slideout .cf-card")) {
					card.hidden = !!termo && !normalizar(card.dataset.busca).includes(termo);
				}
			};
			filtro.addEventListener("input", aplicar);
			aplicar();
			if (context.slideout?.animar) filtro.focus();
		}
		const filtroLoja = this.element.querySelector(".cf-loja .cf-filtro");
		if (filtroLoja) {
			const aplicar = () => {
				const termo = normalizar(filtroLoja.value);
				this.lojaFiltro = filtroLoja.value;
				for (const card of this.element.querySelectorAll(".cf-loja .cf-card")) {
					card.hidden = !!termo && !normalizar(card.dataset.busca).includes(termo);
				}
			};
			filtroLoja.addEventListener("input", aplicar);
			aplicar();
		}
		const slide = this.element.querySelector(".cf-slideout");
		slide?.addEventListener("keydown", (ev) => {
			if (ev.key === "Escape") {
				ev.stopPropagation();
				this.slideout = null;
				this.render();
			}
		});
		for (const el of this.element.querySelectorAll("input[data-campo], select[data-campo]")) {
			el.addEventListener("change", (ev) => this.#aoAlterarCampo(ev.currentTarget));
		}
	}

	#salvarRascunho() {
		if (!this.actor.isOwner || !this.estado) return;
		return this.actor.setFlag(MODULE_ID, "rascunho", JSON.stringify(this.estado));
	}

	#mudou() {
		this._salvarRascunho();
		this.render();
	}

	/* ---------------- Loja ---------------- */

	itemLoja(nome) {
		return this.dados.loja.find((x) => x.doc.name === nome) ?? null;
	}

	/** Total gasto nas compras (T$), arredondado em centavos. */
	get gastoCompras() {
		let total = 0;
		for (const [nome, n] of Object.entries(this.estado.compras ?? {})) {
			const it = this.itemLoja(nome);
			if (it) total += Number(it.doc.system.preco) * n;
		}
		return Math.round(total * 100) / 100;
	}

	get saldo() {
		return Math.round(((this.estado.dinheiro ?? 0) - this.gastoCompras) * 100) / 100;
	}

	static formatarTibares(v) {
		const n = Math.round(Number(v) * 100) / 100;
		return `T$ ${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")}`;
	}

	async #ctxDinheiro() {
		const e = this.estado;
		const fmt = ConstrutorFicha.formatarTibares;
		const extras = this.origensAtivas().filter((o) => o.def.tibares).map((o) => `${o.def.tibares} (${o.def.nome})`);
		const ctx = { dinheiro: e.dinheiro, rolado: e.dinheiro !== null, extras: extras.join(" + ") };
		if (!ctx.rolado) return ctx;
		const saldo = this.saldo;
		const presentes = new Set(this.dados.loja.map((x) => x.categoria));
		const ordem = [...this.dados.categoriasLoja.filter((c) => presentes.has(c)), ...[...presentes].filter((c) => !this.dados.categoriasLoja.includes(c))];
		if (!presentes.has(this.lojaCategoria)) this.lojaCategoria = ordem[0];
		const cards = this.dados.loja.filter((x) => x.categoria === this.lojaCategoria).map(({ doc }) => {
			const f = this.#fichaEquip(doc.name);
			const preco = Number(doc.system.preco);
			const n = e.compras[doc.name] ?? 0;
			return {
				nome: doc.name, img: doc.img,
				preco: fmt(preco),
				sub: [fmt(preco), f.sub].filter(Boolean).join(" · "),
				qtd: n,
				caro: preco > saldo && !n,
				foco: doc.name === this.focoLoja,
				busca: `${doc.name} ${f.sub}`
			};
		});
		const carrinho = Object.entries(e.compras).filter(([, n]) => n > 0).map(([nome, n]) => {
			const it = this.itemLoja(nome);
			const preco = Number(it?.doc.system.preco ?? 0);
			return { nome, qtd: n, multiplo: n > 1, total: fmt(preco * n) };
		});
		let info = null;
		const foco = this.itemLoja(this.focoLoja);
		if (foco) {
			const f = this.#fichaEquip(foco.doc.name);
			const preco = Number(foco.doc.system.preco);
			const n = e.compras[foco.doc.name] ?? 0;
			const pacote = Number(foco.doc.system.qtd) > 1 ? Number(foco.doc.system.qtd) : null;
			info = {
				nome: f.nome, img: f.img,
				preco: fmt(preco),
				pacote,
				stats: f.stats.map(([rotulo, valor]) => ({ rotulo, valor })),
				descricao: await this.#html(foco.doc.uuid, foco.doc.system?.description?.value),
				qtd: n,
				podeComprar: preco <= saldo,
				podeRemover: n > 0
			};
		}
		return {
			...ctx,
			fmtRolado: fmt(e.dinheiro),
			fmtGasto: fmt(this.gastoCompras),
			fmtSaldo: fmt(saldo),
			categorias: ordem.map((c) => ({ nome: c, selecionado: c === this.lojaCategoria })),
			cards,
			carrinho,
			info,
			filtro: this.lojaFiltro
		};
	}

	/* ---------------- Distribuição de atributos (arrastar e soltar) ---------------- */

	#dado(i, valores) {
		const brutos = this.estado.atrModo === "rolagem" ? this.estado.atrRolagem.brutos : null;
		return {
			indice: i,
			valor: sinal(valores[i]),
			bruto: brutos?.[i] ?? null,
			selecionado: this.dadoSelecionado === i
		};
	}

	get #atribuicao() {
		const e = this.estado;
		if (e.atrModo === "rolagem") return e.atrRolagem.atribuicao;
		if (e.atrModo === "fixo") return e.atrFixo.atribuicao;
		return null;
	}

	/** Coloca o dado `indice` no atributo `alvo` (troca com o que estava lá). alvo vazio = devolve ao monte. */
	#moverDado(indice, alvo) {
		const atr = this.#atribuicao;
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
		this.#mudou();
	}

	#ativarArrastar() {
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
				this.#moverDado(indice, alvo.dataset.soltar);
			});
		}
	}

	/* ---------------- Slideout (submenus de escolha) ---------------- */

	/** Opções de uma lista de slideout: [{valor, nome, img, sub}] */
	#opcoesSlideout(lista) {
		const [tipo, arg = ""] = lista.split(/:(.*)/s);
		const equip = (nome) => {
			const f = this.#fichaEquip(nome);
			return { valor: nome, nome: f.nome, img: f.img, sub: f.sub };
		};
		const poderCard = (p) => ({ valor: p.name, nome: p.name, img: p.img, sub: p.system.subtipo ?? "" });
		switch (tipo) {
			case "arma": {
				const cats = arg.split(",");
				return this.dados.armas.filter((a) => cats.includes(a.system.proficiencia)).map((a) => equip(a.name));
			}
			case "nomes":
				return arg.split("|").map(equip);
			case "grupo":
				return poderesDoGrupo(this.dados, arg).map(poderCard);
			case "magia":
				return this.magiasDisponiveis().map((m) => ({
					valor: m.uuid, nome: m.name, img: m.img,
					sub: `${rotuloEscola(m.system.escola)} · ${m.system.tipo === "uni" ? "Universal" : (m.system.tipo === "arc" ? "Arcana" : "Divina")}`
				}));
			case "poderGeral":
				return this.dados.poderes.filter((p) => p.system.tipo === "geral")
					.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(poderCard);
			case "pericia": {
				const atual = foundry.utils.getProperty(this.estado, this.slideout?.campo ?? "");
				const treinadas = this.periciasTreinadas({ ate: "origem" });
				return ordenarPericias(Object.keys(CONFIG.T20?.pericias ?? {}))
					.filter((k) => !treinadas.has(k) || k === atual)
					.map((k) => {
						const c = this.#cardPericia(k);
						return { valor: k, nome: c.nome, sigla: c.atributo, sub: c.tags };
					});
			}
		}
		return [];
	}

	/** Detalhes do item em foco no slideout. */
	async #infoSlideout(lista, valor) {
		const tipo = lista.split(":")[0];
		if (tipo === "magia") {
			const m = this.dados.magias.find((x) => x.uuid === valor);
			if (!m) return null;
			const i = await this.#infoMagia(m);
			return {
				nome: i.nome, img: i.img,
				stats: [{ rotulo: "Escola", valor: `${i.escola} · ${i.tipo}` }, ...i.stats],
				descricao: i.descricao,
				aprimoramentos: i.aprimoramentos
			};
		}
		if (tipo === "arma" || tipo === "nomes") {
			const f = this.#fichaEquip(valor);
			return {
				nome: f.nome, img: f.img,
				stats: f.stats.map(([rotulo, v]) => ({ rotulo, valor: v })),
				descricao: f.doc ? await this.#html(f.doc.uuid, f.doc.system?.description?.value) : ""
			};
		}
		if (tipo === "grupo" || tipo === "poderGeral") {
			const p = poder(this.dados, valor);
			if (!p) return null;
			const i = await this.#infoPoder(p);
			return { ...i, stats: [{ rotulo: "Tipo", valor: p.system.subtipo }] };
		}
		if (tipo === "pericia") {
			const cfg = CONFIG.T20?.pericias?.[valor];
			if (!cfg) return null;
			return {
				nome: rotuloPericia(valor),
				stats: [
					{ rotulo: "Atributo", valor: NOMES_ATRIBUTOS[cfg.abl] ?? cfg.abl },
					{ rotulo: "Somente treinado", valor: cfg.trainedOnly ? "Sim" : "Não" },
					{ rotulo: "Penalidade de armadura", valor: cfg.armorPenalty ? "Sim" : "Não" }
				],
				descricao: await this.#descricaoPericia(valor)
			};
		}
		return null;
	}

	async #ctxSlideout() {
		const so = this.slideout;
		if (!so) return null;
		const atual = foundry.utils.getProperty(this.estado, so.campo) ?? "";
		const ehLista = Array.isArray(atual);
		const cards = this.#opcoesSlideout(so.lista).map((c) => ({
			...c,
			selecionado: ehLista ? atual.includes(c.valor) : c.valor === atual,
			foco: c.valor === so.foco
		}));
		const info = so.foco ? await this.#infoSlideout(so.lista, so.foco) : null;
		if (info) {
			info.valor = so.foco;
			info.jaEscolhido = ehLista ? atual.includes(so.foco) : so.foco === atual;
		}
		const animar = so.animar;
		so.animar = false;
		return { titulo: so.titulo, cards, info, animar, filtro: so.filtro, longa: cards.length > 8 };
	}

	/* ---------------- Contexto por passo ---------------- */

	async #html(chave, html) {
		if (!this._cacheHtml.has(chave)) this._cacheHtml.set(chave, await enriquecer(html));
		return this._cacheHtml.get(chave);
	}

	async #infoPoder(p) {
		if (!p) return null;
		return { nome: p.name, img: p.img, descricao: await this.#html(p.uuid, p.system.description?.value) };
	}

	#resumoLateral() {
		const e = this.estado;
		const linhas = [];
		if (this.raca) linhas.push(["Raça", this.raca.name]);
		if (this.classe) linhas.push(["Classe", this.classe.name]);
		const origens = this.origensAtivas().map((o) => o.def.nome);
		if (origens.length) linhas.push(["Origem", origens.join(" / ")]);
		if (this.textoDivindade) linhas.push(["Divindade", this.textoDivindade]);
		if (e.dinheiro !== null) linhas.push(["Tibares", ConstrutorFicha.formatarTibares(this.saldo)]);
		const atributos = e.atrModo
			? ATRIBUTOS.map((k) => ({ sigla: k.toUpperCase(), valor: sinal(this.atributoFinal(k)) }))
			: null;
		return { linhas: linhas.map(([rotulo, valor]) => ({ rotulo, valor })), atributos };
	}

	async #contextoPasso(passo) {
		switch (passo.id) {
			case "raca": return this.#ctxRaca();
			case "atributos": return this.#ctxAtributos();
			case "classe": return this.#ctxClasse();
			case "magias": return this.#ctxMagias();
			case "pericias": return this.#ctxPericias();
			case "origem": return this.#ctxOrigem(passo.sub);
			case "devocao": return this.#ctxDevocao();
			case "equipamento": return this.#ctxEquipamento();
			case "dinheiro": return this.#ctxDinheiro();
			case "revisao": return this.#ctxRevisao();
		}
		return {};
	}

	#textoAtributosRaca(r) {
		const partes = ATRIBUTOS.filter((k) => r.system.atributos?.[k])
			.map((k) => `${NOMES_ATRIBUTOS[k]} ${sinal(r.system.atributos[k])}`);
		const din = [...(r.system.atributosDinamicos?.value ?? [])];
		if (din.length) {
			const excluidos = ATRIBUTOS.filter((k) => !din.includes(k)).map((k) => NOMES_ATRIBUTOS[k]);
			partes.unshift(`+1 em três atributos${excluidos.length ? ` (exceto ${excluidos.join(", ")})` : ""}`);
		}
		return partes.join(", ") || "—";
	}

	async #ctxRaca() {
		const e = this.estado;
		const racas = this.dados.racas.map((r) => ({
			uuid: r.uuid, nome: r.name, img: r.img,
			resumo: this.#textoAtributosRaca(r),
			selecionado: r.uuid === e.raca
		}));
		let info = null;
		const r = this.raca;
		if (r) {
			const poderes = [];
			for (const g of r.system.grants ?? []) {
				for (const c of g.choices ?? []) {
					const p = this.dados.poderes.find((x) => x.uuid === c.uuid) ?? (await fromUuid(c.uuid));
					if (p) poderes.push(await this.#infoPoder(p));
				}
			}
			const din = [...(r.system.atributosDinamicos?.value ?? [])];
			info = {
				nome: r.name, img: r.img,
				atributos: this.#textoAtributosRaca(r),
				descricao: await this.#html(r.uuid, r.system.description?.value),
				poderes,
				dinamicos: din.length
					? din.map((k) => ({
						chave: k, nome: NOMES_ATRIBUTOS[k],
						selecionado: e.racaAtributos.includes(k)
					}))
					: null,
				qtdDinamicos: ATRIBUTOS_DINAMICOS
			};
		}
		return { racas, info };
	}

	#ctxAtributos() {
		const e = this.estado;
		const modos = this.modosPermitidos();
		const nomesModos = { pontos: "Compra de pontos", rolagem: "Rolagem (4d6)", fixo: "Valores fixos" };
		const ctx = {
			modos: modos.map((m) => ({ id: m, nome: nomesModos[m], selecionado: e.atrModo === m })),
			variosModos: modos.length > 1,
			modo: e.atrModo,
			ehPontos: e.atrModo === "pontos",
			ehRolagem: e.atrModo === "rolagem",
			ehFixo: e.atrModo === "fixo",
			pontosTotais: this.pontosTotais
		};
		let valores = null;
		let atribuicao = null;
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
		ctx.linhas = ATRIBUTOS.map((k) => {
			const base = this.base(k);
			const linha = {
				chave: k,
				nome: NOMES_ATRIBUTOS[k],
				base: base === null ? "—" : sinal(base),
				racial: sinal(this.racial(k)),
				total: base === null ? "—" : sinal(this.atributoFinal(k))
			};
			if (e.atrModo === "pontos") {
				const v = e.atrPontos[k];
				linha.custo = custoAtributo(v);
				linha.podeDiminuir = v > MIN_PONTOS;
				linha.podeAumentar = v < MAX_PONTOS;
			}
			if (valores) {
				const i = atribuicao[k];
				linha.dnd = true;
				linha.alvo = this.dadoSelecionado !== null;
				linha.slot = i === "" || i === undefined ? null : this.#dado(Number(i), valores);
			}
			return linha;
		});
		if (valores) {
			const usados = new Set(ATRIBUTOS.map((k) => atribuicao[k]).filter((v) => v !== "").map(Number));
			ctx.dnd = true;
			ctx.pool = valores.map((_, i) => i).filter((i) => !usados.has(i)).map((i) => this.#dado(i, valores));
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

	async #ctxClasse() {
		const e = this.estado;
		const classes = this.dados.classes.map((c) => ({
			uuid: c.uuid, nome: c.name, img: c.img,
			resumo: `PV ${c.system.pvPorNivel * 4} · PM ${c.system.pmPorNivel}`,
			selecionado: c.uuid === e.classe
		}));
		let info = null;
		const c = this.classe;
		if (c) {
			const r = this.regrasClasse ?? {};
			const nomesProf = { marcial: "Armas marciais", pesada: "Armaduras pesadas", escudo: "Escudos" };
			const prof = ["Armas simples", "Armaduras leves", ...(r.proficiencias ?? []).map((p) => nomesProf[p] ?? p)];
			const habilidades = [];
			for (const nome of r.habilidades ?? []) {
				const p = poder(this.dados, nome);
				if (p) habilidades.push(await this.#infoPoder(p));
			}
			const escolhas = [];
			for (const esc of this.escolhasAtivas()) {
				const opcoes = [];
				for (const o of esc.opcoes) {
					const p = poder(this.dados, o.poder);
					opcoes.push({
						valor: o.poder,
						nome: o.poder.replace(/^.*?: /, ""),
						selecionado: e.escolhasClasse[esc.id] === o.poder,
						info: e.escolhasClasse[esc.id] === o.poder ? await this.#infoPoder(p) : null
					});
				}
				escolhas.push({ id: esc.id, titulo: esc.titulo, campo: `escolhasClasse.${esc.id}`, opcoes });
			}
			const conj = r.conjurador;
			info = {
				nome: c.name, img: c.img,
				pv: `${c.system.pvPorNivel * 4} + Con no 1º nível (+${c.system.pvPorNivel} + Con por nível)`,
				pm: `${c.system.pmPorNivel} por nível`,
				pericias: c.system.pericias?.inatas,
				proficiencias: prof.join(", "),
				magias: conj
					? `${conj.tipo === "arc" ? "Arcanas" : "Divinas"} — ${conj.quantidade} magias de 1º círculo${conj.escolas ? ` de ${conj.escolas} escolas à sua escolha` : ""}`
					: null,
				devocao: r.devocao?.obrigatoria
					? `Devoto obrigatório${r.devocao.divindades ? ` (${r.devocao.divindades.join(", ")})` : ""}${r.devocao.alternativa ? `, ou ${r.devocao.alternativa.nome}` : ""}`
					: null,
				descricao: await this.#html(c.uuid, c.system.description?.value),
				habilidades,
				escolhas,
				semRegras: !this.regrasClasse
			};
		}
		return { classes, info };
	}

	/** Magias de 1º círculo que a classe pode aprender (respeitando as escolas escolhidas). */
	magiasDisponiveis() {
		const c = this.conjurador;
		if (!c) return [];
		const tipos = c.tipo === "arc" ? ["arc", "uni"] : ["div", "uni"];
		const escolas = this.estado.magiasEscolas;
		return this.dados.magias.filter((m) =>
			m.system.circulo === 1
			&& tipos.includes(m.system.tipo)
			&& (!c.escolas || escolas.includes(m.system.escola)));
	}

	/** Painel completo de uma magia (ficha, descrição, aprimoramentos). */
	async #infoMagia(m) {
		return {
			uuid: m.uuid,
			nome: m.name, img: m.img,
			escola: rotuloEscola(m.system.escola),
			tipo: m.system.tipo === "uni" ? "Universal" : (m.system.tipo === "arc" ? "Arcana" : "Divina"),
			escolaDescricao: this.dados.escolas[m.system.escola]?.descricao ?? "",
			selecionado: this.estado.magias.includes(m.uuid),
			stats: this.#statsMagia(m),
			descricao: await this.#html(m.uuid, m.system.description?.value),
			aprimoramentos: await this.#aprimoramentos(m)
		};
	}

	async #ctxMagias() {
		const e = this.estado;
		const c = this.conjurador;
		const tipos = c.tipo === "arc" ? ["arc", "uni"] : ["div", "uni"];
		const daClasse = (k) => this.dados.magias.filter((m) => m.system.circulo === 1 && m.system.escola === k && tipos.includes(m.system.tipo));
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

		const escolhidas = this.dados.magias.filter((m) => e.magias.includes(m.uuid)).map((m) => ({
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
			if (m) infoMagia = await this.#infoMagia(m);
		}

		return {
			conj: c,
			escolas,
			qtdEscolas: c.escolas,
			escolasEscolhidas: e.magiasEscolas.length,
			precisaEscolas,
			escolhidas,
			vagas: Array.from({ length: precisaEscolas ? 0 : vagas }, (_, i) => i),
			qtd: c.quantidade,
			qtdEscolhidas: escolhidas.length,
			infoEscola,
			infoMagia
		};
	}

	/** Ficha resumida de uma magia (execução, alcance, alvo, duração, resistência). */
	#statsMagia(m) {
		const s = m.system;
		const T = CONFIG.T20 ?? {};
		const loc = (mapa, k) => (k && mapa?.[k] ? game.i18n.localize(mapa[k]) : "");
		const stats = [];
		const custo = s.ativacao?.custo;
		if (custo) stats.push(["Custo", `${custo} PM`]);
		const exec = loc(T.abilityActivationTypes, s.ativacao?.execucao);
		if (exec) stats.push(["Execução", exec]);
		const alcance = loc(T.distanceUnits, s.alcance);
		if (alcance && s.alcance !== "none") stats.push(["Alcance", alcance]);
		if (s.alvo) stats.push(["Alvo", s.alvo]);
		if (s.area) stats.push(["Área", s.area]);
		if (s.efeito) stats.push(["Efeito", s.efeito]);
		const u = s.duracao?.units;
		let dur = loc(T.timePeriods, u);
		if (["round", "turn", "minute", "hour", "day"].includes(u) && s.duracao?.value) dur = `${s.duracao.value} ${dur.toLowerCase()}`;
		if (s.duracao?.special) dur = dur ? `${dur} (${s.duracao.special})` : s.duracao.special;
		if (dur) stats.push(["Duração", dur]);
		if (s.resistencia?.txt) stats.push(["Resistência", s.resistencia.txt]);
		return stats.map(([rotulo, valor]) => ({ rotulo, valor }));
	}

	/** Aprimoramentos da magia: efeitos "ao usar" com custo em PM e descrição. */
	async #aprimoramentos(m) {
		const efeitos = [...(m.effects ?? [])]
			.map((ef, ordem) => ({ ef, ordem }))
			.filter(({ ef }) => ef.system?.onuse && (ef.description || ef.system?.abilityUse?.description));
		efeitos.sort((a, b) => (a.ef.system.abilityUse?.custo ?? 0) - (b.ef.system.abilityUse?.custo ?? 0) || a.ordem - b.ordem);
		const out = [];
		for (const { ef } of efeitos) {
			const html = ef.description || ef.system.abilityUse.description;
			const custo = ef.system.abilityUse?.custo ?? 0;
			const texto = await this.#html(`${m.uuid}.${ef.id ?? ef._id}`, html);
			const circulo = /Requer (\d)º círculo/i.exec(html)?.[1] ?? null;
			out.push({ custo: custo ? `+${custo} PM` : "Especial", texto, circulo, bloqueado: circulo && Number(circulo) > 1 });
		}
		return out;
	}

	/** Descrição da perícia vinda do diário "Perícias" do sistema (Ofícios usam a página "Ofício"). */
	async #descricaoPericia(k) {
		const chave = OFICIOS.includes(k) ? "ofic" : k;
		const uuid = CONFIG.T20?.skillCompendiumEntries?.[chave];
		if (!uuid) return "";
		if (!this._cacheHtml.has(uuid)) {
			const page = await fromUuid(uuid).catch(() => null);
			this._cacheHtml.set(uuid, await enriquecer(page?.text?.content ?? ""));
		}
		return this._cacheHtml.get(uuid);
	}

	#cardPericia(k, extra = {}) {
		const cfg = CONFIG.T20?.pericias?.[k] ?? {};
		const tags = [];
		if (cfg.trainedOnly) tags.push("Só treinado");
		if (cfg.armorPenalty) tags.push("Penalidade de armadura");
		return {
			chave: k,
			nome: rotuloPericia(k),
			atributo: NOMES_ATRIBUTOS[cfg.abl]?.slice(0, 3) ?? "",
			tags: tags.join(" · "),
			foco: k === this.focoPericia,
			...extra
		};
	}

	async #ctxPericias() {
		const e = this.estado;
		const r = this.regrasClasse;
		if (!r) return {};
		const card = (k, extra) => this.#cardPericia(k, extra);

		const fixas = ordenarPericias(r.fixas).map((k) => card(k, { fixa: true }));
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
				descricao: await this.#descricaoPericia(k)
			};
		}

		return {
			fixas,
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

	async #ctxOrigem(sub) {
		const est = this.estado.origens[sub];
		const lista = sub === "regional" ? this.dados.origensRegionais : this.dados.origens;
		const base = `origens.${sub}`;
		if (!lista.length) return { semOrigens: true };
		const origens = lista.map((o) => ({
			nome: o.nome,
			resumo: this.#resumoOrigem(o),
			selecionado: o.nome === est.nome
		}));
		const def = lista.find((o) => o.nome === est.nome);
		let info = null;
		if (def) {
			const treinadas = this.periciasTreinadas({ ate: "origem" });
			// perícias de outras origens também contam como já treinadas
			for (const o of this.origensAtivas()) {
				if (o.chave === sub) continue;
				o.estado.beneficios.filter((b) => b.startsWith("pericia:")).forEach((b) => treinadas.add(b.slice(8)));
			}
			const beneficios = [];
			for (const k of ordenarPericias(expandirPericias(def.pericias))) {
				const id = `pericia:${k}`;
				const c = this.#cardPericia(k);
				const sel = est.beneficios.includes(id);
				const bloqueado = treinadas.has(k) && !sel;
				beneficios.push({
					id, tipo: "Perícia", nome: c.nome,
					atributo: c.atributo,
					detalhe: bloqueado ? "Já treinada" : c.tags,
					selecionado: sel,
					bloqueado,
					info: sel ? { nome: `${c.nome} (${c.atributo})`, descricao: await this.#descricaoPericia(k) } : null
				});
			}
			for (const nome of def.poderes ?? []) {
				if (def.especial === "amnesico") continue;
				const p = poder(this.dados, nome);
				const id = `poder:${nome}`;
				beneficios.push({
					id, tipo: p?.system.tipo === "origem" ? "Poder único" : "Poder", nome,
					selecionado: est.beneficios.includes(id),
					info: est.beneficios.includes(id) ? await this.#infoPoder(p) : null
				});
			}
			for (const g of def.grupos ?? []) {
				const id = `grupo:${g}`;
				const sel = est.beneficios.includes(id);
				const escolhido = est.grupos[g];
				beneficios.push({
					id, tipo: "Poder", nome: `Um poder de ${g}`,
					selecionado: sel,
					grupo: sel ? {
						campo: `${base}.grupos.${g}`,
						lista: `grupo:${g}`,
						titulo: `Escolha um poder de ${g}`,
						escolhido: escolhido ?? ""
					} : null,
					info: sel && escolhido ? await this.#infoPoder(poder(this.dados, escolhido)) : null
				});
			}
			const itens = (def.itens ?? []).map((it, i) => this.#ctxItemOrigem(it, i, est, base));
			let amnesico = null;
			if (def.especial === "amnesico") {
				const todas = Object.keys(CONFIG.T20?.pericias ?? {});
				const gerais = this.dados.poderes
					.filter((p) => p.system.tipo === "geral")
					.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
				amnesico = {
					lembrancas: await this.#infoPoder(poder(this.dados, "Lembranças Graduais")),
					pericia: {
						campo: `${base}.amnPericia`,
						lista: "pericia",
						titulo: "Perícia (escolhida pelo mestre)",
						escolhido: est.amnPericia ? rotuloPericia(est.amnPericia) : ""
					},
					poder: {
						campo: `${base}.amnPoder`,
						lista: "poderGeral",
						titulo: "Poder geral (escolhido pelo mestre)",
						escolhido: est.amnPoder ?? ""
					}
				};
			}
			info = {
				nome: def.nome,
				descricao: def.descricao ?? "",
				tibares: def.tibares ?? "",
				beneficios,
				qtdBeneficios: this.beneficiosPorOrigem,
				escolhidos: est.beneficios.length,
				campoBeneficios: `${base}.beneficios`,
				itens,
				amnesico
			};
		}
		return { origens, info, campoNome: `${base}.nome` };
	}

	#resumoOrigem(o) {
		if (o.especial === "amnesico") return "Perícia e poder escolhidos pelo mestre";
		const pericias = expandirPericias(o.pericias).filter((k) => !OFICIOS.includes(k)).map(rotuloPericia);
		if ((o.pericias ?? []).includes("oficio")) pericias.push("Ofício");
		return [...pericias, ...(o.poderes ?? []), ...(o.grupos ?? []).map((g) => `poder de ${g}`)].join(", ");
	}

	#ctxItemOrigem(it, i, est, base) {
		if (typeof it === "string") return { texto: it };
		if (it.nome) return { texto: it.qtd ? `${it.nome} (×${it.qtd})` : it.nome };
		if (it.texto) return { texto: it.texto };
		if (it.escolha || it.arma) {
			const partes = [...(it.escolha ?? [])];
			if (it.arma) partes.push(this.#rotuloArma(it));
			const rotulo = partes.join(" ou ");
			return {
				campo: `${base}.itens.${i}`,
				rotulo,
				lista: `nomes:${this.#opcoesItemOrigem(it).join("|")}`,
				titulo: `Escolha: ${rotulo}`,
				escolhido: est.itens[i] ?? ""
			};
		}
		return { texto: "?" };
	}

	#rotuloArma(it) {
		const nomesProf = { simples: "simples", marcial: "marcial", exotica: "exótica", fogo: "de fogo" };
		const prop = { distancia: " de ataque à distância", corpo: " corpo a corpo" }[it.proposito] ?? "";
		return `uma arma ${it.arma.map((p) => nomesProf[p] ?? p).join(" ou ")}${prop}`;
	}

	/** Nomes possíveis para um item de origem com escolha e/ou arma. */
	#opcoesItemOrigem(it) {
		const nomes = [...(it.escolha ?? [])];
		if (it.arma) {
			const ok = (a) => {
				const prop = String(a.system.proposito ?? "");
				if (it.proposito === "distancia") return /disparo|arremesso/.test(prop);
				if (it.proposito === "corpo") return prop.includes("corpo");
				return true;
			};
			nomes.push(...this.dados.armas.filter((a) => it.arma.includes(a.system.proficiencia) && ok(a)).map((a) => a.name));
		}
		return nomes;
	}

	async #ctxDevocao() {
		const e = this.estado;
		const r = this.regrasClasse;
		const obrig = this.devocaoForcada;
		const alt = this.alternativaDevocao;
		const devoto = this.ehDevoto;
		const divindades = this.dados.divindades.map((d) => {
			const impedimento = this.impedimentoDivindade(d);
			return { nome: d.nome, titulo: d.titulo, selecionado: d.nome === e.divindade, bloqueado: !!impedimento, impedimento };
		});
		// mostra primeiro as permitidas
		divindades.sort((a, b) => Number(a.bloqueado) - Number(b.bloqueado));
		let info = null;
		const div = this.dados.divindades.find((d) => d.nome === (this.focoDivindade || e.divindade));
		if (devoto && div) {
			const poderes = [];
			for (const nome of div.poderes) {
				const p = poder(this.dados, nome);
				poderes.push({
					nome,
					selecionado: e.poderesConcedidos.includes(nome),
					info: await this.#infoPoder(p)
				});
			}
			const impedimento = this.impedimentoDivindade(div);
			info = {
				nome: div.nome, titulo: div.titulo,
				descricao: div.descricao, crencas: div.crencas, simbolo: div.simbolo,
				energia: div.energia, arma: div.arma, devotosTexto: div.devotosTexto, obrigacoes: div.obrigacoes,
				escolhida: div.nome === e.divindade,
				impedimento,
				poderes, qtd: this.poderesConcedidosPermitidos(), escolhidos: e.poderesConcedidos.length
			};
		}
		const lista = r?.devocao?.divindades ? ` de ${r.devocao.divindades.join(", ")}` : "";
		return {
			obrigatoria: obrig,
			motivo: obrig ? `${this.classe.name}s precisam ser devotos${lista}.` : null,
			alternativa: alt ? {
				nome: alt.nome,
				descricao: alt.descricao,
				aviso: lista
					? `Se for devoto de um deus, ${this.classe.name.toLowerCase()}s só podem seguir${lista.replace(/^ de/, "")}.`
					: `Como devoto de um deus, você recebe ${this.poderesConcedidosPermitidos()} poder(es) concedido(s); como ${alt.nome}, nenhum.`
			} : null,
			devoto,
			naoDevoto: !obrig && e.devoto === false,
			divindades,
			info
		};
	}

	/** Dados resumidos de um equipamento do compêndio (para card e painel de detalhes). */
	#fichaEquip(nome) {
		const doc = equipamento(this.dados, nome);
		if (!doc) return { nome, img: "icons/svg/item-bag.svg", sub: "", stats: [] };
		const s = doc.system ?? {};
		const stats = [];
		const nomesProf = { simples: "Simples", marcial: "Marcial", exotica: "Exótica", fogo: "Fogo" };
		const nomesEmp = { leve: "Leve", uma: "Uma mão", duas: "Duas mãos" };
		if (doc.type === "arma") {
			const dano = s.rolls?.find((r) => r.type === "dano")?.parts?.[0];
			if (dano?.[0]) {
				const tipo = dano[1] ? game.i18n.localize(CONFIG.T20?.damageTypes?.[dano[1]] ?? dano[1]).toLowerCase() : "";
				stats.push(["Dano", `${dano[0]}${tipo ? ` ${tipo}` : ""}`]);
			}
			if (s.criticoM || s.criticoX) stats.push(["Crítico", `${s.criticoM && s.criticoM < 20 ? `${s.criticoM}/` : ""}x${s.criticoX ?? 2}`]);
			if (s.alcance && s.alcance !== "-") stats.push(["Alcance", s.alcance]);
			if (s.proficiencia) stats.push(["Proficiência", nomesProf[s.proficiencia] ?? s.proficiencia]);
			if (s.empunhadura) stats.push(["Empunhadura", nomesEmp[s.empunhadura] ?? s.empunhadura]);
		}
		if (s.armadura?.value) {
			stats.push(["Defesa", `+${s.armadura.value}`]);
			if (s.armadura.penalidade) stats.push(["Penalidade", `${s.armadura.penalidade}`]);
		}
		if (s.preco) stats.push(["Preço", `T$ ${s.preco}`]);
		if (s.espacos) stats.push(["Espaços", `${s.espacos}`]);
		const sub = stats.filter(([k]) => ["Dano", "Crítico", "Defesa", "Penalidade"].includes(k)).map(([, v]) => v).join(" · ");
		return { nome: doc.name, img: doc.img, sub, stats, doc };
	}

	async #ctxEquipamento() {
		const e = this.estado;
		const r = this.regrasClasse ?? {};
		const prof = r.proficiencias ?? [];
		const foco = this.focoEquip;
		const card = (nome, extra = {}) => {
			const f = this.#fichaEquip(nome);
			return { nome: f.nome, img: f.img, sub: f.sub, foco: nome === foco, ...extra };
		};

		// Arma
		const cats = ["simples", ...(prof.includes("marcial") ? ["marcial"] : [])];
		const nomesCat = { simples: "Armas simples", marcial: "Armas marciais" };
		const armas = cats.map((c) => ({
			titulo: nomesCat[c],
			cards: this.dados.armas.filter((a) => a.system.proficiencia === c)
				.map((a) => card(a.name, { campo: "equip.arma", valor: a.name, selecionado: e.equip.arma === a.name }))
		}));

		// Armadura
		const arm = this.dados.equipamento.armaduras ?? {};
		const armaduras = [
			{ nome: "Nenhuma", img: "icons/svg/cancel.svg", sub: "", campo: "equip.armadura", valor: "", selecionado: !e.equip.armadura },
			...[...(arm.leve ?? []), ...(prof.includes("pesada") ? arm.pesada ?? [] : [])]
				.map((n) => card(n, { campo: "equip.armadura", valor: n, selecionado: e.equip.armadura === n }))
		];

		// Escudo
		const nomeEscudo = this.dados.equipamento.escudo;
		const escudo = prof.includes("escudo") && nomeEscudo
			? card(nomeEscudo, { campo: "equip.escudo", valor: String(!e.equip.escudo), tipo: "bool", selecionado: !!e.equip.escudo })
			: null;

		// Itens que já recebe
		const recebidos = [];
		const grupo = (titulo, itens) => {
			if (itens.length) recebidos.push({ titulo, cards: itens.map((x) => card(x.nome, { qtd: x.qtd > 1 ? x.qtd : null })) });
		};
		grupo("Todo aventureiro", (this.dados.equipamento.kitBase ?? []).map((n) => ({ nome: n, qtd: 1 })));
		grupo(`Classe (${this.classe?.name ?? ""})`, (r.equipamentoExtra ?? []).map((n) => ({ nome: n, qtd: 1 })));
		for (const o of this.origensAtivas()) grupo(`Origem (${o.def.nome})`, this.#itensDaOrigem(o.def, o.estado));

		// Painel de detalhes
		let info = null;
		if (foco) {
			const f = this.#fichaEquip(foco);
			info = {
				nome: f.nome, img: f.img,
				stats: f.stats.map(([rotulo, valor]) => ({ rotulo, valor })),
				descricao: f.doc ? await this.#html(f.doc.uuid, f.doc.system?.description?.value) : ""
			};
		}
		return { armas, armaduras, escudo, recebidos, info };
	}

	/** Lista final de itens de uma origem: [{nome, qtd, texto?}] */
	#itensDaOrigem(def, est) {
		const out = [];
		(def.itens ?? []).forEach((it, i) => {
			if (typeof it === "string") out.push({ nome: it, qtd: 1 });
			else if (it.nome) out.push({ nome: it.nome, qtd: it.qtd ?? 1 });
			else if (it.texto) out.push({ nome: it.texto, qtd: 1, texto: true });
			else if ((it.escolha || it.arma) && est.itens[i]) out.push({ nome: est.itens[i], qtd: 1 });
		});
		return out;
	}

	#ctxRevisao() {
		const plano = this.plano();
		return {
			nome: this.estado.nome,
			plano,
			racaNome: plano.raca?.name ?? "—",
			dinheiroTexto: plano.gasto
				? `${ConstrutorFicha.formatarTibares(plano.dinheiroRolado)} rolados − ${ConstrutorFicha.formatarTibares(plano.gasto)} em compras = ${ConstrutorFicha.formatarTibares(plano.dinheiro)}`
				: ConstrutorFicha.formatarTibares(plano.dinheiro),
			classeNome: plano.classe?.name ?? "—",
			listaPericias: plano.pericias.map(rotuloPericia).join(", "),
			gruposPoderes: plano.gruposPoderes.filter((g) => g.poderes.length).map((g) => ({
				nome: g.nome,
				lista: g.poderes.map((p) => `${g.prefixo} - ${p.name}`).join(", ")
			})),
			listaMagias: plano.magias.map((m) => m.name).join(", "),
			listaItens: plano.itens.map((x) => (x.qtd > 1 ? `${x.nome} (×${x.qtd})` : x.nome)).join(", "),
			atributos: ATRIBUTOS.map((k) => ({ nome: NOMES_ATRIBUTOS[k], valor: sinal(this.atributoFinal(k)) }))
		};
	}

	/* ---------------- Plano final (usado na revisão e no aplicar) ---------------- */

	plano() {
		const e = this.estado;
		const r = this.regrasClasse ?? {};
		const raca = this.raca;
		const classe = this.classe;

		const poderesRaciais = [];
		for (const g of raca?.system.grants ?? []) {
			for (const c of g.choices ?? []) {
				const p = this.dados.poderes.find((x) => x.uuid === c.uuid);
				if (p) poderesRaciais.push(p);
			}
		}

		// Poderes separados pela fonte (ordem e prefixo usados na ficha)
		const vistos = new Set(poderesRaciais);
		const adicionar = (lista) => (nome) => {
			const p = poder(this.dados, nome);
			if (p && !vistos.has(p)) {
				vistos.add(p);
				lista.push(p);
			}
		};
		const poderesOrigem = [];
		const poderesConcedidos = [];
		const poderesClasse = [];

		const itens = [];
		const addOrigem = adicionar(poderesOrigem);
		for (const o of this.origensAtivas()) {
			for (const b of o.estado.beneficios) {
				if (b.startsWith("poder:")) addOrigem(b.slice(6));
				if (b.startsWith("grupo:") && o.estado.grupos[b.slice(6)]) addOrigem(o.estado.grupos[b.slice(6)]);
			}
			if (o.def.especial === "amnesico") {
				(o.def.poderes ?? []).forEach(addOrigem);
				if (o.estado.amnPoder) addOrigem(o.estado.amnPoder);
			}
			itens.push(...this.#itensDaOrigem(o.def, o.estado));
		}

		const devoto = this.ehDevoto;
		if (devoto) e.poderesConcedidos.forEach(adicionar(poderesConcedidos));

		const addClasse = adicionar(poderesClasse);
		(r.habilidades ?? []).forEach(addClasse);
		for (const esc of this.escolhasAtivas()) if (e.escolhasClasse[esc.id]) addClasse(e.escolhasClasse[esc.id]);

		const gruposPoderes = [
			{ prefixo: "R", nome: "Raciais", poderes: poderesRaciais, raciais: true },
			{ prefixo: "O", nome: "Origem", poderes: poderesOrigem },
			{ prefixo: "D", nome: "Concedidos", poderes: poderesConcedidos },
			{ prefixo: "1", nome: "Classe", poderes: poderesClasse }
		];
		const poderes = [...poderesOrigem, ...poderesConcedidos, ...poderesClasse];

		itens.unshift(
			...(this.dados.equipamento.kitBase ?? []).map((n) => ({ nome: n, qtd: 1 })),
			...(r.equipamentoExtra ?? []).map((n) => ({ nome: n, qtd: 1 }))
		);
		if (e.equip.arma) itens.push({ nome: e.equip.arma, qtd: 1 });
		if (e.equip.armadura) itens.push({ nome: e.equip.armadura, qtd: 1 });
		if (e.equip.escudo && (r.proficiencias ?? []).includes("escudo") && this.dados.equipamento.escudo) {
			itens.push({ nome: this.dados.equipamento.escudo, qtd: 1 });
		}

		for (const [nome, n] of Object.entries(e.compras ?? {})) {
			const it = this.itemLoja(nome);
			if (!it || n <= 0) continue;
			const pacote = Number(it.doc.system.qtd) > 1 ? Number(it.doc.system.qtd) : 1;
			itens.push({ nome, qtd: n * pacote, comprado: true });
		}

		const magias = this.conjurador ? this.dados.magias.filter((m) => e.magias.includes(m.uuid)) : [];

		let conjuracao = this.conjurador?.atributo ?? null;
		for (const esc of this.escolhasAtivas()) {
			const o = esc.opcoes.find((x) => x.poder === e.escolhasClasse[esc.id]);
			if (o?.conjuracao) conjuracao = o.conjuracao;
		}

		return {
			raca, classe, poderesRaciais, poderes, gruposPoderes, magias, itens,
			pericias: ordenarPericias([...this.periciasTreinadas()]),
			atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, { base: this.base(k) ?? 0, racial: this.racial(k) }])),
			origem: this.origensAtivas().map((o) => o.def.nome).join(" / "),
			divindade: this.textoDivindade,
			dinheiro: this.saldo,
			dinheiroRolado: e.dinheiro ?? 0,
			gasto: this.gastoCompras,
			conjuracao,
			nome: e.nome?.trim() || this.actor.name
		};
	}

	/* ---------------- Alteração de estado ---------------- */

	#aoAlterarCampo(el) {
		const campo = el.dataset.campo;
		let valor = el.type === "checkbox" ? el.checked : el.value;
		if (el.dataset.tipo === "numero") valor = Number(valor);
		this.#definirCampo(campo, valor);
	}

	/** Define um campo do estado aplicando as invalidações necessárias. */
	#definirCampo(campo, valor) {
		const e = this.estado;
		if (campo === "divindade") this.focoDivindade = "";
		const anterior = foundry.utils.getProperty(e, campo);
		foundry.utils.setProperty(e, campo, valor);
		if (anterior !== valor) {
			if (campo === "raca") e.racaAtributos = [];
			if (campo === "classe") {
				e.escolhasClasse = {};
				e.magiasEscolas = [];
				e.magias = [];
				e.periciasOu = [];
				e.periciasClasse = [];
				e.poderesConcedidos = [];
				e.divindade = "";
				e.devoto = null;
				e.equip = { arma: "", armadura: "", escudo: false };
			}
			if (campo.startsWith("escolhasClasse.")) {
				// trocar o caminho limpa subescolhas que deixaram de existir
				const validas = new Set(this.escolhasAtivas().map((x) => x.id));
				for (const k of Object.keys(e.escolhasClasse)) if (!validas.has(k)) delete e.escolhasClasse[k];
			}
			if (campo === "magiasEscolas") {
				const validas = new Set(this.magiasDisponiveis().map((m) => m.uuid));
				e.magias = e.magias.filter((u) => validas.has(u));
			}
			if (campo.startsWith("periciasOu")) {
				const ja = this.periciasTreinadas({ ate: "classe" });
				e.periciasClasse = e.periciasClasse.filter((k) => !ja.has(k));
			}
			if (/^origens\.\w+\.nome$/.test(campo)) {
				const sub = campo.split(".")[1];
				Object.assign(e.origens[sub], { beneficios: [], grupos: {}, itens: {}, amnPericia: "", amnPoder: "" });
			}
			if (campo === "divindade") e.poderesConcedidos = [];
			if (campo === "devoto" && valor === false) {
				e.divindade = "";
				e.poderesConcedidos = [];
			}
			if (campo === "atrModo" || campo === "atrFixo.arranjo") {
				this.dadoSelecionado = null;
				for (const k of ATRIBUTOS) e.atrFixo.atribuicao[k] = "";
			}
		}
		// perícias por Inteligência acima do permitido são descartadas
		const nInt = Math.max(0, this.atributoFinal("int"));
		if (e.periciasInt.length > nInt) e.periciasInt = e.periciasInt.slice(0, nInt);
		this.#mudou();
	}

	/* ---------------- Ações ---------------- */

	static #lojaCategoria(event, target) {
		this.lojaCategoria = target.dataset.valor;
		this.render();
	}

	static #focarLoja(event, target) {
		this.focoLoja = target.dataset.nome;
		this.render();
	}

	/** Compra (+1) ou devolve (−1) um item da loja, respeitando o saldo. */
	static #comprar(event, target) {
		const nome = target.dataset.nome;
		const delta = Number(target.dataset.delta);
		const it = this.itemLoja(nome);
		if (!it) return;
		const compras = { ...(this.estado.compras ?? {}) };
		const atual = compras[nome] ?? 0;
		if (delta > 0 && Number(it.doc.system.preco) > this.saldo) {
			return ui.notifications.warn(`Tibares insuficientes para comprar ${nome}.`);
		}
		const novo = Math.max(0, atual + delta);
		if (novo) compras[nome] = novo;
		else delete compras[nome];
		this.focoLoja = nome;
		this.estado.compras = compras;
		this.#mudou();
	}

	/** Clique num dado: seleciona (ou desseleciona) para depois clicar no atributo. */
	static #selecionarDado(event, target) {
		const i = Number(target.dataset.dado);
		const slot = target.closest("[data-soltar]")?.dataset.soltar;
		// outro dado já selecionado + clique num dado que está num atributo = troca
		if (this.dadoSelecionado !== null && this.dadoSelecionado !== i && slot) {
			return this.#moverDado(this.dadoSelecionado, slot);
		}
		this.dadoSelecionado = this.dadoSelecionado === i ? null : i;
		this.render();
	}

	/** Clique num atributo/monte com um dado selecionado. */
	static #colocarDado(event, target) {
		if (this.dadoSelecionado === null) return;
		this.#moverDado(this.dadoSelecionado, target.dataset.soltar);
	}

	static #abrirSlideout(event, target) {
		const { campo, lista, titulo } = target.dataset;
		const limite = Number(target.dataset.limite ?? Infinity);
		const atual = foundry.utils.getProperty(this.estado, campo) ?? "";
		const foco = Array.isArray(atual) ? "" : atual;
		this.slideout = { campo, lista, titulo, limite, foco, animar: true, filtro: "" };
		this.render();
	}

	static #fecharSlideout() {
		this.slideout = null;
		this.render();
	}

	static #focarSlideout(event, target) {
		if (!this.slideout) return;
		this.slideout.foco = target.dataset.valor;
		this.render();
	}

	static #confirmarSlideout(event, target) {
		if (!this.slideout) return;
		const { campo, limite } = this.slideout;
		const valor = target.dataset.valor ?? this.slideout.foco;
		const atual = foundry.utils.getProperty(this.estado, campo);
		// campo de lista (ex.: magias): adiciona o item em vez de substituir
		if (Array.isArray(atual)) {
			if (atual.includes(valor)) {
				this.slideout = null;
				return this.render();
			}
			if (atual.length >= limite) return ui.notifications.info(`Você já escolheu ${limite}. Remova uma para trocar.`);
			this.slideout = null;
			if (campo === "magias") {
				this.focoMagia = valor;
				this.focoEscola = "";
			}
			return this.#definirCampo(campo, [...atual, valor]);
		}
		this.slideout = null;
		this.#definirCampo(campo, valor);
	}

	static #avancar() {
		this.slideout = null;
		const passos = this.passos();
		const pend = this.pendencia(passos[this.indice]);
		if (pend) return ui.notifications.warn(pend);
		this.indice = Math.min(this.indice + 1, passos.length - 1);
		this.estado.alcancado = Math.max(this.estado.alcancado, this.indice);
		this.#mudou();
	}

	static #voltar() {
		this.slideout = null;
		this.indice = Math.max(0, this.indice - 1);
		this.render();
	}

	static #irPara(event, target) {
		const i = Number(target.dataset.indice);
		if (i <= this.estado.alcancado) {
			this.slideout = null;
			this.indice = i;
			this.render();
		}
	}

	static #definir(event, target) {
		let valor = target.dataset.valor;
		if (target.dataset.tipo === "numero") valor = Number(valor);
		if (target.dataset.tipo === "bool") valor = valor === "true";
		this.#definirCampo(target.dataset.campo, valor);
	}

	static #alternar(event, target) {
		const { campo, valor } = target.dataset;
		const limite = Number(target.dataset.limite ?? Infinity);
		const lista = [...(foundry.utils.getProperty(this.estado, campo) ?? [])];
		const i = lista.indexOf(valor);
		if (i >= 0) lista.splice(i, 1);
		else {
			if (lista.length >= limite) {
				if (limite === 1) lista.splice(0, 1);
				else return ui.notifications.info(`Você já escolheu ${limite}. Desmarque uma opção para trocar.`);
			}
			lista.push(valor);
		}
		// desmarcar um benefício de grupo limpa o poder escolhido nele
		if (campo.endsWith(".beneficios") && i >= 0 && valor.startsWith("grupo:")) {
			const sub = campo.split(".")[1];
			delete this.estado.origens[sub].grupos[valor.slice(6)];
		}
		this.#definirCampo(campo, lista);
	}

	static #ajustarPonto(event, target) {
		const k = target.dataset.atributo;
		const delta = Number(target.dataset.delta);
		const v = Math.clamp((this.estado.atrPontos[k] ?? 0) + delta, MIN_PONTOS, MAX_PONTOS);
		this.#definirCampo(`atrPontos.${k}`, v);
	}

	static async #rolarAtributos() {
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
		this.#mudou();
	}

	static async #rerrolarMenor() {
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
		this.#mudou();
	}

	static #focarEscola(event, target) {
		this.focoEscola = target.dataset.valor;
		this.focoMagia = "";
		this.render();
	}

	static #focarDivindade(event, target) {
		this.focoDivindade = target.dataset.valor;
		this.render();
	}

	static #focarPericia(event, target) {
		this.focoPericia = target.dataset.valor;
		this.render();
	}

	/** Seleciona/desmarca uma perícia e mostra os detalhes dela. */
	static #escolherPericia(event, target) {
		const { campo, valor, modo } = target.dataset;
		this.focoPericia = valor;
		if (modo === "unica") {
			const atual = foundry.utils.getProperty(this.estado, campo);
			return this.#definirCampo(campo, atual === valor ? "" : valor);
		}
		return ConstrutorFicha.#alternar.call(this, event, target);
	}

	static #focarEquip(event, target) {
		this.focoEquip = target.dataset.nome;
		this.render();
	}

	/** Escolhe um equipamento e mostra os detalhes dele no painel. */
	static #escolherEquip(event, target) {
		const { campo, nome } = target.dataset;
		let valor = target.dataset.valor;
		if (target.dataset.tipo === "bool") valor = valor === "true";
		if (nome && nome !== "Nenhuma") this.focoEquip = nome;
		this.#definirCampo(campo, valor);
	}

	static #focarMagia(event, target) {
		this.focoMagia = target.dataset.uuid;
		this.focoEscola = "";
		this.render();
	}

	static async #rolarDinheiro() {
		if (this.estado.dinheiro !== null) return;
		const extras = this.origensAtivas().map((o) => o.def.tibares).filter(Boolean);
		const roll = await new Roll(["4d6", ...extras].join(" + ")).evaluate();
		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			flavor: `Construtor de Personagem — tibares iniciais (T$)${extras.length ? ` (4d6 + ${extras.join(" + ")} da origem)` : ""}`
		});
		this.estado.dinheiro = roll.total;
		this.#mudou();
	}

	static async #recomecar() {
		const ok = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Recomeçar" },
			content: "<p>Descartar todas as escolhas e começar de novo? Rolagens já feitas também serão descartadas.</p>"
		});
		if (!ok) return;
		this.estado = estadoInicial(this.actor);
		const modos = this.modosPermitidos();
		if (modos.length === 1) this.estado.atrModo = modos[0];
		this.indice = 0;
		this.#mudou();
	}

	static async #finalizar(event, target) {
		const pend = this.pendencia({ id: "revisao" });
		if (pend) return ui.notifications.warn(pend);
		if (this.actor.items.some((i) => i.type === "race" || i.type === "classe")) {
			return ui.notifications.error("Esta ficha já tem raça ou classe. Remova-as antes de usar o construtor.");
		}
		target.disabled = true;
		try {
			await aplicarNaFicha(this.actor, this.plano(), this.dados);
			ui.notifications.info(`${this.actor.name} está pronto para a aventura!`);
			await this.close();
			this.actor.sheet.render(true);
		} catch (err) {
			console.error(`${MODULE_ID} |`, err);
			ui.notifications.error(`Erro ao criar a ficha: ${err.message}`);
			target.disabled = false;
		}
	}
}
