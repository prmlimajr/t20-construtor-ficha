/**
 * Subida de nível: o que o próximo nível concede e quais poderes podem ser escolhidos.
 * Funções puras (sem Foundry), testáveis em Node com os compêndios lidos do disco.
 */
import { normalizar } from "./regras.js";
import { extrairPreRequisito, interpretarPreRequisito, avaliarPreRequisito, podeRepetir } from "./pre-requisitos.js";

export const NIVEL_MAXIMO = 20;

/** Nomes usados nos pré-requisitos que se referem a outro poder ("Pré-requisito: Bruxo"). */
const APELIDOS_PODER = {
	bruxo: "Caminho do Arcanista: Bruxo",
	feiticeiro: "Caminho do Arcanista: Feiticeiro",
	mago: "Caminho do Arcanista: Mago"
};

/** Progressão de uma classe (variantes herdam da classe básica o que não declaram). */
export function progressaoDe(progressao, nomeClasse) {
	const p = progressao?.[nomeClasse];
	if (!p) return null;
	if (!p.base) return p;
	const base = progressaoDe(progressao, p.base) ?? {};
	// a variante herda o poder e as magias da básica; a tabela de níveis, só se não tiver a sua
	return { ...base, ...p, poder: p.poder ?? base.poder, magias: p.magias ?? base.magias, niveis: p.niveis ?? base.niveis };
}

