/**
 * Bac du père mathieu (`FERRY.MHK`, écran 10 ; vague H, tâche H4) : écran de l'épreuve. Règles dans `game/puzzles/ferry.ts`, étude dans
 * `docs/zoombinis/puzzles/ferry.md`, kit commun dans `scenes/puzzle-kit.ts`.
 *
 * Ce que l'écran porte (adresses de l'original entre parenthèses) :
 *  - fond `tBMP` / palette `SHPL` 1300, cinq groupes de formes (`tBMP` 1500, 1600, 1700, 1800, 1450) avec leurs plages de `SCRB`, pieux du ponton
 *    (1450 à 1452), ambiances 1602 / 1603 et décors du radeau (image 1 de la forme) si le réglage « moins d'action » est coupé (`10d8:1861`) ;
 *  - le radeau de la forme du niveau : un tabouret par Zoombini (16 à 20), une feature `SCRB` 1500 à 1502 par tabouret (`10d8:1271`) qui rejoue ses 4 images
 *    quand un Zoombini transporté est à portée de son ancre `(x + 22, y − 7)` ;
 *  - l'arrivée du groupe sur le ponton, le glisser-déposer et l'aide F1 par le kit (cibles = tabourets libres ; le ponton est la zone `DS:10e0`) ;
 *  - un dépôt accepté ou refusé (`ferry.ts` : `dropOn`) ; refusé, la grenouille fait sa remarque (1804 à 1815) puis éjecte (variantes `DS:72f8` 0 à 9 :
 *    actions 1604 à 1607, envol `SCRS` 1900 à 1906, arrivée 1901 à 1907, nage 1000 à 1009 et éclaboussures 1704 à 1706) ;
 *  - les répliques du père mathieu (`SCRB` 1800 à 1832, leur son est celui du terminateur de l'image) ;
 *  - le bouton « go » (actif dès qu'un Zoombini est assis) : départ du radeau (`SCRB` 1608 ou 1609, glissement de 113 pixels des assis, des tabourets et des
 *    décors), puis écran suivant ; les perdus sont ceux qui ne sont pas assis ;
 *  - le bouton carte, l'enregistrement pendant l'épreuve et la musique (aucune) par le kit.
 *
 * Écarts et lectures « probables » : voir `docs/zoombinis/engine-ts.md`, « Bac (tâche H4) ».
 */
import type { Archive } from "../../../../engine/mohawk/resources";
import type { Point } from "../../data/zoombini";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature } from "../../engine/features";
import { ZOOMBINIS_GAME } from "../../engine/game";
import { DIALOG } from "../../engine/dialog";
import { ScreenId, type Scene, type SceneContext } from "../../engine/scene";
import { scrb } from "../../engine/resources";
import { ZOOMBINIS_SOUND } from "../../engine/sound";
import {
  BATH_REMARKS,
  buildRaft,
  createChatter,
  createPlay,
  departureScript,
  DOCK_PLACES,
  dockOccupancy,
  drawFromBag,
  drawRejection,
  EJECT_ARRIVALS,
  EJECT_FLIGHTS,
  dropOn,
  FAR_ARRIVAL,
  frogAction,
  goEnabled,
  IDLE_RANGE,
  IDLE_REMARKS,
  inDock,
  isSplash,
  layoutScriptId,
  NEAR_REMARKS,
  onAcceptance,
  onRefusal,
  pickDockPlace,
  pickUp,
  REST_ANIMATIONS,
  SEAT_EJECT_SCRIPTS,
  SEAT_SCRIPT_FIRST,
  seatCount,
  seatedCount,
  SPLASH_ENTRY,
  SWIM_START,
  type Chatter,
  type DropResult,
  type FerryPlay,
  type Raft,
} from "../../game/puzzles/ferry";
import { currentLevel, dialogMemoryIndex } from "../../game/route";
import type { Session, Zoombini } from "../../game/state";
import {
  SOUND_MAP,
  createPuzzleKit,
  createTarget,
  sheetButtonImages,
  type DropInfo,
  type DropTarget,
  type KitMember,
  type OutsidePlacement,
  type PointerInfo,
  type PuzzleKit,
} from "../puzzle-kit";
import { closeScreen, openScreen } from "../screen-kit";
import { screenScripts } from "../snoid";
import { dialogChoice } from "../xfer";

