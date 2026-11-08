import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../../src/data/mohawk/mohawk";
import { parseScrb, parseScrs } from "../../../src/games/zoombinis/data/script";
import { DIALOG } from "../../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../../src/games/zoombinis/engine/engine";
import { FEATURES } from "../../../src/games/zoombinis/engine/features";
import { ScreenId } from "../../../src/games/zoombinis/engine/scene";
import { GRAPHICS, installServices } from "../../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../../src/games/zoombinis/engine/sound";
import { STATE, WAITING_POSITIONS, createPlay, evaluate, robot, slotPosition, stateCode, stonePosition, type Placement } from "../../../src/games/zoombinis/game/puzzles/slides";
import { dialogMemoryIndex, nextScreen } from "../../../src/games/zoombinis/game/route";
import { makeZoombini, type GameState, type Session, type Zoombini } from "../../../src/games/zoombinis/game/state";
import { createSlidesScene, filterStoneParts, type SlidesProbe, type SlidesScene, type StoneLook } from "../../../src/games/zoombinis/scenes/puzzles/slides";
import { originalFiles } from "../../support/original";
import { runFor, TestHost } from "../engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;
const TICK_MS = 17;
const LEVELS = [0, 1, 2, 3] as const;
const setLevel = (level: number) => (game: GameState) => (game.levels = [level, level, level, level]);

/** Un groupe de `count` Zoombinis aux fiches variées (cinq valeurs par attribut). */
function party(count: number): Zoombini[] {
  return Array.from({ length: count }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + ((i * 2) % 5), 1 + ((i * 3) % 5)], i + 1));
}

