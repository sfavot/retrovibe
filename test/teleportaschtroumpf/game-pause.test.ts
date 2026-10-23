import { describe, expect, it } from "vitest";
import { forceMinigameStubs } from "../../src/games/teleportaschtroumpf/scenes/minigames";
import { Session } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";

// Ces tests traversent un mini-jeu sans le jouer : la souche commune les garde indépendants des vrais mini-jeux.
forceMinigameStubs();

const TWO = [{ character: 0 }, { character: 3 }];
const THREE = [{ character: 0 }, { character: 3 }, { character: 5 }];

/** Ouvre la pause S48 depuis le plateau. */
async function pause(s: Session) {
  await s.ready();
  await s.tap("KeyP");
  await s.settle("PauseScene");
  await s.run(300);
}

describe.skipIf(!hasOriginalFiles)("pause S48 et ses quatre issues", () => {
  it("P ouvre S48 ; « retour » reprend le tour là où il était, chrono du tour gelé, chrono de la partie en marche", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x40 });
    await s.run(3000);
    const turn = s.game.state.turn.elapsed;
    const total = s.game.state.elapsed;
    const x = s.game.player.x;
    await pause(s);
    expect(s.game.state.paused).toBe(true);
    await s.run(10_000);
    await s.tap("Space"); // premier bouton : retour (200)
    await s.ready();
    expect(s.game.state.paused).toBe(false);
    expect(s.game.state.current).toBe(0);
    expect(s.game.player.x).toBe(x);
    expect(s.game.state.turn.elapsed).toBe(turn);
    expect(s.game.state.elapsed - total).toBeGreaterThanOrEqual(10);
    // Le tour continue : on peut marcher.
    await s.hold("ArrowRight", 500);
    expect(s.game.player.x).toBeGreaterThan(x);
  }, 120_000);

  it("pendant la pause, la touche P est sans effet et le plateau ne bouge pas", async () => {
    const s = await Session.start();
    await pause(s);
    const x = s.game.player.x;
    s.host.input.keyDown("ArrowRight");
    await s.run(1000);
    s.host.input.keyUp("ArrowRight");
    await s.tap("KeyP");
    expect(s.top()).toBe("PauseScene");
    expect(s.game.player.x).toBe(x);
  }, 60_000);

  it("carte (202) : consultation de S02 empilée, retour au même tour", async () => {
    const s = await Session.start({ players: TWO });
    await pause(s);
    await s.tap("ArrowRight");
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("MapScene");
    expect(s.host.loaded.some((f) => /S02A002D\.MCG/i.test(f))).toBe(true); // fond de consultation
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.current).toBe(0);
    expect(s.game.state.paused).toBe(false);
  }, 60_000);

  it("aide (203) : écran info S03 / S45 empilé, retour au même tour", async () => {
    const s = await Session.start({ players: TWO });
    await pause(s);
    await s.tap("ArrowRight");
    await s.tap("ArrowRight");
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("HelpScene");
    expect(s.host.loaded.some((f) => /S03A001D\.MCG/i.test(f))).toBe(true);
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.current).toBe(0);
    expect(s.game.state.players).toHaveLength(2);
  }, 60_000);

  it("abandon (201) : « retour » de S46 revient au jeu sans rien changer", async () => {
    const s = await Session.start({ players: TWO });
    await pause(s);
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("AbandonScene");
    for (let i = 0; i < 3; i++) await s.tap("ArrowDown");
    await s.tap("Space"); // « retour »
    await s.ready();
    expect(s.game.state.players).toHaveLength(2);
    expect(s.game.state.current).toBe(0);
  }, 60_000);

  it("abandon d'un joueur : S49, joueurs compactés, S46 réaffiché avec ceux qui restent, tour du joueur suivant", async () => {
    const s = await Session.start({ players: THREE });
    await pause(s);
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("AbandonScene");
    await s.tap("Space"); // joueur 1 (le joueur courant, Costaud)
    await s.settle("ConfirmScene");
    await s.tap("Space"); // Oui
    await s.settle("AbandonScene"); // S46 est réaffiché avec les deux joueurs restants
    expect(s.game.state.players.map((p) => p.character)).toEqual([3, 5]);
    // Le joueur courant est parti : le suivant commence son tour.
    expect(s.game.state.current).toBe(0);
    for (let i = 0; i < 3; i++) await s.tap("ArrowDown");
    await s.tap("Space"); // « retour »
    await s.ready();
    expect(s.board.shown.player).toBe(0);
    expect(s.game.state.players[s.board.shown.player].character).toBe(3);
  }, 120_000);

  it("abandon d'un autre joueur : le joueur courant garde la main (chrono de tour repris)", async () => {
    const s = await Session.start({ players: THREE });
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x50 });
    await s.run(2000);
    const x = s.game.player.x;
    await s.tap("KeyP");
    await s.settle("PauseScene");
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("AbandonScene");
    await s.tap("ArrowRight"); // joueur 2 (Gourmand)
    await s.tap("Space");
    await s.settle("ConfirmScene");
    await s.tap("Space");
    await s.settle("AbandonScene");
    expect(s.game.state.players.map((p) => p.character)).toEqual([0, 5]);
    for (let i = 0; i < 3; i++) await s.tap("ArrowDown");
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.current).toBe(0);
    expect(s.game.player.x).toBe(x);
  }, 120_000);

  it("abandon d'un joueur qui précède le joueur courant : le plateau suit le bon joueur", async () => {
    const s = await Session.start({ players: THREE });
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x20 });
    await s.tap("Space"); // le joueur 0 joue S35 : le tour passe au joueur 1
    await s.settle("MinigameStub");
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.current).toBe(1);
    s.place({ screen: 3, row: "top", x: 0x50 });
    await s.tap("KeyP");
    await s.settle("PauseScene");
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("AbandonScene");
    await s.tap("Space"); // le joueur 0 (Costaud) part
    await s.settle("ConfirmScene");
    await s.tap("Space");
    await s.settle("AbandonScene");
    for (let i = 0; i < 3; i++) await s.tap("ArrowDown");
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.players.map((p) => p.character)).toEqual([3, 5]);
    expect(s.game.state.current).toBe(0);
    expect(s.board.shown.player).toBe(0);
    // Le plateau suit toujours le pion du joueur courant.
    const x = s.game.player.x;
    await s.hold("ArrowRight", 500);
    expect(s.game.player.x).toBeGreaterThan(x);
    expect(s.board.shown.x).toBe(s.game.player.x);
  }, 120_000);

  it("abandon de tous : fin de partie sans vidéo, retour au menu (rappel de fin)", async () => {
    const s = await Session.start({ players: TWO });
    await pause(s);
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("AbandonScene");
    await s.tap("ArrowDown"); // « tous »
    await s.tap("Space");
    await s.settle("ConfirmScene");
    await s.tap("Space"); // Oui
    await s.until(() => s.finished);
    expect(s.game.state.result).toEqual({ kind: "abandoned" });
    expect(s.host.loaded.some((f) => /S11A\.MUX|S42A0/i.test(f))).toBe(false);
  }, 120_000);

  it("abandon successif : un joueur puis le dernier", async () => {
    const s = await Session.start({ players: TWO });
    await pause(s);
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("AbandonScene");
    await s.tap("Space"); // joueur 1
    await s.settle("ConfirmScene");
    await s.tap("Space"); // Oui
    await s.settle("ConfirmScene"); // le dernier joueur : S49 tout de suite
    expect(s.game.state.players).toHaveLength(1);
    await s.tap("Space"); // Oui : il abandonne aussi
    await s.until(() => s.finished);
    expect(s.game.state.result).toEqual({ kind: "abandoned" });
  }, 120_000);

  it("seul : abandonner passe par S49 directement ; Non revient au jeu", async () => {
    const s = await Session.start();
    await pause(s);
    await s.tap("ArrowRight");
    await s.tap("Space");
    await s.settle("ConfirmScene");
    await s.tap("ArrowRight");
    await s.tap("Space"); // Non
    await s.ready();
    expect(s.game.state.phase).toBe("turn");
    expect(s.finished).toBe(false);
  }, 60_000);
});
