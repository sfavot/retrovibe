import { describe, expect, it, vi } from "vitest";
import { MsvcRandom } from "../../src/engine/mohawk/rng";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FEATURES, FeatureFlag } from "../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { installServices } from "../../src/games/zoombinis/engine/services";
import { typeIndex, type GameState } from "../../src/games/zoombinis/game/state";
import { generateName, nameOf, createPickerScene } from "../../src/games/zoombinis/scenes/picker";
import { originalFiles } from "../support/original";
import { runFor, TestHost } from "./engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

/** Centres des boutons (`1470:0000` et suivants) : attribut `row` (0 à 3) de valeur `value` (1 à 5), et les actions. */
const attribute = (row: number, value: number): [number, number] => [3 + 39 * (value - 1) + 19, 304 + 44 * row + 20];
const ADD: [number, number] = [232, 323];
/** Entrée de la grotte : la zone de retrait (`DS:1ab6`, (172, 226), tolérance 60). */
const CAVE = [175, 225] as const;
const GUIDE: [number, number] = [239, 383];
const NAME: [number, number] = [244, 428];
const RANDOM: [number, number] = [232, 459];
const MAP: [number, number] = [619, 421];
const GO: [number, number] = [619, 459];

/** Les 16 places (`1470:03cc`). */
const SLOTS = [
  [542, 446],
  [505, 447],
  [466, 451],
  [425, 448],
  [380, 450],
  [342, 451],
  [522, 402],
  [488, 408],
  [444, 416],
  [403, 413],
  [364, 413],
  [498, 360],
  [463, 367],
  [426, 370],
  [389, 373],
  [352, 374],
] as const;

