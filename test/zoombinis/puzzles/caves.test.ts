import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { parseScrb, parseScrs } from "../../../src/games/zoombinis/data/script";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import {
  FLOOR_RECTS,
  HIEROGLYPH_X,
  HIEROGLYPH_Y,
  LION_BASE_SCRIPT,
  LION_LAST_SCRIPT,
  LION_STEPS,
  SLOT_ANCHORS,
  SLOT_COUNT,
  SLOT_FACING,
  SLOT_IDLE_VARIANT,
  SORT_ROWS,
  WAITING_PLACES,
  createCaves,
  drawHints,
  drawRule,
  fittingSlots,
  goEnabled,
  layoutSlots,
  lionAtLast,
  lionLimit,
  lostCount,
  onFloor,
  placeMember,
  regretVoiceDue,
  robot,
  savedMembers,
  slotFits,
  wakeLion,
  type CavesLevel,
} from "../../../src/games/zoombinis/game/puzzles/caves";
import { nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type Attrs, type GameState, type Session, type Zoombini } from "../../../src/games/zoombinis/game/state";
import { createCavesScene, type CavesProbe, type CavesScene } from "../../../src/games/zoombinis/scenes/puzzles/caves";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const LEVELS: CavesLevel[] = [0, 1, 2, 3];
const SEEDS = [1, 7, 42, 1234, 99991];

/** Groupe de `n` Zoombinis aux attributs de 1 à 5 tirés avec la graine. */
function group(n: number, seed: number): Attrs[] {
  const rng = new MsvcRandom(seed * 7919 + n);
  return Array.from({ length: n }, () => [1 + rng.rand(4), 1 + rng.rand(4), 1 + rng.rand(4), 1 + rng.rand(4)] as Attrs);
}

