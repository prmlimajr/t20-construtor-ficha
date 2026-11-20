/**
 * Passo "Classe" do construtor.
 */
import { poder, fonteDe } from "../../dados.js";
import { rotuloPericia } from "../comum.js";

export const passo = {
	id: "classe",

	/** Instâncias do passo na barra lateral (vazio quando o passo não aparece). m = ModeloConstrutor. */
	passos(m) {
		return [{ id: "classe", titulo: "Classe", dica: "Escolha a classe do seu personagem." }];
	},

	/** Pendência do passo (texto) ou null se estiver completo. this = ModeloConstrutor. */
	pendencia(passo) {
		const e = this.estado;
		if (!this.classe) return "Escolha uma classe.";
		for (const esc of this.escolhasAtivas()) {
			if (!e.escolhasClasse[esc.id]) return `Escolha: ${esc.titulo}.`;
		}
		return this.pendenciaEscolhas(this.escolhasDeClasse(["opcao", "magias", "beneficio"]));
	},

	/** Dados do template do passo. this = janela (ConstrutorFicha). */
	contexto(passo) {
		return this.ctxClasse();
	}
};

/** Métodos da tela deste passo; entram na janela (ConstrutorFicha), this = janela. */
export class Tela {
	async ctxClasse() {
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
				const info = await this.infoPoder(p);
				info.escolhas = [];
				for (const regra of regrasPorPoder.get(p.name) ?? []) {
					if (["opcao", "magias", "beneficio"].includes(regra.tipo)) {
						info.escolhas.push(this.ctxEscolhaRacial(p, regra));
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
				descricao: await this.html(c.uuid, c.system.description?.value),
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
}
