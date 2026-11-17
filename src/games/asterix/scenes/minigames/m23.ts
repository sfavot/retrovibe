import type { Sound } from "../../../../engine/infogrames/audio/sound";
import type { Play } from "../game";
import { DOWN, LEFT, RIGHT, UP, type Script, type Zone } from "../runtime";
import { changeSesterces } from "../squares";
import { Anim, beginPlay, endPlay, flushInput, waitFrame } from "./common";

/**
 * Mini-jeu « Non, tu ne chanteras pas !! » (case 3, `MDF/23`, segment `275a` : `275a:0052` et `275a:000a`).
 * Règles, adresses et niveaux de confiance : `docs/asterix/minigames/m23.md`.
 *
 * Le barde pince les cordes de sa lyre : une note, puis deux, puis trois… Après chaque démonstration, le joueur rejoue
 * la suite entière, une direction par corde. Une fausse note et tout est perdu ; cinq suites réussies rapportent
 * 1 sesterce, six 2, sept ou plus 3.
 */
export const MODULE = 23;

/** Durée de l'épreuve en secondes (chrono 2), lue à la fin de chaque suite : la suite en cours va toujours à son terme. */
export const DURATION = 60;
/** Temps accordé pour rejouer une suite entière, en secondes (chrono 3). */
export const ROUND_TIME = 15;
/** Une image tous les 6 ticks (`1831:030a(6)`) : 10 images par seconde. */
export const FRAME_TICKS = 6;
/** Nombre de cordes (tirage `rnd() & 3`). */
export const STRINGS = 4;
/** Direction de chaque corde, de gauche à droite (table de sauts `275a:05f9`) : gauche, haut, bas, droite. */
export const STRING_DIRS = [LEFT, UP, DOWN, RIGHT] as const;
/** Suites réussies à partir desquelles le joueur gagne. */
export const WIN_ROUNDS = 5;

/** Sesterces gagnés pour `rounds` suites réussies sans fausse note (`275a:05c1`) : 5 → 1, 6 → 2, 7 et plus → 3. */
export function gain(rounds: number): number {
  if (rounds < WIN_ROUNDS) return 0;
  return rounds === 5 ? 1 : rounds === 6 ? 2 : 3;
}

/** Animations de `m23s.hy8` : attente (1 image), démonstration (8 images), puis une par corde pincée par le joueur (8 images). */
const ANIM_IDLE = 0;
const ANIM_SHOW = 1;
const ANIM_PLUCK = 2;
/** Ancre du barde ; pendant la démonstration sa main se décale de 12 pixels par corde. */
const BARD_X = 0x22;
const BARD_Y = 0x23;
const STRING_STEP = 0xc;
/** Rang de l'animation de démonstration (`+0x16`) auquel la note sonne. */
const SHOW_NOTE_RANK = 3;
/** Indice de la fausse note dans la table des sons (`DS:7390`, `b23-99a.voc`). */
const WRONG_NOTE = 4;

/** Clé du dossier de voix `MDF/23` (`DS:6412 = 0x40`) : posée par le module, qui ne joue pourtant aucune voix. */
const VOICE_KEY = 64;

/**
 * Décision D11 : cliquer ou toucher une corde la pince. Les cordes sont obliques (de (172, 45) à (145, 160) pour la
 * première, 11 pixels d'écart) : chacune est couverte par des tranches de 25 lignes ; les deux cordes du bord débordent
 * de 8 pixels vers l'extérieur. Les quatre chevilles de couleur, en haut de la lyre, valent chacune leur corde.
 */
const STRING_GAP = 11;
const TOUCH: readonly (readonly [Zone, number])[] = (() => {
  const zones: [Zone, number][] = [];
  for (let string = 0; string < STRINGS; string++) {
    for (let y1 = 40; y1 < 165; y1 += 25) {
      const centre = Math.round(172 - (27 * (y1 + 12 - 45)) / 115) + STRING_GAP * string;
      const x1 = centre - 5 - (string === 0 ? 8 : 0);
      const x2 = centre + 5 + (string === STRINGS - 1 ? 8 : 0);
      zones.push([{ x1, y1, x2, y2: y1 + 24 }, string]);
    }
    const peg = 169 + Math.floor(12.5 * string);
    zones.push([{ x1: peg, y1: 6, x2: peg + 11, y2: 22 }, string]);
  }
  return zones;
})();
const TOUCH_ZONES = TOUCH.map(([zone]) => zone);

/** Zones cliquables d'une corde (tests et robots). */
export function stringZones(string: number): Zone[] {
  return TOUCH.filter(([, s]) => s === string).map(([zone]) => zone);
}

/** État du mini-jeu (variables locales de `275a:0052`), exposé aux robots par `rt.hint.state`. */
export interface BardeState {
  /** `[BP − 0x72]` : la suite de cordes (0 à 3, de gauche à droite), une de plus à chaque démonstration. */
  sequence: number[];
  /** `SI` : longueur de la suite en cours. */
  length: number;
  /** `DI` : pendant la démonstration, rang de la note montrée ; pendant la réponse, nombre de notes déjà rejouées. */
  index: number;
  /** `"show"` : le barde montre la suite ; `"input"` : le joueur la rejoue. */
  phase: "show" | "input";
  /** Vrai pendant que le jeu attend une direction (boucle `275a:033c`). */
  waiting: boolean;
  /** `[BP − 5]` : fausse note. */
  failed: boolean;
  /** `[BP − 4] >= 15` : la suite n'a pas été rejouée à temps. */
  timedOut: boolean;
  /** Suites réussies, calculé à la fin (`SI`, moins un si la dernière n'est pas finie) ; −1 pendant le jeu. */
  rounds: number;
}

