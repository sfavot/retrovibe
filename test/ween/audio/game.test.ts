import { describe, expect, it } from "vitest";
import { parseAdl } from "../../../src/engine/coktel/audio/adlib/adl-player";
import { hasOriginalFiles } from "../helpers";
import { referenceTrace, tracePlayer } from "./adl-trace";
import { runAudio } from "./harness";

/**
 * Le son de Ween tel que le jeu le demande (script réel, interpréteur, `SoundEngine`, backend enregistreur), sur le
 * déroulement déjà validé au banc (`test/ween/engine/boot.test.ts` : 7 800 images identiques pour les variables, dont
 * celles que `o1_waitEndPlay` et le son en cours font évoluer).
 */
describe.skipIf(!hasOriginalFiles)("Ween : son de l'introduction (script réel)", () => {
  it("musiques ADL : chargées, jouées une fois ou en boucle, remplacées proprement, toutes lisibles par le lecteur commun", async () => {
    const { events, adls } = await runAudio(7800);
    const adl = events.filter((e) => e.what.startsWith("adl."));
    // Chaque morceau : unload (le précédent), load, repeat, play ; stop seulement quand un autre le remplace.
    const plays = adl.filter((e) => e.what === "adl.play");
    expect(plays).toHaveLength(7);
    expect(adls.map((d) => d.length)).toEqual([5212, 5264, 3662, 4466, 1278, 15003, 5212]);
    expect(adl.filter((e) => e.what.startsWith("adl.repeat")).map((e) => e.what.slice(11))).toEqual(
      ["0", "0", "0", "0", "0", "-1", "-1"],
    );
    // o1_playSound : répétitions négatives = jouer en boucle (repCount - 1 = -1 se lit « boucle infinie »)
    for (const d of adls) {
      expect(parseAdl(d)).not.toBeNull();
      const ref = referenceTrace(d);
      const run = tracePlayer(d, 0, 5_000_000);
      expect(run.events).toEqual(ref.events);
      expect(run.finishedAt).toEqual([ref.endTick]);
    }
    // L'ordre des appels au lecteur ne change pas : arrêt, déchargement, chargement, répétition, lecture.
    const sequence = adl.map((e) => e.what.split(" ")[0]);
    expect(sequence.slice(0, 4)).toEqual(["adl.unload", "adl.load", "adl.repeat", "adl.play"]);
  }, 60_000);

  it("INTRO0 : composition 0, 1, 1, 1 enchaînée, coupée après l'échantillon en cours par waitEndPlay", async () => {
    const { events } = await runAudio(300);
        const composition = events.find((e) => e.what.startsWith("composition"))!;
    expect(composition.what.startsWith("composition [0,1,1,1,")).toBe(true);
    const [first, second, third] = events.filter((e) => e.what.startsWith("pcm ")).slice(0, 3);
    expect([first.what, second.what, third.what]).toEqual(["pcm 41472@7714 x1", "pcm 47029@7714 x1", "pcm 47029@7714 x1"]);
    // Chaque échantillon suit le précédent à la fin de sa durée (taille / fréquence), à une image près
    const duration = (what: string) => {
      const [, size, rate] = /pcm (\d+)@(\d+)/.exec(what)!;
      return (Number(size) * 1000) / Number(rate);
    };
    expect(second.ms - first.ms).toBeGreaterThanOrEqual(duration(first.what));
    expect(second.ms - first.ms).toBeLessThan(duration(first.what) + 120);
    expect(third.ms - second.ms).toBeGreaterThanOrEqual(duration(second.what));
    expect(third.ms - second.ms).toBeLessThan(duration(second.what) + 120);
    // waitEndPlay (image 142) coupe la suite : le quatrième 1 et les 0 suivants ne sont jamais joués, le canal se libère à la fin du troisième
    const wait = events.filter((e) => e.what === "waitEndPlay")[1];
    expect(wait.ms).toBeGreaterThan(third.ms);
    expect(wait.ms).toBeLessThan(third.ms + duration(third.what));
    const next = events.find((e) => e.ms > third.ms && e.what.startsWith("pcm "))!;
    expect(next.ms).toBeGreaterThanOrEqual(third.ms + duration(third.what));
  });

  it("l'introduction regardée en entier ne sonne pas au haut-parleur (protection sautée, plan D2)", async () => {
    const { events } = await runAudio(7800);
    expect(events.filter((e) => e.what.startsWith("speaker."))).toEqual([]);
  }, 60_000);
});
