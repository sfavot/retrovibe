/**
 * Les gorges allergiques (`BRIDGE.MHK`, écran 7, tâche H1 ; `docs/zoombinis/puzzles/bridge.md`, `docs/zoombinis/engine-ts.md`, « Gorges (tâche H1) »).
 * Première vraie épreuve de la vague H, sur le kit commun (`puzzle-kit.ts`) : le kit porte l'arrivée du groupe, le glisser-déposer, les boutons, la sortie, l'enregistrement,
 * l'aide F1 et la musique ; cet écran porte les règles (`game/puzzles/bridge.ts`) et la mise en scène.
 *
 * ## Déroulé (original : Enter `10c0:00e6`, Tick `10c0:05e4`, clic `10c0:0a99`, événements des Zoombinis `10c0:0f68`, des objets de décor `10c0:0e5a`)
 *
 *  1. **Entrée** : fond et palette 1000, groupes de formes 1100 / 1200 / 1300 et leurs `SCRB`, décor créé dans l'ordre de l'original (zones de dépôt, visage de la falaise,
 *     clôture, socles, décor 1100 à 1106, boutons), puis le groupe (arrivée échelonnée : 0 puis 45 ticks), la règle (`drawRule`, après la création des Zoombinis comme
 *     dans l'original), « tous perdus » (`+0x127 = 0`), le jingle 997.
 *  2. **Dépôt** : un Zoombini lâché dans le carré de 55 pixels d'un point d'accroche (116, 104) ou (128, 203) se pose dessus ; la décision (`isRefused`) entre dans une
 *     file de 2 au plus (le dépôt sur une zone déjà prise n'est pas possible).
 *  3. **Départ** (Tick) : si aucun refus n'est en cours (`DS:7078`), que les ponts sont ouverts, que 45 ticks au moins se sont écoulés depuis le dernier départ et que
 *     5 refus ne sont pas déjà en route, la décision de tête part : le Zoombini joue son `SCRS` de traversée (2000/2005/2010/2015 + pieds − 1) depuis le point d'accroche.
 *  4. **Accepté** : il traverse (59 ou 50 images, 4 ou 5 ticks chacune), puis rejoint la place d'arrivée suivante de la falaise de droite. Le bouton « go » s'active à
 *     la première arrivée.
 *  5. **Refusé** : il marche sur le pont ; au début le socle secoue (`SCRB` 1214/1222), le visage éternue (1208 + n / 1223 + n, n = erreurs) et un poteau de la clôture tombe
 *     (1215 + n / 1229 + n) ; à la fin de la marche (événement 10) il est soufflé en arrière (`SCRS` 1000 à 1019 d'après le type d'éternuement du visage) ; l'erreur est comptée à
 *     la dernière image (événement 20) ; il retourne ensuite dans la falaise de gauche (`returnSpot`).
 *  6. **Sixième refus** : le visage joue l'événement 0 (`DS:7074`) ; au tick suivant les ponts se ferment (animation 1221, clôture 1235, socle du haut retiré) ; plus aucun
 *     Zoombini ne peut être pris. La voix de regret part à la fin de l'animation s'il reste des Zoombinis.
 *
 * ## Écarts avec l'original (voir aussi `docs/zoombinis/puzzles/bridge.md`)
 *
 *  - Les animations d'attente de l'épreuve (`SCRS` 2020 à 2024, quotas `DS:70b8`) ne visent que les Zoombinis arrivés et immobiles ; l'original ne contrôle que `+0x127 ≠ 0`
 *    (il peut donc interrompre une traversée, ce qui la laisse sans fin) ;
 *  - l'ondulation de la corde à la traversée acceptée (`SCRB` 1237 à 1248) est du **code mort** de l'original (`10c0:089f` exige un refus avant de tester l'acceptation) : elle n'est pas jouée ;
 *  - l'ordre de dessin des Zoombinis arrivés est celui de leur ordonnée (l'original les place « devant le précédent » rang par rang, tables non portées) ; **probable** ;
 *  - le type d'éternuement manquant à l'événement 10 (jamais en jeu : le visage l'annonce 18 ticks plus tôt) retombe sur la table `FACE_SNEEZE_TYPES`.
 */
