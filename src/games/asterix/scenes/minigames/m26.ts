import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../../engine/infogrames/data/mcg";
import { VideoPlayer } from "../../../../engine/infogrames/video";
import type { Play } from "../game";
import { VOICES, type Runtime, type Script } from "../runtime";
import { changeSesterces } from "../squares";
import { beginPlay, endPlay } from "./common";

/**
 * Mini-jeu « Le brouillard » (case 8, `MDF/26`, segment `1f31` : `1f31:0294` et ses quatre fonctions).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m26.md`.
 *
 * Une scène pleine d'animaux est montrée quelques secondes, puis le brouillard la recouvre. Un cri se fait entendre :
 * le joueur montre de la flèche l'endroit où se tenait l'animal qui l'a poussé. Le brouillard se lève, l'animal est
 * encadré. Bien visé : 1 sesterce.
 */
export const MODULE = 26;

/** Sesterces gagnés (`1d24:0912(joueur, 1, 1)`). */
export const GAIN = 1;
/** Scènes (`rnd() % 5`) : lettre A à E du nom des fichiers. */
export const SCENE_COUNT = 5;
/** Zones décrites par scène dans `DS:2524` : trois au niveau 0, trois au niveau 1, quatre au niveau 2. */
const ZONES_PER_SCENE = 10;
/** Noms de sons de `DS:2498` ; le premier est le son de l'erreur. */
const SOUND_COUNT = 35;
/** Couleurs 1 à 4 des volutes de `m26aa.mux` : rouge de chacune (`DS:5771`…), vert et bleu à `0xa0`. */
const FOG_REDS = [0x63, 0x7a, 0x6b, 0x8c] as const;
/** Clé du dossier de voix `MDF/26` (`DS:6412 = 0x36`, `DS:6410 = 1`) : `K26TE01` à `06` perdu, `07` à `12` gagné, par personnage. */
const VOICE_KEY = 154;
/** Centre de l'écran, où `153c:0030` replace le pointeur. */
const CENTER_X = 160;
const CENTER_Y = 100;
/**
 * Cadence des MUK. L'original les déroule sans temporisation (`19b9:019f` : au rythme du lecteur de CD et du décodeur) ;
 * le portage prend la cadence par défaut du moteur commun pour une vidéo sans en-tête, 11 images par seconde.
 */
export const MUK_FPS = 11;

/** Secondes pendant lesquelles la scène reste visible avant le brouillard (`1a93:01c3(8 − 2 × niveau)`). */
export function viewSeconds(level: number): number {
  return 8 - 2 * level;
}

/** Nombre d'animaux possibles (`DS:6a5b`). */
export function zoneCount(level: number): number {
  return level === 2 ? 4 : 3;
}

/** Marqueur `08` de `m26aa.mux` qui clôt la recherche : 3 au niveau 0 (40 s), 2 au niveau 1 (32 s), 1 au niveau 2 (24 s). */
export function endMarker(level: number): number {
  return 3 - level;
}

/** Phases du rappel `1f31:01c5` (`DS:6a5f`). */
export const PHASE_START = 0;
export const PHASE_SEARCH = 1;
export const PHASE_STOP = 2;
export const PHASE_REVEAL = 3;

/** Une zone de `DS:2524` (10 octets) : rectangle en pixels d'écran et rang du cri dans `DS:2498`. */
export interface FogZone {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  sound: number;
}

/** Un pixel du curseur de bibliothèque. */
interface CursorPixel {
  x: number;
  y: number;
  color: number;
}

export interface FogTables {
  /** `DS:2498` : noms des sons (pointeurs lointains vers `DS:2718`…). */
  sounds: string[];
  /** `DS:2524 + 100 × scène + 10 × zone`. */
  zones: FogZone[][];
  /** `DS:11d4` : flèche 16 × 16 du curseur de bibliothèque (`18a1`), noire à l'intérieur blanc (couleurs 0 et 255). */
  cursor: CursorPixel[];
}

const EXECUTABLE = "ASTERIX.EXE";
/** Segment de chargement de la décompilation et segment de données (comme `data/exe.ts`). */
const LOAD_SEGMENT = 0x1000;
const DGROUP = 0x2de2;
const CURSOR_SIZE = 16;

