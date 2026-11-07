/**
 * Écran 6 : Zoombiniville (`TOWN.MHK`, `docs/zoombinis/screens.md` §4). Portage de `1188:0000` (initialisation), `1188:0128` (Enter), `1188:0c1d` (Exit),
 * `1188:0ce5` (Tick), `1188:1071` (clic), `1188:1300` (survol), `1188:1380` (touches du mode de test), `1188:0a88` (défilement des objets), `1188:15b3` (image des
 * couches), `1188:16d4` (monuments), `1188:1688` (arbres), `1188:0936` (horloge), `1188:1832` (fiche d'un monument), `1188:1cdf` (objets décoratifs), `1188:1edb`
 * (fin d'un objet décoratif), `1188:08bb` (gel), `1188:1bf5` (versement des survivants, dans `game/team.ts`) et `1188:0b47` (bouton de la carte).
 *
 * ## Ce que fait l'original (sûr sauf mention)
 *
 * - **Le décor** est un anneau de 1 920 points (6 colonnes de 320) vu par une fenêtre de 640 : `S+0x1E` (0 à 5) est la colonne de gauche. Quatre `SCRB` de 6 images (une
 *   par position, les parties sont déjà placées pour la fenêtre) : 1000 le terrain (deux tranches de 320 de la `tBMP` 1000, images 1 à 6), 1002 et 1003 les arbres
 *   (parties 25 à 55 et 56 à 80), 1001 les 16 bâtiments des monuments (parties 7 à 22 = emplacement + 7) et deux poteaux (23, 24). `1188:15b3` fait lire l'image `S+0x1E`
 *   de ces quatre features. Les objets « en monde » (petits décors animés, objets décoratifs, habitants) ont une position dans l'anneau (−320 à 1 599) que le défilement
 *   décale de ±320 (`1188:0a88`, avec bouclage).
 * - **Arbres** : `1188:1688` retire les parties dont le numéro dépasse `24 + min(56, 56 × population / 625 + 1)` : la ville se couvre d'arbres avec la population.
 * - **Petits décors animés** (`SCRB` 4000 à 4007, `tBMP` 4000) : `min(16, (population − 20) / 37)` d'entre eux, aux 16 positions de `DS:39AA` tirées sans répétition
 *   (`1098:0098`), délai 4 à 6 ticks, en boucle (le script est `4000 + position % 8`).
 * - **Monuments** : `1188:16d4` garde dans l'image de 1001 les bâtiments dont l'emplacement `k` est rempli (`S+0xA2+k`) et en tire un rectangle de survol (centre =
 *   partie + `DS:3968[k]`, ± 28 × ± 14). Le type de bâtiment de l'emplacement `k` est `DS(1508):010D[k]` (table de 16 octets d'un autre segment de données), son
 *   style de fiche `DS:3A0C[k]` (1 à 4). L'emplacement 4 (type 13, beffroi) porte l'**horloge** : `SCRB` 6000 (deux parties, aiguille des minutes 1 à 12 et des heures 13 à 24)
 *   posée à (626, 218) à la colonne 1 et (307, 218) à la colonne 2 ; elle montre l'heure de l'ordinateur (minute / 5, heure mod 12, relue toutes les 1 800 ticks).
 *   Un clic sur l'horloge lui fait faire un tour de cadran (délai 2) avant de revenir à l'heure.
 * - **Fiche d'un monument** : un clic (et non un simple survol) sur un bâtiment crée la feature `SCRB` 1003 + style (une image de 359 × 288 posée en (140, 101)) et la
 *   dessine avec cinq lignes (`1188:1832`), police petite, grande, petite, grande, petite, centrées dans les rectangles de `DS:3A1E` (0, 36, 196, 210, 230, 244 de haut,
 *   plus un décalage de 20, 22, 14 ou 14 selon le style) : le type (`STRL` 2014), l'exploit (2016, `(étape − 1) × 4 + niveau − 1`), « quand le voyage était: » (2012),
 *   le niveau (2004, `niveau + 2`) et la date `"%d %s %d"` (jour, mois de 2010, année). Textes cernés de quatre copies décalées d'un pixel (`10a8:0cd2`), couleurs de
 *   palette (contour, texte) 199 / 45, 199 / 45, 212 / 45 et 45 / 205 selon le style. Un clic quelconque la ferme. Ouverte, la fiche gèle les habitants, l'horloge et
 *   les objets décoratifs (`1188:08bb`) et suspend les évènements, les phrases et les objets décoratifs.
 * - **Habitants** : au plus 20 (les plus récents de la population), positions tirées dans l'anneau (`x` −320 à 1 599, `y` 410 à 475), en petit. Dans l'original ils sont créés à
 *   l'état 0 de `1168:0ba8` : ils **ne marchent pas** et n'ont **aucune animation d'attente** (`1168:5a13(0)`, appelé à `1188:018b`, met `DS:239a` à 1 et l'état 0 ne tire alors
 *   rien, `1168:1176` : c'est `Snoid.tickWait` qui reprend cette règle pour tout Zoombini `small`). Seuls les évènements de `1188:0ce5` les animent : un habitant visible (20 < x < 620)
 *   joue son `SCRS` de danse 4999 + pieds (5000 à 5004 de `TOWN.MHK`), le budget d'évènements étant 1 (1 à 156), 4 (157 à 312), 6 (313 à 624) ou 8 (625 habitants) et l'intervalle de
 *   120 ticks (600 avec « moins d'action »).
 * - **Glissement d'un habitant** (`1188:1071`, `11a8:0d61`, `1168:1742`) : un appui sur le plus en avant des habitants sous le pointeur le prend, avant l'horloge, les bâtiments et
 *   le défilement. Il passe devant tout, délai 3, animation de transport `145 + pieds`, suit le pointeur (bornes de l'écran, tourné du côté où va la souris) selon le protocole de
 *   `1168:58c7` des épreuves (souris aimantée : un clic prend, le suivant dépose ; auto-aimantation ; curseur masqué). Aucune zone de dépôt (**probable**) : lâché avec 410 < y < 476 il garde
 *   sa nouvelle place (`1188:1071` copie sa position dans sa destination `+0x116`), sinon il retourne d'un coup où il a été pris (variante d'attente 1, tourné à droite).
 * - **Objets décoratifs** (`1188:1cdf`) : `SCRB` 8000 à 8043 (oiseaux, papillons… `tBMP` 8000), jusqu'à 3 en même temps, un tirage 51 % de 8022 à 8043 et 49 % de 8000 à 8021,
 *   `x` 100 à 540 et `y` dans une plage qui dépend du script ; ils jouent une fois (sons dans le `SCRB`) et disparaissent. Le nombre total à produire est 1, 3, 6, 10 ou 15
 *   (population > 100, 200, 300, 400, 500) ; 20 à la fin du jeu, puis 40 quand la phrase finale est finie.
 * - **Phrases** : à l'arrivée, selon `[8550]` (dernière épreuve finale) et la mémoire de dialogue `S+0x46` (`1168:5c57`), le son 20086 à 20088 (`0x4E76`…), ou le récit
 *   3000 à 3002 ; à la fin du jeu la phrase finale 3003. Puis, une fois le son fini et 150 à 300 ticks écoulés, une nouvelle phrase : un tour sur deux le récit (3000, 3001, 3002,
 *   puis 3000…), un tour sur deux un des cinq sons 20089 à 20093 tirés sans répétition (le dernier, 20093, pas au-delà de 600 habitants) ; à la fin du jeu seulement le récit.
 * - **Sortie** : le bouton de la carte (`tBMP` 1100, images 5 et 6, rectangle (600, 403)-(640, 440)) joue le son 999 et demande la carte. Aucun texte n'est écrit par
 *   cet écran, sauf la fiche : le texte « population de zoombiniville » (`STRL` 2008) n'est dessiné que par `XFER` (`11b0:1ef8`).
 * - **Touches** (`1188:1380`, seulement avec le mode de test `[a43f]`) : `Suppr` remplit les emplacements libres de monuments (étape et niveau cycliques, date du jour), `0` les
 *   vide, `F` bascule le budget d'objets décoratifs entre 100 et 0, `←` / `→` retirent / ajoutent 5 arbres, `F9` / `F11` / `Espace` feuillettent les fiches (non porté).
 *
 * ## Écarts
 *
 * - Transport d'un habitant : la boucle reprend celle de `PuzzleKit` (constantes partagées, logique dupliquée : voir `engine-ts.md`) ; pendant le transport la danse ne choisit pas l'habitant porté (l'original bloque dans `1168:1742`, ce que fait alors `1188:0ce5` n'est pas établi) ; le retour est immédiat (l'état 4 attend l'échéance suivante, ≤ 6 ticks).
 * - Curseurs : l'original affiche des curseurs en image (`tBMP` 2000 : flèche gauche, flèche droite, loupe, `11a8:0fe9`) ; l'hôte n'a pas de curseur « image », la main (`curs1`) sert
 *   de loupe et les flèches de bord ne sont pas affichées.
 * - Fondu d'entrée de palette (`1188:0128` appelle `11a8:302b`) et musique (aucun appel dans `1188:*`, elle continue) non portés. L'horloge est relue
 *   dès la première image (l'original attend 30 s d'horloge de programme à cause d'une comparaison non signée), le son d'une phrase fini est détecté par la file des effets entière
 *   (pas par identifiant), le survol d'un bâtiment est calculé au clic et non à chaque tick.
 */
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import type { Point } from "../data/zoombini";
import { TAG_SND } from "../../../data/mohawk/mohawk";
import { loadPcm } from "../../../engine/mohawk/audio/pcm";
import { NoRepeatPool } from "../../../engine/mohawk/rng";
import type { Surface } from "../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../engine/mohawk/resources";
import { DIALOG } from "../engine/dialog";
import { FEATURES, FEATURE_END, FeatureFlag, type Feature, type FeatureImageHook, type FeaturePart, type Features } from "../engine/features";
import { ZOOMBINIS_GAME } from "../engine/game";
import type { Scene, SceneContext } from "../engine/scene";
import { ScreenId } from "../engine/scene";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { TextFlags, ZOOMBINIS_TEXT, type FontName, type TextStrings } from "../engine/text";
import { currentLevel, dialogMemoryIndex } from "../game/route";
import { MONUMENT_SLOTS, type Monument } from "../game/state";
import {
  townArrive,
  townBuildingCount,
  townDecorCount,
  townResidentPosition,
  townResidents,
  townScrollBy,
  townScrollDirection,
  TOWN_END_GAME_DECOR_BURST,
} from "../game/team";
import { closeScreen, openScreen } from "./screen-kit";
import { CARRY_DELAY, CARRY_DEPTH, CARRY_SCRIPT_BASE, HIDDEN_CURSOR, SCREEN_BOUNDS, SNAP_IDLE_VARIANT } from "./puzzle-kit";
import { createSnoid, screenScripts, type Snoid } from "./snoid";
import { dialogChoice } from "./xfer";

