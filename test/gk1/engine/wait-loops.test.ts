import { describe, expect, it } from "vitest";
import { decodeCp850 } from "../../../src/data/cp850";
import { eventsOf, MouseButton } from "../../../src/games/gk1/engine/events";
import { SUSPEND_GET_EVENT } from "../../../src/games/gk1/engine/kernel/events";
import { SUSPEND_FRAME_OUT } from "../../../src/games/gk1/engine/kernel/planes";
import { lookupSelector, newLookup, readSelector, SelectorKind } from "../../../src/games/gk1/engine/object";
import type { Vm } from "../../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { original } from "../data/real";
import { bookshop, center, click, item, step } from "./journey";

/**
 * Boucles d'attente des scripts qui relisent `GetEvent` sans appeler `FrameOut` (`docs/gk1/engine.md` § 9) : le jeu doit
 * continuer de recevoir les entrées et de rendre la main à la page, une image par tick.
 */

/** Icônes de la barre : « ? » (aide), « marcher », « regarder », panneau de réglages. */
const HELP_ICON = "icon5";
const WALK_ICON = "icon2";
const LOOK_ICON = "icon3";
const CONTROL_PANEL_ICON = "icon11";
/** Curseur « ? » de l'aide (vue des curseurs d'action). */
const HELP_CURSOR = { view: 958, loop: 8 };

/** Textes des fenêtres de texte à l'écran. */
function shownTexts(vm: Vm): string[] {
  const selector = vm.selectors.id("text");
  const out: string[] = [];
  for (const plane of frameoutOf(vm).planes) {
    for (const shown of plane.items) {
      const object = shown.object !== 0 && shown.bitmap !== 0 ? vm.memory.getObject(shown.object) : undefined;
      if (!object || lookupSelector(vm.memory, object, selector, newLookup()) !== SelectorKind.Variable) continue;
      const raw = vm.memory.getString(readSelector(vm.memory, shown.object, selector));
      out.push(decodeCp850(Uint8Array.from(raw, (char) => char.charCodeAt(0))));
    }
  }
  return out;
}

/** Ouvre la barre d'icônes : le pointeur touche le haut de l'écran. */
function openIconBar(vm: Vm): void {
  eventsOf(vm).move(160, 2);
  step(vm, 30);
  expect(item(vm, HELP_ICON)).toBeDefined();
}

describe.skipIf(!original.has)("boucles d'attente sans FrameOut", () => {
  it("aide « ? » de la barre d'icônes : le texte suit l'icône survolée, un clic quitte l'aide", { timeout: 120_000 }, () => {
    const vm = bookshop();
    const cursor = frameoutOf(vm).cursor;
    const events = eventsOf(vm);
    openIconBar(vm);

    // Clic sur « ? » : `GKIconbar::noClickHelp` tourne, le curseur devient un point d'interrogation.
    const help = center(vm, HELP_ICON);
    click(vm, help.x, help.y);
    step(vm, 10);
    expect(vm.backtrace().some((line) => line.startsWith("GKIconbar::noClickHelp"))).toBe(true);
    expect([cursor.view, cursor.loop]).toEqual([HELP_CURSOR.view, HELP_CURSOR.loop]);

    // Sans rien survoler de nouveau, la boucle ne fait que relire la file : chaque image rend la main sur `GetEvent`, en un
    // seul tick d'horloge (pas de tranche d'instructions épuisée).
    const ticks = vm.ticks;
    expect(step(vm, 20).reason).toBe(SUSPEND_GET_EVENT);
    expect(vm.ticks).toBe(ticks + 20);

    // Survol d'une icône : son texte d'aide s'affiche ; d'une autre : le texte change.
    const walk = center(vm, WALK_ICON);
    events.move(walk.x, walk.y);
    step(vm, 5);
    const walkHelp = shownTexts(vm);
    expect(walkHelp).toMatchInlineSnapshot(`
      [
        "L'icône MARCHER vous permet de déplacer Gabriel à l'écran. Cliquez sur l'icône, et pointer la à l'endroit où vous voulez amener Gabriel.",
      ]
    `);
    const look = center(vm, LOOK_ICON);
    events.move(look.x, look.y);
    step(vm, 5);
    const lookHelp = shownTexts(vm);
    expect(lookHelp).toMatchInlineSnapshot(`
      [
        "L'icône REGARDER vous permet d'avoir une description d'un objet. Cliquez sur l'icône, puis utilisez le curseur sur un objet à l'écran. Des indices y sont souvent dissimulés.",
      ]
    `);
    // Hors de toute icône : plus de texte.
    events.move(160, 120);
    step(vm, 5);
    expect(shownTexts(vm)).toEqual([]);

    // Un clic quitte l'aide sans choisir l'icône : le curseur d'avant revient, le jeu reprend son rythme (`FrameOut`).
    events.move(look.x, look.y);
    step(vm, 5);
    events.down(MouseButton.Left, look.x, look.y);
    events.up(MouseButton.Left, look.x, look.y);
    step(vm, 5);
    expect(vm.backtrace().some((line) => line.includes("noClickHelp"))).toBe(false);
    expect(shownTexts(vm)).toEqual([]);
    expect([cursor.view, cursor.loop]).not.toEqual([HELP_CURSOR.view, HELP_CURSOR.loop]);
    expect(step(vm, 20).reason).toBe(SUSPEND_FRAME_OUT);
    expect([...vm.warnings.keys()]).toEqual([]);
  });

  it("glisser d'un curseur du panneau de réglages : la jauge suit le pointeur, le relâchement rend la main", { timeout: 120_000 }, () => {
    const vm = bookshop();
    const events = eventsOf(vm);
    openIconBar(vm);
    const panel = center(vm, CONTROL_PANEL_ICON);
    click(vm, panel.x, panel.y);
    step(vm, 30);
    const bar = item(vm, "speedBar")!.screenRect;
    const gauge = (): number => item(vm, "testBar")!.screenRect.right;
    const y = (bar.top + bar.bottom) >> 1;

    events.move(bar.left + 20, y);
    step(vm, 3);
    events.down(MouseButton.Left, bar.left + 20, y);
    step(vm, 5);
    expect(vm.backtrace().some((line) => line.startsWith("speedBar::select"))).toBe(true);
    const low = gauge();
    events.move(bar.right - 10, y);
    step(vm, 5);
    expect(gauge()).toBeGreaterThan(low);
    events.up(MouseButton.Left, bar.right - 10, y);
    step(vm, 5);
    expect(vm.backtrace().some((line) => line.startsWith("speedBar::select"))).toBe(false);
    expect([...vm.warnings.keys()]).toEqual([]);
  });
});