// ---------------------------------------------------------------------------------------------------------------------------
// Constantes de l'original

const SCREEN = ScreenId.ferry;
/** Fond `tBMP` 640 × 480 et palette `SHPL` de même id. */
const BACKGROUND = 1300;
/** Planche des boutons (6 images de 38 × 36) : 1 « go » grisé, 2 « go », 3 « go » enfoncé, 5 carte, 6 carte enfoncée. */
const BUTTON_SHEET = 1400;
/** Le bouton reste enfoncé 2 ticks (`1090:00c1(1, 0, 2, 0, 0)`). */
const PRESS_TICKS = 2;
/** Délai entre deux images de tous les objets animés de l'écran : 6 ticks. */
const FRAME_DELAY = 6;
/** Groupes de formes (rang de la plage de `SCRB`) : planche et plage. */
const GROUPS: readonly { sheet: number; first: number; count: number }[] = [
  { sheet: 1500, first: 1500, count: 10 },
  { sheet: 1600, first: 1600, count: 10 },
  { sheet: 1700, first: 1700, count: 7 },
  { sheet: 1800, first: 1800, count: 33 },
  { sheet: 1450, first: 1450, count: 3 },
];
const POST_SCRIPTS = [1450, 1451, 1452] as const;
/** Plancher du radeau (tBMP 1600 image 1, 528 × 173 en (181, 262)). */
const RAFT_BASE_SCRIPT = 1601;
const AMBIENT_SCRIPTS = [1602, 1603] as const;
const SPLASH_FLOOR = 1704;
const SPLASH_WATER = 1705;
const SPLASH_SIDE = 1706;
/** `SCRS` d'arrivée de l'éclaboussure (variantes 7 à 9). */
const SPLASH_ARRIVAL = 1907;
/** Son 999 (clic) est `SOUND_MAP` du kit ; sons de la voix du narrateur à l'entrée (`DS:a2c4`). */
const NARRATOR_FIRST = 20073;
const NARRATOR_FIRST_VISIT = 20074;
/** Décalage de l'éclaboussure latérale 1706 : `place − 14` (`10d8:1614`). */
const SPLASH_SIDE_OFFSET = 14;
/** Rayon de la remarque « c'est à côté » (`1168:41bd`) : 15 pixels autour de l'ancre d'un tabouret. */
const NEAR_RADIUS = 15;
/** Profondeurs (les Zoombinis sont à `1 + y / 1000`, celui qui est transporté à 1000). */
const DEPTH_AMBIENT = 0.2;
const DEPTH_POSTS = 0.3;
const DEPTH_RAFT_BASE = 0.35;
const DEPTH_RAFT_DECOR = 0.4;
const DEPTH_BUTTONS = 0.5;
const DEPTH_FROG = 0.8;
const DEPTH_EFFECTS = 5;

/** Drapeaux d'un tabouret et d'un décor (`0x748c2000`, `0x74980000` sans les bits sans effet) : position relative, une seule image, jouée tout de suite. */
const SEAT_FLAGS = FeatureFlag.relative | FeatureFlag.queueScript | FeatureFlag.noReplay | FeatureFlag.firstImage;
const DECOR_FLAGS = FeatureFlag.relative | FeatureFlag.stopAtEnd | FeatureFlag.noReplay | FeatureFlag.firstImage;

/** Mémoire du programme (variables du segment de données qui ne sont pas remises à zéro à l'entrée : `DS:7304`, historiques des tirages). */
interface Program {
  visits: number;
  chatter: Chatter;
}
const programs = new WeakMap<Session, Program>();

function programOf(session: Session): Program {
  let program = programs.get(session);
  if (!program) {
    program = { visits: 0, chatter: createChatter() };
    programs.set(session, program);
  }
  return program;
}

