/**
 * Extrai os compêndios (LevelDB) do Suplementos de Arton para ferramentas/.cache/suplemento.json,
 * lido por testar-nivel.mjs. Copia os packs para uma pasta temporária antes de abrir (o LevelDB
 * grava arquivos de controle ao abrir; o repositório do suplemento fica intocado).
 *
 * Uso: (cd ferramentas && npm install) && node ferramentas/extrair-suplemento.mjs [caminho do repositório Suplementos-de-Arton]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClassicLevel } from "classic-level";

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.resolve(process.argv[2] ?? path.join(aqui, "../../Suplementos-de-Arton"));
const modulo = JSON.parse(fs.readFileSync(path.join(raiz, "module.json"), "utf8"));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "t20cf-sup-"));

const itens = [];
const pastas = [];
for (const pack of modulo.packs.filter((p) => p.type === "Item")) {
	const origem = path.join(raiz, pack.path);
	const copia = path.join(temp, pack.name);
	fs.cpSync(origem, copia, { recursive: true });
	const db = new ClassicLevel(copia, { valueEncoding: "json" });
	const doPack = [];
	const efeitos = new Map(); // "itemId.efeitoId" → efeito
	for await (const [k, v] of db.iterator()) {
		if (k.startsWith("!items!")) doPack.push({ ...v, pack: pack.name, rotuloPack: pack.label, uuid: `Compendium.${modulo.id}.${pack.name}.Item.${v._id}` });
		else if (k.startsWith("!items.effects!")) efeitos.set(k.slice("!items.effects!".length), v);
		else if (k.startsWith("!folders!")) pastas.push({ _id: v._id, name: v.name, folder: v.folder, pack: pack.name });
	}
	await db.close();
	// efeitos ficam em chaves próprias; o item guarda só os ids (o Foundry junta ao carregar)
	for (const item of doPack) item.effects = (item.effects ?? []).map((id) => (typeof id === "string" ? efeitos.get(`${item._id}.${id}`) : id)).filter(Boolean);
	itens.push(...doPack);
}
fs.rmSync(temp, { recursive: true, force: true });

fs.mkdirSync(path.join(aqui, ".cache"), { recursive: true });
const destino = path.join(aqui, ".cache/suplemento.json");
fs.writeFileSync(destino, JSON.stringify({ versao: modulo.version, itens, pastas }));
console.log(`${itens.length} itens e ${pastas.length} pastas (Suplementos de Arton ${modulo.version}) → ${path.relative(process.cwd(), destino)}`);
