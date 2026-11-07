/**
 * La tanière du sphinx (`CAVES.MHK`, écran 16, tâche H12 ; `docs/zoombinis/puzzles/caves.md`, `docs/zoombinis/engine-ts.md`, « Sphinx (tâche H12) »).
 * Épreuve sur le kit commun (`puzzle-kit.ts`) : le kit porte l'arrivée du groupe, le glisser-déposer, les boutons, l'enregistrement, l'aide F1 et la musique ;
 * cet écran porte les règles (`game/puzzles/caves.ts`) et la mise en scène.
 *
 * ## Déroulé (original : Enter `10c8:0000`, Tick `10c8:09a6`, clic `10c8:130f`, phases du rejet `10c8:0e74`, événements `10c8:1137` et `10c8:1245`)
 *
 *  1. **Entrée** : fond et palette 5000, groupes de formes 6000 (lion, patte), 9000 (dalle allumée), 7000 (dalle), 8200 (retournement de dalle), 9025 (remplissage) et leurs
 *     `SCRB` ; lion et patte, remplissage des dalles inutilisées, les 20 dalles, tête du lion à son premier cran ; groupe (arrivée échelonnée 30 puis 45 ticks), tirage de la
 *     règle, des dalles et des indices, hiéroglyphes ; personne de « sauvé » (`+0x127 = 0`).
 *  2. **Dépôt sur le sol** (`DS:0d0a`) : le Zoombini reste où il est lâché ; ailleurs hors des dalles il tombe dans le gouffre (`SCRS` 12012) et revient d'où il vient (12013).
 *  3. **Dépôt sur une dalle** : « posé » (`+0x127 = 1`) et « go » actif. Dalle valable : il y reste (variante d'attente et sens de la dalle) et fait un pas sur place (`SCRS`
 *     13000 + pieds). Sinon il est replacé : la dalle se retourne (`SCRB` 8200 + 4(s − 1)), le Zoombini rebondit (`SCRS` 12004) et tombe, une dalle valable libre tirée au hasard se
 *     retourne à son tour (`+ 2`) et il y saute (`SCRS` 12005) ; les deux dalles s'allument et le lion se réveille d'un cran (`SCRB` base + cran). Pas de saisie tant que le lion joue.
 *  4. **Dernier cran** : la saisie reste verrouillée ; une phrase de consolation part s'il reste des Zoombinis hors des dalles.
 *  5. **Tout posé** : voix de réussite, verrou, puis un Zoombini tiré au hasard danse toutes les 30 ticks.
 *  6. **« go »** : le lion se réveille tout à fait (`SCRB` 6002), le son 996 part, les Zoombinis posés partent un à un (30 ticks d'écart, de la dalle 20 à la dalle 1) le long de
 *     `PATH` 1000 jusqu'au point de sortie ; quand ils sont tous partis (ou au premier clic), écran suivant. Les Zoombinis hors des dalles sont perdus.
 *
 * ## Écarts avec l'original (voir aussi `docs/zoombinis/puzzles/caves.md`)
 *
 *  - rayon de prise des dalles 15 (`DS:9706` par défaut : l'épreuve ne le règle pas) ; **probable** ;
 *  - le Zoombini posé sur une dalle est posé d'un coup (état 4 du kit) puis fait son pas sur place : l'original lui fait marcher la distance de dépôt (au plus 15 pixels) ;
 *  - le retournement de dalle est joué par une feature propre (profondeur 0,5) au-dessus de la dalle, qui est masquée pendant l'animation : l'original rejoue le script sur la
 *    feature de la dalle allumée `[71f8 + 2s]` (ordre de dessin non porté) ; la dalle allumée (`SCRB` 9000 + s − 1, deux images) n'est qu'un éclair d'une image ;
 *  - les poussières (`SCRB` 8201 / 8203 + 4(s − 1)) sont des features de même profondeur, sans le rattachement au Zoombini (`11a8:1f5c`) ; les objets d'accroche des dalles
 *    (scripts 6000 et rappels `10c8:18c7` / `18d3`) ne sont pas portés ;
 *  - l'éclat d'introduction des hiéroglyphes du niveau 1 (3 redessins à 30 ticks, `[70fa]`) n'est pas porté : `10c8:1a1f` n'est pas désassemblé ; la rangée est fixe ;
 *  - la danse de victoire tire sans remise (`NoRepeatPool`) au lieu de `1098:0098` avec le masque `[7238]` ; **probable** ;
 *  - le dernier Zoombini posé ne fait pas de pas sur place (fidèle : `[7224]` n'est pas alimenté dans ce cas) ;
 *  - le « 20036 / `0x4e44` » des études n'est pas une voix : c'est l'étiquette de type `SND` passée à `1028:0d9e(id, SND)`, qui demande si le son `id` (996) joue encore ; l'écran suivant l'attend (porté) ;
 *  - les rafales de touches de débogage (`10c8:1cf5`, `[a43f]`) ne sont pas portées.
 */
