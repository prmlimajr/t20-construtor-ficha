/**
 * Cascata de invalidações do construtor: o que cada campo do estado invalida quando muda.
 *
 * INVALIDACOES roda, na ordem da lista, as regras cujo `campo` casa com o campo alterado, só quando o
 * valor mudou de fato. AJUSTES roda depois de qualquer alteração (mesmo sem mudança) e corta o que
 * passou do limite. Nas duas, `aplicar(e, campo, valor)` roda com this = ModeloConstrutor e e = estado.
 *
 * `campo` pode ser o nome exato, uma RegExp ou uma função (campo, valor) => boolean.
 * A ordem importa: a regra de "classe" zera escolhas que a regra seguinte ("classe" ou Caminho) usa.
 */
import { ATRIBUTOS } from "../regras.js";

export const INVALIDACOES = [
	{
		campo: "raca",
		porque: "trocar de raça revoga tudo o que a raça anterior concedia",
		aplicar(e) {
			e.racaAtributos = [];
			e.racaAbertos = [];
			e.racaEscolhas = {};
			this.prepararEscolhasRaciais();
		}
	},
	{
		campo: /^racaEscolhas\./,
		porque: "uma escolha racial pode conflitar com outra",
		aplicar() {
			this.removerConflitosRaciais();
		}
	},
	{
		campo: "classe",
		porque: "trocar de classe zera tudo o que dependia dela",
		aplicar(e) {
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
			// Futura Lenda: o poder escolhido era da classe anterior
			for (const o of Object.values(e.origens ?? {})) if (o) o.escolhasPoder = {};
		}
	},
	{
		campo: /^escolhasClasse\./,
		porque: "trocar o caminho limpa subescolhas que deixaram de existir",
		aplicar(e) {
			const validas = new Set(this.escolhasAtivas().map((x) => x.id));
			for (const k of Object.keys(e.escolhasClasse)) if (!validas.has(k)) delete e.escolhasClasse[k];
		}
	},
	{
		campo: (campo) => campo === "classe" || campo.startsWith("escolhasClasse."),
		porque: "trocar classe, Caminho ou Linhagem revoga as escolhas dos poderes que saíram",
		aplicar(e, campo) {
			if (campo === "classe") e.classePoderEscolhas = {};
			this.prepararEscolhasRaciais();
			this.removerConflitosRaciais();
			const c = this.conjurador;
			if (c && e.magias.length > c.quantidade) e.magias = e.magias.slice(0, c.quantidade);
		}
	},
	{
		campo: "magiasEscolas",
		porque: "magias de escolas que saíram deixam de estar disponíveis",
		aplicar(e) {
			const validas = new Set(this.magiasDisponiveis().map((m) => m.uuid));
			e.magias = e.magias.filter((u) => validas.has(u));
		}
	},
	{
		campo: "periciasFixasManuais",
		porque: "perícia que virou fixa da classe sai das escolhidas",
		aplicar(e, campo, valor) {
			const fixas = new Set(valor);
			e.periciasClasse = e.periciasClasse.filter((k) => !fixas.has(k));
			e.periciasInt = e.periciasInt.filter((k) => !fixas.has(k));
		}
	},
	{
		campo: /^periciasOu/,
		porque: "perícia obrigatória escolhida sai das perícias da classe",
		aplicar(e) {
			const ja = this.periciasTreinadas({ ate: "classe" });
			e.periciasClasse = e.periciasClasse.filter((k) => !ja.has(k));
		}
	},
	{
		campo: /^origens\.\w+\.nome$/,
		porque: "trocar de origem zera os benefícios escolhidos",
		aplicar(e, campo) {
			const sub = campo.split(".")[1];
			Object.assign(e.origens[sub], { beneficios: [], grupos: {}, escolhasPoder: {}, itens: {}, amnPericia: "", amnPoder: "" });
		}
	},
	{
		campo: "divindade",
		porque: "poderes concedidos são do deus anterior",
		aplicar(e) {
			e.poderesConcedidos = [];
		}
	},
	{
		campo: "complicacoes",
		porque: "trocar ou tirar a complicação zera o poder geral escolhido por ela",
		aplicar(e) {
			e.complicacaoPoder = "";
		}
	},
	{
		campo: "idade.faixa",
		porque: "trocar de faixa zera as complicações e o poder geral de idade, e corta o que a faixa nova não permite",
		aplicar(e) {
			e.idade.complicacoes = [];
			e.idade.poderGeral = "";
			for (const sub of ["principal", "regional"]) {
				const o = e.origens[sub];
				const n = this.beneficiosPorOrigem(sub);
				if (o.beneficios.length > n) {
					for (const b of o.beneficios.slice(n)) if (b.startsWith("grupo:")) delete o.grupos[b.slice(6)];
					o.beneficios = o.beneficios.slice(0, n);
				}
			}
			const r = this.regrasClasse;
			if (r && e.periciasClasse.length > r.numero) e.periciasClasse = e.periciasClasse.slice(0, r.numero);
		}
	},
	{
		campo: (campo, valor) => campo === "idade.poderGeral" && !valor,
		porque: "Adulto: tirar o poder geral de Já Vi Coisas devolve a complicação de idade que vinha com ele",
		aplicar(e) {
			e.idade.complicacoes = [];
		}
	},
	{
		campo: /^classePoderEscolhas\.([^.]+)\.item$/,
		porque: "Protótipo e afins (item superior): trocar o item base invalida a melhoria",
		aplicar(e, campo) {
			const id = /^classePoderEscolhas\.([^.]+)\.item$/.exec(campo)[1];
			if (e.classePoderEscolhas[id]) e.classePoderEscolhas[id].melhoria = "";
		}
	},
	{
		campo: (campo, valor) => campo === "devoto" && valor === false,
		porque: "deixar de ser devoto tira divindade, poderes concedidos e fundamentalismo",
		aplicar(e) {
			e.divindade = "";
			e.poderesConcedidos = [];
			e.fundamentalista = false;
		}
	},
	{
		campo: (campo, valor) => campo === "fundamentalista" && !valor,
		porque: "deixar de ser fundamentalista devolve o poder concedido extra",
		aplicar(e) {
			e.poderesConcedidos = e.poderesConcedidos.slice(0, this.poderesConcedidosPermitidos());
		}
	},
	{
		campo: (campo) => campo === "atrModo" || campo === "atrFixo.arranjo",
		porque: "outra modalidade ou arranjo desfaz a atribuição dos valores (a janela também solta o dado selecionado)",
		aplicar(e) {
			for (const k of ATRIBUTOS) e.atrFixo.atribuicao[k] = "";
		}
	}
];

