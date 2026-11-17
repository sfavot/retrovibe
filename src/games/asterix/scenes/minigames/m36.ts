import type { VideoPlayer } from "../../../../engine/infogrames/video";
import type { Play } from "../game";
import { LEFT, RIGHT, type Script } from "../runtime";
import { changeSesterces } from "../squares";
import { Anim, LEFT_HALF, RIGHT_HALF, beginPlay, endPlay, flushInput, touchDirs, waitFrame } from "./common";

/**
 * Mini-jeu « Le ciel sur la tête » (case 23, `MDF/36`, segment `1f84` : `1f84:040a` et ses quatre fonctions).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m36.md`.
 *
 * Tout le jeu est le rappel d'image de la vidéo `M36A.MUX` (35 s, 11 images par seconde) : le joueur, vu de dos au
 * premier plan, occupe un des trois couloirs et s'écarte des rochers qui tombent un à un. Touché, il perd ; s'il tient
 * jusqu'au marqueur 2 de la vidéo, il gagne 1 sesterce.
 */
export const MODULE = 36;

/** Sesterces gagnés (`1d24:0912(joueur, 1, 1)`). */
export const GAIN = 1;
/** Abscisse des trois couloirs (`pos × 0x50 + 0x50` pour le joueur, `DS:28d8` pour le rocher). */
export const LANE_X = [0x50, 0xa0, 0xf0] as const;
/** Ordonnée du joueur, et sol : le rocher s'écrase quand il la dépasse. */
export const GROUND_Y = 0xf0;
/** Vitesse du rocher en pixels par image : `0xf + 3 × niveau Action`. */
export const ROCK_SPEED = 0xf;
export const ROCK_SPEED_PER_LEVEL = 3;
/** Le rocher part de `0x7d % vitesse`, pour passer exactement par l'ordonnée 0x7d. */
export const ROCK_ALIGN_Y = 0x7d;
/** Le rocher touche un joueur immobile quand son ordonnée est strictement entre ces bornes. */
export const HIT_MIN_Y = 0x7d;
export const HIT_MAX_Y = 0xaf;
/** Pendant un déplacement, le joueur reste vulnérable à ses deux premières images, plus bas seulement. */
const HIT_MIN_Y_STEP1 = 0x96;
const HIT_MIN_Y_STEP2 = 0x8c;
/** Attente avant le premier rocher, puis entre deux rochers : `(3 − niveau) × 5 + (rnd & 7)` images. */
export const FIRST_DELAY = 0xf;
export const DELAY_PER_LEVEL = 5;
/** Nombre de rochers différents (sprites 0 à 6 de `M36SA001.hy8`). */
const ROCK_SPRITES = 7;

/** Déplacement du joueur (`DS:6a86`) : aucun, vers la gauche, vers la droite. */
export const MOVE_NONE = 0;
export const MOVE_LEFT = 1;
export const MOVE_RIGHT = 2;

/** Animations de `M36SA000.hy8` (joueur) : attente, pas à gauche, pas à droite. `M36SA001.hy8` : 0 rocher écrasé, 1 joueur assommé, 2 étoiles. */
const ANIM_IDLE = 0;
const ANIM_CRASH = 0;
const ANIM_STUNNED = 1;
const ANIM_STARS = 2;

/** Cadence de l'animation du perdant, après la vidéo (`1831:030a(6)`). */
const LOST_TICKS = 6;

/** Décision D11 : toucher ou cliquer la moitié gauche de l'écran fait un pas à gauche, la moitié droite un pas à droite. */
const TOUCH = [
  [LEFT_HALF, LEFT],
  [RIGHT_HALF, RIGHT],
] as const;

