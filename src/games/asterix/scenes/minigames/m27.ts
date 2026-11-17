import type { VideoPlayer } from "../../../../engine/infogrames/video";
import type { Play } from "../game";
import { LEFT, RIGHT, type Script } from "../runtime";
import { changeSesterces } from "../squares";
import { Anim, LEFT_HALF, RIGHT_HALF, beginPlay, endPlay, touchDirs, waitFrame } from "./common";

/**
 * Mini-jeu « Tempête en mer du Nord » (case 11, `MDF/27`, segment `2840` : `2840:023a`, ses rappels vidéo `2840:01e6` et
 * `2840:01da`, et leurs deux fonctions `2840:000b` et `2840:014c`).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m27.md`.
 *
 * La barque file dans la tempête, filmée par une vidéo d'une trentaine de secondes. Des vagues et des récifs surgissent
 * à gauche, au centre ou à droite : les marqueurs `08` de la vidéo disent où. Le joueur déplace la barque de gauche à
 * droite pour ne pas se trouver là où ça frappe. Touché, il a perdu ; au bout de la vidéo, il gagne 1 sesterce.
 */
export const MODULE = 27;

/** Sesterces gagnés (`1d24:0912(joueur, 1, 1)`). */
export const GAIN = 1;
/** Positions de la barque (`DS:7565`) : départ, bornes. Elle est dessinée en `x = 64 × position − 96`. */
export const START_POS = 4;
export const MIN_POS = 2;
export const MAX_POS = 6;
/** Zone de danger d'une position : 0 gauche (position 2), 1 centre (3 à 5), 2 droite (6). */
export const zoneOf = (pos: number): number => Math.trunc(pos / 3);
/** Un marqueur arme sa zone à 5 ; le compteur baisse d'un à chaque image, dès celle qui l'arme. */
export const DANGER_FRAMES = 5;
/** Marqueur de la victoire, et marqueur qui ouvre le jeu. */
export const MARKER_WIN = 5;
export const MARKER_START = -1;
/** Zones armées par chaque marqueur 1 à 4 (`2840:014c`) ; le 4 (les deux bords) ne figure dans aucune vidéo. */
export const MARKER_ZONES: Readonly<Record<number, readonly number[]>> = { 1: [0], 2: [1], 3: [2], 4: [0, 2] };

/** Nom de la vidéo : deux par niveau Action, `M27AA` à `M27AF` (`'A' + 2 × niveau + (rnd() & 1)`). */
export function videoName(action: number, variant: number): string {
  return `M27A${String.fromCharCode(0x41 + 2 * action + variant)}.MUX`;
}

/** Animations de `m27sr.hy8` : la barque de face (16 images), vers la gauche (8), vers la droite (8), le choc (2). */
const ANIM_IDLE = 0;
const ANIM_LEFT = 1;
const ANIM_RIGHT = 2;
const ANIM_HIT = 3;
/** Mouvement en cours (`DS:7567`) : le numéro de l'animation. */
export const MOVE_NONE = ANIM_IDLE;
export const MOVE_LEFT = ANIM_LEFT;
export const MOVE_RIGHT = ANIM_RIGHT;
export const MOVE_HIT = ANIM_HIT;

const BOAT_Y = 0xc8;
const boatX = (pos: number): number => (pos << 6) - 0x60;
/** Chaque image du choc reste 16 ticks. */
const HIT_TICKS = 0x10;

/** Décision D11 : toucher ou cliquer la moitié gauche de l'écran pousse la barque à gauche, la moitié droite à droite. */
const TOUCH = [
  [LEFT_HALF, LEFT],
  [RIGHT_HALF, RIGHT],
] as const;

/** État du mini-jeu (globales `DS:7546` à `DS:7567`), exposé aux robots par `rt.hint.state`. */
export interface TempeteState {
  /** Vidéo tirée (`DS:751e`). */
  video: string;
  /** Numéro de la dernière image de la vidéo traitée par le jeu (−1 avant la première). */
  frame: number;
  /** `DS:754c` : dernier marqueur traité ; 0 tant que le jeu n'est pas ouvert (la barque n'est ni dessinée ni commandée). */
  phase: number;
  /** `DS:7565` : position de la barque, 2 à 6. */
  pos: number;
  /** `DS:7567` : mouvement en cours (`MOVE_*`). La position ne change qu'à la fin du mouvement. */
  move: number;
  /** `DS:7546` : compteurs de danger des trois zones. */
  danger: [number, number, number];
  /** `DS:7562` : touché. */
  hit: boolean;
  /** `DS:7563` : animation de la barque touchée arrivée à son terme. */
  over: boolean;
  /** `DS:7564` : la vidéo a atteint son marqueur 5. */
  won: boolean;
}

