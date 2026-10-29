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
 * le curseur masqué demande le type `hidden` (`HIDDEN_CURSOR`), que `CursorKind` et l'hôte du navigateur ne connaissent pas encore (voir
 * `engine-ts.md`).
 */
import type { Input } from "../../../engine/mohawk/input";
import { DIALOG, confirmLeaveToMap } from "../engine/dialog";
import { FEATURES, type Feature } from "../engine/features";
import { ZOOMBINIS_GAME } from "../engine/game";
import type { CursorKind } from "../engine/host";
import type { SceneContext } from "../engine/scene";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../engine/services";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { currentLevel, exitPuzzle, leaveMap, nextScreen } from "../game/route";
import type { GameDate, Zoombini } from "../game/state";
import type { Point } from "../data/zoombini";
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

/** Curseur masqué pendant le transport (`11e8:77bc`). Absent de `CursorKind` tant que ni l'hôte ni son type ne le déclarent : voir `engine-ts.md`. */
export const HIDDEN_CURSOR = "hidden" as CursorKind;

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
}

export function createTarget(point: Point, tag?: unknown): DropTarget {
  return { x: point.x, y: point.y, owner: null, tag };
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
  /** Boutons : `null` = absent. Défaut `BUTTON_MAP` ; le « go » n'existe que si l'épreuve le donne. */
  buttons?: { map?: Readonly<Rect> | null; go?: Readonly<Rect> | null };
  /** Marche de sortie de `pressGo` (`1168:2982(écart, y, x)`) : point hors écran et écart entre départs (45). */
  exitWalk?: { x: number; y: number; step?: number };
  /** Peut-on prendre ce Zoombini ? Défaut : personne en marche (`DS:9702 < 1`) et lui-même immobile. */
  canPick?: (member: KitMember) => boolean;
  /** Appui sur l'écran avant toute prise : vrai = l'épreuve l'a traité. */
  onPointerDown?: (x: number, y: number) => boolean;
  /** Décision d'un dépôt (défaut : accepté s'il y a une cible). */
  decide?: (drop: DropInfo) => boolean;
  /** Retours : prise, cible survolée (null = aucune), dépôt accepté, retour à l'origine, entrée à pied terminée. */
  onPick?: (member: KitMember) => void;
  onHover?: (target: DropTarget | null, member: KitMember) => void;
  onDrop?: (drop: DropInfo) => void;
  onReturn?: (drop: DropInfo) => void;
  onArrived?: (member: KitMember) => void;
}

export interface ArrivalSpec {
  /** Délai du premier départ après l'entrée et écart entre deux départs (`1168:274e`) : 30 et 45 en général. */
  startDelay: number;
  step: number;
  /** Ajouté à l'ordonnée des places pour ceux qui entrent à pied (paramètre de `1168:2505` : 0, −20 au camp, 100, 200). */
  yOffset?: number;
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
  member: KitMember;
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
  depth: number;
  hidden: boolean;
  hover: DropTarget | null;
  /** Fin demandée par l'épreuve (`DS:96f4`). */
  forced: boolean;
}

export class PuzzleKit {
  readonly members: KitMember[] = [];
  /** Places d'attente (liste B) et cibles de dépôt (liste A). */
  readonly waitingPlaces: DropTarget[];
  readonly targets: DropTarget[];
  /** Bouton « go » actif (l'épreuve le règle : par exemple tant qu'un Zoombini est sauvé). */
  goEnabled = false;
  /** Voix d'introduction (`DS:a2c4`). */
  introVoice: number;
  /** `DS:9702` : Zoombinis lancés à pied et pas encore arrivés ; `DS:9704` : arrivés depuis. */
  walking = 0;
  arrived = 0;
  /** L'épreuve a changé d'écran (ou est en train : une sortie ne se déclenche qu'une fois). */
  left = false;
  /** Sortie « go » en cours : l'écran change quand le son est fini ou au clic suivant. */
  departing = false;

