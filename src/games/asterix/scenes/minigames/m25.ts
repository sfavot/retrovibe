import type { Session } from "../../game/state";
import type { Play } from "../game";
import type { Runtime, Script, Zone } from "../runtime";
import { changeSesterces } from "../squares";
import { beginPlay, endPlay, fadeSoundOut, flushInput } from "./common";
import { SoftCursor, centrePointer, dataOffset, loadExecutable, movePointer, pointerAt } from "./m24";

/**
 * Mini-jeu « Anachronismes » (case 40, `MDF/25`, segment `1f01` : une seule fonction, `1f01:0008`).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m25.md`.
 *
 * Une image du niveau Réflexion du joueur cache un objet qui n'est pas de l'époque. Le joueur a 35, 25 ou 15 secondes
 * pour le montrer d'un seul clic : dans sa zone il gagne 1 sesterce, à côté ou trop tard il perd.
 */
export const MODULE = 25;

/** Images `M25DA000.mcg` à `043` et leur table `DS:22a2` (10 octets : x1, y1, x2, y2, niveau). */
export const PICTURES = 0x2c;
const ZONE_TABLE = 0x22a2;
const ZONE_SIZE = 10;
/** Décalage (32, 40) des coordonnées de la table. */
const ORIGIN_X = 0x20;
const ORIGIN_Y = 0x28;
/** Temps de recherche : `35 − 10 × niveau` secondes (`1a93:01c3`). */
export const TIME_LIMIT = 0x23;
export const TIME_PER_LEVEL = 10;
/** Sesterces gagnés (`1d24:0912(joueur, 1, 1)`). */
export const GAIN = 1;
/** Couleurs du double cadre de la bonne réponse. */
const DARK = 0x7e;
const LIGHT = 0x7f;

/** Clé du dossier de voix `MDF/25` (`DS:6412 = 0x1e`, `DS:6410 = 1`). */
const VOICE_KEY = 130;
/** Voix `K25TE` : trouvé `personnage + 6 × (rnd() & 1)`, temps écoulé `personnage + 12`, à côté `personnage + 18`. */
const WIN_VOICE_STEP = 6;
const TIMEOUT_VOICE = 0xc;
const MISS_VOICE = 0x12;

/** Une image et son anachronisme. */
export interface Anachronism {
  /** Coordonnées de la table (`DS:22a2 + 10n`), décalées de (32, 40). */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Niveau Réflexion auquel l'image est proposée. */
  level: number;
}

/** Lit la table `DS:22a2` de l'exécutable. */
export function readAnachronisms(exe: Uint8Array): Anachronism[] {
  const view = new DataView(exe.buffer, exe.byteOffset, exe.byteLength);
  const start = dataOffset(exe, ZONE_TABLE);
  return Array.from({ length: PICTURES }, (_, n) => {
    const [x1, y1, x2, y2, level] = [0, 2, 4, 6, 8].map((field) => view.getInt16(start + n * ZONE_SIZE + field, true));
    return { x1, y1, x2, y2, level };
  });
}

/** Nom de l'image `n` : `M25DA00%d.mcg` jusqu'à 9, `M25DA0%d.mcg` au-delà. */
export function pictureFile(n: number): string {
  return `M25DA${String(n).padStart(3, "0")}.mcg`;
}

/** Zone à l'écran où un clic trouve l'anachronisme (bords compris) : `x1 − 32 <= x < x2 − 32`, `y1 − 40 <= y < y2 − 40`. */
export function hitZone(item: Anachronism): Zone {
  return { x1: item.x1 - ORIGIN_X, y1: item.y1 - ORIGIN_Y, x2: item.x2 - ORIGIN_X - 1, y2: item.y2 - ORIGIN_Y - 1 };
}

/**
 * Curseur 16 × 16 de la bibliothèque (`18a1:0262(0)` le montre, le rappel d'horloge `18a1:04aa` le dessine à l'écran),
 * forme `DS:11d4` décodée comme `18a1:0559` : par ligne, un nombre de segments ; par segment, des points transparents à
 * sauter, puis un mot (octet bas : quadruplets, octet haut : octets en plus) et autant de couleurs ; enfin les points
 * transparents de fin de ligne. Couleurs 0 (contour) et 255 (corps, blanc dans les 44 images).
 */
