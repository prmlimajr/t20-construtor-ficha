/**
 * Integração opcional com o módulo "Suplementos de Arton" (suplementos-de-arton).
 *
 * Tudo aqui só roda quando o mestre liga a configuração "Usar Suplementos de Arton" e o
 * módulo está ativo. Cada tipo de conteúdo tem uma chave própria. O construtor só lê os
 * compêndios do outro módulo; nada é copiado.
 *
 * O suplemento foi feito para Foundry v13 / Tormenta20 1.5: os documentos chegam migrados
 * pelo Foundry, mas algumas regras (perícias e proficiências das classes, devotos dos deuses
 * menores) não existem nos dados e são deduzidas ou ficam livres, sempre com aviso.
 */
import { MODULE_ID, ATRIBUTOS, normalizar, interpretarPericiasClasse } from "./regras.js";

export const SUPLEMENTO_ID = "suplementos-de-arton";

/** Chaves de conteúdo (configuração `sup<Chave>`), na ordem do menu de configurações. */
export const CONTEUDOS_SUPLEMENTO = ["Racas", "Classes", "Poderes", "Magias", "Itens", "Divindades", "OrigensRegionais", "OrigensMundanas"];

/** O suplemento está ligado (configuração) e ativo (módulo)? */
export function suplementoLigado() {
	try {
		return !!game.settings.get(MODULE_ID, "suplementos") && !!game.modules.get(SUPLEMENTO_ID)?.active;
	} catch (err) {
		return false;
	}
}

/** Um tipo de conteúdo do suplemento está ligado? */
export function conteudoLigado(chave) {
	if (!suplementoLigado()) return false;
	try {
		return !!game.settings.get(MODULE_ID, `sup${chave}`);
	} catch (err) {
		return false;
	}
}

/* ---------------- Utilitários ---------------- */

const ENTIDADES = {
	nbsp: " ", amp: "&", quot: "\"", lt: "<", gt: ">", ordm: "º", ordf: "ª",
	aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", atilde: "ã", otilde: "õ", ccedil: "ç",
	acirc: "â", ecirc: "ê", ocirc: "ô", agrave: "à"
};

/** Texto puro de um HTML do compêndio (o suplemento usa entidades como "come&ccedil;a"). */
function texto(html) {
	const semTags = String(html ?? "").replace(/<[^>]+>/g, " ");
	const decodificado = semTags
		.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
		.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
		.replace(/&([a-z]+);/gi, (m, nome) => {
			const c = ENTIDADES[nome.toLowerCase()];
			if (!c) return m;
			return nome[0] === nome[0].toUpperCase() ? c.toUpperCase() : c;
		});
	return decodificado.replace(/\s+/g, " ").trim();
}

const NUMEROS = { nenhuma: 0, nenhum: 0, uma: 1, um: 1, duas: 2, dois: 2, tres: 3, quatro: 4, cinco: 5, seis: 6 };
function numeroPorExtenso(t) {
	const n = Number(t);
	return Number.isFinite(n) ? n : NUMEROS[normalizar(t)] ?? null;
}

/** Cadeia de pastas de um documento do compêndio ("HdA - Itens / Armas / Simples"). */
function cadeiaPastas(doc, pack) {
	const nomes = [];
	let f = doc.folder ?? null;
	if (typeof f === "string") f = pack?.folders?.get(f) ?? null;
	while (f) {
		nomes.unshift(f.name);
		f = typeof f.folder === "string" ? pack?.folders?.get(f.folder) : f.folder;
	}
	return nomes.join(" / ");
}

/* ---------------- Loja ---------------- */

/** Pastas de itens que não são equipamento inicial comprável (mágicos, artefatos, litúrgicos...). */
const PASTAS_FORA_DA_LOJA = /m[aá]gic|artefato|lit[uú]rgic|espec[ií]fic|avatar|distin[cç]|b[eê]n[cç][aã]o|extras/i;

const ARMAS_POR_PROFICIENCIA = { simples: "Armas simples", marcial: "Armas marciais", exotica: "Armas exóticas", fogo: "Armas de fogo" };
const ARMADURAS_POR_TIPO = { leve: "Armaduras leves", pesada: "Armaduras pesadas", escudo: "Escudos" };

