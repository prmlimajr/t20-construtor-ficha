/**
 * Afinidade Elemental do místico (SDD/fontes/origem-mistico.pdf e parceiro-magia.pdf, tabela "Os Seis
 * Elementos"): o que cada elemento dá e as escolhas e ajustes automáticos dos poderes que dependem dele.
 * Funções puras, sem Foundry (usadas pela subida de nível e pelos testes em Node).
 */

/** Os seis elementos: tipo de dano (energia), escola, condição do Combate Elemental, perícia e parceiros do Pacto Elemental. */
export const ELEMENTOS = {
	agua: { nome: "Água", dano: "frio", rotuloDano: "frio", escola: "enc", pericia: "dipl", condicao: "lento", parceiros: ["assassino", "perseguidor", "vigilante"] },
	ar: { nome: "Ar", dano: "eletricidade", rotuloDano: "eletricidade", escola: "ilu", pericia: "enga", condicao: "ofuscado", parceiros: ["ajudante", "guardião", "médico"] },
	fogo: { nome: "Fogo", dano: "fogo", rotuloDano: "fogo", escola: "tra", pericia: "acro", condicao: "em chamas", parceiros: ["atirador", "combatente", "fortão"] },
	luz: { nome: "Luz", dano: "luz", rotuloDano: "luz", escola: "abj", pericia: "cura", condicao: "ofuscado", parceiros: ["guardião", "médico", "vigilante"] },
	terra: { nome: "Terra", dano: "acido", rotuloDano: "ácido", escola: "con", pericia: "inve", condicao: "vulnerável", parceiros: ["combatente", "guardião", "montaria"] },
	trevas: { nome: "Trevas", dano: "trevas", rotuloDano: "trevas", escola: "nec", pericia: "inti", condicao: "não pode curar PV", parceiros: ["assassino", "magivocador", "perseguidor"] }
};

/**
 * Círculo máximo de magias do místico pelo nível de místico (1º no 1º, 2º no 6º, 3º no 10º, 4º no 14º),
 * em fórmula de efeito do sistema. O 5º círculo só vem de Ditame Absoluto.
 */
export const CIRCULO_MISTICO = "min(4, max(1, floor((@nvl.mistico + 2) / 4)))";
/** Afinidade Elemental: redução 5 contra o tipo de dano do elemento para cada círculo que pode lançar. */
export const REDUCAO_AFINIDADE = `5 * ${CIRCULO_MISTICO}`;
/** Perícia Mística e Pacto Hábil: +2, mais +1 por patamar acima de iniciante. */
export const BONUS_POR_PATAMAR = "1+@patamar";

/** "Fogo (fogo; Combate Elemental: em chamas)": como a escolha aparece e fica anotada no poder. */
export const rotuloElemento = (k) => `${ELEMENTOS[k].nome} (${ELEMENTOS[k].rotuloDano}; Combate Elemental: ${ELEMENTOS[k].condicao})`;
/** Elemento (chave) de um tipo de dano ("acido" → "terra"). */
export const elementoPorDano = (dano) => Object.keys(ELEMENTOS).find((k) => ELEMENTOS[k].dano === dano) ?? null;
/** Nome do item do guia elemental de um elemento. */
export const nomeGuia = (k) => `Guia Elemental (${ELEMENTOS[k].nome})`;

/** Escolas de magia dos elementos da ficha (o místico tem acesso à escola de cada elemento seu). */
export const escolasDaAfinidade = (ficha) => [...(ficha?.afinidade?.elementos ?? [])].map((k) => ELEMENTOS[k]?.escola).filter(Boolean);

/** Elementos da ficha; se algum não está anotado, todos os seis (não dá para restringir). */
function elementosDaFicha(ficha) {
	const a = ficha?.afinidade;
	return !a || a.incompleta || !a.elementos.size ? Object.keys(ELEMENTOS) : [...a.elementos];
}

/** Ajuste de um elemento novo da afinidade (Afinidade Expandida e Maior): redução, perícia treinada. */
export const ajusteDeElemento = (k) => ({ resistencia: ELEMENTOS[k].dano, valor: REDUCAO_AFINIDADE, treinar: [ELEMENTOS[k].pericia] });

/**
 * Escolha que um poder pede ao ser escolhido na subida de nível (em vez de uma anotação livre):
 * { titulo, opcoes: [{ nome, ajuste?, concede? (nome do poder que entra junto) }] } ou null.
 */
export function escolhaDoPoder(nome, ficha) {
	if (nome === "Afinidade Maior") {
		const tem = ficha?.afinidade?.elementos ?? new Set();
		return {
			titulo: "Terceiro elemento",
			opcoes: Object.keys(ELEMENTOS).filter((k) => !tem.has(k)).map((k) => ({ nome: rotuloElemento(k), ajuste: ajusteDeElemento(k) }))
		};
	}
	if (nome === "Pacto Elemental") {
		return {
			titulo: "Guia elemental (tipo de parceiro)",
			opcoes: elementosDaFicha(ficha).flatMap((k) => ELEMENTOS[k].parceiros.map((p) => ({ nome: `${ELEMENTOS[k].nome}: ${p}`, concede: nomeGuia(k) })))
		};
	}
	return null;
}

/**
 * Ajuste automático de um poder ao entrar na ficha, pelo que a ficha já tem (sem escolha do jogador).
 * @returns {{ ajuste: object|null, nota: string|null } | null}
 */
export function ajusteAutomatico(nome, ficha) {
	const conhecidos = ficha?.afinidade && !ficha.afinidade.incompleta ? [...ficha.afinidade.elementos] : null;
	if (nome === "Perícia Mística") {
		if (!conhecidos?.length) return { ajuste: null, nota: "Perícia Mística: o elemento da Afinidade não está anotado na ficha; o bônus fica como opção ao testar a perícia." };
		return { ajuste: { bonusPericias: conhecidos.map((k) => ELEMENTOS[k].pericia), bonus: BONUS_POR_PATAMAR }, nota: null };
	}
	if (nome === "Comunhão Suprema") {
		if (!conhecidos?.length) return { ajuste: null, nota: "Comunhão Suprema: o elemento da Afinidade não está anotado na ficha; marque a imunidade à mão." };
		return { ajuste: { imunidades: conhecidos.map((k) => ELEMENTOS[k].dano) }, nota: null };
	}
	if (nome === "Visão Noturna") {
		const s = ficha?.sentidos ?? new Set();
		if (s.has("penumbra") && s.has("escuro")) return { ajuste: null, nota: "Visão Noturna: a ficha já tem visão na penumbra e no escuro; vale a redução da chance de falha por camuflagem (no texto)." };
		return { ajuste: { sentido: s.has("penumbra") ? "escuro" : "penumbra" }, nota: null };
	}
	return null;
}
