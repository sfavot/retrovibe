/**
 * Solution de la zone « le château » (pièces 42 à 49) : de l'arrivée dans la cave (pièce 42) à la fin du jeu (sortie de la pièce 49 :
 * `endgameSequence`, `host.exit()`). Données seulement : `Play.run` (`runner.ts`) les joue avec de vrais clics.
 *
 * Le puzzle, tel que les scripts l'imposent :
 *
 * 1. Cuisine (43) : Minnow (hotspot `0x3F2`, le serf) patrouille de la cave (42) au réfectoire (45). Le joueur lui parle (présentations
 *    obligatoires), prend les tenailles et, après avoir regardé la carcasse (qui rend la graisse sélectionnable), la graisse.
 * 2. Cave (42) : regarder le fût rend le bondon sélectionnable ; les tenailles sur le bondon font couler le vin (champ 63 = 1). Le vin
 *    coule 95 s (1192 images) puis le fût est vide (champ 63 = 2) : tout le reste doit tenir dans ce délai.
 * 3. Minnow (le choisir quand il passe en 44) : « Je cherche Séléna » puis « Dis au Skorl que l'un des fûts de la cave a une fuite ! ».
 *    Il va prévenir le Skorl du réfectoire (437), qui se réveille (script 3, puis `castleSkorlAnimHandler`), s'efface et laisse la place
 *    au Skorl `0x3F3` qui descend 45, 44, 43, 42 (emploi du temps 21).
 *    - Il tue le joueur qu'il rattrape : le joueur doit être hors du chemin 45-42 au réveil, et il doit être en bas (le champ `y` du
 *      joueur >= 52) quand le Skorl apparaît (`npcJumpAddress` 1 : sinon le Skorl le traque sans fin) : on passe par le bas du
 *      réfectoire (le haut et le bas des pièces 45 et 46 ne communiquent pas) jusqu'au bas de la pièce 46.
 *    - Arrivé à la cave tant que le vin coule, le Skorl se met à boire (hotspot `0x438`, champ 64 = 1) et ne revient jamais.
 * 4. Minnow, de nouveau (« Comment puis-je retrouver Séléna ? ») : le champ 19 passe à 5 et « Dis à » lui devient possible.
 * 5. Pièce 48 (la salle à grille) : la graisse sur le levier ; il faut qu'un autre tire le levier (le levier tiré ne le reste que
 *    5 s, champ 65) pendant que le joueur actionne le treuil (champ 66 = 1) : Minnow suit le joueur dans la pièce (emploi du temps), on
 *    lui dit « Tire le levier », on attend le levier tiré, on actionne le treuil.
 * 6. Le pont-levis : la porte du nord de la pièce 46 (en haut) mène à la pièce 49 quand le champ 66 vaut 1 (sinon à la 47, un cul-de-sac) ;
 *    combat contre le Skorl, puis sortie à gauche : fin du jeu.
 */

import type { LureEngine } from "../../../src/games/lure/engine/game";
import { Field, HotspotId } from "../../../src/games/lure/engine/ids";
import type { TestHost } from "../engine/test-host";
import type { Step } from "./runner";

export const HS = {
  MINNOW: 0x3f2,
  SKORL_GUARD: 0x437,
  SKORL_DRINKING: 0x438,
  TONGS: 0x2736,
  GREASE: 0x2735,
  CARCASS: 0x7566,
  BARREL: 0x754e,
  BUNG: 0x754d,
  WINCH: 0x43a,
  LEVER: 0x43d,
  SKORL_FIGHTER: HotspotId.SKORL_FIGHTER,
} as const;

/** Champs de la table des valeurs propres au château. */
export const CF = {
  TALK_INDEX: Field.TALK_INDEX,
  WINE: 63,
  SKORL_AT_BARREL: 64,
  LEVER_PULLED: 65,
  WINCH_DONE: 66,
  LEVER_GREASED: 77,
} as const;

/**
 * État de départ : celui que produit la zone précédente. Le dialogue d'Ewan (`0xEED2`, réponse 4) lance la séquence différée `0x2911` :
 * le joueur (champ 1 = `0x3E8`) change de pièce pour la cave (pièce 42, en `(231, 284)`), et le champ 76 passe à 2. Rien d'autre n'est
 * exigé par les pièces 42 à 49 : les tenailles et la graisse sont dans la cuisine, Minnow et les Skorl sont chargés par les données
 * (`0x3F2` en 44, `0x437` en 45) ; l'inventaire du joueur peut contenir ce que les zones précédentes lui ont laissé (aucun objet n'est
 * utilisé dans le château, hors tenailles et graisse). Comme la commande `enter 42` du débogueur de ScummVM, mais par le chemin du jeu
 * (la pièce est quittée et la séquence d'entrée jouée).
 */
export function setupCastleStart(engine: LureEngine): void {
  engine.script.execute(0x2911);
}

const minnowIn =
  (room: number) =>
  (e: LureEngine): boolean =>
    e.world.requireHotspot(HS.MINNOW).roomNumber === room;

export interface CastlePhase {
  name: string;
  steps: Step[];
}

