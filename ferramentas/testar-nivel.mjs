/**
 * Teste da subida de nível fora do Foundry, com os compêndios do sistema lidos do disco.
 * Uso: node ferramentas/testar-nivel.mjs [caminho do repositório Tormenta20] [Classe]
 * (padrão: ../Tormenta20 e Guerreiro). Não entra no module.zip.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizar } from "../scripts/regras.js";
import { lerFicha } from "../scripts/ficha-atual.js";
import { montarNivel, criarLeitorPreRequisitos } from "../scripts/nivel.js";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raizModulo = path.resolve(aqui, "..");
const raizSistema = path.resolve(process.argv[2] ?? path.join(raizModulo, "../Tormenta20"));
const NOME_CLASSE = process.argv[3] ?? "Guerreiro";

function lerPack(nome) {
	const dir = path.join(raizSistema, "src/packs", nome);
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
	andar(dir);
	return out;
}

const json = (f) => JSON.parse(fs.readFileSync(path.join(raizModulo, "data", f), "utf8"));
const poderes = lerPack("poderes");
const dados = {
	poderes,
	poderesPorNome: new Map(poderes.map((p) => [normalizar(p.name), p])),
	classes: lerPack("classes"),
	magias: lerPack("magias")
};
const progressao = json("progressao.json");
const regrasClasses = json("classes.json");
const lerPreRequisito = criarLeitorPreRequisitos(dados, json("pre-requisitos.json"));

let falhas = 0;
const conferir = (cond, msg) => {
	if (!cond) {
		falhas++;
		console.log(`  ✗ ${msg}`);
	}
};

/* ---------- 1. Pré-requisitos não reconhecidos (todos os poderes de classe e gerais) ---------- */
const naoReconhecidos = [];
for (const p of poderes.filter((p) => ["classe", "geral"].includes(p.system?.tipo))) {
	const req = lerPreRequisito(p);
	if (req?.naoReconhecidos.length) naoReconhecidos.push(`${p.system.subtipo} · ${p.name}: ${req.naoReconhecidos.join(" | ")}`);
}
console.log(`Pré-requisitos não reconhecidos (viram aviso, não bloqueiam): ${naoReconhecidos.length}`);
for (const l of naoReconhecidos) console.log(`  · ${l}`);

/* ---------- 2. Ficha simulada subindo do 1 ao 20 ---------- */
const classeDoc = dados.classes.find((c) => c.name === NOME_CLASSE);
const ator = {
	items: [{ _id: "classe", type: "classe", name: NOME_CLASSE, system: { niveis: 1, inicial: true } }],
	system: {
		atributos: { for: { value: 3 }, des: { value: 2 }, con: { value: 2 }, int: { value: 1 }, sab: { value: 0 }, car: { value: -1 } },
		pericias: { luta: { treinado: true }, fort: { treinado: true }, guer: { treinado: true }, atle: { treinado: true } },
		tracos: {}
	}
};
for (const h of progressao[NOME_CLASSE]?.niveis?.["1"]?.habilidades ?? []) {
	ator.items.push({ type: "poder", name: `1 - ${h}`, system: { tipo: "ability", subtipo: NOME_CLASSE } });
}
conferir(classeDoc, `classe ${NOME_CLASSE} existe no compêndio`);

