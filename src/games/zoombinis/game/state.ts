import type { ZoombinisPrefs } from "../engine/context";

/**
 * État d'une partie de L'Odyssée des Zoombinis (`docs/zoombinis/screens.md` §6.3) : le tampon `S` de 0xAE05 octets (`[2362]`) en champs nommés,
 * plus l'état de session (variables globales du programme qui ne sont pas dans la partie). Module pur : aucun DOM, aucun rendu, aucun hasard.
 * La sérialisation (JSON versionné) est dans `saves.ts`, les règles dans `route.ts` et `team.ts`.
 *
 * Les décalages cités sont ceux de `S+0xNN` ; les adresses `segment:offset` sont celles de `ZOOMBINI.EXE`.
 */

/** Zoombinis au total (5⁴ = 0x271 types, `S+0xAB94`). */
export const ZOOMBINI_TYPES = 625;
/** Taille d'un groupe complet (`[8cea] = 0x10`). */
export const GROUP_SIZE = 16;
/** Places d'un tampon de groupe (`S+0xA92E` : 32 fiches de 19 octets). */
export const GROUP_CAPACITY = 32;
/** Longueur de l'état opaque d'un Zoombini (fiche : octets 9 à 18 ; réserve : octets 12 à 21). */
export const STATE_BYTES = 10;
/** Longueur de l'emplacement d'une entrée de réserve (octets 4 à 11 : rectangle sur le présentoir, voir `PoolEntry.slot`). */
export const SLOT_BYTES = 8;
/** Monuments de Zoombiniville (`S+0xA2` / `S+0xB2`). */
export const MONUMENT_SLOTS = 16;
/** Étapes (`S+0xC2`) et épreuves (`S+0x56`). */
export const STAGES = 4;
export const PUZZLES = 12;
/** Niveau maximal d'une étape (0 à 3, `1168:36e1`). */
export const MAX_LEVEL = 3;

/** Les quatre attributs d'un Zoombini, de 1 à 5 chacun (`screens.md` §2.1). */
export type Attrs = [number, number, number, number];

/**
 * Fiche de 19 octets du groupe courant (`S+0xA92E + 6 + 19 × i`) : attributs (0 à 3), identifiant (4 à 7), présent / perdu (8),
 * état opaque (9 à 18). `present` faux = perdu pendant l'épreuve (`1168:36e1`).
 */
export interface Zoombini {
  attrs: Attrs;
  id: number;
  present: boolean;
  /** 10 octets propres au Zoombini (nom, pose… : contenu non décodé, copié tel quel entre groupe, réserves et ville). */
  state: Uint8Array;
}

/**
 * Entrée de 22 octets d'une réserve de camp ou de la population (`S+0xCE + 4 + 22 × i`) : attributs (0 à 3), emplacement (4 à 11), état (12 à 21).
 * L'entrée est libre quand le double mot des attributs est nul (`10b0:1ac9`, `1188:1bf5`).
 * `slot` : huit octets que `10b0:1217` lit comme un rectangle de quatre mots (gauche, haut, droite, bas) pour retrouver un Zoombini posé sur le présentoir
 * (**probable** ; la valeur par défaut copiée depuis `DS:072e` n'est pas extraite : zéros ici). La ville ne l'utilise pas.
 */
export interface PoolEntry {
  attrs: Attrs;
  slot: Uint8Array;
  state: Uint8Array;
}

/** Réserve de 625 emplacements (`4 + 625 × 22` octets) : en-tête (mot 0 = défilement du présentoir, mot 1 = nombre d'occupés) puis entrées. */
export interface Reserve {
  /** `[6dda]` / `*(S+0xCE)` : première ligne affichée (le présentoir montre 5 × 5 entrées). */
  scroll: number;
  /** `[6de0]` / `*(S+0xD0)` : nombre d'entrées occupées (invariant tenu par `team.ts`). */
  count: number;
  entries: (PoolEntry | null)[];
}

/**
 * Tampon de groupe de 614 octets (`S+0xA92E`, et ses copies `0xA1FC`, `0xA462`, `0xA6C8`) : nombre de membres, deux drapeaux, 32 fiches.
 * `members.length` est le nombre de membres. Le tampon est le **passage** du groupe d'un écran à l'autre : pendant un écran, le groupe
 * vit dans les objets de la scène, et `1168:36e1` le recopie ici à la sortie.
 */
