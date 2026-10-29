import { describe, expect, it } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { parseRegs } from "../../../src/games/zoombinis/data/regs";
import {
  FAIRY_GAUGE,
  FROG_MAX_ALIVE,
  TATTOOS,
  TOAD_COUNT,
  arrive,
  attrOf,
  canDrop,
  canExchange,
  canLeave,
  cellIndex,
  computeFrogField,
  createLilly,
  drop,
  dropRows,
  exchange,
  exchangesLeft,
  frogKind,
  frogSpawnAllowed,
  guaranteedPaths,
  lilyOrigin,
  outcome,
  passingTattoos,
  pathExists,
  planLilly,
  playPlan,
  releaseLanding,
  runToads,
  settleRemaining,
  shortestPath,
  spawnFrog,
  stepFrog,
  stepToad,
  type Cell,
  type Kind,
  type LillyLevel,
  type LillyState,
  type LillyTemplates,
} from "../../../src/games/zoombinis/game/puzzles/lilly";
import { originalFiles } from "../../support/original";

const original = originalFiles("zoombinis", "files.json");

const LEVELS: readonly LillyLevel[] = [0, 1, 2, 3];
const GROUPS = Array.from({ length: 16 }, (_, i) => i + 1);

/** Gabarits synthétiques (sans archive) : un chemin horizontal complet par identifiant, sur des rangées distinctes dans chaque kind. */
function synthetic(): LillyTemplates {
  const make = (first: number, rows: readonly number[]) => {
    const t = new Array<number>(144).fill(0);
    rows.forEach((row, i) => t.fill(first + i, row * 12, row * 12 + 12));
    return t;
  };
  return [make(1, [3, 6, 9]), make(4, [1, 4, 7, 10]), make(8, [0, 2, 5, 8, 11])];
}

function realTemplates(): LillyTemplates {
  const archive = MohawkArchive.parse(original.read("LILLY.MHK"));
  return [15000, 15001, 15002].map((id) => parseRegs(archive.get("REGS", id))) as unknown as LillyTemplates;
}

/** Remplit l'étang de `value` pour la caractéristique 2 (B) partout sauf les cases listées : sert aux tests de cas à la main. */
function handPond(state: LillyState, free: readonly Cell[]): void {
  for (const lily of state.pond.cells) lily.attrs = [0, 3, 0];
  for (const c of free) state.pond.cells[cellIndex(c.col, c.row)]!.attrs[1] = 0;
}

/** Un crapaud de caractéristique B = 0 (kind 2, valeur 0) dans l'état. */
function toadB0(state: LillyState) {
  return state.toads.find((t) => t.kind === 2 && t.value === 0)!;
}

function snapshot(state: LillyState) {
  return JSON.stringify({ cells: state.pond.cells, info: state.info, toads: state.toads.map((t) => [t.tattoo, t.frameDelay]), fairy: state.fairy });
}

describe("tables", () => {
  it("les 12 tatouages sont les 3 + 4 + 5 valeurs des trois caractéristiques", () => {
    expect(TATTOOS).toHaveLength(12);
    expect(TATTOOS.filter((t) => t.kind === 1).map((t) => t.value)).toEqual([0, 1, 2]);
    expect(TATTOOS.filter((t) => t.kind === 2).map((t) => t.value)).toEqual([0, 1, 2, 3]);
    expect(TATTOOS.filter((t) => t.kind === 3).map((t) => t.value)).toEqual([0, 1, 2, 3, 4]);
  });

  it("le nombre de chemins garantis au niveau 1 est ⌊(N + 1) / 2⌋ (DS2:25bc)", () => {
    for (const n of GROUPS) expect(guaranteedPaths(n)).toBe(Math.trunc((n + 1) / 2));
  });

  it("l'origine d'un nénuphar suit REGS 100 / 101 et la pente de DS:145a", () => {
    const x = [0, 150, 147];
    const y = [0, 79, 108];
    expect(lilyOrigin(0, 0, x, y)).toEqual({ x: 150, y: 81 });
    expect(lilyOrigin(5, 1, x, y)).toEqual({ x: 147 + 175, y: 108 + 6 });
  });
});