console.log(`\n${NOME_CLASSE} (For 3, Des 2, Con 2, Int 1; treinado em Luta, Fortitude, Guerra, Atletismo):`);
for (let n = 2; n <= 21; n++) {
	const ficha = lerFicha(ator, { regrasClasses });
	const classe = ficha.classes[0];
	const r = montarNivel({ dados, progressao, ficha, classe, lerPreRequisito });
	if (n === 21) {
		conferir(r.erro === "nivelMaximo", "nível 21 deve ser recusado");
		break;
	}
	conferir(!r.erro, `nível ${n}: ${r.erro}`);
	if (r.erro) break;
	r.avisos.forEach((a) => conferir(false, a));
	const disponiveis = r.poderesClasse.filter((o) => o.disponivel);
	// escolhe o primeiro disponível que ainda não estava liberado no nível anterior, para exercitar pré-requisitos
	const escolha = disponiveis.find((o) => o.preRequisito) ?? disponiveis[0];
	const habil = r.habilidades.map((h) => h.nome + (h.valor ? ` ${h.valor}` : "")).join(", ");
	const vals = r.valores.map((v) => `${v.nome} ${v.de} → ${v.para}`).join(", ");
	console.log(`  ${String(n).padStart(2)}: ${habil || "—"}${vals ? ` | ${vals}` : ""} | poderes disponíveis ${disponiveis.length}/${r.poderesClasse.length}, gerais ${r.poderesGerais.filter((o) => o.disponivel).length} | escolhe: ${escolha?.nome ?? "—"}${escolha?.preRequisito ? ` (pré: ${escolha.preRequisito})` : ""}`);
	if (r.ganhaPoder) conferir(escolha, `nível ${n}: nenhum poder disponível`);

	// aplica na ficha simulada
	ator.items[0].system.niveis++;
	for (const h of r.habilidades) ator.items.push({ type: "poder", name: `${n} - ${h.nome}`, system: h.doc?.system ?? {} });
	if (escolha) ator.items.push({ type: "poder", name: `${n} - ${escolha.nome}`, system: escolha.doc.system });
}

/* ---------- 3. Casos de pré-requisito conhecidos ---------- */
console.log("\nCasos de pré-requisito:");
const caso = (nomePoder, mutar, esperado) => {
	const doc = dados.poderesPorNome.get(normalizar(nomePoder));
	const a = structuredClone(ator);
	a.items = [{ _id: "classe", type: "classe", name: NOME_CLASSE, system: { niveis: 1, inicial: true } }];
	mutar(a);
	const ficha = lerFicha(a, { regrasClasses });
	const r = montarNivel({ dados, progressao, ficha, classe: ficha.classes[0], lerPreRequisito });
	const op = [...r.poderesClasse, ...r.poderesGerais].find((o) => o.doc === doc);
	const ok = op?.disponivel === esperado;
	conferir(ok, `${nomePoder}: esperado ${esperado ? "disponível" : "bloqueado"}, veio ${op?.disponivel} (${op?.motivo ?? "sem motivo"})`);
	if (ok) console.log(`  ✓ ${nomePoder} ${esperado ? "disponível" : `bloqueado — ${op.motivo}`}`);
};
caso("Ambidestria (Guerreiro)", (a) => (a.system.atributos.des.value = 1), false);
caso("Ambidestria (Guerreiro)", (a) => (a.system.atributos.des.value = 2), true);
caso("Golpe Pessoal", (a) => (a.items[0].system.niveis = 3), false);
caso("Golpe Pessoal", (a) => (a.items[0].system.niveis = 4), true); // atinge o 5º neste nível
caso("Planejamento Marcial", (a) => (a.items[0].system.niveis = 9), true);
caso("Planejamento Marcial", (a) => { a.items[0].system.niveis = 9; delete a.system.pericias.guer; }, false);
caso("Mestre em Arma", (a) => (a.items[0].system.niveis = 11), false);
caso("Mestre em Arma", (a) => { a.items[0].system.niveis = 11; a.items.push({ type: "poder", name: "3 - Especialização em Arma", system: {} }); }, true);
caso("Especialização em Arma", (a) => a.items.push({ type: "poder", name: "2 - Especialização em Arma", system: {} }), true); // repetível
caso("Bater e Correr", (a) => a.items.push({ type: "poder", name: "2 - Bater e Correr", system: {} }), false); // já tem
caso("Encouraçado", () => {}, true); // proficiência com armaduras pesadas (classes.json)
caso("Fanático", (a) => (a.items[0].system.niveis = 11), false);

console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
process.exit(falhas ? 1 : 0);
