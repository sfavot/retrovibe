import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { decodeTbmpImages } from "../../../src/data/mohawk/tbmp";
import { parseScrs } from "../../../src/games/zoombinis/data/script";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import { ZOOMBINIS_TEXT } from "../../../src/games/zoombinis/engine/text";
import { FLEENS_BRANCH_POINTS, FLEENS_QUEUE, FLEENS_TERRACE_POINTS, cousinAttrs, runRobot } from "../../../src/games/zoombinis/game/puzzles/fleens";
import { nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type GameState, type Session, type Zoombini } from "../../../src/games/zoombinis/game/state";
import { WAITING_PLACES, createFleensScene, type FleensProbe, type FleensScene } from "../../../src/games/zoombinis/scenes/puzzles/fleens";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;
const LEVELS = [0, 1, 2, 3];
const setLevel = (level: number) => (game: GameState) => (game.levels = [level, level, level, level]);

/** Un groupe de `count` Zoombinis aux fiches toutes différentes. */
function party(count: number): Zoombini[] {
  return Array.from({ length: count }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + ((i * 2) % 5), 1 + ((i * 3) % 5)], i + 1));
}

describe.skipIf(!original.has)("nizibooms : écran sur les vrais fichiers (FLEENS.MHK)", () => {
  async function start(setup?: (game: GameState, session: Session) => void, size = 16) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 3 });
    const services = await installServices(engine);
    const entered: number[] = [];
    const scene: FleensScene = createFleensScene();
    for (const id of Object.values(S)) {
      if (id === S.fleens) engine.register(id, () => scene);
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
    zoombinis.session.screen = S.fleens;
    engine.start(S.fleens);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const probe = (): FleensProbe => scene.probe!;
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
    const mark = () => ({ x: 438, y: 357 });
    /** Dépose le membre sur le repère, attend la fin de son essai (et de la clôture éventuelle). */
    const tryOnce = async (index: number) => {
      await until(() => probe().dropTarget.owner === null && !probe().introPlaying, 900);
      await drag(index, mark());
    };
    const settle = async () => {
      await until(() => probe().trial === null && probe().pending === 0, 1500);
    };
    const specials = () => state().specials;
    const others = () => state().cousins.filter((c) => !c.special).map((c) => c.member);
    return { host, engine, services, zoombinis, entered, scene, sound, queued, probe, state, wait, until, grab, drag, tryOnce, settle, specials, others, mark, features: engine.services.get(FEATURES), dialog: engine.services.get(DIALOG) };
  }

  it("entre : décor, 16 nizibooms (3 sur la branche), groupe en bas à gauche, règle tirée, personne de sauvé, repère de dépôt, pas de musique", async () => {
    const { probe, zoombinis, queued, features, state } = await start();
    const { kit } = probe();
    expect(zoombinis.session.screen).toBe(S.fleens);
    expect(kit.members).toHaveLength(16);
    expect(WAITING_PLACES).toHaveLength(16);
    expect(state().cousins).toHaveLength(16);
    expect(probe().nizibooms).toHaveLength(16);
    expect(kit.members.every((m) => !m.zoombini.present)).toBe(true);
    expect(kit.goEnabled).toBe(false);
    // Le membre 0 joue son introduction et finit sur (236, 395) ; les autres sont sur leurs places.
    expect(probe().introPlaying).toBe(true);
    kit.members.slice(1).forEach((m, i) => expect(m.snoid.position).toEqual(WAITING_PLACES[i + 1]));
    // Trois cousins sur la branche, aux points de `REGS 5000`, les autres sur la terrasse.
    const branch = state().cousins.filter((c) => c.special);
    expect(branch.map((c) => c.origin)).toEqual(FLEENS_BRANCH_POINTS);
    expect(state().cousins.filter((c) => !c.special).map((c) => c.origin)).toEqual(FLEENS_TERRACE_POINTS.slice(0, 13));
    // Chaque nizibooms est dessiné (5 parties de la planche 4000) à l'endroit de son point.
    for (const niz of probe().nizibooms) {
      expect(niz.feature.parts.length).toBe(5);
      expect(niz.feature.parts.every((p) => p.sheet !== undefined && p.w >= 1 && p.w <= 740)).toBe(true);
    }
    // Attributs dessinés = attributs transformés par la règle de la partie.
    expect(state().cousins[0]!.attrs).toEqual(cousinAttrs(kit.members[0]!.zoombini.attrs, state().rule));
    // Aucune musique, pas de jingle ; la voix d'aide est 20080 à la première visite du niveau 0 (choix 1 : 20079).
    expect(queued.filter((id) => id >= 30000)).toEqual([]);
    expect(kit.introVoice).toBe(20079);
    expect(features.features.length).toBeGreaterThanOrEqual(16 + 16 + 3);
    // Une visite de plus de l'écran (mémoire de dialogue 8).
    expect(zoombinis.game.dialogMemory[8]! & 0xfff).toBe(1);
    // L'introduction se termine : la saisie s'ouvre.
  });

  it.each(LEVELS)("niveau %i : règle et permutation de ce niveau, enregistrées dans la partie ; le robot la résout", async (level) => {
    const { probe, zoombinis, state } = await start(setLevel(level));
    expect(state().level).toBe(level);
    const rule = zoombinis.game.fleensRule;
    expect(rule).toHaveLength(8);
    expect(rule.slice(0, 4).every((v) => v >= 1 && v <= 5)).toBe(true);
    if (level < 2) expect(rule.slice(4)).toEqual([0, 0, 0, 0]);
    else {
      expect(rule[4]).toBeGreaterThanOrEqual(2);
      expect([...rule.slice(5)].sort()).toEqual([1, 2, 3, 4].filter((p) => p !== rule[4]));
    }
    expect([...state().rule]).toEqual(rule);
    // Voix d'aide : 20079 aux niveaux 0 et 2 (la première visite du niveau 1 donne 20080), 20079 ou 20080 aux niveaux 1 et 3.
    expect([20079, 20080]).toContain(probe().kit.introVoice);
    const copy = { ...state(), found: [], trials: [], queue: [], cocoons: state().single ? 2 : 0, cousins: state().cousins.map((c) => ({ ...c })), specials: [...state().specials], vanished: [], closed: false };
    expect(runRobot(copy, party(16))).not.toBeNull();
  });

  it("la règle de la partie est conservée d'une entrée à l'autre aux niveaux 0 et 2, retirée aux niveaux 1 et 3", async () => {
    const saved = [4, 2, 5, 3, 3, 4, 1, 2];
    for (const level of LEVELS) {
      const { zoombinis, state } = await start((game) => {
        game.levels = [level, level, level, level];
        game.fleensRule = [...saved];
      });
      if (level === 0) expect(zoombinis.game.fleensRule).toEqual([4, 2, 5, 3, 0, 0, 0, 0]);
      else if (level === 2) expect(zoombinis.game.fleensRule).toEqual(saved);
      else expect(zoombinis.game.fleensRule).not.toEqual(saved);
      expect([...state().rule]).toEqual(zoombinis.game.fleensRule);
    }
  });

  it("introduction terminée, la saisie s'ouvre ; elle est fermée avant", async () => {
    const { probe, until, host, wait, grab, drag, mark } = await start();
    expect(probe().introPlaying).toBe(true);
    const index = 5;
    const point = grab(index)!;
    host.input.moveMouse(point.x, point.y);
    host.input.mouseDown("left");
    await wait(4);
    expect(probe().kit.carrying).toBeNull();
    host.input.mouseUp("left");
    await until(() => !probe().introPlaying, 600);
    await drag(index, mark());
    expect(probe().trial?.index).toBe(index);
  }, 60_000);

  it("survol du repère libre (1168:1742) : le repère (bit 0x1000000) joue et se dessine ; hors de lui et au lâcher, il s'arrête", async () => {
    const { probe, grab, wait, until, host, specials, mark } = await start();
    await until(() => probe().dropTarget.owner === null && !probe().introPlaying, 900);
    const zone = probe().dropTarget.highlight!;
    expect(zone.active).toBe(false);
    const index = specials()[0]!;
    const point = grab(index)!;
    const member = probe().kit.members[index]!;
    const at = { x: point.x - member.snoid.position.x, y: point.y - member.snoid.position.y };
    host.input.moveMouse(point.x, point.y);
    host.input.mouseDown("left");
    await wait(4);
    host.input.moveMouse(mark().x + at.x, mark().y + at.y);
    await wait(8);
    expect(zone.active).toBe(true);
    host.input.moveMouse(320, 40);
    await wait(8);
    expect(zone.active).toBe(false);
    host.input.mouseUp("left");
    await wait(10);
    expect(zone.active).toBe(false);
  });

  it("un essai juste remplit un cocon : parcours 7000 + pieds, cocon (SCRB 1001), cousin perché descendu dans la file des cousins, repère libéré à l'événement 7", async () => {
    const { probe, tryOnce, until, specials, state, features, settle, mark } = await start();
    const index = specials()[0]!;
    const member = probe().kit.members[index]!;
    const niz = probe().nizibooms.find((n) => n.cousin.member === index)!;
    expect(niz.cousin.special).toBe(true);
    await tryOnce(index);
    // Dépôt : posé sur le repère, essai compté tout de suite, parcours 7000 + pieds, sauvé (`+0x127 = 1` par le Tick).
    expect(member.snoid.position).toEqual(mark());
    expect(state().cocoons).toBe(1);
    expect(state().found).toEqual([index]);
    expect(probe().trial).toBe(member);
    expect(member.snoid.scriptId).toBe(7000 + member.snoid.traits.feet - 1);
    expect(probe().dropTarget.owner).toBe(member);
    // Événement 5 (`10e0:23a0`, type 6) : le cousin perché descend de la branche (`SCRS` 4000 + position, 4017 à 4019) jusqu'au repère.
    await until(() => niz.feature.scriptId === 4000 + niz.cousin.position);
    // Événement 6 : le cocon se remplit, les autres perchés réagissent sur place (type 7 : 4020 + 2 k) ; événement 7 : le repère se libère.
    await until(() => probe().branch.scriptId === 1001);
    const others = probe().nizibooms.filter((n) => n.cousin.special && n !== niz);
    expect(others.length).toBeGreaterThan(0);
    for (const other of others) expect(other.feature.scriptId).toBe(4020 + 2 * (other.cousin.position - 17));
    await until(() => probe().dropTarget.owner === null);
    expect(probe().trial).toBe(member);
    // Type 9 (`10e0:24fc`) : le cousin court jusqu'à la file des cousins, sous la file des Zoombinis, et y reste (`+0x120 = 20`).
    const feet = niz.cousin.attrs[3];
    await until(() => niz.feature.scriptId === 4025 + feet);
    await until(() => !(niz as unknown as { busy: boolean }).busy, 1500);
    expect(niz.gone).toBe(false);
    expect(features.features).toContain(niz.feature);
    expect((niz as unknown as { position: { x: number; y: number } }).position).toEqual({ x: 214, y: 207 });
    // Fin du parcours : en tête de la file (199, 120).
    await settle();
    expect(member.snoid.position).toEqual({ x: 199, y: 120 });
    expect(probe().line).toEqual([member]);
    expect(member.snoid.resting).toBe(true);
    expect(state().closed).toBe(false);
  }, 60_000);

  it("un essai faux ne change aucun compteur : le cousin de la terrasse se tourne (4003), court au repère (4004 + position), rejoint la file des cousins (214, 207) ; le Zoombini finit dans la file, il ne se reprend pas", async () => {
    const { probe, tryOnce, until, others, state, settle, drag, mark, wait } = await start();
    const index = others()[0]!;
    const member = probe().kit.members[index]!;
    const niz = probe().nizibooms.find((n) => n.cousin.member === index)!;
    await tryOnce(index);
    expect(state().cocoons).toBe(0);
    expect(state().trials).toEqual([{ member: index, special: false }]);
    expect(probe().branch.scriptId).toBe(1000);
    await until(() => niz.feature.scriptId === 4003);
    await until(() => niz.feature.scriptId === 4004 + niz.cousin.position);
    await until(() => niz.feature.scriptId === 4025 + niz.cousin.attrs[3]);
    await settle();
    expect(state().cocoons).toBe(0);
    expect(niz.gone).toBe(false);
    expect(member.snoid.position).toEqual({ x: 199, y: 120 });
    await until(() => !(niz as unknown as { busy: boolean }).busy, 1500);
    expect((niz as unknown as { position: { x: number; y: number } }).position).toEqual({ x: 214, y: 207 });
    // Pas repris : le glissé ne le prend pas.
    const point = { x: 199 - 5, y: 100 };
    await wait(2);
    expect(probe().kit.memberAt(point.x, point.y)).not.toBeNull();
    await drag(index, mark());
    expect(probe().kit.carrying).toBeNull();
    expect(state().trials).toHaveLength(1);
  }, 60_000);

  it("file de 7 : les essais précédents reculent de 20 pixels à l'événement 132, le plus ancien sort à gauche au 7e essai", async () => {
    const { probe, tryOnce, settle, others, state, until } = await start(undefined, 16);
    const wrong = others();
    for (let n = 0; n < FLEENS_QUEUE - 1; n++) {
      await tryOnce(wrong[n]!);
      await settle();
    }
    // Six essais : la file est pleine à six, tête en (199, 120), puis 179, 159…
    expect(state().queue).toHaveLength(6);
    const xs = probe().line.map((m) => m.snoid.position.x);
    expect(xs).toEqual([99, 119, 139, 159, 179, 199]);
    const oldest = probe().line[0]!;
    await tryOnce(wrong[6]!);
    // Au 7e essai le plus ancien est éjecté (le 7e est dans la file au moment de l'événement 132).
    await until(() => state().queue.length === 6 && probe().line.length === 6);
    expect(state().queue).not.toContain(oldest.index);
    // Le plus ancien saute au sol (`5999 + pieds`) et son cousin sort à gauche (type 13 : `4045 + pieds`, événement 60), puis il sort à son tour.
    const oldestCousin = probe().nizibooms.find((n) => n.cousin.member === oldest.index)!;
    await until(() => oldest.snoid.scriptId === 5999 + oldest.snoid.traits.feet || oldest.snoid.destroyed);
    await until(() => oldestCousin.gone, 900);
    await until(() => oldest.snoid.destroyed, 600);
    await settle();
    expect(probe().line.map((m) => m.snoid.position.x)).toEqual([99, 119, 139, 159, 179, 199]);
    // Les cousins de la file restent, chacun reculé de 21 points par essai suivant (type 12) : 214, 193, 172…
    const lineCousins = probe().line.map((m) => probe().nizibooms.find((n) => n.cousin.member === m.index)!);
    expect(lineCousins.every((n) => !n.gone)).toBe(true);
    await until(() => lineCousins.every((n) => !(n as unknown as { busy: boolean }).busy), 1500);
    const xs2 = lineCousins.map((n) => (n as unknown as { position: { x: number } }).position.x);
    expect(xs2.at(-1)).toBe(214);
    expect(xs2.at(-2)).toBe(193);
    expect(state().trials).toHaveLength(7);
    expect(state().cocoons).toBe(0);
  }, 240_000);

  it("trois cocons : les nizibooms de la terrasse s'enfuient, clôture (SCRB 1004 à 1006), « Go » actif, voix de réussite, groupe sauvé", async () => {
    const { probe, tryOnce, settle, specials, state, until, queued, features } = await start();
    for (const index of specials()) {
      await tryOnce(index);
      if (index !== specials()[2]) await settle();
    }
    expect(state().cocoons).toBe(3);
    // Plus de saisie dès le troisième cocon ; « Go » reste grisé jusqu'à la fin de la clôture.
    expect(probe().kit.goEnabled).toBe(false);
    await until(() => probe().closureStarted, 900);
    expect(features.features.some((f) => f.scriptId >= 1004 && f.scriptId <= 1006)).toBe(true);
    await until(() => state().closed, 900);
    expect(probe().kit.goEnabled).toBe(true);
    expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(true);
    // Les nizibooms de la terrasse et de la branche sont partis.
    await until(() => probe().nizibooms.every((n) => n.gone), 600);
    // Tout le groupe est « sauvé ».
    expect(probe().kit.members.every((m) => m.zoombini.present)).toBe(true);
    await settle();
  }, 240_000);

  it("« Go » à trois cocons : 996, le groupe part à pied, écran suivant (l'hôtel), personne de perdu, épreuve réussie et sans perte", async () => {
    const { probe, tryOnce, settle, specials, until, host, queued, zoombinis, engine, state } = await start();
    for (const index of specials()) {
      await tryOnce(index);
      await settle();
    }
    await until(() => state().closed, 900);
    expect(queued).not.toContain(996);
    // « Go » est à (600, 441)-(639, 478).
    host.click(620, 460);
    await until(() => queued.includes(996), 60);
    expect(probe().leaving).toBe(true);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 3000);
    expect(engine.error).toBeNull();
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.fleens, "success") });
    const { game } = zoombinis;
    expect(game.group.members.filter((z) => z.present)).toHaveLength(16);
    // Les attributs des Zoombinis sortent inchangés.
    expect(game.group.members.map((z) => z.attrs)).toEqual(party(16).map((z) => z.attrs));
  }, 240_000);

  it("« Go » : les Zoombinis de la file descendent de la branche par les SCRS 7021 à 7030, le plus récent d'abord, au lieu de marcher droit à travers l'arbre", async () => {
    const { probe, tryOnce, settle, specials, until, host, wait, zoombinis, engine, state } = await start();
    for (const index of specials()) {
      await tryOnce(index);
      await settle();
    }
    await until(() => state().closed, 900);
    // La file des essais : du plus ancien au plus récent, le plus récent en tête de branche (199, 120).
    const line = [...probe().line];
    expect(line).toHaveLength(3);
    const feet = line.map((m) => m.snoid.traits.feet);
    expect(line.map((m) => m.snoid.position.x)).toEqual([159, 179, 199]);
    const seen = line.map(() => [] as number[]);
    const starts = line.map(() => -1);
    const trail = line.map(() => [] as { x: number; y: number }[]);
    host.click(620, 460);
    for (let tick = 0; tick < 1500 && zoombinis.lastChange?.screen !== S.xfer; tick += 1) {
      await wait(1);
      line.forEach((m, k) => {
        if (m.snoid.destroyed) return;
        const id = m.snoid.feature.scriptId;
        if (seen[k]!.at(-1) !== id) seen[k]!.push(id);
        if (starts[k] < 0 && id >= 7026 && id <= 7030) starts[k] = tick;
        // Les pieds (milieu du bas du rectangle de la feature) : `position` n'avance qu'à la fin d'un script.
        const r = m.snoid.feature.rect;
        if (r) trail[k]!.push({ x: (r.left + r.right) / 2, y: r.bottom });
      });
    }
    expect(engine.error).toBeNull();
    // L'écran suivant attend la fin de la dernière descente (`[9702] == 0`) : tous ont fini leur script quand il change.
    expect(line.every((m) => m.snoid.destroyed)).toBe(true);
    // Jamais de marche droite (scripts de marche 105 à 129) : le plus récent descend par 7025 + pieds, les autres avancent d'un cran (7020 + pieds) puis descendent à leur tour.
    for (const ids of seen) expect(ids.filter((id) => id >= 105 && id <= 129)).toEqual([]);
    expect(seen[2]).toContain(7025 + feet[2]!);
    expect(seen[1]).toContain(7020 + feet[1]!);
    expect(seen[1]).toContain(7025 + feet[1]!);
    expect(seen[0]).toContain(7020 + feet[0]!);
    expect(seen[0]).toContain(7025 + feet[0]!);
    // L'ordre de départ : le plus récent, puis celui d'avant, puis le plus ancien.
    expect(starts[2]).toBeGreaterThan(-1);
    expect(starts[1]).toBeGreaterThan(starts[2]!);
    expect(starts[0]).toBeGreaterThan(starts[1]!);
    // Le trajet du script : saut de la branche près de (230, 104), puis la descente le long de x ≈ 280 à 310 avant de repartir vers la sortie, et non une droite de (199, 120) à (660, 357).
    const head = trail[2]!;
    const straight = (p: { x: number; y: number }) => Math.abs(p.y - (120 + ((p.x - 199) * (357 - 120)) / (660 - 199)));
    expect(head.some((p) => p.x >= 275 && p.x <= 315 && p.y >= 190)).toBe(true);
    expect(Math.max(...head.map(straight))).toBeGreaterThan(40);
  }, 240_000);

  it("« Go » est grisé avant les trois cocons : le clic ne fait rien", async () => {
    const { probe, host, wait, engine } = await start();
    host.click(620, 460);
    await wait(10);
    expect(probe().leaving).toBe(false);
    expect(probe().kit.left).toBe(false);
    expect(engine.error).toBeNull();
  });

  it("un groupe de 2 Zoombinis : un cocon est déjà plein, un seul spécial à trouver par essai ; avec 1 : deux cocons pleins, il disparaît (perdu)", async () => {
    const two = await start(undefined, 2);
    expect(two.state().cocoons).toBe(1);
    expect(two.probe().branch.scriptId).toBe(1001);
    const one = await start(undefined, 1);
    expect(one.state().cocoons).toBe(2);
    expect(one.probe().branch.scriptId).toBe(1002);
    expect(one.state().single).toBe(true);
    await one.until(() => !one.probe().introPlaying, 600);
    await one.tryOnce(0);
    expect(one.state().cocoons).toBe(3);
    expect(one.probe().trial?.snoid.scriptId).toBe(7041 + one.probe().kit.members[0]!.snoid.traits.feet - 1);
    await one.until(() => one.state().closed, 1500);
    expect(one.state().vanished).toEqual([0]);
    expect(one.probe().kit.members[0]!.zoombini.present).toBe(false);
    expect(one.probe().kit.goEnabled).toBe(true);
    // Sortie par « Go » : l'écran suivant est l'hôtel, le disparu est perdu.
    one.host.click(620, 460);
    await one.until(() => one.zoombinis.lastChange?.screen === S.xfer, 3000);
    expect(one.zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.fleens, "success") });
    expect(one.zoombinis.game.group.members.filter((z) => z.present)).toHaveLength(0);
  }, 120_000);

  describe("touches du mode de test (`10e0:0def`)", () => {
    /** Presse une touche et renvoie les textes dessinés dans la foulée (ligne d'état du mode de test). */
    async function pressKey(t: Awaited<ReturnType<typeof start>>, key: string, code: string): Promise<string[]> {
      const text = t.engine.services.get(ZOOMBINIS_TEXT);
      const drawn: string[] = [];
      const draw = text.drawText.bind(text);
      const spy = vi.spyOn(text, "drawText").mockImplementation((surface, font, value, ...rest) => {
        drawn.push(value);
        return draw(surface, font, value, ...rest);
      });
      t.host.press(code, { key });
      await t.wait(2);
      spy.mockRestore();
      return drawn;
    }

    it("L et l écrivent « Level » et le niveau + 1 (sans changer le niveau)", async () => {
      const t = await start((game) => void (game.options.testMode = true));
      const level = t.probe().level;
      expect(await pressKey(t, "L", "KeyL")).toContain(`Level ${level + 1}`);
      expect(await pressKey(t, "l", "KeyL")).toContain(`Level ${level + 1}`);
      expect(t.probe().level).toBe(level);
      expect(t.engine.error).toBeNull();
    });

    it("sans mode de test, L ne fait rien ; les autres touches non plus", async () => {
      const t = await start();
      expect(await pressKey(t, "L", "KeyL")).toEqual([]);
      expect(await pressKey(t, "l", "KeyL")).toEqual([]);
      expect(await pressKey(t, "a", "KeyA")).toEqual([]);
    });

    it("en mode de test, une autre touche ne fait rien", async () => {
      const t = await start((game) => void (game.options.testMode = true));
      expect(await pressKey(t, "a", "KeyA")).toEqual([]);
      expect(await pressKey(t, "r", "KeyR")).toEqual([]);
    });
  });

  it("le bouton carte demande l'avertissement ; F1 rejoue la voix d'introduction", async () => {
    const { host, engine, wait, dialog, queued, probe, zoombinis } = await start();
    host.press("F1", { key: "F1" });
    await wait(6);
    expect(queued).toContain(probe().kit.introVoice);
    host.click(620, 420);
    await wait(6);
    expect(dialog.isOpen).toBe(true);
    host.press("Enter");
    await wait(10);
    expect(engine.error).toBeNull();
    // Abandon : retour à la carte, groupe perdu.
    expect(zoombinis.lastChange?.screen).toBe(nextScreen(S.fleens, "failure"));
  });

  it("une partie enregistrée pendant l'épreuve retrouve le groupe entier ; le crochet est retiré à la sortie", async () => {
    const { engine, zoombinis, scene, tryOnce, until, specials, probe } = await start();
    await until(() => !probe().introPlaying, 600);
    await tryOnce(specials()[0]!);
    const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(zoombinis.game.group.members).toHaveLength(16);
    expect(zoombinis.game.group.members.every((z) => z.present)).toBe(true);
    scene.leave(engine.ctx);
    expect(dialogs.beforeSave).toHaveLength(0);
  }, 60_000);

  it("les `SCRS` de l'archive ont les événements que l'écran attend (essai : 4, 5, 6, 7, 132 ; 7005 : 30 ; fuite : 0 ; Zoombini seul : 137) et la planche 4000 ses 740 images", () => {
    const archive = MohawkArchive.parse(original.read("FLEENS.MHK"));
    const events = (id: number) => parseScrs(archive.get("SCRS", id)).images.map((image) => image.event - 1);
    for (let feet = 0; feet < 5; feet++) {
      expect(events(7000 + feet)).toEqual(expect.arrayContaining([4, 5, 6, 7, 132]));
      expect(events(7005 + feet)).toEqual(expect.arrayContaining([4, 5, 6, 7, 132, 133, 134, 30]));
      expect(events(7041 + feet)).toContain(137);
      expect(parseScrs(archive.get("SCRS", 7000 + feet)).pose).toBe(0);
    }
    for (const id of [4056, 4057, 4058]) expect(events(id)).toContain(0);
    expect(parseScrs(archive.get("SCRS", 4000)).pose).toBe(3);
    expect(archive.ids("SCRB")).toEqual(expect.arrayContaining([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1100, 1200, 1206]));
    expect(decodeTbmpImages(archive.get("tBMP", 4000))).toHaveLength(740);
  });
});
