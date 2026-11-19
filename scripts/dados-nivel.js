/**
 * Dados da subida de nível (progressões e correções de pré-requisitos) e o leitor de pré-requisitos,
 * compartilhados pelo assistente de subir de nível e pelo construtor (listas de poderes gerais).
 */
import { MODULE_ID } from "./regras.js";
import { criarLeitorPreRequisitos } from "./nivel.js";

let dadosNivel = null;
let carregando = null;

/** Lê data/progressao.json e data/pre-requisitos.json (uma vez só). */
export async function carregarDadosNivel() {
	if (dadosNivel) return dadosNivel;
	carregando ??= (async () => {
		const ler = async (arquivo) => {
			const resp = await fetch(`modules/${MODULE_ID}/data/${arquivo}`);
			if (!resp.ok) throw new Error(`${MODULE_ID} | não foi possível ler data/${arquivo}`);
			return resp.json();
		};
		const [progressao, correcoes] = await Promise.all([ler("progressao.json"), ler("pre-requisitos.json")]);
		delete progressao._comentario;
		delete correcoes._comentario;
		dadosNivel = { progressao, correcoes };
		return dadosNivel;
	})().finally(() => { carregando = null; });
	return carregando;
}

const leitores = new WeakMap();

/** Leitor de pré-requisitos (com cache) para estes dados dos compêndios. */
export function leitorPreRequisitos(dados, correcoes) {
	if (!leitores.has(dados)) leitores.set(dados, criarLeitorPreRequisitos(dados, correcoes));
	return leitores.get(dados);
}