describe("génération (gabarits synthétiques)", () => {
  it("est déterministe à graine fixe et varie avec la graine", () => {
    const a = createLilly(new MsvcRandom(7), 2, 8, synthetic());
    const b = createLilly(new MsvcRandom(7), 2, 8, synthetic());
    const c = createLilly(new MsvcRandom(8), 2, 8, synthetic());
    expect(snapshot(a)).toBe(snapshot(b));
    expect(snapshot(a)).not.toBe(snapshot(c));
  });

  it("donne aux 12 crapauds les 12 tatouages, sans doublon", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = createLilly(new MsvcRandom(seed), 0, 8, synthetic());
      expect(state.toads).toHaveLength(TOAD_COUNT);
      expect(state.toads.map((t) => t.tattoo).sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i));
      for (const t of state.toads) {
        expect(TATTOOS[t.tattoo]).toEqual({ kind: t.kind, value: t.value });
        expect(t.frameDelay).toBeGreaterThanOrEqual(3);
        expect(t.frameDelay).toBeLessThanOrEqual(6);
      }
    }
  });

  it("garde chaque caractéristique dans ses bornes et le motif = base[C] + A", () => {
    const state = createLilly(new MsvcRandom(3), 1, 12, synthetic());
    expect(state.pond.cells).toHaveLength(144);
    for (const lily of state.pond.cells) {
      expect(lily.attrs[0]).toBeLessThan(3);
      expect(lily.attrs[1]).toBeLessThan(4);
      expect(lily.attrs[2]).toBeLessThan(5);
      expect(lily.motif).toBe([5, 8, 11, 14, 17][lily.attrs[2]]! + lily.attrs[0]);
      expect(lily.occupied).toBe(false);
    }
  });

  it("au niveau 1, au moins ⌊(N + 1) / 2⌋ tatouages passent (N de 1 à 16)", () => {
    for (const n of GROUPS)
      for (let seed = 1; seed <= 12; seed++) {
        const state = createLilly(new MsvcRandom(seed * 31 + n), 0, n, synthetic());
        expect(passingTattoos(state.pond).length).toBeGreaterThanOrEqual(guaranteedPaths(n));
      }
  });

  it("n'a ni grenouille ni point d'entrée aux niveaux 0 et 1, 2 puis 3 points d'entrée aux niveaux 2 et 3", () => {
    const counts = LEVELS.map((level) => createLilly(new MsvcRandom(5), level, 8, synthetic()).info.entries.length);
    expect(counts).toEqual([0, 0, 2, 3]);
    const state = createLilly(new MsvcRandom(5), 3, 8, synthetic());
    expect(state.info.rotated).not.toBe(0);
    expect(frogKind(state)).toBe(state.info.rotated);
    expect(state.info.entries.every((e, i, all) => e.col >= 0 && e.col < 12 && (i === 0 || e.col > all[i - 1]!.col))).toBe(true);
    for (const e of state.info.entries) expect(attrOf(state.pond.cells[cellIndex(e.col, 0)]!, e.kind)).toBe(e.value);
  });

  it("le budget d'échanges est ⌈(coupures + 5) / 6⌉ par cran, 6 crans", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const state = createLilly(new MsvcRandom(seed), 1, 8, synthetic());
      expect(state.fairy.perGauge).toBe(Math.ceil((state.info.cuts + 5) / 6));
      expect(exchangesLeft(state)).toBe(6 * state.fairy.perGauge);
    }
    expect(exchangesLeft(createLilly(new MsvcRandom(1), 0, 8, synthetic()))).toBe(0);
  });
});

