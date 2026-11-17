import { VideoPlayer } from "../../../../engine/infogrames/video";
import type { MinigameEntry } from "../../game/rules";
import type { Player } from "../../game/state";
import type { Play } from "../game";
import { DOWN, UP, type Runtime, type Script } from "../runtime";
import { changeSesterces } from "../squares";
import { Anim, BOTTOM_HALF, TOP_HALF, beginPlay, endPlay, touchDirs, waitFrame } from "./common";

/**
 * Mini-jeu « Idéfix dans la pyramide » (case 47, `MDF/34`, segment `23d1` : `23d1:09c1` et ses six fonctions), aussi
 * lancé du menu principal hors partie (`23d1:09c1(0)`). Règles, adresses et niveaux de confiance :
 * `docs/asterix/minigames/m34.md`.
 *
 * Idéfix court dans un couloir pendant 28 secondes. Des obstacles arrivent de la droite : il saute par-dessus ceux du sol
 * et se baisse sous ceux du plafond. Touché, il perd ; arrivé au bout, il gagne 1 sesterce (rien hors partie).
 */
export const MODULE = 34;

/** Sesterces gagnés en partie (`1d24:0912(joueur, 1, 1)`) ; aucun hors partie. */
export const GAIN = 1;
/** Une image tous les 3 ticks : 20 images par seconde. */
export const FRAME_TICKS = 3;
/** Images jouées à vide avant le début, pour peupler le décor (`DS:6f3a` part donc de 40). */
export const WARMUP_FRAMES = 0x28;
/** La course s'arrête après cette image, dès qu'Idéfix repasse par le sprite 0. */
export const LAST_FRAME = 0x258;
/** Un obstacle est jugé à sa 22e image, pendant `JUDGED_FRAMES` images de suite. */
export const JUDGE_AGE = 0x15;
export const JUDGED_FRAMES = 4;

/** Type d'un objet (`+0x0a`) : libre, obstacle du sol (à sauter), obstacle du plafond (se baisser dessous), décor. */
export const TYPE_FREE = 0;
export const TYPE_LOW = 1;
export const TYPE_HIGH = 2;
export const TYPE_DECOR = 3;

/** Posture d'Idéfix (`DS:7025`) : course, baissé, saut ; après un choc, le numéro de l'animation de `m34sa001.hy8`. */
export const POSE_RUN = 0;
export const POSE_DUCK = 1;
export const POSE_JUMP = 2;

/** Jugement en cours (`DS:7010`) : aucun, obstacle du sol, obstacle du plafond. */
export const EVENT_NONE = -1;
export const EVENT_LOW = 1;
export const EVENT_HIGH = 2;

/** Positions en vingtièmes de pixel (`valeur × 5 / 100`). Départ à droite de l'écran ; ordonnées des deux sortes d'obstacles. */
const START_X = 0x18ec;
const LOW_Y = 0xed8;
const HIGH_Y = 0x460;
/** Vitesses par image, en vingtièmes de pixel : obstacles (10 et 3 pixels), décor (9 et 2,7 pixels). */
const OBSTACLE_DX = 0xc8;
const OBSTACLE_DY = 0x3c;
const DECOR_DX = 0xb4;
const DECOR_DY = 0x36;
/** Un objet disparaît quand `x × 5 < −8000` (80 pixels à gauche de l'écran). */
const GONE_X5 = -8000;
/** Âge donné à un obstacle déjà jugé. */
const JUDGED_AGE = 5000;
/** Premier sprite du décor dans `m34sa002.hy8` (13 à 17) ; obstacles du sol 0 à 4, du plafond 6 à 10. */
const DECOR_SPRITE = 0xd;
const HIGH_SPRITE = 6;
/** Idéfix (`2bdb:0477(sprite, 0x20, 0x74)`). */
const DOG_X = 0x20;
const DOG_Y = 0x74;
/** En saut, Idéfix est au-dessus de l'obstacle aux sprites 18 à 21 (`> 0x11` et `!= 0x16`). */
const AIRBORNE_AFTER = 0x11;
const LANDING_SPRITE = 0x16;
/** Objets : 0 et 1 les obstacles, 2 à 14 le décor. */
const OBJECT_COUNT = 15;
const FIRST_DECOR = 2;

/** Animation finale `m34ag.muk` : 6 ticks par image ; voix `m34ag1` à l'image 2, `m34ag2` à l'image 29, où le décor s'arrête. */
const ENDING_TICKS = 6;
const ENDING_VOICE_1 = 2;
const ENDING_VOICE_2 = 0x1d;

/** Décision D11 : toucher ou cliquer la moitié haute de l'écran fait sauter, la moitié basse se baisser. */
const TOUCH = [
  [TOP_HALF, UP],
  [BOTTOM_HALF, DOWN],
] as const;