export function libraryCursor(rt: Runtime, exe: Uint8Array): SoftCursor {
  const size = 16;
  const pixels = new Int16Array(size * size).fill(-1);
  let at = dataOffset(exe, 0x11d4);
  for (let row = 0; row < size; row++) {
    let column = 0;
    for (let segments = exe[at++]; segments > 0; segments--) {
      column += exe[at++];
      const length = exe[at] * 4 + exe[at + 1];
      at += 2;
      for (let i = 0; i < length; i++) pixels[row * size + column++] = exe[at++];
    }
    at++;
  }
  return new SoftCursor(rt, size, size, pixels);
}

/** État du mini-jeu, exposé aux robots par `rt.hint.state`. */
export interface AnachronismesState {
  /** `SI` : numéro de l'image. */
  picture: number;
  /** Zone de l'anachronisme à l'écran. */
  zone: Zone;
  /** Secondes accordées. */
  limit: number;
  /** `[BP − 1]` : trouvé. */
  found: boolean;
  /** `[BP − 2]` : cliqué à côté. */
  missed: boolean;
}

/** `DS:245a` : dernière image tirée, gardée d'une partie à l'autre (décision D13) ; 0 au lancement. */
const LAST_PICTURE = new WeakMap<Session, number>();

/** `1f01:0008`. */
export function* anachronismes(play: Play): Script {
  const { rt, board } = play;
  const { resources, voice } = rt.ctx;
  const player = board.player;
  const exe = yield* loadExecutable(rt);
  const table = readAnachronisms(exe);

  // Une image du niveau du joueur, différente de la précédente.
  let picture: number;
  do picture = rt.rnd() % PICTURES;
  while (table[picture].level !== player.reflexion || picture === (LAST_PICTURE.get(rt.session) ?? 0));
  LAST_PICTURE.set(rt.session, picture);
  const item = table[picture];
  yield* rt.picture(pictureFile(picture), 3);
  const [goodSound, wrongSound] = yield* rt.load(Promise.all([resources.sound("b24-03a.voc"), resources.sound("b24-01a.voc")]));
  yield* rt.music("m25m.voc");
  rt.commit();

  const s: AnachronismesState = {
    picture,
    zone: hitZone(item),
    limit: TIME_LIMIT - TIME_PER_LEVEL * player.reflexion,
    found: false,
    missed: false,
  };
  yield* flushInput(rt);
  centrePointer(rt);
  const cursor = libraryCursor(rt, exe);

  // `1a93:01c3(limite)` : jusqu'au premier clic gauche ou à la fin du temps, le curseur suit le pointeur.
  beginPlay(rt, MODULE, s);
  const end = rt.cs + s.limit * 100;
  let clicked = false;
  for (;;) {
    movePointer(rt);
    const pointer = pointerAt(rt);
    cursor.erase();
    cursor.draw(pointer.x, pointer.y);
    clicked = rt.click() !== null;
    if (clicked || rt.cs >= end) break;
    yield;
  }
  endPlay(rt);

  rt.restore();
  if (clicked) {
    const { x, y } = pointerAt(rt);
    if (x >= s.zone.x1 && x <= s.zone.x2 && y >= s.zone.y1 && y <= s.zone.y2) {
      rt.frame(item.x1 - 0x21, item.y1 - 0x29, item.x2 - 0x1e, item.y2 - 0x26, DARK);
      rt.frame(item.x1 - 0x22, item.y1 - 0x2a, item.x2 - 0x1f, item.y2 - 0x27, LIGHT);
      rt.effect(goodSound);
      s.found = true;
    } else {
      rt.effect(wrongSound);
      s.missed = true;
    }
    yield* rt.waitRelease();
  }
  while (voice.effectPlaying) yield;
  yield* rt.wait(0x19);
  yield* fadeSoundOut(rt, 1);
  yield* rt.wait(0x19);
  if (s.found) {
    yield* rt.voice(player.character + (rt.rnd() & 1) * WIN_VOICE_STEP, VOICE_KEY);
    yield* changeSesterces(rt, player, GAIN, true);
  } else {
    yield* rt.voice(player.character + (s.missed ? MISS_VOICE : TIMEOUT_VOICE), VOICE_KEY);
  }
  yield* rt.cleanup();
}