/** `275a:0052`. */
export function* barde(play: Play): Script {
  const { rt, board } = play;
  const { surface, resources, voice } = rt.ctx;
  const player = board.player;
  rt.voiceKey = VOICE_KEY;
  // Table `DS:7390` (7 octets par son) : les trois premiers en EMS, les deux derniers en mémoire.
  const [sounds, sheet] = yield* rt.load(
    Promise.all([
      Promise.all(["b23-11a.voc", "b23-12a.voc", "b23-13a.voc", "b23-14a.voc", "b23-99a.voc"].map((name) => resources.sound(name))),
      resources.hy8("m23s.hy8"),
    ]),
  );
  // `M23AA` (7 images muettes, `0x20100` : plein écran, sans interruption) amène la lyre ; sa dernière image devient le décor.
  yield* rt.video("M23AA.mux", { skip: "none" });
  surface.commitBackground();

  const s: BardeState = { sequence: [], length: 0, index: 0, phase: "show", waiting: false, failed: false, timedOut: false, rounds: -1 };
  const bard = new Anim(sheet);
  /** `+0x16` de l'objet animation : rang de l'image à venir, 0 quand l'animation vient de boucler. */
  let rank = 0;
  let frames = 1;
  const select = (animation: number): void => {
    bard.select(animation);
    frames = sheet.animations[animation].frames.length;
    rank = 0;
  };
  /** Une image : fond, un pas d'animation, le barde, présentation. */
  const show = (x = BARD_X): void => {
    rt.restore();
    bard.step();
    rank = (rank + 1) % frames;
    bard.draw(rt, x, BARD_Y);
  };
  /** `275a:000a(n)` : son `n` de la table, sur la voie principale (`16cb:08c9`, `0x800001` ou `0x800004`). */
  const note = (n: number): void => voice.play(sounds[n] as Sound);
  /** Joue l'animation courante en entier, une image tous les 6 ticks. */
  const animate = function* (x: number, eachFrame?: () => void): Script {
    do {
      show(x);
      eachFrame?.();
      yield* waitFrame(FRAME_TICKS);
    } while (rank !== 0);
  };

  rt.startChrono(2);
  select(ANIM_IDLE);
  show();
  beginPlay(rt, MODULE, s);
  let elapsed = 0;
  do {
    // Une corde de plus. Niveau Réflexion 1 : jamais trois fois de suite la même ; niveau 2 : jamais deux fois de suite.
    const n = s.length;
    const level = n < 1 ? 0 : player.reflexion;
    const draw = (): number => (s.sequence[n] = rt.rnd() & 3);
    if (level === 0 || (level === 1 && n < 2)) draw();
    else if (level === 1) while (draw() === s.sequence[n - 1] && s.sequence[n] === s.sequence[n - 2]);
    else if (level === 2) while (draw() === s.sequence[n - 1]);
    s.length++;

    // Démonstration : la main du barde va sur chaque corde, la note sonne à la troisième image.
    s.phase = "show";
    for (s.index = 0; s.index < s.length; s.index++) {
      const string = s.sequence[s.index];
      select(ANIM_SHOW);
      yield* animate(BARD_X + STRING_STEP * string, () => {
        if (rank === SHOW_NOTE_RANK) note(string);
      });
    }

    // Réponse : la suite entière en 15 secondes.
    s.index = 0;
    s.phase = "input";
    rt.startChrono(3);
    yield* flushInput(rt);
    do {
      select(ANIM_IDLE);
      show();
      let directions = 0;
      s.waiting = true;
      for (;;) {
        elapsed = rt.chrono(3);
        if (elapsed >= ROUND_TIME) break;
        directions = rt.dirs();
        const click = rt.click(TOUCH_ZONES);
        if (typeof click === "number") directions |= STRING_DIRS[TOUCH[click][1]];
        if (directions) break;
        yield;
      }
      s.waiting = false;
      // Deux directions à la fois ne désignent aucune corde.
      const string = STRING_DIRS.indexOf(directions as (typeof STRING_DIRS)[number]);
      if (string >= 0 && elapsed < ROUND_TIME) {
        if (s.sequence[s.index] === string) {
          s.index++;
          note(string);
          select(ANIM_PLUCK + string);
          yield* animate(BARD_X);
        } else {
          note(WRONG_NOTE);
          s.failed = true;
        }
      }
      yield* rt.wait(10);
      yield* rt.waitSound();
    } while (!s.failed && s.index < s.length && elapsed < ROUND_TIME);
    s.timedOut = elapsed >= ROUND_TIME;
    if (s.index === s.length) {
      select(ANIM_IDLE);
      show();
      yield* rt.wait(50);
    }
  } while (!s.failed && rt.chrono(2) < DURATION && elapsed < ROUND_TIME);
  s.rounds = s.failed ? 0 : s.index < s.length ? s.length - 1 : s.length;
  endPlay(rt);

  yield* rt.waitSound();
  // Gagné : `M23AB`. Perdu (fausse note, ou moins de cinq suites) : `M23AC`, `AD` ou `AE` au hasard. `0x20d00` : interruptible.
  const won = s.rounds >= WIN_ROUNDS;
  yield* rt.video(won ? "M23AB.mux" : `M23A${"CDE"[rt.rnd() % 3]}.mux`);
  // L'original ne présente pas le fond que restaure le nettoyage : la dernière image de la vidéo reste à l'écran.
  surface.commitBackground();
  yield* rt.cleanup();
  if (won) yield* changeSesterces(rt, player, gain(s.rounds), true);
}
