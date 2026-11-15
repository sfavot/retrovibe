import { describe, expect, it } from "vitest";
import { readItf } from "../../../src/games/tim3/data/itf";
import { parseLines } from "../../../src/games/tim3/data/text";
import { RenderAssets, Surface } from "../../../src/games/tim3/render";
import { CREDITS_SCROLL, INTRO_FRAME_MS, LOGO, TITLE, creditsStep, drawCredits, frameSounds, screenLut } from "../../../src/games/tim3/render/front";
import { imageCount, stateStart } from "../../../src/games/tim3/render/anm-draw";
import { CREDITS, CREDITS_FONT, CREDITS_TICK_MS, CreditsScreen } from "../../../src/games/tim3/ui/credits";
import { IntroPlayer } from "../../../src/games/tim3/ui/intro";
import { ItfWindow } from "../../../src/games/tim3/ui/itf-window";
import { frenchIndex, original } from "../data/real";

describe("crédits : défilement (41a0a5)", () => {
  it("premier tour sans pas, puis (ms × 38) / 1000 entre 1 et 8", () => {
    expect(creditsStep(null)).toBe(0);
    expect(creditsStep(0)).toBe(1);
    expect(creditsStep(48)).toBe(1);
    expect(creditsStep(100)).toBe(3);
    expect(creditsStep(1000)).toBe(8);
    expect(CREDITS_SCROLL.start).toBe(40);
  });
});

