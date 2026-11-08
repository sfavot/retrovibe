import { describe, expect, it } from "vitest";
import { parseCredits } from "../../src/games/fotaq/data/credits";
import { hasOriginalFiles, readOriginal } from "./helpers";
import { FULL_GAME_START, PLAY_ORDER } from "./solutions";
import { Walkthrough } from "./walkthrough";

/**
 * La partie complète (`docs/fotaq/specials.md`, § 7) : un seul moteur, de l'introduction (sautée par Échap) jusqu'au générique de fin
 * et à `endGame`, passage après passage dans l'ordre de `PLAY_ORDER`, à la souris (et Échap) uniquement : l'état du jeu n'est
 * jamais écrit, seul le départ (`FULL_GAME_START`, un nouveau jeu) est posé.
 */
describe.skipIf(!hasOriginalFiles)("la partie complète", () => {
  it("se joue de l'introduction au générique de fin, sans avertissement, et finit la partie", () => {
    const w = new Walkthrough({ ...FULL_GAME_START, voices: false });
    const credits = parseCredits(readOriginal("CREDIT2.CRD")).pages.flatMap((page) => page.lines.map((line) => line.text));
    const seen = new Set<string>();
    const arrivals: string[] = [];
    const durations: string[] = [];

    for (const passage of PLAY_ORDER) {
      const before = w.ticks;
      // Le générique de fin se lit pendant le dernier passage : on relève les textes affichés à chaque image.
      if (passage === PLAY_ORDER.at(-1)) {
        w.observers.push(() => {
          for (let y = 1; y < 200; y++) {
            const text = w.stage.display.textAt(y).text;
            if (text) seen.add(text);
          }
        });
      }
      try {
        passage.play(w);
      } catch (error) {
        throw new Error(`passage ${passage.id} (${passage.what}) : ${(error as Error).message}`);
      }
      arrivals.push(`${passage.id}:${w.room}`);
      durations.push(`${passage.id} ${w.ticks - before}`);
      expect(w.engine.warnings, `avertissements du moteur après ${passage.id}`).toEqual([]);
    }

    expect(arrivals).toEqual(["6a:70", "4a:75", "5a:1", "1a-1c:17", "2a:22", "1d:17", "3a+4b:41", "2b:21", "4c:69", "5b+6c:110"]);
    expect(w.engine.ended).toBe(true);
    expect(w.host.exits).toBe(1);
    // Le générique de fin s'est déroulé en entier.
    expect(credits.filter((text) => text.trim() !== "" && !seen.has(text))).toEqual([]);
    // Les états qui jalonnent la partie : Azura libérée, la corne, le crâne, la fusée pleine, le combat gagné.
    for (const [state, value] of [[40, 1], [102, 1], [45, 2], [9, 2], [149, 1], [151, 2]] as const) {
      expect(w.engine.gameState(state), `état ${state}`).toBe(value);
    }
    expect(w.talk.warnings).toEqual([]);
    // La pièce 6 (premier gorille) est traversée deux fois (1a, puis la banane de 2a) sans rejouer C6C : le gorille est passé en 1a.
    expect(w.cutaways.played.filter((name) => name.toUpperCase() === "C6C.CUT")).toEqual([]);
  }, 300_000);
});
