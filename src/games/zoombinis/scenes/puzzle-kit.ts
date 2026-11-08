/**
 * Kit commun des épreuves (vague H, tâche H0) : le segment `1168` et les appels `11a8` / `11a0` que les 12 écrans d'épreuve partagent.
 * Aucune épreuve ne réécrit ces mécanismes ; elle fournit ses places, ses cibles de dépôt, un rappel de décision et ses boutons.
 * Documentation : `docs/zoombinis/engine.md` (§3.6 états du snoid, §4.2 marche, §7 touches) et `docs/zoombinis/engine-ts.md`, « Kit des épreuves (tâche H0) ».
 *
 * ## Ce que le kit porte (et l'original qui y correspond)
 *
 *  1. **Arrivée du groupe** (`11a8:0ed9`, `1168:0858`, `1168:2505`, `1168:274e`) : `arrive()`. Le groupe de la scène (`party`, copie des
 *     présents du tampon) va sur la liste de places d'attente (le membre `i` sur la place `i`). Hors reprise et hors « moins d'action »
 *     (`DS:9a26`), seuls les `⌊3N/4⌋` premiers sont déjà debout ; les autres entrent à pied depuis `x = −50` (à l'ordonnée de leur place
 *     plus `yOffset`) et leurs départs sont échelonnés, du côté de la place la plus à droite vers la plus à gauche, d'un délai de départ
 *     puis d'un écart (`1168:274e(départ, écart)`, 30 et 45 ticks pour la plupart des écrans, 0 et 45 aux gorges ; fleens 200).
 *     `walking` est `DS:9702` (Zoombinis encore en marche), `arrived` est `DS:9704` (arrivés).
 *  2. **Glisser-déposer** (`1168:1742` et `1168:58c7`) : `pick` à l'appui sur un Zoombini immobile, puis le Zoombini suit le pointeur (pris par
 *     l'endroit où on l'a saisi, retenu dans `bounds`), tourné du côté où il va, en profondeur maximale, délai de 3 ticks et animation de
 *     transport `145 + pieds` (état 5). La fin du transport suit `1168:58c7` : relâcher le bouton dépose ; avec « souris aimantée » le
 *     transport est collé (relâcher ne dépose pas, le clic suivant dépose) ; avec « auto-aimantation » un appui plus court que
 *     `GameState.unknown02` (`[a438]`, 0 par défaut donc jamais) devient collé. `hideCursorWhileCarrying` masque le curseur pendant le transport.
 *     Les cibles sont des points (pieds) avec un propriétaire (`1520:0x00fc + 4k`, `1520:0x2f0 + 2k`) ; une cible libre est « prise » si
 *     elle est dans le carré de demi-côté `radius` (`DS:9706`, 15 par défaut) autour des pieds. L'épreuve décide par `decide`
 *     (vrai : le Zoombini se pose sur la cible ; faux ou hors cible : il retourne à sa place d'origine). Dans les deux cas il
 *     « téléporte » (état 4 : position posée d'un coup, variante d'attente 1, tourné à droite) puis reprend son profondeur.
 *  3. **Animations d'attente** : `Snoid.waitAnimations` (états 0 et 6, scripts 130 à 145) ; le kit appelle `tickWait()` pour tout le groupe.
 *  4. **Sortie** : `Zoombini.present` est le drapeau « sauvé » (`+0x127`), `markAll` est `1168:3dd0`. `pressMap` (son 999, avertissement de
 *     `confirmLeaveToMap`, abandon) et `pressGo` (son 996, `departSaved` = `1168:2982`, puis changement d'écran quand le son est fini ou au clic suivant)
 *     appellent `exitPuzzle` puis `ZOOMBINIS_GAME.goTo(nextScreen(…))`. Les images des boutons sont à l'épreuve ; le kit ne gère que l'état et le clic.
 *  5. **Enregistrement** (`11a0:141e` → `1168:36e1(1, 1)`) : avant chaque écriture de la partie par les dialogues, le groupe de la scène est
 *     rangé dans le tampon (`GameState.group`), tous présents (sans perte ni réussite).
 *  6. **Aide vocale** : `introVoice` (`DS:a2c4`) rejouée, ou coupée si elle joue encore, par `F1` (code `0x16f` = `VK_F1 + 0xff`, `11a0:155e`).
 *  7. **Musique** : `PUZZLE_MUSIC` / `puzzleMusicId`, `playMusic()`.
 *
 * Écarts assumés : pas de transport au clavier (`DS:96fe`) ; pas de fin de transport forcée par un minuteur de l'épreuve (`DS:96f4`) sauf par
 * `endCarry()` ; la mise en surbrillance des cibles pendant le transport est un simple rappel `onHover` ; pas de pose fixe (`DS:96fa`) ;
 * le curseur masqué est le type `hidden` (`HIDDEN_CURSOR`, `none` dans le navigateur).
 *
 * ## Ce que l'épreuve peut brancher (sans rien contourner)
 *
 *  - **Boutons** : `spec.buttons.map` / `go` (rectangle, images fournies par l'épreuve que le kit dessine, durée de l'image enfoncée, rappel de
 *    pression `onPress`) ; état lisible `buttonState()` / `pressed`. `goEnabled` redessine tout seul.
 *  - **Pointeur** : `spec.onPointer` reçoit chaque appui et relâchement, même quand le kit est suspendu.
 *  - **Transport d'objet** : `carryObject(spec)` fait porter par le pointeur autre chose qu'un Zoombini (crapaud, baguette, cristal…) avec le même
 *    protocole (`1168:58c7`) ; le transport d'un Zoombini en est un cas particulier. `cancelObjectCarry()` l'abandonne.
 *  - **Dépôt non accepté** : `spec.onDropOutside` décide où va le Zoombini (ponton, place d'attente de repli) avant le retour par défaut.
 *  - **Marches** : `walk(membre, destination, arrivée, options)` tient `walking` / `arrived` et rend la main si le marcheur est repris.
 *  - **Arrivée** : `arrive({ …, standing: true })` met tout le groupe debout (sans entrée à pied).
 *  - **Sortie** : `markAll` marque « sauvé » ; `pressGo({ saveAll, depart, sound, end })` (son 996 tout de suite ou différé, fin au son ou menée par
 *    l'épreuve) ; `finish()` ; `suspend()` / `resume()` gèlent le kit pendant un départ propre à l'épreuve ; `soundIdle()` dit si plus aucun son ne
 *    joue, `isPlaying(id)` si le son `id` est en file ou en cours.
 */
import type { Shape } from "../../../data/mohawk/shap";
import { drawShape } from "../../../engine/mohawk/graphics/blit";
import type { Input, KeyEvent } from "../../../engine/mohawk/input";
import { DIALOG, confirmLeaveToMap } from "../engine/dialog";
import { FEATURES, FeatureFlag, type Feature } from "../engine/features";
import { ZOOMBINIS_GAME } from "../engine/game";
import { screenKeyCode } from "../engine/shortcuts";
import type { CursorKind, Host } from "../engine/host";
import type { SceneContext } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/services";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { currentLevel, exitPuzzle, leaveMap, nextScreen } from "../game/route";
import { testMode, type GameDate, type Zoombini } from "../game/state";
import type { Point, WalkMap } from "../data/zoombini";
import { createSnoid, type Snoid, type SnoidOptions } from "./snoid";

// ---------------------------------------------------------------------------------------------------------------------------
// Constantes de l'original

/** Sons de `ZOOMBINI.MHK` communs aux épreuves : « go » (`996`), jingle d'entrée (`997`, certaines épreuves seulement), carte (`999`). */
export const SOUND_GO = 996;
export const SOUND_ENTRY = 997;
export const SOUND_MAP = 999;

/**
 * Voix de réussite (tous sauvés, `20055…20063`) et de regret (`20045…20048`). Aucune fonction commune ne les choisit : chaque épreuve tire
 * `10a8:04e8(max, min)` à sa façon (`10c8:1574`, `10f8:3e84`, `1118:18e8`, `1130:15bb`, `1150:2fdb`, `1158:0ff9` pour la réussite ;
 * `10f8:7934`, `1120:0717`, `1130:15d0` pour le regret) ; la condition est propre à l'épreuve. Le kit ne fait que tirer et mettre en file.
 */
export const SUCCESS_VOICES = { first: 20055, last: 20063 } as const;
export const REGRET_VOICES = { first: 20045, last: 20048 } as const;

