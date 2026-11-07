/**
 * L'hôtel du temps-compté (`HOTEL.MHK`, écran 14, tâche H10 ; `docs/zoombinis/puzzles/hotel.md`, `docs/zoombinis/engine-ts.md`, « Hôtel (tâche H10) »).
 * Épreuve de la vague H sur le kit commun (`puzzle-kit.ts`) : le kit porte le groupe, le glisser-déposer, les boutons, la sortie, l'enregistrement, l'aide F1 et la
 * musique ; cet écran porte les règles (`game/puzzles/hotel.ts`) et la mise en scène.
 *
 * ## Déroulé (original : Enter `10e8:0000`, Tick `10e8:07ca`, mise en place `10e8:1896`, relance `10e8:12f6`, clic `10e8:1cea`)
 *
 *  1. **Entrée** : fond 5000 (la forêt et sa palissade), avant-plans `SCRB 11500 + {0, 1, 1, 2}` et 11800, plan de la palissade au niveau 2 (les chambres bloquées,
 *     `SCRB 11000 + dessin` aux points de `REGS 11000` / `11001`), puis la **scénette d'introduction** `SCRB 7000 + variante` (`DS:74ae`) : l'écureuil du portier. Un clic
 *     l'abandonne (`DS:7504`).
 *  2. **Relance** (la scénette finie ou abandonnée) : fond 5001 (niveaux 0 à 2) ou 5002 (niveau 3), groupe sur les seize places du hall (`1438:000a`), puis les objets des
 *     chambres dans l'ordre de `12f6` : portes `SCRB 6013 + r`, barrières (niveaux 2 et 3), avant-plan percé de trous aux portes (`11503` / `11504` / `11505`), étagères `6038 + r`,
 *     socles de dépôt `10000 + r` (niveau 3 : portes `9002 + r mod 5`, étagères `9007 + r mod 5`, socles `10025 + r`).
 *  3. **Explication** : au niveau 0 à la première visite, aux niveaux 1 et 2 toujours, l'écureuil explique (`SCRB 7500 + niveau`, après 180 ticks au niveau 1) ; un clic l'abandonne.
 *     Puis le cadran (niveaux 0 à 2) descend (`SCRB 6000`) et marque ses `F` premiers crans (`6001` à `6000 + F`) ; la musique `30020 + niveau` démarre.
 *  4. **Pose** : un Zoombini lâché dans le carré de prise d'une chambre (`1168:1742`) est jugé par `place`. *Accepté* : il monte dans la chambre (`SCRS 13030 + …`, `13045 + …`
 *     au niveau 3), prend sa place dans la pile (`10e8:3620`), la porte de la chambre s'ouvre pour le premier, « go » devient actif. *Refusé* : l'étagère bascule
 *     (`6038 + r`, `9007 + r mod 5`), le Zoombini rebondit (`SCRS 13000 + r`) puis tombe au sol (`14000 + r`, `14025 + …`), le cran suivant du cadran joue, la lumière baisse
 *     (palette × 88 / 90 / 92 % : `10e8:2698`), au cran 9 une réplique, au douzième la défaite.
 *  5. **Fin** : tous rangés (voix 175 à 198 puis, niveaux 0 à 2, étagères repliées et scénette de victoire `7507 + rand(0..2)`) ou défaite (cran 12 : coucou `6012`, voix 6006,
 *     étagères repliées, scénette `7503 + rand(0..3)` ; niveau 3 : attente de 60 ticks puis le son 7500). Le joueur sort par « go » : les non rangés sont perdus.
 *
 * ## Écarts avec l'original (voir aussi `docs/zoombinis/puzzles/hotel.md`)
 *
 *  - la scénette d'introduction et le groupe : l'original crée le groupe dès l'entrée sur vingt places du hall (`DS:12d6`) ; le groupe n'apparaît ici qu'à la relance, sur les
 *    seize places du bas, **debout** (l'original n'appelle ni `1168:2505` ni `1168:274e` : aucune entrée à pied) ;
 *  - le rectangle de découpe d'un Zoombini rangé (`+0xe4`) n'est pas porté : l'avant-plan percé suffit à ne le montrer que dans l'ouverture de sa porte ;
 *  - un Zoombini déjà rangé n'est pas reprenable (l'original le laisse déplacer pour trier à l'œil, sans changer de chambre) ;
 *  - un dépôt sur une chambre bloquée renvoie le Zoombini sur sa place d'origine (l'original l'annule sans le déplacer) ;
 *  - le survol (images 1 et 2 des socles `10000 + r`) n'est pas porté ;
 *  - les clics pendant les animations de refus et d'acceptation sont ignorés jusqu'à leur fin (l'original ne bloque que le traitement du Tick) ;
 *  - l'attente de 60 ticks de la défaite (`1090:00c1`) est un délai de la scène, pas une attente bloquante.
 */
