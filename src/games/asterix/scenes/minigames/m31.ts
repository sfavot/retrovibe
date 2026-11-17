import type { Play } from "../game";
import { UP, VOICES, type Script } from "../runtime";
import { changeSesterces } from "../squares";
import { Anim, BOTTOM_HALF, TOP_HALF, beginPlay, endPlay, flushInput, restoreRects, waitFrame } from "./common";

/**
 * Mini-jeu « Le fakir » (case 36, `MDF/31`, segment `27ba` : `27ba:0561` et ses trois fonctions).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m31.md`.
 *
 * Des tapis volants vont et viennent en diagonale, un par étage, le long d'une tour. Le joueur part du sol et saute de
 * tapis en tapis jusqu'au sommet, en moins de 65 secondes. Un tapis qui arrive au bout de sa course se retourne : il
 * faut sauter sur place à ce moment-là pour ne pas tomber. Au sommet, 3 sesterces ; tombé ou trop lent, rien.
 */
export const MODULE = 31;

/** Sesterces gagnés au sommet (`1d24:0912(joueur, 3, 1)`). */
export const GAIN = 3;
/** Nombre de tapis au niveau Action 0 ; un de plus par niveau (4, 5, 6). */
export const CARPETS_MIN = 4;
/** Une image tous les 4 ticks (`1831:030a(4)`) : 15 images par seconde. */
export const FRAME_TICKS = 4;
/** Les commandes sont lues tant que le chrono 2 est sous cette seconde. */
export const TIME_LIMIT = 0x41;
/** Au-delà de `TIME_LIMIT` le temps est écoulé ; au-delà de cette seconde le joueur encore sur un tapis tombe. */
const TIME_FALL = 0x42;

/** Poses du joueur (`DS:7401`), qui sont aussi ses animations dans `m31s.hy8`. */
export const POSE_HOP = 3;
export const POSE_JUMP = 4;
export const POSE_FALL = 5;
export const POSE_IDLE = 6;
/** Animations d'un tapis (`DS:7403`) : vol, demi-tour au bout droit (bas), demi-tour au bout gauche (haut). */
export const CARPET_FLY = 0;
export const CARPET_TURN_BACK = 1;
export const CARPET_TURN_FORTH = 7;
/** Rang de l'animation du demi-tour auquel un joueur immobile sur le tapis tombe. */
export const TURN_FALL_RANK = 7;
/** Second mot d'une image d'animation (`+0x1a` de l'objet) : 2 sur l'image du joueur où part son bruitage. */
const SOUND_TAG = 2;

/** Départ du joueur : abscisse, et ordonnée `N × 30 + 45` sous le dernier tapis. */
const START_X = 0x4b;
const START_Y = 0x2d;
/** Écart vertical entre deux étages de tapis. */
export const ROW_HEIGHT = 0x1e;
/** Un saut déplace le joueur de (+38, −10). */
export const JUMP_DX = 0x26;
export const JUMP_DY = -10;
/** Course des tapis : abscisse de 45 à 345, ordonnée de 80 à 225 ; pas de (2, 1) par image. */
export const CARPET_MIN_X = 0x2d;
export const CARPET_MAX_X = 0x159;
export const CARPET_MIN_Y = 0x50;
export const CARPET_MAX_Y = 0xe1;
/** Tirage de l'abscisse de départ d'un tapis : `rnd() % 300 + 45`. */
const CARPET_SPREAD = 300;
/** Le joueur retombe sur un tapis si `x − 22 < X < x + 15` ; posé, il est ramené entre `x − 10` et `x`. */
export const LAND_LEFT = 0x16;
export const LAND_RIGHT = 0xf;
const RIDE_LEFT = 10;
/** Décalage des tables du jeu vers les pixels d'écran (ancre des sprites). */
const OFFSET_X = 0x20;
const OFFSET_Y = 0x28;
/** Attente de fin (bruitage en cours), en ticks au plus. */
const END_TICKS = 600;

/** Décision D11 : toucher ou cliquer la moitié haute de l'écran saute à l'étage suivant, la moitié basse saute sur place. */
const TOUCH = [TOP_HALF, BOTTOM_HALF] as const;

/** Un tapis (`DS:73c5`, `DS:73e9`, `DS:7403` et son objet animation en `DS:7435 + 36 i`). */
export interface Carpet {
  /** `DS:73e9 + 4i`, `DS:73eb + 4i` : position (dessiné en `x − 32`, `y − 40`). */
  x: number;
  y: number;
  /** `DS:73c5 + 2i` : sens de la course, +1 vers la droite et le bas, −1 vers la gauche et le haut. */
  dir: number;
  /** `DS:7403 + 2i` : animation en cours (`CARPET_FLY` ou l'un des deux demi-tours, pendant lesquels il ne bouge pas). */
  mode: number;
  /** `+0x16` de son objet animation : rang de la prochaine image. */
  rank: number;
}

