/**
 * Slideout: o submenu de escolha que abre por cima do passo (lista, painel de informação, filtro de pré-requisitos dos poderes gerais) e as suas ações.
 */
import { categoriaPoder, agruparPorCategoria } from "../../categorias-poder.js";
import { poder, poderesDoGrupo, magiaPorNome, poderSelecionavel, fonteDe } from "../../dados.js";
import { NOMES_ATRIBUTOS, expandirPericias } from "../../regras.js";
import { circuloMagia, rotuloPericia, ordenarPericias } from "../comum.js";
import { rotuloEscola, tipoMelhoria, LISTAS_PODERES_GERAIS } from "../tela.js";

/** Métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações (this = janela). */
export class Tela {
	/**
	 * Nas listas de poderes gerais, os de pré-requisito não atendido somem a partir do passo Origem
	 * (atributos, classe e perícias já escolhidos); antes disso, só ganham um aviso.
	 */
	get listasFiltramPreRequisito() {
		const iPericias = this.passos().findIndex((p) => p.id === "pericias");
		return iPericias >= 0 && this.indice > iPericias;
	}

	/** Opções de uma lista de slideout: [{valor, nome, img, sub}] */
	opcoesSlideout(lista) {
		const [tipo, arg = ""] = lista.split(/:(.*)/s);
		const equip = (nome) => {
			const f = this.fichaEquip(nome);
			return { valor: nome, nome: f.nome, img: f.img, sub: f.sub };
		};
		// grupo: categoria do poder (Combate, Destino…), para listar agrupado quando a lista mistura categorias
		const poderCard = (p) => ({ valor: p.name, nome: p.name, img: p.img, grupo: categoriaPoder(p), sub: [p.system.subtipo, fonteDe(this.dados, p)].filter(Boolean).join(" · ") });
		switch (tipo) {
			case "arma": {
				const cats = arg.split(",");
				return this.dados.armas.filter((a) => cats.includes(a.system.proficiencia)).map((a) => equip(a.name));
			}
			case "nomes":
				return arg.split("|").map(equip);
			case "grupo":
				return poderesDoGrupo(this.dados, arg).filter((p) => this.poderListavel(p)).map(poderCard);
			case "magiaRacial": {
				const regra = this.regraRacial(arg);
				if (!regra) return [];
				const lista = regra.nomes
					? regra.nomes.map((n) => magiaPorNome(this.dados, n)).filter(Boolean)
					: this.dados.magias.filter((m) => circuloMagia(m) === Number(regra.circulo)
						&& (!regra.escolas || regra.escolas.includes(m.system.escola))
						&& (!regra.tiposMagia || regra.tiposMagia.includes(m.system.tipo)));
				return lista.map((m) => ({
					valor: m.uuid, nome: m.name, img: m.img,
					sub: `${rotuloEscola(m.system.escola)} · ${m.system.tipo === "uni" ? "Universal" : (m.system.tipo === "arc" ? "Arcana" : "Divina")}`
				}));
			}
			case "pericias":
				return ordenarPericias(arg.split("|")).map((k) => {
					const c = this.cardPericia(k);
					return { valor: k, nome: c.nome, sigla: c.atributo, sub: c.tags };
				});
			case "periciaRacial": {
				const regra = this.regraRacial(arg);
				const outras = regra?.pericia === "treinada" ? this.periciasRaciais({ exceto: regra.fonte === "classe" ? null : regra.id }) : new Set();
				// lista restrita (ex.: Papel Tribal) ou só perícias de certos atributos (ex.: Esperteza Vulpina)
				const permitidas = regra?.opcoesPericias ? new Set(expandirPericias(regra.opcoesPericias)) : null;
				const atributos = regra?.atributosPericias ?? null;
				return ordenarPericias(Object.keys(CONFIG.T20?.pericias ?? {}))
					.filter((k) => !outras.has(k))
					.filter((k) => !permitidas || permitidas.has(k))
					.filter((k) => !atributos || atributos.includes(CONFIG.T20.pericias[k]?.abl))
					.map((k) => {
						const c = this.cardPericia(k);
						return { valor: k, nome: c.nome, sigla: c.atributo, sub: c.tags };
					});
			}
			case "lojaAte": {
				const max = Number(arg);
				return this.dados.loja.filter(({ doc }) => Number(doc.system.preco) <= max)
					.map(({ doc, categoria }) => ({ ...equip(doc.name), sub: `${this.constructor.formatarTibares(doc.system.preco)} · ${categoria}` }));
			}
			case "itemSuperior": {
				// "300" ou "300:arma" (só armas, ex.: Presente dos Deuses do cruzado)
				const [precoMax, soTipo] = arg.split(":");
				const max = Number(precoMax);
				return this.dados.loja.filter(({ doc }) => tipoMelhoria(doc) && Number(doc.system.preco) <= max && (!soTipo || doc.type === soTipo))
					.map(({ doc, categoria }) => ({ ...equip(doc.name), sub: `${this.constructor.formatarTibares(doc.system.preco)} · ${categoria}` }));
			}
			case "melhoria":
				return this.dados.melhorias.filter((m) => [...(m.system.upgrade.itemType ?? [])].includes(arg))
					.map((m) => ({ valor: m.uuid, nome: m.name, img: m.img, sub: "Melhoria" }));
			case "magia":
				return this.magiasDisponiveis().map((m) => ({
					valor: m.uuid, nome: m.name, img: m.img,
					sub: [rotuloEscola(m.system.escola), m.system.tipo === "uni" ? "Universal" : (m.system.tipo === "arc" ? "Arcana" : "Divina"), fonteDe(this.dados, m)].filter(Boolean).join(" · ")
				}));
			case "poderes":
				return arg.split("|").map((n) => poder(this.dados, n)).filter(Boolean).map(poderCard);
			case "poderGeralOrigem":
				// poder geral ou poder único de origem do livro básico (Ambição Herdada do meio-elfo)
				return this.dados.poderes
					.filter((p) => (p.system.tipo === "geral" && poderSelecionavel(this.dados, p) && this.poderListavel(p)) || (p.system.tipo === "origem" && !fonteDe(this.dados, p)))
					.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(poderCard);
			case "poderGeralComplicacao": {
				// poder geral concedido pela complicação: tira os que o personagem já recebe por outras fontes
				const atual = this.estado.complicacaoPoder;
				const ja = new Set(this.plano({ semComplicacao: true }).gruposPoderes.flatMap((g) => g.poderes.map((p) => p.name)));
				return this.dados.poderes.filter((p) => p.system.tipo === "geral" && poderSelecionavel(this.dados, p) && this.poderListavel(p) && (!ja.has(p.name) || p.name === atual))
					.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(poderCard);
			}
			case "poderGeralIdade": {
				// Já Vi Coisas (adulto): poder geral que o personagem ainda não recebe por outra fonte
				const atual = this.estado.idade?.poderGeral;
				const ja = new Set(this.plano({ semIdade: true }).gruposPoderes.flatMap((g) => g.poderes.map((p) => p.name)));
				return this.dados.poderes.filter((p) => p.system.tipo === "geral" && poderSelecionavel(this.dados, p) && this.poderListavel(p) && (!ja.has(p.name) || p.name === atual))
					.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(poderCard);
			}
			case "poderClasse": {
				// Futura Lenda: um poder da classe escolhida
				const atual = foundry.utils.getProperty(this.estado, this.slideout?.campo ?? "") ?? "";
				return this.poderesDeClasseEscolhiveis(atual).map(poderCard);
			}
			case "complicacoesIdade":
				return (this.dados.idades?.complicacoes ?? []).map((n) => poder(this.dados, n)).filter(Boolean).map(poderCard);
			case "poderGeral":
				return this.dados.poderes.filter((p) => p.system.tipo === "geral" && poderSelecionavel(this.dados, p) && this.poderListavel(p))
					.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(poderCard);
			case "pericia": {
				const atual = foundry.utils.getProperty(this.estado, this.slideout?.campo ?? "");
				const treinadas = this.periciasTreinadas({ ate: "origem" });
				return ordenarPericias(Object.keys(CONFIG.T20?.pericias ?? {}))
					.filter((k) => !treinadas.has(k) || k === atual)
					.map((k) => {
						const c = this.cardPericia(k);
						return { valor: k, nome: c.nome, sigla: c.atributo, sub: c.tags };
					});
			}
		}
		return [];
	}

