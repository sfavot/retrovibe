import { describe, expect, it, vi } from "vitest";
import { MsvcRandom } from "../../../src/engine/mohawk/rng";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { FEATURES, FeatureFlag } from "../../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_TEXT } from "../../../src/games/zoombinis/engine/text";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import { bridgeAvoidCount, nextScreen, setBridgeMemory } from "../../../src/games/zoombinis/game/route";
import {
  ERROR_BUDGETS,
  INTRO_VOICES,
  WARNING_VOICES,
  arrive,
  candidatesFor,
  canContinue,
  chooseRulePair,
  correctEntrances,
  createState,
  drawBlocked,
  drawEncouragementDelay,
  drawIntroVoice,
  drawRules,
  drop,
  judge,
  playRobot,
  reactionAllowed,
  satisfies,
  shouldCollapse,
  startWalk,
  type Entrance,
  type Level,
  type TunnelsRules,
} from "../../../src/games/zoombinis/game/puzzles/tunnels";
import { makeZoombini, type Attrs, type Session } from "../../../src/games/zoombinis/game/state";
import { createTunnelsScene, resetTunnelsVisits, type TunnelsScene } from "../../../src/games/zoombinis/scenes/puzzles/tunnels";
import { originalFiles } from "../../support/original";
import { TestHost, runFor } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const LEVELS: readonly Level[] = [0, 1, 2, 3];
const ENTRANCE_LIST: readonly Entrance[] = [1, 2, 3, 4];

/** Un groupe de `n` Zoombinis aux attributs tirés (graine `seed`). */
function randomGroup(seed: number, n = 16): Attrs[] {
  const rng = new MsvcRandom(seed);
  return Array.from({ length: n }, () => [rng.range(1, 5), rng.range(1, 5), rng.range(1, 5), rng.range(1, 5)] as Attrs);
}

