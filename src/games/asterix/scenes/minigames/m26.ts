import type { FogZone } from "../../data/exe";
import type { Play } from "../game";
import { VOICES, type Script } from "../runtime";
import { changeSesterces } from "../squares";
import { MUK_FPS, beginPlay, centrePointer, endPlay, libraryCursor, movePointer, playMuk, pointerClick } from "./common";

export { MUK_FPS };
export type { FogZone };

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
/**
 * Tables de l'exécutable (`rt.tables.fog`) : `DS:2524`, dix zones par scène (trois au niveau 0, trois au niveau 1,
 * quatre au niveau 2) ; `DS:2498`, les 35 noms de sons, dont le premier est le son de l'erreur.
 */
/** Couleurs 1 à 4 des volutes de `m26aa.mux` : rouge de chacune (`DS:5771`…), vert et bleu à `0xa0`. */
const FOG_REDS = [0x63, 0x7a, 0x6b, 0x8c] as const;
/** Clé du dossier de voix `MDF/26` (`DS:6412 = 0x36`, `DS:6410 = 1`) : `K26TE01` à `06` perdu, `07` à `12` gagné, par personnage. */
const VOICE_KEY = 154;

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

/** `1f31:0294`. */
export function* brouillard(play: Play): Script {
  const { rt, board } = play;
  const { surface, palette, resources, voice } = rt.ctx;
  const player = board.player;
  const level = player.reflexion;
  rt.voiceKey = VOICE_KEY;
  const tables = rt.tables.fog;

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
  const cursor = libraryCursor(rt);

  // Les volutes `m26aa.mux` par-dessus l'écran (`0x210c` : à même l'écran, palette gardée, non interruptible), pointeur
  // libre (`DS:0144 = 1`) recentré. Le rappel `1f31:01c5` lance le cri, attend le clic et arrête la vidéo, au clic ou
  // au marqueur du niveau.
  centrePointer(rt);
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
      if (s.phase !== PHASE_START) cursor.drawAtPointer();
    },
    poll: () => {
      movePointer(rt);
      if (s.phase === PHASE_START) {
        rt.effect(cry);
        s.phase = PHASE_SEARCH;
      } else if (s.phase === PHASE_SEARCH) {
        const click = pointerClick(rt);
        if (click) {
          s.clickX = click.x;
          s.clickY = click.y;
          s.button = click.button;
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
