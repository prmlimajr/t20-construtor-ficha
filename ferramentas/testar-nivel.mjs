/**
 * Teste da subida de nível fora do Foundry, com os compêndios do sistema lidos do disco.
 * Roda o código real de gravação e desfazer (aplicar-nivel.js) contra um ator simulado.
 *
 * Uso: node ferramentas/testar-nivel.mjs [Classe ...] [--sistema=caminho do repositório Tormenta20] [-v]
 *   sem classes: todas as de data/progressao.json; -v: mostra cada nível.
 *   Classes do Suplementos de Arton precisam do cache: (cd ferramentas && npm install) && node ferramentas/extrair-suplemento.mjs
 * Não entra no module.zip.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MODULE_ID, normalizar } from "../scripts/regras.js";
import { lerFicha, nomeBase } from "../scripts/ficha-atual.js";
import { podeRepetir, limiteRepeticoes } from "../scripts/pre-requisitos.js";
import { montarNivel, criarLeitorPreRequisitos, montarPlano, pendenciaNivel, progressaoDe, magiasDisponiveis, circuloDe, variantesDe, classesParaSubir, vagasEfetivas, atributoEfetivo, escolhaAtiva, tiposDasVagas, magiasDoPoder, conferirVagas } from "../scripts/nivel.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizModulo = path.resolve(aqui, "..");
const args = process.argv.slice(2);
const raizSistema = path.resolve(args.find((a) => a.startsWith("--sistema="))?.slice(10) ?? path.join(raizModulo, "../Tormenta20"));
const VERBOSO = args.includes("-v");

/* ---------- Simulação mínima do Foundry (o que aplicar-nivel.js e aplicar.js usam) ---------- */
const getProperty = (o, k) => k.split(".").reduce((x, p) => x?.[p], o);
const setProperty = (o, k, v) => {
	const partes = k.split(".");
	const ult = partes.pop();
	const alvo = partes.reduce((x, p) => (x[p] ??= {}), o);
	if (ult.startsWith("-=")) delete alvo[ult.slice(2)]; // remoção, como no update do Foundry
	else alvo[ult] = v;
};
// como o do Foundry: copia só objetos simples e listas; instâncias de classe (modelos de dados) voltam por referência
const ehSimples = (x) => x !== null && typeof x === "object" && (Array.isArray(x) || Object.getPrototypeOf(x) === Object.prototype);
const deepClone = (x) => !ehSimples(x) ? x : Array.isArray(x) ? x.map(deepClone) : Object.fromEntries(Object.entries(x).map(([k, v]) => [k, deepClone(v)]));
globalThis.foundry = { utils: { getProperty, setProperty, deepClone, escapeHTML: (t) => t } };
globalThis.game = { items: { fromCompendium: (d) => structuredClone({ name: d.name, type: d.type, img: d.img, system: d.system, effects: d.effects ?? [] }) } };
const { aplicarNivel, desfazerUltimoNivel, podeDesfazer } = await import("../scripts/aplicar-nivel.js");
const { AtorVirtual, aplicarEscolhas } = await import("../scripts/ficha-virtual.js");

let proximoId = 1;
/** Rolagem como modelo de dados (instância de classe), como RollData no sistema. */
class RollData { constructor(o) { Object.assign(this, structuredClone(o)); } }
/**
 * Item simulado: dados de origem (_source, objetos simples, devolvidos por toObject) e dados preparados
 * (system com as rolagens como RollData), refeitos a cada update, como no Foundry.
 */
function novoItem(data) {
	const fonteItem = structuredClone({ flags: {}, effects: [], ...data });
	// como no Foundry: todo efeito tem id e "origin" (null por padrão)
	fonteItem.effects = (fonteItem.effects ?? []).map((e, i) => ({ _id: e._id ?? `e${i}`, origin: null, ...e }));
	const id = `i${proximoId++}`;
	const item = {
		id,
		uuid: `Actor.teste.Item.${id}`,
		toObject: () => structuredClone(fonteItem),
		preparar() {
			Object.assign(item, structuredClone({ name: fonteItem.name, type: fonteItem.type, flags: fonteItem.flags }));
			item.system = structuredClone(fonteItem.system ?? {});
			if (Array.isArray(item.system.rolls)) item.system.rolls = item.system.rolls.map((r) => new RollData(r));
			item.effects = fonteItem.effects.map((e) => ({ ...structuredClone(e), id: e._id }));
		},
		async update(u) {
			for (const [k, v] of Object.entries(u)) setProperty(fonteItem, k, structuredClone(v));
			item.preparar();
			item.dono?.reset();
		},
		async updateEmbeddedDocuments(_, lista) {
			for (const { _id, ...resto } of lista) Object.assign(fonteItem.effects.find((e) => e._id === _id), structuredClone(resto));
			item.preparar();
		}
	};
	item.preparar();
	return item;
}
function novoAtor(classe, habilidades1, flags = {}) {
	const itens = [];
	const ator = {
		flags: { "t20-construtor-ficha": structuredClone(flags) },
		system: {
			atributos: { for: { value: 3 }, des: { value: 2 }, con: { value: 2 }, int: { value: 1 }, sab: { value: 1 }, car: { value: 2 } },
			pericias: { luta: { treinado: true }, fort: { treinado: true }, guer: { treinado: true }, atle: { treinado: true }, inti: { treinado: true }, dipl: { treinado: true } },
			tracos: {},
			attributes: { pv: { max: 0, value: 0 }, pm: { max: 0, value: 0 } }
		},
		items: Object.assign(itens, {
			get: (id) => itens.find((i) => i.id === id),
			has: (id) => itens.some((i) => i.id === id)
		}),
		get nivel() { return itens.filter((i) => i.type === "classe").reduce((s, c) => s + c.system.niveis, 0); },
		getFlag: (m, k) => ator.flags[m]?.[k],
		reset() {
			// PV/PM simplificados (só para conferir que a diferença vai para os valores atuais)
			ator.system.attributes.pv.max = 20 + (ator.nivel - 1) * 5;
			ator.system.attributes.pm.max = ator.nivel * 3;
		},
		// como no Foundry, os dados derivados (PV/PM máximos) são recalculados depois de cada alteração
		async update(u) { for (const [k, v] of Object.entries(u)) setProperty(ator, k, structuredClone(v)); ator.reset(); },
		async createEmbeddedDocuments(_, lista) { const c = lista.map(novoItem); itens.push(...c); ator.reset(); return c; },
		async updateEmbeddedDocuments(_, lista) { for (const u of lista) { const { _id, ...resto } = u; await itens.find((i) => i.id === _id).update(resto); } ator.reset(); },
		async deleteEmbeddedDocuments(_, ids) { for (const id of ids) itens.splice(itens.findIndex((i) => i.id === id), 1); ator.reset(); }
	};
	itens.push(Object.assign(novoItem({ type: "classe", name: classe, system: { niveis: 1, inicial: true } }), { dono: ator }));
	for (const doc of habilidades1) itens.push(novoItem({ type: "poder", name: `1 - ${doc.name}`, system: structuredClone(doc.system), effects: structuredClone(doc.effects ?? []) }));
	ator.reset();
	ator.system.attributes.pv.value = ator.system.attributes.pv.max;
	ator.system.attributes.pm.value = ator.system.attributes.pm.max;
	return ator;
}
/**
 * Documento preparado simulado a partir dos dados de origem: o papel de `new Actor.implementation(fonte)`
 * na ficha virtual, com a mesma regra de PV/PM do ator simulado (novoAtor → reset).
 */
function documentoSimulado(fonte) {
	const nivel = fonte.items.filter((i) => i.type === "classe").reduce((s, c) => s + (Number(c.system?.niveis) || 0), 0);
	const items = fonte.items.map((f) => ({
		id: f._id, uuid: `Actor.${fonte._id}.Item.${f._id}`, name: f.name, type: f.type, img: f.img, sort: f.sort,
		flags: structuredClone(f.flags ?? {}), system: structuredClone(f.system ?? {}),
		effects: (f.effects ?? []).map((e) => ({ ...structuredClone(e), id: e._id }))
	}));
	const system = structuredClone(fonte.system ?? {});
	system.attributes ??= {};
	system.attributes.pv = { ...(system.attributes.pv ?? {}), max: 20 + (nivel - 1) * 5 };
	system.attributes.pm = { ...(system.attributes.pm ?? {}), max: nivel * 3 };
	return {
		_id: fonte._id, name: fonte.name, type: fonte.type, uuid: `Actor.${fonte._id}`, flags: structuredClone(fonte.flags ?? {}), system, nivel,
		items: Object.assign(items, { get: (id) => items.find((i) => i.id === id), has: (id) => items.some((i) => i.id === id) })
	};
}
/** Dados de origem do ator simulado (o que actor.toObject() daria no Foundry). */
const fonteDoAtor = (ator, nome = "Sombra") => ({
	_id: "sombra", name: nome, type: "character",
	system: structuredClone(ator.system), flags: structuredClone(ator.flags),
	items: ator.items.map((i) => ({ _id: i.id, ...i.toObject() }))
});
const virtualDe = (ator, nome) => new AtorVirtual(fonteDoAtor(ator, nome), { criarDocumento: documentoSimulado });
/** O que a ficha lida (lerFicha) e os valores atuais dizem, sem ids (o ator virtual cria os seus). */
function leitura(ator) {
	const f = lerFicha(ator, { regrasClasses, variantes: variantesDe(progressao) });
	const fora = new Set(["id", "item", "doc", "ator", "dono", "uuid"]);
	return JSON.stringify({
		ficha: JSON.parse(JSON.stringify(f, (k, v) => (fora.has(k) ? undefined : v))),
		itens: ator.items.map((i) => `${i.type}:${i.name}`).sort(),
		pv: ator.system.attributes.pv.value, pm: ator.system.attributes.pm.value,
		escolas: ator.flags?.["t20-construtor-ficha"]?.escolasMagia ?? null,
		historico: (ator.getFlag("t20-construtor-ficha", "niveis") ?? []).map((h) => [h.nivel, h.classe, h.nivelClasse, h.itens.length, h.alteracoes.length, h.pv, h.pm])
	});
}

/**
 * Magias para as vagas do nível, como o teste 2 escolhe: vagas mais restritas primeiro; de preferência do maior
 * círculo; nas vagas do poder que liberam outro tipo (Aumentar Repertório), uma magia desse outro tipo.
 */
function escolherMagias(r, ficha, vagas, escolas) {
	const lista = magiasDisponiveis(dados, { ...r.magias, tipos: tiposDasVagas(r.magias, vagas) }, ficha, escolas);
	const escolhidas = [];
	const restricao = (v) => (v.circulo ? 0 : 10) + (v.tipos?.length ?? 9);
	for (const vaga of [...vagas].sort((a, b) => restricao(a) - restricao(b))) {
		const livres = lista.filter((x) => !escolhidas.includes(x) && (vaga.circulo ? circuloDe(x) === vaga.circulo : circuloDe(x) <= vaga.ate) && (!vaga.tipos || vaga.tipos.includes(x.system.tipo)))
			.sort((a, b) => circuloDe(b) - circuloDe(a));
		const m = livres.find((x) => !r.magias.tipos.includes(x.system.tipo) && circuloDe(x) === (vaga.circulo ?? vaga.ate)) ?? livres[0];
		if (m) escolhidas.push(m);
	}
	return escolhidas;
}

const fotografia = (ator) => JSON.stringify({
	itens: ator.items.map((i) => ({ id: i.id, ...i.toObject() })).sort((a, b) => a.id.localeCompare(b.id)),
	pv: ator.system.attributes.pv.value, pm: ator.system.attributes.pm.value,
	escolas: ator.flags["t20-construtor-ficha"]?.escolasMagia ?? null
});

