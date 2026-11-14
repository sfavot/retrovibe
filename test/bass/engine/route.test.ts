import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { CompactField as F, MegaSetField, megaSetBase } from "../../../src/games/bass/data/compact-fields";
import { setGridBlocked } from "../../../src/games/bass/data/grid-file";
import { Compacts } from "../../../src/games/bass/engine/compacts";
import { Cpt } from "../../../src/games/bass/engine/ids";
import { AutoRoute } from "../../../src/games/bass/engine/route/autoroute";
import { Grid } from "../../../src/games/bass/engine/route/grid";
import { createScriptVars } from "../../../src/games/bass/engine/vars";
import { skyCpt, skyDisk } from "../data/helpers";
import { buildScript, routeInfo, runScript } from "./route-cases";
import { hasOriginalFiles } from "./helpers";

/**
 * Marche : `Grid` et `AutoRoute` comparés au vrai `grid.o` / `autoroute.o` de ScummVM (harnais `bench/sky-route/`, hors dépôt). Le scénario
 * (`route-cases.ts`, déterministe) joue des milliers de routes (écran, largeur de grille, départ et arrivée, dont hors écran) entre des
 * modifications de grille, sur les vraies grilles du jeu ; `fixtures/route-scummvm.json` garde la sortie de ScummVM (routes : code et mots du
 * tampon ; grilles : empreinte FNV-1a).
 */
interface Fixture {
  info: ReturnType<typeof routeInfo>;
  commands: number;
  outputs: number;
  log: string;
}

function setup(): { grid: Grid; router: AutoRoute; compacts: Compacts; vars: Uint32Array } {
  const compacts = new Compacts(skyCpt());
  const vars = createScriptVars();
  const disk = skyDisk();
  const grid = new Grid({ disk: { has: (id) => disk.has(id), load: (id) => disk.load(id) }, vars, compacts });
  return { grid, router: new AutoRoute(grid, compacts), compacts, vars };
}

describe.skipIf(!hasOriginalFiles)("marche comparée à ScummVM (grilles et autoroute)", () => {
  const fixture = JSON.parse(readFileSync(new URL("./fixtures/route-scummvm.json", import.meta.url), "utf8")) as Fixture;
  const expected = gunzipSync(Buffer.from(fixture.log, "base64")).toString().split("\n");

  it("le scénario est celui du banc (paramètres tirés des vrais compacts)", () => {
    const { compacts } = setup();
    expect(routeInfo(compacts, fixture.info.routesPerScreen)).toEqual(fixture.info);
    expect(buildScript(fixture.info)).toHaveLength(fixture.commands);
    expect(expected).toHaveLength(fixture.outputs);
  });

  it("toutes les routes et toutes les empreintes de grille sont celles de ScummVM", () => {
    const { grid, router, compacts, vars } = setup();
    const actual = runScript(buildScript(fixture.info), grid, router, compacts, vars);
    expect(actual).toHaveLength(expected.length);
    const at = expected.findIndex((line, i) => line !== actual[i]);
    expect(at === -1 ? "aucune" : `sortie ${at} : ${expected[at]} / ${actual[at]}`).toBe("aucune");
    const routes = expected.filter((l) => l.startsWith("R"));
    expect(routes.length).toBeGreaterThan(5000);
    // le scénario couvre bien les trois codes de retour et des routes longues
    for (const code of ["R 0 ", "R 1 ", "R 2 "]) expect(routes.filter((l) => l.startsWith(code)).length).toBeGreaterThan(50);
    // les escaliers : 7 routes que le tampon de ScummVM ne peut pas contenir (le portage les refuse), d'autres de 14 et 15 segments
    expect(routes.filter((l) => l === "R !").length).toBeGreaterThanOrEqual(5);
    expect(Math.max(...routes.map((l) => l.length))).toBeGreaterThan(4 + 4 * 16);
  });

  it("route trop longue pour le tampon de 64 octets : refusée (code 1) au lieu du débordement de ScummVM", () => {
    const { grid, router, compacts } = setup();
    grid.loadGrids();
    const foster = compacts.require(Cpt.FOSTER);
    // Grille sans décor, sauf un escalier d'un bloc de large de (0, 0) à (22, 22), tout le reste est plein : la route compte 44 segments
    // (la bordure de la grille de travail, libre, ne rejoint pas l'arrivée).
    const data = grid.giveGrid(0)!;
    data.fill(0);
    for (let row = 0; row < 24; row++) {
      for (let col = 0; col < 40; col++) if (col !== row && col !== row + 1) setGridBlocked(data, col, row, true);
    }
    foster[F.screen] = 0;
    foster[F.xcood] = 128;
    foster[F.ycood] = 136;
    foster[F.arTargetX] = 128 + 8 * 22;
    foster[F.arTargetY] = 136 + 8 * 22;
    foster[F.megaSet] = 0;
    foster[megaSetBase(0) + MegaSetField.gridWidth] = 0;
    expect(router.autoRoute(foster)).toBe(1);
    expect(router.overflowed).toBe(true);
    expect(compacts.require(foster[F.animScratchId]!).subarray(0, 32).every((w) => w === 0)).toBe(true);
    // Six marches : 12 segments, la route tient.
    foster[F.arTargetX] = 128 + 8 * 6;
    foster[F.arTargetY] = 136 + 8 * 6;
    expect(router.autoRoute(foster)).toBe(0);
    expect(router.overflowed).toBe(false);
  });
});
