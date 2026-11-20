/**
 * Regra do construtor de personagem, sem tela: estado das escolhas, dados derivados (raça, classe,
 * atributos, perícias, origens, devoção…), passos e pendências, loja e o plano final (o que vai para a
 * ficha). A janela (wizard.js) usa esta classe pelos mesmos nomes; a regra não depende da janela.
 *
 * Campos: actor (o ator em criação), dados (carregarDados), estado (escolhas, salvo como rascunho),
 * dadosNivel e lerPreRequisito (pré-requisitos dos poderes gerais, ver dados-nivel.js).
 */
import {
	MODULE_ID, ATRIBUTOS, PONTOS_TOTAIS, ARRANJOS_FIXOS, MODOS_VARIADOS, VALKARIA_INICIAL, converterRolagem, normalizar
} from "../regras.js";
import { poder, equipamento, magiaPorNome, fonteDe, poderSelecionavel } from "../dados.js";
import { poderRacialPermitido } from "../poderes-raciais.js";
import { lerFicha } from "../ficha-atual.js";
import { avaliarPreRequisito } from "../pre-requisitos.js";
import { variantesDe } from "../nivel.js";
import { poderDistincaoPermitido } from "../distincoes.js";
import { atributosDinamicosRaca } from "../suplementos.js";
import { circuloMagia, rotuloPericia, ordenarPericias } from "./comum.js";
import { PASSOS, PASSO_POR_ID } from "./passos/index.js";
import { escolhaDoPoder } from "./passos/origem.js";
import { INVALIDACOES, AJUSTES, casa } from "./cascata.js";

/** Categorias de tamanho, da menor para a maior (system.tracos.tamanho). */
const TAMANHOS = ["min", "peq", "med", "gra", "eno", "col"];

export class ModeloConstrutor {
	constructor(actor) {
		this.actor = actor;
		this.dados = null;
		this.estado = null;
		this.dadosNivel = null;
		this.lerPreRequisito = null;
	}

	get raca() {
		return this.dados.racas.find((r) => r.uuid === this.estado.raca) ?? null;
	}

	get classe() {
		return this.dados.classes.find((c) => c.uuid === this.estado.classe) ?? null;
	}

	/**
	 * Fora das listas de poderes gerais: poderes de outras raças (ex.: Arma Amada (Anão) para um humano)
	 * e poderes de distinção (exigem a marca da distinção, que ninguém tem no 1º nível).
	 */
	poderListavel(p) {
		return poderRacialPermitido(this.dados, p, this.raca) && poderDistincaoPermitido(this.dados, p);
	}