/** Touche d'aide vocale : code `0x16f` du moteur = `VK_F1 (0x70) + 0xff` (`1148:0ea4`, `WM_KEYDOWN`) ; ensuite `11a0:155e`. */
export const HELP_KEY = "F1";

/** Abscisse de départ de ceux qui entrent à pied (`1168:2505` : `0xffce`). */
export const WALK_IN_X = -50;
/** Demi-côté du carré de prise des cibles, `DS:9706` (`1168:0034` : 15 ; propre à chaque épreuve ensuite : 55 aux gorges, 100 aux nizibooms…). */
export const DEFAULT_RADIUS = 15;
/** Délai entre deux images d'un Zoombini transporté (`+0x28 = 3`). */
export const CARRY_DELAY = 3;
/** Profondeur d'un Zoombini transporté (l'original le met devant tout : id `0xfffd`). */
export const CARRY_DEPTH = 1000;
/**
 * Profondeur par défaut des images des boutons : devant tout le décor et les Zoombinis (les boutons de l'original portent `0x1000` et passent devant tout),
 * derrière un objet porté (`CARRY_DEPTH`). Une profondeur de 0 les cachait derrière un avant-plan (cristal : `SCRB` 11077, bug 33).
 */
export const BUTTONS_DEPTH = 100;
/** Script d'animation de transport : `145 + pieds` (état 5, `146…150`). */
export const CARRY_SCRIPT_BASE = 145;
/** Variante d'attente posée par l'état 4 quand le Zoombini est « téléporté » sur sa destination. */
export const SNAP_IDLE_VARIANT = 1;

/** Boutons de l'angle bas-droit communs à la plupart des épreuves (rectangles inclusifs de leurs régions 1 et 2). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export const BUTTON_MAP: Readonly<Rect> = { left: 600, top: 403, right: 639, bottom: 440 };
export const BUTTON_GO: Readonly<Rect> = { left: 600, top: 441, right: 639, bottom: 478 };

/** Zone où un Zoombini transporté peut aller (`DS:6092` par défaut dans l'original) : l'écran entier. */
export const SCREEN_BOUNDS: Readonly<Rect> = { left: 0, top: 0, right: SCREEN_WIDTH - 1, bottom: SCREEN_HEIGHT - 1 };

/** Écart (pixels de l'écran) en deçà duquel un doigt relâché n'a pas glissé : c'est un toucher (prise en main, `updateCarry`). */
export const TAP_SLOP = 4;

/** Curseur masqué pendant le transport (`11e8:77bc`) : `hidden` de `CursorKind`, associé à `none` par l'hôte du navigateur. */
export const HIDDEN_CURSOR: CursorKind = "hidden";

// ---------------------------------------------------------------------------------------------------------------------------
// Musique

/** Musique `tMID` (`MIDIMPC.MHK`) lancée à l'`Enter` d'une épreuve : `base + niveau` (niveau de `1168:515d`), jusqu'à `maxLevel` inclus. */
export interface PuzzleMusic {
  base: number;
  maxLevel: number;
}

/**
 * Musique de chaque épreuve (écran 7 à 18), relevée dans le code (appels `11a0:0ee7(0, id)` avec `id ≥ 30000` de chaque `Enter`) :
 * hôtel `30020 + niveau` (`10e8:0b72`, relancée à `10e8:0de7`), tanière du sphinx `30025 + niveau` seulement si `[7106] < 4` (`10c8:091b` ;
 * `caves.md` : niveaux 0 à 2), piège de cristal `30030 + niveau` (`1158:0a5f`), gouffre des véhibules `30035 + niveau` (`1118:1173`).
 * Les huit autres épreuves n'en lancent aucune. Les 18 `tMID` de `MIDIMPC.MHK` sont 30000, 30001 (choix), 30020…30023, 30025…30028,
 * 30030…30033 et 30035…30038 ; 30028 n'est lancée par aucune épreuve relevée.
 */
export const PUZZLE_MUSIC: Readonly<Record<number, PuzzleMusic | null>> = {
  7: null, // BRIDGE
  8: null, // TUNNELS
  9: null, // PIZZA
  10: null, // FERRY
  11: null, // LILLY
  12: null, // SLIDES
  13: null, // FLEENS
  14: { base: 30020, maxLevel: 3 }, // HOTEL
  15: null, // NET
  16: { base: 30025, maxLevel: 2 }, // CAVES
  17: { base: 30030, maxLevel: 3 }, // SMOKE
  18: { base: 30035, maxLevel: 3 }, // MAZE2
};

/** Id de la musique de l'épreuve `screen` au niveau `level` (0 à 3), ou null si elle n'en a pas. */
export function puzzleMusicId(screen: number, level: number): number | null {
  const music = PUZZLE_MUSIC[screen];
  if (!music || level < 0 || level > music.maxLevel) return null;
  return music.base + level;
}

// ---------------------------------------------------------------------------------------------------------------------------
// Modèle

/** Une cible de dépôt ou place d'attente : un point (les pieds) et le Zoombini qui l'occupe (`1520:0x00fc + 4k`, propriétaire `1520:0x2f0 + 2k`). */
export interface DropTarget {
  readonly x: number;
  readonly y: number;
  owner: KitMember | null;
  /** Donnée libre de l'épreuve (zone de pont, radeau…). */
  readonly tag?: unknown;
  /**
   * Rectangle de l'image de la cible (le tabouret du bac…), lu au moment du test. Extension tactile du port : au doigt, qui cache le
   * Zoombini porté, une cible libre est aussi prise quand le doigt est sur son image (voir `findIn`).
   */
  readonly area?: () => Rect | null;
  /** Objet de la zone (`1520:0x0002 + 2k`) : il rejoue son script quand un objet porté survole la cible (`1168:1742`, `Features.playZone`). */
  highlight?: Feature;
}

export function createTarget(point: Point, tag?: unknown, area?: () => Rect | null): DropTarget {
  return { x: point.x, y: point.y, owner: null, tag, area };
}

/** Un Zoombini de l'épreuve : sa fiche (copie de la scène), son personnage, la place qu'il occupe. */
export interface KitMember {
  readonly index: number;
  readonly zoombini: Zoombini;
  readonly snoid: Snoid;
  /** Cible occupée (liste de dépôt) et place d'attente occupée (peuvent être le même objet). */
  target: DropTarget | null;
  waiting: DropTarget | null;
  /** En marche (entrée à pied, sortie, retour) : ni pris ni déposé. */
  walking: boolean;
}

/** Ce que l'épreuve apprend d'un dépôt et sur quoi elle décide. */
export interface DropInfo {
  member: KitMember;
  /** Cible libre prise par le carré de prise, ou null (hors cible). */
  target: DropTarget | null;
  /** Cible occupée avant le transport. */
  from: DropTarget | null;
  /** Position des pieds au relâchement, et à la prise. */
  position: Point;
  origin: Point;
}

/** Les deux boutons de l'angle bas-droit. */
export type ButtonId = "map" | "go";

/** État affiché d'un bouton : le « go » est grisé tant que l'épreuve ne l'active pas (`goEnabled`) ; la carte n'est jamais grisée. */
export type ButtonState = "disabled" | "normal" | "down";

/** Images d'un bouton, fournies par l'épreuve (planche de son archive). Une image absente n'est pas dessinée. */
export interface KitButtonImages {
  normal?: Shape;
  down?: Shape;
  /** Seulement pour « go ». */
  disabled?: Shape;
}

/**
 * Un bouton géré par le kit. `{}` suffit : rectangle par défaut (`BUTTON_MAP` / `BUTTON_GO`), pas d'image, image enfoncée tant que le bouton est
 * tenu, action par défaut.
 */
export interface KitButtonSpec {
  rect?: Readonly<Rect>;
  /** Images : si une épreuve en donne, le kit les dessine (feature de profondeur `buttons.depth`) ; sinon elle dessine d'après `buttonState`. */
  images?: KitButtonImages;
  /**
   * Durée (ticks) de l'image enfoncée après un clic. Absente : l'image est enfoncée tant que le bouton de la souris est tenu sur le bouton
   * (pas pendant un transport ; « go » seulement s'il est actif).
   */
  hold?: number;
  /**
   * Rappel de pression, appelé au clic (pour « go » : seulement s'il est actif) avant l'action par défaut (`pressMap` / `pressGo`). Vrai : l'épreuve
   * a traité le clic, le kit ne fait rien de plus ; faux ou rien : l'action par défaut suit. L'image enfoncée est déjà demandée.
   */
  onPress?: (kit: PuzzleKit) => boolean | void;
}