export interface GroupBuffer {
  members: Zoombini[];
  /** Mot `+2` (`S−0x56D0` pour le groupe courant) : « déjà versé au présentoir » pour le groupe courant ; pour une réserve de groupe, « contenu à purger au prochain retour de perdus ». */
  flagA: boolean;
  /** Mot `+4` (`S−0x56CE`) : sens non établi (n'est jamais lu dans le corpus). */
  flagB: boolean;
}

/** Date calendaire (`10a8:0c75` : jour `S+0x92+k`, mois `S+0x82+k`, année mot `S+0x62+2k`, d'après `_dos_getdate`). */
export interface GameDate {
  year: number;
  month: number;
  day: number;
}

/** Monument de Zoombiniville : un par couple (étape, niveau) réussi sans perte, d'une traite (`screens.md` §3.4, §4.2). */
export interface Monument extends GameDate {
  /** Étape 1 à 4 (`S+0xA2+k`). */
  stage: number;
  /** Niveau + 1, de 1 à 4 (`S+0xB2+k`). */
  level: number;
}

/**
 * Options (`S+0x04…0x0A`, `S+0x20`, `screens.md` §5.2). Les noms suivent `engine/sound.ts` et `engine/context.ts` : `S+0x05` (`DS:a43b`) est la musique,
 * `S+0x04` (`DS:a43a`) les voix et effets ; `screens.md` §5.2 les décrit à l'envers (« défaut probable des libellés », à confirmer dans l'original).
 */
export interface GameOptions {
  /** `S+0x04`, `DS:a43a`, défaut 1 : voix et effets. */
  effects: boolean;
  /** `S+0x05`, `DS:a43b`, défaut 1 : musique de fond. */
  music: boolean;
  /** `S+0x06`, `DS:a43c`, défaut 1 : souris aimantée. */
  magneticMouse: boolean;
  /** `S+0x07`, `DS:a43d`, défaut 1 : pointeur masqué pendant le transport d'une pièce (`1168:58c7`, `10f8:6cdf` ; messages « curseur masqué / affiché »). */
  hideCursorWhileCarrying: boolean;
  /**
   * `S+0x08`, `DS:a43f`, défaut 0 : mode de test, levé par un code secret tapé au clavier (`1198:05b3`, `game/route.ts` `SECRET_TEST_MODE`). Rien ne le
   * rabaisse en jeu, mais il suit la partie : écrit et relu avec elle (`10d0:0a31`, `10d0:0863`), remis à 0 par une nouvelle partie (`10d0:089b(1)` puis `10d0:07f5`).
   * Lire par `testMode(game)`.
   */
  testMode: boolean;
  /** `S+0x09`, `DS:a43e`, défaut 0 : auto-aimantation. */
  autoMagnet: boolean;
  /** `S+0x0A`, `DS:854e`, défaut 0 : 1 = transitions `XFER` désactivées. */
  transitionsOff: boolean;
  /** `S+0x20`, défaut 0 (`10d0:089b` y met `[908a]`, valeur initiale non relevée) : 1 = « moins d'action » (moins d'animations décoratives). */
  lessAction: boolean;
}

/** Écrans qui ont un mot de mémoire de dialogue (`S+0x28 + 2k`, `screens.md` §5.1), dans l'ordre des mots. */
export const DIALOG_SCREENS: readonly number[] = [3, 7, 8, 9, 4, 10, 11, 12, 13, 14, 15, 5, 16, 17, 18, 6];

/** Compteurs de Zoombinis (`S+0x48 … 0x4E`). */
export interface Counters {
  /** `S+0x48` : Zoombinis créés au choix (0 à 625). */
  created: number;
  /** `S+0x4A` : au camp 1 (arrivés ou renvoyés). */
  camp1: number;
  /** `S+0x4C` : au camp 2. */
  camp2: number;
  /** `S+0x4E` : arrivés à Zoombiniville (le jeu est fini quand il dépasse 624). */
  town: number;
}