/** Categoria da loja de um item do suplemento: pelo nome da pasta e, se não bastar, pelo tipo. */
function categoriaSuplemento(doc, pasta) {
	const s = doc.system ?? {};
	const p = normalizar(pasta);
	if (doc.type === "arma") return ARMAS_POR_PROFICIENCIA[s.proficiencia] ?? null;
	if (/aliment/.test(p) || s.tipo === "food") return "Alimentação";
	if (/alquim|catali|venen|prepara/.test(p) || s.tipo === "alchemy") return "Alquímicos";
	if (/muni/.test(p) || s.tipo === "ammo") return "Munições";
	if (/armadura|escudo/.test(p) && ARMADURAS_POR_TIPO[s.tipo]) return ARMADURAS_POR_TIPO[s.tipo];
	if (doc.type === "equipamento" && ["leve", "pesada", "escudo"].includes(s.tipo) && !/anima|vestu|ferrament/.test(p)) return ARMADURAS_POR_TIPO[s.tipo];
	if (/anima/.test(p)) return "Animais";
	if (/vestu/.test(p) || s.tipo === "traje") return "Vestuário";
	if (/ferrament|instrument/.test(p) || s.tipo === "ferramenta") return "Ferramentas";
	if (/esot/.test(p) || s.tipo === "esoterico") return "Esotérico";
	if (/veicul/.test(p)) return "Veículos";
	return "Equipamento de aventura";
}

/* ---------------- Raças ---------------- */

/** Texto que o sistema põe em toda raça, com ou sem atributos flexíveis: não indica regra nenhuma. */
const DESCRICAO_PADRAO_DINAMICOS = "+1 em tres atributos diferentes";

/**
 * Atributos com +1 flexível de uma raça: {lista, qtd, deduzido}. Raças do suplemento (formato
 * antigo) às vezes trazem só o texto ("+1 em dois atributos", "... (exceto Con)") com a lista
 * vazia; nesse caso a regra é deduzida do texto, desde que ele não seja o texto padrão.
 */
export function atributosDinamicosRaca(r) {
	const ad = r?.system?.atributosDinamicos ?? {};
	let lista = [...(ad.value ?? [])];
	const desc = normalizar(ad.description ?? "");
	const m = /\+1 em (\w+) atributos/.exec(desc);
	const qtd = m ? numeroPorExtenso(m[1]) ?? 3 : 3;
	let deduzido = false;
	if (!lista.length && m && desc !== DESCRICAO_PADRAO_DINAMICOS) {
		const exceto = /exceto (\w+)/.exec(desc)?.[1] ?? "";
		lista = ATRIBUTOS.filter((k) => !exceto || !normalizar(exceto).startsWith(k));
		deduzido = true;
	}
	return { lista, qtd, deduzido };
}

/* ---------------- Classes ---------------- */

const RE_NIVEL_SUPERIOR = /^(no|a partir do|ao atingir o|quando atinge o|em)\s+\d+º\s+n[ií]vel|pr[eé]-requisito/i;

/** Habilidades de 1º nível prováveis: as da classe cujo texto não fala de nível maior nem pré-requisito. */
function habilidadesNivel1(nomeClasse, poderesSup) {
	return poderesSup
		.filter((p) => p.system?.tipo === "ability" && p.system?.subtipo === nomeClasse)
		.filter((p) => !RE_NIVEL_SUPERIOR.test(texto(p.system?.description?.value).slice(0, 400)))
		.map((p) => p.name);
}

/** Conjuração a partir do texto de "Magias (...)": tipo, quantidade inicial, escolas e atributo. */
function conjuradorDoTexto(t) {
	const n = normalizar(t);
	const tipo = /magias arcanas/.test(n) ? "arc" : /magias divinas/.test(n) ? "div" : null;
	if (!tipo) return null;
	const qtd = numeroPorExtenso(/comeca com (\w+) magias?/.exec(n)?.[1] ?? "") ?? 2;
	const escolas = numeroPorExtenso(/escolha (\w+) escolas/.exec(n)?.[1] ?? "") ?? 0;
	const atr = /atributo-chave para lancar magias e (\w+)/.exec(n)?.[1] ?? "";
	const atributo = atr.startsWith("sab") ? "sab" : atr.startsWith("car") ? "car" : "int";
	// Usurpador: não começa com magias, mas Usurpar lança qualquer magia divina dos círculos acessíveis
	// → a ficha recebe todas as magias do tipo de 1º círculo (sem escolha)
	if (/nao comeca com nenhuma magia/.test(n) && /usurpar/.test(n)) return { tipo, quantidade: 0, escolas: 0, atributo, todas: true };
	return { tipo, quantidade: qtd, escolas, atributo };
}