const ARCHIVE = "TOWN.MHK";
const COMMON_ARCHIVE = "ZOOMBINI.MHK";
/** Durée d'un tick (`Clock`) en secondes. */
const TICK_SECONDS = 0.017;
/** `11a8:1475(0x4b0)` : palette `SHPL` 1200 et fond `tBMP` 1200 (8 × 6, recouvert par le terrain). */
const BACKGROUND = 1200;
/** Plages de `SCRB` et planches (`11a0:0000`, `11a8:14ab` / `11a8:15a6`) : terrain et couches 1000 à 1007 (groupe 0), petits décors 4000 à 4007 (1), horloge 6000 (2, avec `REGS`), objets décoratifs 8000 à 8043 (3). */
const SHEET_TERRAIN = 1000;
const SHEET_SCENERY = 4000;
const SHEET_CLOCK = 6000;
const SHEET_DECOR = 8000;
const SCRIPT_TERRAIN = 1000;
const SCRIPT_MONUMENTS = 1001;
const SCRIPT_TREES = [1002, 1003] as const;
const SCRIPT_CARD_BASE = 1003;
const SCRIPT_CLOCK = 6000;
const DECOR_FIRST = 8000;
const DECOR_COUNT = 44;
const BUTTONS_SHEET = 1100;

/** Sons : clic (`ZOOMBINI.MHK`), récit (`TOWN.MHK` 3000 à 3003), voix du narrateur (`ZOOMBINI.MHK` 20086 à 20093). */
const SOUND_CLICK = 999;
const STORY_FIRST = 3000;
const STORY_LAST = 3002;
const FINAL_PHRASE = 3003;
const GREETINGS = [0x4e76, 0x4e77, 0x4e78] as const;
const CHATTER = [0x4e79, 0x4e7a, 0x4e7b, 0x4e7c, 0x4e7d] as const;
/** Le dernier son de `CHATTER` n'est pas dit au-delà de cette population (`1188:0ce5`). */
const CHATTER_LIMIT_SOUND = 0x4e7d;
const CHATTER_LIMIT_POPULATION = 600;

