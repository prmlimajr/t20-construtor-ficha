/**
 * Passo "Origem (profissional e regional)" do construtor.
 */
import { poder } from "../../dados.js";
import { OFICIOS, expandirPericias, normalizar } from "../../regras.js";
import { rotuloPericia, ordenarPericias } from "../comum.js";

/**
 * Poderes de origem cujo benefício é outro poder, escolhido pelo jogador (lista do slideout).
 * O escolhido fica em origens.<sub>.escolhasPoder[nome do poder].
 */
export const PODERES_COM_ESCOLHA = {
	// Atlas de Arton (Nova Malpetrim): "Escolha um dos poderes de sua classe [...] Você recebe esse poder."
	"futura lenda": { lista: "poderClasse", titulo: "Escolha um poder de sua classe", rotulo: "o poder de classe" }
};

/** Regra de escolha do poder (ou null). */
export function escolhaDoPoder(nome) {
	return PODERES_COM_ESCOLHA[normalizar(nome)] ?? null;
}

export const passo = {
	id: "origem",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		if (m.semOrigem) return [];
		const lista = [{
			id: "origem", sub: "principal",
			titulo: m.origemDupla ? "Origem profissional" : "Origem",
			dica: "Escolha sua origem e os benefícios que ela fornece."
		}];
		if (m.origemDupla) lista.push({ id: "origem", sub: "regional", titulo: "Origem regional", dica: "Escolha sua origem regional." });
		return lista;
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
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
				const pendente = b.startsWith("poder:") && this.pendenciaEscolhaPoder(b.slice(6), o);
				if (pendente) return pendente;
			}
		}
		const itens = def.itens ?? [];
		for (let i = 0; i < itens.length; i++) {
			if ((itens[i].escolha || itens[i].arma) && !o.itens[i]) return "Escolha os itens da origem.";
		}
		return null;
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxOrigem(passo.sub);
	}
};

/** Métodos da tela deste passo; entram na janela (ConstrutorFicha), this = janela. */
export class Tela {
	async ctxOrigem(sub) {
		const est = this.estado.origens[sub];
		const lista = sub === "regional" ? this.dados.origensRegionais : this.dados.origens;
		const base = `origens.${sub}`;
		if (!lista.length) return { semOrigens: true };
		const origens = lista.map((o) => ({
			nome: o.nome,
			resumo: this.resumoOrigem(o),
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
				const c = this.cardPericia(k);
				const sel = est.beneficios.includes(id);
				const bloqueado = treinadas.has(k) && !sel;
				beneficios.push({
					id, tipo: "Perícia", nome: c.nome,
					atributo: c.atributo,
					detalhe: bloqueado ? "Já treinada" : c.tags,
					selecionado: sel,
					bloqueado,
					info: sel ? { nome: `${c.nome} (${c.atributo})`, descricao: await this.descricaoPericia(k) } : null
				});
			}
			for (const nome of def.poderes ?? []) {
				if (def.especial === "amnesico") continue;
				const p = poder(this.dados, nome);
				const id = `poder:${nome}`;
				const sel = est.beneficios.includes(id);
				// Futura Lenda e afins: o benefício manda escolher outro poder
				const esc = escolhaDoPoder(nome);
				beneficios.push({
					id, tipo: p?.system.tipo === "origem" ? "Poder único" : "Poder", nome,
					selecionado: sel,
					grupo: sel && esc ? {
						campo: `${base}.escolhasPoder.${nome}`,
						lista: esc.lista,
						titulo: esc.titulo,
						escolhido: est.escolhasPoder?.[nome] ?? ""
					} : null,
					info: await this.infoPoder(p)
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
					info: sel && escolhido ? await this.infoPoder(poder(this.dados, escolhido)) : null
				});
			}
			const itens = (def.itens ?? []).map((it, i) => this.ctxItemOrigem(it, i, est, base));
			let mundana = null;
			if (def.especial === "mundana") {
				const p = poder(this.dados, def.poder);
				const extras = [];
				for (const n of def.poderesExtras ?? []) {
					const x = poder(this.dados, n);
					if (x) extras.push(await this.infoPoder(x));
				}
				mundana = {
					poder: p ? { ...(await this.infoPoder(p)), aberto: true } : null,
					pericias: (def.periciasMundanas ?? []).map((k) => ({ nome: rotuloPericia(k), atributo: this.cardPericia(k).atributo })),
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
					.filter((p) => p.system.tipo === "geral" && this.poderListavel(p))
					.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
				amnesico = {
					lembrancas: await this.infoPoder(poder(this.dados, "Lembranças Graduais")),
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

	resumoOrigem(o) {
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

	ctxItemOrigem(it, i, est, base) {
		if (typeof it === "string") return { texto: it };
		if (it.nome) return { texto: it.qtd ? `${it.nome} (×${it.qtd})` : it.nome };
		if (it.texto) return { texto: it.texto };
		if (it.escolha || it.arma) {
			const partes = [...(it.escolha ?? [])];
			if (it.arma) partes.push(this.rotuloArma(it));
			const rotulo = partes.join(" ou ");
			return {
				campo: `${base}.itens.${i}`,
				rotulo,
				lista: `nomes:${this.opcoesItemOrigem(it).join("|")}`,
				titulo: `Escolha: ${rotulo}`,
				escolhido: est.itens[i] ?? ""
			};
		}
		return { texto: "?" };
	}

	rotuloArma(it) {
		const nomesProf = { simples: "simples", marcial: "marcial", exotica: "exótica", fogo: "de fogo" };
		const prop = { distancia: " de ataque à distância", corpo: " corpo a corpo" }[it.proposito] ?? "";
		return `uma arma ${it.arma.map((p) => nomesProf[p] ?? p).join(" ou ")}${prop}`;
	}

	/** Nomes possíveis para um item de origem com escolha e/ou arma. */
	opcoesItemOrigem(it) {
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
}