  private readonly ctx: SceneContext;
  private readonly spec: PuzzleKitSpec;
  private readonly radius: number;
  private readonly bounds: Readonly<Rect>;
  private readonly scheduled: Scheduled[] = [];
  private carry: Carry | null = null;
  private unhookSave: (() => void) | null = null;
  private introPlaying = false;
  private finished = false;

  constructor(ctx: SceneContext, spec: PuzzleKitSpec) {
    this.ctx = ctx;
    this.spec = spec;
    this.radius = spec.radius ?? DEFAULT_RADIUS;
    this.bounds = spec.bounds ?? SCREEN_BOUNDS;
    this.introVoice = spec.introVoice ?? 0;
    this.waitingPlaces = spec.places.map((p) => createTarget(p));
    this.targets = [...(spec.targets ? spec.targets(this.waitingPlaces) : this.waitingPlaces)];
    this.hookSave();
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

  /** Le Zoombini transporté, s'il y en a un. */
  get carrying(): KitMember | null {
    return this.carry?.member ?? null;
  }

  /** Cible libre prise par le carré de prise autour de `point` (la première de la liste A, comme `1168:1742`), ou null. */
  findTarget(point: Point, own: KitMember | null = null): DropTarget | null {
    const r = this.radius;
    for (const target of this.targets) {
      if (target.owner !== null && target.owner !== own) continue;
      if (target.x >= point.x - r && target.x <= point.x + r && target.y >= point.y - r && target.y <= point.y + r) return target;
    }
    return null;
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
    // `DS:9a26` : entrée à pied, hors reprise (`DS:970a`) et hors « moins d'action » (`S+0x20`).
    const walkIn = !game.options.lessAction && !session.resuming;
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
    if (this.left || this.dialogOpen) return;
    this.runDue();
    if (this.spec.waitAnimations ?? true) for (const member of this.members) if (!member.walking && this.carry?.member !== member) member.snoid.tickWait();
    this.input(this.ctx.input);
    if (this.departing && this.soundDone()) this.finish("success");
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
      if (!event.down) continue;
      if (this.carry) {
        pressed = true;
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
    const { buttons } = this.spec;
    const map = buttons?.map === undefined ? BUTTON_MAP : buttons.map;
    if (inside(map, x, y)) {
      this.pressMap();
      return true;
    }
    if (inside(buttons?.go, x, y)) {
      this.pressGo();
      return true;
    }
    if (this.spec.onPointerDown?.(x, y)) return true;
    return this.pick(x, y);
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
    const { prefs } = this.ctx;
    const position = member.snoid.position;
    const from = member.target;
    // La place quittée est libérée (`1168:1742` : propriétaire remis à 0 dans les deux listes).
    for (const target of [...this.targets, ...this.waitingPlaces]) if (target.owner === member) target.owner = null;
    const hidden = prefs.hideCursorWhileCarrying;
    this.carry = {
      member,
      origin: { x: position.x, y: position.y },
      from,
      grab: { x: x - position.x, y: y - position.y },
      lastX: x,
      sticky: prefs.magneticMouse,
      held: true,
      startedAt: this.ctx.clock.ticks,
      depth: member.snoid.feature.depth,
      hidden,
      hover: null,
      forced: false,
    };
    this.features.restack(member.snoid.feature, CARRY_DEPTH);
    member.snoid.delay = CARRY_DELAY;
    member.snoid.play(CARRY_SCRIPT_BASE + member.snoid.traits.feet);
    if (hidden) this.ctx.setCursor(HIDDEN_CURSOR);
    this.spec.onPick?.(member);
    return true;
  }

  /** Fin de transport demandée par l'épreuve (`DS:96f4 = 1`) : le Zoombini est déposé là où il est. */
  endCarry(): void {
    if (this.carry) this.carry.forced = true;
  }

  private updateCarry(input: Input, pressed: boolean): void {
    const carry = this.carry!;
    const { member } = carry;
    const x = Math.max(this.bounds.left, Math.min(this.bounds.right, input.mouseX - carry.grab.x));
    const y = Math.max(this.bounds.top, Math.min(this.bounds.bottom, input.mouseY - carry.grab.y));
    // Tourné du côté où il va (`+0xf2`).
    if (input.mouseX < carry.lastX) member.snoid.setFacing(1);
    else if (input.mouseX > carry.lastX) member.snoid.setFacing(0);
    carry.lastX = input.mouseX;
    member.snoid.setPosition({ x, y });
    const hover = this.findTarget({ x, y }, member);
    if (hover !== carry.hover) {
      carry.hover = hover;
      this.spec.onHover?.(hover, member);
    }
    // `1168:58c7` : le transport continue tant qu'elle renvoie 1.
    let down = input.isButtonDown("left");
    let done = carry.forced;
    if (!carry.sticky) {
      if (!down) {
        const { game } = this.zoombinis;
        const quick = game.options.autoMagnet && this.ctx.clock.ticks - carry.startedAt < game.unknown02;
        if (quick) {
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
    if (done) this.drop(x, y);
  }

  private drop(x: number, y: number): void {
    const carry = this.carry!;
    this.carry = null;
    const { member } = carry;
    const position = { x, y };
    const target = this.findTarget(position, member);
    const info: DropInfo = { member, target, from: carry.from, position, origin: carry.origin };
    // Relâché sur la place qu'il vient de quitter : rien à décider, il y retourne.
    const accepted = target !== null && target !== carry.from && (this.spec.decide ? this.spec.decide(info) : true);
    if (carry.hidden) this.ctx.setCursor("system");
    const where = accepted ? { x: target.x, y: target.y } : carry.origin;
    this.snap(member, where);
    this.features.restack(member.snoid.feature, accepted ? this.depthAt(where) : carry.depth);
    if (accepted) {
      target.owner = member;
      member.target = target;
      if (this.waitingPlaces.includes(target)) member.waiting = target;
      this.spec.onDrop?.(info);
    } else {
      if (carry.from) carry.from.owner = member;
      member.target = carry.from;
      if (carry.from && this.waitingPlaces.includes(carry.from)) member.waiting = carry.from;
      this.spec.onReturn?.(info);
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
          member.snoid.walkTo({ x, y });
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
    this.left = true;
    confirmLeaveToMap(
      this.ctx,
      () => {
        this.left = false;
        this.finish("failure");
      },
      () => {
        this.left = false;
      },
    );
  }

  /**
   * Bouton « go » (seulement s'il est actif, `goEnabled`) : son 996, départ à pied des sauvés vers `exitWalk`, puis changement d'écran quand
   * le son est fini ou au clic suivant. Renvoie vrai si la sortie est lancée.
   */
  pressGo(): boolean {
    if (this.left || this.departing || !this.goEnabled) return false;
    const walk = this.spec.exitWalk;
    this.sound.stopEffects();
    this.sound.queue(SOUND_GO);
    if (walk) this.departSaved(walk.x, walk.y, walk.step);
    this.departing = true;
    return true;
  }

  /**
   * Sortie de l'épreuve (`1168:36e1`) puis écran suivant (`ZOOMBINIS_GAME.goTo`). Réussite : `exitPuzzle` avec le groupe de la scène (`present` faux =
   * perdu) et `nextScreen(écran, "success")` ; échec : abandon du groupe (`leaveMap`) et carte. Une seule fois.
   */
  finish(outcome: "success" | "failure"): void {
    if (this.finished) return;
    this.finished = true;
    this.left = true;
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

  /** `leave` de l'épreuve : retire l'action d'enregistrement, rend le curseur, remet le Zoombini transporté à sa place. */
  leave(): void {
    this.left = true;
    this.unhookSave?.();
    this.unhookSave = null;
    const carry = this.carry;
    if (carry) {
      this.carry = null;
      if (carry.hidden) this.ctx.setCursor("system");
      if (carry.from) carry.from.owner = carry.member;
    }
    this.scheduled.length = 0;
  }

  /** Les features des personnages (pour les tests et les épreuves qui les redessinent). */
  get snoidFeatures(): Feature[] {
    return this.members.map((m) => m.snoid.feature);
  }
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
