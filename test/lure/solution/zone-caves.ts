/**
 * Solution de la zone « grottes et monastère » : de Goewin qui a préparé la potion pour le dragon (village, `TALK_INDEX` 15) à l'arrivée
 * dans la cave du château (pièce 42, point de départ de `zone-castle.ts`). Données seulement : `Play` (`runner.ts`, combat réactif compris)
 * les joue avec de vrais clics ; `passage-caves.test.ts` les enchaîne (phase par phase, avec les reprises).
 *
 * Le fil de la zone est `TALK_INDEX` (champ 19) ; le dialogue d'un personnage est le rang `TALK_INDEX + 1` de sa liste de `0x3F11`.
 *
 * 1. `TALK_INDEX` 15, les gargouilles (pièce 15) : Ultar, un client du bar (pièce 29), apprend au joueur qu'elles ouvrent la grille de la
 *    Weregate (`0xD4B6`, méthode 59 : « Parle à » leur devient possible) ; elles ne l'ouvrent pas à un homme (`0xEC66`, `TALK_INDEX` 16).
 * 2. `TALK_INDEX` 16, Goewin : « M'aideriez-vous à ouvrir la Weregate ? » (`0xD99E`) -> 17, elle part vers la grille (emploi du temps 6 :
 *    pièces 34, 10, 13, 14, 15) et **n'y attend que ~250 images** avant d'abandonner (`0x2731` remet le champ 19 à 16). Le joueur doit
 *    l'y rejoindre à temps (les villageois et les Skorls en promenade le retardent : la solution recommence quand elle a abandonné). À la
 *    grille, « Appelez-les » (`0xD9CC`) -> 19, la porte `0x271E` s'ouvre, Goewin (`setSupportData`) va dans la cave.
 * 3. Pièce 38 : la première entrée (`0xE91`) fixe `TALK_INDEX` à 21 et fait de Goewin une suiveuse (`makeGoewinFollow`) : elle ne suit pas
 *    d'elle-même, elle obéit à « Dis à » (le menu ne propose que les pièces visitées et, pour les objets, ceux que le joueur a survolés).
 * 4. Pièces 38, 39, 40 : le puzzle des six crânes. Trois portes (A `0x272A`, C `0x272C`, E `0x272E` ; chacune a sa jumelle de l'autre
 *    côté) dont **une seule est ouverte à la fois** : « Tire » un crâne ouvre sa porte et ferme les deux autres, « Pousse » le ferme.
 *    42E, 431, 432 ouvrent A ; 42F, 433 ouvrent C ; 430 ouvre E. Un crâne se tire s'il est poussé (champs 49 à 54 : 1 = poussé), ceux de la
 *    pièce 38 le sont à l'arrivée. Aucun crâne n'est dans la bonne pièce pour passer seul : Goewin en tire un derrière le joueur.
 *    - 38 : tirer 42E (A), passer en 39 (Goewin a été envoyée en 39 : « Va à La Grotte Verte »), s'écarter du point d'arrivée (un
 *      personnage qui arrive sur un autre se met à marcher au hasard au lieu d'entrer) ;
 *    - 39 : « Dis à Goewin : Va à La Grotte d'entrée, Tire Crâne de gauche (42F : C s'ouvre, A se ferme), Va à La Grotte Verte, Tire Crâne
 *      de droite (430 : E) » ; le joueur passe en 40 par C ;
 *    - 40 : tirer 432 (A) : Goewin, qui attendait devant A fermée, passe en 39 et tire 430 (E s'ouvre, A et C se ferment) ; le joueur
 *      passe en 5 par E. Il faut tirer 432 vite : Goewin renonce à franchir une porte fermée au bout de cinq essais.
 * 5. Pièces 5 et 6 : en entrant dans la 6 le combat du cochon commence (`setupPigFight`, le texte d'entrée bloque le monde) ; gagné, le
 *    joueur a la hache.
 * 6. Pièce 41, le dragon : la potion (`0x2728`) sur lui (« Utilise »), puis le dialogue `0xECCE` : l'Oeil de Gethryn (`0x2737`),
 *    `TALK_INDEX` 22, la porte `0x2729` (la Weregate) s'ouvre.
 */

import type { LureEngine } from "../../../src/games/lure/engine/game";
import { Field, HotspotId } from "../../../src/games/lure/engine/ids";
import type { Step } from "./runner";
import { startVillage } from "./zone-village";

export const HS = {
  GOEWIN: HotspotId.GOEWIN,
  ULTAR: 0x42b,
  GARGOYLE: 0x42c,
  SKULL_38_RIGHT: 0x42e,
  SKULL_38_LEFT: 0x42f,
  SKULL_39_RIGHT: 0x430,
  SKULL_39_LEFT: 0x431,
  SKULL_40_RIGHT: 0x432,
  SKULL_40_LEFT: 0x433,
  DOOR_A: 0x272a,
  DOOR_C: 0x272c,
  DOOR_E: 0x272e,
  PIG: HotspotId.PIG,
  DRAGON: 0x434,
  POTION: 0x2728,
  EYE: 0x2737,
  AXE: 0x2738,
} as const;

