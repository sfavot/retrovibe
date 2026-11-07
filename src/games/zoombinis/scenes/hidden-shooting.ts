/**
 * Écran caché 19 (et son doublon 21) : le tir aux Zoombinis (`PICKER.MHK`, `1110:20f6` Enter, `1110:2354` Exit, `1110:23ac` Tick, `1110:24e8` clic, `1110:2b0f` touches,
 * `1110:28ed` passant, `1110:28a1` fin du tir, `1110:2b23` score, `1110:2bfb` viseur ; `docs/zoombinis/screens.md` §1.7). On y arrive par le lieu 9 de la carte, en
 * entraînement, juste après avoir tapé le code secret de l'écran (`game/route.ts`, `mapClick`).
 *
 * Ce que fait l'original (sûr, désassemblage) :
 * - décor : fond `tBMP` / `SHPL` 1001 ; groupe 0 = planche 1100 (`SCRB` 1100 à 1104 : cinq décors fixes ; 1105 : le viseur), groupe 1 = planche 1200 avec ses `REGS`
 *   (`SCRB` 1200 : tir réussi, son 1200 et évènement 0 à l'image 1 ; 1201 : tir manqué, son 1201 ; 1202 : décor fixe ; 1203 : les six chiffres du tableau ; 1204 :
 *   fin de partie) ; musique 30025 ; le pointeur système est masqué et le viseur (image 6, point chaud (14, 13)) suit la souris à chaque tour (`1110:2bfb`) ;
 * - des Zoombinis aux quatre attributs tirés au hasard traversent l'écran en ligne droite (`1110:28ed`) : loin du pointeur (pointeur dans la moitié haute, `y ≤ 240` :
 *   trajets 1 à 3 en bas ; sinon trajets 4 à 6 en haut), sens tiré à pile ou face, délai entre deux pas `DS:8588` (8 au départ, moins 1 une fois sur quatre), et une
 *   voix de Zoombini au départ ; trois places au plus (`DS:8812`), un nouveau passant au plus tôt 20 à 120 ticks après le précédent ; le nombre de places servies dépend
 *   du score ; un passant arrivé est retiré ;
 * - un clic (n'importe quel bouton) tire, s'il reste des coups (`DS:8582`, 9 au départ) et qu'aucun tir n'est en cours (`DS:87ec`) : un Zoombini est touché si le point
 *   est dans son rectangle, à 12 points au plus du centre, et hors des trois zones de décor de premier plan (`DS:16d4`) ; touché, il s'arrête 240 ticks et disparaît à
 *   l'image 1 de l'animation du tir, le score (`DS:8584`) monte, la série (`DS:8564`) rend des coups (5 à 20, dans la limite de 99 − score − coups), la cadence des
 *   passants accélère (`DS:8588` de 8 à 1 aux scores 5, 10, 20, 40, 60, 80 et 90) et aucun passant ne part avant la fin de l'animation ; manqué, la série retombe à 0 ;
 * - le tableau (`SCRB` 1203, `1110:2b23`) montre le meilleur score (`S+0x22`, tenu à jour ici), le score (remis à 0 au-delà de 99) et les coups restants ;
 * - plus de coups : le `SCRB` 1204 s'affiche, le viseur s'arrête et le pointeur revient ; un clic dans le rectangle où le viseur s'est arrêté relance une partie ;
 * - un clic dans le carré (7, 7)–(41, 41) (`DS:85a6`) ramène à la carte ; les touches ne font rien (`1110:2b0f`).
 *
 * Écarts : les animations de tir sont dessinées devant tout (l'original met celle d'un tir réussi juste devant le Zoombini touché, `11a8:2a0a` ; un tir n'est réussi
 * qu'hors des zones de premier plan, le rendu est donc le même) ; les passants vont en ligne droite (aucune carte `NODE` n'est chargée par l'écran, **probable**) ; la
 * logique s'arrête pendant qu'une boîte de dialogue est ouverte.
 */
import type { Archive } from "../../../engine/mohawk/resources";
import type { Fade } from "../../../engine/mohawk/graphics/palette";
import { snoidVoiceId } from "../data/zoombini";
import { DIALOG } from "../engine/dialog";
import { FEATURE_END, FEATURES, FeatureFlag, type Feature, type FeaturePart, type Features } from "../engine/features";
import { ZOOMBINIS_GAME, type ZoombinisGame } from "../engine/game";
import type { Scene, SceneContext } from "../engine/scene";
import { ScreenId } from "../engine/scene";
import { ZOOMBINIS_SOUND } from "../engine/sound";
import { makeZoombini } from "../game/state";
import { closeScreen, fadeInScreen, fadeOutScreen, openScreen } from "./screen-kit";
import { createSnoid, type Snoid } from "./snoid";