/** Lit dans `ASTERIX.EXE` les tables du mini-jeu (décision D4). */
export function parseFogTables(exe: Uint8Array): FogTables {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const ds = view.getUint16(8, true) * 16 + (DGROUP - LOAD_SEGMENT) * 16;
  const text = (offset: number): string => {
    let end = ds + offset;
    while (exe[end] !== 0) end++;
    return String.fromCharCode(...exe.subarray(ds + offset, end));
  };
  const sounds = Array.from({ length: SOUND_COUNT }, (_, i) => text(view.getUint16(ds + 0x2498 + 4 * i, true)));
  const zones = Array.from({ length: SCENE_COUNT }, (_, scene) =>
    Array.from({ length: ZONES_PER_SCENE }, (_, i): FogZone => {
      const at = ds + 0x2524 + 100 * scene + 10 * i;
      return { x1: view.getInt16(at, true), y1: view.getInt16(at + 2, true), x2: view.getInt16(at + 4, true), y2: view.getInt16(at + 6, true), sound: exe[at + 8] };
    }),
  );
  // Format de `18a1:0559`, ligne par ligne : nombre de segments ; par segment, pixels sautés, puis un mot (octet bas :
  // nombre de quadruplets, octet haut : nombre d'octets) et les pixels ; enfin les pixels sautés en fin de ligne.
  const cursor: CursorPixel[] = [];
  let at = ds + 0x11d4;
  for (let y = 0; y < CURSOR_SIZE; y++) {
    let x = 0;
    for (let segments = exe[at++]; segments > 0; segments--) {
      x += exe[at++];
      const length = exe[at] * 4 + exe[at + 1];
      at += 2;
      for (let i = 0; i < length; i++) cursor.push({ x: x++, y, color: exe[at++] });
    }
    at++;
  }
  return { sounds, zones, cursor };
}

/** État du mini-jeu (globales `DS:69f9` à `DS:6a5f`), exposé aux robots par `rt.hint.state`. */
export interface BrouillardState {
  /** `DS:6a5d` : scène tirée, 0 à 4. */
  scene: number;
  /** Niveau Réflexion du joueur. */
  level: number;
  /** Zones du niveau (`DS:6a5b` zones à partir du rang `DS:6a57`). */
  zones: readonly FogZone[];
  /** `DS:6a59` : rang de la zone de l'animal qui crie. */
  target: number;
  /** `DS:6a5f`. */
  phase: number;
  /** `DS:6a01` : bouton du clic retenu (1 gauche, 2 droit), 0 sans clic. */
  button: number;
  /** `DS:6a05`, `DS:6a03` : position du clic. */
  clickX: number;
  clickY: number;
  /** `DS:69fa`, `DS:69f9`. */
  won: boolean;
  lost: boolean;
}

/**
 * `19b9:019f(nom, rappel)` : joue un MUK en entier, puis attend la fin de la voie. Chaque image apporte sa palette
 * (envoyée aussitôt, entrée 0 à noir) et se décode sur l'image précédente ; `each` est le rappel d'image.
 */
function* playMuk(rt: Runtime, name: string, each?: (frame: number) => void): Script {
  const { surface, palette, resources, clock } = rt.ctx;
  const video = new VideoPlayer(yield* rt.load(resources.video(name)));
  const start = clock.ticks;
  for (let frame = 0; frame < video.frameCount; frame++) {
    video.seek(frame);
    palette.load(video.palette);
    video.compose(surface.work);
    each?.(frame);
    while ((clock.ticks - start) * MUK_FPS < (frame + 1) * 60) yield;
  }
  yield* rt.waitSound();
}

