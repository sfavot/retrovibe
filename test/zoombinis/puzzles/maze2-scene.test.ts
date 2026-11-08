import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { Archive } from "../../../src/engine/mohawk/resources";
import { scrs } from "../../../src/games/zoombinis/engine/resources";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import {
  MAZE2_RAMPS,
  Maze2Kind,
  advanceMaze2,
  launchMaze2,
  maze2Idle,
  maze2MemberState,
  maze2Outcome,
  planMaze2,
  type Maze2World,
} from "../../../src/games/zoombinis/game/puzzles/maze2";
import { nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type GameState, type Session, type Zoombini } from "../../../src/games/zoombinis/game/state";
import { CLIFF_PLACES, IMAGE_TICKS, createMaze2Scene, type Maze2Probe, type Maze2Scene } from "../../../src/games/zoombinis/scenes/puzzles/maze2";
import { HELP_KEY } from "../../../src/games/zoombinis/scenes/puzzle-kit";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

const S = ScreenId;
const TICK_MS = 17;

/** Un groupe de `count` Zoombinis aux fiches variées (`variant` décale les valeurs). */
function party(count: number, variant = 0): Zoombini[] {
  return Array.from({ length: count }, (_, i) =>
    makeZoombini([1 + ((i + variant) % 5), 1 + (Math.floor((i + variant) / 5) % 5), 1 + ((i * 2 + variant) % 5), 1 + ((i * 3 + variant) % 5)], i + 1),
  );
}

/** Ce qu'un lancer (ou deux) fait dans la simulation seule : tourbillon, collision, case d'attente. */
function simulate(w: Maze2World) {
  const events = { whirl: false, clash: false, wait: false, rotations: 0, buttons: 0 };
  const rejected = new Set<number>();
  let dirs = w.cells.map((c) => c.dir);
  for (let i = 0; i < 6000 && !maze2Idle(w); i++) {
    advanceMaze2(w);
    // Aiguillages qui ont tourné : seuls (tournants) ou par un bouton (kind 4 non tournant).
    w.cells.forEach((cell, k) => {
      if (cell.dir === dirs[k]) return;
      if (cell.rotates) events.rotations++;
      else if (cell.kind === Maze2Kind.switch) events.buttons++;
    });
    dirs = w.cells.map((c) => c.dir);
    for (const f of w.flights) {
      if (f.state === "reject" && !rejected.has(f.id)) {
        rejected.add(f.id);
        // 26 images avant le retour pour un tourbillon, 12 pour une collision.
        if (f.backAt - (w.time - 1) > 20) events.whirl = true;
        else events.clash = true;
      }
      if (f.state === "wait") events.wait = true;
    }
  }
  return events;
}

/** Cherche un lancer `(membre, rampe)` de la falaise 0 dont le résultat, simulé seul, vérifie `wanted`. */
function findLaunch(probe: Maze2Probe, wanted: (w: Maze2World, id: number, events: ReturnType<typeof simulate>) => boolean): { index: number; ramp: number } | null {
  const size = probe.kit.members.length;
  for (let index = 0; index < size; index++) {
    for (const ramp of probe.world.ramps) {
      if (MAZE2_RAMPS[ramp - 1]!.cliff !== 0) continue;
      const w = probe.snapshot();
      if (!launchMaze2(w, index + 1, ramp).ok) continue;
      const events = simulate(w);
      if (wanted(w, index + 1, events)) return { index, ramp };
    }
  }
  return null;
}

/** Cherche deux lancers, le second `delay` images après le premier, dont les Zoombinis se heurtent (rampes différentes avant 35 images, la même ensuite). */
function findClash(probe: Maze2Probe): { a: { index: number; ramp: number }; b: { index: number; ramp: number }; delay: number } | null {
  const size = probe.kit.members.length;
  const ramps = probe.world.ramps.filter((r) => MAZE2_RAMPS[r - 1]!.cliff === 0);
  for (let delay = 0; delay <= 40; delay++) {
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        if (i === j) continue;
        for (const r of ramps) {
          for (const r2 of ramps) {
            const w = probe.snapshot();
            launchMaze2(w, i + 1, r);
            advanceMaze2(w, delay);
            if (!launchMaze2(w, j + 1, r2).ok) continue;
            if (simulate(w).clash) return { a: { index: i, ramp: r }, b: { index: j, ramp: r2 }, delay };
          }
        }
      }
    }
  }
  return null;
}