import type { Archive } from "../../../../engine/mohawk/resources";
import { NoRepeatPool } from "../../../../engine/mohawk/rng";
import { screenInfo } from "../../data/archives";
import type { Script } from "../../data/script";
import { scriptAnchorOffset } from "../../data/zoombini";
import { DIALOG } from "../../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type Features } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { scrs } from "../../engine/resources";
import type { Scene, SceneContext } from "../../engine/scene";
import { currentLevel, dialogMemoryIndex, setBridgeMemory } from "../../game/route";
import {
  ARRIVAL_PLACES,
  BRIDGE_ANCHORS,
  CARRY_BOUNDS,
  GRAB_RADIUS,
  RETURN_RECTS,
  SNEEZE_POINTS,
  WAITING_PLACES,
  canStartDecision,
  celebrationPeriod,
  celebrationQuotaGain,
  crossingScript,
  createBridge,
  faceSneezeType,
  isClosed,
  isRefused,
  recordCrossing,
  recordRefusal,
  returnSpot,
  savedCount,
  sneezeScript,
  type Bridge,
  type BridgeLevel,
  type BridgeState,
  type Point,
} from "../../game/puzzles/bridge";
import type { Zoombini } from "../../game/state";
import { createPuzzleKit, createTarget, sheetButtonImages, type DropInfo, type DropTarget, type KitMember, type PuzzleKit } from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";
import { dialogChoice } from "../xfer";

const SCREEN = 7;

/** Fond et palette (`SHPL` / `tBMP` 1000), groupes de formes (`tBMP` 1100 : décor, 1200 : socles, visage, clôture, 1300 : zones de dépôt), planche des boutons. */
const BACKGROUND = 1000;
const GROUP_DECOR = 1100;
const GROUP_PIECES = 1200;
const GROUP_ZONES = 1300;
const BUTTONS_SHEET = 1400;

/** `SCRB` de l'écran. */
const SCRB = {
  /** Décor 1100 à 1106 ; 1103 (`DS:7072`) est animé à la fermeture, 1105 est aussi le premier état du visage. */
  decorFirst: 1100,
  decorLast: 1106,
  decorAnimated: 1103,
  face: 1105,
  lowerSocket: 1200,
  upperSocket: 1201,
  fence: 1202,
  /** Secousse du socle du bas / du haut, éternuement n + erreurs du visage (bas / haut), chute du poteau n + erreurs (bas / haut). */
  lowerShake: 1214,
  upperShake: 1222,
  lowerFace: 1208,
  upperFace: 1223,
  lowerPost: 1215,
  upperPost: 1229,
  /** Fermeture des ponts : clôture et socle du bas. `1236` remplace le décor 1103 pendant l'animation. */
  closeFence: 1235,
  closeSocket: 1221,
  closeDecor: 1236,
} as const;

/** Délais entre images des objets de décor (`11a8:0ad6`, 6 pour le visage, la clôture et les socles, 7 pour les zones). */
const PIECE_DELAY = 6;
const ZONE_DELAY = 7;
/** Animation d'attente d'un Zoombini arrivé : `SCRS` 2019 + pieds (`10c0:05e4`). */
const CELEBRATION_BASE = 2019;
/** Marche de sortie de « go » (`1168:2982(45, 0, 316, 680)` : x = 680, y = 316). */
const EXIT_WALK = { x: 680, y: 316, step: 45 } as const;
/** Délai de la traversée acceptée : `rand(4, 5)` ticks entre images (`+0x28`). */
const CROSS_DELAY_MIN = 4;
const CROSS_DELAY_MAX = 5;
/** Voix de regret (`20045…20048`, `10c0:0eea`) : `rand(0..4) > niveau` ou moins de 4 visites. */
const REGRET_VISITS = 3;

/** État d'un Zoombini dans l'épreuve. */
type Status = "wait" | "queued" | "crossing" | "sneezing" | "back" | "crossed";

interface Entry {
  member: KitMember;
  bridge: Bridge;
  refused: boolean;
  target: DropTarget;
}

interface Info {
  status: Status;
  bridge: Bridge;
  /** Position de départ du script en cours (point d'accroche ou position d'attente). */
  start: Point;
}