/** Devoção a partir do texto de "Devoto Fiel (...)". */
function devocaoDoTexto(t) {
	const n = normalizar(t);
	const poderes = /dois poderes concedidos/.test(n) ? 2 : 1;
	const devocao = { obrigatoria: true, poderes };
	if (/panteao/.test(n)) {
		devocao.alternativa = { nome: "Devoto do Panteão", descricao: "Serve ao Panteão como um todo, sem ser devoto de uma divindade específica. Não recebe poderes concedidos; em compensação, recebe Devoção Ampla (+2 PM por patamar).", poder: "Devoção Ampla" };
	}
	return devocao;
}

const OFICIO_POR_NOME = { alfaiate: "alfa", alquimista: "alqu", armeiro: "arme", artesao: "arte", cozinheiro: "cozi", engenhoqueiro: "enge" };

/** Tira o rótulo "Perícias." que vem no começo do texto copiado do livro. */
function limparTextoPericias(texto) {
	return String(texto ?? "").replace(/^\s*per[ií]cias\.\s*/i, "").replace(/\s+/g, " ").trim();
}

/**
 * Perícias de uma classe a partir do texto do livro. Além do formato normal ("X e Y, mais N a sua
 * escolha entre ..."), entende "Como o <classe> básico" (copia as perícias da classe básica) e
 * "mas seu Ofício inicial é <ofício>" (troca o Ofício à escolha pelo Ofício indicado).
 */
function periciasDoTexto(texto, regrasBase) {
	const limpo = limparTextoPericias(texto);
	if (!limpo) return null;
	const como = /^como (?:o|a) (.+?) b[aá]sic[oa]/i.exec(limpo);
	if (!como) return interpretarPericiasClasse(limpo);
	const nomeBase = Object.keys(regrasBase).find((k) => normalizar(k) === normalizar(como[1]));
	const base = nomeBase ? regrasBase[nomeBase] : null;
	if (!base) return { fixas: [], ou: [], opcoes: ["todas"], numero: 2, naoReconhecidas: [como[1]] };
	const out = { fixas: [...base.fixas], ou: base.ou.map((g) => [...g]), opcoes: [...base.opcoes], numero: base.numero, naoReconhecidas: [] };
	const oficio = /of[ií]cio inicial (?:é|e) (?:o |a )?(\w+)/i.exec(limpo)?.[1];
	if (oficio) {
		const k = OFICIO_POR_NOME[normalizar(oficio)];
		if (!k) out.naoReconhecidas.push(`Ofício (${oficio})`);
		else {
			// o grupo "um Ofício à escolha" vira o Ofício indicado, treinado automaticamente
			out.ou = out.ou.filter((g) => !(g.length === 1 && g[0] === "oficio"));
			out.fixas.push(k);
		}
	}
	return out;
}

/**
 * Regras de 1º nível de uma classe do suplemento. Prioridade:
 * 1. regras completas em data/suplementos.json → "classes";
 * 2. variante de uma classe básica ("variantes"): herda perícias e proficiências da base;
 * 3. dedução: perícias livres, só proficiências básicas.
 * As habilidades de 1º nível, a conjuração e a devoção vêm dos poderes da própria classe.
 */
