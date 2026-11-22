/**
 * Etapas da subida de nível (Classe → Nível → Poder → Magias → Revisão), sem janela: estado das escolhas,
 * cálculo do nível, pendências, contextos dos passos e as operações dos botões. A janela "Subir de nível"
 * (subir-nivel.js) usa esta classe com a ficha real; o planejador de builds vai usá-la com a ficha virtual.
 *
 * As operações devolvem um aviso (texto) quando não dá para fazer o que foi pedido, ou null.
 */
import { poderSelecionavel, fonteDe } from "./dados.js";
import { lerFicha } from "./ficha-atual.js";
import { poderRacialPermitido } from "./poderes-raciais.js";
import { poderDistincaoPermitido, ehPoderDeDistincao, distincaoDoPoder } from "./distincoes.js";
import {
	montarNivel, pendenciaNivel, montarPlano, variantesDe, classesParaSubir, vagasEfetivas, progressaoDe,
	magiasDisponiveis, escolasEfetivas, conferirVagas, circuloDe, tiposDasVagas, internasAtivas, escolhaAtiva
} from "./nivel.js";
import { agruparPorLivro } from "./construtor/comum.js";
import { statsMagia, aprimoramentosMagia } from "./magias-info.js";
import { categoriaPoder, compararCategorias } from "./categorias-poder.js";

export const TITULOS_PASSOS = { classe: "Classe", nivel: "Nível", poder: "Poder", magias: "Magias", revisao: "Revisão" };
export const DICAS_PASSOS = {
	classe: "Continue numa classe que você já tem ou comece uma nova (multiclasse).",
	nivel: "O que este nível concede e as escolhas das habilidades de classe.",
	poder: "Um poder de classe ou, no lugar dele, um poder geral. Clique num poder para ver a descrição e use o botão para escolhê-lo.",
	magias: "Magias novas que você aprende neste nível. Clique numa magia para ver a descrição e use o botão para escolhê-la.",
	revisao: "Confira tudo o que vai entrar na ficha."
};
const TIPOS_MAGIA = { arc: "Arcana", div: "Divina", uni: "Universal" };

async function enriquecer(html) {
	const limpo = String(html ?? "").trim();
	if (!limpo) return "";
	return foundry.applications.ux.TextEditor.implementation.enrichHTML(limpo, { async: true });
}

/** { [chave]: lista } só quando a lista tem algo (o contexto das telas sem escolha interna fica como era). */
const semVazio = (chave, lista) => (lista.length ? { [chave]: lista } : {});

const rotuloEscola = (k) => game.i18n.localize(CONFIG.T20?.spellSchools?.[k] ?? k);

export class EtapasNivel {
	/**
	 * @param {Actor} actor  o personagem (real ou virtual)
	 * @param {object} [fontes]  { dados, progressao, lerPreRequisito } (podem ser definidos depois)
	 */
	constructor(actor, { dados = null, progressao = null, lerPreRequisito = null } = {}) {
		this.actor = actor;
		this.dados = dados;
		this.progressao = progressao;
		this.lerPreRequisito = lerPreRequisito;
		this._html = new Map();
		this.limparEscolhas();
	}

	/** Estado das escolhas (volta ao início depois de aplicar um nível). */
	limparEscolhas() {
		this.passo = "classe";
		this.classeAlvo = null; // id do item de classe a subir, ou "nova:<Nome>" (multiclasse); null = a inicial
		this.limparEscolhasDoNivel();
	}

	/** Escolhas que dependem da classe escolhida (trocar de classe descarta). */
	limparEscolhasDoNivel() {
		this.escolha = null; // uuid do poder escolhido
		this.focoPoder = null; // uuid do poder em destaque (o painel mostra; o botão escolhe)
		this.aba = "classe";
		this.mostrarIndisponiveis = false;
		this.anotacao = "";
		this.selecoes = {}; // id → uuid (escolha entre habilidades) ou texto (escolha anotada)
		this.magias = []; // uuids das magias escolhidas
		this.escolas = []; // escolas escolhidas agora (ficha sem as escolas gravadas)
		this.focoMagia = null;
		this.filtros = {};
	}

