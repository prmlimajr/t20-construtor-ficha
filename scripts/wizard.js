/**
 * Janela do construtor de ficha (ApplicationV2). Mantém todo o estado em memória
 * (com rascunho salvo numa flag do ator) e só grava a ficha no "Finalizar".
 */
import {
	MODULE_ID, ATRIBUTOS, PONTOS_TOTAIS, normalizar, sinal
} from "./regras.js";
import { carregarDados, dadosCarregados } from "./dados.js";
import { carregarDadosNivel, leitorPreRequisitos } from "./dados-nivel.js";
import { aplicarNaFicha } from "./aplicar.js";
import { ModeloConstrutor } from "./construtor/modelo.js";
import { MODULOS_PASSOS, PASSO_POR_ID } from "./construtor/passos/index.js";
import * as cartoes from "./construtor/apoio/cartoes.js";
import * as slideout from "./construtor/apoio/slideout.js";
import * as loja from "./construtor/apoio/loja.js";
import * as arrastar from "./construtor/apoio/arrastar.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TPL = `modules/${MODULE_ID}/templates`;

/**
 * Telas que entram na janela: a de cada passo (construtor/passos) e as de apoio (construtor/apoio).
 * Métodos de instância viram métodos da janela; métodos estáticos viram ações (data-action).
 */
const TELAS = [...MODULOS_PASSOS, cartoes, slideout, loja, arrastar].map((m) => m.Tela);
const estaticos = (Tela) => Object.getOwnPropertyNames(Tela).filter((n) => typeof Tela[n] === "function" && !["length", "name", "prototype"].includes(n));

export const TEMPLATES_PASSOS = [
	"raca", "atributos", "classe", "magias", "pericias", "origem", "devocao", "complicacoes", "idade", "equipamento", "dinheiro", "revisao"
].map((p) => `${TPL}/passos/${p}.hbs`).concat(`${TPL}/partes/poder.hbs`, `${TPL}/partes/abrir.hbs`, `${TPL}/partes/aprimoramentos.hbs`, `${TPL}/partes/escolha-racial.hbs`, `${TPL}/partes/poder-escolha.hbs`, `${TPL}/partes/venda.hbs`, `${TPL}/partes/poder-selecionavel.hbs`);

function estadoInicial(actor) {
	const zeros = Object.fromEntries(ATRIBUTOS.map((k) => [k, 0]));
	const vazio = Object.fromEntries(ATRIBUTOS.map((k) => [k, ""]));
	const origem = () => ({ nome: "", beneficios: [], grupos: {}, escolhasPoder: {}, itens: {}, amnPericia: "", amnPoder: "" });
	return {
		versao: 1,
		alcancado: 0,
		nome: actor.name,
		raca: "",
		racaAtributos: [],
		/** Raças abertas (regra opcional do sistema): atributo escolhido para cada modificador da raça, na ordem de modificadoresRaca(). */
		racaAbertos: [],
		/** Escolhas das habilidades raciais (data/racas.json), por id. Zeradas ao trocar de raça. */
		racaEscolhas: {},
		/** Escolhas das habilidades de classe (data/poderes-classe.json), por id. Zeradas ao trocar de classe. */
		classePoderEscolhas: {},
		atrModo: "",
		atrPontos: { ...zeros },
		atrPontosTotal: PONTOS_TOTAIS,
		atrRolagem: { brutos: null, valores: null, rerrolou: false, atribuicao: { ...vazio } },
		atrFixo: { arranjo: 0, atribuicao: { ...vazio } },
		/** Atributos Variados (regra opcional): estado de cada método. */
		atrVariados: {
			classica: { brutos: null, valores: null, atribuicao: { ...vazio } },
			epica: { brutos: null, valores: null, atribuicao: { ...vazio } },
			nimb: { brutos: null, descartado: null, valores: null, atribuicao: { ...vazio } },
			khalmyr: { atribuicao: { ...vazio } },
			// 7 dados; atribuicao[i] = atributo que recebeu o dado i ("" = ainda no monte)
			valkaria: { dados: null, atribuicao: ["", "", "", "", "", "", ""] }
		},
		classe: "",
		escolhasClasse: {},
		magiasEscolas: [],
		magias: [],
		periciasOu: [],
		/** Classes de suplemento sem perícias cadastradas: perícias treinadas da classe indicadas pelo jogador. */
		periciasFixasManuais: [],
		periciasClasse: [],
		periciasInt: [],
		origens: { principal: origem(), regional: origem() },
		devoto: null,
		divindade: "",
		devocaoEscolhas: {},
		poderesConcedidos: [],
		/** Devoto fundamentalista: um poder concedido a mais; a ficha registra "(fundamentalista)". */
		fundamentalista: false,
		/** Complicação escolhida (uuid; no máximo uma) e o poder geral que ela concede. */
		complicacoes: [],
		complicacaoPoder: "",
		/** Idades Variadas (regra opcional): faixa etária, idade em anos, complicações de idade e o poder geral do adulto. */
		idade: { faixa: "jovem", anos: "", complicacoes: [], poderGeral: "" },
		equip: { arma: "", armaMarcial: "", armadura: "" },
		dinheiro: null,
		compras: {},
		/** Nomes dos itens iniciais vendidos (um por entrada; metade do preço vira tibares). */
		vendas: [],
		/** Retrato e token ("" = manter os do ator). tokenIgual: o token usa o retrato. */
		img: "",
		tokenImg: "",
		tokenIgual: true
	};
}

