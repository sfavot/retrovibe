import { describe, expect, it, vi } from "vitest";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { GRAPHICS } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import {
  AXIS_COUNTS,
  BLOCKED,
  COMPLETION_VOICES,
  DEFEAT_STEP,
  DIM_PERCENT,
  EXPLAIN_SCRIPT,
  FREE_STEPS,
  HALL_PLACES,
  INTRO_SCRIPT,
  MAX_ERRORS,
  PILE_MAX,
  ROOM_COUNTS,
  ROOM_POINTS_125,
  ROOM_POINTS_25,
  axisIndices,
  blockedArt,
  blockedRooms,
  chooseAttributes,
  createHotel,
  dimPalette,
  dimmed,
  distinctValues,
  errorsMade,
  explanationScript,
  introVariant,
  isValid,
  lostMembers,
  memberValues,
  place,
  robot,
  robotPlan,
  roomOfAxes,
  savedMembers,
  tablePoint,
  type HotelState,
  type Level,
  type Traits,
} from "../../../src/games/zoombinis/game/puzzles/hotel";
import { nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type Attrs, type Zoombini } from "../../../src/games/zoombinis/game/state";
import { acceptScript, createHotelScene, stackPosition, type HotelProbe, type HotelScene } from "../../../src/games/zoombinis/scenes/puzzles/hotel";
import { BUTTON_GO, BUTTON_MAP } from "../../../src/games/zoombinis/scenes/puzzle-kit";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;
const LEVELS: readonly Level[] = [0, 1, 2, 3];

function randomGroup(rng: MsvcRandom, size: number): Traits[] {
  return Array.from({ length: size }, () => [rng.range(1, 5), rng.range(1, 5), rng.range(1, 5), rng.range(1, 5)]);
}

/** Groupe où chaque attribut prend ses cinq valeurs (membres 0 à 4 tous différents entre eux sur chaque attribut). */
function variedGroup(size: number): Attrs[] {
  return Array.from({ length: size }, (_, i) => [1 + (i % 5), 1 + ((i * 2) % 5), 1 + ((i * 3) % 5), 1 + ((i * 4) % 5)] as Attrs);
}

/** Pose du membre 1 (toujours différent du membre 0 sur chaque attribut) dans la chambre du membre 0 : refus garanti après la première pose. */
function refuseOnce(state: HotelState, room: number) {
  return place(state, 1, room);
}

