/**
 * Janela "Subir de nível": mostra o que o próximo nível da classe concede, deixa escolher o poder
 * (de classe ou geral) e grava tudo de uma vez. Também desfaz o último nível aplicado.
 */
import { MODULE_ID, normalizar } from "./regras.js";
import { carregarDados, poderSelecionavel, fonteDe } from "./dados.js";
import { lerFicha } from "./ficha-atual.js";
import { poderRacialPermitido } from "./poderes-raciais.js";
import { poderDistincaoPermitido, ehPoderDeDistincao, distincaoDoPoder } from "./distincoes.js";
import { montarNivel, criarLeitorPreRequisitos } from "./nivel.js";
import { aplicarNivel, desfazerUltimoNivel, podeDesfazer, historico } from "./aplicar-nivel.js";

const TPL = `modules/${MODULE_ID}/templates`;
export const TEMPLATES_NIVEL = [`${TPL}/subir-nivel.hbs`];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/* ---------- Dados próprios da subida de nível (progressões e correções de pré-requisitos) ---------- */

let dadosNivel = null;
async function carregarDadosNivel() {
	if (dadosNivel) return dadosNivel;
	const ler = async (arquivo) => {
		const resp = await fetch(`modules/${MODULE_ID}/data/${arquivo}`);
		if (!resp.ok) throw new Error(`${MODULE_ID} | não foi possível ler data/${arquivo}`);
		return resp.json();
	};
	const [progressao, correcoes] = await Promise.all([ler("progressao.json"), ler("pre-requisitos.json")]);
	delete progressao._comentario;
	delete correcoes._comentario;
	dadosNivel = { progressao, correcoes };
	return dadosNivel;
}

let leitorPreRequisitos = null;
let leitorDe = null;

async function enriquecer(html) {
	const limpo = String(html ?? "").trim();
	if (!limpo) return "";
	return foundry.applications.ux.TextEditor.implementation.enrichHTML(limpo, { async: true });
}