// --- Tables de `ASTERIX.EXE` (décision D4) ----------------------------------------------------------

const EXECUTABLE = "ASTERIX.EXE";
const LOAD_SEGMENT = 0x1000;
const DGROUP = 0x2de2;
/** `DS:2ec4` : sept parcours de 15 couples (moment, type), le moment en doubles images, −1 pour finir. */
const COURSES = 0x2ec4;
const COURSE_COUNT = 7;
const COURSE_ENTRIES = 15;
/** `DS:306a` et `DS:306f` : pour chacun des cinq décors, l'étendue de son ordonnée et l'attente avant le suivant. */
const DECOR_SPANS = 0x306a;
const DECOR_DELAYS = 0x306f;
const DECOR_KINDS = 5;

export interface IdefixTables {
  /** Par parcours (0 hors partie, 1 à 6 en partie) : type de l'obstacle par moment (`DS:6f3a >> 1`). */
  courses: Map<number, number>[];
  decorSpans: number[];
  decorDelays: number[];
}

/** Lit les tables du mini-jeu dans l'exécutable (même adressage que `data/exe.ts`). */
export function parseIdefixTables(exe: Uint8Array): IdefixTables {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const data = view.getUint16(8, true) * 16 + (DGROUP - LOAD_SEGMENT) * 16;
  const courses: Map<number, number>[] = [];
  for (let course = 0; course < COURSE_COUNT; course++) {
    const entries = new Map<number, number>();
    for (let i = 0; i < COURSE_ENTRIES; i++) {
      const at = data + COURSES + (course * COURSE_ENTRIES + i) * 4;
      const moment = view.getInt16(at, true);
      if (moment === -1) break;
      // `23d1:01a9` rend le type de la première entrée dont le moment correspond.
      if (!entries.has(moment)) entries.set(moment, view.getInt16(at + 2, true));
    }
    courses.push(entries);
  }
  const bytes = (offset: number): number[] => Array.from(exe.subarray(data + offset, data + offset + DECOR_KINDS));
  return { courses, decorSpans: bytes(DECOR_SPANS), decorDelays: bytes(DECOR_DELAYS) };
}

// --- État ---------------------------------------------------------------------------------------------

/** Objet du couloir (14 octets en `DS:6f3c + 14 × n`). */
export interface IdefixObject {
  /** `+0`, `+2` : position en vingtièmes de pixel. */
  x: number;
  y: number;
  /** `+4`, `+6` : déplacement par image (vers la gauche et vers le haut). */
  dx: number;
  dy: number;
  /** `+8` : sprite de `m34sa002.hy8`. */
  sprite: number;
  /** `+0x0a`. */
  type: number;
  /** `+0x0c` : images depuis l'apparition. */
  age: number;
}

/** État du mini-jeu (globales `DS:6f36` à `DS:7025`), exposé aux robots par `rt.hint.state`. */
export interface IdefixState {
  /** Vrai en partie (argument 1), faux pour le jeu du menu (argument 0). */
  inGame: boolean;
  /** `DS:6f36` : parcours, 0 hors partie, sinon `2 × niveau Action + 1 + (rnd & 1)`. */
  course: number;
  /** `DS:6f3a` : compteur d'images. */
  frame: number;
  /** `DS:6f38` : image à partir de laquelle un décor peut apparaître. */
  nextDecor: number;
  /** `DS:3068` : bascule à chaque décor ; faux, le prochain est placé plus bas (deux tiers de son étendue en plus). */
  decorHigh: boolean;
  /** `DS:6f3c` : 0 et 1 les obstacles, 2 à 14 le décor. */
  objects: IdefixObject[];
  /** `DS:7025`. */
  pose: number;
  /** `DS:7010` et `DS:700e` : jugement en cours et images qu'il lui reste. */
  event: number;
  countdown: number;
  /** `DS:7022` : touché ; `DS:7023` : son animation est finie, perdu. */
  hit: boolean;
  lost: boolean;
  /** Arrivé au bout sans choc. */
  won: boolean;
}

/** `x × 5 / 100` : vingtièmes de pixel vers pixels, division tronquée (`IDIV`). */
const pixels = (value: number): number => Math.trunc((value * 5) / 100);

/**
 * `23d1:09c1(argument)`. `player` : le joueur de la partie (argument 1), ou `null` pour le jeu du menu principal
 * (argument 0 : parcours 0, aucun gain).
 */