/** `STRL` de la fiche (`DS:9dc6`…`9df6`) et format de date (`DS:3A50`). */
const STRL_LEVELS = 2004;
const STRL_MONTHS = 2010;
const STRL_WHEN = 2012;
const STRL_TYPES = 2014;
const STRL_FEATS = 2016;
export const DATE_FORMAT = "%d %s %d";

/** Un habitant lâché (`1188:1071`) garde sa place si ses pieds sont dans cette bande d'ordonnées (exclusive : `0x199 < y < 0x1dc`), sinon il retourne où il a été pris. */
const RESIDENT_HOME_BAND = { min: 0x199, max: 0x1dc } as const;

/** Anneau du décor : positions de −320 à 1 599, pas de défilement de 320. */
const RING_STEP = 320;
const RING_MIN = -320;
const RING_MAX = 0x63f;

/** Type de bâtiment de chaque emplacement (`1508:010D`) : indice dans `STRL` 2014. */
export const BUILDING_TYPES: readonly number[] = [7, 1, 4, 5, 13, 3, 10, 11, 14, 15, 0, 8, 12, 9, 2, 6];
/** Emplacement qui porte le beffroi et son horloge. */
const CLOCK_SLOT = 4;
/** Décalage du rectangle de survol par rapport à la partie (`DS:3968`) et demi-taille (± 0x1c, ± 0xe). */
const HOTSPOT_OFFSETS: readonly (readonly [number, number])[] = [
  [72, 70], [118, 126], [81, 118], [77, 63], [65, 227], [144, 83], [107, 81], [144, 186],
  [49, 97], [57, 148], [86, 46], [67, 119], [108, 80], [76, 97], [47, 181], [119, 65],
];
const HOTSPOT_HALF = { w: 0x1c, h: 0xe } as const;
/** Première partie des bâtiments dans `SCRB` 1001 (`1188:16d4` : parties 7 à 22). */
const BUILDING_FIRST_PART = 7;
/** Style de fiche de chaque emplacement (`DS:3A0C`, 1 à 4). */
const CARD_STYLES: readonly number[] = [2, 2, 4, 4, 2, 3, 3, 1, 4, 1, 1, 2, 4, 2, 3, 4];
/** Position de la fiche : la partie de l'image est posée en (140, 101). */
const CARD_DEPTH = 100;
/** Hauts des cinq lignes (`DS:3A1E`) et décalage par style (`1188:18a0`), polices et couleurs (contour, texte) des lignes (`1188:1832`). */
const CARD_EDGES: readonly number[] = [0, 36, 196, 210, 230, 244];
const CARD_OFFSET: readonly number[] = [0x14, 0x16, 0xe, 0xe];
const CARD_FONTS: readonly FontName[] = ["small", "large", "small", "large", "small"];
const CARD_COLORS: readonly (readonly [number, number])[] = [[0xc7, 0x2d], [0xc7, 0x2d], [0xd4, 0x2d], [0x2d, 0xcd]];

/** Petits décors animés : position de chaque emplacement (`DS:39AA`), script `4000 + i % 8` (`DS:39EA`). */
const SCENERY_POSITIONS: readonly (readonly [number, number])[] = [
  [467, 265], [349, 225], [777, 291], [828, 284], [44, 330], [283, 152], [195, 211], [607, 201],
  [1182, 287], [1299, 228], [1422, 269], [1807, 316], [1048, 309], [709, 228], [1740, 284], [1532, 172],
];
/** Habitants : au plus ce nombre est visible et un évènement ne touche que ceux dont `x` est dans cet intervalle ouvert. */
const EVENT_VISIBLE = { min: 0x14, max: 0x26c } as const;
const EVENT_ATTEMPTS = 16;
const EVENT_INTERVAL = 120;
const EVENT_INTERVAL_LESS_ACTION = 600;
/** Phrases : attente après la fin d'un son (150 à 300 ticks). */
const PHRASE_WAIT = { min: 150, max: 300 } as const;
/** Objets décoratifs : simultanés au plus, bande de `x`, et fin de partie. */
const DECOR_SLOTS = 3;
const DECOR_X = { min: 100, max: 540 } as const;
/** Bande de défilement et bouton de la carte. */
const MAP_BUTTON = { x1: 600, y1: 403, x2: 640, y2: 440 } as const;
const MAP_BUTTON_IMAGES = { ready: 5, pressed: 6 } as const;
/** Clic sur le bouton : 2 ticks enfoncé (`1090:00c1`). */
const PRESS_TICKS = 2;
/** Horloge (`1188:0936`) : position par colonne, délais, relecture de l'heure en ticks. */
const CLOCK_POSITION = { x: [0, 0x272, 0x133] as const, y: 0xda };
const CLOCK_DELAY = 6;
const CLOCK_SPIN_DELAY = 2;
const CLOCK_RESYNC = 0x708;
const CLOCK_HOUR_FIRST_PART = 13;
/** Arbres : numéro de partie de base, bornes de `9f26` (`1188:0128` et `1188:150a`). */
const TREES_BASE = 0x18;
const TREES_MAX = 0x38;
/** Profondeurs : terrain, arbres, objets décoratifs (juste derrière les monuments, `11a8:2a0a`), monuments, petits décors, habitants, bouton et horloge, fiche. */
const DEPTH = { terrain: 0, treesA: 1, treesB: 2, decor: 3.5, monuments: 4, scenery: 5, residents: 6, overlay: 7 } as const;