function regrasClasseSuplemento(doc, poderesSup, regrasBase, config) {
	// regras cadastradas à mão (data/suplementos.json → classes): substituem a dedução automática.
	// Aceitam "periciasTexto" (texto do livro) e "variante" (classe básica de onde vêm as proficiências).
	const manual = config.classes?.[doc.name];
	if (manual) {
		const base = manual.variante ? regrasBase[manual.variante] : null;
		const pericias = manual.periciasTexto ? periciasDoTexto(manual.periciasTexto, regrasBase) : null;
		if (pericias?.naoReconhecidas?.length) console.warn(`${MODULE_ID} | perícias não reconhecidas em ${doc.name}:`, pericias.naoReconhecidas);
		return {
			fixas: [], ou: [], opcoes: [], numero: 0, escolhas: [], equipamentoExtra: base?.equipamentoExtra ?? [],
			...manual,
			...(pericias ? { fixas: pericias.fixas, ou: pericias.ou, opcoes: pericias.opcoes, numero: pericias.numero, periciasTexto: limparTextoPericias(manual.periciasTexto) } : {}),
			proficiencias: manual.proficiencias ?? base?.proficiencias ?? [],
			suplemento: true
		};
	}
	const habilidades = habilidadesNivel1(doc.name, poderesSup);
	const porNome = (n) => poderesSup.find((p) => p.name === n);
	const magias = habilidades.find((n) => /^magias\b/i.test(n));
	const devoto = habilidades.find((n) => /^devoto fiel/i.test(n));
	const conjurador = magias ? conjuradorDoTexto(texto(porNome(magias)?.system?.description?.value)) : null;
	const devocao = devoto ? devocaoDoTexto(texto(porNome(devoto)?.system?.description?.value)) : null;

	// Habilidades "Prefixo: Opção" com o mesmo prefixo (ex.: "Tipo: Animal", "Tipo: Monstro") são
	// alternativas: viram uma escolha, como o Caminho do Arcanista
	const escolhas = [];
	const porPrefixo = new Map();
	for (const h of habilidades) {
		const m = /^([^:]+):\s+.+$/.exec(h);
		if (m) (porPrefixo.get(m[1]) ?? porPrefixo.set(m[1], []).get(m[1])).push(h);
	}
	for (const [prefixo, opcoes] of porPrefixo) {
		if (opcoes.length < 2) continue;
		escolhas.push({ id: normalizar(prefixo).replace(/[^a-z0-9]+/g, "-"), titulo: prefixo, opcoes: opcoes.map((poder) => ({ poder })) });
		for (const o of opcoes) habilidades.splice(habilidades.indexOf(o), 1);
	}

	// perícias cadastradas como texto do livro (data/suplementos.json → periciasClasses)
	const textoPericias = config.periciasClasses?.[doc.name];
	const doLivro = periciasDoTexto(textoPericias, regrasBase);
	if (doLivro?.naoReconhecidas?.length) console.warn(`${MODULE_ID} | perícias não reconhecidas em ${doc.name}:`, doLivro.naoReconhecidas);

	const nomeBase = config.variantes?.[doc.name];
	const base = nomeBase ? regrasBase[nomeBase] : null;
	if (base) {
		const pericias = doLivro ?? base;
		return {
			fixas: pericias.fixas, ou: pericias.ou, opcoes: pericias.opcoes, numero: pericias.numero,
			...(doLivro ? { periciasTexto: limparTextoPericias(textoPericias) } : {}),
			proficiencias: base.proficiencias,
			habilidades, escolhas,
			...(conjurador ? { conjurador } : {}),
			...(devocao ? { devocao } : base.devocao && habilidades.some((h) => /aben[cç]oado/i.test(h)) ? { devocao: base.devocao } : {}),
			equipamentoExtra: base.equipamentoExtra ?? [],
			suplemento: true,
			aviso: doLivro
				? `Variante de ${nomeBase}: perícias conforme o livro; proficiências herdadas de ${nomeBase}; habilidades de 1º nível deduzidas dos poderes do suplemento. Confira com o livro.`
				: `Variante de ${nomeBase}: perícias e proficiências herdadas de ${nomeBase}; habilidades de 1º nível deduzidas dos poderes do suplemento. Confira com o livro.`
		};
	}
	if (doLivro) {
		return {
			fixas: doLivro.fixas, ou: doLivro.ou, opcoes: doLivro.opcoes, numero: doLivro.numero,
			periciasTexto: limparTextoPericias(textoPericias),
			proficiencias: [],
			habilidades, escolhas,
			...(conjurador ? { conjurador } : {}),
			...(devocao ? { devocao } : {}),
			equipamentoExtra: [],
			suplemento: true,
			aviso: "Classe de suplemento: perícias conforme o livro; proficiências (só as básicas) e habilidades de 1º nível deduzidas dos dados do suplemento. Confira com o livro."
		};
	}
	return {
		fixas: [], ou: [], opcoes: ["todas"], numero: Number(doc.system?.pericias?.numero) || 2,
		// as perícias treinadas da classe não estão nos dados: o jogador indica no passo Perícias
		periciasManuais: true,
		proficiencias: [],
		habilidades, escolhas,
		...(conjurador ? { conjurador } : {}),
		...(devocao ? { devocao } : {}),
		equipamentoExtra: [],
		suplemento: true,
		aviso: "Classe de suplemento sem regras cadastradas: indique as perícias treinadas da classe no passo Perícias (conforme o livro); só proficiências básicas e habilidades de 1º nível deduzidas. Confira com o livro."
	};
}

/* ---------------- Divindades ---------------- */

