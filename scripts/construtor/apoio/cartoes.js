/**
 * Cartões de informação usados por vários passos e pelo slideout (poder, magia, perícia, equipamento, escolha racial).
 */
import { equipamento } from "../../dados.js";
import { statsMagia, aprimoramentosMagia } from "../../magias-info.js";
import { NOMES_ATRIBUTOS, OFICIOS } from "../../regras.js";
import { rotuloPericia } from "../comum.js";
import { rotuloEscola, enriquecer } from "../tela.js";

/** Métodos de instância entram na janela (ConstrutorFicha); os estáticos são ações (this = janela). */
export class Tela {
	async html(chave, html) {
		if (!this._cacheHtml.has(chave)) this._cacheHtml.set(chave, await enriquecer(html));
		return this._cacheHtml.get(chave);
	}

	async infoPoder(p) {
		if (!p) return null;
		return { nome: p.name, img: p.img, descricao: await this.html(p.uuid, p.system.description?.value) };
	}

	/** Controles de uma escolha racial no painel da raça. */
	ctxEscolhaRacial(p, regra) {
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

	/** Painel completo de uma magia (ficha, descrição, aprimoramentos). */
	async infoMagia(m) {
		return {
			uuid: m.uuid,
			nome: m.name, img: m.img,
			escola: rotuloEscola(m.system.escola),
			tipo: m.system.tipo === "uni" ? "Universal" : (m.system.tipo === "arc" ? "Arcana" : "Divina"),
			escolaDescricao: this.dados.escolas[m.system.escola]?.descricao ?? "",
			selecionado: this.estado.magias.includes(m.uuid),
			stats: this.statsMagia(m),
			descricao: await this.html(m.uuid, m.system.description?.value),
			aprimoramentos: await this.aprimoramentos(m)
		};
	}

	/** Ficha resumida de uma magia (execução, alcance, alvo, duração, resistência). */
	statsMagia(m) {
		return statsMagia(m);
	}

	/** Aprimoramentos da magia: efeitos "ao usar" com custo em PM e descrição. */
	async aprimoramentos(m) {
		// no 1º nível só se lançam magias de 1º círculo
		return aprimoramentosMagia(m, (chave, html) => this.html(chave, html), 1);
	}

	/** Descrição da perícia vinda do diário "Perícias" do sistema (Ofícios usam a página "Ofício"). */
	async descricaoPericia(k) {
		const chave = OFICIOS.includes(k) ? "ofic" : k;
		const uuid = CONFIG.T20?.skillCompendiumEntries?.[chave];
		if (!uuid) return "";
		if (!this._cacheHtml.has(uuid)) {
			const page = await fromUuid(uuid).catch(() => null);
			this._cacheHtml.set(uuid, await enriquecer(page?.text?.content ?? ""));
		}
		return this._cacheHtml.get(uuid);
	}

	cardPericia(k, extra = {}) {
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

	/** Dados resumidos de um equipamento do compêndio (para card e painel de detalhes). */
	fichaEquip(nome) {
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
}
