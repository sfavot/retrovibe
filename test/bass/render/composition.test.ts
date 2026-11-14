import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { hasOriginalFiles } from "../engine/helpers";
import { RenderedGame, fixturePath, readReferenceFrame } from "./harness";

const json = <T>(name: string): T => JSON.parse(readFileSync(fixturePath(name), "utf8")) as T;

/**
 * Comparaison au banc ScummVM (`bench/scenarios/b-idle*.txt`, patch `SKY_SHOT_CYCLES` / `SKY_EXEC` / `SKY_STEP_SHOTS`) : le portage tourne
 * depuis le départ après l'introduction (`startAfterIntro`, graine 1, aucune entrée) et chaque image composée est comparée à la capture de
 * ScummVM prise une fois le même tour terminé : 263 captures (tours 1 à 40 un par un, puis un tour sur cinq jusqu'au tour 1 155),
 * indices et palette de la machine identiques.
 */
describe.skipIf(!hasOriginalFiles)("image composée comparée au banc ScummVM (première pièce, sans entrée)", () => {
  it("263 captures de tours entre 1 et 1 155 : empreintes identiques (indices + 240 couleurs)", () => {
    const expected = json<Record<string, string>>("idle-cycles.json");
    const game = new RenderedGame();
    const wrong: string[] = [];
    for (const [cycle, hash] of Object.entries(expected)) {
      game.runTo(Number(cycle));
      if (game.hash() !== hash) wrong.push(cycle);
    }
    expect(Object.keys(expected)).toHaveLength(263);
    expect(wrong).toEqual([]);
    expect(game.engine.journal).toEqual([]);
  });

  it.each(["cy-0001", "cy-0300", "cy-1150"])("%s : pixel par pixel", (name) => {
    const game = new RenderedGame();
    game.runTo(Number(name.slice(3)));
    const ref = readReferenceFrame(name);
    let different = 0;
    for (let i = 0; i < 64000; i++) if (ref.pixels[i] !== game.renderer.frame.pixels[i]) different++;
    expect(different).toBe(0);
    expect(game.renderer.frame.palette.subarray(0, 720)).toEqual(ref.palette.subarray(0, 720));
    // Le curseur de la souris n'est pas dans l'écran (ScummVM le dessine par CursorMan) : l'écran du banc non plus.
  });

  it("les images ne sont pas toutes identiques (Foster, Joey et les décors animés bougent)", () => {
    const hashes = new Set(Object.values(json<Record<string, string>>("idle-cycles.json")));
    expect(hashes.size).toBeGreaterThan(100);
  });
});

/**
 * Effets déclenchés par `Logic::fnExec` au début d'un tour (`SKY_EXEC`) : une image par tick de 20 ms comme les captures `st-TTTT-KKK` de
 * ScummVM (une par pas présenté). Les pas d'un défilement ne sont pas comparés (voir `docs/bass/graphics.md` : le ScummVM du banc affiche
 * directement le nouveau décor), seulement l'image finale.
 */
describe.skipIf(!hasOriginalFiles)("fondus et défilements comparés au banc ScummVM", () => {
  const expected = json<Record<string, string>>("effects.json");
  const PAL = 4316; // palette de l'écran 0

  it("fnDrawScreen (fondu 0) : 64 images (32 pas au noir, 32 pas en entrée) identiques", () => {
    const game = new RenderedGame();
    game.runTo(19);
    expect(game.hash()).toBe(expected["cy-19"]);
    const hashes = game.execAtCycle(20, "fn_draw_screen", PAL, 0);
    for (const k of [1, 16, 32, 33, 48, 64]) expect(hashes[k - 1], `pas ${k}`).toBe(expected[`20-${k}`]);
    const all = Object.keys(expected).filter((key) => key.startsWith("20-"));
    expect(all).toHaveLength(64);
    for (const key of all) expect(hashes[Number(key.slice(3)) - 1], key).toBe(expected[key]);
    game.runTo(21);
    expect(game.hash()).toBe(expected["cy-21"]);
  });

  it("fnFadeDown puis fnFadeUp : 32 pas chacun, identiques", () => {
    const game = new RenderedGame();
    game.runTo(199);
    expect(game.hash()).toBe(expected["cy-199"]);
    const down = game.execAtCycle(200, "fn_fade_down", 0, 0);
    for (let k = 1; k <= 32; k++) expect(down[k - 1], `fondu au noir, pas ${k}`).toBe(expected[`200-${k}`]);
    game.runTo(209);
    expect(game.hash()).toBe(expected["cy-209"]);
    const up = game.execAtCycle(210, "fn_fade_up", PAL, 0);
    for (let k = 1; k <= 32; k++) expect(up[k - 1], `fondu en entrée, pas ${k}`).toBe(expected[`210-${k}`]);
    game.runTo(229);
    expect(game.hash()).toBe(expected["cy-229"]);
  });

  it("fnDrawScreen avec défilement (123 puis 321) : image finale identique, 19 pas puis l'image finale", () => {
    const game = new RenderedGame();
    game.runTo(79);
    const right = game.execAtCycle(80, "fn_draw_screen", PAL, 123);
    expect(right).toHaveLength(20);
    expect(right[19]).toBe(expected["80-20"]);
    expect(new Set(right.slice(0, 19)).size).toBe(19); // un décalage de 16 pixels de plus à chaque pas
    game.runTo(139);
    const left = game.execAtCycle(140, "fn_draw_screen", PAL, 321);
    expect(left).toHaveLength(20);
    expect(left[19]).toBe(expected["140-20"]);
    game.runTo(141);
    expect(game.hash()).toBe(expected["cy-141"]);
  });

  it("fnBlankScreen : écran noir, palette gardée", () => {
    const game = new RenderedGame();
    game.runTo(229);
    game.execAtCycle(230, "fn_blank_screen", 0, 0);
    game.runTo(231);
    expect(game.hash()).toBe(expected["cy-231"]);
  });
});
