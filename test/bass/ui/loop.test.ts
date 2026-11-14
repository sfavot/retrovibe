import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import { createBassEngine } from "../../../src/games/bass/create";
import { SF } from "../../../src/games/bass/engine/ids";
import { CursorOverlay, MouseCursor } from "../../../src/games/bass/render/cursor";
import { BrowserHost } from "../../../src/games/bass/ui/browser-host";
import { BassLoop } from "../../../src/games/bass/ui/loop";
import { skyCpt, skyDisk } from "../data/helpers";
import { hasOriginalFiles } from "../engine/helpers";

/** Hôte du navigateur sur les vrais fichiers, sans son : l'introduction, puis le jeu, avec les entrées de la page. */
function setup(intro: boolean) {
  const buttons: number[] = [];
  const host: BrowserHost = new BrowserHost({
    storage: new MemoryStorage(),
    onExit() {},
    onSaveRequest() {},
    onRestoreRequest() {},
    onSettings() {},
    onVolume() {},
    onButtons: (mask) => {
      buttons.push(mask);
      game.engine.mouse.held = mask;
    },
  });
  const game = createBassEngine({ disk: skyDisk(), cpt: skyCpt() }, host, { render: true, intro: intro ? {} : undefined });
  const presented: { pixels: Uint8Array; palette: Uint8Array }[] = [];
  const disk = skyDisk();
  const loop = new BassLoop({
    game,
    overlay: new CursorOverlay((id) => (disk.has(id) ? disk.load(id) : null)),
    present: (pixels, palette) => presented.push({ pixels: pixels.slice(), palette: palette.slice() }),
    touchMode: () => host.input.touchMode,
  });
  if (!intro) game.engine.startAfterIntro();
  return { host, game, loop, presented, buttons };
}

describe.skipIf(!hasOriginalFiles)("BassLoop : introduction, puis jeu", () => {
  it("l'introduction tourne d'abord (image de l'introduction, « Passer » offert), un appui sur Échap la passe et le jeu démarre", () => {
    const { host, game, loop, presented } = setup(true);
    expect(loop.introRunning).toBe(true);
    expect(loop.canSkip).toBe(true);
    expect(loop.canSave).toBe(false);
    for (let i = 0; i < 5; i++) loop.tick();
    loop.render();
    expect(presented).toHaveLength(1);
    expect(presented[0]!.pixels).toHaveLength(64000);
    expect(game.engine.completedCycles).toBe(0);

    host.input.action("skip");
    for (let i = 0; i < 3 && loop.introRunning; i++) loop.tick();
    expect(loop.introRunning).toBe(false);
    expect(game.engine.system.pastIntro).toBe(true);
    loop.tick();
    expect(game.engine.cycleCount).toBeGreaterThan(0);
  });

  it("un clic de souris passe aussi l'introduction", () => {
    const { host, loop } = setup(true);
    loop.tick();
    host.input.down(0, 100, 100);
    for (let i = 0; i < 12 && loop.introRunning; i++) loop.tick();
    expect(loop.introRunning).toBe(false);
  });

  it("endIntro (chargement de partie pendant l'introduction) démarre le jeu tout de suite, une seule fois", () => {
    const { game, loop } = setup(true);
    let starts = 0;
    const original = game.engine.startAfterIntro.bind(game.engine);
    game.engine.startAfterIntro = () => (starts++, original());
    loop.endIntro();
    loop.endIntro();
    expect(loop.introRunning).toBe(false);
    expect(starts).toBe(1);
  });

  it("en jeu : le curseur est dessiné par-dessus l'image, avec la palette de l'écran, sans modifier l'écran du moteur", () => {
    const { host, game, loop, presented } = setup(false);
    for (let i = 0; i < 40; i++) loop.tick();
    host.input.move(200, 100);
    for (let i = 0; i < 8; i++) loop.tick();
    game.engine.mouse.sprite(MouseCursor.normal, 0, 0); // le jeu cache le curseur pendant certaines scènes
    const before = game.renderer!.frame.pixels.slice();
    loop.render();
    const shown = presented.at(-1)!.pixels;
    expect(game.renderer!.frame.pixels).toEqual(before);
    const differing = shown.reduce((n, p, i) => n + (p !== before[i] ? 1 : 0), 0);
    expect(differing).toBeGreaterThan(20);
    expect(differing).toBeLessThan(22 * 22);
    expect(presented.at(-1)!.palette).toEqual(game.renderer!.frame.palette);
  });

  it("au doigt, le curseur de la souris n'est pas dessiné, mais l'objet tenu reste visible", () => {
    const { host, game, loop, presented } = setup(false);
    for (let i = 0; i < 80; i++) loop.tick();
    host.input.tap(0, 100, 100);
    for (let i = 0; i < 8; i++) loop.tick();
    expect(host.input.touchMode).toBe(true);
    game.engine.mouse.sprite(MouseCursor.normal, 0, 0);
    loop.render();
    expect(presented.at(-1)!.pixels).toEqual(game.renderer!.frame.pixels);
    // Objet en main (curseur 0, image d'objet 0 de 60301) : dessiné même au doigt.
    game.engine.mouse.sprite(MouseCursor.heldObject, 5, 5);
    game.engine.mouse.objectCursor = 0;
    loop.render();
    expect(presented.at(-1)!.pixels).not.toEqual(game.renderer!.frame.pixels);
  });

  it("toucher le haut de l'écran déplace le pointeur sur la ligne 0 sans cliquer", () => {
    const { host, game, loop } = setup(false);
    for (let i = 0; i < 80; i++) loop.tick();
    host.input.openInventory(160);
    for (let i = 0; i < 8; i++) loop.tick();
    expect(game.engine.pointer).toEqual({ x: 160, y: 0 });
    expect(game.engine.mouse.button).toBe(0);
  });

  it("un clic de souris tenu est vu par le jeu (Mouse.held) puis relâché", () => {
    const { host, game, buttons } = setup(false);
    host.input.down(2, 50, 50);
    expect(game.engine.mouse.held).toBe(1);
    host.input.up(2, 50, 50);
    expect(game.engine.mouse.held).toBe(0);
    expect(buttons).toEqual([1, 0]);
  });

  it("F5 ouvre le panneau de contrôle (jeu figé), Échap le ferme ; les réglages changés sont notifiés à l'hôte", () => {
    const { host, game, loop } = setup(false);
    for (let i = 0; i < 80; i++) loop.tick();
    expect(loop.canSkip).toBe(true);
    host.input.action("panel");
    for (let i = 0; i < 400 && !game.engine.control.panelOpen; i++) loop.tick();
    expect(game.engine.control.panelOpen).toBe(true);
    expect(loop.canSkip).toBe(false);
    const cycles = game.engine.cycleCount;
    for (let i = 0; i < 20; i++) loop.tick();
    expect(game.engine.cycleCount).toBe(cycles);
    host.input.action("skip");
    for (let i = 0; i < 100 && game.engine.control.panelOpen; i++) loop.tick();
    expect(game.engine.control.panelOpen).toBe(false);
  });

  it("choisir : le drapeau de choix de dialogue est lu par la boucle", () => {
    const { game, loop } = setup(false);
    expect(loop.choosing).toBe(false);
    game.engine.system.systemFlags |= SF.CHOOSING;
    expect(loop.choosing).toBe(true);
  });

  it("la sauvegarde n'est offerte qu'une fois le jeu commencé et sans effet bloquant", () => {
    const { loop } = setup(false);
    expect(loop.canSave).toBe(true);
  });
});