import type { Archive } from "../../../../engine/mohawk/resources";
import { screenInfo } from "../../data/archives";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type Features } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { regs } from "../../engine/resources";
import type { Scene, SceneContext } from "../../engine/scene";
import { GRAPHICS } from "../../engine/services";
import { ZOOMBINIS_SOUND } from "../../engine/sound";
import {
  ROOM_POINTS_125,
  ROOM_POINTS_25,
  DEFEAT_VOICE,
  DEFEAT_VOICE_L3,
  DEFEAT_WAIT_TICKS,
  DIM_PERCENT,
  FREE_STEPS,
  HALL_PLACES,
  HELP_VOICE,
  INTRO_SCRIPT,
  WARNING_STEP,
  blockedArt,
  blockedRooms,
  createHotel,
  dimPalette,
  drawCompletionVoice,
  drawDefeatScript,
  drawVictoryScript,
  drawWarningScript,
  explanationScript,
  introVariant,
  place,
  tablePoint,
  type HotelState,
  type Level,
} from "../../game/puzzles/hotel";
import { currentLevel, dialogMemoryIndex } from "../../game/route";
import type { Zoombini } from "../../game/state";
import { createPuzzleKit, createTarget, sheetButtonImages, type DropInfo, type DropTarget, type KitMember, type PuzzleKit } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";
import { dialogChoice } from "../xfer";

const SCREEN = 14;

/** Fonds : l'entrée (forêt et palissade) puis, après la relance, les troncs de l'hôtel (5001 : niveaux 0 à 2, 5002 : niveau 3). */
const BACKGROUND_ENTRY = 5000;
const BACKGROUND_HOTEL = [5001, 5001, 5001, 5002] as const;
/** Planche des boutons (`DS:12d2` = `tBMP 8000`, `10e8:05c7`) et groupes de formes. */
const BUTTONS_SHEET = 8000;
/** Barrières : planches `tBMP 11000` (niveau 2, ancres `REGS 11002` / `11003`) et `12000` (niveau 3, sans ancre). */
const BARRIER_SHEET = [0, 0, 11000, 12000] as const;

/** Profondeurs (l'original ordonne par création, `12f6` : portes, barrières, avant-plan, étagères, socles) : les Zoombinis sont à `1 + y / 1000`. */
const DEPTH = {
  door: 0.5,
  barrier: 0.6,
  wall: 2,
  /** Un Zoombini qui monte ou qui tombe passe devant l'avant-plan. */
  acting: 3,
  shelf: 3.5,
  base: 3.6,
  clock: 4,
  buttons: 5,
  scene: 6,
} as const;

const F = FeatureFlag;
/** Drapeaux des objets de `12f6` (`0x4188000`, `0xc188000`, `0x508a000`, `0x4008000`, `0x808000`, `0x108000`, `0x8108000`, `0x8188000`). */
const FLAG_DOOR = F.flag4000000 | F.stopAtEnd | F.noReplay | F.active;
const FLAG_SHELF = F.region | FLAG_DOOR;
const FLAG_BASE = F.flag4000000 | F.staticFirst | F.noReplay | F.active | F.firstImage;
const FLAG_WALL = F.flag4000000 | F.active;
const FLAG_BARRIER = F.relative | F.active;
const FLAG_PLAY = F.stopAtEnd | F.active;
const FLAG_SCENE = F.region | F.stopAtEnd | F.active;
const FLAG_EXPLAIN = F.region | F.stopAtEnd | F.noReplay | F.active;

/** Délai entre images : cadran, portes et avant-plans 6 ; étagères 3 ; socles 7 (niveau 3 : 6) ; Zoombini qui rebondit 3 (`+0x28`). */
const DELAY = { play: 6, shelf: 3, base: 7, refusal: 3, fold: 1 } as const;

/** `SCRB` de l'écran. */
const SCRB = {
  clock: 6000,
  door: 6013,
  shelf: 6038,
  shelfFold: 6063,
  foreground: 11500,
  strip: 11800,
  wallFirst: 11503,
  barrierPlan: 11000,
  barrierRoom: 11004,
  doorL3: 9002,
  shelfL3: 9007,
  baseL3: 10025,
  barrierL3: 12000,
  base: 10000,
} as const;

/** `SCRS` : rebond (`13000 + r`, niveau 3 : `13025 + r mod 5`), chute (`14000 + r`, niveau 3 : `14025 + r mod 25`), montée (voir `acceptScript`). */
const SCRS = { refusal: 13000, refusalL3: 13025, fall: 14000, fallL3: 14025, accept: [13030, 13035, 13040], acceptL3: 13045 } as const;

/** `1168:3f76` : abscisse du point d'atterrissage (`10e8:349f`, `-23` ou `-15`) et ordonnée `410 + 5 × ⌊r / 5⌋` (niveau 3 : `⌊r / 25⌋`). */
const LAND = { dx: -23, dxL3: -15, y: 410, ystep: 5 } as const;