interface Box {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const contains = (box: Box, x: number, y: number): boolean => x >= box.x1 && x < box.x2 && y >= box.y1 && y < box.y2;

// ---------------------------------------------------------------------------------------------------------------------------
// Règles et mises en page pures

/** Une position de l'anneau déplacée d'une colonne : `direction` 1 = on regarde plus à droite (le monde recule de 320), −1 = plus à gauche (`1188:0a88`). */
export function shiftRing(x: number, direction: -1 | 1): number {
  if (direction === -1) {
    const moved = x + RING_STEP;
    return moved > RING_MAX ? x - 0x640 : moved;
  }
  const moved = x - RING_STEP;
  return moved < RING_MIN ? x + 0x640 : moved;
}

/** Dernier numéro de partie d'arbre gardé (`DS:9f26`) : `24 + min(56, 56 × population / 625 + 1)`. */
export function treeLimit(population: number): number {
  return TREES_BASE + Math.min(TREES_MAX, Math.floor((population * TREES_MAX) / 0x271) + 1);
}

/** Budget d'évènements de danse (`[a014]`, `1188:0ce5`) : 0 sans habitant, 1 jusqu'à 156, 4 jusqu'à 312, 6 jusqu'à 624, 8 à 625. */
export function eventBudget(population: number): number {
  if (population === 0x271) return 8;
  if (population >= 0x139) return 6;
  if (population >= 0x9d) return 4;
  return population !== 0 ? 1 : 0;
}

/** Plage de `y` d'un objet décoratif selon son script (`1188:1cdf`). */
export function decorHeight(script: number): readonly [number, number] {
  if (script < 8008) return [170, 280];
  if (script < 8010) return [40, 280];
  if (script < 8018) return [110, 260];
  if (script < 8022) return [-10, 100];
  if (script < 8030) return [230, 310];
  if (script < 8032) return [140, 290];
  if (script < 8040) return [190, 280];
  return [100, 200];
}

/** `0caf` : premier récit, `3000 + ((S+0x46 − 1) & 0xfff) % 3`. */
export function storyStart(memory: number): number {
  const id = STORY_FIRST + (((memory - 1) & 0xfff) % 3);
  return Math.min(Math.max(id, STORY_FIRST), STORY_LAST);
}

/** Les cinq lignes de la fiche du monument `monument` de l'emplacement `slot` (`1188:1832`), avec les chaînes de `TEXTSTR.MHK`. */
export function cardLines(strings: Pick<TextStrings, "get">, slot: number, monument: Monument): string[] {
  const text = (list: number, index: number): string => strings.get(list, index) ?? "";
  const feat = ((monument.stage - 1) * 4 + monument.level - 1) & 0xf;
  const month = text(STRL_MONTHS, monument.month);
  const args = [monument.day, month, monument.year];
  let next = 0;
  const date = DATE_FORMAT.replace(/%[ds]/g, () => String(args[next++]));
  return [text(STRL_TYPES, BUILDING_TYPES[slot]! + 1), text(STRL_FEATS, feat + 1), text(STRL_WHEN, 1), text(STRL_LEVELS, monument.level + 2), date];
}

/** Rectangle de survol d'un bâtiment dont la partie est en `(x, y)` (`1188:16d4`). */
export function hotspotOf(slot: number, x: number, y: number): Box {
  const cx = x + HOTSPOT_OFFSETS[slot]![0];
  const cy = y + HOTSPOT_OFFSETS[slot]![1];
  return { x1: cx - HOTSPOT_HALF.w, y1: cy - HOTSPOT_HALF.h, x2: cx + HOTSPOT_HALF.w, y2: cy + HOTSPOT_HALF.h };
}

export interface Hotspot {
  slot: number;
  box: Box;
}

/**
 * `1188:16d4` sur les parties de l'image de `SCRB` 1001 : retire les bâtiments (parties 7 à 22) dont l'emplacement n'est pas rempli et donne le rectangle de survol des autres.
 * `clock` est vrai quand le beffroi (emplacement 4) est dans l'image.
 */
export function monumentLayer(parts: readonly FeaturePart[], monuments: readonly (Monument | null)[]): { parts: FeaturePart[]; hotspots: Hotspot[]; clock: boolean } {
  const kept: FeaturePart[] = [];
  const hotspots: Hotspot[] = [];
  let clock = false;
  for (const part of parts) {
    const slot = part.w - BUILDING_FIRST_PART;
    if (slot < 0 || slot >= MONUMENT_SLOTS) {
      kept.push(part);
      continue;
    }
    if (!monuments[slot]) continue;
    if (slot === CLOCK_SLOT) clock = true;
    kept.push(part);
    hotspots.push({ slot, box: hotspotOf(slot, part.x, part.y) });
  }
  return { parts: kept, hotspots, clock };
}

// ---------------------------------------------------------------------------------------------------------------------------
// Scène

interface Resident {
  snoid: Snoid;
}

/** Habitant porté par le pointeur (`1168:1742` + `1168:58c7`, voir l'en-tête). */
interface Carry {
  resident: Resident;
  /** Pieds à la prise, écart pointeur / pieds à la prise, abscisse du pointeur au tour précédent. */
  origin: Point;
  grab: Point;
  lastX: number;
  /** Transport collé (`DS:9b40`) et bouton tenu depuis la prise (`DS:9b3e`). */
  sticky: boolean;
  held: boolean;
  startedAt: number;
  hidden: boolean;
  /** Profondeur rendue au dépôt. */
  depth: number;
}

/** Objet en monde (petit décor animé, objet décoratif) : sa feature a une position relative dans l'anneau. */
interface WorldItem {
  feature: Feature;
}

interface DecorSlot {
  feature: Feature;
  finished: boolean;
}

export interface TownOptions {
  /** Heure de l'horloge du beffroi : la date locale du moment (défaut : `host.unixMillis()`). */
  now?: (ctx: SceneContext) => Date;
}

export function createTownScene(options: TownOptions = {}): Scene {
  let archive: Archive;
  let view: TownView | undefined;
  /** Sons tirés sans répétition (`DS:3962`) : gardés d'une visite à l'autre. */
  const chatter = new NoRepeatPool(CHATTER.length, 0);

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(ARCHIVE);
    },
    enter(ctx: SceneContext) {
      view = start(ctx, archive, chatter, options);
    },
    leave(ctx: SceneContext) {
      view?.leave(ctx);
      view = undefined;
    },
    tick() {
      view?.tick();
    },
    key(event) {
      return view?.key(event.code, event.ctrl, event.alt) ?? false;
    },
  };
}

type TownView = ReturnType<typeof start>;