import { drawShape } from "../../../../engine/mohawk/graphics/blit";
import type { Archive } from "../../../../engine/mohawk/resources";
import { NoRepeatPool } from "../../../../engine/mohawk/rng";
import { screenInfo } from "../../data/archives";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type Features } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { node, path, regs } from "../../engine/resources";
import type { Scene, SceneContext } from "../../engine/scene";
import { currentLevel, dialogMemoryIndex } from "../../game/route";
import {
  HIEROGLYPH_X,
  HIEROGLYPH_Y,
  SLOT_ANCHORS,
  SLOT_COUNT,
  SLOT_FACING,
  SLOT_IDLE_VARIANT,
  LION_BASE_SCRIPT,
  WAITING_PLACES,
  createCaves,
  goEnabled,
  lionAtLast,
  onFloor,
  placeMember,
  regretVoiceDue,
  wakeLion,
  type CavesLevel,
  type CavesState,
  type Placement,
} from "../../game/puzzles/caves";
import type { Zoombini } from "../../game/state";
import { createPuzzleKit, createTarget, SOUND_GO, sheetButtonImages, type DropInfo, type DropTarget, type KitMember, type OutsidePlacement, type PuzzleKit, type Rect } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";
import { dialogChoice } from "../xfer";

const SCREEN = 16;

/** Fond et palette (`SHPL` / `tBMP` 5000), planches : lion 6000, dalle allumée 9000, dalle 7000, retournement 8200, remplissage 9025 ; hiéroglyphes 10000 ; boutons 11000. */
const BACKGROUND = 5000;
const GROUP_LION = 6000;
const GROUP_LIT = 9000;
const GROUP_TILES = 7000;
const GROUP_FLIP = 8200;
const GROUP_FILL = 9025;
const HIEROGLYPHS = 10000;
const BUTTONS_SHEET = 11000;

