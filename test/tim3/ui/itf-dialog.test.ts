import { describe, expect, it } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { RenderAssets, Surface } from "../../../src/games/tim3/render";
import { ItfDialogModel } from "../../../src/games/tim3/ui/itf-dialog";
import { frenchIndex, original } from "../data/real";

describe.skipIf(!original.has)("fenêtre ITF sans DOM (ItfDialogModel)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const generic = () => new ItfDialogModel(assets, readItf(index.get("GENERIC.ITF")), { state: { texts: { 65004: "Sûr ?" } }, cancelId: 65002 });
  const solved = () => new ItfDialogModel(assets, readItf(index.get("PUZZSOLV.ITF")), { state: { disabled: [17003] } });

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
});
