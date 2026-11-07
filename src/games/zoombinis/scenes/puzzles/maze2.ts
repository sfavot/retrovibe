/**
 * Le gouffre des véhibules (`MAZE2.MHK`, écran 18, tâche H9 ; `docs/zoombinis/puzzles/maze2.md`, `docs/zoombinis/engine-ts.md`, « Véhibules (tâche H9) »).
 * Épreuve sur le kit commun (`puzzle-kit.ts`) : le kit porte l'arrivée du groupe, le glisser-déposer, les boutons carte et « go », l'enregistrement, l'aide F1 et la
 * musique ; cet écran porte les règles (`game/puzzles/maze2.ts`, simulation image par image) et la mise en scène.
 *
 * ## Déroulé (original : Enter `1118:0000`, Tick `1118:1503`, clic `1118:2285`, rampes `1118:29cc`, cases `1100:xxxx`)
 *
 *  1. **Entrée** : fond et palette 5000, groupes de formes 7000 (marques des rampes), 8000 (calques de falaise), 9000 (rampes), 10000 (bulles, éclaboussures, tourbillon) et
 *     leurs `SCRB` ; carte du niveau, traits des panneaux et jeux de sprites des cases tirés (`setupMaze2`) ; cases dessinées d'après `tBMP 5100` ; marques et rampes des
 *     rampes actives ; l'équipe (16 au plus) sur les places de la falaise 0 (`S14:042c`, arrivée échelonnée 30 puis 45 ticks) ; personne de « sauvé » ; jingle 997, musique
 *     `30035 + niveau`.
 *  2. **Lancer** : un Zoombini glissé sur une rampe libre de **sa** falaise y est posé, puis la rampe joue son script (`SCRB` 9000, 9001 ou 9003 : plaque `7014 + z − 1`, pose
 *     assise `SCRS 15000…`, canon `SCRS 14000…`, bulle au bout de 30 images) pendant que la simulation (`launchMaze2`) le fait entrer dans la grille. Le temps de la
 *     simulation est celui des images d'animation : **une image = 6 ticks** (délai des features et des `SCRS`, **probable** pour l'original) ; un pas de case dure 6 images.
 *  3. **Vol** : la simulation décide de tout (panneaux, aiguillages, boutons, cases d'attente, tourbillons, collisions, falaises) ; l'écran n'en montre que les segments :
 *     un script de pas par case (`SCRS 15015 + 5 × direction + pieds − 1`, bulle `SCRB 10000 + direction`), le bond de lancement (`SCRS 15080` / `15085 + pieds`, bulle `10042` /
 *     `10043`), l'attente en boucle (`SCRS 15055 + 5 × direction + pieds`), le tourbillon (`SCRB 10031`, `SCRS 14006`), la collision (pose `SCRS 15035 + 5 × direction +
 *     pieds − 1`, éclaboussure `SCRB 10012…`, `SCRS 14004`), l'atterrissage (`SCRS 15075 + pieds`, gerbe `SCRB 10040`, `SCRS 14007`).
 *  4. **Retour** : un Zoombini rejeté ou arrivé sur une falaise marche jusqu'à la place suivante de la file de **sa** falaise (`S14:042c + 0x50 × falaise + 4 × rang`, 20 places,
 *     compteur qui boucle ; 16 réservées sur la falaise 0). Il peut être relancé s'il y a une rampe active sur sa falaise (relais des falaises 1 et 2 au niveau 3).
 *  5. **Fin** : « go » actif dès qu'un Zoombini a atteint la falaise 3 (`+0x127`) ; il joue 996 puis mène à Zoombiniville. Les Zoombinis hors de la falaise 3 sont perdus.
 *     Quand tous sont sur la falaise 3 : voix de réussite puis danse d'un Zoombini toutes les 30 ticks.
 *  6. **Danse d'arrivée** : l'événement de `SCRS 14007` (image 5, dernière) met le Zoombini arrivé sur la falaise 3 en file `[8956]` ; le Tick (étape 6) lui joue aussitôt
 *     `SCRS 15090 + pieds` (12 à 18 images, voix aux événements `212`), qui remplace la fin de `14007`. C'est le rappel de fin de **cette** danse (`+0x2f`) qui le met en file
 *     `[8950]` : il danse en entier, sur sa case d'arrivée, puis marche vers sa place (la voix de réussite totale est donc dite à ce moment). Sur les falaises 1 et 2 le même
 *     événement met directement le Zoombini en file `[8950]` : la marche de retour remplace la dernière image de `14007`.
 *
 * ## Écarts avec l'original (voir aussi `docs/zoombinis/puzzles/maze2.md`)
 *
 *  - temps : la simulation avance toutes les 6 ticks et seulement quand quelque chose bouge ; un lancer est pris à l'image suivante (au plus 5 ticks après le dépôt) ;
 *  - le glisser-déposer n'est pas limité au rectangle de la falaise du Zoombini (le kit a une seule zone de transport) : un dépôt sur une rampe d'une autre falaise est refusé
 *    (retour sur sa place) ; il n'y a donc pas de différence de résultat, seulement de geste ;
 *  - la bulle est une feature `relative` posée par rapport aux pieds du Zoombini (décalage **probable**, calé sur les dimensions des images) ; sa position exacte dans l'original
 *    dépend de `1100:0b69` / `11a8:1f5c` (rattachement non porté) ;
 *  - calques de falaise (`SCRB 8000` à `8013`) : tous posés devant les objets en vol, derrière les Zoombinis posés ; l'ordre dynamique `[894a]` / `[895a]` / `[895c]` n'est pas porté ;
 *  - la rampe joue son script entier ; le Zoombini passe devant le canon (pas de réordonnancement des calques de la rampe) ;
 *  - les Zoombinis qui reviennent marchent en ligne droite (pas de terrain `tBMP 100` : dans les épreuves l'original ne s'en sert qu'au dépôt) ;
 *  - la case d'attente est animée en boucle (`base + 9…14`) ; le bouton enfoncé joue `base + 15…18` ; **probable** ;
 *  - grille `tBMP 12000` et `SCRB 12000` à `12002` : aide de mise au point (jamais créée par le code), non dessinée ; `SCRS 14003` et `14005` : jamais jouées (aucun appelant) ;
 *  - voix `20036` attendue avant de quitter (`1118:1503`) : lue comme l'attente du son 996 du bouton « go » (**probable**), c'est la fin de `pressGo` du kit.
 */
