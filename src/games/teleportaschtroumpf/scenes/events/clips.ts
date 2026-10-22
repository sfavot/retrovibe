import { voiceName } from "../../engine/paths";
import type { BorlandRandom } from "../../engine/rng";
import type { GameEvent } from "../../game/rules";
import type { Position } from "../../game/tables";

/**
 * Animations des événements du plateau (S14 à S21, `2a78:015f..1244`) : quelle vidéo MUX, quelle voix. Table et choix
 * purs, sans scène (voir `docs/teleportaschtroumpf/screens-events.md`).
 *
 * Chaque routine de `2a78` fait marcher le pion jusqu'au point `target` (`2bd4:000f` en boucle) puis joue la vidéo : `a`
 * s'il arrivait de la gauche (`x < target + 1` au déclenchement, il marche vers la droite), `b` sinon (il marche vers la
 * gauche). L'arrivée dans `game/` est déjà réglée ; seule la vidéo dépend du côté.
 */

export type EventRequest = Extract<GameEvent, { type: "hazard" | "release" }>;

/** Voix prononcée après la vidéo : `prefix` + 1 + rand × `count` (`15f9:0db1`). */
interface ClipVoice {
  prefix: string;
  count: number;
  /** Un clic coupe la voix (`1f33:03a7(1)` ; les routines qui l'appellent sans argument n'ont pas ce raccourci : hypothèse). */
  skippable: boolean;
}

interface HazardClip {
  kind: Extract<EventRequest, { type: "hazard" }>["kind"];
  screen: number;
  /** Pièges seulement : écran d'arrivée, qui distingue les pièges d'un même écran. */
  arrival?: number;
  /** `x` où le pion s'arrête avant la vidéo ; absent : la vidéo est jouée sur place (fusée). */
  target?: number;
  /** Vidéo `a` (pion à gauche du point) puis `b` ; une seule vidéo pour la fusée. */
  files: readonly [string] | readonly [string, string];
  voice?: ClipVoice;
}

const trapVoice = (skippable: boolean): ClipVoice => ({ prefix: "s15a", count: 4, skippable });
const siphonVoice = (skippable: boolean): ClipVoice => ({ prefix: "s21v", count: 3, skippable });

/** Événements déclenchés par `Game` (`HAZARDS` de `game/tables.ts`), un par entrée ou presque. */
const HAZARD_CLIPS: readonly HazardClip[] = [
  // S14 : puits de l'écran 2 (`2a78:015f`).
  { kind: "wellFall", screen: 2, target: 0x104, files: ["s14a", "s14b"], voice: { prefix: "s14a", count: 4, skippable: true } },
  // Prison S20 (la voix de captivité `s20v` est celle du plateau, tour suivant).
  { kind: "jail", screen: 3, target: 0xac, files: ["s20a", "s20b"] },
  { kind: "jail", screen: 5, target: 0x106, files: ["s20d", "s20e"] },
  { kind: "jail", screen: 7, target: 0xb0, files: ["s20g", "s20h"] },
  { kind: "jail", screen: 8, target: 0x34, files: ["s20j", "s20k"] },
  { kind: "jail", screen: 9, target: 0x3a, files: ["s20m", "s20n"] },
  // Turlusiphon S21 : voix `s21v` 1 à 3.
  { kind: "turlusiphon", screen: 3, target: 0x109, files: ["s21a", "s21c"], voice: siphonVoice(false) },
  { kind: "turlusiphon", screen: 5, target: 0xa3, files: ["s21e", "s21g"], voice: siphonVoice(false) },
  { kind: "turlusiphon", screen: 6, target: 0x109, files: ["s21i", "s21k"], voice: siphonVoice(true) },
  // S13 : le pion arrive devant la porte du puits (le puits interactif suit).
  { kind: "wellDoor", screen: 4, target: 0x116, files: ["s13a", "s13b"] },
  { kind: "wellDoor", screen: 6, target: 0x41, files: ["s13c", "s13d"] },
  { kind: "wellDoor", screen: 9, target: 0x36, files: ["s13e", "s13f"] },
  // S15 : pièges de Gargamel.
  { kind: "trap", screen: 4, arrival: 9, target: 0xad, files: ["s15a", "s15b"], voice: trapVoice(true) },
  { kind: "trap", screen: 5, arrival: 9, target: 0x36, files: ["s15c", "s15d"], voice: trapVoice(false) },
  { kind: "trap", screen: 5, arrival: 8, target: 0x93, files: ["s15e", "s15f"], voice: trapVoice(false) },
  { kind: "trap", screen: 6, arrival: 7, target: 0xa9, files: ["s15g", "s15h"], voice: trapVoice(true) },
  { kind: "trap", screen: 8, arrival: 7, target: 0x52, files: ["s15i", "s15j"], voice: trapVoice(false) },
  { kind: "trap", screen: 8, arrival: 5, target: 0x9d, files: ["s15k", "s15l"], voice: trapVoice(false) },
  { kind: "trap", screen: 8, arrival: 3, target: 0x117, files: ["s15m", "s15n"], voice: trapVoice(false) },
  // S18 lac glacé, S16 pont branlant, S17 fusée.
  { kind: "ice", screen: 4, target: 0x106, files: ["s18a", "s18b"], voice: { prefix: "s18a", count: 4, skippable: true } },
  { kind: "bridge", screen: 7, target: 0x89, files: ["s16a", "s16b"], voice: { prefix: "s16a", count: 3, skippable: false } },
  { kind: "rocket", screen: 6, files: ["s17a"], voice: { prefix: "s17a", count: 4, skippable: true } },
];