/** Fenêtre sur l'épreuve en cours, pour les tests. */
export interface BridgeProbe {
  readonly kit: PuzzleKit;
  readonly state: BridgeState;
  readonly queue: readonly Entry[];
  readonly statuses: readonly Status[];
  /** Ponts fermés (animation de fin lancée). */
  readonly closing: boolean;
  /** Zoombinis arrivés qui ont déjà joué une animation d'attente / quota. */
  readonly celebrations: { played: number; quota: number };
}

export type BridgeScene = Scene & { readonly probe: BridgeProbe | null };

/** Position des pieds à la dernière image d'un `SCRS` posé en `start` (`1168:4741` écrit `+0xa6/+0xa8` à chaque image dont la première case est une partie). */
function scriptEnd(script: Script, start: Point): Point {
  const origin = scriptAnchorOffset(script.images, start, false);
  let last = script.images[0]?.cells[0];
  for (const image of script.images) {
    const first = image.cells[0];
    if (first && first.w > 0) last = first;
  }
  return last ? { x: origin.x + last.x, y: origin.y + last.y } : start;
}

class BridgeRun implements BridgeProbe {
  readonly kit: PuzzleKit;
  state!: BridgeState;
  queue: Entry[] = [];
  /** Ponts fermés : l'animation de fin est lancée. */
  closing = false;
  readonly celebrations = { played: 0, quota: 0 };

  private readonly features: Features;
  private readonly size: number;
  private readonly party: Zoombini[];
  private readonly info: Info[] = [];
  private readonly zones: Record<Bridge, DropTarget>;
  private readonly pool: NoRepeatPool;
  private readonly period: number;
  private readonly socket: Record<Bridge, Feature>;
  private readonly fence: Feature;
  private readonly face: Feature;
  private readonly decor: Feature;
  /** `DS:7078` : un refus est en cours ; `DS:70b2` : sa réaction est finie (le Zoombini peut être repris) ; `DS:7066` : un clic a eu lieu. */
  private lock = false;
  private reactionDone = false;
  private touched = false;
  /** `DS:7074` : le visage a joué l'événement 0 (sixième refus), les ponts se ferment au prochain tick. */
  private closeRequested = false;
  /** Décision de départ la plus récente (`DS:707a`, `DS:7076`), nombre de décisions en route (`DS:707c`), dernier départ (`DS:7062`). */
  private curBridge: Bridge = 1;
  private curRefused = false;
  private walkers = 0;
  private lastStart: number;
  /** Socle à secouer au prochain tick (`DS:7080`) et type d'éternuement annoncé par le visage (`DS:7090`). */
  private shake: Bridge | null = null;
  private sneezeType = 0;
  /** Premier nombre de traversées (`DS:705a`), rangs d'arrivée (`DS:705c` / `705e`). */
  private firstCount = 0;
  private readonly ranks: Record<Bridge, number> = { 1: 0, 2: 0 };
  private lastIdle = 0;

