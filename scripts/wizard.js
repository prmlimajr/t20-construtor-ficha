/**
 * Janela do construtor de ficha (ApplicationV2). Mantém todo o estado em memória
 * (com rascunho salvo numa flag do ator) e só grava a ficha no "Finalizar".
 */
import {
	MODULE_ID, ATRIBUTOS, NOMES_ATRIBUTOS, OFICIOS, PONTOS_TOTAIS, MIN_PONTOS, MAX_PONTOS,
	ARRANJOS_FIXOS, MODOS_VARIADOS, VALKARIA_INICIAL, converterNimb, custoAtributo, pontosGastos, converterRolagem, expandirPericias, normalizar, sinal
} from "./regras.js";
import { carregarDados, dadosCarregados, poder, poderesDoGrupo, equipamento, magiaPorNome, poderSelecionavel, fonteDe } from "./dados.js";
import { atributosDinamicosRaca } from "./suplementos.js";
import { aplicarNaFicha } from "./aplicar.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TPL = `modules/${MODULE_ID}/templates`;

export const TEMPLATES_PASSOS = [
	"raca", "atributos", "classe", "magias", "pericias", "origem", "devocao", "complicacoes", "equipamento", "dinheiro", "revisao"
].map((p) => `${TPL}/passos/${p}.hbs`).concat(`${TPL}/partes/poder.hbs`, `${TPL}/partes/abrir.hbs`, `${TPL}/partes/aprimoramentos.hbs`, `${TPL}/partes/escolha-racial.hbs`, `${TPL}/partes/poder-escolha.hbs`, `${TPL}/partes/venda.hbs`, `${TPL}/partes/poder-selecionavel.hbs`);


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
		poderesConcedidos: [],
		/** Devoto fundamentalista: um poder concedido a mais; a ficha registra "(fundamentalista)". */
		fundamentalista: false,
		/** Complicação escolhida (uuid; no máximo uma) e o poder geral que ela concede. */
		complicacoes: [],
		complicacaoPoder: "",
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

/** Categoria de melhoria (system.upgrade.itemType) de um item do compêndio de equipamentos. */
function tipoMelhoria(doc) {
	if (doc?.type === "arma") return "weapon";
	if (doc?.type !== "equipamento") return null;
	return { leve: "armor", pesada: "armor", escudo: "shield", esoterico: "esoteric", ferramenta: "tool", traje: "clothing" }[doc.system?.tipo] ?? null;
}

/**
 * Aprimoramento sem custo em PM: é um truque (custo vazio no compêndio, ou texto "em vez do normal"),
 * exceto as automações "Maximiza..." e as variantes de efeito (ex.: formas de Animar Objetos, "+2 em Força").
 */
function ehTruque(custo, html) {
	const texto = String(html ?? "").replace(/<[^>]+>/g, " ").trim();
	if (/^maximiza/i.test(texto)) return false;
	return custo === null || /^muda\b/i.test(texto) || /em vez d[oae]/i.test(texto);
}

/**
 * Círculo da magia como número. Magias de suplementos feitos para o Tormenta20 1.5 (ex.: Heróis de
 * Arton) guardam o círculo como texto ("1"); sem converter, elas sumiriam das listas por círculo.
 */
