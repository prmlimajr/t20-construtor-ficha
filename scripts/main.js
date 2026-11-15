/**
 * T20 — Construtor de Ficha
 *
 * Wizard passo a passo para criar personagens de nível 1 de Tormenta20:
 * raça → atributos → classe → magias → perícias → origem → devoção → equipamento → dinheiro.
 *
 * - Abre sozinho ao criar um ator do tipo "personagem" (configurável).
 * - Botão "Criar personagem (wizard)" no diretório de Atores.
 * - Botão "Construtor" no cabeçalho da ficha para retomar um rascunho.
 */
import { MODULE_ID } from "./regras.js";
import { ConstrutorFicha, TEMPLATES_PASSOS } from "./wizard.js";
import { invalidarDados, carregarDados } from "./dados.js";
import { CONTEUDOS_SUPLEMENTO, SUPLEMENTO_ID } from "./suplementos.js";

const L = (k) => game.i18n.localize(`T20CF.${k}`);

/* ---------------- Configurações ---------------- */

function registrarConfiguracoes() {
	const s = (chave, extra) => game.settings.register(MODULE_ID, chave, {
		name: `T20CF.Config.${chave}.Nome`,
		hint: `T20CF.Config.${chave}.Dica`,
		scope: "world",
		config: true,
		...extra
	});
	s("abrirAoCriar", { type: Boolean, default: true });
	s("modoPontos", { type: Boolean, default: true });
	s("modoRolagem", { type: Boolean, default: true });
	s("modoFixo", { type: Boolean, default: true });
	s("atributosVariados", { type: Boolean, default: false });
	s("atributosClassicaEmOrdem", { type: Boolean, default: false });
	s("origemDupla", { type: Boolean, default: false });
	s("beneficiosOrigemDupla", {
		type: Number, default: 1,
		range: { min: 1, max: 2, step: 1 }
	});

	// Suplementos de Arton: chave geral (desligada por padrão) e uma por tipo de conteúdo.
	// Mudar qualquer uma descarta os dados carregados; o próximo construtor aberto relê tudo.
	const recarregar = () => invalidarDados();
	s("suplementos", { type: Boolean, default: false, onChange: recarregar });
	for (const chave of CONTEUDOS_SUPLEMENTO) s(`sup${chave}`, { type: Boolean, default: true, onChange: recarregar });
}

/* ---------------- Abertura ---------------- */

export function abrirConstrutor(actor) {
	const existente = foundry.applications.instances.get(`t20cf-${actor.id}`);
	if (existente) {
		existente.render({ force: true });
		existente.bringToFront?.();
		return existente;
	}
	return new ConstrutorFicha(actor).render({ force: true });
}

async function criarPersonagem() {
	if (!game.user.can("ACTOR_CREATE")) {
		return ui.notifications.warn(L("SemPermissao"));
	}
	await Actor.implementation.create(
		{ name: L("NovoPersonagem"), type: "character" },
		{ renderSheet: false, [MODULE_ID]: { abrir: true } }
	);
}

function jaConstruido(actor) {
	return actor.items.some((i) => i.type === "race" || i.type === "classe");
}

/* ---------------- Supressão do diálogo de raça do sistema ---------------- */

/**
 * Ao adicionar uma raça, o sistema abre o diálogo "Atributos Dinâmicos" e importa
 * os poderes raciais. Quando a raça vem do construtor (flag), o construtor já fez
 * essas escolhas, então pulamos esse fluxo.
 */
function envolverRacaDoSistema() {
	const proto = CONFIG.Item.documentClass?.prototype;
	if (!proto || typeof proto._onCreateOwnedRace !== "function") {
		console.warn(`${MODULE_ID} | _onCreateOwnedRace não encontrado — o sistema pode abrir o diálogo de atributos da raça ao finalizar.`);
		return;
	}
	const original = proto._onCreateOwnedRace;
	proto._onCreateOwnedRace = async function (...args) {
		if (this.flags?.[MODULE_ID]?.construtor) return {};
		return original.apply(this, args);
	};
}

/* ---------------- Hooks ---------------- */

Hooks.once("init", () => {
	registrarConfiguracoes();
	foundry.applications.handlebars.loadTemplates(TEMPLATES_PASSOS);
});

// Pré-carregamento: alguns segundos depois de o mundo abrir, carrega os compêndios em segundo
// plano para que a primeira abertura do construtor já encontre tudo pronto. Só para quem pode
// criar personagens.
Hooks.once("ready", () => {
	if (!game.user.can("ACTOR_CREATE")) return;
	setTimeout(() => {
		carregarDados().catch((err) => console.warn(`${MODULE_ID} | pré-carregamento falhou (o construtor tenta de novo ao abrir):`, err));
	}, 5000);
});

// Aviso ao mestre: integração ligada, mas o módulo Suplementos de Arton não está ativo
Hooks.once("ready", () => {
	if (!game.user.isGM || !game.settings.get(MODULE_ID, "suplementos")) return;
	if (!game.modules.get(SUPLEMENTO_ID)?.active) {
		ui.notifications.warn(L("SuplementoInativo"));
	}
});

Hooks.once("setup", () => {
	envolverRacaDoSistema();
	game.modules.get(MODULE_ID).api = { abrir: abrirConstrutor, criarPersonagem };
});

Hooks.on("createActor", (actor, options, userId) => {
	if (userId !== game.userId || actor.type !== "character") return;
	const forcado = options?.[MODULE_ID]?.abrir;
	if (!forcado) {
		if (!game.settings.get(MODULE_ID, "abrirAoCriar")) return;
		// não abre para atores importados de compêndio, duplicados ou já montados
		if (actor._stats?.compendiumSource || actor._stats?.duplicateSource || options?.fromCompendium) return;
	}
	if (jaConstruido(actor)) return;
	abrirConstrutor(actor);
});

Hooks.on("renderActorDirectory", (app, html) => {
	const root = html instanceof HTMLElement ? html : html?.[0];
	if (!root || root.querySelector(".t20cf-criar")) return;
	if (!game.user.can("ACTOR_CREATE")) return;
	const destino = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
	if (!destino) return;
	const botao = document.createElement("button");
	botao.type = "button";
	botao.className = "t20cf-criar";
	botao.innerHTML = `<i class="fa-solid fa-hat-wizard"></i> ${L("CriarPersonagem")}`;
	botao.addEventListener("click", (ev) => {
		ev.preventDefault();
		criarPersonagem();
	});
	destino.append(botao);
});

/* Ficha do sistema (ApplicationV1): botão no cabeçalho */
Hooks.on("getActorSheetHeaderButtons", (sheet, buttons) => {
	const actor = sheet.actor;
	if (!actor || actor.type !== "character" || !actor.isOwner || jaConstruido(actor)) return;
	buttons.unshift({
		label: L("Construtor"),
		class: "t20cf-abrir",
		icon: "fa-solid fa-hat-wizard",
		onclick: () => abrirConstrutor(actor)
	});
});

/* Caso a ficha seja ApplicationV2 numa versão futura do sistema */
Hooks.on("getHeaderControlsActorSheetV2", (sheet, controls) => {
	const actor = sheet.document;
	if (!actor || actor.type !== "character" || !actor.isOwner || jaConstruido(actor)) return;
	controls.unshift({
		label: L("Construtor"),
		icon: "fa-solid fa-hat-wizard",
		action: "t20cfAbrir",
		onClick: () => abrirConstrutor(actor)
	});
});