	/** Detalhes do item em foco no slideout. */
	async infoSlideout(lista, valor) {
		const tipo = lista.split(":")[0];
		if (tipo === "magia" || tipo === "magiaRacial") {
			const m = this.dados.magias.find((x) => x.uuid === valor);
			if (!m) return null;
			const i = await this.infoMagia(m);
			return {
				nome: i.nome, img: i.img,
				stats: [{ rotulo: "Escola", valor: `${i.escola} · ${i.tipo}` }, ...i.stats],
				descricao: i.descricao,
				aprimoramentos: i.aprimoramentos
			};
		}
		if (tipo === "melhoria") {
			const m = this.dados.melhorias.find((x) => x.uuid === valor);
			if (!m) return null;
			return { nome: m.name, img: m.img, stats: [{ rotulo: "Custo", valor: "+T$ 300 (1 melhoria)" }], descricao: await this.html(m.uuid, m.description) };
		}
		if (tipo === "arma" || tipo === "nomes" || tipo === "lojaAte" || tipo === "itemSuperior") {
			const f = this.fichaEquip(valor);
			return {
				nome: f.nome, img: f.img,
				stats: f.stats.map(([rotulo, v]) => ({ rotulo, valor: v })),
				descricao: f.doc ? await this.html(f.doc.uuid, f.doc.system?.description?.value) : ""
			};
		}
		if (["grupo", "poderGeral", "poderes", "poderGeralOrigem", "poderGeralComplicacao", "poderGeralIdade", "complicacoesIdade", "poderClasse"].includes(tipo)) {
			const p = poder(this.dados, valor);
			if (!p) return null;
			const i = await this.infoPoder(p);
			const stats = [{ rotulo: "Tipo", valor: p.system.subtipo }];
			const r = this.lerPreRequisito ? this.preRequisito(p, this.fichaProvisoria({ semComplicacao: tipo === "poderGeralComplicacao", semIdade: tipo === "poderGeralIdade" }), { classe: tipo === "poderClasse" }) : null;
			if (r) stats.push({ rotulo: "Pré-requisito", valor: r.ok ? r.texto : `${r.texto} — não atendido: ${r.falhas.join(", ")}` });
			// a partir do passo Origem, não dá para escolher um poder com pré-requisito não atendido
			const bloqueado = r && !r.ok && this.listasFiltramPreRequisito;
			return { ...i, stats, bloqueado, avisos: r?.avisos ?? [] };
		}
		if (tipo === "pericia" || tipo === "periciaRacial" || tipo === "pericias") {
			const cfg = CONFIG.T20?.pericias?.[valor];
			if (!cfg) return null;
			return {
				nome: rotuloPericia(valor),
				stats: [
					{ rotulo: "Atributo", valor: NOMES_ATRIBUTOS[cfg.abl] ?? cfg.abl },
					{ rotulo: "Somente treinado", valor: cfg.trainedOnly ? "Sim" : "Não" },
					{ rotulo: "Penalidade de armadura", valor: cfg.armorPenalty ? "Sim" : "Não" }
				],
				descricao: await this.descricaoPericia(valor)
			};
		}
		return null;
	}