/** Masques de niveaux terminés (`S+0x50 / 0x51 / 0x52`) : bits 0 à 3 = niveau 0 à 3 de l'étape. */
export interface StageMasks {
  /** `S+0x50` : étape 1 (arrivée au camp 1). */
  stage1: number;
  /** `S+0x52` bits 0 à 3 : étape 2 (arrivée au camp 2 par le chemin A). */
  stage2: number;
  /** `S+0x52` bits 4 à 7 : étape 3 (arrivée au camp 2 par le chemin B). */
  stage3: number;
  /** `S+0x51` : étape 4 (arrivée à Zoombiniville). */
  stage4: number;
}

export interface GameState {
  /** `S+0x02` : mot non identifié (`[a438]`), conservé. */
  unknown02: number;
  options: GameOptions;
  /** `S+0x0C…0x13` : règle cachée des nizibooms, gardée d'une visite à l'autre (`10e0:1b29`, `game/puzzles/fleens.ts`) ; 0 = pas encore tirée. */
  fleensRule: number[];
  /** `S+0x14` : cycle d'image des 5 objets de décor des camps. */
  campDecor: number[];
  /** `S+0x1E` : position de défilement de Zoombiniville, 0 à 5 (6 positions de 320 points sur 1 920). */
  townScroll: number;
  /** `S+0x22` : meilleur score de l'écran caché 19 (tir aux Zoombinis, `1110:2b23`), 0 à 99. */
  shootingHighScore: number;
  /** `S+0x24` : meilleur score de l'écran caché 20 (astéroïdes, `1110:3e95`), 0 à 999. */
  asteroidsHighScore: number;
  /** `S+0x26` : état des mascottes du choix des Zoombinis, 0 à 3. */
  mascots: number;
  /** `S+0x28…0x47` : mémoire de dialogue des 16 écrans de `DIALOG_SCREENS`. */
  dialogMemory: number[];
  counters: Counters;
  masks: StageMasks;
  /** `S+0x54` : vrai tant que l'étape en cours a été faite d'une traite et sans perte (mis à l'entrée de 7, 10, 13, 16 ; effacé quand des perdus sont rendus). */
  stageUnbroken: boolean;
  /** `S+0x56…0x61` : réussites des 12 épreuves (écran − 7) ; bits 0 à 3 = niveau réussi, bits 4 à 7 = réussi sans perte. */
  successes: number[];
  /** `S+0x62…0xB2` : 16 monuments (null = emplacement libre). */
  monuments: (Monument | null)[];
  /** `S+0xC2…0xC8` : niveau (0 à 3) des étapes 1 à 4. */
  levels: number[];
  /** `S+0xCA` : écran précédent. */
  previousScreen: number;
  /** `S+0xCC` : écran de reprise (−1 = partie neuve). */
  resumeScreen: number;
  /** `S+0xCE` : réserve du camp 1. */
  camp1: Reserve;
  /** `S+0x3688` : réserve du camp 2. */
  camp2: Reserve;
  /** `S+0x6C42` : population de Zoombiniville. */
  population: Reserve;
  /** `S+0xA1FC` : groupe en cours de constitution, et perdus de l'étape 1 (réserve de l'écran 3). */
  pickerGroup: GroupBuffer;
  /** `S+0xA462` : réserve de groupe du camp 1 (groupe parti du camp, puis perdus des étapes 2 et 3). */
  camp1Group: GroupBuffer;
  /** `S+0xA6C8` : réserve de groupe du camp 2 (idem, perdus de l'étape 4). */
  camp2Group: GroupBuffer;
  /** `S+0xA92E` : **groupe courant**. */
  group: GroupBuffer;
  /** `S+0xAB94` : exemplaires créés de chacun des 625 types (`a0×125 + a1×25 + a2×5 + a3`, valeur − 1). */
  typeCounts: Uint8Array;
}

/**
 * État de session : variables globales du programme qui ne sont pas dans le tampon de partie. Jamais sauvegardé,
 * sauf `name` (le nom de la partie courante, rôle de `ZBUser.txt` / `<nom>.txt`) qui n'est qu'une indication pour l'écriture automatique.
 */
