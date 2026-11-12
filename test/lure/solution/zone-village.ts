/**
 * Zone « village » de Lure of the Temptress (vague L3) : de la sortie de la cellule (Diermot et Ratpouch arrivent dans les égouts, pièce 7)
 * jusqu'à la sortie de la zone. Des données (`Step[]`), jouées par `runner.ts` (de vrais clics : menus, sorties, dialogues) ; la vague K
 * enchaîne les zones.
 *
 * Le fil de l'histoire est le champ `TALK_INDEX` (19) : le dialogue d'un personnage est le rang `TALK_INDEX + 1` de sa liste de `0x3F11`
 * (rang 0 : un étranger dont on ne sait pas encore le nom). Chaque étape ci-dessous dit l'index où elle se joue et celui qu'elle donne.
 * `docs/lure/group-3.md` décrit le reste de la zone (jusqu'où cette solution va, et ce qui suit).
 */

import type { LureEngine } from "../../../src/games/lure/engine/game";
import { Field, HotspotId } from "../../../src/games/lure/engine/ids";
import type { Step } from "./runner";

/** Hotspots de la zone (`luredefs.h`). */
export const Village = {
  MALLIN: 0x3ed,
  LUTHERN: 0x3eb,
  GRUB: 0x422,
  MORKUS: 0x421,
  NELLIE: 0x429,
  EWAN: 0x436,
  RATPOUCH: 0x3e9,
  /** Porte de la boutique de Goewin (pièce 19, vers le laboratoire de Taidgh, pièce 30). */
  SHOP_DOOR: 0x2717,
  /** Eileain, la tricoteuse du bar de Sid (pièce 29) : elle a le carnet de Taidgh. */
  EILEAIN: 0x442,
  /** La Poudrière (forge, pièce 28), le Brûleur à mazout et l'Appareil (laboratoire, pièce 30), le Robinet qu'il cache. */
  TINDERBOX: 0x271c,
  BURNER: 0x424,
  APPARATUS: 0x755f,
  TAP: 0x753d,
  /** Le Skorl qui fait la ronde du village (geôlier quand il surprend le joueur au laboratoire). */
  VILLAGE_SKORL: 0x3f1,
  /** Les Skorls qui gardent Goewin à la mairie (pièce 31). */
  SKORL_GUARD: 0x426,
  GOEWIN: 0x3ef,
  /** Toby, un moine (le livre rouge, l'herbe du sort). */
  TOBY: 0x3f0,
  /** La Cobane qui manque à Goewin (pièce 18 ; la séquence 0x2524 la rend visible). */
  COBANE: 0x2732,
} as const;

/** Champs du village lus par la solution. */
export const VillageField = {
  /** Porte 2717 déverrouillée (séquence 0x936, « Déverrouille » par Ratpouch muni du crochet). */
  SHOP_DOOR_UNLOCKED: 24,
  /** Contenu du Flacon : 2 la bière de Nellie (la Vieille Chauffe-Quiquette), 0 vide, 1 la potion de Taidgh. */
  FLASK: 25,
  /** Le brûleur a chauffé l'appareil (le robinet donne la potion). */
  STILL_HOT: 27,
  /** Changements de pièce restants sous l'apparence de Séléna (hors pièces 31 et 14) ; 74 : Goewin a vu « Séléna ». */
  DISGUISE_LEFT: 29,
  GOEWIN_FREED: 32,
  /** Le sort de Goewin : 1 en préparation (séquence différée 0x2680, 40 s), 2 prêt, 3 donné. */
  SPELL: 45,
  GOEWIN_SAW_SELENA: 74,
  /** Le carnet de Taidgh a été lu : « Regarde » l'appareil désigne le brûleur et le robinet. */
  NOTEBOOK_READ: 75,
} as const;

/**
 * État de début de village : ce que produit la sortie de la cellule. Le joueur entre dans la pièce 7 (égouts) : le script d'entrée de la
 * pièce (`0x83`, première fois seulement : champ 62) met en place le village (active les PNJ et les objets de la zone, fixe `TALK_INDEX`
 * à 1 et les champs 25, 43, 44, 55, 56, 71, lance les sons et les séquences différées des égouts). Ratpouch, qui suit Diermot depuis la
 * cellule, est dans la même pièce. Les objets que la solution de la cellule laisse au joueur ne servent pas au village.
 */
export function startVillage(engine: LureEngine): void {
  engine.tick();
  engine.world.fields.playerNewPos = { roomNumber: 7, x: 100, y: 100 };
  engine.tick();
  const ratpouch = engine.world.activateHotspot(HotspotId.RATPOUCH)!;
  ratpouch.roomNumber = 7;
  ratpouch.setPosition(150, 100);
}

