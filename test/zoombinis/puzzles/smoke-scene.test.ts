import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { parseScrb, parseScrs } from "../../../src/games/zoombinis/data/script";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import { isFinished, robotPlan, transform, type SmokeState } from "../../../src/games/zoombinis/game/puzzles/smoke";
import { nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type GameState, type Session, type Zoombini } from "../../../src/games/zoombinis/game/state";
import {
  SMOKE_PLACES,
  SMOKE_PLATFORM,
  SMOKE_QUEUE,
  SMOKE_WAGON,
  createSmokeScene,
  type SmokeProbe,
  type SmokeScene,
} from "../../../src/games/zoombinis/scenes/puzzles/smoke";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;
const LEVELS = [1, 2, 3, 4] as const;
type Point = { x: number; y: number };

/** Un groupe de `count` Zoombinis aux fiches variées (cinq valeurs par attribut). */
function party(count: number): Zoombini[] {
  return Array.from({ length: count }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + ((i * 2) % 5), 1 + ((i * 3) % 5)], i + 1));
}

describe.skipIf(!original.has)("cristal : écran sur les vrais fichiers (SMOKE.MHK)", () => {
  async function start(level: 1 | 2 | 3 | 4 = 1, size = 6, setup?: (game: GameState, session: Session) => void, seed = 3) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed });
    const services = await installServices(engine);
    const entered: number[] = [];
    const scene: SmokeScene = createSmokeScene();
    for (const id of Object.values(S)) {
      if (id === S.smoke) engine.register(id, () => scene);
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
    zoombinis.game.levels = [level - 1, level - 1, level - 1, level - 1];
    setup?.(zoombinis.game, zoombinis.session);
    zoombinis.session.screen = S.smoke;
    engine.start(S.smoke);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const probe = (): SmokeProbe => scene.probe!;
    const state = (): SmokeState => probe().state;
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
    const dragMember = async (index: number, feet: Point) => {
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
    /** Glisse un objet de puzzle d'un point à un autre (appui, déplacement, relâchement). */
    const dragPoint = async (from: Point, to: Point) => {
      host.input.moveMouse(from.x, from.y);
      host.input.mouseDown("left");
      await wait(4);
      host.input.moveMouse(to.x, to.y);
      await wait(8);
      host.input.mouseUp("left");
      await wait(6);
    };
    const pullLever = async () => {
      host.click(probe().leverPoint.x, probe().leverPoint.y);
      await wait(2);
    };
    /** Niveaux 1-2 : pose le Zoombini `member` sur le wagonnet et la silhouette `k` sur le cristal. */
    const prepareLow = async (member: number, k: number) => {
      await dragMember(member, SMOKE_WAGON);
      await dragPoint(probe().silhouetteAt(k)!, probe().crystalPoint);
    };
    /** Niveaux 3-4 : pose les cristaux de `plan` (de gauche à droite de chaque côté). */
    const prepareHigh = async (left: readonly number[], right: readonly number[]) => {
      for (const c of left) await dragPoint(probe().crystalAt(c)!, probe().casePoint("left", state().left.length));
      for (const c of right) await dragPoint(probe().crystalAt(c)!, probe().casePoint("right", state().right.length));
    };
    /** Un tour entier pour le Zoombini courant, d'après la règle de l'écran (le robot). Renvoie le test enregistré. */
    const solveTurn = async () => {
      const plan = robotPlan(state())!;
      expect(plan).not.toBeNull();
      if (probe().level <= 2) await prepareLow(plan.member!, plan.silhouette!);
      else await prepareHigh(plan.left!, plan.right!);
      const before = state().tested;
      await pullLever();
      await until(() => state().tested > before, 2000);
    };
    /** Un tour perdant : une disposition qui ne sauve pas le Zoombini courant. */
    const losingPlan = (): { member?: number; silhouette?: number; left?: number[]; right?: number[] } => {
      const s = state();
      if (probe().level <= 2) {
        for (const m of s.queue) {
          for (let k = 0; k < 8; k++) if (!transform({ ...s, silhouette: k }, m).saved) return { member: m, silhouette: k };
        }
        throw new Error("pas de couple perdant");
      }
      const member = s.rank;
      const candidates: { left: number[]; right: number[] }[] = [{ left: [], right: [] }];
      for (let c = 1; c <= 6; c++) candidates.push({ left: [c], right: [] }, { left: [], right: [c] });
      for (const candidate of candidates) if (!transform({ ...s, left: candidate.left, right: candidate.right }, member).saved) return candidate;
      throw new Error("pas de disposition perdante");
    };
    const playLosing = async () => {
      const plan = losingPlan();
      if (probe().level <= 2) await prepareLow(plan.member!, plan.silhouette!);
      else await prepareHigh(plan.left!, plan.right!);
      const before = state().tested;
      await pullLever();
      await until(() => state().tested > before, 2000);
    };
    /** Niveaux 3-4 : attend l'arrivée du premier Zoombini. */
    const arrived = () => until(() => probe().ready && !probe().locked, 800);
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
      dragMember,
      dragPoint,
      pullLever,
      prepareLow,
      prepareHigh,
      solveTurn,
      playLosing,
      losingPlan,
      arrived,
      features: engine.services.get(FEATURES),
      dialog: engine.services.get(DIALOG),
    };
  }

  it.each(LEVELS)("niveau %i : entrée, décor, objets de puzzle, musique 30030 + niveau, personne de sauvé, « go » grisé", async (level) => {
    const { probe, state, zoombinis, queued, features, arrived } = await start(level);
    const { kit } = probe();
    expect(zoombinis.session.screen).toBe(S.smoke);
    expect(probe().level).toBe(level);
    expect(state().level).toBe(level);
    expect(kit.members).toHaveLength(6);
    expect(kit.members.every((m) => !m.zoombini.present)).toBe(true);
    expect(kit.goEnabled).toBe(false);
    expect(probe().leaving).toBe(false);
    // Musique `30030 + niveau interne` (0 à 3), pas de jingle d'entrée ; voix d'introduction tirée (20066 ou 20067) pour F1.
    expect(queued).toContain(30030 + level - 1);
    expect(queued).not.toContain(997);
    expect([20066, 20067]).toContain(kit.introVoice);
    // Une visite de plus de l'écran (mémoire de dialogue 13, 12 bits).
    expect(zoombinis.game.dialogMemory[13]! & 0xfff).toBe(1);
    // Le décor (machine, wagonnets, intro du cristal géant) et les objets de puzzle sont créés.
    expect(features.features.length).toBeGreaterThan(level <= 2 ? 25 : 20);
    if (level <= 2) {
      kit.members.forEach((m, i) => expect(m.snoid.position).toEqual(SMOKE_PLACES[i]));
      expect(state().silhouettes).toHaveLength(8);
      expect(state().filters).toHaveLength(level === 2 ? 4 : 0);
      expect(probe().silhouetteAt(0)).not.toBeNull();
      expect(probe().ready).toBe(false);
      expect(probe().locked).toBe(false);
      // L'intro du cristal géant joue (`SCRB` 11015) puis laisse la place au cristal suspendu (11017).
      expect(features.features.some((f) => f.scriptId === 11015)).toBe(true);
    } else {
      // Les Zoombinis ne sont pas affichés : ils arrivent en wagonnet, le premier sur la plate-forme, le suivant dans la file.
      expect(state().crystals).toHaveLength(6);
      expect(probe().locked).toBe(true);
      expect(kit.members[0]!.snoid.position.x).toBeLessThan(0);
      await arrived();
      expect(kit.members[0]!.snoid.position).toEqual(SMOKE_PLATFORM);
      expect(kit.members[1]!.snoid.position).toEqual(SMOKE_QUEUE);
      expect(state().current).toBe(0);
      expect(probe().crystalAt(1)).not.toBeNull();
      expect(probe().secondTarget).toEqual(level === 4 ? { x: 616, y: 253 } : null);
    }
  });

  it.each([1, 2] as const)("niveau %i : un Zoombini sur le wagonnet, une silhouette sur le cristal, levier : test réussi, sauvé, garé, « go » actif", async (level) => {
    const { probe, state, prepareLow, pullLever, until, queued, features, wait } = await start(level);
    const plan = robotPlan(state())!;
    await prepareLow(plan.member!, plan.silhouette!);
    // Pose acceptée : le Zoombini est sur le wagonnet (pieds en (42, 262)) ; la silhouette est sur le cristal de droite (la place de l'étagère est vide).
    const member = probe().kit.members[plan.member!]!;
    expect(state().current).toBe(plan.member);
    expect(state().silhouette).toBe(plan.silhouette);
    expect(member.snoid.position).toEqual(SMOKE_WAGON);
    expect(probe().silhouetteAt(plan.silhouette!)).toBeNull();
    // Le levier est armé (il clignote, `SCRB` 11003).
    await wait(10);
    expect(probe().leverScript).toBe(11003);
    expect(probe().kit.goEnabled).toBe(false);
    await pullLever();
    expect(probe().locked).toBe(true);
    // Levier (11002, son 11003), puis balayage de la machine (11018 / 11019), fiches comparées.
    await until(() => features.features.some((f) => f.scriptId === 11002));
    await until(() => probe().fiches !== null);
    expect(probe().fiches!.left).toEqual(probe().fiches!.right);
    await until(() => features.features.some((f) => f.scriptId === 11019));
    // Résultat : la machine joue la réussite (11024), le Zoombini traverse (`SCRS` 11999 + pieds), puis monte dans le wagonnet de sortie (12020 + 0).
    await until(() => features.features.some((f) => f.scriptId === 11024));
    await until(() => member.snoid.scriptId === 11999 + member.snoid.traits.feet);
    await until(() => member.snoid.scriptId === 12020);
    expect(features.features.some((f) => f.scriptId === 11036)).toBe(true);
    // Fin de tour : sauvé (+0x127), « go » actif, wagonnet garé (`SCRB` 11071), plus de saisie avant le levier.
    await until(() => state().tested === 1, 800);
    expect(state().outcome[plan.member!]).toBe(true);
    expect(state().savedCount).toBe(1);
    expect(member.zoombini.present).toBe(true);
    expect(probe().kit.goEnabled).toBe(true);
    expect(probe().parked[0]!.scriptId).toBe(11071);
    expect(probe().locked).toBe(false);
    expect(state().awaitingRound).toBe(true);
    await wait(30);
    // Le levier clignote (« nouveau tirage », 11005) ; le Zoombini sauvé ne se reprend plus.
    expect(probe().leverScript).toBe(11005);
    expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(false);
    expect(probe().kit.members[plan.member!]!.target).toBeNull();
  }, 60_000);

  it.each([1, 2] as const)("niveau %i : test raté, le Zoombini est piégé (SCRS 12004 + pieds, fiches différentes), « go » reste grisé, le wagonnet roule à vide", async (level) => {
    const { probe, state, losingPlan, prepareLow, pullLever, until, features } = await start(level);
    const plan = losingPlan();
    await prepareLow(plan.member!, plan.silhouette!);
    const member = probe().kit.members[plan.member!]!;
    await pullLever();
    await until(() => probe().fiches !== null);
    expect(probe().fiches!.left).not.toEqual(probe().fiches!.right);
    await until(() => features.features.some((f) => f.scriptId === 11026));
    await until(() => member.snoid.scriptId === 12004 + member.snoid.traits.feet);
    // Le wagonnet de sortie roule à vide : le Zoombini ne monte pas (pas de SCRS 12020).
    await until(() => features.features.some((f) => f.scriptId === 11036));
    await until(() => state().tested === 1, 800);
    expect(member.snoid.scriptId).not.toBe(12020);
    expect(state().outcome[plan.member!]).toBe(false);
    expect(state().savedCount).toBe(0);
    expect(member.zoombini.present).toBe(false);
    expect(probe().kit.goEnabled).toBe(false);
    // Le wagonnet est garé (vide) à sa place.
    expect(probe().parked[0]!.scriptId).toBe(11071);
    // Piégé : il ne peut plus être pris.
    expect(state().outcome[plan.member!]).toBe(false);
  }, 60_000);

  it("niveau 3 : cristaux posés sur la voie (cases d'insertion), test réussi, le suivant monte sur la plate-forme, nouveau tirage au levier", async () => {
    const { probe, state, arrived, prepareHigh, pullLever, until, features, wait } = await start(3, 4);
    await arrived();
    const plan = robotPlan(state())!;
    await prepareHigh(plan.left!, plan.right!);
    expect(state().left).toEqual(plan.left);
    expect(state().right).toEqual(plan.right);
    // Les cristaux posés sont à leur place sur la voie (positions `DS:1f40` / `DS:1f64`).
    for (const c of plan.left!) expect(probe().crystalAt(c)!.y).toBeGreaterThan(200);
    await wait(10);
    expect(probe().leverScript).toBe(11003);
    await pullLever();
    expect(probe().locked).toBe(true);
    const first = probe().kit.members[0]!;
    await until(() => features.features.some((f) => f.scriptId === 11028));
    await until(() => first.snoid.scriptId === 12009 + first.snoid.traits.feet);
    await until(() => state().tested === 1, 800);
    expect(state().outcome[0]).toBe(true);
    expect(probe().kit.goEnabled).toBe(true);
    expect(state().rank).toBe(1);
    // Le suivant monte de la file vers la plate-forme (11035, `SCRS` 12040), un nouveau suivant arrive (11034).
    await until(() => features.features.some((f) => f.scriptId === 11035));
    await until(() => !probe().locked, 400);
    const second = probe().kit.members[1]!;
    expect(second.snoid.position).toEqual(SMOKE_PLATFORM);
    expect(probe().kit.members[2]!.snoid.position).toEqual(SMOKE_QUEUE);
    // Pas de pose entre deux tours ; le levier de nouveau tirage refait le puzzle (11004).
    expect(state().awaitingRound).toBe(true);
    expect(probe().leverScript).toBe(11005);
    await pullLever();
    expect(features.features.some((f) => f.scriptId === 11004)).toBe(true);
    await until(() => !probe().locked, 400);
    expect(state().awaitingRound).toBe(false);
    expect(state().current).toBe(1);
    expect(state().left).toEqual([]);
  }, 90_000);

  it("niveau 3 : test raté, piégé (SCRS 12014 + pieds, séquence 11030), le suivant arrive quand même", async () => {
    const { probe, state, arrived, losingPlan, prepareHigh, pullLever, until, features } = await start(3, 3);
    await arrived();
    const first = probe().kit.members[0]!;
    const plan = losingPlan();
    await prepareHigh(plan.left!, plan.right!);
    await pullLever();
    await until(() => features.features.some((f) => f.scriptId === 11030));
    await until(() => first.snoid.scriptId === 12014 + first.snoid.traits.feet);
    await until(() => state().tested === 1, 800);
    expect(state().outcome[0]).toBe(false);
    expect(first.zoombini.present).toBe(false);
    expect(first.snoid.scriptId).not.toBe(12020);
    expect(probe().kit.goEnabled).toBe(false);
    expect(probe().parked[0]!.scriptId).toBe(11071);
    await until(() => !probe().locked, 400);
    expect(probe().kit.members[1]!.snoid.position).toEqual(SMOKE_PLATFORM);
  }, 60_000);

  it("niveau 4 : une disposition pour la paire ; le second est testé tout seul contre la cible n° 8 (socle 11011), puis la paire suivante arrive", async () => {
    const { probe, state, arrived, prepareHigh, pullLever, until, features, wait } = await start(4, 4);
    await arrived();
    const plan = robotPlan(state())!;
    await prepareHigh(plan.left!, plan.right!);
    const placed = { left: [...state().left], right: [...state().right] };
    await pullLever();
    await until(() => state().tested === 1, 1000);
    expect(state().outcome[0]).toBe(true);
    // Le second de la paire : cible n° 7 cachée, cible n° 8 posée sous le socle (11011), test sans geste du joueur, même disposition.
    await until(() => state().second);
    expect(state().awaitingRound).toBe(false);
    expect(probe().locked).toBe(true);
    await until(() => features.features.some((f) => f.scriptId === 11011), 400);
    await until(() => probe().secondTarget !== null && probe().secondTarget!.x === 548, 400);
    expect(probe().secondTarget).toEqual({ x: 548, y: 255 });
    await until(() => probe().fiches !== null && state().pending !== null, 400);
    expect(state().left).toEqual(placed.left);
    expect(state().right).toEqual(placed.right);
    await until(() => state().tested === 2, 1200);
    expect(state().outcome[1]).toBe(true);
    expect(probe().kit.members[1]!.zoombini.present).toBe(true);
    expect(state().second).toBe(false);
    expect(state().savedCount).toBe(2);
    // La paire suivante (membres 2 et 3) arrive ; le levier de nouveau tirage clignote.
    await until(() => probe().ready && !probe().locked, 800);
    expect(probe().kit.members[2]!.snoid.position).toEqual(SMOKE_PLATFORM);
    expect(probe().kit.members[3]!.snoid.position).toEqual(SMOKE_QUEUE);
    await wait(10);
    expect(probe().leverScript).toBe(11005);
    await pullLever();
    await until(() => features.features.some((f) => f.scriptId === 11012), 100);
    await until(() => !probe().locked, 400);
    expect(state().rank).toBe(2);
    expect(state().current).toBe(2);
    expect(state().awaitingRound).toBe(false);
  }, 120_000);

  it("« go » est sans effet tant que personne n'est sauvé ; après le premier sauvé il part : 996, wagonnets 11072, écran 18, les autres sont perdus", async () => {
    const { probe, state, host, wait, until, solveTurn, zoombinis, engine, queued, features } = await start(1, 4);
    const final = state();
    host.click(620, 460);
    await wait(10);
    expect(probe().leaving).toBe(false);
    expect(probe().kit.left).toBe(false);
    await solveTurn();
    await until(() => !probe().locked, 100);
    expect(probe().kit.goEnabled).toBe(true);
    expect(queued).not.toContain(996);
    host.click(620, 460);
    await wait(2);
    expect(probe().leaving).toBe(true);
    expect(probe().kit.left).toBe(true);
    expect(queued).toContain(996);
    // Le premier wagonnet garé part (`SCRB` 11072) et le Zoombini sauvé marche (`SCRS` 12041).
    await until(() => features.features.some((f) => f.scriptId === 11072));
    const saved = probe().kit.members.find((m) => m.zoombini.present)!;
    expect(saved.snoid.scriptId).toBe(12041);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 2000);
    expect(engine.error).toBeNull();
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.smoke, "success") });
    // Un sauvé, trois non testés perdus ; le passage est marqué (bit du niveau 0) mais pas « sans perte ».
    const { game } = zoombinis;
    expect(game.group.members.filter((z) => z.present)).toHaveLength(1);
    expect(game.successes[10]! & 1).toBe(1);
    expect(game.successes[10]! & 0x10).toBe(0);
    expect(final.savedCount).toBe(1);
    expect(final.tested).toBe(1);
  }, 90_000);

  it("« go » pendant un tour est sans effet ; un clic pendant le départ change tout de suite d'écran", async () => {
    const { probe, state, host, wait, until, solveTurn, pullLever, prepareLow, zoombinis } = await start(1, 4);
    await solveTurn();
    await until(() => !probe().locked, 100);
    // Un deuxième tour, tiré mais pas fini : « go » ne fait rien.
    await until(() => state().awaitingRound, 100);
    await wait(10);
    await pullLever();
    await until(() => !probe().locked, 400);
    const plan = robotPlan(state())!;
    await prepareLow(plan.member!, plan.silhouette!);
    await pullLever();
    expect(probe().locked).toBe(true);
    host.click(620, 460);
    await wait(2);
    expect(probe().leaving).toBe(false);
    await until(() => state().tested === 2, 1000);
    host.click(620, 460);
    await wait(2);
    expect(probe().leaving).toBe(true);
    host.click(300, 300);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 100);
    expect(zoombinis.game.group.members.filter((z) => z.present)).toHaveLength(2);
  }, 120_000);

  it("tout le groupe sauvé (niveau 1, 2 Zoombinis) : voix de réussite, partie gagnée, « go » quitte sans perdus (marque « sans perte »)", async () => {
    const { probe, state, solveTurn, until, pullLever, wait, queued, zoombinis, host } = await start(1, 2);
    await solveTurn();
    await until(() => !probe().locked, 100);
    expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(false);
    await wait(20);
    await pullLever();
    await until(() => !probe().locked, 400);
    await solveTurn();
    await until(() => state().tested === 2, 100);
    expect(probe().hasWon).toBe(true);
    expect(state().awaitingRound).toBe(false);
    expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(true);
    expect(queued.some((id) => id >= 20045 && id <= 20048)).toBe(false);
    // Plus de tirage : le levier reste au repos, rien ne se prend.
    await wait(40);
    expect(probe().leverScript).toBe(11002);
    host.click(620, 460);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 2000);
    expect(zoombinis.game.group.members.filter((z) => z.present)).toHaveLength(2);
    expect(zoombinis.game.successes[10]! & 0x10).toBe(0x10);
  }, 120_000);

  it("un perdu, un sauvé : voix de regret à la fin de la série (première visite : toujours)", async () => {
    const { probe, state, solveTurn, playLosing, until, pullLever, wait, queued } = await start(2, 2);
    await playLosing();
    await until(() => !probe().locked, 100);
    await wait(20);
    await pullLever();
    await until(() => !probe().locked, 400);
    await solveTurn();
    await until(() => state().tested === 2, 100);
    expect(probe().hasWon).toBe(false);
    expect(queued.some((id) => id >= 20045 && id <= 20048)).toBe(true);
    expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(false);
    expect(state().savedCount).toBe(1);
  }, 120_000);

  it("à partir du quatrième sauvé, le Zoombini danse sur place à son arrivée (SCRS 12044 + pieds)", async () => {
    const { probe, state, solveTurn, until, pullLever, wait } = await start(1, 5);
    for (let turn = 0; turn < 4; turn++) {
      await solveTurn();
      await until(() => !probe().locked, 100);
      if (turn < 3) {
        await wait(20);
        await pullLever();
        await until(() => !probe().locked, 400);
      }
    }
    expect(state().savedCount).toBe(4);
    const fourth = probe().kit.members[probe().saved[3]!]!;
    expect(fourth.snoid.scriptId).toBe(12044 + fourth.snoid.traits.feet);
    // Les trois premiers sont garés dans leur wagonnet (11071, 11070, 11069).
    expect(probe().parked.slice(0, 3).map((f) => f!.scriptId).filter((id) => id >= 11069)).toHaveLength(3);
  }, 180_000);

  it.each([
    [1, 3],
    [2, 3],
    [3, 3],
    [4, 3],
    [3, 1],
    [4, 1],
    [4, 4],
  ] as const)("niveau %i, %i Zoombini(s) : le robot joue la partie entière par l'écran, tout le groupe est sauvé, voix de réussite, « go » quitte", async (level, size) => {
    const { probe, state, until, solveTurn, pullLever, queued, zoombinis, host, engine } = await start(level, size);
    for (let guard = 0; guard < 2 * size + 2 && !isFinished(state()); guard++) {
      await until(() => !probe().locked && (probe().level <= 2 || probe().ready), 2000);
      // Niveau 4 : le second de la paire se joue tout seul ; la série peut finir pendant cette attente.
      if (isFinished(state())) break;
      if (state().awaitingRound) {
        await pullLever();
        await until(() => !probe().locked, 800);
      }
      await solveTurn();
    }
    await until(() => !probe().locked, 2000);
    expect(isFinished(state())).toBe(true);
    expect(state().savedCount).toBe(size);
    expect(state().outcome.every((o) => o === true)).toBe(true);
    expect(probe().hasWon).toBe(true);
    expect(probe().kit.members.every((m) => m.zoombini.present)).toBe(true);
    expect(probe().kit.goEnabled).toBe(true);
    expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(true);
    expect(probe().parked.filter(Boolean)).toHaveLength(size);
    host.click(620, 460);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 2500);
    expect(engine.error).toBeNull();
    expect(zoombinis.game.group.members.filter((z) => z.present)).toHaveLength(size);
    // Sans perte : la marque du niveau et la marque « sans perte » (0x10 << niveau interne).
    expect(zoombinis.game.successes[10]! & (1 << (level - 1))).toBe(1 << (level - 1));
    expect(zoombinis.game.successes[10]! & (0x10 << (level - 1))).toBe(0x10 << (level - 1));
  }, 240_000);

  it("un groupe de 16 : 16 places d'attente (niveaux 1-2) ; 16 wagonnets garés possibles (SCRB 11071 à 11056, trajets 12020 à 12035)", async () => {
    const { probe, state } = await start(1, 16);
    expect(probe().kit.members).toHaveLength(16);
    probe().kit.members.forEach((m, i) => expect(m.snoid.position).toEqual(SMOKE_PLACES[i]));
    expect(state().members).toHaveLength(16);
  });

  it("souris aimantée (partie neuve) : un glissé prend la silhouette, le clic suivant la dépose sur le cristal", async () => {
    const { probe, state, host, wait, until } = await start(1, 4, (game) => (game.options.magneticMouse = true));
    const from = probe().silhouetteAt(2)!;
    host.input.moveMouse(from.x, from.y);
    host.input.mouseDown("left");
    await wait(4);
    host.input.mouseUp("left");
    await wait(4);
    // Transport collé : l'objet suit le pointeur sans bouton.
    expect(probe().kit.carryingObject).toBe(true);
    host.input.moveMouse(probe().crystalPoint.x, probe().crystalPoint.y);
    await wait(6);
    expect(state().silhouette).toBeNull();
    host.click(probe().crystalPoint.x, probe().crystalPoint.y);
    await until(() => state().silhouette === 2, 50);
    expect(probe().kit.carryingObject).toBe(false);
    // Reprise de la silhouette posée, puis lâchée ailleurs : elle retourne à son étagère.
    await wait(4);
    host.click(probe().crystalPoint.x, probe().crystalPoint.y);
    await wait(4);
    expect(state().silhouette).toBeNull();
    host.click(300, 400);
    await wait(6);
    expect(probe().silhouetteAt(2)).not.toBeNull();
    expect(state().silhouette).toBeNull();
  }, 30_000);

  it("une seconde silhouette sur le cristal renvoie la première à sa place ; un Zoombini repris du wagonnet désarme le levier", async () => {
    const { probe, state, dragMember, dragPoint, wait, until } = await start(1, 4);
    await dragPoint(probe().silhouetteAt(0)!, probe().crystalPoint);
    expect(state().silhouette).toBe(0);
    await dragPoint(probe().silhouetteAt(3)!, probe().crystalPoint);
    expect(state().silhouette).toBe(3);
    expect(probe().silhouetteAt(0)).not.toBeNull();
    expect(probe().silhouetteAt(3)).toBeNull();
    // Un Zoombini sur le wagonnet : le levier est armé ; on le reprend et on le replace sur une place d'attente.
    await dragMember(1, SMOKE_WAGON);
    await wait(10);
    expect(probe().leverScript).toBe(11003);
    await dragMember(1, SMOKE_PLACES[1]!);
    await until(() => probe().leverScript === 11002, 50);
    expect(state().current).toBeNull();
    expect(probe().kit.members[1]!.snoid.position).toEqual(SMOKE_PLACES[1]);
    // Lâché loin de tout, il retourne à sa place.
    await dragMember(1, { x: 400, y: 420 });
    expect(probe().kit.members[1]!.snoid.position).toEqual(SMOKE_PLACES[1]);
  }, 60_000);

  it("niveaux 3-4 : un cristal posé se reprend, un côté plein (3) renvoie le cristal sur son étagère, hors des cases aussi", async () => {
    const { probe, state, arrived, dragPoint } = await start(3, 4);
    await arrived();
    await dragPoint(probe().crystalAt(1)!, probe().casePoint("left", 0));
    await dragPoint(probe().crystalAt(2)!, probe().casePoint("left", 1));
    await dragPoint(probe().crystalAt(3)!, probe().casePoint("left", 2));
    expect(state().left).toEqual([1, 2, 3]);
    // Côté plein : le quatrième est refusé et retourne à l'étagère.
    const shelf = probe().crystalAt(4)!;
    await dragPoint(shelf, { x: 200, y: 262 });
    expect(state().left).toEqual([1, 2, 3]);
    expect(probe().crystalAt(4)).toEqual(shelf);
    // Hors de toute case : étagère.
    await dragPoint(probe().crystalAt(5)!, { x: 320, y: 100 });
    expect(state().right).toEqual([]);
    // Un cristal posé se reprend et se glisse de l'autre côté.
    await dragPoint(probe().crystalAt(2)!, probe().casePoint("right", 0));
    expect(state().left).toEqual([1, 3]);
    expect(state().right).toEqual([2]);
    // Reposé à l'insertion 0 du côté gauche : les suivants sont décalés.
    await dragPoint(probe().crystalAt(4)!, probe().casePoint("left", 0));
    expect(state().left).toEqual([4, 1, 3]);
  }, 60_000);

  it("F1 rejoue la voix d'introduction ; le bouton carte demande l'avertissement", async () => {
    const { host, engine, wait, dialog, queued, probe } = await start(1);
    host.press("F1", { key: "F1" });
    await wait(6);
    expect(queued).toContain(probe().kit.introVoice);
    host.click(620, 420);
    await wait(6);
    expect(dialog.isOpen).toBe(true);
    host.press("Enter");
    await wait(10);
    expect(engine.error).toBeNull();
  });

  it("une partie enregistrée pendant l'épreuve retrouve le groupe entier (perdus compris) ; le crochet est retiré à la sortie", async () => {
    const { engine, zoombinis, scene } = await start(1, 5);
    const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(zoombinis.game.group.members).toHaveLength(5);
    expect(zoombinis.game.group.members.every((z) => z.present)).toBe(true);
    scene.leave(engine.ctx);
    expect(dialogs.beforeSave).toHaveLength(0);
  });

  it("les `SCRB` et `SCRS` de l'archive ont les événements que l'écran attend", () => {
    const archive = MohawkArchive.parse(original.read("SMOKE.MHK"));
    const scrb = (id: number) => parseScrb(archive.get("SCRB", id)).images.map((image) => image.event - 1);
    const scrs = (id: number) => parseScrs(archive.get("SCRS", id)).images.map((image) => image.event - 1);
    // Levier : test à l'image 3 ; « nouveau tirage » : fin à l'image 5 ; balayage : fin à la dernière image.
    expect(scrb(11002)[3]).toBe(2);
    expect(scrb(11004)[5]).toBe(3);
    expect(scrb(11019).at(-1)).toBe(4);
    // Résultats : le Zoombini part (10, 11, 13, 14), les fiches rebondissent (16), le wagonnet de sortie part (17), le cristal se rendort (1).
    for (const [id, walk] of [[11024, 10], [11026, 11], [11028, 13], [11030, 14]] as const) {
      const events = scrb(id);
      expect(events.includes(walk), `SCRB ${id} : ${walk}`).toBe(true);
      expect(events.filter((e) => e === 16).length).toBeGreaterThanOrEqual(8);
      expect(events.includes(17)).toBe(true);
      expect(events.includes(1)).toBe(true);
    }
    // Wagonnets de sortie : 51 puis 50 à la dernière image ; départs au « go » : 60.
    for (let k = 0; k < 18; k++) expect(scrb(11036 + k).at(-1), `SCRB ${11036 + k}`).toBe(50);
    for (let i = 0; i < 4; i++) expect(scrb(11072 + i).at(-1)).toBe(60);
    // Arrivées (niveaux 3-4) et socle (niveau 4).
    expect(scrb(11033).filter((e) => e === 30 || e === 31)).toEqual([30, 31]);
    expect(scrb(11034).filter((e) => e === 35 || e === 36)).toEqual([35, 36]);
    expect(scrb(11035).filter((e) => e === 37 || e === 38)).toEqual([37, 38]);
    expect(scrb(11011).filter((e) => e === 17 || e === 18)).toEqual([17, 18]);
    expect(scrb(11012).at(-1)).toBe(19);
    expect(scrb(11015).at(-1)).toBe(1);
    // Zoombini : fin sur la plate-forme (12038, événement 25 sans cas), trajet 12020 + k de 34 à 2 images.
    expect(scrs(12038).at(-1)).toBe(25);
    [34, 32, 30, 28, 26, 24, 22, 20, 18, 17, 16, 14, 12, 10, 8, 6].forEach((count, k) => expect(parseScrs(archive.get("SCRS", 12020 + k)).images.length).toBe(count));
  });
});
