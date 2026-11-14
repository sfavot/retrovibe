/**
 * Assemblage du moteur de *Beneath a Steel Sky* avec ses services réels : un seul endroit pour l'hôte (navigateur) et les tests qui
 * veulent l'image et le son.
 *
 * `BassEngine` seul reste le moteur de logique pure : `NullScreen` et `SilentSound` par défaut (sans image ni son), `BassTextManager`,
 * `Grid` et `AutoRoute` toujours réels. Il ne dépend donc ni de `render/` ni de `audio/`. `createBassEngine` y ajoute, à la demande :
 * - `render: true` : `BassScreenRenderer` (écran 320 x 200 lu par l'hôte dans `renderer.frame`), lié au moteur ;
 * - `audio` : `BassAudio` (musique, effets, voix), dont l'hôte appelle `update()` à chaque image et `unlock()` au premier geste ;
 * - `intro` : l'introduction du CD (`BassIntro`), qui tourne avant le moteur (`engine/sequences/intro.ts`).
 * Voir `docs/bass/engine.md` § 16.
 */

import type { SamplePlayer } from "../../audio/sample-channel";
import { BassAudio, type BassAudioOptions } from "./audio/audio";
import { BassEngine, type BassData, type BassEngineOptions } from "./engine/game";
import type { BassHost } from "./engine/host";
import { Var } from "./engine/ids";
import { createIntroAudio } from "./engine/sequences/intro-audio";
import { BassIntro } from "./engine/sequences/intro";
import type { IntroCanvasOptions } from "./engine/sequences/intro-screen";
import { BassScreenRenderer } from "./render/screen";

export interface CreateBassEngineOptions extends Omit<BassEngineOptions, "data" | "host"> {
  /** Écran réel (`BassScreenRenderer`) au lieu de `NullScreen` ; incompatible avec `screen`. */
  render?: boolean;
  /** Son réel (`BassAudio`) au lieu de `SilentSound` ; incompatible avec `sound`. Le temps et les fichiers viennent de l'hôte et des données. */
  audio?: Pick<BassAudioOptions, "voices" | "music" | "createContext" | "createMusic">;
  /**
   * Introduction du CD (`game.intro`). `player` : la sortie d'échantillons qui joue ses voix et ses ambiances (celle de `BassAudio` pour
   * qu'un seul contexte sonne et se débloque) ; sans elle l'introduction est muette et dure autant.
   */
  intro?: { player?: SamplePlayer; canvas?: IntroCanvasOptions };
}

export interface BassGame {
  readonly engine: BassEngine;
  /** Présent avec `render: true`. */
  readonly renderer: BassScreenRenderer | null;
  /** Présent avec `audio`. */
  readonly audio: BassAudio | null;
  /** Présent avec `intro` : l'hôte appelle `start()`, puis `tick()` toutes les 20 ms tant que `running`, puis `startGameAfterIntro`. */
  readonly intro: BassIntro | null;
}

export function createBassEngine(data: BassData, host: BassHost, options: CreateBassEngineOptions = {}): BassGame {
  const { render = false, audio: audioOptions, intro: introOptions, ...engineOptions } = options;
  if (render && engineOptions.screen) throw new Error("createBassEngine : `render` et `screen` sont exclusifs");
  if (audioOptions && engineOptions.sound) throw new Error("createBassEngine : `audio` et `sound` sont exclusifs");

  let renderer: BassScreenRenderer | null = null;
  let audio: BassAudio | null = null;
  const engine = new BassEngine({
    ...engineOptions,
    data,
    host,
    screen: render ? (e) => (renderer = new BassScreenRenderer().attach(e)) : engineOptions.screen,
    sound: audioOptions
      ? (audio = new BassAudio({
          ...audioOptions,
          now: () => host.now(),
          loadFile: (id) => data.disk.load(id),
          screen: () => engine.vars[Var.SCREEN]! & 0xff,
        }))
      : engineOptions.sound,
  });
  let intro: BassIntro | null = null;
  if (introOptions) {
    const created: BassIntro = new BassIntro({
      disk: data.disk,
      audio: createIntroAudio({ sound: engine.sound, player: introOptions.player ?? audio?.samplePlayer, clock: () => created.clockMs }),
      // Échap ou un clic passent l'introduction ; les autres entrées sont jetées (le moteur ne tourne pas encore).
      pollSkip: () => host.pollInput().some((input) => input.type === "click" || (input.type === "action" && input.action === "skip")),
      log: (message) => engine.log(message),
      canvas: introOptions.canvas,
    });
    intro = created;
  }
  return { engine, renderer, audio, intro };
}