const exits = (...rooms: number[]): Step[] => rooms.map((exit) => ({ exit }));

const inRoom =
  (id: number, room: number) =>
  (e: LureEngine): boolean =>
    e.world.requireHotspot(id).roomNumber === room;
const field =
  (n: number, value: number) =>
  (e: LureEngine): boolean =>
    e.world.fields.get(n) === value;
const talkIndex =
  (n: number) =>
  (e: LureEngine): boolean =>
    e.world.fields.get(Field.TALK_INDEX) === n;

/**
 * Luthern partage sa journée entre la forge (28) et le bar de Sid : il ne parle de Goewin qu'à la forge (ailleurs : « Nous ne pouvons pas
 * discuter ici. Suivez-moi. »). On l'attend donc à la forge, à l'écart de la porte : un personnage n'entre pas dans une pièce dont le point
 * d'arrivée est occupé (il attend dans la pièce voisine, comme dans ScummVM).
 */
const luthernAtForge = (note: string): Step[] => [
  { goto: 28 },
  { walk: [220, 150], note: "quitter le point d'arrivée de la porte : Luthern ne peut pas entrer tant qu'on s'y tient" },
  { until: inRoom(Village.LUTHERN, 28), what: "Luthern à la forge", max: 4000 },
  { verb: "Parle à", on: Village.LUTHERN, note },
  { talk: [] },
];

/** De l'arrivée dans les égouts (pièce 7, `startVillage`) à la place du village (pièce 10), où finit la zone de la cellule. */
export const VILLAGE_ARRIVAL: Step[] = exits(8, 9, 10);