describe("dépôt, pas et arrivée (étang fait à la main)", () => {
  /** Couloir de la rangée 5 de la colonne 0 à la colonne 11 : B = 0 ; le reste est B = 3. */
  function corridor(): LillyState {
    const state = createLilly(new MsvcRandom(1), 0, 3, synthetic());
    handPond(state, Array.from({ length: 12 }, (_, col) => ({ col, row: 5 })));
    return state;
  }

  it("n'accepte un dépôt que sur un nénuphar libre de la première colonne qui porte le tatouage", () => {
    const state = corridor();
    const toad = toadB0(state);
    const other = state.toads.find((t) => t.kind === 2 && t.value === 1)!;
    expect(dropRows(state, toad.index)).toEqual([5]);
    expect(canDrop(state, toad.index, 4)).toBe(false);
    expect(canDrop(state, other.index, 5)).toBe(false);
    expect(canDrop(state, toad.index, 12)).toBe(false);
    state.pond.cells[cellIndex(0, 5)]!.occupied = true;
    expect(canDrop(state, toad.index, 5)).toBe(false);
    state.pond.cells[cellIndex(0, 5)]!.occupied = false;
    expect(drop(state, toad.index, 5)).toBe(true);
    expect(state.pond.cells[cellIndex(0, 5)]!.occupied).toBe(true);
    expect(canDrop(state, toad.index, 5)).toBe(false);
    expect(drop(state, toad.index, 4)).toBe(false);
    expect(state.launched).toBe(1);
    expect(toad.token).toBe(0);
  });

  it("refuse un dépôt quand tous les jetons sont lancés", () => {
    const state = corridor();
    const toad = toadB0(state);
    for (let i = 0; i < 3; i++) {
      expect(drop(state, toad.index, 5)).toBe(true);
      runToads(state);
    }
    expect(state.launched).toBe(3);
    expect(drop(state, toad.index, 5)).toBe(false);
  });

  it("le crapaud traverse le couloir pas à pas : 11 sauts à droite, puis la sortie", () => {
    const state = corridor();
    const toad = toadB0(state);
    drop(state, toad.index, 5);
    expect(toad.target).toBe(11);
    const path: Cell[] = [];
    for (let i = 0; i < 11; i++) {
      const step = stepToad(state, toad);
      expect(step.kind).toBe("jump");
      if (step.kind === "jump") {
        expect(step.heading).toBe(1);
        expect(step.from.col).toBe(i);
        path.push(step.to);
      }
    }
    expect(path.map((c) => `${c.col},${c.row}`)).toEqual(Array.from({ length: 11 }, (_, i) => `${i + 1},5`));
    const exit = stepToad(state, toad);
    expect(exit).toEqual({ kind: "exit", row: 5 });
    expect(state.pond.landing[5]).toBe(true);
    expect(canLeave(state)).toBe(false);
    expect(arrive(state, toad)).toBe(true);
    expect(canLeave(state)).toBe(true);
    expect(state.saved).toEqual([true, false, false]);
    expect(state.pond.cells[cellIndex(11, 5)]!.occupied).toBe(false);
    expect(toad.active).toBe(false);
    expect(state.pond.landing[5]).toBe(true);
    releaseLanding(state, 5);
    expect(state.pond.landing[5]).toBe(false);
  });

  it("une seule case d'abordage par rangée : le deuxième crapaud attend", () => {
    const state = corridor();
    // Deux crapauds de B = 0 n'existent pas : on pose à la main un second crapaud sur la même rangée.
    const a = toadB0(state);
    drop(state, a.index, 5);
    runToads(state, 9);
    // a est en route ; on occupe la case d'abordage et on la lui laisse trouver prise.
    state.pond.landing[5] = true;
    let step = stepToad(state, a);
    while (step.kind === "jump") step = stepToad(state, a);
    expect(step).toEqual({ kind: "wait", reason: "landing" });
    state.pond.landing[5] = false;
    expect(stepToad(state, a)).toEqual({ kind: "exit", row: 5 });
  });

  it("dans une impasse le crapaud erre sans fin et sans échouer", () => {
    const state = createLilly(new MsvcRandom(1), 0, 3, synthetic());
    handPond(state, [0, 1, 2, 3, 4].map((col) => ({ col, row: 2 })));
    const toad = toadB0(state);
    drop(state, toad.index, 2);
    expect(toad.target).toBe(4);
    const turns = runToads(state, 400);
    expect(turns).toBe(400);
    expect(state.arrivals).toBe(0);
    expect(toad.active).toBe(true);
    expect(toad.col).toBeLessThanOrEqual(4);
    expect(outcome(state).saved).toBe(0);
  });

  it("un crapaud bloqué par un nénuphar occupé attend, puis reprend quand il se libère", () => {
    const state = corridor();
    const toad = toadB0(state);
    drop(state, toad.index, 5);
    const ahead = state.pond.cells[cellIndex(1, 5)]!;
    ahead.occupied = true;
    expect(stepToad(state, toad)).toEqual({ kind: "wait", reason: "blocked" });
    expect(toad.col).toBe(0);
    ahead.occupied = false;
    const step = stepToad(state, toad);
    expect(step.kind).toBe("jump");
    expect(toad.col).toBe(1);
  });

  it("la case quittée est libérée au pas suivant et le crapaud n'occupe qu'une case de plus pendant le saut", () => {
    const state = corridor();
    const toad = toadB0(state);
    drop(state, toad.index, 5);
    stepToad(state, toad);
    expect(state.pond.cells.filter((l) => l.occupied)).toHaveLength(2);
    stepToad(state, toad);
    expect(state.pond.cells.filter((l) => l.occupied)).toHaveLength(2);
    expect(state.pond.cells[cellIndex(0, 5)]!.occupied).toBe(false);
  });

  it("deux crapauds sur des rangées différentes arrivent tous les deux, chacun avec son Zoombini", () => {
    const state = createLilly(new MsvcRandom(2), 0, 4, synthetic());
    for (const lily of state.pond.cells) lily.attrs = [0, 0, 0];
    // Tout le monde a A = B = C = 0 : seuls les crapauds de valeur 0 passent.
    const zeros = state.toads.filter((t) => t.value === 0);
    expect(zeros.length).toBe(3);
    expect(drop(state, zeros[0]!.index, 1)).toBe(true);
    expect(drop(state, zeros[1]!.index, 8)).toBe(true);
    runToads(state);
    expect(state.arrivals).toBe(2);
    expect(state.saved).toEqual([true, true, false, false]);
    expect(outcome(state)).toMatchObject({ saved: 2, lost: 2 });
  });
});