/** Libération de la prison au début du tour (états 3 → 0) : une vidéo par écran, sans côté. */
const JAIL_RELEASE: Readonly<Record<number, string>> = { 3: "s20c", 5: "s20f", 7: "s20i", 8: "s20l", 9: "s20o" };

/** Libération du Turlusiphon (états 5 → 0) : vidéo selon le regard du pion (`right` : tourné vers la droite). */
const SIPHON_RELEASE: Readonly<Record<number, { right: string; left: string }>> = {
  3: { right: "s21b", left: "s21d" },
  5: { right: "s21f", left: "s21h" },
  6: { right: "s21j", left: "s21l" },
};

/** Ce que joue un événement : vidéo, puis voix éventuelle. */
export interface EventClip {
  /** Nom d'origine de la vidéo, par exemple `s15c.mux`. */
  video: string;
  /** Fichier voix tiré (`s15a003t.voc`), absent s'il n'y en a pas. Le fichier peut ne pas exister (`s18a004t`) : la voix est alors muette. */
  voice: string | null;
  /** Un clic coupe la voix. */
  voiceSkippable: boolean;
}

function findHazard(event: Extract<EventRequest, { type: "hazard" }>, before: Position, after: Position): HazardClip | undefined {
  return HAZARD_CLIPS.find((c) => c.kind === event.kind && c.screen === before.screen && (c.arrival === undefined || c.arrival === after.screen));
}

/** `x` où le pion s'arrête avant la vidéo d'un événement déclenché, `null` s'il n'y a pas de marche (fusée, libération). */
export function approachX(event: EventRequest, before: Position, after: Position): number | null {
  if (event.type !== "hazard") return null;
  return findHazard(event, before, after)?.target ?? null;
}

/**
 * Vidéo et voix d'un événement, ou `null` pour une combinaison inconnue. `facingRight` : regard du joueur (libération du
 * Turlusiphon). Tire la voix avec `rng`.
 */
export function pickClip(event: EventRequest, before: Position, after: Position, facingRight: boolean, rng: BorlandRandom): EventClip | null {
  if (event.type === "release") {
    if (event.from === "jail") {
      const file = JAIL_RELEASE[before.screen];
      return file ? { video: `${file}.mux`, voice: null, voiceSkippable: false } : null;
    }
    const files = SIPHON_RELEASE[before.screen];
    return files ? { video: `${facingRight ? files.right : files.left}.mux`, voice: null, voiceSkippable: false } : null;
  }
  const clip = findHazard(event, before, after);
  if (!clip) return null;
  const file = clip.files.length === 1 || clip.target === undefined || before.x <= clip.target ? clip.files[0] : clip.files[1];
  const voice = clip.voice ? voiceName(clip.voice.prefix, 1 + rng.below(clip.voice.count)) : null;
  return { video: `${file}.mux`, voice, voiceSkippable: clip.voice?.skippable ?? false };
}