/** État du mini-jeu (globales `DS:6a62` à `DS:6a86`), exposé aux robots par `rt.hint.state`. */
export interface CielState {
  /** Numéro de la dernière image de la vidéo traitée. */
  frame: number;
  /** `DS:6a64` : −1 jeu en cours, 1 fin de la pluie (marqueur 1), 2 gagné (marqueur 2). */
  phase: number;
  /** `DS:6a72` : marqueur 1 passé, plus aucun rocher ne part. */
  ending: boolean;
  /** `DS:6a75` : marqueur 2 atteint, gagné. */
  won: boolean;
  /** `DS:6a73` : touché. */
  hit: boolean;
  /** `DS:6a74` : l'animation « assommé » est finie, les étoiles tournent. */
  stunned: boolean;
  /** `DS:6a84` : couloir du joueur, 0 à 2. */
  pos: number;
  /** `DS:6a86`. */
  move: number;
  /** `DS:6a71` : un rocher est en jeu (en chute ou écrasé). */
  falling: boolean;
  /** `DS:6a70` : le rocher s'écrase (animation de trois images). */
  crashed: boolean;
  /** `DS:6a6a` et `DS:6a68` : couloir du rocher, et du précédent. */
  lane: number;
  lastLane: number;
  /** `DS:6a66` : ordonnée du rocher. */
  rockY: number;
  /** `DS:6a62` : pixels par image. */
  speed: number;
  /** `DS:6a6c` : sprite du rocher. */
  rockSprite: number;
  /** `DS:6a6e` : images avant le prochain rocher. */
  delay: number;
}

