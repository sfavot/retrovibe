import { describe, expect, it, vi } from "vitest";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { acceptingBridge, BRIDGE_ANCHORS, type Bridge } from "../../src/games/zoombinis/game/puzzles/bridge";
import { makeZoombini } from "../../src/games/zoombinis/game/state";
import type { BridgeScene } from "../../src/games/zoombinis/scenes/puzzles/bridge";
import { originalFiles } from "../support/original";
import { boot, dragMember, reach, tick, until } from "./full-game-robot";

vi.setConfig({ testTimeout: 30_000 });

const original = originalFiles("zoombinis", "files.json");

/** Hôte de test dont le dernier appui est (ou non) un doigt (`Host.pointerIsTouch`, posé par `ui/browser-host.ts`). */
const setTouch = (host: object, touch: boolean): void => void ((host as { pointerIsTouch?: boolean }).pointerIsTouch = touch);

describe.skipIf(!original.has)("tactile : glisser-déposer au doigt", () => {
  async function toBridge(touch: boolean) {
    const r = await boot();
    // Option « souris aimantée » active, comme dans une partie neuve du navigateur (`boot` la coupe pour les robots).
    r.zb.game.options.magneticMouse = true;
    setTouch(r.host, touch);
    r.zb.game.group.members = Array.from({ length: 8 }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (i % 3), 1], i + 1));
    r.zb.session.screen = ScreenId.bridge;
    r.engine.start(ScreenId.bridge);
    await reach(r, ScreenId.bridge);
    const scene = r.scenes.get(ScreenId.bridge) as BridgeScene;
    await until(r, "gorges : sonde", () => (scene.probe?.kit.members.length ?? 0) > 0);
    // Laisse finir l'arrivée du groupe.
    await until(r, "gorges : groupe posé", () => scene.probe!.kit.members.every((m) => m.snoid.resting), 600);
    return { r, p: scene.probe! };
  }

  it("au doigt, relâcher dépose : la « souris aimantée » ne garde pas le Zoombini en l'air", async () => {
    const { r, p } = await toBridge(true);
    const index = p.kit.members.length - 1;
    const bridge = acceptingBridge(p.state.rule, p.state.attrs[index]!) as Bridge;
    await dragMember(r, p.kit, index, BRIDGE_ANCHORS[bridge as 1 | 2]);
    expect(r.engine.ctx.prefs.magneticMouse).toBe(false);
    expect(p.kit.carrying).toBeNull();
    await until(r, "gorges : le Zoombini traverse", () => p.statuses[index] !== "wait", 200);
  });

  it("à la souris, la « souris aimantée » garde le Zoombini collé jusqu'au clic suivant", async () => {
    const { r, p } = await toBridge(false);
    const index = p.kit.members.length - 1;
    const bridge = acceptingBridge(p.state.rule, p.state.attrs[index]!) as Bridge;
    const anchor = BRIDGE_ANCHORS[bridge as 1 | 2];
    await dragMember(r, p.kit, index, anchor);
    expect(r.engine.ctx.prefs.magneticMouse).toBe(true);
    expect(p.kit.carrying).not.toBeNull();
    expect(p.statuses[index]).toBe("wait");
    r.host.click(anchor.x, anchor.y);
    await tick(r, 6);
    await until(r, "gorges : le Zoombini traverse", () => p.statuses[index] !== "wait", 200);
  });
});

describe.skipIf(!original.has)("tactile : menu (enregistrer, charger)", () => {
  it("sur la carte, le bouton du menu (SCRB 1005, pierre en haut à droite) est dessiné et un toucher dedans ouvre le menu", async () => {
    const { DIALOG } = await import("../../src/games/zoombinis/engine/dialog");
    const { FEATURES } = await import("../../src/games/zoombinis/engine/features");
    const r = await boot();
    setTouch(r.host, true);
    r.zb.session.screen = ScreenId.picker;
    r.engine.start(ScreenId.map);
    await reach(r, ScreenId.map);
    await tick(r, 10);
    const button = r.engine.services.get(FEATURES).features.find((f) => f.scriptId === 1005)!;
    expect(button.rect).toEqual({ left: 588, top: 15, right: 625, bottom: 45 });
    expect(button.parts.length).toBeGreaterThan(0);
    r.host.click(606, 30);
    await tick(r, 6);
    expect(r.engine.services.get(DIALOG).isOpen).toBe(true);
  });
});