describe("la fée (étang fait à la main)", () => {
  function pondWithGap(): { state: LillyState; toad: ReturnType<typeof toadB0> } {
    const state = createLilly(new MsvcRandom(1), 1, 3, synthetic());
    // Couloir B = 0 dans la rangée 5 avec un trou en colonne 6 ; un nénuphar B = 0 isolé en (3, 9).
    handPond(
      state,
      [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11].map((col) => ({ col, row: 5 })).concat([{ col: 3, row: 9 }]),
    );
    return { state, toad: toadB0(state) };
  }

  it("n'existe pas au niveau 0, refuse les cases occupées, identiques ou hors de l'étang", () => {
    const flat = createLilly(new MsvcRandom(1), 0, 3, synthetic());
    expect(canExchange(flat, { col: 0, row: 0 }, { col: 1, row: 1 })).toBe(false);
    expect(exchange(flat, { col: 0, row: 0 }, { col: 1, row: 1 })).toBe(false);
    const { state } = pondWithGap();
    expect(canExchange(state, { col: 6, row: 5 }, { col: 3, row: 9 })).toBe(true);
    expect(canExchange(state, { col: 6, row: 5 }, { col: 6, row: 5 })).toBe(false);
    expect(canExchange(state, { col: 6, row: 5 }, { col: 12, row: 5 })).toBe(false);
    state.pond.cells[cellIndex(3, 9)]!.occupied = true;
    expect(canExchange(state, { col: 6, row: 5 }, { col: 3, row: 9 })).toBe(false);
  });

  it("l'échange permute les trois caractéristiques et le motif, et répare le chemin", () => {
    const { state, toad } = pondWithGap();
    expect(pathExists(state.pond, 2, 0)).toBe(false);
    const before = state.pond.cells[cellIndex(3, 9)]!;
    const donor = { attrs: [...before.attrs], motif: before.motif };
    const gap = { attrs: [...state.pond.cells[cellIndex(6, 5)]!.attrs], motif: state.pond.cells[cellIndex(6, 5)]!.motif };
    expect(exchange(state, { col: 6, row: 5 }, { col: 3, row: 9 })).toBe(true);
    expect(state.pond.cells[cellIndex(6, 5)]).toMatchObject(donor);
    expect(state.pond.cells[cellIndex(3, 9)]).toMatchObject(gap);
    expect(pathExists(state.pond, 2, 0)).toBe(true);
    expect(shortestPath(state.pond, 2, 0)).toHaveLength(12);
    expect(state.fairy.total).toBe(1);
    drop(state, toad.index, 5);
    runToads(state);
    expect(state.arrivals).toBe(1);
  });

  it("compte les échanges par crans et s'épuise après 6 crans", () => {
    const { state } = pondWithGap();
    const per = state.fairy.perGauge;
    const a = { col: 8, row: 8 };
    const b = { col: 9, row: 8 };
    for (let i = 0; i < per; i++) expect(exchange(state, a, b)).toBe(true);
    expect(state.fairy.gauge).toBe(1);
    expect(state.fairy.inGauge).toBe(0);
    expect(exchangesLeft(state)).toBe(5 * per);
    for (let i = 0; i < 5 * per; i++) expect(exchange(state, a, b)).toBe(true);
    expect(state.fairy.gauge).toBe(FAIRY_GAUGE);
    expect(exchangesLeft(state)).toBe(0);
    expect(canExchange(state, a, b)).toBe(false);
    expect(exchange(state, a, b)).toBe(false);
  });

  it("un échange recalcule le chemin du crapaud en route et remet à zéro les compteurs des deux cases", () => {
    const { state, toad } = pondWithGap();
    drop(state, toad.index, 5);
    expect(toad.target).toBe(5);
    stepToad(state, toad);
    exchange(state, { col: 6, row: 5 }, { col: 3, row: 9 });
    expect(toad.target).toBe(11);
    runToads(state);
    expect(state.arrivals).toBe(1);
  });

  it("baguette épuisée et tous les jetons lancés : les crapauds qui ont un chemin comptent comme sauvés (10f8:7866)", () => {
    const { state, toad } = pondWithGap();
    exchange(state, { col: 6, row: 5 }, { col: 3, row: 9 });
    state.fairy.gauge = FAIRY_GAUGE;
    state.group = 1;
    state.saved = [false];
    drop(state, toad.index, 5);
    expect(state.launched).toBe(1);
    expect(state.saved).toEqual([true]);
    expect(state.arrivals).toBe(0);
    // Un crapaud sans chemin n'est pas compté.
    const other = createLilly(new MsvcRandom(1), 1, 1, synthetic());
    handPond(other, [0, 1, 2].map((col) => ({ col, row: 0 })));
    other.fairy.gauge = FAIRY_GAUGE;
    const t = toadB0(other);
    drop(other, t.index, 0);
    settleRemaining(other);
    expect(other.saved).toEqual([false]);
  });
});