/* ---------- Dados ---------- */
function lerPack(nome) {
	const out = [];
	const andar = (d) => {
		for (const f of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, f.name);
			if (f.isDirectory()) andar(p);
			else if (f.name.endsWith(".json") && !f.name.startsWith("Folder_")) {
				const doc = JSON.parse(fs.readFileSync(p, "utf8"));
				if (doc._id) out.push({ ...doc, uuid: `Compendium.tormenta20.${nome}.Item.${doc._id}` });
			}
		}
	};
	andar(path.join(raizSistema, "src/packs", nome));
	return out;
}
const json = (f) => JSON.parse(fs.readFileSync(path.join(raizModulo, "data", f), "utf8"));
// Suplementos de Arton (cache gerado por extrair-suplemento.mjs); sem o cache, as classes dele são puladas
const caminhoSup = path.join(aqui, ".cache/suplemento.json");
const sup = fs.existsSync(caminhoSup) ? JSON.parse(fs.readFileSync(caminhoSup, "utf8")) : null;
// poderes e classes definidos pelo próprio construtor (dados.js), na mesma ordem que o módulo monta:
// sistema, construtor (não exclusivos), suplemento (sem os substituídos), construtor exclusivos
const { poderesSubstitutos, classesDoConstrutor } = await import("../scripts/dados.js");
const poderesSup = (sup?.itens ?? []).filter((i) => i.type === "poder");
const doConstrutor = poderesSubstitutos({ ligado: !!sup, poderes: poderesSup });
const substituidos = new Set(doConstrutor.filter((p) => p.substituiSuplemento).map((p) => p.name));
const poderes = [
	...lerPack("poderes"),
	...doConstrutor.filter((p) => !p.exclusivo),
	...poderesSup.filter((p) => !substituidos.has(p.name)),
	...doConstrutor.filter((p) => p.exclusivo)
];
const classesSistema = lerPack("classes");
const dados = {
	poderes,
	poderesPorNome: new Map([...poderes].reverse().map((p) => [normalizar(p.name), p])),
	classes: [...classesSistema, ...(sup?.itens ?? []).filter((i) => i.type === "classe"), ...classesDoConstrutor(classesSistema)],
	// como em dados.js: magia do suplemento com o nome de uma do livro básico fica de fora
	magias: ((base) => [...base, ...(sup?.itens ?? []).filter((i) => i.type === "magia" && !base.some((b) => normalizar(b.name) === normalizar(i.name)))])(lerPack("magias")),
	racas: [...lerPack("racas"), ...(sup?.itens ?? []).filter((i) => i.type === "race")]
};
const progressao = json("progressao.json");
delete progressao._comentario;
const regrasClasses = json("classes.json");
// como em dados.js (comOpcoesDivindades): "opcoesDivindades" vira a lista dos deuses maiores
const opcoesDeuses = (json("divindades.json").divindades ?? []).map((d) => ({ valor: d.nome, nome: d.nome }));
const regrasPoderesClasse = Object.fromEntries(Object.entries(json("poderes-classe.json").poderes ?? {})
	.map(([k, r]) => [k, r?.opcoesDivindades ? { ...r, opcoes: opcoesDeuses } : r]));
const correcoes = json("pre-requisitos.json");
delete correcoes._comentario;
const lerPreRequisito = criarLeitorPreRequisitos(dados, correcoes);

let falhas = 0;
const conferir = (cond, msg) => {
	if (!cond) {
		falhas++;
		console.log(`  ✗ ${msg}`);
	}
	return cond;
};

/* ---------- 1. Pré-requisitos não reconhecidos ---------- */
const naoReconhecidos = [];
for (const p of poderes.filter((p) => ["classe", "geral"].includes(p.system?.tipo))) {
	const req = lerPreRequisito(p);
	if (req?.naoReconhecidos.length) naoReconhecidos.push(`${p.system.subtipo} · ${p.name}: ${req.naoReconhecidos.join(" | ")}`);
}
console.log(`Pré-requisitos não reconhecidos (viram aviso, não bloqueiam): ${naoReconhecidos.length}`);
for (const l of naoReconhecidos) console.log(`  · ${l}`);

/* ---------- 2. Cada classe de 1 a 20, gravando com aplicar-nivel.js ---------- */
const classes = args.filter((a) => !a.startsWith("-")).length ? args.filter((a) => !a.startsWith("-")) : Object.keys(progressao);

/**
 * Variações de personagem por classe: escolhas do 1º nível que mudam a progressão, escolas gravadas,
 * poderes preferidos (para exercitar concessões) e o total de magias novas esperado do 2º ao 20º.
 */
const VARIACOES = {
	Arcanista: [
		{ rotulo: "Bruxo", nivel1: ["Caminho do Arcanista: Bruxo"], magias: 19 },
		{ rotulo: "Feiticeiro (Rubra)", nivel1: ["Caminho do Arcanista: Feiticeiro", "Linhagem Rubra Básica"], magias: 9,
			preferir: ["Herança Aprimorada", "Herança Superior"], concede: ["Linhagem Rubra Aprimorada", "Linhagem Rubra Superior"] },
		{ rotulo: "Mago", nivel1: ["Caminho do Arcanista: Mago"], magias: 19 + 4, extraPorCirculo: [5, 9, 13, 17] }
	],
	Bardo: [
		{ rotulo: "escolas na ficha", flags: { escolasMagia: ["enc", "ilu", "adv"] }, magias: 10 },
		{ rotulo: "sem escolas na ficha", escolher: ["evo", "con", "nec"], magias: 10 }
	],
	Clérigo: [{ rotulo: "", magias: 19 }],
	Druida: [{ rotulo: "sem escolas na ficha", escolher: ["evo", "con", "trm"], magias: 10 }],
	// Suplementos de Arton
	Ermitão: [{ rotulo: "sem escolas na ficha", escolher: ["evo", "con", "trm"], magias: 10 }],
	Magimarcialista: [{ rotulo: "sem escolas na ficha", escolher: ["evo", "trm", "ilu"], magias: 10 }],
	Místico: [{ rotulo: "sem escolas na ficha", escolher: ["evo", "con", "trm"], magias: 10 }],
	Necromante: [{ rotulo: "", magias: 19 }],
	Frade: [{ rotulo: "", magias: 19 }],
	Usurpador: [{ rotulo: "Usurpar (magias automáticas)", automaticas: [5, 9, 13, 17] }],
	Atleta: [{ rotulo: "", formula: { "Casca Grossa": ["@nvl.lutador", "@nvl.atleta"] } }],
	// Dragão Brasil (definidas pelo construtor)
	Cruzado: [{ rotulo: "", magias: 19 }],
	Sentinela: [{ rotulo: "", magias: 19 }]
};
const SUPLEMENTO = new Set(["Treinador", "Alquimista", "Atleta", "Burguês", "Duelista", "Ermitão", "Inovador", "Machado de Pedra", "Magimarcialista",
	"Necromante", "Santo", "Seteiro", "Usurpador", "Vassalo", "Ventanista", "Frade", "Samurai", "Místico", "Miragem"]);