export class SubirNivel extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(actor, options = {}) {
		super({ id: `t20cf-nivel-${actor.id}`, ...options });
		this.actor = actor;
		this.dados = null;
		this.escolha = null; // uuid do poder escolhido
		this.aba = "classe";
		this.mostrarIndisponiveis = false;
		this.anotacao = "";
		this.filtro = "";
		this.ocupado = false;
		this._html = new Map();
	}

	static DEFAULT_OPTIONS = {
		classes: ["t20-construtor", "t20cf-nivel"],
		tag: "div",
		window: { icon: "fa-solid fa-angles-up", resizable: true },
		position: { width: 960, height: 720 },
		actions: {
			escolher: SubirNivel.#escolher,
			aba: SubirNivel.#trocarAba,
			indisponiveis: SubirNivel.#alternarIndisponiveis,
			aplicar: SubirNivel.#aplicar,
			desfazer: SubirNivel.#desfazer,
			compendioClasses: SubirNivel.#compendioClasses
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
		if (leitorDe !== dados) {
			leitorPreRequisitos = criarLeitorPreRequisitos(dados, correcoes);
			leitorDe = dados;
		}
		this.dados = dados;
		this.progressao = progressao;
	}

	/** Situação atual: ficha, classe e o que o próximo nível concede (ou o motivo de não poder subir). */
	#calcular() {
		const ficha = lerFicha(this.actor, { regrasClasses: this.dados.regrasClasses, variantes: this.dados.variantes });
		if (!ficha.classes.length) return { ficha, bloqueio: "Este personagem ainda não tem classe. Use o construtor para criá-lo." };
		if (ficha.classes.length > 1) return { ficha, bloqueio: "Personagens com mais de uma classe (multiclasse) ainda não são suportados pelo assistente. Use “Outra classe (compêndio)” para subir de nível arrastando a classe para a ficha, como no sistema." };
		const classe = ficha.classes[0];
		// poderes gerais de outras raças (ex.: Arma Amada (Anão) para um humano) não aparecem
		const raca = this.actor.items.find((i) => i.type === "race")?.name ?? null;
		const r = montarNivel({
			dados: this.dados, progressao: this.progressao, ficha, classe,
			lerPreRequisito: leitorPreRequisitos,
			selecionavel: (p) => poderSelecionavel(this.dados, p) && poderRacialPermitido(this.dados, p, raca)
				// poderes de distinção só para quem tem a marca da distinção
				&& poderDistincaoPermitido(this.dados, p, (nome) => ficha.temPoder(nome)),
			ehGeral: (p) => p.system?.tipo === "geral" || ehPoderDeDistincao(this.dados, p),
			grupoGeral: (p) => {
				const d = distincaoDoPoder(this.dados, p);
				return d ? `Distinção: ${d}` : p.system?.subtipo || "Outros";
			}
		});
		if (r.erro === "semProgressao") return { ficha, classe, bloqueio: `A progressão de ${classe.nome} ainda não foi cadastrada no construtor. Use “Outra classe (compêndio)” para subir de nível arrastando a classe para a ficha, como no sistema.` };
		if (r.erro === "nivelMaximo") return { ficha, classe, bloqueio: "Este personagem já está no 20º nível." };
		return { ficha, classe, nivel: r };
	}

	async #descricao(doc) {
		if (!doc) return "";
		if (!this._html.has(doc.uuid)) this._html.set(doc.uuid, await enriquecer(doc.system?.description?.value));
		return this._html.get(doc.uuid);
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
		const { ficha, classe, nivel, bloqueio } = this.#calcular();
		const pdDesfazer = podeDesfazer(this.actor);
		const ultimo = historico(this.actor).at(-1);
		const base = {
			ator: this.actor.name,
			classe: classe?.nome,
			nivelAtual: ficha.nivel,
			podeDesfazer: pdDesfazer,
			ultimo: pdDesfazer ? `${ultimo.classe} ${ultimo.nivelClasse} (nível ${ultimo.nivel})` : null,
			manual: !!this.actor.getFlag("tormenta20", "lvlconfig")?.manual,
			ocupado: this.ocupado
		};
		if (bloqueio) return { ...base, bloqueio };

		const classeDoc = classe.item;
		const sysClasse = classeDoc.system ?? {};
		const con = ficha.atributos.con ?? 0;
		const habilidades = await Promise.all(nivel.habilidades.map(async (h) => ({
			nome: h.nome + (h.valor ? ` ${h.valor}` : ""),
			img: h.doc?.img,
			descricao: await this.#descricao(h.doc),
			jaTem: h.jaTem,
			semDoc: !h.doc
		})));

		// lista de poderes da aba atual
		const lista = this.aba === "geral" ? nivel.poderesGerais : nivel.poderesClasse;
		const visiveis = lista.filter((o) => o.disponivel || this.mostrarIndisponiveis);
		const escolhida = [...nivel.poderesClasse, ...nivel.poderesGerais].find((o) => o.doc.uuid === this.escolha) ?? null;
		if (escolhida && !escolhida.disponivel) this.escolha = null;
		const card = (o) => ({
			uuid: o.doc.uuid,
			nome: o.nome,
			img: o.doc.img,
			sub: o.disponivel ? (o.preRequisito ? `Pré-requisito: ${o.preRequisito}` : "Sem pré-requisito") : o.motivo,
			selecionado: o.doc.uuid === this.escolha,
			bloqueado: !o.disponivel,
			aviso: o.avisos.length > 0,
			fonte: fonteDe(this.dados, o.doc)
		});
		let grupos;
		if (this.aba === "geral") {
			const porGrupo = new Map();
			for (const o of visiveis) {
				if (!porGrupo.has(o.grupo)) porGrupo.set(o.grupo, []);
				porGrupo.get(o.grupo).push(card(o));
			}
			grupos = [...porGrupo.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR")).map(([titulo, cards]) => ({ titulo, cards }));
		} else {
			grupos = [{ titulo: `Poderes de ${classe.nome}`, cards: visiveis.map(card) }];
		}

		const info = escolhida && escolhida.disponivel ? {
			nome: escolhida.nome,
			img: escolhida.doc.img,
			fonte: fonteDe(this.dados, escolhida.doc),
			preRequisito: escolhida.preRequisito,
			avisos: escolhida.avisos,
			repetivel: escolhida.repetivel,
			jaTem: escolhida.jaTem,
			pedeEscolha: escolhida.repetivel || /\bescolha\b/i.test(escolhida.doc.system?.description?.value ?? ""),
			descricao: await this.#descricao(escolhida.doc)
		} : null;

		const pendencia = nivel.ganhaPoder && !info ? "Escolha um poder." : null;
		return {
			...base,
			img: classeDoc.img,
			fonte: nivel.fonte,
			nivelClasseAtual: classe.niveis,
			nivelClasse: nivel.nivelClasse,
			nivelPersonagem: nivel.nivelPersonagem,
			pv: Math.max(1, (Number(sysClasse.pvPorNivel) || 0) + con),
			pm: Number(sysClasse.pmPorNivel) || 0,
			bonusPericia: nivel.bonusPericia,
			habilidades,
			valores: nivel.valores,
			avisos: nivel.avisos,
			ganhaPoder: nivel.ganhaPoder,
			aba: this.aba,
			abaClasse: this.aba === "classe",
			totais: {
				classe: nivel.poderesClasse.filter((o) => o.disponivel).length,
				geral: nivel.poderesGerais.filter((o) => o.disponivel).length
			},
			mostrarIndisponiveis: this.mostrarIndisponiveis,
			grupos,
			vazio: !visiveis.length,
			filtro: this.filtro,
			info,
			anotacao: this.anotacao,
			pendencia
		};
	}

	_onRender(context, options) {
		super._onRender(context, options);
		if (context.carregando) return;
		const filtro = this.element.querySelector(".cf-filtro-lista");
		if (filtro) {
			const lista = filtro.closest(".cf-lista-filtravel");
			const aplicar = () => {
				this.filtro = filtro.value;
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
			this.anotacao = ev.target.value;
		});
	}

	/* ---------- Ações ---------- */

	static #escolher(event, target) {
		const uuid = target.dataset.uuid;
		if (this.escolha !== uuid) this.anotacao = "";
		this.escolha = uuid;
		this.render();
	}

	static #trocarAba(event, target) {
		this.aba = target.dataset.aba;
		this.render();
	}

	static #alternarIndisponiveis() {
		this.mostrarIndisponiveis = !this.mostrarIndisponiveis;
		this.render();
	}

	static async #aplicar() {
		if (this.ocupado) return;
		const { classe, nivel, bloqueio } = this.#calcular();
		if (bloqueio) return;
		const poder = this.escolha ? [...nivel.poderesClasse, ...nivel.poderesGerais].find((o) => o.doc.uuid === this.escolha && o.disponivel) : null;
		if (nivel.ganhaPoder && !poder) return ui.notifications.warn("Escolha um poder antes de subir de nível.");
		this.ocupado = true;
		this.render();
		try {
			const r = await aplicarNivel(this.actor, {
				classeId: classe.id,
				nivelPersonagem: nivel.nivelPersonagem,
				nivelClasse: nivel.nivelClasse,
				habilidades: nivel.habilidades.filter((h) => h.doc && !h.jaTem).map((h) => h.doc),
				poder: poder?.doc ?? null,
				anotacao: this.anotacao
			});
			ui.notifications.info(`${this.actor.name} subiu para o ${nivel.nivelPersonagem}º nível (${classe.nome} ${nivel.nivelClasse}): +${r.pv} PV, +${r.pm} PM.`);
			this.escolha = null;
			this.anotacao = "";
		} catch (err) {
			console.error(err);
			ui.notifications.error(`Não foi possível subir de nível: ${err.message}`);
		} finally {
			this.ocupado = false;
			this.render();
		}
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
			content: `<p>Desfazer o ${ultimo.nivel}º nível (${ultimo.classe} ${ultimo.nivelClasse})? Os poderes ganhos nesse nível serão removidos da ficha e PV/PM atuais voltam a diminuir.</p><p>Só o último nível pode ser desfeito.</p>`
		});
		if (!ok) return;
		this.ocupado = true;
		this.render();
		try {
			await desfazerUltimoNivel(this.actor);
			ui.notifications.info(`${this.actor.name} voltou para o ${ultimo.nivel - 1}º nível.`);
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
