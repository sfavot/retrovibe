import { describe, expect, it, vi } from "vitest";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import { bridgeAvoidCount, nextScreen, setBridgeMemory } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type GameState, type Session, type Zoombini } from "../../../src/games/zoombinis/game/state";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { parseScrb, parseScrs } from "../../../src/games/zoombinis/data/script";
import { createBridgeScene, type BridgeProbe, type BridgeScene } from "../../../src/games/zoombinis/scenes/puzzles/bridge";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";
import {
  ARRIVAL_PLACES,
  BRIDGE_ANCHORS,
  FACE_SNEEZE_TYPES,
  MAX_ERRORS,
  RETURN_RECTS,
  WAITING_PLACES,
  acceptingBridge,
  attempt,
  candidates,
  canStartDecision,
  celebrationPeriod,
  celebrationQuotaGain,
  conditionsOf,
  crossingScript,
  createBridge,
  drawRule,
  faceSneezeType,
  isClosed,
  isRefused,
  lostCount,
  matches,
  packAttrs,
  robot,
  returnSpot,
  satisfies,
  savedCount,
  sneezeScript,
  solve,
  type Bridge,
  type BridgeLevel,
} from "../../../src/games/zoombinis/game/puzzles/bridge";
import type { Attrs } from "../../../src/games/zoombinis/game/state";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const LEVELS: BridgeLevel[] = [0, 1, 2, 3];
const SEEDS = [1, 7, 42, 1234, 99991];

/** Groupe de `n` Zoombinis aux attributs de 1 à 5 tirés avec la graine. */
function group(n: number, seed: number): { attrs: Attrs }[] {
  const rng = new MsvcRandom(seed * 7919 + n);
  return Array.from({ length: n }, () => ({ attrs: [1 + rng.rand(4), 1 + rng.rand(4), 1 + rng.rand(4), 1 + rng.rand(4)] as Attrs }));
}