	/**
	 * Situação atual: ficha, classes que podem subir, a classe escolhida e o que o próximo nível dela concede.
	 * bloqueio: não dá para subir de nível; erroClasse: a classe escolhida não tem progressão cadastrada.
	 */
	calcular() {
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
			lerPreRequisito: this.lerPreRequisito,
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
				return d ? `Distinção: ${d}` : categoriaPoder(p);
			}
		});
		if (r.erro === "semProgressao") {
			return { ficha, opcoes, classe, erroClasse: `A progressão de ${classe.nome} ainda não foi cadastrada no construtor. Escolha outra classe ou use “Outra classe (compêndio)” para subir arrastando a classe para a ficha, como no sistema.` };
		}
		return { ficha, opcoes, classe, nivel: r };
	}

	/** Poder escolhido (opção de poderesClasse/poderesGerais), se ainda for válido. */
	poderEscolhido(nivel) {
		return [...nivel.poderesClasse, ...nivel.poderesGerais].find((o) => o.doc.uuid === this.escolha && o.disponivel) ?? null;
	}

	magiasEscolhidas() {
		return this.magias.map((u) => this.dados.magias.find((m) => m.uuid === u)).filter(Boolean);
	}

	/** Passos deste nível (só os que têm o que escolher, mais a revisão). */
	passos(nivel) {
		if (!nivel) return ["classe"];
		const m = nivel.magias;
		// o poder escolhido pode trazer magias (Conhecimento Mágico) mesmo num nível sem magia nova
		const temMagias = !!m && (vagasEfetivas(m, this.selecoes, this.poderEscolhido(nivel)).length > 0 || (m.escolas && !m.escolasFicha.length));
		return ["classe", "nivel", ...(nivel.ganhaPoder ? ["poder"] : []), ...(temMagias ? ["magias"] : []), "revisao"];
	}

	/** Pendência de um passo (ou de tudo, sem passo). */
	pendencia(nivel, passo = null) {
		if (passo === "classe") return null;
		const ctx = { poder: this.poderEscolhido(nivel), selecoes: this.selecoes, magias: this.magiasEscolhidas(), escolas: this.escolas };
		const so = {
			nivel: { ...nivel, magias: null, ganhaPoder: false },
			poder: { ...nivel, escolhas: [], anotadas: [], internas: [], magias: null },
			magias: { ...nivel, escolhas: [], anotadas: [], internas: [], ganhaPoder: false },
			revisao: nivel
		};
		return pendenciaNivel(passo ? so[passo] : nivel, ctx);
	}

	/** HTML enriquecido com cache por chave (aprimoramentos das magias). */
	async htmlCache(chave, html) {
		if (!this._html.has(chave)) this._html.set(chave, await enriquecer(html));
		return this._html.get(chave);
	}

	async descricao(doc) {
		if (!doc) return "";
		if (!this._html.has(doc.uuid)) this._html.set(doc.uuid, await enriquecer(doc.system?.description?.value));
		return this._html.get(doc.uuid);
	}

	/**
	 * Contexto dos passos para o template (sem os campos que são da janela: desfazer, ocupado…).
	 * @param {object} [calculo]  resultado de calcular() (calculado aqui se não vier)
	 */
	async contexto(calculo = this.calcular()) {
		const { ficha, classe, nivel, bloqueio, erroClasse } = calculo;
		if (bloqueio) return { bloqueio, resumo: [] };
		if (!nivel) {
			// a classe escolhida não tem progressão: só o passo Classe, para escolher outra
			this.passo = "classe";
			return {
				...(await this.ctxClasse(calculo)),
				passos: [{ id: "classe", titulo: TITULOS_PASSOS.classe, numero: 1, atual: true, acessivel: true }],
				passo: "classe", passoTitulo: TITULOS_PASSOS.classe, passoDica: DICAS_PASSOS.classe,
				nivelClasseAtual: classe.niveis, nivelClasse: classe.niveis + 1,
				primeiro: true, ultimoPasso: false, pendencia: erroClasse,
				resumo: [{ rotulo: "Personagem", valor: `${ficha.nivel}º nível` }]
			};
		}

		const { pv, pm } = this.ganhos(calculo);

		// passos
		const ids = this.passos(nivel);
		if (!ids.includes(this.passo)) this.passo = "nivel";
		const atual = ids.indexOf(this.passo);
		const primeiroPendente = ids.findIndex((id) => id !== "revisao" && this.pendencia(nivel, id));
		const passos = ids.map((id, i) => ({
			id, titulo: TITULOS_PASSOS[id], numero: i + 1,
			atual: i === atual,
			feito: i < atual && !this.pendencia(nivel, id),
			// dá para pular para trás e para frente até o primeiro passo com pendência
			acessivel: i <= atual || primeiroPendente < 0 || i <= primeiroPendente
		}));

		const poder = this.poderEscolhido(nivel);
		const magiasEsc = this.magiasEscolhidas();
		const resumo = [
			{ rotulo: "Classe", valor: `${classe.nome} ${classe.niveis} → ${nivel.nivelClasse}${classe.nova ? " (nova)" : ""}` },
			{ rotulo: "Personagem", valor: `${ficha.nivel}º → ${nivel.nivelPersonagem}º nível` },
			{ rotulo: "PV", valor: `+${pv}` },
			{ rotulo: "PM", valor: `+${pm}` },
			...(nivel.ganhaPoder ? [{ rotulo: "Poder", valor: poder?.nome ?? "—" }] : []),
			// Idades Variadas: níveis extras da faixa etária que ainda faltam subir
			...(ficha.niveisExtras && 1 + ficha.niveisExtras - ficha.nivel > 0
				? [{ rotulo: "Idade", valor: `faltam ${1 + ficha.niveisExtras - ficha.nivel} nível(is)` }] : []),
			...(vagasEfetivas(nivel.magias, this.selecoes, poder).length ? [{ rotulo: "Magias", valor: `${magiasEsc.length}/${vagasEfetivas(nivel.magias, this.selecoes, poder).length}` }] : [])
		];

		const ctx = {
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
			pendencia: this.passo === "revisao" ? this.pendencia(nivel) : this.pendencia(nivel, this.passo),
			resumo,
			pv, pm,
			avisos: nivel.avisos,
			notas: nivel.notas,
			classeNova: !!classe.nova
		};
		if (this.passo === "classe") Object.assign(ctx, await this.ctxClasse(calculo));
		if (this.passo === "nivel") Object.assign(ctx, await this.ctxNivel(nivel));
		if (this.passo === "poder") Object.assign(ctx, await this.ctxPoder(nivel, classe));
		if (this.passo === "magias") Object.assign(ctx, await this.ctxMagias(nivel, ficha));
		if (this.passo === "revisao") Object.assign(ctx, this.ctxRevisao(nivel, poder, magiasEsc));
		return ctx;
	}

	async ctxClasse({ ficha, opcoes, classe }) {
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
				descricao: await this.descricao(classe.doc)
			};
		} else infoClasse = { nome: classe.nome, img: classe.item?.img, nova: false, dados: dePv(classe.item), nivel: classe.niveis };
		// classes novas agrupadas por livro, como na escolha de classe do construtor
		const gruposNovas = agruparPorLivro(novas).map((g) => ({ titulo: g.titulo, classes: g.itens }));
		return { classesExistentes: existentes, classesNovas: novas, gruposNovas, infoClasse, filtro: this.filtros.classe ?? "" };
	}

	async ctxNivel(nivel) {
		const habilidades = await Promise.all(nivel.habilidades.map(async (h) => ({
			nome: h.nome + (h.valor ? ` ${h.valor}` : ""),
			img: h.doc?.img,
			descricao: await this.descricao(h.doc),
			jaTem: h.jaTem,
			semDoc: !h.doc
		})));
		const ativas = nivel.escolhas.filter((e) => !e.requer || this.selecoes[e.requer.id] === e.requer.uuid);
		// escolhas internas dos poderes (deus da Linhagem Abençoada…): chips; as de magia só avisam do passo Magias
		const internas = internasAtivas(nivel, this.selecoes);
		const ctxInterna = (i) => (i.tipo === "opcao"
			? { id: i.id, titulo: i.titulo, poder: i.poder, opcoes: i.opcoes.map((o) => ({ ...o, selecionado: this.selecoes[i.id] === o.valor })) }
			: { id: i.id, titulo: i.titulo, poder: i.poder, magia: true });
		const escolhas = await Promise.all(ativas.map(async (e) => {
			const marcada = e.opcoes.find((o) => o.doc.uuid === this.selecoes[e.id]);
			return {
				id: e.id,
				titulo: e.titulo,
				// "Caminho do Cavaleiro: Bastião" → "Bastião" (o título já diz qual é a escolha)
				opcoes: e.opcoes.map((o) => ({ valor: o.doc.uuid, nome: o.nome.replace(new RegExp(`^${e.titulo}:\\s*`, "i"), ""), selecionado: o === marcada })),
				info: marcada ? { nome: marcada.nome, img: marcada.doc.img, descricao: await this.descricao(marcada.doc) } : null,
				...semVazio("internas", internas.filter((i) => i.requer?.id === e.id).map(ctxInterna))
			};
		}));
		const anotadas = await Promise.all(nivel.anotadas.map(async (a) => ({
			id: a.id,
			titulo: a.titulo,
			habilidade: a.habilidade,
			jaTem: a.jaTem,
			opcoes: a.opcoes.map((o) => ({ valor: o, nome: o, selecionado: this.selecoes[a.id] === o })),
			descricao: a.jaTem ? "" : await this.descricao(a.doc),
			img: a.doc?.img
		})));
		const m = nivel.magias;
		return {
			bonusPericia: nivel.bonusPericia,
			valores: nivel.valores,
			habilidades,
			escolhas,
			anotadas,
			...semVazio("internas", internas.filter((i) => !i.requer).map(ctxInterna)),
			circuloNovo: m?.circuloNovo ?? null,
			tipoMagia: m ? TIPOS_MAGIA[m.tipo]?.toLowerCase() : null,
			ausentes: nivel.ausentes,
			automaticas: (m?.automaticas ?? []).map((x) => x.name).sort((a, b) => a.localeCompare(b, "pt-BR"))
		};
	}

	async ctxPoder(nivel, classe) {
		const lista = this.aba === "geral" ? nivel.poderesGerais : nivel.poderesClasse;
		const visiveis = lista.filter((o) => o.disponivel || this.mostrarIndisponiveis);
		const todos = [...nivel.poderesClasse, ...nivel.poderesGerais];
		const escolhida = todos.find((o) => o.doc.uuid === this.escolha) ?? null;
		if (escolhida && !escolhida.disponivel) this.escolha = null;
		// o painel mostra o poder em destaque; sem destaque, o escolhido
		let focado = todos.find((o) => o.doc.uuid === this.focoPoder && o.disponivel) ?? null;
		if (!focado) this.focoPoder = null;
		focado ??= escolhida?.disponivel ? escolhida : null;
		const card = (o) => ({
			uuid: o.doc.uuid,
			nome: o.nome,
			img: o.doc.img,
			sub: o.disponivel ? (o.preRequisito ? `Pré-requisito: ${o.preRequisito}` : "Sem pré-requisito") : o.motivo,
			selecionado: o.doc.uuid === this.escolha,
			foco: o === focado,
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
			grupos = [...porGrupo.entries()].sort(([a], [b]) => compararCategorias(a, b)).map(([titulo, cards]) => ({ titulo, cards }));
		} else {
			grupos = [{ titulo: `Poderes de ${classe.nome}`, cards: visiveis.map(card) }];
		}
		const info = focado ? await this.#infoPoder(nivel, focado, escolhida) : null;
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

	/** Painel do poder em destaque: descrição, avisos e o botão de escolher (ou remover, se for o escolhido). */
	async #infoPoder(nivel, focado, escolhida) {
		const ehEscolhido = focado === escolhida;
		const escolhidaValida = escolhida?.disponivel ? escolhida : null;
		const info = await this.#detalhesPoder(nivel, focado);
		return {
			...info,
			uuid: focado.doc.uuid,
			escolhido: ehEscolhido,
			// a anotação é do poder escolhido: só aparece depois de escolher
			pedeEscolha: ehEscolhido && info.pedeEscolha,
			substitui: !ehEscolhido && escolhidaValida ? escolhidaValida.nome : null
		};
	}

	async #detalhesPoder(nivel, escolhida) {
		return {
			nome: escolhida.nome,
			img: escolhida.doc.img,
			fonte: fonteDe(this.dados, escolhida.doc),
			preRequisito: escolhida.preRequisito,
			avisos: escolhida.avisos,
			jaTem: escolhida.jaTem,
			concede: escolhida.concede?.name ?? null,
			// poderes que ensinam magias: a escolha são as próprias magias (passo Magias), sem anotação
			// restam menos magias para aprender do que o poder ensina: as vagas abertas são só as que dá para preencher
			avisoMagias: escolhida.magias && escolhida.magias.livres != null && vagasEfetivas(nivel.magias, this.selecoes, escolhida).filter((v) => v.motivo === escolhida.nome).length < escolhida.magias.qtd
				? `Restam poucas magias para aprender: este poder abre só ${vagasEfetivas(nivel.magias, this.selecoes, escolhida).filter((v) => v.motivo === escolhida.nome).length} de ${escolhida.magias.qtd} vagas.` : null,
			pedeEscolha: !escolhida.magias && (escolhida.repetivel || /\bescolha\b/i.test(escolhida.doc.system?.description?.value ?? "")),
			descricao: await this.descricao(escolhida.doc)
		};
	}

	async ctxMagias(nivel, ficha) {
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

		const escolhidas = this.magiasEscolhidas();
		const vagasM = vagasEfetivas(m, this.selecoes, this.poderEscolhido(nivel));
		const vagas = conferirVagas(vagasM, escolhidas);
		// a lista inclui os tipos que só as vagas do poder aceitam (Aumentar Repertório: arcanas ou divinas)
		const lista = escolasProntas ? magiasDisponiveis(this.dados, { ...m, tipos: tiposDasVagas(m, vagasM) }, ficha, this.escolas) : [];
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
			vagasTexto: vagasM.map((v) => `${v.titulo ? `1 ${v.titulo.charAt(0).toLowerCase()}${v.titulo.slice(1)}` : v.circulo ? `1 de ${v.circulo}º círculo` : `1 de até ${v.ate}º círculo`}${v.motivo ? ` (${v.motivo})` : ""}`),
			faltam: vagas.faltam,
			circuloNovo: m.circuloNovo,
			semMagiaNova: !vagasM.length,
			circulos: [...porCirculo.entries()].sort(([a], [b]) => a - b).map(([c, cards]) => ({ titulo: `${c}º círculo`, cards })),
			filtro: this.filtros.magia ?? "",
			escolhidasLista: escolhidas.map((x) => ({ uuid: x.uuid, nome: x.name, circulo: circuloDe(x) })),
			// mesmo painel do construtor: escola, ficha resumida, descrição e aprimoramentos (os que pedem um
			// círculo que o personagem ainda não lança ficam marcados)
			infoMagia: foco ? {
				uuid: foco.uuid,
				nome: foco.name, img: foco.img,
				escola: rotuloEscola(foco.system?.escola),
				tipo: TIPOS_MAGIA[foco.system?.tipo] ?? "",
				circulo: circuloDe(foco),
				escolaDescricao: this.dados.escolas?.[foco.system?.escola]?.descricao ?? "",
				fonte: fonteDe(this.dados, foco),
				selecionado: this.magias.includes(foco.uuid),
				stats: statsMagia(foco),
				descricao: await this.descricao(foco),
				aprimoramentos: await aprimoramentosMagia(foco, (chave, html) => this.htmlCache(chave, html), m.circulo)
			} : null
		};
	}

	ctxRevisao(nivel, poder, magiasEsc) {
		const plano = montarPlano(nivel, { poder, selecoes: this.selecoes, magias: magiasEsc, escolas: this.escolas, anotacao: this.anotacao });
		const itens = [
			...(plano.classeNova ? [{ tipo: "Classe", nome: `${plano.classeNova.name} (nova, 1º nível)` }] : []),
			...plano.habilidades.map((h) => ({ tipo: "Habilidade", nome: h.doc.name + (h.valor ? ` ${h.valor}` : "") })),
			...plano.escolhidas.map((d) => ({ tipo: "Escolha", nome: d.name })),
			...Object.entries(plano.ajustes ?? {}).filter(([, a]) => a.anotacao)
				.map(([uuid, a]) => ({ tipo: "Escolha interna", nome: `${[...plano.habilidades.map((h) => h.doc), ...plano.escolhidas].find((d) => d.uuid === uuid)?.name ?? "Poder"}: ${a.anotacao}` })),
			...plano.anotadas.map((a) => ({ tipo: "Anotação", nome: `${a.doc.name}: ${a.texto}` })),
			...plano.valores.map((v) => ({ tipo: "Valor", nome: `${v.nome}: ${v.para}${v.modo === "rolagem" ? " (rolagem do poder)" : " (anotado na descrição)"}` })),
			...(plano.poder ? [{ tipo: "Poder", nome: plano.poder.name + (plano.anotacao?.trim() ? ` — ${plano.anotacao.trim()}` : "") }] : []),
			...plano.magias.slice(0, 12).map((d) => ({ tipo: "Magia", nome: `${d.name} (${circuloDe(d)}º círculo)` })),
			...(plano.magias.length > 12 ? [{ tipo: "Magia", nome: `… e mais ${plano.magias.length - 12}` }] : []),
			...(plano.escolasMagia ? [{ tipo: "Escolas", nome: plano.escolasMagia.map(rotuloEscola).join(", ") }] : [])
		];
		return { revisao: itens, valoresInformativos: nivel.valores.filter((v) => !v.modo), bonusPericia: nivel.bonusPericia };
	}

	/** PV e PM que o nível dá (pela classe escolhida e a Constituição). */
	ganhos({ ficha, classe }) {
		const sysClasse = (classe.item ?? classe.doc)?.system ?? {};
		return {
			pv: Math.max(1, (Number(sysClasse.pvPorNivel) || 0) + (ficha.atributos.con ?? 0)),
			pm: Number(sysClasse.pmPorNivel) || 0
		};
	}

	/** As escolhas atuais (uuids), no formato de aplicarEscolhas. */
	escolhasAtuais() {
		return {
			classeAlvo: this.classeAlvo, escolha: this.escolha, anotacao: this.anotacao,
			selecoes: { ...this.selecoes }, magias: [...this.magias], escolas: [...this.escolas]
		};
	}

	/* ---------- Operações (as ações dos botões, sem desenhar) ---------- */

	irPara(id) {
		this.passo = id;
	}

	/** Próximo passo; com pendência no atual, devolve o aviso e não avança. */
	avancar() {
		const { nivel } = this.calcular();
		if (!nivel) return null;
		const ids = this.passos(nivel);
		const pend = this.pendencia(nivel, this.passo);
		if (pend) return pend;
		this.passo = ids[Math.min(ids.length - 1, ids.indexOf(this.passo) + 1)];
		return null;
	}

	voltar() {
		const { nivel } = this.calcular();
		if (!nivel) return;
		const ids = this.passos(nivel);
		this.passo = ids[Math.max(0, ids.indexOf(this.passo) - 1)];
	}

	/** @returns {boolean} se a classe mudou */
	escolherClasse(valor) {
		if (this.classeAlvo === valor) return false;
		this.classeAlvo = valor;
		this.limparEscolhasDoNivel();
		return true;
	}

	/** Poder em destaque no painel (não escolhe). */
	focarPoder(uuid) {
		this.focoPoder = uuid;
	}

	/** Tira o poder escolhido (o destaque fica nele, para escolher de novo se quiser). */
	removerPoder() {
		this.focoPoder ??= this.escolha;
		this.escolher(null);
	}

	escolher(uuid) {
		if (this.escolha !== uuid) this.anotacao = "";
		this.escolha = uuid;
		if (uuid) this.focoPoder = uuid;
		// trocar Conhecimento Mágico (e afins) por outro poder tira as vagas que ele dava: as magias a
		// mais saem (as escolhidas primeiro ficam), senão o passo de magias some com pendência
		const { nivel } = this.calcular();
		if (nivel) {
			const vagas = vagasEfetivas(nivel.magias, this.selecoes, this.poderEscolhido(nivel)).length;
			if (this.magias.length > vagas) this.magias = this.magias.slice(0, vagas);
		}
	}

	/** Escolha do nível (Caminho do Cavaleiro, terreno do Explorador…). */
	selecionar(id, valor) {
		this.selecoes[id] = valor;
		// trocar uma opção (ex.: Caminho, Linhagem) tira as escolhas que dependiam da anterior
		const { nivel } = this.calcular();
		if (!nivel) return;
		for (let mudou = true; mudou;) {
			mudou = false;
			for (const e of nivel.escolhas) {
				if (this.selecoes[e.id] !== undefined && !escolhaAtiva(e, this.selecoes)) { delete this.selecoes[e.id]; mudou = true; }
			}
		}
		const ativas = new Set(internasAtivas(nivel, this.selecoes).map((i) => i.id));
		for (const i of nivel.internas ?? []) if (!ativas.has(i.id)) delete this.selecoes[i.id];
		// magias que não cabem mais nas vagas (a vaga da Linhagem trocada) saem
		const vagas = vagasEfetivas(nivel.magias, this.selecoes, this.poderEscolhido(nivel));
		if (this.magias.length && conferirVagas(vagas, this.magiasEscolhidas()).sobram) {
			const fica = [];
			for (const u of this.magias) {
				const teste = [...fica, u].map((x) => this.dados.magias.find((m) => m.uuid === x)).filter(Boolean);
				if (!conferirVagas(vagas, teste).sobram) fica.push(u);
			}
			this.magias = fica;
		}
	}

	trocarAba(aba) {
		this.aba = aba;
		// o destaque não passa de uma lista para a outra (o painel volta ao poder escolhido)
		this.focoPoder = null;
	}

	alternarIndisponiveis() {
		this.mostrarIndisponiveis = !this.mostrarIndisponiveis;
	}

	alternarEscola(k) {
		const { nivel } = this.calcular();
		if (this.escolas.includes(k)) this.escolas = this.escolas.filter((x) => x !== k);
		else if (this.escolas.length < (nivel?.magias?.escolas ?? 0)) this.escolas = [...this.escolas, k];
		else return `Você já escolheu ${nivel.magias.escolas} escolas. Remova uma para trocar.`;
		// magias de escolas que deixaram de valer saem da escolha
		this.magias = this.magiasEscolhidas().filter((m) => this.escolas.includes(m.system?.escola)).map((m) => m.uuid);
		return null;
	}

	alternarMagia(uuid) {
		this.focoMagia = uuid;
		if (this.magias.includes(uuid)) this.magias = this.magias.filter((u) => u !== uuid);
		else {
			const { nivel } = this.calcular();
			const vagas = vagasEfetivas(nivel?.magias, this.selecoes, nivel ? this.poderEscolhido(nivel) : null);
			if (this.magias.length >= vagas.length) {
				return `Você já escolheu ${vagas.length === 1 ? "a magia" : `as ${vagas.length} magias`} deste nível. Desmarque uma para trocar.`;
			}
			this.magias = [...this.magias, uuid];
		}
		return null;
	}

	focarMagia(uuid) {
		this.focoMagia = uuid;
	}

	/**
	 * Plano de gravação do nível com as escolhas atuais (para aplicarNivel).
	 * @returns {{classe, nivel, plano}|{bloqueio}|{pendencia}}
	 */
	planoDoNivel() {
		const { classe, nivel, bloqueio } = this.calcular();
		if (bloqueio) return { bloqueio };
		const pendencia = this.pendencia(nivel);
		if (pendencia) return { pendencia };
		const plano = montarPlano(nivel, {
			classeId: classe.id, poder: this.poderEscolhido(nivel), anotacao: this.anotacao, selecoes: this.selecoes,
			magias: this.magiasEscolhidas(), escolas: this.escolas
		});
		return { classe, nivel, plano };
	}
}