async function subirClasse(nomeClasse, variacao = {}) {
	const prog = progressaoDe(progressao, nomeClasse);
	const nomes1 = [...(prog.niveis?.["1"]?.habilidades ?? []), ...(variacao.nivel1 ?? [])];
	const docsNivel1 = nomes1.map((n) => dados.poderesPorNome.get(normalizar(n))).filter(Boolean);
	const titulo = `${nomeClasse}${variacao.rotulo ? ` (${variacao.rotulo})` : ""}`;
	conferir(docsNivel1.length === nomes1.length, `${titulo}: habilidade de 1º nível não encontrada`);
	conferir(dados.classes.some((c) => c.name === nomeClasse), `${nomeClasse}: classe não existe no compêndio`);
	const ator = novoAtor(nomeClasse, docsNivel1, variacao.flags ?? {});
	// a mesma subida numa ficha virtual (ficha-virtual.js): a ficha lida tem de ser igual em todo nível
	const sombra = virtualDe(ator);
	let virtualOk = conferir(leitura(sombra) === leitura(ator), `${nomeClasse}: a ficha virtual nasceu diferente do ator`);
	let escolasEscolhidas = null;
	let magiasNovas = 0;
	let magiasDePoderes = 0; // vagas dadas por poderes escolhidos (Conhecimento Mágico, Aumentar Repertório)
	const resumo = [];
	let desfazerTestado = false;

	for (let n = 2; n <= 21; n++) {
		const ficha = lerFicha(ator, { regrasClasses, variantes: variantesDe(progressao) });
		const r = montarNivel({ dados, progressao, ficha, classe: ficha.classes[0], lerPreRequisito, regrasPoderesClasse });
		if (r.magias && (variacao.automaticas ?? []).includes(n)) {
			conferir(r.magias.automaticas?.length > 0, `${titulo} ${n}: deveria receber as magias do círculo novo`);
			magiasNovas += r.magias.automaticas?.length ?? 0;
		}
		if (n === 21) {
			conferir(r.erro === "nivelMaximo", `${nomeClasse}: nível 21 deveria ser recusado`);
			break;
		}
		if (!conferir(!r.erro, `${nomeClasse} ${n}: ${r.erro}`)) break;
		r.avisos.forEach((a) => conferir(false, `${nomeClasse} ${n}: ${a}`));

		// escolhas automáticas: 1ª opção de cada escolha; terreno diferente a cada vez; 1º poder de classe
		// com pré-requisito; sem poder de classe disponível, um poder geral (como no jogo)
		const selecoes = {};
		for (const e of r.escolhas) selecoes[e.id] = e.opcoes[0].doc.uuid;
		for (const a of r.anotadas) selecoes[a.id] = a.opcoes[(n * 3) % a.opcoes.length];
		const disponiveis = r.poderesClasse.filter((o) => o.disponivel);
		const preferido = (variacao.preferir ?? []).map((nome) => disponiveis.find((o) => o.nome === nome)).find(Boolean);
		const poder = preferido ?? disponiveis.find((o) => o.preRequisito) ?? disponiveis[0] ?? r.poderesGerais.find((o) => o.disponivel && !o.repetivel) ?? null;

		// magias: escolas (uma vez, se a ficha não tiver) e uma magia que caiba em cada vaga
		const magias = [];
		if (r.magias) {
			if (r.magias.escolas && !r.magias.escolasFicha.length) {
				conferir(pendenciaNivel(r, { poder, selecoes, escolas: [] })?.includes("escolas"), `${titulo} ${n}: deveria pedir as escolas`);
				escolasEscolhidas = variacao.escolher;
			}
			const vagasNivel = vagasEfetivas(r.magias, selecoes, poder);
			const doPoder = vagasNivel.filter((v) => v.motivo && v.motivo === poder?.nome).length;
			if (poder?.magias && !r.magias.todas) conferir(doPoder === poder.magias.qtd, `${titulo} ${n}: ${poder.nome} deveria dar ${poder.magias.qtd} vagas de magia (deu ${doPoder})`);
			magiasDePoderes += doPoder;
			const lista = magiasDisponiveis(dados, { ...r.magias, tipos: tiposDasVagas(r.magias, vagasNivel) }, ficha, escolasEscolhidas);
			// vagas mais restritas primeiro (círculo exato, depois as só do tipo da classe); nas vagas do poder que
			// liberam outro tipo (Aumentar Repertório), escolhe de propósito uma magia desse outro tipo
			const restricao = (v) => (v.circulo ? 0 : 10) + (v.tipos?.length ?? 9);
			for (const vaga of [...vagasNivel].sort((a, b) => restricao(a) - restricao(b))) {
				// de preferência do maior círculo da vaga; se acabaram, de um círculo menor (como no jogo)
				const livres = lista.filter((x) => !magias.includes(x) && (vaga.circulo ? circuloDe(x) === vaga.circulo : circuloDe(x) <= vaga.ate) && (!vaga.tipos || vaga.tipos.includes(x.system.tipo)))
					.sort((a, b) => circuloDe(b) - circuloDe(a));
				const m = livres.find((x) => !r.magias.tipos.includes(x.system.tipo) && circuloDe(x) === (vaga.circulo ?? vaga.ate)) ?? livres[0];
				if (conferir(m, `${titulo} ${n}: nenhuma magia para a vaga ${JSON.stringify(vaga)}`)) magias.push(m);
			}
			const esc = r.magias.escolasFicha.length ? r.magias.escolasFicha : escolasEscolhidas;
			for (const m of magias) {
				conferir(tiposDasVagas(r.magias, vagasNivel).includes(m.system.tipo), `${titulo} ${n}: ${m.name} é de tipo ${m.system.tipo}`);
				if (r.magias.escolas) conferir(esc.includes(m.system.escola), `${titulo} ${n}: ${m.name} fora das escolas`);
			}
			if ((variacao.extraPorCirculo ?? []).includes(n)) conferir(r.magias.vagas.some((v) => v.circulo === r.magias.circuloNovo), `${titulo} ${n}: faltou a vaga extra do círculo novo`);
			if (r.magias.vagas.length) conferir(pendenciaNivel(r, { poder, selecoes, magias: [], escolas: escolasEscolhidas }), `${titulo} ${n}: deveria pedir magias`);
			magiasNovas += magias.length;
		}
		if (VERBOSO && r.ganhaPoder && !disponiveis.length) console.log(`  ${String(n).padStart(2)}: sem poder de ${nomeClasse} disponível; escolhe o geral ${poder?.nome}`);
		if (r.ganhaPoder) conferir(poder, `${nomeClasse} ${n}: nenhum poder disponível`);
		const tudo = { poder, selecoes, magias, escolas: escolasEscolhidas };
		conferir(!pendenciaNivel(r, tudo), `${titulo} ${n}: pendência com tudo escolhido: ${pendenciaNivel(r, tudo)}`);
		conferir(pendenciaNivel(r, { poder: null, selecoes: {} }) || (!r.ganhaPoder && !r.escolhas.length && !r.anotadas.length),
			`${nomeClasse} ${n}: deveria haver pendência sem escolhas`);

		const plano = montarPlano(r, { classeId: ficha.classes[0].id, poder, selecoes, magias, escolas: escolasEscolhidas, anotacao: poder?.repetivel ? "teste" : "" });
		const antes = fotografia(ator);
		await aplicarNivel(ator, plano);
		await aplicarNivel(sombra, plano);
		conferir(ator.nivel === n, `${nomeClasse} ${n}: nível ficou ${ator.nivel}`);

		// desfazer no nível com mais coisas (escolha, anotação ou valor gravado) e reaplicar
		if (!desfazerTestado && (r.escolhas.length || r.anotadas.some((a) => a.jaTem) || plano.valores.length || plano.escolasMagia || n === 10)) {
			conferir(podeDesfazer(ator), `${nomeClasse} ${n}: deveria poder desfazer`);
			await desfazerUltimoNivel(ator);
			await desfazerUltimoNivel(sombra);
			conferir(fotografia(ator) === antes, `${nomeClasse} ${n}: desfazer não restaurou a ficha`);
			conferir(!podeDesfazer(ator), `${nomeClasse} ${n}: não deveria desfazer duas vezes`);
			if (virtualOk) virtualOk = conferir(leitura(sombra) === leitura(ator), `${titulo} ${n}: depois de desfazer, a ficha virtual ficou diferente do ator`);
			await aplicarNivel(ator, plano);
			await aplicarNivel(sombra, plano);
			desfazerTestado = n;
		}

		const extras = [
			...r.habilidades.map((h) => h.nome + (h.valor ? ` ${h.valor}` : "")),
			...r.escolhas.map((e) => `[${e.titulo}: ${e.opcoes[0].nome}]`),
			...r.anotadas.map((a) => `[${a.habilidade}: ${selecoes[a.id]}${a.jaTem ? " (anota)" : ""}]`),
			...r.valores.map((v) => `${v.nome} ${v.de ?? ""}→${v.para}${v.modo ? ` (${v.modo})` : ""}`)
		];
		if (VERBOSO) console.log(`  ${String(n).padStart(2)}: ${extras.join(", ") || "—"} | poderes ${disponiveis.length}/${r.poderesClasse.length} | ${poder?.nome ?? "—"}`);
		resumo.push(...extras.filter((e) => !/→/.test(e)));
		// só a primeira diferença (as seguintes são consequência)
		if (virtualOk) virtualOk = conferir(leitura(sombra) === leitura(ator), `${titulo} ${n}: a ficha virtual ficou diferente do ator\n      ator:    ${leitura(ator).slice(0, 400)}\n      virtual: ${leitura(sombra).slice(0, 400)}`);
	}

	// conferências do estado final
	const poderesFicha = ator.items.filter((i) => i.type === "poder");
	const contagem = new Map();
	for (const p of poderesFicha) contagem.set(nomeBase(p.name), (contagem.get(nomeBase(p.name)) ?? 0) + 1);
	for (const [nome, qtd] of contagem) {
		const doc = dados.poderesPorNome.get(normalizar(nome));
		const repetivel = podeRepetir(doc?.system?.description?.value);
		conferir(qtd === 1 || repetivel, `${nomeClasse}: ${nome} aparece ${qtd} vezes`);
	}
	// magias: prefixo do nível em que entraram ("5 - Bola de Fogo") e nenhuma repetida (a ficha lê o nome sem prefixo)
	const magiasFicha = ator.items.filter((i) => i.type === "magia");
	for (const m of magiasFicha) {
		const nivel = m.flags?.[MODULE_ID]?.nivel;
		if (nivel) conferir(m.name === `${nivel} - ${nomeBase(m.name)}`, `${titulo}: magia sem o prefixo do nível: ${m.name}`);
	}
	const nomesMagias = magiasFicha.map((m) => nomeBase(m.name));
	conferir(new Set(nomesMagias).size === nomesMagias.length, `${titulo}: magia repetida na ficha: ${nomesMagias.filter((n, i) => nomesMagias.indexOf(n) !== i).join(", ")}`);
	for (const [nome, modo] of Object.entries(prog.valoresNaFicha ?? {})) {
		let ultimo = null;
		for (let n = 1; n <= 20; n++) ultimo = prog.niveis?.[n]?.valores?.[nome] ?? ultimo;
		const item = poderesFicha.find((p) => normalizar(nomeBase(p.name)) === normalizar(nome));
		if (!conferir(item, `${nomeClasse}: ${nome} não está na ficha`)) continue;
		if (modo === "rolagem") {
			const formula = item.toObject().system.rolls?.[0]?.parts?.[0]?.[0];
			conferir(formula === ultimo.replace(/^\+/, ""), `${nomeClasse}: rolagem de ${nome} (dados de origem) = ${formula}, esperado ${ultimo}`);
			const comRoll = item.effects.filter((e) => (e.system?.changes ?? []).some((c) => c.value === "roll"));
			conferir(comRoll.every((e) => e.origin === item.uuid), `${nomeClasse}: efeito de ${nome} não aponta para o próprio item (origin ${comRoll.map((e) => e.origin).join(", ")})`);
		}
		if (modo === "anotacao") conferir(item.system.description.value.includes(`(20º nível):</strong> ${ultimo}`) || item.system.description.value.includes(`</strong> ${ultimo}</p>`), `${nomeClasse}: anotação de ${nome} não tem ${ultimo}`);
	}
	for (const nivel of Object.values(prog.niveis ?? {})) {
		for (const a of nivel.anotadas ?? []) {
			const item = poderesFicha.find((p) => normalizar(nomeBase(p.name)) === normalizar(a.habilidade));
			const vezes = Object.values(prog.niveis).filter((x) => x.anotadas?.some((y) => y.habilidade === a.habilidade)).length;
			const anotacoes = (item?.system.description.value.match(/Escolha \(\d+º nível\)/g) ?? []).length;
			conferir(anotacoes === vezes, `${nomeClasse}: ${a.habilidade} tem ${anotacoes} anotações, esperado ${vezes}`);
			break;
		}
	}
	// magias e concessões
	if (variacao.magias !== undefined) {
		const naFicha = ator.items.filter((i) => i.type === "magia");
		const esperadas = variacao.magias + magiasDePoderes;
		conferir(magiasNovas === esperadas && naFicha.length === esperadas, `${titulo}: ${naFicha.length} magias na ficha (${magiasNovas} escolhidas), esperado ${esperadas} (${magiasDePoderes} de poderes)`);
		conferir(new Set(naFicha.map((m) => m.name)).size === naFicha.length, `${titulo}: magia repetida na ficha`);
		const maxCirculo = Math.max(0, ...naFicha.map((m) => circuloDe(m)));
		const esperado = Math.max(...Object.values(prog.magias.circulos));
		conferir(maxCirculo === esperado, `${titulo}: maior círculo na ficha ${maxCirculo}, esperado ${esperado}`);
		if (variacao.escolher) conferir(JSON.stringify(ator.flags["t20-construtor-ficha"].escolasMagia) === JSON.stringify(variacao.escolher), `${titulo}: escolas não gravadas na ficha`);
	}
	for (const [nome, [errado, certo]] of Object.entries(variacao.formula ?? {})) {
		const item = ator.items.find((i) => normalizar(nomeBase(i.name)) === normalizar(nome));
		const valores = (item?.effects ?? []).flatMap((e) => [...(e.changes ?? []), ...(e.system?.changes ?? [])]).map((c) => String(c.value));
		conferir(item && !valores.some((v) => v.includes(errado)) && valores.some((v) => v.includes(certo)), `${titulo}: fórmula de ${nome} não corrigida (${valores.join(" | ")})`);
	}
	if (variacao.automaticas) {
		const naFicha = ator.items.filter((i) => i.type === "magia").length;
		conferir(naFicha === magiasNovas && naFicha > 0, `${titulo}: ${naFicha} magias na ficha, esperado ${magiasNovas} (automáticas)`);
	}
	for (const nome of variacao.concede ?? []) {
		conferir(ator.items.some((i) => normalizar(nomeBase(i.name)) === normalizar(nome)), `${titulo}: ${nome} não foi concedida`);
	}
	const pvOk = ator.system.attributes.pv.value === ator.system.attributes.pv.max;
	conferir(pvOk, `${nomeClasse}: PV atual ${ator.system.attributes.pv.value} ≠ máximo ${ator.system.attributes.pv.max}`);
	const qtdMagias = ator.items.filter((i) => i.type === "magia").length;
	console.log(`${titulo}: 1→20 ok${virtualOk ? " (ficha virtual igual)" : ""} · ${poderesFicha.length} poderes${qtdMagias ? ` · ${qtdMagias} magias novas` : ""} · desfazer testado no nível ${desfazerTestado || "—"}${resumo.length ? `\n    ganhos: ${resumo.join(", ")}` : ""}`);
}

console.log("");
for (const c of classes) {
	if (SUPLEMENTO.has(c) && !sup) {
		console.log(`${c}: pulada (sem o cache do Suplementos de Arton; rode ferramentas/extrair-suplemento.mjs)`);
		continue;
	}
	for (const v of VARIACOES[c] ?? [{}]) await subirClasse(c, v);
}

/* ---------- 3. Casos de pré-requisito conhecidos ---------- */
{
	console.log("\nCasos de pré-requisito:");
	const casoDe = (nomeClasse) => (nomePoder, mutar, esperado) => {
		if (!classes.includes(nomeClasse)) return;
		const doc = dados.poderesPorNome.get(normalizar(nomePoder));
		const a = novoAtor(nomeClasse, []);
		mutar(a);
		const ficha = lerFicha(a, { regrasClasses, variantes: variantesDe(progressao) });
		const r = montarNivel({ dados, progressao, ficha, classe: ficha.classes[0], lerPreRequisito });
		const op = [...r.poderesClasse, ...r.poderesGerais].find((o) => o.doc === doc);
		if (conferir(op?.disponivel === esperado, `${nomePoder}: esperado ${esperado ? "disponível" : "bloqueado"}, veio ${op?.disponivel} (${op?.motivo ?? "sem motivo"})`)) {
			console.log(`  ✓ ${nomeClasse} · ${nomePoder} ${esperado ? "disponível" : `bloqueado — ${op.motivo}`}`);
		}
	};
	const caso = casoDe("Guerreiro");
	const classe = (a) => a.items.find((i) => i.type === "classe");
	const poderNaFicha = (a, nome) => a.items.push(novoItem({ type: "poder", name: nome, system: {} }));
	caso("Ambidestria (Guerreiro)", (a) => (a.system.atributos.des.value = 1), false);
	caso("Ambidestria (Guerreiro)", (a) => (a.system.atributos.des.value = 2), true);
	caso("Golpe Pessoal", (a) => (classe(a).system.niveis = 3), false);
	caso("Golpe Pessoal", (a) => (classe(a).system.niveis = 4), true); // atinge o 5º neste nível
	caso("Planejamento Marcial", (a) => (classe(a).system.niveis = 9), true);
	caso("Planejamento Marcial", (a) => { classe(a).system.niveis = 9; delete a.system.pericias.guer; }, false);
	caso("Mestre em Arma", (a) => (classe(a).system.niveis = 11), false);
	caso("Mestre em Arma", (a) => { classe(a).system.niveis = 11; poderNaFicha(a, "3 - Especialização em Arma"); }, true);
	caso("Especialização em Arma", (a) => poderNaFicha(a, "2 - Especialização em Arma"), true); // repetível
	caso("Bater e Correr", (a) => poderNaFicha(a, "2 - Bater e Correr"), false); // já tem
	caso("Encouraçado", () => {}, true); // proficiência com armaduras pesadas (classes.json)
	caso("Fanático", (a) => (classe(a).system.niveis = 11), false);

	const cacador = casoDe("Caçador");
	cacador("Armadilheiro", (a) => (classe(a).system.niveis = 5), false);
	cacador("Armadilheiro", (a) => { classe(a).system.niveis = 5; poderNaFicha(a, "3 - Armadilha: Laço"); }, true);
	cacador("Armadilheiro", (a) => { classe(a).system.niveis = 3; poderNaFicha(a, "3 - Armadilha: Laço"); }, false);
	const cavaleiro = casoDe("Cavaleiro");
	cavaleiro("Montaria Corajosa", (a) => (classe(a).system.niveis = 6), false);
	cavaleiro("Montaria Corajosa", (a) => { classe(a).system.niveis = 6; poderNaFicha(a, "5 - Caminho do Cavaleiro: Montaria"); }, true);
	cavaleiro("Montaria Corajosa", (a) => { classe(a).system.niveis = 6; poderNaFicha(a, "5 - Caminho do Cavaleiro: Bastião"); }, false);
	const paladino = casoDe("Paladino");
	paladino("Arma Sagrada", () => {}, false);
	paladino("Arma Sagrada", (a) => (a.system.detalhes = { divindade: "Khalmyr" }), true);
	paladino("Arma Sagrada", (a) => (a.system.detalhes = { divindade: "Lena (fundamentalista)" }), false);
	paladino("Arma Sagrada", (a) => (a.system.detalhes = { divindade: "Marah" }), false);
	paladino("Escudo Fraterno", (a) => (classe(a).system.niveis = 6), false); // "Égide Sagrada" = Bênção da Justiça: Égide Sagrada
	paladino("Escudo Fraterno", (a) => { classe(a).system.niveis = 6; poderNaFicha(a, "5 - Bênção da Justiça: Égide Sagrada"); }, true);
	if (sup) {
		const lutador = casoDe("Lutador");
		lutador("Mestre das Combinações", (a) => { classe(a).system.niveis = 9; poderNaFicha(a, "2 - Combinação: Chute Circular"); }, false);
		lutador("Mestre das Combinações", (a) => { classe(a).system.niveis = 9; poderNaFicha(a, "2 - Combinação: Chute Circular"); poderNaFicha(a, "3 - Combinação: Gancho"); }, true);
		const druida = casoDe("Druida");
		druida("Forma Esquelética", (a) => { classe(a).system.niveis = 9; a.system.detalhes = { divindade: "Allihanna" }; }, false);
		druida("Forma Esquelética", (a) => { classe(a).system.niveis = 9; a.system.detalhes = { divindade: "Tenebra" }; poderNaFicha(a, "2 - Forma Selvagem"); }, true);
		druida("Xamã Místico", (a) => poderNaFicha(a, "1 - Forma Selvagem"), false);
		const bardo = casoDe("Bardo");
		bardo("Música: Réquiem Sombrio", (a) => (a.flags["t20-construtor-ficha"].escolasMagia = ["enc", "ilu", "adv"]), false);
		bardo("Música: Réquiem Sombrio", (a) => (a.flags["t20-construtor-ficha"].escolasMagia = ["enc", "nec", "adv"]), true);
		// a variante conta como a classe básica: Ventanista 5 atende "5º nível de ladino"
		const ventanista = casoDe("Ventanista");
		const comPreNivelLadino = dados.poderes.find((p) => p.system?.subtipo === "Ladino" && /\d+º nível de ladino/i.test(p.system?.description?.value ?? "") && !/\b(treinado|For|Des|Con|Int|Sab|Car)\b/.test(p.system.description.value.match(/Pr[ée]-requisitos?:([^.]*)/)?.[1] ?? "x"));
		if (comPreNivelLadino) {
			const min = Number(comPreNivelLadino.system.description.value.match(/(\d+)º nível de ladino/i)[1]);
			ventanista(comPreNivelLadino.name, (a) => (classe(a).system.niveis = min - 2), false);
			ventanista(comPreNivelLadino.name, (a) => (classe(a).system.niveis = min - 1), true);
		}
	}
}