/** Tables de `DS:132c` / `DS:1336` (décalages de colonne du niveau 3) et de `1438:0000` (décalage des portes). */
const OFFSET_X5 = [0, 23, 46, 69, 94] as const;
const OFFSET_Y5 = [0, 10, 16, 20, 23] as const;
const OFFSET_DOOR = [0, 7, 11, 14, 17] as const;

/** `DS:9706` (`10e8:12f6`) : rayon de prise des chambres, 15 + 10 aux niveaux 0 à 2, 10 au niveau 3. */
const RADIUS = [25, 25, 25, 10] as const;
/** Attente avant l'explication du niveau 1 (`10e8:0d27` : `0xb4` ticks). */
const EXPLAIN_WAIT = 180;
/** Rayon de dispersion des autres Zoombinis autour d'un atterrissage (`10e8:3bae`). */
const SCATTER = { dx: 20, yMin: 400, yMax: 440, floor: 440, step: 30, min: 15, max: 520 } as const;

export interface Point {
  x: number;
  y: number;
}

/** Fenêtre sur l'épreuve en cours, pour les tests. */
export interface HotelProbe {
  readonly kit: PuzzleKit | null;
  readonly state: HotelState;
  readonly level: Level;
  /** `intro` (scénette de l'entrée), `explain` (explication après la relance), `play`. */
  readonly phase: "intro" | "explain" | "play";
  /** Variante de la scénette d'entrée (`DS:74ae`). */
  readonly variant: number;
  /** Une animation de pose ou de cran de l'horloge est en cours. */
  readonly busy: boolean;
  /** Nombre d'assombrissements appliqués à la palette. */
  readonly dims: number;
  /** Id du script du cadran (niveaux 0 à 2). */
  readonly clockScript: number;
  /** Étagères et portes par chambre. */
  readonly shelves: readonly (Feature | undefined)[];
  readonly doors: readonly (Feature | undefined)[];
  /** Id de la dernière scénette lancée (introduction, explication, victoire ou défaite). */
  readonly lastScene: number;
  /** Points de dépôt des chambres. */
  readonly roomTargets: readonly DropTarget[];
  /** Atterrissage de la chambre `room`, rangement final de la `k`-ième place. */
  landing(room: number): Point;
  /** Point de dépôt (pieds) de la chambre `room`. */
  point(room: number): Point;
}

export type HotelScene = Scene & { readonly probe: HotelProbe | null };

/** Rangement final d'un Zoombini dans la pile de la chambre (`10e8:3620`, `757a` / `757c`). */
export function stackPosition(level: number, tableRoom: number, room: Point, pile: number): Point {
  if (level === 3) {
    let x = room.x + 5;
    let y = room.y - 17;
    if (pile > 1) {
      x += (pile - 1) * -2;
      y -= pile - 1;
    }
    return { x, y };
  }
  let base: number;
  if (level === 0) base = room.x + ({ 4: 0x13, 9: 0x11, 14: 0x15, 19: 0x15, 24: 0x15 } as Record<number, number>)[tableRoom]!;
  else if (tableRoom < 5) base = room.x + 0x10;
  else if (tableRoom < 10) base = room.x + 0x12;
  else if (tableRoom < 15) base = room.x + 0x13;
  else if (tableRoom < 20) base = room.x + 0x14;
  else base = room.x + 0x13;
  const y = pile + (room.y - 9) - 1;
  if (pile === 0 || pile % 3 === 1) return { x: base - 8, y };
  if (pile % 3 === 2) return { x: base - 1, y };
  return { x: base + 6, y };
}

/** `SCRS` de la montée d'un Zoombini accepté (`10e8:3620`). */
export function acceptScript(level: number, tableRoom: number, room: number, feet: number): number {
  if (level === 3) return SCRS.acceptL3 + (room % 5) * 5 + feet - 1;
  const family = tableRoom < 10 ? 0 : tableRoom < 15 ? 1 : 2;
  return SCRS.accept[family]! + feet - 1;
}

class HotelRun implements HotelProbe {
  kit: PuzzleKit | null = null;
  state!: HotelState;
  phase: "intro" | "explain" | "play" = "intro";
  variant = 0;
  dims = 0;
  lastScene = 0;
  readonly shelves: (Feature | undefined)[] = [];
  readonly doors: (Feature | undefined)[] = [];
  readonly roomTargets: DropTarget[] = [];

