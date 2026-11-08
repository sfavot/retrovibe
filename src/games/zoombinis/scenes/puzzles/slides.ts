/**
 * La fosse de monte-pierre (`SLIDES.MHK`, écran 12, tâche H6 ; `docs/zoombinis/puzzles/slides.md`, `docs/zoombinis/engine-ts.md`, « Monte-pierre (tâche H6) »).
 * Épreuve sur le kit commun (`puzzle-kit.ts`) : le kit porte l'arrivée du groupe, le glisser-déposer, les boutons, l'enregistrement, l'aide F1 ; cet écran
 * porte le plateau (`game/puzzles/slides.ts`) et la mise en scène.
 *
 * ## Déroulé (original : Enter `1170:0000`, Tick `1170:0532`, clic `1170:08f5`, rejet `1170:4ddd`, bilan `1170:4f98`)
 *
 *  1. **Entrée** : fond et palette 5000, groupes de formes 7000 (pierres, anneaux, décors) et 8000 (étincelles de rejet), 14 + 3 `SCRB`, plateau de 117 pierres
 *     généré pour le niveau et le groupe, une feature par pierre (`SCRB` 7000, filtre des parties selon l'état : `1170:20cc`), un anneau par emplacement
 *     (`SCRB` 7013, `1170:23a2`), décors de bord (7003 à 7012) rangés entre les rangées, groupe sur les 16 positions d'attente (arrivée échelonnée 30 puis 45 ticks).
 *  2. **Dépôt sur un emplacement libre** : le Zoombini y est posé (`place`), la montée est recalculée (`evaluate`), les pierres se redessinent, le « go » s'allume
 *     ou s'éteint, un son de bilan part (8500 / 8501 / 8502 / 8504 / 8505). Un emplacement pris n'est pas une cible (`1168:1742`) : y lâcher un Zoombini est un dépôt « ailleurs ».
 *  3. **Dépôt ailleurs** : le Zoombini quitte son emplacement ; au-dessus d'une des 117 pierres il est rejeté (étincelles `SCRB` 8000 + k, vol `SCRS` 14000 + k puis
 *     14003) ; sinon (ou après le vol) il rejoint à pied une position d'attente libre (`1170:509f`).
 *  4. **Tout le groupe relié** : voix de réussite, puis un Zoombini tiré au hasard danse (`SCRS` 13000 + pieds) toutes les 30 ticks ; le clic suivant n'arrête
 *     que la danse. Niveau 3, quatre posés dont 57, 59 et 61 reliés : cycle de palette (7 ticks) jusqu'à la sortie.
 *  5. **« go »** (définitif) : les reliés sont sauvés, les pierres reliées s'élèvent (`SCRB` 7002, son 7000) avec leur Zoombini (`SCRS` 13000) ; à la fin de la
 *     première : son 7001, 60 ticks, son 996, les sauvés partent à pied un à un (45 ticks, le plus à droite d'abord) ; écran suivant au premier arrivé (le
 *     son 996 fini) ou au clic. Les autres sont perdus.
 *
 * Écarts et lectures **probables** : `docs/zoombinis/puzzles/slides.md` §9 et `docs/zoombinis/engine-ts.md`, « Monte-pierre (tâche H6) ».
 */
import type { Archive } from "../../../../engine/mohawk/resources";
import { screenInfo } from "../../data/archives";
import type { Point } from "../../data/zoombini";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type FeaturePart, type Features } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { node, path } from "../../engine/resources";
import { ScreenId, type Scene, type SceneContext } from "../../engine/scene";
import { GRAPHICS } from "../../engine/services";
import { ZOOMBINIS_SOUND } from "../../engine/sound";
import { currentLevel, dialogMemoryIndex } from "../../game/route";
import {
  BOARD_COLS,
  FEEDBACK_SOUND,
  STATE,
  STONE_COUNT,
  WAITING_POSITIONS,
  createPlay,
  evaluate,
  feedbackSound,
  generateBoard,
  go,
  pickWaitingPosition,
  place,
  remove,
  slotPosition,
  stateCode,
  stonePosition,
  type Evaluation,
  type SlidesBoard,
  type SlidesPlay,
  type SlidesResult,
} from "../../game/puzzles/slides";
import type { Zoombini } from "../../game/state";
import { createPuzzleKit, createTarget, sheetButtonImages, type DropInfo, type DropTarget, type KitMember, type OutsidePlacement, type PuzzleKit } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";
import { dialogChoice } from "../xfer";

const SCREEN = ScreenId.slides;