export interface Session {
  /** `[8552]` : écran courant (−1 avant le premier écran). */
  screen: number;
  /** `[855a]` : écran précédent. */
  previous: number;
  /** `[8558]` : destination réelle quand `XFER` (2) est intercalé, sinon −1. */
  finalTarget: number;
  /**
   * `DS:4180` : trajet forcé (1 à 16) par `T` puis `a` à `p` sur la carte (mode de test, en entraînement, `1110:0ab4`) ; 0 sinon. `1108:0177` intercale alors
   * la transition de ce trajet quel que soit l'écran quitté, et `XFER` revient à la carte (`11b0:139b`, `11b0:16e9`) en le remettant à 0.
   */
  forcedTransfer: number;
  /** `[8550]` : dernière épreuve finale d'étape terminée (9, 12, 15, 18 ; 0 au départ). */
  lastFinal: number;
  /** `[96f2]` : 0 = aventure, 1 à 4 = entraînement au niveau 0 à 3 (`1168:515d`). */
  training: number;
  /** `[9700]` : le niveau vient d'être augmenté par `1168:36e1` (retire 1 au niveau lu par `1108:0000`). */
  levelRaised: boolean;
  /** `[970a]` : reprise en cours (chargement, nouvelle partie, retour au camp) : pas de transition. */
  resuming: boolean;
  /** `[a406]` : le groupe a été abandonné en quittant la carte (`1110:03b8`) ; les sorties d'écran ne le recopient pas. */
  leftToMap: boolean;
  /** `[22e8]` : fermeture en cours. */
  quitting: boolean;
  /** Nom de la partie enregistrée (null = partie anonyme `ZBUser`). */
  name: string | null;
  /** `DS:96ec` / `96f0` : règle des gorges laissée aux grottes (`game/route.ts`, `setBridgeMemory`) ; hors du tampon `S`, jamais sauvegardée. */
  bridgeRule: BridgeRuleMemory | null;
  /** `DS:6dac` / `DS:0486` : condensat roulant des caractères tapés (`10a8:03d9`, `game/route.ts` `typeSecretKey`) ; valeurs initiales du segment de données. */
  secret: SecretHash;
}

/** Condensat des touches (`10a8:03d9`) : `a` = 7 bits par caractère des derniers caractères (`DS:6dac`), `b` = OU exclusif de tous les `a` (`DS:0486`). */
export interface SecretHash {
  a: number;
  b: number;
}

/** Règle des gorges retenue pour les grottes : `DS:96ec` candidate, `DS:96f0` effectif. */
export interface BridgeRuleMemory {
  candidate: number;
  count: number;
}

export function createSession(): Session {
  return {
    screen: -1,
    previous: -1,
    finalTarget: -1,
    forcedTransfer: 0,
    lastFinal: 0,
    training: 0,
    levelRaised: false,
    resuming: false,
    leftToMap: false,
    quitting: false,
    name: null,
    bridgeRule: null,
    // Segment de données : `DS:6dac` vaut 0 et `DS:0486` vaut 0xffffffff au lancement.
    secret: { a: 0, b: 0xffffffff },
  };
}

export function emptyReserve(): Reserve {
  return { scroll: 0, count: 0, entries: new Array<PoolEntry | null>(ZOOMBINI_TYPES).fill(null) };
}

export function emptyGroup(flagA = false, flagB = false): GroupBuffer {
  return { members: [], flagA, flagB };
}

export function defaultOptions(): GameOptions {
  return {
    effects: true,
    music: true,
    magneticMouse: true,
    hideCursorWhileCarrying: true,
    testMode: false,
    autoMagnet: false,
    transitionsOff: false,
    lessAction: false,
  };
}

