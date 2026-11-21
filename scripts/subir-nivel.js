/**
 * Janela "Subir de nível": assistente em passos (Nível → Poder → Magias → Revisão, só os que o nível
 * tiver), com a mesma barra lateral do construtor. Grava tudo de uma vez e desfaz o último nível aplicado.
 * As regras, o estado das escolhas e os contextos dos passos ficam em etapas-nivel.js (EtapasNivel);
 * aqui ficam o carregamento, a gravação na ficha, o desfazer e o que é só da janela.
 */
import { MODULE_ID, normalizar } from "./regras.js";
import { carregarDados } from "./dados.js";
import { aplicarNivel, desfazerUltimoNivel, podeDesfazer, historico } from "./aplicar-nivel.js";
import { animarSubidaDeNivel } from "./animacao-nivel.js";
import { carregarDadosNivel, leitorPreRequisitos as leitorDe } from "./dados-nivel.js";
import { EtapasNivel } from "./etapas-nivel.js";
import { lerArvore, gravarArvore, sincronizar, noDoCaminho, adicionarNo, escolherNo, registrarSubida, paraNomes, paraEtapas } from "./builds/arvore.js";

const TPL = `modules/${MODULE_ID}/templates`;
export const TEMPLATES_NIVEL = [`${TPL}/subir-nivel.hbs`];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SubirNivel extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(actor, options = {}) {
		super({ id: `t20cf-nivel-${actor.id}`, ...options });
		this.actor = actor;
		this.etapas = new EtapasNivel(actor);
		this.ocupado = false;
		// plano (árvore de builds): o nó do próximo nível preenche as escolhas ao abrir e depois de cada nível
		this.plano = null;
		this.planoPreparado = false;
	}

	// dados carregados ficam nas etapas (que fazem as contas)
	get dados() { return this.etapas.dados; }
	set dados(v) { this.etapas.dados = v; }
	get progressao() { return this.etapas.progressao; }
	set progressao(v) { this.etapas.progressao = v; }
	get lerPreRequisito() { return this.etapas.lerPreRequisito; }
	set lerPreRequisito(v) { this.etapas.lerPreRequisito = v; }

	static DEFAULT_OPTIONS = {
		classes: ["t20-construtor", "t20cf-nivel"],
		tag: "div",
		window: { icon: "fa-solid fa-angles-up", resizable: true },
		position: { width: 1040, height: 760 },
		actions: {
			irPara: SubirNivel.#irPara,
			escolherClasse: SubirNivel.#escolherClasse,
			avancar: SubirNivel.#avancar,
			voltar: SubirNivel.#voltar,
			escolher: SubirNivel.#escolher,
			selecionar: SubirNivel.#selecionar,
			aba: SubirNivel.#trocarAba,
			indisponiveis: SubirNivel.#alternarIndisponiveis,
			escola: SubirNivel.#alternarEscola,
			magia: SubirNivel.#alternarMagia,
			focarMagia: SubirNivel.#focarMagia,
			aplicar: SubirNivel.#aplicar,
			desfazer: SubirNivel.#desfazer,
			compendioClasses: SubirNivel.#compendioClasses,
			salvarPlano: SubirNivel.#salvarPlano,
			abrirBuilds: SubirNivel.#abrirBuilds,
			limparPlano: SubirNivel.#limparPlano
		}
	};

	static PARTS = {
		main: { template: `${TPL}/subir-nivel.hbs`, scrollable: [".cf-lista", ".cf-info", ".cf-conteudo"] }
	};

	get title() {
		return `Subir de nível — ${this.actor.name}`;
	}

	async #carregar() {
		const [dados, { progressao, correcoes }] = await Promise.all([carregarDados(), carregarDadosNivel()]);
		this.lerPreRequisito = leitorDe(dados, correcoes);
		this.dados = dados;
		this.progressao = progressao;
	}

	async _prepareContext() {
		if (!this.dados) {
			this.#carregar().then(() => this.render(), (err) => {
				console.error(err);
				this.erro = err.message;
				this.render();
			});
			return { carregando: true, erro: this.erro };
		}
		if (!this.planoPreparado) await this.#prepararPlano();
		const calculo = this.etapas.calcular();
		const { ficha, classe } = calculo;
		const pdDesfazer = podeDesfazer(this.actor);
		const ultimo = historico(this.actor).at(-1);
		const base = {
			ator: this.actor.name,
			classe: classe?.nome,
			img: classe?.item?.img ?? classe?.doc?.img,
			nivelAtual: ficha.nivel,
			podeDesfazer: pdDesfazer,
			ultimo: pdDesfazer ? `${ultimo.classe} ${ultimo.nivelClasse} (nível ${ultimo.nivel})` : null,
			manual: !!this.actor.getFlag("tormenta20", "lvlconfig")?.manual,
			ocupado: this.ocupado
		};
		return {
			...base,
			...(await this.etapas.contexto(calculo)),
			plano: this.plano,
			// salvar como plano: só com o nível completo
			salvarPlano: !!calculo.nivel && !this.etapas.pendencia(calculo.nivel)
		};
	}

	/**
	 * Plano para o próximo nível: acerta a árvore com o nível da ficha e, se o caminho escolhido tem um nó
	 * para o próximo nível, põe as escolhas dele nas etapas (e vai direto para a revisão, se estiver completo).
	 * Um nó que não vale mais (poder sem pré-requisito, magia que sumiu) só gera o aviso.
	 */
	async #prepararPlano() {
		this.planoPreparado = true;
		this.plano = null;
		const { ficha, bloqueio } = this.etapas.calcular();
		if (bloqueio) return;
		const arvore = lerArvore(this.actor);
		if (!arvore.nos.length) return;
		if (sincronizar(arvore, ficha.nivel)) await gravarArvore(this.actor, arvore);
		const no = noDoCaminho(arvore, ficha.nivel + 1);
		if (!no || no.pai || no.naoSeguido) return;
		const { problemas, calculo } = paraEtapas(this.etapas, no.escolhas);
		if (problemas.length) {
			this.etapas.limparEscolhas();
			this.plano = { id: no.id, nome: no.nome, nivel: no.nivel, invalido: problemas[0] };
			return;
		}
		const pendencia = calculo.nivel ? this.etapas.pendencia(calculo.nivel) : null;
		this.plano = { id: no.id, nome: no.nome, nivel: no.nivel, pendencia };
		if (!pendencia) this.etapas.passo = "revisao";
	}

	_onRender(context, options) {
		super._onRender(context, options);
		if (context.carregando) return;
		for (const filtro of this.element.querySelectorAll(".cf-filtro-lista")) {
			const lista = filtro.closest(".cf-lista-filtravel");
			const aplicar = () => {
				this.etapas.filtros[filtro.dataset.filtro] = filtro.value;
				const termo = normalizar(filtro.value);
				let total = 0;
				for (const grupo of lista.querySelectorAll(".cf-grupo")) {
					let visiveis = 0;
					for (const c of grupo.querySelectorAll(".cf-card")) {
						c.hidden = !!termo && !normalizar(c.dataset.busca).includes(termo);
						if (!c.hidden) visiveis++;
					}
					grupo.hidden = !visiveis;
					total += visiveis;
				}
				const vazio = lista.querySelector(".cf-sem-resultado");
				if (vazio) vazio.hidden = total > 0;
			};
			filtro.addEventListener("input", aplicar);
			aplicar();
		}
		this.element.querySelector("[name=anotacao]")?.addEventListener("input", (ev) => {
			this.etapas.anotacao = ev.target.value;
		});
	}

	/* ---------- Ações ---------- */

	static #irPara(event, target) {
		this.etapas.irPara(target.dataset.passo);
		this.render();
	}

	static #avancar() {
		const aviso = this.etapas.avancar();
		if (aviso) return ui.notifications.warn(aviso);
		this.render();
	}

	static #voltar() {
		this.etapas.voltar();
		this.render();
	}

	static #escolherClasse(event, target) {
		if (this.etapas.escolherClasse(target.dataset.valor)) this.render();
	}

	static #escolher(event, target) {
		this.etapas.escolher(target.dataset.uuid);
		this.render();
	}

	static #selecionar(event, target) {
		this.etapas.selecionar(target.dataset.id, target.dataset.valor);
		this.render();
	}

	static #trocarAba(event, target) {
		this.etapas.trocarAba(target.dataset.aba);
		this.render();
	}

	static #alternarIndisponiveis() {
		this.etapas.alternarIndisponiveis();
		this.render();
	}

	static #alternarEscola(event, target) {
		const aviso = this.etapas.alternarEscola(target.dataset.escola);
		if (aviso) return ui.notifications.warn(aviso);
		this.render();
	}

	static #alternarMagia(event, target) {
		// com as vagas cheias, avisa e redesenha mesmo assim (o foco vai para a magia clicada)
		const aviso = this.etapas.alternarMagia(target.dataset.uuid);
		if (aviso) ui.notifications.warn(aviso);
		this.render();
	}

	/** Salva as escolhas deste nível como o plano (nó raiz da árvore) para o próximo nível. */
	static async #salvarPlano() {
		const calculo = this.etapas.calcular();
		if (!calculo.nivel) return;
		const pendencia = this.etapas.pendencia(calculo.nivel);
		if (pendencia) return ui.notifications.warn(pendencia);
		const arvore = lerArvore(this.actor);
		sincronizar(arvore, calculo.ficha.nivel);
		const no = adicionarNo(arvore, { nivel: calculo.nivel.nivelPersonagem, escolhas: paraNomes(this.etapas, calculo) });
		escolherNo(arvore, no.id);
		await gravarArvore(this.actor, arvore);
		this.plano = { id: no.id, nome: no.nome, nivel: no.nivel, pendencia: null };
		ui.notifications.info(`Plano salvo para o ${no.nivel}º nível: ${no.nome}.`);
		this.render();
	}

	/** Abre o cadastro de builds (planejador) com os dados já carregados; quando a árvore muda, o plano do próximo nível é refeito. */
	static async #abrirBuilds() {
		if (!this.dados) return;
		const { abrirPlanejador } = await import("./builds/planejador.js");
		abrirPlanejador(this.actor, {
			dados: this.dados, progressao: this.progressao, lerPreRequisito: this.lerPreRequisito,
			aoMudar: () => {
				this.etapas.limparEscolhas();
				this.planoPreparado = false;
				if (this.rendered) this.render();
			}
		});
	}

	/** Descarta o preenchimento do plano neste nível (o plano continua salvo). */
	static #limparPlano() {
		this.etapas.limparEscolhas();
		this.plano = null;
		this.render();
	}

	static #focarMagia(event, target) {
		this.etapas.focarMagia(target.dataset.uuid);
		this.render();
	}

	static async #aplicar() {
		if (this.ocupado) return;
		const r0 = this.etapas.planoDoNivel();
		if (r0.bloqueio) return;
		if (r0.pendencia) return ui.notifications.warn(r0.pendencia);
		const { classe, nivel, plano } = r0;
		// as escolhas por nome, para marcar na árvore de builds qual nó foi seguido
		const aplicadas = paraNomes(this.etapas, { classe, nivel });
		this.ocupado = true;
		this.render();
		let animacao = null;
		try {
			const r = await aplicarNivel(this.actor, plano);
			ui.notifications.info(`${this.actor.name} subiu para o ${nivel.nivelPersonagem}º nível (${classe.nome} ${nivel.nivelClasse}): +${r.pv} PV, +${r.pm} PM.`);
			// só dentro da janela (no elemento raiz, que não é redesenhado pelo render do conteúdo)
			animacao = animarSubidaDeNivel({
				container: this.element,
				nivel: nivel.nivelPersonagem,
				detalhe: `${classe.nome} ${nivel.nivelClasse} · +${r.pv} PV · +${r.pm} PM`,
				img: classe.item?.img ?? classe.doc?.img
			});
			const arvore = lerArvore(this.actor);
			if (arvore.nos.length) {
				registrarSubida(arvore, nivel.nivelPersonagem, aplicadas);
				await gravarArvore(this.actor, arvore);
			}
			this.etapas.limparEscolhas();
			this.planoPreparado = false;
		} catch (err) {
			console.error(err);
			ui.notifications.error(`Não foi possível subir de nível: ${err.message}`);
		} finally {
			this.ocupado = false;
			this.render();
		}
		if (animacao) await this.#perguntarOutroNivel(animacao);
	}

	/**
	 * Depois da animação: pergunta se quer subir mais um nível; "Não" fecha o assistente.
	 * No 20º nível não há o que perguntar (a janela mostra o aviso). Fechar a pergunta no X mantém a janela.
	 */
	async #perguntarOutroNivel(animacao) {
		await animacao;
		if (!this.rendered) return;
		const { ficha, bloqueio } = this.etapas.calcular();
		if (bloqueio) return;
		const continuar = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Subir de nível" },
			content: `<p>${foundry.utils.escapeHTML?.(this.actor.name) ?? this.actor.name} está no ${ficha.nivel}º nível. Deseja subir mais um nível?</p>`,
			yes: { label: "Sim, subir mais um" },
			no: { label: "Não, fechar", default: true }
		});
		if (continuar === false) this.close();
	}

	/** Comportamento original do "+" da ficha: compêndio de classes (para multiclasse, arrastando a classe). */
	static #compendioClasses() {
		game.packs.get("tormenta20.classes")?.render(true);
	}

	static async #desfazer() {
		if (this.ocupado || !podeDesfazer(this.actor)) return;
		const ultimo = historico(this.actor).at(-1);
		const ok = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Desfazer último nível" },
			content: `<p>Desfazer o ${ultimo.nivel}º nível (${ultimo.classe} ${ultimo.nivelClasse})? Os poderes e magias ganhos nesse nível serão removidos da ficha e PV/PM atuais voltam a diminuir.</p><p>Só o último nível pode ser desfeito.</p>`
		});
		if (!ok) return;
		this.ocupado = true;
		this.render();
		try {
			await desfazerUltimoNivel(this.actor);
			ui.notifications.info(`${this.actor.name} voltou para o ${ultimo.nivel - 1}º nível.`);
			this.etapas.limparEscolhas();
			this.planoPreparado = false;
		} catch (err) {
			console.error(err);
			ui.notifications.error(`Não foi possível desfazer: ${err.message}`);
		} finally {
			this.ocupado = false;
			this.render();
		}
	}
}

export function abrirSubirNivel(actor) {
	const existente = foundry.applications.instances.get(`t20cf-nivel-${actor.id}`);
	if (existente) {
		existente.render({ force: true });
		existente.bringToFront?.();
		return existente;
	}
	return new SubirNivel(actor).render({ force: true });
}