/** Ce que l'écran laisse voir à l'extérieur (tests, outils de développement). Rempli à l'entrée. */
export interface FerryProbe {
  kit: PuzzleKit;
  play: FerryPlay;
  raft: Raft;
  /** Features des tabourets (même ordre que `raft.seats`) et du père mathieu. */
  seatFeatures: Feature[];
  frog: Feature;
  /** Zoombinis du groupe de la scène (même ordre que `play.members`). */
  party: Zoombini[];
  readonly busy: boolean;
  readonly departing: boolean;
  readonly variant: number | null;
  /** Total des glissements du radeau pendant le départ. */
  readonly shifted: number;
  /** Remarque de la grenouille en attente ou jouée en dernier. */
  readonly lastRemark: number;
}

/** Scène du bac. `probe` (facultatif) reçoit l'état interne à chaque entrée. */
export function createFerryScene(probe?: (probe: FerryProbe) => void): Scene {
  let archive: Archive;
  let running: Running | null = null;

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open("FERRY.MHK");
    },
    enter(ctx: SceneContext) {
      running = start(ctx, archive, probe);
    },
    leave(ctx: SceneContext) {
      running?.stop();
      running = null;
      closeScreen(ctx);
    },
    tick() {
      running?.tick();
    },
    key(event, ctx: SceneContext) {
      const kit = running?.kit;
      if (!running || !kit || kit.left) return false;
      if (event.ctrl || event.alt) return false;
      if (ctx.services.tryGet(DIALOG)?.isOpen) return false;
      running.activity();
      return kit.key(event);
    },
  };
}

/** Éjection d'un Zoombini refusé (`72fc`, `72f8`, `72c0` / `72c6`) : tabouret, variante tirée, place du ponton, point d'arrivée. */
interface Ejection {
  member: KitMember;
  seat: number;
  variant: number;
  place: number;
  arrival: Point;
}

interface Running {
  kit: PuzzleKit;
  tick(): void;
  activity(): void;
  stop(): void;
}