/** `1f84:040a`. */
export function* ciel(play: Play): Script {
  const { rt, board } = play;
  const { surface, resources, voice } = rt.ctx;
  const player = board.player;
  const [rockSheet, heroSheet, moveSound, crashSound, hitSound] = yield* rt.load(
    Promise.all([
      resources.hy8("M36SA001.hy8"),
      resources.hy8("M36SA000.hy8"),
      resources.sound("m36b0005.voc"),
      resources.sound("m36b0001.voc"),
      resources.sound("m36b0004.voc"),
    ]),
  );
  yield* rt.fadeOut(0x10);

  const s: CielState = {
    frame: -1,
    phase: -1,
    ending: false,
    won: false,
    hit: false,
    stunned: false,
    pos: 1,
    move: MOVE_NONE,
    falling: false,
    crashed: false,
    lane: 0,
    // Au niveau 0, le premier rocher tiré au hasard ne tombe pas au milieu, où attend le joueur.
    lastLane: player.action === 0 ? 1 : 0,
    rockY: 0,
    speed: 0,
    rockSprite: 0,
    delay: FIRST_DELAY,
  };
  const hero = new Anim(heroSheet);
  hero.select(ANIM_IDLE);
  const rock = new Anim(rockSheet);

  /** `1f84:0007` : le rocher tombe, s'écrase, puis le suivant part après l'attente. */
  const stepRock = (): void => {
    if (!s.falling) {
      s.delay--;
      if (s.hit || s.delay >= 1 || s.ending) return;
      s.falling = true;
      s.rockSprite = rt.rnd() % ROCK_SPRITES;
      s.speed = player.action * ROCK_SPEED_PER_LEVEL + ROCK_SPEED;
      s.rockY = ROCK_ALIGN_Y % s.speed;
      // Une fois sur deux le rocher vise le couloir du joueur ; sinon un couloir au hasard, jamais celui du rocher précédent.
      if (rt.rnd() & 1) s.lane = s.pos;
      else {
        do s.lane = rt.rnd() % 3;
        while (s.lane === s.lastLane);
      }
      s.lastLane = s.lane;
    } else if (!s.crashed) {
      rt.sprite(rockSheet, s.rockSprite, LANE_X[s.lane], s.rockY);
      s.rockY += s.speed;
      if (s.rockY > GROUND_Y) {
        rt.effect(crashSound);
        s.crashed = true;
        rock.init(rockSheet);
        rock.select(ANIM_CRASH);
      }
    } else {
      rock.step();
      rock.draw(rt, LANE_X[s.lane], s.rockY);
      if (rock.wrapped) {
        s.falling = false;
        s.crashed = false;
        s.delay = (3 - player.action) * DELAY_PER_LEVEL + (rt.rnd() & 7);
      }
    }
  };

  /**
   * `1f84:018b` : choc, jugé avant le pas du rocher, dans le couloir que le joueur occupe encore. Immobile, il est touché
   * entre 0x7d et 0xaf ; à la première image d'un pas (sprites 6 et 10) au-delà de 0x96, à la deuxième (7 et 11) au-delà
   * de 0x8c ; aux deux dernières il est à l'abri.
   */
  const collide = (): void => {
    if (!s.falling || s.lane !== s.pos || s.rockY >= HIT_MAX_Y) return;
    const sprite = hero.sprite;
    const touched =
      (s.move === MOVE_NONE && s.rockY > HIT_MIN_Y) ||
      ((sprite === 6 || sprite === 10) && s.rockY > HIT_MIN_Y_STEP1) ||
      ((sprite === 7 || sprite === 11) && s.rockY > HIT_MIN_Y_STEP2);
    if (!touched) return;
    s.hit = true;
    s.falling = false;
    s.move = MOVE_LEFT;
    hero.init(rockSheet);
    hero.select(ANIM_STUNNED);
  };

  /** `1f84:025a` : commandes, animation et dessin du joueur ; le couloir ne change qu'à la fin du pas. */
  const stepHero = (directions: number): void => {
    // Après le marqueur 1, le joueur ne bouge plus que tant qu'un rocher est encore en jeu.
    if (s.move === MOVE_NONE && !s.hit && (s.falling || !s.ending)) {
      if (directions & LEFT && s.pos > 0) {
        rt.effect(moveSound);
        s.move = MOVE_LEFT;
        hero.select(MOVE_LEFT);
      }
      if (directions & RIGHT && s.pos < 2) {
        rt.effect(moveSound);
        s.move = MOVE_RIGHT;
        hero.select(MOVE_RIGHT);
      }
    }
    // Assommé : l'animation 1 jouée une fois, puis les étoiles (animation 2) en boucle.
    if (hero.wrapped && s.hit && s.move === MOVE_LEFT && s.stunned) {
      s.move = MOVE_RIGHT;
      hero.select(ANIM_STARS);
    }
    hero.step();
    hero.draw(rt, LANE_X[s.pos], GROUND_Y);
    if (!hero.wrapped) return;
    if (s.hit) s.stunned = true;
    else {
      if (s.move === MOVE_LEFT) s.pos--;
      if (s.move === MOVE_RIGHT) s.pos++;
      s.move = MOVE_NONE;
      hero.select(ANIM_IDLE);
    }
  };

  let touched = 0;
  let stop = false;
  /**
   * `1f84:0388` : rappel de chaque image décodée. Toutes les images de `M36A` sont complètes : le décodage efface les
   * sprites de l'image précédente. Marqueurs : −1 jeu en cours (non remis à zéro), 1 fin de la pluie, 2 gagné.
   */
  const onFrame = (video: VideoPlayer): void => {
    s.frame = video.shown;
    surface.drawFullScreen(video.pixels);
    if (video.marker === -1) s.phase = -1;
    else if (video.marker === 1) {
      s.phase = 1;
      s.ending = true;
      video.marker = 0;
    } else if (video.marker === 2) {
      s.phase = 2;
      s.won = true;
      video.marker = 0;
    }
    if (s.hit) {
      // Image suivant le choc : elle devient le fond (`138e:037e`), et la vidéo s'arrête (`DS:3755 = 0`, `DS:631e = 1`).
      surface.commitBackground();
      stop = true;
      return;
    }
    if (s.phase === 0 || s.phase === 2) return;
    const directions = rt.dirs() | touched;
    touched = 0;
    stepHero(directions);
    collide();
    stepRock();
  };

  yield* flushInput(rt);
  beginPlay(rt, MODULE, s);
  yield* rt.video("M36A.mux", {
    skip: "none",
    draw: (video) => {
      if (video.shown !== s.frame) onFrame(video);
    },
    poll: () => {
      touched |= touchDirs(rt, TOUCH);
      return stop;
    },
  });
  endPlay(rt);

  if (s.hit) {
    // `16cb:08c9(m36b0004, 0x800004)` sur la voie ; le joueur assommé reste animé sur le fond tant qu'elle sonne.
    voice.play(hitSound);
    while (voice.voicePlaying) {
      rt.restore();
      stepHero(0);
      yield* waitFrame(LOST_TICKS);
    }
  }
  if (s.won) yield* changeSesterces(rt, player, GAIN, true);
  yield* rt.wait(0x19);
}