describe("grenouilles (étang fait à la main)", () => {
  /** Niveau 3 (3 points d'entrée) puis étang à la main : A = 0 partout sauf la colonne 4 (A = 1), qui descend de la rangée 0 à la rangée 11. */
  function frogPond(): LillyState {
    const state = createLilly(new MsvcRandom(1), 3, 8, synthetic());
    for (const lily of state.pond.cells) lily.attrs = [0, 0, 0];
    for (let row = 0; row < 12; row++) state.pond.cells[cellIndex(4, row)]!.attrs[0] = 1;
    state.info.entries.splice(0, state.info.entries.length, { col: 4, kind: 1, value: 1, tattoo: 1 });
    return state;
  }

  it("le champ de distance mesure chaque composante depuis sa rangée la plus basse", () => {
    const state = frogPond();
    const field = computeFrogField(state.pond, 1, 1);
    for (let row = 0; row < 12; row++) expect(field[(row + 1) * 12 + 4]).toBe(12 - row);
    expect(field[(5 + 1) * 12 + 3]).toBe(0);
    expect(computeFrogField(state.pond, 0, 1).every((v) => v === 0)).toBe(true);
  });

  it("crée une grenouille ordinaire sur une entrée libre, la variante sur une entrée déjà servie et occupée", () => {
    const state = frogPond();
    expect(frogSpawnAllowed(state)).toBe(true);
    const first = spawnFrog(state)!;
    expect(first).toMatchObject({ col: 4, row: 0, kind: 1, value: 1, variant: false, alive: true });
    expect(state.pond.cells[cellIndex(4, 0)]!.occupied).toBe(true);
    expect(state.frogSeen[4]).toBe(true);
    const second = spawnFrog(state)!;
    expect(second).toMatchObject({ col: 4, row: 0, kind: 0, variant: true });
    // Une entrée occupée par autre chose qu'une grenouille déjà venue : rien.
    const fresh = frogPond();
    fresh.pond.cells[cellIndex(4, 0)]!.occupied = true;
    expect(spawnFrog(fresh)).toBeNull();
    // Le point d'entrée suivant devient courant dans tous les cas.
    expect(fresh.nextEntry).toBe(0);
  });

  it("sans champ calculé, une grenouille ordinaire ne bouge pas ; un échange touchant sa valeur le calcule et elle descend", () => {
    const state = frogPond();
    const frog = spawnFrog(state)!;
    expect(stepFrog(state, frog)).toEqual({ kind: "wait" });
    expect(frog.row).toBe(0);
    // Deux nénuphars libres, dont un de la valeur de la grenouille, déclenchent le calcul.
    state.pond.cells[cellIndex(9, 9)]!.attrs[0] = 1;
    expect(exchange(state, { col: 9, row: 9 }, { col: 9, row: 10 })).toBe(true);
    expect(state.frogField[1]).not.toBeNull();
    const step = stepFrog(state, frog);
    expect(step.kind).toBe("jump");
    expect(frog).toMatchObject({ col: 4, row: 1 });
    expect(state.pond.cells[cellIndex(4, 1)]!.occupied).toBe(true);
    // La case de départ est libérée au pas suivant.
    stepFrog(state, frog);
    expect(state.pond.cells[cellIndex(4, 0)]!.occupied).toBe(false);
  });

  it("descend jusqu'à la rangée 11 puis sort en libérant sa case", () => {
    const state = frogPond();
    const frog = spawnFrog(state)!;
    state.pond.cells[cellIndex(9, 9)]!.attrs[0] = 1;
    exchange(state, { col: 9, row: 9 }, { col: 9, row: 10 });
    let steps = 0;
    while (frog.alive && steps++ < 40) stepFrog(state, frog);
    expect(frog.alive).toBe(false);
    expect(state.pond.cells.filter((l) => l.occupied)).toHaveLength(0);
  });

  it("une grenouille occupe un nénuphar : le crapaud n'y saute pas", () => {
    const state = frogPond();
    spawnFrog(state);
    const toad = state.toads.find((t) => t.kind === 1 && t.value === 1)!;
    // A = 1 : la colonne 4 est le seul chemin, et la grenouille est en (4, 0) : aucun nénuphar de la colonne 0 n'a A = 1 ici.
    expect(dropRows(state, toad.index)).toEqual([]);
    expect(frogSpawnAllowed(state)).toBe(true);
    expect(FROG_MAX_ALIVE).toBe(20);
  });

  it("la variante descend tout droit sur un nénuphar occupé, adopte le premier libre, puis devient ordinaire", () => {
    const state = frogPond();
    const regular = spawnFrog(state)!;
    const variant = spawnFrog(state)!;
    expect(regular.variant).toBe(false);
    state.pond.cells[cellIndex(4, 1)]!.occupied = true;
    expect(stepFrog(state, variant)).toMatchObject({ kind: "jump", heading: 2 });
    expect(variant).toMatchObject({ row: 1, kind: 0, adopted: false });
    expect(stepFrog(state, variant)).toMatchObject({ kind: "jump", heading: 2 });
    expect(variant).toMatchObject({ row: 2, kind: 1, value: 1, adopted: true, variant: true });
    expect(stepFrog(state, variant)).toEqual({ kind: "wait" });
    expect(variant).toMatchObject({ variant: false, adopted: false });
  });
});