/** De la place du village (pièce 10) au départ de la zone grottes et monastère (`TALK_INDEX` 15, pièce 14, avec Ratpouch). */
export const VILLAGE_FROM_SQUARE: Step[] = [
  // --- TALK_INDEX 1 : la place du village
  { verb: "Parle à", on: Village.MALLIN, note: "Mallin donne une barre d'or à porter chez Ewan (le dialogue propose deux options)" },
  { talk: ["Dites-moi"] },
  // --- la boutique d'Ewan (19, 35) : la barre contre de l'argent et un faux bijou
  { goto: 35, note: "par les pièces 13, 14 et 19 depuis la place (Mallin a pu être rejoint ailleurs)" },
  { verb: "Donne", on: Village.EWAN, with: "Barre de métal", note: "8 groats et la gemme" },
  // --- la forge (28) : Luthern se présente et dit que Goewin a disparu : TALK_INDEX 1 -> 2
  ...luthernAtForge("présentations, puis « J'ai récemment réussi à m'échapper » : Goewin a disparu"),
  { until: talkIndex(2), what: "TALK_INDEX 2" },
  // --- la taverne de Nellie (32) : la gemme contre un flacon ; Morkus, un groat, TALK_INDEX 2 -> 3 (Goewin est à la mairie)
  { goto: 12 },
  { exit: 32 },
  { verb: "Donne", on: Village.NELLIE, with: "Gemme", note: "le flacon (Flacon)" },
  { verb: "Parle à", on: Village.MORKUS, note: "il se présente" },
  { talk: [] },
  { verb: "Corromps", on: Village.MORKUS, note: "un groat" },
  { verb: "Parle à", on: Village.MORKUS, note: "Goewin est à la mairie : TALK_INDEX 3" },
  { talk: [] },
  { until: talkIndex(3), what: "TALK_INDEX 3" },
  // --- retour à la forge : Luthern, TALK_INDEX 3 -> 4 (voir Grub)
  ...luthernAtForge("Goewin arrêtée : voir Grub"),
  { until: talkIndex(4), what: "TALK_INDEX 4" },
  // --- la ruelle de Grub (12) : le crochet, TALK_INDEX 4 -> 5
  { goto: 12 },
  { verb: "Parle à", on: Village.GRUB, note: "il se présente" },
  { talk: [] },
  { verb: "Parle à", on: Village.GRUB, note: "la Chèvre Noire : le crochet, TALK_INDEX 5" },
  { talk: ["Chèvre"] },
  { until: talkIndex(5), what: "TALK_INDEX 5" },
  { verb: "Donne", on: Village.RATPOUCH, with: "Crochet", note: "Ratpouch crochète les serrures (champ 1 = 1001 dans les scripts)" },
  // --- TALK_INDEX 5 -> 6 : la potion de Taidgh (Séléna). Le Flacon contient la bière de Nellie (champ 25 = 2) : Luthern la boit et rend
  //     le flacon vide (séquence 0x17D9) ; le carnet de Taidgh (Eileain) apprend à reconnaître le brûleur et le robinet.
  ...luthernAtForge("(sans dialogue)").slice(0, 3),
  { verb: "Prends", on: Village.TINDERBOX, note: "la Poudrière, sur le sol de la forge" },
  { repeat: [{ verb: "Donne", on: Village.LUTHERN, with: "Flacon" }], until: field(VillageField.FLASK, 0), what: "Luthern boit la bière : le flacon est vide" },
  { goto: 29 },
  { verb: "Parle à", on: Village.EILEAIN, note: "elle se présente" },
  { talk: [] },
  { verb: "Parle à", on: Village.EILEAIN },
  { talk: ["Taidgh"], note: "elle donne le carnet de Taidgh" },
  { verb: "Examine", with: "Carnet", note: "le journal de Taidgh : la potion de transformation (champ 75)" },
  { until: field(VillageField.NOTEBOOK_READ, 1), what: "carnet lu" },
  // --- la boutique de Goewin (19) : Ratpouch déverrouille la porte 2717 (séquence 0x936 : le personnage est Ratpouch et il a le crochet).
  //     Les passants la referment (séquence 0x91F, champ 24 = 0) : on la déverrouille juste avant d'entrer, et on recommence s'il le faut.
  { goto: 19 },
  { walk: [230, 150], note: "quitter le point d'arrivée : Ratpouch ne peut pas entrer tant qu'on s'y tient" },
  {
    repeat: [
      { until: inRoom(Village.RATPOUCH, 19), what: "Ratpouch dans la ruelle de la boutique", max: 2000 },
      { tell: Village.RATPOUCH, orders: [{ verb: "Déverrouille", object: "Porte", seen: Village.SHOP_DOOR }], note: "Dis à Ratpouch : Déverrouille Porte" },
      { until: field(VillageField.SHOP_DOOR_UNLOCKED, 1), what: "porte de la boutique déverrouillée", max: 800 },
      // Le Skorl du village (0x3F1) fait sa ronde par la 19 ; de là, s'il trouve le joueur dans le laboratoire sans le déguisement, il
      // l'arrête (emploi du temps 12, séquence 0x1E8A). On entre juste après son passage, une fois qu'il a quitté la 19 et la 30 : le laboratoire tient dans l'intervalle (s'il a
      // refermé la porte en passant, on recommence).
      { until: inRoom(Village.VILLAGE_SKORL, 19), what: "le Skorl passe dans la ruelle", max: 2000 },
      {
        until: (e) => ![19, 30].includes(e.world.requireHotspot(Village.VILLAGE_SKORL).roomNumber),
        what: "le Skorl quitte la ruelle (sa ronde passe aussi par le laboratoire quand la porte est déverrouillée)",
        max: 2000,
      },
      {
        repeat: [
          { tell: Village.RATPOUCH, orders: [{ verb: "Déverrouille", object: "Porte", seen: Village.SHOP_DOOR }] },
          { until: field(VillageField.SHOP_DOOR_UNLOCKED, 1), what: "porte de la boutique déverrouillée", max: 800 },
        ],
        until: field(VillageField.SHOP_DOOR_UNLOCKED, 1),
        what: "porte de nouveau déverrouillée",
        times: 1,
        optional: true,
        note: "le Skorl l'a reverrouillée en passant par le laboratoire : Ratpouch la rouvre, on entre aussitôt",
      },
      { exit: 30, note: "le laboratoire de Taidgh (la porte déverrouillée s'ouvre)" },
    ],
    until: (e) => e.room.roomNumber === 30,
    what: "entrer dans le laboratoire",
    times: 5,
  },
  { look: Village.APPARATUS, note: "« Regarde » l'appareil : le brûleur et le robinet deviennent désignables" },
  { verb: "Utilise", on: Village.BURNER, with: "Poudrière", note: "le brûleur s'allume" },
  { until: field(VillageField.STILL_HOT, 1), what: "le mélange chauffe", max: 3000 },
  { verb: "Utilise", on: Village.TAP, with: "Flacon", note: "la potion rouge (champ 25 = 1)" },
  { verb: "Bois", with: "Flacon", note: "Diermot prend l'apparence de Séléna : TALK_INDEX 6" },
  { until: talkIndex(6), what: "TALK_INDEX 6" },
  // --- TALK_INDEX 6 -> 7 : « Séléna » fait libérer Goewin (dialogue 0xE8D0, freeGoewin), Goewin la voit, puis l'effet se dissipe
  { goto: 31 },
  { verb: "Parle à", on: Village.SKORL_GUARD, note: "« Relâchez la fille ! » puis « Silence ! » : freeGoewin" },
  { talk: ["Relâchez", "Silence"] },
  { until: field(VillageField.GOEWIN_FREED, 1), what: "Goewin libérée" },
  { verb: "Parle à", on: Village.GOEWIN, note: "« Je n'ai pas peur de toi, Séléna » (champ 74)" },
  { talk: [] },
  { until: field(VillageField.GOEWIN_SAW_SELENA, 1), what: "Goewin a vu Séléna" },
  { goto: 10, note: "deux changements de pièce hors des pièces 31 et 14 (champ 29) : la séquence 0xCB7 rend TALK_INDEX 7" },
  { until: talkIndex(7), what: "TALK_INDEX 7", max: 300 },
  // --- 7 -> 8 : Goewin ; 8 -> 10 : Mallin (le livre rouge) ; 10 -> 12 : le livre à Toby (la statuette) ; 12 -> 13 : le Dragon et le sort
  { verb: "Parle à", on: Village.GOEWIN },
  { talk: ["Bonjour", "C'est moi", "Un jour"] },
  { until: talkIndex(8), what: "TALK_INDEX 8" },
  {
    repeat: [
      { verb: "Parle à", on: Village.MALLIN },
      { talk: ["Pourquoi", "Oui"] },
      { walk: [160, 140], note: "si Mallin nous a échappé : dégager le passage (il attend au bord de l'écran que la sortie se libère)" },
      { wait: 60 },
    ],
    until: talkIndex(10),
    what: "TALK_INDEX 10 (Mallin donne le livre)",
    times: 6,
    note: "« Donneriez-vous ce livre à Morkus ? » ; Mallin se promène (sa tournée dépend de l'heure) : on le rattrape, et on recommence s'il nous échappe",
  },
  { goto: 20, note: "Toby fait la navette et passe par la pièce 20 pour regagner sa cellule (36, sans autre issue) : on l'y attend" },
  { walk: [80, 160], note: "à l'écart du passage des moines (de la porte 2721 à la cellule) et des points d'arrivée" },
  { until: inRoom(Village.TOBY, 36), what: "Toby rentré dans sa cellule (36)", max: 6000 },
  { exit: 36, note: "il y médite : un moine qui marche n'écoute pas (« Hey, attendez ! » sans effet)" },
  {
    repeat: [{ verb: "Donne", on: Village.TOBY, with: "Livre" }],
    until: talkIndex(12),
    what: "TALK_INDEX 12 (Toby prend le livre)",
    times: 5,
    note: "un moine qui marche n'accepte pas : on recommence",
  },
  { verb: "Parle à", on: Village.TOBY, note: "il se présente" },
  { talk: [] },
  { verb: "Parle à", on: Village.TOBY },
  { talk: ["vaincre", "quelqu'un"], note: "le Dragon, le sort (Chiendent, Cobane, Elécampane)" },
  { until: talkIndex(13), what: "TALK_INDEX 13" },
  // --- 13 -> 14 -> 15 : Goewin prépare le sort ; la Cobane lui manque (séquence 0x2524 : elle devient visible en pièce 18)
  { verb: "Parle à", on: Village.GOEWIN },
  { talk: ["infusion", "Chiendent, Cobane", "Dragon", "choix"] },
  { until: talkIndex(14), what: "TALK_INDEX 14" },
  { goto: 18 },
  { verb: "Prends", on: Village.COBANE },
  { repeat: [{ verb: "Donne", on: Village.GOEWIN, with: "Cobane" }], until: (e) => e.world.fields.get(VillageField.SPELL) !== 0, what: "Goewin prépare le sort" },
  { until: field(VillageField.SPELL, 2), what: "le sort est prêt (40 s)", max: 1500 },
  { verb: "Parle à", on: Village.GOEWIN },
  { talk: ["prêt", "Oui"], note: "« Voilà le sort » : la Potion, TALK_INDEX 15" },
  { until: talkIndex(15), what: "TALK_INDEX 15" },
  // --- départ de la zone grottes et monastère : la place (14), avec Ratpouch
  { goto: 14 },
  { walk: [160, 150], note: "s'écarter du point d'arrivée" },
  { until: inRoom(Village.RATPOUCH, 14), what: "Ratpouch sur la place", max: 2000 },
];

/** La zone entière depuis `startVillage`. */
export const VILLAGE_STEPS: Step[] = [...VILLAGE_ARRIVAL, ...VILLAGE_FROM_SQUARE];