/** Champs de la zone. */
export const CF = {
  TALK_INDEX: Field.TALK_INDEX,
  /** Potion de Goewin : 0 = celle qui convient au dragon (`0x2582`). */
  POTION_KIND: 56,
  /** État du sort de Goewin (1 : en préparation, 2 : prêt, 3 : donné). */
  SPELL: 45,
  /** Crânes (1 = poussé). */
  SKULL_42F: 49,
  SKULL_42E: 50,
} as const;

/**
 * État de départ : celui que produit la zone précédente. Le village est installé (comme `startVillage`) et le joueur est sur la place (14)
 * avec Ratpouch. De Goewin et de la potion, on rejoue les **séquences réelles** des réponses du dialogue `0xD8CE` et `0xD960` plutôt que
 * d'écrire les champs :
 * - `0x2182` : Goewin est libérée (`freeGoewin`, dialogue `0xE8D0` avec le Skorl) : elle s'active, joue son animation de libération, puis
 *   suit son emploi du temps ordinaire (elle se promène dans le village) ;
 * - `0x2582` puis `0x2524` : elle prépare le sort ; la potion qui convient au dragon (champ 56 = 0) et `TALK_INDEX` 14 ;
 * - on laisse passer l'attente du sort (séquence différée `0x2680` : champ 45 = 2) puis `0x269e` : « Voilà le sort » (la potion est donnée,
 *   champ 45 = 3, `TALK_INDEX` 15).
 * Ce qui précède (le livre, le rameau, les plantes) n'est pas joué : ni l'une ni l'autre des séquences ci-dessus ne l'exige.
 */
export function setupCavesStart(engine: LureEngine): void {
  startVillage(engine);
  const world = engine.world;
  world.requireHotspot(HotspotId.GOEWIN).roomNumber = 31;
  world.activateHotspot(HotspotId.GOEWIN);
  engine.script.execute(0x2182);
  engine.script.execute(0x2582);
  engine.script.execute(0x2524);
  for (let i = 0; i < 400 && world.fields.get(CF.SPELL) !== 2; i++) engine.tick();
  engine.script.execute(0x269e);
  world.fields.playerNewPos = { roomNumber: 14, x: 160, y: 100 };
  engine.tick();
  const ratpouch = world.activateHotspot(HotspotId.RATPOUCH)!;
  ratpouch.roomNumber = 14;
  ratpouch.setPosition(200, 100);
}

const goewinIn = (room: number) => (e: LureEngine) => e.world.requireHotspot(HotspotId.GOEWIN).roomNumber === room;
const doorOpen = (door: number) => (e: LureEngine) => e.world.getExitJoin(door)?.blocked === 0;

export interface CavesPhase {
  name: string;
  steps: Step[];
  /** Phase à recommencer (au plus `max` fois) tant que la condition n'est pas vraie : le joueur retente (voir le texte ci-dessus). */
  retry?: { until: (engine: LureEngine) => boolean; max: number };
}