/* ==================================================================== */

export class ConstrutorFicha extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(actor, options = {}) {
		super({ id: `t20cf-${actor.id}`, ...options });
		/** Regra do construtor (sem tela): estado, dados derivados, pendências e plano. */
		this.modelo = new ModeloConstrutor(actor);
		this.actor = actor;
		this.dados = null;
		this.estado = null;
		this.indice = 0;
		this.focoMagia = "";
		this.focoEquip = "";
		this.focoPericia = "";
		this.focoPericiaCampo = "";
		this.focoDivindade = "";
		this.focoEscola = "";
		/** Slideout aberto: { campo, lista, titulo, foco, animar, filtro } */
		this.slideout = null;
		/** Dado escolhido por clique (alternativa ao arrastar). */
		this.dadoSelecionado = null;
		this.lojaTipo = "Armas e munições";
		this.lojaCategoria = "Armas simples";
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
			alternar: ConstrutorFicha.alternar,
			escolherImagem: ConstrutorFicha.#escolherImagem,
			finalizar: ConstrutorFicha.#finalizar,
			recomecar: ConstrutorFicha.#recomecar,
			tentarDeNovo: ConstrutorFicha.#tentarDeNovo,
			// ações das telas dos passos e de apoio
			...Object.fromEntries(TELAS.flatMap((Tela) => estaticos(Tela).map((n) => [n, Tela[n]])))
		}
	};

	static PARTS = {
		main: {
			template: `${TPL}/wizard.hbs`,
			scrollable: [".cf-lista", ".cf-info", ".cf-conteudo", ".cf-slideout .cf-lista", ".cf-slideout .cf-info", ".cf-loja .cf-lista", ".cf-loja .cf-info"]
		}
	};

	/* Campos da regra, guardados no modelo (a janela e o modelo veem o mesmo estado). */
	get dados() { return this.modelo.dados; }
	set dados(v) { this.modelo.dados = v; }
	get estado() { return this.modelo.estado; }
	set estado(v) { this.modelo.estado = v; }
	get dadosNivel() { return this.modelo.dadosNivel; }
	set dadosNivel(v) { this.modelo.dadosNivel = v; }
	get lerPreRequisito() { return this.modelo.lerPreRequisito; }
	set lerPreRequisito(v) { this.modelo.lerPreRequisito = v; }

	get title() {
		return `Construtor de Personagem — ${this.actor.name}`;
	}

	/* ---------------- Ciclo de vida ---------------- */

	/**
	 * Carrega dados e rascunho uma única vez. Chamado no início de _prepareContext, porque o
	 * ApplicationV2 prepara o contexto antes de _preFirstRender.
	 */
	async #inicializar() {
		if (this.dados && this.estado) return;
		this.dados = await carregarDados();
		// pré-requisitos dos poderes gerais (mesmo leitor do assistente de subir de nível); sem eles, as
		// listas só não são filtradas
		try {
			this.dadosNivel = await carregarDadosNivel();
			this.lerPreRequisito = leitorPreRequisitos(this.dados, this.dadosNivel.correcoes);
		} catch (err) {
			console.warn(`${MODULE_ID} | pré-requisitos dos poderes indisponíveis:`, err);
			this.lerPreRequisito = null;
		}
		const salvo = this.actor.getFlag(MODULE_ID, "rascunho");
		let estado = null;
		if (salvo) {
			try { estado = JSON.parse(salvo); } catch (err) { estado = null; }
		}
		this.estado = foundry.utils.mergeObject(estadoInicial(this.actor), estado ?? {}, { inplace: false });
		this.limparReferencias();
		this.prepararEscolhasRaciais();
		const modos = this.modosPermitidos();
		if (!modos.includes(this.estado.atrModo)) this.estado.atrModo = modos.length === 1 ? modos[0] : "";
		this.indice = Math.min(this.estado.alcancado ?? 0, this.passos().length - 1);
	}

	async _prepareContext(options) {
		// primeira abertura: mostra a tela de carregamento na hora e carrega os compêndios em segundo plano
		if (!this.dados || !this.estado) {
			// depois de uma falha, não tenta de novo sozinho (evita repetir o erro em loop): espera o botão
			if (this._erroCarregamento) return { carregando: true, erro: this._erroCarregamento };
			if (!dadosCarregados()) {
				this._carregando ??= this.#inicializar()
					.then(() => { this._erroCarregamento = null; })
					.catch((err) => {
						console.error(`${MODULE_ID} |`, err);
						this._erroCarregamento = err.message ?? String(err);
					})
					.finally(() => {
						this._carregando = null;
						if (this.rendered) this.render();
					});
				return { carregando: true, erro: this._erroCarregamento };
			}
		}
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
		ctx.slideout = await this.ctxSlideout();
		return ctx;
	}

	_onRender(context, options) {
		super._onRender(context, options);
		// a tela de carregamento foi desenhada depois de os dados ficarem prontos: desenha o construtor
		if (context.carregando) {
			if (!this._carregando && !context.erro) this.render();
			return;
		}
		this.ativarArrastar();
		const filtro = this.element.querySelector(".cf-slideout .cf-filtro");
		if (filtro) {
			const aplicar = () => {
				const termo = normalizar(filtro.value);
				if (this.slideout) this.slideout.filtro = filtro.value;
				for (const card of this.element.querySelectorAll(".cf-slideout .cf-card")) {
					card.hidden = !!termo && !normalizar(card.dataset.busca).includes(termo);
				}
				// lista por categoria: some o título da categoria sem resultado
				for (const grupo of this.element.querySelectorAll(".cf-slideout .cf-grupo")) {
					grupo.hidden = ![...grupo.querySelectorAll(".cf-card")].some((c) => !c.hidden);
				}
			};
			filtro.addEventListener("input", aplicar);
			aplicar();
			if (context.slideout?.animar) filtro.focus();
		}
		// busca em listas agrupadas (ex.: raças): esconde cards e grupos sem resultado
		const filtroLista = this.element.querySelector(".cf-lista-filtravel .cf-filtro-lista");
		if (filtroLista) {
			const lista = filtroLista.closest(".cf-lista-filtravel");
			const aplicar = () => {
				const termo = normalizar(filtroLista.value);
				this.filtros ??= {};
				this.filtros[filtroLista.dataset.filtro ?? "raca"] = filtroLista.value;
				let total = 0;
				for (const grupo of lista.querySelectorAll(".cf-grupo")) {
					let visiveis = 0;
					for (const card of grupo.querySelectorAll(".cf-card")) {
						card.hidden = !!termo && !normalizar(card.dataset.busca ?? card.textContent).includes(termo);
						if (!card.hidden) visiveis++;
					}
					grupo.hidden = !visiveis;
					total += visiveis;
				}
				lista.querySelector(".cf-sem-resultado").hidden = total > 0;
			};
			filtroLista.addEventListener("input", aplicar);
			aplicar();
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
		// cartões selecionáveis: Enter/Espaço marcam; links dentro da descrição não marcam o cartão
		for (const card of this.element.querySelectorAll(".cf-poder-card[data-action]")) {
			card.addEventListener("keydown", (ev) => {
				if (ev.target !== card || !["Enter", " "].includes(ev.key)) return;
				ev.preventDefault();
				card.click();
			});
			for (const link of card.querySelectorAll(".cf-descricao a")) link.addEventListener("click", (ev) => ev.stopPropagation());
		}
		for (const el of this.element.querySelectorAll("input[data-campo], select[data-campo]")) {
			el.addEventListener("change", (ev) => this.#aoAlterarCampo(ev.currentTarget));
		}
	}

	#salvarRascunho() {
		if (!this.actor.isOwner || !this.estado) return;
		return this.actor.setFlag(MODULE_ID, "rascunho", JSON.stringify(this.estado));
	}

	mudou() {
		this._salvarRascunho();
		this.render();
	}

	/* ---------------- Tibares (usado pela loja, pela venda e pela barra lateral) ---------------- */

	static formatarTibares(v) {
		const n = Math.round(Number(v) * 100) / 100;
		return `T$ ${Number.isInteger(n) ? n : n.toFixed(2).replace(".", ",")}`;
	}

	/* ---------------- Barra lateral e contexto do passo ---------------- */

	#resumoLateral() {
		const e = this.estado;
		const linhas = [];
		if (this.raca) linhas.push(["Raça", this.raca.name]);
		if (this.classe) linhas.push(["Classe", this.classe.name]);
		const origens = this.origensAtivas().map((o) => o.def.nome);
		if (origens.length) linhas.push(["Origem", origens.join(" / ")]);
		if (this.textoDivindade) linhas.push(["Divindade", this.textoDivindade]);
		if (this.faixaIdade) linhas.push(["Idade", this.faixaIdade.nome + (Number(e.idade?.anos) > 0 ? ` (${Number(e.idade.anos)} anos)` : "")]);
		if (e.dinheiro !== null) linhas.push(["Tibares", ConstrutorFicha.formatarTibares(this.saldo)]);
		const atributos = e.atrModo
			? ATRIBUTOS.map((k) => ({ sigla: k.toUpperCase(), valor: sinal(this.atributoFinal(k)) }))
			: null;
		return { linhas: linhas.map(([rotulo, valor]) => ({ rotulo, valor })), atributos };
	}

	/** Dados do template do passo atual (cada passo tem o seu arquivo em construtor/passos). */
	async #contextoPasso(passo) {
		const p = PASSO_POR_ID[passo.id];
		return p ? p.contexto.call(this, passo) : {};
	}

	/* ---------------- Alteração de estado ---------------- */

	#aoAlterarCampo(el) {
		const campo = el.dataset.campo;
		let valor = el.type === "checkbox" ? el.checked : el.value;
		if (el.dataset.tipo === "numero") valor = Number(valor);
		this.definirCampo(campo, valor);
	}

	/**
	 * Define um campo do estado: a regra (invalidações em cascata, ver construtor/cascata.js) fica no
	 * modelo; aqui só o que é de tela (foco, dado selecionado, passo atual) e o redesenho.
	 */
	definirCampo(campo, valor) {
		// passo atual antes da mudança: se passos surgirem ou sumirem (ex.: criança fica sem origem),
		// o construtor continua no mesmo passo em vez de pular para o que ficou no mesmo índice
		const passoAntes = this.passos()[this.indice];
		if (campo === "divindade") this.focoDivindade = "";
		const mudou = this.modelo.definirCampo(campo, valor);
		if (mudou && (campo === "atrModo" || campo === "atrFixo.arranjo")) this.dadoSelecionado = null;
		this.#manterPasso(passoAntes);
		this.mudou();
	}

	/** Reposiciona o índice no mesmo passo (id e sub) depois que a lista de passos mudou. */
	#manterPasso(passoAntes) {
		if (!passoAntes) return;
		const passos = this.passos();
		const novo = passos.findIndex((p) => p.id === passoAntes.id && (p.sub ?? null) === (passoAntes.sub ?? null));
		if (novo < 0 || novo === this.indice) return;
		const delta = novo - this.indice;
		this.indice = novo;
		this.estado.alcancado = Math.min(passos.length - 1, Math.max(novo, (this.estado.alcancado ?? 0) + delta));
	}

	/* ---------------- Ações ---------------- */

	/** Abre o navegador de arquivos do Foundry para o retrato ("img") ou o token ("tokenImg"). */
	static async #escolherImagem(event, target) {
		const campo = target.dataset.campo;
		const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
		if (!FP) return ui.notifications.warn("Navegador de arquivos indisponível; cole o caminho da imagem no campo.");
		const atual = campo === "img" ? this.imagens.img : this.imagens.token;
		const fp = new FP({
			type: "image",
			current: atual,
			callback: (caminho) => this.definirCampo(campo, caminho)
		});
		try {
			await fp.browse(atual);
		} catch (err) {
			// jogadores sem a permissão "Navegar por arquivos" não abrem o navegador
			return ui.notifications.warn("Você não tem permissão para navegar pelos arquivos. Cole o caminho da imagem no campo.");
		}
	}

	static #avancar() {
		this.slideout = null;
		const passos = this.passos();
		const pend = this.pendencia(passos[this.indice]);
		if (pend) return ui.notifications.warn(pend);
		this.indice = Math.min(this.indice + 1, passos.length - 1);
		this.estado.alcancado = Math.max(this.estado.alcancado, this.indice);
		this.mudou();
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
		this.definirCampo(target.dataset.campo, valor);
	}

	static alternar(event, target) {
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
		// desmarcar um benefício de grupo (ou a Futura Lenda) limpa o poder escolhido nele
		if (campo.endsWith(".beneficios") && i >= 0 && valor.startsWith("grupo:")) {
			const sub = campo.split(".")[1];
			delete this.estado.origens[sub].grupos[valor.slice(6)];
		}
		if (campo.endsWith(".beneficios") && i >= 0 && valor.startsWith("poder:")) {
			const sub = campo.split(".")[1];
			delete this.estado.origens[sub].escolhasPoder?.[valor.slice(6)];
			// desmarcar a Herança desmarca também a 2ª vez dela
			const j = lista.indexOf(`poder2:${valor.slice(6)}`);
			if (j >= 0) lista.splice(j, 1);
		}
		this.definirCampo(campo, lista);
	}

	/** Tela de carregamento com erro: limpa o erro e tenta carregar de novo. */
	static #tentarDeNovo() {
		this._erroCarregamento = null;
		this.render();
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
		this.mudou();
	}

	static async #finalizar(event, target) {
		const pend = this.pendencia({ id: "revisao" });
		if (pend) return ui.notifications.warn(pend);
		if (this.actor.items.some((i) => i.type === "race" || i.type === "classe")) {
			return ui.notifications.error("Esta ficha já tem raça ou classe. Remova-as antes de usar o construtor.");
		}
		target.disabled = true;
		try {
			const plano = this.plano();
			await aplicarNaFicha(this.actor, plano, this.dados);
			ui.notifications.info(`${this.actor.name} está pronto para a aventura!`);
			await this.close();
			this.actor.sheet.render(true);
			// Idades Variadas: faixas que começam acima do 1º nível abrem o assistente de subir de nível
			if (plano.niveisExtras > 0 && game.settings.get(MODULE_ID, "subirNivel")) {
				ui.notifications.info(`${this.actor.name} começa ${plano.niveisExtras === 1 ? "1 nível" : `${plano.niveisExtras} níveis`} acima do grupo pela idade: suba agora no assistente.`);
				game.modules.get(MODULE_ID).api?.subirNivel?.(this.actor);
			}
		} catch (err) {
			console.error(`${MODULE_ID} |`, err);
			ui.notifications.error(`Erro ao criar a ficha: ${err.message}`);
			target.disabled = false;
		}
	}
}