function start(ctx: SceneContext, archive: Archive, probe?: (probe: FerryProbe) => void): Running {
  const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
  const { game, session } = zoombinis;
  const features = ctx.services.get(FEATURES);
  const sound = ctx.services.get(ZOOMBINIS_SOUND);
  const { rng } = ctx;
  session.screen = SCREEN;
  const program = programOf(session);
  program.visits += 1;
  // `10d8:0000` remet à zéro les compteurs de répliques ; les historiques de tirage sont des données statiques.
  const chatter = createChatter();
  chatter.bags = program.chatter.bags;
  const lessAction = game.options.lessAction;

  // --- Décor, groupes de formes, scripts (`10d8:0071`) ---
  openScreen(ctx, archive, { background: BACKGROUND });
  GROUPS.forEach((group, k) => {
    features.defineGroup(k, group.sheet);
    if (k === 0) features.setScripts(group.first, group.count);
    else features.addScripts(group.first, group.count);
  });
  const buttons = sheetButtonImages(archive.tbmpImages(BUTTON_SHEET));
  const level = currentLevel(game, session, SCREEN);

  // Groupe de la scène : copie des présents du tampon (le kit ne crée que ceux-là).
  const party: Zoombini[] = game.group.members
    .filter((z) => z.present)
    .map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
  const size = seatCount(party.length);
  const layout = scrb(archive, layoutScriptId(level, size));
  const raft = buildRaft(level, size, layout.images[0]!.cells, layout.images[1]?.cells ?? []);
  const play = createPlay(
    raft,
    party.map((z) => z.attrs),
  );

  // --- État de l'épreuve (variables `DS:72xx`) ---
  /** `72c4` : un refus est en cours, plus personne ne se saisit. */
  let busy = false;
  /** `72d4` : refus en attente de la fin de la remarque (le tabouret refusé est `seat`). */
  let refusal: { member: KitMember; seat: number } | null = null;
  /** Éjection en cours (`72fc`, `72f8`, `72c0` / `72c6` / `72ce`). */
  let action: Ejection | null = null;
  /** `72d2` : réplique en attente, et dernière jouée. */
  let pendingRemark = 0;
  let lastRemark = 0;
  /** La grenouille joue un script. */
  let frogBusy = false;
  /** `72fe` : départ demandé ; puis départ en cours. */
  let departRequested = false;
  let departing = false;
  let shifted = 0;
  let lastVariant: number | null = null;
  /** Instant de la dernière activité et seuil d'inactivité (`11a8:22ad`, `72b8`). */
  let lastActivity = ctx.clock.ticks;
  let idleLimit = rng.range(IDLE_RANGE.min, IDLE_RANGE.max);
  let lastGoState = false;
  /** Résultat du dernier dépôt (le test se fait dans `decide`, avant la pose). */
  let verdict: DropResult | null = null;
  const seatFeatures: Feature[] = [];
  const decorFeatures: Feature[] = [];

  /** Effet temporaire (éclaboussures) : il disparaît à la fin de son script. */
  function effect(script: number, options: { position?: Point; flags: number; onEvent?: (n: number) => void }): Feature {
    return features.create({
      script,
      delay: FRAME_DELAY,
      depth: DEPTH_EFFECTS,
      position: options.position,
      flags: options.flags | FeatureFlag.stopAtEnd | FeatureFlag.firstImage,
      onEvent: (_image, n, feature) => {
        if (n === FEATURE_END) features.destroy(feature);
        else options.onEvent?.(n);
      },
    });
  }

  // --- Décors fixes ---
  for (const script of POST_SCRIPTS) {
    features.create({ script, delay: FRAME_DELAY, depth: DEPTH_POSTS, flags: FeatureFlag.staticFirst | FeatureFlag.firstImage });
  }
  // Le plancher du radeau (`SCRB` 1601, objet `72e4`) : sa grande image est aussi dans chaque image du départ, qui le fait glisser avec le reste.
  const raftBase = features.create({ script: RAFT_BASE_SCRIPT, delay: FRAME_DELAY, depth: DEPTH_RAFT_BASE, flags: FeatureFlag.staticFirst | FeatureFlag.firstImage });
  let ambient: Feature | null = null;
  if (!lessAction) {
    // Ambiances (bulles) : 1602 puis 1603, chaînées (`11a8:2083`).
    ambient = features.create({ script: AMBIENT_SCRIPTS[0], delay: FRAME_DELAY, depth: DEPTH_AMBIENT, flags: FeatureFlag.stopAtEnd | FeatureFlag.firstImage });
    const bubbles = ambient;
    const chain = (next: number): void => {
      bubbles.onEvent = (_image, n) => {
        if (n !== FEATURE_END) return;
        chain(next === AMBIENT_SCRIPTS[0] ? AMBIENT_SCRIPTS[1] : AMBIENT_SCRIPTS[0]);
        features.setScript(bubbles, next);
      };
    };
    chain(AMBIENT_SCRIPTS[1]);
    for (const decor of raft.decor) {
      decorFeatures.push(features.create({ script: decor.script, delay: FRAME_DELAY, depth: DEPTH_RAFT_DECOR, position: { x: decor.x, y: decor.y }, flags: DECOR_FLAGS }));
    }
  }

  // --- Tabourets (`10d8:1271`) : plus bas, plus devant ; toujours derrière leur occupant ---
  for (const seat of raft.seats) {
    seatFeatures.push(
      features.create({
        script: SEAT_SCRIPT_FIRST + seat.variant - 1,
        delay: FRAME_DELAY,
        depth: 1 + seat.anchor.y / 1000 - 0.0004,
        position: { x: seat.x, y: seat.y },
        flags: SEAT_FLAGS,
      }),
    );
  }

  // --- Père mathieu (`SCRB` 1800 à 1832, objet `72e6`) : l'introduction à la première visite du programme, sinon une animation de repos ---
  const rest = program.visits === 1 ? 1803 : REST_ANIMATIONS[drawFromBag(chatter.bags.rest, REST_ANIMATIONS.length, rng)]!;
  const frog = features.create({ script: rest, delay: FRAME_DELAY, depth: DEPTH_FROG, flags: FeatureFlag.stopAtEnd | FeatureFlag.firstImage });
  frogBusy = true;
  frog.onEvent = (_image, n) => {
    if (n === FEATURE_END) frogBusy = false;
  };

  /** Joue un script du père mathieu ; `hook` reçoit ses événements (octet bas du terminateur − 1), `done` sa fin. */
  function playFrog(script: number, hook: (n: number) => void = () => {}, done?: () => void): void {
    frogBusy = true;
    frog.onEvent = (_image, n) => {
      if (n === FEATURE_END) {
        frogBusy = false;
        done?.();
      } else {
        hook(n);
      }
    };
    features.setScript(frog, script);
  }

  // --- Kit des épreuves ---
  // Au doigt, toucher l'image d'un tabouret libre y assied aussi le Zoombini (`DropTarget.area`, extension tactile du port).
  const seatTargets: DropTarget[] = raft.seats.map((seat) => createTarget(seat.anchor, seat.index, () => seatFeatures[seat.index]?.rect ?? null));
  const seatOf = (target: DropTarget | null): number | null => (target && seatTargets.includes(target) ? (target.tag as number) : null);

  // Voix du narrateur de l'entrée (`DS:a2c4`, `1108:035b`) : 20074 à la première visite du niveau 1, sinon 20073 au niveau 0, sinon l'une des deux.
  const slot = dialogMemoryIndex(SCREEN);
  const choice = dialogChoice(game.dialogMemory[slot]!, level, session.training !== 0);
  game.dialogMemory[slot] = choice.memory;
  const introVoice = choice.choice === 2 ? NARRATOR_FIRST_VISIT : level === 0 ? NARRATOR_FIRST : rng.range(NARRATOR_FIRST, NARRATOR_FIRST_VISIT);

  const kit: PuzzleKit = createPuzzleKit(ctx, {
    screen: SCREEN,
    party,
    places: DOCK_PLACES,
    targets: () => seatTargets,
    introVoice,
    // Boutons de la planche 1400 (`10d8:046d`) dessinés par le kit ; l'image reste enfoncée 2 ticks ; « go » demande un départ (`pressGo`).
    buttons: {
      map: { images: buttons.map, hold: PRESS_TICKS },
      go: {
        images: buttons.go,
        hold: PRESS_TICKS,
        onPress: () => {
          pressGo();
          return true;
        },
      },
      depth: DEPTH_BUTTONS,
    },
    snoid: { scripts: screenScripts(archive) },
    canPick: (member) => kit.walking < 1 && !busy && !departRequested && !member.walking,
    onPointer: (event) => pointer(event),
    // Accepté ou refusé, le Zoombini va d'abord s'asseoir sur le tabouret (à l'ancre quand `10d8:0984` teste) ; `onDrop` renvoie le refusé.
    decide: (info) => {
      verdict = dropOn(play, info.member.index, seatOf(info.target)!);
      return true;
    },
    onPick: (member) => {
      activity();
      // `+0x127 = 0` dès la prise : le Zoombini n'est plus assis, quoi qu'il arrive ensuite (défaut de l'original corrigé).
      pickUp(play, member.index);
      member.snoid.onEnd = undefined;
      member.snoid.onEvent = undefined;
      syncGo();
    },
    // Le tabouret visé rejoue ses 4 images (mise en évidence).
    onHover: (target) => {
      const seat = seatOf(target);
      if (seat === null) return;
      const feature = seatFeatures[seat]!;
      if (feature.queued === 0) features.setScript(feature, feature.scriptId);
    },
    onDrop: (info) => dropped(info),
    onDropOutside: (info) => outside(info),
  });
  kit.arrive({ startDelay: 30, step: 45 });
  kit.playMusic();
  kit.playEntryJingle();
  sound.queue(introVoice);
  ctx.requestPresent();

  // --- Dépôt accepté ou refusé (`10d8:0984`, code 3) ---
  function dropped(info: DropInfo): void {
    const result = verdict!;
    verdict = null;
    const fromDock = seatOf(info.from) === null;
    if (result.accepted) {
      const remark = onAcceptance(chatter, rng, fromDock, seatedCount(play) - 1, party.length);
      if (remark !== null) pendingRemark = remark;
      syncGo();
      return;
    }
    // Refusé : le tabouret est libéré (`1168:1647`), le Zoombini reste à l'ancre le temps de la remarque, puis la grenouille l'éjecte.
    info.target!.owner = null;
    info.member.target = null;
    info.member.waiting = null;
    busy = true;
    refusal = { member: info.member, seat: seatOf(info.target)! };
    pendingRemark = onRefusal(chatter, rng);
    syncGo();
  }

  // --- Dépôt non accepté (`+0x124 == 4`) : sur son propre tabouret, ou hors tabouret libre ---
  function outside(info: DropInfo): OutsidePlacement | undefined {
    const member = info.member;
    const fromSeat = seatOf(info.from);
    if (fromSeat !== null && info.target === info.from) {
      // Relâché sur son propre tabouret : le test se refait, comme pour tout dépôt ; le retour par défaut le rassied.
      verdict = dropOn(play, member.index, fromSeat);
      const remark = onAcceptance(chatter, rng, false, seatedCount(play) - 1, party.length);
      if (remark !== null) pendingRemark = remark;
      syncGo();
      return undefined;
    }
    // Le tabouret quitté reste libre (le kit ne le rend pas) ; le Zoombini n'a plus de place.
    let placement: OutsidePlacement = { at: info.origin };
    if (info.position.x !== info.origin.x || info.position.y !== info.origin.y) {
      if (inDock(info.position.x, info.position.y)) {
        // Il reste là où il est tombé (`+0x116` = point lâché).
        placement = { at: info.position };
      } else {
        // Hors du ponton : il rejoint à pied une place libre (`10d8:1b71`).
        const place = DOCK_PLACES[pickDockPlace(occupancy(member), rng)]!;
        placement = { at: { x: place.x, y: place.y }, walk: true };
      }
    }
    if (pendingRemark === 0 && nearAnchor(info.position)) pendingRemark = NEAR_REMARKS[drawFromBag(chatter.bags.near, NEAR_REMARKS.length, rng)]!;
    syncGo();
    return placement;
  }

  function nearAnchor(point: Point): boolean {
    return raft.seats.some((seat) => Math.abs(seat.anchor.x - point.x) <= NEAR_RADIUS && Math.abs(seat.anchor.y - point.y) <= NEAR_RADIUS);
  }

  /** Occupation du ponton (`DS:9714`) : les Zoombinis au repos (ni en marche, ni transportés, pas assis), sauf `except`. */
  function occupancy(except: KitMember | null): (number | null)[] {
    const resting = kit.members
      .filter((m) => m !== except && !m.walking && kit.carrying !== m && !m.snoid.destroyed && play.seatOf[m.index] === null)
      .map((m) => ({ member: m.index, x: m.snoid.position.x, y: m.snoid.position.y }));
    return dockOccupancy(resting);
  }

  function activity(): void {
    lastActivity = ctx.clock.ticks;
  }

  /** « go » actif dès qu'un Zoombini est assis (`72e0`). */
  function syncGo(): void {
    kit.goEnabled = goEnabled(play);
    if (kit.goEnabled !== lastGoState) {
      lastGoState = kit.goEnabled;
      features.invalidate();
    }
  }

  function pressGo(): void {
    activity();
    if (!kit.goEnabled || departRequested || kit.left) return;
    sound.stopEffects();
    sound.queue(SOUND_MAP);
    departRequested = true;
  }

  // --- Éjection (`10d8:1614`, `10d8:0ff0`) ---
  function launchRejection(): void {
    const { member, seat } = refusal!;
    refusal = null;
    const { variant, place } = drawRejection(chatter, occupancy(member), rng);
    lastVariant = variant;
    const spot = DOCK_PLACES[place]!;
    const script = frogAction(variant, rng);
    const arrival: Point = variant === 0 ? { ...FAR_ARRIVAL } : isSplash(variant) ? { ...SPLASH_ENTRY } : { x: spot.x, y: spot.y };
    const current: Ejection = { member, seat, variant, place, arrival };
    action = current;
    member.snoid.onEvent = (n) => rejectEvent(current, n);
    playFrog(script, (n) => rejectEvent(current, n));
  }

  /** Rappel `10d8:0ff0` : événements du père mathieu, du Zoombini, du tabouret et des éclaboussures (octet bas du terminateur − 1). */
  function rejectEvent(current: Ejection, n: number): void {
    if (action !== current) return;
    const { member, variant } = current;
    const snoid = member.snoid;
    const spot = DOCK_PLACES[current.place]!;
    switch (n) {
      case 1:
        // Le tabouret bascule, le Zoombini s'envole (`10d8:0f15`, `0f7f`).
        ejectStool(seatFeatures[current.seat]!, SEAT_EJECT_SCRIPTS[variant]!);
        snoid.play(EJECT_FLIGHTS[variant]!, FeatureFlag.stopAtEnd, { kind: "reject" });
        break;
      case 2:
        // Fin de l'envol.
        if (EJECT_ARRIVALS[variant] === SPLASH_ARRIVAL) {
          splash(current);
        } else {
          snoid.onEvent = undefined;
          snoid.play(EJECT_ARRIVALS[variant]!, FeatureFlag.stopAtEnd, { kind: "reject", at: current.arrival });
          snoid.onEnd = () => settle(current, current.arrival);
          busy = false;
        }
        break;
      case 3:
        // Chute dans l'eau : le Zoombini apparaît à l'entrée de l'éclaboussure.
        snoid.moveTo(SPLASH_ENTRY);
        snoid.play(SPLASH_ARRIVAL, FeatureFlag.stopAtEnd, { kind: "reject", at: SPLASH_ENTRY });
        break;
      case 4:
        // Il nage : script `998 + 2 × pieds` depuis (93, 408).
        snoid.moveTo(SWIM_START);
        snoid.play(998 + 2 * snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal" });
        break;
      case 5:
        // Fin de la nage : il marche jusqu'à sa place (`999 + 2 × pieds`, 34 images) ; les événements suivants sont ceux de `10d8:1209`.
        snoid.onEvent = (m) => {
          if (m === 6) sideSplash(current, spot);
        };
        snoid.play(999 + 2 * snoid.traits.feet, FeatureFlag.stopAtEnd, { kind: "normal", at: spot });
        snoid.onEnd = () => settle(current, spot);
        busy = false;
        break;
      case 6:
        // « Après la baignade » : une remarque si aucune n'est en attente (`10d8:0ff0` cas 6).
        if (pendingRemark === 0) pendingRemark = BATH_REMARKS[drawFromBag(chatter.bags.bath, BATH_REMARKS.length, rng)]!;
        break;
    }
  }

  /** `10d8:0f15` : le tabouret joue son basculement sans le drapeau « relatif » (il garde la référence de son image), puis revient à son image. */
  function ejectStool(stool: Feature, script: number): void {
    stool.queued = 0;
    stool.flags &= ~FeatureFlag.relative;
    features.setScript(stool, script);
    stool.flags |= FeatureFlag.relative;
  }

  /** Le Zoombini est de nouveau sur le ponton, en pose d'attente (`+0x127 = 0`, `72c4 = 0`). */
  function settle(current: Ejection, at: Point): void {
    if (action !== current) return;
    const { member } = current;
    member.snoid.onEnd = undefined;
    member.snoid.onEvent = undefined;
    member.snoid.moveTo(at);
    member.snoid.idle();
    features.restack(member.snoid.feature, 1 + at.y / 1000);
    member.target = null;
    member.waiting = null;
    action = null;
    busy = false;
  }

  /** Variantes 7 à 9 : les éclaboussures 1704 et 1705 (`72d6`) ; le Zoombini tombe à l'eau. */
  function splash(current: Ejection): void {
    const onEvent = (n: number): void => rejectEvent(current, n);
    effect(SPLASH_FLOOR, { flags: 0, onEvent });
    effect(SPLASH_WATER, { flags: 0, onEvent });
  }

  /** `10d8:1209` n = 6 : l'éclaboussure latérale 1706, à `place − 14`, joue quand le Zoombini sort de l'eau. */
  function sideSplash(_current: Ejection, spot: Point): void {
    effect(SPLASH_SIDE, { position: { x: spot.x - SPLASH_SIDE_OFFSET, y: spot.y - SPLASH_SIDE_OFFSET }, flags: FeatureFlag.relative });
  }

  // --- Départ (`10d8:0615` étape 1, `10d8:17af`) ---
  function startDeparture(): void {
    departRequested = false;
    departing = true;
    pendingRemark = 0;
    // Le départ décide seul de l'écran suivant : le kit ne traite plus ni clics ni avertissement (seul `onPointer` reste à l'écoute).
    kit.suspend();
    // `11a8:20e8` : le plancher et les ambiances disparaissent (le départ redessine le plancher).
    features.destroy(raftBase);
    if (ambient) features.destroy(ambient);
    for (const m of kit.members) {
      m.zoombini.present = play.seatOf[m.index] !== null;
      m.snoid.onEnd = undefined;
      m.snoid.onEvent = undefined;
    }
    playFrog(
      departureScript(rng),
      (n) => shiftRaft(n),
      () => finishDeparture(),
    );
  }

  /** `10d8:17af(n)` : le radeau tout entier (assis, tabourets, décors) glisse de `n` pixels vers la droite. */
  function shiftRaft(dx: number): void {
    shifted += dx;
    const shift = (feature: Feature): void => {
      feature.position.x += dx;
      for (const part of feature.parts) part.x += dx;
      if (feature.rect) feature.rect = { ...feature.rect, left: feature.rect.left + dx, right: feature.rect.right + dx };
    };
    seatFeatures.forEach(shift);
    decorFeatures.forEach(shift);
    for (const m of kit.members) {
      if (play.seatOf[m.index] === null) continue;
      const at = m.snoid.position;
      m.snoid.moveTo({ x: at.x + dx, y: at.y });
    }
    features.invalidate();
  }

  function finishDeparture(): void {
    if (!departing) return;
    departing = false;
    kit.finish("success");
  }

  /** Clics (`10d8:0984`) : tout appui compte comme activité ; pendant le départ, il court-circuite l'attente. */
  function pointer(event: PointerInfo): boolean {
    if (!event.down || event.button !== "left") return false;
    if (departing) {
      finishDeparture();
      return true;
    }
    activity();
    return false;
  }

  // --- Tick (`10d8:0615`) ---
  function tick(): void {
    const now = ctx.clock.ticks;
    // Le kit gère les clics, l'image enfoncée des boutons, l'arrivée et les prises ; gelé (départ), il ne transmet que le pointeur.
    kit.tick();
    if (departing || kit.left) return;
    // Départ demandé : seulement quand plus rien n'est en cours (`72d4 == 0`, `72c4 == 0`).
    if (departRequested && refusal === null && !busy) {
      startDeparture();
      return;
    }
    if (pendingRemark !== 0) {
      // Réplique en attente : le père mathieu la joue dès qu'il est libre (`72d2`).
      if (!frogBusy) {
        lastRemark = pendingRemark;
        const script = pendingRemark;
        pendingRemark = 0;
        playFrog(script);
      }
    } else if (refusal !== null) {
      if (!frogBusy) launchRejection();
    } else if (!busy && !frogBusy && action === null && now - lastActivity > idleLimit) {
      // Réplique d'inactivité (`72b8`).
      activity();
      pendingRemark = IDLE_REMARKS[drawFromBag(chatter.bags.idle, IDLE_REMARKS.length, rng)]!;
      idleLimit = rng.range(IDLE_RANGE.min, IDLE_RANGE.max);
    }
  }

  probe?.({
    kit,
    play,
    raft,
    seatFeatures,
    frog,
    party,
    get busy() {
      return busy;
    },
    get departing() {
      return departing || departRequested;
    },
    get variant() {
      return lastVariant;
    },
    get shifted() {
      return shifted;
    },
    get lastRemark() {
      return lastRemark;
    },
  });

  return {
    kit,
    tick,
    activity,
    stop() {
      // Les historiques de tirage restent à la mémoire du programme.
      program.chatter.bags = chatter.bags;
      kit.leave();
    },
  };
}