export const ZONE_CAVES_PHASES: CavesPhase[] = [
  {
    name: "Ultar et les gargouilles",
    steps: [
      { goto: 29, note: "le bar : Ultar (un client)" },
      { verb: "Parle à", on: HS.ULTAR, note: "il se présente" },
      { talk: [] },
      { verb: "Parle à", on: HS.ULTAR, note: "« Dites m'en plus au sujet du Dragon ! » : les gargouilles peuvent parler" },
      { talk: ["Dragon"] },
      { goto: 15, note: "le monastère" },
      { verb: "Parle à", on: HS.GARGOYLE, note: "elles n'ouvrent pas la grille à un homme : TALK_INDEX 16" },
      { talk: ["Ultar"] },
    ],
  },
  {
    name: "Goewin ouvre la grille",
    retry: { until: (e) => e.world.fields.get(CF.TALK_INDEX) === 19, max: 6 },
    steps: [
      { goto: 34, note: "Goewin se tient surtout là" },
      { verb: "Parle à", on: HS.GOEWIN, note: "« M'aideriez-vous à ouvrir la Weregate ? » : elle part vers la grille (TALK_INDEX 17)" },
      { talk: ["Weregate", "belle"] },
      { until: (e) => !goewinIn(34)(e), what: "Goewin part" },
      { goto: 15, note: "la rejoindre à la grille avant qu'elle abandonne" },
      { verb: "Parle à", on: HS.GOEWIN, note: "« Appelez-les » : la porte s'ouvre, TALK_INDEX 19" },
      { talk: ["Appelez", "Fengael", "tout", "portes"] },
    ],
  },
  {
    name: "la grotte d'entrée",
    steps: [
      { exit: 38, note: "la première entrée : TALK_INDEX 21, Goewin suit les ordres" },
      { until: (e) => e.world.fields.get(CF.SKULL_42E) === 1, what: "les crânes de la pièce 38 sont poussés" },
      { look: HS.SKULL_38_LEFT, note: "survoler le crâne : « Dis à » le proposera" },
    ],
  },
  {
    name: "les crânes",
    steps: [
      { verb: "Tire", on: HS.SKULL_38_RIGHT, note: "la porte A s'ouvre (C et E se ferment)" },
      { exit: 39 },
      { look: HS.SKULL_39_RIGHT, note: "survoler les crânes de la pièce 39" },
      { look: HS.SKULL_39_LEFT },
      { exit: 38 },
      {
        repeat: [{ tell: HS.GOEWIN, orders: [{ verb: "Va à", object: "La Grotte Verte" }] }],
        until: goewinIn(39),
        what: "Goewin en 39",
        times: 1,
        optional: true,
        note: "Goewin passe en 39 (rien à dire si elle y est déjà : suiveuse, elle a pu y entrer derrière le joueur)",
      },
      { exit: 39 },
      { giveWay: true, note: "s'écarter du point d'arrivée de Goewin" },
      { until: goewinIn(39), what: "Goewin en 39" },
      {
        tell: HS.GOEWIN,
        orders: [
          { verb: "Va à", object: "La Grotte d'entrée" },
          { verb: "Tire", object: "Crâne de gauche" },
          { verb: "Va à", object: "La Grotte Verte" },
          { verb: "Tire", object: "Crâne de droite" },
        ],
        note: "elle retourne en 38 tirer 42F (C s'ouvre, A se ferme), puis repassera en 39 pour tirer 430 (E)",
      },
      { giveWay: true, note: "s'écarter de son chemin et du point d'arrivée en 39 (Goewin y repassera)" },
      { until: doorOpen(HS.DOOR_C), what: "la porte C est ouverte" },
      { exit: 40 },
      { verb: "Tire", on: HS.SKULL_40_RIGHT, note: "A s'ouvre pour Goewin (C et E se ferment) ; elle passe en 39 et tire 430" },
      { until: doorOpen(HS.DOOR_E), what: "la porte E est ouverte" },
      { exit: 5 },
    ],
  },
  {
    name: "le cochon",
    steps: [
      { exit: 6, note: "le combat commence à l'entrée" },
      { fight: HS.PIG, note: "gagné : la hache" },
    ],
  },
  {
    name: "le dragon",
    steps: [
      { exit: 41 },
      { verb: "Utilise", on: HS.DRAGON, with: "Potion", note: "la potion sur ses écailles (champ 57 = 1) : il dort encore" },
      { verb: "Parle à", on: HS.DRAGON },
      { talk: [], note: "0xECCE : l'Oeil de Gethryn, TALK_INDEX 22" },
    ],
  },
  {
    name: "le retour",
    steps: [
      { exit: 6 },
      { exit: 5 },
      { exit: 40 },
      { verb: "Tire", on: HS.SKULL_40_LEFT, note: "C s'ouvre (E et A se ferment)" },
      { exit: 39, note: "Goewin est restée près du point d'arrivée : le joueur se met à marcher au hasard" },
      { wait: 60 },
      { verb: "Tire", on: HS.SKULL_39_LEFT, note: "A s'ouvre (C et E se ferment)" },
      { exit: 38 },
      { go: [197, 198], room: 15, note: "le bas de la grotte d'entrée mène au monastère (séquence 0xEF2 : seulement si TALK_INDEX > 21)" },
    ],
  },
  {
    name: "la conversation du Skorl et d'Ewan",
    steps: [
      { goto: 19, note: "la place du marché" },
      { verb: "Regarde par", on: 0x754c, note: "la fenêtre de la boutique : vue à distance de la pièce 35" },
      { until: (e) => e.world.fields.get(CF.TALK_INDEX) === 24, what: "le Skorl parle à Ewan : TALK_INDEX 24", max: 6000 },
    ],
  },
  {
    name: "Ewan et le tonneau",
    steps: [
      { wait: 10, note: "la boîte « 0xAB9 » se ferme d'un clic" },
      { walk: [160, 100], note: "un clic ramène de la vue à distance à la place du marché" },
      { goto: 35 },
      { verb: "Parle à", on: 0x436, note: "il se présente (le joueur ne sait pas encore son nom)" },
      { talk: [] },
      { verb: "Parle à", on: 0x436, note: "« Je prendrai votre place dans le tonneau ! »" },
      { talk: [], note: "0xEED2, dernière réponse : la séquence différée 0x2911 emporte le joueur dans la cave du Château (pièce 42)" },
      { until: (e) => e.room.roomNumber === 42, what: "dans la cave du Château" },
    ],
  },
];

export const ZONE_CAVES_STEPS: Step[] = ZONE_CAVES_PHASES.flatMap((p) => p.steps);
