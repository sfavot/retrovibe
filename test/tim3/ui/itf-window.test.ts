import { describe, expect, it } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { RenderAssets, Surface } from "../../../src/games/tim3/render";
import { ITF_TICK_MS, ItfWindow } from "../../../src/games/tim3/ui/itf-window";
import { frenchIndex, original } from "../data/real";

describe.skipIf(!original.has)("fenêtre ITF sans DOM (ItfWindow)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const generic = () => new ItfWindow(assets, readItf(index.get("GENERIC.ITF")), { title: "", state: { texts: { 65004: "Sûr ?" } }, cancelId: 65002 });
  const solved = () => new ItfWindow(assets, readItf(index.get("PUZZSOLV.ITF")), { title: "", state: { disabled: [17003] } });

  it("appui puis relâché sur le même bouton : il est choisi ; enfoncé entre les deux", () => {
    const m = generic();
    expect(m.pointerDown(230, 300)).toBe(true);
    expect(m.state().pressed).toBe(65001);
    expect(m.pointerUp(231, 301)).toBe(65001);
    expect(m.state().pressed).toBeNull();
  });

  it("glisser hors du bouton le relâche et n'agit pas ; revenir dessus le renfonce", () => {
    const m = generic();
    m.pointerDown(230, 300);
    expect(m.pointerMove(100, 100)).toBe(true);
    expect(m.state().pressed).toBeNull();
    expect(m.pointerMove(232, 302)).toBe(true);
    expect(m.state().pressed).toBe(65001);
    m.pointerMove(330, 300);
    expect(m.pointerUp(330, 300)).toBeNull();
  });

  it("hors des boutons : rien", () => {
    const m = generic();
    expect(m.pointerDown(320, 200)).toBe(false);
    expect(m.pointerUp(320, 200)).toBeNull();
  });

  it("Échap choisit le bouton d'annulation ; sans annulation, il ferme sans choix", () => {
    expect(generic().escape()).toBe(65002);
    expect(solved().escape()).toBeNull();
  });

  it("un bouton grisé ne s'enfonce pas et ne s'active pas", () => {
    const m = solved();
    expect(m.pointerDown(390, 230)).toBe(false);
    expect(m.pointerUp(390, 230)).toBeNull();
    expect(m.canActivate(17003)).toBe(false);
    expect(m.canActivate(17004)).toBe(true);
  });

  it("boutons dans l'ordre de lecture, avec leur libellé ; textes pour les lecteurs d'écran", () => {
    const m = solved();
    expect(m.buttons().map((b) => [b.name, m.label(b)])).toEqual([
      ["PS_PLAY", "Même Puzzle"],
      ["PS_RERUN", "Rejouer la Solution"],
      ["PS_NEXT", "Puzzle Suivant"],
    ]);
    expect(generic().texts()).toEqual(["Sûr ?"]);
  });

  it("le rendu redessine l'état enfoncé", () => {
    const m = generic();
    const a = new Surface(640, 480);
    const b = new Surface(640, 480);
    m.render(a);
    m.pointerDown(230, 300);
    m.render(b);
    expect(a.pixels.some((v, i) => v !== b.pixels[i])).toBe(true);
  });

  it("grisés activables (écrans) : le bouton s'enfonce, agit, et son nom dit « (non disponible) »", () => {
    const m = new ItfWindow(assets, readItf(index.get("PUZZSOLV.ITF")), { title: "", state: { disabled: [17003] }, greyedActive: true });
    expect(m.pointerDown(390, 230)).toBe(true);
    expect(m.pointerUp(390, 230)).toBe(17003);
    expect(m.canActivate(17003)).toBe(true);
    const next = m.controls().find((c) => c.key === "b17003")!;
    expect(next).toMatchObject({ kind: "button", name: "Puzzle Suivant (non disponible)", disabled: false, unavailable: true });
    expect(solved().controls().find((c) => c.key === "b17003")).toMatchObject({ name: "Puzzle Suivant", disabled: true, unavailable: false });
  });

  it("bouton actif : celui de la dernière action, survol de la souris ou focus du clavier", () => {
    const m = generic();
    m.focus(65002);
    expect(m.active()).toBe(65002);
    m.pointerMove(230, 300);
    expect(m.active()).toBe(65001);
    // Hors des boutons, la souris ne rend pas la main au focus : rien n'est actif.
    m.pointerMove(5, 5);
    expect(m.active()).toBeNull();
    m.focus(65002);
    expect(m.active()).toBe(65002);
    m.pointerMove(230, 300);
    m.pointerLeave();
    expect(m.active()).toBe(65002);
  });

  it("horloge de l'hôte : une passe des contrôles toutes les 50 ms ; les choix en attente sortent avec elle", () => {
    let passes = 0;
    const m = new ItfWindow(assets, readItf(index.get("GENERIC.ITF")), { title: "", tick: () => (passes++, false) });
    m.tick(0);
    m.tick(16);
    m.tick(ITF_TICK_MS - 1);
    expect(passes).toBe(1);
    m.queue(65001);
    m.queue(65001);
    expect(m.tick(ITF_TICK_MS).fire).toEqual([65001]);
    expect(passes).toBe(2);
    expect(m.drain()).toEqual([]);
  });
});