	async ctxSlideout() {
		const so = this.slideout;
		if (!so) return null;
		if (so.tipo === "venda") return this.ctxSlideoutVenda();
		const atual = foundry.utils.getProperty(this.estado, so.campo) ?? "";
		const ehLista = Array.isArray(atual);
		let cards = this.opcoesSlideout(so.lista).map((c) => ({
			...c,
			selecionado: ehLista ? atual.includes(c.valor) : c.valor === atual,
			foco: c.valor === so.foco
		}));
		// poderes gerais: pré-requisito conferido contra o que já foi escolhido
		const tipoLista = so.lista.split(":")[0];
		let indisponiveis = 0;
		if (LISTAS_PODERES_GERAIS.has(tipoLista) && this.lerPreRequisito) {
			const filtrar = this.listasFiltramPreRequisito;
			// a lista da complicação/idade não conta o poder que ela mesma dá
			const ficha = this.fichaProvisoria({ semComplicacao: tipoLista === "poderGeralComplicacao", semIdade: tipoLista === "poderGeralIdade" });
			cards = cards.map((c) => {
				const r = this.preRequisito(poder(this.dados, c.valor), ficha, { classe: tipoLista === "poderClasse" });
				if (!r || r.ok) return c;
				if (!filtrar) return { ...c, sub: `⚠ Pré-requisito ainda não conferido: ${r.texto}`, aviso: true };
				indisponiveis++;
				return { ...c, indisponivel: true, sub: `Pré-requisito não atendido: ${r.falhas.join(", ")}` };
			});
			// o já escolhido continua visível (para poder trocar), mesmo se deixou de atender
			if (filtrar && !so.mostrarIndisponiveis) cards = cards.filter((c) => !c.indisponivel || c.selecionado);
		}
		const info = so.foco ? await this.infoSlideout(so.lista, so.foco) : null;
		if (info) {
			info.valor = so.foco;
			info.jaEscolhido = ehLista ? atual.includes(so.foco) : so.foco === atual;
		}
		const animar = so.animar;
		so.animar = false;
		// poderes de mais de uma categoria (ex.: poder geral da complicação): listados por categoria, com os
		// tipos no topo para filtrar a lista (um tipo de cada vez; "Todos" volta à lista inteira)
		const porCategoria = agruparPorCategoria(cards.filter((c) => c.grupo), (c) => c.grupo);
		const variasCategorias = porCategoria.length > 1;
		if (!variasCategorias || !porCategoria.some((g) => g.titulo === so.categoria)) so.categoria = "";
		const categorias = variasCategorias ? [
			{ valor: "", nome: "Todos", qtd: cards.length, selecionado: !so.categoria },
			...porCategoria.map((g) => ({ valor: g.titulo, nome: g.titulo, qtd: g.itens.length, selecionado: g.titulo === so.categoria }))
		] : null;
		const semSub = (c) => ({ ...c, sub: c.sub.split(" · ").filter((x) => x !== c.grupo && x.toLowerCase() !== c.grupo.toLowerCase()).join(" · ") });
		const grupos = variasCategorias
			? porCategoria.filter((g) => !so.categoria || g.titulo === so.categoria).map((g) => ({ titulo: g.titulo, cards: g.itens.map(semSub) }))
			: null;
		return {
			titulo: so.titulo, cards, grupos, categorias, info, animar, filtro: so.filtro, longa: cards.length > 8,
			indisponiveis, mostrarIndisponiveis: !!so.mostrarIndisponiveis
		};
	}