/* ---------- 4. Multiclasse ---------- */
{
	console.log("\nMulticlasse:");
	const variantes = variantesDe(progressao);
	const doc = (nome) => dados.poderesPorNome.get(normalizar(nome));
	const docClasse = (nome) => dados.classes.find((c) => c.name === nome);
	/** Ator com uma classe já no nível n (habilidades de 1º nível + extras). */
	const atorEm = (classe, n, extras = []) => {
		const prog = progressaoDe(progressao, classe);
		const nomes = [...(prog.niveis?.["1"]?.habilidades ?? []).filter((h) => typeof h === "string"), ...extras];
		const a = novoAtor(classe, nomes.map(doc).filter(Boolean));
		a.items.find((i) => i.type === "classe").system.niveis = n;
		a.reset();
		a.system.attributes.pv.value = a.system.attributes.pv.max;
		a.system.attributes.pm.value = a.system.attributes.pm.max;
		return a;
	};
	const calcular = (a, classe) => {
		const ficha = lerFicha(a, { regrasClasses, variantes });
		return { ficha, r: montarNivel({ dados, progressao, ficha, classe, lerPreRequisito, regrasPoderesClasse, regrasClasses }) };
	};
	const nova = (nome) => ({ nome, niveis: 0, nova: true, doc: docClasse(nome) });
	const ok = (cond, msg) => { if (conferir(cond, msg)) console.log(`  ✓ ${msg}`); };

	// A. Arcanista (Bruxo) 3 → Paladino 1
	{
		const a = atorEm("Arcanista", 3, ["Caminho do Arcanista: Bruxo"]);
		const fichaA = lerFicha(a, { regrasClasses, variantes });
		const op = classesParaSubir(dados, progressao, fichaA, variantes);
		ok(op.novas.some((c) => c.nome === "Paladino" && !c.bloqueio), "Arcanista pode começar Paladino");
		if (sup) ok(op.novas.find((c) => c.nome === "Necromante")?.bloqueio, "Arcanista não pode começar Necromante (variante)");
		const { r } = calcular(a, nova("Paladino"));
		ok(r.nivelClasse === 1 && r.nivelPersonagem === 4 && !r.ganhaPoder, "Paladino 1 = personagem 4, sem poder de classe");
		ok(["Abençoado", "Código do Herói", "Golpe Divino"].every((n) => r.habilidades.some((h) => h.nome === n)), "habilidades de 1º nível do paladino");
		ok(r.notas.some((t) => /perícias treinadas nem as proficiências/.test(t)) && r.notas.some((t) => /devotos/.test(t)), "avisos de multiclasse e de devoção");
		const antes = fotografia(a);
		await aplicarNivel(a, montarPlano(r, { classeId: null }));
		const pal = a.items.find((i) => i.type === "classe" && i.name === "Paladino");
		ok(pal && pal.system.niveis === 1 && pal.system.inicial === false && a.nivel === 4, "classe nova com 1 nível, não inicial");
		ok(a.items.some((i) => i.name === "4 - Golpe Divino") && a.system.attributes.nivel.value === 4, "habilidades com prefixo do nível e nível do personagem atualizado");
		await desfazerUltimoNivel(a);
		ok(fotografia(a) === antes && !a.items.some((i) => i.name === "Paladino"), "desfazer remove a classe nova e restaura a ficha");
	}

	// B. Guerreiro 5 → Clérigo 1 → Clérigo 2
	{
		const a = atorEm("Guerreiro", 5);
		a.system.detalhes = { divindade: "Khalmyr" };
		let { ficha, r } = calcular(a, nova("Clérigo"));
		ok(r.magias && r.magias.vagas.length === 3 && r.magias.circulo === 1 && r.magias.atributo === "sab", "Clérigo 1: 3 magias iniciais de 1º círculo, atributo Sab");
		ok(!r.notas.some((t) => /devotos/.test(t)), "sem aviso de devoção (ficha já é devota)");
		const lista = magiasDisponiveis(dados, r.magias, ficha);
		const escolhidas = lista.filter((m) => circuloDe(m) === 1).slice(0, 3);
		ok(!pendenciaNivel(r, { magias: escolhidas }), "sem pendência com as 3 magias");
		await aplicarNivel(a, montarPlano(r, { classeId: null, magias: escolhidas }));
		const naFicha = a.items.filter((i) => i.type === "magia");
		ok(naFicha.length === 3 && naFicha.every((m) => !m.system.resistencia || m.system.resistencia.atributo === "sab"), "magias gravadas com o atributo Sab");
		const cle = a.items.find((i) => i.type === "classe" && i.name === "Clérigo");
		({ ficha, r } = calcular(a, { nome: "Clérigo", niveis: cle.system.niveis, id: cle.id }));
		ok(r.nivelClasse === 2 && r.nivelPersonagem === 7 && r.magias.vagas.length === 1 && r.magias.circulo === 1, "Clérigo 2 (personagem 7): 1 magia de 1º círculo (círculo pelo nível de classe)");
		ok(r.poderesClasse.length > 0 && r.poderesClasse.every((o) => o.doc.system.subtipo === "Clérigo" || o.doc.system.subtipo === "Clerigo"), "poderes de clérigo no 2º nível de clérigo");
	}

	// C. Guerreiro 2 → Arcanista 1: Caminho, Linhagem só para Feiticeiro, Mago com 4 magias
	{
		const a = atorEm("Guerreiro", 2);
		const { r } = calcular(a, nova("Arcanista"));
		const caminho = r.escolhas.find((e) => e.id === "caminho");
		const linhagem = r.escolhas.find((e) => e.id === "linhagem");
		const uuid = (nome) => caminho.opcoes.find((o) => o.nome === nome).doc.uuid;
		ok(caminho && linhagem && !escolhaAtiva(linhagem, { caminho: uuid("Caminho do Arcanista: Mago") }) && escolhaAtiva(linhagem, { caminho: uuid("Caminho do Arcanista: Feiticeiro") }), "Linhagem só vale para o Feiticeiro");
		const mago = { caminho: uuid("Caminho do Arcanista: Mago") };
		ok(vagasEfetivas(r.magias, mago).length === 4 && atributoEfetivo(r.magias, mago) === "int", "Mago: 4 magias iniciais, atributo Int");
		const feit = { caminho: uuid("Caminho do Arcanista: Feiticeiro") };
		ok(vagasEfetivas(r.magias, feit).length === 3 && atributoEfetivo(r.magias, feit) === "car", "Feiticeiro: 3 magias iniciais, atributo Car");
		ok(/Linhagem/.test(pendenciaNivel(r, { selecoes: feit, magias: [] }) ?? ""), "Feiticeiro sem linhagem fica pendente");
	}

	// D. Guerreiro 3 → Bardo 1: escolas por classe
	{
		const a = atorEm("Guerreiro", 3);
		const { ficha, r } = calcular(a, nova("Bardo"));
		ok(r.magias.escolas === 3 && !r.magias.escolasFicha.length, "Bardo novo pede as 3 escolas");
		const escolas = ["enc", "ilu", "adv"];
		const mags = magiasDisponiveis(dados, r.magias, ficha, escolas).filter((m) => circuloDe(m) === 1).slice(0, 2);
		ok(!pendenciaNivel(r, { magias: mags, escolas }), "sem pendência com escolas e 2 magias");
		const antes = fotografia(a);
		await aplicarNivel(a, montarPlano(r, { classeId: null, magias: mags, escolas }));
		const fl = a.flags["t20-construtor-ficha"];
		ok(JSON.stringify(fl.escolasMagiaPorClasse?.Bardo) === JSON.stringify(escolas) && !fl.escolasMagia, "escolas gravadas por classe (não como as da classe inicial)");
		ok(a.items.filter((i) => i.type === "magia").every((m) => !m.system.resistencia || m.system.resistencia.atributo === "car"), "magias do bardo com Car");
		await desfazerUltimoNivel(a);
		ok(fotografia(a) === antes && !a.flags["t20-construtor-ficha"].escolasMagiaPorClasse?.Bardo, "desfazer apaga as escolas do bardo");
	}

	// E. básica × variante
	if (sup) {
		const ladino = lerFicha(atorEm("Ladino", 2), { regrasClasses, variantes });
		ok(classesParaSubir(dados, progressao, ladino, variantes).novas.find((c) => c.nome === "Ventanista")?.bloqueio, "Ladino não pode começar Ventanista");
		const vent = lerFicha(atorEm("Ventanista", 2), { regrasClasses, variantes });
		const opV = classesParaSubir(dados, progressao, vent, variantes);
		ok(opV.novas.find((c) => c.nome === "Ladino")?.bloqueio && !opV.novas.find((c) => c.nome === "Ermitão")?.bloqueio, "Ventanista não pode começar Ladino, mas pode Ermitão");
	}

	// F. poderes que ensinam magias ao serem escolhidos (Conhecimento Mágico, Aumentar Repertório)
	{
		// Feiticeiro 3 → 4: nível par, sem magia nova; Conhecimento Mágico dá 2 magias mesmo assim
		const a = atorEm("Arcanista", 3, ["Caminho do Arcanista: Feiticeiro", "Linhagem Rubra Básica"]);
		const { ficha, r } = calcular(a, { nome: "Arcanista", niveis: 3, id: a.items.find((i) => i.type === "classe").id });
		const cm = r.poderesClasse.find((o) => o.nome === "Conhecimento Mágico (Arcanista)");
		const outro = r.poderesClasse.find((o) => o.disponivel && !o.magias);
		ok(r.magias && r.magias.vagas.length === 0 && cm?.disponivel && cm.magias?.qtd === 2, "Feiticeiro 4: sem magia do nível; Conhecimento Mágico disponível e ensina 2");
		const vagas = vagasEfetivas(r.magias, {}, cm);
		ok(vagas.length === 2 && vagas.every((v) => v.ate === r.magias.circulo && v.motivo === cm.nome), "Conhecimento Mágico: 2 vagas de até o maior círculo que lança");
		ok(/Conhecimento Mágico/.test(pendenciaNivel(r, { poder: cm, magias: [] }) ?? ""), "sem as 2 magias, o nível fica pendente");
		const duas = magiasDisponiveis(dados, r.magias, ficha).slice(0, 2);
		ok(!pendenciaNivel(r, { poder: cm, magias: duas }) && montarPlano(r, { classeId: "x", poder: cm, magias: duas }).magias.length === 2, "com as 2 magias, sem pendência e as 2 no plano");
		ok(/desmarcar 2/.test(pendenciaNivel(r, { poder: outro, magias: duas }) ?? ""), "trocar por outro poder tira as vagas (magias a mais ficam pendentes)");
		// Aumentar Repertório: as magias do poder podem ser arcanas ou divinas; a da classe continua arcana
		const ar = dados.poderesPorNome.get(normalizar("Aumentar Repertório"));
		ok(JSON.stringify(magiasDoPoder(ar)) === JSON.stringify({ qtd: 2, tipos: ["arc", "div", "uni"] }), "Aumentar Repertório: 2 magias, arcanas ou divinas");
		const arc = dados.magias.find((m) => m.system.tipo === "arc" && circuloDe(m) === 1);
		const div = dados.magias.find((m) => m.system.tipo === "div" && circuloDe(m) === 1);
		const daClasse = { ate: 1, tipos: ["arc", "uni"] };
		const doPoder = { ate: 1, tipos: ["arc", "div", "uni"], motivo: "Aumentar Repertório" };
		ok(conferirVagas([doPoder, daClasse], [arc, div]).ok, "a arcana vai para a vaga da classe e a divina para a do poder (em qualquer ordem)");
		ok(!conferirVagas([daClasse, daClasse], [arc, div]).ok, "divina não entra na vaga da classe arcana");

		// repetíveis: "quantas vezes quiser" sempre disponível; "duas vezes" com limite
		const desc = (nome) => dados.poderesPorNome.get(normalizar(nome))?.system?.description?.value;
		ok(podeRepetir(desc("Conhecimento Mágico (Arcanista)")) && podeRepetir(desc("Aumentar Repertório")) && !limiteRepeticoes(desc("Aumentar Repertório")), "Conhecimento Mágico e Aumentar Repertório: repetíveis, sem limite");
		ok(podeRepetir("<p>Voc&ecirc; pode escolher este poder v&aacute;rias vezes.</p>") && limiteRepeticoes("Você pode escolher este poder duas vezes, para um item") === 2
			&& limiteRepeticoes("Você pode escolher este poder até três vezes para conceitos diferentes") === 3 && !podeRepetir("Você recebe +2 em Luta."), "frases de repetição (com entidades HTML) e limites de 2 e 3 vezes");
		const a2 = atorEm("Arcanista", 3, ["Caminho do Arcanista: Feiticeiro", "Linhagem Rubra Básica", "Conhecimento Mágico (Arcanista)", "Conhecimento Mágico (Arcanista)"]);
		const { r: r2 } = calcular(a2, { nome: "Arcanista", niveis: 3, id: a2.items.find((i) => i.type === "classe").id });
		const cm2 = r2.poderesClasse.find((o) => o.nome === "Conhecimento Mágico (Arcanista)");
		ok(cm2?.jaTem && cm2.disponivel && vagasEfetivas(r2.magias, {}, cm2).length === 2, "ficha com Conhecimento Mágico 2 vezes: continua disponível e dá mais 2 magias");
		ok(cm2.magias.livres > 2 && vagasEfetivas(r2.magias, {}, { ...cm2, magias: { ...cm2.magias, livres: 1 } }).length === 1
			&& vagasEfetivas(r2.magias, {}, { ...cm2, magias: { ...cm2.magias, livres: 0 } }).length === 0, "com só 1 (ou 0) magia para aprender, o poder abre 1 (ou 0) vaga: o nível não trava");
	}
}