/** `SCRB` : lion (6000 patte, 6001 patte, 6002 éveil final, 6012 décor), dalle `6999 + s`, dalle allumée `8999 + s`, retournement `8200 + 4(s − 1) + {0, 1, 2, 3}`, remplissage `9024 + n`. */
const SCRB = {
  paw: 6000,
  pawBlink: 6001,
  awake: 6002,
  decor: 6012,
  tile: 6999,
  lit: 8999,
  flip: 8200,
  filler: 9024,
} as const;
/** Délais entre images (`11a8:0ad6`) : patte, remplissage et dalles allumées 6, éveil 8, tête du lion 9, dalles 7. */
const DELAY = { default: 6, awake: 8, head: 9, tile: 7 } as const;
/** Profondeurs : remplissage (recouvre les dalles inutilisées), hiéroglyphes, éclair des dalles allumées, retournements et poussières (sous les Zoombinis, qui sont à 1 + y / 1000). */
const DEPTH = { filler: 0.05, hieroglyphs: 0.1, flash: 0.4, flip: 0.5 } as const;
/** `SCRS` : rebond sur la dalle refusée, saut vers la dalle valable, chute dans le gouffre, retour ; pas sur place = 12999 + pieds. */
const SCRS = { hop: 12004, jump: 12005, fall: 12012, back: 12013, step: 12999 } as const;
/** Événements (octet bas du terminateur − 1) : `10c8:1137` pour les Zoombinis et les dalles, `10c8:1245` pour le lion. */
const EVENT = {
  /** Retournement de la dalle refusée, image 1 : le Zoombini rebondit ; dernière image : la dalle valable se retourne. */
  tileHop: 1,
  tileDone: 5,
  /** Retournement de la dalle valable, image 1 : le Zoombini saute. */
  tileJump: 2,
  /** Fin du saut. */
  landed: 4,
  /** Fin de la chute. */
  fallen: 10,
  /** Fin du retour ou d'un script du lion. */
  settled: 20,
  /** Fin de l'éveil final (`SCRB` 6002, octet 11). */
  awake: 10,
} as const;
/** Boutons (rectangles inclusifs des régions 1 et 2, `DS:0c2a`, `DS:0c4e`). */
const BUTTON_RECTS: { map: Rect; go: Rect } = {
  map: { left: 589, top: 392, right: 628, bottom: 429 },
  go: { left: 589, top: 430, right: 628, bottom: 467 },
};
/** Voix d'aide (`[a2c4] = 0x4e61`), sortie : écart entre deux départs 30 ticks, point de sortie (nœud 21 de `NODE` 1000). */
const HELP_VOICE = 20065;
const EXIT_STEP = 30;
const EXIT_NODE = { x: 701, y: 363 };
/** Danse de victoire : un Zoombini toutes les 30 ticks (`10c8:09a6`, étape 6). */
const DANCE_GAP = 30;
const MAP_ID = 1000;

/** `[0c08]` : script de base du lion (6006, 6005, 6004, 6003 aux niveaux 1 à 4). */
function lionBase(level: CavesLevel): number {
  return LION_BASE_SCRIPT[level];
}

/** Fin de partie : en cours, éveil final du lion, départ à pied des posés. */
type Leaving = "requested" | "waking" | "walking";

/** Rejet en cours : la dalle lâchée, la dalle valable, les features d'animation. */
interface Rejection {
  member: KitMember;
  placement: Placement;
  phase: 0 | 1 | 2 | 3;
  /** Demande de la phase suivante (`[0c0e]`, traitée au tick). */
  next: boolean;
  flips: Feature[];
}

/** Chute dans le gouffre en cours. */
interface Fall {
  member: KitMember;
  origin: { x: number; y: number };
  started: boolean;
}

/** Fenêtre sur l'épreuve en cours, pour les tests. */
export interface CavesProbe {
  readonly kit: PuzzleKit;
  readonly state: CavesState;
  /** `[0bf8]` : saisie verrouillée. */
  readonly locked: boolean;
  /** `[7102]` : une animation de rejet ou de chute est en cours. */
  readonly busy: boolean;
  readonly leaving: Leaving | null;
  readonly slots: readonly (DropTarget | undefined)[];
  /** Tête du lion (`[7232]`) et son script courant. */
  readonly lionScript: number;
  readonly hasWon: boolean;
}

export type CavesScene = Scene & { readonly probe: CavesProbe | null };

class CavesRun implements CavesProbe {
  readonly kit: PuzzleKit;
  state!: CavesState;
  locked = false;
  busy = false;
  leaving: Leaving | null = null;

