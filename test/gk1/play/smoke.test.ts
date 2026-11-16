import { describe, expect, it } from "vitest";
import { original } from "../data/real";
import { DAY1, Room } from "./day1";
import { Play, TITLE_ROOM, Verb } from "./harness";
import { runStages } from "./walkthrough";

/** Le parcours complet (`playthrough.test.ts`) ne tourne qu'avec `PLAY=1` (convention du dépôt, voir le README) ; l'essai court tourne toujours. */
const FULL = process.env.PLAY === "1";

describe.skipIf(!original.has)("Gabriel Knight, parcours sans tête", () => {
  it("essai court : du titre à la librairie, lire le journal, ouvrir le menu de Grace, reprendre d'un point de reprise", { timeout: 120_000 }, () => {
    const { play, scores } = runStages(DAY1.slice(0, 1));
    expect(scores).toEqual([{ name: "j1-titre", score: 0 }]);
    expect([play.room(), play.day(), play.inControl()]).toEqual([Room.Bookshop, 1, true]);
    expect(play.verb()).toBe(Verb.Look);
    expect(play.object("newsPaper")).toMatchObject({ kind: "cast", noun: 35 });
    expect(play.objectAt(play.pointOn("xphone").x, play.pointOn("xphone").y - 10)?.name).toBe("xphone");

    const image = play.checkpoint("librairie");
    const read = play.use(Verb.Pickup, "newsPaper");
    expect(read[0]).toBe("Le Times, du 18 Juin 1993. La première page est consacrée aux Meurtres Vaudous.");
    expect(play.score()).toBe(1);
    play.use(Verb.Ask, "graceProp", { settle: false });
    play.playUntil(() => play.room() === Room.Interrogation && play.menu().length > 0, 3000, "le menu de Grace");
    expect(play.menu().map((choice) => choice.text)).toEqual(["Vaudou", "Crimes Vaudou", "La Nouvelle Orléans", "Elle-même", "Messages", "Demande de recherche", "Sortie"]);

    // Reprise : même pièce, score d'avant le journal, et la même action redonne le même résultat.
    const resumed = Play.resume(image);
    expect([resumed.room(), resumed.score(), resumed.carried()]).toEqual([Room.Bookshop, 0, []]);
    expect(resumed.use(Verb.Pickup, "newsPaper")).toEqual(read);
    expect(resumed.score()).toBe(1);
    expect(() => resumed.object("personne")).toThrow(/aucun objet « personne » dans la pièce[\s\S]*pièce : 210 \(jour 1, score 1\)[\s\S]*derniers appels du noyau/);
    expect(play.vm.kernel.journal.stubs.size).toBe(0);
  });

  it.runIf(FULL)("texte et voix : l'ouverture se déroule seule, chaque réplique durant ce que dure son clip", { timeout: 300_000 }, () => {
    // Sans une seule frappe : les fenêtres se ferment à la fin des clips (index des voix du CD, sortie audio nulle).
    const frames = [true, false].map((voices) => {
      const play = Play.boot({ voices });
      play.waitUntil(() => play.room() === TITLE_ROOM && play.item("playButt") !== undefined, 6000, "l'écran titre");
      play.step(120);
      play.setVoices();
      while (play.room() === TITLE_ROOM) {
        play.clickItem("playButt");
        play.step(20);
      }
      const start = play.frames;
      const lines = new Set<string>();
      play.waitUntil(
        () => {
          for (const text of play.texts()) lines.add(text);
          return play.room() === Room.Bookshop && play.inControl() && play.texts().length === 0;
        },
        60_000,
        "la librairie, sans fermer les répliques",
      );
      expect(lines.size).toBe(20);
      expect([...play.vm.warnings.keys()]).toEqual([]);
      return play.frames - start;
    });
    // Avec les index des voix, les durées sont celles des clips ; sans eux, le temps de lecture du texte (`kernel/audio.ts`).
    expect(frames).toEqual([8309, 10248]);
  });
});
