import { describe, expect, it } from "vitest";
import { pauseTicks } from "../../../src/games/drascula/engine/cadence";
import { MISSING_VOICE_TICKS_PER_CHAR } from "../../../src/games/drascula/engine/talk";
import { pianistDialog } from "../../../src/games/drascula/engine/rooms/chapter-1/room-62";
import { TAP_SKIP_GRACE_TICKS, tapEffect } from "../../../src/games/drascula/ui/input";
import { Player } from "../engine/test-host";
import { hasOriginalFiles, readManifest } from "../helpers";

/** Durée d'une voix en ticks (11 025 Hz, 64 octets de marges, tick de 10 ms). */
function voiceTicks(file: string): number {
  const entry = readManifest().find((e) => e.path.toUpperCase() === file.toUpperCase())!;
  return ((entry.size - 64) * 1000) / 11025 / 10;
}

/** Ce que fait l'hôte du navigateur d'un toucher (`app.ts`, `tap`) : Entrée s'il coupe la réplique, un clic sinon. */
function tap(player: Player): void {
  const effect = tapEffect(player.engine, 0);
  if (effect === "skip") player.host.push({ type: "key", key: "Enter" });
  else if (effect === "click") {
    player.move(160, 100, 1);
    player.move(160, 100, 0);
  }
}

/**
 * Joue le dialogue du pianiste (`animation_4_1`) en touchant l'écran `after` ticks après le début de la voix `at` ; rend la durée
 * de chaque voix (ticks entre son début et celui de la suivante).
 */
function pianistWithTap(at: string, after: number, reading = false): Map<string, number> {
  const player = new Player({ chapter: 1 });
  player.engine.subtitleReadingTime = reading;
  player.settle();
  const sounds = player.host.sounds;
  const from = sounds.length;
  const starts: [string, number][] = [];
  player.engine.run(pianistDialog(player.engine));
  let tapAt = -1;
  for (let t = 0; t < 20_000 && player.engine.busy; t++) {
    if (t === tapAt) tap(player);
    player.run(1);
    while (from + starts.length < sounds.length) {
      const name = sounds[from + starts.length];
      starts.push([name, t]);
      if (name === at) tapAt = t + after;
    }
  }
  expect(player.engine.busy).toBe(false);
  const end = starts.length ? starts[starts.length - 1][1] : 0;
  return new Map(starts.map(([name, start], i) => [name, (starts[i + 1]?.[1] ?? end) - start]));
}

describe("toucher pendant une réplique", () => {
  it("un clic hors réplique ou devant les choix, l'appui long toujours un clic droit", () => {
    expect(tapEffect({ ticks: 500, subtitle: null, choices: null, speechStart: 0 }, 0)).toBe("click");
    expect(tapEffect({ ticks: 500, subtitle: {}, choices: {}, speechStart: 0 }, 0)).toBe("click");
    expect(tapEffect({ ticks: 500, subtitle: {}, choices: null, speechStart: 0 }, 2)).toBe("click");
    expect(tapEffect({ ticks: 500, subtitle: {}, choices: null, speechStart: 500 - TAP_SKIP_GRACE_TICKS }, 0)).toBe("skip");
    expect(tapEffect({ ticks: 500, subtitle: {}, choices: null, speechStart: 501 - TAP_SKIP_GRACE_TICKS }, 0)).toBe("ignore");
  });

  describe.skipIf(!hasOriginalFiles)("pianiste de l'auberge (chapitre 1)", () => {
    it("sans toucher, chaque réplique dure sa voix", () => {
      const said = pianistWithTap("none", 0);
      expect([...said.keys()]).toEqual(["205.als", "p1.als", "206.als", "p2.als", "207.als", "p3.als", "208.als", "p4.als", "209.als"]);
      expect(said.get("207.als")).toBeGreaterThanOrEqual(Math.floor(voiceTicks("207.als")));
    });

    it("un toucher pour « continuer » à la fin du « très jolie » du pianiste ne coupe pas la réplique suivante du héros", () => {
      // Le joueur touche l'écran 0,3 s après la fin de la voix du pianiste : la réplique 207 a déjà commencé.
      const said = pianistWithTap("207.als", 30);
      expect(said.get("207.als")).toBeGreaterThanOrEqual(Math.floor(voiceTicks("207.als")));
    });

    it("un toucher après le délai coupe la réplique en cours, et elle seule", () => {
      const said = pianistWithTap("207.als", TAP_SKIP_GRACE_TICKS + 10);
      expect(said.get("207.als")).toBeLessThanOrEqual(TAP_SKIP_GRACE_TICKS + 10 + pauseTicks(3));
      expect(said.get("p3.als")).toBeGreaterThanOrEqual(Math.floor(voiceTicks("P3.als")));
    });
  });
});

describe.skipIf(!hasOriginalFiles)("temps de lecture minimal des sous-titres (navigateur)", () => {
  it("le texte de 207 (80 caractères, voix de 2,2 s) reste affiché le temps de le lire ; sans sous-titres, la réplique dure sa voix", () => {
    const text207 = new Player({ chapter: 1 }).engine.data.text("text", 207).length;
    expect(text207).toBeGreaterThan(70);
    const reading = pianistWithTap("none", 0, true);
    expect(reading.get("207.als")).toBeGreaterThanOrEqual(text207 * MISSING_VOICE_TICKS_PER_CHAR);
    expect(reading.get("207.als")).toBeLessThanOrEqual(text207 * MISSING_VOICE_TICKS_PER_CHAR + pauseTicks(3));
    const faithful = pianistWithTap("none", 0, false);
    expect(faithful.get("207.als")).toBeLessThan(text207 * MISSING_VOICE_TICKS_PER_CHAR);
  });

  it("un toucher pendant le temps de lecture fait passer la réplique", () => {
    const said = pianistWithTap("207.als", 300, true);
    expect(said.get("207.als")).toBeLessThanOrEqual(300 + pauseTicks(3));
  });

  it("le moteur seul (sans l'hôte du navigateur) ou sans sous-titres : aucun temps ajouté", () => {
    const player = new Player({ chapter: 1 });
    expect(player.engine.readingTicks("UN TEXTE")).toBe(0);
    player.engine.subtitleReadingTime = true;
    expect(player.engine.readingTicks("UN TEXTE")).toBe(8 * MISSING_VOICE_TICKS_PER_CHAR);
    player.engine.subtitlesEnabled = false;
    expect(player.engine.readingTicks("UN TEXTE")).toBe(0);
  });
});
