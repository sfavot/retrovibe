import { describe, expect, it } from "vitest";
import { Session } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";
import { FIDGET_AFTER_SECONDS, POSE_FIDGET_RIGHT, POSE_IDLE_RIGHT } from "../../src/games/teleportaschtroumpf/scenes/board/walker";
import { STUB_POINTS, forceMinigameStubs } from "../../src/games/teleportaschtroumpf/scenes/minigames";

// Ces tests traversent un mini-jeu sans le jouer : la souche commune les garde indépendants des vrais mini-jeux.
forceMinigameStubs();

const TWO = [{ character: 0 }, { character: 3 }];

describe.skipIf(!hasOriginalFiles)("partie : tours, portes et mini-jeux", () => {
  it("démarre sur le plateau du premier joueur : fond de l'écran 1, bandeau, personnage annoncé", async () => {
    const s = await Session.start({ players: TWO, audio: true });
    await s.ready();
    expect(s.top()).toBe("GameScene");
    expect(s.game.state.current).toBe(0);
    expect(s.board.shown).toMatchObject({ player: 0, screen: 1, row: "top", x: 0x0b });
    // Voix d'annonce du personnage (s01v 1..5 pour Costaud) jouée au début du tour.
    const announce = await Promise.all([1, 2, 3, 4, 5].map((n) => s.ctx.resources.voc(`s01v00${n}t.voc`)));
    expect(s.host.audio.plays.some((p) => announce.some((v) => v.samples === p.sound.samples))).toBe(true);
    expect(s.game.state.paused).toBe(false);
  }, 60_000);

  it("pas de musique pendant l'annonce du début de tour (S19 comprise) : elle part quand le joueur a la main", async () => {
    const s = await Session.start({ players: TWO, audio: true });
    await s.ready();
    const voices = s.host.audio.plays.length;
    expect(voices).toBeGreaterThan(5); // ouverture, ingrédients, points, annonce du personnage
    expect(s.host.audio.plays.some((p) => p.loop)).toBe(false);
    await s.run(200);
    expect(s.host.audio.plays.slice(voices).some((p) => p.loop)).toBe(true);
  }, 60_000);

  it("l'impatience du pion attend 8 s à partir de la prise de main, pas du début de l'annonce", async () => {
    const s = await Session.start({ players: TWO, audio: true });
    const shownAt = s.host.time;
    await s.ready();
    expect(s.host.time - shownAt).toBeGreaterThan(FIDGET_AFTER_SECONDS * 1000); // l'annonce (S19 comprise) dure plus longtemps
    await s.run(500);
    expect(s.board.walker.pose).toBe(POSE_IDLE_RIGHT);
    await s.run(FIDGET_AFTER_SECONDS * 1000);
    expect(s.board.walker.pose).toBe(POSE_FIDGET_RIGHT);
  }, 60_000);

  it("porte → bonne scène → issue appliquée → joueur suivant", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x20 }); // porte gauche de l'écran 2 haut : S35 (coloriage)
    await s.tap("Space");
    await s.settle("MinigameStub");
    // La souche du mini-jeu affiche le fond de S35.
    expect(s.host.loaded.some((f) => /S35A000D\.MCG/i.test(f))).toBe(true);
    expect(s.game.state.phase).toBe("minigame");
    expect(s.game.state.pending).toMatchObject({ scene: 35, player: 0 });
    await s.tap("Space"); // réussi
    await s.ready();
    expect(s.game.state.players[0].points).toBe(STUB_POINTS);
    expect(s.game.state.current).toBe(1);
    expect(s.board.shown.player).toBe(1);
    expect(s.board.shown).toMatchObject({ screen: 1, row: "top", x: 0x0b });
  }, 60_000);

  it("la pression qui ouvre la porte ne coupe pas la voix d'accroche du mini-jeu", async () => {
    const s = await Session.start({ players: TWO, audio: true });
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x20 }); // S35
    const intro = await Promise.all([1, 2].map((n) => s.ctx.resources.voc(`s35a00${n}t.voc`)));
    await s.tap("Space");
    expect(s.host.audio.plays.some((p) => intro.some((v) => v.samples === p.sound.samples))).toBe(true);
    // La voix est dite en entier avant le mini-jeu.
    expect(s.ctx.voice.voicePlaying).toBe(true);
    expect(s.top()).toBe("GameScene");
    await s.settle("MinigameStub");
  }, 60_000);

  it("échec du mini-jeu : rien n'est gagné, le tour passe quand même ; au dernier joueur le tour de plateau avance", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x20 });
    await s.tap("Space");
    await s.settle("MinigameStub");
    await s.tap("Enter"); // échoué
    await s.ready();
    expect(s.game.state.players[0].points).toBe(0);
    expect(s.game.state.current).toBe(1);
    expect(s.game.state.round).toBe(1);
    s.place({ screen: 3, row: "top", x: 0x20 }); // S26
    await s.tap("Space");
    await s.settle("MinigameStub");
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.current).toBe(0);
    expect(s.game.state.round).toBe(2);
    expect(s.game.state.players[1].points).toBe(STUB_POINTS);
  }, 60_000);

  it("mini-jeu à ingrédient : réussi donne l'ingrédient de la scène (S22 → ingrédient 3)", async () => {
    const s = await Session.start({ players: [{ character: 2 }] });
    await s.ready();
    s.place({ screen: 7, row: "top", x: 0x20 }); // porte gauche écran 7 haut : S22
    await s.tap("Space");
    await s.settle("MinigameStub");
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.players[0].ingredients & (1 << 3)).not.toBe(0);
  }, 60_000);

  it("zone sans porte : le bouton ne fait rien et le tour continue", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 1, row: "top", x: 0x20 });
    await s.tap("Space");
    await s.run(300);
    expect(s.top()).toBe("GameScene");
    expect(s.game.state.phase).toBe("turn");
    expect(s.game.state.current).toBe(0);
  }, 60_000);

  it("sortie du plateau par la gauche : vidéo s01b, le tour est perdu", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    s.place({ screen: 1, row: "top", x: 0x04 }, false);
    s.host.input.keyDown("ArrowLeft");
    await s.settle("VideoScene");
    s.host.input.keyUp("ArrowLeft");
    expect(s.host.loaded.some((f) => /S01B\.MUX/i.test(f))).toBe(true);
    await s.run(1200);
    await s.tap("Escape"); // la vidéo se passe
    await s.ready();
    expect(s.game.state.current).toBe(1);
  }, 120_000);

  it("piège de marche : le pion est renvoyé ailleurs, le tour continue", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 4, row: "bottom", x: 0x90 });
    s.host.input.keyDown("ArrowRight");
    // Le pion s'arrête au point de déclenchement de la vidéo (0xad), après l'avoir rejoint en marchant.
    const xs: number[] = [];
    await s.until(() => {
      xs.push(s.board.shown.x);
      return s.top() === "BoardEventScene";
    });
    s.host.input.keyUp("ArrowRight");
    expect(s.board.shown.x).toBe(0xad);
    expect(new Set(xs).size).toBeGreaterThan(2); // marche animée, pas de saut
    await s.settle("BoardEventScene");
    await s.ready();
    expect(s.game.player).toMatchObject({ screen: 9, row: "top" });
    expect(s.board.shown).toMatchObject({ screen: 9, row: "top", x: s.game.player.x });
    expect(s.game.state.current).toBe(0);
  }, 60_000);

  it("prison : le tour s'arrête, le tour suivant est passé (voix), puis libération", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 3, row: "bottom", x: 0xa0 });
    s.setElapsedTurn(15);
    // Piège d'attente à 16 s de tour : animation de la cage, tour passé (cage affichée), libération, puis le plateau.
    await s.settle("BoardEventScene");
    expect(s.board.shown.x).toBe(0xac); // marché jusqu'au point de la cage avant la vidéo
    await s.until(() => s.board.shown.look === "jail");
    expect(s.board.shown).toMatchObject({ screen: 3, row: "bottom", x: 0xac });
    await s.settle("BoardEventScene"); // libération (S20)
    // Le bandeau du plateau reste affiché sous la vidéo (`2a78:0009`) : s20c n'a que des pixels parasites à cet endroit.
    const hud = 152 * 320;
    expect(s.ctx.surface.work.subarray(hud).every((p, i) => p === s.ctx.surface.background[hud + i])).toBe(true);
    await s.ready();
    expect(s.game.player.status).toBe(0);
    expect(s.board.shown.look).toBe("normal");
    // Le pion libéré est encore dans la zone de la cage : le chrono du tour part de la prise de main (`291e:0b6a`), pas
    // de la libération ; il n'est repris qu'après 16 s sur place.
    expect(s.game.state.turn.elapsed).toBeLessThan(2);
    await s.run(10_000);
    expect(s.game.player.status).toBe(0);
    expect(s.top()).toBe("GameScene");
  }, 120_000);

  it("S13 interactif : la porte du puits ouvert lance l'animation puis le puits (code 14)", async () => {
    const s = await Session.start();
    await s.ready();
    s.game.state.turn.wellOpen = true;
    s.game.player.ingredients = 0xff; // tous les ingrédients : le puits est toujours en mode voyage (pas de tirage)
    s.place({ screen: 4, row: "top", x: 0xe0 });
    await s.tap("Space");
    await s.settle("BoardEventScene"); // animation S13
    await s.settle("WellScene");
    expect(s.game.state.pending).toMatchObject({ scene: 14, wellMode: "travel" });
    await s.settle("MapScene"); // voix d'accroche, puis la carte des vœux
    await s.tap("Space"); // le lieu proposé est choisi
    await s.ready();
    expect(s.game.state.pending).toBeNull();
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("partie : voix et temps", () => {
  it("indices vocaux à 12 s puis 24 s sans rien toucher (seul)", async () => {
    const s = await Session.start({ audio: true });
    await s.ready();
    await s.run(1000);
    const hint = (from: number, to: number) => Promise.all(Array.from({ length: to - from + 1 }, (_, i) => s.ctx.resources.voc(`s01v0${from + i}t.voc`)));
    const first = await hint(31, 35);
    const second = await hint(36, 40);
    const played = () => s.host.audio.plays.map((p) => p.sound.samples);
    expect(played().some((x) => first.some((v) => v.samples === x))).toBe(false);
    await s.run(12_000);
    expect(played().some((x) => first.some((v) => v.samples === x))).toBe(true);
    expect(played().some((x) => second.some((v) => v.samples === x))).toBe(false);
    await s.run(25_000);
    expect(played().some((x) => second.some((v) => v.samples === x))).toBe(true);
  }, 120_000);

  it("pas d'indice quand le joueur a bougé", async () => {
    const s = await Session.start({ audio: true });
    await s.ready();
    await s.tap("ArrowRight", 300);
    const first = await Promise.all([31, 32, 33, 34, 35].map((n) => s.ctx.resources.voc(`s01v0${n}t.voc`)));
    await s.run(20_000);
    expect(s.host.audio.plays.some((p) => first.some((v) => v.samples === p.sound.samples))).toBe(false);
  }, 120_000);

  it("à plusieurs, l'action automatique de 36 s enclenche la porte où se trouve le pion", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x20 });
    await s.run(30_000);
    expect(s.top()).toBe("GameScene");
    await s.until(() => s.top() === "MinigameStub", 15_000);
    expect(s.game.state.pending).toMatchObject({ scene: 35, player: 0 });
  }, 120_000);

  it("seul, le tour est sans limite", async () => {
    const s = await Session.start();
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x20 });
    await s.run(60_000);
    expect(s.top()).toBe("GameScene");
    expect(s.game.state.phase).toBe("turn");
  }, 120_000);

  it("le chrono de la partie compte le temps passé dans un mini-jeu", async () => {
    const s = await Session.start({ players: TWO });
    await s.ready();
    s.place({ screen: 2, row: "top", x: 0x20 });
    await s.tap("Space");
    await s.settle("MinigameStub");
    const before = s.game.state.elapsed;
    await s.run(10_000);
    await s.tap("Space");
    await s.ready();
    expect(s.game.state.elapsed - before).toBeGreaterThanOrEqual(9);
  }, 120_000);
});
