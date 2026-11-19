/**
 * Animação de "subiu de nível" no estilo MMO: clarão, coluna de luz, raios girando, onda de choque,
 * faíscas subindo e o título dourado. Só para quem subiu o nível; dura ~3 s e some sozinha
 * (clicar fecha antes). Com "reduzir movimento" no sistema, só o título aparece e some.
 */

const DURACAO_MS = 3200;
const FAISCAS = 36;

function el(tag, classe, texto) {
	const e = document.createElement(tag);
	if (classe) e.className = classe;
	if (texto !== undefined) e.textContent = texto;
	return e;
}

/**
 * @param {object} p { nivel: número do nível de personagem alcançado, detalhe: texto menor (ex.: "Guerreiro 5"), img }
 */
export function animarSubidaDeNivel({ nivel, detalhe = "", img = "" } = {}) {
	document.querySelector(".t20cf-levelup")?.remove();
	const raiz = el("div", "t20cf-levelup");
	raiz.setAttribute("role", "status");
	raiz.setAttribute("aria-live", "polite");

	raiz.append(el("div", "t20cf-lu-clarao"), el("div", "t20cf-lu-raios"), el("div", "t20cf-lu-coluna"), el("div", "t20cf-lu-onda"));

	const faiscas = el("div", "t20cf-lu-faiscas");
	for (let i = 0; i < FAISCAS; i++) {
		const f = el("span");
		// posição, atraso, duração, deriva lateral e tamanho aleatórios (via variáveis CSS)
		f.style.setProperty("--x", `${(Math.random() * 2 - 1) * 26}vw`);
		f.style.setProperty("--deriva", `${(Math.random() * 2 - 1) * 8}vw`);
		f.style.setProperty("--atraso", `${Math.random() * 0.9}s`);
		f.style.setProperty("--dur", `${1.4 + Math.random() * 1.2}s`);
		f.style.setProperty("--tam", `${3 + Math.random() * 5}px`);
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
	texto.append(el("div", "t20cf-lu-titulo", "Subiu de nível!"));
	texto.append(el("div", "t20cf-lu-nivel", `${nivel}º nível`));
	if (detalhe) texto.append(el("div", "t20cf-lu-detalhe", detalhe));
	raiz.append(texto);

	let fechado = false;
	const fechar = () => {
		if (fechado) return;
		fechado = true;
		raiz.classList.add("saindo");
		setTimeout(() => raiz.remove(), 450);
	};
	raiz.addEventListener("click", fechar);
	document.body.append(raiz);
	setTimeout(fechar, DURACAO_MS);
}