/**
 * Distribui os poderes concedidos do suplemento: os de deuses maiores entram na lista do deus
 * (inclusive os de vários deuses, "Lena, Thyatis"); os do Guia de Deuses Menores viram deuses
 * novos, sem restrição de devotos (o compêndio não traz essa informação).
 */
function divindadesComSuplemento(divindades, poderesSup, fonte) {
	const lista = divindades.map((d) => ({ ...d, poderes: [...(d.poderes ?? [])] }));
	const porNome = new Map(lista.map((d) => [normalizar(d.nome), d]));
	const menores = new Map();
	for (const p of poderesSup) {
		if (p.system?.tipo !== "concedido") continue;
		const sub = String(p.system?.subtipo ?? "").replace(/\s+/g, " ").trim();
		if (!sub) continue;
		const partes = sub.split(",").map((s) => s.trim());
		if (partes.every((x) => porNome.has(normalizar(x)))) {
			for (const x of partes) {
				const d = porNome.get(normalizar(x));
				if (!d.poderes.includes(p.name)) d.poderes.push(p.name);
			}
			continue;
		}
		if (!/deuses menores/i.test(fonte.get(p.uuid) ?? "")) continue;
		const [nome, ...resto] = partes;
		// subtipo corrompido no compêndio (ex.: "system.pericias.perc.bonus") não é nome de deus
		if (!/^\p{Lu}/u.test(nome) || nome.includes(".")) continue;
		const chave = normalizar(nome);
		if (!menores.has(chave)) {
			menores.set(chave, {
				nome,
				titulo: resto.join(", ") || "Deus menor",
				descricao: "Deus menor (Guia de Deuses Menores). As crenças, os devotos e as obrigações não estão nos dados do suplemento: consulte o livro.",
				poderes: [],
				devotos: {},
				menor: true
			});
		}
		menores.get(chave).poderes.push(p.name);
	}
	return [...lista, ...[...menores.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))];
}

/* ---------------- Origens regionais ---------------- */