/* Telas dos passos e de apoio entram na janela (nome repetido é erro, inclusive entre ações). */
{
	const vistas = new Set();
	for (const Tela of TELAS) {
		for (const n of estaticos(Tela)) {
			if (vistas.has(n)) throw new Error(`${MODULE_ID} | ação repetida nas telas: ${n}`);
			vistas.add(n);
		}
		for (const nome of Object.getOwnPropertyNames(Tela.prototype)) {
			if (nome === "constructor") continue;
			if (Object.hasOwn(ConstrutorFicha.prototype, nome)) throw new Error(`${MODULE_ID} | membro repetido nas telas: ${nome}`);
			Object.defineProperty(ConstrutorFicha.prototype, nome, Object.getOwnPropertyDescriptor(Tela.prototype, nome));
		}
	}
}

/*
 * A janela usa a regra pelos mesmos nomes de antes (this.raca, this.plano()…): os métodos e getters
 * públicos do modelo são repassados para ele.
 */
for (const nome of Object.getOwnPropertyNames(ModeloConstrutor.prototype)) {
	if (nome === "constructor" || Object.hasOwn(ConstrutorFicha.prototype, nome)) continue;
	const desc = Object.getOwnPropertyDescriptor(ModeloConstrutor.prototype, nome);
	Object.defineProperty(ConstrutorFicha.prototype, nome, desc.get
		? { get() { return this.modelo[nome]; }, configurable: true }
		: { value(...args) { return this.modelo[nome](...args); }, configurable: true, writable: true });
}