describe.skipIf(!original.has)("choix des Zoombinis (écran 3)", () => {
  /** Le choix des Zoombinis, venant de `from` (défaut : la carte) ; les autres écrans sont des scènes vides qui notent leur entrée. */
  async function start(setup?: (game: GameState, session: { previous: number; training: number }) => void, from: number = ScreenId.map) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 7 });
    const services = await installServices(engine);
    const entered: number[] = [];
    engine.register(ScreenId.picker, createPickerScene);
    for (const id of [ScreenId.map, ScreenId.xfer, ScreenId.bridge]) engine.register(id, () => ({ enter: () => void entered.push(id), leave() {}, tick() {} }));
    const queue = vi.spyOn(services.sound, "queue");
    setup?.(services.game.game, services.game.session);
    services.game.session.screen = ScreenId.picker;
    services.game.session.previous = from;
    engine.start(ScreenId.picker);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const features = engine.services.get(FEATURES);
    const zoombinis = services.game;
    const snoids = () => features.features.filter((f) => f.hasFlag(FeatureFlag.snoid));
    const click = async (at: readonly [number, number], ms = 40) => {
      host.click(at[0], at[1]);
      await runFor(engine, host, ms);
    };
    /** Glisse (bouton tenu) du point `from` au point `to`, puis relâche (`1168:1742`). */
    const drag = async (from: readonly [number, number], to: readonly [number, number]) => {
      host.input.moveMouse(from[0], from[1]);
      host.input.mouseDown("left");
      await runFor(engine, host, 60);
      host.input.moveMouse(to[0], to[1]);
      await runFor(engine, host, 120);
      host.input.mouseUp("left");
      await runFor(engine, host, 60);
    };
    /** Compose et ajoute un Zoombini de type `attrs`. */
    const chosen = [0, 0, 0, 0];
    const create = async (attrs: readonly number[]) => {
      for (let row = 0; row < 4; row++) {
        // Recliquer la valeur déjà choisie la retire : on ne clique que ce qui change.
        if (chosen[row] !== attrs[row]) await click(attribute(row, attrs[row]!), 20);
        chosen[row] = attrs[row]!;
      }
      await click(ADD, 20);
    };
    return { host, engine, services, entered, queue, features, zoombinis, snoids, click, drag, create };
  }

  /** 16 types distincts. */
  const TYPES = Array.from({ length: 16 }, (_, i) => [1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (i % 3), 1]);

  it("affiche le fond et le décor : trois vagues, les deux décors animés, l'arche, les rochers et la couche des boutons", async () => {
    const { host, features } = await start();
    const frame = host.frames[host.frames.length - 1]!;
    expect(frame.pixels.some((p) => p !== 0)).toBe(true);
    const scripts = features.features.map((f) => f.scriptId);
    expect(scripts).toEqual(expect.arrayContaining([4101, 4102, 4103, 4104, 4105, 4100, 4110, 4106, 4107, 4108, 4109, 0]));
    expect(features.features.find((f) => f.scriptId === 4101)!.delay).toBe(10);
    expect(features.features.find((f) => f.scriptId === 4103)!.delay).toBe(12);
  });

  it("compose un groupe de 16 Zoombinis par clics : fiches, compteur, noms, personnages sur leurs places", async () => {
    const { zoombinis, snoids, create, engine, host } = await start();
    for (const attrs of TYPES) await create(attrs);
    const { game } = zoombinis;
    expect(game.group.members).toHaveLength(16);
    expect(game.counters.created).toBe(16);
    expect(game.group.members.map((z) => z.attrs)).toEqual(TYPES);
    for (const z of game.group.members) expect(nameOf(z.state)).toMatch(/^[a-z]{4,9}$/);
    expect(snoids()).toHaveLength(16);
    // Ils sortent de la grotte (148, 215) puis marchent jusqu'à leurs places : tous arrêtés, pieds sur leurs places à quelques pixels près.
    await runFor(engine, host, 20000);
    expect(snoids().every((f) => !f.active)).toBe(true);
    const rects = snoids().map((f) => f.rect!);
    for (const [x, y] of SLOTS) {
      expect(rects.some((r) => x >= r.left - 8 && x <= r.right + 8 && y >= r.top && y <= r.bottom + 8)).toBe(true);
    }
  });

  it("au plus deux exemplaires d'un même type", async () => {
    const { zoombinis, create } = await start();
    await create([2, 3, 4, 5]);
    await create([2, 3, 4, 5]);
    await create([2, 3, 4, 5]);
    const { game } = zoombinis;
    expect(game.group.members).toHaveLength(2);
    expect(game.typeCounts[typeIndex([2, 3, 4, 5])]).toBe(2);
    expect(game.counters.created).toBe(2);
  });

  it("ne crée rien tant qu'un attribut n'est pas choisi ; recliquer une valeur la retire", async () => {
    const { zoombinis, click } = await start();
    await click(attribute(0, 1));
    await click(attribute(1, 1));
    await click(attribute(2, 1));
    await click(ADD);
    expect(zoombinis.game.group.members).toHaveLength(0);
    await click(attribute(3, 2));
    await click(attribute(3, 2));
    await click(ADD);
    expect(zoombinis.game.group.members).toHaveLength(0);
    await click(attribute(3, 4));
    await click(ADD);
    expect(zoombinis.game.group.members.map((z) => z.attrs)).toEqual([[1, 1, 1, 4]]);
  });

  it("joue les sons des boutons : sélection, retrait de la sélection, ajout", async () => {
    const { queue, click } = await start();
    queue.mockClear();
    await click(attribute(0, 3));
    expect(queue).toHaveBeenCalledWith(1000);
    await click(attribute(0, 3));
    expect(queue).toHaveBeenCalledWith(1008);
    for (let row = 0; row < 4; row++) await click(attribute(row, 1));
    await click(ADD);
    expect(queue).toHaveBeenCalledWith(1005);
  });

  it("au hasard : tire un type complet que « ajouter » crée ; le nom de la plaque est renouvelé par la plaque", async () => {
    const { zoombinis, click, queue } = await start();
    await click(RANDOM);
    expect(queue).toHaveBeenCalledWith(1006);
    await click(ADD);
    expect(zoombinis.game.group.members).toHaveLength(1);
    expect(zoombinis.game.group.members[0]!.attrs.every((a) => a >= 1 && a <= 5)).toBe(true);
    // La plaque (action 3) tire un nouveau nom sans toucher à la sélection.
    const before = zoombinis.game.counters.created;
    await click(NAME);
    expect(zoombinis.game.counters.created).toBe(before);
    expect(zoombinis.game.group.members).toHaveLength(1);
  });

  it("mode de test : Maj + « ajouter » sur un groupe vide ne laisse qu'un Zoombini à créer (S+0x48 = S+0x4E = 624, 1128:083c)", async () => {
    for (const testMode of [false, true]) {
      const { zoombinis, host, engine, click } = await start((game) => {
        game.options.testMode = testMode;
      });
      for (let row = 0; row < 4; row++) await click(attribute(row, 2), 20);
      host.input.moveMouse(...ADD);
      host.input.mouseDown("left", { shift: true });
      host.input.mouseUp("left", { shift: true });
      await runFor(engine, host, 60);
      const { counters, group } = zoombinis.game;
      expect(group.members).toHaveLength(1);
      expect(counters.created).toBe(testMode ? 625 : 1);
      expect(counters.town).toBe(testMode ? 624 : 0);
      // Groupe non vide : rien de plus.
      host.input.mouseDown("left", { shift: true });
      host.input.mouseUp("left", { shift: true });
      await runFor(engine, host, 60);
      expect(zoombinis.game.counters.town).toBe(testMode ? 624 : 0);
    }
  });

  it("au hasard avec Maj tenue : remplit tout le groupe, avec des Zoombinis tous différents d'au plus deux exemplaires", async () => {
    const { zoombinis, host, engine, snoids } = await start();
    host.input.moveMouse(...RANDOM);
    host.input.mouseDown("left", { shift: true });
    host.input.mouseUp("left", { shift: true });
    host.input.keyUp("ShiftLeft", { shift: false, ctrl: false, alt: false });
    await runFor(engine, host, 100);
    const { game } = zoombinis;
    expect(game.group.members).toHaveLength(16);
    expect(game.counters.created).toBe(16);
    expect(Math.max(...game.typeCounts)).toBeLessThanOrEqual(2);
    // Les sorties de la grotte sont étalées dans le temps (1 à 2 secondes d'écart).
    expect(snoids().length).toBeLessThan(16);
    await runFor(engine, host, 60000);
    expect(snoids()).toHaveLength(16);
  });

  it("retire un Zoombini glissé sur l'entrée de la grotte (zone 4110, 1168:1742) : ses valeurs et son nom reviennent dans les boutons, son exemplaire est libéré", async () => {
    const { zoombinis, snoids, create, click, drag, engine, host, queue } = await start();
    await create([1, 2, 3, 4]);
    await create([5, 4, 3, 2]);
    await runFor(engine, host, 20000);
    const target = zoombinis.game.group.members[0]!;
    const name = nameOf(target.state);
    const rect = snoids()[0]!.rect!;
    queue.mockClear();
    await drag([Math.round((rect.left + rect.right) / 2), Math.round((rect.top + rect.bottom) / 2)], CAVE);
    const { game } = zoombinis;
    expect(game.group.members.map((z) => z.attrs)).toEqual([[5, 4, 3, 2]]);
    expect(game.counters.created).toBe(1);
    expect(game.typeCounts[typeIndex([1, 2, 3, 4])]).toBe(0);
    expect(queue).toHaveBeenCalledWith(1007);
    expect(snoids()).toHaveLength(1);
    // « Ajouter » recrée le même Zoombini, avec le même nom.
    await click(ADD);
    expect(game.group.members[1]!.attrs).toEqual([1, 2, 3, 4]);
    expect(nameOf(game.group.members[1]!.state)).toBe(name);
  });

  it("un clic sur un Zoombini ne le retire plus ; glissé ailleurs il revient à sa place ; l'entrée de la grotte (4110, bit 0x1000000) n'est dessinée que survolée", async () => {
    const { zoombinis, snoids, create, click, engine, host, features } = await start();
    await create([1, 2, 3, 4]);
    await runFor(engine, host, 20000);
    const zone = features.features.find((f) => f.scriptId === 4110)!;
    expect(zone.active).toBe(false);
    const snoid = snoids()[0]!;
    const rect = snoid.rect!;
    const at: [number, number] = [Math.round((rect.left + rect.right) / 2), Math.round((rect.top + rect.bottom) / 2)];
    await click(at);
    expect(zoombinis.game.group.members).toHaveLength(1);
    // Porté au-dessus de l'entrée : la zone joue (dessinée) ; ramené ailleurs puis lâché : il revient, la zone s'arrête.
    host.input.moveMouse(at[0], at[1]);
    host.input.mouseDown("left");
    await runFor(engine, host, 60);
    host.input.moveMouse(CAVE[0], CAVE[1]);
    await runFor(engine, host, 120);
    expect(zone.active).toBe(true);
    host.input.moveMouse(500, 400);
    await runFor(engine, host, 120);
    expect(zone.active).toBe(false);
    host.input.mouseUp("left");
    await runFor(engine, host, 60);
    expect(zoombinis.game.group.members).toHaveLength(1);
    expect(snoid.rect).toEqual(rect);
  });

  it("au doigt (extension tactile, bug 18) : glisser le Zoombini sur l'image de l'entrée, ou le toucher puis toucher l'entrée, le retire ; toucher puis toucher ailleurs le ramène", async () => {
    for (const mode of ["glisser", "toucher-toucher", "toucher-ailleurs"] as const) {
      const { zoombinis, snoids, create, drag, engine, host } = await start();
      (host as unknown as { pointerIsTouch: boolean }).pointerIsTouch = true;
      await create([1, 2, 3, 4]);
      await runFor(engine, host, 20000);
      const snoid = snoids()[0]!;
      const rect = snoid.rect!;
      const at: [number, number] = [Math.round((rect.left + rect.right) / 2), Math.round((rect.top + rect.bottom) / 2)];
      // Un point du bas de l'image de l'entrée (4110) ; toute l'image tient dans la tolérance de 60 points autour de (172, 226).
      const finger: [number, number] = [160, 255];
      if (mode === "glisser") await drag(at, finger);
      else {
        host.click(at[0], at[1]);
        await runFor(engine, host, 60);
        expect(zoombinis.game.group.members, mode).toHaveLength(1);
        const to = mode === "toucher-toucher" ? finger : ([500, 400] as const);
        host.click(to[0], to[1]);
        await runFor(engine, host, 200);
      }
      expect(zoombinis.game.group.members, mode).toHaveLength(mode === "toucher-ailleurs" ? 1 : 0);
      if (mode === "toucher-ailleurs") {
        await runFor(engine, host, 500);
        expect(snoid.rect).toEqual(rect);
      }
    }
  });

  it("garde les Zoombinis dans leur rangée après un retrait : le suivant prend la place libre", async () => {
    const { zoombinis, snoids, create, drag, engine, host } = await start();
    for (const attrs of TYPES.slice(0, 3)) await create(attrs);
    await runFor(engine, host, 20000);
    const first = snoids()[0]!;
    const rect = first.rect!;
    await drag([Math.round((rect.left + rect.right) / 2), Math.round((rect.top + rect.bottom) / 2)], CAVE);
    expect(zoombinis.game.group.members).toHaveLength(2);
    // Les deux restants rejoignent les places 0 et 1 : le premier marche d'une place vers la droite.
    await runFor(engine, host, 5000);
    const bottoms = snoids().map((f) => f.rect!.bottom);
    expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThanOrEqual(12);
    expect(snoids().every((f) => !f.active)).toBe(true);
  });

  it("refuse le départ d'un groupe incomplet : même écran, groupe gardé", async () => {
    const { engine, zoombinis, create, click, entered, host } = await start();
    await create([1, 1, 1, 1]);
    await click(GO);
    await runFor(engine, host, 3000);
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
    expect(zoombinis.lastChange).toBeNull();
    expect(entered).toEqual([]);
    expect(zoombinis.game.group.members).toHaveLength(1);
  });

  it("le départ d'un groupe complet : un Zoombini embarque, puis transition 1 vers l'écran 7, groupe recopié dans la partie", async () => {
    const { engine, zoombinis, create, click, entered, host, snoids } = await start();
    for (const attrs of TYPES) await create(attrs);
    await runFor(engine, host, 20000);
    await click(GO, 20);
    // Le Zoombini de la place 11 marche vers le bateau ; tant qu'il n'est pas arrivé, l'écran reste.
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
    expect(snoids().some((f) => f.active)).toBe(true);
    await runFor(engine, host, 60000);
    expect(engine.scenes.currentId).toBe(ScreenId.xfer);
    expect(entered).toEqual([ScreenId.xfer]);
    expect(zoombinis.lastChange).toEqual({ screen: ScreenId.xfer, target: ScreenId.bridge, transfer: 1 });
    const { game } = zoombinis;
    expect(game.group.members).toHaveLength(16);
    expect(game.group.members.map((z) => z.attrs)).toEqual(TYPES);
    expect(game.pickerGroup.members).toEqual([]);
    expect(game.resumeScreen).toBe(ScreenId.bridge);
  });

  it("un clic pendant la marche vers le bateau fait partir tout de suite", async () => {
    const { engine, zoombinis, create, click, host } = await start();
    for (const attrs of TYPES) await create(attrs);
    await runFor(engine, host, 20000);
    await click(GO, 20);
    await click([20, 20], 40);
    expect(zoombinis.lastChange?.target).toBe(ScreenId.bridge);
    expect(engine.scenes.currentId).toBe(ScreenId.xfer);
  });

  it("le bouton carte garde le groupe en cours dans la réserve de l'écran, qui revient à l'entrée suivante", async () => {
    const { engine, zoombinis, create, click, entered, host } = await start();
    for (const attrs of TYPES.slice(0, 3)) await create(attrs);
    await runFor(engine, host, 3000);
    await click(MAP, 100);
    expect(engine.scenes.currentId).toBe(ScreenId.map);
    expect(entered).toEqual([ScreenId.map]);
    const { game } = zoombinis;
    expect(game.pickerGroup.members.map((z) => z.attrs)).toEqual(TYPES.slice(0, 3));
    expect(game.group.members).toEqual([]);
    expect(game.counters.created).toBe(3);
    // Retour au choix : les trois Zoombinis sont là, sur leurs places, sans marcher.
    zoombinis.session.screen = ScreenId.map;
    engine.scenes.request(ScreenId.picker);
    await runFor(engine, host, 200);
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
    const features = engine.services.get(FEATURES);
    const people = features.features.filter((f) => f.hasFlag(FeatureFlag.snoid));
    expect(people).toHaveLength(3);
    expect(people.every((f) => !f.active)).toBe(true);
    expect(game.group.members).toHaveLength(3);
    expect(game.pickerGroup.members).toEqual([]);
  });

  it("une partie reprise avec un groupe en réserve : les Zoombinis sont posés sur les places 0 à n − 1", async () => {
    const { zoombinis, snoids } = await start((game) => {
      game.pickerGroup.members = TYPES.slice(0, 5).map((attrs) => ({ attrs: attrs as [number, number, number, number], id: 0, present: true, state: new Uint8Array(10) }));
      game.counters.created = 5;
    });
    expect(zoombinis.game.group.members).toHaveLength(5);
    expect(snoids()).toHaveLength(5);
    const lefts = snoids().map((f) => f.rect!.left);
    expect(new Set(lefts).size).toBe(5);
  });

  it("« moins d'action » : pas de décors animés ; Ctrl+W les crée et fait avancer leur état", async () => {
    const { engine, features, host, zoombinis } = await start((game) => {
      game.options.lessAction = true;
    });
    const mascots = () => features.features.filter((f) => f.scriptId === 4104 || f.scriptId === 4105);
    expect(mascots()).toHaveLength(0);
    expect(zoombinis.game.mascots).toBe(1);
    host.press("KeyW", { ctrl: true, key: "w" });
    await runFor(engine, host, 50);
    expect(mascots()).toHaveLength(2);
    expect(zoombinis.game.mascots).toBe(2);
    expect(mascots().map((f) => f.active)).toEqual([true, false]);
    host.press("KeyW", { ctrl: true, key: "w" });
    await runFor(engine, host, 50);
    expect(zoombinis.game.mascots).toBe(3);
    expect(mascots().map((f) => f.active)).toEqual([false, true]);
  });

  it("avec les décors animés, Ctrl+W cycle 0 → 1 (aucun) → 2 → 3 → 0", async () => {
    const { engine, features, host, zoombinis } = await start();
    const mascots = () => features.features.filter((f) => f.scriptId === 4104 || f.scriptId === 4105);
    const states: number[] = [];
    for (let i = 0; i < 4; i++) {
      host.press("KeyW", { ctrl: true, key: "w" });
      await runFor(engine, host, 50);
      states.push(zoombinis.game.mascots);
    }
    expect(states).toEqual([1, 2, 3, 0]);
    expect(mascots().map((f) => f.active)).toEqual([true, true]);
  });

  it("phrase d'accueil : seulement après le logo ; les phrases rares au retour de la carte", async () => {
    const afterLogo = await start(undefined, ScreenId.logo);
    expect(afterLogo.queue).toHaveBeenCalledWith(20042);
    expect(afterLogo.queue).toHaveBeenCalledWith(30001);
    expect(afterLogo.zoombinis.game.dialogMemory[0]).toBe(1);
    const fromMap = await start(undefined, ScreenId.map);
    expect(fromMap.queue).not.toHaveBeenCalledWith(20042);
    expect(fromMap.zoombinis.game.dialogMemory[0]).toBe(0);
  });

  it("le guide parle : une voix de ZOOMBINI.MHK selon les cheveux et le nez choisis", async () => {
    const { click, queue } = await start();
    await click(attribute(0, 3));
    await click(attribute(2, 2));
    queue.mockClear();
    await click(GUIDE);
    const ids = queue.mock.calls.map(([id]) => id);
    expect(ids).toHaveLength(1);
    // base 100 + 25 k (k de 0 à 12) + 20 (cheveux 3) + 1 (nez 2 − 1).
    expect((ids[0]! - 21) % 25).toBe(0);
    expect(ids[0]!).toBeGreaterThanOrEqual(121);
    expect(ids[0]!).toBeLessThanOrEqual(421);
  });

  it("changer d'écran ailleurs que par les boutons (partie remplacée) ne recopie pas le groupe dans la nouvelle partie", async () => {
    const { engine, zoombinis, create, host } = await start();
    await create([1, 1, 1, 1]);
    const other = zoombinis.game;
    zoombinis.game = structuredClone(other);
    zoombinis.game.group.members = [];
    zoombinis.game.counters.created = 0;
    engine.scenes.request(ScreenId.map);
    await runFor(engine, host, 100);
    expect(zoombinis.game.group.members).toEqual([]);
    expect(zoombinis.game.pickerGroup.members).toEqual([]);
  });

  describe("noms (1168:1f84)", () => {
    it("4 à 8 lettres minuscules, sans lettre doublée en tête, reproductibles à graine égale", () => {
      const rng = new MsvcRandom(3);
      const names = Array.from({ length: 300 }, () => generateName(rng));
      for (const name of names) {
        expect(name).toMatch(/^[a-z]{4,9}$/);
        expect(name[1]).not.toBe(name[0]);
      }
      const again = new MsvcRandom(3);
      expect(Array.from({ length: 300 }, () => generateName(again))).toEqual(names);
      expect(new Set(names).size).toBeGreaterThan(100);
    });
  });
});
