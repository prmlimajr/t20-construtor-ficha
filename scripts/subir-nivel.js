/**
 * Janela "Subir de nível": assistente em passos (Nível → Poder → Magias → Revisão, só os que o nível
 * tiver), com a mesma barra lateral do construtor. Grava tudo de uma vez e desfaz o último nível aplicado.
 */
import { MODULE_ID, normalizar } from "./regras.js";
import { carregarDados, poderSelecionavel, fonteDe } from "./dados.js";
import { lerFicha } from "./ficha-atual.js";
import { poderRacialPermitido } from "./poderes-raciais.js";
import { poderDistincaoPermitido, ehPoderDeDistincao, distincaoDoPoder } from "./distincoes.js";
import {
	montarNivel, criarLeitorPreRequisitos, pendenciaNivel, montarPlano, variantesDe, classesParaSubir, vagasEfetivas, progressaoDe,
	magiasDisponiveis, escolasEfetivas, conferirVagas, circuloDe
} from "./nivel.js";
import { aplicarNivel, desfazerUltimoNivel, podeDesfazer, historico } from "./aplicar-nivel.js";
import { animarSubidaDeNivel } from "./animacao-nivel.js";

const TPL = `modules/${MODULE_ID}/templates`;
export const TEMPLATES_NIVEL = [`${TPL}/subir-nivel.hbs`];

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

const TITULOS_PASSOS = { classe: "Classe", nivel: "Nível", poder: "Poder", magias: "Magias", revisao: "Revisão" };
const DICAS_PASSOS = {
	classe: "Continue numa classe que você já tem ou comece uma nova (multiclasse).",
	nivel: "O que este nível concede e as escolhas das habilidades de classe.",
	poder: "Um poder de classe ou, no lugar dele, um poder geral.",
	magias: "Magias novas que você aprende neste nível.",
	revisao: "Confira tudo o que vai entrar na ficha."
};
const TIPOS_MAGIA = { arc: "Arcana", div: "Divina", uni: "Universal" };

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

const rotuloEscola = (k) => game.i18n.localize(CONFIG.T20?.spellSchools?.[k] ?? k);

export class SubirNivel extends HandlebarsApplicationMixin(ApplicationV2) {
	constructor(actor, options = {}) {
		super({ id: `t20cf-nivel-${actor.id}`, ...options });
		this.actor = actor;
		this.dados = null;
		this.ocupado = false;
		this._html = new Map();
		this.#limparEscolhas();
	}