export const ZONE_CASTLE_PHASES: CastlePhase[] = [
  {
    name: "cuisine : présentations, tenailles et graisse",
    steps: [
      { wait: 20, note: "le joueur arrive dans la cave (pièce 42)" },
      { go: [315, 170], room: 43, note: "la cave mène à la cuisine (43)" },
      { until: minnowIn(43), what: "Minnow en cuisine" },
      { verb: "Parle à", on: HS.MINNOW, note: "présentations (dialogue sans choix)" },
      { verb: "Prends", on: HS.TONGS },
      { look: HS.CARCASS, note: "regarder la carcasse rend la graisse sélectionnable" },
      { verb: "Prends", on: HS.GREASE },
    ],
  },
  {
    name: "cave : le vin coule",
    steps: [
      { go: [6, 150], room: 42, note: "retour à la cave" },
      { look: HS.BARREL, note: "regarder le fût rend le bondon sélectionnable" },
      { until: minnowIn(43), what: "Minnow quitte la cave" },
      { until: minnowIn(42), what: "Minnow revient à la cave" },
      { verb: "Utilise", on: HS.BUNG, with: "Tenailles", note: "le bondon saute : le vin coule (T0)" },
    ],
  },
  {
    name: "Minnow prévient le Skorl",
    steps: [
      { go: [315, 170], room: 43, note: "cave -> cuisine" },
      { go: [320, 148], room: 44, note: "cuisine -> passage" },
      { giveWay: true, note: "laisser le passage libre (loin du point d'arrivée) : Minnow ne peut pas entrer sinon" },
      {
        repeat: [
          { until: minnowIn(44), what: "Minnow en 44" },
          { verb: "Parle à", on: HS.MINNOW, here: true, note: "ici, sans le poursuivre dans le haut du réfectoire (on ne pourrait plus gagner le bas)" },
          { talk: ["Séléna", "fuite"], note: "« l'un des fûts de la cave a une fuite »" },
        ],
        until: (e) => e.world.fields.get(CF.TALK_INDEX) === 1,
        what: "Minnow prévenu de la fuite (TALK_INDEX 1)",
      },
      { giveWay: true, note: "s'écarter sans le bousculer : Minnow attend tant qu'il touche le joueur (CHARMODE_PLAYER_WAIT)" },
      { until: minnowIn(45), what: "Minnow part vers le Skorl" },
    ],
  },
  {
    name: "se cacher en bas de la pièce 46",
    steps: [
      { go: [250, 116], room: 45, note: "passage -> réfectoire par la sortie du bas" },
      { go: [317, 165], room: 46, note: "réfectoire (bas) -> pièce 46 (bas)" },
      { walk: [150, 175], note: "quitter le point d'arrivée (Minnow viendra par là), en restant dans le bas de la pièce" },
      {
        until: (e) => e.world.fields.get(CF.SKORL_AT_BARREL) === 1,
        what: "le Skorl boit au tonneau",
      },
    ],
  },
  {
    name: "Minnow : comment retrouver Séléna ?",
    steps: [
      { until: (e) => e.world.requireHotspot(HS.MINNOW).roomNumber === e.room.roomNumber, what: "Minnow près du joueur" },
      { verb: "Parle à", on: HS.MINNOW },
      { talk: [], note: "« Comment puis-je retrouver Séléna ? » : champ 19 = 5, « Dis à » possible" },
    ],
  },
  {
    name: "salle à grille : levier et treuil",
    steps: [
      { go: [300, 183], room: 48, note: "pièce 46 -> pièce 48 (salle à grille)" },
      { verb: "Utilise", on: HS.LEVER, with: "Graisse", note: "le levier rouillé est graissé" },
      { until: minnowIn(48), what: "Minnow suit le joueur" },
      {
        repeat: [
          { look: HS.WINCH, note: "se placer près du treuil" },
          { tell: HS.MINNOW, orders: [{ verb: "Tire", object: "Levier" }], note: "Dis à Minnow : Tire le levier" },
          {
            walk: [200, 175],
            note: "s'écarter : pour donner l'ordre, Diermot est allé jusqu'à Minnow, qui attend tant qu'il le touche (CHARMODE_PLAYER_WAIT, comme ScummVM)",
          },
          { until: (e) => e.world.fields.get(CF.LEVER_PULLED) === 1, what: "le levier est tiré (5 s)" },
          { verb: "Actionne", on: HS.WINCH, note: "le treuil, pendant que le levier est tiré" },
        ],
        until: (e) => e.world.fields.get(CF.WINCH_DONE) === 1,
        what: "le pont-levis est baissé (treuil actionné pendant que le levier est tiré)",
        times: 3,
        note: "le levier ne reste tiré que 5 s : si le treuil n'a pas été actionné à temps, on recommence, comme un joueur",
      },
    ],
  },
  {
    name: "le chemin du pont-levis",
    steps: [
      { go: [45, 140], room: 46, note: "pièce 48 -> pièce 46 (bas)" },
      { go: [2, 165], room: 45, note: "pièce 46 -> réfectoire (bas)" },
      { go: [0, 180], room: 44, note: "réfectoire (bas) -> passage" },
      { go: [96, 116], room: 45, note: "passage -> réfectoire (haut)" },
      { go: [317, 70], room: 46, note: "réfectoire (haut) -> pièce 46 (haut)" },
      { go: [145, 48], room: 49, note: "la porte du nord mène au pont-levis (champ 66 = 1)" },
    ],
  },
  {
    name: "combat contre le Skorl et fin du jeu",
    steps: [
      { fight: HS.SKORL_FIGHTER, note: "combat contre le Skorl du pont-levis" },
      { walk: [10, 190], note: "sortie à gauche du pont-levis" },
      { skipUntil: (_e: LureEngine, host: TestHost) => host.exits >= 1, what: "fin du jeu (la séquence attend une touche)" },
    ],
  },
];

export const ZONE_CASTLE_STEPS: Step[] = ZONE_CASTLE_PHASES.flatMap((p) => p.steps);
