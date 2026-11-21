/**
 * Janela "Cadastro de builds" (planejador): a árvore de variações do personagem, nível a nível, a partir do
 * próximo nível da ficha. Aberta só pelo botão da janela de subir de nível.
 *
 * - Uma coluna por nível. A coluna do nível N lista os filhos da build escolhida no nível N–1; o nível
 *   seguinte só abre quando o atual tem uma build escolhida.
 * - Cada build: escolher (entra no caminho), prévia da ficha (slide, só leitura), editar, variação,
 *   renomear e apagar (com os descendentes).
 * - "Nova build" abre o editor: a própria janela de subir de nível (EditorBuild) sobre a ficha virtual do
 *   caminho até o nível anterior, com "Salvar no plano" no lugar de "Subir".
 * - Cada build é conferida na ficha virtual (validarArvore); as que não valem mais aparecem com o motivo.
 */
import { MODULE_ID } from "../regras.js";
import { carregarDados } from "../dados.js";
import { carregarDadosNivel, leitorPreRequisitos as leitorDe } from "../dados-nivel.js";
import { SubirNivel } from "../subir-nivel.js";
import { AtorVirtual, aplicarEscolhas } from "../ficha-virtual.js";
import { EtapasNivel } from "../etapas-nivel.js";
import {
	lerArvore, gravarArvore, sincronizar, filhos, noPorId, descendentes, noDoCaminho, adicionarNo, escolherNo,
	apagarNo, renomearNo, paraNomes, paraEtapas, mesmasEscolhas, nomeAutomatico, textoNaoSeguido
} from "./arvore.js";
import { validarArvore } from "./validar.js";
import { previaDaFicha, documentoDaPrevia, prepararIframeDaPrevia } from "./previa.js";

const TPL = `modules/${MODULE_ID}/templates`;
export const TEMPLATES_BUILDS = [`${TPL}/planejador.hbs`];
const NIVEL_MAXIMO = 20;

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const esc = (t) => foundry.utils.escapeHTML?.(String(t ?? "")) ?? String(t ?? "");

export class PlanejadorBuilds extends HandlebarsApplicationMixin(ApplicationV2) {
	/**
	 * @param {Actor} actor
	 * @param {object} [opcoes]  { dados, progressao, lerPreRequisito } (já carregados pela janela de subir de
	 *   nível), aoMudar (chamado quando a árvore muda), opcoesFicha (repassadas a AtorVirtual; testes)
	 */
	constructor(actor, { dados = null, progressao = null, lerPreRequisito = null, aoMudar = null, opcoesFicha = {}, ...options } = {}) {
		super({ id: `t20cf-builds-${actor.id}`, ...options });
		this.actor = actor;
		Object.assign(this, { dados, progressao, lerPreRequisito, aoMudar, opcoesFicha });
		this.previa = null;
		this.editor = null;
		this.validacao = { chave: null, motivos: new Map(), erro: null };
		this.fichas = new Map(); // id do nó (ou "") → ficha virtual depois dele
	}

	static DEFAULT_OPTIONS = {
		classes: ["t20-construtor", "t20cf-builds"],
		tag: "div",
		window: { icon: "fa-solid fa-route", resizable: true },
		position: { width: 1100, height: 720 },
		actions: {
			escolherBuild: PlanejadorBuilds.#escolher,
			novaBuild: PlanejadorBuilds.#nova,
			editarBuild: PlanejadorBuilds.#editar,
			variacaoBuild: PlanejadorBuilds.#variacao,
			renomearBuild: PlanejadorBuilds.#renomear,
			apagarBuild: PlanejadorBuilds.#apagar,
			proximoNivel: PlanejadorBuilds.#proximoNivel,
			previaBuild: PlanejadorBuilds.#abrirPrevia,
			fecharPrevia: PlanejadorBuilds.#fecharPrevia
		}
	};

	static PARTS = {
		main: { template: `${TPL}/planejador.hbs`, scrollable: [".cf-builds-colunas", ".cf-previa"] }
	};