describe.skipIf(!original.has)("gouffre des véhibules : écran (écran 18, MAZE2.MHK)", () => {
  async function start(options: { level?: number; size?: number; variant?: number; lessAction?: boolean; magnetic?: boolean; setup?: (game: GameState, session: Session) => void } = {}) {
    const level = options.level ?? 0;
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 11 });
    const services = await installServices(engine);
    const entered: number[] = [];
    const scene: Maze2Scene = createMaze2Scene();
    for (const id of Object.values(S)) {
      if (id === S.maze2) engine.register(id, () => scene);
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
    zoombinis.game.group.members = party(options.size ?? 8, options.variant ?? 0);
    zoombinis.game.stageUnbroken = true;
    zoombinis.game.levels = [level, level, level, level];
    // Par défaut : tous debout et « relâcher dépose » ; la partie neuve (arrivée à pied, transport collé) se teste à part.
    zoombinis.game.options.lessAction = options.lessAction ?? true;
    zoombinis.game.options.magneticMouse = options.magnetic ?? false;
    options.setup?.(zoombinis.game, zoombinis.session);
    zoombinis.session.screen = S.maze2;
    engine.start(S.maze2);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const features = engine.services.get(FEATURES);
    const probe = (): Maze2Probe => scene.probe!;
    const wait = (ticks: number) => runFor(engine, host, ticks * TICK_MS);
    /** Avance jusqu'à ce que `done` soit vrai (au plus `limit` ticks), en relevant les scripts vus à l'écran. */
    const seen = new Set<number>();
    const until = async (done: () => boolean, limit = 4000) => {
      for (let waited = 0; !done() && waited < limit; waited += 3) {
        await wait(3);
        for (const f of features.features) seen.add(f.scriptId);
      }
      expect(done()).toBe(true);
    };
    const scripts = () => features.features.map((f) => f.scriptId);
    /** Plus rien ne vole (les Zoombinis retenus dans une case d'attente restent), plus de lancer en cours, plus de danse d'arrivée, plus personne en marche. */
    const settled = () => probe().launches === 0 && probe().landDances === 0 && probe().world.flights.every((f) => f.state === "wait") && probe().kit.members.every((m) => !m.snoid.walking);
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
    const rampPoint = (ramp: number) => MAZE2_RAMPS[ramp - 1]!.drop;
    return { host, engine, services, zoombinis, entered, scene, sound, queued, probe, wait, until, seen, scripts, settled, grab, drag, rampPoint, features, dialog: engine.services.get(DIALOG) };
  }

  /** Rampes actives de la carte, dans l'ordre de l'en-tête. */
  const activeRamps = (probe: Maze2Probe) => probe.ramps.map((t) => t.tag as number);

  it.each([0, 1, 2, 3])("niveau %i : entrée sur le fond de MAZE2.MHK, cases de la carte, rampes actives, équipe sur la falaise 0, personne de sauvé, jingle et musique", async (level) => {
    const { probe, zoombinis, host, queued, scripts, features } = await start({ level });
    const { world, kit } = probe();
    expect(zoombinis.session.screen).toBe(S.maze2);
    expect(host.frames[host.frames.length - 1]!.pixels.some((p) => p !== 0)).toBe(true);
    expect(world.level).toBe(level);
    // La carte de la première visite : 16600 (niveau 0), 16602 (1), 16604 (2), 16606 (3).
    expect(world.mapIndex).toBe([0, 2, 4, 6][level]);
    expect(activeRamps(probe())).toEqual(world.ramps);
    // Décor : machine de la falaise 0, rochers fixes, marque, plaque, rampe (et son cache) de chaque rampe active.
    const ids = scripts();
    for (const id of [9005, 8000, 8004, 8011]) expect(ids, `SCRB ${id}`).toContain(id);
    for (const number of world.ramps) {
      const ramp = MAZE2_RAMPS[number - 1]!;
      for (const id of [7000 + number - 1, 7014 + number - 1, ramp.script]) expect(ids, `rampe ${number} : SCRB ${id}`).toContain(id);
      if (ramp.script !== 9000) expect(ids).toContain(ramp.script + 1);
      if (ramp.cliff > 0) expect(ids).toContain(9005 + ramp.cliff);
    }
    // Les cases : un enregistrement de la carte dessine au moins une image de `tBMP 5100`.
    const cells = world.cells;
    expect(cells.length).toBeGreaterThan(10);
    cells.forEach((cell, i) => {
      const images = probe().cellImages(i);
      if (cell.kind === Maze2Kind.whirl) expect(images).toHaveLength(1);
      if (cell.kind === Maze2Kind.panel && cell.panel && cell.panel.value > 0) {
        // Plaque, pétale de la direction, indicateur et icône du trait (images 11 à 30).
        const icon = images[images.length - 1]!;
        expect(icon).toBe(10 + 5 * cell.panel.attr + cell.panel.value);
        expect(icon).toBeGreaterThanOrEqual(11);
        expect(icon).toBeLessThanOrEqual(30);
      }
      if (cell.kind === Maze2Kind.arrow) expect(images).toContain(cell.spriteBase + 5 + cell.dir);
    });
    // L'équipe : 8 Zoombinis debout sur les 8 premières places de la falaise 0, personne de sauvé, rien en vol.
    expect(kit.members).toHaveLength(8);
    kit.members.forEach((m, i) => expect(m.snoid.position).toEqual(CLIFF_PLACES[0]![i]));
    expect(kit.members.every((m) => !m.zoombini.present)).toBe(true);
    expect(world.flights).toHaveLength(0);
    expect(kit.goEnabled).toBe(false);
    expect(queued).toContain(997);
    expect(queued).toContain(30035 + level);
    expect(features.features.filter((f) => f.hasFlag(1))).toHaveLength(8);
  });

  it("un groupe de moins de 5 Zoombinis au niveau 3 joue la carte 16609 (niveau 4) ; la musique reste celle du niveau 3", async () => {
    const { probe, queued } = await start({ level: 3, size: 4 });
    expect(probe().world.level).toBe(4);
    expect(probe().world.mapIndex).toBe(9);
    expect(probe().world.ramps).toEqual([3]);
    expect(queued).toContain(30038);
  });

  it("les cartes alternent d'une visite à l'autre de la même partie (16600 puis 16601)", async () => {
    const { scene, engine, probe } = await start({ level: 0 });
    expect(probe().world.mapIndex).toBe(0);
    scene.leave(engine.ctx);
    scene.enter(engine.ctx);
    expect(scene.probe!.world.mapIndex).toBe(1);
    scene.leave(engine.ctx);
    scene.enter(engine.ctx);
    expect(scene.probe!.world.mapIndex).toBe(0);
  });

  it("glisser un Zoombini sur une rampe : la rampe est occupée, il part ; un second dépôt sur la même rampe retourne à sa place ; hors rampe aussi", async () => {
    const { probe, drag, rampPoint, wait, until, scripts } = await start({ level: 0 });
    const ramp = probe().world.ramps[0]!;
    const first = probe().kit.members[0]!;
    const second = probe().kit.members[1]!;
    await drag(0, rampPoint(ramp));
    expect(probe().launches).toBe(1);
    expect(probe().ramps.find((t) => t.tag === ramp)!.owner).toBe(first);
    expect(first.snoid.position).toEqual(rampPoint(ramp));
    // Le Zoombini pris est entré dans la liste en vol dès l'image suivante : il ne peut plus être pris.
    await until(() => probe().world.launched.includes(1), 100);
    expect(probe().kit.pick(first.snoid.position.x, first.snoid.position.y)).toBe(false);
    // La rampe est occupée : le dépôt d'un autre Zoombini sur elle est hors cible, il rentre sur sa place.
    const home = { ...second.snoid.position };
    await drag(1, rampPoint(ramp));
    expect(second.snoid.position).toEqual(home);
    expect(probe().launches).toBe(1);
    // Hors de toute rampe : retour à la place.
    const third = probe().kit.members[2]!;
    const place = { ...third.snoid.position };
    await drag(2, { x: 300, y: 200 });
    expect(third.snoid.position).toEqual(place);
    // La rampe joue son script (machine à bulles, plaque, canon).
    await until(() => scripts().includes(MAZE2_RAMPS[ramp - 1]!.script) && scripts().includes(9005));
    await wait(1);
  });

  it("le survol d'une rampe par un Zoombini porté allume sa plaque (SCRB 7014 + z − 1)", async () => {
    const { probe, host, wait, rampPoint, grab, scripts, features } = await start({ level: 0 });
    const ramp = probe().world.ramps[0]!;
    const member = probe().kit.members[0]!;
    const point = grab(0)!;
    const at = { x: point.x - member.snoid.position.x, y: point.y - member.snoid.position.y };
    host.input.moveMouse(point.x, point.y);
    host.input.mouseDown("left");
    await wait(4);
    const plate = features.features.find((f) => f.scriptId === 7014 + ramp - 1)!;
    host.input.moveMouse(rampPoint(ramp).x + at.x, rampPoint(ramp).y + at.y);
    await wait(10);
    // Le script de la plaque (5 images) est en lecture : elle n'est plus l'image fixe.
    expect(plate.active || plate.image > 0).toBe(true);
    expect(scripts()).toContain(7014 + ramp - 1);
    host.input.mouseUp("left");
    await wait(6);
  });

  /** Premier niveau (0 à 3) dont une rampe active de la falaise 0 vérifie `wanted`. */
  async function startWithRamp(wanted: (ramp: (typeof MAZE2_RAMPS)[number]) => boolean, options: { size?: number } = {}) {
    for (let level = 0; level <= 3; level++) {
      const t = await start({ level, size: options.size });
      const ramp = t.probe().world.ramps.find((n) => MAZE2_RAMPS[n - 1]!.cliff === 0 && wanted(MAZE2_RAMPS[n - 1]!));
      if (ramp !== undefined) return { ...t, ramp };
    }
    throw new Error("aucune rampe de la falaise 0 ne convient");
  }

  it("bug 34 : la bulle (SCRB 10000…, rappel 1118:3dac et ancres REGS 17000 / 17001) enveloppe le Zoombini en vol jusqu'aux pieds, pour les 5 types de pieds", async () => {
    const { probe, wait } = await start({ level: 0, size: 8 });
    const ramps = probe().world.ramps.filter((n) => MAZE2_RAMPS[n - 1]!.cliff === 0);
    const feetSeen = new Set<number>();
    const outside: string[] = [];
    const steps = new Set<number>();
    for (let index = 0, ticks = 0; (index < 5 || probe().launches > 0) && ticks < 6000; ticks += 3) {
      if (index < 5 && ramps.some((ramp) => probe().launch(index, ramp))) index++;
      await wait(3);
      for (const member of probe().kit.members) {
        const bubble = probe().bubbleOf(member.index);
        const id = member.snoid.scriptId;
        // Scripts de pas `15015 + 5 × direction + pieds − 1` sous une bulle de pas `10000 + direction`.
        if (!bubble?.rect || !member.snoid.feature.rect || id < 15015 || id > 15034 || bubble.scriptId > 10003) continue;
        feetSeen.add(member.snoid.traits.feet);
        steps.add(id);
        const z = member.snoid.feature.rect;
        const b = bubble.rect;
        if (z.bottom > b.bottom || z.top < b.top || z.left < b.left || z.right > b.right)
          outside.push(`pieds ${member.snoid.traits.feet}, SCRS ${id} [${z.left},${z.top},${z.right},${z.bottom}] hors de la bulle ${bubble.scriptId} [${b.left},${b.top},${b.right},${b.bottom}]`);
      }
    }
    expect(feetSeen).toEqual(new Set([1, 2, 3, 4, 5]));
    expect(steps.size).toBeGreaterThan(5);
    expect(outside).toEqual([]);
  }, 60_000);

  it("bug 34 : au bond de lancement, la bulle naît sur la bulle que dessine le cache de la rampe (SCRB 9002 / 9004, image 29) : une seule bulle", async () => {
    const { probe, wait, features, ramp } = await startWithRamp((r) => r.script !== 9000);
    const script = MAZE2_RAMPS[ramp - 1]!.script;
    const front = features.features.find((f) => f.scriptId === script + 1)!;
    expect(probe().launch(0, ramp)).toBe(true);
    let cache: { left: number; top: number } | null = null;
    for (let ticks = 0; ticks < 600 && !probe().bubbleOf(0)?.rect; ticks++) {
      await wait(1);
      // Image 29 du cache : la bulle qui sort du canon (`tBMP 9000` image 216, 52 × 67).
      if (front.image === 29 && front.rect) cache = { left: front.rect.left, top: front.rect.top };
    }
    const bubble = probe().bubbleOf(0)!;
    expect(bubble.scriptId).toBe(MAZE2_RAMPS[ramp - 1]!.dir === 1 ? 10042 : 10043);
    expect(cache).not.toBeNull();
    expect(Math.abs(bubble.rect!.left - cache!.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(bubble.rect!.top - cache!.top)).toBeLessThanOrEqual(1);
  }, 60_000);

  it("bug 34 : au doigt, lâcher le Zoombini sur la flèche de la rampe (SCRB 7000 + z − 1) le lance ; à la souris, le même geste suit la règle de l'original (±15 px des pieds) et il rentre", async () => {
    for (const mode of ["souris", "doigt"] as const) {
      const { probe, host, wait, grab, features, rampPoint } = await start({ level: 0 });
      (host as unknown as { pointerIsTouch: boolean }).pointerIsTouch = mode === "doigt";
      const ramp = probe().world.ramps[0]!;
      const mark = features.features.find((f) => f.scriptId === 7000 + ramp - 1)!.rect!;
      const member = probe().kit.members[0]!;
      const home = { ...member.snoid.position };
      const point = grab(0)!;
      const at = { x: point.x - member.snoid.position.x, y: point.y - member.snoid.position.y };
      const finger = { x: Math.floor((mark.left + mark.right) / 2), y: Math.floor((mark.top + mark.bottom) / 2) };
      // Les pieds du Zoombini porté sont hors du carré de ±15 px du point de dépôt (`DS:9706`) : la flèche est sous ce point.
      expect(Math.max(Math.abs(finger.x - at.x - rampPoint(ramp).x), Math.abs(finger.y - at.y - rampPoint(ramp).y))).toBeGreaterThan(15);
      host.input.moveMouse(point.x, point.y);
      host.input.mouseDown("left");
      await wait(4);
      host.input.moveMouse(finger.x, finger.y);
      await wait(8);
      host.input.mouseUp("left");
      await wait(6);
      if (mode === "doigt") {
        expect(probe().launches).toBe(1);
        expect(member.snoid.position).toEqual(rampPoint(ramp));
      } else {
        expect(probe().launches).toBe(0);
        expect(member.snoid.position).toEqual(home);
      }
    }
  });

  it("bug 34 : au doigt, toucher un Zoombini puis toucher la flèche d'une rampe l'y lance", async () => {
    const { probe, host, wait, grab, features, rampPoint } = await start({ level: 0 });
    (host as unknown as { pointerIsTouch: boolean }).pointerIsTouch = true;
    const ramp = probe().world.ramps[0]!;
    const mark = features.features.find((f) => f.scriptId === 7000 + ramp - 1)!.rect!;
    const member = probe().kit.members[0]!;
    const point = grab(0)!;
    host.input.moveMouse(point.x, point.y);
    host.input.mouseDown("left");
    await wait(4);
    host.input.mouseUp("left");
    await wait(4);
    expect(probe().launches).toBe(0);
    host.input.moveMouse(mark.left + 1, mark.bottom - 2);
    await wait(4);
    host.input.mouseDown("left");
    await wait(2);
    host.input.mouseUp("left");
    await wait(6);
    expect(probe().launches).toBe(1);
    expect(member.snoid.position).toEqual(rampPoint(ramp));
  });

  it("un lancer suit les cases jusqu'à la sortie 3 : bulle, pas de case, atterrissage, retour à pied sur la falaise 3, « go » actif", async () => {
    const { probe, until, seen, queued, settled } = await start({ level: 0 });
    const found = findLaunch(probe(), (w, id) => w.members[id - 1]!.saved);
    expect(found, "un lancer qui sauve existe").not.toBeNull();
    const { index, ramp } = found!;
    expect(probe().launch(index, ramp)).toBe(true);
    const member = probe().kit.members[index]!;
    await until(() => probe().world.goalArrivals > 0, 3000);
    // Pendant le vol : machine à bulles, bulle, scripts de pas, tourbillon évité ; atterrissage, gerbe.
    await until(() => settled(), 3000);
    expect(seen.has(9005)).toBe(true);
    expect([...seen].some((id) => id >= 10000 && id <= 10003)).toBe(true);
    expect([...seen].some((id) => id >= 15015 && id <= 15034)).toBe(true);
    expect(seen.has(10040)).toBe(true);
    expect([...seen].some((id) => id >= 15076 && id <= 15080)).toBe(true);
    expect(seen.has(14007)).toBe(true);
    expect(seen.has(10031)).toBe(false);
    // Sauvé : sur la première place de la file de la falaise 3, `present` (`+0x127`), « go » actif.
    expect(probe().world.members[index]!.cliff).toBe(3);
    expect(member.snoid.position).toEqual(CLIFF_PLACES[3]![0]);
    expect(member.zoombini.present).toBe(true);
    expect(probe().kit.goEnabled).toBe(true);
    expect(probe().kit.buttonState("go")).toBe("normal");
    expect(maze2Outcome(probe().world).saved).toEqual([index + 1]);
    expect(queued).toContain(30035);
  }, 60_000);

  it("danse d'arrivée : le Zoombini qui atterrit sur la falaise 3 joue SCRS 14007 puis SCRS 15090 + pieds en entier (il ne marche qu'après) ; sur une falaise de relais, pas de danse", async () => {
    const { probe, until, features, wait, settled, scene } = await start({ level: 0 });
    // Ticks écoulés de l'écran (l'hôte de test ne garantit pas la durée d'un tick en millisecondes).
    let ticks = 0;
    const tick = scene.tick.bind(scene);
    scene.tick = (...args) => {
      ticks += 1;
      tick(...args);
    };
    const found = findLaunch(probe(), (w, id) => w.members[id - 1]!.saved);
    expect(found, "un lancer qui sauve existe").not.toBeNull();
    const { index, ramp } = found!;
    const member = probe().kit.members[index]!;
    const feet = member.snoid.traits.feet;
    expect(probe().launch(index, ramp)).toBe(true);
    // Scripts joués par le Zoombini, un échantillon par tick (suites identiques regroupées), et marche en cours.
    const played: number[] = [];
    const walkingAt: boolean[] = [];
    const startedAt: number[] = [];
    const sample = () => {
      const id = features.features.find((f) => f === member.snoid.feature)?.scriptId ?? -1;
      if (played[played.length - 1] !== id) {
        played.push(id);
        walkingAt.push(member.snoid.walking);
        startedAt.push(ticks);
      }
    };
    await until(() => {
      sample();
      return probe().world.goalArrivals > 0 && settled();
    }, 4000);
    const dance = 15090 + feet;
    const land = played.indexOf(14007);
    const danced = played.indexOf(dance);
    expect(land, "SCRS 14007 joué").toBeGreaterThan(-1);
    expect(played[land - 1]).toBe(15075 + feet);
    // La danse suit `14007` sans autre script entre eux, une seule fois (un seul Zoombini sauvé : pas de danse finale), sur sa case d'arrivée.
    expect(danced).toBe(land + 1);
    expect(played.filter((id) => id === dance)).toHaveLength(1);
    expect(walkingAt[danced]).toBe(false);
    // Elle va au bout de ses images (6 ticks chacune ; échantillons toutes les 3 ticks) avant que la marche ne commence.
    const images = scrs(new Archive("MAZE2.MHK", MohawkArchive.parse(original.read("MAZE2.MHK"))), dance).imageCount;
    expect(startedAt[danced + 1]! - startedAt[danced]!).toBeGreaterThanOrEqual((images - 1) * IMAGE_TICKS);
    // Après la danse seulement : la marche vers la première place de la falaise 3.
    expect(played.length).toBeGreaterThan(danced + 1);
    expect(member.snoid.position).toEqual(CLIFF_PLACES[3]![0]);
    expect(member.zoombini.present).toBe(true);
    await wait(60);
    expect(played.filter((id) => id === dance)).toHaveLength(1);
  }, 60_000);

  it("danse d'arrivée : pas de danse sur une falaise de relais (SCRS 14007 seul, puis la marche)", async () => {
    const { probe, until, features, settled } = await start({ level: 3 });
    const found = findLaunch(probe(), (w, id) => w.members[id - 1]!.cliff === 2);
    expect(found).not.toBeNull();
    const { index, ramp } = found!;
    const member = probe().kit.members[index]!;
    const played = new Set<number>();
    expect(probe().launch(index, ramp)).toBe(true);
    await until(() => {
      played.add(features.features.find((f) => f === member.snoid.feature)?.scriptId ?? -1);
      return settled() && probe().world.members[index]!.cliff === 2 && probe().world.flights.length === 0;
    }, 4000);
    expect(played.has(14007)).toBe(true);
    for (let feet = 1; feet <= 5; feet++) expect(played.has(15090 + feet)).toBe(false);
    expect(probe().landDances).toBe(0);
  }, 90_000);

  it("la simulation avance d'une image toutes les 6 ticks, seulement quand quelque chose bouge", async () => {
    const { probe, wait } = await start({ level: 0 });
    // Rien ne vole : le temps de la simulation est arrêté.
    await wait(60);
    expect(probe().images).toBe(0);
    const found = findLaunch(probe(), (w, id) => w.members[id - 1]!.saved)!;
    expect(probe().launch(found.index, found.ramp)).toBe(true);
    await wait(IMAGE_TICKS);
    const before = probe().images;
    expect(before).toBeGreaterThan(0);
    await wait(60);
    // 60 ticks de 17 ms simulés à 60 Hz : 10 images, à une près.
    expect(Math.abs(probe().images - before - 60 / IMAGE_TICKS)).toBeLessThanOrEqual(1);
  });

  it("un lancer glissé à la souris atteint la sortie 3 comme un lancer direct", async () => {
    const { probe, until, drag, rampPoint, settled } = await start({ level: 0 });
    const found = findLaunch(probe(), (w, id) => w.members[id - 1]!.saved)!;
    await drag(found.index, rampPoint(found.ramp));
    await until(() => settled() && probe().world.goalArrivals > 0, 4000);
    expect(probe().world.members[found.index]!.cliff).toBe(3);
    expect(probe().kit.members[found.index]!.zoombini.present).toBe(true);
  }, 60_000);

  it("un lancer qui tombe dans un tourbillon revient sur la falaise de lancement (première place de la file), relançable, « go » grisé", async () => {
    const { probe, until, seen, settled } = await start({ level: 0 });
    const found = findLaunch(probe(), (w, id, e) => e.whirl && w.members[id - 1]!.cliff === 0 && !w.members[id - 1]!.saved);
    expect(found, "un lancer qui rejoint un tourbillon existe").not.toBeNull();
    const { index, ramp } = found!;
    expect(probe().launch(index, ramp)).toBe(true);
    await until(() => seen.has(14006), 3000);
    await until(() => settled(), 3000);
    expect(seen.has(10031)).toBe(true);
    expect(probe().world.goalArrivals).toBe(0);
    const member = probe().kit.members[index]!;
    // `DS:8920 = 0x10` : les 16 premières places de la falaise 0 sont celles de l'équipe, la file des retours commence à la 17e.
    expect(member.snoid.position).toEqual(CLIFF_PLACES[0]![16]);
    expect(member.zoombini.present).toBe(false);
    expect(probe().kit.goEnabled).toBe(false);
    expect(maze2MemberState(probe().world, index + 1)).toBe("cliff");
    // Il peut être relancé tout de suite : la rampe est libre de nouveau.
    expect(probe().ramps.every((t) => t.owner === null)).toBe(true);
    expect(probe().launch(index, ramp)).toBe(true);
  }, 60_000);

  it("deux Zoombinis qui réservent la même case sont rejetés ensemble (collision) et reviennent sur la falaise de lancement", async () => {
    const { probe, until, seen, settled } = await start({ level: 0 });
    const clash = findClash(probe());
    expect(clash, "une collision existe").not.toBeNull();
    const { a, b, delay } = clash!;
    expect(probe().launch(a.index, a.ramp)).toBe(true);
    // Le second lancer part `delay` images de simulation après le premier (la simulation compte une image toutes les 6 ticks).
    const first = probe().images;
    await until(() => probe().images >= first + delay, 1000);
    expect(probe().launch(b.index, b.ramp)).toBe(true);
    await until(() => seen.has(14004), 3000);
    await until(() => settled(), 3000);
    // Pose de collision (15035…), éclaboussure (10012…), `SCRS 14004`.
    expect([...seen].some((id) => id >= 15035 && id <= 15054)).toBe(true);
    expect([...seen].some((id) => id >= 10012 && id <= 10029)).toBe(true);
    for (const { index } of [a, b]) {
      expect(maze2MemberState(probe().world, index + 1)).not.toBe("flying");
      expect(probe().world.members[index]!.cliff).toBe(0);
    }
    expect(probe().kit.goEnabled).toBe(false);
  }, 60_000);

  it("un aiguillage tournant joue 5101 puis 5102 à chaque passage ; un bouton actionné joue 5103 et s'enfonce (cartes à aiguillages et à boutons)", async () => {
    // Cartes à aiguillage tournant : 16602 (niveau 1, 1re visite), 16603 (niveau 1, 2e visite, boutons), 16604 (niveau 2), 16606 (niveau 3).
    let rotated = false;
    let pressed = false;
    for (const [level, visits] of [[1, 0], [1, 1], [2, 0], [2, 1], [3, 0]] as const) {
      const { until, queued, settled, scene, engine, features } = await start({ level });
      for (let v = 0; v < visits; v++) {
        scene.leave(engine.ctx);
        scene.enter(engine.ctx);
      }
      const probe = scene.probe!;
      const rotating = findLaunch(probe, (_w, _id, e) => e.rotations > 0 && e.buttons === 0);
      if (rotating) {
        expect(probe.launch(rotating.index, rotating.ramp)).toBe(true);
        await until(() => settled() && probe.images > 40, 6000);
        expect(queued).toContain(5101);
        rotated = true;
        queued.length = 0;
      }
      const button = findLaunch(probe, (_w, _id, e) => e.buttons > 0);
      if (button) {
        expect(probe.launch(button.index, button.ramp)).toBe(true);
        // Le bouton s'enfonce (`base + 15…18` dans la case) pendant que le son 5103 part.
        let pushed = false;
        await until(() => {
          if (probe.world.cells.some((c, i) => c.kind === Maze2Kind.button && probe.cellImages(i).length > 1)) pushed = true;
          return queued.includes(5103) && settled();
        }, 6000);
        expect(pushed).toBe(true);
        pressed = true;
      }
      expect(features.features.length).toBeGreaterThan(0);
    }
    expect(rotated, "un lancer a fait tourner un aiguillage").toBe(true);
    expect(pressed, "un lancer a actionné un bouton").toBe(true);
  }, 120_000);

  it("niveau 3, relais : un Zoombini qui atterrit sur la falaise 2 y reste, peut être relancé depuis la rampe 12 mais plus depuis la falaise 0", async () => {
    const { probe, until, settled, seen } = await start({ level: 3 });
    expect(probe().world.ramps).toEqual([2, 4, 12]);
    const found = findLaunch(probe(), (w, id) => w.members[id - 1]!.cliff === 2);
    expect(found, "un lancer qui atterrit sur la falaise 2 existe").not.toBeNull();
    const { index, ramp } = found!;
    expect(probe().launch(index, ramp)).toBe(true);
    await until(() => settled(), 4000);
    const member = probe().kit.members[index]!;
    expect(probe().world.members[index]!.cliff).toBe(2);
    expect(member.snoid.position).toEqual(CLIFF_PLACES[2]![0]);
    expect(member.zoombini.present).toBe(false);
    expect(seen.has(9007)).toBe(true);
    expect(maze2MemberState(probe().world, index + 1)).toBe("relay");
    // Plus de rampe de la falaise 0 pour lui ; la rampe 12 (falaise 2) l'accepte.
    expect(probe().launch(index, 2)).toBe(false);
    expect(probe().launch(index, 4)).toBe(false);
    expect(probe().launch(index, 12)).toBe(true);
    await until(() => settled(), 4000);
    expect(probe().world.launched).toHaveLength(0);
  }, 90_000);

  it("une case d'attente retient le Zoombini (niveau 3) : il reste en vol, animation d'attente en boucle", async () => {
    const { probe, until, scripts } = await start({ level: 3 });
    const found = findLaunch(probe(), (_w, _id, e) => e.wait);
    expect(found, "un lancer retenu dans une case d'attente existe").not.toBeNull();
    expect(probe().launch(found!.index, found!.ramp)).toBe(true);
    await until(() => maze2MemberState(probe().world, found!.index + 1) === "waiting", 3000);
    await until(() => scripts().some((id) => id >= 15056 && id <= 15075), 200);
    // Retenu : il n'est ni perdu ni revenu, et ne peut pas être pris.
    expect(probe().kit.pick(probe().kit.members[found!.index]!.snoid.position.x, probe().kit.members[found!.index]!.snoid.position.y)).toBe(false);
  }, 60_000);

  it("au plus 10 Zoombinis en vol : le onzième ne peut pas être pris", async () => {
    const { probe, grab } = await start({ level: 0, size: 12 });
    for (let id = 100; id < 110; id++) probe().world.launched.push(id);
    expect(grab(0)).not.toBeNull();
    const point = grab(0)!;
    expect(probe().kit.pick(point.x, point.y)).toBe(false);
    expect(probe().launch(0, probe().world.ramps[0]!)).toBe(false);
    probe().world.launched.length = 0;
    expect(probe().kit.pick(point.x, point.y)).toBe(true);
  });

  it("« go » : grisé tant que personne n'est arrivé ; après une arrivée il joue 996 puis mène à Zoombiniville, les autres sont perdus", async () => {
    const { probe, host, until, wait, queued, settled, zoombinis, engine } = await start({ level: 0 });
    // Grisé : le clic ne fait rien.
    host.click(620, 460);
    await wait(10);
    expect(probe().kit.finishing).toBe(false);
    expect(queued).not.toContain(996);
    const found = findLaunch(probe(), (w, id) => w.members[id - 1]!.saved)!;
    expect(probe().launch(found.index, found.ramp)).toBe(true);
    await until(() => settled() && probe().world.goalArrivals > 0, 4000);
    expect(probe().kit.goEnabled).toBe(true);
    host.click(620, 460);
    await wait(2);
    expect(queued).toContain(996);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 3000);
    expect(engine.error).toBeNull();
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.maze2, "success") });
    const { game } = zoombinis;
    // Les 7 autres sont perdus ; le passage est marqué (bit du niveau 0) mais pas « sans perte ».
    expect(game.successes[11]! & 1).toBe(1);
    expect(game.successes[11]! & 0x10).toBe(0);
    expect(game.group.members.filter((z) => z.present)).toHaveLength(1);
  }, 60_000);

  it("le bouton carte joue 999 et demande confirmation avant d'abandonner le groupe", async () => {
    const { host, wait, queued, dialog, probe } = await start({ level: 0 });
    host.click(620, 420);
    await wait(3);
    expect(queued).toContain(999);
    expect(dialog.isOpen).toBe(true);
    expect(probe().kit.finishing).toBe(false);
  });

  it("F1 rejoue la voix d'introduction 20068", async () => {
    const { host, wait, queued } = await start({ level: 0 });
    host.press(HELP_KEY);
    await wait(2);
    expect(queued).toContain(20068);
  });

  it("une partie enregistrée pendant l'épreuve retrouve le groupe entier (perdus compris) ; le crochet est retiré à la sortie", async () => {
    const { engine, zoombinis, scene } = await start({ level: 0, size: 8 });
    const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(zoombinis.game.group.members).toHaveLength(8);
    expect(zoombinis.game.group.members.every((z) => z.present)).toBe(true);
    scene.leave(engine.ctx);
    expect(dialogs.beforeSave).toHaveLength(0);
  });

  it("partie neuve (arrivée à pied, transport collé) : un glissé prend, le clic suivant dépose sur la rampe", async () => {
    const { probe, host, wait, until, rampPoint, grab } = await start({ level: 0, lessAction: false, magnetic: true });
    await wait(900);
    const ramp = probe().world.ramps[0]!;
    const index = probe().kit.members.findIndex((m, i) => !m.walking && m.snoid.resting && grab(i) !== null);
    expect(index).toBeGreaterThanOrEqual(0);
    const member = probe().kit.members[index]!;
    const point = grab(index)!;
    const at = { x: point.x - member.snoid.position.x, y: point.y - member.snoid.position.y };
    host.click(point.x, point.y);
    await wait(6);
    host.input.moveMouse(rampPoint(ramp).x + at.x, rampPoint(ramp).y + at.y);
    await wait(8);
    host.click(rampPoint(ramp).x + at.x, rampPoint(ramp).y + at.y);
    await wait(6);
    await until(() => probe().world.launched.includes(index + 1), 100);
    expect(probe().world.flights[0]!.id).toBe(index + 1);
  }, 60_000);

  describe("le robot sauve tout le groupe, lancer après lancer, à chaque niveau", () => {
    it.each([
      [0, 6, 0],
      [1, 6, 0],
      [2, 6, 0],
      [3, 6, 3],
      [3, 3, 0],
    ])("niveau %i, %i Zoombinis (variante %i)", async (level, size, variant) => {
      const { probe, until, settled, queued, seen } = await start({ level, size, variant });
      const plan = planMaze2(probe().snapshot(), 100_000);
      expect(plan.complete, "un plan qui sauve tout le groupe existe").toBe(true);
      for (const launch of plan.launches) {
        // Chaque lancer part quand le précédent est fini et que les Zoombinis sont rentrés.
        expect(probe().launch(launch.id - 1, launch.ramp), `lancer ${launch.id} depuis la rampe ${launch.ramp}`).toBe(true);
        await until(() => settled(), 6000);
      }
      const outcome = maze2Outcome(probe().world);
      expect(outcome.allSaved).toBe(true);
      expect(outcome.lost).toEqual([]);
      expect(probe().kit.members.every((m) => m.zoombini.present)).toBe(true);
      expect(probe().kit.goEnabled).toBe(true);
      // Tous sur la falaise 3 : voix de réussite (20055 à 20063), puis une danse (SCRS 15091 à 15095) toutes les 30 ticks.
      expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(true);
      await until(() => [...seen].some((id) => id >= 15091 && id <= 15095) || !probe().dancing, 600);
      if (size > 1) expect([...seen].some((id) => id >= 15091 && id <= 15095)).toBe(true);
    }, 240_000);
  });
});