import { drawShape } from "../../../../engine/mohawk/graphics/blit";
import type { Surface } from "../../../../engine/mohawk/graphics/surface";
import type { Archive } from "../../../../engine/mohawk/resources";
import type { Shape } from "../../../../data/mohawk/shap";
import { screenInfo } from "../../data/archives";
import type { Point } from "../../data/zoombini";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type Features } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { regs, scrs } from "../../engine/resources";
import type { Scene, SceneContext } from "../../engine/scene";
import { ZOOMBINIS_SOUND } from "../../engine/sound";
import { currentLevel } from "../../game/route";
import {
  MAZE2_GOAL_CLIFF,
  MAZE2_MAX_FLIGHTS,
  MAZE2_RAMPS,
  MAZE2_SIZE,
  Maze2Kind,
  advanceMaze2,
  cloneMaze2,
  launchMaze2,
  maze2CellPosition,
  maze2Idle,
  maze2Outcome,
  maze2ZoombiniPosition,
  newMaze2Rotation,
  readMaze2Maps,
  setupMaze2,
  type Maze2Cell,
  type Maze2Flight,
  type Maze2Ramp,
  type Maze2Rotation,
  type Maze2World,
} from "../../game/puzzles/maze2";
import type { Session, Zoombini } from "../../game/state";
import { createPuzzleKit, createTarget, sheetButtonImages, type DropInfo, type DropTarget, type KitMember, type PuzzleKit } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";

const SCREEN = 18;

/** Fond et palette 5000 ; planches : cases 5100, boutons 6000 ; groupes de formes 7000 (marques), 8000 (calques), 9000 (rampes), 10000 (bulles). */
const BACKGROUND = 5000;
const CELL_SHEET = 5100;
const CELL_ANCHORS = 18000;
const BUTTONS_SHEET = 6000;
const GROUP_MARKS = 7000;
const GROUP_LAYERS = 8000;
const GROUP_RAMPS = 9000;
const GROUP_BUBBLES = 10000;
/** Voix d'introduction (`[a2c4] = 20068`), rejouée par F1. */
const HELP_VOICE = 20068;
/** Une image d'animation = 6 ticks (délai des features et des `SCRS`). */
export const IMAGE_TICKS = 6;
/** Danse finale : un Zoombini toutes les 30 ticks (`1118:1503`, étape 11). */
const DANCE_GAP = 30;

/** Places d'attente de chacune des 4 falaises (`S14:042c + 0x50 × falaise + 4 × rang`, paires `(x, y)`, 20 places) ; relues dans l'exécutable. */
export const CLIFF_PLACES: readonly (readonly Point[])[] = [
  [[287, 394], [260, 426], [224, 447], [188, 441], [157, 455], [263, 384], [219, 397], [184, 388], [155, 402], [121, 417], [226, 354], [189, 349], [156, 354], [131, 375], [85, 394], [164, 311], [125, 324], [79, 352], [29, 318], [15, 285]],
  [[4, 86], [29, 70], [50, 68], [70, 68], [94, 63], [7, 102], [30, 86], [55, 79], [72, 79], [8, 116], [33, 100], [56, 93], [73, 93], [9, 131], [34, 115], [99, 108], [74, 108], [57, 108], [97, 79], [98, 93]],
  [[633, 311], [613, 311], [590, 336], [571, 340], [551, 345], [632, 297], [612, 297], [589, 321], [570, 325], [550, 330], [629, 281], [609, 281], [588, 307], [569, 311], [549, 316], [589, 291], [566, 296], [546, 300], [634, 336], [614, 336]],
  [[621, 18], [624, 40], [624, 64], [625, 84], [594, 20], [598, 40], [593, 60], [594, 75], [594, 90], [556, 32], [560, 50], [555, 72], [563, 94], [511, 42], [515, 60], [521, 80], [529, 100], [476, 67], [484, 89], [594, 104]],
].map((places) => places.map(([x, y]) => ({ x: x!, y: y! })));
/** `DS:8920 = 0x10` : les 16 premières places de la falaise 0 sont celles de l'équipe, la file des arrivées commence à la 17e. */
const QUEUE_START = [16, 0, 0, 0] as const;
const QUEUE_SIZE = 20;

/** Profondeurs : cases, marques, plaques, machines à bulles, calques de falaise, rampes, objets en vol (Zoombini puis bulle), effets, caches de rampe ; les Zoombinis posés sont à `1 + y / 1000`. */
const DEPTH = { cells: 0.1, marks: 0.12, plates: 0.13, machines: 0.2, layers: 0.3, ramps: 0.5, flight: 0.6, bubble: 0.61, effects: 0.62, fronts: 0.7 } as const;

/** Décalage du coin haut-gauche de la bulle (première image des scripts `SCRB 10000…`) par rapport aux pieds du Zoombini (calé sur les images de 52 × 67) ; **probable**. */
const BUBBLE_OFFSET = { x: -26, y: -52 } as const;
/** Tourbillon `SCRB 10031` : coin haut-gauche (image de 52 × 55) par rapport au centre de la case ; **probable**. */
const WHIRL_OFFSET = { x: -26, y: -27 } as const;

/** `SCRS` : poses de rampe `14999 + 5 × classe + pieds`, canon `14000 + classe`, bond `15080` / `15085 + pieds`, pas `15015`, collision `15035`, attente `15055`, danse `15090 + pieds`. */
const SCRS = {
  pose: 14999,
  canon: 14000,
  hop: { 1: 15080, 3: 15085 } as Readonly<Record<number, number>>,
  step: 15015,
  clash: 15035,
  wait: 15055,
  land: 15075,
  dance: 15090,
  clashReject: 14004,
  whirlReject: 14006,
  landReject: 14007,
} as const;
/** `SCRB` : marque `7000 + z − 1`, plaque `7014 + z − 1`, bulle `10000 + direction` (pas) / `10042`, `10043` (bond), éclaboussures `10012 + 3 × famille + zone`, tourbillon, gerbe. */
const SCRB = { mark: 7000, plate: 7014, machine: 9005, bubble: 10000, bubbleHop: { 1: 10042, 3: 10043 } as Readonly<Record<number, number>>, splash: 10012, whirl: 10031, spray: 10040 } as const;
/** Sons : rotation d'un aiguillage (alternés, `[1782]`), bouton. */
const SOUND = { switchA: 5101, switchB: 5102, button: 5103 } as const;
/** Images d'une case dans `tBMP 5100` (`1100:2679`) : tourbillon 2 à 5 ; pétales `base + 1…4`, indicateur `base + 5 + g`, attente `base + 9…14`, bouton enfoncé `base + 15…18`, bouton `base + 19`. */
const WHIRL_IMAGE = 2;
const WHIRL_FRAMES = 4;
const WAIT_FRAMES = 6;
const PRESS_FRAMES = 4;

