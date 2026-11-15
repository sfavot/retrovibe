import { describe, expect, it, vi } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { DEFAULT_DISPLAY, DISPLAY } from "../../../src/games/tim3/engine/players";
import { RenderAssets } from "../../../src/games/tim3/render";
import { ItfWindow } from "../../../src/games/tim3/ui/itf-window";
import { USERPREF, toggleDisplay, userPrefChecked, userPrefWindow, withReadableTitle } from "../../../src/games/tim3/ui/userpref-window";
import { frenchIndex, original } from "../data/real";

describe("USERPREF.ITF : bascules (42ae4a)", () => {
  it("chaque case bascule son bit ; éteindre les décors éteint aussi les fonds (42aec8), pas l'inverse", () => {
    expect(toggleDisplay(DEFAULT_DISPLAY, USERPREF.ambientSel)).toBe(DISPLAY.scenery | DISPLAY.background);
    expect(toggleDisplay(DEFAULT_DISPLAY, USERPREF.scenerySel)).toBe(DISPLAY.ambient);
    expect(toggleDisplay(DISPLAY.ambient, USERPREF.scenerySel)).toBe(DISPLAY.ambient | DISPLAY.scenery);
    // Fonds rallumés sans les décors : le jeu le permet (42aee3 ne vérifie rien).
    expect(toggleDisplay(DISPLAY.ambient, USERPREF.backgroundSel)).toBe(DISPLAY.ambient | DISPLAY.background);
    expect(toggleDisplay(DEFAULT_DISPLAY, USERPREF.infoSel)).toBe(DEFAULT_DISPLAY | DISPLAY.noInfo);
    expect(toggleDisplay(DEFAULT_DISPLAY | DISPLAY.noInfo, USERPREF.infoSel)).toBe(DEFAULT_DISPLAY);
    // Bits inconnus gardés (mot +0x154 écrit tel quel).
    expect(toggleDisplay(0x107, USERPREF.ambientSel)).toBe(0x106);
    expect(toggleDisplay(DEFAULT_DISPLAY, USERPREF.done)).toBe(DEFAULT_DISPLAY);
  });

  it("cases allumées (42accf) : la case des icônes d'info est inversée, celle du son suit l'interrupteur général", () => {
    const on = { display: DEFAULT_DISPLAY, soundOn: true };
    expect([USERPREF.ambientSel, USERPREF.scenerySel, USERPREF.backgroundSel, USERPREF.infoSel, USERPREF.soundSel].map((id) => userPrefChecked(on, id))).toEqual([true, true, true, true, true]);
    const off = { display: DISPLAY.noInfo, soundOn: false };
    expect([USERPREF.ambientSel, USERPREF.scenerySel, USERPREF.backgroundSel, USERPREF.infoSel, USERPREF.soundSel].map((id) => userPrefChecked(off, id))).toEqual([false, false, false, false, false]);
    expect(userPrefChecked(on, USERPREF.done)).toBeUndefined();
  });
});

describe.skipIf(!original.has)("USERPREF.ITF : la fenêtre", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const itf = () => readItf(index.get("USERPREF.ITF"));
  const open = (display = DEFAULT_DISPLAY, soundOn = true) => {
    const o = { initial: { display, soundOn }, setDisplay: vi.fn(), setSound: vi.fn(), help: vi.fn() };
    const w = userPrefWindow(assets, itf(), o);
    return { o, w, m: new ItfWindow(assets, w.itf, w.options) };
  };

  it("les cases montrent les préférences : image 0 éteinte, dernière image allumée (44f02c)", () => {
    const { w } = open(DISPLAY.ambient | DISPLAY.noInfo, false);
    const frames = w.options.state!.frames!;
    expect(frames[USERPREF.ambientSel]).toBeGreaterThan(0);
    expect(frames[USERPREF.scenerySel]).toBe(0);
    expect(frames[USERPREF.backgroundSel]).toBe(0);
    expect(frames[USERPREF.infoSel]).toBe(0);
    expect(frames[USERPREF.soundSel]).toBe(0);
  });

  it("un clic sur une case la bascule, garde la fenêtre ouverte et rend les nouvelles préférences", () => {
    const { o, w, m } = open();
    const r = m.item(USERPREF.scenerySel)!;
    m.pointerDown(r.x + 2, r.y + 2);
    const id = m.pointerUp(r.x + 2, r.y + 2);
    expect(id).toBe(USERPREF.scenerySel);
    expect(w.options.choose(id!)).toBe(true);
    expect(o.setDisplay).toHaveBeenLastCalledWith(DISPLAY.ambient);
    expect(w.options.checked!(USERPREF.backgroundSel)).toBe(false);
    expect(w.options.state!.frames![USERPREF.backgroundSel]).toBe(0);
    expect(w.options.choose(USERPREF.infoSel)).toBe(true);
    expect(o.setDisplay).toHaveBeenLastCalledWith(DISPLAY.ambient | DISPLAY.noInfo);
    expect(w.options.choose(USERPREF.soundSel)).toBe(true);
    expect(o.setSound).toHaveBeenCalledWith(false);
  });

  it("langue cachée (drapeau 8) ; ▲ ▼ sans effet (une seule langue) ; « ? » ferme pour l'aide ; « Terminé » et Échap ferment", () => {
    const { o, w } = open();
    expect(w.options.state!.hidden).toContain(USERPREF.language);
    expect(w.options.choose(USERPREF.up)).toBe(true);
    expect(w.options.choose(USERPREF.down)).toBe(true);
    expect(o.setDisplay).not.toHaveBeenCalled();
    expect(w.options.choose(USERPREF.help)).toBe(false);
    expect(o.help).toHaveBeenCalled();
    expect(w.options.choose(USERPREF.done)).toBe(false);
    expect(w.options.defaultId).toBe(USERPREF.done);
    expect(w.options.cancelId).toBe(USERPREF.done);
    expect(w.options.title).toBe("Préférences du joueur");
  });

  it("calque : chaque case porte le libellé du jeu posé à sa droite, avec son état", () => {
    const { m } = open(DISPLAY.ambient);
    const byKey = new Map(m.controls().map((c) => [c.key, c]));
    expect(byKey.get(`b${USERPREF.ambientSel}`)).toMatchObject({ name: "Animation Ambiante", pressed: true });
    expect(byKey.get(`b${USERPREF.scenerySel}`)).toMatchObject({ name: "Affichage des Éléments du Décor", pressed: false });
    expect(byKey.get(`b${USERPREF.backgroundSel}`)).toMatchObject({ name: "Décor On", pressed: false });
    expect(byKey.get(`b${USERPREF.infoSel}`)).toMatchObject({ name: "Icônes d'Info On", pressed: true });
    expect(byKey.get(`b${USERPREF.soundSel}`)).toMatchObject({ name: "Effets Sonores On", pressed: true });
    expect(byKey.has(`b${USERPREF.language}`)).toBe(false);
  });

  it("titre lisible (écart voulu) : le jeu n'écrit que « Préférences des » ; le port élargit le contrôle jusqu'à l'ordinateur", () => {
    const base = itf();
    const wide = withReadableTitle(assets, base);
    const before = base.controls.find((c) => c.id === USERPREF.heading)!;
    const after = wide.controls.find((c) => c.id === USERPREF.heading)!;
    const box = base.controls.find((c) => c.id === USERPREF.ambientSel)!;
    const picture = base.controls.find((c) => c.id === USERPREF.picture)!;
    expect(after).toMatchObject({ x: box.x, y: before.y, width: picture.x - box.x, height: before.height });
    expect(withReadableTitle(assets, wide)).toEqual(wide);
  });
});