function circuloMagia(m) {
	return Number(m?.system?.circulo);
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
			alternar: ConstrutorFicha.#alternar,
			ajustarPonto: ConstrutorFicha.#ajustarPonto,
			rolarAtributos: ConstrutorFicha.#rolarAtributos,
			rolarVariado: ConstrutorFicha.#rolarVariado,
			rerrolarMenor: ConstrutorFicha.#rerrolarMenor,
			focarMagia: ConstrutorFicha.#focarMagia,
			focarEquip: ConstrutorFicha.#focarEquip,
			escolherPericia: ConstrutorFicha.#escolherPericia,
			abrirSlideout: ConstrutorFicha.#abrirSlideout,
			selecionarDado: ConstrutorFicha.#selecionarDado,
			lojaCategoria: ConstrutorFicha.#lojaCategoria,
			lojaTipo: ConstrutorFicha.#lojaTipo,
			focarLoja: ConstrutorFicha.#focarLoja,
			comprar: ConstrutorFicha.#comprar,
			ajustarAlquimico: ConstrutorFicha.#ajustarAlquimico,
			abrirVenda: ConstrutorFicha.#abrirVenda,
			alternarVenda: ConstrutorFicha.#alternarVenda,
			marcarTodosVenda: ConstrutorFicha.#marcarTodosVenda,
			confirmarVenda: ConstrutorFicha.#confirmarVenda,
			escolherImagem: ConstrutorFicha.#escolherImagem,
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
			recomecar: ConstrutorFicha.#recomecar,
			tentarDeNovo: ConstrutorFicha.#tentarDeNovo,
			atribuirAberto: ConstrutorFicha.#atribuirAberto,
			focarComplicacao: ConstrutorFicha.#focarComplicacao,
			escolherComplicacao: ConstrutorFicha.#escolherComplicacao
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
		const r = c ? this.dados.regrasClasses[c.name] ?? null : null;
		// classe sem perícias cadastradas: as treinadas da classe são as que o jogador indicou
		if (r?.periciasManuais) return { ...r, fixas: [...(this.estado.periciasFixasManuais ?? [])] };
		return r;
	}

	/** Tipos de magia que a classe pode aprender: os do conjurador e os acrescentados por poderes (ex.: Linhagem Abençoada → divinas). */
	tiposMagiaClasse() {
		const c = this.conjurador;
		const tipos = new Set(c?.tipo === "arc" ? ["arc", "uni"] : ["div", "uni"]);
		for (const { regra } of this.poderesDaClasse()) (regra?.tiposMagiaExtras ?? []).forEach((t) => tipos.add(t));
		return [...tipos];
	}

	/** A classe tem a proficiência (marcial, pesada, escudo)? */
	temProficiencia(p) {
		return this.proficiencias.includes(p);
	}

	/** Proficiências da classe somadas às de habilidades raciais (ex.: Arte da Guerra do hobgoblin). */
	get proficiencias() {
		const set = new Set(this.regrasClasse?.proficiencias ?? []);
		for (const { regra } of this.poderesDaRaca()) (regra?.proficiencias ?? []).forEach((x) => set.add(x));
		return [...set];
	}

	get conjurador() {
		const c = this.regrasClasse?.conjurador;
		if (!c) return null;
		const extra = this.poderesDaClasse().reduce((n, x) => n + (x.regra?.magiasExtra ?? 0), 0);
		return extra ? { ...c, quantidade: c.quantidade + extra } : c;
	}

	get origemDupla() {
		return game.settings.get(MODULE_ID, "origemDupla");
	}

	/**
	 * Benefícios a escolher em cada origem. A origem regional sempre concede um só; a profissional
	 * concede 2 (regra do livro) ou, com a origem dupla ligada, o valor configurado pelo mestre.
	 */
	beneficiosPorOrigem(sub = "principal") {
		if (sub === "regional") return 1;
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
		if (this.atributosVariados) modos.push(...Object.keys(MODOS_VARIADOS));
		return modos.length ? modos : ["pontos"];
	}

	/** Regra opcional "Usar Complicações": precisa do mestre ligar e das complicações do Heróis de Arton carregadas. */
	get usarComplicacoes() {
		try {
			return !!game.settings.get(MODULE_ID, "complicacoes") && !!this.dados?.complicacoes?.length;
		} catch (err) {
			return false;
		}
	}

	/** Complicações disponíveis: as gerais e as da classe escolhida (ou da classe básica, se for variante). */
	complicacoesDisponiveis() {
		const classe = this.classe?.name;
		const base = classe ? this.dados.variantes?.[classe] : null;
		return (this.dados.complicacoes ?? []).filter((c) => !c.classe || c.classe === classe || (base && c.classe === base));
	}

	/** A complicação escolhida (documento), se ainda for válida para a classe atual. */
	get complicacao() {
		const uuid = this.estado.complicacoes?.[0];
		return uuid ? this.complicacoesDisponiveis().find((c) => c.doc.uuid === uuid)?.doc ?? null : null;
	}

	/** Regra opcional "Atributos Variados" ligada pelo mestre. */
	get atributosVariados() {
		try {
			return !!game.settings.get(MODULE_ID, "atributosVariados");
		} catch (err) {
			return false;
		}
	}

	/** Método Clássica com os valores rolados em ordem (For, Des, Con, Int, Sab, Car), sem distribuir. */
	get classicaEmOrdem() {
		try {
			return !!game.settings.get(MODULE_ID, "atributosClassicaEmOrdem");
		} catch (err) {
			return false;
		}
	}

	/**
	 * Valores do método atual que são distribuídos um por atributo (rolagem, arranjo fixo, Clássica,
	 * Épica, Nimb, Khalmyr): {valores, brutos, atribuicao}. null = nada rolado ou método sem valores.
	 */
	fonteValores() {
		const e = this.estado;
		const v = e.atrVariados ?? {};
		switch (e.atrModo) {
			case "rolagem": return e.atrRolagem.valores ? { valores: e.atrRolagem.valores, brutos: e.atrRolagem.brutos, atribuicao: e.atrRolagem.atribuicao } : null;
			case "fixo": return { valores: ARRANJOS_FIXOS[e.atrFixo.arranjo], brutos: null, atribuicao: e.atrFixo.atribuicao };
			case "khalmyr": return { valores: MODOS_VARIADOS.khalmyr.valores, brutos: null, atribuicao: v.khalmyr.atribuicao };
			case "classica":
			case "epica":
			case "nimb": return v[e.atrModo]?.valores ? { valores: v[e.atrModo].valores, brutos: v[e.atrModo].brutos, atribuicao: v[e.atrModo].atribuicao } : null;
		}
		return null;
	}

	/** Valkaria: valor bruto do atributo (8 + dados aplicados) e os dados aplicados nele. */
	valkariaAtributo(k) {
		const v = this.estado.atrVariados?.valkaria;
		const dados = (v?.dados ?? []).map((d, i) => ({ indice: i, valor: d })).filter((x) => v.atribuicao[x.indice] === k);
		return { dados, total: VALKARIA_INICIAL + dados.reduce((s, d) => s + d.valor, 0) };
	}

	/** Modificador racial final (fixo + escolhas de +1). */
	racial(k) {
		const r = this.raca;
		if (!r) return 0;
		if (this.racasAbertas) {
			const mods = this.modificadoresRaca(r);
			return (this.estado.racaAbertos ?? []).reduce((soma, atr, i) => soma + (atr === k ? mods[i] ?? 0 : 0), 0);
		}
		return (r.system.atributos?.[k] ?? 0) + (this.estado.racaAtributos.includes(k) ? 1 : 0);
	}

	/**
	 * Regra opcional "Raças Abertas" do sistema Tormenta20 (configuração do mundo): cada modificador
	 * de atributo da raça pode ir para qualquer atributo, no máximo um modificador por atributo.
	 */
	get racasAbertas() {
		try {
			return !!game.settings.get("tormenta20", "openRaces");
		} catch (err) {
			return false;
		}
	}

	/**
	 * Modificadores de atributo da raça como valores soltos, do maior para o menor: os fixos
	 * (ex.: anão +2, +1, −1) e um +1 para cada atributo flexível (ex.: humano +1, +1, +1).
	 */
	modificadoresRaca(r = this.raca) {
		if (!r) return [];
		const fixos = ATRIBUTOS.map((k) => Number(r.system.atributos?.[k] ?? 0)).filter((v) => v);
		const din = atributosDinamicosRaca(r);
		const flex = din.lista.length ? Array(Math.min(din.qtd, din.lista.length)).fill(1) : [];
		return [...fixos, ...flex].sort((a, b) => b - a);
	}

	/** Habilidades da raça atual com as regras de escolha de data/racas.json: [{poder, regra}]. */
	poderesDaRaca() {
		const r = this.raca;
		if (!r) return [];
		const out = [];
		const doSuplemento = !!this.dados.fonteSuplemento?.has(r.uuid);
		// escolhas da raça que substituem habilidades (ex.: suraggel variante troca Luz Sagrada por uma herança)
		const escolhasDaRaca = (this.dados.regrasRacas[`raca:${r.name}`]?.escolhas ?? [])
			.filter((regra) => !(regra.somenteSuplemento && !doSuplemento) && !(regra.requerSuplemento && !this.dados.suplementoLigado));
		const removidas = new Set();
		for (const regra of escolhasDaRaca) {
			if (!regra.substitui) continue;
			const v = this.estado.racaEscolhas?.[regra.id];
			if ((v?.poderes?.length ?? 0) + (v?.pericias?.length ?? 0) > 0) regra.substitui.forEach((n) => removidas.add(n));
		}
		const regraDe = (p) => {
			const regra = this.dados.regrasRacas[p.name];
			// regras marcadas "somenteSuplemento" valem só para o poder homônimo do suplemento (ex.: Chassi do Golem)
			if (!regra || (regra.somenteSuplemento && !fonteDe(this.dados, p))) return null;
			return regra;
		};
		for (const g of r.system.grants ?? []) {
			for (const c of g.choices ?? []) {
				// alguns poderes do suplemento apontam para "Compendium.world..." (compêndio do autor): busca pelo id
				const id = String(c.uuid).split(".").pop();
				const p = this.dados.poderes.find((x) => x.uuid === c.uuid)
					?? (doSuplemento ? this.dados.poderes.find((x) => x._id === id || x.id === id) : null);
				if (p && !removidas.has(p.name)) out.push({ poder: p, regra: regraDe(p) });
			}
		}
		// escolhas da raça que não pertencem a uma habilidade (ex.: natureza e tamanho do duende)
		for (const regra of escolhasDaRaca) out.push({ poder: r, regra, daRaca: true });
		return out;
	}

	/** Habilidades de 1º nível da classe + poderes escolhidos (Caminho, Linhagem), com as regras de data/poderes-classe.json. */
	poderesDaClasse() {
		const r = this.regrasClasse;
		if (!r || !this.dados) return [];
		const nomes = [...(r.habilidades ?? [])];
		for (const esc of this.escolhasAtivas()) if (this.estado.escolhasClasse[esc.id]) nomes.push(this.estado.escolhasClasse[esc.id]);
		const out = [];
		for (const n of nomes) {
			const p = poder(this.dados, n);
			if (!p) continue;
			const regra = this.dados.regrasPoderesClasse[p.name];
			// uma regra pode trazer escolhas extras (ex.: Linhagem Abençoada: deus maior + magia divina)
			const regras = regra ? [regra, ...(regra.extras ?? [])] : [null];
			for (const r of regras) out.push({ poder: p, regra: this.#comFonte(r, "classe") });
		}
		return out;
	}

	#comFonte(regra, fonte) {
		return regra ? { ...regra, fonte } : null;
	}

	/** Só as habilidades raciais que pedem escolha do jogador. */
	escolhasRaciais() {
		return this.poderesDaRaca().filter((x) => x.regra?.tipo);
	}

	/** Habilidades de classe com escolha. `tipos` restringe (ex.: só as mostradas no passo Classe). */
	escolhasDeClasse(tipos = null) {
		return this.poderesDaClasse().filter((x) => x.regra?.tipo && (!tipos || tipos.includes(x.regra.tipo)));
	}

	/** Onde fica no estado a escolha de uma regra. */
	campoEscolha(regra) {
		return `${regra.fonte === "classe" ? "classePoderEscolhas" : "racaEscolhas"}.${regra.id}`;
	}

	/** Estado de uma escolha de poder, sempre no formato do tipo. */
	escolhaRacial(regra) {
		const v = foundry.utils.getProperty(this.estado, this.campoEscolha(regra));
		switch (regra.tipo) {
			case "opcao":
			case "item": return typeof v === "string" ? v : "";
			case "magias":
			case "especialista": return Array.isArray(v) ? v : [];
			case "prototipo": return {
				modo: v?.modo ?? "", item: v?.item ?? "", melhoria: v?.melhoria ?? "",
				alquimicos: v?.alquimicos && typeof v.alquimicos === "object" ? v.alquimicos : {}
			};
		}
		return { pericias: v?.pericias ?? [], poderes: v?.poderes ?? [] };
	}

	/**
	 * Descarta do rascunho o que não existe mais nos dados carregados (ex.: o mestre desligou os
	 * Suplementos de Arton no meio da criação). O passo afetado volta a pedir a escolha.
	 */
	#limparReferencias() {
		const e = this.estado;
		const d = this.dados;
		const existe = (lista, uuid) => !uuid || lista.some((x) => x.uuid === uuid);
		if (!existe(d.racas, e.raca)) Object.assign(e, { raca: "", racaAtributos: [], racaEscolhas: {} });
		if (!existe(d.classes, e.classe)) {
			Object.assign(e, {
				classe: "", escolhasClasse: {}, classePoderEscolhas: {}, magiasEscolas: [], magias: [],
				periciasOu: [], periciasFixasManuais: [], periciasClasse: [], poderesConcedidos: [], divindade: "", devoto: null
			});
		}
		const uuidsMagias = new Set(d.magias.map((m) => m.uuid));
		e.magias = e.magias.filter((u) => uuidsMagias.has(u));
		const div = d.divindades.find((x) => x.nome === e.divindade);
		if (e.divindade && !div) Object.assign(e, { divindade: "", poderesConcedidos: [] });
		if (div) e.poderesConcedidos = e.poderesConcedidos.filter((n) => div.poderes.includes(n) && poder(d, n) && !this.impedimentoPoder(poder(d, n)));
		for (const [sub, lista] of [["principal", d.origens], ["regional", d.origensRegionais]]) {
			const o = e.origens[sub];
			if (o.nome && !lista.some((x) => x.nome === o.nome)) {
				Object.assign(o, { nome: "", beneficios: [], grupos: {}, itens: {}, amnPericia: "", amnPoder: "" });
			}
			for (const [g, n] of Object.entries(o.grupos ?? {})) if (!poder(d, n)) delete o.grupos[g];
		}
		const limparEscolhas = (mapa) => {
			for (const [id, v] of Object.entries(mapa ?? {})) {
				if (Array.isArray(v) && v.some((x) => String(x).startsWith("Compendium."))) mapa[id] = v.filter((u) => uuidsMagias.has(u));
				else if (v?.poderes) v.poderes = v.poderes.filter((n) => poder(d, n));
			}
		};
		limparEscolhas(e.racaEscolhas);
		limparEscolhas(e.classePoderEscolhas);
		// a origem regional concede um só benefício (rascunhos antigos podiam ter mais)
		const reg = e.origens.regional;
		if (reg.beneficios.length > 1) {
			for (const b of reg.beneficios.slice(1)) if (b.startsWith("grupo:")) delete reg.grupos[b.slice(6)];
			reg.beneficios = reg.beneficios.slice(0, 1);
		}
		const armas = new Set(d.armas.map((a) => a.name));
		for (const campo of ["arma", "armaMarcial"]) if (e.equip?.[campo] && !armas.has(e.equip[campo])) e.equip[campo] = "";
		const loja = new Set(d.loja.map((x) => x.doc.name));
		for (const nome of Object.keys(e.compras ?? {})) if (!loja.has(nome)) delete e.compras[nome];
	}

	/** Garante a estrutura das escolhas da raça e da classe atuais; descarta as que deixaram de valer. */
	#prepararEscolhasRaciais() {
		const e = this.estado;
		e.racaEscolhas ??= {};
		for (const { regra } of this.escolhasRaciais()) e.racaEscolhas[regra.id] = this.escolhaRacial(regra);
		const ativas = {};
		for (const { regra } of this.escolhasDeClasse()) ativas[regra.id] = this.escolhaRacial(regra);
		e.classePoderEscolhas = ativas;
	}

	/** Perícias treinadas automaticamente por poderes de classe (ex.: Linhagem Feérica → Enganação). */
	periciasDePoderesClasse() {
		const set = new Set();
		for (const { regra } of this.poderesDaClasse()) (regra?.periciasFixas ?? []).forEach((k) => set.add(k));
		return set;
	}

	/** Quantas perícias o Especialista escolhe: Inteligência, mínimo 1. */
	get qtdEspecialista() {
		return Math.max(1, this.atributoFinal("int"));
	}

	/** Pendência de uma lista de escolhas de poder (null = completas). */
	#pendenciaEscolhas(lista) {
		for (const { poder: p0, regra, daRaca } of lista) {
			const p = daRaca ? { name: regra.titulo } : p0;
			const v = this.escolhaRacial(regra);
			if (regra.tipo === "opcao" && !v) return `${p.name}: escolha ${regra.titulo.toLowerCase()}.`;
			if (regra.tipo === "magias" && v.length !== regra.quantidade) {
				return `${p.name}: escolha ${regra.quantidade} magia(s) (${v.length}/${regra.quantidade}).`;
			}
			if (regra.tipo === "beneficio") {
				const n = v.pericias.length + v.poderes.length;
				if (regra.opcional && n === 0) continue;
				if (n !== regra.quantidade) return `${p.name}: faça ${regra.quantidade} escolha(s) (${n}/${regra.quantidade}).`;
			}
			if (regra.tipo === "especialista") {
				const n = Math.min(this.qtdEspecialista, this.periciasTreinadas().size);
				if (v.length !== n) return `Especialista: escolha ${n} perícia(s) treinada(s) (${v.length}/${n}).`;
			}
			if (regra.tipo === "item" && !v) return `${p.name}: escolha um item de até T$ ${regra.precoMax}.`;
			if (regra.tipo === "prototipo") {
				if (!v.modo) return "Protótipo: escolha entre item superior e itens alquímicos.";
				if (v.modo === "superior" && (!v.item || !v.melhoria)) return "Protótipo: escolha o item e a melhoria.";
				if (v.modo === "alquimicos") {
					const { qtd } = this.totaisAlquimicos(v);
					if (!qtd) return "Protótipo: escolha seus itens alquímicos.";
				}
			}
		}
		return null;
	}

	/** Quantidade e preço total dos itens alquímicos do Protótipo. */
	totaisAlquimicos(v) {
		let qtd = 0, preco = 0;
		for (const [nome, n] of Object.entries(v.alquimicos ?? {})) {
			const it = this.itemLoja(nome);
			qtd += n;
			preco += Number(it?.doc.system.preco ?? 0) * n;
		}
		return { qtd, preco: Math.round(preco * 100) / 100 };
	}

	/** A raça não escolhe origem (Golem: Propósito de Criação). */
	get racaSemOrigem() {
		return this.poderesDaRaca().some((x) => x.regra?.semOrigem);
	}

	/** Perícias treinadas por habilidades raciais (Versátil, Híbrido, Memória Póstuma). */
	periciasRaciais({ exceto = null } = {}) {
		const set = new Set();
		for (const { regra } of this.poderesDaRaca()) (regra?.periciasFixas ?? []).forEach((k) => set.add(k));
		for (const { regra } of this.escolhasRaciais()) {
			if (regra.tipo !== "beneficio" || regra.pericia !== "treinada" || regra.id === exceto) continue;
			this.escolhaRacial(regra).pericias.forEach((k) => set.add(k));
		}
		return set;
	}

	/** Remove das escolhas seguintes as perícias que passaram a ser treinadas pela raça. */
	#removerConflitosRaciais() {
		const e = this.estado;
		const raciais = new Set([...this.periciasRaciais(), ...this.periciasDePoderesClasse()]);
		if (!raciais.size) return;
		e.periciasOu = e.periciasOu.map((k) => (raciais.has(k) ? "" : k));
		e.periciasClasse = e.periciasClasse.filter((k) => !raciais.has(k));
		e.periciasInt = e.periciasInt.filter((k) => !raciais.has(k));
		for (const o of Object.values(e.origens)) {
			o.beneficios = o.beneficios.filter((b) => !(b.startsWith("pericia:") && raciais.has(b.slice(8))));
			if (raciais.has(o.amnPericia)) o.amnPericia = "";
		}
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
			case "valkaria": {
				if (!e.atrVariados?.valkaria?.dados) return null;
				return converterRolagem(this.valkariaAtributo(k).total);
			}
			case "classica":
			case "epica":
			case "nimb":
			case "khalmyr": {
				const f = this.fonteValores();
				const i = f?.atribuicao[k];
				return !f || i === "" || i === undefined ? null : f.valores[Number(i)];
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
		const set = this.periciasRaciais();
		if (r) {
			r.fixas.forEach((k) => set.add(k));
			this.periciasDePoderesClasse().forEach((k) => set.add(k));
			e.periciasOu.forEach((k) => k && set.add(k));
		}
		if (ate === "classe") return set;
		e.periciasClasse.forEach((k) => set.add(k));
		if (ate === "int") return set;
		e.periciasInt.forEach((k) => set.add(k));
		if (ate === "origem") return set;
		for (const o of this.origensAtivas()) {
			for (const b of o.estado.beneficios) if (b.startsWith("pericia:")) set.add(b.slice(8));
			if (o.def.especial === "mundana") (o.def.periciasMundanas ?? []).forEach((k) => set.add(k));
			if (o.estado.amnPericia) set.add(o.estado.amnPericia);
		}
		return set;
	}

	origensAtivas() {
		const out = [];
		if (this.racaSemOrigem) return out;
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
	 * Só as listas fixas de algumas classes restringem (Druida e Paladino, em classes.json).
	 * A lista de devotos de cada deus (raças e classes) é apenas informativa: não bloqueia.
	 */
	impedimentoDivindade(d) {
		const r = this.regrasClasse;
		if (r?.devocao?.divindades && !r.devocao.divindades.includes(d.nome)) {
			return `${this.classe?.name}s só podem ser devotos de ${r.devocao.divindades.join(", ")}.`;
		}
		return null;
	}

	/** Motivo pelo qual o personagem não pode escolher o poder (null = pode). Ex.: "Apenas druidas". */
	impedimentoPoder(p) {
		const classes = p?.apenasClasses;
		if (!classes?.length) return null;
		const classe = this.classe?.name;
		const base = classe ? this.dados.variantes?.[classe] ?? this.dados.regrasClasses[classe]?.variante : null;
		if (classes.includes(classe) || (base && classes.includes(base))) return null;
		return `Apenas ${classes.map((c) => c.toLowerCase()).join(" ou ")}s podem escolher este poder.`;
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
		if (this.ehDevoto) {
			const d = this.estado.divindade;
			return d && this.estado.fundamentalista ? `${d} (fundamentalista)` : d;
		}
		if (this.estado.devoto === false && this.alternativaDevocao) return this.alternativaDevocao.nome;
		return "";
	}

	poderesConcedidosPermitidos() {
		// devoto fundamentalista escolhe um poder concedido a mais
		return (this.regrasClasse?.devocao?.poderes ?? 1) + (this.ehDevoto && this.estado.fundamentalista ? 1 : 0);
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
		if (!this.racaSemOrigem) lista.push({
			id: "origem", sub: "principal",
			titulo: this.origemDupla ? "Origem profissional" : "Origem",
			dica: "Escolha sua origem e os benefícios que ela fornece."
		});
		if (this.origemDupla && !this.racaSemOrigem) {
			lista.push({ id: "origem", sub: "regional", titulo: "Origem regional", dica: "Escolha sua origem regional." });
		}
		lista.push(
			{ id: "devocao", titulo: "Devoção", dica: "Seu personagem é devoto de algum deus?" },
			...(this.usarComplicacoes ? [{ id: "complicacoes", titulo: "Complicações", dica: "Uma complicação opcional: em troca, você recebe um poder geral." }] : []),
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
				if (this.racasAbertas) {
					const mods = this.modificadoresRaca(r);
					const feitos = mods.filter((_, i) => e.racaAbertos?.[i]).length;
					if (feitos < mods.length) return `Distribua os modificadores da raça (${feitos}/${mods.length}).`;
					return this.#pendenciaEscolhas(this.escolhasRaciais());
				}
				const din = atributosDinamicosRaca(r);
				if (din.lista.length && e.racaAtributos.length !== Math.min(din.qtd, din.lista.length)) {
					return `Escolha ${Math.min(din.qtd, din.lista.length)} atributos para receber +1.`;
				}
				return this.#pendenciaEscolhas(this.escolhasRaciais());
			}
			case "atributos": {
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
			}
			case "classe": {
				if (!this.classe) return "Escolha uma classe.";
				for (const esc of this.escolhasAtivas()) {
					if (!e.escolhasClasse[esc.id]) return `Escolha: ${esc.titulo}.`;
				}
				return this.#pendenciaEscolhas(this.escolhasDeClasse(["opcao", "magias", "beneficio"]));
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
				if (r.periciasManuais && !r.fixas.length) return "Indique as perícias treinadas da classe (consulte o livro).";
				if (r.ou.some((_, i) => !e.periciasOu[i])) return "Escolha as perícias obrigatórias da classe.";
				if (e.periciasClasse.length !== r.numero) {
					return `Escolha ${r.numero} perícias da classe (${e.periciasClasse.length} escolhidas).`;
				}
				const nInt = Math.max(0, this.atributoFinal("int"));
				if (e.periciasInt.length !== nInt) {
					return `Escolha ${nInt} perícias por Inteligência (${e.periciasInt.length} escolhidas).`;
				}
				return this.#pendenciaEscolhas(this.escolhasDeClasse(["especialista"]));
			}
			case "origem": {
				const o = e.origens[passo.sub];
				const lista = passo.sub === "regional" ? this.dados.origensRegionais : this.dados.origens;
				if (passo.sub === "regional" && !lista.length) return null; // sem dados: passo opcional
				const def = lista.find((x) => x.nome === o.nome);
				if (!def) return "Escolha uma origem.";
				if (def.especial === "amnesico") {
					if (!o.amnPericia || !o.amnPoder) return "Escolha a perícia e o poder (definidos pelo mestre).";
				} else if (def.especial === "mundana") {
					// origem mundana: benefício fixo; só pede o que o texto manda escolher
					if (def.escolhaPericia && !o.amnPericia) return `Escolha: ${def.escolhaPericia.titulo}.`;
					if (def.escolhaPoder && !o.amnPoder) return `Escolha: ${def.escolhaPoder.titulo}.`;
				} else {
					const n = this.beneficiosPorOrigem(passo.sub);
					if (o.beneficios.length !== n) return `Escolha ${n === 1 ? "1 benefício" : `${n} benefícios`} (${o.beneficios.length} escolhidos).`;
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
			case "complicacoes":
				if (this.complicacao && !e.complicacaoPoder) return "Escolha o poder geral concedido pela complicação.";
				return null;
			case "equipamento":
				if (!e.equip.arma) return "Escolha sua arma simples.";
				if (this.temProficiencia("marcial") && !e.equip.armaMarcial) return "Escolha sua arma marcial.";
				return this.#pendenciaEscolhas(this.escolhasDeClasse(["item", "prototipo"]));
			case "dinheiro":
				if (e.dinheiro === null) return "Role seus tibares iniciais.";
				if (this.saldo < 0) return "Saldo negativo: devolva algumas compras.";
				return null;
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
		this.#limparReferencias();
		this.#prepararEscolhasRaciais();
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
		ctx.slideout = await this.#ctxSlideout();
		return ctx;
	}

	_onRender(context, options) {
		super._onRender(context, options);
		// a tela de carregamento foi desenhada depois de os dados ficarem prontos: desenha o construtor
		if (context.carregando) {
			if (!this._carregando && !context.erro) this.render();
			return;
		}
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
		return Math.round(((this.estado.dinheiro ?? 0) + this.valorVendas - this.gastoCompras) * 100) / 100;
	}

	/** Total recebido pela venda de itens iniciais (T$). */
	get valorVendas() {
		return this.#vendas(this.plano({ semVendas: true }).itens).total;
	}

	/** Preço de venda de uma entrada de item inicial: metade do preço (0 = não vende). */
	precoVenda(it) {
		if (it.texto) return 0;
		const doc = equipamento(this.dados, it.nome);
		const preco = Number(doc?.system?.preco ?? 0) + (it.melhoria ? (this.dados.regrasPoderesClasse["Protótipo"]?.precoMelhoria ?? 300) : 0);
		if (!doc || preco <= 0) return 0;
		const pacote = Number(doc.system.qtd) > 1 ? Number(doc.system.qtd) : 1;
		return Math.round((preco * ((it.qtd ?? 1) / pacote) / 2) * 100) / 100;
	}

	/**
	 * Casa as vendas do estado com os itens iniciais disponíveis (cada nome vende uma entrada).
	 * Retorna os índices vendidos e o total, ignorando vendas de itens que não existem mais.
	 */
	#vendas(iniciais) {
		const usados = new Set();
		const indices = [];
		let total = 0;
		for (const nome of this.estado.vendas ?? []) {
			const i = iniciais.findIndex((it, j) => !usados.has(j) && it.nome === nome && this.precoVenda(it) > 0);
			if (i < 0) continue;
			usados.add(i);
			indices.push(i);
			total += this.precoVenda(iniciais[i]);
		}
		return { indices, total: Math.round(total * 100) / 100 };
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
		// tipo (Armas e munições, Armaduras e escudos, Itens gerais) → categoria; só os que têm itens
		const presentes = new Set(this.dados.loja.map((x) => x.categoria));
		const tipos = this.dados.estruturaLoja
			.map((t) => ({ ...t, categorias: t.categorias.filter((c) => presentes.has(c)) }))
			.filter((t) => t.categorias.length);
		let tipo = tipos.find((t) => t.tipo === this.lojaTipo) ?? tipos[0];
		this.lojaTipo = tipo?.tipo;
		if (!tipo?.categorias.includes(this.lojaCategoria)) this.lojaCategoria = tipo?.categorias[0];
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
			fmtVendas: this.valorVendas ? fmt(this.valorVendas) : "",
			fmtSaldo: fmt(saldo),
			tipos: tipos.map((t) => ({ nome: t.tipo, selecionado: t.tipo === this.lojaTipo })),
			categorias: (tipo?.categorias ?? []).map((c) => ({
				nome: c, selecionado: c === this.lojaCategoria,
				qtd: this.dados.loja.filter((x) => x.categoria === c).length
			})),
			cards,
			carrinho,
			info,
			filtro: this.lojaFiltro
		};
	}

	/* ---------------- Distribuição de atributos (arrastar e soltar) ---------------- */

	#dado(i, valores) {
		const brutos = this.fonteValores()?.brutos ?? null;
		return {
			indice: i,
			valor: sinal(valores[i]),
			bruto: brutos?.[i] ?? null,
			selecionado: this.dadoSelecionado === i
		};
	}

	get #atribuicao() {
		return this.fonteValores()?.atribuicao ?? null;
	}

	/** Coloca o dado `indice` no atributo `alvo` (troca com o que estava lá). alvo vazio = devolve ao monte. */
	#moverDado(indice, alvo) {
		// Valkaria: vários dados podem ir no mesmo atributo; o dado só muda de lugar (sem troca)
		if (this.estado.atrModo === "valkaria") {
			const v = this.estado.atrVariados.valkaria;
			if (!v.dados || !Number.isInteger(indice) || indice < 0 || indice >= v.dados.length) return;
			v.atribuicao[indice] = alvo || "";
			this.dadoSelecionado = null;
			return this.#mudou();
		}
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
		const poderCard = (p) => ({ valor: p.name, nome: p.name, img: p.img, sub: [p.system.subtipo, fonteDe(this.dados, p)].filter(Boolean).join(" · ") });
		switch (tipo) {
			case "arma": {
				const cats = arg.split(",");
				return this.dados.armas.filter((a) => cats.includes(a.system.proficiencia)).map((a) => equip(a.name));
			}
			case "nomes":
				return arg.split("|").map(equip);
			case "grupo":
				return poderesDoGrupo(this.dados, arg).map(poderCard);
			case "magiaRacial": {
				const regra = this.#regraRacial(arg);
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
					const c = this.#cardPericia(k);
					return { valor: k, nome: c.nome, sigla: c.atributo, sub: c.tags };
				});
			case "periciaRacial": {
				const regra = this.#regraRacial(arg);
				const outras = regra?.pericia === "treinada" ? this.periciasRaciais({ exceto: regra.fonte === "classe" ? null : regra.id }) : new Set();
				// lista restrita (ex.: Papel Tribal) ou só perícias de certos atributos (ex.: Esperteza Vulpina)
				const permitidas = regra?.opcoesPericias ? new Set(expandirPericias(regra.opcoesPericias)) : null;
				const atributos = regra?.atributosPericias ?? null;
				return ordenarPericias(Object.keys(CONFIG.T20?.pericias ?? {}))
					.filter((k) => !outras.has(k))
					.filter((k) => !permitidas || permitidas.has(k))
					.filter((k) => !atributos || atributos.includes(CONFIG.T20.pericias[k]?.abl))
					.map((k) => {
						const c = this.#cardPericia(k);
						return { valor: k, nome: c.nome, sigla: c.atributo, sub: c.tags };
					});
			}
			case "lojaAte": {
				const max = Number(arg);
				return this.dados.loja.filter(({ doc }) => Number(doc.system.preco) <= max)
					.map(({ doc, categoria }) => ({ ...equip(doc.name), sub: `${ConstrutorFicha.formatarTibares(doc.system.preco)} · ${categoria}` }));
			}
			case "itemSuperior": {
				const max = Number(arg);
				return this.dados.loja.filter(({ doc }) => tipoMelhoria(doc) && Number(doc.system.preco) <= max)
					.map(({ doc, categoria }) => ({ ...equip(doc.name), sub: `${ConstrutorFicha.formatarTibares(doc.system.preco)} · ${categoria}` }));
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
					.filter((p) => (p.system.tipo === "geral" && poderSelecionavel(this.dados, p)) || (p.system.tipo === "origem" && !fonteDe(this.dados, p)))
					.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(poderCard);
			case "poderGeralComplicacao": {
				// poder geral concedido pela complicação: tira os que o personagem já recebe por outras fontes
				const atual = this.estado.complicacaoPoder;
				const ja = new Set(this.plano({ semComplicacao: true }).gruposPoderes.flatMap((g) => g.poderes.map((p) => p.name)));
				return this.dados.poderes.filter((p) => p.system.tipo === "geral" && poderSelecionavel(this.dados, p) && (!ja.has(p.name) || p.name === atual))
					.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")).map(poderCard);
			}
			case "poderGeral":
				return this.dados.poderes.filter((p) => p.system.tipo === "geral" && poderSelecionavel(this.dados, p))
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
		if (tipo === "magia" || tipo === "magiaRacial") {
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
		if (tipo === "melhoria") {
			const m = this.dados.melhorias.find((x) => x.uuid === valor);
			if (!m) return null;
			return { nome: m.name, img: m.img, stats: [{ rotulo: "Custo", valor: "+T$ 300 (1 melhoria)" }], descricao: await this.#html(m.uuid, m.description) };
		}
		if (tipo === "arma" || tipo === "nomes" || tipo === "lojaAte" || tipo === "itemSuperior") {
			const f = this.#fichaEquip(valor);
			return {
				nome: f.nome, img: f.img,
				stats: f.stats.map(([rotulo, v]) => ({ rotulo, valor: v })),
				descricao: f.doc ? await this.#html(f.doc.uuid, f.doc.system?.description?.value) : ""
			};
		}
		if (["grupo", "poderGeral", "poderes", "poderGeralOrigem", "poderGeralComplicacao"].includes(tipo)) {
			const p = poder(this.dados, valor);
			if (!p) return null;
			const i = await this.#infoPoder(p);
			return { ...i, stats: [{ rotulo: "Tipo", valor: p.system.subtipo }] };
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
				descricao: await this.#descricaoPericia(valor)
			};
		}
		return null;
	}

	async #ctxSlideout() {
		const so = this.slideout;
		if (!so) return null;
		if (so.tipo === "venda") return this.#ctxSlideoutVenda();
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

	/** Slideout de venda: marcar vários itens iniciais, ver o total e confirmar de uma vez. */
	async #ctxSlideoutVenda() {
		const so = this.slideout;
		const fmt = ConstrutorFicha.formatarTibares;
		const iniciais = this.plano({ semVendas: true }).itens;
		const sel = this.vendaRascunho ?? new Set();
		const cards = [];
		iniciais.forEach((it, i) => {
			const pv = this.precoVenda(it);
			if (!pv) return;
			const f = this.#fichaEquip(it.nome);
			cards.push({
				indice: i, img: f.img,
				nome: it.qtd > 1 ? `${f.nome} ×${it.qtd}` : f.nome,
				sub: [`Vende por ${fmt(pv)}`, f.sub].filter(Boolean).join(" · "),
				selecionado: sel.has(i),
				foco: so.foco === i
			});
		});
		const total = Math.round([...sel].reduce((t, i) => t + (iniciais[i] ? this.precoVenda(iniciais[i]) : 0), 0) * 100) / 100;
		let info = null;
		const it = iniciais[so.foco];
		if (it && this.precoVenda(it)) {
			const f = this.#fichaEquip(it.nome);
			info = {
				indice: so.foco, nome: f.nome, img: f.img,
				selecionado: sel.has(so.foco),
				stats: [
					{ rotulo: "Venda", valor: `${fmt(this.precoVenda(it))} (metade do preço)` },
					...f.stats.map(([rotulo, valor]) => ({ rotulo, valor }))
				],
				descricao: f.doc ? await this.#html(f.doc.uuid, f.doc.system?.description?.value) : ""
			};
		}
		const atual = this.#vendas(iniciais);
		const animar = so.animar;
		so.animar = false;
		const rolado = this.estado.dinheiro !== null;
		return {
			venda: true, titulo: so.titulo, cards, info, animar, filtro: so.filtro, longa: cards.length > 8,
			qtdSelecionados: sel.size,
			total: fmt(total),
			todos: sel.size === cards.length,
			mudou: !(sel.size === atual.indices.length && atual.indices.every((i) => sel.has(i))),
			// com o dinheiro já rolado, mostra como fica a carteira
			carteira: rolado ? fmt(this.saldo - atual.total + total) : null
		};
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
			case "complicacoes": return this.#ctxComplicacoes();
			case "equipamento": return this.#ctxEquipamento();
			case "dinheiro": return this.#ctxDinheiro();
			case "revisao": return this.#ctxRevisao();
		}
		return {};
	}

	#textoAtributosRaca(r) {
		if (this.racasAbertas) {
			const mods = this.modificadoresRaca(r);
			return mods.length ? `Modificadores livres: ${mods.map(sinal).join(", ")}` : "—";
		}
		const partes = ATRIBUTOS.filter((k) => r.system.atributos?.[k])
			.map((k) => `${NOMES_ATRIBUTOS[k]} ${sinal(r.system.atributos[k])}`);
		const din = atributosDinamicosRaca(r);
		if (din.lista.length) {
			const excluidos = ATRIBUTOS.filter((k) => !din.lista.includes(k)).map((k) => NOMES_ATRIBUTOS[k]);
			const qtd = { 1: "um", 2: "dois", 3: "três", 4: "quatro" }[din.qtd] ?? din.qtd;
			partes.unshift(`+1 em ${qtd} atributos${excluidos.length ? ` (exceto ${excluidos.join(", ")})` : ""}`);
		}
		return partes.join(", ") || "—";
	}

	async #ctxRaca() {
		const e = this.estado;
		const racas = this.dados.racas.map((r) => ({
			uuid: r.uuid, nome: r.name, img: r.img,
			resumo: this.#textoAtributosRaca(r),
			fonte: fonteDe(this.dados, r),
			selecionado: r.uuid === e.raca
		}));
		// agrupadas por livro: o básico primeiro, depois Heróis de Arton, Ameaças de Arton e os demais
		const ORDEM = ["", "Heróis de Arton", "Ameaças de Arton"];
		const porLivro = new Map();
		for (const card of racas) (porLivro.get(card.fonte) ?? porLivro.set(card.fonte, []).get(card.fonte)).push(card);
		const grupos = [...porLivro.entries()]
			.sort(([a], [b]) => {
				const ia = ORDEM.indexOf(a), ib = ORDEM.indexOf(b);
				if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
				return a.localeCompare(b, "pt-BR");
			})
			.map(([fonte, lista]) => ({ titulo: fonte || "Tormenta20 — Jogo do Ano", racas: lista }));

		let info = null;
		const r = this.raca;
		if (r) {
			const poderes = [];
			for (const { poder: p, regra, daRaca } of this.poderesDaRaca()) {
				// escolha da própria raça (sem habilidade associada): só o título e os controles
				const info = daRaca ? { nome: regra.titulo, escolhaDaRaca: true } : await this.#infoPoder(p);
				if (regra?.tipo) {
					info.escolha = this.#ctxEscolhaRacial(p, regra);
					info.aberto = !!info.escolha.pendente;
				}
				if (regra?.magiasFixas) {
					info.magiasFixas = regra.atributo
						? `${regra.magiasFixas.join(", ")} (atributo-chave ${NOMES_ATRIBUTOS[regra.atributo]})`
						: regra.magiasFixas.join(", ");
				}
				poderes.push(info);
			}
			const din = atributosDinamicosRaca(r);
			info = {
				nome: r.name, img: r.img, fonte: fonteDe(this.dados, r),
				doSuplemento: !!this.dados.fonteSuplemento?.has(r.uuid),
				atributos: this.#textoAtributosRaca(r),
				descricao: await this.#html(r.uuid, r.system.description?.value),
				poderes,
				abertos: this.racasAbertas ? this.#ctxRacaAberta(r) : null,
				dinamicos: din.lista.length && !this.racasAbertas
					? din.lista.map((k) => ({
						chave: k, nome: NOMES_ATRIBUTOS[k],
						selecionado: e.racaAtributos.includes(k)
					}))
					: null,
				qtdDinamicos: Math.min(din.qtd, din.lista.length),
				dinamicosDeduzidos: din.deduzido,
				semOrigem: this.racaSemOrigem
			};
		}
		return { racas, grupos, variosGrupos: grupos.length > 1, filtro: this.filtros?.raca ?? "", info };
	}

	/** Raças abertas: uma linha por modificador, com os seis atributos para escolher. */
	#ctxRacaAberta(r) {
		const usados = this.estado.racaAbertos ?? [];
		const mods = this.modificadoresRaca(r);
		return {
			linhas: mods.map((v, i) => ({
				indice: i,
				valor: sinal(v),
				negativo: v < 0,
				atributos: ATRIBUTOS.map((k) => ({
					chave: k, nome: NOMES_ATRIBUTOS[k],
					selecionado: usados[i] === k,
					// um modificador por atributo: os já usados por outra linha ficam bloqueados
					bloqueado: usados.some((x, j) => j !== i && x === k)
				}))
			})),
			feitos: mods.filter((_, i) => usados[i]).length,
			total: mods.length
		};
	}

	/** Controles de uma escolha racial no painel da raça. */
	#ctxEscolhaRacial(p, regra) {
		const v = this.escolhaRacial(regra);
		const campo = this.campoEscolha(regra);
		const base = { titulo: regra.titulo, poder: p.name, campo };
		if (regra.tipo === "opcao") {
			return {
				...base, ehOpcao: true, pendente: !v,
				opcoes: regra.opcoes.map((o) => ({ ...o, selecionado: o.valor === v }))
			};
		}
		if (regra.tipo === "magias") {
			const escolhidas = v.map((u) => this.dados.magias.find((m) => m.uuid === u)).filter(Boolean)
				.map((m) => ({ valor: m.uuid, nome: m.name, img: m.img }));
			return {
				...base, ehMagias: true,
				pendente: v.length !== regra.quantidade,
				escolhidas,
				lista: `magiaRacial:${regra.fonte}.${regra.id}`,
				limite: regra.quantidade,
				contagem: `${v.length}/${regra.quantidade}`,
				podeAdicionar: v.length < regra.quantidade,
				atributo: regra.atributo ? NOMES_ATRIBUTOS[regra.atributo] : ""
			};
		}
		const total = v.pericias.length + v.poderes.length;
		const resta = regra.quantidade - total;
		const sufixo = regra.pericia === "bonus" ? ` +${regra.bonus}` : "";
		return {
			...base, ehBeneficio: true,
			nota: regra.nota ?? "",
			pendente: resta !== 0 && !(regra.opcional && total === 0),
			contagem: `${total}/${regra.quantidade}`,
			pericias: v.pericias.map((k) => ({ valor: k, nome: `${rotuloPericia(k)}${sufixo}` })),
			poderes: v.poderes.map((n) => ({ valor: n, nome: n })),
			campoPericias: `${campo}.pericias`,
			campoPoderes: `${campo}.poderes`,
			listaPericia: `periciaRacial:${regra.fonte}.${regra.id}`,
			listaPoder: regra.poder?.lista ?? "",
			limitePericias: resta + v.pericias.length,
			limitePoderes: Math.min(regra.poder?.maximo ?? 0, resta + v.poderes.length),
			podePericia: !!regra.pericia && resta > 0,
			podePoder: !!regra.poder && resta > 0 && v.poderes.length < regra.poder.maximo,
			textoPericia: regra.pericia === "bonus" ? `perícia (+${regra.bonus})` : "perícia treinada",
			nomePoder: regra.poder?.nome ?? ""
		};
	}

	/** Regra pelo identificador "fonte.id" usado nas listas do slideout. */
	#regraRacial(chave) {
		const [fonte, id] = chave.split(".");
		const lista = fonte === "classe" ? this.escolhasDeClasse() : this.escolhasRaciais();
		return lista.find((x) => x.regra.id === id)?.regra ?? null;
	}

	#ctxAtributos() {
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

	async #ctxClasse() {
		const e = this.estado;
		const classes = this.dados.classes.map((c) => ({
			uuid: c.uuid, nome: this.dados.regrasClasses[c.name]?.nomeExibicao ?? c.name, img: c.img,
			resumo: `PV ${c.system.pvPorNivel * 4} · PM ${c.system.pmPorNivel}`,
			fonte: fonteDe(this.dados, c),
			selecionado: c.uuid === e.classe
		}));
		let info = null;
		const c = this.classe;
		if (c) {
			const r = this.regrasClasse ?? {};
			const nomesProf = { marcial: "Armas marciais", pesada: "Armaduras pesadas", escudo: "Escudos" };
			const prof = ["Armas simples", "Armaduras leves", ...(r.proficiencias ?? []).map((p) => nomesProf[p] ?? p)];
			// Escolhas dos poderes de classe mostradas aqui (as de perícia e equipamento ficam nos passos delas)
			const regrasPorPoder = new Map();
			for (const x of this.poderesDaClasse()) {
				if (!regrasPorPoder.has(x.poder.name)) regrasPorPoder.set(x.poder.name, []);
				if (x.regra) regrasPorPoder.get(x.poder.name).push(x.regra);
			}
			const comEscolha = async (p) => {
				const info = await this.#infoPoder(p);
				info.escolhas = [];
				for (const regra of regrasPorPoder.get(p.name) ?? []) {
					if (["opcao", "magias", "beneficio"].includes(regra.tipo)) {
						info.escolhas.push(this.#ctxEscolhaRacial(p, regra));
						info.aberto = true;
					} else if (regra.tipo) {
						info.nota = { especialista: "Escolha as perícias no passo Perícias.", item: "Escolha o item no passo Equipamento.", prototipo: "Monte o protótipo no passo Equipamento." }[regra.tipo];
					}
					if (regra.periciasFixas) info.nota = `Treinado em ${regra.periciasFixas.map(rotuloPericia).join(", ")} (já marcado na ficha).`;
					if (regra.magiasExtra) info.nota = `+${regra.magiasExtra} magia inicial (total ${this.conjurador?.quantidade}).`;
					if (regra.tiposMagiaExtras) info.nota = "Magias divinas de 1º círculo também aparecem na sua lista de magias de feiticeiro.";
				}
				return info;
			};
			const habilidades = [];
			for (const nome of r.habilidades ?? []) {
				const p = poder(this.dados, nome);
				if (p) habilidades.push(await comEscolha(p));
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
						info: e.escolhasClasse[esc.id] === o.poder && p ? await comEscolha(p) : null
					});
				}
				escolhas.push({ id: esc.id, titulo: esc.titulo, campo: `escolhasClasse.${esc.id}`, opcoes });
			}
			const conj = this.conjurador;
			info = {
				nome: r.nomeExibicao ?? c.name, img: c.img,
				pv: `${c.system.pvPorNivel * 4} + Con no 1º nível (+${c.system.pvPorNivel} + Con por nível)`,
				pm: `${c.system.pmPorNivel} por nível`,
				pericias: c.system.pericias?.inatas || r.periciasTexto || (r.periciasManuais ? "Não registradas: indique no passo Perícias." : ""),
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
				fonte: fonteDe(this.dados, c),
				aviso: r.aviso ?? null,
				semRegras: !this.regrasClasse
			};
		}
		// agrupadas por livro, como as raças: o básico primeiro, depois Heróis de Arton e os demais
		const ORDEM = ["", "Heróis de Arton"];
		const porLivro = new Map();
		for (const card of classes) (porLivro.get(card.fonte) ?? porLivro.set(card.fonte, []).get(card.fonte)).push(card);
		const grupos = [...porLivro.entries()]
			.sort(([a], [b]) => {
				const ia = ORDEM.indexOf(a), ib = ORDEM.indexOf(b);
				if (ia >= 0 || ib >= 0) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
				return a.localeCompare(b, "pt-BR");
			})
			.map(([fonte, lista]) => ({ titulo: fonte || "Tormenta20 — Jogo do Ano", classes: lista }));
		return { classes, grupos, variosGrupos: grupos.length > 1, filtro: this.filtros?.classe ?? "", info };
	}

	/** Magias de 1º círculo que a classe pode aprender (respeitando as escolas escolhidas). */
	magiasDisponiveis() {
		const c = this.conjurador;
		if (!c) return [];
		const tipos = this.tiposMagiaClasse();
		const escolas = this.estado.magiasEscolas;
		return this.dados.magias.filter((m) =>
			circuloMagia(m) === 1
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
		const tipos = this.tiposMagiaClasse();
		const daClasse = (k) => this.dados.magias.filter((m) => circuloMagia(m) === 1 && m.system.escola === k && tipos.includes(m.system.tipo));
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
			const custo = ef.system.abilityUse?.custo ?? null;
			const texto = await this.#html(`${m.uuid}.${ef.id ?? ef._id}`, html);
			const circulo = /Requer (\d)º círculo/i.exec(html)?.[1] ?? null;
			out.push({ custo: custo ? `+${custo} PM` : (ehTruque(custo, html) ? "Truque" : "Variante"), texto, circulo, bloqueado: circulo && Number(circulo) > 1 });
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

		const fixas = ordenarPericias([...new Set([...r.fixas, ...this.periciasDePoderesClasse()])]).map((k) => card(k, { fixa: true }));
		const raciais = this.periciasRaciais();
		const daRaca = ordenarPericias([...raciais]).map((k) => card(k, { fixa: true }));
		const repetidas = r.fixas.filter((k) => raciais.has(k)).map(rotuloPericia);
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
			daRaca,
			repetidas: repetidas.join(", "),
			especialista: this.#ctxEspecialista(),
			manuais: r.periciasManuais ? {
				cards: ordenarPericias(Object.keys(CONFIG.T20?.pericias ?? {})).map((k) => card(k, {
					selecionado: r.fixas.includes(k),
					bloqueado: raciais.has(k) && !r.fixas.includes(k)
				})),
				qtd: r.fixas.length
			} : null,
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

	/** Especialista (Ladino): escolhe perícias treinadas em número igual à Inteligência (mínimo 1). */
	#ctxEspecialista() {
		const [x] = this.escolhasDeClasse(["especialista"]);
		if (!x) return null;
		const v = this.escolhaRacial(x.regra);
		const treinadas = ordenarPericias([...this.periciasTreinadas()]);
		const qtd = Math.min(this.qtdEspecialista, treinadas.length);
		return {
			campo: this.campoEscolha(x.regra),
			qtd,
			contagem: `${v.length}/${qtd}`,
			cards: treinadas.map((k) => ({ chave: k, nome: rotuloPericia(k), selecionado: v.includes(k) }))
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
			fonte: o.fonte ?? "",
			selecionado: o.nome === est.nome
		}));
		// agrupadas por livro (básico primeiro), como as raças
		const porLivro = new Map();
		for (const o of origens) (porLivro.get(o.fonte) ?? porLivro.set(o.fonte, []).get(o.fonte)).push(o);
		const grupos = [...porLivro.entries()]
			.sort(([a], [b]) => (a ? 1 : 0) - (b ? 1 : 0) || a.localeCompare(b, "pt-BR"))
			.map(([fonte, l]) => ({ titulo: fonte || (sub === "regional" ? "Origens regionais" : "Tormenta20 — Jogo do Ano"), origens: l }));
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
					info: await this.#infoPoder(p)
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
			let mundana = null;
			if (def.especial === "mundana") {
				const p = poder(this.dados, def.poder);
				const extras = [];
				for (const n of def.poderesExtras ?? []) {
					const x = poder(this.dados, n);
					if (x) extras.push(await this.#infoPoder(x));
				}
				mundana = {
					poder: p ? { ...(await this.#infoPoder(p)), aberto: true } : null,
					pericias: (def.periciasMundanas ?? []).map((k) => ({ nome: rotuloPericia(k), atributo: this.#cardPericia(k).atributo })),
					oficios: (def.oficiosSemPericia ?? []).map((x) => `Ofício (${x})`).join(", "),
					extras,
					escolhaPericia: def.escolhaPericia ? {
						campo: `${base}.amnPericia`,
						lista: `pericias:${def.escolhaPericia.opcoes.join("|")}`,
						titulo: def.escolhaPericia.titulo,
						rotulo: def.escolhaPericia.titulo,
						escolhido: est.amnPericia ? rotuloPericia(est.amnPericia) : ""
					} : null,
					escolhaPoder: def.escolhaPoder ? {
						campo: `${base}.amnPoder`,
						lista: `poderes:${def.escolhaPoder.opcoes.join("|")}`,
						titulo: def.escolhaPoder.titulo,
						rotulo: def.escolhaPoder.titulo,
						escolhido: est.amnPoder ?? ""
					} : null
				};
			}
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
				qtdBeneficios: this.beneficiosPorOrigem(sub),
				rotuloBeneficios: this.beneficiosPorOrigem(sub) === 1 ? "1 benefício" : `${this.beneficiosPorOrigem(sub)} benefícios`,
				escolhidos: est.beneficios.length,
				campoBeneficios: `${base}.beneficios`,
				itens,
				amnesico,
				mundana,
				fonte: def.fonte ?? ""
			};
		}
		return { origens, grupos, variosGrupos: grupos.length > 1, filtro: this.filtros?.[`origem-${sub}`] ?? "", chaveFiltro: `origem-${sub}`, info, campoNome: `${base}.nome` };
	}

	#resumoOrigem(o) {
		if (o.especial === "amnesico") return "Perícia e poder escolhidos pelo mestre";
		if (o.especial === "mundana") {
			const partes = (o.periciasMundanas ?? []).map(rotuloPericia);
			(o.oficiosSemPericia ?? []).forEach((x) => partes.push(`Ofício (${x})`));
			if (o.escolhaPericia) partes.push(o.escolhaPericia.titulo);
			return [...partes, o.poder].join(", ");
		}
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
			return { nome: d.nome, titulo: d.titulo, menor: !!d.menor, selecionado: d.nome === e.divindade, bloqueado: !!impedimento, impedimento };
		});
		// mostra primeiro as permitidas
		divindades.sort((a, b) => Number(a.bloqueado) - Number(b.bloqueado));
		// O Panteão (os 20 deuses maiores) e, se houver, os deuses menores dos suplementos
		const gruposDivindades = [
			{ titulo: "O Panteão", divindades: divindades.filter((d) => !d.menor) },
			{ titulo: "Deuses Menores", divindades: divindades.filter((d) => d.menor) }
		].filter((g) => g.divindades.length);
		let info = null;
		const div = this.dados.divindades.find((d) => d.nome === (this.focoDivindade || e.divindade));
		if (devoto && div) {
			const poderes = [];
			for (const nome of div.poderes) {
				const p = poder(this.dados, nome);
				if (!p) continue;
				const impedido = this.impedimentoPoder(p);
				poderes.push({
					nome,
					selecionado: e.poderesConcedidos.includes(nome),
					bloqueado: !!impedido,
					motivo: impedido ?? "",
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
				poderes, qtd: this.poderesConcedidosPermitidos(), escolhidos: e.poderesConcedidos.length,
				fundamentalista: !!e.fundamentalista
			};
		}
		const lista = r?.devocao?.divindades ? ` de ${r.devocao.divindades.join(", ")}` : "";
		return {
			obrigatoria: obrig,
			motivo: obrig ? `${this.classe.name}s precisam ser devotos${lista}.` : null,
			alternativa: alt ? {
				nome: alt.nome,
				descricao: alt.descricao,
				poder: alt.poder ? await this.#infoPoder(poder(this.dados, alt.poder)) : null,
				aviso: lista
					? `Se for devoto de um deus, ${this.classe.name.toLowerCase()}s só podem seguir${lista.replace(/^ de/, "")}.`
					: `Como devoto de um deus, você recebe ${this.poderesConcedidosPermitidos()} poder(es) concedido(s); como ${alt.nome}, nenhum.`
			} : null,
			devoto,
			naoDevoto: !obrig && e.devoto === false,
			divindades,
			gruposDivindades,
			filtro: this.filtros?.divindade ?? "",
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
		const prof = this.proficiencias;
		const foco = this.focoEquip;
		const card = (nome, extra = {}) => {
			const f = this.#fichaEquip(nome);
			return { nome: f.nome, img: f.img, sub: f.sub, foco: nome === foco, ...extra };
		};

		// Arma
		// Uma arma simples; quem tem proficiência com armas marciais escolhe também uma marcial
		const vendidosNomes = this.#nomesVendidos();
		const cardEscolha = (nome, campo, atual) => {
			const vendido = atual === nome && vendidosNomes.has(nome);
			return card(nome, { campo, valor: nome, selecionado: atual === nome, vendido, ...(vendido ? { sub: "Vendida" } : {}) });
		};
		const armas = [{ titulo: "Arma simples", campo: "equip.arma", cat: "simples" }];
		if (prof.includes("marcial")) armas.push({ titulo: "Arma marcial", campo: "equip.armaMarcial", cat: "marcial" });
		for (const g of armas) {
			const atual = foundry.utils.getProperty(e, g.campo);
			g.cards = this.dados.armas.filter((a) => a.system.proficiencia === g.cat).map((a) => cardEscolha(a.name, g.campo, atual));
		}

		// Armadura
		const arm = this.dados.equipamento.armaduras ?? {};
		const armaduras = [
			{ nome: "Nenhuma", img: "icons/svg/cancel.svg", sub: "", campo: "equip.armadura", valor: "", selecionado: !e.equip.armadura },
			...[...(arm.leve ?? []), ...(prof.includes("pesada") ? arm.pesada ?? [] : [])]
				.map((n) => cardEscolha(n, "equip.armadura", e.equip.armadura))
		];


		// Itens que já recebe
		const recebidos = [];
		// itens vendidos saem da lista (uma ocorrência por venda)
		const aRemover = this.#nomesVendidos({ lista: true });
		const grupo = (titulo, todos) => {
			const itens = todos.filter((x) => {
				const i = aRemover.indexOf(x.nome);
				if (i < 0) return true;
				aRemover.splice(i, 1);
				return false;
			});
			if (itens.length) recebidos.push({ titulo, cards: itens.map((x) => card(x.nome, { qtd: x.qtd > 1 ? x.qtd : null })) });
		};
		grupo("Todo aventureiro", (this.dados.equipamento.kitBase ?? []).map((n) => ({ nome: n, qtd: 1 })));
		grupo(`Classe (${this.classe?.name ?? ""})`, [
			...(r.equipamentoExtra ?? []).map((n) => ({ nome: n, qtd: 1 })),
			...(prof.includes("escudo") && this.dados.equipamento.escudo ? [{ nome: this.dados.equipamento.escudo, qtd: 1 }] : [])
		]);
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
		const venda = this.#ctxVenda();
		venda.bloqueado = !!this.pendencia({ id: "equipamento" });
		return { armas, armaduras, recebidos, info, itensClasse: this.#ctxItensClasse(), venda, filtro: this.filtros?.equipamento ?? "" };
	}

	/**
	 * Nomes dos itens vendidos. `lista: true` devolve um nome por venda, sem os das escolhas
	 * (arma, armadura), que ficam marcadas como vendidas na própria seção.
	 */
	#nomesVendidos({ lista = false } = {}) {
		const iniciais = this.plano({ semVendas: true }).itens;
		const nomes = this.#vendas(iniciais).indices.map((i) => iniciais[i].nome);
		if (!lista) return new Set(nomes);
		const out = [...nomes];
		for (const n of Object.values(this.estado.equip ?? {})) {
			const i = typeof n === "string" && n ? out.indexOf(n) : -1;
			if (i >= 0) out.splice(i, 1);
		}
		return out;
	}

	/** Venda de itens iniciais: botão para o slideout e lista do que já foi vendido. */
	#ctxVenda() {
		const iniciais = this.plano({ semVendas: true }).itens;
		const vendas = this.#vendas(iniciais);
		const vendidos = vendas.indices.map((i) => {
			const it = iniciais[i];
			return { nome: it.nome, rotulo: it.qtd > 1 ? `${it.nome} ×${it.qtd}` : it.nome, valor: ConstrutorFicha.formatarTibares(this.precoVenda(it)) };
		});
		const temItens = iniciais.some((it) => this.precoVenda(it) > 0);
		return {
			vendidos, total: ConstrutorFicha.formatarTibares(vendas.total), temVendas: vendidos.length > 0, podeVender: temItens,
			listaVendidos: vendidos.map((v) => v.rotulo).join(", ")
		};
	}

	/**
	 * Complicações: lista à esquerda (as da classe e as gerais) e painel à direita com a complicação
	 * em foco, o botão de escolher/desistir e, para a escolhida, o seletor do poder geral.
	 */
	async #ctxComplicacoes() {
		const e = this.estado;
		const escolhida = this.complicacao;
		const disponiveis = this.complicacoesDisponiveis();
		// foco: a clicada por último; se nenhuma, a escolhida
		if (!disponiveis.some((c) => c.doc.uuid === this.focoComplicacao)) this.focoComplicacao = escolhida?.uuid ?? "";
		const resumo = (doc) => {
			const t = String(doc.system?.description?.value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
			return t.length > 90 ? `${t.slice(0, 90).replace(/\s+\S*$/, "")}…` : t;
		};
		const card = (c) => ({
			uuid: c.doc.uuid, nome: c.doc.name, img: c.doc.img,
			sub: resumo(c.doc),
			selecionado: escolhida?.uuid === c.doc.uuid,
			foco: this.focoComplicacao === c.doc.uuid
		});
		const classe = this.classe?.name ?? "";
		const grupos = [
			{ titulo: `Complicações de ${classe}`, cards: disponiveis.filter((c) => c.classe).map(card) },
			{ titulo: "Complicações gerais", cards: disponiveis.filter((c) => !c.classe).map(card) }
		].filter((g) => g.cards.length);

		let info = null;
		const foco = disponiveis.find((c) => c.doc.uuid === this.focoComplicacao);
		if (foco) {
			const ehEscolhida = escolhida?.uuid === foco.doc.uuid;
			info = {
				uuid: foco.doc.uuid,
				nome: foco.doc.name, img: foco.doc.img,
				tipo: foco.classe ? `Complicação de ${classe}` : "Complicação geral",
				descricao: await this.#html(foco.doc.uuid, foco.doc.system?.description?.value),
				escolhida: ehEscolhida,
				outraEscolhida: escolhida && !ehEscolhida ? escolhida.name : null,
				poder: ehEscolhida ? {
					campo: "complicacaoPoder",
					lista: "poderGeralComplicacao",
					titulo: `Poder geral concedido por ${foco.doc.name}`,
					escolhido: e.complicacaoPoder ?? ""
				} : null,
				poderInfo: ehEscolhida && e.complicacaoPoder ? await this.#infoPoder(poder(this.dados, e.complicacaoPoder)) : null
			};
		}
		return { grupos, info, escolhidaNome: escolhida?.name ?? "" };
	}

	/** Espólio (Nobre) e Protótipo (Inventor). */
	#ctxItensClasse() {
		const out = [];
		const fmt = ConstrutorFicha.formatarTibares;
		for (const { poder: p, regra } of this.escolhasDeClasse(["item", "prototipo"])) {
			const campo = this.campoEscolha(regra);
			const v = this.escolhaRacial(regra);
			if (regra.tipo === "item") {
				out.push({
					titulo: regra.titulo, ehItem: true,
					texto: `Um item à sua escolha com preço de até ${fmt(regra.precoMax)}.`,
					abrir: { campo, lista: `lojaAte:${regra.precoMax}`, titulo: `${p.name} — até ${fmt(regra.precoMax)}`, escolhido: v }
				});
				continue;
			}
			const baseMax = regra.precoMax - regra.precoMelhoria;
			const itemDoc = v.item ? this.itemLoja(v.item)?.doc : null;
			const mel = this.dados.melhorias.find((x) => x.uuid === v.melhoria);
			const { qtd, preco } = this.totaisAlquimicos(v);
			const alquimicos = this.dados.loja
				.filter(({ doc }) => doc.type === "consumivel" && doc.system.tipo === "alchemy" && Number(doc.system.preco) <= regra.precoMax)
				.map(({ doc }) => {
					const n = v.alquimicos[doc.name] ?? 0;
					const pr = Number(doc.system.preco);
					return {
						nome: doc.name, img: doc.img, preco: fmt(pr), qtd: n,
						podeMais: qtd < regra.maxAlquimicos && preco + pr <= regra.precoMax,
						podeMenos: n > 0
					};
				});
			out.push({
				titulo: regra.titulo, ehPrototipo: true,
				campoModo: `${campo}.modo`,
				modos: [
					{ valor: "superior", nome: "Item superior", selecionado: v.modo === "superior" },
					{ valor: "alquimicos", nome: `Até ${regra.maxAlquimicos} itens alquímicos`, selecionado: v.modo === "alquimicos" }
				],
				superior: v.modo === "superior" ? {
					texto: `Item de até ${fmt(baseMax)} com uma melhoria (+${fmt(regra.precoMelhoria)}), total até ${fmt(regra.precoMax)}.`,
					item: { campo: `${campo}.item`, lista: `itemSuperior:${baseMax}`, titulo: "Protótipo — item base", escolhido: v.item },
					melhoria: itemDoc ? {
						campo: `${campo}.melhoria`, lista: `melhoria:${tipoMelhoria(itemDoc)}`,
						titulo: `Protótipo — melhoria (${v.item})`, escolhido: mel?.name ?? ""
					} : null
				} : null,
				alquimicos: v.modo === "alquimicos" ? {
					total: `${qtd}/${regra.maxAlquimicos} itens · ${fmt(preco)} de ${fmt(regra.precoMax)}`,
					itens: alquimicos
				} : null
			});
		}
		return out;
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
		// itens que vêm junto com o benefício escolhido (ex.: origens regionais de Halak-Tûr)
		for (const b of est.beneficios ?? []) {
			if (!b.startsWith("poder:")) continue;
			for (const it of poder(this.dados, b.slice(6))?.itensOrigem ?? []) {
				if (it.texto) out.push({ nome: it.texto, qtd: 1, texto: true });
				else out.push({ nome: it.nome, qtd: it.qtd ?? 1, ...(it.rotulo ? { rotulo: it.rotulo } : {}) });
			}
		}
		return out;
	}

	/** Retrato e token escolhidos (com os do ator como padrão). */
	get imagens() {
		const e = this.estado;
		const img = e.img || this.actor.img || "icons/svg/mystery-man.svg";
		const token = e.tokenIgual ? img : (e.tokenImg || this.actor.prototypeToken?.texture?.src || img);
		return { img, token };
	}

	#ctxRevisao() {
		const plano = this.plano();
		const imagens = this.imagens;
		return {
			nome: this.estado.nome,
			imagens,
			tokenIgual: this.estado.tokenIgual,
			plano,
			racaNome: plano.raca?.name ?? "—",
			dinheiroTexto: (plano.gasto || plano.valorVendas)
				? [
					`${ConstrutorFicha.formatarTibares(plano.dinheiroRolado)} rolados`,
					plano.valorVendas ? ` + ${ConstrutorFicha.formatarTibares(plano.valorVendas)} em vendas` : "",
					plano.gasto ? ` − ${ConstrutorFicha.formatarTibares(plano.gasto)} em compras` : "",
					` = ${ConstrutorFicha.formatarTibares(plano.dinheiro)}`
				].join("")
				: ConstrutorFicha.formatarTibares(plano.dinheiro),
			listaVendidos: plano.vendidos.map((x) => (x.qtd > 1 ? `${x.nome} (×${x.qtd})` : x.nome)).join(", "),
			classeNome: plano.classe?.name ?? "—",
			listaPericias: plano.pericias.map(rotuloPericia).join(", "),
			gruposPoderes: plano.gruposPoderes.filter((g) => g.poderes.length).map((g) => ({
				nome: g.nome,
				lista: g.poderes.map((p) => `${g.prefixo} - ${p.name}`).join(", ")
			})),
			listaMagias: [
				...plano.magias.map((m) => m.name),
				...plano.magiasPoderesClasse.map((m) => m.doc.name),
				...plano.magiasRaciais.map((m) => `${m.doc.name} (raça)`)
			].join(", "),
			escolhasRaciais: plano.escolhasRaciais.join(" · "),
			escolhasClasse: plano.escolhasClasse.join(" · "),
			listaItens: plano.itens.map((x) => {
				const nome = x.melhoriaNome ? `${x.nome} (${x.melhoriaNome})` : x.nome;
				return x.qtd > 1 ? `${nome} (×${x.qtd})` : nome;
			}).join(", "),
			atributos: ATRIBUTOS.map((k) => ({ nome: NOMES_ATRIBUTOS[k], valor: sinal(this.atributoFinal(k)) }))
		};
	}

	/* ---------------- Plano final (usado na revisão e no aplicar) ---------------- */

	plano({ semVendas = false, semComplicacao = false } = {}) {
		const e = this.estado;
		const r = this.regrasClasse ?? {};
		const raca = this.raca;
		const classe = this.classe;

		const poderesRaciais = this.poderesDaRaca().filter((x) => !x.daRaca).map((x) => x.poder);

		// Escolhas das habilidades raciais e de classe: ajustes nos efeitos, magias, poderes e itens extras
		const daRaca = this.#processarEscolhas(this.poderesDaRaca());
		const daClasse = this.#processarEscolhas(this.poderesDaClasse());
		const ajustesRaciais = { ...daRaca.ajustes, ...daClasse.ajustes };
		const magiasRaciais = daRaca.magias;
		const poderesExtrasRaca = daRaca.poderes;
		const escolhasTexto = daRaca.texto;

		// Poderes separados pela fonte (ordem e prefixo usados na ficha)
		const vistos = new Set(poderesRaciais);
		for (const extra of poderesExtrasRaca) {
			if (vistos.has(extra)) continue;
			vistos.add(extra);
			poderesRaciais.push(extra);
		}
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
			if (o.def.especial === "mundana") {
				addOrigem(o.def.poder);
				(o.def.poderesExtras ?? []).forEach(addOrigem);
				if (o.estado.amnPoder) addOrigem(o.estado.amnPoder);
			}
			itens.push(...this.#itensDaOrigem(o.def, o.estado));
		}

		const devoto = this.ehDevoto;
		if (devoto) e.poderesConcedidos.forEach(adicionar(poderesConcedidos));
		// alternativa sem deus (Devoto do Panteão, Druida de Arton, Paladino do Bem): Devoção Ampla
		else if (e.devoto === false && this.alternativaDevocao?.poder) adicionar(poderesConcedidos)(this.alternativaDevocao.poder);

		const addClasse = adicionar(poderesClasse);
		(r.habilidades ?? []).forEach(addClasse);
		for (const esc of this.escolhasAtivas()) if (e.escolhasClasse[esc.id]) addClasse(e.escolhasClasse[esc.id]);
		daClasse.poderes.forEach((p) => addClasse(p.name));

		// Complicação (regra opcional): a própria complicação e o poder geral que ela concede, prefixo "C"
		const poderesComplicacao = [];
		const complicacao = this.usarComplicacoes && !semComplicacao ? this.complicacao : null;
		if (complicacao) {
			poderesComplicacao.push(complicacao);
			vistos.add(complicacao);
			if (e.complicacaoPoder) adicionar(poderesComplicacao)(e.complicacaoPoder);
		}

		// Ordem na ficha (campo "sort"): raciais, origem, concedidos, complicação e, sempre por último,
		// os de classe de 1º nível ("1 - ")
		const gruposPoderes = [
			{ prefixo: "R", nome: "Raciais", poderes: poderesRaciais, raciais: true },
			{ prefixo: "O", nome: "Origem", poderes: poderesOrigem },
			{ prefixo: "D", nome: "Concedidos", poderes: poderesConcedidos },
			{ prefixo: "C", nome: "Complicação", poderes: poderesComplicacao },
			{ prefixo: "1", nome: "Classe", poderes: poderesClasse }
		];
		const poderes = [...poderesOrigem, ...poderesConcedidos, ...poderesClasse];

		itens.unshift(
			...(this.dados.equipamento.kitBase ?? []).map((n) => ({ nome: n, qtd: 1 })),
			...(r.equipamentoExtra ?? []).map((n) => ({ nome: n, qtd: 1 }))
		);
		if (e.equip.arma) itens.push({ nome: e.equip.arma, qtd: 1 });
		if (e.equip.armaMarcial && this.temProficiencia("marcial")) itens.push({ nome: e.equip.armaMarcial, qtd: 1 });
		if (e.equip.armadura) itens.push({ nome: e.equip.armadura, qtd: 1 });
		if (this.temProficiencia("escudo") && this.dados.equipamento.escudo) {
			itens.push({ nome: this.dados.equipamento.escudo, qtd: 1 });
		}
		itens.push(...daClasse.itens);
		if (semVendas) return { itens };

		// Vendas: remove os itens vendidos (metade do preço vai para o dinheiro)
		const vendas = this.#vendas(itens);
		const vendidos = vendas.indices.map((i) => itens[i]);
		const vendidosSet = new Set(vendas.indices);
		const restantes = itens.filter((_, i) => !vendidosSet.has(i));
		itens.length = 0;
		itens.push(...restantes);

		for (const [nome, n] of Object.entries(e.compras ?? {})) {
			const it = this.itemLoja(nome);
			if (!it || n <= 0) continue;
			const pacote = Number(it.doc.system.qtd) > 1 ? Number(it.doc.system.qtd) : 1;
			itens.push({ nome, qtd: n * pacote, comprado: true });
		}

		const magias = this.conjurador ? this.dados.magias.filter((m) => e.magias.includes(m.uuid)) : [];
		// Magias raciais: uma vez só (se a classe também der a magia, fica a da classe;
		// o redutor de –1 PM vem do efeito do poder racial)
		const jaTem = new Set(magias.map((m) => m.uuid));
		const unicas = (lista) => lista.filter(({ doc }) => {
			if (jaTem.has(doc.uuid)) return false;
			jaTem.add(doc.uuid);
			return true;
		});
		const magiasDaRaca = unicas(magiasRaciais);
		// magias que poderes escolhidos dão na ficha (ex.: Canção da Pedra → Transmutar Objetos)
		const deOutrosPoderes = gruposPoderes.filter((g) => !g.raciais).flatMap((g) => g.poderes)
			.flatMap((p) => (p.magiasConcedidas ?? []).map((n) => magiaPorNome(this.dados, n)).filter(Boolean).map((doc) => ({ doc })));
		const magiasDePoderesClasse = unicas([...daClasse.magias, ...deOutrosPoderes]);

		let conjuracao = this.conjurador?.atributo ?? null;
		for (const esc of this.escolhasAtivas()) {
			const o = esc.opcoes.find((x) => x.poder === e.escolhasClasse[esc.id]);
			if (o?.conjuracao) conjuracao = o.conjuracao;
		}

		return {
			raca, classe, poderesRaciais, poderes, gruposPoderes, magias, itens,
			magiasRaciais: magiasDaRaca, magiasPoderesClasse: magiasDePoderesClasse,
			ajustesRaciais, escolhasRaciais: escolhasTexto, escolhasClasse: daClasse.texto,
			pericias: ordenarPericias([...this.periciasTreinadas()]),
			atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, { base: this.base(k) ?? 0, racial: this.racial(k) }])),
			origem: this.origensAtivas().map((o) => o.def.nome).join(" / "),
			divindade: this.textoDivindade,
			dinheiro: Math.round(((e.dinheiro ?? 0) + vendas.total - this.gastoCompras) * 100) / 100,
			vendidos,
			valorVendas: vendas.total,
			dinheiroRolado: e.dinheiro ?? 0,
			gasto: this.gastoCompras,
			conjuracao,
			nome: e.nome?.trim() || this.actor.name,
			img: e.img ? this.imagens.img : null,
			tokenImg: (e.img || e.tokenImg || !e.tokenIgual) ? this.imagens.token : null
		};
	}

	/**
	 * Converte as escolhas de uma lista de poderes [{poder, regra}] no que vai para a ficha:
	 * ajustes nos efeitos do poder (por uuid), magias, poderes extras, itens e um resumo em texto.
	 */
	#processarEscolhas(lista) {
		const out = { ajustes: {}, magias: [], poderes: [], itens: [], texto: [] };
		for (const { poder: p, regra, daRaca } of lista) {
			if (!regra) continue;
			// escolha da própria raça (ex.: natureza do duende): o resumo usa o título da escolha
			const rotulo = daRaca ? regra.titulo : p.name;
			for (const n of regra.magiasFixas ?? []) {
				const m = magiaPorNome(this.dados, n);
				if (m) out.magias.push({ doc: m, atributo: regra.atributo });
			}
			if (!regra.tipo) continue;
			const v = this.escolhaRacial(regra);
			const ajuste = (dados) => { out.ajustes[p.uuid] = { ...(out.ajustes[p.uuid] ?? {}), ...dados }; };
			let resumo = "";
			switch (regra.tipo) {
				case "opcao": {
					const o = regra.opcoes.find((x) => x.valor === v);
					if (!o) break;
					if (regra.efeito === "nenhum") { /* só registra a escolha (ex.: deus da Linhagem Abençoada) */ }
					else if (regra.efeito === "imunidade") ajuste({ imunidade: o.valor });
					else if (regra.efeito === "pericia") ajuste({ bonusPericias: [o.valor], bonus: regra.valor });
					else ajuste({ resistencia: o.valor, valor: regra.valor });
					resumo = o.nome;
					break;
				}
				case "magias": {
					const nomes = [];
					for (const u of v) {
						const m = this.dados.magias.find((x) => x.uuid === u);
						if (!m) continue;
						out.magias.push({ doc: m, atributo: regra.atributo });
						nomes.push(m.name);
					}
					ajuste({ nomesMagias: nomes });
					resumo = nomes.join(", ");
					break;
				}
				case "beneficio": {
					if (regra.pericia === "bonus" && v.pericias.length) ajuste({ bonusPericias: v.pericias, bonus: regra.bonus });
					for (const n of v.poderes) {
						const extra = poder(this.dados, n);
						if (extra) out.poderes.push(extra);
					}
					const sufixo = regra.pericia === "bonus" ? ` +${regra.bonus}` : "";
					resumo = [...v.pericias.map((k) => `${rotuloPericia(k)}${sufixo}`), ...v.poderes].join(", ");
					break;
				}
				case "especialista": {
					const nomes = v.map(rotuloPericia);
					if (nomes.length) ajuste({ nomesPericias: nomes });
					resumo = nomes.join(", ");
					break;
				}
				case "item": {
					if (v) out.itens.push({ nome: v, qtd: 1 });
					resumo = v;
					break;
				}
				case "prototipo": {
					if (v.modo === "superior" && v.item && v.melhoria) {
						const mel = this.dados.melhorias.find((x) => x.uuid === v.melhoria);
						out.itens.push({ nome: v.item, qtd: 1, melhoria: v.melhoria, melhoriaNome: mel?.name ?? "" });
						resumo = `${v.item} (${mel?.name ?? "melhoria"})`;
					} else if (v.modo === "alquimicos") {
						const partes = [];
						for (const [nome, n] of Object.entries(v.alquimicos)) {
							if (n <= 0) continue;
							out.itens.push({ nome, qtd: n });
							partes.push(n > 1 ? `${nome} ×${n}` : nome);
						}
						resumo = partes.join(", ");
					}
					break;
				}
			}
			if (resumo) {
				out.texto.push(`${rotulo}: ${resumo}`);
				// várias escolhas no mesmo poder (ex.: deus e magia da Linhagem Abençoada): junta as anotações
				const anterior = out.ajustes[p.uuid]?.anotacao;
				ajuste({ anotacao: anterior ? `${anterior}; ${resumo}` : resumo });
			}
		}
		return out;
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
			if (campo === "raca") {
				// trocar de raça revoga tudo o que a raça anterior concedia
				e.racaAtributos = [];
				e.racaAbertos = [];
				e.racaEscolhas = {};
				this.#prepararEscolhasRaciais();
			}
			if (campo.startsWith("racaEscolhas.")) this.#removerConflitosRaciais();
			if (campo === "classe") {
				e.escolhasClasse = {};
				e.magiasEscolas = [];
				e.magias = [];
				e.periciasOu = [];
				e.periciasFixasManuais = [];
				e.periciasClasse = [];
				e.poderesConcedidos = [];
				e.divindade = "";
				e.devoto = null;
				e.fundamentalista = false;
				e.equip = { arma: "", armaMarcial: "", armadura: "" };
				// complicação de outra classe deixa de valer (as gerais continuam)
				if (e.complicacoes?.length && !this.complicacao) {
					e.complicacoes = [];
					e.complicacaoPoder = "";
				}
			}
			if (campo.startsWith("escolhasClasse.")) {
				// trocar o caminho limpa subescolhas que deixaram de existir
				const validas = new Set(this.escolhasAtivas().map((x) => x.id));
				for (const k of Object.keys(e.escolhasClasse)) if (!validas.has(k)) delete e.escolhasClasse[k];
			}
			if (campo === "classe" || campo.startsWith("escolhasClasse.")) {
				// trocar classe, Caminho ou Linhagem revoga as escolhas dos poderes que saíram
				if (campo === "classe") e.classePoderEscolhas = {};
				this.#prepararEscolhasRaciais();
				this.#removerConflitosRaciais();
				const c = this.conjurador;
				if (c && e.magias.length > c.quantidade) e.magias = e.magias.slice(0, c.quantidade);
			}
			if (campo === "magiasEscolas") {
				const validas = new Set(this.magiasDisponiveis().map((m) => m.uuid));
				e.magias = e.magias.filter((u) => validas.has(u));
			}
			if (campo === "periciasFixasManuais") {
				const fixas = new Set(valor);
				e.periciasClasse = e.periciasClasse.filter((k) => !fixas.has(k));
				e.periciasInt = e.periciasInt.filter((k) => !fixas.has(k));
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
			// trocar ou tirar a complicação zera o poder geral escolhido por ela
			if (campo === "complicacoes") e.complicacaoPoder = "";
			// Protótipo: trocar o item base invalida a melhoria
			if (campo === "classePoderEscolhas.prototipo.item") e.classePoderEscolhas.prototipo.melhoria = "";
			if (campo === "devoto" && valor === false) {
				e.divindade = "";
				e.poderesConcedidos = [];
				e.fundamentalista = false;
			}
			// deixar de ser fundamentalista devolve o poder concedido extra
			if (campo === "fundamentalista" && !valor) {
				e.poderesConcedidos = e.poderesConcedidos.slice(0, this.poderesConcedidosPermitidos());
			}
			if (campo === "atrModo" || campo === "atrFixo.arranjo") {
				this.dadoSelecionado = null;
				for (const k of ATRIBUTOS) e.atrFixo.atribuicao[k] = "";
			}
		}
		// perícias por Inteligência acima do permitido são descartadas
		const nInt = Math.max(0, this.atributoFinal("int"));
		if (e.periciasInt.length > nInt) e.periciasInt = e.periciasInt.slice(0, nInt);
		// Vendas: descarta as de itens que deixaram de existir (ex.: trocou a arma vendida)
		if (e.vendas?.length) {
			const iniciais = this.plano({ semVendas: true }).itens;
			e.vendas = this.#vendas(iniciais).indices.map((i) => iniciais[i].nome);
		}
		// Especialista: só perícias treinadas, até o limite pela Inteligência
		if (Array.isArray(e.classePoderEscolhas?.especialista)) {
			const treinadas = this.periciasTreinadas();
			e.classePoderEscolhas.especialista = e.classePoderEscolhas.especialista
				.filter((k) => treinadas.has(k)).slice(0, this.qtdEspecialista);
		}
		this.#mudou();
	}

	/* ---------------- Ações ---------------- */

	static #lojaTipo(event, target) {
		this.lojaTipo = target.dataset.valor;
		this.lojaCategoria = "";
		this.render();
	}

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

	/** Abre o navegador de arquivos do Foundry para o retrato ("img") ou o token ("tokenImg"). */
	static async #escolherImagem(event, target) {
		const campo = target.dataset.campo;
		const FP = foundry.applications.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
		if (!FP) return ui.notifications.warn("Navegador de arquivos indisponível; cole o caminho da imagem no campo.");
		const atual = campo === "img" ? this.imagens.img : this.imagens.token;
		const fp = new FP({
			type: "image",
			current: atual,
			callback: (caminho) => this.#definirCampo(campo, caminho)
		});
		try {
			await fp.browse(atual);
		} catch (err) {
			// jogadores sem a permissão "Navegar por arquivos" não abrem o navegador
			return ui.notifications.warn("Você não tem permissão para navegar pelos arquivos. Cole o caminho da imagem no campo.");
		}
	}

	/** Abre o slideout de venda com os itens já vendidos marcados. */
	static #abrirVenda() {
		const pend = this.pendencia({ id: "equipamento" });
		if (pend) return ui.notifications.warn(`Antes de vender: ${pend}`);
		const iniciais = this.plano({ semVendas: true }).itens;
		this.vendaRascunho = new Set(this.#vendas(iniciais).indices);
		this.slideout = { tipo: "venda", titulo: "Vender itens", foco: null, animar: true, filtro: "" };
		this.render();
	}

	/** Marca/desmarca um item para vender (e mostra os detalhes dele). */
	static #alternarVenda(event, target) {
		if (this.slideout?.tipo !== "venda") return;
		const i = Number(target.dataset.indice);
		this.vendaRascunho ??= new Set();
		if (this.vendaRascunho.has(i)) this.vendaRascunho.delete(i);
		else this.vendaRascunho.add(i);
		this.slideout.foco = i;
		this.render();
	}

	/** Marca todos os itens vendáveis, ou desmarca todos se já estavam marcados. */
	static #marcarTodosVenda() {
		if (this.slideout?.tipo !== "venda") return;
		const iniciais = this.plano({ semVendas: true }).itens;
		const todos = iniciais.map((it, i) => (this.precoVenda(it) > 0 ? i : null)).filter((i) => i !== null);
		const marcados = this.vendaRascunho ?? new Set();
		this.vendaRascunho = todos.every((i) => marcados.has(i)) ? new Set() : new Set(todos);
		this.render();
	}

	/** Confirma a venda: os itens marcados saem do inventário e metade do preço vai para a carteira. */
	static #confirmarVenda() {
		if (this.slideout?.tipo !== "venda") return;
		const iniciais = this.plano({ semVendas: true }).itens;
		const nomes = [...(this.vendaRascunho ?? [])].sort((a, b) => a - b).map((i) => iniciais[i]?.nome).filter(Boolean);
		this.slideout = null;
		this.vendaRascunho = null;
		this.#definirCampo("vendas", nomes);
	}

	/** Protótipo: +1/−1 num item alquímico, respeitando 10 itens e T$ 500. */
	static #ajustarAlquimico(event, target) {
		const [x] = this.escolhasDeClasse(["prototipo"]);
		if (!x) return;
		const { nome } = target.dataset;
		const delta = Number(target.dataset.delta);
		const v = this.escolhaRacial(x.regra);
		const alq = { ...v.alquimicos };
		const novo = Math.max(0, (alq[nome] ?? 0) + delta);
		if (novo) alq[nome] = novo;
		else delete alq[nome];
		const { qtd, preco } = this.totaisAlquimicos({ alquimicos: alq });
		if (delta > 0 && (qtd > x.regra.maxAlquimicos || preco > x.regra.precoMax)) {
			return ui.notifications.warn(`O protótipo permite até ${x.regra.maxAlquimicos} itens e T$ ${x.regra.precoMax}.`);
		}
		this.focoEquip = nome;
		this.#definirCampo(`${this.campoEscolha(x.regra)}.alquimicos`, alq);
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

	/** Atributos Variados: rola o método atual (Clássica, Épica, Valkaria ou Nimb) e envia ao chat. Uma vez só. */
	static async #rolarVariado() {
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
		this.#mudou();
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

	/** Complicações: mostra a clicada no painel lateral (não escolhe). */
	static #focarComplicacao(event, target) {
		this.focoComplicacao = target.dataset.valor;
		this.render();
	}

	/** Complicações: escolhe a complicação em foco, ou desiste dela se já for a escolhida. */
	static #escolherComplicacao(event, target) {
		const uuid = target.dataset.valor;
		const atual = this.estado.complicacoes?.[0];
		this.focoComplicacao = uuid;
		this.#definirCampo("complicacoes", atual === uuid ? [] : [uuid]);
	}

	/** Raças abertas: põe o modificador `indice` no atributo clicado (clicar de novo tira). */
	static #atribuirAberto(event, target) {
		const i = Number(target.dataset.indice);
		const k = target.dataset.valor;
		const lista = [...(this.estado.racaAbertos ?? [])];
		lista[i] = lista[i] === k ? "" : k;
		this.#definirCampo("racaAbertos", lista);
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
