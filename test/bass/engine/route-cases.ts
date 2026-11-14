import { CompactField as F, MegaSetField, NEXT_MEGA_SET, megaSetBase } from "../../../src/games/bass/data/compact-fields";
import { GRID_CONVERT_TABLE, TOT_NO_GRIDS } from "../../../src/games/bass/data/grid-file";
import type { Compacts } from "../../../src/games/bass/engine/compacts";
import { Cpt, Var } from "../../../src/games/bass/engine/ids";
import { AutoRoute } from "../../../src/games/bass/engine/route/autoroute";
import { Grid } from "../../../src/games/bass/engine/route/grid";

/**
 * Scénario de la preuve de la marche (vague E) : suite de commandes jouée à l'identique par le harnais du banc
 * (`bench/sky-route/harness.cpp`, vrais `autoroute.o` et `grid.o` de ScummVM) et par `Grid` + `AutoRoute` du portage. Le format des commandes
 * et des lignes de sortie est décrit en tête de `harness.cpp`. Le scénario est déterministe (graine fixe) : le régénérer ne change rien.
 */

/** Écrans qui ont une grille (`_gridConvertTable`). */
export function screensWithGrid(): number[] {
  const screens: number[] = [];
  GRID_CONVERT_TABLE.forEach((grid, screen) => {
    if (grid >= 0 && grid < TOT_NO_GRIDS) screens.push(screen);
  });
  return screens;
}

/** Générateur congruentiel (mulberry32). */
function rng(seed: number): (n: number) => number {
  let a = seed >>> 0;
  return (n) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % n) | 0;
  };
}

export interface RouteScenarioInfo {
  /** `animScratchId` de Foster et de Joey. */
  scratch: [number, number];
  /** Largeurs de grille (`gridWidth`) réelles des compacts. */
  widths: number[];
  routesPerScreen: number;
}

/** Paramètres du scénario tirés des vrais compacts : tampons de route de Foster et de Joey, largeurs de grille de leurs `MegaSet`. */
export function routeInfo(compacts: Compacts, routesPerScreen = 150): RouteScenarioInfo {
  const foster = compacts.require(Cpt.FOSTER);
  const joey = compacts.require(Cpt.JOEY);
  const widths = new Set<number>();
  for (const cpt of [foster, joey]) {
    for (let m = 0; m < 4; m++) {
      const w = cpt[megaSetBase(m) + MegaSetField.gridWidth]!;
      if (w) widths.add(w);
    }
  }
  return { scratch: [foster[F.animScratchId]!, joey[F.animScratchId]!], widths: [...widths].sort((x, y) => x - y), routesPerScreen };
}

const EDGE_X = [0, 100, 127, 128, 129, 135, 440, 447, 448, 449, 500, 65088, 65535];
const EDGE_Y = [0, 100, 135, 136, 137, 143, 327, 328, 329, 400, 65535];

/** Lignes du scénario. */
export function buildScript(info: RouteScenarioInfo): string[] {
  const rnd = rng(0x5ea17);
  const pick = <T>(list: readonly T[]): T => list[rnd(list.length)]!;
  const widths = [0, 1, 2, 3, 4, 5, 6, 8, 12, 255, 259, ...info.widths];
  const lines: string[] = [`scratch ${info.scratch[0]} ${info.scratch[1]}`, "reich 12", "var 0", "load"];
  const onX = (): number => 128 + rnd(320);
  const onY = (): number => 136 + rnd(192);
  const point = (): [number, number] => {
    const k = rnd(100);
    if (k < 70) return [onX(), onY()];
    if (k < 80) return [pick(EDGE_X), onY()];
    if (k < 88) return [onX(), pick(EDGE_Y)];
    if (k < 95) return [pick(EDGE_X), pick(EDGE_Y)];
    return [rnd(65536), rnd(65536)];
  };
  const route = (who: number, screen: number, gridWidth: number, megaSet: number, from: [number, number], to: [number, number]): void => {
    lines.push(`route ${who} ${screen} ${gridWidth} ${megaSet} ${from[0]} ${from[1]} ${to[0]} ${to[1]}`);
  };
  for (const screen of screensWithGrid()) {
    lines.push(`dump ${screen}`);
    for (let i = 0; i < info.routesPerScreen; i++) {
      const megaSet = rnd(10) < 7 ? 0 : 1 + rnd(3);
      const gridWidth = widths[i % widths.length]!;
      const from = point();
      // une route sur 25 : arrivée dans le bloc de départ ou voisine (code « déjà sur place »)
      const to: [number, number] = i % 25 === 7 ? [from[0] + rnd(9) - 4, from[1] + rnd(9) - 4] : point();
      route(i & 1, screen, gridWidth, megaSet, from, to);
      if (i % 12 === 11) {
        // l'empreinte d'un objet, posée puis retirée (les compacts qui marchent, les portes) : routes sur la grille modifiée
        const x = rnd(10) < 8 ? onX() : pick(EDGE_X);
        const y = rnd(10) < 8 ? onY() : pick(EDGE_Y);
        const op = rnd(4);
        const w = pick([0, 1, 2, 3, 5, 12, 40, 60]);
        if (op === 0) lines.push(`plot ${x} ${y} ${w} ${screen}`);
        else if (op === 1) lines.push(`rem ${x} ${y} ${w} ${screen}`);
        else lines.push(`obj ${op === 2 ? 1 : 0} ${screen} ${w} ${x} ${y}`);
        lines.push(`dump ${screen}`);
      }
    }
    // Foster et Joey qui marchent l'un vers l'autre : Joey pose son empreinte, Foster vise un bloc voisin.
    for (let i = 0; i < 6; i++) {
      const joey: [number, number] = [onX(), onY()];
      lines.push(`obj 1 ${screen} ${pick([1, 2, 3])} ${joey[0]} ${joey[1]}`);
      route(1, screen, pick(info.widths), 0, point(), [joey[0] + pick([-8, 0, 8]), joey[1] + pick([-8, 0, 8])]);
      lines.push(`obj 0 ${screen} ${pick([1, 2, 3])} ${joey[0]} ${joey[1]}`);
    }
    lines.push(`dump ${screen}`);
  }
  // Rustine du bogue 1804 : Foster sur l'écran 12 vise le bloc (2, 14), que Joey bloque ou non.
  for (let i = 0; i < 40; i++) {
    const target: [number, number] = [144 + rnd(8), 248 + rnd(8)];
    const joey = rnd(3);
    if (joey === 1) lines.push("plot 144 248 1 12");
    else if (joey === 2) lines.push(`obj 1 12 ${1 + rnd(3)} ${144 - 8 * rnd(3)} 248`);
    route(rnd(4) ? 1 : 0, 12, pick(info.widths), 0, point(), target);
    lines.push("dump 12");
    lines.push("load");
  }
  // Escalier d'un bloc de large sur l'écran 0 (le reste est plein) : une route de 2 segments par marche, pour le tampon de 64 octets
  // (15 segments au plus ; 16 avec le départ hors écran déborde dans ScummVM, voir `R !`).
  lines.push("load");
  for (let row = 0; row < 24; row++) {
    const y = 136 + 8 * row;
    if (row > 0) lines.push(`plot 128 ${y} ${row} 0`);
    if (row < 38) lines.push(`plot ${128 + 8 * (row + 2)} ${y} ${38 - row} 0`);
  }
  for (const steps of [1, 2, 6, 7, 8, 9, 22]) {
    for (const startX of [128, 100, 127, 140]) {
      route(1, 0, 0, 0, [startX, 136], [128 + 8 * steps, 136 + 8 * steps]);
      route(0, 0, 0, 0, [128 + 8 * steps, 136 + 8 * steps], [startX, 136]);
    }
  }
  // Porte du Reich : `loadGrids` retire un bloc de la grille de l'écran du compact `REICH_DOOR_20` quand elle est ouverte.
  for (const screen of [12, 0, 31, 65, 91]) {
    lines.push(`reich ${screen}`, "var 1", "load", `dump ${screen}`, "var 0", "load", `dump ${screen}`);
  }
  return lines;
}