	get title() {
		return `Cadastro de builds — ${this.actor.name}`;
	}

	get fontes() {
		return { dados: this.dados, progressao: this.progressao, lerPreRequisito: this.lerPreRequisito };
	}

	async #carregar() {
		const [dados, { progressao, correcoes }] = await Promise.all([carregarDados(), carregarDadosNivel()]);
		this.lerPreRequisito = leitorDe(dados, correcoes);
		this.dados = dados;
		this.progressao = progressao;
	}

	/* ---------- Árvore e fichas virtuais ---------- */

	/** A árvore do ator, acertada com o nível da ficha (grava se mudou). */
	async #arvore() {
		const arvore = lerArvore(this.actor);
		if (sincronizar(arvore, Number(this.actor.nivel) || 0)) await gravarArvore(this.actor, arvore);
		return arvore;
	}

	/** Grava a árvore, esquece as fichas calculadas e avisa a janela de subir de nível. */
	async #gravar(arvore) {
		await gravarArvore(this.actor, arvore);
		this.fichas.clear();
		this.validacao.chave = null;
		this.aoMudar?.();
	}

	/**
	 * Ficha virtual depois do nó (ou a da ficha real, sem nó), aplicando o caminho até ele.
	 * @returns {Promise<AtorVirtual>} (lança erro se algum nível do caminho não vale mais)
	 */
	async fichaDepois(arvore, id) {
		const chave = id ?? "";
		if (this.fichas.has(chave)) return this.fichas.get(chave);
		let ficha;
		if (!id) ficha = AtorVirtual.de(this.actor, this.opcoesFicha);
		else {
			const no = noPorId(arvore, id);
			if (!no) throw new Error("build não encontrada");
			ficha = AtorVirtual.de(await this.fichaDepois(arvore, no.pai), this.opcoesFicha);
			const etapas = new EtapasNivel(ficha, this.fontes);
			const { problemas } = paraEtapas(etapas, no.escolhas);
			if (problemas.length) throw new Error(`${no.nome} (${no.nivel}º nível): ${problemas[0]}`);
			const r = await aplicarEscolhas(ficha, etapas.escolhasAtuais(), this.fontes);
			if (!r.ok) throw new Error(`${no.nome} (${no.nivel}º nível): ${r.motivo}`);
		}
		this.fichas.set(chave, ficha);
		return ficha;
	}

	/** Confere as builds na ficha virtual (só quando a árvore ou a ficha mudou). */
	async #validar(arvore) {
		const chave = JSON.stringify([this.actor.nivel, arvore.nos.map((n) => [n.id, n.pai, n.nivel, n.escolhas, !!n.naoSeguido])]);
		if (this.validacao.chave === chave) return;
		const copia = structuredClone(arvore);
		const motivos = new Map();
		let erro = null;
		try {
			await validarArvore(this.actor, copia, this.fontes, this.opcoesFicha);
			for (const n of copia.nos) if (n.divergente) motivos.set(n.id, n.divergente.motivo);
		} catch (err) {
			console.error(err);
			erro = err.message;
		}
		this.validacao = { chave, motivos, erro };
	}

	/* ---------- Contexto ---------- */

	async _prepareContext() {
		if (!this.dados) {
			this.#carregar().then(() => this.render(), (err) => {
				console.error(err);
				this.erro = err.message;
				this.render();
			});
			return { carregando: true, erro: this.erro };
		}
		const arvore = await this.#arvore();
		await this.#validar(arvore);
		const nivelFicha = Number(this.actor.nivel) || 0;
		const primeiro = nivelFicha + 1;
		const motivos = this.validacao.motivos;

		const card = (no) => {
			const e = no.escolhas ?? {};
			const classe = e.classe?.startsWith("nova:") ? `${e.classe.slice(5)} (nova)` : e.classe;
			const detalhes = [classe, e.poder && e.poder !== no.nome ? e.poder : null, e.magias?.length ? `${e.magias.length} magia${e.magias.length > 1 ? "s" : ""}` : null].filter(Boolean);
			return {
				id: no.id, nome: no.nome, nivel: no.nivel, sub: detalhes.join(" · "),
				escolhida: arvore.caminho.includes(no.id),
				divergente: motivos.get(no.id) ?? null,
				// planejar o nível seguinte sempre a partir de uma build (a base dele)
				proximo: no.nivel < NIVEL_MAXIMO && !motivos.has(no.id) ? no.nivel + 1 : null,
				filhos: filhos(arvore, no.id).filter((f) => !f.naoSeguido).length,
				previa: this.previa?.id === no.id
			};
		};

		const colunas = [];
		if (primeiro <= NIVEL_MAXIMO) {
			for (let nivel = primeiro; nivel <= NIVEL_MAXIMO; nivel++) {
				const anterior = nivel === primeiro ? null : noDoCaminho(arvore, nivel - 1);
				const aberta = nivel === primeiro || (!!anterior && !motivos.has(anterior.id));
				if (!aberta) {
					colunas.push({ nivel, bloqueada: true, motivo: anterior ? "A build escolhida no nível anterior não vale mais." : `Escolha uma build do ${nivel - 1}º nível.` });
					break;
				}
				const nos = filhos(arvore, anterior?.id ?? null).filter((n) => n.nivel === nivel && !n.naoSeguido).sort((a, b) => a.criado - b.criado);
				// só a primeira coluna cria build direto (a partir da ficha atual); as outras, pelo "+" de uma build do nível anterior
				colunas.push({ nivel, primeira: nivel === primeiro, de: anterior?.nome ?? null, anterior: nivel - 1, builds: nos.map(card) });
			}
		}

		// raízes de outro nível (a ficha subiu ou desceu sem passar pelo plano) e as não seguidas
		const foraDeAlcance = arvore.nos.filter((n) => !n.pai && !n.naoSeguido && n.nivel !== primeiro).map((n) => ({ ...card(n), aviso: `É do ${n.nivel}º nível; a ficha está no ${nivelFicha}º.` }));
		const naoSeguidas = arvore.nos.filter((n) => n.naoSeguido && !noPorId(arvore, n.pai)?.naoSeguido)
			.map((n) => ({ id: n.id, nome: n.nome, nivel: n.nivel, aviso: textoNaoSeguido(n), ramo: descendentes(arvore, n.id).length }));

		const caminho = arvore.caminho.map((id) => noPorId(arvore, id)).filter(Boolean);
		// a animação do slide só na primeira vez que ele aparece
		const previa = this.previa ? { ...this.previa, html: this.previa.sistema ? null : this.previa.html } : null;
		if (this.previa) this.previa.animar = false;
		return {
			ator: this.actor.name,
			img: this.actor.img,
			nivelFicha,
			maximo: primeiro > NIVEL_MAXIMO,
			colunas,
			caminho: caminho.map((n) => `${n.nivel}º ${n.nome}`).join(" → "),
			foraDeAlcance,
			naoSeguidas,
			erroValidacao: this.validacao.erro,
			previa
		};
	}

	_onRender(context, options) {
		super._onRender?.(context, options);
		// prévia com a ficha do sistema: num iframe, com os estilos da página e sem os do construtor
		const iframe = this.element?.querySelector?.(".cf-previa-iframe");
		if (!iframe || !this.previa?.sistema) return;
		iframe.addEventListener("load", () => prepararIframeDaPrevia(iframe), { once: true });
		iframe.srcdoc = documentoDaPrevia(this.previa);
	}

	/* ---------- Editor ---------- */

	/**
	 * Abre o editor de uma build do `nivel`, filho de `pai`.
	 * @param {object} p  { nivel, pai, no (para editar/variação), modo: "nova"|"editar"|"variacao" }
	 */
	async abrirEditor({ nivel, pai = null, no = null, modo = "nova" }) {
		const arvore = await this.#arvore();
		let ficha;
		try {
			ficha = AtorVirtual.de(await this.fichaDepois(arvore, pai), this.opcoesFicha);
		} catch (err) {
			return ui.notifications.warn(`Não dá para montar a ficha até o ${nivel - 1}º nível: ${err.message}`);
		}
		this.editor?.close?.();
		this.editor = new EditorBuild(ficha, { planejador: this, nivel, pai, no, modo });
		this.editor.render({ force: true });
		return this.editor;
	}

	/** Grava a build vinda do editor e a põe no caminho. */
	async salvarDoEditor({ modo, no, pai, nivel, escolhas }) {
		const arvore = await this.#arvore();
		let alvo;
		if (modo === "editar" && no) {
			alvo = noPorId(arvore, no.id);
			if (!alvo) return ui.notifications.warn("A build foi apagada enquanto era editada.");
			const nomeEraAutomatico = alvo.nome === nomeAutomatico(alvo.escolhas, alvo.nivel);
			alvo.escolhas = structuredClone(escolhas);
			if (nomeEraAutomatico) alvo.nome = nomeAutomatico(escolhas, nivel);
		} else {
			const irmaIgual = filhos(arvore, pai).find((n) => n.nivel === nivel && !n.naoSeguido && mesmasEscolhas(n.escolhas, escolhas));
			alvo = adicionarNo(arvore, { nivel, pai, escolhas });
			if (irmaIgual) ui.notifications.info(`Já existe uma build igual neste nível: ${irmaIgual.nome}.`);
		}
		escolherNo(arvore, alvo.id);
		await this.#gravar(arvore);
		this.render();
		return alvo;
	}

	/* ---------- Ações ---------- */

	static async #escolher(event, target) {
		const arvore = await this.#arvore();
		escolherNo(arvore, target.dataset.id);
		await this.#gravar(arvore);
		this.render();
	}

	static async #nova(event, target) {
		const nivel = Number(target.dataset.nivel);
		await this.abrirEditor({ nivel, pai: target.dataset.pai || null, modo: "nova" });
	}

	/** Nova build do nível seguinte, com esta build como base. */
	static async #proximoNivel(event, target) {
		const arvore = await this.#arvore();
		const no = noPorId(arvore, target.dataset.id);
		if (no && no.nivel < NIVEL_MAXIMO) await this.abrirEditor({ nivel: no.nivel + 1, pai: no.id, modo: "nova" });
	}

	static async #editar(event, target) {
		const arvore = await this.#arvore();
		const no = noPorId(arvore, target.dataset.id);
		if (no) await this.abrirEditor({ nivel: no.nivel, pai: no.pai, no, modo: "editar" });
	}

	static async #variacao(event, target) {
		const arvore = await this.#arvore();
		const no = noPorId(arvore, target.dataset.id);
		if (no) await this.abrirEditor({ nivel: no.nivel, pai: no.pai, no, modo: "variacao" });
	}

	static async #renomear(event, target) {
		const arvore = await this.#arvore();
		const no = noPorId(arvore, target.dataset.id);
		if (!no) return;
		const nome = await DialogV2.prompt({
			window: { title: "Renomear build" },
			content: `<label>Nome da build <input type="text" name="nome" value="${esc(no.nome)}" autofocus></label>`,
			ok: { label: "Renomear", callback: (event, button) => button.form.elements.nome.value }
		}).catch(() => null);
		if (!nome?.trim() || nome.trim() === no.nome) return;
		renomearNo(arvore, no.id, nome);
		await this.#gravar(arvore);
		this.render();
	}

	static async #apagar(event, target) {
		const arvore = await this.#arvore();
		const no = noPorId(arvore, target.dataset.id);
		if (!no) return;
		const ramo = descendentes(arvore, no.id).length;
		const ok = await DialogV2.confirm({
			window: { title: "Apagar build" },
			content: `<p>Apagar a build <strong>${esc(no.nome)}</strong> (${no.nivel}º nível)${ramo ? ` e as ${ramo} build${ramo > 1 ? "s" : ""} que dependem dela` : ""}?</p>`
		});
		if (!ok) return;
		apagarNo(arvore, no.id);
		if (this.previa && !noPorId(arvore, this.previa.id)) this.previa = null;
		await this.#gravar(arvore);
		this.render();
	}

	static async #abrirPrevia(event, target) {
		const arvore = await this.#arvore();
		const no = noPorId(arvore, target.dataset.id);
		if (!no) return;
		let ficha;
		try {
			ficha = await this.fichaDepois(arvore, no.id);
		} catch (err) {
			return ui.notifications.warn(`Não dá para montar a ficha desta build: ${err.message}`);
		}
		const p = await previaDaFicha(ficha, this.actor, this.fontes);
		this.previa = { id: no.id, titulo: `${no.nome} · ${no.nivel}º nível`, animar: true, ...p, sistema: p.tipo === "sistema" };
		this.render();
	}

	static #fecharPrevia() {
		this.previa = null;
		this.render();
	}

	async close(options) {
		this.editor?.close?.();
		return super.close(options);
	}
}

