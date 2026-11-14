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
].map((p) => `${TPL}/passos/${p}.hbs`).concat(`${TPL}/partes/poder.hbs`, `${TPL}/partes/abrir.hbs`);

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
		dinheiro: null
	};
}

async function enriquecer(html) {
	return foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { async: true });
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
		/** Slideout aberto: { campo, lista, titulo, foco, animar, filtro } */
		this.slideout = null;
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
			fecharSlideout: ConstrutorFicha.#fecharSlideout,
			focarSlideout: ConstrutorFicha.#focarSlideout,
			confirmarSlideout: ConstrutorFicha.#confirmarSlideout,
			focarPericia: ConstrutorFicha.#focarPericia,
			escolherEquip: ConstrutorFicha.#escolherEquip,
			rolarDinheiro: ConstrutorFicha.#rolarDinheiro,
			finalizar: ConstrutorFicha.#finalizar,
			recomecar: ConstrutorFicha.#recomecar
		}
	};

	static PARTS = {
		main: {
			template: `${TPL}/wizard.hbs`,
			scrollable: [".cf-lista", ".cf-info", ".cf-conteudo", ".cf-slideout .cf-lista", ".cf-slideout .cf-info"]
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

	divindadesDisponiveis() {
		const r = this.regrasClasse;
		const raca = this.raca?.name;
		const classe = this.classe?.name;
		return this.dados.divindades.filter((d) => {
			if (r?.devocao?.divindades && !r.devocao.divindades.includes(d.nome)) return false;
			const dev = d.devotos ?? {};
			if (dev.racas?.length && raca && !dev.racas.includes(raca)) return false;
			if (dev.classes?.length && classe && !dev.classes.includes(classe)) return false;
			return true;
		});
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
				const obrig = this.regrasClasse?.devocao?.obrigatoria;
				if (e.devoto === null && !obrig) return "Responda se o personagem é devoto.";
				if (!e.devoto && !obrig) return null;
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
		const cards = this.#opcoesSlideout(so.lista).map((c) => ({
			...c,
			selecionado: c.valor === atual,
			foco: c.valor === so.foco
		}));
		const info = so.foco ? await this.#infoSlideout(so.lista, so.foco) : null;
		if (info) {
			info.valor = so.foco;
			info.jaEscolhido = so.foco === atual;
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
		if (e.devoto && e.divindade) linhas.push(["Divindade", e.divindade]);
		if (e.dinheiro !== null) linhas.push(["Tibares", `T$ ${e.dinheiro}`]);
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
			case "dinheiro": return { dinheiro: this.estado.dinheiro, rolado: this.estado.dinheiro !== null };
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
		const campoAtr = e.atrModo === "rolagem" ? "atrRolagem.atribuicao" : "atrFixo.atribuicao";
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
				linha.campo = `${campoAtr}.${k}`;
				linha.opcoes = valores.map((v, i) => ({
					indice: String(i), texto: sinal(v), selecionado: String(atribuicao[k]) === String(i)
				}));
			}
			return linha;
		});
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
					? `Devoto obrigatório${r.devocao.divindades ? ` (${r.devocao.divindades.join(", ")})` : ""}`
					: null,
				descricao: await this.#html(c.uuid, c.system.description?.value),
				habilidades,
				escolhas,
				semRegras: !this.regrasClasse
			};
		}
		return { classes, info };
	}

	async #ctxMagias() {
		const e = this.estado;
		const c = this.conjurador;
		const tipos = c.tipo === "arc" ? ["arc", "uni"] : ["div", "uni"];
		const escolas = Object.keys(CONFIG.T20?.spellSchools ?? {}).map((k) => ({
			chave: k, nome: rotuloEscola(k), selecionado: e.magiasEscolas.includes(k)
		}));
		const filtrarEscola = c.escolas > 0;
		const disponiveis = this.dados.magias.filter((m) =>
			m.system.circulo === 1
			&& tipos.includes(m.system.tipo)
			&& (!filtrarEscola || e.magiasEscolas.includes(m.system.escola)));
		const magias = disponiveis.map((m) => ({
			uuid: m.uuid, nome: m.name, img: m.img,
			escola: rotuloEscola(m.system.escola),
			tipo: m.system.tipo === "uni" ? "Universal" : (m.system.tipo === "arc" ? "Arcana" : "Divina"),
			selecionado: e.magias.includes(m.uuid),
			foco: m.uuid === this.focoMagia
		}));
		const foco = disponiveis.find((m) => m.uuid === this.focoMagia);
		return {
			conj: c,
			escolas: filtrarEscola ? escolas : null,
			qtdEscolas: c.escolas,
			magias,
			qtd: c.quantidade,
			escolhidas: e.magias.length,
			foco: foco ? {
				uuid: foco.uuid,
				nome: foco.name, img: foco.img,
				escola: rotuloEscola(foco.system.escola),
				selecionado: e.magias.includes(foco.uuid),
				descricao: await this.#html(foco.uuid, foco.system.description?.value)
			} : null,
			precisaEscolas: filtrarEscola && e.magiasEscolas.length !== c.escolas
		};
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
				beneficios.push({
					id, tipo: "Perícia", nome: rotuloPericia(k),
					selecionado: est.beneficios.includes(id),
					bloqueado: treinadas.has(k) && !est.beneficios.includes(id)
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
		if (it.escolha) {
			return {
				campo: `${base}.itens.${i}`,
				rotulo: it.escolha.join(" ou "),
				lista: `nomes:${it.escolha.join("|")}`,
				titulo: `Escolha: ${it.escolha.join(" ou ")}`,
				escolhido: est.itens[i] ?? ""
			};
		}
		if (it.arma) {
			const nomesProf = { simples: "simples", marcial: "marcial", exotica: "exótica", fogo: "de fogo" };
			const rotulo = `Arma ${it.arma.map((p) => nomesProf[p] ?? p).join(" ou ")}`;
			return {
				campo: `${base}.itens.${i}`,
				rotulo,
				lista: `arma:${it.arma.join(",")}`,
				titulo: `Escolha: ${rotulo.toLowerCase()}`,
				escolhido: est.itens[i] ?? ""
			};
		}
		return { texto: "?" };
	}

	async #ctxDevocao() {
		const e = this.estado;
		const r = this.regrasClasse;
		const obrig = !!r?.devocao?.obrigatoria;
		const devoto = obrig || e.devoto === true;
		const divindades = this.divindadesDisponiveis().map((d) => ({
			nome: d.nome, titulo: d.titulo, selecionado: d.nome === e.divindade
		}));
		let info = null;
		const div = this.dados.divindades.find((d) => d.nome === e.divindade);
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
			info = { nome: div.nome, titulo: div.titulo, poderes, qtd: this.poderesConcedidosPermitidos(), escolhidos: e.poderesConcedidos.length };
		}
		return {
			obrigatoria: obrig,
			motivo: obrig ? `${this.classe.name}s precisam ser devotos${r.devocao.divindades ? ` de ${r.devocao.divindades.join(", ")}` : ""}.` : null,
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
			classeNome: plano.classe?.name ?? "—",
			listaPericias: plano.pericias.map(rotuloPericia).join(", "),
			listaPoderes: plano.poderes.map((p) => p.name).join(", "),
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

		const poderes = [];
		const add = (nome) => { const p = poder(this.dados, nome); if (p && !poderes.includes(p)) poderes.push(p); };
		(r.habilidades ?? []).forEach(add);
		for (const esc of this.escolhasAtivas()) if (e.escolhasClasse[esc.id]) add(e.escolhasClasse[esc.id]);

		const itens = [];
		for (const o of this.origensAtivas()) {
			for (const b of o.estado.beneficios) {
				if (b.startsWith("poder:")) add(b.slice(6));
				if (b.startsWith("grupo:") && o.estado.grupos[b.slice(6)]) add(o.estado.grupos[b.slice(6)]);
			}
			if (o.def.especial === "amnesico") {
				(o.def.poderes ?? []).forEach(add);
				if (o.estado.amnPoder) add(o.estado.amnPoder);
			}
			itens.push(...this.#itensDaOrigem(o.def, o.estado));
		}

		const devoto = !!(r.devocao?.obrigatoria || e.devoto);
		if (devoto) e.poderesConcedidos.forEach(add);

		itens.unshift(
			...(this.dados.equipamento.kitBase ?? []).map((n) => ({ nome: n, qtd: 1 })),
			...(r.equipamentoExtra ?? []).map((n) => ({ nome: n, qtd: 1 }))
		);
		if (e.equip.arma) itens.push({ nome: e.equip.arma, qtd: 1 });
		if (e.equip.armadura) itens.push({ nome: e.equip.armadura, qtd: 1 });
		if (e.equip.escudo && (r.proficiencias ?? []).includes("escudo") && this.dados.equipamento.escudo) {
			itens.push({ nome: this.dados.equipamento.escudo, qtd: 1 });
		}

		const magias = this.conjurador ? this.dados.magias.filter((m) => e.magias.includes(m.uuid)) : [];

		let conjuracao = this.conjurador?.atributo ?? null;
		for (const esc of this.escolhasAtivas()) {
			const o = esc.opcoes.find((x) => x.poder === e.escolhasClasse[esc.id]);
			if (o?.conjuracao) conjuracao = o.conjuracao;
		}

		return {
			raca, classe, poderesRaciais, poderes, magias, itens,
			pericias: ordenarPericias([...this.periciasTreinadas()]),
			atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, { base: this.base(k) ?? 0, racial: this.racial(k) }])),
			origem: this.origensAtivas().map((o) => o.def.nome).join(" / "),
			divindade: devoto ? e.divindade : "",
			dinheiro: e.dinheiro ?? 0,
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
			if (campo === "magiasEscolas") e.magias = [];
			if (campo.startsWith("periciasOu")) {
				const ja = this.periciasTreinadas({ ate: "classe" });
				e.periciasClasse = e.periciasClasse.filter((k) => !ja.has(k));
			}
			if (/^origens\.\w+\.nome$/.test(campo)) {
				const sub = campo.split(".")[1];
				Object.assign(e.origens[sub], { beneficios: [], grupos: {}, itens: {}, amnPericia: "", amnPoder: "" });
			}
			if (campo === "divindade") e.poderesConcedidos = [];
			if (campo === "atrModo" || campo === "atrFixo.arranjo") {
				for (const k of ATRIBUTOS) e.atrFixo.atribuicao[k] = "";
			}
		}
		// perícias por Inteligência acima do permitido são descartadas
		const nInt = Math.max(0, this.atributoFinal("int"));
		if (e.periciasInt.length > nInt) e.periciasInt = e.periciasInt.slice(0, nInt);
		this.#mudou();
	}

	/* ---------------- Ações ---------------- */

	static #abrirSlideout(event, target) {
		const { campo, lista, titulo } = target.dataset;
		const atual = foundry.utils.getProperty(this.estado, campo) ?? "";
		this.slideout = { campo, lista, titulo, foco: atual, animar: true, filtro: "" };
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
		const { campo } = this.slideout;
		const valor = target.dataset.valor ?? this.slideout.foco;
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
		this.render();
	}

	static async #rolarDinheiro() {
		if (this.estado.dinheiro !== null) return;
		const roll = await new Roll("4d6").evaluate();
		await roll.toMessage({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			flavor: "Construtor de Personagem — tibares iniciais (T$)"
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
