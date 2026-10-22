import { describe, expect, it } from "vitest";
import { STORAGE_KEY } from "../../src/games/teleportaschtroumpf/engine/options";
import { STUB_POINTS } from "../../src/games/teleportaschtroumpf/scenes/minigames";
import { Session } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";

const TWO = [{ character: 0 }, { character: 3 }];

/** Le joueur courant entre dans la porte du coloriage (S35, écran 2 haut gauche) ; le mini-jeu est réussi. */
async function winColoring(s: Session) {
  s.place({ screen: 2, row: "top", x: 0x20 });
  await s.tap("Space");
  await s.settle("MinigameStub");
  await s.tap("Space");
}

describe.skipIf(!hasOriginalFiles)("fin de partie : victoire, fin du temps, avertissements", () => {
  it("victoire : l'objectif atteint au retour d'un mini-jeu → vidéo S11 → fin de partie, heure enregistrée", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    const { goal } = s.game.state;
    Object.assign(s.game.player, { ingredients: goal.ingredients, points: goal.points - STUB_POINTS });
    await winColoring(s);
    await s.settle("VideoScene");
    expect(s.host.loaded.some((f) => /S11A\.MUX/i.test(f))).toBe(true);
    expect(s.finished).toBe(false);
    await s.run(1500);
    await s.tap("Escape");
    await s.until(() => s.finished);
    expect(s.game.winner()).toBe(0);
    expect(s.game.state.result).toEqual({ kind: "victory", winner: 0 });
    // L'heure de fin sert au verrou parental (`21ee:1c92`).
    const saved = JSON.parse(s.host.storage.get(STORAGE_KEY)!);
    expect(saved.lastGameMinutes).toBe(Math.floor(s.host.unixSeconds() / 60));
    expect(s.ctx.voice.hasMusic).toBe(false);
  }, 120_000);

  it("un autre joueur ne gagne pas à la place : seul le joueur qui vient de jouer est contrôlé", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    const { goal } = s.game.state;
    Object.assign(s.game.state.players[1], { ingredients: goal.ingredients, points: goal.points });
    await winColoring(s); // le joueur 0 joue
    await s.ready();
    expect(s.game.state.result).toBeNull();
    expect(s.game.state.current).toBe(1);
  }, 120_000);

  it("fin du temps : la partie se termine à la fin du tour par la vidéo S42 du message choisi", async () => {
    const s = await Session.start({ players: TWO, messageIndex: 2 });
    await s.ready();
    s.game.state.durationSeconds = s.game.state.elapsed + 3;
    await s.settle("ClipSequence");
    // Vidéo `s42a0N` (N = 0x29 + message + 9 × (0..3)) entre un clip d'ouverture et `s42g` (`154c:097b`).
    await s.until(() => s.host.loaded.some((f) => /S42A0(43|52|61|70)\.MUX/i.test(f)));
    await s.run(1500);
    await s.tap("Escape");
    await s.until(() => s.finished);
    expect(s.game.state.result?.kind).toBe("timeout");
    expect(s.game.winner()).toBeNull();
  }, 120_000);

  it("le temps s'écoule pendant un mini-jeu : le gain compte, puis la partie se termine", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x20 });
    await s.tap("Space");
    await s.settle("MinigameStub");
    s.game.state.durationSeconds = s.game.state.elapsed + 2;
    await s.run(4000);
    await s.tap("Space");
    await s.settle("ClipSequence");
    expect(s.game.state.players[0].points).toBe(STUB_POINTS);
    expect(s.game.state.result?.kind).toBe("timeout");
  }, 120_000);

  it("avertissement de temps (moins de 10 min) : vidéo du Grand Schtroumpf au début du tour suivant, une seule fois", async () => {
    const s = await Session.start({ players: TWO, durationIndex: 1 });
    await s.ready();
    s.game.state.durationSeconds = s.game.state.elapsed + 500;
    await winColoring(s);
    await s.settle("ClipSequence");
    await s.until(() => s.host.loaded.some((f) => /S42A03[1-3]\.MUX/i.test(f)));
    expect(s.game.state.current).toBe(1);
    await s.run(1500);
    await s.tap("Escape");
    await s.ready();
    expect(s.top()).toBe("GameScene");
    expect(s.game.state.warned10).toBe(true);
    // Pas de second avertissement au tour suivant.
    s.host.loaded.length = 0;
    await winColoring(s);
    await s.ready();
    expect(s.host.loaded.some((f) => /S42A03/i.test(f))).toBe(false);
  }, 120_000);

  it("S19 est joué au premier tour seulement, avant l'annonce du personnage", async () => {
    const s = await Session.start();
    await s.ready();
    const count = () => s.history.filter((name) => name === "IngredientsScene").length;
    expect(count()).toBe(1);
    await winColoring(s);
    await s.ready();
    expect(count()).toBe(1);
    expect(s.game.state.players[0].points).toBe(STUB_POINTS);
  }, 120_000);
});