/** `1f31:0294`. */
export function* brouillard(play: Play): Script {
  const { rt, board } = play;
  const { surface, palette, resources, input, voice } = rt.ctx;
  const player = board.player;
  const level = player.reflexion;
  rt.voiceKey = VOICE_KEY;
  const tables = parseFogTables(yield* rt.load(resources.bytes(EXECUTABLE)));

  const scene = rt.rnd() % SCENE_COUNT;
  const stem = `M26D${String.fromCharCode(0x41 + scene)}`;
  yield* rt.picture(`${stem}00${level}.mcg`, 3);
  rt.commit();
  const zones = tables.zones[scene].slice(level * 3, level * 3 + zoneCount(level));
  const s: BrouillardState = {
    scene,
    level,
    zones,
    target: rt.rnd() % zones.length,
    phase: PHASE_START,
    button: 0,
    clickX: 0,
    clickY: 0,
    won: false,
    lost: false,
  };
  const zone = zones[s.target];
  const [cry, wrong] = yield* rt.load(Promise.all([resources.sound(tables.sounds[zone.sound]), resources.sound(tables.sounds[0])]));

  // La scène à mémoriser, puis le brouillard qui tombe (décodé à même l'écran).
  yield* rt.waitClick(viewSeconds(level));
  yield* playMuk(rt, `${stem}00${level}.muk`);
  palette.setColor(0, 0, 0, 0);
  FOG_REDS.forEach((red, i) => palette.setColor(i + 1, red, 0xa0, 0xa0));

  /** Curseur de bibliothèque (`18a1:0262(0)`), coin haut gauche sur le pointeur, coupé au bord de l'écran. */
  const drawCursor = (): void => {
    for (const { x, y, color } of tables.cursor) {
      const px = input.mouseX + x;
      const py = input.mouseY + y;
      if (px < SCREEN_WIDTH && py < SCREEN_HEIGHT) surface.work[py * SCREEN_WIDTH + px] = color;
    }
  };

  // Les volutes `m26aa.mux` par-dessus l'écran (`0x210c` : à même l'écran, palette gardée, non interruptible), pointeur
  // libre (`DS:0144 = 1`) recentré. Le rappel `1f31:01c5` lance le cri, attend le clic et arrête la vidéo, au clic ou
  // au marqueur du niveau.
  input.warpMouse(CENTER_X, CENTER_Y);
  const screen = surface.work.slice();
  let marker = 0;
  beginPlay(rt, MODULE, s);
  yield* rt.video("m26aa.mux", {
    skip: "none",
    keepPalette: true,
    target: screen,
    draw: (video) => {
      marker = video.marker;
      surface.work.set(screen);
      if (s.phase !== PHASE_START) drawCursor();
    },
    poll: () => {
      input.moveMouseByKeys();
      if (s.phase === PHASE_START) {
        rt.effect(cry);
        s.phase = PHASE_SEARCH;
      } else if (s.phase === PHASE_SEARCH) {
        const button = rt.click() !== null ? 1 : input.justPressed("cancel") ? 2 : 0;
        if (button !== 0) {
          s.clickX = input.mouseX;
          s.clickY = input.mouseY;
          s.button = button;
          s.phase = PHASE_STOP;
        }
      } else return true;
      if (marker === endMarker(level)) s.phase = PHASE_STOP;
      return false;
    },
  });
  endPlay(rt);
  s.phase = PHASE_REVEAL;

  /** `1f31:000a` : cadre noir doublé d'un cadre blanc autour de la zone de l'animal. */
  const frameTarget = (): void => {
    rt.frame(zone.x1 - 1, zone.y1 - 1, zone.x2 + 2, zone.y2 + 2, 0);
    rt.frame(zone.x1 - 2, zone.y1 - 2, zone.x2 + 1, zone.y2 + 1, 0xff);
  };

  /**
   * `1f31:00f1` : seul un clic gauche est jugé. Gagné s'il est dans la zone de l'animal (les autres zones ne comptent
   * pas), sinon perdu ; le cri de l'animal ou le son de l'erreur part sur la voie.
   */
  const judge = (): void => {
    if (s.button !== 1) return;
    s.won = zone.x1 <= s.clickX && zone.y1 <= s.clickY && s.clickX < zone.x2 && s.clickY < zone.y2;
    s.lost = !s.won;
    voice.play(s.won ? cry : wrong);
  };

  // Le brouillard se lève (`M26D?10n.muk`, rappel `1f31:0275`) : jugement à la première image, cadre à chacune.
  yield* playMuk(rt, `${stem}10${level}.muk`, (frame) => {
    if (frame === 0) judge();
    frameTarget();
  });
  surface.commitBackground();
  yield* rt.cleanup();

  if (s.won) {
    yield* changeSesterces(rt, player, GAIN, true);
    yield* rt.voice(player.character + 6);
  } else if (s.lost) {
    yield* rt.voice(player.character);
  } else {
    // Ni clic gauche ni réponse : Panoramix (`DS:6412 = 7`, `DS:6410 = 6`).
    yield* rt.voice(0, VOICES.panoramix);
  }
  yield* rt.fadeOut(16);
}