function start(ctx: SceneContext, archive: Archive, chatter: NoRepeatPool, options: TownOptions) {
  const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
  const initial = zoombinis.game;
  const { game, session } = zoombinis;
  const features: Features = ctx.services.get(FEATURES);
  const sound = ctx.services.get(ZOOMBINIS_SOUND);
  const { rng } = ctx;
  const strings = ctx.services.tryGet(ZOOMBINIS_TEXT)?.strings;

  // --- Arrivée (`1188:0128`) ---
  const arrival = townArrive(game);
  const population = game.counters.town;
  const gameOver = arrival.gameOver;
  if (game.townScroll < 0 || game.townScroll > 5) game.townScroll = 0;

  openScreen(ctx, archive, { background: BACKGROUND });
  features.defineGroup(0, SHEET_TERRAIN);
  features.setScripts(SCRIPT_TERRAIN, 8);
  features.defineGroup(1, SHEET_SCENERY);
  features.addScripts(SHEET_SCENERY, 8);
  features.defineGroup(2, SHEET_CLOCK, true);
  features.addScripts(SCRIPT_CLOCK, 1);
  features.defineGroup(3, SHEET_DECOR);
  features.addScripts(DECOR_FIRST, DECOR_COUNT);

  // --- État de l'écran (variables `DS:9f.. à a0..` de l'original) ---
  let left = false;
  /** `[3966]` : la fiche ouverte (feature), ou null. */
  let card: Feature | null = null;
  /** `[a00e]` : le beffroi est dans l'image courante des monuments. */
  let clockPresent = false;
  /** Rectangles de survol de l'image courante (`9fa8` / `9fc8`). */
  let hotspots: Hotspot[] = [];
  let starsLimit = treeLimit(population);
  /** `[a026]` : objets décoratifs restant à produire. */
  let decorBudget = townDecorCount(population, gameOver);
  /** `[a014]`, `[a018]` : budget et dernier instant des évènements de danse. */
  let eventsLeft = 0;
  let lastEvent = 0;
  /** `[a01c]` : intervalle des évènements. */
  const eventInterval = game.options.lessAction ? EVENT_INTERVAL_LESS_ACTION : EVENT_INTERVAL;
  let eventPool: NoRepeatPool | null = null;
  /** Phrases : `[9fda]` dernier son, `[9fdc]` « le dernier était le récit », `[9fde]` « un son vient d'être lancé », `[9fd2]` attente, `[9fd6]` instant. */
  let phrase = 0;
  let storyLast = false;
  let phraseStarted = false;
  let phraseWait = 0;
  let phraseSince = 0;
  /** Tick où la phrase en cours sera finie (`1028:0d9e` interroge le canal par identifiant ; ici la durée du WAVE). */
  let phraseEnds = 0;
  /** Horloge : `[39a8]` (minutes / 5), `[39a9]` (heure mod 12), `[a010]` dernière relecture, `[a00c]` tours demandés (< 0 : à lancer), cible du tour (`[a028]`, `[a029]`). */
  let minuteIndex = 0;
  let hourIndex = 0;
  let lastSync: number | null = null;
  let spins = 0;
  let spinTargetMinute = 0;
  let spinTargetHour = 0;
  let clockRect: Box | null = null;
  let pressedUntil = -1;
  let exitAt = -1;
  const residents: Resident[] = [];
  const items: WorldItem[] = [];
  const decor: (DecorSlot | null)[] = Array.from({ length: DECOR_SLOTS }, () => null);
  let frozen: { feature: Feature; active: boolean }[] | null = null;
  let carry: Carry | null = null;

  const dialogOpen = (): boolean => ctx.services.tryGet(DIALOG)?.isOpen ?? false;
  const now = (): number => ctx.clock.ticks;

  // --- Couches du décor (`SCRB` 1000 à 1003) : une image par colonne (`1188:15b3`) ---
  const layerFlags = FeatureFlag.stopEachImage | FeatureFlag.firstImage;
  const layers: Feature[] = [];
  const makeLayer = (script: number, depth: number, onImage?: FeatureImageHook): Feature => {
    const feature = features.create({ script, delay: 0, depth, flags: layerFlags, onImage });
    layers.push(feature);
    return feature;
  };
  makeLayer(SCRIPT_TERRAIN, DEPTH.terrain);
  makeLayer(SCRIPT_TREES[0], DEPTH.treesA, (_feature, parts) => parts.filter((part) => part.w <= starsLimit));
  makeLayer(SCRIPT_TREES[1], DEPTH.treesB, (_feature, parts) => parts.filter((part) => part.w <= starsLimit));
  makeLayer(SCRIPT_MONUMENTS, DEPTH.monuments, (_feature, parts) => {
    const layer = monumentLayer(parts, game.monuments);
    hotspots = layer.hotspots;
    clockPresent = layer.clock;
    return layer.parts;
  });

  /** `1188:15b3` : chaque couche relit l'image de la colonne courante. */
  function showColumn(): void {
    for (const layer of layers) {
      features.seek(layer, game.townScroll);
      layer.active = true;
    }
    features.invalidate();
  }

  // --- Petits décors animés (`1188:0128`, boucle des bâtiments) ---
  const scenery = new NoRepeatPool(SCENERY_POSITIONS.length, 0);
  for (let n = townBuildingCount(population); n > 0; n--) {
    const index = scenery.pick(rng);
    const [x, y] = SCENERY_POSITIONS[index]!;
    const feature = features.create({
      script: SHEET_SCENERY + (index % 8),
      delay: rng.range(4, 6),
      depth: DEPTH.scenery,
      position: { x, y },
      flags: FeatureFlag.relative | FeatureFlag.other,
    });
    items.push({ feature });
  }

  /** `1188:0a88` : décale d'une colonne les objets en monde (`direction` 1 = on regarde à droite). */
  function shiftWorld(direction: -1 | 1): void {
    for (const item of items) {
      item.feature.position.x = shiftRing(item.feature.position.x, direction);
      item.feature.next = 0;
    }
    for (const resident of residents) {
      const at = resident.snoid.position;
      resident.snoid.moveTo({ x: shiftRing(at.x, direction), y: at.y });
    }
    features.invalidate();
  }
  for (let step = game.townScroll; step > 0; step--) shiftWorld(1);

  // --- Habitants : les 20 plus récents, positions tirées dans l'anneau ---
  const scripts = screenScripts(archive);
  for (const entry of townResidents(game)) {
    const at = townResidentPosition(rng);
    const snoid = createSnoid(ctx, entry, { position: at, small: true, depth: DEPTH.residents, scripts });
    snoid.onEnd = (self) => self.idle();
    residents.push({ snoid });
  }

  // --- Bouton de la carte (`1188:0b47`) ---
  const buttons = archive.tbmpImages(BUTTONS_SHEET);
  features.create({
    script: 0,
    delay: 0,
    depth: DEPTH.overlay,
    flags: 0,
    onAfterDraw: (_feature, screen: Surface) => {
      const image = buttons[(pressedUntil >= 0 ? MAP_BUTTON_IMAGES.pressed : MAP_BUTTON_IMAGES.ready) - 1];
      if (image) drawShape(screen, image, MAP_BUTTON.x1, MAP_BUTTON.y1, 8);
    },
  });

  // --- Horloge du beffroi (`SCRB` 6000, `1188:0936`) ---
  const date = (): Date => (options.now ? options.now(ctx) : new Date(ctx.host.unixMillis()));
  function syncClock(): void {
    if (lastSync !== null && lastSync + CLOCK_RESYNC >= now()) return;
    lastSync = now();
    const time = date();
    minuteIndex = Math.floor(time.getMinutes() / 5);
    hourIndex = time.getHours() % 12;
  }
  const clock = features.create({
    script: SCRIPT_CLOCK,
    delay: CLOCK_DELAY,
    depth: DEPTH.overlay,
    flags: 0,
    onImage: (feature): FeaturePart[] => {
      clockRect = null;
      const column = game.townScroll;
      if (card || !clockPresent || (column !== 1 && column !== 2)) return [];
      if (spins === 0) syncClock();
      else if (spins < 0) {
        spinTargetMinute = minuteIndex;
        spinTargetHour = hourIndex;
        spins = -spins;
        feature.delay = CLOCK_SPIN_DELAY;
      } else {
        minuteIndex += 1;
        if (minuteIndex > 0xb) {
          minuteIndex = 0;
          hourIndex = (hourIndex + 1) % 12;
        }
        if (spinTargetMinute === minuteIndex && spinTargetHour === hourIndex && --spins === 0) {
          feature.delay = CLOCK_DELAY;
          lastSync = null;
          syncClock();
        }
      }
      const x = CLOCK_POSITION.x[column]!;
      return [
        { w: minuteIndex + 1, x, y: CLOCK_POSITION.y },
        { w: hourIndex + CLOCK_HOUR_FIRST_PART, x, y: CLOCK_POSITION.y },
      ];
    },
    onAfterDraw: (feature) => {
      const rect = feature.parts.length > 0 ? feature.rect : null;
      clockRect = rect && { x1: rect.left, y1: rect.top, x2: rect.right, y2: rect.bottom };
    },
  });

  showColumn();

  // --- Phrase d'arrivée (`1188:0128`, fin) ---
  let choice = 0;
  const memoryIndex = dialogMemoryIndex(ScreenId.town);
  if (session.lastFinal !== 0) {
    session.lastFinal = 0;
    const result = dialogChoice(game.dialogMemory[memoryIndex]!, currentLevel(game, session, ScreenId.town), session.training !== 0);
    game.dialogMemory[memoryIndex] = result.memory;
    choice = result.choice;
    if (choice === 2 && population < 0x11) {
      choice = 1;
      game.dialogMemory[memoryIndex] = game.dialogMemory[memoryIndex]! & 0xcfff;
    }
  }
  const memory = game.dialogMemory[memoryIndex]!;
  switch (choice) {
    case 1:
      phrase = memory >= 1 && memory <= 3 ? GREETINGS[memory - 1]! : GREETINGS[rng.range(1, 3) - 1]!;
      break;
    case 2:
    case 0xc:
      phrase = GREETINGS[rng.range(1, 2)]!;
      break;
    case 5:
      phrase = GREETINGS[0];
      break;
    default:
      phrase = storyStart(memory);
      storyLast = true;
  }
  if (gameOver) {
    phrase = FINAL_PHRASE;
    storyLast = true;
  }
  if (phrase !== 0) {
    say(phrase);
  }

  // --- Cartes, fiche et gel ---
  function freeze(on: boolean): void {
    if (on) {
      const targets = [clock, ...residents.map((resident) => resident.snoid.feature), ...decor.flatMap((slot) => (slot ? [slot.feature] : []))];
      frozen = targets.map((feature) => ({ feature, active: feature.active }));
      for (const target of frozen) target.feature.active = false;
    } else {
      for (const target of frozen ?? []) if (!target.feature.destroyed) target.feature.active = target.active;
      frozen = null;
    }
  }

  function openCard(slot: number): void {
    const monument = game.monuments[slot];
    if (!monument) return;
    sound.queue(SOUND_CLICK);
    const style = CARD_STYLES[slot]!;
    const lines = strings ? cardLines(strings, slot, monument) : [];
    const [outline, ink] = CARD_COLORS[style - 1]!;
    const shift = CARD_OFFSET[style - 1]!;
    card = features.create({
      script: SCRIPT_CARD_BASE + style,
      delay: 0,
      depth: CARD_DEPTH,
      flags: FeatureFlag.staticFirst | FeatureFlag.noReplay | FeatureFlag.firstImage,
      onAfterDraw: (feature, screen) => {
        const drawer = ctx.services.tryGet(ZOOMBINIS_TEXT);
        const rect = feature.rect;
        if (!drawer || !rect) return;
        lines.forEach((line, i) => {
          const area = { x: rect.left, y: rect.top + shift + CARD_EDGES[i]!, w: rect.right - rect.left, h: CARD_EDGES[i + 1]! - CARD_EDGES[i]! };
          // `10a8:0cd2` : quatre copies décalées d'un pixel (gauche, haut, droite, bas), puis le texte.
          for (const [dx, dy] of [[-1, 0], [0, -1], [1, 0], [0, 1]] as const) {
            drawer.drawText(screen, CARD_FONTS[i]!, line, { ...area, x: area.x + dx, y: area.y + dy }, TextFlags.center | TextFlags.vcenter, outline);
          }
          drawer.drawText(screen, CARD_FONTS[i]!, line, area, TextFlags.center | TextFlags.vcenter, ink);
        });
      },
    });
    freeze(true);
    ctx.setCursor("system");
    features.invalidate();
  }

  function closeCard(): void {
    if (!card) return;
    sound.queue(SOUND_CLICK);
    features.destroy(card);
    card = null;
    freeze(false);
    features.invalidate();
  }

  // --- Objets décoratifs (`1188:1cdf`) ---
  function spawnDecor(): void {
    const index = decor.findIndex((slot) => slot === null);
    if (index < 0) return;
    const script = rng.range(0, 100) < 0x33 ? rng.range(8022, 8043) : rng.range(8000, 8021);
    const [low, high] = decorHeight(script);
    const y = rng.range(low, high);
    const x = rng.range(DECOR_X.min, DECOR_X.max);
    const slot: DecorSlot = { feature: undefined as unknown as Feature, finished: false };
    slot.feature = features.create({
      script,
      delay: 6,
      depth: DEPTH.decor,
      position: { x, y },
      flags: FeatureFlag.relative | FeatureFlag.stopAtEnd | FeatureFlag.other,
      onEvent: (_image, n) => {
        if (n === FEATURE_END) slot.finished = true;
      },
    });
    decor[index] = slot;
    items.push({ feature: slot.feature });
    if (decorBudget > 0) decorBudget -= 1;
  }

  function sweepDecor(): void {
    decor.forEach((slot, i) => {
      if (!slot?.finished) return;
      features.destroy(slot.feature);
      const at = items.findIndex((item) => item.feature === slot.feature);
      if (at >= 0) items.splice(at, 1);
      decor[i] = null;
    });
  }

  // --- Évènements : un habitant visible danse (`1188:0ce5`, `1168:3f76`) ---
  function runEvents(): void {
    if (residents.length === 0) return;
    if (eventsLeft < 1) {
      eventsLeft = eventBudget(population);
      return;
    }
    if (eventInterval >= now() - lastEvent) return;
    lastEvent = now();
    eventPool ??= new NoRepeatPool(Math.min(residents.length, 32), 0);
    for (let tries = 0; tries < EVENT_ATTEMPTS; tries++) {
      const resident = residents[eventPool.pick(rng)]!;
      if (resident === carry?.resident) continue;
      const x = resident.snoid.position.x;
      if (x > EVENT_VISIBLE.min && x < EVENT_VISIBLE.max) {
        resident.snoid.play(4999 + resident.snoid.traits.feet, FeatureFlag.stopAtEnd);
        eventsLeft -= 1;
        return;
      }
    }
  }

  // --- Phrases (`1188:0ce5`) ---
  /** Durée en ticks du son `id` (`TOWN.MHK` sous 20000, `ZOOMBINI.MHK` sinon), 0 s'il est absent ou si les effets sont coupés. */
  function soundTicks(id: number): number {
    if (!sound.effectsEnabled) return 0;
    const from = id >= 1000 && id < 20000 ? archive : ctx.resources.get(COMMON_ARCHIVE);
    if (!from?.has(TAG_SND, id)) return 0;
    const pcm = loadPcm(from.mohawk, id);
    return Math.ceil(pcm.samples.length / pcm.sampleRate / TICK_SECONDS);
  }

  function say(id: number): void {
    phrase = id;
    sound.queue(id);
    phraseStarted = true;
    phraseEnds = now() + soundTicks(id);
  }

  const voiceBusy = (): boolean => now() < phraseEnds;

  function runPhrases(): void {
    if (voiceBusy()) return;
    if (phraseStarted) {
      phraseSince = now();
      phraseWait = rng.range(PHRASE_WAIT.min, PHRASE_WAIT.max);
      phraseStarted = false;
      if (gameOver) decorBudget = TOWN_END_GAME_DECOR_BURST;
    }
    if (phraseWait >= now() - phraseSince) return;
    phraseSince = now();
    if (!storyLast || gameOver) {
      if (phrase < 20000) {
        phrase += 1;
        if (phrase > STORY_LAST) phrase = STORY_FIRST;
      } else {
        phrase = storyStart(game.dialogMemory[memoryIndex]!);
      }
      storyLast = true;
    } else {
      storyLast = false;
      let id: number;
      do {
        id = CHATTER[chatter.pick(rng)]!;
      } while (id === CHATTER_LIMIT_SOUND && population > CHATTER_LIMIT_POPULATION);
      phrase = id;
    }
    say(phrase);
  }

  // --- Entrées ---
  const hotspotAt = (x: number, y: number): Hotspot | undefined => hotspots.find((spot) => contains(spot.box, x, y));
  const inBand = (x: number, y: number): boolean => y > 0x1e && y < 0x1c2 && x > 3 && x < 0x27d;

  function leaveToMap(): void {
    if (left) return;
    left = true;
    zoombinis.goTo(ctx, ScreenId.map);
  }

  /** `1188:1071` (clic gauche). */
  function click(x: number, y: number): void {
    if (card) return closeCard();
    if (contains(MAP_BUTTON, x, y)) {
      sound.queue(SOUND_CLICK);
      pressedUntil = now() + PRESS_TICKS;
      exitAt = pressedUntil;
      features.invalidate();
      return;
    }
    // `11a8:0d61` : la feature « cliquable » (drapeaux 2) la plus en avant sous le pointeur ; un habitant se prend avant tout le reste.
    const resident = residentAt(x, y);
    if (resident) return pickResident(resident, x, y);
    if (clockRect && spins === 0 && contains(clockRect, x, y)) spins = -1;
    const spot = hotspotAt(x, y);
    if (spot) return openCard(spot.slot);
    const direction = townScrollDirection(x, y);
    if (direction === 0) return;
    sound.queue(SOUND_CLICK);
    townScrollBy(game, direction);
    clockPresent = false;
    shiftWorld(direction === 1 ? 1 : -1);
    showColumn();
  }


  // --- Glissement d'un habitant (`1188:1071` → `1168:1742` / `1168:58c7`) ---
  /** L'habitant sous le point : le plus en avant (`11a8:0d61` parcourt la liste à partir de la feature la plus devant). */
  function residentAt(x: number, y: number): Resident | null {
    let found: Resident | null = null;
    for (const resident of residents) {
      const rect = resident.snoid.feature.rect;
      if (resident.snoid.destroyed || !rect) continue;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
      if (!found || resident.snoid.feature.depth >= found.snoid.feature.depth) found = resident;
    }
    return found;
  }

  function pickResident(resident: Resident, x: number, y: number): void {
    const { snoid } = resident;
    const at = snoid.position;
    const hidden = ctx.prefs.hideCursorWhileCarrying;
    carry = {
      resident,
      origin: { x: at.x, y: at.y },
      grab: { x: x - at.x, y: y - at.y },
      lastX: x,
      sticky: ctx.prefs.magneticMouse,
      held: true,
      startedAt: now(),
      hidden,
      depth: snoid.feature.depth,
    };
    // Devant tout, délai 3, animation de transport `145 + pieds` (état 5).
    features.restack(snoid.feature, CARRY_DEPTH);
    snoid.delay = CARRY_DELAY;
    snoid.play(CARRY_SCRIPT_BASE + snoid.traits.feet);
    ctx.setCursor(hidden ? HIDDEN_CURSOR : "system");
  }

  /** Un tour de `1168:1742` : l'habitant suit le pointeur (borné à l'écran, tourné du côté où il va) ; `1168:58c7` décide de la fin. */
  function updateCarry(pressed: boolean): void {
    const current = carry!;
    const { input } = ctx;
    const x = Math.max(SCREEN_BOUNDS.left, Math.min(SCREEN_BOUNDS.right, input.mouseX - current.grab.x));
    const y = Math.max(SCREEN_BOUNDS.top, Math.min(SCREEN_BOUNDS.bottom, input.mouseY - current.grab.y));
    if (input.mouseX < current.lastX) current.resident.snoid.setFacing(1);
    else if (input.mouseX > current.lastX) current.resident.snoid.setFacing(0);
    current.lastX = input.mouseX;
    current.resident.snoid.setPosition({ x, y });
    let down = input.isButtonDown("left");
    let done = false;
    if (!current.sticky) {
      if (!down) {
        if (game.options.autoMagnet && now() - current.startedAt < game.unknown02) {
          current.sticky = true;
          current.held = false;
        } else {
          done = true;
        }
      }
    } else {
      if (pressed) down = true;
      if (current.held && !down) current.held = false;
      if (!current.held && down) done = true;
    }
    if (done) dropResident({ x, y });
  }

  /**
   * Fin du transport. La ville ne déclare aucune zone de dépôt (**probable** : `1520:0000` n'est posé par aucun code de `1188`), l'habitant n'est donc jamais
   * « accepté » : `1188:1071` ne retient sa nouvelle place que si ses pieds sont dans la bande 410 à 475 ; sinon il retourne d'un coup où il a été pris
   * (état 4 de `1168:0ba8` : variante d'attente 1, tourné à droite).
   */
  function dropResident(at: Point): void {
    const current = carry!;
    carry = null;
    if (current.hidden) ctx.setCursor("system");
    const { snoid } = current.resident;
    features.restack(snoid.feature, current.depth);
    snoid.delay = 6;
    if (at.y > RESIDENT_HOME_BAND.min && at.y < RESIDENT_HOME_BAND.max) {
      snoid.moveTo(at);
    } else {
      snoid.idleVariant = SNAP_IDLE_VARIANT;
      snoid.setFacing(0);
      snoid.moveTo(current.origin);
    }
    snoid.idle();
  }

  function updateCursor(): void {
    if (card || dialogOpen()) return;
    const x = ctx.input.mouseX;
    const y = ctx.input.mouseY;
    ctx.setCursor(inBand(x, y) && hotspotAt(x, y) ? "curs1" : "system");
  }

  /** Touches du mode de test `[a43f]` (`1188:1380`). */
  function testKey(code: string): boolean {
    switch (code) {
      case "Delete": {
        const date = new Date(ctx.host.unixMillis());
        for (let slot = 0; slot < MONUMENT_SLOTS; slot++) {
          if (game.monuments[slot]) continue;
          const n = testCounter++;
          game.monuments[slot] = { stage: (Math.trunc(n / 4) & 3) + 1, level: (n & 3) + 1, year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
        }
        showColumn();
        return true;
      }
      case "Digit0":
        game.monuments.fill(null);
        showColumn();
        clockPresent = false;
        return true;
      case "KeyF":
        decorBudget = decorBudget === 0 ? 100 : 0;
        return true;
      case "ArrowLeft":
      case "ArrowRight": {
        starsLimit += code === "ArrowRight" ? 5 : -5;
        if (starsLimit > TREES_BASE + TREES_MAX) starsLimit = TREES_BASE + TREES_MAX + 1;
        if (starsLimit < TREES_BASE) starsLimit = TREES_BASE + 1;
        showColumn();
        return true;
      }
      default:
        return false;
    }
  }
  let testCounter = 0;

  return {
    tick(): void {
      if (left) return;
      if (pressedUntil >= 0 && now() >= exitAt) {
        pressedUntil = -1;
        features.invalidate();
        return leaveToMap();
      }
      sweepDecor();
      // `SCRB` 6000 n'a qu'une image : le moteur l'arrête après la première lecture ; l'horloge est relue à son délai (2 ou 6 ticks) tant que la ville n'est pas gelée.
      if (!frozen) clock.active = true;
      if (!dialogOpen()) {
        let pressed = false;
        for (const event of ctx.input.buttonEvents) {
          if (left) return;
          if (!event.down) continue;
          // La boucle de `1168:1742` est bloquante : pendant un transport, un appui (quel que soit le bouton) ne fait que décider du dépôt.
          if (carry) pressed = true;
          else if (event.button === "left") click(event.x, event.y);
        }
        if (carry) updateCarry(pressed);
        if (!card) {
          if (decorBudget > 0) spawnDecor();
          runPhrases();
          runEvents();
        }
      }
      if (!carry) updateCursor();
    },
    key(code: string, ctrl: boolean, alt: boolean): boolean {
      if (!game.options.testMode || ctrl || alt) return false;
      return testKey(code);
    },
    leave(leaveCtx: SceneContext): void {
      // `1188:0c1d` : le groupe est marqué rangé (`[a406]`), sauf si la partie a été remplacée sous l'écran.
      if (zoombinis.game === initial && !session.leftToMap) {
        session.leftToMap = true;
        game.group.members = [];
        game.group.flagA = true;
        game.group.flagB = true;
      }
      left = true;
      if (carry?.hidden) leaveCtx.setCursor("system");
      carry = null;
      closeScreen(leaveCtx);
    },
  };
}