describe.skipIf(!original.has)("monte-pierre : écran sur les vrais fichiers (SLIDES.MHK)", () => {
  async function start(setup?: (game: GameState, session: Session) => void, size = 16) {
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 3 });
    const services = await installServices(engine);
    const entered: number[] = [];
    const scene: SlidesScene = createSlidesScene();
    for (const id of Object.values(S)) {
      if (id === S.slides) engine.register(id, () => scene);
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
    zoombinis.session.screen = S.slides;
    engine.start(S.slides);
    await runFor(engine, host, 100);
    expect(engine.error).toBeNull();
    const probe = (): SlidesProbe => scene.probe!;
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
    /** Pose un membre sur l'emplacement de rang `k`. */
    const seat = (index: number, k: number) => drag(index, slotPosition(probe().board.slots[k]!));
    /** Pose tout le plan du robot (dans l'ordre des membres saisissables). */
    const apply = async (plan: Placement[]) => {
      for (const { member, slot } of plan) {
        await seat(member, slot);
        await wait(12);
      }
    };
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
      wait,
      until,
      grab,
      drag,
      seat,
      apply,
      features: engine.services.get(FEATURES),
      dialog: engine.services.get(DIALOG),
    };
  }

  it("entre : décor, plateau, 117 pierres dessinées, groupe sur ses positions d'attente, « go » grisé, aucun sauvé, voix d'aide, pas de musique", async () => {
    const { probe, zoombinis, queued, features } = await start();
    const { kit, board } = probe();
    expect(zoombinis.session.screen).toBe(S.slides);
    expect(kit.members).toHaveLength(16);
    kit.members.forEach((m, i) => expect(m.snoid.position).toEqual(WAITING_POSITIONS[i]));
    expect(kit.members.every((m) => !m.zoombini.present)).toBe(true);
    expect(probe().level).toBe(0);
    expect(board.slots).toHaveLength(16);
    expect(probe().slots).toHaveLength(16);
    probe().slots.forEach((t, k) => expect({ x: t.x, y: t.y }).toEqual(slotPosition(board.slots[k]!)));
    // Une feature par pierre non vide, un anneau par emplacement, un anneau caché au repos.
    expect(probe().stones.filter(Boolean).length).toBe(board.stones.filter((s) => s.kind !== "void").length);
    expect(probe().rings).toHaveLength(16);
    expect(probe().rings.every((r) => !r.active)).toBe(true);
    expect(kit.goEnabled).toBe(false);
    expect(kit.buttonState("go")).toBe("disabled");
    expect(probe().busy).toBe(false);
    expect(probe().went).toBe(false);
    expect(queued).not.toContain(997);
    expect(queued.filter((id) => id >= 30000)).toEqual([]);
    expect(kit.introVoice).toBe(20078);
    // Décors (10), pierres, anneaux, boutons et 16 Zoombinis.
    expect(features.features.length).toBeGreaterThanOrEqual(10 + probe().stones.filter(Boolean).length + 16 + 16);
    // Une visite de plus de l'écran (mémoire de dialogue).
    expect(zoombinis.game.dialogMemory[dialogMemoryIndex(S.slides)]! & 0xfff).toBe(1);
  });

  it.each(LEVELS)("niveau %i : plateau du niveau, 16 emplacements, pierres affichées d'après l'état", async (level) => {
    const { probe, features } = await start(setLevel(level));
    const { board, ev } = probe();
    expect(probe().level).toBe(level);
    expect(board.level).toBe(level);
    expect(board.slots).toHaveLength(16);
    expect(board.starts.length).toBeGreaterThan(0);
    // Les cases vides n'ont pas de feature, les autres sont posées sur leur position et affichent une image.
    probe().stones.forEach((feature, i) => {
      expect(feature === undefined).toBe(board.stones[i]!.kind === "void");
      if (!feature) return;
      expect(feature.scriptId).toBe(7000);
      expect(feature.position).toEqual(stonePosition(i));
      expect(feature.parts.length).toBeGreaterThan(0);
    });
    // Les cases vides sont pavées d'une pierre nue (`SCRB` 7001, image 97, `1150:0000`) : le fond de la fosse est couvert de 117 pierres.
    const voids = board.stones.flatMap((s, i) => (s.kind === "void" ? [i] : []));
    expect(probe().bare).toHaveLength(voids.length);
    probe().bare.forEach((feature, k) => {
      expect(feature.scriptId).toBe(7001);
      expect(feature.position).toEqual(stonePosition(voids[k]!));
      expect(feature.parts.map((p) => p.w)).toEqual([97]);
    });
    // À l'arrivée, avant toute pose (`1170:20cc`) : le contour orange (103) entoure exactement les 16 emplacements libres ; les pierres de départ, et elles
    // seules, ont le sommet de couleur (rouge 109, ou bleu 110 pour la variante 1 du niveau 3) ; aucune liaison n'est montée.
    const withPart = (w: number) => probe().stones.flatMap((f, i) => (f?.parts.some((p) => p.w === w) ? [i] : []));
    const top = board.startVariant === 1 ? 110 : 109;
    expect(withPart(103)).toEqual([...board.slots].sort((a, b) => a - b));
    expect(withPart(top)).toEqual([...board.starts].sort((a, b) => a - b));
    expect(withPart(top === 109 ? 110 : 109)).toEqual([]);
    expect(ev.raised.some(Boolean)).toBe(false);
    // Les symboles des liaisons à symbole sont dessinés, seulement celui de leur attribut : cheveux 74, yeux 76, nez 75, pieds 73 (`1170:20cc`).
    const symbolImage = [74, 76, 75, 73];
    board.stones.forEach((stone, i) => {
      if (stone.kind !== "link") return;
      const symbols = probe().stones[i]!.parts.filter((p) => p.w >= 73 && p.w <= 76).map((p) => p.w);
      expect(symbols).toEqual(stone.attr === null ? [] : [symbolImage[stone.attr]]);
    });
    expect(ev.goEnabled).toBe(false);
    expect(features.features.length).toBeGreaterThan(40);
  });

  it("une pose qui relie fait monter la liaison : pierre rejouée, « go » actif, son de bilan 8504, voix de réussite seulement quand tout le groupe est relié", async () => {
    const { probe, seat, until, queued, wait } = await start();
    const { board, play } = probe();
    // Un couple relié par le robot : les deux premiers membres d'une paire du plan.
    const plan = robot(createPlay(board, play.members))!;
    const raisedBefore = probe().ev.raisedCount;
    const first = plan.find((p) => evaluate(withSeat(createPlay(board, play.members), p)).goEnabled)!;
    await seat(first.member, first.slot);
    await wait(10);
    expect(probe().play.seat[first.slot]).toBe(first.member);
    expect(probe().ev.goEnabled).toBe(true);
    expect(probe().ev.raisedCount).toBeGreaterThan(raisedBefore);
    expect(probe().kit.goEnabled).toBe(true);
    expect(probe().kit.buttonState("go")).toBe("normal");
    expect(queued).toContain(8504);
    // L'emplacement relié perd le contour orange (103) et prend le sommet rouge (109) ; la liaison montée aussi.
    const stone = probe().stones[board.slots[first.slot]!]!;
    await until(() => stone.parts.some((p) => p.w === 109), 100);
    expect(stone.parts.some((p) => p.w === 103)).toBe(false);
    probe().ev.raised.forEach((up, i) => up && expect(probe().stones[i]!.parts.some((p) => p.w === 109)).toBe(true));
    expect(stateCode(board, probe().ev, board.slots[first.slot]!)).toBe(STATE.slotConnected);
    expect(queued.some((id) => id >= 20055 && id <= 20063)).toBe(false);
  });

  it("l'anneau d'un emplacement ondule quand un Zoombini le survole (son 7002), puis se cache", async () => {
    const { probe, grab, host, wait, until, queued } = await start();
    const member = probe().kit.members[0]!;
    const point = grab(0)!;
    const slot = probe().slots[0]!;
    const ring = probe().rings[0]!;
    host.input.moveMouse(point.x, point.y);
    host.input.mouseDown("left");
    await wait(4);
    host.input.moveMouse(point.x - member.snoid.position.x + slot.x, point.y - member.snoid.position.y + slot.y);
    await wait(4);
    // Bit `0x1000000` (`playOnly`) : dessiné pendant qu'il joue, plus après sa fin.
    expect(ring.active).toBe(true);
    expect(ring.hasFlag(0x1000000)).toBe(true);
    await until(() => queued.includes(7002), 40);
    host.input.mouseUp("left");
    await until(() => !ring.active, 200);
    expect(ring.hasFlag(0x1000000)).toBe(true);
  });

  it("reprise : un Zoombini posé se reprend, la liaison redescend (8500), il se pose ailleurs ou revient en attente", async () => {
    const { probe, seat, drag, wait, until, queued } = await start();
    const { board, play } = probe();
    const plan = robot(createPlay(board, play.members))!;
    const first = plan.find((p) => evaluate(withSeat(createPlay(board, play.members), p)).goEnabled)!;
    await seat(first.member, first.slot);
    await wait(10);
    expect(probe().ev.goEnabled).toBe(true);
    const member = probe().kit.members[first.member]!;
    expect(probe().slots[first.slot]!.owner).toBe(member);
    // Lâché dans le vide (à gauche du plateau, hors de toute pierre) : il quitte l'emplacement et va à une position d'attente libre.
    queued.length = 0;
    await drag(first.member, { x: 60, y: 400 });
    await wait(40);
    expect(probe().play.seat[first.slot]).toBe(-1);
    expect(probe().ev.goEnabled).toBe(false);
    expect(probe().kit.goEnabled).toBe(false);
    expect(probe().slots[first.slot]!.owner).toBeNull();
    expect(queued).toContain(8500);
    const spot = probe().kit.waitingPlaces.find((p) => p.owner === member);
    expect(spot).toBeDefined();
    // Il y retourne à pied (marche du kit, non comptée : il reste saisissable seulement une fois arrivé).
    expect(probe().kit.walking).toBe(0);
    await until(() => member.snoid.position.x === spot!.x && member.snoid.position.y === spot!.y && member.snoid.resting, 400);
    expect(probe().busy).toBe(false);
  });

  it("un emplacement pris n'est pas une cible : le Zoombini lâché dessus est rejeté, l'occupant reste en place", async () => {
    const { probe, seat, wait, until, features, queued } = await start();
    await seat(0, 3);
    await wait(10);
    expect(probe().play.seat[3]).toBe(0);
    queued.length = 0;
    await seat(1, 3);
    // Dépôt « ailleurs » au-dessus d'une pierre : étincelles, puis il retourne en attente ; rien n'a changé sur le plateau.
    expect(probe().busy).toBe(true);
    expect(features.features.some((f) => f.scriptId >= 8000 && f.scriptId <= 8002)).toBe(true);
    expect(probe().play.seat[3]).toBe(0);
    expect(probe().play.seat).not.toContain(1);
    const kit = probe().kit;
    expect(probe().slots[3]!.owner).toBe(kit.members[0]);
    await until(() => !probe().busy, 200);
    await until(() => kit.waitingPlaces.some((p) => p.owner === kit.members[1]) && !kit.members[1]!.walking && kit.members[1]!.snoid.resting, 600);
    expect(kit.members[0]!.snoid.position).toEqual(slotPosition(probe().board.slots[3]!));
    expect(probe().play.seat[3]).toBe(0);
  }, 30_000);

  it("lâché sur l'emplacement qu'il vient de quitter, il y reste sans rien changer", async () => {
    const { probe, seat, wait, queued } = await start();
    await seat(0, 5);
    await wait(10);
    queued.length = 0;
    await seat(0, 5);
    await wait(10);
    expect(probe().play.seat[5]).toBe(0);
    expect(probe().slots[5]!.owner).toBe(probe().kit.members[0]);
    expect(queued.filter((id) => id >= 8500)).toEqual([]);
  });

  it("lâché au-dessus d'une pierre qui n'est pas un emplacement : étincelles, vol, retour en attente ; les clics sont ignorés entre-temps", async () => {
    const { probe, drag, wait, until, features, queued } = await start();
    const { board } = probe();
    // Une liaison (pas un emplacement) : le Zoombini y est rejeté.
    const link = board.stones.findIndex((s) => s.kind === "link");
    const p = stonePosition(link);
    await drag(2, { x: p.x + 20, y: p.y - 8 });
    expect(probe().busy).toBe(true);
    expect(features.features.some((f) => f.scriptId >= 8000 && f.scriptId <= 8002)).toBe(true);
    const member = probe().kit.members[2]!;
    // Pendant le rejet, un autre Zoombini ne se saisit pas.
    expect(probe().kit.pick(WAITING_POSITIONS[0]!.x, WAITING_POSITIONS[0]!.y - 20)).toBe(false);
    await wait(2);
    expect(queued).toContain(8000);
    // Lancé (SCRS 14000 + k), puis en vol (14003) ; la saisie reprend au début du vol.
    await until(() => member.snoid.scriptId >= 14000 && member.snoid.scriptId <= 14002, 60);
    await until(() => member.snoid.scriptId === 14003, 120);
    expect(probe().busy).toBe(false);
    await until(() => !member.walking && member.snoid.resting && probe().kit.waitingPlaces.some((w) => w.owner === member), 400);
    const spot = probe().kit.waitingPlaces.find((w) => w.owner === member)!;
    await until(() => member.snoid.position.x === spot.x && member.snoid.position.y === spot.y, 400);
    expect(probe().play.seat).not.toContain(2);
    expect(probe().kit.members.filter((m) => m.snoid.destroyed)).toHaveLength(0);
  }, 30_000);

  it("« go » est grisé tant que personne n'est relié : le clic ne fait rien", async () => {
    const { probe, host, wait, engine } = await start();
    host.click(620, 460);
    await wait(10);
    expect(probe().went).toBe(false);
    expect(probe().kit.left).toBe(false);
    expect(engine.error).toBeNull();
  });

  it("« go » : les reliés sont sauvés, leurs pierres s'élèvent (7002) avec eux, puis ils partent un à un ; les autres sont perdus ; écran suivant", async () => {
    const { probe, seat, until, host, wait, zoombinis, engine, queued, features } = await start();
    const { board, play } = probe();
    const plan = robot(createPlay(board, play.members))!;
    const first = plan.find((p) => evaluate(withSeat(createPlay(board, play.members), p)).goEnabled)!;
    await seat(first.member, first.slot);
    await wait(10);
    expect(probe().kit.goEnabled).toBe(true);
    const connectedStones = board.stones.map((_, i) => i).filter((i) => stateCode(board, probe().ev, i) === STATE.slotConnected || board.stones[i]!.kind === "start" || probe().ev.raised[i]);
    queued.length = 0;
    // Le bouton « go » est à (600, 441)-(639, 478).
    host.click(620, 460);
    await wait(2);
    expect(probe().went).toBe(true);
    expect(probe().kit.left).toBe(true);
    expect(probe().result?.saved).toEqual([first.member]);
    expect(queued).toContain(7000);
    expect(queued).not.toContain(996);
    expect([...probe().rising].sort((a, b) => a - b)).toEqual(connectedStones.sort((a, b) => a - b));
    expect(probe().stage).toBe("rising");
    await wait(2);
    expect(probe().rising.every((i) => probe().stones[i]!.scriptId === 7002)).toBe(true);
    // Les pierres qui montent ont le sommet rouge (109) et des connecteurs rouges (`w + 0x30`, `1170:250c`), plus de connecteur gris.
    for (const i of probe().rising) {
      const ws = probe().stones[i]!.parts.map((p) => p.w);
      expect(ws).toContain(109);
      expect(ws.some((w) => w === 4 || w === 8 || w === 24)).toBe(false);
    }
    expect(features.features.some((f) => f.scriptId === 13000)).toBe(true);
    // Les marqueurs de sauvetage : seul le relié est sauvé.
    probe().kit.members.forEach((m, i) => expect(m.zoombini.present).toBe(i === first.member));
    // Fin de la montée : son 7001, 60 ticks, son 996, départ.
    await until(() => probe().stage === "pause", 200);
    expect(queued).toContain(7001);
    expect(queued).not.toContain(996);
    await until(() => probe().stage === "walking", 120);
    expect(queued).toContain(996);
    const rider = probe().kit.members[first.member]!;
    // Le Zoombini est resté en haut de sa pierre (73 pixels plus haut) avant de partir.
    const top = slotPosition(board.slots[first.slot]!);
    expect(rider.snoid.walking || rider.snoid.position.y <= top.y).toBe(true);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 3000);
    expect(engine.error).toBeNull();
    expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(S.slides, "success") });
    const { game } = zoombinis;
    // Les 15 autres sont perdus ; le passage est marqué (bit du niveau 0) mais pas « sans perte ».
    expect(game.successes[12 - 7]! & 1).toBe(1);
    expect(game.successes[12 - 7]! & 0x10).toBe(0);
    expect(game.group.members.filter((z) => z.present)).toHaveLength(1);
  }, 90_000);

  it("un clic pendant la sortie change tout de suite d'écran", async () => {
    const { probe, seat, host, wait, until, zoombinis } = await start();
    const { board, play } = probe();
    const plan = robot(createPlay(board, play.members))!;
    const first = plan.find((p) => evaluate(withSeat(createPlay(board, play.members), p)).goEnabled)!;
    await seat(first.member, first.slot);
    await wait(10);
    host.click(620, 460);
    await wait(3);
    expect(probe().went).toBe(true);
    host.click(300, 300);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 100);
    expect(zoombinis.game.group.members.filter((z) => z.present)).toHaveLength(1);
  }, 30_000);

  it("« go » n'est pas gardé par le rejet en cours ; après « go », plus rien ne se saisit ni ne se rejette", async () => {
    const { probe, seat, drag, host, wait } = await start();
    const { board, play } = probe();
    const plan = robot(createPlay(board, play.members))!;
    const first = plan.find((p) => evaluate(withSeat(createPlay(board, play.members), p)).goEnabled)!;
    await seat(first.member, first.slot);
    await wait(10);
    const link = board.stones.findIndex((s) => s.kind === "link");
    const p = stonePosition(link);
    const other = first.member === 3 ? 4 : 3;
    await drag(other, { x: p.x + 20, y: p.y - 8 });
    expect(probe().busy).toBe(true);
    // Pendant le rejet : plus rien ne se saisit (code 3), mais « go » (code 2) part.
    expect(probe().kit.pick(WAITING_POSITIONS[8]!.x, WAITING_POSITIONS[8]!.y - 20)).toBe(false);
    host.click(620, 460);
    await wait(2);
    expect(probe().went).toBe(true);
    expect(probe().result?.saved).toEqual([first.member]);
    expect(probe().kit.pick(WAITING_POSITIONS[8]!.x, WAITING_POSITIONS[8]!.y - 20)).toBe(false);
  }, 30_000);

  it("une partie enregistrée pendant l'épreuve retrouve le groupe entier (perdus compris) ; le crochet est retiré à la sortie", async () => {
    const { engine, zoombinis, scene, dialog } = await start();
    const dialogs = dialog as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    zoombinis.game.group.members = [];
    for (const hook of dialogs.beforeSave) hook();
    expect(zoombinis.game.group.members).toHaveLength(16);
    expect(zoombinis.game.group.members.every((z) => z.present)).toBe(true);
    scene.leave(engine.ctx);
    expect(dialogs.beforeSave).toHaveLength(0);
  });

  it.each(LEVELS)("niveau %i : le robot relie tout le groupe d'après le plateau de l'écran, la voix de réussite part, « go » sauve les 16", async (level) => {
    const { probe, apply, until, queued, host, wait, zoombinis } = await start(setLevel(level));
    const { board, play } = probe();
    const plan = robot(createPlay(board, play.members));
    expect(plan, "robot").not.toBeNull();
    expect(plan).toHaveLength(16);
    await apply(plan!);
    await wait(20);
    expect(probe().ev.victory).toBe(true);
    expect(probe().result).toBeNull();
    await until(() => queued.some((id) => id >= 20055 && id <= 20063), 100);
    expect(probe().celebrating).toBe(true);
    // Un Zoombini danse (SCRS 13001 à 13005).
    await until(() => probe().kit.members.some((m) => m.snoid.scriptId >= 13001 && m.snoid.scriptId <= 13005), 200);
    // Le clic suivant n'arrête que la danse : il ne saisit rien.
    host.click(300, 450);
    await wait(2);
    expect(probe().celebrating).toBe(false);
    expect(probe().kit.carrying).toBeNull();
    // Niveau 3, plan complet de 16 : pas de cycle de palette (il faut exactement 4 emplacements occupés).
    expect(probe().cycling).toBe(false);
    host.click(620, 460);
    await wait(3);
    expect(probe().went).toBe(true);
    expect(probe().result?.perfect).toBe(true);
    expect(probe().result?.saved).toHaveLength(16);
    await until(() => zoombinis.lastChange?.screen === S.xfer, 4000);
    expect(zoombinis.game.group.members.filter((z) => z.present)).toHaveLength(16);
    expect(zoombinis.game.successes[S.slides - 7]! & (1 << level)).toBe(1 << level);
    expect(zoombinis.game.successes[S.slides - 7]! & (0x10 << level)).toBe(0x10 << level);
  }, 180_000);

  it("niveau 3 : quatre Zoombinis dont 57, 59 et 61 reliés lancent le cycle de palette (trois entrées dès 30, un cran toutes les 7 ticks), jusqu'à la sortie", async () => {
    const { probe, apply, wait, engine } = await start(setLevel(3), 4);
    const { board, play } = probe();
    const plan = robot(createPlay(board, play.members))!;
    expect(plan).toHaveLength(4);
    const palette = engine.services.get(GRAPHICS).palette;
    const before = Array.from(palette.snapshot(30, 3));
    // Un à un : tant que les quatre ne sont pas posés (et reliés), pas de cycle.
    await apply(plan.slice(0, 3));
    await wait(30);
    expect(probe().cycling).toBe(false);
    expect(Array.from(palette.snapshot(30, 3))).toEqual(before);
    await apply(plan.slice(3));
    expect(probe().ev.paletteCycle).toBe(true);
    expect(probe().cycling).toBe(true);
    await wait(30);
    const after = Array.from(palette.snapshot(30, 3));
    expect(after).not.toEqual(before);
    // Un cran : chaque entrée prend la couleur de la précédente (`1170:2312`) ; les autres entrées ne bougent pas.
    const sorted = (v: number[]) => [0, 1, 2].map((k) => v.slice(3 * k, 3 * k + 3).join(",")).sort();
    expect(sorted(after)).toEqual(sorted(before));
    // Le drapeau ne retombe pas, même si un Zoombini est repris.
    await wait(10);
    expect(probe().cycling).toBe(true);
  }, 60_000);

  it("la touche F1 rejoue la voix d'introduction (20078)", async () => {
    const { host, wait, queued } = await start();
    queued.length = 0;
    host.press("F1");
    await wait(3);
    expect(queued).toContain(20078);
  });

  it("le bouton carte demande confirmation avant d'abandonner (son 999)", async () => {
    const { host, wait, queued, probe, dialog } = await start();
    host.click(620, 420);
    await wait(3);
    expect(queued).toContain(999);
    expect(dialog.isOpen).toBe(true);
    expect(probe().kit.left).toBe(true);
  });

  it("les `SCRB` et `SCRS` de l'archive ont les événements et sons que l'écran attend (étincelles, montée, anneau)", () => {
    const archive = MohawkArchive.parse(original.read("SLIDES.MHK"));
    const scrb = (id: number) => parseScrb(archive.get("SCRB", id)).images;
    const scrs = (id: number) => parseScrs(archive.get("SCRS", id)).images;
    for (let k = 0; k < 3; k++) {
      const sparks = scrb(8000 + k);
      expect(sparks).toHaveLength(10);
      expect(sparks[1]!.soundId).toBe(8000);
      expect(sparks[2]!.event - 1).toBe(90 + k);
      expect(sparks[9]!.event - 1).toBe(93);
    }
    expect(scrb(7002)).toHaveLength(7);
    expect(scrb(7013)).toHaveLength(11);
    expect(scrb(7013)[2]!.soundId).toBe(7002);
    expect(scrs(13000)).toHaveLength(7);
    expect(scrs(14003)).toHaveLength(24);
    expect(scrs(14003)[3]!.event).toBe(214);
    for (const id of [14000, 14001, 14002]) expect(scrs(id)).toHaveLength(2);
    // Les sons de bilan 8500 à 8505 sont dans l'archive de l'écran.
    for (const id of [7000, 7001, 7002, 8000, 8500, 8501, 8502, 8504, 8505]) expect(archive.has("\0SND", id)).toBe(true);
  });

  describe("touches du mode de test (1170:1740)", () => {
    const testLevel = (level: number, testMode: boolean) => (game: GameState) => {
      setLevel(level)(game);
      game.options.testMode = testMode;
    };
    /** Frappe les caractères un à un. */
    const type = async (t: Awaited<ReturnType<typeof start>>, keys: string) => {
      for (const key of keys) {
        t.host.press(`Key${key.toUpperCase()}`, { key });
        await t.wait(3);
      }
    };
    const solutionSeats = (t: Awaited<ReturnType<typeof start>>) => t.probe().board.solution;
    const placed = (t: Awaited<ReturnType<typeof start>>) => t.probe().play.seat.filter((m) => m >= 0).length;

    // Le code d'origine avance à `s`, `o`, `v`, `l`, `e` (`DS:9c7e`, table `CS:1810`) ; le mot « solve » n'est pas la séquence.
    it("niveau 3 : s, o, v, l, e posent la solution du générateur : tout le groupe est relié, « go » actif, la danse part", async () => {
      const t = await start(testLevel(3, true));
      expect(t.probe().level).toBe(3);
      await type(t, "sovle");
      const { seat } = t.probe().play;
      // Les membres de la solution sont sur leur emplacement ; celui que le générateur du port laisse sans emplacement prend l'emplacement resté libre.
      solutionSeats(t).forEach((m, k) => m >= 0 && expect(seat[k]).toBe(m));
      expect(placed(t)).toBe(16);
      expect(t.probe().ev.connected).toHaveLength(16);
      expect(t.probe().ev.victory).toBe(true);
      expect(t.probe().kit.goEnabled).toBe(true);
      expect(t.probe().celebrating).toBe(true);
      // Chaque membre est sur son emplacement.
      t.probe().play.seat.forEach((m, k) => {
        if (m < 0) return;
        const member = t.probe().kit.members[m]!;
        expect(member.target).toBe(t.probe().slots[k]);
        expect(member.snoid.position).toEqual({ x: t.probe().slots[k]!.x, y: t.probe().slots[k]!.y });
      });
    });

    it("la séquence est stricte : « solve », une lettre manquante ou dans le désordre ne fait rien ; les autres touches ne la remettent pas à zéro", async () => {
      // « solve » : s, o, v avancent, puis l (attendu après v) puis e : seules s, o, v sont reconnues dans cet ordre ; `l` et `e` arrivent trop tôt.
      const wrong = await start(testLevel(3, true));
      await type(wrong, "solve");
      expect(placed(wrong)).toBe(0);
      const partial = await start(testLevel(3, true));
      await type(partial, "sovl");
      await type(partial, "ovl");
      expect(placed(partial)).toBe(0);
      // Des touches étrangères et des répétitions ne remettent rien à zéro ; la dernière lettre déclenche.
      const strict = await start(testLevel(3, true));
      await type(strict, "xsqoozvvwlle");
      expect(placed(strict)).toBe(16);
    });

    it("hors du mode de test, la séquence ne fait rien", async () => {
      const t = await start(testLevel(3, false));
      await type(t, "sovle");
      expect(placed(t)).toBe(0);
    });

    it.each([0, 1, 2])("niveau %i : la séquence est reconnue mais ne pose rien (la pose n'existe qu'au niveau 3)", async (level) => {
      const t = await start(testLevel(level, true));
      await type(t, "sovle");
      expect(placed(t)).toBe(0);
    });

    it("la solution reprend un plateau entamé : l'intrus qui occupait un emplacement visé et le membre posé au mauvais endroit rejoignent leur place", async () => {
      const t = await start(testLevel(3, true));
      const solution = solutionSeats(t);
      const stranger = [...Array(16).keys()].find((i) => !solution.includes(i))!;
      const free = solution.indexOf(-1);
      const wanted = solution.findIndex((m) => m >= 0);
      expect(stranger).toBeDefined();
      expect(free).toBeGreaterThanOrEqual(0);
      // L'intrus sur l'emplacement d'un membre de la solution, et ce membre sur l'emplacement laissé libre.
      await t.seat(stranger, wanted);
      await t.seat(solution[wanted]!, free);
      expect(t.probe().play.seat[wanted]).toBe(stranger);
      await type(t, "sovle");
      solution.forEach((m, k) => m >= 0 && expect(t.probe().play.seat[k]).toBe(m));
      expect(t.probe().play.seat[free]).toBe(stranger);
      expect(t.probe().kit.members[stranger]!.target).toBe(t.probe().slots[free]);
      expect(t.probe().kit.waitingPlaces.every((place) => place.owner === null)).toBe(true);
      expect(t.probe().ev.victory).toBe(true);
    });
  });
});

