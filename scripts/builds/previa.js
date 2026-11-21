/**
 * Prévia da ficha de uma build (planejador de builds), só leitura.
 *
 * 1º: a ficha do próprio sistema (AppV1), montada sobre o documento da ficha virtual com getData() e
 *     _renderInner(): o HTML sai sem activateListeners, então nenhum botão tem ação.
 * 2º (se a 1ª falhar ou não existir): uma ficha resumida própria (atributos, PV, PM, Defesa, perícias
 *     treinadas, poderes e magias), montada com lerFicha e os dados preparados da ficha virtual.
 */
import { lerFicha, nomeBase } from "../ficha-atual.js";
import { variantesDe } from "../nivel.js";

const esc = (t) => String(t ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NOMES_ATRIBUTOS = { for: "Força", des: "Destreza", con: "Constituição", int: "Inteligência", sab: "Sabedoria", car: "Carisma" };
const sinal = (n) => (Number(n) >= 0 ? `+${Number(n)}` : `${Number(n)}`);

/**
 * @param {AtorVirtual} virtual  a ficha virtual no nível da build
 * @param {Actor} real           o ator real (dá a classe da ficha do sistema)
 * @param {object} fontes        { dados, progressao }
 * @returns {Promise<{tipo: "sistema"|"resumo", html: string, classes?: string, erro?: string}>}
 */
export async function previaDaFicha(virtual, real, fontes) {
	let erro = null;
	try {
		const r = await fichaDoSistema(virtual, real);
		if (r) return { tipo: "sistema", ...r };
	} catch (err) {
		console.warn("t20-construtor-ficha | prévia: a ficha do sistema não montou; usando a ficha resumida.", err);
		erro = err.message;
	}
	return { tipo: "resumo", html: fichaResumida(virtual, fontes), ...(erro ? { erro } : {}) };
}

/** HTML da ficha do sistema sem eventos, ou null se a ficha não for AppV1. */
async function fichaDoSistema(virtual, real) {
	const Ficha = real?.sheet?.constructor;
	if (!Ficha?.prototype?._renderInner || !Ficha.prototype.getData || !virtual?.doc) return null;
	const sheet = new Ficha(virtual.doc, { editable: false });
	const dados = await sheet.getData();
	const $html = await sheet._renderInner(dados);
	const html = ($html?.get?.() ?? [$html]).map((el) => el?.outerHTML ?? "").join("");
	if (html.length < 500) return null;
	return { html, classes: (sheet.options?.classes ?? []).join(" ") };
}

/** Ficha resumida própria (plano B). */
export function fichaResumida(virtual, { dados, progressao } = {}) {
	const ficha = lerFicha(virtual, { regrasClasses: dados?.regrasClasses ?? {}, variantes: variantesDe(progressao, dados?.variantes) });
	const sys = virtual.system ?? {};
	const at = sys.attributes ?? {};
	const pericias = Object.entries(sys.pericias ?? {})
		.filter(([, p]) => p?.treinado)
		.map(([k, p]) => {
			const cfg = globalThis.CONFIG?.T20?.pericias?.[k];
			const rotulo = cfg?.label ? globalThis.game?.i18n?.localize?.(cfg.label) ?? cfg.label : k;
			return { nome: rotulo, valor: p.value };
		})
		.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
	const itens = [...virtual.items];
	const porSort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name, "pt-BR");
	const poderes = itens.filter((i) => i.type === "poder").sort(porSort);
	const magias = itens.filter((i) => i.type === "magia")
		.map((m) => ({ nome: nomeBase(m.name), circulo: Number(m.system?.circulo) || 0 }))
		.sort((a, b) => a.circulo - b.circulo || a.nome.localeCompare(b.nome, "pt-BR"));
	const porCirculo = new Map();
	for (const m of magias) (porCirculo.get(m.circulo) ?? porCirculo.set(m.circulo, []).get(m.circulo)).push(m.nome);

	const valor = (v) => (v === undefined || v === null || v === "" ? "—" : esc(v));
	const blocos = [];
	blocos.push(`<header class="cf-previa-topo">
		<h3>${esc(virtual.name)}</h3>
		<p>${ficha.classes.map((c) => `${esc(c.nome)} ${c.niveis}`).join(" / ")} · ${ficha.nivel}º nível</p>
	</header>`);
	blocos.push(`<div class="cf-previa-numeros">
		<div><span>PV</span><strong>${valor(at.pv?.max)}</strong></div>
		<div><span>PM</span><strong>${valor(at.pm?.max)}</strong></div>
		<div><span>Defesa</span><strong>${valor(at.defesa?.value)}</strong></div>
	</div>`);
	blocos.push(`<section><h4>Atributos</h4><div class="cf-previa-atributos">${Object.entries(NOMES_ATRIBUTOS)
		.map(([k, nome]) => `<div><span>${nome}</span><strong>${sinal(sys.atributos?.[k]?.value ?? 0)}</strong></div>`).join("")}</div></section>`);
	if (pericias.length) {
		blocos.push(`<section><h4>Perícias treinadas</h4><ul class="cf-previa-lista">${pericias
			.map((p) => `<li>${esc(p.nome)}${p.valor !== undefined ? ` <strong>${esc(sinal(p.valor))}</strong>` : ""}</li>`).join("")}</ul></section>`);
	}
	blocos.push(`<section><h4>Poderes e habilidades (${poderes.length})</h4><ul class="cf-previa-lista">${poderes
		.map((p) => `<li>${esc(p.name)}</li>`).join("")}</ul></section>`);
	if (magias.length) {
		blocos.push(`<section><h4>Magias (${magias.length})</h4>${[...porCirculo.entries()]
			.map(([c, nomes]) => `<p><strong>${c}º círculo:</strong> ${nomes.map(esc).join(", ")}</p>`).join("")}</section>`);
	}
	return `<div class="cf-previa-resumo">${blocos.join("\n")}</div>`;
}