  constructor(
    private readonly ctx: SceneContext,
    private readonly archive: Archive,
  ) {
    const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
    const { game, session } = zoombinis;
    session.screen = SCREEN;
    const level = currentLevel(game, session, SCREEN) as BridgeLevel;
    openScreen(ctx, archive, { background: BACKGROUND });
    this.features = ctx.services.get(FEATURES);
    this.party = game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
    this.size = this.party.length;
    this.pool = new NoRepeatPool(Math.max(1, Math.min(32, this.size)));
    this.period = celebrationPeriod(game.options.lessAction);
    this.zones = { 1: createTarget(BRIDGE_ANCHORS[1], 1), 2: createTarget(BRIDGE_ANCHORS[2], 2) };

    // Décor, dans l'ordre de création de `10c0:00e6` (le dernier créé est devant ; les Zoombinis, créés ensuite, sont devant tout).
    const f = this.features;
    f.defineGroup(0, GROUP_DECOR);
    f.defineGroup(1, GROUP_PIECES);
    f.defineGroup(2, GROUP_ZONES);
    f.setScripts(SCRB.decorFirst, 7);
    f.addScripts(GROUP_PIECES, 49);
    f.addScripts(GROUP_ZONES, 2);
    const F = FeatureFlag;
    for (const bridge of [1, 2] as const) {
      // Zones de dépôt (`0x2000`) : allumées au survol d'un Zoombini porté (`1168:1742`, `DropTarget.highlight`).
      this.zones[bridge].highlight = f.create({ script: GROUP_ZONES + bridge - 1, delay: ZONE_DELAY, flags: F.playOnly | F.noReplay | F.active | F.firstImage });
    }
    this.face = f.create({ script: SCRB.face, delay: PIECE_DELAY, flags: F.playOnly | F.stopAtEnd | F.noReplay | F.queueScript | F.active });
    this.fence = f.create({ script: SCRB.fence, delay: PIECE_DELAY, flags: F.stopAtEnd | F.active });
    this.socket = {
      1: f.create({ script: SCRB.upperSocket, delay: PIECE_DELAY, flags: F.stopAtEnd | F.active }),
      2: f.create({ script: SCRB.lowerSocket, delay: PIECE_DELAY, flags: F.stopAtEnd | F.active }),
    };
    let decor: Feature | undefined;
    for (let id: number = SCRB.decorFirst; id <= SCRB.decorLast; id++) {
      const feature = f.create({ script: id, delay: 0, flags: id === SCRB.decorAnimated ? F.stopAtEnd : F.stopEachImage });
      if (id === SCRB.decorAnimated) decor = feature;
    }
    this.decor = decor!;

    const buttons = sheetButtonImages(archive.tbmpImages(BUTTONS_SHEET));
    this.kit = createPuzzleKit(ctx, {
      screen: SCREEN,
      party: this.party,
      places: WAITING_PLACES,
      targets: (places) => [this.zones[1], this.zones[2], ...places],
      radius: GRAB_RADIUS,
      bounds: CARRY_BOUNDS,
      snoid: { scripts: screenScripts(archive) },
      // Planche 1400 (`10c0:045f`) : image enfoncée tant que le bouton de la souris est tenu ; les images sont dessinées par le kit, derrière les Zoombinis.
      buttons: { map: { images: buttons.map }, go: { images: buttons.go } },
      exitWalk: EXIT_WALK,
      // `10c0:0d20` : F1 n'est prise que si plus personne n'est en marche ; l'épreuve n'a pas de voix d'introduction (`DS:a2c4 = 0`).
      helpAllowed: () => this.kit.walking <= 0,
      onPointerDown: (): boolean => {
        // `10c0:0a99` région 3 : `(DS:9702 < 1 || DS:7066 ≠ 0) && DS:7068 < 6` ; le premier clic pris pose `DS:7066`.
        if ((this.kit.walking < 1 || this.touched) && !isClosed(this.state)) this.touched = true;
        return false;
      },
      canPick: (member) => this.canPick(member),
      decide: (drop) => this.decide(drop),
      onPick: (member) => this.picked(member),
      onDrop: (drop) => this.dropped(drop),
      onReturn: (drop) => this.returned(drop),
    });
    this.party.forEach((_z, index) => this.info.push({ status: "wait", bridge: 1, start: { ...WAITING_PLACES[index]! } }));
    // `1168:0858`, `2505`, `274e(0, 45)` puis `131a` : la règle est tirée une fois les Zoombinis créés.
    this.kit.arrive({ startDelay: 0, step: 45 });
    this.state = createBridge(ctx.rng, level, this.party);
    // `DS:96ec` / `96f0` : la règle du niveau 0 est laissée aux grottes (`bridgeAvoidCount`).
    setBridgeMemory(session, this.state.previous);
    // `1168:3dd0(0, 0)` : personne n'est sauvé (`+0x127 = 0`).
    this.kit.markAll(false);
    this.lastStart = ctx.clock.ticks;
    this.kit.playEntryJingle();
    this.kit.playMusic();
    // `1168:5c57` : une visite de plus de l'écran (mémoire de dialogue 1, 12 bits).
    const slot = dialogMemoryIndex(SCREEN);
    if (slot >= 0) game.dialogMemory[slot] = dialogChoice(game.dialogMemory[slot]!, level, session.training !== 0).memory;
    ctx.requestPresent();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Fenêtre pour les tests

  get statuses(): readonly Status[] {
    return this.info.map((i) => i.status);
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Prise et dépôt (`10c0:0a99`)

  private bridgeOf(target: DropTarget | null | undefined): Bridge | undefined {
    return typeof target?.tag === "number" ? (target.tag as Bridge) : undefined;
  }

  /** Objet visé : ni en traversée (état 8), ni déjà passé (`+0x127`), et un Zoombini soufflé (état 9) seulement entre la fin de sa réaction et le tour suivant (`DS:70b2`). */
  private canPick(member: KitMember): boolean {
    if (!this.touched || isClosed(this.state)) return false;
    const status = this.info[member.index]!.status;
    if (status === "crossing" || status === "crossed") return false;
    if (status === "sneezing") return this.reactionDone;
    return true;
  }

  private picked(member: KitMember): void {
    const info = this.info[member.index]!;
    if (info.status === "queued") this.queue = this.queue.filter((entry) => entry.member !== member);
    if (info.status === "sneezing") {
      // `DS:7078 = 0`, `DS:70b2 = 0` : la prochaine décision peut partir.
      this.lock = false;
      this.reactionDone = false;
      member.snoid.onEnd = undefined;
    }
    // Un refusé repris en route a déjà abandonné sa marche de retour (`PuzzleKit.cancelWalk`).
    info.status = "wait";
  }

  private decide(drop: DropInfo): boolean {
    if (this.bridgeOf(drop.target) === undefined) return true;
    return !isClosed(this.state) && this.queue.length < 2;
  }

  private dropped(drop: DropInfo): void {
    const bridge = this.bridgeOf(drop.target);
    const info = this.info[drop.member.index]!;
    if (bridge === undefined || !drop.target) {
      info.status = "wait";
      return;
    }
    this.enqueue(drop.member, bridge, drop.target);
  }

  /** Retour à l'origine : un Zoombini repris d'une zone et relâché ailleurs hors cible retombe sur sa zone, donc dans la file. */
  private returned(drop: DropInfo): void {
    const bridge = this.bridgeOf(drop.from);
    if (bridge !== undefined && drop.from && !isClosed(this.state)) this.enqueue(drop.member, bridge, drop.from);
    else this.info[drop.member.index]!.status = "wait";
  }

  private enqueue(member: KitMember, bridge: Bridge, target: DropTarget): void {
    const info = this.info[member.index]!;
    info.status = "queued";
    info.bridge = bridge;
    info.start = { x: target.x, y: target.y };
    this.queue.push({ member, bridge, refused: isRefused(this.state.rule, this.state.attrs[member.index]!, bridge), target });
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // Tick (`10c0:05e4`)

  tick(): void {
    this.kit.tick();
    if (this.kit.left || this.kit.departing) return;
    if (this.ctx.services.tryGet(DIALOG)?.isOpen) return;
    if (this.closeRequested) {
      this.closeRequested = false;
      this.closeBridges();
    }
    this.startDecision();
    this.shakeStep();
    this.celebrate();
  }

  /** Étape 3 : la décision de tête part si les conditions de `canStartDecision` sont réunies et qu'aucun refus n'est en cours. */
  private startDecision(): void {
    if (this.queue.length === 0 || this.lock) return;
    const entry = this.queue[0]!;
    const elapsed = this.ctx.clock.ticks - this.lastStart;
    if (!canStartDecision(this.state, entry.refused, this.walkers, elapsed)) return;
    this.queue.shift();
    this.lastStart = this.ctx.clock.ticks;
    const { member, bridge, refused } = entry;
    this.curBridge = bridge;
    this.curRefused = refused;
    this.lock = refused;
    this.walkers += 1;
    // `1168:170f(0, pont)` : la zone est libérée.
    entry.target.owner = null;
    member.target = null;
    const snoid = member.snoid;
    const info = this.info[member.index]!;
    info.status = "crossing";
    info.bridge = bridge;
    info.start = { ...snoid.position };
    if (!refused) {
      // `+0x127 = 1` et délai de 4 ou 5 ticks entre images.
      recordCrossing(this.state, member.index);
      member.zoombini.present = true;
      snoid.delay = this.ctx.rng.range(CROSS_DELAY_MIN, CROSS_DELAY_MAX);
    }
    snoid.onEnd = undefined;
    snoid.onEvent = (n) => this.crossingEvent(member, n);
    snoid.play(crossingScript(bridge, refused, snoid.traits.feet), FeatureFlag.stopAtEnd, { kind: "normal" });
  }

  /** Machine à événements des Zoombinis (`10c0:0f68`, `n` = octet bas du terminateur − 1). */
  private crossingEvent(member: KitMember, n: number): void {
    switch (n) {
      case 1:
      case 4:
        this.shake = 2;
        break;
      case 2:
      case 5:
        this.shake = 1;
        break;
      case 3:
        this.arrive(member, 2);
        break;
      case 6:
        this.arrive(member, 1);
        break;
      case 10:
        this.sneeze(member);
        break;
      case 20:
        // Fin de la réaction : une erreur de plus (plafonnée), le Zoombini peut être repris.
        this.walkers -= 1;
        recordRefusal(this.state);
        this.reactionDone = true;
        break;
    }
  }

  /** Événements 3 et 6 : la traversée finie, le Zoombini rejoint la place d'arrivée suivante. */
  private arrive(member: KitMember, bridge: Bridge): void {
    this.walkers -= 1;
    const snoid = member.snoid;
    const info = this.info[member.index]!;
    const places = ARRIVAL_PLACES[bridge];
    const place = places[this.ranks[bridge]++ % places.length]!;
    snoid.onEnd = undefined;
    snoid.onEvent = undefined;
    snoid.setPosition(scriptEnd(scrs(this.archive, snoid.scriptId), info.start));
    snoid.walkTo(place);
    this.features.restack(snoid.feature, 1 + place.y / 1000);
    info.status = "crossed";
    const count = savedCount(this.state);
    if (this.firstCount === 0) {
      this.firstCount = count;
      this.kit.goEnabled = true;
      this.features.invalidate();
    }
    this.celebrations.quota += celebrationQuotaGain(count, this.size);
    if (count === this.size && this.walkers === 0) this.kit.playSuccessVoice();
  }

  /** Événement 10 : fin de la marche d'un refusé, le visage l'a annoncé (`DS:7090`) : il est soufflé vers la falaise. */
  private sneeze(member: KitMember): void {
    const info = this.info[member.index]!;
    const type = this.sneezeType !== 0 ? this.sneezeType : faceSneezeType(info.bridge, this.state.errors);
    const script = sneezeScript(type, info.bridge, this.ctx.rng.range(0, 1));
    this.sneezeType = 0;
    info.status = "sneezing";
    member.snoid.onEnd = () => this.reactionEnded(member);
    member.snoid.play(script, FeatureFlag.stopAtEnd, { kind: "reject", at: SNEEZE_POINTS[info.bridge] });
  }

  /** Événement −1 : le refus est terminé, le Zoombini retourne dans la falaise de gauche (`1168:5482(0x24, 1, rect)`). */
  private reactionEnded(member: KitMember): void {
    const info = this.info[member.index]!;
    this.reactionDone = false;
    this.lock = false;
    const snoid = member.snoid;
    snoid.onEnd = undefined;
    snoid.onEvent = undefined;
    const others = this.kit.members.filter((m) => m !== member && !m.snoid.destroyed).map((m) => m.snoid.position);
    const spot = returnSpot(this.ctx.rng, RETURN_RECTS[info.bridge], others);
    info.status = "back";
    // Marche du kit (`DS:9702` / `9704`) ; le refusé reste saisissable pendant le retour.
    this.kit.walk(
      member,
      spot,
      () => {
        if (info.status === "back") info.status = "wait";
      },
      { pickable: true },
    );
  }

  /** Étape 4 : socle, visage et clôture réagissent à un refus (le code d'acceptation de l'original est mort, voir l'en-tête). */
  private shakeStep(): void {
    const target = this.shake;
    if (target === null) return;
    this.shake = null;
    if (!this.curRefused) return;
    const upper = this.curBridge === 1;
    const errors = this.state.errors;
    this.features.setScript(this.socket[target], upper ? SCRB.upperShake : SCRB.lowerShake);
    // Le visage éternue (hook `10c0:0e5a`, sans événement de fin : `+0x2f = 0`) et un poteau tombe.
    this.face.onEvent = (_image, n) => this.faceEvent(n);
    this.face.notifyEnd = false;
    this.features.setScript(this.face, (upper ? SCRB.upperFace : SCRB.lowerFace) + errors);
    this.features.setScript(this.fence, (upper ? SCRB.upperPost : SCRB.lowerPost) + errors);
  }

  /** Hook des objets de décor (`10c0:0e5a`) pour le visage : événement 0 = fin des ponts, 1 à 6 = type d'éternuement. */
  private faceEvent(n: number): void {
    if (n === 0) this.closeRequested = true;
    else if (n >= 1 && n <= 6) this.sneezeType = n;
  }

  /** Étape 2 : les ponts se ferment. */
  private closeBridges(): void {
    this.closing = true;
    this.kit.endCarry();
    this.socket[1].active = false;
    this.socket[1].parts = [];
    this.socket[1].rect = null;
    this.features.setScript(this.fence, SCRB.closeFence);
    const socket = this.socket[2];
    socket.onEvent = (_image, n) => this.closingEvent(n);
    socket.notifyEnd = true;
    this.features.setScript(socket, SCRB.closeSocket);
    this.features.invalidate();
  }

  /** Hook de l'animation de fin (`10c0:0e5a`) : 100 et 101 changent le décor 1103 ; la fin joue la voix de regret s'il reste des Zoombinis (`10c0:0eea`). */
  private closingEvent(n: number): void {
    if (n === 100) this.features.setScript(this.decor, SCRB.closeDecor);
    else if (n === 101) this.features.setScript(this.decor, SCRB.decorAnimated);
    else if (n === FEATURE_END) this.regret();
  }

  private regret(): void {
    if (savedCount(this.state) >= this.size) return;
    const { game, session } = this.ctx.services.get(ZOOMBINIS_GAME);
    const level = currentLevel(game, session, SCREEN);
    const slot = dialogMemoryIndex(SCREEN);
    const visits = slot >= 0 ? game.dialogMemory[slot]! & 0xfff : 0;
    if (this.ctx.rng.range(0, 4) > level || visits <= REGRET_VISITS) this.kit.playRegretVoice();
  }

  /** Étape 6 : un Zoombini arrivé joue son animation d'attente (`SCRS` 2020 à 2024), dans la limite du quota et à la période de l'épreuve. */
  private celebrate(): void {
    const now = this.ctx.clock.ticks;
    if (this.celebrations.played >= this.celebrations.quota || now - this.lastIdle <= this.period) return;
    this.lastIdle = now;
    for (let tries = 0; tries < 16; tries++) {
      const index = this.pool.pick(this.ctx.rng);
      const member = this.kit.members[index];
      if (!member || this.info[index]!.status !== "crossed" || !member.snoid.resting || member.walking) continue;
      const snoid = member.snoid;
      const start = { ...snoid.position };
      snoid.onEvent = undefined;
      snoid.onEnd = () => {
        snoid.onEnd = undefined;
        snoid.setPosition(scriptEnd(scrs(this.archive, CELEBRATION_BASE + snoid.traits.feet), start));
        snoid.idle();
      };
      snoid.play(CELEBRATION_BASE + snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal" });
      this.celebrations.played += 1;
      break;
    }
  }

  leave(): void {
    this.kit.leave();
  }
}

/** Écran des gorges allergiques (`BRIDGE.MHK`, écran 7). */
export function createBridgeScene(): BridgeScene {
  const name = screenInfo(SCREEN)?.archive;
  if (!name) throw new Error("createBridgeScene : pas d'archive pour l'écran 7");
  let archive: Archive;
  let run: BridgeRun | null = null;
  return {
    get probe() {
      return run;
    },
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(name);
    },
    enter(ctx: SceneContext) {
      run = new BridgeRun(ctx, archive);
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
      if (!run || run.kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (ctx.services.tryGet(DIALOG)?.isOpen) return false;
      return run.kit.key(event);
    },
  };
}
