/**
 * Image par image contre le banc ScummVM (`cruise-bench`, `cruise-replay.sh scenarios/first-room.in DIR 4000 1`) : graine 1, temps
 * virtuel, contournement de la protection, aucune entrée. Fixture : lignes `SC n crc pal` (CRC32 de `globalScreen` et de la palette
 * envoyée à l'écran, à la fin de chaque tour), `fixtures/bench-first-room-sc.txt.gz`.
 *
 * Menu d'objet : le banc clique sur l'étagère au tour 3602 (`1 0 0 0 / 3600 60 60 0 / 3602 60 60 1 / 3604 60 60 0`, puis la souris
 * en (70, 82) au tour 3610) ; captures `fr-3606.idx` (menu « Livre », « Examiner » non survolé) et `fr-3615.idx` (survolé), dans
 * `fixtures/bench-menu-livre.idx.gz`. L'interface n'étant pas encore portée, le menu est posé à la main sur la pièce, inchangée.
 *
 * `CROISIERE_SCREEN_FRAMES` règle le dernier tour comparé ; `CROISIERE_SCREEN_DUMP=dossier` écrit, au premier écart, `fr-NNNN.idx` et
 * `fr-NNNN.pal` (même format que `CRUISE_SHOT_DIR` du banc) pour comparer avec les captures du banc.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { crc32, gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { TestHost } from "../../../src/games/croisiere/engine/host";
import { CroisiereEngine } from "../../../src/games/croisiere/engine/main-loop";
import { drawScreen, renderText, SYSTEM_FONT_FILE, type MenuView } from "../../../src/games/croisiere/render/draw";
import { gameFiles, hasOriginalFiles, original } from "../engine/support";

/** Dernier tour comparé : toute la fixture (l'image reste identique après la divergence de la trace logique au tour 2225). */
const EXPECTED_MATCH = Number(process.env.CROISIERE_SCREEN_FRAMES ?? 4000);

function benchScreens(): Map<number, string> {
  const text = gunzipSync(readFileSync(resolve(import.meta.dirname, "fixtures", "bench-first-room-sc.txt.gz"))).toString("latin1");
  const out = new Map<number, string>();
  for (const line of text.split("\n")) {
    const [tag, n, screen, pal] = line.split(" ");
    if (tag === "SC") out.set(Number(n), `${screen} ${pal}`);
  }
  return out;
}

const hex = (value: number) => (value >>> 0).toString(16).padStart(8, "0");

/** Volumes du jeu et `SYSTEM.FNT`, fichier libre lu par `loadFNT`. */
function filesWithSystemFont() {
  const volumes = gameFiles();
  const font = new Uint8Array(original.read(SYSTEM_FONT_FILE));
  return {
    has: (name: string) => name === SYSTEM_FONT_FILE || volumes.has(name),
    readFile: (name: string) => (name === SYSTEM_FONT_FILE ? font : volumes.readFile(name)),
  };
}

describe.skipIf(!hasOriginalFiles)("écran du banc (intro)", () => {
  it(`est identique au banc, image et palette, jusqu'au tour ${EXPECTED_MATCH}`, () => {
    const bench = benchScreens();
    const engine = new CroisiereEngine(new TestHost(), { files: filesWithSystemFont(), seed: 1 });
    const d = engine.state.display;
    for (let n = 1; n <= EXPECTED_MATCH; n++) {
      if (n === 1) engine.applyInputLevel(0, 0, 0);
      engine.runFrame();
      const actual = `${hex(crc32(d.globalScreen))} ${hex(crc32(d.hardwarePalette))}`;
      const expected = bench.get(n);
      if (actual !== expected) {
        const dir = process.env.CROISIERE_SCREEN_DUMP;
        if (dir) {
          mkdirSync(dir, { recursive: true });
          const base = resolve(dir, `fr-${String(n).padStart(4, "0")}`);
          writeFileSync(`${base}.idx`, d.globalScreen);
          writeFileSync(`${base}.pal`, d.hardwarePalette);
        }
        expect.fail(`Tour ${n} : banc ${expected}, port ${actual}`);
      }
    }
    expect(engine.frameNumber).toBe(EXPECTED_MATCH);
  });

  it("dessine un menu d'objet comme le banc (titre, entrée normale puis survolée)", () => {
    const shots = gunzipSync(readFileSync(resolve(import.meta.dirname, "fixtures", "bench-menu-livre.idx.gz")));
    const engine = new CroisiereEngine(new TestHost(), { files: filesWithSystemFont(), seed: 1 });
    const e = engine.state;
    engine.applyInputLevel(0, 0, 0);
    for (let n = 1; n <= 3605; n++) engine.runFrame();
    expect(hex(crc32(e.display.globalScreen))).toBe("95bdeceb");

    // createMenu(60, 60, "Livre") puis addSelectableMenuEntry(..., -1, "Examiner")
    const item = { x: 0, y: 0, selected: false, color: -1, gfx: renderText(e, 160, "Examiner") };
    const menu: MenuView = { x: 60 - 80, y: 60, gfx: renderText(e, 160, "Livre"), elements: [item] };
    (e.menuTable as unknown as (MenuView | null)[])[0] = menu;
    e.currentActiveMenu = 0;
    for (const [selected, at] of [[false, 0], [true, 64000]] as const) {
      item.selected = selected;
      drawScreen(e);
      expect(hex(crc32(e.display.page10))).toBe(hex(crc32(shots.subarray(at, at + 64000))));
    }
    expect({ x: item.x, y: item.y }).toEqual({ x: 0, y: 75 });
  });
});