describe("gorges : règles (BRIDGE, 10c0:131a, 10c0:2059)", () => {
  it("énumère 20, 40, 150 et 500 candidates dans l'ordre de l'original", () => {
    expect(LEVELS.map((level) => candidates(level).length)).toEqual([20, 40, 150, 500]);
    // Niveau 0 : octet 0 (attribut 4) valeurs 1 à 5, puis octet 1 (attribut 3)…
    expect(candidates(0).slice(0, 7)).toEqual([1, 2, 3, 4, 5, 0x100, 0x200]);
    expect(candidates(0)[19]).toBe(0x5000000);
    // Niveau 1 : les dix paires de l'octet 0 d'abord.
    expect(candidates(1).slice(0, 3)).toEqual([0x12, 0x13, 0x14]);
    expect(candidates(1)[10]).toBe(0x1200);
    // Niveau 2 : paire (octet 0, octet 1), le pas (octet 1) en boucle extérieure, la base (octet 0) en boucle intérieure.
    expect(candidates(2).slice(0, 6)).toEqual([0x101, 0x102, 0x103, 0x104, 0x105, 0x201]);
    // Niveau 3 : triplet (octets 0, 1, 2), l'octet 0 varie le plus vite ; le deuxième triplet (0, 1, 3) commence à la 126e.
    expect(candidates(3)[0]).toBe(0x010101);
    expect(candidates(3)[1]).toBe(0x010102);
    expect(candidates(3)[5]).toBe(0x010201);
    expect(candidates(3)[25]).toBe(0x020101);
    expect(candidates(3)[125]).toBe(0x1000101);
    for (const level of LEVELS) expect(new Set(candidates(level)).size).toBe(candidates(level).length);
  });

  it("une candidate est un OU : au niveau 1 chaque octet porte deux valeurs, un octet nul ne correspond jamais", () => {
    const hairOne = packAttrs([1, 3, 3, 3]);
    expect(hairOne).toBe(0x01030303);
    expect(satisfies(0x1000000, 0, [1, 3, 3, 3])).toBe(true);
    expect(satisfies(0x2000000, 0, [1, 3, 3, 3])).toBe(false);
    // Niveau 1 : paire {1, 2} des cheveux (octet 3) → 0x12000000.
    expect(satisfies(0x12000000, 1, [2, 4, 4, 4])).toBe(true);
    expect(satisfies(0x12000000, 1, [1, 4, 4, 4])).toBe(true);
    expect(satisfies(0x12000000, 1, [3, 4, 4, 4])).toBe(false);
    // Les conditions rendent l'attribut (cheveux = 1, pieds = 4).
    expect(conditionsOf(0x12000000, 1)).toEqual([
      { attr: 1, value: 2 },
      { attr: 1, value: 1 },
    ]);
    expect(conditionsOf(0x00000304, 2)).toEqual([{ attr: 4, value: 4 }, { attr: 3, value: 3 }]);
  });

  it("tire une règle qui sépare le groupe en moitiés presque égales, aux quatre niveaux (jamais au-delà de n/2 + 1, point 2 de l'étude)", () => {
    const seen = new Set<number>();
    for (const level of LEVELS) {
      for (let seed = 1; seed <= 200; seed++) {
        const members = group(16, seed);
        const draw = drawRule(new MsvcRandom(seed), level, members);
        const matching = members.filter((member) => matches(draw.rule, member.attrs)).length;
        expect(matching, `niveau ${level} graine ${seed}`).toBe(draw.count);
        expect(draw.count).toBeGreaterThanOrEqual(1);
        expect(draw.count).toBeLessThanOrEqual(9);
        seen.add(draw.count);
        // Le nombre de conditions suit le niveau (au niveau 1 : une valeur de deux attributs identiques).
        const attrs = new Set(draw.rule.conditions.map((condition) => condition.attr));
        expect(draw.rule.conditions.length).toBe(level === 0 ? 1 : level === 1 ? 2 : level);
        expect(attrs.size).toBe(level === 1 || level === 0 ? 1 : level);
        expect(draw.ties).toBeGreaterThanOrEqual(1);
      }
    }
    // La suite de balayage est 8, 9, 7, 6, 5… : 10 et plus ne sortent jamais.
    expect(Math.max(...seen)).toBeLessThanOrEqual(9);
    expect(seen.has(8)).toBe(true);
  });

  it("reproduit le défaut de balayage : l'effectif n/2 + 2 et au-delà n'est jamais testé, on retombe plus bas", () => {
    // 12 cheveux 1 et 4 cheveux 2 ; les trois autres attributs sont constants (effectif 16, hors plage) : seules existent des candidates d'effectif 12 et 4.
    const members = Array.from({ length: 16 }, (_, i) => ({ attrs: [i < 12 ? 1 : 2, 3, 3, 3] as Attrs }));
    const draw = drawRule(new MsvcRandom(5), 0, members);
    expect(draw.count).toBe(4);
    expect(draw.rule.conditions).toEqual([{ attr: 1, value: 2 }]);
    expect(draw.ties).toBe(1);
    // Niveau 0 et une seule candidate : mémoire laissée aux grottes (DS:96ec / 96f0).
    expect(draw.previous).toEqual({ candidate: 0x2000000, count: 4 });
    // Sans candidate utilisable, l'original ne se termine pas : le port lève.
    const same = Array.from({ length: 16 }, () => ({ attrs: [1, 1, 1, 1] as Attrs }));
    expect(() => drawRule(new MsvcRandom(5), 0, same)).toThrow(RangeError);
  });

  it("tire dans l'ordre de l'original : une candidate parmi les égalités, puis le pont (deux tirages)", () => {
    for (const level of LEVELS) {
      const members = group(16, 11 + level);
      const rng = new MsvcRandom(2024);
      const copy = new MsvcRandom(2024);
      const draw = drawRule(rng, level, members);
      // Rejoue à la main : 1 + rand(k − 1) puis rand(1).
      const pick = 1 + copy.rand(draw.ties - 1);
      const upper = copy.rand(1) === 1;
      const equal = candidates(level).filter((candidate) => members.filter((member) => satisfies(candidate, level, member.attrs)).length === draw.count);
      expect(equal.length).toBe(draw.ties);
      expect(draw.candidate).toBe(equal[pick - 1]);
      expect(draw.rule.upperAccepts).toBe(upper);
      expect(rng.current).toBe(copy.current);
    }
  });

  it("graines fixes : la règle est reproductible", () => {
    const first = SEEDS.map((seed) => LEVELS.map((level) => drawRule(new MsvcRandom(seed), level, group(16, seed))));
    const second = SEEDS.map((seed) => LEVELS.map((level) => drawRule(new MsvcRandom(seed), level, group(16, seed))));
    expect(second).toEqual(first);
    // Quelques tirages figés.
    const pinned = drawRule(new MsvcRandom(42), 0, group(16, 42));
    expect(pinned.rule.conditions).toHaveLength(1);
    expect(pinned.count).toBeGreaterThanOrEqual(6);
  });

  it("acceptation (10c0:2059) : chaque Zoombini est accepté par exactement un pont, haut si la règle est vraie et que le haut l'accepte", () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const members = group(16, seed);
        const state = createBridge(new MsvcRandom(seed), level, members);
        for (const attrs of state.attrs) {
          const upperRefuses = isRefused(state.rule, attrs, 1);
          const lowerRefuses = isRefused(state.rule, attrs, 2);
          expect(upperRefuses).not.toBe(lowerRefuses);
          const bridge = acceptingBridge(state.rule, attrs) as Bridge;
          expect(isRefused(state.rule, attrs, bridge)).toBe(false);
          const upperWants = matches(state.rule, attrs) ? state.rule.upperAccepts : !state.rule.upperAccepts;
          expect(bridge).toBe(upperWants ? 1 : 2);
        }
      }
    }
    // Un numéro de pont hors de 1 à 2 vaut 1.
    const state = createBridge(new MsvcRandom(3), 0, group(16, 3));
    expect(isRefused(state.rule, state.attrs[0]!, 7)).toBe(isRefused(state.rule, state.attrs[0]!, 1));
  });

  it("six refus ferment les ponts : plus aucune pose n'est prise, les autres Zoombinis sont perdus", () => {
    const state = createBridge(new MsvcRandom(9), 1, group(16, 9));
    expect(isClosed(state)).toBe(false);
    let refused = 0;
    for (let member = 0; member < 16 && refused < MAX_ERRORS; member++) {
      const wrong = (acceptingBridge(state.rule, state.attrs[member]!) === 1 ? 2 : 1) as Bridge;
      const result = attempt(state, member, wrong)!;
      expect(result.refused).toBe(true);
      refused += 1;
      expect(result.errors).toBe(refused);
      expect(result.closed).toBe(refused === MAX_ERRORS);
    }
    expect(isClosed(state)).toBe(true);
    expect(attempt(state, 15, 1)).toBeNull();
    expect(savedCount(state)).toBe(0);
    expect(lostCount(state)).toBe(16);
    expect(canStartDecision(state, false, 0, 1000)).toBe(false);
  });

  it("sauvés et perdus : les acceptés passent, les refusés comptent une erreur sans passer", () => {
    const state = createBridge(new MsvcRandom(4), 0, group(16, 4));
    const good = attempt(state, 0, acceptingBridge(state.rule, state.attrs[0]!))!;
    expect(good).toMatchObject({ refused: false, errors: 0, closed: false });
    expect(attempt(state, 0, 1)).toBeNull();
    const bad = attempt(state, 1, (acceptingBridge(state.rule, state.attrs[1]!) === 1 ? 2 : 1) as Bridge)!;
    expect(bad).toMatchObject({ refused: true, errors: 1 });
    expect(savedCount(state)).toBe(1);
    expect(lostCount(state)).toBe(15);
    // Un refusé peut recommencer.
    expect(attempt(state, 1, acceptingBridge(state.rule, state.attrs[1]!))).toMatchObject({ refused: false });
  });

  it("départ d'une décision : ponts ouverts, 45 ticks depuis le dernier départ, pas plus de 5 refus à la fois", () => {
    const state = createBridge(new MsvcRandom(4), 0, group(16, 4));
    expect(canStartDecision(state, false, 0, 44)).toBe(false);
    expect(canStartDecision(state, false, 0, 45)).toBe(true);
    expect(canStartDecision(state, true, 4, 45)).toBe(true);
    expect(canStartDecision(state, true, 5, 45)).toBe(false);
    expect(canStartDecision(state, false, 9, 45)).toBe(true);
  });

  it("robot : sauve tout le groupe sans une erreur aux quatre niveaux", () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        for (const size of [16, 9, 4]) {
          const state = createBridge(new MsvcRandom(seed), level, group(size, seed));
          const moves = solve(state);
          expect(moves).toHaveLength(size);
          const done = robot(state);
          expect(done).toEqual(moves);
          expect(state.errors).toBe(0);
          expect(savedCount(state)).toBe(size);
          expect(lostCount(state)).toBe(0);
        }
      }
    }
  });

  it("les deux ponts servent : la règle sépare vraiment le groupe", () => {
    for (const level of LEVELS) {
      const state = createBridge(new MsvcRandom(31), level, group(16, 31));
      const upper = solve(state).filter((move) => move.bridge === 1).length;
      expect(upper).toBeGreaterThan(0);
      expect(upper).toBeLessThan(16);
    }
  });

  it("quotas d'animation et période (« moins d'action »)", () => {
    expect(celebrationPeriod(false)).toBe(60);
    expect(celebrationPeriod(true)).toBe(120);
    const gains = Array.from({ length: 16 }, (_, i) => celebrationQuotaGain(i + 1, 16));
    expect(gains).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 2, 0, 2]);
    expect(gains.reduce((a, b) => a + b, 0)).toBe(6);
  });

  it("scripts : traversée, éternuement par type et visage (SCRS 2000-2019, 1000-1019)", () => {
    expect(crossingScript(2, true, 1)).toBe(2000);
    expect(crossingScript(2, false, 3)).toBe(2007);
    expect(crossingScript(1, true, 5)).toBe(2014);
    expect(crossingScript(1, false, 2)).toBe(2016);
    expect([1, 2, 3, 4, 5].map((type) => sneezeScript(type, 2, 0))).toEqual([1016, 1012, 1008, 1000, 1004]);
    expect([1, 2, 3, 4, 5].map((type) => sneezeScript(type, 1, 1))).toEqual([1019, 1015, 1011, 1003, 1007]);
    expect(faceSneezeType(2, 3)).toBe(4);
    expect(faceSneezeType(1, 5)).toBe(2);
    expect(FACE_SNEEZE_TYPES[1]).toHaveLength(6);
    expect(ARRIVAL_PLACES[1]).toHaveLength(16);
    expect(ARRIVAL_PLACES[2]).toHaveLength(16);
    expect(WAITING_PLACES).toHaveLength(16);
  });

  it("place de retour d'un refusé : dans la falaise, à plus de 6 pixels des autres", () => {
    for (const bridge of [1, 2] as const) {
      const rect = RETURN_RECTS[bridge];
      const rng = new MsvcRandom(8);
      const others: { x: number; y: number }[] = [];
      for (let i = 0; i < 6; i++) {
        const spot = returnSpot(rng, rect, others);
        expect(spot.x).toBeGreaterThanOrEqual(rect.left);
        expect(spot.x).toBeLessThanOrEqual(rect.right + 10);
        expect(spot.y).toBeGreaterThanOrEqual(rect.top);
        expect(spot.y).toBeLessThanOrEqual(rect.bottom);
        for (const other of others) expect((spot.x - other.x) ** 2 + (spot.y - other.y) ** 2).toBeGreaterThanOrEqual(36);
        others.push(spot);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Écran sur les vrais fichiers

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;

/** Un groupe de `count` Zoombinis aux fiches variées (cinq valeurs par attribut). */
function party(count: number): Zoombini[] {
  return Array.from({ length: count }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + ((i * 2) % 5), 1 + ((i * 3) % 5)], i + 1));
}

describe.skipIf(!original.has)("gorges : écran sur les vrais fichiers (BRIDGE.MHK)", () => {
  async function start(setup?: (game: GameState, session: Session) => void, size = 16) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 3 });
    const services = await installServices(engine);
    const entered: number[] = [];
    const scene: BridgeScene = createBridgeScene();
    for (const id of Object.values(S)) {
      if (id === S.bridge) engine.register(id, () => scene);
      else engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    const sound = engine.services.get(ZOOMBINIS_SOUND);
    const queued: number[] = [];
    const queue = sound.queue.bind(sound);
    sound.queue = (id: number) => {
      queued.push(id);
      queue(id);
    };
    const zoombinis = services.game;
    zoombinis.game.group.members = party(size);
    zoombinis.game.stageUnbroken = true;
    // Tous debout (« moins d'action »), transport « relâcher dépose ».
    zoombinis.game.options.lessAction = true;
    zoombinis.game.options.magneticMouse = false;
    setup?.(zoombinis.game, zoombinis.session);
    zoombinis.session.screen = S.bridge;
    engine.start(S.bridge);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const probe = (): BridgeProbe => scene.probe!;
    const wait = (ticks: number) => runFor(engine, host, ticks * TICK_MS);
    /** Avance jusqu'à ce que `done` soit vrai (au plus `limit` ticks). */
    const until = async (done: () => boolean, limit = 1500) => {
      for (let waited = 0; !done() && waited < limit; waited += 10) await wait(10);
      expect(done()).toBe(true);
    };
    /** Point à saisir pour un membre : un point de son rectangle où il est bien le Zoombini le plus en avant. */
    const grab = (index: number) => {
      const member = probe().kit.members[index]!;
      const rect = member.snoid.feature.rect!;
      for (let y = Math.floor((rect.top + rect.bottom) / 2); y < rect.bottom; y += 2) {
        for (let x = Math.floor((rect.left + rect.right) / 2); x < rect.right; x += 2) if (probe().kit.memberAt(x, y) === member) return { x, y };
      }
      return null;
    };
    /** Glisse un membre jusqu'au point `feet` (pieds) et le lâche. */
    const drag = async (index: number, feet: { x: number; y: number }) => {
      const member = probe().kit.members[index]!;
      const point = grab(index);
      expect(point, `membre ${index} saisissable`).not.toBeNull();
      const at = { x: point!.x - member.snoid.position.x, y: point!.y - member.snoid.position.y };
      host.input.moveMouse(point!.x, point!.y);
      host.input.mouseDown("left");
      await wait(4);
      host.input.moveMouse(feet.x + at.x, feet.y + at.y);
      await wait(8);
      host.input.mouseUp("left");
      await wait(6);
    };
    const accepting = (index: number) => acceptingBridge(probe().state.rule, probe().state.attrs[index]!) as Bridge;
    /** Membres debout, les plus en avant d'abord (les mieux saisissables). */
    const byFront = () =>
      probe().kit.members
        .map((m) => m.index)
        .sort((a, b) => probe().kit.members[b]!.snoid.position.y - probe().kit.members[a]!.snoid.position.y);
    return { host, engine, services, zoombinis, entered, scene, sound, queued, probe, wait, until, grab, drag, accepting, byFront, features: engine.services.get(FEATURES), dialog: engine.services.get(DIALOG) };
  }

  it("entre : décor, 16 Zoombinis debout sur leurs places, règle tirée, personne de sauvé, jingle 997, pas de musique", async () => {
    const { probe, zoombinis, queued, sound, features } = await start();
    const { kit, state } = probe();
    expect(zoombinis.session.screen).toBe(S.bridge);
    expect(kit.members).toHaveLength(16);
    kit.members.forEach((m, i) => expect(m.snoid.position).toEqual(WAITING_PLACES[i]));
    expect(kit.members.every((m) => !m.zoombini.present)).toBe(true);
    expect(state.rule.conditions.length).toBeGreaterThan(0);
    expect(state.level).toBe(0);
    expect(probe().statuses.every((status) => status === "wait")).toBe(true);
    expect(kit.goEnabled).toBe(false);
    expect(queued).toContain(997);
    expect(sound.lastMusicId).toBe(0);
    // Décor (zones, visage, clôture, 2 socles, 7 pièces, boutons) et 16 Zoombinis.
    expect(features.features.length).toBeGreaterThanOrEqual(16 + 8);
    expect(zoombinis.game.dialogMemory[1]! & 0xfff).toBe(1);
  });

  it.each(LEVELS)("niveau %i : la règle est tirée au niveau de l'étape (forme et nombre de conditions)", async (level) => {
    const { probe } = await start((game) => (game.levels = [level, 0, 0, 0]));
    expect(probe().state.level).toBe(level);
    const rule = probe().state.rule;
    expect(rule.conditions.length).toBe(level === 0 ? 1 : level === 1 ? 2 : level);
    // Le robot sauve tout le groupe sur la règle de l'écran.
    const state = createBridge(new MsvcRandom(1), level, probe().kit.members.map((m) => m.zoombini));
    expect(robot(state)).toHaveLength(16);
  });

  it.each(LEVELS)("niveau %i : la règle laissée aux grottes (DS:96ec / 96f0) est écrite dans la session, remise à 0 à chaque tirage", async (level) => {
    const { probe, zoombinis } = await start((game, session) => {
      game.levels = [level, 0, 0, 0];
      // Une mémoire plus ancienne est toujours effacée par le tirage (`10c0:131a`).
      setBridgeMemory(session, { candidate: 0x0100, count: 99 });
    });
    const previous = probe().state.previous;
    expect(bridgeAvoidCount(zoombinis.session)).toBe(previous?.count ?? 0);
    if (level > 0) expect(previous).toBeNull();
    expect(bridgeAvoidCount(zoombinis.session)).not.toBe(99);
  });

  it("une pose acceptée traverse : le Zoombini est sauvé, rejoint la falaise de droite et active « go »", async () => {
    const { probe, drag, accepting, wait, until, byFront, queued } = await start();
    const index = byFront().find((i) => accepting(i) === 1)!;
    const member = probe().kit.members[index]!;
    await drag(index, BRIDGE_ANCHORS[1]);
    expect(probe().statuses[index]).toBe("queued");
    expect(member.snoid.position).toEqual(BRIDGE_ANCHORS[1]);
    expect(probe().queue).toHaveLength(1);
    // 45 ticks après l'entrée, la décision part : traversée (+0x127 = 1, donc déjà « sauvé »).
    await until(() => probe().statuses[index] === "crossing");
    expect(member.zoombini.present).toBe(true);
    expect(member.snoid.scriptId).toBe(crossingScript(1, false, member.snoid.traits.feet));
    expect(probe().queue).toHaveLength(0);
    await until(() => probe().statuses[index] === "crossed");
    await until(() => member.snoid.resting);
    expect(member.snoid.position).toEqual(ARRIVAL_PLACES[1][0]);
    expect(probe().kit.goEnabled).toBe(true);
    expect(probe().state.errors).toBe(0);
    expect(savedCount(probe().state)).toBe(1);
    expect(queued).not.toContain(20055);
    await wait(10);
  });

  it("son de marche : un seul canal, deux traversées ne laissent jamais deux sons en boucle (pas, roulettes… : \\0SND 2000 / 2003 répétés 0xffff)", async () => {
    const { host, probe, drag, accepting, until, byFront, queued } = await start();
    const audio = host.audio;
    const playing = () => audio.waves.filter((w) => audio.isWavePlaying(w.handle));
    let maxPlaying = 0;
    // Relevé toutes les 10 ticks (pas de `until`).
    const watch = async (done: () => boolean) => {
      await until(() => {
        maxPlaying = Math.max(maxPlaying, playing().length);
        return done();
      });
    };
    // Pieds 4 et 5 (roulettes, hélice…) : leurs scripts de traversée relancent un son en boucle toutes les deux images.
    const crossers = byFront()
      .filter((i) => probe().kit.members[i]!.snoid.traits.feet >= 4)
      .slice(0, 2);
    expect(crossers).toHaveLength(2);
    for (const index of crossers) {
      const member = probe().kit.members[index]!;
      await drag(index, BRIDGE_ANCHORS[accepting(index)]);
      await watch(() => probe().statuses[index] === "crossed");
      await watch(() => member.snoid.resting);
    }
    // Les pas ont bien été joués, en boucle.
    expect(queued.some((id) => id >= 2000 && id <= 2008)).toBe(true);
    expect(audio.waves.some((w) => w.loop)).toBe(true);
    // Jamais plus d'un son à la fois, donc jamais deux boucles superposées.
    expect(maxPlaying).toBeLessThanOrEqual(1);
    expect(playing().filter((w) => w.loop).length).toBeLessThanOrEqual(1);
  });

  it("une pose refusée revient : une erreur de plus, le visage éternue, il retourne dans la falaise de gauche et peut être repris", async () => {
    const { probe, drag, accepting, until, byFront, features, wait } = await start();
    const index = byFront().find((i) => accepting(i) === 1)!;
    const member = probe().kit.members[index]!;
    // Pont du bas : refusé.
    await drag(index, BRIDGE_ANCHORS[2]);
    await until(() => probe().statuses[index] === "crossing");
    expect(member.zoombini.present).toBe(false);
    expect(member.snoid.scriptId).toBe(crossingScript(2, true, member.snoid.traits.feet));
    // Le visage (1208 + erreurs), la clôture (1215 + erreurs) et le socle (1214) jouent.
    await until(() => features.features.some((f) => f.scriptId === 1208));
    expect(features.features.some((f) => f.scriptId === 1215)).toBe(true);
    expect(features.features.some((f) => f.scriptId === 1214)).toBe(true);
    // Fin de la marche : soufflé en arrière (SCRS 1016 à 1019 : éternuement de type 1 en bas), erreur comptée à la dernière image.
    await until(() => probe().statuses[index] === "sneezing");
    expect(member.snoid.scriptId).toBe(sneezeScript(1, 2, member.snoid.scriptId - 1016));
    expect(probe().state.errors).toBe(0);
    await until(() => probe().state.errors === 1);
    await until(() => probe().statuses[index] === "back");
    await until(() => probe().statuses[index] === "wait");
    const rect = RETURN_RECTS[2];
    expect(member.snoid.position.x).toBeGreaterThanOrEqual(rect.left);
    expect(member.snoid.position.x).toBeLessThanOrEqual(rect.right + 10);
    expect(member.snoid.position.y).toBeGreaterThanOrEqual(rect.top);
    expect(member.snoid.position.y).toBeLessThanOrEqual(rect.bottom);
    expect(member.zoombini.present).toBe(false);
    expect(probe().kit.goEnabled).toBe(false);
    expect(probe().kit.walking).toBe(0);
    // Il peut être repris et posé sur le bon pont.
    await wait(20);
    await drag(index, BRIDGE_ANCHORS[1]);
    await until(() => probe().statuses[index] === "crossed", 2500);
    expect(probe().state.errors).toBe(1);
  });

  it("le sixième refus ferme les ponts : plus aucun Zoombini ne peut être pris, « go » reste éteint", async () => {
    const { probe, drag, accepting, until, byFront, features, host, engine, wait, queued } = await start();
    const order = byFront();
    for (let n = 1; n <= 6; n++) {
      const index = order[n - 1]!;
      const wrong = accepting(index) === 1 ? 2 : 1;
      await drag(index, BRIDGE_ANCHORS[wrong]);
      await until(() => probe().state.errors === n, 2500);
      // L'éternuement n du visage est annoncé à chaque refus ; au dernier, le décor annonce la fin.
      await until(() => probe().statuses[index] === "wait", 1500);
    }
    expect(probe().state.errors).toBe(MAX_ERRORS);
    await until(() => probe().closing);
    // Animation de fin du socle du bas (1221) et de la clôture (1235) ; le socle du haut a disparu.
    expect(features.features.some((f) => f.scriptId === 1221)).toBe(true);
    expect(features.features.some((f) => f.scriptId === 1235)).toBe(true);
    // À la fin de l'animation, la voix de regret part (niveau 0, première visite : toujours).
    await until(() => queued.some((id) => id >= 20045 && id <= 20048));
    // Plus de prise : le septième Zoombini glissé ne bouge pas.
    const index = order[6]!;
    const member = probe().kit.members[index]!;
    const before = { ...member.snoid.position };
    const point = probe().kit.memberAt(member.snoid.position.x, member.snoid.position.y - 10) ? { x: member.snoid.position.x, y: member.snoid.position.y - 10 } : null;
    if (point) {
      host.input.moveMouse(point.x, point.y);
      host.input.mouseDown("left");
      await wait(4);
      host.input.moveMouse(100, 100);
      await wait(8);
      host.input.mouseUp("left");
      await wait(8);
    }
    expect(member.snoid.position).toEqual(before);
    expect(probe().queue).toHaveLength(0);
    expect(probe().kit.goEnabled).toBe(false);
    // « go » est éteint (aucun sauvé) : le clic ne fait rien.
    host.click(620, 460);
    await wait(10);
    expect(probe().kit.departing).toBe(false);
    expect(engine.error).toBeNull();
  }, 60_000);

  it("sortie par « go » : l'écran suivant avec les Zoombinis passés, les autres perdus", async () => {
    const { probe, drag, accepting, until, byFront, host, wait, zoombinis, engine, queued } = await start();
    const chosen = byFront().slice(0, 4);
    for (const index of chosen) {
      await drag(index, BRIDGE_ANCHORS[accepting(index)]);
      await wait(50);
    }
    await until(() => chosen.every((index) => probe().statuses[index] === "crossed"), 2500);
    await until(() => chosen.every((index) => probe().kit.members[index]!.snoid.resting));
    expect(probe().state.errors).toBe(0);
    expect(savedCount(probe().state)).toBe(4);
    expect(queued).not.toContain(20055);
    host.click(620, 460);
    await wait(10);
    expect(probe().kit.departing).toBe(true);
    expect(queued).toContain(996);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 2500);
    expect(engine.error).toBeNull();
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.bridge, "success") });
    const { game } = zoombinis;
    // Les 12 autres sont perdus ; le passage est marqué (bit du niveau 0) mais pas « sans perte ».
    expect(game.successes[0]! & 1).toBe(1);
    expect(game.successes[0]! & 0x10).toBe(0);
    expect(game.group.members.filter((z) => z.present)).toHaveLength(4);
    const lost = game.group.members.length;
    expect(lost).toBe(4);
  }, 60_000);

  it("le robot sauve les seize, la voix de réussite part, « go » mène à l'écran suivant sans perte", async () => {
    const { probe, drag, accepting, until, byFront, host, wait, zoombinis, queued } = await start((game) => (game.levels = [3, 0, 0, 0]));
    expect(probe().state.level).toBe(3);
    for (let n = 0; n < 16; n++) {
      const index = byFront().find((i) => probe().statuses[i] === "wait")!;
      await drag(index, BRIDGE_ANCHORS[accepting(index)]);
      await until(() => probe().queue.length === 0, 400);
    }
    await until(() => probe().statuses.every((status) => status === "crossed"), 4000);
    await until(() => probe().kit.members.every((m) => m.snoid.resting), 600);
    expect(probe().state.errors).toBe(0);
    expect(savedCount(probe().state)).toBe(16);
    expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(true);
    // Les animations d'attente des arrivés : le quota gagne +2 à chaque arrivée quand tout le groupe est déjà parti (comme l'original), 6 au moins.
    expect(probe().celebrations.quota).toBeGreaterThanOrEqual(6);
    await until(() => probe().celebrations.played === probe().celebrations.quota, 3000);
    host.click(620, 460);
    await wait(10);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 3000);
    // Niveau 3 : bit 0x08 (passé) et 0x80 (sans perte).
    expect(zoombinis.game.successes[0]! & 0x88).toBe(0x88);
    expect(zoombinis.game.group.members.filter((z) => z.present)).toHaveLength(16);
  }, 120_000);

  it("les événements des SCRB et des SCRS de l'archive sont ceux que l'écran attend (terminateurs de 10c0:0f68 et 10c0:0e5a)", () => {
    const archive = MohawkArchive.parse(original.read("BRIDGE.MHK"));
    const events = (script: { images: { event: number }[] }) => script.images.map((image) => image.event - 1);
    // Traversées : refus au pont du bas / du haut (2000-2004, 2010-2014) finissent par l'événement 10 ; acceptés (2005-2009, 2015-2019) par 3 (bas) et 6 (haut).
    for (let feet = 0; feet < 5; feet++) {
      const lowerRefused = events(parseScrs(archive.get("SCRS", 2000 + feet)));
      const lowerAccepted = events(parseScrs(archive.get("SCRS", 2005 + feet)));
      const upperRefused = events(parseScrs(archive.get("SCRS", 2010 + feet)));
      const upperAccepted = events(parseScrs(archive.get("SCRS", 2015 + feet)));
      expect(lowerRefused.at(-1)).toBe(10);
      expect(upperRefused.at(-1)).toBe(10);
      expect(lowerAccepted.at(-1)).toBe(3);
      expect(upperAccepted.at(-1)).toBe(6);
      // Début : 1 (refus bas), 2 (refus haut), 4 (accepté bas), 5 (accepté haut) : le socle à secouer.
      expect(lowerRefused.find((n) => n > 0)).toBe(1);
      expect(upperRefused.find((n) => n > 0)).toBe(2);
      expect(lowerAccepted.find((n) => n > 0)).toBe(4);
      expect(upperAccepted.find((n) => n > 0)).toBe(5);
    }
    // Réactions : l'événement 20 à la dernière image.
    for (let id = 1000; id <= 1019; id++) expect(events(parseScrs(archive.get("SCRS", id))).at(-1), `SCRS ${id}`).toBe(20);
    // Visage : le type d'éternuement (événement 1 à 5) est annoncé par la troisième image, et suit FACE_SNEEZE_TYPES ; le sixième refus porte l'événement 0 (fin des ponts).
    for (const [bridge, first] of [[2, 1208], [1, 1223]] as const) {
      for (let n = 0; n < 6; n++) {
        const ev = events(parseScrb(archive.get("SCRB", first + n)));
        const type = ev.slice(0, 4).find((e) => e >= 1 && e <= 6)!;
        expect(type, `SCRB ${first + n}`).toBe(FACE_SNEEZE_TYPES[bridge][n]);
        expect(ev.includes(0), `SCRB ${first + n}`).toBe(n === 5);
      }
    }
    // Fermeture : 1221 change le décor 1103 (événements 100 puis 101).
    const closing = events(parseScrb(archive.get("SCRB", 1221))).filter((n) => n >= 100);
    expect(closing).toEqual([100, 101]);
  });

  it("une partie enregistrée pendant l'épreuve retrouve le groupe entier (perdus compris) ; le crochet est retiré à la sortie", async () => {
    const { engine, zoombinis, probe, scene, drag, accepting, until, byFront } = await start();
    const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    const index = byFront().find((i) => accepting(i) === 1)!;
    await drag(index, BRIDGE_ANCHORS[1]);
    await until(() => probe().statuses[index] === "crossing");
    zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(zoombinis.game.group.members).toHaveLength(16);
    expect(zoombinis.game.group.members.every((z) => z.present)).toBe(true);
    // Retour à la carte par le bouton : le crochet est retiré.
    scene.leave(engine.ctx);
    expect(dialogs.beforeSave).toHaveLength(0);
  });

  it("partie neuve (arrivée à pied, transport collé) : un dépôt sur chacun des ponts va jusqu'à la traversée ou au refus", async () => {
    const { probe, host, wait, until, accepting, byFront } = await start((game) => {
      game.options.lessAction = false;
      game.options.magneticMouse = true;
    });
    await wait(900);
    for (const bridge of [1, 2] as const) {
      const index = byFront().find((i) => probe().statuses[i] === "wait")!;
      const member = probe().kit.members[index]!;
      const rect = member.snoid.feature.rect!;
      let point = { x: 0, y: 0 };
      for (let y = Math.floor((rect.top + rect.bottom) / 2); y < rect.bottom; y += 2) {
        const x = Math.floor((rect.left + rect.right) / 2);
        if (probe().kit.memberAt(x, y) === member) {
          point = { x, y };
          break;
        }
      }
      const at = { x: point.x - member.snoid.position.x, y: point.y - member.snoid.position.y };
      host.click(point.x, point.y);
      await wait(6);
      host.input.moveMouse(BRIDGE_ANCHORS[bridge].x + at.x, BRIDGE_ANCHORS[bridge].y + at.y);
      await wait(8);
      host.click(BRIDGE_ANCHORS[bridge].x + at.x, BRIDGE_ANCHORS[bridge].y + at.y);
      await wait(6);
      await until(() => probe().statuses[index] !== "queued" && probe().statuses[index] !== "wait", 400);
      const refused = accepting(index) !== bridge;
      await until(() => (refused ? probe().statuses[index] === "wait" && probe().state.errors > 0 : probe().statuses[index] === "crossed"), 2500);
      await until(() => probe().kit.walking === 0, 600);
      await wait(60);
    }
  }, 60_000);

  it("F1 ne fait rien d'audible (pas de voix d'introduction) et le bouton carte demande l'avertissement", async () => {
    const { host, engine, wait, dialog, queued } = await start();
    host.press("F1", { key: "F1" });
    await wait(6);
    expect(queued.filter((id) => id >= 20000)).toEqual([]);
    host.click(620, 420);
    await wait(6);
    expect(dialog.isOpen).toBe(true);
    host.press("Enter");
    await wait(10);
    expect(engine.error).toBeNull();
  });
});