/** Vue d'un Zoombini lancé : son dernier segment, la bulle et les effets qui l'accompagnent. */
interface FlightView {
  id: number;
  member: KitMember;
  key: string;
  /** Case visée du segment précédent (effet d'un bouton à l'entrée). */
  lastTarget: { row: number; col: number } | null;
  bubble: Feature | null;
  effects: Feature[];
  /** Où le Zoombini se trouve à l'écran (pour le retour à pied). */
  at: Point;
}

/** Une rampe : cible de dépôt, objet de rampe, cache et plaque. */
interface RampView {
  ramp: Maze2Ramp;
  target: DropTarget;
  object: Feature;
  /** Cache qui passe devant le Zoombini dans le canon (`SCRB` de la rampe + 1, rampes 4 à 9, 13 et 14). */
  front: Feature | null;
  /** Plaque (`SCRB 7014 + z − 1`) : s'allume quand un Zoombini porté survole la rampe. */
  plate: Feature;
}

/** Un lancer demandé (dépôt accepté) puis en cours : la simulation le prend à la prochaine image. */
interface Launch {
  member: KitMember;
  ramp: Maze2Ramp;
  /** Image de la simulation du lancer (`null` tant qu'il est en attente). */
  t0: number | null;
}

/** Action différée à une image de la simulation. */
interface Scheduled {
  at: number;
  run: () => void;
}

/** Fenêtre sur l'épreuve en cours, pour les tests. */
export interface Maze2Probe {
  readonly kit: PuzzleKit;
  readonly world: Maze2World;
  /** Cibles de dépôt (rampes actives). */
  readonly ramps: readonly DropTarget[];
  /** Lancers demandés ou en cours (rampe occupée) et dernier numéro d'image simulée. */
  readonly launches: number;
  readonly images: number;
  /** Positions écran des 169 cases (`REGS 16000`). */
  readonly positions: Int16Array;
  /** Images de `tBMP 5100` dessinées pour la case `i` de la carte (ordre des enregistrements). */
  cellImages(i: number): number[];
  /** Lance le Zoombini `index` depuis la rampe `ramp` sans geste (même chemin qu'un dépôt accepté) ; faux si le dépôt serait refusé. */
  launch(index: number, ramp: number): boolean;
  /** Place suivante de la file d'une falaise (sans la consommer). */
  nextPlace(cliff: number): Point;
  readonly dancing: boolean;
  /** Zoombinis qui dansent leur arrivée sur la falaise 3, avant de rejoindre leur place. */
  readonly landDances: number;
  /** Copie du monde (pour un robot ou un contrôle). */
  snapshot(): Maze2World;
}

export type Maze2Scene = Scene & { readonly probe: Maze2Probe | null };

/** Compteurs d'alternance des cartes (`DS:177a…1780`) : persistent entre deux visites de la session. */
const ROTATIONS = new WeakMap<Session, Maze2Rotation>();

function rotationOf(session: Session): Maze2Rotation {
  let rotation = ROTATIONS.get(session);
  if (!rotation) {
    rotation = newMaze2Rotation();
    ROTATIONS.set(session, rotation);
  }
  return rotation;
}

class Maze2Run implements Maze2Probe {
  readonly kit: PuzzleKit;
  readonly world: Maze2World;
  readonly positions: Int16Array;

  private readonly features: Features;
  private readonly party: Zoombini[];
  private readonly rampViews: RampView[] = [];
  /** Machines à bulles des falaises 0 à 2 (`SCRB 9005 + falaise`). */
  private readonly machines: (Feature | undefined)[] = [];
  private readonly rampTargets: DropTarget[] = [];
  private readonly views = new Map<number, FlightView>();
  private readonly pending: Launch[] = [];
  private readonly running: Launch[] = [];
  private readonly scheduled: Scheduled[] = [];
  private readonly shapes: readonly Shape[];
  private readonly anchorX: Int16Array;
  private readonly anchorY: Int16Array;
  /** Compteurs d'animation des cases (tourbillon, attente, bouton enfoncé), échéances (ticks) et direction affichée. */
  private readonly frames: number[];
  private readonly due: number[];
  private readonly shownDir: number[];
  private readonly pressed: number[];
  private readonly queue: number[] = [...QUEUE_START];
  private phase = 0;
  /** Nombre d'images simulées (pour les tests). */
  private imageCount = 0;
  private switchSounds = 0;
  private dancingNow = false;
  /** Zoombinis en train de danser leur arrivée sur la falaise 3 (`[8956]`, étape 6 du Tick). */
  private landDancers = 0;
  private danced = 0;
  private lastDance = 0;
  private readonly dancers: number[] = [];
  private voiced = false;
  private finished = false;