/** Uma origem regional por região do Atlas de Arton, com os poderes dela como benefícios. */
function origensRegionaisDoAtlas(poderesSup, fonte) {
	const regioes = new Map();
	for (const p of poderesSup) {
		if (p.system?.tipo !== "origem" || !/atlas/i.test(fonte.get(p.uuid) ?? "")) continue;
		for (const regiao of String(p.system?.subtipo ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
			if (!regioes.has(regiao)) {
				regioes.set(regiao, {
					nome: regiao,
					descricao: `Origem regional de ${regiao} (Atlas de Arton). Escolha um dos poderes regionais abaixo.`,
					itens: [], pericias: [], poderes: [], grupos: [],
					suplemento: true
				});
			}
			regioes.get(regiao).poderes.push(p.name);
		}
	}
	return [...regioes.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/* ---------------- Origens mundanas ---------------- */

/**
 * Origens mundanas do Heróis de Arton: cada uma é um único poder (subtipo "Mundana") que já diz
 * tudo o que a origem concede; não há itens nem escolha de benefícios. As perícias e escolhas
 * vêm de data/suplementos.json → "origensMundanas".
 */
function origensMundanas(poderesSup, fonte, config) {
	return poderesSup
		.filter((p) => p.system?.tipo === "origem" && p.system?.subtipo === "Mundana")
		.map((p) => {
			const extra = config.origensMundanas?.[p.name] ?? {};
			return {
				nome: p.name,
				descricao: "",
				especial: "mundana",
				poder: p.name,
				periciasMundanas: extra.pericias ?? [],
				oficiosSemPericia: extra.oficiosSemPericia ?? [],
				poderesExtras: extra.poderesExtras ?? [],
				escolhaPericia: extra.escolhaPericia ?? null,
				escolhaPoder: extra.escolhaPoder ?? null,
				itens: [], pericias: [], poderes: [], grupos: [],
				fonte: fonte.get(p.uuid) ?? "Heróis de Arton",
				suplemento: true
			};
		})
		.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/* ---------------- Carregamento ---------------- */

/**
 * Lê os compêndios do suplemento e devolve o conteúdo já filtrado pelas chaves ligadas.
 * `base`: { regrasClasses, divindades, origensRegionais } do construtor.
 */
export async function carregarSuplementos(base, config) {
	const vazio = { ligado: false, racas: [], classes: [], regrasClasses: {}, poderes: [], magias: [], itens: [], fonte: new Map(), uuids: new Set() };
	if (!suplementoLigado()) return vazio;

	const packs = game.packs.filter((p) => p.metadata?.packageName === SUPLEMENTO_ID && p.documentName === "Item");
	const fonte = new Map();
	const pastas = new Map();
	const docs = [];
	// os compêndios do suplemento em paralelo
	const listas = await Promise.all(packs.map((pack) => pack.getDocuments().catch((err) => {
		console.warn(`${MODULE_ID} | não foi possível ler ${pack.collection}:`, err);
		return [];
	})));
	for (const [i, pack] of packs.entries()) {
		const lista = listas[i];
		for (const d of lista) {
			fonte.set(d.uuid, pack.metadata.label);
			pastas.set(d.uuid, cadeiaPastas(d, pack));
			docs.push(d);
		}
	}
	const ignorar = new Set(config.ignorarClasses ?? []);
	const porTipo = (t) => docs.filter((d) => d.type === t);
	const poderesSup = porTipo("poder");

	const out = {
		ligado: true,
		fonte,
		uuids: new Set(docs.map((d) => d.uuid)),
		// os poderes sempre entram para consulta (habilidades de raças e classes); a chave
		// "Poderes" decide só se eles aparecem nas listas de escolha
		poderes: poderesSup,
		racas: conteudoLigado("Racas") ? porTipo("race") : [],
		classes: conteudoLigado("Classes") ? porTipo("classe").filter((c) => !ignorar.has(c.name) && !base.regrasClasses[c.name]) : [],
		regrasClasses: {},
		magias: conteudoLigado("Magias") ? porTipo("magia") : [],
		itens: []
	};
	for (const c of out.classes) out.regrasClasses[c.name] = regrasClasseSuplemento(c, poderesSup, base.regrasClasses, config);

	if (conteudoLigado("Itens")) {
		for (const d of docs) {
			if (!["arma", "equipamento", "consumivel", "tesouro"].includes(d.type)) continue;
			const pasta = pastas.get(d.uuid) ?? "";
			// ajustes manuais da loja (data/suplementos.json → loja): categoria e itens sem preço no compêndio
			const incluir = (config.loja?.incluir ?? []).includes(d.name);
			if (!incluir && (PASTAS_FORA_DA_LOJA.test(pasta) || /distin/i.test(fonte.get(d.uuid) ?? ""))) continue;
			if (!incluir && !(Number(d.system?.preco) > 0)) continue;
			const categoria = config.loja?.categorias?.[d.name] ?? categoriaSuplemento(d, pasta);
			if (categoria) out.itens.push({ doc: d, categoria });
		}
	}
	if (conteudoLigado("Divindades")) out.divindades = divindadesComSuplemento(base.divindades, poderesSup, fonte);
	// Complicações (Heróis de Arton): pela pasta, "Complicações (Geral)" ou "Complicações (Classe) / <classe>"
	out.complicacoes = [];
	for (const p of poderesSup) {
		const m = /Complica[cç][oõ]es \((Geral|Classe)\)(?: \/ (.+))?/i.exec(pastas.get(p.uuid) ?? "");
		if (!m) continue;
		out.complicacoes.push({ doc: p, classe: /classe/i.test(m[1]) ? (m[2] ?? "").trim() : null });
	}
	out.complicacoes.sort((a, b) => a.doc.name.localeCompare(b.doc.name, "pt-BR"));
	if (conteudoLigado("OrigensMundanas")) out.origensMundanas = origensMundanas(poderesSup, fonte, config);
	if (conteudoLigado("OrigensRegionais")) {
		const atlas = origensRegionaisDoAtlas(poderesSup, fonte);
		const existentes = new Set(base.origensRegionais.map((o) => normalizar(o.nome)));
		out.origensRegionais = [...base.origensRegionais, ...atlas.filter((o) => !existentes.has(normalizar(o.nome)))];
	}

	console.info(`${MODULE_ID} | Suplementos de Arton ${game.modules.get(SUPLEMENTO_ID)?.version ?? ""}: `
		+ `${out.racas.length} raças, ${out.classes.length} classes, ${poderesSup.length} poderes, `
		+ `${out.magias.length} magias, ${out.itens.length} itens na loja`
		+ (out.divindades ? `, ${out.divindades.filter((d) => d.menor).length} deuses menores` : "")
		+ (out.origensRegionais ? `, ${out.origensRegionais.length} origens regionais` : "")
		+ (out.origensMundanas ? `, ${out.origensMundanas.length} origens mundanas` : "")
		+ `, ${out.complicacoes.length} complicações`);
	return out;
}