/* ---------- 5. A janela de subir de nível, nível a nível ---------- */
/**
 * O ator simulado sobe de nível pela própria janela (SubirNivel), acionando as ações dos botões com as
 * mesmas escolhas do teste 2. O contexto de cada passo de cada nível vira um resumo (sha1) guardado em
 * ferramentas/retratos/subir-nivel.json: uma refatoração da janela não pode mudar nenhum.
 * --atualizar grava o retrato; --telas=arquivo.json grava os contextos completos (para comparar à mão).
 */
{
	console.log("\nJanela de subir de nível:");
	// ids dos itens simulados a partir de um número fixo: o retrato não depende de quais classes rodaram antes
	proximoId = 100000;
	const { createHash } = await import("node:crypto");
	const ATUALIZAR = args.includes("--atualizar");
	const ARQ_TELAS = args.find((a) => a.startsWith("--telas="))?.slice(8) ?? null;
	// T20.js mexe no CONFIG ao ser importado: um CONFIG que aceita qualquer caminho (como no testar-construtor)
	const automatico = () => new Proxy(function () {}, {
		get(t, k) {
			if (k === Symbol.toPrimitive) return () => "";
			if (!(k in t)) t[k] = automatico();
			return t[k];
		},
		apply() { return automatico(); }
	});
	globalThis.CONFIG = automatico();
	const { T20 } = await import(path.join(raizSistema, "module/config/T20.js"));
	globalThis.CONFIG = { T20 };
	const avisos = [];
	globalThis.ui = { notifications: { info() {}, warn: (m) => avisos.push(m), error: (m) => avisos.push(m) } };
	Object.assign(globalThis.game, { i18n: { localize: (k) => k }, packs: { get: () => null } });
	class ApplicationV2 {
		constructor(options = {}) { this.options = options; this.rendered = false; }
		render() { return this; }
		close() { return this; }
	}
	Object.assign(globalThis.foundry, {
		applications: {
			api: { ApplicationV2, HandlebarsApplicationMixin: (B) => B, DialogV2: { confirm: async () => true } },
			ux: { TextEditor: { implementation: { enrichHTML: async (h) => h } } },
			instances: new Map()
		}
	});
	const { SubirNivel } = await import("../scripts/subir-nivel.js");
	const acoes = SubirNivel.DEFAULT_OPTIONS.actions;
	const acionar = (win, acao, dataset = {}) => acoes[acao].call(win, null, { dataset });

	// textos longos (descrições) entram só pelo tamanho e um pedaço do hash: o retrato fica pequeno e estável
	const compactar = (x) => {
		if (typeof x === "string") return x.length > 160 ? `#${createHash("sha1").update(x).digest("hex").slice(0, 10)}:${x.length}` : x;
		if (Array.isArray(x)) return x.map(compactar);
		if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, compactar(v)]));
		return x;
	};
	const contextos = {};
	const retrato = {};
	const guardar = async (win, chave) => {
		const ctx = compactar(await win._prepareContext());
		const texto = JSON.stringify(ctx);
		retrato[chave] = createHash("sha1").update(texto).digest("hex").slice(0, 16);
		if (ARQ_TELAS) contextos[chave] = ctx;
		return ctx;
	};

	const CENARIOS_TELA = [
		{ classe: "Guerreiro", ate: 20 },
		{ classe: "Cavaleiro", ate: 8 },
		{ classe: "Caçador", ate: 8 },
		{ classe: "Arcanista", nivel1: ["Caminho do Arcanista: Mago"], ate: 10 },
		{ classe: "Bardo", escolher: ["evo", "con", "nec"], ate: 6 },
		{ classe: "Clérigo", preferir: ["Conhecimento Mágico (Clérigo)"], ate: 6 },
		{ classe: "Guerreiro", rotulo: "multiclasse Arcanista no 4º", multiclasse: { nivel: 4, classe: "Arcanista" }, ate: 6 }
	];
	for (const c of CENARIOS_TELA) {
		const titulo = `${c.classe}${c.rotulo ? ` (${c.rotulo})` : c.nivel1 ? ` (${c.nivel1.join(", ")})` : ""}`;
		const prog = progressaoDe(progressao, c.classe);
		const docs1 = [...(prog.niveis?.["1"]?.habilidades ?? []), ...(c.nivel1 ?? [])].map((n) => dados.poderesPorNome.get(normalizar(n))).filter(Boolean);
		const ator = Object.assign(novoAtor(c.classe, docs1), { id: `tela${normalizar(titulo).replace(/\W/g, "")}`, name: titulo, type: "character" });
		const win = new SubirNivel(ator);
		Object.assign(win, {
			dados: { ...dados, regrasClasses, regrasPoderesClasse, variantes: {}, escolas: {} },
			progressao, lerPreRequisito
		});
		let escolas = null;
		const inicio = avisos.length;
		for (let n = 2; n <= c.ate; n++) {
			const k = (passo) => `${titulo} | ${n} | ${passo}`;
			await guardar(win, k("classe"));
			// a mesma conta da janela, de fora, para decidir as escolhas como no teste 2
			const ficha = lerFicha(ator, { regrasClasses, variantes: variantesDe(progressao) });
			let classe = ficha.classes[0];
			if (c.multiclasse?.nivel === n) {
				acionar(win, "escolherClasse", { valor: `nova:${c.multiclasse.classe}` });
				await guardar(win, k("classe nova"));
				classe = { nome: c.multiclasse.classe, niveis: 0, nova: true, doc: dados.classes.find((x) => x.name === c.multiclasse.classe) };
			}
			const r = montarNivel({ dados, progressao, ficha, classe, lerPreRequisito, regrasPoderesClasse, regrasClasses });
			if (!conferir(!r.erro, `janela ${titulo} ${n}: ${r.erro}`)) break;

			acionar(win, "avancar");
			let ctx = await guardar(win, k("nivel"));
			conferir(ctx.passo === "nivel", `janela ${titulo} ${n}: avançar deveria ir para Nível (foi ${ctx.passo})`);
			const selecoes = {};
			for (const e of r.escolhas) {
				selecoes[e.id] = e.opcoes[0].doc.uuid;
				acionar(win, "selecionar", { id: e.id, valor: selecoes[e.id] });
			}
			for (const a of r.anotadas) {
				selecoes[a.id] = a.opcoes[(n * 3) % a.opcoes.length];
				acionar(win, "selecionar", { id: a.id, valor: selecoes[a.id] });
			}
			if (r.escolhas.length || r.anotadas.length) await guardar(win, k("nivel escolhido"));

			let poder = null;
			if (r.ganhaPoder) {
				acionar(win, "avancar");
				ctx = await guardar(win, k("poder"));
				acionar(win, "aba", { aba: "geral" });
				await guardar(win, k("poder geral"));
				acionar(win, "indisponiveis");
				await guardar(win, k("poder geral indisponíveis"));
				acionar(win, "indisponiveis");
				acionar(win, "aba", { aba: "classe" });
				const disponiveis = r.poderesClasse.filter((o) => o.disponivel);
				const preferido = (c.preferir ?? []).map((nome) => disponiveis.find((o) => o.nome === nome)).find(Boolean);
				poder = preferido ?? disponiveis.find((o) => o.preRequisito) ?? disponiveis[0] ?? r.poderesGerais.find((o) => o.disponivel && !o.repetivel) ?? null;
				if (poder && !disponiveis.includes(poder)) acionar(win, "aba", { aba: "geral" });
				if (poder) acionar(win, "escolher", { uuid: poder.doc.uuid });
				await guardar(win, k("poder escolhido"));
			}

			const vagas = r.magias ? vagasEfetivas(r.magias, selecoes, poder) : [];
			if (r.magias && (vagas.length || (r.magias.escolas && !r.magias.escolasFicha.length))) {
				acionar(win, "avancar");
				ctx = await guardar(win, k("magias"));
				conferir(ctx.passo === "magias", `janela ${titulo} ${n}: avançar deveria ir para Magias (foi ${ctx.passo})`);
				if (r.magias.escolas && !r.magias.escolasFicha.length) {
					escolas = c.escolher;
					for (const e of escolas) acionar(win, "escola", { escola: e });
					await guardar(win, k("magias escolas"));
				}
				const escolhidas = escolherMagias(r, ficha, vagas, escolas);
				for (const m of escolhidas) acionar(win, "magia", { uuid: m.uuid });
				if (escolhidas[0]) acionar(win, "focarMagia", { uuid: escolhidas[0].uuid });
				await guardar(win, k("magias escolhidas"));
			}

			acionar(win, "avancar");
			ctx = await guardar(win, k("revisao"));
			conferir(ctx.passo === "revisao" && !ctx.pendencia, `janela ${titulo} ${n}: revisão com pendência: ${ctx.pendencia ?? `(passo ${ctx.passo})`}`);
			await acionar(win, "aplicar");
			if (!conferir(ator.nivel === n, `janela ${titulo} ${n}: aplicar deixou o personagem no nível ${ator.nivel}`)) break;
		}
		await guardar(win, `${titulo} | fim`);
		conferir(avisos.length === inicio, `janela ${titulo}: avisos durante a subida: ${avisos.slice(inicio).join(" | ")}`);
		console.log(`  ✓ ${titulo}: ${ator.nivel}º nível pela janela`);
	}

	const caminhoRetrato = path.join(aqui, "retratos/subir-nivel.json");
	const salvo = fs.existsSync(caminhoRetrato) ? JSON.parse(fs.readFileSync(caminhoRetrato, "utf8")) : null;
	if (ATUALIZAR || !salvo) {
		fs.writeFileSync(caminhoRetrato, JSON.stringify(retrato, null, 1) + "\n");
		console.log(`  retrato gravado: ${Object.keys(retrato).length} telas`);
	} else {
		const diferentes = [...new Set([...Object.keys(salvo), ...Object.keys(retrato)])].filter((k) => salvo[k] !== retrato[k]);
		conferir(!diferentes.length, `telas diferentes do retrato (${diferentes.length}): ${diferentes.slice(0, 8).join("; ")}${diferentes.length > 8 ? "…" : ""} — compare com --telas=arquivo.json`);
		if (!diferentes.length) console.log(`  ✓ ${Object.keys(retrato).length} telas iguais ao retrato`);
	}
	if (ARQ_TELAS) fs.writeFileSync(ARQ_TELAS, JSON.stringify(contextos, null, 1));
}