describe("sphinx : règles (CAVES, 10c8:201a, 10c8:2279, 10c8:2508, 10c8:2635)", () => {
  it("fixe les réglages de chaque niveau : crans du lion, script de base, rangées de tri", () => {
    expect(LEVELS.map((level) => LION_STEPS[level])).toEqual([4, 5, 6, 7]);
    expect(LEVELS.map((level) => LION_BASE_SCRIPT[level])).toEqual([6006, 6005, 6004, 6003]);
    expect(LEVELS.map((level) => SORT_ROWS[level])).toEqual([1, 1, 2, 2]);
    // Le dernier cran joue toujours le dernier script (6010), quel que soit le niveau.
    for (const level of LEVELS) expect(LION_BASE_SCRIPT[level] + LION_STEPS[level]).toBe(LION_LAST_SCRIPT);
  });

  it("tire des attributs distincts et deux permutations de 1 à 5, toujours (même quand B ne sert pas)", () => {
    for (const seed of SEEDS) {
      const rule = drawRule(new MsvcRandom(seed));
      expect(rule.attrA).not.toBe(rule.attrB);
      for (const attr of [rule.attrA, rule.attrB]) {
        expect(attr).toBeGreaterThanOrEqual(0);
        expect(attr).toBeLessThanOrEqual(3);
      }
      expect([...rule.orderA].sort()).toEqual([1, 2, 3, 4, 5]);
      expect([...rule.orderB].sort()).toEqual([1, 2, 3, 4, 5]);
    }
    // Reproductible avec la graine ; plusieurs règles distinctes.
    expect(drawRule(new MsvcRandom(42))).toEqual(drawRule(new MsvcRandom(42)));
    expect(new Set(SEEDS.map((seed) => JSON.stringify(drawRule(new MsvcRandom(seed))))).size).toBeGreaterThan(3);
    // Toutes les valeurs d'attribut sortent sur 400 graines.
    const seenA = new Set<number>();
    for (let seed = 1; seed <= 400; seed++) seenA.add(drawRule(new MsvcRandom(seed)).attrA);
    expect([...seenA].sort()).toEqual([0, 1, 2, 3]);
  });

  it("tire dans l'ordre de l'original : A, sa permutation, B, sa permutation (13 tirages, dont 4 nuls consommés à vide)", () => {
    for (const seed of SEEDS) {
      const rng = new MsvcRandom(seed);
      const copy = new MsvcRandom(seed);
      const rule = drawRule(rng);
      // Rejoue à la main : `04e8(3, 0)`, 4 tirages (5, 4, 3, 2 ; le 5e est `04e8(1, 1)` sans tirage), `04e8(2, 0)`, 4 tirages.
      const attrs = [0, 1, 2, 3];
      const pickA = copy.rand(3);
      expect(rule.attrA).toBe(attrs[pickA]);
      attrs.splice(pickA, 1);
      const play = (): number[] => {
        const values = [1, 2, 3, 4, 5];
        const order: number[] = [];
        for (let left = 5; left >= 1; left--) {
          const at = copy.rand(left - 1);
          order.push(values[at]!);
          values.splice(at, 1);
        }
        return order;
      };
      expect(rule.orderA).toEqual(play());
      const pickB = copy.rand(2);
      expect(rule.attrB).toBe(attrs[pickB]);
      expect(rule.orderB).toEqual(play());
      // Les deux générateurs ont consommé exactement le même nombre de tirages.
      expect(rng.current).toBe(copy.current);
    }
  });

  it("dispose les dalles en blocs consécutifs par valeur de A (sous-blocs par B aux niveaux 3 et 4), toujours solubles", () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        for (const size of [1, 2, 7, 11, 16]) {
          const attrs = group(size, seed);
          const rule = drawRule(new MsvcRandom(seed + 1));
          const layout = layoutSlots(rule, level, attrs);
          expect(layout.first).toBe(21 - size);
          expect(layout.fillers).toBe(Math.min(4, 20 - size));
          // Les dalles du groupe sont toutes affectées, les autres jamais.
          for (let s = 1; s <= 20; s++) expect(layout.needA[s] !== 0, `niveau ${level} dalle ${s}`).toBe(s >= layout.first);
          // Blocs de A dans l'ordre de la permutation, de la taille du nombre de Zoombinis de cette valeur.
          const sequence = layout.needA.slice(layout.first);
          const blocks = rule.orderA.map((v) => attrs.filter((a) => a[rule.attrA] === v).length);
          expect(sequence).toEqual(rule.orderA.flatMap((v, i) => new Array<number>(blocks[i]!).fill(v)));
          // Exactement une dalle par Zoombini dans chaque classe.
          for (let v = 1; v <= 5; v++) expect(sequence.filter((x) => x === v).length).toBe(attrs.filter((a) => a[rule.attrA] === v).length);
          if (SORT_ROWS[level] === 2) {
            let cursor = layout.first;
            for (const v of rule.orderA) {
              for (const w of rule.orderB) {
                const n = attrs.filter((a) => a[rule.attrA] === v && a[rule.attrB] === w).length;
                for (let k = 0; k < n; k++) expect(layout.needB[cursor + k]).toBe(w);
                cursor += n;
              }
            }
          } else {
            expect(layout.needB.every((x) => x === 0)).toBe(true);
          }
        }
      }
    }
    expect(() => layoutSlots(drawRule(new MsvcRandom(1)), 0, group(21, 1))).toThrow(RangeError);
  });

  it("indices : 5 hiéroglyphes au niveau 1, 2 au niveau 2, 2 + 2 au niveau 3, aucun au niveau 4 ; image = valeur + 5 × attribut", () => {
    const expected: Record<CavesLevel, [number, number]> = { 0: [5, 0], 1: [2, 0], 2: [2, 2], 3: [0, 0] };
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const rule = drawRule(new MsvcRandom(seed));
        const hints = drawHints(new MsvcRandom(seed + 5), level, rule);
        const rowA = hints.filter((h) => h.slot <= 5);
        const rowB = hints.filter((h) => h.slot > 5);
        expect([rowA.length, rowB.length], `niveau ${level}`).toEqual(expected[level]);
        for (const hint of hints) {
          const k = (hint.slot - 1) % 5;
          const row = hint.slot <= 5;
          expect(hint.image).toBe((row ? rule.orderA : rule.orderB)[k]! + 5 * (row ? rule.attrA : rule.attrB));
          expect(hint.image).toBeGreaterThanOrEqual(1);
          expect(hint.image).toBeLessThanOrEqual(20);
        }
        expect(new Set(hints.map((h) => h.slot)).size).toBe(hints.length);
      }
    }
    // Le niveau 2 en montre deux emplacements différents : toutes les paires sortent sur de nombreuses graines.
    const pairs = new Set<string>();
    for (let seed = 1; seed <= 300; seed++) {
      pairs.add(
        drawHints(new MsvcRandom(seed), 1, drawRule(new MsvcRandom(seed)))
          .map((h) => h.slot)
          .join(","),
      );
    }
    expect(pairs.size).toBe(10);
    // Seuls les niveaux 2 et 3 tirent : aucun tirage de plus aux niveaux 1 et 4.
    for (const level of [0, 3] as const) {
      const rng = new MsvcRandom(9);
      drawHints(rng, level, drawRule(new MsvcRandom(9)));
      expect(rng.current).toBe(new MsvcRandom(9).current);
    }
  });

  it("tire les indices du niveau 2 sans remise, comme `10c8:2279` (`04e8(5, 1)` puis `04e8(4, 1)`)", () => {
    for (const seed of SEEDS) {
      const rule = drawRule(new MsvcRandom(seed));
      const rng = new MsvcRandom(seed + 77);
      const hints = drawHints(rng, 1, rule);
      const copy = new MsvcRandom(seed + 77);
      const list = [0, 1, 2, 3, 4, 5, 6];
      const slots: number[] = [];
      for (const left of [5, 4]) {
        const at = 1 + copy.rand(left - 1);
        slots.push(list[at]!);
        list.splice(at, 1);
      }
      expect(hints.map((h) => h.slot)).toEqual([...slots].sort((a, b) => a - b));
    }
  });

  it("une pose sur une dalle valable y reste ; sinon une dalle libre valide est tirée au hasard (jamais la dalle lâchée), le lion ne bouge pas encore", () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        const attrs = group(16, seed);
        const rng = new MsvcRandom(seed);
        const state = createCaves(rng, level, attrs);
        const good = fittingSlots(state, 0);
        expect(good.length).toBeGreaterThan(0);
        const right = placeMember(state, rng, 0, good[good.length - 1]!);
        expect(right).toMatchObject({ correct: true, first: true, complete: false, slot: good[good.length - 1] });
        // Un autre Zoombini lâché sur une dalle qui ne lui convient pas.
        const wrong = [...Array(21).keys()].find((s) => s >= state.layout.first && state.occupant[s] === -1 && !slotFits(state, s, 1))!;
        const fits = fittingSlots(state, 1);
        const placement = placeMember(state, rng, 1, wrong);
        expect(placement.correct).toBe(false);
        expect(placement.dropped).toBe(wrong);
        expect(fits).toContain(placement.slot);
        expect(state.occupant[placement.slot]).toBe(1);
        expect(state.occupant[wrong]).toBe(-1);
        expect(placement.first).toBe(false);
        expect(state.placed).toBe(2);
        expect(state.lion).toBe(0);
        // Une dalle occupée est refusée : le Zoombini suivant, lâché sur elle, est replacé ailleurs.
        const taken = good[good.length - 1]!;
        const sameClass = attrs.findIndex((a, i) => i > 1 && a[state.rule.attrA] === attrs[0]![state.rule.attrA] && (state.rows < 2 || a[state.rule.attrB] === attrs[0]![state.rule.attrB]));
        if (sameClass >= 0) {
          const third = placeMember(state, rng, sameClass, taken);
          expect(third.correct).toBe(false);
          expect(third.slot).not.toBe(taken);
        }
        expect(() => placeMember(state, rng, 0, good[0]!)).toThrow();
      }
    }
  });

  it("le tirage de repli est `04e8(n − 1, 0)` parmi les n dalles libres valides, dans l'ordre du chemin", () => {
    for (const seed of SEEDS) {
      const attrs = group(16, seed);
      const state = createCaves(new MsvcRandom(seed), 3, attrs);
      const choices = fittingSlots(state, 3);
      const wrong = [...Array(21).keys()].find((s) => s >= state.layout.first && !choices.includes(s))!;
      const rng = new MsvcRandom(seed * 3);
      const copy = new MsvcRandom(seed * 3);
      const placement = placeMember(state, rng, 3, wrong);
      expect(placement.slot).toBe(choices[copy.rand(choices.length - 1)]);
      expect(rng.current).toBe(copy.current);
    }
  });

  it("le lion monte d'un cran par rejet (script base + cran) ; au dernier cran la pose est verrouillée", () => {
    for (const level of LEVELS) {
      const state = createCaves(new MsvcRandom(5), level, group(16, 5));
      expect(lionLimit(state)).toBe(LION_STEPS[level]);
      expect(lionAtLast(state)).toBe(false);
      for (let cran = 1; cran <= LION_STEPS[level]; cran++) {
        expect(wakeLion(state)).toBe(LION_BASE_SCRIPT[level] + cran);
        expect(lionAtLast(state)).toBe(cran === LION_STEPS[level]);
      }
      expect(wakeLion(state)).toBeNull();
    }
  });

  it("phrase de consolation : seulement s'il reste des Zoombinis hors des dalles, selon le tirage et le nombre de visites", () => {
    const state = createCaves(new MsvcRandom(5), 2, group(16, 5));
    expect(regretVoiceDue(state, 4, 99)).toBe(true);
    expect(regretVoiceDue(state, 2, 99)).toBe(false);
    expect(regretVoiceDue(state, 0, 3)).toBe(true);
    expect(regretVoiceDue(state, 0, 4)).toBe(false);
    const all = createCaves(new MsvcRandom(5), 2, group(2, 5));
    robot(all).forEach((slot, member) => placeMember(all, new MsvcRandom(1), member, slot));
    expect(regretVoiceDue(all, 4, 0)).toBe(false);
  });

  it("le robot pose tout le groupe sans réveiller le lion, aux quatre niveaux et pour toutes les tailles de groupe", () => {
    for (const level of LEVELS) {
      for (const seed of SEEDS) {
        for (const size of [1, 3, 8, 14, 16]) {
          const attrs = group(size, seed);
          const rng = new MsvcRandom(seed);
          const state = createCaves(rng, level, attrs);
          const slots = robot(state);
          expect(new Set(slots).size).toBe(size);
          const before = rng.current;
          slots.forEach((slot, member) => {
            const placement = placeMember(state, rng, member, slot);
            expect(placement.correct, `niveau ${level} membre ${member}`).toBe(true);
            expect(placement.complete).toBe(member === size - 1);
          });
          // Aucun tirage de repli, aucun cran.
          expect(rng.current).toBe(before);
          expect(state.lion).toBe(0);
          expect(state.placed).toBe(size);
          expect(savedMembers(state)).toHaveLength(size);
          expect(lostCount(state)).toBe(0);
          expect(goEnabled(state)).toBe(true);
          // Les dalles sont triées par blocs : le premier Zoombini de chaque bloc est dans l'ordre de la permutation.
          const order = state.occupant.slice(state.layout.first).map((m) => attrs[m]![state.rule.attrA]);
          const firsts = order.filter((v, i) => i === 0 || order[i - 1] !== v);
          expect(firsts).toEqual(state.rule.orderA.filter((v) => order.includes(v)));
        }
      }
    }
  });

  it("poser plus de rejets que de places libres est impossible : chaque classe a exactement autant de dalles que de Zoombinis", () => {
    for (const level of LEVELS) {
      const attrs = group(16, 3);
      const rng = new MsvcRandom(3);
      const state = createCaves(rng, level, attrs);
      // Tout le groupe lâché sur la dalle 20 (valable pour un seul d'entre eux au mieux) : tous sont replacés sur une dalle libre valide.
      attrs.forEach((_a, member) => {
        const placement = placeMember(state, rng, member, 20);
        expect(state.occupant[placement.slot]).toBe(member);
      });
      expect(state.placed).toBe(16);
      expect(new Set(state.occupant.slice(state.layout.first)).size).toBe(16);
    }
  });

  it("le sol est l'escalier de gauche (11 rectangles) ; le reste de l'écran est le gouffre", () => {
    expect(FLOOR_RECTS).toHaveLength(11);
    expect(onFloor(100, 100)).toBe(true);
    expect(onFloor(195, 130)).toBe(true);
    expect(onFloor(0, 0)).toBe(true);
    expect(onFloor(30, 380)).toBe(true);
    expect(onFloor(196, 100)).toBe(false);
    expect(onFloor(300, 400)).toBe(false);
    expect(onFloor(600, 100)).toBe(false);
    // Chaque place d'attente est sur le sol, aucune dalle n'y est.
    for (const place of WAITING_PLACES) expect(onFloor(place.x, place.y), `place ${place.x},${place.y}`).toBe(true);
    for (const anchor of SLOT_ANCHORS) expect(onFloor(anchor.x, anchor.y)).toBe(false);
  });

  it("tables relevées dans ZOOMBINI.EXE : 20 dalles, 20 places, variantes d'attente 1 ou 2, 6 dalles tournées à gauche, 10 emplacements de hiéroglyphes", () => {
    expect(SLOT_ANCHORS).toHaveLength(SLOT_COUNT);
    expect(WAITING_PLACES).toHaveLength(20);
    expect(SLOT_IDLE_VARIANT.every((v) => v === 1 || v === 2)).toBe(true);
    expect(SLOT_FACING.reduce<number>((sum, f) => sum + f, 0)).toBe(6);
    expect(SLOT_FACING.map((f, i) => (f ? i + 1 : 0)).filter(Boolean)).toEqual([5, 6, 7, 17, 18, 19]);
    expect(HIEROGLYPH_X).toHaveLength(11);
    expect(HIEROGLYPH_Y).toHaveLength(11);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Écran sur les vrais fichiers

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;
const setLevel = (level: number) => (game: GameState) => (game.levels = [level, level, level, level]);

/** Un groupe de `count` Zoombinis aux fiches variées (cinq valeurs par attribut). */
function party(count: number): Zoombini[] {
  return Array.from({ length: count }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + ((i * 2) % 5), 1 + ((i * 3) % 5)], i + 1));
}