/** `10d0:089b(1)` : partie neuve (tampon mis à zéro, options par défaut, `S+0xCC = −1`). */
export function newGame(): GameState {
  return {
    unknown02: 0,
    options: defaultOptions(),
    fleensRule: [0, 0, 0, 0, 0, 0, 0, 0],
    campDecor: [0, 0, 0, 0, 0],
    townScroll: 0,
    shootingHighScore: 0,
    asteroidsHighScore: 0,
    mascots: 0,
    dialogMemory: new Array<number>(DIALOG_SCREENS.length).fill(0),
    counters: { created: 0, camp1: 0, camp2: 0, town: 0 },
    masks: { stage1: 0, stage2: 0, stage3: 0, stage4: 0 },
    stageUnbroken: false,
    successes: new Array<number>(PUZZLES).fill(0),
    monuments: new Array<Monument | null>(MONUMENT_SLOTS).fill(null),
    levels: [0, 0, 0, 0],
    previousScreen: -1,
    resumeScreen: -1,
    camp1: emptyReserve(),
    camp2: emptyReserve(),
    population: emptyReserve(),
    pickerGroup: emptyGroup(),
    camp1Group: emptyGroup(),
    camp2Group: emptyGroup(),
    group: emptyGroup(),
    typeCounts: new Uint8Array(ZOOMBINI_TYPES),
  };
}

/** `[a43f]` : le mode de test (`S+0x08`) est-il levé ? Accesseur des écrans qui ont des touches de test (carte, choix, ville, épreuves). */
export function testMode(game: GameState): boolean {
  return game.options.testMode;
}

/** Copie profonde (les tests et `saves.ts` comparent des états). */
export function cloneGame(game: GameState): GameState {
  return structuredClone(game);
}

/** Index d'un type dans `typeCounts` (`S+0xAB94`) ; les attributs doivent être de 1 à 5. */
export function typeIndex(attrs: readonly number[]): number {
  return (attrs[0]! - 1) * 125 + (attrs[1]! - 1) * 25 + (attrs[2]! - 1) * 5 + (attrs[3]! - 1);
}

export function isValidAttrs(attrs: readonly number[]): attrs is Attrs {
  return attrs.length === 4 && attrs.every((a) => Number.isInteger(a) && a >= 1 && a <= 5);
}

export function makeZoombini(attrs: readonly number[], id = 0, present = true, state?: Uint8Array): Zoombini {
  return { attrs: [attrs[0]!, attrs[1]!, attrs[2]!, attrs[3]!], id, present, state: state ? state.slice(0, STATE_BYTES) : new Uint8Array(STATE_BYTES) };
}

/** Une entrée de réserve occupe un emplacement quand le double mot d'attributs est non nul. */
export function isOccupied(entry: PoolEntry | null): entry is PoolEntry {
  return entry !== null && entry.attrs.some((a) => a !== 0);
}

export function entryFromZoombini(z: Zoombini, slot?: Uint8Array): PoolEntry {
  return { attrs: [...z.attrs], slot: slot ? slot.slice(0, SLOT_BYTES) : new Uint8Array(SLOT_BYTES), state: z.state.slice() };
}

export function zoombiniFromEntry(entry: PoolEntry, id = 0): Zoombini {
  return makeZoombini(entry.attrs, id, true, entry.state);
}

export function cloneGroup(g: GroupBuffer): GroupBuffer {
  return { members: g.members.map((m) => ({ ...m, attrs: [...m.attrs] as Attrs, state: m.state.slice() })), flagA: g.flagA, flagB: g.flagB };
}

/** `1168:0824` : membres vivants (présents) du groupe. */
export function aliveCount(group: GroupBuffer): number {
  return group.members.filter((m) => m.present).length;
}

// --- Options et préférences de session ---

/** Les options remplacent à terme `ZoombinisPrefs` (plan.md, « Préférences ») ; `context.ts` n'est pas modifié. */
export function prefsFromOptions(o: GameOptions): ZoombinisPrefs {
  return {
    music: o.music,
    effects: o.effects,
    transitions: !o.transitionsOff,
    magneticMouse: o.magneticMouse,
    autoMagnet: o.autoMagnet,
    hideCursorWhileCarrying: o.hideCursorWhileCarrying,
  };
}

/** Reporte des préférences dans des options (`base` fournit les champs sans équivalent : mode de test, « moins d'action »). */
export function optionsFromPrefs(prefs: ZoombinisPrefs, base: GameOptions = defaultOptions()): GameOptions {
  return {
    ...base,
    music: prefs.music,
    effects: prefs.effects,
    transitionsOff: !prefs.transitions,
    magneticMouse: prefs.magneticMouse,
    autoMagnet: prefs.autoMagnet,
    hideCursorWhileCarrying: prefs.hideCursorWhileCarrying,
  };
}
