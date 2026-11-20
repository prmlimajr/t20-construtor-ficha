/**
 * Passos do wizard, na ordem em que aparecem. Cada arquivo exporta:
 *  - passo: id, passos(m) (instâncias na barra lateral; vazio se o passo não aparece),
 *    pendencia(passo) (regra, roda no ModeloConstrutor) e contexto(passo) (dados do template, roda na janela);
 *  - Tela: métodos da tela do passo, misturados na janela (ConstrutorFicha).
 * O template de cada passo é templates/passos/<id>.hbs.
 */
import * as raca from "./raca.js";
import * as atributos from "./atributos.js";
import * as classe from "./classe.js";
import * as magias from "./magias.js";
import * as pericias from "./pericias.js";
import * as origem from "./origem.js";
import * as devocao from "./devocao.js";
import * as complicacoes from "./complicacoes.js";
import * as idade from "./idade.js";
import * as equipamento from "./equipamento.js";
import * as dinheiro from "./dinheiro.js";
import * as revisao from "./revisao.js";

export const MODULOS_PASSOS = [raca, atributos, classe, magias, pericias, origem, devocao, complicacoes, idade, equipamento, dinheiro, revisao];
export const PASSOS = MODULOS_PASSOS.map((m) => m.passo);
export const PASSO_POR_ID = Object.fromEntries(PASSOS.map((p) => [p.id, p]));