export const AJUSTES = [
	{
		porque: "perícias por Inteligência acima do permitido são descartadas",
		aplicar(e) {
			const nInt = Math.max(0, this.atributoFinal("int"));
			if (e.periciasInt.length > nInt) e.periciasInt = e.periciasInt.slice(0, nInt);
		}
	},
	{
		porque: "vendas de itens que deixaram de existir são descartadas (ex.: trocou a arma vendida)",
		aplicar(e) {
			if (!e.vendas?.length) return;
			const iniciais = this.plano({ semVendas: true }).itens;
			e.vendas = this.vendas(iniciais).indices.map((i) => iniciais[i].nome);
		}
	},
	{
		porque: "Especialista: só perícias treinadas, até o limite pela Inteligência",
		aplicar(e) {
			if (!Array.isArray(e.classePoderEscolhas?.especialista)) return;
			const treinadas = this.periciasTreinadas();
			e.classePoderEscolhas.especialista = e.classePoderEscolhas.especialista
				.filter((k) => treinadas.has(k)).slice(0, this.qtdEspecialista);
		}
	}
];

/** A regra vale para este campo (e valor)? */
export function casa(regra, campo, valor) {
	const c = regra.campo;
	if (typeof c === "string") return c === campo;
	if (c instanceof RegExp) return c.test(campo);
	return c(campo, valor);
}
