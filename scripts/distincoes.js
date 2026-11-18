/**
 * Distinções (Heróis de Arton / Deuses de Arton, compêndio "Distinções" do Suplementos de Arton).
 * Os poderes de uma distinção só podem ser escolhidos por quem tem a marca dela ("… (Marca)").
 * A distinção de um poder é a pasta logo abaixo da raiz do compêndio: "Distinções - HdA / Mestre
 * Cozinheiro / Ingredientes Monstruosos" → "Mestre Cozinheiro" (o subtipo nem sempre é o nome dela).
 * Funções puras, sem Foundry.
 */
const RE_MARCA = /\(marca\)\s*$/i;

export function ehMarca(poder) {
	return RE_MARCA.test(poder?.name ?? "");
}

/**
 * @param {{uuid: string, name: string, pasta: string, subtipo?: string}[]} poderes  poderes do compêndio de distinções
 * @returns {{porPoder: Map<string, string>, marcas: Map<string, string[]>}}
 *   porPoder: uuid → distinção; marcas: distinção → nomes das marcas
 */
export function indexarDistincoes(poderes) {
	const porPoder = new Map();
	const marcas = new Map();
	for (const p of poderes) {
		const partes = String(p.pasta ?? "").split(" / ").map((s) => s.trim()).filter(Boolean);
		const distincao = partes[1] ?? p.subtipo ?? partes[0];
		if (!distincao) continue;
		porPoder.set(p.uuid, distincao);
		if (RE_MARCA.test(p.name)) {
			if (!marcas.has(distincao)) marcas.set(distincao, []);
			marcas.get(distincao).push(p.name);
		}
	}
	return { porPoder, marcas };
}

/** Distinção a que o poder pertence, ou null. */
export function distincaoDoPoder(dados, poder) {
	return dados.distincoes?.porPoder?.get(poder?.uuid) ?? null;
}

/**
 * O poder pode aparecer numa lista de escolha? Poderes que não são de distinção sempre podem.
 * As marcas nunca aparecem (entrar numa distinção não é uma escolha de poder comum).
 * @param {(nome: string) => boolean} temPoder  a ficha tem o poder? (na criação: ninguém tem marca)
 */
export function poderDistincaoPermitido(dados, poder, temPoder = () => false) {
	const distincao = distincaoDoPoder(dados, poder);
	if (!distincao) return true;
	if (ehMarca(poder)) return false;
	return (dados.distincoes.marcas.get(distincao) ?? []).some((m) => temPoder(m));
}

/** Poderes de distinção que entram na lista de poderes gerais (todos menos as marcas). */
export function ehPoderDeDistincao(dados, poder) {
	return !!distincaoDoPoder(dados, poder) && poder.type === "poder" && !ehMarca(poder) && ["geral", "distincao"].includes(poder.system?.tipo);
}