	/** Estado das escolhas (volta ao início depois de aplicar um nível). */
	#limparEscolhas() {
		this.passo = "classe";
		this.classeAlvo = null; // id do item de classe a subir, ou "nova:<Nome>" (multiclasse); null = a inicial
		this.#limparEscolhasDoNivel();
	}

	/** Escolhas que dependem da classe escolhida (trocar de classe descarta). */
	#limparEscolhasDoNivel() {
		this.escolha = null; // uuid do poder escolhido
		this.aba = "classe";
		this.mostrarIndisponiveis = false;
		this.anotacao = "";
		this.selecoes = {}; // id → uuid (escolha entre habilidades) ou texto (escolha anotada)
		this.magias = []; // uuids das magias escolhidas
		this.escolas = []; // escolas escolhidas agora (ficha sem as escolas gravadas)
		this.focoMagia = null;
		this.filtros = {};
	}

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

	/**
	 * Situação atual: ficha, classes que podem subir, a classe escolhida e o que o próximo nível dela concede.
	 * bloqueio: não dá para subir de nível; erroClasse: a classe escolhida não tem progressão cadastrada.
	 */
	#calcular() {
		const variantes = variantesDe(this.progressao, this.dados.variantes);
		// a variante conta como a classe básica nos pré-requisitos ("5º nível de ladino" para o ventanista)
		const ficha = lerFicha(this.actor, { regrasClasses: this.dados.regrasClasses, variantes });
		if (!ficha.classes.length) return { ficha, bloqueio: "Este personagem ainda não tem classe. Use o construtor para criá-lo." };
		if (ficha.nivel >= 20) return { ficha, classe: ficha.classes[0], bloqueio: "Este personagem já está no 20º nível." };
		const opcoes = classesParaSubir(this.dados, this.progressao, ficha, variantes);

		// classe escolhida: uma que a ficha tem, ou uma nova; sem escolha, a inicial (ou a primeira com progressão)
		let classe = null;
		if (this.classeAlvo?.startsWith("nova:")) {
			const nova = opcoes.novas.find((c) => c.nome === this.classeAlvo.slice(5) && !c.bloqueio);
			if (nova) classe = { nome: nova.nome, niveis: 0, nova: true, doc: nova.doc };
		} else if (this.classeAlvo) classe = ficha.classes.find((c) => c.id === this.classeAlvo) ?? null;
		classe ??= opcoes.existentes.find((c) => c.inicial) ?? opcoes.existentes[0] ?? ficha.classes[0];
		this.classeAlvo = classe.nova ? `nova:${classe.nome}` : classe.id;

		// poderes gerais de outras raças (ex.: Arma Amada (Anão) para um humano) não aparecem
		const raca = this.actor.items.find((i) => i.type === "race")?.name ?? null;
		const r = montarNivel({
			dados: this.dados, progressao: this.progressao, ficha, classe,
			lerPreRequisito: leitorPreRequisitos,
			regrasPoderesClasse: this.dados.regrasPoderesClasse,
			regrasClasses: this.dados.regrasClasses,
			// poderes de distinção: só para quem tem a marca, e para quem tem, sempre (mesmo com a chave
			// "Poderes" do suplemento desligada: a marca foi posta na ficha pelo mestre)
			selecionavel: (p) => (distincaoDoPoder(this.dados, p) || poderSelecionavel(this.dados, p))
				&& poderRacialPermitido(this.dados, p, raca)
				&& poderDistincaoPermitido(this.dados, p, (nome) => ficha.temPoder(nome)),
			ehGeral: (p) => p.system?.tipo === "geral" || ehPoderDeDistincao(this.dados, p),
			grupoGeral: (p) => {
				const d = distincaoDoPoder(this.dados, p);
				return d ? `Distinção: ${d}` : p.system?.subtipo || "Outros";
			}
		});
		if (r.erro === "semProgressao") {
			return { ficha, opcoes, classe, erroClasse: `A progressão de ${classe.nome} ainda não foi cadastrada no construtor. Escolha outra classe ou use “Outra classe (compêndio)” para subir arrastando a classe para a ficha, como no sistema.` };
		}
		return { ficha, opcoes, classe, nivel: r };
	}

	/** Poder escolhido (opção de poderesClasse/poderesGerais), se ainda for válido. */
	#poderEscolhido(nivel) {
		return [...nivel.poderesClasse, ...nivel.poderesGerais].find((o) => o.doc.uuid === this.escolha && o.disponivel) ?? null;
	}

	#magiasEscolhidas() {
		return this.magias.map((u) => this.dados.magias.find((m) => m.uuid === u)).filter(Boolean);
	}

	/** Passos deste nível (só os que têm o que escolher, mais a revisão). */
	#passos(nivel) {
		if (!nivel) return ["classe"];
		const m = nivel.magias;
		const temMagias = !!m && (m.vagas.length > 0 || (m.escolas && !m.escolasFicha.length));
		return ["classe", "nivel", ...(nivel.ganhaPoder ? ["poder"] : []), ...(temMagias ? ["magias"] : []), "revisao"];
	}

	/** Pendência de um passo (ou de tudo, sem passo). */
	#pendencia(nivel, passo = null) {
		if (passo === "classe") return null;
		const ctx = { poder: this.#poderEscolhido(nivel), selecoes: this.selecoes, magias: this.#magiasEscolhidas(), escolas: this.escolas };
		const so = {
			nivel: { ...nivel, magias: null, ganhaPoder: false },
			poder: { ...nivel, escolhas: [], anotadas: [], magias: null },
			magias: { ...nivel, escolhas: [], anotadas: [], ganhaPoder: false },
			revisao: nivel
		};
		return pendenciaNivel(passo ? so[passo] : nivel, ctx);
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
		const calculo = this.#calcular();
		const { ficha, classe, nivel, bloqueio, erroClasse } = calculo;
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
		if (bloqueio) return { ...base, bloqueio, resumo: [] };
		if (!nivel) {
			// a classe escolhida não tem progressão: só o passo Classe, para escolher outra
			this.passo = "classe";
			return {
				...base, ...(await this.#ctxClasse(calculo)),
				passos: [{ id: "classe", titulo: TITULOS_PASSOS.classe, numero: 1, atual: true, acessivel: true }],
				passo: "classe", passoTitulo: TITULOS_PASSOS.classe, passoDica: DICAS_PASSOS.classe,
				nivelClasseAtual: classe.niveis, nivelClasse: classe.niveis + 1,
				primeiro: true, ultimoPasso: false, pendencia: erroClasse,
				resumo: [{ rotulo: "Personagem", valor: `${ficha.nivel}º nível` }]
			};
		}

		const sysClasse = (classe.item ?? classe.doc)?.system ?? {};
		const pv = Math.max(1, (Number(sysClasse.pvPorNivel) || 0) + (ficha.atributos.con ?? 0));
		const pm = Number(sysClasse.pmPorNivel) || 0;

		// passos
		const ids = this.#passos(nivel);
		if (!ids.includes(this.passo)) this.passo = "nivel";
		const atual = ids.indexOf(this.passo);
		const primeiroPendente = ids.findIndex((id) => id !== "revisao" && this.#pendencia(nivel, id));
		const passos = ids.map((id, i) => ({
			id, titulo: TITULOS_PASSOS[id], numero: i + 1,
			atual: i === atual,
			feito: i < atual && !this.#pendencia(nivel, id),
			// dá para pular para trás e para frente até o primeiro passo com pendência
			acessivel: i <= atual || primeiroPendente < 0 || i <= primeiroPendente
		}));

		const poder = this.#poderEscolhido(nivel);
		const magiasEsc = this.#magiasEscolhidas();
		const resumo = [
			{ rotulo: "Classe", valor: `${classe.nome} ${classe.niveis} → ${nivel.nivelClasse}${classe.nova ? " (nova)" : ""}` },
			{ rotulo: "Personagem", valor: `${ficha.nivel}º → ${nivel.nivelPersonagem}º nível` },
			{ rotulo: "PV", valor: `+${pv}` },
			{ rotulo: "PM", valor: `+${pm}` },
			...(nivel.ganhaPoder ? [{ rotulo: "Poder", valor: poder?.nome ?? "—" }] : []),
			// Idades Variadas: níveis extras da faixa etária que ainda faltam subir
			...(ficha.niveisExtras && 1 + ficha.niveisExtras - ficha.nivel > 0
				? [{ rotulo: "Idade", valor: `faltam ${1 + ficha.niveisExtras - ficha.nivel} nível(is)` }] : []),
			...(nivel.magias?.vagas.length ? [{ rotulo: "Magias", valor: `${magiasEsc.length}/${vagasEfetivas(nivel.magias, this.selecoes).length}` }] : [])
		];

		const ctx = {
			...base,
			fonte: nivel.fonte,
			nivelClasseAtual: classe.niveis,
			nivelClasse: nivel.nivelClasse,
			nivelPersonagem: nivel.nivelPersonagem,
			passos,
			passo: this.passo,
			passoTitulo: TITULOS_PASSOS[this.passo],
			passoDica: DICAS_PASSOS[this.passo],
			primeiro: atual === 0,
			ultimoPasso: atual === ids.length - 1,
			pendencia: this.passo === "revisao" ? this.#pendencia(nivel) : this.#pendencia(nivel, this.passo),
			resumo,
			pv, pm,
			avisos: nivel.avisos,
			notas: nivel.notas,
			classeNova: !!classe.nova
		};
		if (this.passo === "classe") Object.assign(ctx, await this.#ctxClasse(calculo));
		if (this.passo === "nivel") Object.assign(ctx, await this.#ctxNivel(nivel));
		if (this.passo === "poder") Object.assign(ctx, await this.#ctxPoder(nivel, classe));
		if (this.passo === "magias") Object.assign(ctx, await this.#ctxMagias(nivel, ficha));
		if (this.passo === "revisao") Object.assign(ctx, this.#ctxRevisao(nivel, poder, magiasEsc));
		return ctx;
	}

	async #ctxClasse({ ficha, opcoes, classe }) {
		const dePv = (doc) => `${doc?.system?.pvPorNivel ?? "?"} PV e ${doc?.system?.pmPorNivel ?? "?"} PM por nível`;
		const existentes = ficha.classes.map((c) => {
			const tem = !!progressaoDe(this.progressao, c.nome);
			return {
				valor: c.id, nome: c.nome, img: c.item?.img,
				sub: tem ? `${c.niveis}º → ${c.niveis + 1}º nível de classe${c.inicial ? " · classe inicial" : ""}` : "progressão ainda não cadastrada",
				selecionado: !classe.nova && c.id === classe.id,
				bloqueado: !tem
			};
		});
		const novas = opcoes.novas.map((c) => ({
			valor: `nova:${c.nome}`, nome: c.nome, img: c.doc.img,
			sub: c.bloqueio ?? dePv(c.doc),
			selecionado: classe.nova && c.nome === classe.nome,
			bloqueado: !!c.bloqueio,
			fonte: fonteDe(this.dados, c.doc)
		}));
		let infoClasse = null;
		if (classe.nova) {
			const prog = progressaoDe(this.progressao, classe.nome);
			const hab = (prog?.niveis?.["1"]?.habilidades ?? []).map((h) => (typeof h === "string" ? h : h.nome));
			infoClasse = {
				nome: classe.nome, img: classe.doc?.img, nova: true,
				dados: dePv(classe.doc),
				habilidades: hab.join(", "),
				descricao: await this.#descricao(classe.doc)
			};
		} else infoClasse = { nome: classe.nome, img: classe.item?.img, nova: false, dados: dePv(classe.item), nivel: classe.niveis };
		return { classesExistentes: existentes, classesNovas: novas, infoClasse, filtro: this.filtros.classe ?? "" };
	}

	async #ctxNivel(nivel) {
		const habilidades = await Promise.all(nivel.habilidades.map(async (h) => ({
			nome: h.nome + (h.valor ? ` ${h.valor}` : ""),
			img: h.doc?.img,
			descricao: await this.#descricao(h.doc),
			jaTem: h.jaTem,
			semDoc: !h.doc
		})));
		const ativas = nivel.escolhas.filter((e) => !e.requer || this.selecoes[e.requer.id] === e.requer.uuid);
		const escolhas = await Promise.all(ativas.map(async (e) => {
			const marcada = e.opcoes.find((o) => o.doc.uuid === this.selecoes[e.id]);
			return {
				id: e.id,
				titulo: e.titulo,
				// "Caminho do Cavaleiro: Bastião" → "Bastião" (o título já diz qual é a escolha)
				opcoes: e.opcoes.map((o) => ({ valor: o.doc.uuid, nome: o.nome.replace(new RegExp(`^${e.titulo}:\\s*`, "i"), ""), selecionado: o === marcada })),
				info: marcada ? { nome: marcada.nome, img: marcada.doc.img, descricao: await this.#descricao(marcada.doc) } : null
			};
		}));
		const anotadas = await Promise.all(nivel.anotadas.map(async (a) => ({
			id: a.id,
			titulo: a.titulo,
			habilidade: a.habilidade,
			jaTem: a.jaTem,
			opcoes: a.opcoes.map((o) => ({ valor: o, nome: o, selecionado: this.selecoes[a.id] === o })),
			descricao: a.jaTem ? "" : await this.#descricao(a.doc),
			img: a.doc?.img
		})));
		const m = nivel.magias;
		return {
			bonusPericia: nivel.bonusPericia,
			valores: nivel.valores,
			habilidades,
			escolhas,
			anotadas,
			circuloNovo: m?.circuloNovo ?? null,
			tipoMagia: m ? TIPOS_MAGIA[m.tipo]?.toLowerCase() : null,
			ausentes: nivel.ausentes,
			automaticas: (m?.automaticas ?? []).map((x) => x.name).sort((a, b) => a.localeCompare(b, "pt-BR"))
		};
	}

	async #ctxPoder(nivel, classe) {
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
			aviso: o.avisos.length > 0
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
			jaTem: escolhida.jaTem,
			concede: escolhida.concede?.name ?? null,
			pedeEscolha: escolhida.repetivel || /\bescolha\b/i.test(escolhida.doc.system?.description?.value ?? ""),
			descricao: await this.#descricao(escolhida.doc)
		} : null;
		return {
			aba: this.aba,
			abaClasse: this.aba === "classe",
			totais: {
				classe: nivel.poderesClasse.filter((o) => o.disponivel).length,
				geral: nivel.poderesGerais.filter((o) => o.disponivel).length
			},
			mostrarIndisponiveis: this.mostrarIndisponiveis,
			grupos,
			vazio: !visiveis.length,
			filtro: this.filtros.poder ?? "",
			info,
			anotacao: this.anotacao
		};
	}

	async #ctxMagias(nivel, ficha) {
		const m = nivel.magias;
		const precisaEscolas = !!m.escolas && !m.escolasFicha.length;
		const esc = escolasEfetivas(m, this.escolas);
		const escolasProntas = !m.escolas || esc.length === m.escolas;

		// escolas: só quando a ficha ainda não as tem (personagem criado antes de o construtor gravá-las)
		let escolas = null;
		if (precisaEscolas) {
			const todasDoTipo = magiasDisponiveis(this.dados, { ...m, escolas: 0 }, ficha);
			const conhecidas = new Set(this.actor.items.filter((i) => i.type === "magia").map((i) => i.system?.escola));
			escolas = Object.keys(CONFIG.T20?.spellSchools ?? {}).map((k) => ({
				chave: k,
				nome: rotuloEscola(k),
				qtd: todasDoTipo.filter((x) => x.system?.escola === k).length,
				conhecida: conhecidas.has(k),
				selecionado: this.escolas.includes(k)
			}));
		}

		const escolhidas = this.#magiasEscolhidas();
		const vagasM = vagasEfetivas(m, this.selecoes);
		const vagas = conferirVagas(vagasM, escolhidas);
		const lista = escolasProntas ? magiasDisponiveis(this.dados, m, ficha, this.escolas) : [];
		const porCirculo = new Map();
		for (const x of lista) {
			const c = circuloDe(x);
			if (!porCirculo.has(c)) porCirculo.set(c, []);
			porCirculo.get(c).push({
				uuid: x.uuid, nome: x.name, img: x.img,
				sub: `${rotuloEscola(x.system?.escola)} · ${TIPOS_MAGIA[x.system?.tipo] ?? ""}${fonteDe(this.dados, x) ? ` · ${fonteDe(this.dados, x)}` : ""}`,
				selecionado: this.magias.includes(x.uuid),
				foco: x.uuid === this.focoMagia
			});
		}
		const foco = this.dados.magias.find((x) => x.uuid === this.focoMagia);
		return {
			precisaEscolas,
			escolas,
			qtdEscolas: m.escolas,
			dicaEscolas: m.dicaEscolas,
			escolasEscolhidas: this.escolas.length,
			escolasFicha: m.escolasFicha.map(rotuloEscola).join(", "),
			escolasProntas,
			vagasTexto: vagasM.map((v) => (v.circulo ? `1 de ${v.circulo}º círculo${v.motivo ? ` (${v.motivo})` : ""}` : `1 de até ${v.ate}º círculo`)),
			faltam: vagas.faltam,
			circuloNovo: m.circuloNovo,
			semMagiaNova: !vagasM.length,
			circulos: [...porCirculo.entries()].sort(([a], [b]) => a - b).map(([c, cards]) => ({ titulo: `${c}º círculo`, cards })),
			filtro: this.filtros.magia ?? "",
			escolhidasLista: escolhidas.map((x) => ({ uuid: x.uuid, nome: x.name, circulo: circuloDe(x) })),
			infoMagia: foco ? {
				nome: foco.name, img: foco.img,
				sub: `${circuloDe(foco)}º círculo · ${rotuloEscola(foco.system?.escola)} · ${TIPOS_MAGIA[foco.system?.tipo] ?? ""}`,
				selecionado: this.magias.includes(foco.uuid),
				descricao: await this.#descricao(foco)
			} : null
		};
	}

	#ctxRevisao(nivel, poder, magiasEsc) {
		const plano = montarPlano(nivel, { poder, selecoes: this.selecoes, magias: magiasEsc, escolas: this.escolas, anotacao: this.anotacao });
		const itens = [
			...(plano.classeNova ? [{ tipo: "Classe", nome: `${plano.classeNova.name} (nova, 1º nível)` }] : []),
			...plano.habilidades.map((h) => ({ tipo: "Habilidade", nome: h.doc.name + (h.valor ? ` ${h.valor}` : "") })),
			...plano.escolhidas.map((d) => ({ tipo: "Escolha", nome: d.name })),
			...plano.anotadas.map((a) => ({ tipo: "Anotação", nome: `${a.doc.name}: ${a.texto}` })),
			...plano.valores.map((v) => ({ tipo: "Valor", nome: `${v.nome}: ${v.para}${v.modo === "rolagem" ? " (rolagem do poder)" : " (anotado na descrição)"}` })),
			...(plano.poder ? [{ tipo: "Poder", nome: plano.poder.name + (plano.anotacao?.trim() ? ` — ${plano.anotacao.trim()}` : "") }] : []),
			...plano.magias.slice(0, 12).map((d) => ({ tipo: "Magia", nome: `${d.name} (${circuloDe(d)}º círculo)` })),
			...(plano.magias.length > 12 ? [{ tipo: "Magia", nome: `… e mais ${plano.magias.length - 12}` }] : []),
			...(plano.escolasMagia ? [{ tipo: "Escolas", nome: plano.escolasMagia.map(rotuloEscola).join(", ") }] : [])
		];
		return { revisao: itens, valoresInformativos: nivel.valores.filter((v) => !v.modo), bonusPericia: nivel.bonusPericia };
	}

	_onRender(context, options) {
		super._onRender(context, options);
		if (context.carregando) return;
		for (const filtro of this.element.querySelectorAll(".cf-filtro-lista")) {
			const lista = filtro.closest(".cf-lista-filtravel");
			const aplicar = () => {
				this.filtros[filtro.dataset.filtro] = filtro.value;
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

	/* ---------- Navegação ---------- */

	#irParaPasso(id) {
		this.passo = id;
		this.render();
	}

	static #irPara(event, target) {
		this.#irParaPasso(target.dataset.passo);
	}

	static #avancar() {
		const { nivel } = this.#calcular();
		if (!nivel) return;
		const ids = this.#passos(nivel);
		const pend = this.#pendencia(nivel, this.passo);
		if (pend) return ui.notifications.warn(pend);
		this.#irParaPasso(ids[Math.min(ids.length - 1, ids.indexOf(this.passo) + 1)]);
	}

	static #voltar() {
		const { nivel } = this.#calcular();
		if (!nivel) return;
		const ids = this.#passos(nivel);
		this.#irParaPasso(ids[Math.max(0, ids.indexOf(this.passo) - 1)]);
	}

	/* ---------- Ações ---------- */

	static #escolherClasse(event, target) {
		if (this.classeAlvo === target.dataset.valor) return;
		this.classeAlvo = target.dataset.valor;
		this.#limparEscolhasDoNivel();
		this.render();
	}

	static #escolher(event, target) {
		const uuid = target.dataset.uuid;
		if (this.escolha !== uuid) this.anotacao = "";
		this.escolha = uuid;
		this.render();
	}

	/** Escolha do nível (Caminho do Cavaleiro, terreno do Explorador…). */
	static #selecionar(event, target) {
		this.selecoes[target.dataset.id] = target.dataset.valor;
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

	static #alternarEscola(event, target) {
		const { nivel } = this.#calcular();
		const k = target.dataset.escola;
		if (this.escolas.includes(k)) this.escolas = this.escolas.filter((x) => x !== k);
		else if (this.escolas.length < (nivel?.magias?.escolas ?? 0)) this.escolas = [...this.escolas, k];
		else return ui.notifications.warn(`Você já escolheu ${nivel.magias.escolas} escolas. Remova uma para trocar.`);
		// magias de escolas que deixaram de valer saem da escolha
		this.magias = this.#magiasEscolhidas().filter((m) => this.escolas.includes(m.system?.escola)).map((m) => m.uuid);
		this.render();
	}

	static #alternarMagia(event, target) {
		const uuid = target.dataset.uuid;
		this.focoMagia = uuid;
		if (this.magias.includes(uuid)) this.magias = this.magias.filter((u) => u !== uuid);
		else {
			const { nivel } = this.#calcular();
			const vagas = vagasEfetivas(nivel?.magias, this.selecoes);
			if (this.magias.length >= vagas.length) {
				ui.notifications.warn(`Você já escolheu ${vagas.length === 1 ? "a magia" : `as ${vagas.length} magias`} deste nível. Desmarque uma para trocar.`);
			} else this.magias = [...this.magias, uuid];
		}
		this.render();
	}

	static #focarMagia(event, target) {
		this.focoMagia = target.dataset.uuid;
		this.render();
	}

	static async #aplicar() {
		if (this.ocupado) return;
		const { classe, nivel, bloqueio } = this.#calcular();
		if (bloqueio) return;
		const poder = this.#poderEscolhido(nivel);
		const pendencia = this.#pendencia(nivel);
		if (pendencia) return ui.notifications.warn(pendencia);
		this.ocupado = true;
		this.render();
		try {
			const plano = montarPlano(nivel, {
				classeId: classe.id, poder, anotacao: this.anotacao, selecoes: this.selecoes,
				magias: this.#magiasEscolhidas(), escolas: this.escolas
			});
			const r = await aplicarNivel(this.actor, plano);
			ui.notifications.info(`${this.actor.name} subiu para o ${nivel.nivelPersonagem}º nível (${classe.nome} ${nivel.nivelClasse}): +${r.pv} PV, +${r.pm} PM.`);
			animarSubidaDeNivel({
				nivel: nivel.nivelPersonagem,
				detalhe: `${this.actor.name} · ${classe.nome} ${nivel.nivelClasse} · +${r.pv} PV · +${r.pm} PM`,
				img: classe.item?.img
			});
			this.#limparEscolhas();
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
			content: `<p>Desfazer o ${ultimo.nivel}º nível (${ultimo.classe} ${ultimo.nivelClasse})? Os poderes e magias ganhos nesse nível serão removidos da ficha e PV/PM atuais voltam a diminuir.</p><p>Só o último nível pode ser desfeito.</p>`
		});
		if (!ok) return;
		this.ocupado = true;
		this.render();
		try {
			await desfazerUltimoNivel(this.actor);
			ui.notifications.info(`${this.actor.name} voltou para o ${ultimo.nivel - 1}º nível.`);
			this.#limparEscolhas();
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
