import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import { createBassEngine } from "../../../src/games/bass/create";
import type { BassSettings } from "../../../src/games/bass/engine/host";
import { CursorOverlay } from "../../../src/games/bass/render/cursor";
import { BrowserHost } from "../../../src/games/bass/ui/browser-host";
import { BassLoop } from "../../../src/games/bass/ui/loop";
import { skyCpt, skyDisk } from "../data/helpers";
import { hasOriginalFiles } from "../engine/helpers";

/** Positions des éléments du panneau (voir `test/bass/control/panel.test.ts`). */
const AT = { save: [122, 53], quit: [122, 73], restart: [122, 93], text: [122, 133], speedSlide: [85, 112], musicSlide: [85, 70], yes: [95, 95], no: [175, 95] } as const;

/** Chaîne réelle de la page : `InputQueue` (souris du navigateur) -> `pollInput` -> `GameControl.tick` / moteur, sur les vrais fichiers. */
function setup() {
  const seen = { save: 0, restore: 0, exit: 0, settings: [] as BassSettings[] };
  const host: BrowserHost = new BrowserHost({
    storage: new MemoryStorage(),
    onExit: () => seen.exit++,
    onSaveRequest: () => seen.save++,
    onRestoreRequest: () => seen.restore++,
    onSettings: (s) => seen.settings.push(s),
    onVolume() {},
    onButtons: (mask) => (game.engine.mouse.held = mask),
  });
  const game = createBassEngine({ disk: skyDisk(), cpt: skyCpt() }, host, { render: true });
  const loop = new BassLoop({ game, overlay: new CursorOverlay(() => null), present() {}, touchMode: () => false });
  game.engine.startAfterIntro();
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) loop.tick();
  };
  ticks(80);
  host.input.action("panel");
  ticks(10);
  /** Clic de navigateur : déplacement, appui et relâchement dans le même tick, après `lead` ticks de calme. */
  const click = ([x, y]: readonly [number, number], lead = 0, after = 20) => {
    ticks(lead);
    host.input.move(x, y);
    host.input.down(0, x, y);
    host.input.up(0, x, y);
    ticks(after);
  };
  return { host, game, seen, ticks, click };
}

describe.skipIf(!hasOriginalFiles)("panneau F5 par la chaîne d'entrées de la page", () => {
  it("le panneau s'ouvre", () => {
    expect(setup().game.engine.control.panelOpen).toBe(true);
  });

  it.each([0, 1, 2, 3])("un clic de souris sur « Sauvegarder » (appui et relâchement dans le même tick, décalage %i) arrive au panneau", (lead) => {
    const { click, seen } = setup();
    click(AT.save, lead);
    expect(seen.save).toBe(1);
  });

  it("le survol d'un bouton écrit son libellé, un clic sur le bouton texte / voix change le mode et prévient l'hôte", () => {
    const { click, seen, game } = setup();
    click(AT.text, 1);
    expect(seen.settings.at(-1)?.textMode).toBeDefined();
    expect(game.engine.control.panelOpen).toBe(true);
  });

  it("glisser le curseur de vitesse puis le relâcher pose la vitesse et prévient l'hôte", () => {
    const { host, game, seen, ticks } = setup();
    const [x, y] = AT.speedSlide;
    host.input.move(x, y);
    ticks(8);
    host.input.down(0, x, y);
    ticks(10);
    host.input.move(x, y + 10);
    ticks(5);
    host.input.up(0, x, y + 10);
    ticks(8);
    expect(game.engine.system.gameSpeed).not.toBe(80);
    expect(seen.settings.length).toBeGreaterThan(0);
  });

  it("glisser le curseur de volume change le volume de la musique", () => {
    const { host, game, seen, ticks } = setup();
    const [x, y] = AT.musicSlide;
    host.input.move(x, y);
    ticks(8);
    host.input.down(0, x, y);
    ticks(10);
    host.input.move(x, y + 20);
    ticks(5);
    host.input.up(0, x, y + 20);
    ticks(8);
    expect(seen.settings.at(-1)?.musicVolume).toBeLessThan(127);
    expect(game.engine.control.panelOpen).toBe(true);
  });

  it("Recommencer : la question oui / non répond au clic, « non » garde le panneau, « oui » le ferme", () => {
    const { click, game } = setup();
    click(AT.restart, 1, 40);
    click(AT.no, 1, 40);
    expect(game.engine.control.panelOpen).toBe(true);
    click(AT.restart, 1, 40);
    click(AT.yes, 1, 40);
    for (let i = 0; i < 100 && game.engine.control.panelOpen; i++) game.engine.tick();
    expect(game.engine.control.panelOpen).toBe(false);
  });

  it("Quitter : « oui » demande la sortie à l'hôte", () => {
    const { click, seen } = setup();
    click(AT.quit, 1, 40);
    click(AT.yes, 1, 40);
    expect(seen.exit).toBe(1);
  });
});
