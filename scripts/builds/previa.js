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
	// as classes da janela da ficha (com as de tema, se a ficha do ator estiver aberta)
	const abertas = String(real.sheet?.element?.[0]?.className ?? real.sheet?.element?.className ?? "").split(/\s+/);
	const classes = [...new Set([...(sheet.options?.classes ?? []), ...abertas].filter((c) => c && !["minimized", "t20cf-previa-janela"].includes(c)))];
	return { html, classes: classes.join(" ") };
}

/**
 * Documento (srcdoc) do iframe da prévia: a ficha do sistema com os estilos da página (Foundry, sistema e
 * módulos), mas fora da janela do construtor, para que o CSS dele não mude as cores da ficha. Campos e botões
 * ficam sem ação; as abas são trocadas pela janela do planejador.
 */
export function documentoDaPrevia({ html, classes = "" }) {
	const estilos = [...document.querySelectorAll('link[rel="stylesheet"], style')].map((el) => el.outerHTML).join("\n");
	const raiz = document.documentElement;
	const atr = (t) => esc(t ?? "");
	return `<!doctype html>
<html class="${atr(raiz.className)}" lang="${atr(raiz.lang)}">
<head>
<meta charset="utf-8">
<base href="${atr(document.baseURI)}">
${estilos}
<style>
/* a janela da ficha ocupa o quadro inteiro: o corpo da ficha (.sheet-body, com altura relativa) rola por dentro, como na ficha normal */
html, body { height: 100% !important; min-height: 0 !important; overflow: hidden !important; background: transparent !important; margin: 0 !important; padding: 0 !important; }
.t20cf-previa-janela { position: relative !important; inset: auto !important; width: 100% !important; height: 100% !important; max-height: none !important; min-height: 0 !important; margin: 0 !important; transform: none !important; box-shadow: none !important; display: flex !important; flex-direction: column !important; }
.t20cf-previa-janela > .window-content { flex: 1 !important; height: 100% !important; min-height: 0 !important; overflow: hidden !important; }
.t20cf-previa-janela > .window-content > form { height: 100% !important; }
.t20cf-previa-janela button, .t20cf-previa-janela a:not([data-tab]), .t20cf-previa-janela .rollable, .t20cf-previa-janela .item-control,
.t20cf-previa-janela [data-action], .t20cf-previa-janela input, .t20cf-previa-janela select, .t20cf-previa-janela textarea { pointer-events: none !important; }
.t20cf-previa-janela .sheet-tabs [data-tab] { pointer-events: auto !important; cursor: pointer; }
</style>
</head>
<body class="${atr(document.body?.className)}">
<div class="${atr(`app window-app ${classes} t20cf-previa-janela`)}"><section class="window-content">${html}</section></div>
</body>
</html>`;
}

/**
 * Deixa a ficha do iframe só leitura e só com a aba principal (a da ficha: "attributes"; sem Diário, Modificadores
 * e Efeitos). Se a ficha tiver outras abas de conteúdo (layouts com abas), elas continuam, trocadas sem os eventos da ficha.
 */
export function prepararIframeDaPrevia(iframe) {
	const doc = iframe?.contentDocument;
	const raiz = doc?.querySelector(".t20cf-previa-janela");
	if (!raiz) return;
	raiz.querySelectorAll("input, select, textarea").forEach((el) => { el.disabled = true; });
	esconderAbas(raiz);
	raiz.addEventListener("click", (ev) => {
		const aba = ev.target.closest(".sheet-tabs [data-tab]");
		if (!aba) return;
		ev.preventDefault();
		const nome = aba.dataset.tab;
		aba.closest(".sheet-tabs").querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x.dataset.tab === nome));
		raiz.querySelectorAll(".sheet-body .tab[data-tab]").forEach((x) => x.classList.toggle("active", x.dataset.tab === nome));
	});
	if (!raiz.querySelector(".sheet-body .tab.active")) raiz.querySelector(".sheet-tabs [data-tab]")?.click();
}

/** Abas que não entram na prévia (só a ficha em si). */
export const ABAS_FORA_DA_PREVIA = ["journal", "modifiers", "effects", "biography", "notes"];

/** Tira da prévia as abas de Diário, Modificadores e Efeitos (o botão e o conteúdo) e deixa a principal ativa. */
export function esconderAbas(raiz) {
	for (const nome of ABAS_FORA_DA_PREVIA) {
		raiz.querySelectorAll(`.sheet-tabs [data-tab="${nome}"], .sheet-body .tab[data-tab="${nome}"]`).forEach((el) => el.remove());
	}
	const principal = raiz.querySelector('.sheet-body .tab[data-tab="attributes"]') ?? raiz.querySelector(".sheet-body .tab[data-tab]");
	if (principal && !raiz.querySelector(".sheet-body .tab.active")) {
		principal.classList.add("active");
		raiz.querySelector(`.sheet-tabs [data-tab="${principal.dataset.tab}"]`)?.classList.add("active");
	}
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