/** Fond et palette (`SHPL` / `tBMP` 5000), planche des boutons 6000, groupes de formes 7000 (pierres) et 8000 (étincelles). */
const BACKGROUND = 5000;
const BUTTONS_SHEET = 6000;
const GROUP_STONES = 7000;
const GROUP_SPARKS = 8000;
/** `SCRB` : pierre, pierre nue (case vide), montée, décors 7003 à 7012, anneau, étincelles 8000 + k. */
const SCRB = { stone: 7000, bare: 7001, rise: 7002, decor: 7003, ring: 7013, sparks: 8000 } as const;
/** `SCRS` : montée d'un Zoombini avec sa pierre, danse 13000 + pieds, rejet 14000 + k (hauteur) puis vol 14003. */
const SCRS = { rise: 13000, dance: 13000, kick: 14000, flight: 14003 } as const;
/** Délai entre images de toutes les features de l'écran (`11a8:0ad6`) : 6 ticks. */
const DELAY = 6;
/** Décalage de l'anneau par rapport à la pierre (`1170:23a2` : `−0x16`, `+6` sur la position d'emplacement `+24, −5`). */
const RING_OFFSET = { x: 2, y: 1 } as const;
/** Position des étincelles (`1170:4ddd`) : pierre `+ (0x13, 0x18)` ; hit-test : `x ≤ px ≤ x + 45`, `y − 22 ≤ py ≤ y`. */
const SPARK_OFFSET = { x: 19, y: 24 } as const;
const STONE_BOX = { width: 45, height: 22 } as const;
/** Montée d'un Zoombini avec sa pierre : `SCRS` 13000, de `y = 147` à `y = 74`. */
const RISE_HEIGHT = 73;
/** Événements du terminateur (octet bas − 1) : 90 à 92 = étincelles (image 2), 93 = fin (image 9). */
const EVENT = { sparks: 90, sparksEnd: 93 } as const;
/**
 * Pièces de l'image de la pierre (`SCRB` 7000 et 7002, filtres `1170:20cc` et `1170:250c`, §5.2 de l'étude) : connecteurs 0 à 5 ; symboles 73 à 76 ;
 * contour orange 103 (emplacement libre) ; sommets rouge 109 et bleu 110 (pierre « haute » : départ, liaison montée, emplacement relié, variantes 0 et 1).
 */
const PART = { conn0: 4, conn1: 8, conn2: 12, conn3: 16, conn4: 20, conn5: 24, symbol0: 73, symbol3: 76, outline: 103, redTop: 109, blueTop: 110 } as const;
/**
 * Image du symbole de chaque attribut (cheveux, yeux, nez, pieds) : `1170:20cc` garde 0x49 pour `0x201`, 0x4a pour `0x1fe`, 0x4b pour `0x200`, 0x4c pour `0x1ff`
 * (table `CS:22ea` relue sur les octets) ; les dessins concordent (74 une touffe, 76 un œil, 75 un nez, 73 un pied).
 */
const SYMBOL_IMAGE = [74, 76, 75, 73] as const;
/** Montée (`1170:250c`) : un connecteur gardé prend sa couleur, image `w + DS:9d60` (0x30 : rouge, variante 0 ; 0x18 : bleu, variante 1). */
const RISE_CONNECTOR_SHIFT = [0x30, 0x18] as const;
/** Cycle de palette du niveau 3 (`1170:2312`) : trois entrées dès 30 (tableau de 236 entrées dès 10, entrées 20 à 22), un cran toutes les 7 ticks. */
const CYCLE = { first: 30, count: 3, period: 7 } as const;
/** Danse de victoire : un Zoombini toutes les 30 ticks (`1170:0532` étape 5), au plus 20 essais de tirage. */
const DANCE_GAP = 30;
const DANCE_TRIES = 20;
/** Sortie : écart entre deux départs (45), attente après la montée (60 ticks), destinations `1168:2982` (x, y) : 800 / 200 aux niveaux 2 et 3, 1280 / 240 aux niveaux 0 et 1. */
const EXIT_STEP = 45;
const EXIT_PAUSE = 60;
const SOUND = { rumble: 7000, arrived: 7001 } as const;
/** Voix d'introduction (`[a2c4] = 0x4e6e`). */
const HELP_VOICE = 20078;
/** Profondeurs : pierres par rangée (les Zoombinis sont à `1 + y / 1000`), anneaux au-dessus de leur pierre, étincelles devant les pierres. */
const DEPTH = { stone: 0.2, row: 0.02, ring: 0.005, front: 0.5, sparks: 0.6 } as const;

/** Drapeaux d'une pierre au repos (une image, jouée tout de suite) et en montée (7 images, s'arrête à la fin). */
const STONE_FLAGS = FeatureFlag.relative | FeatureFlag.stopEachImage | FeatureFlag.firstImage | FeatureFlag.active;
const RISE_FLAGS = FeatureFlag.relative | FeatureFlag.stopAtEnd | FeatureFlag.active;

/** Connecteur gardé si le bit de direction du masque est posé (`1170:20cc`, `1170:23a2`, `1170:250c`) ; les autres pièces ne sont pas des connecteurs. */
function connectorKept(mask: number, w: number): boolean {
  switch (w) {
    case PART.conn0:
      return (mask & 1) !== 0;
    case PART.conn1:
      return (mask & 2) !== 0;
    case PART.conn2:
      return (mask & 4) !== 0;
    case PART.conn3:
      return (mask & 8) !== 0;
    case PART.conn4:
      return (mask & 16) !== 0;
    case PART.conn5:
      return (mask & 32) !== 0;
    default:
      return true;
  }
}

/** Ce qui décide de l'image d'une pierre : symbole (liaison), code d'état de l'original, masque des connecteurs, variante de départ (`DS:9d5e − 0x1f8`), montée en cours. */
export interface StoneLook {
  attr: number | null;
  code: number;
  mask: number;
  variant: 0 | 1;
  rising: boolean;
}

