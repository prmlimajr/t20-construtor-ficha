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
const regrasPoderesClasse = json("poderes-classe.json").poderes ?? {};
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
		conferir(ator.nivel === n, `${nomeClasse} ${n}: nível ficou ${ator.nivel}`);

		// desfazer no nível com mais coisas (escolha, anotação ou valor gravado) e reaplicar
		if (!desfazerTestado && (r.escolhas.length || r.anotadas.some((a) => a.jaTem) || plano.valores.length || plano.escolasMagia || n === 10)) {
			conferir(podeDesfazer(ator), `${nomeClasse} ${n}: deveria poder desfazer`);
			await desfazerUltimoNivel(ator);
			conferir(fotografia(ator) === antes, `${nomeClasse} ${n}: desfazer não restaurou a ficha`);
			conferir(!podeDesfazer(ator), `${nomeClasse} ${n}: não deveria desfazer duas vezes`);
			await aplicarNivel(ator, plano);
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
	console.log(`${titulo}: 1→20 ok · ${poderesFicha.length} poderes${qtdMagias ? ` · ${qtdMagias} magias novas` : ""} · desfazer testado no nível ${desfazerTestado || "—"}${resumo.length ? `\n    ganhos: ${resumo.join(", ")}` : ""}`);
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

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