  constructor(
    private readonly ctx: SceneContext,
    private readonly archive: Archive,
  ) {
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    const { game, session } = zoombinis;
    session.screen = SCREEN;
    const level = currentLevel(game, session, SCREEN);
    openScreen(ctx, archive, { background: BACKGROUND });
    this.features = ctx.services.get(FEATURES);
    this.party = game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
    if (this.party.length < 1 || this.party.length > QUEUE_START[0]) throw new RangeError(`gouffre des véhibules : ${this.party.length} Zoombinis`);

    // Carte, traits des panneaux, jeux de sprites et délais : `1118:4a3e` / `1118:4ad2` / `1118:4cf0`.
    const maps = readMaze2Maps((id) => regs(archive, id));
    this.world = setupMaze2(ctx.rng, maps, this.party.map((z) => z.attrs), level, rotationOf(session));
    this.positions = regs(archive, 16000);
    this.shapes = archive.tbmpImages(CELL_SHEET);
    this.anchorX = regs(archive, CELL_ANCHORS);
    this.anchorY = regs(archive, CELL_ANCHORS + 1);
    const cells = this.world.cells;
    this.frames = cells.map(() => 0);
    this.due = cells.map((cell) => ctx.clock.ticks + cell.delay);
    this.shownDir = cells.map((cell) => cell.dir);
    this.pressed = cells.map(() => -1);

    // Décor, dans l'ordre de création de `1118:0000` : groupes 0 à 3 (7000, 8000, 9000, 10000) et leurs plages de `SCRB`.
    const f = this.features;
    f.defineGroup(0, GROUP_MARKS);
    f.defineGroup(1, GROUP_LAYERS);
    f.defineGroup(2, GROUP_RAMPS);
    f.defineGroup(3, GROUP_BUBBLES);
    f.setScripts(GROUP_MARKS, 28);
    f.addScripts(GROUP_LAYERS, 14);
    f.addScripts(GROUP_RAMPS, 8);
    f.addScripts(GROUP_BUBBLES, 44);
    const F = FeatureFlag;
    const still = F.flag4000000 | F.staticFirst | F.noReplay | F.active | F.firstImage;
    f.create({ script: 0, delay: 0, depth: DEPTH.cells, flags: 0, onAfterDraw: (_feature, screen) => this.drawCells(screen) });
    const active = new Set(this.world.ramps);
    // Machines à bulles des falaises (`SCRB 9005 + falaise`, première image) : la falaise 0 toujours, les falaises 1 et 2 si elles ont une rampe active (`1118:0000`).
    for (let cliff = 0; cliff < 3; cliff++) {
      if (cliff > 0 && !this.world.ramps.some((number) => MAZE2_RAMPS[number - 1]!.cliff === cliff)) continue;
      this.machines[cliff] = f.create({ script: SCRB.machine + cliff, delay: IMAGE_TICKS, depth: DEPTH.machines, flags: F.flag4000000 | F.stopAtEnd | F.noReplay | F.active | F.firstImage });
    }
    // Calques de falaise (`SCRB 8000…`) : toujours 8000, 8004 et 8011 ; ceux d'une falaise seulement avec ses rampes (8001 à 8003 : rampes 4 à 6, 8005 à 8007 : rampes 7 à 9,
    // 8010 sinon ; 8008 et 8009 : rampes 13 et 14). 8012 et 8013 ne sont créés par aucun code du module.
    const layers = [0, 4, 11];
    if ([4, 5, 6].some((n) => active.has(n))) layers.push(1);
    if (active.has(4)) layers.push(2);
    if (active.has(5)) layers.push(3);
    if ([7, 8, 9].some((n) => active.has(n))) layers.push(5);
    else layers.push(10);
    if (active.has(7)) layers.push(6);
    if (active.has(8)) layers.push(7);
    if ([13, 14].some((n) => active.has(n))) layers.push(8);
    if (active.has(13)) layers.push(9);
    for (const layer of layers.sort((x, y) => x - y)) f.create({ script: GROUP_LAYERS + layer, delay: 0, depth: DEPTH.layers, flags: still });
    // Marques, plaques (qui s'allument quand un Zoombini survole la rampe), rampes et caches des rampes actives (script de rampe et son cache `+ 1` à la position de la plaque).
    for (const number of this.world.ramps) {
      const ramp = MAZE2_RAMPS[number - 1]!;
      f.create({ script: SCRB.mark + number - 1, delay: IMAGE_TICKS, depth: DEPTH.marks, flags: still });
      const plate = f.create({ script: SCRB.plate + number - 1, delay: IMAGE_TICKS, depth: DEPTH.plates, flags: still });
      const object = f.create({ script: ramp.script, delay: IMAGE_TICKS, depth: DEPTH.ramps, position: ramp.plaque, flags: still | F.relative });
      const front = ramp.script === 9000 ? null : f.create({ script: ramp.script + 1, delay: IMAGE_TICKS, depth: DEPTH.fronts, position: ramp.plaque, flags: still | F.relative });
      const target = createTarget(ramp.drop, number);
      this.rampTargets.push(target);
      this.rampViews.push({ ramp, target, object, front, plate });
    }

    const buttons = sheetButtonImages(archive.tbmpImages(BUTTONS_SHEET));
    this.kit = createPuzzleKit(ctx, {
      screen: SCREEN,
      party: this.party,
      places: CLIFF_PLACES[0]!,
      targets: () => this.rampTargets,
      introVoice: HELP_VOICE,
      snoid: { scripts: screenScripts(archive) },
      buttons: { map: { images: buttons.map }, go: { images: buttons.go, onPress: () => this.pressGo() } },
      canPick: (member) => this.canPick(member),
      decide: (drop) => this.decide(drop),
      onHover: (target) => this.hovered(target),
      onDrop: (drop) => this.dropped(drop),
    });
    // `1168:0858` crée les Zoombinis, `1168:2505` les place, `1168:274e(30, 45)` échelonne l'arrivée, `1168:3dd0(0, 0)` : personne de sauvé.
    this.kit.arrive({ startDelay: 30, step: 45 });
    this.kit.markAll(false);
    this.kit.playEntryJingle();
    this.kit.playMusic();
    ctx.requestPresent();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Fenêtre pour les tests

  get ramps(): readonly DropTarget[] {
    return this.rampTargets;
  }

  get launches(): number {
    return this.pending.length + this.running.length;
  }

  get images(): number {
    return this.imageCount;
  }

  get landDances(): number {
    return this.landDancers;
  }

  get dancing(): boolean {
    return this.dancingNow;
  }

  cellImages(i: number): number[] {
    return this.imagesOf(this.world.cells[i]!, i);
  }

  nextPlace(cliff: number): Point {
    return CLIFF_PLACES[cliff]![this.queue[cliff]!]!;
  }

  snapshot(): Maze2World {
    return cloneMaze2(this.world);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Cases (`1100:2679`)

  /** Images de `tBMP 5100` d'une case selon son type, dans l'ordre de dessin. */
  private imagesOf(cell: Maze2Cell, i: number): number[] {
    const base = cell.spriteBase;
    switch (cell.kind) {
      case Maze2Kind.whirl:
        return [WHIRL_IMAGE + (this.frames[i]! % WHIRL_FRAMES)];
      case Maze2Kind.panel:
      case Maze2Kind.arrow:
      case Maze2Kind.switch: {
        const images = [base];
        cell.dirs.forEach((allowed, d) => {
          if (allowed !== 0) images.push(base + 1 + d);
        });
        images.push(base + 5 + cell.dir);
        // Le panneau affiche l'icône du trait qu'il teste (image `10 + 5 × attribut + valeur`) ; un panneau inerte (trait 0) n'en a pas.
        if (cell.panel && cell.panel.value !== 0) images.push(10 + 5 * cell.panel.attr + cell.panel.value);
        return images;
      }
      case Maze2Kind.wait:
        return [base + 9 + (this.frames[i]! % WAIT_FRAMES)];
      case Maze2Kind.button: {
        const images = [base + 19];
        if (this.pressed[i]! >= 0) images.push(base + 15 + this.pressed[i]!);
        return images;
      }
      default:
        return [];
    }
  }

  private drawCells(screen: Surface): void {
    this.world.cells.forEach((cell, i) => {
      const at = maze2CellPosition(this.positions, cell.row, cell.col);
      // Case hors du losange (la flèche parasite en (0, 0) de `16601`) : rien à dessiner.
      if (at.x === 0 && at.y === 0) return;
      for (const image of this.imagesOf(cell, i)) {
        const shape = this.shapes[image - 1];
        if (shape) drawShape(screen, shape, at.x - (this.anchorX[image] ?? 0), at.y - (this.anchorY[image] ?? 0), 8);
      }
    });
  }

  /** Animations des cases : tourbillon et case d'attente cyclent à leur délai propre (`rand(25, 20)`), le bouton enfoncé joue quatre images. */
  private tickCells(): void {
    const now = this.ctx.clock.ticks;
    let changed = false;
    this.world.cells.forEach((cell, i) => {
      if (now < this.due[i]!) return;
      const animated = cell.kind === Maze2Kind.whirl || cell.kind === Maze2Kind.wait || this.pressed[i]! >= 0;
      if (!animated) return;
      this.due[i] = now + cell.delay;
      if (this.pressed[i]! >= 0) this.pressed[i] = this.pressed[i]! + 1 >= PRESS_FRAMES ? -1 : this.pressed[i]! + 1;
      else this.frames[i] = this.frames[i]! + 1;
      changed = true;
    });
    if (changed) this.features.invalidate();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Prise et dépôt (`1118:2285`, région 3)

  private pendingOf(member: KitMember): boolean {
    return this.pending.some((l) => l.member === member);
  }

  /** Refus : liste en vol pleine (10), déjà en vol (jusqu'à 7 images après un atterrissage), en cours de lancer, placement initial en cours. */
  private canPick(member: KitMember): boolean {
    const w = this.world;
    const id = member.index + 1;
    if (this.kit.walking >= 1) return false;
    if (w.launched.length + this.pending.length >= MAZE2_MAX_FLIGHTS) return false;
    if (w.launched.includes(id) || w.flights.some((f) => f.id === id) || this.pendingOf(member)) return false;
    return true;
  }

  /** Dépôt sur une rampe libre de la falaise du Zoombini (le dépôt sur une rampe occupée est hors cible : `findTarget` ne prend que les cibles libres). */
  private decide(drop: DropInfo): boolean {
    const number = drop.target?.tag;
    if (typeof number !== "number") return false;
    const ramp = MAZE2_RAMPS[number - 1]!;
    const member = this.world.members[drop.member.index]!;
    return ramp.cliff === member.cliff;
  }

  /** Lancer : la rampe est occupée (cible), la simulation prend le Zoombini à la prochaine image. */
  private dropped(drop: DropInfo): void {
    this.enqueue(drop.member, MAZE2_RAMPS[(drop.target!.tag as number) - 1]!);
  }

  private enqueue(member: KitMember, ramp: Maze2Ramp): void {
    // Orientation du Zoombini posé sur la rampe (`+0xf2 = S14:00aa[z]`), devant le décor des rampes.
    member.snoid.setFacing(ramp.mirror === 1 ? 1 : 0);
    this.features.restack(member.snoid.feature, DEPTH.flight);
    this.pending.push({ member, ramp, t0: null });
  }

  /** Pour les tests : lance le Zoombini `index` depuis la rampe `number` comme un dépôt accepté (sans geste) ; faux si le dépôt aurait été refusé. */
  launch(index: number, number: number): boolean {
    const member = this.kit.members[index];
    const view = this.rampViews.find((r) => r.ramp.number === number);
    if (!member || !view || view.target.owner !== null || !this.canPick(member)) return false;
    if (view.ramp.cliff !== this.world.members[index]!.cliff) return false;
    this.kit.cancelWalk(member);
    view.target.owner = member;
    member.target = view.target;
    member.snoid.moveTo(view.ramp.drop);
    member.snoid.idle();
    this.enqueue(member, view.ramp);
    return true;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick

  tick(): void {
    this.kit.tick();
    if (this.finished || this.kit.finishing || this.kit.left) return;
    if (this.ctx.services.tryGet(DIALOG)?.isOpen) return;
    this.tickCells();
    this.tickDance();
    this.phase += 1;
    if (this.phase >= IMAGE_TICKS) {
      this.phase = 0;
      this.image();
    }
  }

  /** Une image d'animation : lancers en attente, simulation (seulement si quelque chose bouge), puis mise en scène. */
  private image(): void {
    const w = this.world;
    this.startPending();
    const busy = this.pending.length > 0 || this.running.length > 0 || !maze2Idle(w);
    if (!busy && this.scheduled.length === 0) return;
    advanceMaze2(w, 1);
    this.imageCount += 1;
    this.sync();
  }

  /** `1118:2285` : le Zoombini déposé part (liste en vol, rampe occupée, script de rampe) ; refusé, il rentre à sa place. */
  private startPending(): void {
    const w = this.world;
    for (const launch of this.pending.splice(0)) {
      const id = launch.member.index + 1;
      const result = launchMaze2(w, id, launch.ramp.number);
      if (!result.ok) {
        this.freeRamp(launch.ramp.number);
        this.returnHome(launch.member, { ...launch.ramp.drop });
        continue;
      }
      launch.t0 = w.time;
      this.running.push(launch);
      this.playRamp(launch);
    }
  }

  private rampView(number: number): RampView {
    return this.rampViews.find((r) => r.ramp.number === number)!;
  }

  private freeRamp(number: number): void {
    this.rampView(number).target.owner = null;
  }

  /** Image 0 du script de rampe : la rampe repart de sa première image (son 9000 à l'image 1, 9001 à l'image 19, joués par le script). */
  private playRamp(launch: Launch): void {
    const view = this.rampView(launch.ramp.number);
    const object = view.object;
    object.flags = (object.flags & ~(FeatureFlag.staticFirst | FeatureFlag.noReplay)) | FeatureFlag.stopAtEnd;
    this.features.setScript(object, launch.ramp.script);
    if (view.front) {
      view.front.flags = (view.front.flags & ~(FeatureFlag.staticFirst | FeatureFlag.noReplay)) | FeatureFlag.stopAtEnd;
      this.features.setScript(view.front, launch.ramp.script + 1);
    }
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Mise en scène à chaque image

  private sync(): void {
    const w = this.world;
    const now = w.time - 1;
    this.syncLaunches(now);
    for (const flight of w.flights) this.syncFlight(flight);
    for (const [id, view] of [...this.views]) {
      if (w.flights.some((f) => f.id === id)) continue;
      this.views.delete(id);
      this.endView(view);
    }
    this.syncCells();
    for (const entry of this.scheduled.filter((s) => s.at <= now)) {
      this.scheduled.splice(this.scheduled.indexOf(entry), 1);
      entry.run();
    }
    this.kit.goEnabled = maze2Outcome(w).goActive;
  }

  /** Chronologie d'un lancer (événements du script de rampe, §5.4) : machine à bulles (image 1), pose assise (2), canon (16), rampe libre (34). */
  private syncLaunches(now: number): void {
    for (const launch of [...this.running]) {
      const k = now - launch.t0!;
      const { ramp, member } = launch;
      const snoid = member.snoid;
      if (k === 1) this.playMachine(ramp);
      else if (k === 2) {
        snoid.setPosition(ramp.drop);
        snoid.play(SCRS.pose + 5 * ramp.poseClass + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal" });
      } else if (k === 16) {
        // Le Zoombini monte dans le canon : le script de pose finit à son décalage, le canon (`SCRS 14000 + classe`) repart de là.
        const delta = this.scriptDelta(SCRS.pose + 5 * ramp.poseClass + snoid.traits.feet);
        snoid.setPosition({ x: ramp.drop.x + delta.x, y: ramp.drop.y + delta.y });
        snoid.play(SCRS.canon + ramp.poseClass, FeatureFlag.stopAtEnd, { kind: "reject" });
      }
      if (this.world.time >= this.world.rampFreeAt[ramp.number]!) {
        this.running.splice(this.running.indexOf(launch), 1);
        this.freeRamp(ramp.number);
      }
    }
  }

  /** Décalage entre la première et la dernière image d'un `SCRS` (position du premier élément de l'image). */
  private scriptDelta(id: number): Point {
    const images = scrs(this.archive, id).images.filter((image) => (image.cells[0]?.w ?? 0) > 0);
    const first = images[0]?.cells[0];
    const last = images[images.length - 1]?.cells[0];
    return first && last ? { x: last.x - first.x, y: last.y - first.y } : { x: 0, y: 0 };
  }

  /** Événement `0x32` de la rampe (image 1) : la machine à bulles de la falaise joue son script (`SCRB 9005 + falaise`, `S14:02aa`). */
  private playMachine(ramp: Maze2Ramp): void {
    const machine = this.machines[ramp.cliff];
    if (machine) this.features.setScript(machine, SCRB.machine + ramp.cliff);
  }

  /** Cible survolée par un Zoombini porté (`1168:1742`, mise en surbrillance) : la plaque de la rampe joue son script (`SCRB 7014 + z − 1`, 5 images). */
  private hovered(target: DropTarget | null): void {
    if (!target) return;
    const view = this.rampView(target.tag as number);
    view.plate.flags = (view.plate.flags & ~(FeatureFlag.staticFirst | FeatureFlag.noReplay)) | FeatureFlag.stopAtEnd;
    this.features.setScript(view.plate, SCRB.plate + view.ramp.number - 1);
  }

  private pos(row: number, col: number): Point {
    return maze2ZoombiniPosition(this.positions, row, col);
  }

  private viewOf(flight: Maze2Flight): FlightView {
    let view = this.views.get(flight.id);
    if (!view) {
      const member = this.kit.members[flight.id - 1]!;
      view = { id: flight.id, member, key: "", lastTarget: null, bubble: null, effects: [], at: { ...member.snoid.position } };
      this.views.set(flight.id, view);
    }
    return view;
  }

  private syncFlight(flight: Maze2Flight): void {
    const view = this.viewOf(flight);
    const key = `${flight.state}|${flight.steps}|${flight.dir}|${flight.row},${flight.col}|${flight.targetRow},${flight.targetCol}`;
    if (key === view.key) return;
    view.key = key;
    switch (flight.state) {
      case "step":
        this.startSegment(view, flight);
        break;
      case "wait":
        this.startWait(view, flight);
        break;
      case "reject":
        this.startReject(view, flight);
        break;
      case "land":
        this.startLand(view, flight);
        break;
      default:
        break;
    }
  }

  /** Bulle du Zoombini : feature `relative` dont le coin haut-gauche suit ses pieds ; rejoue le script de pas à chaque case. */
  private placeBubble(view: FlightView, feet: Point, script: number): void {
    const f = this.features;
    const at = { x: feet.x + BUBBLE_OFFSET.x, y: feet.y + BUBBLE_OFFSET.y };
    if (!view.bubble) {
      view.bubble = f.create({
        script,
        delay: IMAGE_TICKS,
        depth: DEPTH.bubble,
        position: at,
        flags: FeatureFlag.flag4000000 | FeatureFlag.relative | FeatureFlag.stopAtEnd | FeatureFlag.active | FeatureFlag.firstImage,
      });
      return;
    }
    view.bubble.position.x = at.x;
    view.bubble.position.y = at.y;
    f.setScript(view.bubble, script);
  }

  private dropBubble(view: FlightView): void {
    if (view.bubble) this.features.destroy(view.bubble);
    view.bubble = null;
  }

  /** Effet à usage unique (éclaboussure, tourbillon, gerbe) : détruit à la fin de son script. */
  private effect(view: FlightView, script: number, at: Point): void {
    const f = this.features;
    const effect = f.create({
      script,
      delay: IMAGE_TICKS,
      depth: DEPTH.effects,
      position: at,
      flags: FeatureFlag.flag4000000 | FeatureFlag.relative | FeatureFlag.stopAtEnd | FeatureFlag.active | FeatureFlag.firstImage,
      onEvent: (_image, n) => {
        if (n !== FEATURE_END) return;
        view.effects.splice(view.effects.indexOf(effect), 1);
        f.destroy(effect);
      },
    });
    view.effects.push(effect);
  }

  /** Un pas de case, ou le bond de lancement des rampes de direction 1 et 3 (`1100:0b69`, `1118:2dad`). */
  private startSegment(view: FlightView, flight: Maze2Flight): void {
    const { snoid } = view.member;
    const feet = this.pos(flight.row, flight.col);
    // Effet de la case quittée : un bouton actionné à l'entrée (`1100:102a`, son 5103, image enfoncée) ; un aiguillage tournant joue 5101 / 5102 (voir `syncCells`).
    const last = view.lastTarget;
    if (last && last.row === flight.row && last.col === flight.col) this.cellEntered(flight.row, flight.col);
    view.lastTarget = { row: flight.targetRow, col: flight.targetCol };
    const feetLooks = snoid.traits.feet;
    const script = flight.hop ? SCRS.hop[flight.dir]! + feetLooks : SCRS.step + 5 * flight.dir + (feetLooks - 1);
    const bubble = flight.hop ? SCRB.bubbleHop[flight.dir]! : SCRB.bubble + flight.dir;
    this.features.restack(snoid.feature, DEPTH.flight);
    snoid.onEnd = undefined;
    snoid.onEvent = undefined;
    snoid.setPosition(feet);
    snoid.play(script, FeatureFlag.stopAtEnd, { kind: "normal" });
    view.at = feet;
    this.placeBubble(view, feet, bubble);
  }

  /** Case d'attente (`1100:20dc`) : le Zoombini y reste, animation d'attente en boucle (`SCRS 15055 + 5 × direction + pieds`). */
  private startWait(view: FlightView, flight: Maze2Flight): void {
    const { snoid } = view.member;
    const feet = this.pos(flight.row, flight.col);
    view.lastTarget = null;
    snoid.onEnd = undefined;
    snoid.onEvent = undefined;
    snoid.setPosition(feet);
    snoid.play(SCRS.wait + 5 * flight.dir + snoid.traits.feet, 0, { kind: "normal" });
    view.at = feet;
  }

  /** Rejet : tourbillon (`SCRB 10031`, `SCRS 14006`) ou collision (pose `15035…`, éclaboussure, puis `SCRS 14004`). */
  private startReject(view: FlightView, flight: Maze2Flight): void {
    const w = this.world;
    const { snoid } = view.member;
    const now = w.time - 1;
    snoid.onEnd = undefined;
    snoid.onEvent = undefined;
    this.dropBubble(view);
    view.lastTarget = null;
    this.features.restack(snoid.feature, DEPTH.flight);
    if (flight.backAt - now > 20) {
      // Tourbillon (26 images avant le retour) : le Zoombini est dans la case visée.
      const feet = this.pos(flight.targetRow, flight.targetCol);
      snoid.setPosition(feet);
      snoid.play(SCRS.whirlReject, FeatureFlag.stopAtEnd, { kind: "reject" });
      view.at = feet;
      const whirl = maze2CellPosition(this.positions, flight.targetRow, flight.targetCol);
      this.effect(view, SCRB.whirl, { x: whirl.x + WHIRL_OFFSET.x, y: whirl.y + WHIRL_OFFSET.y });
      return;
    }
    // Collision : les deux Zoombinis se heurtent à mi-chemin de la case visée.
    const from = this.pos(flight.row, flight.col);
    const to = this.pos(flight.targetRow, flight.targetCol);
    const mid = { x: Math.round((from.x + to.x) / 2), y: Math.round((from.y + to.y) / 2) };
    snoid.setPosition(mid);
    snoid.play(SCRS.clash + 5 * flight.dir + (snoid.traits.feet - 1), FeatureFlag.stopAtEnd, { kind: "normal" });
    view.at = mid;
    const zone = this.splashZone(flight);
    this.effect(view, SCRB.splash + 3 * flight.dir + zone, { x: mid.x + BUBBLE_OFFSET.x, y: mid.y + BUBBLE_OFFSET.y });
    // 6 images de gerbe, puis `SCRS 14004` (`SCRB 10012…`, événement `0x3d`).
    this.scheduled.push({
      at: now + 6,
      run: () => {
        if (view.member.snoid.destroyed) return;
        view.member.snoid.play(SCRS.clashReject, FeatureFlag.stopAtEnd, { kind: "reject" });
      },
    });
  }

  /** Zone de l'éclaboussure (`REGS 16501`, 0 à 2) : lue sur la case visée ; l'original utilise un pas de 12 mots (hypothèse d'une relique), repris tel quel. */
  private splashZone(flight: Maze2Flight): number {
    const zones = regs(this.archive, 16501);
    const zone = zones[flight.targetRow * 12 + flight.targetCol] ?? 0;
    return zone >= 0 && zone <= 2 ? zone : 0;
  }

  /** Atterrissage sur une falaise (`1118:1fb4`) : pose `SCRS 15075 + pieds`, gerbe `SCRB 10040`, `SCRS 14007` à l'image 2 de la gerbe. */
  private startLand(view: FlightView, flight: Maze2Flight): void {
    const w = this.world;
    const { snoid } = view.member;
    const now = w.time - 1;
    snoid.onEnd = undefined;
    snoid.onEvent = undefined;
    this.dropBubble(view);
    view.lastTarget = null;
    const feet = this.pos(flight.targetRow, flight.targetCol);
    snoid.setPosition(feet);
    snoid.play(SCRS.land + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal" });
    view.at = feet;
    this.effect(view, SCRB.spray, { x: feet.x + BUBBLE_OFFSET.x, y: feet.y + BUBBLE_OFFSET.y });
    const member = w.members[view.id - 1]!;
    if (member.saved) view.member.zoombini.present = true;
    this.scheduled.push({
      at: now + 2,
      run: () => {
        if (view.member.snoid.destroyed) return;
        view.member.snoid.play(SCRS.landReject, FeatureFlag.stopAtEnd, { kind: "reject" });
      },
    });
  }

  /** Un Zoombini quitte la liste (la simulation l'oublie) : effets nettoyés, retour à pied sur la place suivante de la file de sa falaise. */
  private endView(view: FlightView): void {
    this.dropBubble(view);
    for (const effect of view.effects.splice(0)) this.features.destroy(effect);
    if (this.world.members[view.member.index]!.cliff === MAZE2_GOAL_CLIFF) this.danceLanding(view);
    else this.returnHome(view.member, view.at);
  }

  /**
   * `1118:1503` étape 6 : un Zoombini arrivé sur la falaise 3 est mis en file `[8956]` par l'événement de `SCRS 14007` (`1118:3263`) ; le Tick lui joue `SCRS 15090 + pieds`
   * (même rappel, drapeau `+0x2f`) avant que `14007` ait fini : la danse prend la place de sa dernière image. Le rappel de fin de la danse met alors le Zoombini en file
   * `[8950]` (étape 8) : il ne marche vers sa place qu'une fois la danse finie (voix et retour sont donc retardés d'autant).
   */
  private danceLanding(view: FlightView): void {
    const { member } = view;
    const { snoid } = member;
    snoid.setPosition(view.at);
    snoid.setFacing(0);
    snoid.onEvent = undefined;
    this.landDancers += 1;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      this.landDancers -= 1;
      this.returnHome(member, view.at);
    };
    snoid.play(SCRS.dance + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal" });
  }

  private returnHome(member: KitMember, from: Point): void {
    const w = this.world;
    const m = w.members[member.index]!;
    const cliff = m.cliff;
    const slot = this.queue[cliff]!;
    this.queue[cliff] = (slot + 1) % QUEUE_SIZE;
    const place = CLIFF_PLACES[cliff]![slot]!;
    const { snoid } = member;
    this.arrived(member);
    snoid.setPosition(from);
    snoid.setFacing(0);
    snoid.delay = IMAGE_TICKS;
    member.target = null;
    this.features.restack(snoid.feature, 1 + from.y / 1000);
    this.kit.walk(
      member,
      place,
      () => {
        this.features.restack(snoid.feature, 1 + place.y / 1000);
      },
      { counted: false, pickable: true },
    );
  }

  /** `1118:1503` étape 8 (au départ de la marche vers sa place) : arrivée sur une falaise ; la falaise 3 pleine déclenche la voix de réussite et la danse (`[899e]`). */
  private arrived(member: KitMember): void {
    const outcome = maze2Outcome(this.world);
    if (!outcome.allSaved || this.voiced) return;
    if (this.world.members[member.index]!.cliff !== MAZE2_GOAL_CLIFF) return;
    this.voiced = true;
    this.kit.playSuccessVoice();
    this.dancingNow = true;
    this.danced = 0;
    this.lastDance = this.ctx.clock.ticks;
    this.dancers.length = 0;
    this.dancers.push(...this.kit.members.map((m) => m.index));
  }

  /** Après chaque image : cases dont l'aiguillage a tourné (son 5101 / 5102 alternés) et redessin. */
  private syncCells(): void {
    let changed = false;
    this.world.cells.forEach((cell, i) => {
      if (cell.dir === this.shownDir[i]) return;
      this.shownDir[i] = cell.dir;
      changed = true;
      if (cell.rotates) this.playSwitchSound();
    });
    if (changed) this.features.invalidate();
  }

  private playSwitchSound(): void {
    const sound = this.ctx.services.get(ZOOMBINIS_SOUND);
    sound.queue(this.switchSounds++ % 2 === 0 ? SOUND.switchA : SOUND.switchB);
  }

  /** Un Zoombini entre dans la case `(row, col)` : bouton (type 6) enfoncé, son 5103. */
  private cellEntered(row: number, col: number): void {
    const index = this.world.grid[row * MAZE2_SIZE + col]!;
    if (index < 0) return;
    const cell = this.world.cells[index]!;
    if (cell.kind !== Maze2Kind.button) return;
    this.pressed[index] = 0;
    this.due[index] = this.ctx.clock.ticks + cell.delay;
    this.features.invalidate();
    this.ctx.services.get(ZOOMBINIS_SOUND).queue(SOUND.button);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Danse finale (`1118:1503`, étape 11)

  private tickDance(): void {
    if (!this.dancingNow) return;
    const now = this.ctx.clock.ticks;
    if (this.danced >= this.party.length - 1 || this.dancers.length === 0) {
      this.dancingNow = false;
      return;
    }
    if (now - this.lastDance <= DANCE_GAP) return;
    this.lastDance = now;
    // Un Zoombini tiré au hasard parmi ceux qui n'ont pas encore dansé et qui sont immobiles (`1098:0098`, masque des danseurs) ; personne de libre : à la prochaine date.
    const free = this.dancers.filter((index) => {
      const member = this.kit.members[index]!;
      return member.snoid.resting && !member.snoid.destroyed && member.zoombini.present;
    });
    if (free.length === 0) return;
    const index = free[this.ctx.rng.range(0, free.length - 1)]!;
    this.dancers.splice(this.dancers.indexOf(index), 1);
    const { snoid } = this.kit.members[index]!;
    snoid.onEvent = undefined;
    snoid.onEnd = () => {
      snoid.onEnd = undefined;
      snoid.idle();
    };
    snoid.play(SCRS.dance + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal" });
    this.danced += 1;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // « go » : son 996, puis Zoombiniville quand le son est fini (`1118:2285`, région 2 ; aucune marche de sortie)

  private pressGo(): boolean {
    this.dancingNow = false;
    this.kit.pressGo({ depart: () => {} });
    return true;
  }

  leaveScene(): void {
    this.finished = true;
    this.kit.leave();
  }
}

/** Écran du gouffre des véhibules (`MAZE2.MHK`, écran 18). */
export function createMaze2Scene(): Maze2Scene {
  const name = screenInfo(SCREEN)?.archive;
  if (!name) throw new Error("createMaze2Scene : pas d'archive pour l'écran 18");
  let archive: Archive;
  let run: Maze2Run | null = null;
  return {
    get probe() {
      return run;
    },
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(name);
    },
    enter(ctx: SceneContext) {
      run = new Maze2Run(ctx, archive);
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