const ARCHIVE = "PICKER.MHK";
/** Fond et palette (`11a8:1475(1001)`). */
const BACKGROUND = 1001;
/** Groupes de formes (`11a0:0000(0, 0, 1100)`, `11a0:0000(1, 1, 1200)`) et plages de scripts (`11a8:14ab(6, 1100)`, `11a8:15a6(0, 5, 1200)`). */
const DECOR_SHEET = 1100;
const SHOT_SHEET = 1200;
const DECOR_SCRIPTS = 6;
const SHOT_SCRIPTS = 5;
/** Les cinq décors fixes (`SCRB` 1100 à 1104), le viseur (1105). */
const DECOR_FIRST = 1100;
const DECOR_COUNT = 5;
const CROSSHAIR = 1105;
/** Point chaud du viseur : position de référence `(14, 13)` passée à `11a8:0ad6` par `1110:2210`. */
const CROSSHAIR_HOTSPOT = { x: 14, y: 13 } as const;
/** Tir réussi, tir manqué, décor, tableau, fin de partie. */
const SHOT_HIT = 1200;
const SHOT_MISS = 1201;
const PANEL = 1202;
const SCOREBOARD = 1203;
const GAME_OVER = 1204;
/** Musique (`11a0:0ee7(0, 30025)`) ; les sons 1200 et 1201 (chargés à l'avance par `1028:0000`) sont joués par les scripts de tir. */
const MUSIC = 30025;

/** Carré de retour à la carte (`DS:85a6`, droite et bas exclus). */
const EXIT_BOX = { left: 7, top: 7, right: 41, bottom: 41 } as const;
/** Zones de décor de premier plan où aucun tir ne touche (`DS:16d4`). */
const SHIELDS = [
  { left: 529, top: 125, right: 639, bottom: 197 },
  { left: 227, top: 155, right: 356, bottom: 205 },
  { left: 415, top: 425, right: 639, bottom: 479 },
] as const;
/** Écart maximal entre le point visé et le centre du Zoombini (`1110:24e8`). */
const AIM_TOLERANCE = 12;

