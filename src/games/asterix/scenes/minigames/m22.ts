import type { Play } from "../game";
import { DOWN, UP, type Script } from "../runtime";
import { changeSesterces } from "../squares";
import { Anim, BOTTOM_HALF, EffectLoop, TOP_HALF, beginPlay, endPlay, fadeSoundOut, flushInput, restoreRects, touchDirs, waitFrame, type Rect } from "./common";

/**
 * Mini-jeu « Des poissons pas très frais » (case 2, `MDF/22`, segment `2580` : `2580:03b3` et ses trois fonctions).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m22.md`.
 *
 * Pendant 30 secondes, des poissons traversent l'écran de gauche à droite sur trois hauteurs. Le joueur, debout à
 * droite, saute par-dessus ceux du bas, se baisse sous ceux du milieu et laisse passer ceux du haut sans sauter.
 * Touché, il perd ; sinon il gagne 1 sesterce.
 */
export const MODULE = 22;

/** Durée de l'épreuve en secondes (chrono 2). */
export const DURATION = 30;
/** Une image tous les 6 ticks (`1831:030a(6)`) : 10 images par seconde. */
export const FRAME_TICKS = 6;
/** Sesterces gagnés (`1d24:0912(joueur, 1, 1)`). */
export const GAIN = 1;

/** Couloirs des poissons, dans l'ordre du tirage `rnd() % 3` : ordonnée (`DS:7110`) et vitesse de base en pixels par image. */
export const LANES = [
  { y: 0xda, speed: 0x1a },
  { y: 0x84, speed: 0x1a },
  { y: 0x57, speed: 0x1e },
] as const;
export const [LANE_BOTTOM, LANE_MIDDLE, LANE_TOP] = LANES.map((lane) => lane.y);
/** Gain de vitesse par niveau Action du joueur (0, 1, 2). */
export const SPEED_PER_LEVEL = 4;

/** Le poisson touche quand son abscisse (après son pas) est strictement entre ces bornes. */
export const HIT_MIN_X = 0x113;
export const HIT_MAX_X = 0x168;
/** Abscisse au-delà de laquelle le poisson a fini sa course. */
const FISH_END_X = 0x1fe;

/** Animations de `m22sa000.hy8` : attente, se baisser, sauter, poisson, étoiles. */
const ANIM_IDLE = 0;
const ANIM_DUCK = 1;
const ANIM_JUMP = 2;
const ANIM_FISH = 3;
const ANIM_DAZED = 4;

/**
 * Posture du joueur (`DS:711b`). Avant le choc : 0 debout, 1 baissé, 2 en saut. Après le choc, c'est le numéro de
 * l'animation de `m22sa001.hy8` : 0 debout touché au milieu, 1 debout touché en bas, 2 baissé touché en bas, 3 en saut
 * touché en haut, 4 en saut touché au milieu ; puis 4 pendant les étoiles.
 */
export const POSE_STANDING = 0;
export const POSE_DUCKING = 1;
export const POSE_JUMPING = 2;

/** Joueur : ancre du sprite debout, et ordonnée des étoiles après le choc. */
const HERO_X = 0xfd;
const HERO_Y = 0xc5;
const DAZED_Y = 0x75;
/** Zones restaurées à chaque image : celle du joueur ; après le choc, presque tout l'écran à droite de x = 83. */
const HERO_RECT: Rect = [0x99, 0x19, 0x152, 0xc5];
const HIT_RECT: Rect = [0x53, -13, 0x15f, 0xde];

/** Clé du dossier de voix `MDF/22` (`DS:6412 = 0x3f`) : `K22TE01`, la remarque du perdant. */
const VOICE_KEY = 63;

/** Décision D11 : toucher ou cliquer la moitié haute de l'écran fait sauter, la moitié basse se baisser. */
const TOUCH = [
  [TOP_HALF, UP],
  [BOTTOM_HALF, DOWN],
] as const;