/* ---------- 6. Ficha virtual: subir só em memória, com as escolhas de um nó ---------- */
{
	console.log("\nFicha virtual (aplicarEscolhas):");
	const fontes = { dados: { ...dados, regrasClasses, regrasPoderesClasse, variantes: {}, escolas: {} }, progressao, lerPreRequisito };
	const casos = [
		{ classe: "Guerreiro", ate: 20 },
		{ classe: "Arcanista", nivel1: ["Caminho do Arcanista: Mago"], ate: 12 },
		{ classe: "Bardo", escolher: ["evo", "con", "nec"], ate: 6 },
		{ classe: "Guerreiro", rotulo: "multiclasse Arcanista no 3º", multiclasse: { nivel: 3, classe: "Arcanista" }, ate: 5 }
	];
	for (const c of casos) {
		const titulo = `${c.classe}${c.rotulo ? ` (${c.rotulo})` : ""}`;
		const prog = progressaoDe(progressao, c.classe);
		const docs1 = [...(prog.niveis?.["1"]?.habilidades ?? []), ...(c.nivel1 ?? [])].map((n) => dados.poderesPorNome.get(normalizar(n))).filter(Boolean);
		const real = novoAtor(c.classe, docs1);
		const foto = fotografia(real);
		const v = virtualDe(real, titulo);
		let escolas = null;
		let ok = true;
		for (let n = 2; n <= c.ate && ok; n++) {
			const ficha = lerFicha(v, { regrasClasses, variantes: variantesDe(progressao) });
			const nova = c.multiclasse?.nivel === n;
			const classe = nova ? { nome: c.multiclasse.classe, niveis: 0, nova: true, doc: dados.classes.find((x) => x.name === c.multiclasse.classe) } : ficha.classes.find((x) => x.inicial) ?? ficha.classes[0];
			const r = montarNivel({ dados, progressao, ficha, classe, lerPreRequisito, regrasPoderesClasse, regrasClasses });
			const selecoes = {};
			for (const e of r.escolhas) selecoes[e.id] = e.opcoes[0].doc.uuid;
			for (const a of r.anotadas) selecoes[a.id] = a.opcoes[(n * 3) % a.opcoes.length];
			const disponiveis = r.poderesClasse.filter((o) => o.disponivel);
			const poder = disponiveis.find((o) => o.preRequisito) ?? disponiveis[0] ?? r.poderesGerais.find((o) => o.disponivel && !o.repetivel) ?? null;
			if (r.magias?.escolas && !r.magias.escolasFicha.length) escolas = c.escolher;
			const vagas = r.magias ? vagasEfetivas(r.magias, selecoes, poder) : [];
			const magias = vagas.length ? escolherMagias(r, ficha, vagas, escolas).map((m) => m.uuid) : [];
			const escolhas = { classeAlvo: nova ? `nova:${classe.nome}` : classe.id, escolha: poder?.doc.uuid ?? null, selecoes, magias, escolas: escolas ?? [] };
			// sem o poder (ou sem as magias), o nível é recusado com o motivo, e nada muda na ficha virtual
			if (r.ganhaPoder) {
				const antes = leitura(v);
				const sem = await aplicarEscolhas(v, { ...escolhas, escolha: null }, fontes);
				ok = conferir(!sem.ok && /poder/i.test(sem.motivo) && leitura(v) === antes, `${titulo} ${n}: sem poder, deveria recusar sem mudar a ficha (${JSON.stringify(sem)})`);
			}
			const res = await aplicarEscolhas(v, escolhas, fontes);
			ok = conferir(res.ok && res.nivel === n && v.nivel === n && res.classe === classe.nome, `${titulo} ${n}: ${JSON.stringify(res)}`) && ok;
		}
		const ficha = lerFicha(v, { regrasClasses, variantes: variantesDe(progressao) });
		conferir(fotografia(real) === foto, `${titulo}: o ator real mudou`);
		if (c.multiclasse) conferir(ficha.classes.some((x) => x.nome === c.multiclasse.classe && x.niveis === 1), `${titulo}: a classe nova não entrou na ficha virtual`);
		conferir(await aplicarEscolhas(v, { classeAlvo: "nova:Classe Inexistente" }, fontes).then((x) => !x.ok), `${titulo}: classe nova inexistente deveria ser recusada`);
		if (ok) console.log(`  ✓ ${titulo}: ${v.nivel}º nível na ficha virtual (${ficha.classes.map((x) => `${x.nome} ${x.niveis}`).join(", ")}; ${v.items.filter((i) => i.type === "magia").length} magias); o ator real não mudou`);
	}
}