/** Variante → classe básica: as do suplemento (suplementos.json) e as que a progressão declara com "base". */
export function variantesDe(progressao, variantes = {}) {
	const out = { ...variantes };
	for (const [nome, p] of Object.entries(progressao ?? {})) if (p?.base) out[nome] = p.base;
	return out;
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
	// nome sem o complemento: "Esgrimista" → "Esgrimista (Bucaneiro)", "Ambidestria" → a geral ou a de classe;
	// e pelo nome final: "Égide Sagrada" → "Bênção da Justiça: Égide Sagrada", "animal" → "Tipo: Animal"
	const semComplemento = new Map();
	const porSufixo = new Map();
	for (const p of dados.poderes) {
		const k = normalizar(p.name).replace(/\s*\([^)]*\)\s*$/, "");
		if (!semComplemento.has(k)) semComplemento.set(k, p.name);
		const sufixo = k.includes(":") ? k.split(":").pop().trim() : null;
		if (sufixo && !porSufixo.has(sufixo)) porSufixo.set(sufixo, p.name);
	}
	const racas = new Map((dados.racas ?? []).map((r) => [normalizar(r.name), r.name]));
	const ctx = {
		ehPoder: (nome) => dados.poderesPorNome.get(normalizar(nome))?.name ?? semComplemento.get(normalizar(nome))
			?? dados.poderesPorNome.get(normalizar(APELIDOS_PODER[normalizar(nome)] ?? ""))?.name ?? porSufixo.get(normalizar(nome)) ?? null,
		ehRaca: (nome) => racas.get(normalizar(nome)) ?? null,
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
function fichaProjetada(ficha, nomesClasse, habilidades) {
	const novas = new Set(habilidades.map((h) => normalizar(h)));
	// o nível novo conta para a classe e para a básica dela (variante)
	const daClasse = new Set(nomesClasse.filter(Boolean).map(normalizar));
	return {
		...ficha,
		nivel: ficha.nivel + 1,
		niveisDeClasse: (nome) => ficha.niveisDeClasse(nome) + (daClasse.has(normalizar(nome)) ? 1 : 0),
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
	dados, progressao, ficha, classe, lerPreRequisito, selecionavel = () => true, regrasPoderesClasse = {},
	ehGeral = (p) => p.system?.tipo === "geral", grupoGeral = (p) => p.system?.subtipo || "Outros"
}) {
	const prog = progressaoDe(progressao, classe.nome);
	if (!prog) return { erro: "semProgressao" };
	const nivelClasse = classe.niveis + 1;
	const nivelPersonagem = ficha.nivel + 1;
	if (nivelPersonagem > NIVEL_MAXIMO) return { erro: "nivelMaximo" };

	const entrada = prog.niveis?.[nivelClasse] ?? {};
	const avisos = [];
	// o item da própria classe tem preferência: variantes têm habilidades com o mesmo nome das da
	// classe básica (ex.: Briga do Atleta × Briga do Lutador), com texto e efeitos próprios
	const daClasse = new Map(dados.poderes
		.filter((p) => normalizar(p.system?.subtipo) === normalizar(classe.nome))
		.map((p) => [normalizar(p.name), p]));
	const buscar = (nome, { avisar = true } = {}) => {
		const doc = daClasse.get(normalizar(nome)) ?? dados.poderesPorNome.get(normalizar(nome)) ?? null;
		if (!doc && avisar) avisos.push(`Habilidade "${nome}" não encontrada nos compêndios.`);
		return doc;
	};
	// como o valor da tabela vai para a ficha: "rolagem" (fórmula da rolagem do poder), "anotacao"
	// (linha na descrição) ou nada (só informativo: o sistema já faz o efeito crescer)
	const modoValor = (nome) => prog.valoresNaFicha?.[nome] ?? null;
	const habilidades = [];
	// habilidade que depende de uma escolha anterior (ex.: Técnica Avançada conforme a Escola de Duelo)
	const conformes = (entrada.conforme ?? []).map((mapa) => {
		const chave = Object.keys(mapa).find((k) => ficha.temPoder(k));
		if (!chave) avisos.push(`Nenhuma das escolhas que definem a habilidade deste nível está na ficha (${Object.keys(mapa).join(", ")}).`);
		return chave ? mapa[chave] : null;
	}).filter(Boolean);
	for (const ref of [...(entrada.habilidades ?? []), ...conformes]) {
		// {nome, classe}: habilidade ou poder de outra classe (ex.: Golpe Divino do paladino para o vassalo)
		const nome = typeof ref === "string" ? ref : ref.nome;
		const doc = typeof ref === "string" ? buscar(nome)
			: dados.poderes.find((p) => normalizar(p.name) === normalizar(nome) && normalizar(p.system?.subtipo) === normalizar(ref.classe)) ?? buscar(nome);
		const jaTem = ficha.temPoder(nome);
		habilidades.push({
			nome: doc?.name ?? nome, doc, jaTem, valor: valorAte(prog, nome, nivelClasse), modo: modoValor(nome),
			corrigir: prog.corrigirFormulas?.[nome] ?? null
		});
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

	// poderes que concedem outra habilidade conforme a ficha (ex.: Herança Aprimorada → Linhagem Dracônica Aprimorada)
	const concessoes = new Map();
	for (const [poder, mapa] of Object.entries(prog.poderesConcedem ?? {})) {
		const chave = Object.keys(mapa).find((k) => ficha.temPoder(k));
		const doc = chave ? dados.poderesPorNome.get(normalizar(mapa[chave])) : null;
		if (doc) concessoes.set(normalizar(poder), doc);
	}

	const ganhaPoder = (prog.poder?.niveis ?? []).includes(nivelClasse);
	const magias = magiasDoNivel(prog, ficha, nivelClasse, regrasPoderesClasse);
	// Usurpar e afins: todas as magias do círculo novo entram sozinhas
	if (magias?.todas && magias.circuloNovo) magias.automaticas = magiasDisponiveis(dados, magias, ficha).filter((m) => circuloDe(m) === magias.circuloNovo);
	const projetada = fichaProjetada(ficha, [classe.nome, prog.base], habilidades.map((h) => h.nome));
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
			jaTem,
			concede: concessoes.get(normalizar(doc.name)) ?? null
		};
	};
	const ordenar = (a, b) => a.nome.localeCompare(b.nome, "pt-BR");
	// poderes da classe básica, da própria classe (variante) e listas extras (ex.: Melhor Amigo do treinador)
	const listas = new Set([classeBasica, classe.nome, ...(prog.poder?.listas ?? []), ...(prog.poder?.listasPorNivel?.[nivelClasse] ?? [])].map(normalizar));
	const poderesClasse = !ganhaPoder ? [] : dados.poderes
		.filter((p) => p.system?.tipo === "classe" && listas.has(normalizar(p.system?.subtipo)) && selecionavel(p))
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
		// habilidades da tabela que não têm item em nenhum compêndio (só aviso: consultar o livro)
		ausentes: entrada.ausentes ?? [],
		magias,
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
export function pendenciaNivel(nivel, { poder = null, selecoes = {}, magias = [], escolas = null } = {}) {
	const faltam = [];
	const m = nivel.magias;
	if (m) {
		const esc = escolasEfetivas(m, escolas);
		if (m.escolas && esc.length !== m.escolas) faltam.push(`${m.escolas} escolas de magia`);
		else if (m.vagas.length) {
			const r = conferirVagas(m.vagas, magias);
			if (r.faltam.length) faltam.push(r.faltam.join(", "));
		}
	}
	for (const e of nivel.escolhas ?? []) if (!e.opcoes.some((o) => o.doc.uuid === selecoes[e.id])) faltam.push(e.titulo);
	for (const a of nivel.anotadas ?? []) if (!a.opcoes.includes(selecoes[a.id])) faltam.push(a.titulo);
	if (nivel.ganhaPoder && !poder?.disponivel) faltam.push("um poder");
	return faltam.length ? `Escolha: ${faltam.join(", ")}.` : null;
}

/** Plano de gravação (aplicar-nivel.js) a partir do nível calculado e das escolhas feitas. */
export function montarPlano(nivel, { classeId, poder = null, anotacao = "", selecoes = {}, magias = [], escolas = null } = {}) {
	const concedido = poder?.disponivel && poder.concede ? [{ doc: poder.concede }] : [];
	const m = nivel.magias;
	return {
		magias: [...magias, ...(m?.automaticas ?? [])],
		// escolas escolhidas agora (personagem sem as escolas gravadas na ficha)
		escolasMagia: m?.escolas && !m.escolasFicha?.length && escolas?.length === m.escolas ? [...escolas] : null,
		classeId,
		nivelPersonagem: nivel.nivelPersonagem,
		nivelClasse: nivel.nivelClasse,
		habilidades: [...nivel.habilidades.filter((h) => h.doc && !h.jaTem).map((h) => ({ doc: h.doc, valor: h.valor, modo: h.modo, corrigir: h.corrigir })), ...concedido],
		escolhidas: (nivel.escolhas ?? []).map((e) => e.opcoes.find((o) => o.doc.uuid === selecoes[e.id])?.doc).filter(Boolean),
		anotadas: (nivel.anotadas ?? []).filter((a) => selecoes[a.id]).map((a) => ({ doc: a.doc, texto: `${a.titulo}: ${selecoes[a.id]}` })),
		valores: nivel.valores.filter((v) => v.modo),
		poder: poder?.disponivel ? poder.doc : null,
		anotacao
	};
}

/* ---------- Magias ---------- */

export const circuloDe = (m) => Number(m?.system?.circulo) || 0;

/** Maior círculo acessível no nível de classe (círculos: {"1": 1, "5": 2, …}). */
function circuloAte(circulos, nivel) {
	let c = 0;
	for (const [n, circ] of Object.entries(circulos ?? {})) if (Number(n) <= nivel) c = Math.max(c, circ);
	return c;
}

/**
 * Regra de magias da classe para esta ficha: a da progressão, ajustada pelas escolhas que a ficha tem
 * (porEscolha, ex.: Feiticeiro aprende só em nível ímpar) e pelos tipos extras de poderes
 * (poderes-classe.json → tiposMagiaExtras, ex.: Linhagem Abençoada dá magias divinas).
 */
export function regraMagias(prog, ficha, regrasPoderesClasse = {}) {
	const m = prog?.magias;
	if (!m) return null;
	let r = { tipo: m.tipo, circulos: m.circulos, aprende: m.aprende ?? "todo", escolas: m.escolas ?? 0, extraPorCirculo: 0, todas: !!m.todas };
	for (const [poder, ajuste] of Object.entries(m.porEscolha ?? {})) if (ficha.temPoder(poder)) r = { ...r, ...ajuste };
	const tipos = new Set([m.tipo, "uni"]);
	for (const [poder, regra] of Object.entries(regrasPoderesClasse)) {
		if (regra?.tiposMagiaExtras && ficha.temPoder(poder)) regra.tiposMagiaExtras.forEach((t) => tipos.add(t));
	}
	return { ...r, tipos: [...tipos] };
}

/**
 * Magias que o nível concede: vagas ({ate: círculo máximo} ou {circulo: exato}), círculo acessível e escolas.
 * Null se a classe não conjura. Vagas vazias = nível sem magia nova (ex.: bardo em nível ímpar).
 */
export function magiasDoNivel(prog, ficha, nivelClasse, regrasPoderesClasse = {}) {
	const r = regraMagias(prog, ficha, regrasPoderesClasse);
	if (!r) return null;
	const circulo = circuloAte(r.circulos, nivelClasse);
	const circuloNovo = r.circulos?.[nivelClasse] ?? null;
	const qtd = r.todas ? 0 : r.aprende === "todo" ? 1
		: r.aprende === "par" ? (nivelClasse % 2 === 0 ? 1 : 0)
			: r.aprende === "impar" ? (nivelClasse % 2 === 1 && nivelClasse >= 3 ? 1 : 0) : 0;
	const vagas = Array.from({ length: qtd }, () => ({ ate: circulo }));
	if (circuloNovo && r.extraPorCirculo) for (let i = 0; i < r.extraPorCirculo; i++) vagas.push({ circulo: circuloNovo, motivo: "círculo novo" });
	return {
		tipo: r.tipo,
		tipos: r.tipos,
		circulo,
		circuloNovo,
		escolas: r.escolas,
		escolasFicha: ficha.escolasMagia ?? [],
		dicaEscolas: prog.magias?.dicaEscolas ?? null,
		aprende: r.aprende,
		todas: r.todas,
		vagas
	};
}

/** Escolas que valem: as gravadas na ficha ou, se não houver, as escolhidas agora na janela. */
export function escolasEfetivas(m, escolhidas = null) {
	if (!m?.escolas) return [];
	return m.escolasFicha?.length ? m.escolasFicha : (escolhidas ?? []);
}

/** Magias que podem ser aprendidas neste nível (tipo, círculo, escolas; sem as que a ficha já tem). */
export function magiasDisponiveis(dados, m, ficha, escolhidas = null) {
	if (!m) return [];
	const esc = escolasEfetivas(m, escolhidas);
	return dados.magias
		.filter((x) => m.tipos.includes(x.system?.tipo) && circuloDe(x) >= 1 && circuloDe(x) <= m.circulo)
		.filter((x) => !m.escolas || esc.includes(x.system?.escola))
		.filter((x) => !ficha.magias.has(normalizar(x.name)))
		.sort((a, b) => circuloDe(a) - circuloDe(b) || a.name.localeCompare(b.name, "pt-BR"));
}

const textoVaga = (v) => (v.circulo ? `1 magia de ${v.circulo}º círculo${v.motivo ? ` (${v.motivo})` : ""}` : `1 magia de até ${v.ate}º círculo`);

/**
 * Distribui as magias escolhidas nas vagas (as de círculo exato primeiro).
 * @returns {{ok: boolean, faltam: string[], sobram: number}}
 */
export function conferirVagas(vagas, magias) {
	const livres = [...vagas].sort((a, b) => (b.circulo ? 1 : 0) - (a.circulo ? 1 : 0));
	const restantes = [...magias].sort((a, b) => circuloDe(b) - circuloDe(a));
	const naoUsadas = [];
	for (const mag of restantes) {
		const c = circuloDe(mag);
		const i = livres.findIndex((v) => (v.circulo ? v.circulo === c : c <= v.ate));
		if (i >= 0) livres.splice(i, 1);
		else naoUsadas.push(mag);
	}
	return { ok: !livres.length && !naoUsadas.length, faltam: livres.map(textoVaga), sobram: naoUsadas.length };
}