	static abrirSlideout(event, target) {
		const { campo, lista, titulo } = target.dataset;
		// sem limite (ou limite vazio): quantas quiser
		const limite = target.dataset.limite ? Number(target.dataset.limite) : Infinity;
		const atual = foundry.utils.getProperty(this.estado, campo) ?? "";
		const foco = Array.isArray(atual) ? "" : atual;
		this.slideout = { campo, lista, titulo, limite, foco, animar: true, filtro: "" };
		this.render();
	}

	/** Chip de tipo no topo do slideout de poderes: mostra só os poderes daquele tipo. */
	static filtrarCategoriaSlideout(event, target) {
		if (!this.slideout) return;
		this.slideout.categoria = target.dataset.valor ?? "";
		this.render();
	}

	static fecharSlideout() {
		this.slideout = null;
		this.render();
	}

	static alternarIndisponiveisSlideout() {
		if (!this.slideout) return;
		this.slideout.mostrarIndisponiveis = !this.slideout.mostrarIndisponiveis;
		this.render();
	}

	static focarSlideout(event, target) {
		if (!this.slideout) return;
		this.slideout.foco = target.dataset.valor;
		this.render();
	}

	static confirmarSlideout(event, target) {
		if (!this.slideout) return;
		const { campo, limite } = this.slideout;
		const valor = target.dataset.valor ?? this.slideout.foco;
		// a partir do passo Origem, poder geral com pré-requisito não atendido não pode ser escolhido
		const tipoLista = this.slideout.lista.split(":")[0];
		if (LISTAS_PODERES_GERAIS.has(tipoLista) && this.listasFiltramPreRequisito) {
			const ficha = this.fichaProvisoria({ semComplicacao: tipoLista === "poderGeralComplicacao", semIdade: tipoLista === "poderGeralIdade" });
			const r = this.preRequisito(poder(this.dados, valor), ficha, { classe: tipoLista === "poderClasse" });
			if (r && !r.ok) return ui.notifications.warn(`Pré-requisito não atendido: ${r.falhas.join(", ")}.`);
		}
		let atual = foundry.utils.getProperty(this.estado, campo);
		// lista de magias de uma escolha ainda sem nada escolhido: começa vazia
		if (atual === undefined && this.slideout.lista.startsWith("magiaRacial:")) atual = [];
		// perícia escolhida: o painel do passo mostra a perícia, com o botão de remover
		if (this.slideout.lista.startsWith("pericias:")) {
			this.focoPericia = valor;
			this.focoPericiaCampo = campo;
		}
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
			return this.definirCampo(campo, [...atual, valor]);
		}
		this.slideout = null;
		this.definirCampo(campo, valor);
	}
}