  private readonly features: Features;
  private readonly party: Zoombini[];
  private readonly tiles: Feature[] = [];
  private readonly head: Feature;
  private readonly awake: Feature;
  private readonly targets: (DropTarget | undefined)[] = [];
  private readonly pool: NoRepeatPool;
  private rejection: Rejection | null = null;
  private fall: Fall | null = null;
  /** Danse de victoire (`[7240]`), nombre de danseurs (`[723e]`), date du dernier (`[7234]`). */
  private dancing = false;
  private danced = 0;
  private lastDance = 0;
  /** Départs en file (date, membre), et nombre partis / arrivés. */
  private readonly departures: { at: number; member: KitMember }[] = [];
  private departed = 0;
  private arrivedCount = 0;
  private finished = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly archive: Archive,
  ) {
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    const { game, session } = zoombinis;
    session.screen = SCREEN;
    const level = currentLevel(game, session, SCREEN) as CavesLevel;
    openScreen(ctx, archive, { background: BACKGROUND });
    this.features = ctx.services.get(FEATURES);
    this.party = game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
    this.pool = new NoRepeatPool(Math.max(1, Math.min(32, this.party.length)));
    if (this.party.length < 1 || this.party.length > SLOT_COUNT) throw new RangeError(`tanière du sphinx : ${this.party.length} Zoombinis`);

    // Décor, dans l'ordre de création de `10c8:0000` : le dernier créé est devant, les Zoombinis (créés ensuite) sont devant tout.
    const f = this.features;
    f.defineGroup(0, GROUP_LION);
    f.defineGroup(1, GROUP_LIT);
    f.defineGroup(2, GROUP_TILES);
    f.defineGroup(3, GROUP_FLIP);
    f.defineGroup(4, GROUP_FILL);
    f.setScripts(SCRB.paw, 13);
    f.addScripts(GROUP_LIT, 20);
    f.addScripts(GROUP_TILES, 20);
    f.addScripts(GROUP_FLIP, 80);
    f.addScripts(GROUP_FILL, 4);
    const F = FeatureFlag;
    const still = F.flag4000000 | F.noReplay | F.active;
    f.create({ script: SCRB.paw, delay: DELAY.default, flags: still });
    f.create({ script: SCRB.pawBlink, delay: DELAY.default, flags: still });
    this.awake = f.create({ script: SCRB.awake, delay: DELAY.awake, flags: F.flag4000000 | F.stopAtEnd | F.noReplay | F.active });
    // Les dalles du début du chemin que le groupe n'occupe pas sont recouvertes (`[71f8]`, scripts 9025 à 9028).
    const fillers = Math.min(4, SLOT_COUNT - this.party.length);
    if (fillers > 0) f.create({ script: SCRB.filler + fillers, delay: DELAY.default, flags: F.flag4000000 | F.stopAtEnd | F.active, depth: DEPTH.filler });
    for (let s = 1; s <= SLOT_COUNT; s++) {
      // Dalles : `0x508a000` dans l'original (`10c8:0000`), donc avec le bit `0x1000000`. **Écart provisoire** : elles restent dessinées (`still`) en attendant que
      // l'utilisatrice confirme l'aspect de l'original (sans elles, le fond montre des dalles dorées en pointe de diamant).
      this.tiles[s] = f.create({ script: SCRB.tile + s, delay: DELAY.tile, flags: F.flag4000000 | F.still | F.noReplay | F.active | F.firstImage });
    }
    f.create({ script: SCRB.decor, delay: 0, flags: F.flag4000000 });

    // Tête du lion (`[7232]`) : première image du script du premier cran (`SCRB` base + 1), qui rejoue à chaque cran.
    this.head = f.create({ script: lionBase(level) + 1, delay: DELAY.head, flags: F.region | F.stopAtEnd | F.noReplay });

    const images = archive.tbmpImages(HIEROGLYPHS);
    const anchorY = regs(archive, 201);
    // `10c8:1a8b` : rangée de hiéroglyphes, centrés sur leur abscisse, remontés de l'ancre `REGS 201` de l'emplacement.
    f.create({
      script: 0,
      delay: 0,
      depth: DEPTH.hieroglyphs,
      flags: 0,
      onAfterDraw: (_feature, screen) => {
        for (const hint of this.state?.hints ?? []) {
          const shape = images[hint.image - 1];
          if (shape) drawShape(screen, shape, HIEROGLYPH_X[hint.slot]! - (shape.width >> 1), HIEROGLYPH_Y[hint.slot]! - (anchorY[hint.slot] ?? 0), 8);
        }
      },
    });

    // Cibles de dépôt : les dalles du groupe (les dalles de remplissage appartiennent à leur objet : `[02f0 + 2i]`, jamais libres).
    for (let s = SLOT_COUNT + 1 - this.party.length; s <= SLOT_COUNT; s++) this.targets[s] = createTarget(SLOT_ANCHORS[s - 1]!, s);
    const buttons = sheetButtonImages(archive.tbmpImages(BUTTONS_SHEET));
    this.kit = createPuzzleKit(ctx, {
      screen: SCREEN,
      party: this.party,
      places: WAITING_PLACES,
      targets: () => this.targets.filter((t): t is DropTarget => t !== undefined),
      introVoice: HELP_VOICE,
      snoid: { scripts: screenScripts(archive) },
      buttons: {
        map: { rect: BUTTON_RECTS.map, images: buttons.map },
        go: { rect: BUTTON_RECTS.go, images: buttons.go, onPress: () => this.pressGo() },
      },
      canPick: (member) => this.canPick(member),
      decide: (drop) => this.decide(drop),
      onDrop: (drop) => this.dropped(drop),
      onDropOutside: (drop) => this.droppedOutside(drop),
    });
    this.kit.arrive({ startDelay: 30, step: 45 });
    // `1168:0858` crée les Zoombinis, puis `10c8:1ffd` tire la règle et `10c8:2279` les indices.
    this.state = createCaves(ctx.rng, level, this.party.map((z) => z.attrs));
    // `1168:3dd0(0, 0)` : personne n'est posé (`+0x127 = 0`).
    this.kit.markAll(false);
    this.kit.playMusic();
    // `1168:5c57` : une visite de plus de l'écran (mémoire de dialogue 12, 12 bits).
    const slot = dialogMemoryIndex(SCREEN);
    if (slot >= 0) game.dialogMemory[slot] = dialogChoice(game.dialogMemory[slot]!, level, session.training !== 0).memory;
    ctx.requestPresent();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Fenêtre pour les tests

  get slots(): readonly (DropTarget | undefined)[] {
    return this.targets;
  }

  get lionScript(): number {
    return this.head.scriptId;
  }

  get hasWon(): boolean {
    return this.state.placed === this.party.length;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Prise et dépôt (`10c8:130f` région 3)

  /** Saisie permise (`[0bf8] == 0`, `[9702] < 1`) et Zoombini pas déjà sur une dalle. */
  private canPick(member: KitMember): boolean {
    if (this.locked || this.leaving !== null || this.kit.walking >= 1) return false;
    return this.state.slotOf[member.index] === 0;
  }

  private decide(drop: DropInfo): boolean {
    return !this.locked && typeof drop.target?.tag === "number";
  }

  private dropped(drop: DropInfo): void {
    const { member, target } = drop;
    const dropped = target?.tag as number;
    const placement = placeMember(this.state, this.ctx.rng, member.index, dropped);
    // `+0x127 = 1` : posé (sauvé), même si la dalle est refusée.
    member.zoombini.present = true;
    if (placement.first) this.kit.goEnabled = goEnabled(this.state);
    const snoid = member.snoid;
    if (placement.correct) {
      this.applyPose(member, placement.slot);
      if (placement.complete) {
        this.finishPlacing();
      } else {
        // File de marche `[7224]` : un pas sur place (`SCRS` 12999 + pieds) à l'arrivée sur la dalle.
        snoid.onEvent = undefined;
        snoid.onEnd = () => {
          snoid.onEnd = undefined;
          snoid.idle();
        };
        snoid.play(SCRS.step + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal" });
      }
      return;
    }
    // Replacé : la dalle lâchée est libérée, la dalle valable est à lui (`27a6`, `170f`).
    const right = this.targets[placement.slot]!;
    target!.owner = null;
    right.owner = member;
    member.target = right;
    this.locked = true;
    this.busy = true;
    this.rejection = { member, placement, phase: 0, next: false, flips: [] };
    if (placement.complete) this.playSuccess();
  }

  /** Variante d'attente et sens de la dalle (`+0xf1`, `+0xf2`). */
  private applyPose(member: KitMember, slot: number): void {
    member.snoid.idleVariant = SLOT_IDLE_VARIANT[slot - 1]!;
    member.snoid.setFacing(SLOT_FACING[slot - 1]!);
    member.snoid.idle();
  }

  /** Tout le groupe est posé : voix, verrou, danse de victoire (`[7240]`). */
  private finishPlacing(): void {
    this.locked = true;
    this.dancing = true;
    this.lastDance = this.ctx.clock.ticks;
    this.playSuccess();
  }

  private playSuccess(): void {
    this.kit.playSuccessVoice();
  }

  /** Dépôt hors dalle : sur le sol il reste là, ailleurs il tombe dans le gouffre et revient d'où il vient. */
  private droppedOutside(drop: DropInfo): OutsidePlacement | void {
    if (this.locked) return;
    const { x, y } = drop.position;
    if (onFloor(x, y)) return { at: { x, y } };
    this.locked = true;
    this.busy = true;
    this.fall = { member: drop.member, origin: { ...drop.origin }, started: false };
    // La place d'attente quittée redevient la sienne ; la chute démarre au tick, une fois le Zoombini posé là où il est lâché.
    return { at: { x, y }, place: drop.from };
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick (`10c8:09a6`)

  tick(): void {
    this.kit.tick();
    if (this.finished || this.kit.finishing) return;
    if (this.kit.left && this.leaving === null) return;
    if (this.ctx.services.tryGet(DIALOG)?.isOpen) return;
    // Une chute ou un rejet en cours s'achève même si « go » a été demandé (le départ attend `[7102] == 0`).
    this.tickFall();
    this.tickRejection();
    if (this.leaving !== null) {
      this.leave();
      return;
    }
    this.dance();
  }

  // --- Chute dans le gouffre (`10c8:0e74(2)`, `SCRS` 12012 / 12013) ---

  private tickFall(): void {
    const fall = this.fall;
    if (!fall || fall.started) return;
    fall.started = true;
    const { snoid } = fall.member;
    snoid.onEnd = undefined;
    snoid.onEvent = (n) => {
      if (n !== EVENT.fallen) return;
      // Fin de la chute : retour vers la position d'origine (`[724a]`, `10c8:1137` cas 10).
      snoid.onEvent = (m) => {
        if (m === EVENT.settled) this.fallSettled(fall);
      };
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        snoid.idle();
      };
      snoid.play(SCRS.back, FeatureFlag.stopAtEnd, { kind: "reject", at: fall.origin });
    };
    snoid.play(SCRS.fall, FeatureFlag.stopAtEnd, { kind: "reject" });
  }

  /** `10c8:1137` cas 0x14 : le verrou tombe, sauf au dernier cran. */
  private fallSettled(fall: Fall): void {
    if (this.fall !== fall) return;
    this.fall = null;
    this.busy = false;
    this.locked = lionAtLast(this.state) || this.hasWon;
  }

  // --- Rejet (`10c8:0e74(0)` et `(1)`, `10c8:1137`) ---

  private tickRejection(): void {
    const r = this.rejection;
    if (!r) return;
    if (r.phase === 0) {
      r.phase = 1;
      this.startFlip(r, r.placement.dropped, 0);
    } else if (r.phase === 1 && r.next) {
      r.next = false;
      r.phase = 2;
      this.startFlip(r, r.placement.slot, 2);
    }
  }

  /** Retourne la dalle `slot` : `SCRB` 8200 + 4(s − 1) + `part` (+ 1 pour la poussière). Dalle masquée le temps de l'animation. */
  private startFlip(r: Rejection, slot: number, part: 0 | 2): void {
    const f = this.features;
    const F = FeatureFlag;
    const base = SCRB.flip + 4 * (slot - 1) + part;
    const tile = this.tiles[slot]!;
    tile.flags |= F.noDraw;
    f.invalidate();
    const flip = f.create({
      script: base,
      delay: DELAY.default,
      flags: F.flag4000000 | F.stopAtEnd | F.active,
      depth: DEPTH.flip,
      onEvent: (_image, n) => {
        if (n === FEATURE_END) {
          tile.flags &= ~F.noDraw;
          f.destroy(flip);
          f.invalidate();
        } else {
          this.flipEvent(r, part, n);
        }
      },
    });
    const dust = f.create({
      script: base + 1,
      delay: DELAY.default,
      flags: F.flag4000000 | F.stopAtEnd | F.active,
      depth: DEPTH.flip,
      onEvent: (_image, n) => {
        if (n === FEATURE_END) f.destroy(dust);
      },
    });
    r.flips.push(flip, dust);
  }

  private flipEvent(r: Rejection, part: 0 | 2, n: number): void {
    const { snoid } = r.member;
    if (part === 0 && n === EVENT.tileHop) {
      // Le Zoombini rebondit sur la dalle refusée (`SCRS` 12004, depuis sa position).
      snoid.onEnd = undefined;
      snoid.onEvent = undefined;
      snoid.play(SCRS.hop, FeatureFlag.stopAtEnd, { kind: "reject" });
    } else if (part === 0 && n === EVENT.tileDone) {
      r.next = true;
    } else if (part === 2 && n === EVENT.tileJump) {
      // Il saute vers la dalle valable (`SCRS` 12005, qui finit sur son ancre) ; à la fin du saut les deux dalles s'allument et le lion monte.
      const anchor = SLOT_ANCHORS[r.placement.slot - 1]!;
      snoid.onEvent = (m) => {
        if (m === EVENT.landed) this.landed(r);
      };
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        this.applyPose(r.member, r.placement.slot);
      };
      snoid.play(SCRS.jump, FeatureFlag.stopAtEnd, { kind: "reject", at: anchor });
    }
  }

  /** `10c8:1137` cas 4 : dalles allumées (`[7222]`), le lion monte d'un cran (`10c8:1c92`). */
  private landed(r: Rejection): void {
    this.flash(r.placement.dropped);
    this.flash(r.placement.slot);
    const script = wakeLion(this.state);
    this.rejection = null;
    if (script === null) {
      this.settle();
      return;
    }
    const F = FeatureFlag;
    const head = this.head;
    head.flags |= F.stopAtEnd;
    head.onEvent = (_image, n) => {
      if (n === EVENT.settled) this.settle();
    };
    this.features.setScript(head, script);
  }

  /** Éclair d'une dalle allumée (`SCRB` 8999 + s). */
  private flash(slot: number): void {
    const f = this.features;
    const lit = f.create({
      script: SCRB.lit + slot,
      delay: DELAY.default,
      flags: FeatureFlag.flag4000000 | FeatureFlag.stopAtEnd | FeatureFlag.active,
      depth: DEPTH.flash,
      onEvent: (_image, n) => {
        if (n === FEATURE_END) f.destroy(lit);
      },
    });
  }

  /** `10c8:1245` événement 0x14 : fin d'un script du lion. Le verrou tombe sauf au dernier cran, où la phrase de consolation part s'il reste des Zoombinis. */
  private settle(): void {
    this.busy = false;
    const last = lionAtLast(this.state);
    this.locked = last || this.hasWon;
    if (!last) return;
    if (this.state.placed >= this.party.length) return;
    const { game } = this.ctx.services.get(ZOOMBINIS_GAME);
    const slot = dialogMemoryIndex(SCREEN);
    const visits = slot >= 0 ? game.dialogMemory[slot]! & 0xfff : 0;
    if (regretVoiceDue(this.state, this.ctx.rng.range(0, 4), visits)) this.kit.playRegretVoice();
  }

  // --- Danse de victoire (`[7240]`) ---

  private dance(): void {
    if (!this.dancing) return;
    const now = this.ctx.clock.ticks;
    if (this.danced >= this.party.length - 1) {
      // `[723e] ≥ [723c]` : remise à zéro.
      this.dancing = false;
      this.danced = 0;
      return;
    }
    if (now - this.lastDance <= DANCE_GAP) return;
    this.lastDance = now;
    for (let tries = 0; tries < this.party.length; tries++) {
      const member = this.kit.members[this.pool.pick(this.ctx.rng)];
      if (!member || !member.snoid.resting || member.snoid.destroyed || !member.zoombini.present) continue;
      const { snoid } = member;
      snoid.onEvent = undefined;
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        snoid.idle();
      };
      snoid.play(SCRS.step + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal" });
      this.danced += 1;
      break;
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // « go » et départ (`10c8:130f` cas 2, Tick étapes 1 et 2)

  /**
   * Bouton « go » (actif) : demande l'éveil du lion. Le kit se gèle et l'écran mène seul son départ (son 996 après l'éveil, `end: "depart"`) ;
   * un clic pendant le départ change l'écran tout de suite (`10c8:130f`, `[8556] ≠ 0`), ce que fait le kit.
   */
  private pressGo(): boolean {
    if (this.leaving !== null) return true;
    this.kit.pressGo({
      sound: "later",
      end: "depart",
      depart: () => {
        this.leaving = "requested";
        this.locked = true;
        this.dancing = false;
        this.kit.endCarry();
      },
    });
    return true;
  }

  private leave(): void {
    if (this.leaving === "requested") {
      // Éveil du lion (`[70fe]`) : attend la fin de l'animation en cours (`[7102] == 0`).
      if (this.busy) return;
      this.leaving = "waking";
      const awake = this.awake;
      awake.onEvent = (_image, n) => {
        if (n === EVENT.awake) this.startDeparture();
      };
      this.features.setScript(awake, SCRB.awake);
    } else if (this.leaving === "walking") {
      const now = this.ctx.clock.ticks;
      for (const entry of [...this.departures]) {
        if (entry.at > now) continue;
        this.departures.splice(this.departures.indexOf(entry), 1);
        this.depart(entry.member);
      }
      // `1028:0d9e(996)` (`10c8:09db`) : l'écran ne change pas tant que le son de départ joue encore.
      if (this.departures.length === 0 && this.arrivedCount >= this.departed && !this.kit.isPlaying(SOUND_GO)) this.complete();
    }
  }

  /** `10c8:16c2` : son 996, puis les posés partent de la dalle 20 à la dalle 1, un toutes les 30 ticks. */
  private startDeparture(): void {
    if (this.leaving !== "waking") return;
    this.leaving = "walking";
    this.kit.playGoSound();
    const now = this.ctx.clock.ticks;
    let k = 0;
    for (let s = SLOT_COUNT; s >= 1; s--) {
      const index = this.state.occupant[s]!;
      const member = index >= 0 ? this.kit.members[index] : undefined;
      if (!member || member.snoid.destroyed) continue;
      this.departures.push({ at: now + k * EXIT_STEP, member });
      k += 1;
    }
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
    snoid.walkTo(EXIT_NODE, { nodes: node(this.archive, MAP_ID), paths: [path(this.archive, MAP_ID)[0]!] });
  }

  /** Écran suivant (`[8556] = 0x11`) : les posés sont sauvés (`present`), les autres perdus. */
  private complete(): void {
    if (this.finished) return;
    this.finished = true;
    this.kit.finish("success");
  }

  leaveScene(): void {
    this.kit.leave();
  }
}

/** Écran de la tanière du sphinx (`CAVES.MHK`, écran 16). */
export function createCavesScene(): CavesScene {
  const name = screenInfo(SCREEN)?.archive;
  if (!name) throw new Error("createCavesScene : pas d'archive pour l'écran 16");
  let archive: Archive;
  let run: CavesRun | null = null;
  return {
    get probe() {
      return run;
    },
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(name);
    },
    enter(ctx: SceneContext) {
      run = new CavesRun(ctx, archive);
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
      return run.kit.key(event);
    },
  };
}