/** Une image de la planche de boutons commune aux épreuves : « go » 1 grisé / 2 actif / 3 enfoncé, carte 5 / 6 (rang 1-based, `10c0:045f`). */
export function sheetButtonImages(shapes: readonly Shape[]): { map: KitButtonImages; go: KitButtonImages } {
  return {
    map: { normal: shapes[4], down: shapes[5] },
    go: { disabled: shapes[0], normal: shapes[1], down: shapes[2] },
  };
}

/** Un événement du pointeur, vu par `spec.onPointer`. */
export interface PointerInfo {
  x: number;
  y: number;
  /** Appui (vrai) ou relâchement (faux). */
  down: boolean;
  button: string;
}

/** Où va un Zoombini dont le dépôt n'est pas accepté, au lieu de sa place d'origine (`spec.onDropOutside`). */
export interface OutsidePlacement {
  /** Destination (pieds). */
  at: Point;
  /** Y va à pied (marche du kit, non comptée dans `walking`) au lieu d'y être posé d'un coup. À pied, il part du point de dépôt. */
  walk?: boolean;
  /** Place d'attente qu'il occupe désormais (liste B ; et cible libre correspondante). Absente : aucune. */
  place?: DropTarget | null;
}

/** Options d'une marche lancée par l'épreuve (`PuzzleKit.walk`). */
export interface WalkOptions {
  /** Compte dans `walking` puis `arrived` (`DS:9702` / `9704`). Défaut vrai. */
  counted?: boolean;
  /** Reste saisissable pendant la marche (`member.walking` reste faux) ; une prise annule la marche. Défaut faux. */
  pickable?: boolean;
}

/** Options de `pressGo`. */
export interface GoOptions {
  /** `1168:3dd0(0, 1)` : tout le groupe est sauvé avant le départ. */
  saveAll?: boolean;
  /** Départ fourni par l'épreuve, à la place de la marche `exitWalk` des sauvés. */
  depart?: () => void;
  /**
   * Son de départ : `"now"` (défaut) coupe les effets et joue 996 tout de suite ; `"later"` ne joue rien, l'épreuve le lance à son heure
   * (`playGoSound()`, sans couper les effets en cours).
   */
  sound?: "now" | "later";
  /**
   * Fin du départ : `"sound"` (défaut) : `finish("success")` quand le son est fini ; `"depart"` : l'épreuve mène tout le départ et appelle
   * `finish("success")` elle-même, le kit est gelé (`suspend`, plus d'animation d'attente ni de prise) et seul un clic quitte tout de suite.
   * Dans les deux cas un clic pendant le départ quitte l'écran.
   */
  end?: "sound" | "depart";
}

/** Un dépôt d'objet (`carryObject`) : la cible libre prise, d'où il vient, où il est lâché. */
export interface ObjectDrop {
  /** Cible libre prise par le carré de prise, ou null. */
  target: DropTarget | null;
  /** Cible occupée avant le transport (`ObjectCarrySpec.from`). */
  from: DropTarget | null;
  /** Position de l'objet au relâchement, et à la prise. */
  position: Point;
  origin: Point;
}

/**
 * Un objet quelconque que l'épreuve fait porter par le pointeur (`PuzzleKit.carryObject`) : même protocole que le transport d'un Zoombini
 * (`1168:58c7` : souris aimantée, auto-aimantation, curseur masqué, fin forcée `endCarry`). L'épreuve dessine l'objet : le kit lui donne la
 * position à chaque tick (`onMove`) et la profondeur de transport (`feature`).
 */
export interface ObjectCarrySpec {
  /** Position de l'objet à la prise (retour par défaut, `ObjectDrop.origin`). */
  origin: Point;
  /** Écart entre le pointeur et l'objet à la prise (défaut 0, 0 : l'objet est sous le pointeur). */
  grab?: Point;
  /** Dessin de l'objet : passé devant tout (`CARRY_DEPTH`) pendant le transport. Le kit ne lui rend pas sa profondeur : l'épreuve le fait dans `onDrop` / `onReturn`. */
  feature?: Feature | null;
  /** Cible occupée avant le transport. */
  from?: DropTarget | null;
  /** Cibles de dépôt (défaut : aucune) et demi-côté du carré de prise (défaut : celui du kit) ; une cible occupée n'est jamais prise. */
  targets?: readonly DropTarget[];
  radius?: number;
  /** Zone du transport (défaut : celle du kit). */
  bounds?: Readonly<Rect>;
  /** Curseur masqué pendant le transport (défaut : l'option `hideCursorWhileCarrying`). */
  hideCursor?: boolean;
  /** À chaque tick : position de l'objet (pointeur moins `grab`, borné) et sens du pointeur depuis le tick précédent (−1 gauche, 1 droite, 0). */
  onMove?: (position: Point, direction: -1 | 0 | 1) => void;
  /** Cible libre survolée (null = aucune), quand elle change. */
  onHover?: (target: DropTarget | null) => void;
  /**
   * Décision du relâchement : vrai = accepté (`onDrop`), faux = refusé (`onReturn`), `"keep"` = l'objet reste en main, collé, et le clic suivant
   * décide de nouveau (l'épreuve a déjà agi sur ce relâchement). Défaut : accepté s'il y a une cible libre autre que `from`.
   */
  decide?: (drop: ObjectDrop) => boolean | "keep";
  /** Le transport est fini (curseur rendu) : dépôt accepté / refusé. */
  onDrop?: (drop: ObjectDrop) => void;
  onReturn?: (drop: ObjectDrop) => void;
}

export interface PuzzleKitSpec {
  /** Écran de l'épreuve (7 à 18). */
  screen: number;
  /** Groupe de la scène : copie des présents du tampon (`exitPuzzle` le reçoit). Chaque entrée devient un `KitMember`. */
  party: Zoombini[];
  /** Places d'attente (`11a8:0ed9`), en pieds ; au moins autant que de membres. */
  places: readonly Point[];
  /** Cibles de dépôt (liste A). Défaut : les places d'attente. Reçoit les places (objets `DropTarget`) pour pouvoir les réutiliser. */
  targets?: (places: readonly DropTarget[]) => readonly DropTarget[];
  /** Demi-côté du carré de prise (`DS:9706`). */
  radius?: number;
  /** Zone du transport. */
  bounds?: Readonly<Rect>;
  /** Options communes des personnages (`small`, `scripts`, `idleVariant`, `delay`). */
  snoid?: Pick<SnoidOptions, "small" | "scripts" | "idleVariant" | "delay">;
  /** Profondeur d'un Zoombini posé sur le point donné. Défaut : `1 + y / 1000` (le plus bas devant). */
  depthOf?: (point: Point) => number;
  /** Animations d'attente (état 0 et 6). Défaut vrai. */
  waitAnimations?: boolean;
  /** Voix d'introduction (`DS:a2c4`), rejouée par `F1` ; 0 = aucune. */
  introVoice?: number;
  /** F1 est-elle prise en ce moment ? Défaut : toujours. Aux gorges (`10c0:0d20`) : épreuve active et plus personne en marche (`DS:9702 ≤ 0`). */
  helpAllowed?: () => boolean;
  /** Boutons : `null` = absent. Défaut : la carte (`BUTTON_MAP`) ; le « go » n'existe que si l'épreuve le donne. `depth` : profondeur des images dessinées par le kit (défaut `BUTTONS_DEPTH`, devant tout le décor). */
  buttons?: { map?: KitButtonSpec | null; go?: KitButtonSpec | null; depth?: number };
  /** Marche de sortie de `pressGo` (`1168:2982(écart, y, x)`) : point hors écran et écart entre départs (45). */
  exitWalk?: { x: number; y: number; step?: number };
  /**
   * `NODE` / `PATH` de l'écran, quand son Enter les charge (`1168:2a5c(1000)` : grottes, hutte à pizza…) : la marche de sortie les suit (`1168:2f9f`,
   * `DS:970c` remis à 0 par le bouton « go ») au lieu d'aller tout droit. Sans eux, ligne droite (gorges, muraille…).
   */
  walkMap?: WalkMap;
  /** Peut-on prendre ce Zoombini ? Défaut : personne en marche (`DS:9702 < 1`) et lui-même immobile. */
  canPick?: (member: KitMember) => boolean;
  /** Appui sur l'écran, après les boutons et avant toute prise : vrai = l'épreuve l'a traité. */
  onPointerDown?: (x: number, y: number) => boolean;
  /**
   * Chaque appui et relâchement, avant tout le reste, y compris pendant un transport et quand le kit est suspendu (`suspend()`), sauf boîte de
   * dialogue ouverte. Vrai sur un appui : l'épreuve l'a pris, le kit l'ignore.
   */
  onPointer?: (event: PointerInfo) => boolean | void;
  /** Décision d'un dépôt (défaut : accepté s'il y a une cible). */
  decide?: (drop: DropInfo) => boolean;
  /** Retours : prise, cible survolée (null = aucune), dépôt accepté, retour à l'origine, entrée à pied terminée. */
  onPick?: (member: KitMember) => void;
  onHover?: (target: DropTarget | null, member: KitMember) => void;
  onDrop?: (drop: DropInfo) => void;
  onReturn?: (drop: DropInfo) => void;
  /**
   * Dépôt non accepté (hors de toute cible libre, refusé par `decide`, ou reposé sur la place quittée : `drop.target` le dit), avant le retour par
   * défaut. Renvoyer un `OutsidePlacement` envoie le Zoombini ailleurs que sur sa place d'origine (la place quittée reste libre, `onReturn` n'est pas
   * appelé) ; ne rien renvoyer laisse le retour par défaut, suivi de `onReturn`.
   */
  onDropOutside?: (drop: DropInfo) => OutsidePlacement | null | void;
  onArrived?: (member: KitMember) => void;
}