/* ---------- 6b. Multiclasse com escolhas internas: Clérigo 1 → Arcanista (Feiticeiro, Linhagem Abençoada) ---------- */
{
	console.log("\nEscolhas internas na multiclasse (Linhagem Abençoada):");
	const { EtapasNivel } = await import("../scripts/etapas-nivel.js");
	const { paraNomes } = await import("../scripts/builds/arvore.js");
	const fontes = { dados: { ...dados, regrasClasses, regrasPoderesClasse, variantes: {}, escolas: {} }, progressao, lerPreRequisito };
	const docs1 = (progressaoDe(progressao, "Clérigo").niveis?.["1"]?.habilidades ?? []).map((n) => dados.poderesPorNome.get(normalizar(typeof n === "string" ? n : n.nome))).filter(Boolean);
	const real = novoAtor("Clérigo", docs1);
	const v = virtualDe(real, "Clérigo devoto de Arsenal");
	const et = new EtapasNivel(v, fontes);
	et.escolherClasse("nova:Arcanista");
	let { nivel } = et.calcular();
	const caminho = nivel.escolhas.find((e) => /caminho/i.test(e.titulo));
	const feiticeiro = caminho?.opcoes.find((o) => /feiticeiro/i.test(o.nome));
	et.selecionar(caminho.id, feiticeiro.doc.uuid);
	({ nivel } = et.calcular());
	const linhagem = nivel.escolhas.find((e) => e.requer?.id === caminho.id);
	const abencoada = linhagem?.opcoes.find((o) => /aben/i.test(o.nome));
	conferir(!!abencoada, "a Linhagem Abençoada deveria estar entre as linhagens do Feiticeiro");
	et.selecionar(linhagem.id, abencoada.doc.uuid);
	({ nivel } = et.calcular());
	et.irPara("nivel");
	let ctx = await et.contexto();
	const blocoLinhagem = ctx.escolhas.find((e) => e.id === linhagem.id);
	const deus = blocoLinhagem?.internas?.find((i) => !i.magia);
	const avisoMagia = blocoLinhagem?.internas?.find((i) => i.magia);
	conferir(deus && deus.opcoes.some((o) => o.valor === "Arsenal") && avisoMagia,
		`passo Nível: a Linhagem Abençoada deveria pedir o deus maior (chips) e avisar da magia divina (${JSON.stringify(blocoLinhagem?.internas)?.slice(0, 200)})`);
	conferir(!ctx.notas.some((n) => /Abençoada/.test(n)), `a nota "complete na ficha" não deveria citar mais a Linhagem Abençoada: ${ctx.notas.join(" | ")}`);
	conferir(/Deus maior/.test(et.pendencia(nivel, "nivel") ?? ""), `sem o deus, o passo Nível deveria ter pendência (${et.pendencia(nivel, "nivel")})`);
	et.selecionar(deus.id, "Arsenal");
	({ nivel } = et.calcular());
	conferir(!et.pendencia(nivel, "nivel"), `com o deus, o passo Nível não deveria ter pendência (${et.pendencia(nivel, "nivel")})`);

	// passo Magias: as 3 da classe (podem ser divinas de 1º círculo) + a divina da Linhagem
	const vagas = vagasEfetivas(nivel.magias, et.selecoes, null);
	const daLinhagem = vagas.filter((x) => x.interna);
	conferir(vagas.length === 4 && daLinhagem.length === 1 && daLinhagem[0].tipos.includes("div") && !daLinhagem[0].tipos.includes("arc") && vagas.every((x) => x.tipos.includes("div")),
		`vagas: 3 da classe (arcanas ou divinas) + 1 divina da Linhagem (${JSON.stringify(vagas)})`);
	et.irPara("magias");
	ctx = await et.contexto();
	conferir(ctx.vagasTexto.some((t) => /magia divina de 1º círculo \(Linhagem Abençoada/i.test(t)), `passo Magias: a vaga da Linhagem com o título (${ctx.vagasTexto.join(" | ")})`);
	const ficha = lerFicha(v, { regrasClasses, variantes: variantesDe(progressao) });
	const lista = magiasDisponiveis(dados, { ...nivel.magias, tipos: tiposDasVagas(nivel.magias, vagas) }, ficha);
	const divina = lista.find((m) => m.system.tipo === "div" && circuloDe(m) === 1);
	const arcanas = lista.filter((m) => m.system.tipo === "arc" && circuloDe(m) === 1).slice(0, 3);
	for (const m of [...arcanas, divina]) et.alternarMagia(m.uuid);
	conferir(!et.pendencia(nivel), `com as 4 magias, nada pendente (${et.pendencia(nivel)})`);
	const p = et.planoDoNivel();
	const ajuste = p.plano?.ajustes?.[abencoada.doc.uuid];
	conferir(ajuste && /Arsenal/.test(ajuste.anotacao) && ajuste.anotacao.includes(divina.name), `plano: o ajuste da Linhagem anota o deus e a magia (${JSON.stringify(ajuste)})`);
	et.irPara("revisao");
	ctx = await et.contexto();
	conferir(ctx.revisao.some((i) => i.tipo === "Escolha interna" && /Arsenal/.test(i.nome)), `revisão: mostra a escolha interna (${JSON.stringify(ctx.revisao)})`);
	conferir(paraNomes(et, et.calcular()).selecoes[deus.id]?.texto === "Arsenal", "build: o deus vai para o plano salvo (por texto)");

	const res = await aplicarEscolhas(v, et.escolhasAtuais(), fontes);
	const item = v.items.find((i) => /Linhagem Abençoada/.test(i.name));
	const desc = item?.system?.description?.value ?? "";
	conferir(res.ok && item && /Arsenal/.test(desc) && desc.includes(divina.name) && v.items.some((i) => i.type === "magia" && i.name.endsWith(divina.name)),
		`ficha: a Linhagem Abençoada com o deus e a magia anotados, e a magia divina na ficha (${JSON.stringify(res)}; ${desc.slice(0, 160)})`);

	// trocar a Linhagem tira o deus e a magia divina que só cabia na vaga dela
	const et2 = new EtapasNivel(virtualDe(real, "outro"), fontes);
	et2.escolherClasse("nova:Arcanista");
	et2.selecionar(caminho.id, feiticeiro.doc.uuid);
	et2.selecionar(linhagem.id, abencoada.doc.uuid);
	et2.selecionar(deus.id, "Arsenal");
	for (const m of [...arcanas, divina]) et2.alternarMagia(m.uuid);
	const draconica = linhagem.opcoes.find((o) => /drac/i.test(o.nome));
	et2.selecionar(linhagem.id, draconica.doc.uuid);
	conferir(et2.selecoes[deus.id] === undefined && !et2.magias.includes(divina.uuid) && et2.magias.length === 3,
		`trocar para a Dracônica: sai o deus e a magia divina (${JSON.stringify({ deus: et2.selecoes[deus.id], magias: et2.magias.length })})`);
	const tipoDano = et2.calcular().nivel.internas.find((i) => i.poder === draconica.nome && i.tipo === "opcao");
	et2.selecionar(tipoDano.id, "fogo");
	const p2 = et2.planoDoNivel();
	conferir(p2.plano?.ajustes?.[draconica.doc.uuid]?.resistencia === "fogo", `Dracônica: redução de dano a fogo no ajuste (${JSON.stringify(p2.plano?.ajustes ?? p2)})`);
	const v2 = et2.actor;
	await aplicarEscolhas(v2, et2.escolhasAtuais(), fontes);
	const drac = v2.items.find((i) => /Linhagem Dracônica/.test(i.name));
	conferir((drac?.effects ?? []).some((e) => (e.system?.changes ?? e.changes ?? []).some((c) => c.key === "system.tracos.resistencias.fogo.bonus")),
		"ficha: a Linhagem Dracônica com a redução de dano a fogo no efeito");
	console.log("  ✓ conferido (deus, magia divina, revisão, build, gravação e troca de linhagem)");
}

/* ---------- 7. Plano de builds: árvore, validação e a janela preenchida pelo plano ---------- */
{
	console.log("\nPlano de builds:");
	const A = await import("../scripts/builds/arvore.js");
	const { validarArvore } = await import("../scripts/builds/validar.js");
	const { EtapasNivel } = await import("../scripts/etapas-nivel.js");
	const { SubirNivel } = await import("../scripts/subir-nivel.js");
	const fontes = { dados: { ...dados, regrasClasses, regrasPoderesClasse, variantes: {}, escolas: {} }, progressao, lerPreRequisito };
	const ok = (cond, msg) => { if (conferir(cond, msg)) console.log(`  ✓ ${msg}`); };
	const atorDe = (classe, extras = [], niveis = 1) => {
		const prog = progressaoDe(progressao, classe);
		const docs = [...(prog.niveis?.["1"]?.habilidades ?? []), ...extras].map((n) => dados.poderesPorNome.get(normalizar(n))).filter(Boolean);
		const a = novoAtor(classe, docs);
		a.items.find((i) => i.type === "classe").system.niveis = niveis;
		a.reset();
		a.toObject = () => fonteDoAtor(a);
		return Object.assign(a, { id: `plano${classe}`, name: `Plano ${classe}`, type: "character" });
	};
	/** Escolhas completas (uuids) do próximo nível, como o teste 2 decide. */
	const escolherTudo = (etapas, preferir = null) => {
		const calculo = etapas.calcular();
		const r = calculo.nivel;
		for (const e of r.escolhas) etapas.selecoes[e.id] = e.opcoes[0].doc.uuid;
		for (const a of r.anotadas) etapas.selecoes[a.id] = a.opcoes[0];
		const disp = r.poderesClasse.filter((o) => o.disponivel);
		const poder = (preferir && [...disp, ...r.poderesGerais].find((o) => o.nome === preferir && o.disponivel)) ?? disp.find((o) => o.preRequisito) ?? disp[0] ?? r.poderesGerais.find((o) => o.disponivel && !o.repetivel);
		etapas.escolha = poder?.doc.uuid ?? null;
		const ficha = lerFicha(etapas.actor, { regrasClasses, variantes: variantesDe(progressao) });
		if (r.magias) {
			if (r.magias.escolas && !r.magias.escolasFicha.length) etapas.escolas = ["evo", "con", "nec"];
			const vagas = vagasEfetivas(r.magias, etapas.selecoes, poder);
			etapas.magias = escolherMagias(r, ficha, vagas, etapas.escolas.length ? etapas.escolas : null).map((m) => m.uuid);
		}
		return etapas.calcular();
	};

	// 1. nomes ↔ etapas: ida e volta, em níveis com escolha de Caminho, anotação, magias e multiclasse
	for (const [classe, extras, niveis, alvo] of [["Cavaleiro", [], 4, null], ["Caçador", [], 2, null], ["Arcanista", ["Caminho do Arcanista: Mago"], 4, null], ["Guerreiro", [], 2, "nova:Arcanista"]]) {
		const a = atorDe(classe, extras, niveis);
		const et = new EtapasNivel(a, fontes);
		if (alvo) et.classeAlvo = alvo;
		const calculo = escolherTudo(et);
		const nomes = A.paraNomes(et, calculo);
		const antes = JSON.stringify(et.escolhasAtuais());
		const et2 = new EtapasNivel(a, fontes);
		const { problemas } = A.paraEtapas(et2, nomes);
		ok(!problemas.length && JSON.stringify(et2.escolhasAtuais()) === antes && !et2.pendencia(et2.calcular().nivel),
			`${classe} ${niveis + 1}${alvo ? ` (${alvo})` : ""}: escolhas por nome voltam iguais (${[nomes.poder, ...Object.values(nomes.selecoes).map((v) => v.nome ?? v.texto), ...nomes.magias].filter(Boolean).join(", ") || "—"})`);
	}
	{
		const a = atorDe("Guerreiro");
		const et = new EtapasNivel(a, fontes);
		const { problemas } = A.paraEtapas(et, { classe: "Guerreiro", poder: "Poder Que Não Existe", magias: ["Magia Sumida"], selecoes: {} });
		ok(problemas.some((p) => /Poder Que Não Existe/.test(p)) && problemas.some((p) => /Magia Sumida/.test(p)), "nomes que não existem mais viram problemas (poder e magia)");
		const golpe = A.paraEtapas(new EtapasNivel(a, fontes), { classe: "Guerreiro", poder: "Golpe Pessoal", selecoes: {} }).problemas;
		ok(golpe.some((p) => /Golpe Pessoal: Pré-requisito/.test(p)), "poder sem o pré-requisito vira problema com o motivo");
	}

	// 2. operações da árvore
	{
		const arv = A.arvoreVazia(1);
		const e = (poder) => ({ classe: "Guerreiro", poder, anotacao: "", selecoes: {}, magias: [], escolas: [] });
		const a2 = A.adicionarNo(arv, { nivel: 2, escolhas: e("Bater e Correr") });
		const b2 = A.adicionarNo(arv, { nivel: 2, escolhas: e("Golpe Demolidor") });
		const a3 = A.adicionarNo(arv, { nivel: 3, pai: a2.id, escolhas: e("Ataque Reflexo") });
		const a4 = A.adicionarNo(arv, { nivel: 4, pai: a3.id, escolhas: e("Valentão (Guerreiro)") });
		const repetido = A.adicionarNo(arv, { nivel: 2, escolhas: e("bater e correr") });
		ok(repetido === a2 && arv.nos.length === 4 && a2.nome === "Bater e Correr", "nó com as mesmas escolhas não duplica; nome automático é o poder");
		A.escolherNo(arv, a4.id);
		ok(JSON.stringify(arv.caminho) === JSON.stringify([a2.id, a3.id, a4.id]), "escolher um nó põe os ancestrais no caminho");
		A.escolherNo(arv, a2.id);
		ok(arv.caminho.length === 3, "escolher um ancestral mantém o caminho abaixo dele");
		A.escolherNo(arv, b2.id);
		ok(JSON.stringify(arv.caminho) === JSON.stringify([b2.id]), "escolher um irmão troca o caminho");
		A.escolherNo(arv, a4.id);
		ok(A.apagarNo(arv, a3.id) === 2 && arv.nos.length === 2 && JSON.stringify(arv.caminho) === JSON.stringify([a2.id]), "apagar um nó apaga os descendentes e corta o caminho");
		ok(A.mesmasEscolhas({ classe: "Bardo", magias: ["B", "A"], escolas: ["evo", "con"] }, { classe: "bardo", magias: ["A", "B"], escolas: ["con", "evo"], anotacao: " " }), "mesmas escolhas ignoram ordem, acentos e espaços");

		// subir seguindo o plano: o nó sai, os filhos viram raízes, o irmão fica não seguido
		const arv2 = A.arvoreVazia(1);
		const x2 = A.adicionarNo(arv2, { nivel: 2, escolhas: e("Bater e Correr") });
		const y2 = A.adicionarNo(arv2, { nivel: 2, escolhas: e("Golpe Demolidor") });
		const x3 = A.adicionarNo(arv2, { nivel: 3, pai: x2.id, escolhas: e("Ataque Reflexo") });
		const y3 = A.adicionarNo(arv2, { nivel: 3, pai: y2.id, escolhas: e("Valentão (Guerreiro)") });
		A.escolherNo(arv2, x3.id);
		const seguido = A.registrarSubida(arv2, 2, e("Bater e Correr"));
		ok(seguido?.id === x2.id && !A.noPorId(arv2, x2.id) && x3.pai === null && JSON.stringify(arv2.caminho) === JSON.stringify([x3.id]) && arv2.base === 2,
			"subir com as escolhas do plano: o nó sai, o filho vira raiz e continua no caminho");
		ok(y2.naoSeguido?.escolhido === "Bater e Correr" && y3.naoSeguido && /no 2º nível o personagem escolheu Bater e Correr/.test(A.textoNaoSeguido(y2)),
			"o irmão e o ramo dele ficam como não seguidos, com o aviso");
		A.registrarSubida(arv2, 3, e("Golpe Demolidor"));
		ok(x3.naoSeguido && !arv2.caminho.length, "subir com outra escolha: os nós do nível ficam não seguidos e o caminho esvazia");
		const arv3 = A.arvoreVazia(1);
		const z2 = A.adicionarNo(arv3, { nivel: 2, escolhas: e("Bater e Correr") });
		ok(A.sincronizar(arv3, 3) && z2.naoSeguido?.fora && /fora do planejador/.test(A.textoNaoSeguido(z2)), "ficha que passou do nível fora do planejador: os nós ficam não seguidos");
	}

	// 3. validação na ficha virtual: caminho válido, poder que perde o pré-requisito, nó fora de alcance
	{
		const a = atorDe("Guerreiro");
		const arv = A.arvoreVazia(1);
		const v = virtualDe(a, "validação");
		let pai = null;
		const ids = [];
		for (let n = 2; n <= 5; n++) {
			const et = new EtapasNivel(v, fontes);
			const calculo = escolherTudo(et);
			const no = A.adicionarNo(arv, { nivel: n, pai, escolhas: A.paraNomes(et, calculo) });
			await aplicarEscolhas(v, et.escolhasAtuais(), fontes);
			ids.push(no.id);
			pai = no.id;
		}
		// um ramo no 3º com um poder de 5º nível (sem pré-requisito) e um filho dele
		const ruim = A.adicionarNo(arv, { nivel: 3, pai: ids[0], escolhas: { ...A.noPorId(arv, ids[1]).escolhas, poder: "Golpe Pessoal" } });
		const filhoRuim = A.adicionarNo(arv, { nivel: 4, pai: ruim.id, escolhas: A.noPorId(arv, ids[2]).escolhas });
		const longe = A.adicionarNo(arv, { nivel: 7, escolhas: { classe: "Guerreiro", poder: "Bater e Correr", selecoes: {}, magias: [], escolas: [], anotacao: "" } });
		const foto = fotografia(a);
		const cont = await validarArvore(virtualDe(a, "v"), arv, fontes, { criarDocumento: documentoSimulado });
		ok(cont.validos === 4 && ids.every((id) => !A.noPorId(arv, id).divergente), `caminho de 4 níveis válido na ficha virtual (${ids.map((id) => A.noPorId(arv, id).nome).join(" → ")})`);
		ok(/Golpe Pessoal: Pré-requisito/.test(ruim.divergente?.motivo ?? "") && filhoRuim.divergente?.herdado, "poder sem pré-requisito no 3º: o nó fica divergente com o motivo, e o filho herda");
		ok(/7º nível/.test(longe.divergente?.motivo ?? ""), "nó de um nível que a ficha não alcança fica divergente");
		ok(fotografia(a) === foto, "validar não mexe no ator real");
	}

	// 4. a janela: preenche pelo plano, vai para a revisão, sobe e marca o nó; salvar como plano cria o nó
	{
		const a = atorDe("Guerreiro");
		const abrir = () => Object.assign(new SubirNivel(a), { dados: fontes.dados, progressao, lerPreRequisito });
		const acionar = (win, acao, dataset = {}) => SubirNivel.DEFAULT_OPTIONS.actions[acao].call(win, null, { dataset });
		let win = abrir();
		let ctx = await win._prepareContext();
		ok(ctx.plano === null && ctx.salvarPlano === false, "sem plano: nada preenchido, salvar desabilitado até completar o nível");
		escolherTudo(win.etapas);
		ctx = await win._prepareContext();
		const poder = ctx.resumo.find((x) => x.rotulo === "Poder")?.valor;
		await acionar(win, "salvarPlano");
		const arv = A.lerArvore(a);
		ok(arv.nos.length === 1 && arv.nos[0].nivel === 2 && arv.nos[0].escolhas.poder === poder && arv.caminho[0] === arv.nos[0].id, `salvar como plano grava o nó do 2º nível (${poder}) e o põe no caminho`);
		// um irmão (outra build para o 2º) e um filho (3º) do nó salvo
		const arv2 = A.lerArvore(a);
		const irmao = A.adicionarNo(arv2, { nivel: 2, escolhas: { ...arv2.nos[0].escolhas, poder: "Golpe Demolidor" } });
		const filho = A.adicionarNo(arv2, { nivel: 3, pai: arv2.nos[0].id, escolhas: { classe: "Guerreiro", poder: "Ataque Reflexo", selecoes: {}, magias: [], escolas: [], anotacao: "" } });
		A.escolherNo(arv2, filho.id);
		await A.gravarArvore(a, arv2);

		win = abrir();
		ctx = await win._prepareContext();
		ok(ctx.plano?.nome === poder && !ctx.plano.invalido && ctx.passo === "revisao" && !ctx.pendencia, "ao abrir, as escolhas vêm do plano e a janela vai direto para a revisão");
		await acionar(win, "aplicar");
		const depois = A.lerArvore(a);
		ok(a.nivel === 2 && depois.base === 2 && A.noPorId(depois, filho.id)?.pai === null && JSON.stringify(depois.caminho) === JSON.stringify([filho.id]), "subir pelo plano: o nó do 2º sai e o do 3º vira o próximo");
		ok(A.noPorId(depois, irmao.id)?.naoSeguido?.escolhido === poder, "a outra build do 2º fica como não seguida");
		ctx = await win._prepareContext();
		ok(ctx.plano?.nome === "Ataque Reflexo" && ctx.passo === "revisao", "depois de subir, o próximo nível já vem preenchido pelo plano");
		acionar(win, "limparPlano");
		ctx = await win._prepareContext();
		ok(ctx.plano === null && ctx.passo === "classe" && A.lerArvore(a).nos.length === 2, "limpar descarta o preenchimento, sem apagar o plano");

		// plano que não vale mais: aviso, sem preencher
		const arv3 = A.lerArvore(a);
		A.noPorId(arv3, filho.id).escolhas.poder = "Poder Que Não Existe";
		await A.gravarArvore(a, arv3);
		win = abrir();
		ctx = await win._prepareContext();
		ok(/Poder Que Não Existe/.test(ctx.plano?.invalido ?? "") && ctx.passo === "classe", "plano que não vale mais: aviso com o motivo, e nada preenchido");
	}
}

/* ---------- 8. Cadastro de builds (planejador): colunas, editor, prévia ---------- */
{
	console.log("\nCadastro de builds (planejador):");
	const A = await import("../scripts/builds/arvore.js");
	const { PlanejadorBuilds, EditorBuild } = await import("../scripts/builds/planejador.js");
	const { SubirNivel } = await import("../scripts/subir-nivel.js");
	const fontes = { dados: { ...dados, regrasClasses, regrasPoderesClasse, variantes: {}, escolas: {} }, progressao, lerPreRequisito };
	const ok = (cond, msg) => { if (conferir(cond, msg)) console.log(`  ✓ ${msg}`); };
	let respostaConfirmar = true;
	Object.assign(foundry.applications.api.DialogV2, { confirm: async () => respostaConfirmar, prompt: async () => "Minha build" });

	// todo data-action dos templates tem ação (planejador; subir de nível, que agora também é o editor)
	for (const [arquivo, Classe] of [["planejador.hbs", PlanejadorBuilds], ["subir-nivel.hbs", SubirNivel]]) {
		const tpl = fs.readFileSync(path.join(raizModulo, "templates", arquivo), "utf8");
		const usadas = new Set([...tpl.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]));
		const acoes = Classe.DEFAULT_OPTIONS.actions;
		const faltam = [...usadas].filter((a) => typeof acoes[a] !== "function");
		// focarMagia: ação antiga da janela de subir de nível, sem botão no template (o clique na magia já foca)
		const sobram = Object.keys(acoes).filter((a) => !usadas.has(a) && a !== "focarMagia");
		ok(!faltam.length && !sobram.length, `${arquivo}: ações dos botões registradas${faltam.length ? ` (faltam ${faltam})` : ""}${sobram.length ? ` (sem uso: ${sobram})` : ""}`);
	}

	const prog = progressaoDe(progressao, "Guerreiro");
	const docs1 = (prog.niveis?.["1"]?.habilidades ?? []).map((n) => dados.poderesPorNome.get(normalizar(n))).filter(Boolean);
	const real = Object.assign(novoAtor("Guerreiro", docs1), { id: "planejador", name: "Tarik", type: "character", img: "x.webp" });
	real.toObject = () => fonteDoAtor(real, "Tarik");
	const foto = () => JSON.stringify(real.items.map((i) => i.toObject()));
	const fotoInicial = foto();
	const plan = new PlanejadorBuilds(real, { ...fontes, opcoesFicha: { criarDocumento: documentoSimulado } });
	const acao = (nome, dataset = {}) => PlanejadorBuilds.DEFAULT_OPTIONS.actions[nome].call(plan, null, { dataset });
	/** Completa as escolhas do editor (1º poder de classe com pré-requisito, ou o preferido) e salva no plano. */
	const salvarEditor = async (editor, preferir = null) => {
		const et = editor.etapas;
		const r = et.calcular().nivel;
		for (const e of r.escolhas) et.selecoes[e.id] = e.opcoes[0].doc.uuid;
		const disp = r.poderesClasse.filter((o) => o.disponivel);
		const poder = (preferir && disp.find((o) => o.nome === preferir)) ?? disp.find((o) => o.preRequisito) ?? disp[0];
		et.escolha = poder.doc.uuid;
		await EditorBuild.DEFAULT_OPTIONS.actions.aplicar.call(editor);
		return poder.nome;
	};

	let ctx = await plan._prepareContext();
	ok(ctx.colunas.length === 2 && ctx.colunas[0].nivel === 2 && !ctx.colunas[0].builds.length && ctx.colunas[1].bloqueada, "sem builds: a coluna do 2º nível aberta e a do 3º bloqueada");

	await acao("novaBuild", { nivel: "2", pai: "" });
	ok(plan.editor instanceof EditorBuild && plan.editor.actor.virtual && plan.editor.actor.nivel === 1, "nova build do 2º: o editor abre sobre a ficha virtual do 1º nível");
	const ctxEditor = await plan.editor._prepareContext();
	ok(ctxEditor.modoPlano && ctxEditor.podeDesfazer === false && ctxEditor.nivelPersonagem === 2, "o editor é a tela de subir de nível em modo plano (sem desfazer, botão Salvar no plano)");
	const p2 = await salvarEditor(plan.editor);
	let arv = A.lerArvore(real);
	const b2 = arv.nos[0];
	ctx = await plan._prepareContext();
	ok(arv.nos.length === 1 && b2.escolhas.poder === p2 && arv.caminho[0] === b2.id && ctx.colunas[0].builds[0]?.escolhida && !ctx.colunas[1].bloqueada,
		`salvar no plano: a build ${p2} entra no 2º nível, escolhida, e o 3º abre`);
	ok(foto() === fotoInicial && real.nivel === 1, "o ator real não muda ao planejar");

	// variação no 2º com outro poder: vira a escolhida; o 3º passa a partir dela
	await acao("variacaoBuild", { id: b2.id });
	ok(plan.editor.modo === "variacao" && plan.editor.etapas.passo === "revisao", "variação: o editor abre com as escolhas da build, na revisão");
	const p2b = await salvarEditor(plan.editor, "Bater e Correr");
	arv = A.lerArvore(real);
	const b2b = arv.nos.find((n) => n.escolhas.poder === p2b);
	ctx = await plan._prepareContext();
	ok(arv.nos.length === 2 && arv.caminho[0] === b2b.id && ctx.colunas[0].builds.length === 2 && ctx.colunas[1].builds.length === 0, `a variação ${p2b} é outra build do 2º e passa a ser a escolhida`);

	// 3º e 4º a partir da variação: só pelo "+" de uma build do nível anterior (a base do novo nível)
	ctx = await plan._prepareContext();
	ok(ctx.colunas[0].primeira && !ctx.colunas[1].primeira && ctx.colunas[1].de === p2b && ctx.colunas[0].builds.every((b) => b.proximo === 3),
		"só a 1ª coluna cria build direto; a do 3º diz a partir de qual build, e cada build do 2º tem o botão + 3º");
	await acao("proximoNivel", { id: b2b.id });
	ok(plan.editor.actor.nivel === 2 && plan.editor.actor.items.some((i) => i.name === `2 - ${p2b}`), "nova build do 3º: a ficha virtual já tem o poder da build do 2º");
	const p3 = await salvarEditor(plan.editor);
	arv = A.lerArvore(real);
	const b3 = arv.nos.find((n) => n.nivel === 3);
	await acao("proximoNivel", { id: b3.id });
	await salvarEditor(plan.editor);
	arv = A.lerArvore(real);
	ctx = await plan._prepareContext();
	ok(ctx.colunas.map((c) => c.nivel).join(",") === "2,3,4,5,6" && ctx.colunas[3].builds.length === 0 && ctx.colunas[4].bloqueada && ctx.caminho.startsWith(`2º ${p2b} → 3º ${p3}`),
		`caminho de 3 níveis (${ctx.caminho}): a coluna do 5º aberta e a do 6º bloqueada`);

	// trocar a escolha no 2º: o 3º passa a mostrar os filhos da outra build (nenhum)
	await acao("escolherBuild", { id: b2.id });
	ctx = await plan._prepareContext();
	ok(ctx.colunas[1].builds.length === 0 && ctx.colunas.length === 3 && ctx.colunas[2].bloqueada, "escolher a outra build do 2º: o 3º mostra os filhos dela, e o 4º bloqueia");
	await acao("escolherBuild", { id: b2b.id });

	// prévia: em Node não há ficha do sistema, então sai a ficha resumida, com o 3º nível e o poder
	await acao("previaBuild", { id: b3.id });
	ctx = await plan._prepareContext();
	ok(ctx.previa?.tipo === "resumo" && ctx.previa.animar && ctx.previa.html.includes(`3 - ${p3}`) && ctx.previa.html.includes("3º nível") && ctx.previa.html.includes("PV"),
		"prévia da build do 3º: ficha resumida (sem a ficha do sistema em Node) com o poder e o nível");
	ctx = await plan._prepareContext();
	ok(!ctx.previa.animar, "a animação do slide só na primeira vez");
	{
		// documento do iframe da ficha do sistema: estilos da página, base, classes da janela e o HTML da ficha
		const { documentoDaPrevia } = await import("../scripts/builds/previa.js");
		const antes = globalThis.document;
		globalThis.document = {
			querySelectorAll: () => [{ outerHTML: '<link rel="stylesheet" href="systems/tormenta20/css/tormenta20.css">' }],
			documentElement: { className: "", lang: "pt-BR" }, baseURI: "http://localhost:30000/game", body: { className: "vtt game system-tormenta20" }
		};
		const doc = documentoDaPrevia({ html: "<form class=\"ficha\">Tarik</form>", classes: "tormenta20 sheet actor character" });
		globalThis.document = antes;
		ok(doc.includes("tormenta20.css") && doc.includes('<base href="http://localhost:30000/game">') && doc.includes('class="vtt game system-tormenta20"')
			&& doc.includes('class="app window-app tormenta20 sheet actor character t20cf-previa-janela"') && doc.includes("<form class=\"ficha\">Tarik</form>") && !doc.includes("t20-construtor"),
			"prévia da ficha do sistema: iframe com os estilos da página, fora da janela do construtor");
	}
	acao("fecharPrevia");

	// editar a build do 3º: troca o poder, mantém o nó (e o filho)
	await acao("editarBuild", { id: b3.id });
	const p3b = await salvarEditor(plan.editor, "Golpe Demolidor");
	arv = A.lerArvore(real);
	ok(A.noPorId(arv, b3.id)?.escolhas.poder === p3b && A.noPorId(arv, b3.id).nome === p3b && arv.nos.length === 4, `editar: a build do 3º vira ${p3b}, no mesmo lugar da árvore (nome automático acompanha)`);

	await acao("renomearBuild", { id: b3.id });
	ok(A.noPorId(A.lerArvore(real), b3.id)?.nome === "Minha build", "renomear");

	// build com problema: poder que não existe mais no 3º → divergente, e o 4º herda
	arv = A.lerArvore(real);
	A.noPorId(arv, b3.id).escolhas.poder = "Poder Que Não Existe";
	await A.gravarArvore(real, arv);
	ctx = await plan._prepareContext();
	const c3 = ctx.colunas[1].builds.find((b) => b.id === b3.id);
	ok(/Poder Que Não Existe/.test(c3?.divergente ?? "") && ctx.colunas[2]?.bloqueada, "build que não vale mais: aviso com o motivo, e o nível seguinte bloqueia");
	await acao("previaBuild", { id: b3.id });
	ok(!plan.previa, "sem prévia de build que não vale mais");

	// apagar com os descendentes (confirmando) e recusar
	respostaConfirmar = false;
	await acao("apagarBuild", { id: b3.id });
	ok(A.lerArvore(real).nos.length === 4, "apagar cancelado não apaga");
	respostaConfirmar = true;
	await acao("apagarBuild", { id: b3.id });
	arv = A.lerArvore(real);
	ok(arv.nos.length === 2 && JSON.stringify(arv.caminho) === JSON.stringify([b2b.id]), "apagar a build do 3º apaga a do 4º junto e corta o caminho");

	// a janela de subir de nível: preenche com a build escolhida do 2º, sobe, e o planejador mostra a outra como não seguida
	let mudou = 0;
	plan.aoMudar = () => mudou++;
	await acao("escolherBuild", { id: b2b.id });
	ok(mudou === 1, "mudanças na árvore avisam a janela de subir de nível");
	const sub = Object.assign(new SubirNivel(real), { dados: fontes.dados, progressao, lerPreRequisito });
	ctx = await sub._prepareContext();
	ok(ctx.plano?.nome === p2b && ctx.passo === "revisao", "a janela de subir de nível vem preenchida com a build escolhida");
	// antes de subir pela build: confirmação com o nível, a build e o que ela dá; cancelar não sobe
	let pergunta = null;
	Object.assign(foundry.applications.api.DialogV2, { confirm: async (o) => { pergunta = o; return respostaConfirmar; } });
	respostaConfirmar = false;
	await SubirNivel.DEFAULT_OPTIONS.actions.aplicar.call(sub);
	ok(real.nivel === 1 && /2º nível/.test(pergunta?.content ?? "") && pergunta.content.includes(p2b) && /\+\d+ PV/.test(pergunta.content) && pergunta.content.includes(`Poder:</strong> ${p2b}`),
		"subir pela build pede confirmação (nível, build, PV/PM e o poder) e, cancelando, não sobe");
	respostaConfirmar = true;
	pergunta = null;
	await SubirNivel.DEFAULT_OPTIONS.actions.aplicar.call(sub);
	ok(real.nivel === 2 && pergunta, "confirmando, sobe");
	ctx = await plan._prepareContext();
	ok(real.nivel === 2 && ctx.nivelFicha === 2 && ctx.colunas[0].nivel === 3 && ctx.naoSeguidas.length === 1 && /escolheu Bater e Correr/.test(ctx.naoSeguidas[0].aviso),
		"depois de subir: o planejador começa no 3º e a outra build do 2º aparece como não seguida");
}

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