/** État du mini-jeu (globales `DS:73b4` à `DS:740f`), exposé aux robots par `rt.hint.state`. */
export interface FakirState {
  /** `DS:740f` : nombre de tapis (niveau Action + 4). */
  count: number;
  /** Tapis, du plus haut (0) au plus bas (`count − 1`). */
  carpets: Carpet[];
  /** `DS:73bb` : étages franchis ; le joueur est sur le tapis `count − climbed`, au sol à 0, au sommet à `count + 1`. */
  climbed: number;
  /** `DS:73c3`, `DS:73c1` : position du joueur. */
  x: number;
  y: number;
  /** `DS:7401`. */
  pose: number;
  /** `DS:73b4` : temps écoulé. */
  timeUp: boolean;
  /** `DS:73b5` : fin sans victoire (chute, ou temps écoulé au sol). */
  over: boolean;
  /** `DS:73b6` : sommet atteint. */
  won: boolean;
  /** Images de jeu jouées (portage : repère des robots). */
  frames: number;
}

/** `27ba:0561`. */
export function* fakir(play: Play): Script {
  const { rt, board } = play;
  const { surface, resources, voice, clock } = rt.ctx;
  const player = board.player;
  const [sheet, jumpSound, hopSound, fallSound] = yield* rt.load(
    Promise.all([resources.hy8("m31s.hy8"), resources.sound("m31b0000.voc"), resources.sound("m31b0001.voc"), resources.sound("m31b0002.voc")]),
  );
  const count = player.action + CARPETS_MIN;
  const s: FakirState = {
    count,
    carpets: [],
    climbed: 0,
    x: START_X,
    y: count * ROW_HEIGHT + START_Y,
    pose: POSE_IDLE,
    timeUp: false,
    over: false,
    won: false,
    frames: 0,
  };
  // Un décor par nombre de tapis (la tour est plus ou moins haute), avec fondu d'entrée.
  yield* rt.picture(`M31DA00${count - CARPETS_MIN}.mcc`, 1);
  yield* rt.music("m31m.voc");
  surface.commitBackground();
  const hero = new Anim(sheet);
  hero.select(s.pose);
  hero.step();
  /** `DS:73b7` : bruitage de la pose en cours, joué sur l'image marquée de son animation. */
  let sound = jumpSound;
  /** Dernière image présentée : l'original laisse à l'écran ce qu'il a montré, pas ce qu'il prépare ensuite. */
  const screen = new Uint8Array(surface.work.length);

  // `27ba:0009` : un tapis par étage, abscisse tirée jusqu'à ce que son ordonnée tienne dans la course, sens tiré.
  const anims: Anim[] = [];
  for (let i = 0; i < count; i++) {
    const anim = new Anim(sheet);
    anim.select(CARPET_FLY);
    anim.step();
    let x: number;
    let y: number;
    do {
      x = (rt.rnd() % CARPET_SPREAD) + CARPET_MIN_X;
      y = i * ROW_HEIGHT + ((x - CARPET_MIN_X) >> 1) + ROW_HEIGHT;
    } while (y < CARPET_MIN_Y || y > CARPET_MAX_Y);
    const dir = rt.rnd() & 1 ? -1 : 1;
    anims.push(anim);
    s.carpets.push({ x, y, dir, mode: CARPET_FLY, rank: anim.rank });
  }

  /** `27ba:00df` : chaque tapis est dessiné puis avance ; au bout de sa course il se retourne sur place (12 images). */
  const stepCarpets = (): void => {
    s.carpets.forEach((carpet, i) => {
      const anim = anims[i];
      anim.step();
      anim.draw(rt, carpet.x - OFFSET_X, carpet.y - OFFSET_Y);
      const turn = (mode: number): void => {
        carpet.dir = -carpet.dir;
        carpet.mode = mode;
        anim.select(mode);
      };
      if (carpet.mode === CARPET_FLY) {
        carpet.x += carpet.dir * 2;
        carpet.y += carpet.dir;
        if (carpet.dir === -1) {
          if (carpet.x < CARPET_MIN_X || carpet.y < CARPET_MIN_Y) turn(CARPET_TURN_FORTH);
        } else if (carpet.x > CARPET_MAX_X || carpet.y > CARPET_MAX_Y) turn(CARPET_TURN_BACK);
      } else if (anim.rank === 0) {
        carpet.mode = CARPET_FLY;
        anim.select(CARPET_FLY);
        carpet.x += carpet.dir * 2;
        carpet.y += carpet.dir;
      }
      carpet.rank = anim.rank;
    });
  };

  const pose = (next: number): void => {
    s.pose = next;
    hero.select(next);
  };
  const fall = (): void => {
    sound = fallSound;
    pose(POSE_FALL);
  };
  /** Fin d'un saut (`27ba:04f5`) : au sol, ou retombé sur son tapis, le joueur se pose ; sinon il tombe. */
  const land = (): void => {
    const carpet = s.carpets[s.count - s.climbed];
    if (s.climbed === 0 || (carpet.x - LAND_LEFT < s.x && s.x < carpet.x + LAND_RIGHT)) pose(POSE_IDLE);
    else fall();
  };
  /** Joueur posé (`27ba:03c3`) : le temps, puis le tapis qui l'emporte et le fait tomber s'il se retourne. */
  const ride = (): void => {
    if (!s.timeUp) {
      if (rt.chrono(2) > TIME_LIMIT) {
        s.timeUp = true;
        return;
      }
    } else if (rt.chrono(2) > TIME_FALL) {
      if (s.climbed <= 0) s.over = true;
      else fall();
      return;
    }
    if (s.climbed <= 0) return;
    const carpet = s.carpets[s.count - s.climbed];
    if (carpet.mode === CARPET_FLY) {
      s.x += carpet.dir * 2;
      s.y += carpet.dir;
      if (carpet.x < s.x) {
        s.x -= 2;
        s.y -= 1;
      }
      if (carpet.x - RIDE_LEFT > s.x) {
        s.x += 2;
        s.y += 1;
      }
    }
    if ((carpet.mode === CARPET_TURN_FORTH || carpet.mode === CARPET_TURN_BACK) && carpet.rank === TURN_FALL_RANK) fall();
  };

  const drawHero = (): void => {
    hero.step();
    hero.draw(rt, s.x - OFFSET_X, s.y - OFFSET_Y);
  };

  /** `27ba:0290` : commandes (posé, avant la fin du temps), animation et dessin du joueur, puis suite de sa pose. */
  const stepHero = (up: boolean, click: boolean): void => {
    if (s.pose === POSE_IDLE && rt.chrono(2) < TIME_LIMIT) {
      if (click) {
        sound = hopSound;
        pose(POSE_HOP);
      }
      if (up) {
        sound = jumpSound;
        pose(POSE_JUMP);
        s.climbed++;
      }
    }
    drawHero();
    if (hero.tag === SOUND_TAG) rt.effect(sound);
    // Chute depuis le premier tapis : le bas du sprite est effacé (le joueur disparaît derrière le sol).
    if (s.pose === POSE_FALL && s.climbed === 1) restoreRects(rt, [s.x - 0x2a, s.y - 0x18, s.x - 0x16, s.y + 0x14]);
    if (hero.rank !== 0) return;
    switch (s.pose) {
      case POSE_HOP:
        land();
        break;
      case POSE_JUMP:
        s.x += JUMP_DX;
        s.y += JUMP_DY;
        if (s.climbed === s.count + 1) {
          s.won = true;
          pose(POSE_IDLE);
        } else land();
        break;
      case POSE_FALL:
        s.over = true;
        break;
      case POSE_IDLE:
        ride();
        break;
    }
  };

  rt.startChrono(2);
  yield* flushInput(rt);

  beginPlay(rt, MODULE, s);
  let touchedUp = false;
  let clicked = false;
  do {
    // Les directions sont lues à chaque image, même en plein saut, pour qu'un appui ne soit pas rendu après coup.
    const up = (rt.dirs() & UP) !== 0 || touchedUp;
    const click = clicked;
    touchedUp = clicked = false;
    rt.restore();
    stepCarpets();
    stepHero(up, click);
    s.frames++;
    screen.set(surface.work);
    yield* waitFrame(rt, FRAME_TICKS, () => {
      const zone = rt.click(TOUCH);
      if (zone === 0) touchedUp = true;
      else if (zone !== null) clicked = true;
    });
  } while (!s.over && !s.won);
  endPlay(rt);

  // `27ba:0701` : une image préparée mais jamais présentée (les tapis avancent d'un pas), puis les tapis seuls tant
  // que le dernier bruitage et la musique jouent, 600 ticks au plus.
  rt.restore();
  if (!s.timeUp) stepCarpets();
  if (s.won || (s.timeUp && s.climbed === 0)) drawHero();
  const start = clock.ticks;
  while (voice.effectPlaying && voice.voicePlaying && clock.ticks < start + END_TICKS) {
    rt.restore();
    stepCarpets();
    screen.set(surface.work);
    yield* waitFrame(rt, FRAME_TICKS);
  }
  surface.work.set(screen);
  voice.setMusic(null);
  voice.stop();
  yield* rt.fadeOut(16);
  yield* rt.cleanup();
  // Temps écoulé : Panoramix (`K63TE02`). Sommet atteint : les deux vidéos (`15d7:08e9`), puis les sesterces.
  if (s.timeUp) yield* rt.voice(1, VOICES.panoramix);
  if (s.won) {
    yield* rt.moduleVideo(MODULE, 0);
    yield* rt.moduleVideo(MODULE, 1);
    yield* changeSesterces(rt, player, GAIN, true);
  }
}