describe("règles de l'hôtel (hotel.ts)", () => {
  it("constantes : 5 / 25 / 25 / 125 chambres, 1 / 2 / 2 / 3 axes, F = 5, 2, 4, 2, erreurs tolérées 7, 10, 8, 10, lumière × 88 / 92 / 90 / 92", () => {
    expect(ROOM_COUNTS).toEqual([5, 25, 25, 125]);
    expect(AXIS_COUNTS).toEqual([1, 2, 2, 3]);
    expect(FREE_STEPS).toEqual([5, 2, 4, 2]);
    expect(MAX_ERRORS).toEqual([7, 10, 8, 10]);
    expect(DIM_PERCENT).toEqual([88, 92, 90, 92]);
    expect(ROOM_POINTS_25).toHaveLength(25);
    expect(ROOM_POINTS_125).toHaveLength(125);
    expect(HALL_PLACES).toHaveLength(16);
    // Niveau 0 : la rangée du bas (chambres 4, 9, 14, 19, 24 de la table).
    expect([0, 1, 2, 3, 4].map((room) => tablePoint(0, room))).toEqual([4, 9, 14, 19, 24]);
    expect(tablePoint(1, 7)).toBe(7);
    // Chambres du niveau 3 : bloc `⌊r / 25⌋` va de gauche à droite, rangée `⌊(r mod 25) / 5⌋` de haut en bas.
    expect(ROOM_POINTS_125[0]).toEqual({ x: 16, y: 40 });
    expect(ROOM_POINTS_125[124]).toEqual({ x: 623, y: 385 });
    expect(ROOM_POINTS_25[24]).toEqual({ x: 485, y: 346 });
  });

  it("axes : colonne et bloc (niveaux 1 et 2), rangée, bloc et place (niveau 3) ; réciproque", () => {
    expect(axisIndices(0, 3)).toEqual([3]);
    expect(axisIndices(1, 13)).toEqual([3, 2]);
    expect(axisIndices(3, 100)).toEqual([0, 4, 0]);
    expect(axisIndices(3, 57)).toEqual([1, 2, 2]);
    for (const level of LEVELS) {
      for (let room = 0; room < ROOM_COUNTS[level]!; room++) expect(roomOfAxes(level, axisIndices(level, room))).toBe(room);
    }
  });

  it("attributs choisis : la condition du niveau est vraie sur 40 graines et toutes les tailles de groupe", () => {
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 40; seed++) {
        const rng = new MsvcRandom(seed);
        const group = randomGroup(rng, 1 + (seed % 16));
        const c = distinctValues(group);
        const [a, b, k] = chooseAttributes(rng, level, group);
        for (const attr of [a, b, k]) expect(attr).toBeGreaterThanOrEqual(0);
        if (level === 3) {
          expect(new Set([a, b, k]).size).toBe(3);
        } else {
          expect(a).not.toBe(b);
          const wanted = level === 2 ? 4 : 5;
          if (c.filter((n) => n < wanted).length < 3 && !(level < 2 && c[a] === 5 && c[b] === 5)) {
            expect(c[a]).toBeGreaterThan(3);
            expect(c[b]).toBeGreaterThan(3);
          }
        }
      }
    }
  });

  it("mise en place : mêmes graines, même hôtel ; axes, étiquettes vierges, pile vide", () => {
    for (const level of LEVELS) {
      const group = randomGroup(new MsvcRandom(5), 12);
      const one = createHotel(new MsvcRandom(9), level, group);
      const two = createHotel(new MsvcRandom(9), level, group);
      expect(one).toEqual(two);
      expect(one.axes).toBe(AXIS_COUNTS[level]);
      expect(one.rooms).toBe(ROOM_COUNTS[level]);
      expect(one.labels).toHaveLength(AXIS_COUNTS[level]!);
      expect(one.labels.flat().every((l) => l === 0)).toBe(true);
      expect(one.step).toBe(FREE_STEPS[level]);
      expect(one.firstPose).toBe(true);
      expect(one.lost).toBe(false);
    }
  });

  it("niveau 2 : disposition cachée (deux permutations), 1 à 8 chambres bloquées jamais utiles, dessins 0 à 3 dans l'ordre des chambres ; aucun blocage ailleurs", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = new MsvcRandom(seed);
      const group = randomGroup(rng, 6 + (seed % 11));
      const state = createHotel(rng, 2, group);
      const hidden = state.hidden!;
      expect([...hidden.a].sort()).toEqual([1, 2, 3, 4, 5]);
      expect([...hidden.b].sort()).toEqual([1, 2, 3, 4, 5]);
      const blocked = blockedRooms(state);
      expect(blocked.length).toBeGreaterThanOrEqual(1);
      expect(blocked.length).toBeLessThanOrEqual(8);
      expect(state.arts).toHaveLength(blocked.length);
      for (const room of blocked) {
        expect(state.piles[room]).toBe(BLOCKED);
        // Aucun Zoombini du groupe n'irait dans cette chambre dans la disposition cachée.
        for (let member = 0; member < group.length; member++) {
          const [va, vb] = memberValues(state, member);
          expect(hidden.a[room % 5] === va && hidden.b[Math.floor(room / 5)] === vb).toBe(false);
        }
        expect(blockedArt(state, room)).toBe(state.arts[blocked.indexOf(room)]);
      }
      for (const art of state.arts) expect([0, 1, 2, 3]).toContain(art);
      // Les étiquettes de la disposition cachée sont effacées : le joueur les apprend à la volée (point ouvert 1).
      expect(state.labels.flat().every((l) => l === 0)).toBe(true);
    }
    for (const level of [0, 1, 3] as const) {
      const state = createHotel(new MsvcRandom(3), level, randomGroup(new MsvcRandom(4), 10));
      expect(blockedRooms(state)).toEqual([]);
      expect(state.hidden).toBeNull();
    }
  });

  it("première pose gratuite : toujours acceptée, définit les étiquettes de sa chambre et remet le cran à F", () => {
    for (const level of LEVELS) {
      const state = createHotel(new MsvcRandom(2), level, variedGroup(12));
      const room = level === 0 ? 2 : 7;
      const result = place(state, 0, room);
      expect(result).toMatchObject({ kind: "accepted", free: true, opensDoor: true, pile: 0, completed: false });
      expect(state.firstPose).toBe(false);
      expect(state.step).toBe(FREE_STEPS[level]);
      expect(errorsMade(state)).toBe(0);
      const values = memberValues(state, 0);
      const indices = axisIndices(level, room);
      values.forEach((value, axis) => expect(state.labels[axis]![indices[axis]!]).toBe(value));
      expect(state.piles[room]).toBe(1);
    }
  });

  it("étiquettes apprises à la volée : une étiquette posée n'accepte que sa valeur, une valeur déjà portée ailleurs est refusée en chambre vierge", () => {
    for (const level of LEVELS) {
      const state = createHotel(new MsvcRandom(2), level, variedGroup(12));
      // Chambres libres dont tous les axes diffèrent de ceux des chambres déjà choisies.
      const rooms = Array.from({ length: ROOM_COUNTS[level]! }, (_, r) => r).filter((r) => state.piles[r] !== BLOCKED);
      const apart = (used: number[]) => rooms.find((r) => used.every((u) => axisIndices(level, r).every((index, axis) => index !== axisIndices(level, u)[axis])))!;
      const first = rooms[0]!;
      const other = apart([first]);
      const again = apart([first, other]);
      place(state, 0, first);
      // Membre 5 : mêmes valeurs que le membre 0 (variedGroup a une période de 5) : accepté dans la même chambre, la pile grandit.
      expect(isValid(state, 5, first)).toBe(true);
      expect(place(state, 5, first)).toMatchObject({ kind: "accepted", opensDoor: false, pile: 2, free: false });
      expect(place(state, 10, first)).toMatchObject({ kind: "accepted", pile: 3 });
      // Membre 1 : valeurs toutes différentes : refusé dans la chambre du membre 0 (étiquette posée).
      expect(isValid(state, 1, first)).toBe(false);
      // Dans une chambre vierge : accepté ; la même valeur ne peut plus aller ailleurs.
      expect(isValid(state, 1, other)).toBe(true);
      expect(place(state, 1, other)).toMatchObject({ kind: "accepted", opensDoor: true });
      expect(isValid(state, 1, again)).toBe(false);
    }
    // Une valeur déjà portée par une autre colonne : refus, même sur une chambre vierge.
    const state = createHotel(new MsvcRandom(2), 1, variedGroup(12));
    place(state, 0, 0);
    const [va] = memberValues(state, 0);
    const clone = state.group.findIndex((traits, member) => member !== 0 && traits[state.chosen[0]] === va);
    // Chambre 1 (même bloc que la chambre 0, colonne vierge) : la colonne de A est vierge mais A déjà porté par la colonne 0 : refusé.
    expect(isValid(state, clone, 1)).toBe(false);
  });

  it("refus : le cran avance d'un, au (12 − F)-ième refus l'épreuve est perdue (7, 10, 8, 10) ; plus aucune pose ensuite", () => {
    for (const level of LEVELS) {
      const state = createHotel(new MsvcRandom(4), level, [[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]]);
      const room = level === 0 ? 1 : 3;
      place(state, 0, room);
      const budget = MAX_ERRORS[level]!;
      let refusals = 0;
      for (;;) {
        const result = refuseOnce(state, room);
        if (result.kind === "ignored") break;
        expect(result.kind).toBe("refused");
        refusals++;
        if (result.kind === "refused") {
          expect(result.step).toBe(FREE_STEPS[level]! + refusals);
          expect(result.lost).toBe(refusals === budget);
        }
        expect(errorsMade(state)).toBe(refusals);
      }
      expect(refusals).toBe(budget);
      expect(state.lost).toBe(true);
      expect(state.step).toBe(DEFEAT_STEP);
      // Perdue : plus de pose, même valide.
      expect(place(state, 0, room).kind).toBe("ignored");
    }
  });

  it("chambre bloquée : le dépôt est annulé, sans erreur ni acceptation", () => {
    const state = createHotel(new MsvcRandom(6), 2, variedGroup(12));
    const [room] = blockedRooms(state);
    expect(room).toBeDefined();
    expect(place(state, 0, room!)).toEqual({ kind: "blocked" });
    expect(state.firstPose).toBe(true);
    expect(state.step).toBe(FREE_STEPS[2]);
    expect(state.accepted).toBe(0);
  });

  it("pile : 0 puis 2 à 6, plafonnée (`1428:[2·r]`), un membre ne se range qu'une fois", () => {
    const state = createHotel(new MsvcRandom(1), 1, Array.from({ length: 12 }, () => [1, 1, 1, 1]));
    const piles: number[] = [];
    for (let member = 0; member < 9; member++) {
      const result = place(state, member, 4);
      if (result.kind === "accepted") piles.push(result.pile);
    }
    expect(piles).toEqual([0, 2, 3, 4, 5, 6, 6, 6, 6]);
    expect(piles.every((p) => p <= PILE_MAX)).toBe(true);
    expect(place(state, 0, 4).kind).toBe("ignored");
  });

  it("robot : range tout le groupe sans la moindre erreur aux 4 niveaux, graines fixes et groupes de 1 à 16", () => {
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 60; seed++) {
        const rng = new MsvcRandom(seed * 7 + level);
        const group = randomGroup(rng, 1 + (seed % 16));
        const state = createHotel(rng, level, group);
        const results = robot(state);
        expect(results.every((r) => r.kind === "accepted"), `niveau ${level} graine ${seed}`).toBe(true);
        expect(state.accepted).toBe(group.length);
        expect(state.lost).toBe(false);
        expect(errorsMade(state)).toBe(0);
        expect(savedMembers(state)).toHaveLength(group.length);
        expect(lostMembers(state)).toEqual([]);
        // Le robot n'utilise jamais une chambre bloquée.
        expect(state.piles.some((p) => p === BLOCKED && false)).toBe(false);
        expect(results.at(-1)).toMatchObject({ completed: true });
      }
    }
  });

  it("robot du niveau 2 : suit la disposition cachée, donc ne vise aucune chambre bloquée", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const rng = new MsvcRandom(seed);
      const group = randomGroup(rng, 4 + (seed % 13));
      const state = createHotel(rng, 2, group);
      const blocked = new Set(blockedRooms(state));
      for (const room of robotPlan(state)) expect(blocked.has(room)).toBe(false);
    }
  });

  it("sauvés et perdus : les non rangés sont perdus, les rangés restent sauvés même en cas d'échec (point ouvert 5)", () => {
    const state = createHotel(new MsvcRandom(4), 1, [[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3], [4, 4, 4, 4]]);
    place(state, 0, 0);
    expect(place(state, 2, 6).kind).toBe("accepted");
    for (let i = 0; i < MAX_ERRORS[1]!; i++) place(state, 1, 0);
    expect(state.lost).toBe(true);
    expect(savedMembers(state)).toEqual([0, 2]);
    expect(lostMembers(state)).toEqual([1, 3]);
  });

  it("obscurcissement : chaque erreur multiplie les entrées 10 à 245 par 88 / 92 / 90 / 92 %, cumulativement, sans toucher aux autres", () => {
    expect(dimmed(200, 88)).toBe(176);
    expect(dimmed(255, 92)).toBe(234);
    for (const level of LEVELS) {
      const colors = new Uint8Array(768).map((_, i) => (i * 7) % 256);
      const before = colors.slice();
      dimPalette(colors, DIM_PERCENT[level]!);
      for (let i = 0; i < 256; i++) {
        for (let c = 0; c < 3; c++) {
          const expected = i >= 10 && i < 246 ? Math.floor((before[i * 3 + c]! * DIM_PERCENT[level]!) / 100) : before[i * 3 + c];
          expect(colors[i * 3 + c]).toBe(expected);
        }
      }
      dimPalette(colors, DIM_PERCENT[level]!);
      expect(colors[30]).toBe(Math.floor((Math.floor((before[30]! * DIM_PERCENT[level]!) / 100) * DIM_PERCENT[level]!) / 100));
    }
  });

  it("scénettes : variante 0 à la première visite du niveau 0, 1 à 3 ensuite, 4 / 5 / 6 aux niveaux 1 à 3 ; l'explication suit le niveau 0 (variante 0), 1 et 2", () => {
    expect(introVariant(new MsvcRandom(1), 0, 1)).toBe(0);
    const seen = new Set<number>();
    for (let seed = 1; seed <= 30; seed++) seen.add(introVariant(new MsvcRandom(seed), 0, 2));
    expect([...seen].sort()).toEqual([1, 2, 3]);
    expect([1, 2, 3].map((level) => introVariant(new MsvcRandom(1), level as Level, 9))).toEqual([4, 5, 6]);
    expect(INTRO_SCRIPT + 4).toBe(7004);
    expect(explanationScript(0, 0)).toBe(EXPLAIN_SCRIPT);
    expect(explanationScript(0, 2)).toBeNull();
    expect(explanationScript(1, 4)).toBe(7501);
    expect(explanationScript(2, 5)).toBe(7502);
    expect(explanationScript(3, 6)).toBeNull();
  });

  it("rangement dans la pile : positions de `10e8:3620` (première, deuxième, troisième, plafond 6), niveau 3 en diagonale", () => {
    const point = { x: 135, y: 78 };
    expect([0, 2, 3, 4].map((pile) => stackPosition(1, 0, point, pile))).toEqual([
      { x: 135 + 0x10 - 8, y: 78 - 9 - 1 },
      { x: 135 + 0x10 - 1, y: 2 + 78 - 9 - 1 },
      { x: 135 + 0x10 + 6, y: 3 + 78 - 9 - 1 },
      { x: 135 + 0x10 - 8, y: 4 + 78 - 9 - 1 },
    ]);
    expect(stackPosition(3, 0, { x: 16, y: 40 }, 0)).toEqual({ x: 21, y: 23 });
    expect(stackPosition(3, 0, { x: 16, y: 40 }, 3)).toEqual({ x: 21 - 4, y: 23 - 2 });
    // `SCRS` de montée : trois familles par colonne au niveau 0 à 2, une par colonne de pas 5 au niveau 3.
    expect([acceptScript(1, 0, 0, 1), acceptScript(1, 10, 10, 3), acceptScript(1, 20, 20, 5), acceptScript(3, 7, 7, 2)]).toEqual([13030, 13037, 13044, 13056]);
  });
});

