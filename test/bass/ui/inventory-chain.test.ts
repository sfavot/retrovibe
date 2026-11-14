import { describe, expect, it } from "vitest";
import { MemoryStorage } from "../../../src/engine/storage";
import { createBassEngine } from "../../../src/games/bass/create";
import { BrowserHost } from "../../../src/games/bass/ui/browser-host";
import { skyCpt, skyDisk } from "../data/helpers";
import { hasOriginalFiles } from "../engine/helpers";

/** Inventaire par la chaîne réelle de la page (`InputQueue` -> `pollInput` -> moteur), sur les vrais fichiers. */
function setup() {
  const host: BrowserHost = new BrowserHost({
    storage: new MemoryStorage(),
    onExit() {},
    onSaveRequest() {},
    onRestoreRequest() {},
    onSettings() {},
    onVolume() {},
    onButtons: (mask) => (game.engine.mouse.held = mask),
  });
  const game = createBassEngine({ disk: skyDisk(), cpt: skyCpt() }, host, { render: true });
  game.engine.startAfterIntro();
  const ticks = (n: number) => {
    for (let i = 0; i < n; i++) game.engine.tick();
  };
  ticks(200);
  host.input.openInventory(160);
  ticks(15);
  const before = game.renderer!.frame.pixels.slice();
  const changed = (): number => game.renderer!.frame.pixels.reduce((n, p, i) => n + (p !== before[i] ? 1 : 0), 0);
  return { host, game, ticks, changed };
}

describe.skipIf(!hasOriginalFiles)("inventaire par la chaîne d'entrées de la page", () => {
  it("un clic gauche sur une icône (déplacement et clic donnés ensemble, comme un toucher ou un clic simulé) lance fnLookAt : le texte s'affiche", () => {
    const { host, game, ticks } = setup();
    host.input.move(40, 8);
    host.input.down(0, 40, 8);
    host.input.up(0, 40, 8);
    let blocked = 0;
    for (let i = 0; i < 80; i++) {
      ticks(1);
      if (game.engine.blocked) blocked++;
    }
    // fnLookAt tient le tour au moins 800 ms (40 ticks) pendant que le texte est à l'écran.
    expect(blocked).toBeGreaterThanOrEqual(38);
  });

  it("même chose au toucher (tap)", () => {
    const { host, game, ticks } = setup();
    host.input.tap(0, 40, 8);
    let blocked = 0;
    for (let i = 0; i < 80; i++) {
      ticks(1);
      if (game.engine.blocked) blocked++;
    }
    expect(blocked).toBeGreaterThanOrEqual(38);
  });

  it("le texte de la description est à l'écran pendant l'attente", () => {
    const { host, game, ticks, changed } = setup();
    host.input.move(40, 8);
    ticks(10);
    const hover = changed();
    host.input.down(0, 40, 8);
    host.input.up(0, 40, 8);
    ticks(25);
    expect(game.engine.blocked).toBe(true);
    expect(changed()).toBeGreaterThan(hover);
  });
});
