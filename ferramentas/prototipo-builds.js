/**
 * Protótipo do planejador de builds (SDD/t20-construtor-fichas/planejador-builds/plano.md, fase P).
 * NÃO é carregado pelo módulo. Para rodar: crie uma macro do tipo Script, cole este arquivo inteiro e execute
 * (ou cole no console do navegador, F12).
 *
 * Antes: selecione o token de um personagem jogador com classe e abaixo do 20º nível
 * (ou tenha um personagem atribuído ao seu usuário).
 *
 * P1  ator temporário (não salvo) + 1 nível de classe + o poder Vitalidade, montado de duas formas:
 *     (a) a partir de uma cópia dos dados já alterada; (b) com updateSource, passo a passo.
 *     Compara com o mesmo nível aplicado de verdade numa CÓPIA TEMPORÁRIA do ator no mundo
 *     ("[protótipo] …"), que é apagada no final. O ator original não é alterado.
 * P2  monta o HTML da ficha do sistema a partir do ator temporário, sem os eventos.
 * P3  mostra esse HTML numa janela, com o estilo da ficha, botões sem ação e abas clicáveis.
 *
 * O resultado aparece no console (F12) e numa notificação. Mande um print da tabela do console e da janela.
 */
(async () => {
	const log = (...a) => console.log("%c[protótipo builds]", "color:#a33;font-weight:bold", ...a);
	const resultado = { P1a: null, P1b: null, P2: null, P3: null };

	const actor = canvas?.tokens?.controlled?.[0]?.actor ?? game.user.character;
	if (!actor || actor.type !== "character") return ui.notifications.error("Protótipo: selecione o token de um personagem jogador.");
	const classe = actor.items.find((i) => i.type === "classe");
	if (!classe) return ui.notifications.error("Protótipo: o personagem não tem classe.");
	const pack = game.packs.get("tormenta20.poderes");
	const idx = await pack.getIndex();
	const entrada = idx.find((e) => e.name === "Vitalidade");
	if (!entrada) return ui.notifications.error("Protótipo: Vitalidade não encontrado em tormenta20.poderes.");
	const vitalidade = (await pack.getDocument(entrada._id)).toObject();
	if (actor.items.some((i) => i.name.replace(/^\S+ - /, "") === "Vitalidade")) log("aviso: o personagem já tem Vitalidade; o efeito vai somar duas vezes nas três versões (comparação continua válida).");

	const ler = (a) => ({
		nivel: a.nivel ?? a.system?.attributes?.nivel?.value,
		pvMax: a.system?.attributes?.pv?.max,
		pmMax: a.system?.attributes?.pm?.max,
		defesa: a.system?.attributes?.defesa?.value,
		fortitude: a.system?.pericias?.fort?.value,
		itens: a.items.size,
		efeitos: [...(a.allApplicableEffects?.() ?? a.effects ?? [])].length
	});
	const novoNivel = Number(classe.system.niveis) + 1;
	const antes = ler(actor);

	/* ---------- P1a: ator temporário a partir dos dados já alterados ---------- */
	let virtualA = null;
	try {
		const src = actor.toObject();
		src.items.find((i) => i._id === classe.id).system.niveis = novoNivel;
		src.items.push({ ...foundry.utils.deepClone(vitalidade), _id: foundry.utils.randomID() });
		virtualA = new Actor.implementation(src);
		virtualA.reset?.();
		resultado.P1a = ler(virtualA);
	} catch (err) {
		console.error(err);
		resultado.P1a = { erro: err.message };
	}

	/* ---------- P1b: ator temporário com updateSource (como seria o adaptador) ---------- */
	try {
		const v = new Actor.implementation(actor.toObject());
		v.items.get(classe.id).updateSource({ "system.niveis": novoNivel });
		v.updateSource({ items: [...v.toObject().items, { ...foundry.utils.deepClone(vitalidade), _id: foundry.utils.randomID() }] });
		v.reset();
		resultado.P1b = ler(v);
	} catch (err) {
		console.error(err);
		resultado.P1b = { erro: err.message };
	}

	/* ---------- referência: o mesmo nível gravado de verdade numa cópia temporária ---------- */
	let real = null;
	let copia = null;
	try {
		copia = await Actor.implementation.create({ ...actor.toObject(), name: `[protótipo] ${actor.name}`, folder: null });
		await copia.items.get(classe.id).update({ "system.niveis": novoNivel });
		await copia.createEmbeddedDocuments("Item", [foundry.utils.deepClone(vitalidade)]);
		copia.reset?.();
		real = ler(copia);
	} catch (err) {
		console.error(err);
		real = { erro: err.message };
	} finally {
		await copia?.delete().catch((e) => console.error("não consegui apagar a cópia; apague à mão:", copia?.name, e));
	}

	const campos = ["nivel", "pvMax", "pmMax", "defesa", "fortitude", "itens", "efeitos"];
	console.table(Object.fromEntries(campos.map((k) => [k, { antes: antes[k], real: real?.[k], P1a: resultado.P1a?.[k], P1b: resultado.P1b?.[k] }])));
	const igual = (r) => r && !r.erro && campos.every((k) => r[k] === real?.[k]);
	const okA = igual(resultado.P1a);
	const okB = igual(resultado.P1b);
	log(`P1a ${okA ? "OK" : "DIFERENTE"} · P1b ${okB ? "OK" : "DIFERENTE"}`, { antes, real, P1a: resultado.P1a, P1b: resultado.P1b });

	/* ---------- P2: HTML da ficha sem eventos ---------- */
	let html = "";
	const ficha = virtualA ?? new Actor.implementation(actor.toObject());
	try {
		const Ficha = actor.sheet.constructor;
		const sheet = new Ficha(ficha, { editable: false });
		const dados = await sheet.getData();
		const $html = await sheet._renderInner(dados);
		html = ($html?.get?.() ?? [$html]).map((el) => el?.outerHTML ?? "").join("");
		resultado.P2 = { ok: html.length > 1000, classe: Ficha.name, tamanho: html.length };
	} catch (err) {
		console.error(err);
		resultado.P2 = { erro: err.message };
	}
	log("P2", resultado.P2);

	/* ---------- P3: a ficha numa janela, só leitura ---------- */
	if (html) {
		const classes = actor.sheet.options.classes.join(" ");
		const estilo = `
			.t20cf-prototipo { max-height: 75vh; overflow: auto; }
			.t20cf-prototipo button, .t20cf-prototipo a:not([data-tab]), .t20cf-prototipo .rollable,
			.t20cf-prototipo .item-control, .t20cf-prototipo [data-action] { pointer-events: none !important; }
			.t20cf-prototipo input, .t20cf-prototipo select, .t20cf-prototipo textarea { pointer-events: none; }
			.t20cf-prototipo .sheet-tabs [data-tab] { pointer-events: auto; cursor: pointer; }`;
		const conteudo = `<style>${estilo}</style>
			<div class="app window-app ${classes} t20cf-prototipo" style="position:static;width:auto;height:auto;box-shadow:none">
				<section class="window-content">${html}</section>
			</div>`;
		try {
			await foundry.applications.api.DialogV2.prompt({
				window: { title: `Prévia (protótipo): ${actor.name} no ${novoNivel}º nível de ${classe.name}`, resizable: true },
				position: { width: 900 },
				content: conteudo,
				ok: { label: "Fechar" },
				render: (event, dialog) => {
					const raiz = (dialog?.element ?? event?.target?.element)?.querySelector(".t20cf-prototipo");
					if (!raiz) return;
					raiz.querySelectorAll("input, select, textarea").forEach((el) => { el.disabled = true; });
					// abas com controle próprio (sem os listeners da ficha)
					raiz.addEventListener("click", (ev) => {
						const aba = ev.target.closest(".sheet-tabs [data-tab]");
						if (!aba) return;
						ev.preventDefault();
						const grupo = aba.closest(".sheet-tabs");
						const nome = aba.dataset.tab;
						grupo.querySelectorAll("[data-tab]").forEach((x) => x.classList.toggle("active", x.dataset.tab === nome));
						raiz.querySelectorAll(".sheet-body .tab[data-tab]").forEach((x) => x.classList.toggle("active", x.dataset.tab === nome));
					});
					const primeira = raiz.querySelector(".sheet-tabs [data-tab]");
					if (primeira && !raiz.querySelector(".sheet-body .tab.active")) primeira.click();
					resultado.P3 = { ok: true, abas: raiz.querySelectorAll(".sheet-tabs [data-tab]").length };
					log("P3", resultado.P3, "→ confira: visual igual ao da ficha, cliques sem efeito, abas trocando.");
				}
			});
		} catch (err) {
			console.error(err);
			resultado.P3 = { erro: err.message };
		}
	}

	log("resumo", resultado);
	ui.notifications.info(`Protótipo: P1a ${okA ? "OK" : "diferente"}, P1b ${okB ? "OK" : "diferente"}, P2 ${resultado.P2?.ok ? "OK" : "falhou"}, P3 ${resultado.P3?.ok ? "abriu" : "não abriu"}. Detalhes no console (F12).`);
	return resultado;
})();