describe.skipIf(!original.has)("intro sur les données d'origine (42a3c2, 42a590)", () => {
  const index = frenchIndex();
  const assets = new RenderAssets(index);
  const JINGLE = 13_000;

  const make = () => {
    const log: string[] = [];
    const player = new IntroPlayer(
      assets,
      index,
      { effect: (s) => log.push(`fx ${s.id}`), stopEffect: (id) => log.push(`stop ${id}`), music: (id) => log.push(`music ${id}`) },
      JINGLE,
    );
    return { player, log };
  };
  const logoImages = imageCount(assets.anm(LOGO.anm)!);
  const titleImages = imageCount(assets.anm(TITLE.anm)!);
  /** Fin du logo : 32 ms, l'air, puis une image toutes les 48 ms (images 1 à n − 1) et un dernier tour. */
  const logoEnd = 32 + JINGLE + INTRO_FRAME_MS * (logoImages - 1);

  it("logo : l'air de Sierra d'abord, image fixe tant qu'il joue", () => {
    const { player, log } = make();
    player.update(0);
    expect(log).toEqual([`fx ${LOGO.jingle}`]);
    const still = player.surface.pixels.slice();
    player.update(32 + JINGLE - 1);
    expect(player.surface.pixels).toEqual(still);
    player.update(32 + JINGLE + INTRO_FRAME_MS * 30);
    expect(player.surface.pixels).not.toEqual(still);
    expect(player.phase).toBe("logo");
  });

  it("palettes : SIERRA.PAL, puis TTLDARK.PAL au titre et TTLLITE.PAL à l'image de l'état 5", () => {
    const { player } = make();
    player.update(0);
    expect(player.lut).toEqual(screenLut(index, LOGO.palette));
    player.update(logoEnd);
    expect(player.phase).toBe("title");
    expect(player.lut).toEqual(screenLut(index, TITLE.dark));
    const anm = assets.anm(TITLE.anm)!;
    let lite = -1;
    for (let i = 1; i < titleImages && lite < 0; i++) if (stateStart(anm, i) === TITLE.liteState) lite = i;
    expect(lite).toBeGreaterThan(0);
    const titleStart = logoEnd + INTRO_FRAME_MS + 2 * INTRO_FRAME_MS;
    player.update(titleStart + INTRO_FRAME_MS * (lite - 2));
    expect(player.lut).toEqual(screenLut(index, TITLE.dark));
    player.update(titleStart + INTRO_FRAME_MS * (lite - 1));
    expect(player.lut).toEqual(screenLut(index, TITLE.lite));
  });

  it("enchaînement complet : air coupé, musique 1000, fin 60 tours après la dernière image du titre", () => {
    const { player, log } = make();
    player.update(0);
    player.update(logoEnd);
    expect(log).toContain(`stop ${LOGO.jingle}`);
    expect(log).toContain(`music ${TITLE.music}`);
    const titleStart = logoEnd + INTRO_FRAME_MS + 2 * INTRO_FRAME_MS;
    const last = titleStart + INTRO_FRAME_MS * (titleImages - 2);
    player.update(last + INTRO_FRAME_MS * (TITLE.hold - 1));
    expect(player.phase).toBe("title");
    player.update(last + INTRO_FRAME_MS * TITLE.hold);
    expect(player.phase).toBe("done");
    expect(player.skipped).toBe(false);
  });

  it("les sons des images sont joués à leur dessin (pas des pas du logo : 3454)", () => {
    const { player, log } = make();
    for (let t = 0; t <= logoEnd; t += 16) player.update(t);
    const steps = frameSounds(assets.anm(LOGO.anm)!, 5);
    expect(steps.map((s) => s.id)).toEqual([3454]);
    expect(log.filter((l) => l === "fx 3454").length).toBeGreaterThan(3);
  });

  it("un clic ou une touche passe tout : fin immédiate, air coupé, pas de crédits", () => {
    const { player, log } = make();
    player.update(0);
    player.skip();
    expect(player.update(10)).toBe("done");
    expect(player.skipped).toBe(true);
    expect(log).toContain(`stop ${LOGO.jingle}`);
  });

  it("crédits : lignes de CREDITS.RES, fermeture d'elles-mêmes une fois toutes passées ; Échap et Terminé ferment", () => {
    const lines = parseLines(index.get("CREDITS.RES"));
    const screen = new CreditsScreen(assets, readItf(index.get("CREDITS.ITF")), lines, "Crédits");
    const m = new ItfWindow(assets, screen.itf, screen.options);
    expect(m.escape()).toBe(CREDITS.done);
    expect(screen.action(CREDITS.done)).toBe("done");
    expect(screen.options.defaultId).toBe(CREDITS.done);
    expect(m.texts()[0]).toContain("Producteur. Jeff Tunnell");
    const s = new Surface(640, 480);
    m.render(s);
    expect(m.drain()).toEqual([]);
    // Un tour toutes les 48 ms : les mains changent d'image.
    const hands = new Surface(640, 480);
    const c = m.rect(CREDITS.hands)!;
    const handPixels = (surface: Surface) => Array.from({ length: c.height }, (_, y) => Array.from(surface.pixels.subarray((c.y + y) * 640 + c.x, (c.y + y) * 640 + c.x + c.width)));
    let moved = false;
    for (let t = 0; t < CREDITS_TICK_MS * 5 && !moved; t += CREDITS_TICK_MS) {
      expect(m.tick(t).redraw).toBe(true);
      expect(m.tick(t + 10).redraw).toBe(false);
      m.render(hands);
      moved = JSON.stringify(handPixels(hands)) !== JSON.stringify(handPixels(s));
    }
    expect(moved).toBe(true);
    screen.scroll = 20_000;
    m.render(s);
    expect(m.drain()).toEqual([CREDITS.done]);
  });

  it("crédits : rendu des titres soulignés et fondu vers le fond en bas", () => {
    const font = assets.font(CREDITS_FONT)!;
    const rect = { x: 10, y: 10, width: 200, height: 140 };
    const s = new Surface(640, 480);
    expect(drawCredits(s, font, ["_Producteur", "Jeff Tunnell"], rect, 60)).toBe(true);
    // Rien hors de la fenêtre.
    expect(s.pixels.slice(0, 640 * 10).every((v) => v === 0)).toBe(true);
    expect(drawCredits(new Surface(640, 480), font, ["a"], rect, 1000)).toBe(false);
  });
});