describe("monte-pierre : image d'une pierre selon son état (`1170:20cc` au repos, `1170:250c` en montée)", () => {
  /** Pièces de l'image 0 du `SCRB` 7000 (socle, sommets, contour, symboles, connecteurs 5, 0, 1). */
  const STONE = [98, 109, 110, 103, 73, 74, 75, 76, 24, 4, 8].map((w) => ({ w, x: 0, y: 0 }));
  /** Pièces d'une image du `SCRB` 7002 (montée). */
  const RISE = [86, 109, 110, 24, 4, 8].map((w) => ({ w, x: 0, y: 0 }));
  const look = (code: number, more: Partial<StoneLook> = {}): StoneLook => ({ attr: null, code, mask: 0, variant: 0, rising: false, ...more });
  const ws = (parts: { w: number; x: number; y: number }[], l: StoneLook) => filterStoneParts(parts, l).map((p) => p.w);

  it("emplacement libre : contour orange 103 sur le socle, sans sommet de couleur (les deux variantes)", () => {
    expect(ws(STONE, look(STATE.slotFree))).toEqual([98, 103]);
    expect(ws(STONE, look(STATE.slotFree, { variant: 1 }))).toEqual([98, 103]);
  });

  it("symbole d'une liaison : celui de son attribut, cheveux 74, yeux 76, nez 75, pieds 73 (table `CS:22ea`)", () => {
    expect([0, 1, 2, 3].map((attr) => ws(STONE, look(STATE.linkLow, { attr })))).toEqual([
      [98, 74],
      [98, 76],
      [98, 75],
      [98, 73],
    ]);
  });

  it("emplacement occupé non relié, liaison basse, pierre libre : socle gris seul (plus le symbole de la liaison)", () => {
    expect(ws(STONE, look(STATE.slotOccupied))).toEqual([98]);
    expect(ws(STONE, look(STATE.linkLow, { attr: 2 }))).toEqual([98, 75]);
    expect(ws(STONE, look(STATE.linkLow))).toEqual([98]);
  });

  it("pierre haute (départ, liaison montée, emplacement relié) : sommet rouge 109 en variante 0, bleu 110 en variante 1, jamais le contour", () => {
    for (const code of [STATE.start, STATE.linkRaised, STATE.slotConnected]) expect(ws(STONE, look(code))).toEqual([98, 109]);
    for (const code of [STATE.startAlt, STATE.linkRaised, STATE.slotConnected]) expect(ws(STONE, look(code, { variant: 1 }))).toEqual([98, 110]);
    expect(ws(STONE, look(STATE.linkRaised, { attr: 0 }))).toEqual([98, 109, 74]);
  });

  it("connecteurs selon les bits 0, 1 et 5 du masque ; en montée, ils prennent la couleur du sommet (w + 0x30 rouge, w + 0x18 bleu)", () => {
    expect(ws(STONE, look(STATE.linkLow, { mask: 1 | 32 }))).toEqual([98, 24, 4]);
    expect(ws(RISE, look(STATE.slotConnected, { mask: 1 | 2, rising: true }))).toEqual([86, 109, 52, 56]);
    expect(ws(RISE, look(STATE.startAlt, { mask: 32, rising: true, variant: 1 }))).toEqual([86, 110, 48]);
  });
});

/** Une pose du plan appliquée à une partie neuve (évaluation d'un état intermédiaire, hors de l'écran). */
function withSeat(play: ReturnType<typeof createPlay>, placement: Placement): ReturnType<typeof createPlay> {
  play.seat[placement.slot] = placement.member;
  return play;
}
