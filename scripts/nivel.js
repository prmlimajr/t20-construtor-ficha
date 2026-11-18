/**
 * Subida de nível: o que o próximo nível concede e quais poderes podem ser escolhidos.
 * Funções puras (sem Foundry), testáveis em Node com os compêndios lidos do disco.
 */
import { normalizar } from "./regras.js";
import { extrairPreRequisito, interpretarPreRequisito, avaliarPreRequisito, podeRepetir } from "./pre-requisitos.js";

export const NIVEL_MAXIMO = 20;

/** Progressão de uma classe (variantes herdam da classe básica o que não declaram). */
export function progressaoDe(progressao, nomeClasse) {
	const p = progressao?.[nomeClasse];
	if (!p) return null;
	if (!p.base) return p;
	const base = progressaoDe(progressao, p.base) ?? {};
	return { ...base, ...p, poder: p.poder ?? base.poder, niveis: { ...(base.niveis ?? {}), ...(p.niveis ?? {}) } };
}

/** Valor mais recente da tabela para uma habilidade até o nível dado (ex.: Ataque Especial +8). */
function valorAte(prog, nome, nivel) {
	let valor = null;
	for (let n = 1; n <= nivel; n++) {
		const v = prog.niveis?.[n]?.valores?.[nome];
		if (v !== undefined) valor = v;
	}
	return valor;
}

/**
 * Pré-requisitos de cada poder, interpretados uma vez só (cache por uuid).
 * correcoes: { "Nome do poder": "texto que substitui o do compêndio" | "" (sem pré-requisito) }
 */
export function criarLeitorPreRequisitos(dados, correcoes = {}) {
	const cache = new Map();
	const classesPorNome = new Map(dados.classes.map((c) => [normalizar(c.name), c.name]));
	// nome sem o complemento: "Esgrimista" → "Esgrimista (Bucaneiro)", "Ambidestria" → a geral ou a de classe
	const semComplemento = new Map();
	for (const p of dados.poderes) {
		const k = normalizar(p.name).replace(/\s*\([^)]*\)\s*$/, "");
		if (!semComplemento.has(k)) semComplemento.set(k, p.name);
	}
	const ctx = {
		ehPoder: (nome) => dados.poderesPorNome.get(normalizar(nome))?.name ?? semComplemento.get(normalizar(nome)) ?? null,
		ehClasse: (nome) => classesPorNome.get(normalizar(nome)) ?? null,
		ehMagia: (nome) => dados.magias.find((m) => normalizar(m.name) === normalizar(nome))?.name ?? null
	};
	return (doc) => {
		const k = doc.uuid ?? doc._id ?? doc.name;
		if (cache.has(k)) return cache.get(k);
		const texto = Object.hasOwn(correcoes, doc.name) ? correcoes[doc.name] : extrairPreRequisito(doc.system?.description?.value);
		const req = texto ? interpretarPreRequisito(texto, ctx) : null;
		cache.set(k, req);
		return req;
	};
}

/**
 * Ficha como ficará depois do nível (pré-requisitos valem no nível em que são atingidos):
 * +1 nível de personagem e da classe, e as habilidades fixas do nível já contam.
 */
function fichaProjetada(ficha, nomeClasse, habilidades) {
	const novas = new Set(habilidades.map((h) => normalizar(h)));
	return {
		...ficha,
		nivel: ficha.nivel + 1,
		niveisDeClasse: (nome) => ficha.niveisDeClasse(nome) + (normalizar(nome) === normalizar(nomeClasse) ? 1 : 0),
		vezesPoder: (nome) => ficha.vezesPoder(nome) + (novas.has(normalizar(nome)) ? 1 : 0),
		temPoder(nome) {
			return this.vezesPoder(nome) > 0;
		}
	};
}

/**
 * Tudo o que o próximo nível da classe concede.
 * @param {object} p { dados, progressao, ficha, classe: {nome, niveis}, lerPreRequisito, selecionavel(doc),
 *   ehGeral(doc): entra na lista de poderes gerais?, grupoGeral(doc): título do grupo na lista }
 */
export function montarNivel({
	dados, progressao, ficha, classe, lerPreRequisito, selecionavel = () => true,
	ehGeral = (p) => p.system?.tipo === "geral", grupoGeral = (p) => p.system?.subtipo || "Outros"
}) {
	const prog = progressaoDe(progressao, classe.nome);
	if (!prog) return { erro: "semProgressao" };
	const nivelClasse = classe.niveis + 1;
	const nivelPersonagem = ficha.nivel + 1;
	if (nivelPersonagem > NIVEL_MAXIMO) return { erro: "nivelMaximo" };

	const entrada = prog.niveis?.[nivelClasse] ?? {};
	const avisos = [];
	const habilidades = [];
	for (const nome of entrada.habilidades ?? []) {
		const doc = dados.poderesPorNome.get(normalizar(nome)) ?? null;
		if (!doc) avisos.push(`Habilidade "${nome}" não encontrada nos compêndios.`);
		const jaTem = ficha.temPoder(nome);
		habilidades.push({ nome: doc?.name ?? nome, doc, jaTem, valor: valorAte(prog, nome, nivelClasse) });
	}
	// valores que mudam neste nível em habilidades que a ficha já tem (ex.: Ataque Especial +4 → +8)
	const valores = Object.entries(entrada.valores ?? {})
		.filter(([nome]) => !habilidades.some((h) => normalizar(h.nome) === normalizar(nome)))
		.map(([nome, valor]) => ({ nome, de: valorAte(prog, nome, nivelClasse - 1), para: valor }));

	const ganhaPoder = (prog.poder?.niveis ?? []).includes(nivelClasse);
	const projetada = fichaProjetada(ficha, classe.nome, habilidades.map((h) => h.nome));
	const classeBasica = prog.base ?? classe.nome;

	const opcao = (doc) => {
		const req = lerPreRequisito(doc);
		const r = req ? avaliarPreRequisito(req, projetada) : { ok: true, falhas: [], avisos: [] };
		const repetivel = podeRepetir(doc.system?.description?.value);
		const jaTem = ficha.temPoder(doc.name);
		let motivo = null;
		if (jaTem && !repetivel) motivo = "Você já tem este poder.";
		else if (!r.ok) motivo = `Pré-requisito não atendido: ${r.falhas.join(", ")}.`;
		return {
			doc,
			nome: doc.name,
			preRequisito: req?.texto ?? null,
			avisos: r.avisos,
			disponivel: !motivo,
			motivo,
			repetivel,
			jaTem
		};
	};
	const ordenar = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");
	const poderesClasse = !ganhaPoder ? [] : dados.poderes
		.filter((p) => p.system?.tipo === "classe" && normalizar(p.system?.subtipo) === normalizar(classeBasica) && selecionavel(p))
		.map(opcao).sort(ordenar);
	const poderesGerais = !ganhaPoder ? [] : dados.poderes
		.filter((p) => ehGeral(p) && selecionavel(p))
		.map((p) => ({ ...opcao(p), grupo: grupoGeral(p) }))
		.sort(ordenar);

	return {
		classe: classe.nome,
		fonte: prog.fonte ?? "",
		nivelClasse,
		nivelPersonagem,
		habilidades,
		valores,
		ganhaPoder,
		poderesClasse,
		poderesGerais,
		// bônus de perícia = metade do nível: sobe nos níveis pares
		bonusPericia: nivelPersonagem % 2 === 0 ? nivelPersonagem / 2 : null,
		avisos
	};
}