/** `FNV-1a` 32 bits d'une grille. */
function fnv(bytes: Uint8Array): string {
  let h = 2166136261;
  for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** Joue le scénario sur `Grid` et `AutoRoute` ; une ligne par route et par `dump`, comme le harnais. */
export function runScript(script: readonly string[], grid: Grid, router: AutoRoute, compacts: Compacts, vars: Uint32Array): string[] {
  const out: string[] = [];
  const foster = compacts.require(Cpt.FOSTER);
  const joey = compacts.require(Cpt.JOEY);
  const reich = compacts.require(Cpt.REICH_DOOR_20);
  for (const line of script) {
    const [cmd, ...rest] = line.split(" ");
    const a = rest.map(Number);
    switch (cmd) {
      case "scratch":
        foster[F.animScratchId] = a[0]!;
        joey[F.animScratchId] = a[1]!;
        break;
      case "reich":
        reich[F.screen] = a[0]!;
        break;
      case "var":
        vars[Var.REICH_DOOR_FLAG] = a[0]!;
        break;
      case "load":
        grid.loadGrids();
        break;
      case "route": {
        const cpt = a[0] ? foster : joey;
        cpt[F.screen] = a[1]!;
        cpt[F.megaSet] = a[3]! * NEXT_MEGA_SET;
        cpt[megaSetBase(a[3]!) + MegaSetField.gridWidth] = a[2]!;
        cpt[F.xcood] = a[4]!;
        cpt[F.ycood] = a[5]!;
        cpt[F.arTargetX] = a[6]!;
        cpt[F.arTargetY] = a[7]!;
        const code = router.autoRoute(cpt);
        if (router.overflowed) {
          out.push("R !");
          break;
        }
        const words = Array.from(compacts.require(cpt[F.animScratchId]!).subarray(0, 32));
        while (words.length && !words[words.length - 1]) words.pop();
        out.push(`R ${code} ${words.map((w) => w.toString(16).padStart(4, "0")).join("")}`);
        break;
      }
      case "plot":
        foster[F.screen] = a[3]!;
        grid.plotGrid(a[0]!, a[1]!, a[2]!, foster);
        break;
      case "rem":
        foster[F.screen] = a[3]!;
        grid.removeGrid(a[0]!, a[1]!, a[2]!, foster);
        break;
      case "obj":
        joey[F.screen] = a[1]!;
        joey[F.megaSet] = 0;
        joey[megaSetBase(0) + MegaSetField.gridWidth] = a[2]!;
        joey[F.xcood] = a[3]!;
        joey[F.ycood] = a[4]!;
        if (a[0]) grid.objectToWalk(joey);
        else grid.removeObjectFromWalk(joey);
        break;
      case "dump":
        out.push(`D ${fnv(grid.giveGrid(a[0]!)!)}`);
        break;
      default:
        throw new Error(`commande inconnue : ${line}`);
    }
  }
  return out;
}