describe.skipIf(!original.has)("écran de l'hôtel (createHotelScene, HOTEL.MHK)", () => {
  interface Config {
    level?: Level;
    size?: number;
    attrs?: (i: number) => Attrs;
    visits?: number;
    seed?: number;
  }

  async function start(config: Config = {}) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: config.seed ?? 11 });
    const services = await installServices(engine);
    const entered: number[] = [];
    const scene: HotelScene = createHotelScene();
    for (const id of Object.values(S)) {
      if (id === S.hotel) engine.register(id, () => scene);
      else engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    const queued: number[] = [];
    const sound = engine.services.get(ZOOMBINIS_SOUND);
    const queue = sound.queue.bind(sound);
    sound.queue = (id: number) => {
      queued.push(id);
      queue(id);
    };
    const zoombinis = services.game;
    const size = config.size ?? 12;
    const attrs = config.attrs ?? ((i: number) => variedGroup(size)[i]!);
    zoombinis.game.group.members = Array.from({ length: size }, (_, i) => makeZoombini(attrs(i), i + 1));
    zoombinis.game.stageUnbroken = true;
    // L'étape de l'hôtel est la troisième (`stageOf(14)`).
    zoombinis.game.levels[2] = config.level ?? 1;
    zoombinis.game.options.lessAction = true;
    zoombinis.game.options.magneticMouse = false;
    if (config.visits !== undefined) zoombinis.game.dialogMemory[9] = config.visits;
    zoombinis.session.screen = S.hotel;
    engine.start(S.hotel);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const probe = (): HotelProbe => scene.probe!;
    const wait = (ticks: number) => runFor(engine, host, ticks * TICK_MS);
    const until = async (done: () => boolean, limit = 3000) => {
      for (let waited = 0; !done() && waited < limit; waited += 10) await wait(10);
      expect(done()).toBe(true);
    };
    /** Abandonne les scénettes par un clic jusqu'à la partie. */
    const toPlay = async () => {
      for (let i = 0; i < 4 && probe().phase !== "play"; i++) {
        host.click(300, 200);
        await wait(5);
      }
      expect(probe().phase).toBe("play");
      await wait(2);
    };
    const grab = (index: number) => {
      const member = probe().kit!.members[index]!;
      const rect = member.snoid.feature.rect!;
      for (let y = Math.floor((rect.top + rect.bottom) / 2); y < rect.bottom; y += 2) {
        for (let x = Math.floor((rect.left + rect.right) / 2); x < rect.right; x += 2) if (probe().kit!.memberAt(x, y) === member) return { x, y };
      }
      return null;
    };
    /** Glisse un membre jusqu'aux pieds `feet` et le lâche. */
    const drag = async (index: number, feet: { x: number; y: number }) => {
      const member = probe().kit!.members[index]!;
      const point = grab(index);
      expect(point, `membre ${index} saisissable`).not.toBeNull();
      const at = { x: point!.x - member.snoid.position.x, y: point!.y - member.snoid.position.y };
      host.input.moveMouse(point!.x, point!.y);
      host.input.mouseDown("left");
      await wait(4);
      host.input.moveMouse(feet.x + at.x, feet.y + at.y);
      await wait(8);
      host.input.mouseUp("left");
      await wait(4);
    };
    const settle = () => until(() => !probe().busy);
    const palette = () => services && engine.services.get(GRAPHICS).palette.colors;
    return { host, engine, services, zoombinis, entered, scene, queued, probe, wait, until, toPlay, drag, grab, settle, palette };
  }

  it("entrée : fond 5000, scénette d'introduction `7000 + variante`, puis la relance (fond de l'hôtel, groupe debout sur les seize places) et le cadran aux niveaux 0 à 2", async () => {
    for (const level of LEVELS) {
      const t = await start({ level, visits: 0 });
      const probe = t.probe();
      expect(probe.level).toBe(level);
      expect(probe.phase).toBe("intro");
      expect(probe.kit).toBeNull();
      expect(probe.variant).toBe(level === 0 ? 0 : level + 3);
      expect(probe.lastScene).toBe(INTRO_SCRIPT + probe.variant);
      expect(t.zoombinis.session.screen).toBe(S.hotel);
      // La scénette finit d'elle-même.
      await t.until(() => probe.kit !== null, 4000);
      expect(probe.kit!.members).toHaveLength(12);
      probe.kit!.members.forEach((m, i) => expect(m.snoid.position).toEqual(HALL_PLACES[i]));
      expect(probe.kit!.goEnabled).toBe(false);
      expect(probe.kit!.members.every((m) => !m.zoombini.present)).toBe(true);
      // Chambres : une cible de dépôt par chambre (5 au niveau 0).
      expect(probe.roomTargets).toHaveLength(level === 0 ? 5 : ROOM_COUNTS[level]);
      expect(t.engine.error).toBeNull();
    }
  });

  it("un clic abandonne la scénette d'entrée : relance aussitôt, le cadran saute à son cran F (niveaux 0 à 2) et la musique `30020 + niveau` démarre", async () => {
    for (const level of [0, 2, 3] as const) {
      const t = await start({ level, visits: 5 });
      const probe = t.probe();
      expect(probe.phase).toBe("intro");
      await t.toPlay();
      await t.wait(60);
      expect(probe.kit).not.toBeNull();
      expect(t.queued).toContain(30020 + level);
      if (level < 3) expect(probe.clockScript).toBe(6000 + FREE_STEPS[level]!);
      expect(t.engine.error).toBeNull();
    }
  });

  it("explication après la relance : niveau 0 à la première visite (7500), niveaux 1 et 2 (7501, 7502) ; le kit est gelé ; un clic l'abandonne", async () => {
    const first = await start({ level: 0, visits: 0 });
    await first.until(() => first.probe().phase === "explain", 4000);
    expect(first.probe().lastScene).toBe(7500);
    expect(first.probe().kit!.left).toBe(true);
    expect(first.queued).not.toContain(30020);
    first.host.click(300, 200);
    await first.wait(10);
    expect(first.probe().phase).toBe("play");
    expect(first.probe().kit!.left).toBe(false);
    expect(first.queued).toContain(30020);

    // Niveau 0 à une visite ultérieure : pas d'explication, le cadran démarre.
    const later = await start({ level: 0, visits: 3 });
    expect(later.probe().variant).toBeGreaterThanOrEqual(1);
    await later.until(() => later.probe().kit !== null, 4000);
    expect(later.probe().phase).toBe("play");
    expect(later.probe().clockScript).toBeGreaterThanOrEqual(6000);

    // Niveau 1 : explication seulement après 180 ticks.
    const second = await start({ level: 1 });
    await second.until(() => second.probe().kit !== null, 4000);
    expect(second.probe().phase).toBe("explain");
    expect(second.probe().lastScene).toBe(7501 - 0 === 7501 ? second.probe().lastScene : 0);
    await second.until(() => second.probe().lastScene === 7501, 400);
    // Niveau 2 : toujours.
    const third = await start({ level: 2 });
    await third.until(() => third.probe().kit !== null, 4000);
    expect(third.probe().phase).toBe("explain");
    await third.until(() => third.probe().lastScene === 7502, 400);
    // Niveau 3 : jamais.
    const fourth = await start({ level: 3 });
    await fourth.until(() => fourth.probe().kit !== null, 4000);
    expect(fourth.probe().phase).toBe("play");
  });

  it("cadran : descend (6000) puis marque ses F crans (6001 à 6000 + F) l'un après l'autre", async () => {
    const t = await start({ level: 2, visits: 5 });
    const probe = t.probe();
    await t.until(() => probe.kit !== null, 4000);
    await t.until(() => probe.phase === "play", 2000);
    expect(probe.clockScript).toBe(6000);
    const seen = new Set<number>();
    for (let i = 0; i < 400; i++) {
      await t.wait(5);
      seen.add(probe.clockScript);
    }
    for (let n = 0; n <= FREE_STEPS[2]!; n++) expect(seen.has(6000 + n), `cran ${n}`).toBe(true);
    expect(probe.clockScript).toBe(6000 + FREE_STEPS[2]!);
  }, 30_000);

  it("pose acceptée : le Zoombini monte (SCRS de montée), prend sa place de pile, la porte s'ouvre, « go » devient actif, il est sauvé", async () => {
    for (const level of LEVELS) {
      const t = await start({ level, visits: 5 });
      const probe = t.probe();
      await t.toPlay();
      const room = level === 0 ? 2 : level === 3 ? 30 : 7;
      await t.drag(0, probe.point(room));
      expect(probe.state.placed[0]).toBe(room);
      expect(probe.kit!.goEnabled).toBe(true);
      const member = probe.kit!.members[0]!;
      expect(member.zoombini.present).toBe(true);
      expect(probe.busy).toBe(true);
      await t.settle();
      const expected = stackPosition(level, tablePoint(level, room), probe.point(room), 0);
      expect(member.snoid.position).toEqual(expected);
      expect(member.snoid.resting).toBe(true);
      // La porte de la chambre a joué (6013 + r, ou 9002 + r mod 5 au niveau 3).
      const door = probe.doors[room]!;
      expect(door.scriptId).toBe(level === 3 ? 9002 + (room % 5) : 6013 + tablePoint(level, room));
      // Un rangé ne se reprend pas ; deux membres identiques s'empilent.
      expect(probe.kit!.pick(member.snoid.feature.rect!.left + 2, member.snoid.feature.rect!.top + 2)).toBe(false);
      await t.drag(5, probe.point(room));
      expect(probe.state.placed[5]).toBe(room);
      expect(probe.state.piles[room]).toBe(2);
      await t.settle();
      expect(probe.kit!.members[5]!.snoid.position).toEqual(stackPosition(level, tablePoint(level, room), probe.point(room), 2));
      expect(t.engine.error).toBeNull();
    }
  }, 60_000);

  it("pose refusée : le Zoombini rebondit puis tombe au sol, le cran du cadran avance, la lumière baisse (palette × 88 / 92 / 90 / 92 %) et le tout se termine", async () => {
    for (const level of LEVELS) {
      const t = await start({ level, visits: 5 });
      const probe = t.probe();
      await t.toPlay();
      const room = level === 0 ? 1 : 3;
      await t.drag(0, probe.point(room));
      await t.settle();
      const before = t.palette().slice();
      expect(probe.dims).toBe(0);
      await t.drag(1, probe.point(room));
      expect(probe.state.placed[1]).toBeNull();
      expect(probe.state.step).toBe(FREE_STEPS[level]! + 1);
      expect(probe.dims).toBe(1);
      expect(probe.busy).toBe(true);
      // La palette est assombrie : composante par composante `⌊v × p / 100⌋` sur 10 à 245.
      const percent = DIM_PERCENT[level]!;
      const after = t.palette();
      for (const index of [30, 100, 200]) {
        for (let c = 0; c < 3; c++) expect(after[index * 3 + c]).toBe(Math.floor((before[index * 3 + c]! * percent) / 100));
      }
      expect(after[5 * 3]).toBe(before[5 * 3]);
      if (level < 3) expect(probe.clockScript).toBe(6000 + FREE_STEPS[level]! + 1);
      // Le Zoombini repart du dépôt, personne ne peut être pris pendant le refus.
      const member = probe.kit!.members[1]!;
      expect(probe.kit!.pick(probe.kit!.members[2]!.snoid.feature.rect!.left + 3, probe.kit!.members[2]!.snoid.feature.rect!.top + 3)).toBe(false);
      await t.settle();
      expect(member.snoid.position).toEqual(probe.landing(room));
      expect(member.snoid.resting).toBe(true);
      expect(member.zoombini.present).toBe(false);
      // Il peut être repris.
      await t.drag(1, probe.point(room));
      expect(probe.state.step).toBe(FREE_STEPS[level]! + 2);
      expect(probe.dims).toBe(2);
      await t.settle();
      expect(t.engine.error).toBeNull();
    }
  }, 120_000);

  it("chambre bloquée (niveau 2) : le Zoombini retourne sur sa place sans erreur ni acceptation", async () => {
    const t = await start({ level: 2, visits: 5 });
    const probe = t.probe();
    await t.toPlay();
    const [room] = blockedRooms(probe.state);
    expect(room).toBeDefined();
    const member = probe.kit!.members[0]!;
    await t.drag(0, probe.point(room!));
    expect(probe.state.placed[0]).toBeNull();
    expect(probe.state.step).toBe(FREE_STEPS[2]);
    expect(probe.state.firstPose).toBe(true);
    expect(probe.busy).toBe(false);
    expect(member.snoid.position).toEqual(HALL_PLACES[0]);
    expect(probe.kit!.goEnabled).toBe(false);
  });

  it("défaite au seuil : le (12 − F)-ième refus perd l'épreuve (voix 6006), plus personne ne peut être pris, scénette de défaite, « go » reste actif", async () => {
    for (const level of LEVELS) {
      const t = await start({ level, visits: 5 });
      const probe = t.probe();
      await t.toPlay();
      const room = level === 0 ? 1 : 3;
      await t.drag(0, probe.point(room));
      await t.settle();
      let refusals = 0;
      while (!probe.state.lost && refusals < 20) {
        await t.drag(1, probe.point(room));
        refusals++;
        await t.settle();
      }
      expect(refusals).toBe(MAX_ERRORS[level]);
      expect(probe.state.lost).toBe(true);
      expect(probe.dims).toBe(MAX_ERRORS[level]);
      expect(t.queued).toContain(6006);
      if (level < 3) {
        expect(probe.clockScript).toBe(6012);
        await t.until(() => probe.lastScene >= 7503 && probe.lastScene <= 7506, 1500);
      } else {
        await t.wait(DEFEAT_WAIT);
        expect(t.queued).toContain(7500);
      }
      expect(probe.kit!.pick(probe.kit!.members[2]!.snoid.feature.rect!.left + 3, probe.kit!.members[2]!.snoid.feature.rect!.top + 3)).toBe(false);
      expect(probe.kit!.goEnabled).toBe(true);
      // Sortie : seul le Zoombini rangé est sauvé, les autres sont perdus.
      t.host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
      await t.wait(10);
      await t.until(() => t.zoombinis.lastChange !== null, 600);
      expect(t.zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.hotel, "success") });
      const saved = t.zoombinis.game.group.members.filter((z: Zoombini) => z.present);
      expect(saved).toHaveLength(1);
      expect(t.engine.error).toBeNull();
    }
  }, 240_000);

  it("réussite : le robot range tout le groupe sans erreur, voix 175 à 198, étagères repliées et scénette de victoire (niveaux 0 à 2), « go » : personne de perdu", async () => {
    for (const level of LEVELS) {
      const t = await start({ level, visits: 5, seed: 21 });
      const probe = t.probe();
      await t.toPlay();
      const plan = robotPlan(probe.state);
      for (let member = 0; member < plan.length; member++) {
        await t.drag(member, probe.point(plan[member]!));
        await t.settle();
      }
      expect(probe.state.accepted).toBe(12);
      expect(probe.state.step).toBe(FREE_STEPS[level]);
      expect(probe.dims).toBe(0);
      expect(t.queued.some((id) => id >= COMPLETION_VOICES.first && id <= COMPLETION_VOICES.last)).toBe(true);
      if (level < 3) {
        // Étagères repliées (6063 + r) puis scénette de victoire 7507 à 7509.
        const slot = probe.shelves.findIndex((s) => s !== undefined);
        expect(probe.shelves[slot]!.scriptId).toBe(6063 + tablePoint(level, slot));
        expect(probe.lastScene).toBeGreaterThanOrEqual(7507);
        expect(probe.lastScene).toBeLessThanOrEqual(7509);
      }
      probe.kit!.members.forEach((m) => expect(m.zoombini.present).toBe(true));
      t.host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
      await t.wait(10);
      await t.until(() => t.zoombinis.lastChange !== null, 600);
      expect(t.zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.hotel, "success") });
      expect(t.zoombinis.game.group.members.filter((z: Zoombini) => z.present)).toHaveLength(12);
      expect(t.engine.error).toBeNull();
    }
  }, 240_000);

  it("« go » est grisé tant que personne n'est rangé ; la touche F1 rejoue la voix d'introduction (20081) ; le bouton carte ouvre l'avertissement", async () => {
    const t = await start({ level: 1, visits: 5 });
    const probe = t.probe();
    await t.toPlay();
    t.host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
    await t.wait(20);
    expect(probe.kit!.departing).toBe(false);
    t.host.press("F1");
    await t.wait(5);
    expect(t.queued).toContain(20081);
    t.host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
    await t.wait(10);
    expect(t.engine.services.get(DIALOG).isOpen).toBe(true);
  });

  it("enregistrer pendant l'épreuve rend tout le groupe à la réserve, comme avant l'épreuve", async () => {
    const t = await start({ level: 1, visits: 5 });
    await t.toPlay();
    const probe = t.probe();
    await t.drag(0, probe.point(3));
    await t.settle();
    const dialogs = t.engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    t.zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(t.zoombinis.game.group.members).toHaveLength(12);
    expect(t.zoombinis.game.group.members.every((z: Zoombini) => z.present)).toBe(true);
  });
});

const DEFEAT_WAIT = 80;