/** État du mini-jeu (globales `DS:710c` à `DS:711b`), exposé aux robots par `rt.hint.state`. */
export interface PoissonsState {
  /** `DS:7116` : un poisson est en vol. */
  fishActive: boolean;
  /** `DS:7112` : abscisse du poisson (dessiné en `x − 32`). */
  fishX: number;
  /** `DS:7110` : ordonnée du couloir du dernier poisson (dessiné en `y − 40`), 0 avant le premier. */
  lane: number;
  /** `DS:710c` : pixels par image. */
  speed: number;
  /** `DS:710e` : indice du dernier couloir tiré (jamais deux fois de suite le même). */
  lastLane: number;
  /** `DS:7114` : le poisson suivant part quand le chrono 3 dépasse ce nombre de secondes. */
  delay: number;
  /** `DS:711b`. */
  pose: number;
  /** `DS:7118` : touché. */
  hit: boolean;
  /** `DS:7117` : animation du choc finie, étoiles en cours. */
  dazed: boolean;
  /** `DS:7119` et `DS:711a` : fin de la boucle. */
  lost: boolean;
  won: boolean;
}

/** `2580:03b3`. */
export function* poissons(play: Play): Script {
  const { rt, board } = play;
  const { surface, resources } = rt.ctx;
  const player = board.player;
  const [throwSound, jumpSound, duckSound, hitSound, dazedSound, heroSheet, hitSheet] = yield* rt.load(
    Promise.all([
      resources.sound("m22b0004.voc"),
      resources.sound("m22b0000.voc"),
      resources.sound("m22b0001.voc"),
      resources.sound("m22b0002.voc"),
      resources.sound("m22b0003.voc"),
      resources.hy8("m22sa000.hy8"),
      resources.hy8("m22sa001.hy8"),
    ]),
  );
  yield* rt.picture("M22DA000.mcc", 3);

  const s: PoissonsState = {
    fishActive: false,
    fishX: 0,
    lane: 0,
    speed: 0,
    lastLane: 0,
    delay: 1,
    pose: POSE_STANDING,
    hit: false,
    dazed: false,
    lost: false,
    won: false,
  };
  const fish = new Anim(heroSheet);
  fish.select(ANIM_FISH);
  const hero = new Anim(heroSheet);
  hero.step();
  const dazedLoop = new EffectLoop(rt);
  /** Dernière image présentée (`DS:402e`, la mémoire vidéo) : le choc la fige dans le fond. */
  const screen = new Uint8Array(surface.work.length);
  const fishBand = (): Rect => [-0x20, s.lane - 0x32, 0x15f, s.lane - 0x1e];

  /** `2580:000d` : le poisson en vol avance ; sinon un nouveau part, 2 ou 3 secondes après la sortie du précédent. */
  const stepFish = (): void => {
    if (s.fishActive) {
      fish.step();
      fish.draw(rt, s.fishX - 0x20, s.lane - 0x28);
      s.fishX += s.speed;
      if (s.fishX > FISH_END_X) {
        s.fishActive = false;
        rt.startChrono(3);
        s.delay = (rt.rnd() & 1) + 1;
      }
    } else if (!s.hit && rt.chrono(3) > s.delay && rt.chrono(2) < DURATION) {
      rt.effect(throwSound);
      s.fishActive = true;
      s.fishX = 0;
      let index: number;
      do index = rt.rnd() % 3;
      while (index === s.lastLane);
      s.lastLane = index;
      s.speed = player.action * SPEED_PER_LEVEL + LANES[index].speed;
      s.lane = LANES[index].y;
    }
  };

  /**
   * `2580:0135` : choc, jugé sur le sprite du joueur dessiné à l'image précédente (10 à 13 : en l'air ; 4 à 7 : baissé).
   * En haut, seul un joueur en l'air est touché ; au milieu, tous sauf un joueur baissé ; en bas, tous sauf un joueur en l'air.
   */
  const collide = (): void => {
    if (!s.fishActive || s.fishX <= HIT_MIN_X || s.fishX >= HIT_MAX_X) return;
    const jumping = hero.sprite >= 10 && hero.sprite <= 13;
    const ducking = hero.sprite >= 4 && hero.sprite <= 7;
    let pose = -1;
    if (s.lane === LANE_TOP) {
      if (jumping) pose = 3;
    } else if (s.lane === LANE_MIDDLE) {
      if (!ducking) pose = jumping ? 4 : 0;
    } else if (s.lane === LANE_BOTTOM && !jumping) pose = ducking ? 2 : 1;
    if (pose < 0) return;
    s.hit = true;
    s.pose = pose;
    rt.effect(hitSound);
    s.fishActive = false;
    hero.init(hitSheet);
    hero.select(s.pose);
    restoreRects(rt, fishBand());
  };

  /** `2580:0244` : commandes, animation et dessin du joueur ; victoire au bout du temps, défaite après les étoiles. */
  const stepHero = (directions: number): void => {
    if (s.pose === POSE_STANDING && !s.hit && rt.chrono(2) < DURATION) {
      if (directions & DOWN) {
        rt.effect(duckSound);
        s.pose = POSE_DUCKING;
        hero.select(ANIM_DUCK);
      }
      if (directions & UP) {
        rt.effect(jumpSound);
        s.pose = POSE_JUMPING;
        hero.select(ANIM_JUMP);
      }
    }
    hero.step();
    hero.draw(rt, HERO_X, s.dazed ? DAZED_Y : HERO_Y);
    if (!s.fishActive && !s.hit && s.pose === POSE_STANDING && rt.chrono(2) >= DURATION) s.won = true;
    if (!hero.wrapped) return;
    if (!s.hit) {
      s.pose = POSE_STANDING;
      hero.select(ANIM_IDLE);
    } else if (!s.dazed) {
      // Fin de l'animation du choc : l'image affichée (l'avant-dernière de l'animation) devient le fond, puis les étoiles.
      surface.background.set(screen);
      rt.restore();
      dazedLoop.play(dazedSound);
      s.pose = ANIM_DAZED;
      hero.init(heroSheet);
      hero.select(ANIM_DAZED);
      s.dazed = true;
    } else {
      s.lost = true;
      rt.restore();
    }
  };

  surface.commitBackground();
  rt.restore();
  hero.draw(rt, HERO_X, HERO_Y);
  screen.set(surface.work);
  yield* rt.music("m22m.voc");
  rt.startChrono(2);
  rt.startChrono(3);
  yield* flushInput(rt);

  beginPlay(rt, MODULE, s);
  let touched = 0;
  do {
    const directions = rt.dirs() | touched;
    touched = 0;
    if (!s.hit) {
      restoreRects(rt, HERO_RECT, fishBand());
      stepFish();
      collide();
    } else restoreRects(rt, HIT_RECT);
    stepHero(directions);
    screen.set(surface.work);
    yield* waitFrame(FRAME_TICKS, () => {
      dazedLoop.pump();
      touched |= touchDirs(rt, TOUCH);
    });
  } while (!s.lost && !s.won);
  endPlay(rt);

  dazedLoop.release();
  yield* dazedLoop.wait();
  yield* fadeSoundOut(rt, 1);
  yield* rt.cleanup();
  if (s.won) {
    // Image de la victoire sous la vidéo `M22AA` en surimpression (`0x1000`), puis le sesterce.
    yield* rt.fadeOut(16);
    rt.draw(yield* rt.load(resources.picture("m22da001.mcc")), 4);
    surface.commitBackground();
    yield* rt.moduleVideo(MODULE, 0, { overlay: true });
    yield* rt.wait(100);
    yield* changeSesterces(rt, player, GAIN, true);
  } else {
    yield* rt.voice(0, VOICE_KEY);
  }
}