/**
 * Filtre des pièces d'une pierre. Au repos (`SCRB` 7000, `1170:20cc`, table `CS:22ea` : 10 pièces puis 10 cibles, relue sur les octets) :
 *  - socle 98 toujours ; connecteurs 4, 8, 24 selon les bits 0, 1, 5 du masque ; symbole de l'attribut `a` (`SYMBOL_IMAGE`) si le contenu vaut `0x1fe + a` ;
 *  - **contour orange 103** si et seulement si la case est un **emplacement libre** (`0x1fa`) : là où l'on peut poser un Zoombini ;
 *  - **sommet rouge 109** si la case est haute (`0x1f6` liaison montée, `0x1f8` départ, `0x1fc` emplacement relié) et la variante 0 ;
 *  - **sommet bleu 110** si elle est haute (`0x1f6`, `0x1f9`, `0x1fc`) et la variante 1 (niveau 3 seulement, tirée).
 * En montée (`SCRB` 7002, `1170:250c`, table `CS:26a0`) : mêmes sommets ; un connecteur gardé passe à sa couleur (`w + DS:9d60`). Le script de montée ne porte
 * ni symbole ni contour.
 */
export function filterStoneParts(parts: readonly FeaturePart[], look: StoneLook): FeaturePart[] {
  const { attr, code, mask, variant, rising } = look;
  const high = code === STATE.linkRaised || code === STATE.slotConnected || code === (variant === 1 ? STATE.startAlt : STATE.start);
  const kept: FeaturePart[] = [];
  for (const part of parts) {
    const { w } = part;
    if (w >= PART.symbol0 && w <= PART.symbol3) {
      if (attr !== null && SYMBOL_IMAGE[attr] === w) kept.push(part);
    } else if (w === PART.outline) {
      if (code === STATE.slotFree) kept.push(part);
    } else if (w === PART.redTop) {
      if (variant === 0 && high) kept.push(part);
    } else if (w === PART.blueTop) {
      if (variant === 1 && high) kept.push(part);
    } else if (connectorKept(mask, w)) {
      const connector = w === PART.conn0 || w === PART.conn1 || w === PART.conn5;
      kept.push(rising && connector ? { ...part, w: w + RISE_CONNECTOR_SHIFT[variant] } : part);
    }
  }
  return kept;
}

/** Étape de la sortie après « go ». */
type Stage = "rising" | "pause" | "walking";

export interface SlidesProbe {
  readonly kit: PuzzleKit;
  readonly board: SlidesBoard;
  readonly play: SlidesPlay;
  readonly ev: Evaluation;
  readonly level: number;
  /** `DS:9c70` : une animation de rejet est en cours (les clics sont ignorés). */
  readonly busy: boolean;
  /** « go » cliqué (`DS:9d74`). */
  readonly went: boolean;
  readonly stage: Stage | null;
  readonly result: SlidesResult | null;
  /** Une danse de victoire est en cours (`DS:9d8a`), le cycle de palette tourne (`DS:9c6e`). */
  readonly celebrating: boolean;
  readonly cycling: boolean;
  /** Features des pierres (`undefined` : case vide), anneaux par rang d'emplacement et cibles de dépôt par rang. */
  readonly stones: readonly (Feature | undefined)[];
  /** Pierres nues (`SCRB` 7001) des cases vides du plateau. */
  readonly bare: readonly Feature[];
  readonly rings: readonly Feature[];
  readonly slots: readonly DropTarget[];
  /** Pierres qui s'élèvent (« go »). */
  readonly rising: readonly number[];
  /** Masque de liaisons affiché de chaque pierre. */
  readonly masks: readonly number[];
}

export type SlidesScene = Scene & { readonly probe: SlidesProbe | null };

/** Rejet en cours : le membre, la pierre visée, la hauteur du coup (0 à 2). */
interface Rejection {
  member: KitMember;
  stone: number;
  height: 0 | 1 | 2;
  sparks: Feature | null;
}

class SlidesRun implements SlidesProbe {
  readonly kit: PuzzleKit;
  readonly board: SlidesBoard;
  readonly play: SlidesPlay;
  readonly level: number;
  ev: Evaluation;
  busy = false;
  went = false;
  stage: Stage | null = null;
  result: SlidesResult | null = null;
  celebrating = false;
  cycling = false;
  readonly stones: (Feature | undefined)[] = new Array<Feature | undefined>(STONE_COUNT).fill(undefined);
  readonly bare: Feature[] = [];
  readonly rings: Feature[] = [];
  readonly slots: DropTarget[] = [];
  readonly rising: number[] = [];
  readonly masks: number[];

