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
	const buscar = (nome) => {
		const doc = dados.poderesPorNome.get(normalizar(nome)) ?? null;
		if (!doc) avisos.push(`Habilidade "${nome}" não encontrada nos compêndios.`);
		return doc;
	};
	// como o valor da tabela vai para a ficha: "rolagem" (fórmula da rolagem do poder), "anotacao"
	// (linha na descrição) ou nada (só informativo: o sistema já faz o efeito crescer)
	const modoValor = (nome) => prog.valoresNaFicha?.[nome] ?? null;
	const habilidades = [];
	for (const nome of entrada.habilidades ?? []) {
		const doc = buscar(nome);
		const jaTem = ficha.temPoder(nome);
		habilidades.push({ nome: doc?.name ?? nome, doc, jaTem, valor: valorAte(prog, nome, nivelClasse), modo: modoValor(nome) });
	}
	// valores que mudam neste nível em habilidades que a ficha já tem (ex.: Ataque Especial +4 → +8)
	const valores = Object.entries(entrada.valores ?? {})
		.filter(([nome]) => !habilidades.some((h) => normalizar(h.nome) === normalizar(nome)))
		.map(([nome, valor]) => ({ nome, de: valorAte(prog, nome, nivelClasse - 1), para: valor, modo: modoValor(nome) }));

	// escolha entre habilidades (ex.: Caminho do Cavaleiro: Bastião ou Montaria); some se a ficha já tem uma
	const escolhas = (entrada.escolhas ?? []).map((e) => {
		const opcoes = e.opcoes.map((nome) => ({ nome, doc: buscar(nome) })).filter((o) => o.doc).map((o) => ({ nome: o.doc.name, doc: o.doc }));
		return { id: e.id, titulo: e.titulo, opcoes, jaTem: opcoes.find((o) => ficha.temPoder(o.nome))?.nome ?? null };
	}).filter((e) => !e.jaTem && e.opcoes.length);

	// habilidade com uma escolha anotada que se acumula (ex.: terreno do Explorador a cada 4 níveis)
	const anotadas = (entrada.anotadas ?? []).map((a) => {
		const doc = buscar(a.habilidade);
		return { id: a.id ?? normalizar(a.habilidade), habilidade: doc?.name ?? a.habilidade, doc, titulo: a.titulo, opcoes: a.opcoes ?? [], jaTem: ficha.temPoder(a.habilidade) };
	}).filter((a) => a.doc);

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
		escolhas,
		anotadas,
		ganhaPoder,
		poderesClasse,
		poderesGerais,
		// bônus de perícia = metade do nível: sobe nos níveis pares
		bonusPericia: nivelPersonagem % 2 === 0 ? nivelPersonagem / 2 : null,
		avisos
	};
}

/**
 * O que ainda falta escolher (texto para o rodapé), ou null.
 * @param {object} nivel   resultado de montarNivel
 * @param {object} s       { poder: opção escolhida (de poderesClasse/poderesGerais) | null, selecoes: {id: valor} }
 */
export function pendenciaNivel(nivel, { poder = null, selecoes = {} } = {}) {
	const faltam = [];
	for (const e of nivel.escolhas ?? []) if (!e.opcoes.some((o) => o.doc.uuid === selecoes[e.id])) faltam.push(e.titulo);
	for (const a of nivel.anotadas ?? []) if (!a.opcoes.includes(selecoes[a.id])) faltam.push(a.titulo);
	if (nivel.ganhaPoder && !poder?.disponivel) faltam.push("um poder");
	return faltam.length ? `Escolha: ${faltam.join(", ")}.` : null;
}

/** Plano de gravação (aplicar-nivel.js) a partir do nível calculado e das escolhas feitas. */
export function montarPlano(nivel, { classeId, poder = null, anotacao = "", selecoes = {} } = {}) {
	return {
		classeId,
		nivelPersonagem: nivel.nivelPersonagem,
		nivelClasse: nivel.nivelClasse,
		habilidades: nivel.habilidades.filter((h) => h.doc && !h.jaTem).map((h) => ({ doc: h.doc, valor: h.valor, modo: h.modo })),
		escolhidas: (nivel.escolhas ?? []).map((e) => e.opcoes.find((o) => o.doc.uuid === selecoes[e.id])?.doc).filter(Boolean),
		anotadas: (nivel.anotadas ?? []).filter((a) => selecoes[a.id]).map((a) => ({ doc: a.doc, texto: `${a.titulo}: ${selecoes[a.id]}` })),
		valores: nivel.valores.filter((v) => v.modo),
		poder: poder?.disponivel ? poder.doc : null,
		anotacao
	};
}