export function* idefix(rt: Runtime, player: Player | null): Script {
  const { surface, resources, voice } = rt.ctx;
  const [jumpSound, duckSound, hitSound, runSheet, hitSheet, objectSheet, endVoice1, endVoice2, exe] = yield* rt.load(
    Promise.all([
      resources.sound("m34b0000.voc"),
      resources.sound("m34b0001.voc"),
      resources.sound("m34b0002.voc"),
      resources.hy8("m34sa000.hy8"),
      resources.hy8("m34sa001.hy8"),
      resources.hy8("m34sa002.hy8"),
      resources.sound("m34ag1.voc"),
      resources.sound("m34ag2.voc"),
      resources.bytes(EXECUTABLE),
    ]),
  );
  const tables = parseIdefixTables(exe);
  yield* rt.picture("m34da000.mcc", 3);
  surface.commitBackground();

  const s: IdefixState = {
    inGame: player !== null,
    course: player ? player.action * 2 + 1 + (rt.rnd() & 1) : 0,
    frame: 0,
    nextDecor: 0,
    decorHigh: false,
    objects: Array.from({ length: OBJECT_COUNT }, () => ({ x: 0, y: 0, dx: 0, dy: 0, sprite: 0, type: TYPE_FREE, age: 0 })),
    pose: -1,
    event: EVENT_NONE,
    countdown: 0,
    hit: false,
    lost: false,
    won: false,
  };
  const course = tables.courses[s.course];
  const obstacles = s.objects.slice(0, FIRST_DECOR);
  const decor = s.objects.slice(FIRST_DECOR);
  const dog = new Anim(runSheet);
  // `19b9:000c` lit la première image de l'animation finale dès maintenant, sans la décoder.
  const ending = new VideoPlayer(yield* rt.load(resources.video("m34ag.muk")));

  /** `23d1:0209(n, 0)` : un décor entre à droite, à une hauteur tirée au hasard, alternativement haute et basse. */
  const spawnDecor = (): void => {
    const object = decor.find((candidate) => candidate.type === TYPE_FREE);
    if (!object || s.frame < s.nextDecor) return;
    const kind = rt.rnd() % DECOR_KINDS;
    const span = tables.decorSpans[kind];
    let y = Math.floor((rt.rnd() % span) / 3) + 0x3c;
    if (!s.decorHigh) y += Math.trunc((span * 2) / 3);
    s.decorHigh = !s.decorHigh;
    s.nextDecor = s.frame + tables.decorDelays[kind];
    Object.assign(object, { age: 0, type: TYPE_DECOR, sprite: kind + DECOR_SPRITE, x: START_X, y: y * 20, dx: DECOR_DX, dy: DECOR_DY });
  };

  /**
   * `23d1:0209(n, 1)` : aux images paires, le parcours dit si un obstacle part (et lequel) ; son sprite est tiré parmi
   * cinq. Les branches de la triche (`DS:19df`, décision D9) ne sont pas portées.
   */
  const spawnObstacle = (object: IdefixObject): void => {
    if ((s.frame & 1) === 0) object.type = course.get(s.frame >> 1) ?? TYPE_FREE;
    if (object.type === TYPE_FREE) return;
    const low = object.type === TYPE_LOW;
    object.age = 0;
    object.sprite = low ? rt.rnd() % 5 : (rt.rnd() % 5) + HIGH_SPRITE;
    Object.assign(object, { x: START_X, y: low ? LOW_Y : HIGH_Y, dx: OBSTACLE_DX, dy: OBSTACLE_DY });
  };

  /** `23d1:04be(avance, n, juge)` : dessine l'objet, l'avance, et à sa 22e image ouvre le jugement de l'obstacle. */
  const stepObject = (object: IdefixObject, move: boolean, judge: boolean): void => {
    if (object.type === TYPE_FREE) return;
    rt.sprite(objectSheet, object.sprite, pixels(object.x), pixels(object.y));
    if (move) {
      object.x -= object.dx;
      object.y -= object.dy;
      if (object.x * 5 < GONE_X5) object.type = TYPE_FREE;
    }
    object.age++;
    if (!judge || object.age <= JUDGE_AGE || object.age >= JUDGED_AGE) return;
    object.age = JUDGED_AGE;
    if (s.hit) return;
    s.event = object.sprite < HIGH_SPRITE ? EVENT_LOW : EVENT_HIGH;
    s.countdown = JUDGED_FRAMES;
  };

  /** Choc : Idéfix passe sur `m34sa001.hy8`, animation 0 (obstacle du sol) ou 1 (obstacle du plafond). */
  const knock = (animation: number): void => {
    s.hit = true;
    s.pose = animation;
    dog.init(hitSheet);
    dog.select(animation);
    s.event = EVENT_NONE;
  };

  /** Obstacle franchi à cette image ; le jugement se referme après `JUDGED_FRAMES` images. */
  const pass = (): void => {
    if (--s.countdown === 0) s.event = EVENT_NONE;
  };

  /** `23d1:000c` : animation et dessin d'Idéfix, jugement de l'obstacle, puis commandes (seulement en course). */
  const stepDog = (directions: number): void => {
    if (s.pose === -1) {
      s.pose = POSE_RUN;
      dog.init(runSheet);
      dog.select(POSE_RUN);
    }
    dog.step();
    dog.draw(rt, DOG_X, DOG_Y);
    if (dog.wrapped) {
      if (s.hit) s.lost = true;
      else {
        s.pose = POSE_RUN;
        dog.select(POSE_RUN);
      }
    }
    if (s.event === EVENT_LOW) {
      if (s.pose === POSE_JUMP && dog.sprite > AIRBORNE_AFTER && dog.sprite !== LANDING_SPRITE) pass();
      else knock(0);
    } else if (s.event === EVENT_HIGH) {
      if (s.pose === POSE_DUCK) pass();
      else knock(1);
    }
    if (s.pose !== POSE_RUN || s.hit) return;
    if (directions & DOWN) {
      rt.effect(duckSound);
      s.pose = POSE_DUCK;
      dog.select(POSE_DUCK);
    }
    if (directions & UP) {
      rt.effect(jumpSound);
      s.pose = POSE_JUMP;
      dog.select(POSE_JUMP);
    }
  };

  /** Une image du couloir : fond, décor, obstacles, Idéfix (`23d1:0705`, boucles de course et de choc). */
  const drawFrame = (move: boolean, directions: number): void => {
    rt.restore();
    for (const object of decor) stepObject(object, move, false);
    for (const object of obstacles) stepObject(object, move, true);
    stepDog(directions);
  };

  /**
   * `23d1:05fb` : arrivée. Le décor défile encore 28 images sous l'animation `m34ag.muk`, dont chaque image partielle
   * est décodée sur le fond restauré ; elle n'a pas de palette (celle de `m34da000.mcc` reste).
   */
  const playEnding = function* (): Script {
    s.frame = 0;
    let moving = true;
    for (let image = 0; image < ending.frameCount; image++) {
      rt.restore();
      for (const object of decor) stepObject(object, moving, false);
      ending.seek(image);
      ending.compose(surface.work);
      s.frame++;
      if (s.frame === ENDING_VOICE_2) {
        voice.play(endVoice2);
        moving = false;
      } else if (s.frame === ENDING_VOICE_1) voice.play(endVoice1);
      spawnDecor();
      yield* rt.ticks(ENDING_TICKS);
    }
  };

  // `23d1:0705` : 40 images à vide peuplent le décor (dessinées dans le tampon, jamais présentées).
  while (s.frame < WARMUP_FRAMES) {
    s.frame++;
    for (const object of decor) stepObject(object, true, false);
    spawnDecor();
  }
  rt.restore();
  yield* rt.music("m34m.voc");
  rt.dirs();

  beginPlay(rt, MODULE, s);
  let touched = 0;
  for (;;) {
    if (s.hit) break;
    if (s.frame > LAST_FRAME && dog.sprite === 0) {
      s.won = true;
      break;
    }
    const directions = rt.dirs() | touched;
    touched = 0;
    drawFrame(true, directions);
    s.frame++;
    const free = obstacles.find((object) => object.type === TYPE_FREE);
    if (free) spawnObstacle(free);
    spawnDecor();
    // Au bout de la course, l'image où Idéfix repasse par le sprite 0 n'est pas attendue.
    if (s.frame <= LAST_FRAME || dog.sprite !== 0) {
      yield* waitFrame(FRAME_TICKS, () => {
        touched |= touchDirs(rt, TOUCH);
      });
    }
  }
  endPlay(rt);

  yield* rt.music(null);
  if (s.hit) {
    // Bruitage du choc sur la voie (`16cb:08c9(m34b0002, 0x800001)`) : il coupe la musique ; le couloir s'arrête.
    voice.play(hitSound);
    while (!s.lost) {
      drawFrame(false, 0);
      yield* rt.ticks(FRAME_TICKS);
    }
  } else {
    rt.stopSound();
    yield* playEnding();
  }
  yield* rt.waitSound();
  yield* rt.cleanup();
  if (player && !s.lost) yield* changeSesterces(rt, player, GAIN, true);
}

/** Case 47 : `23d1:09c1(1)` pour le joueur courant (l'argument 0 est celui du menu : `idefix(rt, null)`). */
export function* script(play: Play, entry: MinigameEntry): Script {
  yield* idefix(play.rt, entry.argument === 0 ? null : play.board.player);
}