describe("règles des grottes de passe-clos", () => {
  describe("candidates", () => {
    it("20, 20, 40 et 150 candidates aux niveaux 0 à 3, dans l'ordre d'énumération de l'original (attribut 4 d'abord)", () => {
      expect(LEVELS.map((level) => candidatesFor(level).length)).toEqual([20, 20, 40, 150]);
      const first = candidatesFor(0);
      expect(first.slice(0, 6).map(([c]) => `${c!.attr}:${c!.value}`)).toEqual(["4:1", "4:2", "4:3", "4:4", "4:5", "3:1"]);
      expect(first[19]).toEqual([{ attr: 1, value: 5 }]);
      // Niveau 2 : paires de valeurs du `DS:3c24` (octet 0xHL = valeurs H et L), 10 par attribut.
      const pairs = candidatesFor(2);
      expect(pairs[0]!.map((c) => c.value).sort()).toEqual([1, 2]);
      expect(pairs[9]!.map((c) => c.value).sort()).toEqual([4, 5]);
      expect(pairs[10]!.every((c) => c.attr === 3)).toBe(true);
      // Niveau 3 : deux attributs différents, 25 couples de valeurs pour chacune des 6 paires d'attributs.
      const two = candidatesFor(3);
      expect(two.every((cand) => cand.length === 2 && cand[0]!.attr !== cand[1]!.attr)).toBe(true);
      expect(new Set(two.map((cand) => `${cand[0]!.attr}${cand[1]!.attr}`)).size).toBe(6);
    });

    it("une candidate accepte un Zoombini dès qu'une de ses conditions est vraie (OU)", () => {
      expect(satisfies([{ attr: 2, value: 3 }, { attr: 4, value: 1 }], [1, 3, 5, 5])).toBe(true);
      expect(satisfies([{ attr: 2, value: 3 }, { attr: 4, value: 1 }], [1, 2, 5, 1])).toBe(true);
      expect(satisfies([{ attr: 2, value: 3 }, { attr: 4, value: 1 }], [1, 2, 5, 5])).toBe(false);
    });
  });

  describe("tirage des règles", () => {
    it.each(LEVELS)("niveau %i : bonne forme, une seule entrée correcte par Zoombini, graines fixes reproductibles", (level) => {
      for (let seed = 1; seed <= 25; seed++) {
        const group = randomGroup(seed);
        const draw = () => {
          const rng = new MsvcRandom(seed);
          const blocked = drawBlocked(rng);
          return drawRules(rng, level, group, blocked);
        };
        const rules = draw();
        expect(draw()).toEqual(rules);
        expect(rules.rules).toHaveLength(level === 0 ? 1 : 2);
        for (const rule of rules.rules) {
          expect(rule.conditions).toHaveLength(level <= 1 ? 1 : 2);
          if (level === 2) expect(new Set(rule.conditions.map((c) => c.attr)).size).toBe(1);
          if (level === 3) expect(new Set(rule.conditions.map((c) => c.attr)).size).toBe(2);
        }
        // Exactement une entrée correcte pour chaque Zoombini, y compris au niveau 0 (exception de `a0ce`).
        for (const attrs of group) expect(correctEntrances(rules, attrs)).toHaveLength(1);
      }
    });

    it("niveau 0 : l'effectif satisfaisant est celui de la suite n/2, n/2 + 1, n/2 − 1, n/2 − 2… (jamais n/2 + 2), la graine fixe donne la même règle", () => {
      const counts = new Set<number>();
      for (let seed = 1; seed <= 60; seed++) {
        const group = randomGroup(seed);
        const rng = new MsvcRandom(seed);
        const rules = drawRules(rng, 0, group, drawBlocked(rng));
        const n = group.filter((attrs) => satisfies(rules.rules[0]!.conditions, attrs)).length;
        counts.add(n);
        expect(n).toBeGreaterThanOrEqual(1);
        expect(n).toBeLessThanOrEqual(9);
      }
      // 8 est de loin le plus fréquent ; 10 et plus n'arrivent jamais.
      expect([...counts].every((n) => n <= 9)).toBe(true);
      expect(counts.has(8)).toBe(true);
    });

    it("niveau 0 : le filtre de la règle du pont exclut l'effectif mémorisé quand une autre candidate existe", () => {
      // Groupe fait pour que cheveux et yeux séparent 8 / 8 et que le nez sépare 7 / 9.
      const group: Attrs[] = [];
      for (let i = 0; i < 16; i++) group.push([i < 8 ? 1 : 2, i < 8 ? 1 : 3, i < 7 ? 1 : 4, 5]);
      const free = new Set<string>();
      const filtered = new Set<string>();
      for (let seed = 1; seed <= 30; seed++) {
        const a = new MsvcRandom(seed);
        const b = new MsvcRandom(seed);
        const key = (rules: TunnelsRules) => `${rules.rules[0]!.conditions[0]!.attr}:${rules.rules[0]!.conditions[0]!.value}`;
        free.add(key(drawRules(a, 0, group, 0, 0)));
        filtered.add(key(drawRules(b, 0, group, 0, 8)));
      }
      // Sans filtre, l'effectif 8 est retenu (cheveux ou yeux) ; avec `avoidCount = 8`, il est exclu et la suite passe à 9 (« nez = 4 »).
      expect([...free].every((k) => ["1:1", "1:2", "2:1", "2:3"].includes(k))).toBe(true);
      expect([...filtered]).toEqual(["3:4"]);
    });

    it.each([1, 2, 3] as const)("niveau %i : la paire de règles sépare le groupe en autant de classes que possible, le plus équilibrées possible", (level) => {
      for (let seed = 1; seed <= 10; seed++) {
        const group = randomGroup(100 + seed);
        const candidates = candidatesFor(level);
        const [i, j] = chooseRulePair(candidates, group, new MsvcRandom(seed));
        expect(i).not.toBe(j);
        const classes = (a: number, b: number) => {
          const c = [0, 0, 0, 0];
          for (const attrs of group) c[satisfies(candidates[a]!, attrs) ? (satisfies(candidates[b]!, attrs) ? 0 : 1) : satisfies(candidates[b]!, attrs) ? 2 : 3]! += 1;
          return c;
        };
        const got = classes(i, j);
        // Aucun autre couple n'a strictement plus de classes non vides, ni (à classes égales) un écart total plus faible.
        const cost = (c: number[]) => {
          let total = 0;
          for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) total += Math.abs(c[a]! - c[b]!);
          return total;
        };
        const nonEmpty = (c: number[]) => c.filter((x) => x !== 0).length;
        for (let a = 0; a < candidates.length; a += level === 3 ? 7 : 1) {
          for (let b = 0; b < candidates.length; b += level === 3 ? 11 : 1) {
            if (a === b) continue;
            const other = classes(a, b);
            expect(nonEmpty(other)).toBeLessThanOrEqual(nonEmpty(got));
            if (nonEmpty(other) === nonEmpty(got)) expect(cost(other)).toBeGreaterThanOrEqual(cost(got));
          }
        }
        // Avec 16 Zoombinis aux attributs tirés, les quatre entrées servent.
        expect(nonEmpty(got)).toBe(4);
      }
    });

    it("l'ordre des tirages : a0ce, puis la règle, puis la voix d'introduction (20069 ou 20070) et le délai d'encouragement", () => {
      const rng = new MsvcRandom(7);
      const reference = new MsvcRandom(7);
      expect(drawBlocked(rng)).toBe(reference.range(0, 1));
      const rules = drawRules(rng, 0, randomGroup(7), 0);
      expect(rules.rules).toHaveLength(1);
      // Un niveau 0 consomme : un tirage de départage parmi les candidates ex æquo, puis `w`.
      reference.rand(0);
      const voice = drawIntroVoice(rng);
      expect(voice).toBeGreaterThanOrEqual(INTRO_VOICES.first);
      expect(voice).toBeLessThanOrEqual(INTRO_VOICES.last);
      const delay = drawEncouragementDelay(rng);
      expect(delay).toBeGreaterThanOrEqual(5400);
      expect(delay).toBeLessThanOrEqual(10800);
    });
  });

  describe("acceptation d'une entrée (1190:2588)", () => {
    const rule = (w: boolean, attr: 1 | 2 | 3 | 4, value: number) => ({ w, conditions: [{ attr, value }] });

    it("deux règles : entrée 1 = A' et B', 2 = A' et non B', 3 = non A' et non B', 4 = non A' et B' ; w = 0 inverse la règle", () => {
      const rules: TunnelsRules = { level: 1, blocked: 0, rules: [rule(true, 1, 1), rule(true, 2, 1)] };
      // A' = cheveux 1, B' = yeux 1.
      const both: Attrs = [1, 1, 3, 3];
      const aOnly: Attrs = [1, 2, 3, 3];
      const bOnly: Attrs = [2, 1, 3, 3];
      const none: Attrs = [2, 2, 3, 3];
      expect(correctEntrances(rules, both)).toEqual([1]);
      expect(correctEntrances(rules, aOnly)).toEqual([2]);
      expect(correctEntrances(rules, none)).toEqual([3]);
      expect(correctEntrances(rules, bOnly)).toEqual([4]);
      const inverted: TunnelsRules = { level: 1, blocked: 0, rules: [rule(false, 1, 1), rule(false, 2, 1)] };
      expect(correctEntrances(inverted, both)).toEqual([3]);
      expect(correctEntrances(inverted, none)).toEqual([1]);
      // Verdict : `first` est le résultat du premier embranchement seul, `code` désigne le trajet.
      expect(judge(rules, aOnly, 1)).toEqual({ entrance: 1, wrong: true, first: true, code: 1 });
      expect(judge(rules, aOnly, 3)).toEqual({ entrance: 3, wrong: true, first: false, code: 5 });
      expect(judge(rules, bOnly, 2)).toEqual({ entrance: 2, wrong: true, first: false, code: 2 });
      expect(judge(rules, bOnly, 4)).toEqual({ entrance: 4, wrong: false, first: true, code: 6 });
    });

    it("niveau 0 : une règle (entrées 1 et 2 pour A', 3 et 4 sinon), et l'exception de a0ce rend deux entrées fausses", () => {
      const open: TunnelsRules = { level: 0, blocked: 0, rules: [rule(true, 1, 1)] };
      const yes: Attrs = [1, 2, 2, 2];
      const no: Attrs = [2, 2, 2, 2];
      // a0ce = 0 : seules les entrées extérieures 1 et 4 sont valables.
      expect(ENTRANCE_LIST.filter((e) => !judge(open, yes, e).wrong)).toEqual([1]);
      expect(ENTRANCE_LIST.filter((e) => !judge(open, no, e).wrong)).toEqual([4]);
      // a0ce = 1 : seules les intérieures 2 et 3.
      const inner: TunnelsRules = { ...open, blocked: 1 };
      expect(ENTRANCE_LIST.filter((e) => !judge(inner, yes, e).wrong)).toEqual([2]);
      expect(ENTRANCE_LIST.filter((e) => !judge(inner, no, e).wrong)).toEqual([3]);
      // L'exception ne touche pas les niveaux 1 à 3.
      const two: TunnelsRules = { level: 1, blocked: 0, rules: [rule(true, 1, 1), rule(true, 2, 1)] };
      expect(ENTRANCE_LIST.filter((e) => !judge(two, [1, 2, 3, 3], e).wrong)).toEqual([2]);
    });
  });

  describe("budget d'erreurs, effondrement, arrivées", () => {
    const rules = (level: Level): TunnelsRules => ({ level, blocked: 0, rules: [{ w: true, conditions: [{ attr: 1, value: 1 }] }] });

    it.each(LEVELS)("niveau %i : %i erreurs permises (16, 18, 20, 22), avertissements aux budgets 5, 4, 3, 2, puis effondrement", (level) => {
      const state = createState(rules(level), 16);
      expect(state.budget).toBe(ERROR_BUDGETS[level]);
      const attrs: Attrs = [1, 1, 1, 1];
      const warnings: number[] = [];
      let errors = 0;
      while (state.budget > 0) {
        const verdict = drop(state, attrs, 3);
        expect(verdict.wrong).toBe(true);
        const { warning } = startWalk(state, verdict);
        if (warning !== null) warnings.push(warning);
        errors += 1;
      }
      expect(errors).toBe([16, 18, 20, 22][level]);
      expect(warnings).toEqual([4700, 4701, 4702, 4703]);
      expect(WARNING_VOICES).toEqual({ 5: 4700, 4: 4701, 3: 4702, 2: 4703 });
      // L'effondrement ne part qu'une fois la marche en cours finie.
      expect(shouldCollapse(state, true)).toBe(false);
      expect(shouldCollapse(state, false)).toBe(true);
      state.collapsed = true;
      expect(shouldCollapse(state, false)).toBe(false);
    });

    it("un bon choix ne coûte rien, une erreur coûte 1 dès le départ ; les réussites consécutives d'une entrée sont comptées au dépôt et remises à 0 par une erreur", () => {
      const state = createState(rules(1), 16);
      const good = drop(state, [1, 1, 1, 1], 1);
      expect(good.wrong).toBe(false);
      expect(state.consecutive).toEqual([1, 0, 0, 0]);
      expect(reactionAllowed(state, 1)).toBe(true);
      expect(startWalk(state, good).warning).toBeNull();
      expect(state.budget).toBe(18);
      drop(state, [1, 1, 1, 1], 1);
      expect(state.consecutive[0]).toBe(2);
      // Deux réussites de suite : plus de réaction du gardien.
      expect(reactionAllowed(state, 1)).toBe(false);
      const bad = drop(state, [1, 1, 1, 1], 4);
      expect(bad.wrong).toBe(true);
      drop(state, [2, 2, 2, 2], 3);
      expect(state.consecutive).toEqual([2, 0, 1, 0]);
      startWalk(state, bad);
      expect(state.budget).toBe(17);
    });

    it("les arrivées sont comptées par tunnel (16 places chacun) ; « Continuer » demande au moins un arrivé et la fin de l'effondrement", () => {
      const state = createState(rules(0), 16);
      expect(canContinue(state, false)).toBe(false);
      expect([arrive(state, 1), arrive(state, 1), arrive(state, 4), arrive(state, 2), arrive(state, 1)]).toEqual([0, 1, 0, 0, 2]);
      expect(state.arrivals).toEqual([3, 1, 0, 1]);
      expect(state.saved).toBe(5);
      expect(canContinue(state, false)).toBe(true);
      state.collapsed = true;
      expect(canContinue(state, false)).toBe(false);
      expect(canContinue(state, true)).toBe(true);
    });
  });

  describe("robot", () => {
    it.each(LEVELS)("niveau %i : sauve tout le groupe, sans erreur, sur 40 graines", (level) => {
      for (let seed = 1; seed <= 40; seed++) {
        const group = randomGroup(seed, 1 + (seed % 16));
        const rng = new MsvcRandom(seed);
        const rules = drawRules(rng, level, group, drawBlocked(rng));
        const result = playRobot(rules, group);
        expect(result.saved).toBe(group.length);
        expect(result.lost).toBe(0);
        expect(result.errors).toBe(0);
        expect(result.state.budget).toBe(ERROR_BUDGETS[level]);
        expect(result.state.arrivals.reduce((a, b) => a + b, 0)).toBe(group.length);
      }
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
// Écran, sur les vrais fichiers

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;

describe.skipIf(!original.has)("écran des grottes de passe-clos (TUNNELS.MHK)", () => {
  /** L'épreuve avec un groupe de `size` Zoombinis différents, au niveau `level` de l'étape 1 ; les autres écrans notent leur entrée. */
  async function start(level: Level = 0, size = 16, seed = 3, setup?: (session: Session) => void, testMode = false) {
    resetTunnelsVisits();
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed });
    const services = await installServices(engine);
    const entered: number[] = [];
    let scene!: TunnelsScene;
    for (const id of Object.values(S)) {
      if (id === S.tunnels) engine.register(id, () => (scene = createTunnelsScene()));
      else engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    }
    const zoombinis = services.game;
    zoombinis.game.group.members = Array.from({ length: size }, (_, i) =>
      makeZoombini([1 + (i % 5), 1 + ((i * 2 + Math.floor(i / 5)) % 5), 1 + ((i * 3) % 5), 1 + ((i + Math.floor(i / 3)) % 5)], i + 1),
    );
    zoombinis.game.stageUnbroken = true;
    zoombinis.game.levels = [level, 0, 0, 0];
    zoombinis.game.options.lessAction = true;
    zoombinis.game.options.magneticMouse = false;
    zoombinis.game.options.testMode = testMode;
    zoombinis.session.screen = S.tunnels;
    setup?.(zoombinis.session);
    engine.start(S.tunnels);
    await runFor(engine, host, 40 * TICK_MS);
    expect(engine.error).toBeNull();
    const ticks = (n: number) => runFor(engine, host, n * TICK_MS);
    /** Avance jusqu'à ce que `done()` soit vrai (6 ticks à la fois) ; échoue au bout de `max` ticks. */
    const until = async (done: () => boolean, max = 4000) => {
      for (let t = 0; t < max && !done(); t += 6) await ticks(6);
      expect(done()).toBe(true);
      expect(engine.error).toBeNull();
    };
    const kit = () => scene.debug.kit!;
    const rules = () => scene.debug.rules!;
    const attrs = (i: number) => kit().members[i]!.zoombini.attrs;
    /** Glisse le membre `i` sur l'entrée `entrance` (en le prenant par le milieu de son image). */
    const dragTo = async (i: number, entrance: Entrance) => {
      const member = kit().members[i]!;
      const rect = member.snoid.feature.rect!;
      const grab = { x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) };
      const feet = member.snoid.position;
      const anchor = scene.debug.entranceAnchor(entrance);
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await ticks(4);
      host.input.moveMouse(anchor.x + grab.x - feet.x, anchor.y + grab.y - feet.y);
      await ticks(12);
      host.input.mouseUp("left");
      await ticks(6);
    };
    const right = (i: number) => correctEntrances(rules(), attrs(i))[0]!;
    const wrong = (i: number) => ENTRANCE_LIST.find((e) => judge(rules(), attrs(i), e).wrong)!;
    return { host, engine, services, zoombinis, entered, scene, ticks, until, kit, rules, attrs, dragTo, right, wrong, features: engine.services.get(FEATURES), sound: engine.services.get(ZOOMBINIS_SOUND) };
  }

  it("niveau 0 : l'effectif de la règle laissée par les gorges (DS:96f0) est évité ; en entraînement la mémoire est effacée (1190:0000)", async () => {
    const count = (run: Awaited<ReturnType<typeof start>>): number =>
      run.kit().members.filter((m) => satisfies(run.rules().rules[0]!.conditions, m.zoombini.attrs)).length;
    const free = await start(0, 16, 3);
    const n = count(free);
    expect(bridgeAvoidCount(free.zoombinis.session)).toBe(0);
    const avoiding = await start(0, 16, 3, (session) => setBridgeMemory(session, { candidate: 0x01, count: n }));
    expect(count(avoiding)).not.toBe(n);
    // Entraînement : rien n'est évité, la mémoire est effacée.
    const training = await start(0, 16, 3, (session) => {
      setBridgeMemory(session, { candidate: 0x01, count: n });
      session.training = 1;
    });
    expect(count(training)).toBe(n);
    expect(bridgeAvoidCount(training.zoombinis.session)).toBe(0);
    training.zoombinis.session.training = 0;
    expect(bridgeAvoidCount(training.zoombinis.session)).toBe(0);
  });

  it.each(LEVELS)("niveau %i : décor, palette, quatre gardiens, groupe debout, règle tirée, budget et personne sauvé", async (level) => {
    const { host, scene, features, kit, zoombinis } = await start(level);
    expect(host.frames[host.frames.length - 1]!.pixels.some((p) => p !== 0)).toBe(true);
    expect(zoombinis.session.screen).toBe(S.tunnels);
    expect(scene.debug.rules!.rules).toHaveLength(level === 0 ? 1 : 2);
    expect(scene.debug.state!.budget).toBe(ERROR_BUDGETS[level]);
    expect(kit().members).toHaveLength(16);
    // Les 16 sont debout (« moins d'action »), personne n'est sauvé, tous sont encore dans le groupe de la partie.
    expect(features.features.filter((f) => f.hasFlag(FeatureFlag.snoid))).toHaveLength(16);
    expect(kit().members.every((m) => !m.zoombini.present)).toBe(true);
    expect(zoombinis.game.group.members.filter((z) => z.present)).toHaveLength(16);
    // Quatre gardiens (profondeur 0,3) ; la phrase d'introduction a pu en changer un de script (6000 à 6003, puis 4xxx).
    const pillars = features.features.filter((f) => f.depth === 0.3);
    expect(pillars).toHaveLength(4);
    expect(pillars.every((f) => (f.scriptId >= 6000 && f.scriptId <= 6003) || (f.scriptId >= 4000 && f.scriptId <= 4623))).toBe(true);
    expect(kit().goEnabled).toBe(false);
    expect(zoombinis.game.dialogMemory[2]! & 0xfff).toBe(1);
  });

  it("une partie tire la même règle à graine égale ; l'aide F1 rejoue la consigne (20069 ou 20070)", async () => {
    const a = await start(1, 16, 11);
    const b = await start(1, 16, 11);
    expect(a.rules()).toEqual(b.rules());
    expect([20069, 20070]).toContain(a.kit().introVoice);
    const before = a.host.audio.waves.length;
    a.host.press("F1");
    await a.ticks(10);
    expect(a.host.audio.waves.length).toBeGreaterThan(before);
  });

  it.each(LEVELS)("niveau %i : un Zoombini déposé sur la bonne entrée traverse le tunnel et arrive à sa place d'arrivée, sans erreur", async (level) => {
    const { dragTo, right, until, scene, kit, zoombinis } = await start(level);
    const entrance = right(0);
    await dragTo(0, entrance);
    expect(scene.debug.statusOf(0)).not.toBe("waiting");
    expect(scene.debug.queueLength).toBe(1);
    await until(() => scene.debug.statusOf(0) === "arrived");
    const state = scene.debug.state!;
    expect(state.saved).toBe(1);
    expect(state.budget).toBe(ERROR_BUDGETS[level]);
    expect(state.arrivals[entrance - 1]).toBe(1);
    expect(kit().members[0]!.zoombini.present).toBe(true);
    // Il rejoint la première place d'arrivée de son tunnel (entrée 1 : (277, 62), 2 : (288, 213), 3 : (414, 217), 4 : (403, 60)).
    await until(() => !kit().members[0]!.snoid.walking);
    const place = { 1: [277, 62], 2: [288, 213], 3: [414, 217], 4: [403, 60] }[entrance];
    expect([kit().members[0]!.snoid.position.x, kit().members[0]!.snoid.position.y]).toEqual(place);
    // L'entrée est libre, le bouton « go » est actif.
    expect(kit().targets.find((t) => t.tag === entrance)!.owner).toBeNull();
    await until(() => scene.debug.queueLength === 0 && !scene.debug.busy);
    expect(kit().goEnabled).toBe(true);
    expect(zoombinis.game.group.members).toHaveLength(16);
  });

  it("sons de marche en boucle (8500 / 8503, pieds 4 et 5) : ils ne retiennent pas la file, chaque Zoombini posé ensuite monte à son tour", async () => {
    const { dragTo, right, until, scene, kit, host } = await start(0);
    const audio = host.audio;
    const playing = () => audio.waves.filter((w) => audio.isWavePlaying(w.handle));
    const walkers = kit()
      .members.map((m, i) => ({ m, i }))
      .filter(({ m }) => m.snoid.traits.feet >= 4)
      .map(({ i }) => i)
      .slice(0, 3);
    expect(walkers).toHaveLength(3);
    let maxPlaying = 0;
    for (const i of walkers) {
      await dragTo(i, right(i));
      await until(() => {
        maxPlaying = Math.max(maxPlaying, playing().length);
        return scene.debug.statusOf(i) === "arrived" && !scene.debug.busy;
      });
    }
    expect(audio.waves.some((w) => w.loop)).toBe(true);
    expect(maxPlaying).toBeLessThanOrEqual(1);
    expect(walkers.every((i) => scene.debug.statusOf(i) === "arrived")).toBe(true);
  });

  it("une mauvaise entrée : le Zoombini part, revient par le script de retour, rejoint une place d'attente et coûte une erreur", async () => {
    const { dragTo, wrong, until, scene, kit } = await start(1);
    const entrance = wrong(0);
    await dragTo(0, entrance);
    // L'erreur est décomptée au départ (pas au dépôt).
    await until(() => scene.debug.state!.budget === 17);
    expect(scene.debug.statusOf(0)).toBe("active");
    await until(() => scene.debug.statusOf(0) === "waiting" && !kit().members[0]!.snoid.walking);
    const state = scene.debug.state!;
    expect(state.budget).toBe(17);
    expect(state.saved).toBe(0);
    expect(kit().members[0]!.zoombini.present).toBe(false);
    // Il occupe une place d'attente (côté préféré : 15 à gauche, 11 à droite), l'entrée est libre.
    const place = kit().members[0]!.waiting!;
    expect(kit().waitingPlaces).toContain(place);
    expect(place.owner).toBe(kit().members[0]);
    expect(kit().targets.find((t) => t.tag === entrance)!.owner).toBeNull();
    expect([kit().members[0]!.snoid.position.x, kit().members[0]!.snoid.position.y]).toEqual([place.x, place.y]);
    await until(() => scene.debug.queueLength === 0 && !scene.debug.busy);
  });

  it("niveau 0 : une entrée qui accepterait le Zoombini mais est bouchée par a0ce compte comme une erreur", async () => {
    const { dragTo, scene, until, attrs, kit } = await start(0);
    const rules = scene.debug.rules!;
    // Entrée que la règle accepte mais qu'`a0ce` interdit.
    const blockedEntrances = rules.blocked === 0 ? [2, 3] : [1, 4];
    const target = blockedEntrances.find((e) => !judge({ ...rules, blocked: rules.blocked === 0 ? 1 : 0 }, attrs(0), e as Entrance).wrong)! as Entrance;
    expect(judge(rules, attrs(0), target).wrong).toBe(true);
    await dragTo(0, target);
    await until(() => scene.debug.state!.budget === 15);
    await until(() => scene.debug.statusOf(0) === "waiting" && !kit().members[0]!.snoid.walking);
  });

  it("plusieurs dépôts : la file garde l'ordre des dépôts et un Zoombini repris d'une entrée en sort", async () => {
    const { dragTo, wrong, right, until, scene, host, kit, ticks } = await start(0);
    // Deux entrées différentes ; le premier dépôt part tout de suite, le second attend dans la file.
    await dragTo(0, wrong(0));
    const second = right(1);
    await dragTo(1, second);
    expect(scene.debug.queueLength).toBeGreaterThanOrEqual(1);
    expect(scene.debug.statusOf(1)).toBe("queued");
    // Reprendre le second et le lâcher hors des entrées le renvoie à une place d'attente et retire sa décision de la file.
    const member = kit().members[1]!;
    const rect = member.snoid.feature.rect!;
    const grab = { x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) };
    host.input.moveMouse(grab.x, grab.y);
    host.input.mouseDown("left");
    await ticks(4);
    host.input.moveMouse(300, 250);
    await ticks(10);
    host.input.mouseUp("left");
    await ticks(6);
    expect(scene.debug.statusOf(1)).toBe("waiting");
    expect(member.target!.tag).toBeUndefined();
    expect(kit().targets.find((t) => t.tag === second)!.owner).toBeNull();
    await until(() => scene.debug.statusOf(0) === "waiting" && !scene.debug.busy && scene.debug.queueLength === 0);
    expect(scene.debug.state!.budget).toBe(15);
  });

  it("l'effondrement : plus personne n'est pris, les Zoombinis restés aux entrées sont perdus, le plafond tombe, « go » grisé sans arrivé", async () => {
    const { dragTo, until, scene, kit, host, ticks, zoombinis, attrs } = await start(0);
    scene.debug.state!.budget = 2;
    const wrongs = (i: number) => ENTRANCE_LIST.filter((e) => judge(scene.debug.rules!, attrs(i), e).wrong);
    const first = wrongs(0)[0]!;
    const second = wrongs(1).find((e) => e !== first)!;
    const third = ENTRANCE_LIST.find((e) => e !== first && e !== second)!;
    await dragTo(0, first);
    // Deux autres dépôts pendant que le premier part : ils attendent aux entrées, dans la file.
    await dragTo(1, second);
    await dragTo(2, third);
    expect(scene.debug.state!.budget).toBe(1);
    expect(scene.debug.queueLength).toBe(3);
    await until(() => scene.debug.state!.collapsed);
    // Le deuxième est parti en erreur (budget 0), le troisième, resté à l'entrée, est perdu.
    expect(scene.debug.state!.budget).toBe(0);
    expect(scene.debug.statusOf(2)).toBe("lost");
    expect(kit().members[2]!.zoombini.present).toBe(false);
    await until(() => scene.debug.collapse === "done");
    expect(kit().members[2]!.snoid.position.y).toBe(460);
    expect(kit().targets.find((t) => t.tag === third)!.owner).toBeNull();
    // Plus aucun Zoombini ne peut être pris, et sans arrivé « go » reste grisé : un clic dessus n'a aucun effet.
    expect(kit().goEnabled).toBe(false);
    host.click(620, 460);
    await ticks(30);
    expect(kit().departing).toBe(false);
    expect(zoombinis.lastChange).toBeNull();
    await dragTo(5, 1);
    expect(scene.debug.queueLength).toBe(0);
    expect(scene.debug.statusOf(5)).toBe("waiting");
  });

  it("sortie par « go » : les sauvés partent à pied, l'écran suivant est la hutte à pizza, les perdus retournent à la réserve du choix", async () => {
    const { dragTo, right, until, scene, kit, host, ticks, zoombinis, engine } = await start(0);
    // Sauve deux Zoombinis (l'un après l'autre : la file attend la fin de chaque marche).
    await dragTo(0, right(0));
    await until(() => scene.debug.statusOf(0) === "arrived");
    await until(() => !scene.debug.busy && scene.debug.queueLength === 0);
    await dragTo(1, right(1));
    await until(() => scene.debug.statusOf(1) === "arrived");
    await until(() => !scene.debug.busy && scene.debug.queueLength === 0 && !kit().members[1]!.snoid.walking);
    expect(scene.debug.state!.saved).toBe(2);
    expect(kit().goEnabled).toBe(true);
    const savedAttrs = new Set([kit().members[0]!.zoombini.attrs.join(), kit().members[1]!.zoombini.attrs.join()]);
    host.click(620, 460);
    await ticks(2);
    expect(kit().departing).toBe(true);
    await until(() => zoombinis.lastChange !== null, 3000);
    expect(engine.error).toBeNull();
    const { game } = zoombinis;
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.tunnels, "success") });
    expect(nextScreen(S.tunnels, "success")).toBe(S.pizza);
    // 2 sauvés restent dans le groupe, les 14 autres sont rendus à la réserve de l'étape 1 (choix des Zoombinis).
    expect(game.group.members.filter((z) => z.present)).toHaveLength(2);
    expect(game.pickerGroup.members).toHaveLength(14);
    expect(game.successes[S.tunnels - 7]! & 1).toBe(1);
    // Le groupe sauvé est celui des deux Zoombinis passés dans les tunnels.
    expect(new Set(game.group.members.filter((z) => z.present).map((z) => z.attrs.join()))).toEqual(savedAttrs);
    expect(game.stageUnbroken).toBe(false);
  });

  it("sortie par « go » : les sauvés suivent NODE / PATH 1000 (1168:2f9f) et passent derrière le gardien du haut (ordre de dessin 11a8:231b)", async () => {
    const { dragTo, right, until, scene, kit, host, ticks, zoombinis, features } = await start(0);
    const saved: number[] = [];
    for (let i = 0; saved.length < 2 && i < 16; i++) {
      if (right(i) !== 1 && right(i) !== 4) continue;
      await dragTo(i, right(i));
      await until(() => scene.debug.statusOf(i) === "arrived");
      await until(() => !scene.debug.busy && scene.debug.queueLength === 0 && !kit().members[i]!.snoid.walking);
      saved.push(i);
    }
    expect(saved).toHaveLength(2);
    const walkers = saved.map((i) => kit().members[i]!.snoid);
    host.click(620, 460);
    await ticks(2);
    const seen = new Set<string>();
    let behindGuardian = false;
    const guardian = features.features.find((f) => f.scriptId >= 4600 && f.scriptId < 4700 && f.rect && f.rect.top === 76)!;
    for (let t = 0; t < 1500 && zoombinis.lastChange === null; t += 2) {
      await ticks(2);
      for (const snoid of walkers) {
        seen.add(`${snoid.position.x},${snoid.position.y}`);
        const r = snoid.feature.rect;
        const g = guardian.rect!;
        if (r && r.right > g.left && r.left < g.right && r.bottom > g.top) {
          const list = features.features;
          if (list.indexOf(snoid.feature) < list.indexOf(guardian)) behindGuardian = true;
        }
      }
    }
    // Points de passage du chemin 1 (287, 87) → (430, 83) → (536, 80) → (670, 30) : on passe par (536, 80) au lieu d'aller tout droit.
    expect(seen.has("536,80")).toBe(true);
    expect(behindGuardian).toBe(true);
  });

  it("sortie par « go » depuis le tunnel du bas à droite : départ au nœud qui suit le plus proche (1168:2f9f, rang k + 1), derrière la cave 9000 (1190:1839, 11a8:2a0a)", async () => {
    // Niveau 2, graine 3 : les membres 4 et 6 ont l'entrée 3 ; ils prennent les places (414, 217) puis (389, 223) du tunnel.
    const { dragTo, right, until, scene, kit, host, ticks, zoombinis, features } = await start(2);
    const saved = [4, 6];
    for (const i of saved) {
      expect(right(i)).toBe(3);
      await dragTo(i, 3);
      await until(() => scene.debug.statusOf(i) === "arrived");
      await until(() => !scene.debug.busy && scene.debug.queueLength === 0 && !kit().members[i]!.snoid.walking);
    }
    const [far, near] = saved.map((i) => kit().members[i]!.snoid);
    expect(far!.position).toEqual({ x: 414, y: 217 });
    expect(near!.position).toEqual({ x: 389, y: 223 });
    const cave = features.features.find((f) => f.scriptId === 9000)!;
    /** Ordre de dessin attendu : le premier arrivé du tunnel juste avant la cave, le second juste après lui (11a8:2a0a), drapeaux 0x4008000. */
    const hidden = () => {
      const list = features.features;
      const order = [far!.feature, near!.feature, cave].map((f) => list.indexOf(f));
      return order[0]! >= 0 && order[1] === order[0]! + 1 && order[2] === order[1]! + 1 && [far!, near!].every((s) => (s.feature.flags & 0x4008000) === 0x4008000);
    };
    expect(hidden()).toBe(true);
    host.click(620, 460);
    await ticks(2);
    const trail = new Map(saved.map((i) => [i, [] as string[]]));
    let alwaysHidden = true;
    for (let t = 0; t < 1500 && zoombinis.lastChange === null; t += 2) {
      for (const [k, snoid] of [far!, near!].entries()) {
        const seen = trail.get(saved[k]!)!;
        const at = `${snoid.position.x},${snoid.position.y}`;
        if (seen[seen.length - 1] !== at) seen.push(at);
      }
      if (features.features.includes(far!.feature) && !hidden()) alwaysHidden = false;
      await ticks(2);
    }
    // Chemin 2 : (304, 238) → (494, 228) → (536, 80) → (670, 30). Depuis (414, 217) le nœud le plus proche est (494, 228) : l'original repart du
    // nœud suivant et monte tout droit vers (536, 80), à travers la paroi (même trajet que l'original, pas de raccourci du port).
    const farTrail = trail.get(4)!;
    expect(farTrail).not.toContain("494,228");
    const top = farTrail.indexOf("536,80");
    expect(top).toBeGreaterThan(0);
    for (const point of farTrail.slice(0, top)) {
      const [x, y] = point.split(",").map(Number) as [number, number];
      // Sur le segment (414, 217) → (536, 80), à un pas près (au plus 13 px en x, 10 en y par pas en secteur 3).
      expect(Math.abs((x - 414) * (80 - 217) - (y - 217) * (536 - 414)) / Math.hypot(122, 137)).toBeLessThan(10);
    }
    // Depuis (389, 223) le plus proche est (304, 238) : il passe par (494, 228) avant de monter.
    const nearTrail = trail.get(6)!;
    expect(nearTrail.indexOf("494,228")).toBeGreaterThan(0);
    expect(nearTrail.indexOf("494,228")).toBeLessThan(nearTrail.indexOf("536,80"));
    // Toute la sortie se fait derrière la cave (rocher de la moitié droite) : les marches à pied rechargent des scripts sans toucher aux drapeaux d'ordre.
    expect(alwaysHidden).toBe(true);
  });

  it("le bouton carte demande l'avertissement, puis mène à la carte sans réussite", async () => {
    const { host, ticks, zoombinis, engine } = await start(0);
    host.click(620, 420);
    await ticks(6);
    expect(zoombinis.lastChange).toBeNull();
    host.press("Enter");
    await ticks(6);
    expect(engine.error).toBeNull();
    expect(zoombinis.lastChange).toMatchObject({ screen: S.map });
    expect(zoombinis.game.successes[S.tunnels - 7]).toBe(0);
  });

  it("une partie enregistrée pendant l'épreuve retrouve son groupe entier ; le crochet est retiré à la sortie", async () => {
    const { engine, zoombinis, host, ticks } = await start(0, 8);
    const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(zoombinis.game.group.members).toHaveLength(8);
    host.click(620, 420);
    await ticks(6);
    host.press("Enter");
    await ticks(6);
    expect(dialogs.beforeSave).toHaveLength(0);
  });

  it("la tête de file attend la fin de la phrase de réaction (la file reste occupée tant que le gardien parle)", async () => {
    const { dragTo, right, until, scene } = await start(0);
    await dragTo(0, right(0));
    await until(() => scene.debug.statusOf(0) === "arrived");
    // Le Zoombini est arrivé, la file n'est libérée qu'à la fin de la réaction du gardien (première réussite de l'entrée).
    expect(scene.debug.busy || scene.debug.queueLength === 0).toBe(true);
    await until(() => !scene.debug.busy && scene.debug.queueLength === 0);
  });

  describe("touches du mode de test (1190:1199)", () => {
    /** L'épreuve en mode de test (ou non), les textes dessinés et les scripts lancés notés, la voix d'introduction finie. */
    const startKeys = async (testMode: boolean, level: Level = 0, seed = 3) => {
      const env = await start(level, 16, seed, undefined, testMode);
      const lines: string[] = [];
      const text = env.engine.services.get(ZOOMBINIS_TEXT);
      const draw = text.drawText.bind(text);
      vi.spyOn(text, "drawText").mockImplementation((surface, font, value, ...rest) => {
        lines.push(value);
        return draw(surface, font, value, ...rest);
      });
      const quiet = () => env.until(() => !env.scene.debug.busy && env.scene.debug.queueLength === 0);
      await quiet();
      const started: number[] = [];
      const set = env.features.setScript.bind(env.features);
      vi.spyOn(env.features, "setScript").mockImplementation((feature, id, play) => {
        // Les scripts des gardiens seulement (4000 à 4699).
        if ((id ?? 0) >= 4000 && (id ?? 0) < 4700) started.push(id ?? 0);
        return set(feature, id, play);
      });
      const press = async (key: string) => {
        env.host.press(`Key${key.toUpperCase()}`, { key });
        await env.ticks(3);
      };
      const guard = (script: number) => env.features.features.some((f) => f.depth === 0.3 && f.scriptId === script);
      return { ...env, lines, started, quiet, press, guard };
    };
    const pillarLines = (lines: string[]) => lines.filter((l) => l.startsWith("SCRB id:"));

    it("hors du mode de test, aucune touche n'agit (ni a, C, F, I, O, H, W, w, t, T, e)", async () => {
      const t = await startKeys(false, 1);
      for (const key of "aCFIOHWwtTe") await t.press(key);
      await ticks3(t);
      expect(t.lines.filter((l) => /accept|SCRB id/.test(l))).toEqual([]);
      expect(t.started).toEqual([]);
      expect(t.scene.debug.queueLength).toBe(0);
    });

    const ticks3 = (t: { ticks: (n: number) => Promise<void> }) => t.ticks(3);

    it.each([
      [0, 1],
      [0, 2],
      [0, 5],
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 4],
      [3, 6],
    ] as const)("a : message d'après le nombre de règles et leurs sens (niveau %i, graine %i)", async (level, seed) => {
      const t = await startKeys(true, level, seed);
      const [first, second] = t.rules().rules;
      const expected =
        t.rules().rules.length === 1
          ? first!.w
            ? "Left accepts:"
            : "Right accepts:"
          : first!.w
            ? second!.w
              ? "Left / Top accept:"
              : "Left / Bottom accept:"
            : second!.w
              ? "Right / Top accept:"
              : "Right / Bottom accept:";
      await t.press("a");
      expect(t.lines).toContain(expected);
    });

    it("C, F, I, O font défiler les scripts d'un gardien avec le compteur partagé ; « SCRB id: » le dit ; la série repart au début", async () => {
      const t = await startKeys(true);
      await t.press("C");
      expect(pillarLines(t.lines)).toEqual(["SCRB id: 4000"]);
      expect(t.guard(4000)).toBe(true);
      await t.press("C");
      expect(t.guard(4001)).toBe(true);
      // Le compteur est partagé : 4002 est hors de la série de F (4200 à 4226), elle commence à son début ; puis I, O de même.
      await t.press("F");
      expect(t.guard(4200)).toBe(true);
      await t.press("I");
      expect(t.guard(4400)).toBe(true);
      await t.press("O");
      expect(t.guard(4600)).toBe(true);
      await t.press("O");
      expect(t.guard(4601)).toBe(true);
      expect(pillarLines(t.lines)).toEqual(["SCRB id: 4000", "SCRB id: 4001", "SCRB id: 4200", "SCRB id: 4400", "SCRB id: 4600", "SCRB id: 4601"]);
      // Fin de série : 4617 puis retour à 4600.
      for (let n = 2; n < 19; n++) await t.press("O");
      expect(pillarLines(t.lines).slice(-2)).toEqual(["SCRB id: 4617", "SCRB id: 4600"]);
    });

    it("H ajoute quatre animations de victoire : un Zoombini arrivé danse, ce que rien ne fait sans elle", async () => {
      const danced = async (key: string | null) => {
        const t = await startKeys(true);
        await t.dragTo(0, t.right(0));
        await t.until(() => t.scene.debug.statusOf(0) === "arrived");
        await t.quiet();
        if (key) await t.press(key);
        for (let n = 0; n < 160; n++) {
          await t.ticks(2);
          const id = t.kit().members[0]!.snoid.feature.scriptId;
          if (id >= 8560 && id <= 8564) return true;
        }
        return false;
      };
      expect(await danced(null)).toBe(false);
      expect(await danced("H")).toBe(true);
    });

    it("w, W, t, T, e mettent chacun une phrase des gardiens en file : introduction, encouragement, effondrement, sortie", async () => {
      const t = await startKeys(true);
      const phrases = async (key: string) => {
        t.started.length = 0;
        await t.press(key);
        expect(t.scene.debug.queueLength + (t.scene.debug.busy ? 1 : 0), key).toBeGreaterThan(0);
        await t.quiet();
        return t.started.slice();
      };
      // Introduction de la première visite (4 variantes), puis après W celle des visites suivantes (8 variantes, scripts disjoints).
      const first = new Set([4221, 4024, 4025, 4614, 4409]);
      const later = new Set([4611, 4026, 4224, 4412, 4612, 4613, 4223, 4222, 4410, 4411, 4027, 4028]);
      for (let n = 0; n < 3; n++) for (const id of await phrases("w")) expect(first.has(id), `w : ${id}`).toBe(true);
      for (let n = 0; n < 3; n++) for (const id of await phrases("W")) expect(later.has(id), `W : ${id}`).toBe(true);
      // `w` ensuite reste une introduction des visites suivantes (`a18e` reste à 1).
      for (const id of await phrases("w")) expect(later.has(id), `w après W : ${id}`).toBe(true);
      for (const id of await phrases("T")) expect([4420, 4421, 4422], `T : ${id}`).toContain(id);
      // Personne n'est sauvé : phrases de sortie « avec des perdus » (9 variantes).
      const some = [4225, 4226, 4615, 4616, 4034, 4036, 4037, 4032, 4033];
      for (const id of await phrases("e")) expect(some, `e : ${id}`).toContain(id);
      const encouragement = await phrases("t");
      expect(encouragement.length).toBeGreaterThan(0);
      // Aucune de ces touches ne change la file de décisions des Zoombinis ni le budget.
      expect(t.scene.debug.state!.budget).toBe(ERROR_BUDGETS[0]);
    });
  });
});