describe("robot (gabarits synthétiques)", () => {
  it("sauve tout le groupe au niveau 0 pour N de 1 à 16", () => {
    for (const n of GROUPS)
      for (let seed = 1; seed <= 6; seed++) {
        const state = createLilly(new MsvcRandom(seed * 101 + n), 0, n, synthetic());
        const plan = planLilly(state);
        expect(plan.filter((m) => m.kind === "exchange")).toHaveLength(0);
        expect(plan.filter((m) => m.kind === "drop")).toHaveLength(n);
        expect(playPlan(state, plan)).toBe(n);
        expect(outcome(state)).toMatchObject({ saved: n, lost: 0 });
        expect(state.launched).toBe(n);
      }
  });

  it("ne modifie pas l'état qu'on lui donne", () => {
    const state = createLilly(new MsvcRandom(4), 1, 6, synthetic());
    const before = snapshot(state);
    planLilly(state);
    expect(snapshot(state)).toBe(before);
  });

  it("ne joue rien quand plus aucun jeton n'est à lancer", () => {
    const state = createLilly(new MsvcRandom(4), 0, 1, synthetic());
    playPlan(state, planLilly(state));
    expect(planLilly(state)).toEqual([]);
  });

  it("ne joue rien quand aucun chemin n'est réparable", () => {
    const state = createLilly(new MsvcRandom(1), 1, 3, synthetic());
    for (const lily of state.pond.cells) lily.attrs = [0, 0, 0];
    for (let row = 0; row < 12; row++) state.pond.cells[cellIndex(5, row)]!.attrs = [1, 1, 1];
    state.fairy.gauge = FAIRY_GAUGE;
    expect(passingTattoos(state.pond)).toEqual([]);
    expect(planLilly(state)).toEqual([]);
  });
});

