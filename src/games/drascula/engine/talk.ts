import type { Roll, TalkView } from "../render/renderer";
import { pauseTicks } from "./cadence";
import { type Sequence, pause, unskippable } from "./sequence";

/**
 * Réplique dite : texte en sous-titre, voix et tête qui parle, jusqu'à la fin de la voix ou une touche. Socle de toutes les
 * fonctions `talk_*` et de `isTalkFinished` (engines/drascula/talk.cpp, ScummVM) ; les personnages (voix, texte, couleur, place du
 * sous-titre) sont dans `talkers.ts`, leurs images dans `render/heads.ts`.
 *
 * Déroulement (ScummVM) : la voix démarre (`talkInit`), puis la boucle « tire un visage, dessine, `pause(3)`, teste la fin » se répète ;
 * la réplique dure donc la durée de la voix, arrondie au tour suivant (3 pauses = 9 ticks). Une touche arrête la voix (et donc la
 * réplique), y compris Échap, qui ne coupe alors que la réplique et non la cinématique qui la contient (les attentes d'une réplique
 * ne se sautent pas : `unskippable`). Exception : `talk_drascula_big` lit Échap avant `isTalkFinished` et en fait un saut de la
 * cinématique, la voix allant à son terme (`escapeSkips`).
 * Écart voulu (`plan.md`, « Cas limites ») : une voix absente ne coupe pas la réplique au premier tour ; le texte reste affiché
 * `MISSING_VOICE_TICKS_PER_CHAR` ticks par caractère. Les visages sont tirés par le hasard du jeu (graine injectable), pas par un
 * hasard rebattu à chaque réplique (`talkInit` : `setSeed(generateNewSeed())`).
 */

/** Sous-titre à afficher : texte et point de référence (`centerText(said, x, y)`). */
export interface Subtitle {
  text: string;
  x: number;
  y: number;
  /** Couleur du texte (`TextColor`, `color_abc`) ; absente : la couleur courante reste. */
  color?: number;
}

/** Durée d'affichage d'une réplique sans voix, par caractère (60 ms). */
export const MISSING_VOICE_TICKS_PER_CHAR = 6;

/** Ce qu'une réplique utilise du moteur. */
export interface Speaker {
  readonly ticks: number;
  playSound(name: string): boolean;
  soundActive(): boolean;
  stopSound(): void;
  /** Consomme une touche du tampon (`getScan`) ; la première, ou `key` si on la nomme ; `null` si elle n'y est pas. */
  takeKey(key?: string): string | null;
  subtitle: Subtitle | null;
  /** Tête qui parle en cours : la vue et le tirage du tour ; `null` hors réplique. */
  head: { view: TalkView; roll: Roll } | null;
  /** Hasard du jeu (tirage des visages). */
  readonly rng: { inclusive(max: number): number };
}

/** Fichier de voix de la réplique `index` de `text` (`talk(int index)` : `"%i.als"`). */
export function voiceFile(index: number): string {
  return `${index}.als`;
}

/** Une réplique : ce que `speak` joue. */
export interface TalkLine {
  text: string;
  /** Fichier de voix (`214.als`, `I8.als`). */
  voice: string;
  /** Point de référence du sous-titre (`centerText`). */
  x: number;
  y: number;
  color?: number;
  /** Tête qui parle ; absente : la composition ordinaire de la pièce (ou de l'image libre) reste. */
  view?: TalkView;
  /** Nombre de visages tirés à chaque tour (`getRandomNumber(n - 1)`) ; 0 : pas de tirage. */
  faces?: number;
  /** Nombre de valeurs du second tirage (`talk_htel`) ; 0 : aucun. */
  extraFaces?: number;
  /** Visage imposé au tour `step` (`talk_sync` : un chiffre de la chaîne de synchronisation) à la place du tirage. */
  faceAt?: (step: number) => number;
  /** Durée d'un tour en unités de `pause` (3 par défaut ; `talk_blind` 2, `talk_trunk` 4). */
  turn?: number;
  /** Appelé au début de chaque tour, avant le dessin (relance de la musique, drapeau du coffre). */
  onTurn?: (step: number) => void;
  /** Échap fait sauter la cinématique au lieu de couper la réplique (`talk_drascula_big`) : `speak` rend alors vrai. */
  escapeSkips?: boolean;
}

/**
 * Dit une réplique. Rend vrai si Échap a demandé le saut de la cinématique (`escapeSkips` seulement). L'état de la réplique (sous-titre,
 * tête) est remis à zéro à la fin, normale ou non.
 */
export function* speak(speaker: Speaker, line: TalkLine): Sequence<boolean> {
  const playing = speaker.playSound(line.voice);
  const silentUntil = playing ? 0 : speaker.ticks + Math.max(pauseTicks(3), line.text.length * MISSING_VOICE_TICKS_PER_CHAR);
  let finished = false;
  let skipped = false;
  speaker.subtitle = { text: line.text, x: line.x, y: line.y, color: line.color };
  try {
    yield* unskippable(
      (function* (): Sequence {
        let step = 0;
        do {
          if (line.view) {
            const face = line.faceAt ? line.faceAt(step) : line.faces ? speaker.rng.inclusive(line.faces - 1) : 0;
            const extra = line.extraFaces ? speaker.rng.inclusive(line.extraFaces - 1) : 0;
            speaker.head = { view: line.view, roll: { face, extra, step } };
          }
          line.onTurn?.(step);
          yield* pause(line.turn ?? 3);
          step++;
          if (line.escapeSkips && speaker.takeKey("Escape") !== null) skipped = true;
          if (speaker.takeKey() !== null) {
            speaker.stopSound();
            break;
          }
        } while (playing ? speaker.soundActive() : speaker.ticks < silentUntil);
      })(),
    );
    finished = true;
  } finally {
    speaker.subtitle = null;
    speaker.head = null;
    if (!finished) speaker.stopSound();
  }
  return skipped;
}
