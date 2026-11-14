/**
 * Carrega e indexa os dados usados pelo construtor: compêndios do sistema Tormenta20
 * + arquivos JSON do módulo (regras de classe, origens, divindades, equipamento).
 */
import { MODULE_ID, normalizar } from "./regras.js";

const PACKS = {
	racas: "tormenta20.racas",
	classes: "tormenta20.classes",
	poderes: "tormenta20.poderes",
	magias: "tormenta20.magias",
	equipamentos: "tormenta20.equipamentos"
};

let cache = null;

async function lerJson(arquivo) {
	const resp = await fetch(`modules/${MODULE_ID}/data/${arquivo}`);
	if (!resp.ok) throw new Error(`${MODULE_ID} | não foi possível ler data/${arquivo}`);
	return resp.json();
}

async function documentos(chave) {
	const pack = game.packs.get(PACKS[chave]);
	if (!pack) {
		console.warn(`${MODULE_ID} | compêndio ${PACKS[chave]} não encontrado`);
		return [];
	}
	return pack.getDocuments();
}

function porNome(docs) {
	const mapa = new Map();
	for (const d of docs) {
		const k = normalizar(d.name);
		if (!mapa.has(k)) mapa.set(k, d);
	}
	return mapa;
}

export async function carregarDados() {
	if (cache) return cache;

	const [racas, classes, poderes, magias, regrasClasses, origens, regionais, divindades, equipamento] =
		await Promise.all([
			documentos("racas"),
			documentos("classes"),
			documentos("poderes"),
			documentos("magias"),
			lerJson("classes.json"),
			lerJson("origens.json"),
			lerJson("origens-regionais.json"),
			lerJson("divindades.json"),
			lerJson("equipamento.json")
		]);

	const packEquip = game.packs.get(PACKS.equipamentos);
	const indiceEquip = packEquip ? await packEquip.getDocuments() : [];

	const ordenar = (a, b) => a.name.localeCompare(b.name, "pt-BR");

	cache = {
		racas: [...racas].sort(ordenar),
		classes: [...classes].sort(ordenar),
		magias: [...magias].sort(ordenar),
		poderes,
		poderesPorNome: porNome(poderes),
		equipPorNome: new Map([...indiceEquip].map((e) => [normalizar(e.name), e])),
		armas: [...indiceEquip].filter((e) => e.type === "arma" && e.system?.proficiencia).sort(ordenar),
		packEquip,
		regrasClasses,
		origens: origens.origens ?? [],
		origensRegionais: regionais.origens ?? [],
		divindades: divindades.divindades ?? [],
		equipamento
	};
	verificarReferencias(cache);
	return cache;
}

/** Busca um poder pelo nome; avisa no console quando o nome não existe no compêndio. */
export function poder(dados, nome) {
	return dados.poderesPorNome.get(normalizar(nome)) ?? null;
}

/** Poderes gerais de um grupo (Combate, Destino, Magia, Tormenta). */
export function poderesDoGrupo(dados, grupo) {
	const g = normalizar(grupo);
	return dados.poderes
		.filter((p) => p.system.tipo === "geral" && normalizar(p.system.subtipo) === g)
		.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

export function equipamento(dados, nome) {
	return dados.equipPorNome.get(normalizar(nome)) ?? null;
}

/** Avisa (só para o mestre) sobre nomes dos JSONs que não existem nos compêndios. */
function verificarReferencias(d) {
	if (!game.user.isGM) return;
	const faltando = new Set();
	const checarPoder = (n) => { if (!poder(d, n)) faltando.add(`poder "${n}"`); };
	const checarEquip = (n) => { if (!equipamento(d, n)) faltando.add(`item "${n}"`); };

	for (const [classe, r] of Object.entries(d.regrasClasses)) {
		if (classe.startsWith("_")) continue;
		r.habilidades?.forEach(checarPoder);
		r.escolhas?.forEach((e) => e.opcoes.forEach((o) => checarPoder(o.poder)));
		r.equipamentoExtra?.forEach(checarEquip);
	}
	for (const o of [...d.origens, ...d.origensRegionais]) {
		o.poderes?.forEach(checarPoder);
		for (const it of o.itens ?? []) {
			if (typeof it === "string") checarEquip(it);
			else if (it.nome) checarEquip(it.nome);
			else if (it.escolha) it.escolha.forEach(checarEquip);
		}
	}
	for (const div of d.divindades) div.poderes.forEach(checarPoder);
	d.equipamento.kitBase?.forEach(checarEquip);
	Object.values(d.equipamento.armaduras ?? {}).flat().forEach(checarEquip);
	if (d.equipamento.escudo) checarEquip(d.equipamento.escudo);

	if (faltando.size) {
		console.warn(`${MODULE_ID} | referências não encontradas nos compêndios (serão criadas como itens simples ou ignoradas):`, [...faltando]);
	}
}