/**
 * Editor de uma build: a janela de subir de nível sobre a ficha virtual. "Salvar no plano" grava a build
 * na árvore (pelo planejador) em vez de subir de nível; não preenche pelo plano nem desfaz.
 */
export class EditorBuild extends SubirNivel {
	constructor(ficha, { planejador, nivel, pai, no = null, modo = "nova" }) {
		super(ficha, { id: `t20cf-builds-editor-${planejador.actor.id}` });
		Object.assign(this, { planejador, nivelBuild: nivel, pai, no, modo });
		this.dados = planejador.dados;
		this.progressao = planejador.progressao;
		this.lerPreRequisito = planejador.lerPreRequisito;
		this.planoPreparado = true; // o editor não se preenche pelo plano da ficha
		this.avisoEditor = null;
		if (no) {
			const { problemas, calculo } = paraEtapas(this.etapas, no.escolhas);
			if (problemas.length) this.avisoEditor = `Algumas escolhas da build não valem mais: ${problemas.join(" ")}`;
			else if (calculo.nivel && !this.etapas.pendencia(calculo.nivel)) this.etapas.passo = "revisao";
		}
	}

	static DEFAULT_OPTIONS = {
		classes: ["t20-construtor", "t20cf-nivel", "t20cf-builds-editor"],
		actions: { aplicar: EditorBuild.#salvar }
	};

	get title() {
		const acao = { nova: "Nova build", editar: "Editar build", variacao: "Variação de build" }[this.modo] ?? "Build";
		return `${acao} do ${this.nivelBuild}º nível — ${this.planejador.actor.name}`;
	}

	async _prepareContext() {
		const ctx = await super._prepareContext();
		return { ...ctx, modoPlano: true, podeDesfazer: false, salvarPlano: false, plano: null, avisoEditor: this.avisoEditor };
	}

	static async #salvar() {
		const r = this.etapas.planoDoNivel();
		if (r.bloqueio) return ui.notifications.warn(r.bloqueio);
		if (r.pendencia) return ui.notifications.warn(r.pendencia);
		const escolhas = paraNomes(this.etapas, { classe: r.classe, nivel: r.nivel });
		const modo = this.modo === "editar" ? "editar" : "nova";
		const alvo = await this.planejador.salvarDoEditor({ modo, no: this.no, pai: this.pai, nivel: this.nivelBuild, escolhas });
		if (alvo) ui.notifications.info(`Build salva no plano: ${alvo.nome} (${alvo.nivel}º nível).`);
		this.planejador.editor = null;
		this.close();
	}
}

export function abrirPlanejador(actor, opcoes = {}) {
	const existente = foundry.applications.instances?.get(`t20cf-builds-${actor.id}`);
	if (existente) {
		if (opcoes.aoMudar) existente.aoMudar = opcoes.aoMudar;
		existente.render({ force: true });
		existente.bringToFront?.();
		return existente;
	}
	return new PlanejadorBuilds(actor, opcoes).render({ force: true });
}