/** Partie neuve (`1110:20f6`, `1110:281c`) : coups, place restante pour les coups rendus (`99 − score − coups`), délai entre deux pas. */
const START_SHOTS = 9;
const START_ROOM = 90;
const START_DELAY = 8;
const MAX_TOTAL = 99;
/** Paliers de score → délai entre deux pas des passants (`1110:26a9`). */
const SPEED_STEPS: readonly (readonly [number, number])[] = [
  [5, 7],
  [10, 6],
  [20, 5],
  [40, 4],
  [60, 3],
  [80, 2],
  [90, 1],
];
/** Places de passants (`DS:8812`). */
const WALKER_SLOTS = 3;
/** Un Zoombini touché s'arrête 240 ticks (`+0x24 = maintenant + 0xf0`). */
const HIT_FREEZE = 0xf0;
/** Codes de voix tirés au départ d'un passant (`1110:2a87`, tirage de 1 à 9). */
const WALKER_VOICES = [6, 12, 10, 9, 0, 1, 11, 2, 8] as const;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function contains(rect: Rect, x: number, y: number): boolean {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

/** Coups rendus par une série de `streak` tirs réussis (`1110:2616`). */
export function streakBonus(streak: number): number {
  if (streak <= 1) return 0;
  if (streak <= 3) return 5;
  if (streak <= 5) return 10;
  if (streak <= 7) return 15;
  return 20;
}

/**
 * Nombre de places de passants servies pour un score (`1110:23ac`, la boucle s'arrête après la place 0, 1 ou 2) : 1 jusqu'à 9, 2 de 10 à 14, 3 de 15 à 19, 2 de 20 à 39,
 * 1 de 40 à 59, 2 de 60 à 79, 3 à 80, 1 au-delà.
 */
export function walkerSlots(score: number): number {
  if (score < 10) return 1;
  if (score < 15) return 2;
  if (score < 20) return 3;
  if (score < 40) return 2;
  if (score < 60) return 1;
  if (score < 80) return 2;
  if (score > 80) return 1;
  return WALKER_SLOTS;
}

/** Trajet d'un passant (`1110:28ed`) : départ et arrivée, à la même ordonnée. */
export interface WalkerRoute {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/**
 * `1110:28ed` : trajet d'un nouveau passant selon l'ordonnée du pointeur. `range(lo, hi)` est `10a8:04e8(hi, lo)` (bornes incluses), appelé dans l'ordre de l'original :
 * trajet, ordonnée, pile ou face du sens.
 */
export function walkerRoute(pointerY: number, range: (lo: number, hi: number) => number): WalkerRoute {
  const kind = pointerY > 0xf0 ? range(4, 6) : range(1, 3);
  let y: number;
  let start: number;
  let end: number;
  switch (kind) {
    case 1:
      y = range(0xe6, 0x10e);
      [start, end] = [-20, 0x294];
      break;
    case 2:
      y = range(0x17c, 0x1c2);
      [start, end] = [-20, 0x294];
      break;
    case 3:
      y = range(0x145, 0x14f);
      [start, end] = [0x145, 0x294];
      break;
    case 4:
      y = range(0xa5, 0xb9);
      [start, end] = [0x148, 0x22d];
      break;
    case 5:
      y = range(0xa5, 0xb9);
      [start, end] = [-20, 0x22d];
      break;
    default:
      y = range(0xa5, 0xb9);
      [start, end] = [-20, 0xfa];
  }
  if (range(1, 100) <= 50) [start, end] = [end, start];
  return { from: { x: start, y }, to: { x: end, y } };
}

/** `1110:2b23` : chiffres du tableau (meilleur score, score, coups), deux par nombre, ajoutés à l'image de base `base` (le « 0 » de la planche). */
export function scoreboardDigits(best: number, score: number, shots: number): number[] {
  return [Math.trunc(best / 10), best % 10, Math.trunc(score / 10), score % 10, Math.trunc(shots / 10), shots % 10];
}

interface ShootingState {
  /** `DS:8584` score, `DS:8582` coups, `DS:8586` place pour les coups rendus, `DS:8564` série, `DS:8588` délai des passants. */
  score: number;
  shots: number;
  room: number;
  streak: number;
  walkDelay: number;
  /** `DS:87ec` : tir en cours (0 aucun, 1 manqué, 2 réussi). */
  shooting: 0 | 1 | 2;
  /** `DS:3fdc` : de nouveaux passants peuvent partir. */
  spawning: boolean;
  /** `DS:8818` : premier tick où un passant peut partir. */
  nextSpawn: number;
}

export function createHiddenShootingScene(): Scene {
  let archive: Archive;
  let features: Features;
  let zoombinis: ZoombinisGame;
  let state: ShootingState;
  let crosshair: Feature;
  /** `+0xe0` du viseur : il suit la souris (faux une fois la partie finie). */
  let aiming = true;
  let hitShot: Feature;
  let missShot: Feature;
  let scoreboard: Feature;
  let gameOver: Feature | null = null;
  /** Zone de relance (`DS:865a`) : le rectangle du viseur arrêté. */
  let restartZone: Rect | null = null;
  const walkers: (Snoid | null)[] = [];
  /** `DS:855e` : le Zoombini touché, qui disparaît à l'évènement 0 du tir réussi. */
  let target: Snoid | null = null;
  let fadeIn: Fade | null = null;
  let fadeOut: Fade | null = null;
  let left = false;

  function newRound(): ShootingState {
    return { score: 0, shots: START_SHOTS, room: START_ROOM, streak: 0, walkDelay: START_DELAY, shooting: 0, spawning: true, nextSpawn: 0 };
  }

  /** Rectangle du viseur, à partir de sa partie courante. */
  function crosshairRect(): Rect | null {
    const part = crosshair.parts[0];
    const shape = part && features.group(0)?.images[part.w - 1];
    return part && shape ? { left: part.x, top: part.y, right: part.x + shape.width, bottom: part.y + shape.height } : null;
  }

  /** `1110:2bfb` : le viseur est posé au pointeur moins son point chaud (sans `REGS`), à chaque tour où il est actif. */
  function aim(ctx: SceneContext): void {
    if (!aiming) return;
    const x = ctx.input.mouseX - CROSSHAIR_HOTSPOT.x;
    const y = ctx.input.mouseY - CROSSHAIR_HOTSPOT.y;
    const part = crosshair.parts[0];
    if (part && part.x === x && part.y === y) return;
    crosshair.parts = crosshair.parts.map((p) => ({ ...p, x, y }));
    features.invalidate();
  }

  /** `11a8:1b89(0, 0, 0, tableau)` : le tableau relit son image (et `1110:2b23` refait les chiffres). */
  function refreshScore(): void {
    features.setScript(scoreboard);
  }

  /** `1110:2b23` : rappel d'image du tableau. */
  function scoreImage(_feature: Feature, parts: FeaturePart[]): FeaturePart[] {
    const game = zoombinis.game;
    if (state.score > MAX_TOTAL) state.score = 0;
    if (game.shootingHighScore < state.score) game.shootingHighScore = state.score;
    const base = parts[0]?.w ?? 0;
    const digits = scoreboardDigits(game.shootingHighScore, state.score, state.shots);
    return parts.map((part, i) => ({ ...part, w: base + (digits[i] ?? 0) }));
  }

  /** `1110:28ed` : un nouveau passant. */
  function spawnWalker(ctx: SceneContext): Snoid {
    const rng = ctx.rng;
    const attrs = [rng.range(1, 5), rng.range(1, 5), rng.range(1, 5), rng.range(1, 5)];
    const route = walkerRoute(ctx.input.mouseY, (lo, hi) => rng.range(lo, hi));
    let delay = state.walkDelay;
    if (delay > 1 && rng.range(1, 100) < 0x1a) delay -= 1;
    const snoid = createSnoid(ctx, makeZoombini(attrs), { position: route.from, delay });
    snoid.walkTo(route.to);
    const code = WALKER_VOICES[rng.range(1, 9) - 1]!;
    ctx.services.get(ZOOMBINIS_SOUND).queue(snoidVoiceId(code, snoid.traits, (lo, hi) => rng.range(lo, hi)));
    return snoid;
  }

  /** `1110:28a1` : évènements de l'animation de tir (0 : le Zoombini touché disparaît ; fin : le tir est fini, les passants repartent). */
  function shotEvent(_image: number, n: number, feature: Feature): void {
    if (n === 0) {
      target?.destroy();
      target = null;
    } else if (n === FEATURE_END) {
      // La dernière image du script n'a qu'une case vide : l'original vide alors le tampon des parties (rien n'est dessiné), `Features` garde l'image précédente.
      feature.parts = [];
      features.invalidate();
      if (state.shooting === 2) state.spawning = true;
      state.shooting = 0;
    }
  }

  /** Zoombini sous le point (`11a8:0d61(1, 1, point)`) : le plus en avant dont le rectangle contient le point. */
  function walkerAt(x: number, y: number): Snoid | null {
    const order = features.features;
    let best: Snoid | null = null;
    let bestIndex = -1;
    for (const walker of walkers) {
      const rect = walker?.feature.rect;
      if (!walker || !rect || !contains(rect, x, y)) continue;
      const index = order.indexOf(walker.feature);
      if (index > bestIndex) [best, bestIndex] = [walker, index];
    }
    return best;
  }

  /** `1110:24e8` : un clic. */
  function click(ctx: SceneContext, x: number, y: number): void {
    if (contains(EXIT_BOX, x, y)) {
      fadeOut = fadeOutScreen(ctx);
      return;
    }
    let hit = walkerAt(x, y);
    const rect = hit?.feature.rect;
    if (hit && rect) {
      const dx = Math.trunc((rect.left + rect.right) / 2) - x;
      const dy = Math.trunc((rect.top + rect.bottom) / 2) - y;
      if (Math.abs(dx) > AIM_TOLERANCE || Math.abs(dy) > AIM_TOLERANCE) hit = null;
    }
    if (SHIELDS.some((shield) => contains(shield, x, y))) hit = null;
    if (state.shooting === 0 && state.shots !== 0) {
      state.shots -= 1;
      state.shooting = 1;
      let shot: Feature;
      if (!hit) {
        state.streak = 0;
        shot = missShot;
      } else {
        state.streak += 1;
        const bonus = streakBonus(state.streak);
        if (bonus !== 0 && state.room !== 0) state.shots += Math.min(bonus, state.room);
        shot = hitShot;
        hit.feature.next = ctx.clock.ticks + HIT_FREEZE;
        target = hit;
        const slot = walkers.indexOf(hit);
        if (slot >= 0) walkers[slot] = null;
        state.score += 1;
        for (const [score, delay] of SPEED_STEPS) if (state.score === score) state.walkDelay = delay;
        state.spawning = false;
        state.shooting = 2;
      }
      shot.position.x = x;
      shot.position.y = y;
      shot.onEvent = shotEvent;
      shot.notifyEnd = true;
      features.setScript(shot);
      state.room = MAX_TOTAL - state.score - state.shots;
      refreshScore();
      if (state.shots === 0 && !gameOver) {
        gameOver = features.create({ script: GAME_OVER, delay: 1 });
        restartZone = crosshairRect();
        aiming = false;
        ctx.setCursor("system");
      }
    } else if (state.shots === 0 && gameOver && restartZone && contains(restartZone, x, y)) {
      state = newRound();
      features.destroy(gameOver);
      gameOver = null;
      refreshScore();
      aiming = true;
      ctx.setCursor("hidden");
    }
  }

  /** `1110:23ac` : passants arrivés retirés, nouveaux passants. */
  function updateWalkers(ctx: SceneContext): void {
    for (let i = 0; i < WALKER_SLOTS; i++) {
      const walker = walkers[i];
      if (walker && !walker.walking) {
        walker.destroy();
        walkers[i] = null;
      }
    }
    const now = ctx.clock.ticks;
    if (!(state.nextSpawn < now) || state.shots === 0) return;
    const served = walkerSlots(state.score);
    for (let i = 0; state.spawning && i < served; i++) {
      if (walkers[i]) continue;
      walkers[i] = spawnWalker(ctx);
      state.nextSpawn = ctx.clock.ticks + ctx.rng.range(0x14, 0x78);
    }
  }

  return {
    async load(ctx: SceneContext) {
      archive = await ctx.resources.open(ARCHIVE);
    },
    enter(ctx: SceneContext) {
      zoombinis = ctx.services.get(ZOOMBINIS_GAME);
      features = ctx.services.get(FEATURES);
      zoombinis.session.screen = ctx.scenes.currentId ?? ScreenId.hiddenShooting;
      state = newRound();
      walkers.length = 0;
      walkers.push(null, null, null);
      target = null;
      gameOver = null;
      restartZone = null;
      aiming = true;
      fadeOut = null;
      left = false;
      openScreen(ctx, archive, { background: BACKGROUND });
      features.defineGroup(0, DECOR_SHEET);
      features.defineGroup(1, SHOT_SHEET, true);
      features.setScripts(DECOR_FIRST, DECOR_SCRIPTS);
      features.addScripts(SHOT_HIT, SHOT_SCRIPTS);
      // `11a8:231b` : les passants passent devant ou derrière les décors selon leur bord bas.
      features.setDepthSort(true);
      for (let i = 0; i < DECOR_COUNT; i++) features.create({ script: DECOR_FIRST + i, delay: 0 });
      crosshair = features.create({
        script: CROSSHAIR,
        delay: 1,
        // Image lue une fois ; `aim` la repose ensuite à chaque tour (le rappel `1110:2bfb` remplace l'interpréteur).
        flags: FeatureFlag.overlay | FeatureFlag.firstImage | FeatureFlag.stopEachImage,
      });
      // Animations de tir : posées hors de l'écran (0, 480), image 0 lue sans son puis arrêtées ; relancées à chaque tir (`11a8:1b89`).
      const shotFlags = FeatureFlag.playOnly | FeatureFlag.relative | FeatureFlag.stopAtEnd | FeatureFlag.noReplay | FeatureFlag.overlay;
      hitShot = features.create({ script: SHOT_HIT, delay: 1, position: { x: 0, y: 480 }, flags: shotFlags });
      missShot = features.create({ script: SHOT_MISS, delay: 1, position: { x: 0, y: 480 }, flags: shotFlags });
      features.create({ script: PANEL, delay: 0 });
      scoreboard = features.create({ script: SCOREBOARD, delay: 1, flags: FeatureFlag.stopAtEnd, onImage: scoreImage });
      ctx.setCursor("hidden");
      fadeIn = fadeInScreen(ctx);
      ctx.services.get(ZOOMBINIS_SOUND).queue(MUSIC);
    },
    leave(ctx: SceneContext) {
      for (const walker of walkers) walker?.destroy();
      walkers.length = 0;
      closeScreen(ctx);
    },
    tick(ctx: SceneContext) {
      if (fadeOut) {
        // `1110:2354` (fondu de sortie, bloquant) puis la carte ; plus rien ne bouge en attendant.
        if (fadeOut.done && !left) {
          left = true;
          zoombinis.goTo(ctx, ScreenId.map);
        }
        return;
      }
      if (fadeIn && !fadeIn.done) return;
      fadeIn = null;
      if (ctx.services.get(DIALOG).isOpen) return;
      aim(ctx);
      updateWalkers(ctx);
      for (const event of ctx.input.buttonEvents) {
        if (fadeOut) return;
        if (event.down) click(ctx, event.x, event.y);
      }
    },
    key() {
      return false;
    },
  };
}
