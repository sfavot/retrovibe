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

  it("bouton de genre 2 (44ee50, appelé à chaque passe) : images 1 … n − 1 en boucle sous le pointeur, image 0 en partant ; il agit dès l'appui", () => {
    const m = new ItfWindow(assets, readItf(index.get("LOADSAVE.ITF")), { title: "" });
    const id = 14007;
    const item = m.item(id)!;
    expect(item.kind).toBe(2);
    const n = item.frameCount!;
    expect(n).toBeGreaterThan(2);
    const frame = () => m.state().frames?.[id];
    m.pointerMove(item.x + 3, item.y + 3);
    const seen: (number | undefined)[] = [];
    for (let i = 0; i < n; i++) {
      m.pass();
      seen.push(frame());
    }
    // La première passe montre l'image 1 ; après n − 1, retour à 1 (l'image 0 n'est que celle du repos).
    expect(seen).toEqual([...Array.from({ length: n - 1 }, (_, i) => i + 1), 1]);
    m.pointerMove(5, 5);
    expect(m.pass().redraw).toBe(true);
    expect(frame()).toBeUndefined();
    expect(m.pass().redraw).toBe(false);
    // Appui : choisi tout de suite (sans attendre le relâché), sans état enfoncé.
    expect(m.pointerDown(item.x + 3, item.y + 3)).toBe(false);
    expect(m.state().pressed).toBeNull();
    expect(m.drain()).toEqual([id]);
    expect(m.pointerUp(item.x + 3, item.y + 3)).toBeNull();
  });

  it("bouton de genre 2 : les sons des images atteintes passent par takeSounds (avec priorité et drapeaux)", () => {
    const index2 = frenchIndex();
    const m = new ItfWindow(new RenderAssets(index2), readItf(index2.get("MAINMENU.ITF")), { title: "" });
    const item = m.item(16011)!;
    m.pointerMove(item.x + 3, item.y + 3);
    const sounds = [];
    for (let i = 0; i < item.frameCount! * 2; i++) {
      m.pass();
      sounds.push(...m.takeSounds());
    }
    expect(sounds.length).toBeGreaterThan(0);
    for (const s of sounds) expect(s).toMatchObject({ id: expect.any(Number), priority: expect.any(Number), flags: expect.any(Number) });
  });
});
