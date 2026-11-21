/**
 * Validação da árvore de builds: cada nó é aplicado na ficha virtual do caminho até ele, com o mesmo código
 * da subida de nível de verdade. O que não dá mais (poder sem pré-requisito, magia que sumiu, escolha
 * faltando) marca o nó como divergente, com o motivo; os descendentes de um nó divergente também ficam
 * divergentes ("depende de…"). Nós não seguidos ficam como estão.
 */
import { EtapasNivel } from "../etapas-nivel.js";
import { AtorVirtual, aplicarEscolhas } from "../ficha-virtual.js";
import { filhos, paraEtapas } from "./arvore.js";

/**
 * @param {Actor|AtorVirtual} actor  o personagem (o real é copiado; nada é gravado nele)
 * @param {object} arvore            lerArvore(actor); os campos `divergente` dos nós são atualizados
 * @param {object} fontes            { dados, progressao, lerPreRequisito }
 * @param {object} [opcoes]          repassadas a AtorVirtual (criarDocumento)
 * @returns {Promise<{validos: number, divergentes: number}>}
 */
export async function validarArvore(actor, arvore, fontes, opcoes = {}) {
	const contagem = { validos: 0, divergentes: 0 };
	const inicial = actor.virtual ? actor : AtorVirtual.de(actor, opcoes);

	const marcar = (no, motivo, herdado = false) => {
		no.divergente = { motivo, ...(herdado ? { herdado: true } : {}) };
		contagem.divergentes++;
	};
	const herdarProblema = (pai, motivo) => {
		for (const f of filhos(arvore, pai.id)) {
			if (f.naoSeguido) continue;
			marcar(f, motivo, true);
			herdarProblema(f, motivo);
		}
	};

	const visitar = async (ator, idPai) => {
		for (const no of filhos(arvore, idPai)) {
			if (no.naoSeguido) continue;
			const dependentes = `Depende do ${no.nivel}º nível (${no.nome}), que não vale mais.`;
			if (no.nivel !== ator.nivel + 1) {
				marcar(no, `Este nó é do ${no.nivel}º nível, mas a ficha chega aqui no ${ator.nivel}º.`);
				herdarProblema(no, dependentes);
				continue;
			}
			const copia = AtorVirtual.de(ator, opcoes);
			const etapas = new EtapasNivel(copia, fontes);
			const { problemas, calculo } = paraEtapas(etapas, no.escolhas);
			const motivo = problemas[0] ?? (calculo.nivel ? etapas.pendencia(calculo.nivel) : calculo.bloqueio ?? calculo.erroClasse);
			if (motivo) {
				marcar(no, motivo);
				herdarProblema(no, dependentes);
				continue;
			}
			const r = await aplicarEscolhas(copia, etapas.escolhasAtuais(), fontes);
			if (!r.ok) {
				marcar(no, r.motivo);
				herdarProblema(no, dependentes);
				continue;
			}
			no.divergente = null;
			contagem.validos++;
			await visitar(copia, no.id);
		}
	};
	await visitar(inicial, null);
	return contagem;
}