/** `2840:023a`. */
export function* tempete(play: Play): Script {
  const { rt, board } = play;
  const { surface, resources, palette, voice } = rt.ctx;
  const player = board.player;
  const [hitSound, moveSoundA, moveSoundB, sheet, colors] = yield* rt.load(
    Promise.all([
      resources.sound("m27b0000.voc"),
      resources.sound("m27b0001.voc"),
      resources.sound("m27b0002.voc"),
      resources.hy8("m27sr.hy8"),
      resources.bytes("m27s.pal"),
    ]),
  );

  const s: TempeteState = { video: "", frame: -1, phase: 0, pos: START_POS, move: MOVE_NONE, danger: [0, 0, 0], hit: false, over: false, won: false };
  const boat = new Anim(sheet);
  boat.select(s.move);
  /** `DS:7550` : sprite de la barque à dessiner, −1 tant que le jeu n'est pas ouvert. */
  let sprite = -1;
  /** `DS:754e` : son abscisse. */
  let x = 0;
  /** `DS:631d` : la vidéo a reçu son ordre d'arrêt. */
  let stopped = false;
  let touched = 0;

  /** Départ d'un mouvement : un des deux bruitages au hasard (`2a28:0b3e(2, son)`, mélangé au son de la vidéo). */
  const startMove = (move: number): void => {
    rt.effect(rt.rnd() & 1 ? moveSoundA : moveSoundB);
    s.move = move;
    boat.select(move);
  };

  /** `2840:000b` : danger, commandes et animation de la barque, une fois par image de la vidéo. */
  const stepBoat = (): void => {
    // Les directions sont lues à chaque image, même sans effet : un appui donné pendant un mouvement est perdu, comme dans l'original.
    const directions = rt.dirs() | touched;
    touched = 0;
    if (s.phase === 0) return;
    if (s.danger[zoneOf(s.pos)] !== 0 && !s.hit) s.hit = true;
    if (s.move === MOVE_NONE && !s.hit && !s.won) {
      if (directions & LEFT && s.pos > MIN_POS) startMove(MOVE_LEFT);
      if (directions & RIGHT && s.pos < MAX_POS) startMove(MOVE_RIGHT);
    }
    boat.step();
    sprite = boat.sprite;
    x = boatX(s.pos);
    if (!boat.wrapped) return;
    if (s.hit) s.over = true;
    else {
      if (s.move === MOVE_LEFT) s.pos--;
      if (s.move === MOVE_RIGHT) s.pos++;
      s.move = MOVE_NONE;
      boat.select(MOVE_NONE);
    }
  };

  /** `2840:014c` : le marqueur lu avec l'image précédente (`DS:6425`) arme ses zones ou donne la victoire ; les dangers s'usent. */
  const stepMarkers = (video: VideoPlayer): void => {
    const marker = video.marker;
    if (marker === MARKER_START || (marker >= 1 && marker <= MARKER_WIN)) {
      s.phase = marker;
      for (const zone of MARKER_ZONES[marker] ?? []) s.danger[zone] = DANGER_FRAMES;
      if (marker === MARKER_WIN) s.won = true;
      video.marker = 0;
    }
    for (let zone = 0; zone < 3; zone++) if (s.danger[zone] !== 0) s.danger[zone]--;
  };

  /**
   * Rappels du lecteur. `2840:01da` (à chaque bloc vidéo) : la barque puis les marqueurs ; le marqueur d'une image suit
   * son bloc vidéo dans le fichier, il n'est donc vu qu'à l'image suivante. `2840:01e6` (à chaque image décodée) : au
   * choc, l'image devient le fond et la vidéo s'arrête ; la barque est dessinée par-dessus l'image.
   */
  const onBlock = (video: VideoPlayer, index: number): void => {
    s.frame = index;
    stepBoat();
    stepMarkers(video);
  };
  const onImage = (): boolean => {
    if (s.hit && !stopped) {
      stopped = true;
      surface.commitBackground();
    }
    if (sprite !== -1) rt.sprite(sheet, sprite, x, BOAT_Y);
    return stopped;
  };

  // Fondu au noir, palette du jeu (`m27s.pal`, celle des vidéos étant ignorée : `0x4`), puis la vidéo du niveau.
  yield* rt.fadeOut(16);
  palette.load(colors);
  s.video = videoName(player.action, rt.rnd() & 1);
  beginPlay(rt, MODULE, s);
  // `0x85` : décodée sur le tampon de travail, sans interruption ; chaque image recouvre tout l'écran, barque comprise.
  yield* rt.video(s.video, {
    skip: "none",
    keepPalette: true,
    target: surface.work,
    block: onBlock,
    frame: onImage,
    poll: () => {
      touched |= touchDirs(rt, TOUCH);
      return false;
    },
  });

  if (s.hit) {
    // La barque touchée : deux images de 16 ticks sur l'image figée, avec le bruitage du choc sur la voie principale.
    s.move = MOVE_HIT;
    boat.select(MOVE_HIT);
    voice.play(hitSound);
    for (let i = 0; i < 2; i++) {
      rt.restore();
      boat.step();
      boat.draw(rt, boatX(s.pos), BOAT_Y);
      yield* waitFrame(rt, HIT_TICKS);
    }
    yield* rt.waitSound();
    s.over = true;
  }
  endPlay(rt);
  yield* rt.cleanup();
  if (s.won) {
    // `M27AG` plein écran (`0x22d00`, interruptible), puis le sesterce.
    yield* rt.video("M27AG.MUX");
    yield* changeSesterces(rt, player, GAIN, true);
  } else {
    // `M27AH` en surimpression sur l'image figée (`0x3c80`, interruptible).
    yield* rt.video("M27AH.MUX", { overlay: true });
  }
}