	get regrasClasse() {
		const c = this.classe;
		const r = c ? this.dados.regrasClasses[c.name] ?? null : null;
		// classe sem perícias cadastradas: as treinadas da classe são as que o jogador indicou
		let out = r?.periciasManuais ? { ...r, fixas: [...(this.estado.periciasFixasManuais ?? [])] } : r;
		// Idades Variadas: adolescente com origem de benefício único treina uma perícia de classe a menos
		if (out && this.menosPericiaPorIdade) out = { ...out, numero: Math.max(0, out.numero - 1) };
		return out;
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
		const n = this.origemDupla ? game.settings.get(MODULE_ID, "beneficiosOrigemDupla") : 2;
		// Idades Variadas: Origem em Construção (adolescente) limita a um benefício
		const lim = this.faixaIdade?.beneficiosOrigem;
		return Number.isFinite(lim) ? Math.min(n, lim) : n;
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

	/** Regra opcional "Usar Idades Variadas" (Tormenta20, cap. 4). */
	get usarIdades() {
		try {
			return !!game.settings.get(MODULE_ID, "idadesVariadas") && !!this.dados?.idades?.faixas?.length;
		} catch (err) {
			return false;
		}
	}

	/** Faixa etária escolhida (definição de data/idades.json) ou null se a regra estiver desligada. */
	get faixaIdade() {
		if (!this.usarIdades) return null;
		const faixas = this.dados.idades.faixas;
		return faixas.find((f) => f.id === this.estado.idade?.faixa) ?? faixas.find((f) => f.id === "jovem") ?? null;
	}

	/** Modificador de atributo da faixa etária. */
	idadeAtr(k) {
		return Number(this.faixaIdade?.atributos?.[k] ?? 0);
	}

	/** Complicações de idade exigidas pela faixa (Adulto: 1 se escolheu o poder geral de Já Vi Coisas). */
	complicacoesIdadeExigidas() {
		const f = this.faixaIdade;
		if (!f) return 0;
		if (f.poderGeralOpcional) return this.estado.idade?.poderGeral ? 1 : 0;
		return Number(f.complicacoes ?? 0);
	}

	/**
	 * Idades de início de cada faixa para a raça atual: a longevidade multiplica as idades a partir
	 * de uma faixa (ex.: elfos ×5 a partir de adulto; goblins ×0,7 em todas). [{id, inicio, fim}]
	 */
	idadesDaRaca(raca = this.raca) {
		const d = this.dados?.idades;
		if (!d) return [];
		const nome = raca?.name ?? "";
		const regra = (d.longevidade ?? []).find((l) => l.racas.some((r) => nome === r || nome.startsWith(`${r}-`) || nome.startsWith(`${r} `)));
		const inicioMult = regra ? d.faixas.findIndex((f) => f.id === regra.aPartirDe) : -1;
		const inicios = d.faixas.map((f, i) => (regra && i >= inicioMult ? Math.round(f.inicio * regra.multiplicador) : f.inicio));
		return d.faixas.map((f, i) => ({ id: f.id, inicio: inicios[i], fim: i + 1 < inicios.length ? inicios[i + 1] - 1 : null, multiplicador: regra?.multiplicador ?? 1 }));
	}

	/** Texto da faixa de idade para a raça. Ex.: "25 a 39 anos", "80+ anos". */
	rotuloIdades(id) {
		const x = this.idadesDaRaca().find((f) => f.id === id);
		if (!x) return "";
		return x.fim === null ? `${x.inicio}+ anos` : `${x.inicio} a ${x.fim} anos`;
	}

	/** Adolescente com origem de um só benefício (mundana): uma perícia de classe a menos. */
	get menosPericiaPorIdade() {
		if (this.faixaIdade?.beneficiosOrigem !== 1) return false;
		return this.origensAtivas().some((o) => o.chave === "principal" && o.def.especial === "mundana");
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
				// sem alquímicos (ex.: Presente dos Deuses do cruzado), só existe o modo item superior
				modo: regra.semAlquimicos ? "superior" : v?.modo ?? "", item: v?.item ?? "", melhoria: v?.melhoria ?? "",
				alquimicos: v?.alquimicos && typeof v.alquimicos === "object" ? v.alquimicos : {}
			};
		}
		return { pericias: v?.pericias ?? [], poderes: v?.poderes ?? [] };
	}

	/**
	 * Descarta do rascunho o que não existe mais nos dados carregados (ex.: o mestre desligou os
	 * Suplementos de Arton no meio da criação). O passo afetado volta a pedir a escolha.
	 */
	limparReferencias() {
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
				Object.assign(o, { nome: "", beneficios: [], grupos: {}, escolhasPoder: {}, itens: {}, amnPericia: "", amnPoder: "" });
			}
			for (const [g, n] of Object.entries(o.grupos ?? {})) if (!poder(d, n)) delete o.grupos[g];
			for (const [k, n] of Object.entries(o.escolhasPoder ?? {})) if (!poder(d, n)) delete o.escolhasPoder[k];
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
	prepararEscolhasRaciais() {
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
	pendenciaEscolhas(lista) {
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
				const nome = regra.titulo?.replace(/\s*\(.*\)$/, "") || "Protótipo";
				if (!v.modo) return `${nome}: escolha entre item superior e itens alquímicos.`;
				if (v.modo === "superior" && (!v.item || !v.melhoria)) return `${nome}: escolha o item e a melhoria.`;
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

	/** Sem origem: pela raça (Golem) ou pela idade (criança: Sem Origem). */
	get semOrigem() {
		return this.racaSemOrigem || this.faixaIdade?.beneficiosOrigem === 0;
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
	removerConflitosRaciais() {
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
		return (this.base(k) ?? 0) + this.racial(k) + this.idadeAtr(k);
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
		if (this.semOrigem) return out;
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

	/**
	 * Define um campo do estado e aplica a cascata (construtor/cascata.js): as invalidações do campo, se
	 * o valor mudou, e depois os ajustes de limite. Devolve se o valor mudou.
	 */
	definirCampo(campo, valor) {
		const e = this.estado;
		const anterior = foundry.utils.getProperty(e, campo);
		foundry.utils.setProperty(e, campo, valor);
		const mudou = anterior !== valor;
		if (mudou) for (const regra of INVALIDACOES) if (casa(regra, campo, valor)) regra.aplicar.call(this, e, campo, valor);
		for (const ajuste of AJUSTES) ajuste.aplicar.call(this, e);
		return mudou;
	}

	/** Passos do wizard, na ordem (cada arquivo de construtor/passos diz quando o seu aparece). */
	passos() {
		return PASSOS.flatMap((p) => p.passos(this));
	}

	/** Retorna a pendência do passo (texto) ou null se estiver completo (ver construtor/passos). */
	pendencia(passo) {
		const p = PASSO_POR_ID[passo.id];
		return p ? p.pendencia.call(this, passo) : null;
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
		return this.vendas(this.plano({ semVendas: true }).itens).total;
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
	vendas(iniciais) {
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

	/**
	 * Ficha provisória com o que já foi escolhido (raça, atributos, classe no 1º nível, perícias, poderes,
	 * magias, devoção), no formato de ficha-atual.js, para conferir pré-requisitos.
	 * @param {object} opcoesPlano  repassadas a plano() (ex.: semComplicacao para a lista da complicação)
	 */
	fichaProvisoria(opcoesPlano = {}) {
		const plano = this.plano(opcoesPlano);
		const itens = [];
		if (this.classe) itens.push({ type: "classe", name: this.classe.name, system: { niveis: 1, inicial: true } });
		if (this.raca) itens.push({ type: "race", name: this.raca.name, system: {} });
		for (const g of plano.gruposPoderes) for (const p of g.poderes) itens.push({ type: "poder", name: p.name, system: p.system ?? {} });
		const magias = [...(plano.magias ?? []), ...(plano.magiasRaciais ?? []).map((x) => x.doc), ...(plano.magiasPoderesClasse ?? []).map((x) => x.doc)];
		for (const m of magias.filter(Boolean)) itens.push({ type: "magia", name: m.name, system: m.system ?? {} });
		const ator = {
			items: itens,
			system: {
				atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, { value: (plano.atributos?.[k]?.base ?? 0) + (plano.atributos?.[k]?.racial ?? 0) }])),
				pericias: Object.fromEntries((plano.pericias ?? []).map((k) => [k, { treinado: true }])),
				tracos: {},
				detalhes: { divindade: plano.divindade ?? "" },
				attributes: { conjuracao: plano.conjuracao ?? null }
			},
			flags: { [MODULE_ID]: { escolasMagia: [...(this.estado.magiasEscolas ?? [])] } }
		};
		return lerFicha(ator, { regrasClasses: this.dados.regrasClasses, variantes: variantesDe(this.dadosNivel?.progressao, this.dados.variantes) });
	}

	/**
	 * Pré-requisito de um poder geral contra a ficha: {texto, ok, falhas} (null se não tem).
	 * @param {boolean} [opcoes.classe]  confere também poderes de classe (lista da Futura Lenda)
	 */
	preRequisito(p, ficha, { classe = false } = {}) {
		const tipo = p?.system?.tipo;
		if (!this.lerPreRequisito || !(tipo === "geral" || (classe && tipo === "classe"))) return null;
		const req = this.lerPreRequisito(p);
		if (!req) return null;
		const r = avaliarPreRequisito(req, ficha);
		return { texto: req.texto, ok: r.ok, falhas: r.falhas, avisos: r.avisos };
	}

	/** Revisão: algum poder geral escolhido não atende o pré-requisito com a ficha final? */
	pendenciaPreRequisitos() {
		if (!this.lerPreRequisito) return null;
		const ficha = this.fichaProvisoria();
		for (const g of this.plano().gruposPoderes) {
			for (const p of g.poderes) {
				const r = this.preRequisito(p, ficha);
				if (r && !r.ok) return `Pré-requisito não atendido: ${p.name} (${r.falhas.join(", ")}). Troque o poder ou ajuste a ficha.`;
			}
		}
		return null;
	}

	/**
	 * Poderes da classe escolhida (e da classe básica, se for variante) que um benefício como a Futura Lenda
	 * pode conceder. Fora os que o personagem já recebe por outra fonte (`atual` continua na lista).
	 */
	poderesDeClasseEscolhiveis(atual = "") {
		const c = this.classe;
		if (!c) return [];
		const base = variantesDe(this.dadosNivel?.progressao, this.dados.variantes)[c.name];
		const listas = new Set([c.name, base].filter(Boolean).map(normalizar));
		const ja = new Set(this.plano().gruposPoderes.flatMap((g) => g.poderes.map((p) => p.name)));
		return this.dados.poderes
			.filter((p) => p.system?.tipo === "classe" && listas.has(normalizar(p.system?.subtipo)))
			.filter((p) => poderSelecionavel(this.dados, p) && this.poderListavel(p))
			.filter((p) => !ja.has(p.name) || p.name === atual)
			.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
	}

	/** Pendência de um benefício de origem que manda escolher outro poder (Futura Lenda), ou null. */
	pendenciaEscolhaPoder(nome, o) {
		const esc = escolhaDoPoder(nome);
		if (!esc) return null;
		const escolhido = o.escolhasPoder?.[nome];
		if (!escolhido) return `${nome}: escolha ${esc.rotulo}.`;
		const p = poder(this.dados, escolhido);
		if (!p) return `${nome}: escolha ${esc.rotulo}.`;
		const r = this.preRequisito(p, this.fichaProvisoria(), { classe: true });
		if (r && !r.ok) return `${nome}: ${p.name} não atende o pré-requisito (${r.falhas.join(", ")}). Troque o poder.`;
		return null;
	}

	/** Regra pelo identificador "fonte.id" usado nas listas do slideout. */
	regraRacial(chave) {
		const [fonte, id] = chave.split(".");
		const lista = fonte === "classe" ? this.escolhasDeClasse() : this.escolhasRaciais();
		return lista.find((x) => x.regra.id === id)?.regra ?? null;
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

	/** Lista final de itens de uma origem: [{nome, qtd, texto?}] */
	itensDaOrigem(def, est) {
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

	/** Tamanho da raça: o último "override" de system.tracos.tamanho nos poderes raciais (padrão: médio). */
	#tamanhoRaca(poderesRaciais) {
		let tam = "med";
		for (const p of poderesRaciais) {
			for (const ef of p.effects ?? []) {
				for (const c of ef.system?.changes ?? ef.changes ?? []) {
					if (c.key === "system.tracos.tamanho" && TAMANHOS.includes(c.value)) tam = c.value;
				}
			}
		}
		return tam;
	}

	/** Texto da idade para as notas da ficha. Ex.: "Idade: Velho, 65 anos (+2 níveis a subir)". */
	#textoIdade(faixa) {
		const anos = Number(this.estado.idade?.anos);
		const partes = [faixa.nome];
		if (Number.isFinite(anos) && anos > 0) partes.push(`${anos} anos`);
		let txt = `Idade: ${partes.join(", ")}`;
		if (faixa.niveisExtras) txt += ` — começa ${faixa.niveisExtras === 1 ? "1 nível" : `${faixa.niveisExtras} níveis`} acima do grupo`;
		return txt;
	}

	plano({ semVendas = false, semComplicacao = false, semIdade = false } = {}) {
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
				// Futura Lenda e afins: o poder escolhido pelo benefício
				if (b.startsWith("poder:") && o.estado.escolhasPoder?.[b.slice(6)]) addOrigem(o.estado.escolhasPoder[b.slice(6)]);
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
			itens.push(...this.itensDaOrigem(o.def, o.estado));
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

		// Idades Variadas: habilidades da faixa ("I") e complicações de idade e poder geral do adulto ("C")
		const poderesIdade = [];
		const faixa = semIdade ? null : this.faixaIdade;
		if (faixa) {
			(faixa.poderes ?? []).forEach(adicionar(poderesIdade));
			if (faixa.poderGeralOpcional && e.idade?.poderGeral) {
				adicionar(poderesIdade)("Já Vi Coisas");
				adicionar(poderesComplicacao)(e.idade.poderGeral);
			}
			(e.idade?.complicacoes ?? []).forEach(adicionar(poderesComplicacao));
			// Tamanho Menor: uma categoria abaixo do tamanho da raça (Minúsculo: só estética)
			const menor = poderesIdade.find((p) => p.name === "Tamanho Menor");
			if (menor) {
				const atual = this.#tamanhoRaca(poderesRaciais);
				const i = TAMANHOS.indexOf(atual);
				ajustesRaciais[menor.uuid] = i > 0
					? { tamanho: TAMANHOS[i - 1] }
					: { anotacao: "Raça já é Minúscula: a mudança é apenas estética." };
			}
		}

		// Ordem na ficha (campo "sort"): raciais, origem, concedidos, complicação e, sempre por último,
		// os de classe de 1º nível ("1 - ")
		const gruposPoderes = [
			{ prefixo: "R", nome: "Raciais", poderes: poderesRaciais, raciais: true },
			{ prefixo: "O", nome: "Origem", poderes: poderesOrigem },
			{ prefixo: "D", nome: "Concedidos", poderes: poderesConcedidos },
			{ prefixo: "C", nome: "Complicação", poderes: poderesComplicacao },
			{ prefixo: "I", nome: "Idade", poderes: poderesIdade },
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
		const vendas = this.vendas(itens);
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

		const conj = this.conjurador;
		const magias = !conj ? [] : conj.todas ? this.magiasDisponiveis() : this.dados.magias.filter((m) => e.magias.includes(m.uuid));
		// Magias raciais: uma vez só (se a classe também der a magia, fica a da classe;
		// o redutor de –1 PM vem do efeito do poder racial)
		const jaTem = new Set(magias.map((m) => m.uuid));
		const unicas = (lista) => lista.filter(({ doc }) => {
			if (jaTem.has(doc.uuid)) return false;
			jaTem.add(doc.uuid);
			return true;
		});
		const magiasDaRaca = unicas(magiasRaciais);
		// magias que poderes escolhidos dão na ficha (ex.: Canção da Pedra → Transmutar Objetos), com o
		// prefixo do grupo do poder (origem, concedidos, complicação, idade, classe)
		const deOutrosPoderes = gruposPoderes.filter((g) => !g.raciais).flatMap((g) => g.poderes.map((p) => ({ p, prefixo: g.prefixo })))
			.flatMap(({ p, prefixo }) => (p.magiasConcedidas ?? []).map((n) => magiaPorNome(this.dados, n)).filter(Boolean).map((doc) => ({ doc, atributo: p.atributoMagias ?? null, prefixo })));
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
			// a faixa etária (Idades Variadas) entra no valor base
			atributos: Object.fromEntries(ATRIBUTOS.map((k) => [k, { base: (this.base(k) ?? 0) + this.idadeAtr(k), racial: this.racial(k) }])),
			idade: faixa ? this.#textoIdade(faixa) : null,
			// Idades Variadas: níveis a subir depois da criação (o assistente de subir de nível mostra quantos faltam)
			niveisExtras: faixa?.niveisExtras ?? 0,
			origem: this.origensAtivas().map((o) => o.def.nome).join(" / "),
			divindade: this.textoDivindade,
			dinheiro: Math.round(((e.dinheiro ?? 0) + vendas.total - this.gastoCompras) * 100) / 100,
			vendidos,
			valorVendas: vendas.total,
			dinheiroRolado: e.dinheiro ?? 0,
			gasto: this.gastoCompras,
			conjuracao,
			// escolas de magia (Bardo, Druida): ficam na ficha para a subida de nível
			escolasMagia: this.conjurador?.escolas ? [...(e.magiasEscolas ?? [])] : null,
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
}
