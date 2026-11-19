/**
 * Animação de "subiu de nível" dentro da janela do assistente, no visual do construtor (fundo vermelho,
 * faixa e faíscas douradas, título na fonte e no contorno bordô dos títulos). Dura ~1000 ms e some
 * sozinha. Com "reduzir movimento" no sistema, só o fundo e o título aparecem e somem.
 */

const DURACAO_MS = 1000;
const FAISCAS = 16;

function el(tag, classe, texto) {
	const e = document.createElement(tag);
	if (classe) e.className = classe;
	if (texto !== undefined) e.textContent = texto;
	return e;
}

/**
 * @param {object} p
 * @param {HTMLElement} p.container  elemento da janela (a animação cobre só ele)
 * @param {number} p.nivel           nível de personagem alcançado
 * @param {string} [p.detalhe]       texto menor (ex.: "Guerreiro 5 · +7 PV · +3 PM")
 * @param {string} [p.img]           ícone da classe
 */
export function animarSubidaDeNivel({ container, nivel, detalhe = "", img = "" } = {}) {
	if (!container) return;
	container.querySelector(":scope > .t20cf-levelup")?.remove();
	const raiz = el("div", "t20cf-levelup");
	raiz.setAttribute("role", "status");
	raiz.setAttribute("aria-live", "polite");

	raiz.append(el("div", "t20cf-lu-faixa"), el("div", "t20cf-lu-onda"));

	const faiscas = el("div", "t20cf-lu-faiscas");
	for (let i = 0; i < FAISCAS; i++) {
		const f = el("span");
		// posição, atraso, altura da subida e tamanho aleatórios (variáveis CSS)
		f.style.setProperty("--x", `${Math.round((Math.random() * 2 - 1) * 200)}px`);
		f.style.setProperty("--sobe", `${-Math.round(80 + Math.random() * 160)}px`);
		f.style.setProperty("--atraso", `${Math.round(Math.random() * 250)}ms`);
		f.style.setProperty("--tam", `${4 + Math.round(Math.random() * 4)}px`);
		faiscas.append(f);
	}
	raiz.append(faiscas);

	const texto = el("div", "t20cf-lu-texto");
	if (img) {
		const i = el("img", "t20cf-lu-icone");
		i.src = img;
		i.alt = "";
		texto.append(i);
	}
	texto.append(el("div", "t20cf-lu-titulo", "Subiu de nível!"), el("div", "t20cf-lu-nivel", `${nivel}º nível`));
	if (detalhe) texto.append(el("div", "t20cf-lu-detalhe", detalhe));
	raiz.append(texto);

	container.append(raiz);
	setTimeout(() => raiz.remove(), DURACAO_MS);
}