describe.skipIf(!original.has)("sphinx : écran sur les vrais fichiers (CAVES.MHK)", () => {
  async function start(setup?: (game: GameState, session: Session) => void, size = 16) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 3 });
    const services = await installServices(engine);
    const entered: number[] = [];
    const scene: CavesScene = createCavesScene();
    for (const id of Object.values(S)) {
      if (id === S.caves) engine.register(id, () => scene);
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
    zoombinis.session.screen = S.caves;
    engine.start(S.caves);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const probe = (): CavesProbe => scene.probe!;
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
    const state = () => probe().state;
    /** Dalle exacte d'un membre (robot) et une dalle libre qui ne lui convient pas. */
    const rightSlot = (index: number) => fittingSlots(state(), index)[0]!;
    const wrongSlot = (index: number) => {
      for (let s = state().layout.first; s <= 20; s++) if (state().occupant[s] === -1 && !slotFits(state(), s, index)) return s;
      throw new Error("pas de dalle refusée");
    };
    /** Membres debout, les plus en avant d'abord (les mieux saisissables). */
    const byFront = () =>
      probe().kit.members
        .map((m) => m.index)
        .filter((i) => state().slotOf[i] === 0)
        .sort((a, b) => probe().kit.members[b]!.snoid.position.y - probe().kit.members[a]!.snoid.position.y);
    const anchor = (slot: number) => SLOT_ANCHORS[slot - 1]!;
    /** Membres debout que l'on peut saisir (pas cachés par un autre). */
    const grabbable = () => byFront().filter((i) => grab(i) !== null);
    return {
      host,
      engine,
      services,
      zoombinis,
      entered,
      scene,
      sound,
      queued,
      probe,
      state,
      wait,
      until,
      grab,
      drag,
      rightSlot,
      wrongSlot,
      byFront,
      anchor,
      grabbable,
      features: engine.services.get(FEATURES),
      dialog: engine.services.get(DIALOG),
    };
  }

  it("entre : décor, 16 Zoombinis debout sur leurs places, règle tirée, hiéroglyphes, personne de posé, lion au premier cran, musique", async () => {
    const { probe, zoombinis, queued, features, state } = await start();
    const { kit } = probe();
    expect(zoombinis.session.screen).toBe(S.caves);
    expect(kit.members).toHaveLength(16);
    kit.members.forEach((m, i) => expect(m.snoid.position).toEqual(WAITING_PLACES[i]));
    expect(kit.members.every((m) => !m.zoombini.present)).toBe(true);
    expect(state().level).toBe(0);
    expect(state().hints).toHaveLength(5);
    expect(state().layout.first).toBe(5);
    expect(probe().locked).toBe(false);
    expect(probe().busy).toBe(false);
    expect(probe().leaving).toBeNull();
    expect(kit.goEnabled).toBe(false);
    // Musique 30025 + niveau, pas de jingle d'entrée.
    expect(queued).toContain(30025);
    expect(queued).not.toContain(997);
    // Tête du lion : première image du script du premier cran.
    expect(probe().lionScript).toBe(6007);
    // Seules les dalles du groupe sont des cibles (4 dalles de remplissage).
    expect(probe().slots.filter(Boolean)).toHaveLength(16);
    expect(probe().slots.slice(1, 5).every((t) => t === undefined)).toBe(true);
    // Décor (2 pattes, éveil, remplissage, 20 dalles, décor, tête, hiéroglyphes, boutons) et 16 Zoombinis.
    expect(features.features.length).toBeGreaterThanOrEqual(16 + 28);
    // Une visite de plus de l'écran (mémoire de dialogue 12).
    expect(zoombinis.game.dialogMemory[12]! & 0xfff).toBe(1);
  });

  it.each(LEVELS)("niveau %i : règle, rangées de tri, indices, lion et musique de ce niveau", async (level) => {
    const { probe, queued, state } = await start((game) => (game.levels = [level, level, level, level]));
    expect(state().level).toBe(level);
    expect(state().rows).toBe(SORT_ROWS[level]);
    expect(state().hints.length).toBe([5, 2, 4, 0][level]);
    expect(probe().lionScript).toBe(LION_BASE_SCRIPT[level] + 1);
    expect(lionLimit(state())).toBe(LION_STEPS[level]);
    // Musique aux trois premiers niveaux seulement (`[7106] < 4`).
    const music = queued.filter((id) => id >= 30000);
    expect(music).toEqual(level <= 2 ? [30025 + level] : []);
    // Le robot sur la règle de l'écran pose tout le groupe.
    const copy = createCaves(new MsvcRandom(1), level, state().attrs);
    expect(robot(copy)).toHaveLength(16);
  });

  it("une pose juste reste sur la dalle : posé, « go » actif, dalle libérée aux autres, pas de cran, pas à pas sur place", async () => {
    const { probe, drag, rightSlot, byFront, anchor, until, state, queued } = await start();
    const index = byFront()[0]!;
    const slot = rightSlot(index);
    const member = probe().kit.members[index]!;
    await drag(index, anchor(slot));
    expect(state().slotOf[index]).toBe(slot);
    expect(state().lion).toBe(0);
    expect(member.zoombini.present).toBe(true);
    expect(member.snoid.position).toEqual(anchor(slot));
    expect(probe().kit.goEnabled).toBe(true);
    expect(probe().locked).toBe(false);
    expect(probe().busy).toBe(false);
    expect(probe().slots[slot]!.owner).toBe(member);
    // Le pas sur place (`SCRS` 12999 + pieds), puis la pose d'attente de la dalle (variante et sens).
    expect(member.snoid.scriptId).toBe(12999 + member.snoid.traits.feet);
    await until(() => member.snoid.resting);
    expect(member.snoid.idleVariant).toBe(SLOT_IDLE_VARIANT[slot - 1]);
    expect(queued.filter((id) => id >= 20000 && id < 30000)).toEqual([]);
    // Un Zoombini posé ne se reprend pas.
    expect(probe().kit.members[index]!.snoid.position).toEqual(anchor(slot));
  });

  it("une pose fausse est replacée : la dalle se retourne, il saute sur une dalle valable, le lion monte d'un cran, saisie verrouillée entre-temps", async () => {
    const { probe, drag, wrongSlot, byFront, anchor, until, state, features, wait } = await start();
    const index = byFront()[0]!;
    const member = probe().kit.members[index]!;
    const wrong = wrongSlot(index);
    const fits = fittingSlots(state(), index);
    await drag(index, anchor(wrong));
    // Replacé tout de suite côté règles (dalle valable occupée), cran du lion pas encore monté, saisie verrouillée.
    expect(state().slotOf[index]).not.toBe(wrong);
    expect(fits).toContain(state().slotOf[index]);
    expect(state().lion).toBe(0);
    expect(member.zoombini.present).toBe(true);
    expect(probe().kit.goEnabled).toBe(true);
    expect(probe().locked).toBe(true);
    expect(probe().busy).toBe(true);
    // Retournement de la dalle lâchée (`SCRB` 8200 + 4(s − 1)), le Zoombini rebondit (`SCRS` 12004).
    await until(() => features.features.some((f) => f.scriptId === 8200 + 4 * (wrong - 1)));
    await until(() => member.snoid.scriptId === 12004);
    // Puis retournement de la dalle valable (`+ 2`) et saut (`SCRS` 12005) jusqu'à son ancre.
    const right = state().slotOf[index];
    await until(() => features.features.some((f) => f.scriptId === 8202 + 4 * (right - 1)));
    await until(() => member.snoid.scriptId === 12005);
    // Le lion monte à la fin du saut, la saisie se rouvre à la fin de son animation.
    await until(() => state().lion === 1);
    expect(probe().lionScript).toBe(6007);
    expect(probe().locked).toBe(true);
    await until(() => !probe().locked, 400);
    expect(probe().busy).toBe(false);
    expect(member.snoid.position).toEqual(anchor(right));
    expect(probe().slots[right]!.owner).toBe(member);
    expect(probe().slots[wrong]!.owner).toBeNull();
    await until(() => member.snoid.resting);
    expect(member.snoid.idleVariant).toBe(SLOT_IDLE_VARIANT[right - 1]);
    await wait(5);
  });

  it("pendant un rejet, la saisie est refusée ; elle reprend après", async () => {
    const { probe, drag, wrongSlot, byFront, anchor, until, host, wait, state } = await start();
    const [first, second] = byFront();
    await drag(first!, anchor(wrongSlot(first!)));
    expect(probe().locked).toBe(true);
    const member = probe().kit.members[second!]!;
    const rect = member.snoid.feature.rect!;
    const x = Math.floor((rect.left + rect.right) / 2);
    const y = Math.floor((rect.top + rect.bottom) / 2);
    host.input.moveMouse(x, y);
    host.input.mouseDown("left");
    await wait(4);
    expect(probe().kit.carrying).toBeNull();
    host.input.mouseUp("left");
    await until(() => !probe().locked, 600);
    expect(state().lion).toBe(1);
    await drag(second!, anchor(state().layout.first === 5 ? fittingSlots(state(), second!)[0]! : 20));
    expect(state().slotOf[second!]).not.toBe(0);
  });

  it("au dernier cran la saisie reste verrouillée, la phrase de consolation part, « go » reste actif", async () => {
    const { probe, drag, wrongSlot, byFront, anchor, until, state, queued, host, wait } = await start();
    for (let n = 1; n <= 4; n++) {
      const index = byFront()[0]!;
      await drag(index, anchor(wrongSlot(index)));
      await until(() => state().lion === n, 1200);
      if (n < 4) await until(() => !probe().locked, 600);
    }
    expect(lionAtLast(state())).toBe(true);
    expect(probe().lionScript).toBe(6010);
    await until(() => !probe().busy, 600);
    // Verrou maintenu ; phrase de consolation (niveau 0, première visite : toujours).
    expect(probe().locked).toBe(true);
    await until(() => queued.some((id) => id >= 20045 && id <= 20048));
    // Un Zoombini de plus : impossible à prendre.
    const index = byFront()[0]!;
    const member = probe().kit.members[index]!;
    const before = { ...member.snoid.position };
    const rect = member.snoid.feature.rect!;
    host.input.moveMouse(Math.floor((rect.left + rect.right) / 2), Math.floor((rect.top + rect.bottom) / 2));
    host.input.mouseDown("left");
    await wait(4);
    host.input.moveMouse(200, 300);
    await wait(8);
    host.input.mouseUp("left");
    await wait(8);
    expect(member.snoid.position).toEqual(before);
    expect(state().slotOf[index]).toBe(0);
    expect(probe().kit.goEnabled).toBe(true);
    expect(state().placed).toBe(4);
  }, 60_000);

  it("lâché sur le sol, il reste là et peut être repris ; lâché dans le gouffre il tombe (SCRS 12012), revient d'où il vient (12013), sans cran", async () => {
    const { probe, drag, byFront, grabbable, until, state } = await start();
    const index = byFront()[0]!;
    const member = probe().kit.members[index]!;
    const origin = { ...member.snoid.position };
    // Sol : (190, 60) est dans le premier rectangle, à l'écart des places.
    await drag(index, { x: 190, y: 60 });
    expect(member.snoid.position).toEqual({ x: 190, y: 60 });
    expect(probe().locked).toBe(false);
    expect(probe().busy).toBe(false);
    expect(state().placed).toBe(0);
    await until(() => member.snoid.resting);
    // Repris (il est libre), lâché au milieu du gouffre.
    await drag(index, { x: 320, y: 430 });
    expect(probe().locked).toBe(true);
    expect(probe().busy).toBe(true);
    await until(() => member.snoid.scriptId === 12012);
    await until(() => member.snoid.scriptId === 12013);
    await until(() => !probe().busy, 600);
    expect(probe().locked).toBe(false);
    await until(() => member.snoid.resting, 100);
    expect(member.snoid.position).toEqual({ x: 190, y: 60 });
    expect(origin).not.toEqual({ x: 190, y: 60 });
    expect(state().lion).toBe(0);
    expect(state().placed).toBe(0);
    expect(member.zoombini.present).toBe(false);
    // Une chute depuis la place d'attente le ramène sur sa place.
    const other = grabbable().find((i) => i !== index)!;
    const m2 = probe().kit.members[other]!;
    const home = { ...m2.snoid.position };
    await drag(other, { x: 400, y: 440 });
    await until(() => !probe().busy, 800);
    await until(() => m2.snoid.resting, 100);
    expect(m2.snoid.position).toEqual(home);
    expect(probe().kit.waitingPlaces.some((place) => place.owner === m2)).toBe(true);
    // Puis une pose juste fonctionne encore.
    await drag(other, SLOT_ANCHORS[fittingSlots(state(), other)[0]! - 1]!);
    expect(state().slotOf[other]).not.toBe(0);
  }, 60_000);

  it("tout le groupe posé : voix de réussite, saisie verrouillée, un Zoombini danse (SCRS 13000 + pieds) toutes les 30 ticks", async () => {
    const { probe, drag, byFront, anchor, until, state, queued, features } = await start(undefined, 3);
    const slots = robot(state());
    for (const index of byFront()) await drag(index, anchor(slots[index]!));
    expect(state().placed).toBe(3);
    expect(probe().hasWon).toBe(true);
    expect(probe().locked).toBe(true);
    expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(true);
    expect(queued.some((id) => id >= 20045 && id <= 20048)).toBe(false);
    expect(state().lion).toBe(0);
    // Danse : un script 13000 à 13004 est joué par l'un d'eux (pas de pas sur place pour le dernier posé).
    await until(() => probe().kit.members.some((m) => m.snoid.scriptId >= 13000 && m.snoid.scriptId <= 13004 && !m.snoid.resting), 200);
    expect(features.features.length).toBeGreaterThan(0);
  });

  it("sortie par « go » : le lion se réveille, 996, les posés partent un à un le long du chemin, écran suivant ; les autres sont perdus", async () => {
    const { probe, drag, byFront, rightSlot, anchor, until, host, wait, zoombinis, engine, queued, features } = await start();
    const chosen = byFront().slice(0, 4);
    for (const index of chosen) {
      await drag(index, anchor(rightSlot(index)));
      await wait(30);
    }
    await until(() => chosen.every((index) => probe().kit.members[index]!.snoid.resting), 600);
    expect(probe().state.placed).toBe(4);
    expect(queued).not.toContain(996);
    // Le bouton « go » est à (589, 430)-(628, 467).
    host.click(610, 450);
    await wait(2);
    expect(probe().leaving).not.toBeNull();
    expect(probe().kit.left).toBe(true);
    // Éveil du lion (6002), puis le départ.
    await until(() => features.features.some((f) => f.scriptId === 6002));
    expect(queued).not.toContain(996);
    await until(() => probe().leaving === "walking", 800);
    expect(queued).toContain(996);
    // De la dalle 20 à la dalle 1 : le premier à partir est celui de la dalle la plus loin.
    const order = [...chosen].sort((a, b) => probe().state.slotOf[b]! - probe().state.slotOf[a]!);
    await until(() => probe().kit.members[order[0]!]!.snoid.scriptId !== 0 && !probe().kit.members[order[0]!]!.snoid.resting, 100);
    // `1028:0d9e(996)` : l'écran ne change qu'une fois le son de départ fini.
    const kit = probe().kit;
    let playingAtChange = false;
    await until(() => {
      if (zoombinis.lastChange?.screen === S.xfer) playingAtChange = kit.isPlaying(996);
      return zoombinis.lastChange?.screen === S.xfer;
    }, 3000);
    expect(playingAtChange).toBe(false);
    expect(engine.error).toBeNull();
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.caves, "success") });
    const { game } = zoombinis;
    // Les 12 autres sont perdus ; le passage est marqué (bit du niveau 0) mais pas « sans perte ».
    expect(game.successes[9]! & 1).toBe(1);
    expect(game.successes[9]! & 0x10).toBe(0);
    expect(game.group.members.filter((z) => z.present)).toHaveLength(4);
  }, 90_000);

  it("un clic pendant le départ change tout de suite d'écran", async () => {
    const { probe, drag, byFront, rightSlot, anchor, until, host, wait, zoombinis } = await start();
    const index = byFront()[0]!;
    await drag(index, anchor(rightSlot(index)));
    host.click(610, 450);
    await wait(3);
    expect(probe().leaving).not.toBeNull();
    host.click(300, 300);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 100);
    expect(zoombinis.game.group.members.filter((z) => z.present)).toHaveLength(1);
  }, 30_000);

  it("« go » est grisé tant que personne n'est posé : le clic ne fait rien", async () => {
    const { probe, host, wait, engine } = await start();
    host.click(610, 450);
    await wait(10);
    expect(probe().leaving).toBeNull();
    expect(probe().kit.left).toBe(false);
    expect(engine.error).toBeNull();
  });

  it("« go » pendant un rejet attend la fin de l'animation avant l'éveil du lion", async () => {
    const { probe, drag, byFront, wrongSlot, anchor, until, host, wait, state } = await start();
    const index = byFront()[0]!;
    await drag(index, anchor(wrongSlot(index)));
    expect(probe().busy).toBe(true);
    host.click(610, 450);
    await wait(3);
    expect(probe().leaving).toBe("requested");
    await until(() => !probe().busy, 800);
    await until(() => probe().leaving === "waking" || probe().leaving === "walking", 100);
    expect(state().lion).toBe(1);
  }, 30_000);

  it.each(LEVELS)("niveau %i : le robot pose tout le groupe d'après la règle de l'écran, sans réveiller le lion", async (level) => {
    const { probe, drag, byFront, anchor, wait, until, state, queued } = await start(setLevel(level));
    const slots = robot(state());
    for (const index of byFront()) {
      await drag(index, anchor(slots[index]!));
      await wait(40);
    }
    expect(state().placed).toBe(16);
    expect(state().lion).toBe(0);
    expect(probe().hasWon).toBe(true);
    await until(() => queued.some((id) => id >= 20055 && id <= 20063));
    expect(lostCount(state())).toBe(0);
  }, 120_000);

  it("les `SCRB` et `SCRS` de l'archive ont les événements que l'écran attend (retournement, saut, chute, lion)", () => {
    const archive = MohawkArchive.parse(original.read("CAVES.MHK"));
    const scrb = (id: number) => parseScrb(archive.get("SCRB", id)).images.map((image) => image.event - 1);
    const scrs = (id: number) => parseScrs(archive.get("SCRS", id)).images.map((image) => image.event - 1);
    for (let s = 1; s <= 20; s++) {
      const base = 8200 + 4 * (s - 1);
      // Retournement de la dalle refusée : rebond à l'image 1 (événement 1), fin à la dernière (5).
      const flip = scrb(base);
      expect(flip[1]).toBe(1);
      expect(flip.at(-1)).toBe(5);
      // Dalle valable : saut à l'image 1 (événement 2).
      expect(scrb(base + 2)[1]).toBe(2);
    }
    // Saut : fin sur l'événement 4 ; chute : événement 10 ; retour et lion : événement 20.
    expect(scrs(12005).at(-1)).toBe(4);
    expect(scrs(12012).at(-1)).toBe(10);
    expect(scrs(12013).at(-1)).toBe(20);
    for (let id = 6004; id <= 6010; id++) expect(scrb(id).at(-1), `SCRB ${id}`).toBe(20);
    // Éveil final : événement 10 à la dernière image.
    expect(scrb(6002).at(-1)).toBe(10);
    // Les 13 scripts de pas : un par type de pieds.
    for (let id = 13000; id <= 13004; id++) expect(parseScrs(archive.get("SCRS", id)).images.length).toBeGreaterThan(5);
    // Les hiéroglyphes : 20 images, `REGS` 200 / 201 pour 20 emplacements.
    expect(archive.ids("REGS")).toContain(201);
  });

  it("F1 rejoue la voix d'introduction (20065) ; le bouton carte demande l'avertissement", async () => {
    const { host, engine, wait, dialog, queued } = await start();
    host.press("F1", { key: "F1" });
    await wait(6);
    expect(queued).toContain(20065);
    host.click(610, 410);
    await wait(6);
    expect(dialog.isOpen).toBe(true);
    host.press("Enter");
    await wait(10);
    expect(engine.error).toBeNull();
  });

  it("une partie enregistrée pendant l'épreuve retrouve le groupe entier (perdus compris) ; le crochet est retiré à la sortie", async () => {
    const { engine, zoombinis, scene } = await start();
    const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(zoombinis.game.group.members).toHaveLength(16);
    expect(zoombinis.game.group.members.every((z) => z.present)).toBe(true);
    scene.leave(engine.ctx);
    expect(dialogs.beforeSave).toHaveLength(0);
  });

  it("un petit groupe (5 Zoombinis) : 15 dalles de remplissage jouables, un remplissage de 4 seulement", async () => {
    const { probe, state, drag, byFront, anchor, rightSlot } = await start(undefined, 5);
    expect(state().layout.first).toBe(16);
    expect(state().layout.fillers).toBe(4);
    expect(probe().slots.filter(Boolean)).toHaveLength(5);
    const index = byFront()[0]!;
    await drag(index, anchor(rightSlot(index)));
    expect(state().placed).toBe(1);
  });

  it("partie neuve (arrivée à pied, transport collé) : un glissé prend, le clic suivant dépose sur une dalle", async () => {
    const { probe, host, wait, until, byFront, rightSlot, anchor, state } = await start((game) => {
      game.options.lessAction = false;
      game.options.magneticMouse = true;
    });
    await wait(900);
    const index = byFront().find((i) => probe().kit.members[i]!.snoid.resting && !probe().kit.members[i]!.walking)!;
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
    const slot = rightSlot(index);
    host.click(point.x, point.y);
    await wait(6);
    host.input.moveMouse(anchor(slot).x + at.x, anchor(slot).y + at.y);
    await wait(8);
    host.click(anchor(slot).x + at.x, anchor(slot).y + at.y);
    await wait(6);
    await until(() => state().slotOf[index] !== 0, 100);
    expect(state().slotOf[index]).toBe(slot);
  }, 60_000);
});