  private readonly features: Features;
  private readonly party: Zoombini[];
  /** Clé d'affichage de chaque pierre (état et masque) : une pierre n'est rejouée que si elle change. */
  private readonly keys: string[] = new Array<string>(STONE_COUNT).fill("");
  /** Membres en vol après un rejet : ni pris ni posés. */
  private readonly flying = new Set<KitMember>();
  private danced = 0;
  private lastDance = 0;
  private lastCycle = 0;
  /** `DS:9c7e` : avancement de la saisie de la séquence du mode de test (0 à 5, remis à 0 à l'entrée). */
  private cheat = 0;
  private departures: { at: number; member: KitMember }[] = [];
  private departed = 0;
  private arrivedCount = 0;
  private pauseUntil = 0;
  private riseEnded = false;
  private finished = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly archive: Archive,
  ) {
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    const { game, session } = zoombinis;
    session.screen = SCREEN;
    this.level = currentLevel(game, session, SCREEN);
    openScreen(ctx, archive, { background: BACKGROUND });
    this.features = ctx.services.get(FEATURES);
    this.party = game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
    if (this.party.length < 1 || this.party.length > WAITING_POSITIONS.length) throw new RangeError(`monte-pierre : ${this.party.length} Zoombinis`);

    const f = this.features;
    f.defineGroup(0, GROUP_STONES);
    f.defineGroup(1, GROUP_SPARKS);
    f.setScripts(SCRB.stone, 14);
    f.addScripts(SCRB.sparks, 3);

    // `1150:0000` : le plateau du niveau, avant les features des pierres.
    this.board = generateBoard(this.level, this.party, ctx.rng);
    this.play = createPlay(this.board, this.party);
    this.ev = evaluate(this.play);
    this.masks = this.board.stones.map((s) => s.mask);
    this.createDecor();
    this.createStones();
    this.createRings();

    const buttons = sheetButtonImages(archive.tbmpImages(BUTTONS_SHEET));
    this.slots = this.board.slots.map((stone, k) => {
      const p = slotPosition(stone);
      return createTarget(p, k);
    });
    this.kit = createPuzzleKit(ctx, {
      screen: SCREEN,
      party: this.party,
      places: WAITING_POSITIONS,
      targets: () => this.slots,
      introVoice: HELP_VOICE,
      snoid: { scripts: screenScripts(archive) },
      buttons: {
        map: { images: buttons.map, hold: 2 },
        go: { images: buttons.go, hold: 2, onPress: () => this.pressGo() },
      },
      canPick: (member) => this.canPick(member),
      onPointerDown: () => this.pointerDown(),
      decide: () => !this.busy && !this.went,
      onHover: (target) => this.hover(target),
      onDrop: (drop) => this.dropped(drop),
      onDropOutside: (drop) => this.droppedOutside(drop),
    });
    this.kit.arrive({ startDelay: 30, step: EXIT_STEP });
    // `1168:3dd0(0, 0)` : personne n'est sauvé (`+0x127 = 0`).
    this.kit.markAll(false);
    this.kit.playMusic();
    this.syncStones();
    // `1168:5c57` : une visite de plus de l'écran (mémoire de dialogue, 12 bits).
    const index = dialogMemoryIndex(SCREEN);
    if (index >= 0) game.dialogMemory[index] = dialogChoice(game.dialogMemory[index]!, this.level, session.training !== 0).memory;
    ctx.requestPresent();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Décor, pierres, anneaux

  /**
   * Décors de bord (`SCRB` 7003 à 7012). `11a8:2a0a` range les huit premiers par rapport aux rangées 1, 3, 5, 7, 9 et 11 : le décor `j` est devant les rangées
   * jusqu'à `2j + 1` (**probable** : seul le rapport aux cases 9, 27, 45, 63, 81, 99 est lu). 7009 et 7010 devant les pierres, 7011 et 7012 devant tout le plateau.
   */
  private createDecor(): void {
    const F = FeatureFlag;
    for (let k = 0; k < 10; k++) {
      const depth = k < 6 ? DEPTH.stone + (2 * k + 1) * DEPTH.row + DEPTH.row / 2 : k < 8 ? DEPTH.stone + 13 * DEPTH.row : DEPTH.front;
      // `1150:0000` crée les décors avec `0x188000`, sans le bit `0x1000000` : dessinés au repos.
      this.features.create({ script: SCRB.decor + k, delay: DELAY, flags: F.flag4000000 | F.still | F.noReplay | F.active | F.firstImage, depth });
    }
  }

  private stoneDepth(i: number): number {
    return DEPTH.stone + Math.trunc(i / BOARD_COLS) * DEPTH.row;
  }

  /**
   * Une feature par case, posée sur la position de la pierre (les scripts placent leur première partie en (308, 152)) : `SCRB` 7000 filtré selon l'état pour
   * une pierre du plateau ; `SCRB` 7001 (pierre nue, image 97, sans filtre) pour une case vide (`1150:0000`, fin : état 500). Tout le fond de la fosse est pavé.
   */
  private createStones(): void {
    this.board.stones.forEach((stone, i) => {
      const position = stonePosition(i);
      if (stone.kind === "void") {
        this.bare.push(this.features.create({ script: SCRB.bare, delay: DELAY, flags: STONE_FLAGS, depth: this.stoneDepth(i), position }));
        return;
      }
      this.stones[i] = this.features.create({
        script: SCRB.stone,
        delay: DELAY,
        flags: STONE_FLAGS,
        depth: this.stoneDepth(i),
        position,
        onImage: (_feature, parts) => this.stoneParts(i, parts),
      });
    });
  }

  /**
   * Un anneau par emplacement (`SCRB` 7013, `1170:0000` : `0x188a000`) : le bit `0x1000000` (`playOnly`) le rend invisible au repos ; il ondule quand un Zoombini
   * survole l'emplacement (**probable**), le temps de son script.
   */
  private createRings(): void {
    const F = FeatureFlag;
    this.board.slots.forEach((stone) => {
      const p = stonePosition(stone);
      const ring = this.features.create({
        script: SCRB.ring,
        delay: DELAY,
        flags: F.playOnly | F.relative | F.stopAtEnd,
        depth: this.stoneDepth(stone) + DEPTH.ring,
        position: { x: p.x + RING_OFFSET.x, y: p.y + RING_OFFSET.y },
        onImage: (_feature, parts) => this.ringParts(stone, parts),
      });
      ring.active = false;
      this.rings.push(ring);
    });
  }

  private stoneParts(i: number, parts: FeaturePart[]): FeaturePart[] {
    const stone = this.board.stones[i]!;
    return filterStoneParts(parts, {
      attr: stone.kind === "link" ? stone.attr : null,
      code: stateCode(this.board, this.ev, i),
      mask: this.masks[i]!,
      variant: this.board.startVariant,
      rising: this.rising.includes(i),
    });
  }

  private ringParts(i: number, parts: FeaturePart[]): FeaturePart[] {
    const mask = this.masks[i]!;
    return parts.filter(({ w }) => connectorKept(mask, w));
  }

  /** Rejoue les pierres dont l'état ou le masque a changé (`11a8:1be6(1, 7000, feature)`). */
  private syncStones(): void {
    for (let i = 0; i < STONE_COUNT; i++) {
      const feature = this.stones[i];
      if (!feature || this.rising.includes(i)) continue;
      const key = `${stateCode(this.board, this.ev, i)}|${this.masks[i]}`;
      if (key === this.keys[i]) continue;
      this.keys[i] = key;
      this.features.setScript(feature, SCRB.stone);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Prise et dépôt (`1170:08f5`, région 3)

  private canPick(member: KitMember): boolean {
    return !this.went && !this.busy && !this.flying.has(member) && this.kit.walking < 1;
  }

  /** Clics ignorés pendant un rejet et après « go » ; après la victoire le clic suivant n'arrête que la danse (`1150:2ff4`). */
  private pointerDown(): boolean {
    if (this.went || this.busy) return true;
    if (this.celebrating) {
      this.celebrating = false;
      return true;
    }
    return false;
  }

  private hover(target: DropTarget | null): void {
    if (!target || this.went) return;
    const ring = this.rings[target.tag as number];
    if (!ring) return;
    this.features.setScript(ring, SCRB.ring);
  }

  /** Recalcule la montée après un changement de pose : son de bilan, « go », pierres, victoire, cycle de palette. */
  private apply(): void {
    const before = this.ev;
    this.ev = evaluate(this.play);
    const sound = this.ctx.services.get(ZOOMBINIS_SOUND);
    const id = feedbackSound(before, this.ev);
    // `1170:4f98` arrête le même son s'il est déjà en cours : le moteur ne sait pas arrêter un son précis, il n'est pas empilé (écart).
    if (id !== null && (id === FEEDBACK_SOUND.shuffle || !sound.isPlaying(id))) sound.queue(id);
    this.kit.goEnabled = this.ev.goEnabled;
    this.syncStones();
    if (this.ev.victory && !before.victory) {
      // `1150:2f9e` : voix de réussite, puis danse.
      this.kit.playSuccessVoice();
      this.celebrating = true;
      this.danced = 0;
      this.lastDance = this.ctx.clock.ticks;
    } else if (!this.ev.victory) {
      this.celebrating = false;
    }
    if (this.ev.paletteCycle && !this.cycling) {
      this.cycling = true;
      this.lastCycle = this.ctx.clock.ticks;
    }
  }

  /** Dépôt sur un emplacement libre. */
  private dropped(drop: DropInfo): void {
    place(this.play, drop.member.index, drop.target!.tag as number);
    this.apply();
  }

  /**
   * Dépôt non accepté : retour sur sa place, ou « hors emplacement » (`1168:166e` renvoie 0, `1170:08f5`) : le Zoombini quitte son emplacement s'il en occupait un
   * (liaisons rabaissées), puis il est rejeté au-dessus d'une pierre (`1170:4ddd`) ou rejoint une position d'attente libre (`1170:509f`). Un emplacement pris
   * n'est pas une cible (`1168:1742` ignore une cible qui a un propriétaire) : y lâcher un Zoombini est un dépôt hors emplacement, sans renvoi de l'occupant.
   */
  private droppedOutside(drop: DropInfo): OutsidePlacement | void {
    if (this.went || this.busy) return;
    // Reposé sur l'emplacement qu'il vient de quitter : rien ne change.
    if (drop.target !== null && drop.target === drop.from) return;
    const { member, position } = drop;
    if (this.play.seat.includes(member.index)) {
      remove(this.play, member.index);
      this.apply();
    }
    const stone = this.stoneUnder(position.x, position.y);
    if (stone >= 0) {
      this.startRejection(member, stone);
      return { at: { x: position.x, y: position.y } };
    }
    const j = this.freeWaiting();
    const spot = this.kit.waitingPlaces[j]!;
    return { at: { x: spot.x, y: spot.y }, walk: true, place: spot };
  }

  /** `1170:4ddd` : pierre (parmi les 117) dont la boîte `x ≤ px ≤ x + 45`, `y − 22 ≤ py ≤ y` contient le point lâché, −1 sinon. */
  stoneUnder(px: number, py: number): number {
    for (let i = 0; i < STONE_COUNT; i++) {
      const p = stonePosition(i);
      if (px >= p.x && px <= p.x + STONE_BOX.width && py >= p.y - STONE_BOX.height && py <= p.y) return i;
    }
    return -1;
  }

  /** `1170:509f` : position d'attente libre, balayée dans un sens tiré à pile ou face (`10a8:04e8(100, 1) < 0x33`). */
  private freeWaiting(): number {
    const taken = this.kit.waitingPlaces.map((p) => p.owner !== null);
    return pickWaitingPosition(taken, this.ctx.rng.range(1, 100) < 0x33);
  }

  /** Renvoie `member` à pied sur une position d'attente libre (marche du kit non comptée), qui devient la sienne (après un rejet). */
  private sendToWaiting(member: KitMember): void {
    const j = this.freeWaiting();
    const spot = this.kit.waitingPlaces[j]!;
    member.target = spot;
    member.waiting = spot;
    spot.owner = member;
    this.kit.walk(member, { x: spot.x, y: spot.y }, () => this.features.restack(member.snoid.feature, 1 + spot.y / 1000), { counted: false });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Rejet (`1170:4ddd`, événements `1170:4bb8`)

  private startRejection(member: KitMember, stone: number): void {
    this.busy = true;
    const height = stone > 88 ? 0 : stone >= 36 ? 1 : 2;
    const rejection: Rejection = { member, stone, height, sparks: null };
    this.flying.add(member);
    const p = stonePosition(stone);
    const F = FeatureFlag;
    // Étincelles (`SCRB` 8000 + k) sur la pierre ; image 1 : son 8000 ; image 2 : le Zoombini est lancé ; image 9 : il revient en vol.
    rejection.sparks = this.features.create({
      script: SCRB.sparks + height,
      delay: DELAY,
      flags: F.relative | F.stopAtEnd | F.active,
      depth: DEPTH.sparks,
      position: { x: p.x + SPARK_OFFSET.x, y: p.y + SPARK_OFFSET.y },
      onEvent: (_image, n) => {
        if (n === EVENT.sparks + height) this.kick(rejection);
        else if (n === EVENT.sparksEnd) this.flight(rejection);
        else if (n === FEATURE_END && rejection.sparks) {
          this.features.destroy(rejection.sparks);
          rejection.sparks = null;
        }
      },
    });
  }

  /** Image 2 des étincelles : le Zoombini est lancé en l'air (`SCRS` 14000 + k, deux images) puis disparaît. */
  private kick(rejection: Rejection): void {
    const { snoid } = rejection.member;
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      snoid.feature.flags |= FeatureFlag.noDraw;
      this.features.invalidate();
    };
    snoid.play(SCRS.kick + rejection.height, FeatureFlag.stopAtEnd, { kind: "reject" });
  }

  /**
   * Image 9 des étincelles (`DS:9c70 ← 0`) : le Zoombini retombe en vol (`SCRS` 14003, 24 images) vers un point tiré (`x = 70 + rand(0..42)`, `y = 152 + rand(0..200)`),
   * puis rejoint à pied une position d'attente libre.
   */
  private flight(rejection: Rejection): void {
    this.busy = false;
    const { member } = rejection;
    const { snoid } = member;
    const rng = this.ctx.rng;
    const landing: Point = { x: 70 + rng.range(0, 42), y: 152 + rng.range(0, 200) };
    snoid.feature.flags &= ~FeatureFlag.noDraw;
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      snoid.moveTo(landing);
      snoid.idle();
      this.flying.delete(member);
      this.sendToWaiting(member);
    };
    this.features.restack(snoid.feature, 1 + landing.y / 1000);
    snoid.play(SCRS.flight, FeatureFlag.stopAtEnd, { kind: "reject", at: landing });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick (`1170:0532`)

  tick(): void {
    this.kit.tick();
    if (this.finished || this.kit.finishing) return;
    if (this.ctx.services.tryGet(DIALOG)?.isOpen) return;
    this.tickCycle();
    if (this.went) {
      this.tickGo();
      return;
    }
    if (this.kit.left) return;
    this.dance();
  }

  /** Cycle de palette du niveau 3 (étape 3 du Tick : plus de 6 ticks depuis le dernier cran). */
  private tickCycle(): void {
    if (!this.cycling) return;
    const now = this.ctx.clock.ticks;
    if (now - this.lastCycle <= CYCLE.period - 1) return;
    this.lastCycle = now;
    this.ctx.services.get(GRAPHICS).palette.rotate(CYCLE.first, CYCLE.count, -1);
    this.ctx.requestPresent();
  }

  /** Danse de victoire (étape 5) : un membre tiré au hasard, immobile, danse `SCRS` 13000 + valeur du pied ; remise à zéro quand chacun a dansé. */
  private dance(): void {
    if (!this.celebrating) return;
    const now = this.ctx.clock.ticks;
    if (this.danced >= this.party.length) {
      this.celebrating = false;
      this.danced = 0;
      return;
    }
    if (now - this.lastDance <= DANCE_GAP) return;
    this.lastDance = now;
    for (let tries = 0; tries < DANCE_TRIES; tries++) {
      const member = this.kit.members[this.ctx.rng.range(0, this.kit.members.length - 1)];
      if (!member || member.snoid.destroyed || !member.snoid.resting || member.walking) continue;
      const { snoid } = member;
      snoid.onEvent = undefined;
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        snoid.idle();
      };
      snoid.play(SCRS.dance + member.zoombini.attrs[3], FeatureFlag.stopAtEnd, { kind: "normal" });
      this.danced += 1;
      break;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // « go » (`1170:08f5` code 2, Tick étape 4)

  /** Seulement actif et une seule fois (`DS:9b64`, `DS:9d74`) ; le code 2 de `1170:08f5` n'est pas gardé par le rejet en cours (`DS:9c70`), seul le code 3 (plateau) l'est. */
  private pressGo(): boolean {
    if (this.went) return true;
    const result = go(this.play);
    if (!result) return true;
    this.kit.pressGo({ sound: "later", end: "depart", depart: () => this.startGo(result) });
    return true;
  }

  /** `1170:2d65`, `1150:2c72`, montée des pierres reliées (`SCRB` 7002) et des Zoombinis reliés (`SCRS` 13000), son 7000. */
  private startGo(result: SlidesResult): void {
    this.went = true;
    this.result = result;
    this.celebrating = false;
    this.kit.endCarry();
    this.kit.members.forEach((member, i) => {
      member.zoombini.present = result.saved.includes(i);
    });
    // Les pierres qui montent : montées, départs et emplacements reliés ; les autres perdent leur connecteur vers elles (`1150:2c72`).
    const raised = new Set<number>();
    this.board.stones.forEach((stone, i) => {
      const code = stateCode(this.board, this.ev, i);
      if (stone.kind !== "void" && (code === STATE.linkRaised || code === STATE.slotConnected || stone.kind === "start")) raised.add(i);
    });
    this.board.stones.forEach((stone, i) => {
      if (raised.has(i)) return;
      let mask = this.masks[i]!;
      stone.neighbors.forEach((j, d) => {
        if (j >= 0 && raised.has(j)) mask &= ~(1 << d);
      });
      this.masks[i] = mask;
    });
    this.ctx.services.get(ZOOMBINIS_SOUND).queue(SOUND.rumble);
    let first = true;
    for (const i of [...raised].sort((a, b) => a - b)) {
      const feature = this.stones[i]!;
      this.rising.push(i);
      feature.flags = RISE_FLAGS;
      feature.onEvent = first
        ? (_image, n) => {
            if (n === FEATURE_END) this.riseEnded = true;
          }
        : undefined;
      first = false;
      this.features.setScript(feature, SCRB.rise);
    }
    this.syncStones();
    for (const index of result.saved) this.riseMember(this.kit.members[index]!);
    this.stage = "rising";
  }

  /** Le Zoombini monte avec sa pierre (`SCRS` 13000, de `y = 147` à `74`) et reste en haut. */
  private riseMember(member: KitMember): void {
    const { snoid } = member;
    const at = { x: snoid.position.x, y: snoid.position.y };
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      snoid.moveTo({ x: at.x, y: at.y - RISE_HEIGHT });
      snoid.idle();
    };
    snoid.play(SCRS.rise, FeatureFlag.stopAtEnd, { kind: "normal" });
  }

  /** Tick après « go » : fin de la montée → son 7001, 60 ticks, son 996, départs échelonnés ; écran suivant au premier arrivé (996 fini). */
  private tickGo(): void {
    const now = this.ctx.clock.ticks;
    if (this.stage === "rising") {
      if (!this.riseEnded) return;
      this.ctx.services.get(ZOOMBINIS_SOUND).queue(SOUND.arrived);
      this.stage = "pause";
      this.pauseUntil = now + EXIT_PAUSE;
      return;
    }
    if (this.stage === "pause") {
      if (now < this.pauseUntil) return;
      this.stage = "walking";
      this.kit.playGoSound();
      this.scheduleDepartures(now);
      return;
    }
    if (this.stage !== "walking") return;
    for (const entry of [...this.departures]) {
      if (entry.at > now) continue;
      this.departures.splice(this.departures.indexOf(entry), 1);
      this.depart(entry.member);
    }
    if (this.arrivedCount > 0 && !this.kit.isPlaying(996)) this.complete();
  }

  /** `1168:2982(45, …)` : les sauvés partent un à un, le plus à droite d'abord, le premier tout de suite. */
  private scheduleDepartures(now: number): void {
    const saved = (this.result?.saved ?? []).map((i) => this.kit.members[i]!).filter((m) => !m.snoid.destroyed);
    saved.sort((a, b) => b.snoid.position.x - a.snoid.position.x);
    this.departures = saved.map((member, k) => ({ at: now + k * EXIT_STEP, member }));
  }

  private depart(member: KitMember): void {
    this.departed += 1;
    const { snoid } = member;
    snoid.onEnd = undefined;
    snoid.onEvent = undefined;
    snoid.onArrive = () => {
      snoid.onArrive = undefined;
      this.arrivedCount += 1;
    };
    const far = this.level >= 2 ? { x: 800, y: 200 } : { x: 1280, y: 240 };
    // `NODE` / `PATH` 1000 ne sont chargés qu'au niveau 3 (`1168:2a5c`) : la marche suit alors ce chemin.
    const map = this.level === 3 ? { nodes: node(this.archive, 1000), paths: [path(this.archive, 1000)[0]!] } : undefined;
    snoid.walkTo(far, map);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Touches du mode de test (`1170:1740`, table `CS:1810`)

  /**
   * Touches `s`, `o`, `v`, `l`, `e` dans cet ordre (`DS:9c7e` : chaque lettre n'avance que si la précédente a été saisie, les autres touches ne remettent rien à
   * zéro). La dernière, au niveau 3 seulement, pose la solution du générateur (`1150:3093`) puis recalcule les liaisons (`1170:3dc0`). Toutes consomment la touche.
   */
  readonly testKeys: Readonly<Record<number, () => boolean>> = {
    [0x73]: () => this.advance(0),
    [0x6f]: () => this.advance(1),
    [0x76]: () => this.advance(2),
    [0x6c]: () => this.advance(3),
    [0x65]: () => this.advance(4),
  };

  private advance(from: number): boolean {
    if (this.cheat !== from) return true;
    this.cheat = from + 1;
    if (from === 4 && this.level === 3) this.placeSolution();
    return true;
  }

  /**
   * `1150:3093` : chaque membre de la solution (`DS:92c0`, `board.solution`) est posé d'un coup sur son emplacement, puis les liaisons sont recalculées (`apply`,
   * `1170:3dc0`). **Écarts** : (1) la solution du générateur du port laisse parfois un membre sans emplacement (la solution de l'original contient tout le groupe) :
   * il est posé sur l'emplacement resté libre, comme le repli du robot ; (2) l'original ne libère ni l'emplacement ni l'attente que le membre occupait (état
   * incohérent si le plateau était déjà entamé) : ici ils sont libérés, et un membre hors solution qui occupait un emplacement visé retourne à pied sur une position
   * d'attente. Sans effet pendant un rejet ou après « go ».
   */
  private placeSolution(): void {
    if (this.went || this.busy) return;
    const target = [...this.board.solution];
    const left = this.kit.members.map((_, i) => i).filter((i) => !target.includes(i));
    target.forEach((m, k) => {
      if (m < 0 && left.length > 0) target[k] = left.shift()!;
    });
    const wanted = new Set(target.filter((m) => m >= 0));
    const release = (member: KitMember): void => {
      remove(this.play, member.index);
      for (const spot of [member.target, member.waiting]) if (spot && spot.owner === member) spot.owner = null;
      member.target = null;
      member.waiting = null;
    };
    target.forEach((m, k) => {
      if (m < 0 || this.play.seat[k] === m) return;
      const member = this.kit.members[m];
      const spot = this.slots[k];
      if (!member || !spot || this.flying.has(member)) return;
      const displaced = this.play.seat[k]!;
      if (displaced >= 0 && displaced !== m) {
        const other = this.kit.members[displaced]!;
        release(other);
        if (!wanted.has(displaced)) this.sendToWaiting(other);
      }
      release(member);
      this.kit.cancelWalk(member);
      member.snoid.moveTo({ x: spot.x, y: spot.y });
      member.snoid.idle();
      this.features.restack(member.snoid.feature, 1 + spot.y / 1000);
      spot.owner = member;
      member.target = spot;
      place(this.play, m, k);
    });
    this.apply();
  }

  /** Écran suivant (`DS:8556 ← 5`) : les reliés sont sauvés (`present`), les autres perdus. */
  private complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.kit.finish("success");
  }

  leaveScene(): void {
    this.kit.leave();
  }
}

/** Écran de la fosse de monte-pierre (`SLIDES.MHK`, écran 12). */
export function createSlidesScene(): SlidesScene {
  const name = screenInfo(SCREEN)?.archive;
  if (!name) throw new Error("createSlidesScene : pas d'archive pour l'écran 12");
  let archive: Archive;
  let run: SlidesRun | null = null;
  return {
    get probe() {
      return run;
    },
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(name);
    },
    enter(ctx: SceneContext) {
      run = new SlidesRun(ctx, archive);
    },
    leave(ctx: SceneContext) {
      run?.leaveScene();
      run = null;
      closeScreen(ctx);
    },
    tick() {
      run?.tick();
    },
    key(event, ctx: SceneContext) {
      if (!run || run.kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (ctx.services.tryGet(DIALOG)?.isOpen) return false;
      if (run.kit.testKey(event, run.testKeys)) return true;
      return run.kit.key(event);
    },
  };
}