export interface ArrivalSpec {
  /** Délai du premier départ après l'entrée et écart entre deux départs (`1168:274e`) : 30 et 45 en général. */
  startDelay: number;
  step: number;
  /** Ajouté à l'ordonnée des places pour ceux qui entrent à pied (paramètre de `1168:2505` : 0, −20 au camp, 100, 200). */
  yOffset?: number;
  /** Tout le groupe est debout sur ses places, sans entrée à pied (l'hôtel : l'original n'appelle ni `1168:2505` ni `1168:274e`). `session.resuming` est consommé comme d'habitude. */
  standing?: boolean;
}

/** Date du jour (monument de fin d'étape). */
export function today(): GameDate {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

function inside(rect: Readonly<Rect> | null | undefined, x: number, y: number): boolean {
  return !!rect && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

interface Scheduled {
  at: number;
  member: KitMember;
  run: () => void;
}

interface Carry {
  /** Objet porté (un Zoombini est un cas particulier : voir `pick`) et le membre, s'il s'agit d'un Zoombini. */
  spec: ObjectCarrySpec;
  member: KitMember | null;
  /** Pieds à la prise et cible alors occupée. */
  origin: Point;
  from: DropTarget | null;
  /** Écart entre le pointeur et les pieds à la prise (`local_6`, `local_8`). */
  grab: Point;
  lastX: number;
  /** Transport collé (`DS:9b40`) et bouton tenu depuis la prise (`DS:9b3e`). */
  sticky: boolean;
  held: boolean;
  startedAt: number;
  hidden: boolean;
  hover: DropTarget | null;
  /** Fin demandée par l'épreuve (`DS:96f4`). */
  forced: boolean;
  targets: readonly DropTarget[];
  radius: number;
  bounds: Readonly<Rect>;
}

export class PuzzleKit {
  readonly members: KitMember[] = [];
  /** Places d'attente (liste B) et cibles de dépôt (liste A). */
  readonly waitingPlaces: DropTarget[];
  readonly targets: DropTarget[];
  /** Voix d'introduction (`DS:a2c4`). */
  introVoice: number;
  /** `DS:9702` : Zoombinis lancés à pied et pas encore arrivés ; `DS:9704` : arrivés depuis. */
  walking = 0;
  arrived = 0;
  /** Sortie « go » en cours : l'écran change quand le son est fini ou au clic suivant. */
  departing = false;

  private readonly ctx: SceneContext;
  private readonly spec: PuzzleKitSpec;
  private readonly radius: number;
  private readonly bounds: Readonly<Rect>;
  private readonly scheduled: Scheduled[] = [];
  /** Marches lancées par l'épreuve (`walk`), pour les annuler à la prise. */
  private readonly walks = new Map<KitMember, { counted: boolean }>();
  private goOn = false;
  /** Fin du départ lancé par `pressGo` (`GoOptions.end`). */
  private goEnd: "sound" | "depart" = "sound";
  /** Le son 996 du départ a été mis en file (`pressGo` ou `playGoSound`). */
  private goSoundQueued = false;
  /** Gelé : l'épreuve a changé d'écran, est en train de le faire, ou mène seule un départ (`suspend`). */
  private halted = false;
  /** Bouton à l'image enfoncée, et fin de cette image (0 : tant que le bouton de la souris est tenu). */
  private pressedId: ButtonId | null = null;
  private pressedUntil = 0;
  private carry: Carry | null = null;
  private unhookSave: (() => void) | null = null;
  private introPlaying = false;
  private finished = false;
  /** `leave()` a été appelé. */
  private gone = false;

  constructor(ctx: SceneContext, spec: PuzzleKitSpec) {
    this.ctx = ctx;
    this.spec = spec;
    this.radius = spec.radius ?? DEFAULT_RADIUS;
    this.bounds = spec.bounds ?? SCREEN_BOUNDS;
    this.introVoice = spec.introVoice ?? 0;
    this.waitingPlaces = spec.places.map((p) => createTarget(p));
    this.targets = [...(spec.targets ? spec.targets(this.waitingPlaces) : this.waitingPlaces)];
    this.hookSave();
    this.hookButtons();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // État

  /** Bouton « go » actif (l'épreuve le règle : par exemple tant qu'un Zoombini est sauvé). Un changement redessine les boutons. */
  get goEnabled(): boolean {
    return this.goOn;
  }

  set goEnabled(on: boolean) {
    if (on === this.goOn) return;
    this.goOn = on;
    this.features.invalidate();
  }

  /** L'épreuve a changé d'écran (ou est en train : une sortie ne se déclenche qu'une fois), ou le kit est suspendu. */
  get left(): boolean {
    return this.halted;
  }

  /**
   * Gèle le kit : plus d'arrivée, d'animation d'attente, de prise ni de clic de bouton ; seul `spec.onPointer` reçoit encore les événements du
   * pointeur. À appeler quand l'épreuve mène seule un départ (le bac fait glisser son radeau) ; elle le termine par `finish()`.
   */
  suspend(): void {
    this.halted = true;
  }

  /** Dégèle le kit (sans effet après `finish()` ou `leave()`). */
  resume(): void {
    if (!this.finished && !this.gone) this.halted = false;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Accès

  private get sound() {
    return this.ctx.services.get(ZOOMBINIS_SOUND);
  }

  private get zoombinis() {
    return this.ctx.services.get(ZOOMBINIS_GAME);
  }

  private get features() {
    return this.ctx.services.get(FEATURES);
  }

  private get dialogOpen(): boolean {
    return this.ctx.services.tryGet(DIALOG)?.isOpen ?? false;
  }

  /** Plus aucun son (effet ou voix) en file ni en cours, quel qu'en soit l'id (`isPlaying` pour un son précis). */
  soundIdle(): boolean {
    return this.soundDone();
  }

  /** Le son `id` est en file ou en cours (`ZoombinisSound.isPlaying`). */
  isPlaying(id: number): boolean {
    return this.sound.isPlaying(id);
  }

  /** Le Zoombini transporté, s'il y en a un (null pour un objet : voir `carryingObject`). */
  get carrying(): KitMember | null {
    return this.carry?.member ?? null;
  }

  /** Un objet de l'épreuve est transporté (`carryObject`). */
  get carryingObject(): boolean {
    return this.carry !== null && this.carry.member === null;
  }

  /** Cible libre prise par le carré de prise autour de `point` (la première de la liste A, comme `1168:1742`), ou null. */
  findTarget(point: Point, own: KitMember | null = null): DropTarget | null {
    return findIn(this.targets, this.radius, point, own);
  }

  /** `finish()` a été appelé : l'écran change (contrairement à `left`, qui est aussi vrai quand le kit est seulement suspendu). */
  get finishing(): boolean {
    return this.finished;
  }

  private depthAt(point: Point): number {
    return this.spec.depthOf ? this.spec.depthOf(point) : 1 + point.y / 1000;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // 1. Arrivée du groupe (`11a8:0ed9`, `1168:0858`, `1168:2505`, `1168:274e`)

  /**
   * Crée les personnages du groupe et les met en place. Les `⌊3N/4⌋` premiers sont debout sur leur place d'attente ; les autres entrent à
   * pied (`x = −50`, départs échelonnés) sauf en reprise de partie (`session.resuming`, consommé ici comme `DS:970a`) et avec
   * « moins d'action » : alors tous sont debout. Appelé une fois, dans `enter`, après `openScreen`.
   */
  arrive(arrival: ArrivalSpec): void {
    const { game, session } = this.zoombinis;
    const { party, places } = this.spec;
    const present = party.filter((z) => z.present);
    if (places.length < present.length) {
      throw new RangeError(`PuzzleKit : ${present.length} Zoombinis pour ${places.length} places d'attente`);
    }
    // `DS:9a26` : entrée à pied, hors reprise (`DS:970a`), hors « moins d'action » (`S+0x20`) et hors `standing` ; la reprise est consommée dans tous les cas.
    const walkIn = !game.options.lessAction && !session.resuming && !arrival.standing;
    session.resuming = false;
    this.walking = 0;
    this.arrived = 0;
    const standing = walkIn ? Math.floor((present.length * 3) / 4) : present.length;
    const yOffset = arrival.yOffset ?? 0;
    present.forEach((zoombini, i) => {
      const place = this.waitingPlaces[i]!;
      const entering = i >= standing;
      const position = entering ? { x: WALK_IN_X, y: place.y + yOffset } : { x: place.x, y: place.y };
      const snoid = createSnoid(this.ctx, zoombini, {
        ...this.spec.snoid,
        position,
        depth: this.depthAt(place),
        waitAnimations: this.spec.waitAnimations ?? true,
      });
      const member: KitMember = { index: i, zoombini, snoid, target: null, waiting: null, walking: entering };
      this.members.push(member);
      if (entering) {
        this.walking += 1;
      } else {
        this.occupy(member, place);
      }
    });
    // Départs échelonnés (`1168:274e`) : par abscisse d'arrivée décroissante (la liste de `1168:280c` est triée croissante et parcourue de la fin).
    const walkers = this.members.filter((m) => m.walking);
    const order = sortedByX(walkers.map((m) => ({ member: m, x: this.waitingPlaces[m.index]!.x })));
    const now = this.ctx.clock.ticks;
    order.reverse().forEach(({ member }, k) => {
      this.scheduled.push({
        at: now + arrival.startDelay + k * arrival.step,
        member,
        run: () => this.walkInto(member, this.waitingPlaces[member.index]!),
      });
    });
    this.runDue();
  }

  private walkInto(member: KitMember, place: DropTarget): void {
    member.snoid.onArrive = () => {
      member.walking = false;
      if (this.walking > 0) {
        this.walking -= 1;
        this.arrived += 1;
      }
      this.occupy(member, place);
      this.spec.onArrived?.(member);
    };
    member.snoid.walkTo({ x: place.x, y: place.y });
  }

  /** Inscrit `member` comme occupant de `place` (liste B) et de la cible libre qui y correspond (liste A). */
  private occupy(member: KitMember, place: DropTarget): void {
    place.owner = member;
    member.waiting = place;
    member.target = place;
    if (!this.targets.includes(place)) {
      const target = this.findTarget({ x: place.x, y: place.y }, member);
      if (target) {
        target.owner = member;
        member.target = target;
      }
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick

  /** À appeler à chaque tick de la scène. */
  tick(): void {
    if (this.finished || this.gone) return;
    this.refreshPressed();
    if (this.dialogOpen) return;
    if (this.halted) {
      // Gelé : seul le crochet de pointeur reste à l'écoute.
      for (const event of this.ctx.input.buttonEvents) {
        this.spec.onPointer?.({ x: event.x, y: event.y, down: event.down, button: event.button });
        if (this.finished) return;
        // Départ mené par l'épreuve (`pressGo({ end: "depart" })`) : un clic quitte tout de suite.
        if (this.departing && event.down) {
          this.finish("success");
          return;
        }
      }
      return;
    }
    this.runDue();
    if (this.spec.waitAnimations ?? true) for (const member of this.members) if (!member.walking && this.carry?.member !== member) member.snoid.tickWait();
    this.input(this.ctx.input);
    // `1028:0d9e(996)` : on attend la fin du « Go » lui-même, pas le silence (un pas en boucle d'un Zoombini qui part ne doit pas bloquer).
    if (this.departing && this.goEnd === "sound" && this.goSoundQueued && !this.sound.isPlaying(SOUND_GO)) this.finish("success");
  }

  /** Lance les départs échus (`+0x24 ≤ maintenant`, `1168:0ba8`), le plus ancien d'abord. */
  private runDue(): void {
    const now = this.ctx.clock.ticks;
    const due = this.scheduled.filter((entry) => entry.at <= now).sort((a, b) => a.at - b.at);
    for (const entry of due) {
      this.scheduled.splice(this.scheduled.indexOf(entry), 1);
      entry.run();
    }
  }

  private soundDone(): boolean {
    return this.sound.pending.effects === 0 && this.sound.effectsPlaying === 0;
  }

  private input(input: Input): void {
    let pressed = false;
    for (const event of input.buttonEvents) {
      const taken = this.spec.onPointer?.({ x: event.x, y: event.y, down: event.down, button: event.button });
      if (this.left) return;
      if (!event.down || (taken && event.down)) continue;
      if (this.carry) {
        // Un objet de l'épreuve ne réagit qu'au bouton gauche ; un Zoombini transporté, à tous (comportement d'origine du kit).
        if (this.carry.member || event.button === "left") pressed = true;
        continue;
      }
      if (event.button !== "left") continue;
      if (this.departing) {
        // Clic pendant la marche de sortie : l'écran change tout de suite (`10b0:073d`, « ou au clic suivant »).
        this.finish("success");
        return;
      }
      this.click(event.x, event.y);
    }
    if (this.carry) this.updateCarry(input, pressed);
  }

  private click(x: number, y: number): boolean {
    const map = this.buttonSpec("map");
    if (map && inside(this.buttonRect("map"), x, y)) {
      this.press("map", map);
      if (!map.onPress?.(this)) this.pressMap();
      return true;
    }
    const go = this.buttonSpec("go");
    if (go && inside(this.buttonRect("go"), x, y)) {
      if (this.goEnabled) {
        this.press("go", go);
        if (!go.onPress?.(this)) this.pressGo();
      }
      return true;
    }
    if (this.spec.onPointerDown?.(x, y)) return true;
    return this.pick(x, y);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // 1 bis. Boutons carte et « go »

  private buttonSpec(id: ButtonId): KitButtonSpec | null {
    const given = this.spec.buttons?.[id];
    if (given !== undefined) return given;
    return id === "map" ? {} : null;
  }

  private buttonRect(id: ButtonId): Readonly<Rect> {
    return this.buttonSpec(id)?.rect ?? (id === "map" ? BUTTON_MAP : BUTTON_GO);
  }

  /** Image du bouton `id` : grisé (« go » inactif), enfoncé, ou normal. */
  buttonState(id: ButtonId): ButtonState {
    if (id === "go" && !this.goEnabled) return "disabled";
    return this.pressedId === id ? "down" : "normal";
  }

  /** Bouton dont l'image est enfoncée en ce moment. */
  get pressed(): ButtonId | null {
    return this.pressedId;
  }

  private setPressed(id: ButtonId | null, until = 0): void {
    this.pressedUntil = until;
    if (id === this.pressedId) return;
    this.pressedId = id;
    this.features.invalidate();
  }

  /** Clic sur un bouton : image enfoncée pour `hold` ticks (sans `hold`, `refreshPressed` la suit tant que la souris est tenue). */
  private press(id: ButtonId, spec: KitButtonSpec): void {
    if (spec.hold !== undefined) this.setPressed(id, this.ctx.clock.ticks + spec.hold);
  }

  /** Fin d'une image enfoncée à durée, ou image enfoncée tant que le bouton de la souris est tenu sur un bouton sans `hold`. */
  private refreshPressed(): void {
    if (this.pressedUntil > 0) {
      if (this.ctx.clock.ticks >= this.pressedUntil) this.setPressed(null);
      return;
    }
    const input = this.ctx.input;
    let held: ButtonId | null = null;
    if (input.isButtonDown("left") && !this.carry && !this.halted) {
      for (const id of ["map", "go"] as const) {
        const spec = this.buttonSpec(id);
        if (!spec || spec.hold !== undefined || (id === "go" && !this.goEnabled)) continue;
        if (inside(this.buttonRect(id), input.mouseX, input.mouseY)) {
          held = id;
          break;
        }
      }
    }
    this.setPressed(held);
  }

  /** Dessine les images des boutons par une feature, si l'épreuve en a fourni. */
  private hookButtons(): void {
    const specs = (["map", "go"] as const).map((id) => [id, this.buttonSpec(id)] as const);
    if (!specs.some(([, spec]) => spec?.images)) return;
    this.features.create({
      script: 0,
      delay: 0,
      depth: this.spec.buttons?.depth ?? BUTTONS_DEPTH,
      // Les boutons restent devant tout quand l'écran trie son décor (`0x1000` des boutons de l'original).
      flags: FeatureFlag.overlay,
      onAfterDraw: (_feature, screen) => {
        for (const [id, spec] of specs) {
          const images = spec?.images;
          if (!images) continue;
          const state = this.buttonState(id);
          const shape = state === "disabled" ? images.disabled : state === "down" ? images.down : images.normal;
          if (shape) drawShape(screen, shape, this.buttonRect(id).left, this.buttonRect(id).top, 8);
        }
      },
    });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // 2. Glisser-déposer (`1168:1742`, `1168:58c7`)

  /** Le Zoombini immobile sous le point (le plus en avant). */
  memberAt(x: number, y: number): KitMember | null {
    let found: KitMember | null = null;
    for (const member of this.members) {
      const rect = member.snoid.feature.rect;
      if (member.snoid.destroyed || member.walking || !rect) continue;
      if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) continue;
      if (!found || member.snoid.feature.depth >= found.snoid.feature.depth) found = member;
    }
    return found;
  }

  /** Prend le Zoombini sous (`x`, `y`) s'il peut l'être. Renvoie vrai si un transport commence. */
  pick(x: number, y: number): boolean {
    if (this.carry || this.left || this.departing) return false;
    const member = this.memberAt(x, y);
    if (!member) return false;
    const allowed = this.spec.canPick ? this.spec.canPick(member) : this.walking < 1;
    if (!allowed) return false;
    // Un marcheur repris abandonne sa marche : le kit rend ses compteurs.
    this.cancelWalk(member);
    const position = member.snoid.position;
    const origin = { x: position.x, y: position.y };
    const depth = member.snoid.feature.depth;
    const from = member.target;
    // La place quittée est libérée (`1168:1742` : propriétaire remis à 0 dans les deux listes).
    for (const target of [...this.targets, ...this.waitingPlaces]) if (target.owner === member) target.owner = null;
    // Un Zoombini est un objet transporté comme un autre, avec ses cibles, sa décision et ses suites propres.
    const spec: ObjectCarrySpec = {
      origin,
      grab: { x: x - position.x, y: y - position.y },
      feature: member.snoid.feature,
      from,
      targets: this.targets,
      radius: this.radius,
      onMove: (at, direction) => {
        // Tourné du côté où il va (`+0xf2`).
        if (direction < 0) member.snoid.setFacing(1);
        else if (direction > 0) member.snoid.setFacing(0);
        member.snoid.setPosition(at);
      },
      onHover: (target) => this.spec.onHover?.(target, member),
      // Relâché sur la place qu'il vient de quitter : rien à décider, il y retourne.
      decide: (drop) => drop.target !== null && drop.target !== from && (this.spec.decide ? this.spec.decide(this.dropInfo(member, drop)) : true),
      onDrop: (drop) => this.memberDropped(member, this.dropInfo(member, drop)),
      onReturn: (drop) => this.memberRejected(member, this.dropInfo(member, drop), depth),
    };
    this.beginCarry(spec, member, x);
    member.snoid.delay = CARRY_DELAY;
    member.snoid.play(CARRY_SCRIPT_BASE + member.snoid.traits.feet);
    this.spec.onPick?.(member);
    return true;
  }

  /**
   * Fait porter un objet de l'épreuve par le pointeur, avec le protocole du transport d'un Zoombini (`1168:58c7`) : souris aimantée (clic-clic),
   * auto-aimantation, curseur masqué, fin forcée par `endCarry()`. Renvoie faux si un transport est déjà en cours (ou si le kit est gelé).
   * À appeler à l'appui, depuis `spec.onPointer` (l'appui est alors pris par l'épreuve : le kit ne le compte pas comme clic de dépôt).
   */
  carryObject(spec: ObjectCarrySpec): boolean {
    if (this.carry || this.left || this.departing) return false;
    this.beginCarry(spec, null, this.ctx.input.mouseX);
    return true;
  }

  /** Abandonne le transport d'un objet sans rien décider (ni `onDrop` ni `onReturn`) : curseur rendu, l'objet reste où l'épreuve l'a mis. */
  cancelObjectCarry(): void {
    const carry = this.carry;
    if (!carry || carry.member) return;
    this.carry = null;
    if (carry.hidden) this.ctx.setCursor("system");
  }

  private beginCarry(spec: ObjectCarrySpec, member: KitMember | null, pointerX: number): void {
    const { prefs } = this.ctx;
    const hidden = spec.hideCursor ?? prefs.hideCursorWhileCarrying;
    this.carry = {
      spec,
      member,
      origin: { ...spec.origin },
      from: spec.from ?? null,
      grab: { x: spec.grab?.x ?? 0, y: spec.grab?.y ?? 0 },
      lastX: pointerX,
      sticky: prefs.magneticMouse,
      held: true,
      startedAt: this.ctx.clock.ticks,
      hidden,
      hover: null,
      forced: false,
      targets: spec.targets ?? [],
      radius: spec.radius ?? this.radius,
      bounds: spec.bounds ?? this.bounds,
    };
    if (spec.feature) {
      this.features.restack(spec.feature, CARRY_DEPTH);
      // Avec l'ordre de dessin dynamique (`Features.setDepthSort`), l'objet porté reste devant tout (extension du port, comme au camp).
      spec.feature.raised = true;
    }
    if (hidden) this.ctx.setCursor(HIDDEN_CURSOR);
  }

  /** Fin de transport demandée par l'épreuve (`DS:96f4 = 1`) : l'objet est déposé là où il est. */
  endCarry(): void {
    if (this.carry) this.carry.forced = true;
  }

  private updateCarry(input: Input, pressed: boolean): void {
    const carry = this.carry!;
    const x = Math.max(carry.bounds.left, Math.min(carry.bounds.right, input.mouseX - carry.grab.x));
    const y = Math.max(carry.bounds.top, Math.min(carry.bounds.bottom, input.mouseY - carry.grab.y));
    const direction = input.mouseX < carry.lastX ? -1 : input.mouseX > carry.lastX ? 1 : 0;
    carry.lastX = input.mouseX;
    carry.spec.onMove?.({ x, y }, direction);
    const finger = this.touchPoint(input);
    const hover = findIn(carry.targets, carry.radius, { x, y }, carry.member, finger);
    if (hover !== carry.hover) {
      if (carry.hover?.highlight) this.features.resetZone(carry.hover.highlight);
      if (hover?.highlight) this.features.playZone(hover.highlight);
      carry.hover = hover;
      carry.spec.onHover?.(hover);
    }
    // `1168:58c7` : le transport continue tant qu'elle renvoie 1.
    let down = input.isButtonDown("left");
    let done = carry.forced;
    if (!carry.sticky) {
      if (!down) {
        const { game } = this.zoombinis;
        const quick = game.options.autoMagnet && this.ctx.clock.ticks - carry.startedAt < game.unknown02;
        // Au doigt, un toucher sans glissement prend le Zoombini en main : le toucher suivant le dépose (prise puis toucher de la cible).
        const tapped = finger !== null && Math.abs(finger.x - carry.origin.x - carry.grab.x) <= TAP_SLOP && Math.abs(finger.y - carry.origin.y - carry.grab.y) <= TAP_SLOP;
        if (quick || tapped) {
          carry.sticky = true;
          carry.held = false;
        } else {
          done = true;
        }
      }
    } else {
      if (pressed) down = true;
      if (carry.held && !down) carry.held = false;
      if (!carry.held && down) done = true;
    }
    if (done) this.drop(carry, { x, y }, finger);
  }

  /** Point du doigt quand le dernier appui vient d'un doigt (`Host.pointerIsTouch`), sinon null (souris : la règle de l'original seule). */
  private touchPoint(input: Input): Point | null {
    return (this.ctx.host as Host).pointerIsTouch ? { x: input.mouseX, y: input.mouseY } : null;
  }

  private drop(carry: Carry, position: Point, finger: Point | null = null): void {
    const { spec } = carry;
    const target = findIn(carry.targets, carry.radius, position, carry.member, finger);
    const info: ObjectDrop = { target, from: carry.from, position, origin: carry.origin };
    // `1168:1742` : au lâcher, la zone survolée revient au repos.
    if (carry.hover?.highlight) this.features.resetZone(carry.hover.highlight);
    carry.hover = null;
    // La décision se prend le transport déjà fini (`kit.carrying` est nul pour l'épreuve), sauf si elle garde l'objet en main.
    this.carry = null;
    const verdict = spec.decide ? spec.decide(info) : target !== null && target !== carry.from;
    if (verdict === "keep" && !carry.forced) {
      this.carry = carry;
      carry.sticky = true;
      carry.held = false;
      return;
    }
    if (carry.hidden) this.ctx.setCursor("system");
    if (spec.feature) spec.feature.raised = false;
    if (verdict === true) spec.onDrop?.(info);
    else spec.onReturn?.(info);
  }

  private dropInfo(member: KitMember, drop: ObjectDrop): DropInfo {
    return { member, target: drop.target, from: drop.from, position: drop.position, origin: drop.origin };
  }

  /** Dépôt accepté d'un Zoombini : posé d'un coup sur la cible, qui devient la sienne. */
  private memberDropped(member: KitMember, info: DropInfo): void {
    const target = info.target!;
    const where = { x: target.x, y: target.y };
    this.snap(member, where);
    this.features.restack(member.snoid.feature, this.depthAt(where));
    target.owner = member;
    member.target = target;
    if (this.waitingPlaces.includes(target)) member.waiting = target;
    this.spec.onDrop?.(info);
  }

  /** Dépôt non accepté d'un Zoombini : l'épreuve peut l'envoyer ailleurs (`onDropOutside`), sinon il retourne d'un coup à sa place d'origine. */
  private memberRejected(member: KitMember, info: DropInfo, depth: number): void {
    const outside = this.spec.onDropOutside?.(info);
    if (outside) {
      this.placeOutside(member, info, outside, depth);
      return;
    }
    this.snap(member, info.origin);
    this.features.restack(member.snoid.feature, depth);
    if (info.from) info.from.owner = member;
    member.target = info.from;
    if (info.from && this.waitingPlaces.includes(info.from)) member.waiting = info.from;
    this.spec.onReturn?.(info);
  }

  /** Le Zoombini va où l'épreuve l'a décidé (`onDropOutside`) : posé d'un coup, ou à pied depuis le point de dépôt ; la place quittée reste libre. */
  private placeOutside(member: KitMember, info: DropInfo, outside: OutsidePlacement, depth: number): void {
    const { at, place = null } = outside;
    member.target = null;
    member.waiting = null;
    if (place) {
      place.owner = member;
      member.waiting = place;
      member.target = place;
    }
    if (outside.walk) {
      this.snap(member, info.position);
      this.features.restack(member.snoid.feature, depth);
      this.walk(member, at, () => this.features.restack(member.snoid.feature, this.depthAt(at)), { counted: false });
    } else {
      this.snap(member, at);
      this.features.restack(member.snoid.feature, this.depthAt(at));
    }
  }

  /** État 4 de `1168:0ba8` : le Zoombini est posé d'un coup sur sa destination, variante d'attente 1, tourné à droite, délai de 6 ticks rétabli. */
  private snap(member: KitMember, where: Point): void {
    const { snoid } = member;
    snoid.delay = 6;
    snoid.idleVariant = SNAP_IDLE_VARIANT;
    snoid.setFacing(0);
    snoid.moveTo(where);
    snoid.idle();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // 3 bis. Marches lancées par l'épreuve

  /**
   * Marche de `member` vers `dest` (`Snoid.walkTo`), tenue par le kit : le membre est « en marche » (ni pris ni déposé, sauf `pickable`), `walking` monte
   * puis, à l'arrivée, redescend et `arrived` monte (`counted`, comme `DS:9702` / `9704`), puis `onArrive`. Une nouvelle marche remplace la précédente ;
   * reprendre un marcheur `pickable` l'annule et rend ses compteurs.
   */
  walk(member: KitMember, dest: Point, onArrive?: (member: KitMember) => void, options: WalkOptions = {}): void {
    const counted = options.counted ?? true;
    this.cancelWalk(member);
    if (!options.pickable) member.walking = true;
    if (counted) this.walking += 1;
    this.walks.set(member, { counted });
    member.snoid.onArrive = () => {
      member.snoid.onArrive = undefined;
      this.walks.delete(member);
      member.walking = false;
      if (counted && this.walking > 0) {
        this.walking -= 1;
        this.arrived += 1;
      }
      onArrive?.(member);
    };
    member.snoid.walkTo(dest);
  }

  /** Abandonne la marche lancée par `walk` de `member`, s'il y en a une : plus de rappel d'arrivée, compteurs rendus. */
  cancelWalk(member: KitMember): void {
    const walk = this.walks.get(member);
    if (!walk) return;
    this.walks.delete(member);
    member.snoid.onArrive = undefined;
    member.walking = false;
    if (walk.counted && this.walking > 0) this.walking -= 1;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // 4. Sortie (`1168:2982`, `1168:36e1`)

  /** `1168:3dd0(0, saved)` : marque « sauvé » (`+0x127`) ou non les 20 premiers membres au plus. */
  markAll(saved: boolean): void {
    let marked = 0;
    for (const member of this.members) {
      if (marked < 20) {
        member.zoombini.present = saved;
        if (saved) marked += 1;
      } else {
        member.zoombini.present = false;
      }
    }
  }

  /**
   * `1168:2982(écart, y, x)` : les membres sauvés (`present`) et immobiles partent à pied vers (`x`, `y`), un toutes les `step` ticks, celui
   * qui est le plus à droite d'abord (`1168:280c`). Remet `walking` et `arrived` à 0 : `arrived` compte ensuite ceux qui sont arrivés.
   */
  departSaved(x: number, y: number, step = 45): void {
    this.walking = 0;
    this.arrived = 0;
    const now = this.ctx.clock.ticks;
    const leaving = this.members.filter((m) => m.zoombini.present && m.snoid.resting && !m.walking && !m.snoid.destroyed);
    const order = sortedByX(leaving.map((m) => ({ member: m, x: m.snoid.position.x })));
    order.reverse().forEach(({ member }, k) => {
      member.walking = true;
      this.scheduled.push({
        at: now + k * step,
        member,
        run: () => {
          this.walking += 1;
          member.snoid.onArrive = () => {
            member.walking = false;
            if (this.walking > 0) this.walking -= 1;
            this.arrived += 1;
          };
          member.snoid.walkTo({ x, y }, this.spec.walkMap);
        },
      });
    });
    this.runDue();
  }

  /** Bouton carte : son 999, puis l'avertissement « ce groupe sera perdu » ; accepté, l'épreuve est abandonnée (retour à la carte). */
  pressMap(): void {
    if (this.left || this.departing) return;
    this.sound.stopEffects();
    this.sound.queue(SOUND_MAP);
    this.suspend();
    confirmLeaveToMap(
      this.ctx,
      () => {
        this.resume();
        this.finish("failure");
      },
      () => {
        this.resume();
      },
    );
  }

  /**
   * Bouton « go » (seulement s'il est actif, `goEnabled`) : son 996 (ou différé, `sound`), départ à pied des sauvés vers `exitWalk` (ou départ de
   * l'épreuve, `depart`), puis changement d'écran quand le son est fini, quand l'épreuve le demande (`end: "depart"`) ou au clic suivant. Le kit ne marque personne « sauvé » de lui-même : l'épreuve l'a fait (`+0x127`)
   * ou demande `saveAll` (`1168:3dd0(0, 1)`). Renvoie vrai si la sortie est lancée.
   */
  pressGo(options: GoOptions = {}): boolean {
    if (this.left || this.departing || !this.goEnabled) return false;
    if (options.saveAll) this.markAll(true);
    const walk = this.spec.exitWalk;
    this.goEnd = options.end ?? "sound";
    this.goSoundQueued = false;
    if ((options.sound ?? "now") === "now") {
      this.sound.stopEffects();
      this.sound.queue(SOUND_GO);
      this.goSoundQueued = true;
    }
    this.departing = true;
    if (options.depart) options.depart();
    else if (walk) this.departSaved(walk.x, walk.y, walk.step);
    // Départ mené par l'épreuve : le kit se gèle (après `depart`, qui peut encore compter sur lui) et ne garde que le clic.
    if (this.goEnd === "depart") this.suspend();
    return true;
  }

  /** Le son de départ 996, quand `pressGo({ sound: "later" })` l'a différé. */
  playGoSound(): void {
    this.sound.queue(SOUND_GO);
    this.goSoundQueued = true;
  }

  /**
   * Sortie de l'épreuve (`1168:36e1`) puis écran suivant (`ZOOMBINIS_GAME.goTo`). Réussite : `exitPuzzle` avec le groupe de la scène (`present` faux =
   * perdu) et `nextScreen(écran, "success")` ; échec : abandon du groupe (`leaveMap`) et carte. Une seule fois.
   */
  finish(outcome: "success" | "failure"): void {
    if (this.finished) return;
    this.finished = true;
    this.halted = true;
    const zoombinis = this.zoombinis;
    const { game, session } = zoombinis;
    const { screen, party } = this.spec;
    if (outcome === "success") {
      exitPuzzle(game, session, screen, party, today());
    } else {
      // Abandon : le groupe est perdu et la sortie n'enregistre ni réussite ni perdus (`session.leftToMap`).
      leaveMap(game, session, this.ctx.rng);
      exitPuzzle(game, session, screen, party, today(), true);
    }
    zoombinis.goTo(this.ctx, nextScreen(screen, outcome));
  }

  /** Voix de réussite commune (`20055…20063`). */
  playSuccessVoice(): void {
    this.sound.queue(this.ctx.rng.range(SUCCESS_VOICES.first, SUCCESS_VOICES.last));
  }

  /** Voix de regret commune (`20045…20048`). */
  playRegretVoice(): void {
    this.sound.queue(this.ctx.rng.range(REGRET_VOICES.first, REGRET_VOICES.last));
  }

  /** Jingle d'entrée (`997`) : certaines épreuves seulement (gorges, bac, étang, véhibules). */
  playEntryJingle(): void {
    this.sound.queue(SOUND_ENTRY);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // 5. Enregistrement pendant l'épreuve (`11a0:141e`)

  private hookSave(): void {
    const initial = this.zoombinis.game;
    const store = (): void => {
      const zoombinis = this.zoombinis;
      // Une partie remplacée (chargement, nouvelle partie) ne reçoit pas le groupe de l'ancienne.
      if (this.left || zoombinis.game !== initial) return;
      // `1168:36e1(1, 1)` : tous les membres du groupe, présents, sans réussite ni perdus rendus.
      zoombinis.game.group.members = this.spec.party.map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice(), present: true }));
    };
    this.unhookSave = this.ctx.services.tryGet(DIALOG)?.addBeforeSave(store) ?? null;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // 6. Aide vocale (`11a0:155e`)

  /**
   * Touche de l'épreuve : `F1` (code `0x16f`) rejoue la voix d'introduction, ou la coupe si elle joue encore. Renvoie vrai si la touche est
   * consommée (même sans voix d'introduction : le code d'origine rend alors la main sans rien faire).
   */
  key(event: { code: string; ctrl?: boolean; alt?: boolean }): boolean {
    if (event.code !== HELP_KEY || event.ctrl || event.alt) return false;
    if (this.spec.helpAllowed && !this.spec.helpAllowed()) return false;
    this.replayIntro();
    return true;
  }

  /**
   * Touches du mode de test (`[a43f]`) de l'épreuve : sa `Key` d'origine ne lit sa table que si le mode de test est levé (`F1`, code 0x16f, reste à `key`).
   * `handlers` associe un code de `screenKeyCode` (caractère, ou `F1`… + 0xff) à une action ; `fold` met d'abord a-z en A-Z (`0x60 < code < 0x7b`,
   * gorges, bac). Renvoie vrai si la touche est consommée (l'action renvoie faux pour ne pas la consommer).
   */
  testKey(event: KeyEvent, handlers: Readonly<Partial<Record<number, () => boolean | void>>>, fold = false): boolean {
    if (!testMode(this.zoombinis.game)) return false;
    let code = screenKeyCode(event);
    if (code === null) return false;
    if (fold && code > 0x60 && code < 0x7b) code -= 0x20;
    const action = handlers[code];
    if (!action) return false;
    return action() !== false;
  }

  replayIntro(): void {
    if (this.introVoice === 0) return;
    const sound = this.sound;
    if (this.introPlaying && (sound.effectsPlaying > 0 || sound.pending.effects > 0)) {
      sound.stopEffects();
      this.introPlaying = false;
      return;
    }
    sound.queue(this.introVoice);
    this.introPlaying = true;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // 7. Musique

  /** Lance la musique de l'épreuve au niveau de l'étape (`1168:515d`), s'il y en a une. Renvoie son id. */
  playMusic(): number | null {
    const { game, session } = this.zoombinis;
    const id = puzzleMusicId(this.spec.screen, currentLevel(game, session, this.spec.screen));
    if (id !== null) this.sound.queue(id);
    return id;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Fin de scène

  /** `leave` de l'épreuve : retire l'action d'enregistrement, rend le curseur, remet le Zoombini transporté à sa place (un objet reste où il est). */
  leave(): void {
    this.gone = true;
    this.halted = true;
    this.unhookSave?.();
    this.unhookSave = null;
    const carry = this.carry;
    if (carry) {
      this.carry = null;
      if (carry.hover?.highlight) this.features.resetZone(carry.hover.highlight);
      if (carry.hidden) this.ctx.setCursor("system");
      if (carry.spec.feature) carry.spec.feature.raised = false;
      if (carry.member && carry.from) carry.from.owner = carry.member;
    }
    this.scheduled.length = 0;
  }

  /** Les features des personnages (pour les tests et les épreuves qui les redessinent). */
  get snoidFeatures(): Feature[] {
    return this.members.map((m) => m.snoid.feature);
  }
}

/** Première cible libre (ou à `own`) de `targets` dans le carré de demi-côté `radius` autour de `point` (`1168:1742`). */
/**
 * Cible libre prise au dépôt (`1168:1742`) : la première dont l'ancre est dans le carré de prise autour de `point`. Au doigt (`finger`),
 * à défaut, la première dont l'image (`area`) contient le doigt : sous le doigt, le joueur ne voit pas le Zoombini porté et vise
 * l'image de la cible, alors que l'ancre est la position du Zoombini posé (extension tactile, sans effet à la souris).
 */
function findIn(targets: readonly DropTarget[], radius: number, point: Point, own: KitMember | null, finger: Point | null = null): DropTarget | null {
  const free = targets.filter((target) => target.owner === null || target.owner === own);
  const near = free.find((t) => t.x >= point.x - radius && t.x <= point.x + radius && t.y >= point.y - radius && t.y <= point.y + radius);
  if (near || !finger) return near ?? null;
  return (
    free.find((target) => {
      const area = target.area?.();
      return area !== null && area !== undefined && finger.x >= area.left && finger.x < area.right && finger.y >= area.top && finger.y < area.bottom;
    }) ?? null
  );
}

/** Tri croissant stable par abscisse (insertion avant le premier plus grand, comme `1168:280c`). */
function sortedByX<T extends { x: number }>(items: T[]): T[] {
  const out: T[] = [];
  for (const item of items) {
    const at = out.findIndex((other) => item.x < other.x);
    if (at < 0) out.push(item);
    else out.splice(at, 0, item);
  }
  return out;
}

export function createPuzzleKit(ctx: SceneContext, spec: PuzzleKitSpec): PuzzleKit {
  return new PuzzleKit(ctx, spec);
}