describe.skipIf(!original.has)("gabarits d'origine (REGS 15000 à 15002 de LILLY.MHK)", () => {
  const templates = realTemplates();

  it("chaque identifiant a un chemin de la colonne 0 à la colonne 11 dans son gabarit", () => {
    for (const [k, template] of templates.entries()) {
      const first = [1, 4, 8][k]!;
      const count = [3, 4, 5][k]!;
      for (let id = first; id < first + count; id++) {
        const cells = new Set<number>();
        for (let i = 0; i < 144; i++) if (template[i] === id) cells.add(i);
        const seen = new Set<number>();
        const queue = [...cells].filter((i) => i % 12 === 0);
        queue.forEach((i) => seen.add(i));
        for (let h = 0; h < queue.length; h++) {
          const i = queue[h]!;
          for (const j of [i - 12, i + 12, i % 12 < 11 ? i + 1 : -1, i % 12 > 0 ? i - 1 : -1])
            if (cells.has(j) && !seen.has(j)) {
              seen.add(j);
              queue.push(j);
            }
        }
        expect([...seen].some((i) => i % 12 === 11), `identifiant ${id}`).toBe(true);
      }
    }
  });

  it("niveau 1 : au moins ⌊(N + 1) / 2⌋ tatouages passent, pour N de 1 à 16 et 25 graines", () => {
    for (const n of GROUPS)
      for (let seed = 1; seed <= 25; seed++) {
        const state = createLilly(new MsvcRandom(seed), 0, n, templates);
        expect(passingTattoos(state.pond).length, `N ${n} graine ${seed}`).toBeGreaterThanOrEqual(guaranteedPaths(n));
      }
  });

  it("niveaux 2 à 4 : peu de chemins intacts, des coupures (au plus 24) et un budget de fée à la mesure", () => {
    for (const level of [1, 2, 3] as const) {
      let passing = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const state = createLilly(new MsvcRandom(seed), level, 8, templates);
        passing += passingTattoos(state.pond).length;
        expect(state.info.cuts).toBeGreaterThan(0);
        expect(state.info.cuts).toBeLessThanOrEqual(24);
        expect(exchangesLeft(state)).toBe(6 * Math.ceil((state.info.cuts + 5) / 6));
        expect(exchangesLeft(state)).toBeGreaterThanOrEqual(state.info.cuts + 5);
        expect(exchangesLeft(state)).toBeLessThanOrEqual(30);
      }
      expect(passing / 60, `niveau ${level + 1}`).toBeLessThan(4);
    }
  });

  it("niveaux 3 et 4 : un gabarit tourné, ses points d'entrée sont sur la rangée 0 et ses chemins vont de haut en bas", () => {
    for (const level of [2, 3] as const)
      for (const n of [3, 8, 16])
        for (let seed = 1; seed <= 30; seed++) {
          const state = createLilly(new MsvcRandom(seed), level, n, templates);
          const { rotated, entries } = state.info;
          expect(rotated).not.toBe(0);
          if (n === 16) expect(rotated).toBe(2);
          if (level === 3) expect(rotated).not.toBe(1);
          expect(entries).toHaveLength(level === 2 ? 2 : 3);
          expect(new Set(entries.map((e) => e.col)).size).toBe(entries.length);
          for (const e of entries) {
            expect(e.kind).toBe(rotated);
            expect(TATTOOS[e.tattoo]).toEqual({ kind: e.kind, value: e.value });
            expect(attrOf(state.pond.cells[cellIndex(e.col, 0)]!, e.kind as Kind)).toBe(e.value);
          }
          // Les chemins du kind tourné vont de haut en bas : aucun de ses tatouages ne traverse de gauche à droite.
          expect(passingTattoos(state.pond).filter((t) => TATTOOS[t]!.kind === rotated)).toEqual([]);
        }
  });

  it("le crapaud arrive si et seulement si sa composante touche la colonne 11, et son pré-calcul le sait", () => {
    for (const level of LEVELS)
      for (let seed = 1; seed <= 12; seed++) {
        const base = createLilly(new MsvcRandom(seed), level, 8, templates);
        for (const toad of base.toads)
          for (const row of dropRows(base, toad.index)) {
            const state = createLilly(new MsvcRandom(seed), level, 8, templates);
            const t = state.toads[toad.index]!;
            drop(state, toad.index, row);
            const reaches = componentReaches(state, t.kind, t.value, { col: 0, row });
            expect(t.target === 11).toBe(reaches);
            runToads(state, 600);
            expect(state.arrivals === 1, `niveau ${level} graine ${seed} crapaud ${toad.index} rangée ${row}`).toBe(reaches);
          }
      }
  });

  it("la trajectoire est déterministe, de nénuphars voisins du bon tatouage, et suit un chemin court", () => {
    const run = () => {
      const state = createLilly(new MsvcRandom(42), 0, 8, templates);
      const toad = state.toads.find((t) => dropRows(state, t.index).some((row) => componentReaches(state, t.kind, t.value, { col: 0, row })))!;
      const row = dropRows(state, toad.index).find((r) => componentReaches(state, toad.kind, toad.value, { col: 0, row: r }))!;
      drop(state, toad.index, row);
      const cells: Cell[] = [{ col: 0, row }];
      for (let guard = 0; guard < 500 && toad.active; guard++) {
        const step = stepToad(state, toad);
        if (step.kind === "jump") cells.push(step.to);
        else if (step.kind === "exit") {
          arrive(state, toad);
          releaseLanding(state, step.row);
        }
      }
      return { state, toad, cells };
    };
    const a = run();
    const b = run();
    expect(a.cells).toEqual(b.cells);
    expect(a.state.arrivals).toBe(1);
    expect(a.cells[0]!.col).toBe(0);
    expect(a.cells.at(-1)!.col).toBe(11);
    for (let i = 1; i < a.cells.length; i++) {
      expect(Math.abs(a.cells[i]!.col - a.cells[i - 1]!.col) + Math.abs(a.cells[i]!.row - a.cells[i - 1]!.row)).toBe(1);
      expect(attrOf(a.state.pond.cells[cellIndex(a.cells[i]!.col, a.cells[i]!.row)]!, a.toad.kind)).toBe(a.toad.value);
    }
    const shortest = shortestPath(a.state.pond, a.toad.kind, a.toad.value)!;
    expect(a.cells.length).toBeLessThanOrEqual(shortest.length + 12);
  });

  it("le robot sauve tout le groupe aux 4 niveaux, pour N de 1 à 16", () => {
    for (const level of LEVELS)
      for (const n of GROUPS)
        for (let seed = 1; seed <= 4; seed++) {
          const state = createLilly(new MsvcRandom(seed * 977 + n), level, n, templates);
          const plan = planLilly(state);
          expect(plan.length, `niveau ${level} N ${n} graine ${seed}`).toBeGreaterThanOrEqual(n);
          playPlan(state, plan);
          expect(outcome(state), `niveau ${level} N ${n} graine ${seed}`).toMatchObject({ saved: n, lost: 0 });
          expect(state.fairy.total).toBeLessThanOrEqual(6 * state.fairy.perGauge);
        }
  });

  it("le robot garde la même économie d'échanges au niveau 1 (aucun) et au plus le budget aux autres", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const flat = createLilly(new MsvcRandom(seed), 0, 8, templates);
      expect(planLilly(flat).some((m) => m.kind === "exchange")).toBe(false);
      const level = createLilly(new MsvcRandom(seed), 1, 8, templates);
      expect(planLilly(level).filter((m) => m.kind === "exchange").length).toBeLessThanOrEqual(exchangesLeft(level));
    }
  });

  it("niveaux 3 et 4 : le robot sauve le groupe avec des grenouilles déjà sorties (étang vu à l'instant du calcul)", () => {
    for (const level of [2, 3] as const)
      for (let seed = 1; seed <= 10; seed++) {
        const state = createLilly(new MsvcRandom(seed), level, 8, templates);
        spawnFrog(state);
        spawnFrog(state);
        playPlan(state, planLilly(state));
        expect(outcome(state).saved, `niveau ${level} graine ${seed}`).toBe(8);
      }
  });
});

/** Parcours en largeur indépendant du module : la composante de `start` pour `(kind, value)` touche-t-elle la colonne 11 ? */
function componentReaches(state: LillyState, kind: Kind, value: number, start: Cell): boolean {
  const seen = new Set<number>([cellIndex(start.col, start.row)]);
  const queue = [start];
  for (let h = 0; h < queue.length; h++) {
    const c = queue[h]!;
    if (c.col === 11) return true;
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const col = c.col + dx;
      const row = c.row + dy;
      if (col < 0 || row < 0 || col > 11 || row > 11) continue;
      const i = cellIndex(col, row);
      if (!seen.has(i) && attrOf(state.pond.cells[i]!, kind) === value) {
        seen.add(i);
        queue.push({ col, row });
      }
    }
  }
  return false;
}