  readonly level: Level;
  private readonly features: Features;
  private readonly party: Zoombini[];
  private readonly later: { at: number; run: () => void }[] = [];
  private readonly points: readonly Point[];
  private clock: Feature | undefined;
  private scene: Feature | undefined;
  /** Actions en cours (rebond, montée) et cran d'horloge en cours. */
  private acting = 0;
  private clockBusy = false;
  /** Étape suivante de l'introduction du cadran (`DS:74ee` de 1 à `F`), ou 0. */
  private clockIntro = 0;
  private explainAt = -1;
  private ended = false;
  private skipped = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly archive: Archive,
  ) {
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    const { game, session } = zoombinis;
    session.screen = SCREEN;
    this.level = currentLevel(game, session, SCREEN) as Level;
    this.features = ctx.services.get(FEATURES);
    this.points = this.level === 3 ? ROOM_POINTS_125 : ROOM_POINTS_25;
    this.party = game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
    // `1168:5c57` : une visite de plus de l'écran (mémoire de dialogue `S+0x3A`, 12 bits) ; `DS:74ae` d'après ce compteur.
    const slot = dialogMemoryIndex(SCREEN);
    let visits = 0;
    if (slot >= 0) {
      const next = dialogChoice(game.dialogMemory[slot]!, this.level, session.training !== 0).memory;
      game.dialogMemory[slot] = next;
      visits = next & 0xfff;
    }
    // Ordre des tirages de l'`Enter` : la variante `DS:74ae` (`10e8:0425`), puis la mise en place `10e8:1896` (attributs, chambres bloquées), que la scénette
    // d'entrée montre déjà au niveau 2 (plan de la palissade).
    this.variant = introVariant(ctx.rng, this.level, visits);
    this.state = createHotel(
      ctx.rng,
      this.level,
      this.party.map((z) => z.attrs),
    );
    this.buildEntry();
    ctx.requestPresent();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Fenêtre pour les tests

  get busy(): boolean {
    return this.acting > 0 || this.clockBusy;
  }

  get clockScript(): number {
    return this.clock?.scriptId ?? 0;
  }

  point(room: number): Point {
    return this.points[tablePoint(this.level, room)]!;
  }

  landing(room: number): Point {
    const table = tablePoint(this.level, room);
    if (this.level === 3) return { x: this.points[table]!.x + LAND.dxL3, y: LAND.y + LAND.ystep * Math.floor(room / 25) };
    return { x: this.points[table]!.x + LAND.dx, y: LAND.y + LAND.ystep * Math.floor(table / 5) };
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Mise en scène

  /** Groupes de formes et plages de scripts de l'`Enter` (`10e8:0000`) ; `barriers` ajoute la planche des barrières. */
  private defineGroups(): void {
    const f = this.features;
    const archive = this.archive;
    const l3 = this.level === 3;
    f.defineGroup(0, l3 ? 9000 : 6000);
    f.defineGroup(1, 7000);
    f.defineGroup(2, 10000);
    f.defineGroup(3, 11500);
    f.defineGroup(4, 11800);
    if (l3) {
      f.setScripts(9000, 12);
      f.addScripts(7000, 11);
      f.addScripts(SCRB.baseL3, 125);
    } else {
      f.defineGroup(5, 7500);
      f.setScripts(6000, 88);
      f.addScripts(7000, 11);
      f.addScripts(SCRB.base, 25);
    }
    f.addScripts(11500, 6);
    f.addScripts(SCRB.strip, 1);
    if (!l3) f.addScripts(7500, 10);
    // Barrières : planche propre (`DS:7540` / `7544`), ancres `REGS 11002` / `11003` au niveau 2.
    const sheet = BARRIER_SHEET[this.level];
    if (sheet) {
      const group = l3 ? 5 : 6;
      const images = archive.tbmpImages(sheet);
      f.setGroup(group, l3 ? { images } : { images, anchors: { x: regs(archive, 11002), y: regs(archive, 11003) } });
      f.addScripts(l3 ? SCRB.barrierL3 : SCRB.barrierPlan, l3 ? 4 : 8);
    }
  }

  /** Entrée (`10e8:0000`, `10e8:1896`) : fond 5000, avant-plans, plan de la palissade (niveau 2), scénette d'introduction. */
  private buildEntry(): void {
    const { archive, features: f } = this;
    openScreen(this.ctx, archive, { background: BACKGROUND_ENTRY });
    this.defineGroups();
    // `74b8` : avant-plan 11500 (niveau 0), 11501 (niveaux 1 et 2), 11502 (niveau 3).
    f.create({ script: SCRB.foreground + (this.level >= 2 ? this.level - 1 : this.level === 0 ? 0 : 1), delay: DELAY.play, flags: FLAG_PLAY, depth: 1 });
    if (this.level === 2) {
      // `1896` : un dessin de barrière sur chaque ligne bloquée du plan (points de `REGS 11000` / `11001`, d'après le numéro de la chambre).
      const x = regs(this.archive, 11000);
      const y = regs(this.archive, 11001);
      for (const room of blockedRooms(this.state)) {
        const art = blockedArt(this.state, room)!;
        f.create({ script: SCRB.barrierPlan + art, delay: 0, flags: FLAG_BARRIER, depth: 1.5, position: { x: x[room + 1]!, y: y[room + 1]! } });
      }
    }
    this.sceneObject(INTRO_SCRIPT + this.variant, FLAG_SCENE, (n) => {
      if (n === FEATURE_END) this.relaunch();
    });
    // `74ba` : bande du bas de l'entrée.
    f.create({ script: SCRB.strip, delay: DELAY.play, flags: F.stopAtEnd, depth: 3 });
  }

  /** Crée la scénette `script` (objet `DS:74aa`) ; `onEnd` reçoit `FEATURE_END`. */
  private sceneObject(script: number, flags: number, onEnd?: (n: number) => void, depth: number = DEPTH.scene): Feature {
    this.dropScene();
    this.lastScene = script;
    const feature = this.features.create({ script, delay: DELAY.play, flags, depth });
    feature.notifyEnd = true;
    if (onEnd) feature.onEvent = (_image, n) => onEnd(n);
    this.scene = feature;
    return feature;
  }

  /** `10e8:3dd4` : retire la scénette en cours. */
  private dropScene(): void {
    if (this.scene) this.features.destroy(this.scene);
    this.scene = undefined;
  }

  /** Relance (`10e8:07ca`, branche `74e2`) : fond de l'hôtel, groupe, chambres, puis explication ou cadran. */
  private relaunch(): void {
    if (this.ended) return;
    const { ctx, archive, level } = this;
    const f = this.features;
    this.scene = undefined;
    f.clear();
    openScreen(ctx, archive, { background: BACKGROUND_HOTEL[level] });
    this.defineGroups();
    const l3 = level === 3;
    const slots = l3 ? 125 : level === 0 ? 5 : 25;

    // Groupe (`1168:0858`) : debout sur les seize places du hall (pas d'entrée à pied : l'original n'appelle pas `1168:2505`).
    const images = sheetButtonImages(archive.tbmpImages(BUTTONS_SHEET));
    const roomTargets: DropTarget[] = [];
    for (let room = 0; room < slots; room++) {
      roomTargets.push(createTarget(this.point(room), room));
    }
    this.roomTargets.push(...roomTargets);
    this.kit = createPuzzleKit(ctx, {
      screen: SCREEN,
      party: this.party,
      places: HALL_PLACES,
      targets: (places) => [...roomTargets, ...places],
      radius: RADIUS[level],
      snoid: { small: true, scripts: screenScripts(archive) },
      depthOf: (p) => 1 + p.y / 1000,
      introVoice: HELP_VOICE,
      buttons: { map: { images: images.map }, go: { images: images.go }, depth: DEPTH.buttons },
      exitWalk: { x: 680, y: 316 },
      canPick: (member) => this.canPick(member),
      decide: (drop) => this.decide(drop),
      onDrop: (drop) => this.dropped(drop),
    });
    this.kit.arrive({ startDelay: 0, step: 45, standing: true });
    // `1168:3dd0(0, 0)` : personne n'est encore rangé.
    this.kit.markAll(false);
    this.buildRooms();
    this.later.length = 0;
    // `10e8:0b09` : scénette d'explication, sinon le cadran démarre.
    const explain = explanationScript(level, this.variant);
    if (explain !== null && !this.skipped) {
      this.phase = "explain";
      this.kit.suspend();
      this.explainAt = this.variant === 4 ? ctx.clock.ticks + EXPLAIN_WAIT : ctx.clock.ticks;
    } else {
      this.startPlay(!this.skipped);
    }
    ctx.requestPresent();
  }

  /** Objets des chambres dans l'ordre de `10e8:12f6`. */
  private buildRooms(): void {
    const { archive, features: f, level } = this;
    const l3 = level === 3;
    const rooms = l3 ? 125 : level === 0 ? 5 : 25;
    const regsOf = (id: number) => regs(archive, id);
    const roomAt = (slot: number): number => (level === 0 ? slot * 5 + 4 : slot);
    if (l3) {
      const [r0x, r0y, r2x, r2y] = [regsOf(9000), regsOf(9001), regsOf(9002), regsOf(9003)];
      for (let room = 0; room < rooms; room++) {
        const c = room % 5;
        const b = Math.floor(room / 5) + 1;
        this.doors[room] = f.create({
          script: SCRB.doorL3 + c,
          delay: DELAY.play,
          flags: F.relative | FLAG_DOOR,
          depth: DEPTH.door,
          position: { x: r0x[b]! + OFFSET_DOOR[c]!, y: r0y[b]! + OFFSET_DOOR[c]! },
        });
      }
      for (let room = 0; room < rooms; room++) {
        const art = blockedArt(this.state, room);
        if (art === null) continue;
        const c = room % 5;
        const b = Math.floor(room / 5) + 1;
        f.create({
          script: SCRB.barrierL3 + art,
          delay: 0,
          flags: FLAG_BARRIER,
          depth: DEPTH.barrier,
          position: { x: r0x[b]! + OFFSET_X5[c]!, y: r0y[b]! + OFFSET_Y5[c]! + (c === 0 ? 5 : c === 2 ? 2 : 0) },
        });
      }
      f.create({ script: 11505, delay: DELAY.play, flags: FLAG_WALL, depth: DEPTH.wall });
      for (let room = 0; room < rooms; room++) {
        const c = room % 5;
        const b = Math.floor(room / 5) + 1;
        this.shelves[room] = f.create({
          script: SCRB.shelfL3 + c,
          delay: DELAY.shelf,
          flags: F.relative | FLAG_SHELF,
          depth: DEPTH.shelf,
          position: { x: r2x[b]! + OFFSET_X5[c]!, y: r2y[b]! + OFFSET_Y5[c]! },
        });
      }
      for (let room = 0; room < rooms; room++) {
        f.create({ script: SCRB.baseL3 + room, delay: DELAY.play, flags: F.stopAtEnd | F.noReplay | F.active | F.firstImage, depth: DEPTH.base });
      }
      return;
    }
    for (let slot = 0; slot < rooms; slot++) {
      const room = roomAt(slot);
      this.doors[slot] = f.create({ script: SCRB.door + room, delay: DELAY.play, flags: FLAG_DOOR, depth: DEPTH.door });
    }
    if (level === 2) {
      const x = regs(archive, 11004);
      const y = regs(archive, 11005);
      for (const room of blockedRooms(this.state)) {
        const art = blockedArt(this.state, room)!;
        f.create({ script: SCRB.barrierRoom + art, delay: 0, flags: FLAG_BARRIER, depth: DEPTH.barrier, position: { x: x[room + 1]!, y: y[room + 1]! } });
      }
    }
    f.create({ script: SCRB.wallFirst + (level === 0 ? 1 : 0), delay: DELAY.play, flags: FLAG_WALL, depth: DEPTH.wall });
    for (let slot = 0; slot < rooms; slot++) {
      this.shelves[slot] = f.create({ script: SCRB.shelf + roomAt(slot), delay: DELAY.shelf, flags: FLAG_SHELF, depth: DEPTH.shelf });
    }
    for (let slot = 0; slot < rooms; slot++) {
      f.create({ script: SCRB.base + roomAt(slot), delay: DELAY.base, flags: FLAG_BASE, depth: DEPTH.base });
    }
  }

  /** Début de la partie : cadran et musique (`10e8:0c50`, `0b44`). `ceremony` : le cadran descend et marque ses `F` crans ; sinon il apparaît au cran `F`. */
  private startPlay(ceremony: boolean): void {
    this.phase = "play";
    this.kit?.resume();
    this.dropScene();
    this.kit?.playMusic();
    if (this.level === 3) return;
    const base = FREE_STEPS[this.level]!;
    this.clock = this.features.create({ script: SCRB.clock + (ceremony ? 0 : base), delay: DELAY.play, flags: FLAG_PLAY, depth: DEPTH.clock });
    this.clock.notifyEnd = true;
    if (ceremony) {
      this.clockIntro = 1;
      this.clock.onEvent = (_i, n) => n === FEATURE_END && this.nextIntroStep();
    }
  }

  /** `10e8:0e88` : les crans `6001` à `6000 + F` se jouent l'un après l'autre. */
  private nextIntroStep(): void {
    const base = FREE_STEPS[this.level]!;
    if (this.clockIntro === 0 || this.clockIntro > base || !this.clock) {
      this.clockIntro = 0;
      return;
    }
    const step = this.clockIntro++;
    this.clock.notifyEnd = true;
    this.clock.onEvent = (_i, n) => n === FEATURE_END && this.nextIntroStep();
    this.features.setScript(this.clock, SCRB.clock + step);
  }

  /** Un clic abandonne la scénette en cours (`10e8:1cea`, `DS:7504`). */
  private abandon(): void {
    if (this.phase === "intro") {
      this.skipped = true;
      this.relaunch();
    } else if (this.phase === "explain") {
      this.skipped = true;
      this.startPlay(false);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Prise et dépôt (`10e8:1cea`)

  private roomOf(target: DropTarget | null | undefined): number | undefined {
    return typeof target?.tag === "number" ? target.tag : undefined;
  }

  /** `10e8:1cea` région 3 : ni scénette, ni animation, ni défaite, ni Zoombini en marche ; un Zoombini déjà rangé n'est pas repris (écart). */
  private canPick(member: KitMember): boolean {
    if (this.phase !== "play" || this.busy || this.state.lost) return false;
    return this.state.placed[member.index] === null;
  }

  private decide(drop: DropInfo): boolean {
    const room = this.roomOf(drop.target);
    if (room === undefined) return true;
    return this.state.piles[room]! >= 0 && !this.state.lost && !this.busy;
  }

  private dropped(drop: DropInfo): void {
    const room = this.roomOf(drop.target);
    if (room === undefined || !drop.target) return;
    // La chambre n'est jamais « occupée » : elle reçoit autant de Zoombinis qu'il en faut.
    drop.target.owner = null;
    drop.member.target = null;
    const result = place(this.state, drop.member.index, room);
    const member = drop.member;
    if (result.kind === "accepted") this.accepted(member, room, result);
    else if (result.kind === "refused") this.refused(member, room, result.step, result.lost);
  }

  private depthAt(y: number): number {
    return 1 + y / 1000;
  }

  /** Acceptation (`10e8:1cea` puis Tick `0f6e` : `3620`, `74a6 = 1`, porte, voix de félicitation). */
  private accepted(member: KitMember, room: number, result: Extract<ReturnType<typeof place>, { kind: "accepted" }>): void {
    const { kit, level, features: f } = this;
    const snoid = member.snoid;
    const table = tablePoint(level, room);
    const point = this.point(room);
    const final = stackPosition(level, table, point, result.pile);
    member.zoombini.present = true;
    kit!.goEnabled = true;
    if (result.completed) this.ctx.services.get(ZOOMBINIS_SOUND).queue(drawCompletionVoice(this.ctx.rng));
    this.acting += 1;
    f.restack(snoid.feature, DEPTH.acting);
    const feet = snoid.traits.feet;
    const script = acceptScript(level, table, room, feet);
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      snoid.setPosition(final);
      snoid.idle();
      f.restack(snoid.feature, this.depthAt(final.y));
      this.acting -= 1;
      if (result.completed) this.afterCompletion();
    };
    snoid.play(script, F.stopAtEnd, { kind: "normal", at: level === 3 ? { x: point.x + 5, y: point.y - 15 } : undefined });
    // La porte s'ouvre pour le premier de la chambre.
    if (result.opensDoor) {
      const door = this.doors[level === 0 ? (room as number) : room];
      if (door) {
        door.notifyEnd = false;
        f.setScript(door, level === 3 ? SCRB.doorL3 + (room % 5) : SCRB.door + table);
      }
    }
  }

  /** Tous rangés (`10e8:07ca`, branche `74e8`) : étagères repliées puis scénette de victoire (niveaux 0 à 2). */
  private afterCompletion(): void {
    if (this.level === 3) return;
    this.foldShelves();
    this.sceneObject(drawVictoryScript(this.ctx.rng), FLAG_SCENE, (n) => n === FEATURE_END && this.dropScene());
  }

  /** `10e8:3ace` : chaque étagère rejoue en repli (`SCRB 6063 + r`, délai 1). */
  private foldShelves(): void {
    if (this.level === 3) return;
    this.shelves.forEach((shelf, slot) => {
      if (!shelf) return;
      shelf.delay = DELAY.fold;
      shelf.notifyEnd = false;
      this.features.setScript(shelf, SCRB.shelfFold + (this.level === 0 ? slot * 5 + 4 : slot));
    });
  }

  /** Refus (`10e8:07ca` branche `7570`, `330e`, `3288`, `32cb`, `2698`). */
  private refused(member: KitMember, room: number, step: number, lost: boolean): void {
    const { level, features: f, ctx } = this;
    const snoid = member.snoid;
    const table = tablePoint(level, room);
    this.acting += 1;
    f.restack(snoid.feature, DEPTH.acting);
    // L'étagère de la chambre bascule (au douzième refus : toutes se replient, `3ace`).
    const shelf = this.shelves[room];
    if (lost && level < 3) this.foldShelves();
    else if (shelf) {
      shelf.delay = DELAY.shelf;
      shelf.notifyEnd = false;
      f.setScript(shelf, level === 3 ? SCRB.shelfL3 + (room % 5) : SCRB.shelf + table);
    }
    // Le Zoombini rebondit (`SCRS 13000 + r`, délai 3) puis tombe au sol (`14000 + r`) : événement de fin, `10e8:349f`.
    const bounce = level === 3 ? SCRS.refusalL3 + (room % 5) : SCRS.refusal + table;
    const fall = level === 3 ? SCRS.fallL3 + (room % 25) : SCRS.fall + table;
    const land = this.landing(room);
    snoid.delay = DELAY.refusal;
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        snoid.delay = 6;
        snoid.setPosition(land);
        snoid.idle();
        f.restack(snoid.feature, this.depthAt(land.y));
        this.scatter(member, land);
        this.acting -= 1;
      };
      snoid.play(fall, F.stopAtEnd, { kind: "reject", at: land });
    };
    snoid.play(bounce, F.stopAtEnd, { kind: "normal" });
    // Cran suivant de l'horloge (niveaux 0 à 2), puis la lumière baisse.
    if (level < 3) this.playClock(step);
    dimPalette(ctx.services.get(GRAPHICS).palette.colors, DIM_PERCENT[level]!);
    this.dims += 1;
    ctx.requestPresent();
    if (step === WARNING_STEP) this.sceneObject(drawWarningScript(ctx.rng), FLAG_SCENE, (n) => n === FEATURE_END && this.dropScene());
    if (lost) this.defeat();
  }

  /** `SCRB 6000 + cran` sur le cadran (`11a8:1b89`), en attendant la fin (`DS:74e0`). */
  private playClock(step: number): void {
    const clock = this.clock;
    if (!clock) return;
    this.clockIntro = 0;
    this.clockBusy = true;
    clock.notifyEnd = true;
    clock.onEvent = (_i, n) => {
      if (n !== FEATURE_END) return;
      this.clockBusy = false;
      if (this.state.lost && this.level < 3 && !this.ended) {
        this.sceneObject(drawDefeatScript(this.ctx.rng), FLAG_SCENE, (m) => m === FEATURE_END && this.dropScene());
      }
    };
    this.features.setScript(clock, SCRB.clock + step);
  }

  /** Douzième refus (`10e8:116b`) : voix 6006, attente de 60 ticks, puis (niveau 3) le son 7500 après un tirage inutile. */
  private defeat(): void {
    const sound = this.ctx.services.get(ZOOMBINIS_SOUND);
    sound.queue(DEFEAT_VOICE);
    if (this.level === 3) {
      this.later.push({
        at: this.ctx.clock.ticks + DEFEAT_WAIT_TICKS,
        run: () => {
          this.ctx.rng.range(0, 3);
          sound.queue(DEFEAT_VOICE_L3);
        },
      });
    }
  }

  /** `10e8:3bae` : les Zoombinis debout près de l'atterrissage s'écartent vers le sol (`y = 440`), à gauche ou à droite. */
  private scatter(landed: KitMember, land: Point): void {
    const kit = this.kit;
    if (!kit) return;
    const rng = this.ctx.rng;
    for (const other of kit.members) {
      if (other === landed || other.walking || other.snoid.destroyed) continue;
      const at = other.snoid.position;
      if (at.y < SCATTER.yMin || at.y >= SCATTER.yMax + 1 || at.x < land.x - SCATTER.dx || at.x > land.x + SCATTER.dx) continue;
      let x: number;
      if (rng.range(0, 1) === 0) {
        x = land.x - 50 - rng.range(0, 3) * SCATTER.step;
        if (x < SCATTER.min) x = rng.range(0, 3) * SCATTER.step + land.x + 50;
      } else {
        x = rng.range(0, 3) * SCATTER.step + land.x + 50;
        if (x > SCATTER.max) x = land.x - 50 - rng.range(0, 3) * SCATTER.step;
      }
      kit.walk(other, { x, y: SCATTER.floor }, () => this.features.restack(other.snoid.feature, this.depthAt(SCATTER.floor)), { counted: false });
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick

  tick(): void {
    const now = this.ctx.clock.ticks;
    if (this.ctx.services.tryGet(DIALOG)?.isOpen) {
      this.kit?.tick();
      return;
    }
    if (!this.kit) {
      // Scénette d'entrée : un clic l'abandonne.
      for (const event of this.ctx.input.buttonEvents) if (event.down && event.button === "left") this.abandon();
      return;
    }
    if (this.phase === "explain") {
      for (const event of this.ctx.input.buttonEvents) {
        if (event.down && event.button === "left") {
          this.abandon();
          break;
        }
      }
      if (this.phase === "explain" && this.explainAt >= 0 && now >= this.explainAt) {
        this.explainAt = -1;
        const script = explanationScript(this.level, this.variant)!;
        this.sceneObject(script, FLAG_EXPLAIN, (n) => {
          if (n === FEATURE_END && this.phase === "explain") this.startPlay(true);
        });
        this.features.setScript(this.scene!, script);
      }
    }
    this.kit.tick();
    for (const entry of [...this.later]) {
      if (entry.at <= now) {
        this.later.splice(this.later.indexOf(entry), 1);
        entry.run();
      }
    }
  }

  leave(): void {
    this.ended = true;
    this.kit?.leave();
  }
}

/** Écran de l'hôtel du temps-compté (`HOTEL.MHK`, écran 14). */
export function createHotelScene(): HotelScene {
  const name = screenInfo(SCREEN)?.archive;
  if (!name) throw new Error("createHotelScene : pas d'archive pour l'écran 14");
  let archive: Archive;
  let run: HotelRun | null = null;
  return {
    get probe() {
      return run;
    },
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(name);
    },
    enter(ctx: SceneContext) {
      run = new HotelRun(ctx, archive);
    },
    leave(ctx: SceneContext) {
      run?.leave();
      run = null;
      closeScreen(ctx);
    },
    tick() {
      run?.tick();
    },
    key(event, ctx: SceneContext) {
      const kit = run?.kit;
      if (!kit || kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (ctx.services.tryGet(DIALOG)?.isOpen) return false;
      return kit.key(event);
    },
  };
}

