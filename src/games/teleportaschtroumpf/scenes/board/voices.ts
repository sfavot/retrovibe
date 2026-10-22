import { TICKS_PER_SECOND } from "../../engine/clock";
import { voiceName } from "../../engine/paths";
import type { BorlandRandom } from "../../engine/rng";
import type { SceneContext } from "../../engine/scene";
import { zoneOf } from "../../game/board";
import { CHARACTER_TEXT_INDEX, DOORS, WELL_S14_SCREEN, type Row } from "../../game/tables";

/**
 * Voix du plateau : choix du fichier (`26ee:006a`, `28a3:04dc`, `291e:0401`) et lecture asynchrone d'une voix.
 */

/** Nom du fichier voix `sNNv` + numéro (`15f9:0db1`). */
export type VoiceFile = string;

/**
 * Indice vocal ou annonce du Grand Schtroumpf `26ee:006a(n)` : `n` = 0 prisonnier (`s20v`), 1 premier indice à 12 s,
 * 2 second à 24 s, 3 action automatique sans rien avoir touché, 6 « rien ici » (multijoueur), 12 annonce du personnage
 * au début du tour, 16 siphon. Les numéros 4 et 5 (`s21v`) sont ceux des animations du Turlusiphon ; 13 et 14 (`s42v`)
 * appartiennent au Grand Schtroumpf. Renvoie `null` pour un numéro sans voix.
 */
export function hintVoice(n: number, character: number, rng: BorlandRandom): VoiceFile | null {
  switch (n) {
    case 0:
      return voiceName("s20v", 1 + rng.below(3));
    case 1:
      return voiceName("s01v", 0x1f + rng.below(5));
    case 2:
      return voiceName("s01v", 0x24 + rng.below(5));
    case 3:
      return voiceName("s01v", 0x29 + rng.below(5));
    case 4:
      return voiceName("s21v", 2 + rng.below(2));
    case 5:
      return voiceName("s21v", 4 + rng.below(2));
    case 6:
      return voiceName("s01v", 0x2e + rng.below(5));
    case 12:
      return voiceName("s01v", CHARACTER_TEXT_INDEX[character] * 5 + rng.below(5) + 1);
    case 16: {
      const pick = rng.below(3);
      return pick === 0 ? voiceName("s20v", 1) : pick === 1 ? voiceName("s20v", 3) : voiceName("s21v", 1);
    }
    default:
      return null;
  }
}

/**
 * Voix d'aide du clic droit (`291e:0401` : `s45v` + `local_42[zone]`, table `DS:28B2`) : numéro de la porte de la zone, 13
 * pour la porte du puits ouvert (écrans 4, 6 et 9 ; le puits de l'écran 2 garde 14), rien dans les zones sans porte.
 * `null` = pas de voix.
 */
export function zoneHelpVoice(screen: number, row: Row, x: number): VoiceFile | null {
  const door = DOORS[screen - 1]?.[row]?.[zoneOf(x)];
  if (door === null || door === undefined) return null;
  return voiceName("s45v", door === 14 && screen !== WELL_S14_SCREEN ? 13 : door);
}

/** Écrans de mini-jeu précédés d'une voix d'accroche `sNNa` + 1 ou 2 (`28a3:04dc`) ; S51 : toujours la 1. */
const INTRO_SCENES = new Set([22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 40, 51]);

/** Voix d'accroche prononcée avant un mini-jeu (`28a3:04dc`), ou `null` (S13, S38, S39, S41). */
export function introVoice(scene: number, rng: BorlandRandom): VoiceFile | null {
  if (!INTRO_SCENES.has(scene)) return null;
  const n = scene === 51 ? 1 : 1 + rng.below(2);
  return voiceName(`s${scene}a`, n);
}

/**
 * Une voix dont le fichier se charge en tâche de fond : `update` la lance une fois lue, puis rend `true` quand elle est
 * finie, coupée (`skip`) ou introuvable. Une sortie audio verrouillée la finit aussitôt (rien ne joue).
 */
export class VoiceLine {
  private state: "loading" | "playing" | "done";
  private voc: Awaited<ReturnType<SceneContext["resources"]["voc"]>> | null = null;
  private failed = false;

  constructor(ctx: SceneContext, file: VoiceFile | null) {
    if (file === null) {
      this.state = "done";
      return;
    }
    this.state = "loading";
    ctx.resources.voc(file).then(
      (voc) => {
        this.voc = voc;
      },
      () => {
        this.failed = true;
      },
    );
  }

  get done(): boolean {
    return this.state === "done";
  }

  update(ctx: SceneContext, skip = false): boolean {
    if (this.state === "loading") {
      if (skip || this.failed) this.state = "done";
      else if (this.voc) {
        ctx.voice.play(this.voc);
        this.state = "playing";
      }
    }
    if (this.state === "playing") {
      if (skip) {
        ctx.voice.stop();
        this.state = "done";
      } else if (!ctx.voice.voicePlaying) this.state = "done";
    }
    return this.state === "done";
  }
}

/** Attente en ticks (par exemple les 0,5 s après l'annonce du personnage, `1f33:00fc(0x32)`). */
export function secondsToTicks(seconds: number): number {
  return Math.round(seconds * TICKS_PER_SECOND);
}
