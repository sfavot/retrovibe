import { describe, expect, it } from "vitest";
import { Inn as Inn1 } from "../../../src/games/drascula/engine/rooms/chapter-1/ids";
import { Inn } from "../../../src/games/drascula/engine/rooms/chapter-2/ids";
import { Verb } from "../../../src/games/drascula/engine/state";
import { type HeadCopy, recordHeadCopies } from "../engine/head-probe";
import { hasOriginalFiles } from "../helpers";
import { SOLUTIONS, playChapter6Intro, solveChapter6 } from "../solutions";
import { talkAndWaitForChoices, startIn } from "../rooms/chapter-2/route";
import { Walkthrough } from "../walkthrough";

/**
 * Les têtes qui parlent (`render/heads.ts`) recopient un rectangle d'une feuille (`extra`, `front`, `back`, `draw3`) que la pièce ou la
 * cinématique y a chargée (`loadPic` d'`enterRoom`, `animation_*` : ScummVM). Ces tests jouent le jeu comme un joueur et comparent les
 * pixels de chaque rectangle copié à ceux du fichier `.ALG` attendu : le personnage est bien dans la feuille quand il parle, pas le héros.
 * (Appeler `talkers.pianist(1)` à la main sans passer par `animation_12_2` laisse `97.ALG` dans `extra` : le rectangle est alors celui
 * du héros, comme dans ScummVM.)
 */

interface Expected {
  chapter: number;
  room: number;
  surface: string;
  width: number;
  height: number;
  /** Fichier(s) `.ALG` dont la tête doit être extraite (l'un d'eux). */
  sheets: string[];
  label: string;
}

const select = (copies: readonly HeadCopy[], e: Pick<Expected, "chapter" | "room" | "surface" | "width" | "height">): HeadCopy[] =>
  copies.filter((c) => c.chapter === e.chapter && c.room === e.room && c.surface === e.surface && c.width === e.width && c.height === e.height);

function expectSheet(copies: readonly HeadCopy[], e: Expected): void {
  const found = select(copies, e);
  expect(found.length, `${e.label} : aucune tête`).toBeGreaterThan(0);
  for (const copy of found) {
    expect(
      copy.matches.some((file) => e.sheets.includes(file)),
      `${e.label} : rectangle (${copy.x}, ${copy.y}) de ${copy.surface} = ${copy.matches.join(", ") || "aucune feuille"}, attendu ${e.sheets.join(" ou ")}`,
    ).toBe(true);
  }
}

describe.skipIf(!hasOriginalFiles)("têtes des personnages : la feuille chargée est celle du personnage", () => {
  it("chapitre 1, le barman de l'auberge : an11y13.alg dans extra (animation_3_1)", () => {
    const w = new Walkthrough({ chapter: 1 });
    const { copies } = recordHeadCopies(w.player);
    w.act(Verb.Talk, Inn1.Barman);
    expectSheet(copies, { chapter: 1, room: 62, surface: "extra", width: 21, height: 24, sheets: ["an11y13.alg"], label: "barman (chapitre 1)" });
  });

  it("chapitre 2, le pianiste : an12.alg dans extra (animation_12_2), pas 974.alg", () => {
    const w = startIn(14);
    const { copies } = recordHeadCopies(w.player);
    talkAndWaitForChoices(w, Inn.Pianist);
    expectSheet(copies, { chapter: 2, room: 14, surface: "extra", width: 47, height: 60, sheets: ["an12.alg"], label: "pianiste" });
  });

  it("chapitre 2, le barman : an11y13.alg dans extra (animation_11_2)", () => {
    const w = startIn(14);
    const { copies } = recordHeadCopies(w.player);
    w.act(Verb.Talk, Inn.Barman, 60_000);
    expectSheet(copies, { chapter: 2, room: 14, surface: "extra", width: 21, height: 24, sheets: ["an11y13.alg"], label: "barman (chapitre 2)" });
  });

  it("chapitre 2, l'ivrogne : an11y13.alg dans front (animation_13_2)", () => {
    const w = startIn(14);
    const { copies } = recordHeadCopies(w.player);
    talkAndWaitForChoices(w, Inn.Drunk);
    expectSheet(copies, { chapter: 2, room: 14, surface: "front", width: 19, height: 19, sheets: ["an11y13.alg"], label: "ivrogne" });
  });

  it("toute la partie : les têtes d'aveugle, Von Braun, Igor, loup-garou, musicien, B.J., pendule et barman du chapitre 6", () => {
    const w = new Walkthrough({ chapter: 1 });
    const { copies } = recordHeadCopies(w.player);
    for (const solve of SOLUTIONS) solve(w);
    playChapter6Intro(w);
    solveChapter6(w);
    const igor = ["auxigor.alg", "auxig2.alg"];
    const table: Expected[] = [
      { chapter: 1, room: 16, surface: "draw3", width: 27, height: 40, sheets: ["auxbj.alg"], label: "B.J." },
      { chapter: 2, room: 9, surface: "draw3", width: 126, height: 149, sheets: ["ciego2.alg"], label: "aveugle (draw3)" },
      { chapter: 2, room: 9, surface: "extra", width: 126, height: 149, sheets: ["ciego3.alg"], label: "aveugle (extra)" },
      { chapter: 2, room: 9, surface: "back", width: 126, height: 149, sheets: ["ciego4.alg"], label: "aveugle (back)" },
      { chapter: 2, room: 9, surface: "front", width: 126, height: 146, sheets: ["ciego5.alg"], label: "aveugle (front)" },
      { chapter: 2, room: 18, surface: "front", width: 25, height: 27, sheets: ["an24.alg"], label: "Von Braun" },
      { chapter: 4, room: 26, surface: "front", width: 29, height: 25, sheets: igor, label: "Igor de face" },
      { chapter: 5, room: 49, surface: "draw3", width: 26, height: 24, sheets: ["aux49.alg"], label: "loup-garou" },
      { chapter: 5, room: 54, surface: "draw3", width: 18, height: 24, sheets: ["aux54.alg"], label: "musicien" },
      { chapter: 6, room: 58, surface: "front", width: 29, height: 25, sheets: igor, label: "Igor de face (chapitre 6)" },
      { chapter: 6, room: 58, surface: "front", width: 25, height: 24, sheets: igor, label: "Igor de profil" },
      { chapter: 6, room: 58, surface: "draw3", width: 25, height: 28, sheets: ["aux58.alg"], label: "pendule" },
      { chapter: 6, room: 60, surface: "draw3", width: 21, height: 24, sheets: ["aux60.alg"], label: "barman derrière le comptoir" },
    ];
    for (const e of table) expectSheet(copies, e);
  }, 120_000);
});
