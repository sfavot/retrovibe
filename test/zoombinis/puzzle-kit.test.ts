import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../src/data/mohawk/mohawk";
import { screenInfo, TAG_TMID } from "../../src/games/zoombinis/data/archives";
import { DIALOG } from "../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { ZOOMBINIS_GAME } from "../../src/games/zoombinis/engine/game";
import { ScreenId, type Scene, type SceneContext } from "../../src/games/zoombinis/engine/scene";
import { installServices } from "../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../src/games/zoombinis/engine/sound";
import { nextScreen } from "../../src/games/zoombinis/game/route";
import { makeZoombini, newGame, type GameState, type Session, type Zoombini } from "../../src/games/zoombinis/game/state";
import {
  BUTTON_GO,
  BUTTON_MAP,
  CARRY_DEPTH,
  createPuzzleKit,
  createTarget,
  HELP_KEY,
  HIDDEN_CURSOR,
  PUZZLE_MUSIC,
  puzzleMusicId,
  REGRET_VOICES,
  SOUND_ENTRY,
  SOUND_GO,
  SOUND_MAP,
  SUCCESS_VOICES,
  type ArrivalSpec,
  type DropInfo,
  type PuzzleKit,
  type PuzzleKitSpec,
} from "../../src/games/zoombinis/scenes/puzzle-kit";
import { BACKGROUNDS } from "../../src/games/zoombinis/scenes/puzzle-stub";
import { closeScreen, openScreen } from "../../src/games/zoombinis/scenes/screen-kit";
import { originalFiles } from "../support/original";
import { FRAME_MS, runFor, TestHost } from "./engine-test-host";

const original = originalFiles("zoombinis", "files.json");

const S = ScreenId;
const BRIDGE = 7;
const ROW_Y = 458;
const FREE_Y = 410;
const STEP_X = 36;

function party(count: number): Zoombini[] {
  return Array.from({ length: count }, (_, i) => makeZoombini([1 + (i % 5), 1 + (Math.floor(i / 5) % 5), 1 + (i % 3), 1 + (i % 5)], i + 1));
}

interface Config {
  screen?: number;
  size?: number;
  /** Nombre de cibles libres au-dessus des places. */
  free?: number;
  setup?: (game: GameState, session: Session) => void;
  spec?: Partial<PuzzleKitSpec>;
  arrival?: ArrivalSpec;
}

describe.skipIf(!original.has)("kit des épreuves (H0)", () => {
  /** Une épreuve de test sur le kit : le fond de l'archive, un groupe sur une rangée de places, des cibles libres au-dessus. */
  async function start(config: Config = {}) {
    const screen = config.screen ?? BRIDGE;
    const size = config.size ?? 16;
    const host = new TestHost();
    host.audio.unlock();
    const engine = createZoombinisEngine(host, { seed: 5 });
    const services = await installServices(engine);
    const out: { kit?: PuzzleKit; enterTick: number; party: Zoombini[]; free: ReturnType<typeof createTarget>[] } = { enterTick: -1, party: [], free: [] };
    let archive!: Awaited<ReturnType<SceneContext["resources"]["open"]>>;
    const scene: Scene = {
      async load(ctx) {
        archive = await ctx.resources.open(screenInfo(screen)!.archive!);
      },
      enter(ctx) {
        const zoombinis = ctx.services.get(ZOOMBINIS_GAME);
        zoombinis.session.screen = screen;
        openScreen(ctx, archive, { background: BACKGROUNDS[screen] });
        out.party = zoombinis.game.group.members.filter((z) => z.present).map((z) => ({ ...z, attrs: [...z.attrs] as Zoombini["attrs"], state: z.state.slice() }));
        const x0 = (640 - (out.party.length - 1) * STEP_X) / 2;
        const row = (y: number) => out.party.map((_, i) => ({ x: x0 + i * STEP_X, y }));
        out.free = Array.from({ length: config.free ?? 3 }, (_, i) => createTarget({ x: x0 + i * STEP_X, y: FREE_Y }));
        out.kit = createPuzzleKit(ctx, {
          screen,
          party: out.party,
          places: row(ROW_Y),
          targets: (places) => [...places, ...out.free],
          exitWalk: { x: 680, y: 316 },
          ...config.spec,
        });
        out.enterTick = ctx.clock.ticks;
        out.kit.arrive(config.arrival ?? { startDelay: 30, step: 45 });
        ctx.requestPresent();
      },
      leave(ctx) {
        out.kit?.leave();
        closeScreen(ctx);
      },
      tick() {
        out.kit?.tick();
      },
    };
    for (const id of Object.values(S)) {
      if (id === screen) engine.register(id, () => scene);
      else engine.register(id, () => ({ enter() {}, leave() {}, tick() {} }));
    }
    const zoombinis = services.game;
    zoombinis.game.group.members = party(size);
    zoombinis.game.stageUnbroken = true;
    config.setup?.(zoombinis.game, zoombinis.session);
    zoombinis.session.screen = screen;
    engine.start(screen as ScreenId);
    await runFor(engine, host, 60);
    expect(engine.error).toBeNull();
    const tickOnce = async () => {
      const t = engine.ctx.clock.ticks;
      while (engine.ctx.clock.ticks === t) await runFor(engine, host, FRAME_MS);
    };
    const ticks = async (n: number) => {
      for (let i = 0; i < n; i++) await tickOnce();
    };
    const kit = () => out.kit!;
    const sound = engine.services.get(ZOOMBINIS_SOUND);
    return { host, engine, services, zoombinis, out, kit, tickOnce, ticks, sound, dialog: engine.services.get(DIALOG) };
  }

  const standing = (setup?: Config["setup"]): Config["setup"] => (game, session) => {
    game.options.lessAction = true;
    setup?.(game, session);
  };

  describe("arrivée du groupe (1168:2505, 274e)", () => {
    it("les ⌊3N/4⌋ premiers sont debout sur leur place, les autres sont hors écran à x = −50 ; départs 30 ticks après l'entrée puis toutes les 45, du plus à droite au plus à gauche", async () => {
      const { out, kit, tickOnce, engine } = await start({ setup: (game) => (game.options.lessAction = false) });
      expect(kit().members).toHaveLength(16);
      kit().members.forEach((m, i) => {
        const place = kit().waitingPlaces[i]!;
        if (i < 12) {
          expect(m.snoid.position).toEqual({ x: place.x, y: place.y });
          expect(place.owner === m).toBe(true);
          expect(m.walking).toBe(false);
        } else {
          expect(m.snoid.position).toEqual({ x: -50, y: ROW_Y });
          expect(place.owner).toBeNull();
          expect(m.walking).toBe(true);
        }
      });
      expect(kit().walking).toBe(4);
      expect(kit().arrived).toBe(0);

      const started = new Map<number, number>();
      for (let i = 0; i < 1200; i++) {
        await tickOnce();
        for (const m of kit().members) if (m.snoid.walking && !started.has(m.index)) started.set(m.index, engine.ctx.clock.ticks);
      }
      expect([...started.keys()]).toEqual([15, 14, 13, 12]);
      const first = started.get(15)! - out.enterTick;
      expect(first).toBeGreaterThanOrEqual(30);
      expect(first).toBeLessThanOrEqual(33);
      expect(started.get(14)! - started.get(15)!).toBe(45);
      expect(started.get(13)! - started.get(14)!).toBe(45);
      expect(started.get(12)! - started.get(13)!).toBe(45);

      // Tous arrivés : sur leur place, propriétaires, compteurs.
      expect(kit().walking).toBe(0);
      expect(kit().arrived).toBe(4);
      kit().members.forEach((m, i) => {
        const place = kit().waitingPlaces[i]!;
        expect(m.snoid.position).toEqual({ x: place.x, y: place.y });
        expect(place.owner === m).toBe(true);
        expect(m.walking).toBe(false);
      });
    });

    it("l'écart et le délai de départ sont ceux de l'épreuve (0 et 45 aux gorges), la hauteur d'entrée suit yOffset", async () => {
      const { out, kit, tickOnce, engine } = await start({ arrival: { startDelay: 12, step: 20, yOffset: 100 }, setup: (game) => (game.options.lessAction = false) });
      expect(kit().members[15]!.snoid.position).toEqual({ x: -50, y: ROW_Y + 100 });
      const started = new Map<number, number>();
      for (let i = 0; i < 200 && started.size < 4; i++) {
        await tickOnce();
        for (const m of kit().members) if (m.snoid.walking && m.index >= 12 && !started.has(m.index)) started.set(m.index, engine.ctx.clock.ticks);
      }
      expect(started.get(15)! - out.enterTick).toBeGreaterThanOrEqual(12);
      expect(started.get(15)! - out.enterTick).toBeLessThanOrEqual(14);
      expect(started.get(14)! - started.get(15)!).toBe(20);
    });

    it("tous debout en reprise de partie (le drapeau est consommé) et avec « moins d'action »", async () => {
      const resumed = await start({ setup: (game, session) => ((game.options.lessAction = false), (session.resuming = true)) });
      expect(resumed.kit().walking).toBe(0);
      expect(resumed.kit().members.every((m) => !m.walking && m.snoid.position.x > 0)).toBe(true);
      expect(resumed.zoombinis.session.resuming).toBe(false);
      const calm = await start({ setup: (game) => (game.options.lessAction = true) });
      expect(calm.kit().walking).toBe(0);
      expect(calm.kit().members.every((m) => !m.walking && m.snoid.position.x > 0)).toBe(true);
    });

    it("n'accepte pas plus de membres que de places", async () => {
      const host = new TestHost();
      host.audio.unlock();
      const engine = createZoombinisEngine(host, { seed: 5 });
      const services = await installServices(engine);
      services.game.game.group.members = party(3);
      let error: unknown = null;
      engine.register(S.bridge, () => ({
        async load(ctx) {
          await ctx.resources.open("BRIDGE.MHK");
        },
        enter(ctx) {
          openScreen(ctx, ctx.resources.require("BRIDGE.MHK"), { background: 1000 });
          const members = services.game.game.group.members;
          try {
            createPuzzleKit(ctx, { screen: BRIDGE, party: members, places: [{ x: 10, y: 10 }] }).arrive({ startDelay: 0, step: 0 });
          } catch (e) {
            error = e;
          }
        },
        leave: closeScreen,
        tick() {},
      }));
      services.game.session.screen = BRIDGE;
      engine.start(S.bridge);
      await runFor(engine, host, 60);
      expect(error).toBeInstanceOf(RangeError);
    });
  });

  describe("glisser-déposer (1168:1742, 58c7)", () => {
    /** Pointeur au milieu du rectangle du membre `i`. */
    const grabPoint = (kit: PuzzleKit, i: number) => {
      const rect = kit.members[i]!.snoid.feature.rect!;
      return { x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) };
    };
    const hold = (setup?: Config["setup"]): Config["setup"] =>
      standing((game, session) => {
        game.options.magneticMouse = false;
        setup?.(game, session);
      });

    it("accepté : le Zoombini suit le pointeur (profondeur maximale, transport 145 + pieds, curseur masqué), se pose sur la cible libre, libère sa place", async () => {
      const decide = vi.fn((_drop: DropInfo) => true);
      const onDrop = vi.fn();
      const onHover = vi.fn();
      const { host, engine, kit, out, tickOnce, ticks } = await start({ size: 6, setup: hold(), spec: { decide, onDrop, onHover } });
      const member = kit().members[0]!;
      const place = kit().waitingPlaces[0]!;
      const target = out.free[1]!;
      const grab = grabPoint(kit(), 0);
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await tickOnce();
      expect(kit().carrying === member).toBe(true);
      expect(host.cursor).toBe(HIDDEN_CURSOR);
      expect(member.snoid.scriptId).toBe(145 + member.snoid.traits.feet);
      expect(member.snoid.feature.depth).toBe(CARRY_DEPTH);
      expect(member.snoid.delay).toBe(3);
      expect(place.owner).toBeNull();
      // Il suit le pointeur, pris par l'endroit où on l'a saisi, et se tourne du côté où il va.
      host.input.moveMouse(grab.x + (target.x - place.x), grab.y + (target.y - place.y));
      await ticks(2);
      expect(member.snoid.position).toEqual({ x: target.x, y: target.y });
      expect(member.snoid.facing).toBe(0);
      expect(onHover.mock.lastCall![0] === target && onHover.mock.lastCall![1] === member).toBe(true);
      host.input.moveMouse(grab.x + (target.x - place.x) - 2, grab.y + (target.y - place.y));
      await ticks(2);
      expect(member.snoid.facing).toBe(1);
      host.input.mouseUp("left");
      await tickOnce();
      expect(kit().carrying).toBeNull();
      expect(decide).toHaveBeenCalledTimes(1);
      const info = decide.mock.calls[0]![0];
      expect([info.member === member, info.target === target, info.from === place]).toEqual([true, true, true]);
      expect(onDrop).toHaveBeenCalledTimes(1);
      expect(member.snoid.position).toEqual({ x: target.x, y: target.y });
      expect(target.owner === member).toBe(true);
      expect(member.target === target).toBe(true);
      expect(place.owner).toBeNull();
      expect(host.cursor).toBe("system");
      // État 4 : téléporté, variante d'attente 1, tourné à droite, délai de 6 ticks, profondeur de la cible.
      expect(member.snoid.idleVariant).toBe(1);
      expect(member.snoid.scriptId).toBe(101);
      expect(member.snoid.facing).toBe(0);
      expect(member.snoid.delay).toBe(6);
      expect(member.snoid.feature.depth).toBeCloseTo(1 + target.y / 1000);
      expect(engine.error).toBeNull();
    });

    it("refusé par l'épreuve : retour d'un coup à la place d'origine, qui redevient occupée ; la cible reste libre", async () => {
      const onReturn = vi.fn();
      const { host, kit, out, tickOnce, ticks } = await start({ size: 6, setup: hold(), spec: { decide: () => false, onReturn } });
      const member = kit().members[2]!;
      const place = kit().waitingPlaces[2]!;
      const target = out.free[2]!;
      const grab = grabPoint(kit(), 2);
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await tickOnce();
      host.input.moveMouse(grab.x + (target.x - place.x), grab.y + (target.y - place.y));
      await ticks(2);
      host.input.mouseUp("left");
      await tickOnce();
      expect(kit().carrying).toBeNull();
      expect(onReturn).toHaveBeenCalledTimes(1);
      const info = onReturn.mock.calls[0]![0] as DropInfo;
      expect([info.member === member, info.target === target, info.from === place]).toEqual([true, true, true]);
      expect(member.snoid.position).toEqual({ x: place.x, y: place.y });
      expect(place.owner === member).toBe(true);
      expect(target.owner).toBeNull();
      expect(member.target === place).toBe(true);
    });

    it("hors de toute cible libre ou sur une place occupée : retour à l'origine sans demander à l'épreuve", async () => {
      const decide = vi.fn(() => true);
      const onReturn = vi.fn();
      const { host, kit, tickOnce, ticks } = await start({ size: 6, setup: hold(), spec: { decide, onReturn } });
      const member = kit().members[0]!;
      const place = kit().waitingPlaces[0]!;
      const grab = grabPoint(kit(), 0);
      // Loin de tout, puis sur la place d'un voisin (occupée).
      for (const dest of [{ x: 300, y: 150 }, { x: kit().waitingPlaces[1]!.x, y: ROW_Y }]) {
        host.input.moveMouse(grab.x, grab.y);
        host.input.mouseDown("left");
        await tickOnce();
        host.input.moveMouse(grab.x + (dest.x - place.x), grab.y + (dest.y - place.y));
        await ticks(2);
        host.input.mouseUp("left");
        await tickOnce();
        expect(member.snoid.position).toEqual({ x: place.x, y: place.y });
        expect(place.owner === member).toBe(true);
        await ticks(2);
      }
      expect(decide).not.toHaveBeenCalled();
      expect(onReturn).toHaveBeenCalledTimes(2);
      expect((onReturn.mock.calls[0]![0] as DropInfo).target === null).toBe(true);
      expect(kit().waitingPlaces[1]!.owner === kit().members[1]).toBe(true);
    });

    it("le Zoombini reste dans la zone de transport", async () => {
      const { host, kit, tickOnce, ticks } = await start({ size: 6, setup: hold(), spec: { bounds: { left: 100, top: 300, right: 500, bottom: 470 } } });
      const grab = grabPoint(kit(), 0);
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await tickOnce();
      host.input.moveMouse(0, 0);
      await ticks(2);
      expect(kit().members[0]!.snoid.position).toEqual({ x: 100, y: 300 });
      host.input.moveMouse(639, 479);
      await ticks(2);
      expect(kit().members[0]!.snoid.position).toEqual({ x: 500, y: 470 });
      host.input.mouseUp("left");
      await tickOnce();
    });

    it("le curseur système reste affiché quand l'option « curseur masqué » est coupée", async () => {
      const { host, kit, tickOnce } = await start({ size: 6, setup: hold((game) => (game.options.hideCursorWhileCarrying = false)) });
      const grab = grabPoint(kit(), 0);
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await tickOnce();
      await tickOnce();
      expect(kit().carrying).not.toBeNull();
      host.input.mouseUp("left");
      await tickOnce();
      expect(host.cursors).not.toContain(HIDDEN_CURSOR);
    });

    it("souris aimantée : relâcher ne dépose pas, le clic suivant dépose (clic-clic)", async () => {
      const { host, kit, out, tickOnce, ticks } = await start({ size: 6, setup: standing((game) => (game.options.magneticMouse = true)) });
      const member = kit().members[0]!;
      const place = kit().waitingPlaces[0]!;
      const target = out.free[0]!;
      const grab = grabPoint(kit(), 0);
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await tickOnce();
      host.input.mouseUp("left");
      await ticks(3);
      expect(kit().carrying === member).toBe(true);
      host.input.moveMouse(grab.x + (target.x - place.x), grab.y + (target.y - place.y));
      await ticks(3);
      expect(kit().carrying === member).toBe(true);
      expect(member.snoid.position).toEqual({ x: target.x, y: target.y });
      host.input.mouseDown("left");
      await tickOnce();
      host.input.mouseUp("left");
      await tickOnce();
      expect(kit().carrying).toBeNull();
      expect(target.owner === member).toBe(true);
    });

    it("auto-aimantation : un appui plus court que le délai (S+0x02) devient collé, sinon le relâchement dépose", async () => {
      const quick = await start({ size: 6, setup: hold((game) => ((game.options.autoMagnet = true), (game.unknown02 = 20))) });
      let grab = grabPoint(quick.kit(), 0);
      quick.host.input.moveMouse(grab.x, grab.y);
      quick.host.input.mouseDown("left");
      await quick.tickOnce();
      quick.host.input.mouseUp("left");
      await quick.ticks(3);
      expect(quick.kit().carrying).not.toBeNull();
      // Délai nul (valeur d'une partie neuve) : jamais collé.
      const never = await start({ size: 6, setup: hold((game) => (game.options.autoMagnet = true)) });
      grab = grabPoint(never.kit(), 0);
      never.host.input.moveMouse(grab.x, grab.y);
      never.host.input.mouseDown("left");
      await never.tickOnce();
      never.host.input.mouseUp("left");
      await never.ticks(2);
      expect(never.kit().carrying).toBeNull();
    });

    it("endCarry dépose le Zoombini là où il est (fin demandée par l'épreuve)", async () => {
      const { host, kit, tickOnce, ticks } = await start({ size: 6, setup: hold() });
      const grab = grabPoint(kit(), 0);
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await tickOnce();
      expect(kit().carrying).not.toBeNull();
      kit().endCarry();
      await ticks(2);
      expect(kit().carrying).toBeNull();
      expect(kit().members[0]!.snoid.position).toEqual({ x: kit().waitingPlaces[0]!.x, y: kit().waitingPlaces[0]!.y });
    });

    it("rien ne se prend tant que des Zoombinis arrivent (DS:9702), ni un membre déjà en marche ; canPick de l'épreuve", async () => {
      const { host, kit, tickOnce } = await start({ setup: (game) => ((game.options.lessAction = false), (game.options.magneticMouse = false)) });
      expect(kit().walking).toBe(4);
      const grab = grabPoint(kit(), 0);
      host.input.moveMouse(grab.x, grab.y);
      host.input.mouseDown("left");
      await tickOnce();
      host.input.mouseUp("left");
      await tickOnce();
      expect(kit().carrying).toBeNull();
      const refused = await start({ size: 6, setup: hold(), spec: { canPick: (m) => m.index !== 0 } });
      const g = grabPoint(refused.kit(), 0);
      refused.host.input.moveMouse(g.x, g.y);
      refused.host.input.mouseDown("left");
      await refused.tickOnce();
      expect(refused.kit().carrying).toBeNull();
      refused.host.input.mouseUp("left");
      await refused.ticks(2);
    });
  });

  describe("sortie (1168:2982, 36e1)", () => {
    it("« go » : inactif d'abord ; puis son 996, les sauvés partent à pied toutes les 45 ticks (le plus à droite d'abord), l'écran suit à la fin du son", async () => {
      const { host, kit, zoombinis, sound, tickOnce, engine, ticks } = await start({ setup: standing(), spec: { buttons: { go: BUTTON_GO } } });
      const queue = vi.spyOn(sound, "queue");
      kit().markAll(false);
      for (const i of [0, 4, 9]) kit().members[i]!.zoombini.present = true;
      host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
      await tickOnce();
      expect(kit().departing).toBe(false);
      expect(queue).not.toHaveBeenCalled();
      kit().goEnabled = true;
      host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
      await tickOnce();
      expect(kit().departing).toBe(true);
      expect(queue).toHaveBeenCalledWith(SOUND_GO);
      const started = new Map<number, number>();
      const watch = () => {
        for (const m of kit().members) if (m.snoid.walking && !started.has(m.index)) started.set(m.index, engine.ctx.clock.ticks);
      };
      // Le plus à droite part dans le tick même du clic (`+0x24 = maintenant`).
      watch();
      expect([...started.keys()]).toEqual([9]);
      for (let i = 0; i < 200 && started.size < 3; i++) {
        await tickOnce();
        watch();
      }
      expect([...started.keys()]).toEqual([9, 4, 0]);
      expect(started.get(4)! - started.get(9)!).toBe(45);
      expect(started.get(0)! - started.get(4)!).toBe(45);
      // Ceux qui n'étaient pas sauvés restent en place.
      expect(kit().members[1]!.snoid.walking).toBe(false);
      expect(kit().members[1]!.snoid.position.x).toBeGreaterThan(0);
      expect(zoombinis.lastChange).toBeNull();
      for (let i = 0; i < 400 && !zoombinis.lastChange; i++) await tickOnce();
      await ticks(1);
      expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer, target: nextScreen(BRIDGE, "success") });
      expect(engine.error).toBeNull();
      // Les trois sauvés continuent ; les 13 autres sont rendus au choix des Zoombinis (étape 1).
      expect(zoombinis.game.group.members).toHaveLength(3);
      expect(zoombinis.game.pickerGroup.members).toHaveLength(13);
      expect(zoombinis.game.successes[0]! & 1).toBe(1);
      expect(zoombinis.game.successes[0]! & 0x10).toBe(0);
    });

    it("un clic pendant la marche de sortie change d'écran tout de suite", async () => {
      const { host, kit, zoombinis, tickOnce, ticks } = await start({ setup: standing(), spec: { buttons: { go: BUTTON_GO } } });
      kit().goEnabled = true;
      host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
      await tickOnce();
      expect(kit().departing).toBe(true);
      host.click(100, 100);
      await ticks(2);
      expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer });
    });

    it("carte : son 999, avertissement ; « Ah non ! » garde l'épreuve, « Tant pis… » la quitte pour la carte et abandonne le groupe", async () => {
      const { host, kit, zoombinis, dialog, sound, engine, ticks } = await start({ setup: standing() });
      const queue = vi.spyOn(sound, "queue");
      host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
      await ticks(2);
      expect(queue).toHaveBeenCalledWith(SOUND_MAP);
      expect(dialog.isOpen).toBe(true);
      host.press("Escape");
      await ticks(3);
      expect(dialog.isOpen).toBe(false);
      expect(zoombinis.lastChange).toBeNull();
      expect(kit().left).toBe(false);
      host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
      await ticks(2);
      expect(dialog.isOpen).toBe(true);
      host.press("Enter");
      await ticks(3);
      expect(engine.error).toBeNull();
      expect(zoombinis.lastChange).toMatchObject({ screen: S.map, target: null });
      expect(zoombinis.game.group.members).toHaveLength(0);
      expect(zoombinis.game.successes[0]).toBe(0);
      expect(kit().left).toBe(true);
    });

    it("le bouton carte peut être absent (buttons.map = null)", async () => {
      const { host, dialog, ticks } = await start({ setup: standing(), spec: { buttons: { map: null } } });
      host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
      await ticks(2);
      expect(dialog.isOpen).toBe(false);
    });

    it("markAll(true) marque 20 membres au plus ; finish ne s'exécute qu'une fois", async () => {
      const { kit, zoombinis, ticks } = await start({ size: 16, setup: standing() });
      kit().markAll(false);
      expect(kit().members.some((m) => m.zoombini.present)).toBe(false);
      kit().markAll(true);
      expect(kit().members.filter((m) => m.zoombini.present)).toHaveLength(16);
      kit().finish("success");
      kit().finish("success");
      await ticks(2);
      expect(zoombinis.game.counters.camp1 + zoombinis.game.counters.camp2).toBe(0);
      expect(zoombinis.game.successes[0]! & 1).toBe(1);
    });
  });

  describe("enregistrement pendant l'épreuve (11a0:141e)", () => {
    it("range tout le groupe de la scène, présent, dans le tampon avant chaque écriture ; le retrait est appelé à la sortie", async () => {
      const { kit, zoombinis, out, engine } = await start({ setup: standing() });
      const dialogs = engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
      expect(dialogs.beforeSave).toHaveLength(1);
      out.party[3]!.present = false;
      out.party[9]!.present = false;
      zoombinis.game.group.members = [];
      for (const hook of dialogs.beforeSave) hook();
      expect(zoombinis.game.group.members).toHaveLength(16);
      expect(zoombinis.game.group.members.every((z) => z.present)).toBe(true);
      expect(zoombinis.game.group.members.map((z) => z.attrs.join())).toEqual(out.party.map((z) => z.attrs.join()));
      // Le tampon est une copie.
      zoombinis.game.group.members[0]!.attrs[0] = 5;
      expect(out.party[0]!.attrs[0]).not.toBe(5);
      // Une partie remplacée ne reçoit rien.
      const fresh = newGame();
      zoombinis.game = fresh;
      for (const hook of dialogs.beforeSave) hook();
      expect(fresh.group.members).toHaveLength(0);
      kit().leave();
      expect(dialogs.beforeSave).toHaveLength(0);
    });
  });

  describe("aide vocale, voix et musique", () => {
    it("F1 (code 0x16f) rejoue la voix d'introduction, la coupe si elle joue encore ; ignoré sans voix, avec Ctrl", async () => {
      const { kit, sound, ticks } = await start({ setup: standing(), spec: { introVoice: 20071 } });
      expect(HELP_KEY).toBe("F1");
      const queue = vi.spyOn(sound, "queue");
      const stop = vi.spyOn(sound, "stopEffects");
      expect(kit().key({ code: "KeyA" })).toBe(false);
      expect(kit().key({ code: "F1", ctrl: true })).toBe(false);
      expect(kit().key({ code: "F1" })).toBe(true);
      expect(queue).toHaveBeenCalledWith(20071);
      await ticks(3);
      expect(sound.effectsPlaying).toBeGreaterThan(0);
      expect(kit().key({ code: "F1" })).toBe(true);
      expect(stop).toHaveBeenCalledTimes(1);
      expect(queue).toHaveBeenCalledTimes(1);
      expect(sound.effectsPlaying).toBe(0);
      const mute = await start({ setup: standing() });
      const q = vi.spyOn(mute.sound, "queue");
      expect(mute.kit().key({ code: "F1" })).toBe(true);
      expect(q).not.toHaveBeenCalled();
      // Aux gorges la touche n'est prise que si l'épreuve le permet (plus personne en marche).
      const gated = await start({ setup: standing(), spec: { introVoice: 20071, helpAllowed: () => false } });
      expect(gated.kit().key({ code: "F1" })).toBe(false);
    });

    it("voix de réussite 20055–20063, de regret 20045–20048, jingle 997", async () => {
      const { kit, sound } = await start({ setup: standing() });
      const queue = vi.spyOn(sound, "queue");
      for (let i = 0; i < 30; i++) {
        kit().playSuccessVoice();
        kit().playRegretVoice();
      }
      kit().playEntryJingle();
      const ids = queue.mock.calls.map((c) => c[0]);
      expect(ids.filter((id) => id >= 20055 && id <= 20063)).toHaveLength(30);
      expect(ids.filter((id) => id >= 20045 && id <= 20048)).toHaveLength(30);
      expect(new Set(ids.filter((id) => id <= 20063 && id >= 20055)).size).toBeGreaterThan(3);
      expect(ids[ids.length - 1]).toBe(SOUND_ENTRY);
      expect([SUCCESS_VOICES.first, SUCCESS_VOICES.last, REGRET_VOICES.first, REGRET_VOICES.last]).toEqual([20055, 20063, 20045, 20048]);
    });

    it("la musique de l'épreuve est lancée au niveau de l'étape (hôtel, tanière du sphinx, piège de cristal, gouffre des véhibules) et les huit autres n'en ont pas", async () => {
      expect(puzzleMusicId(14, 2)).toBe(30022);
      expect(puzzleMusicId(16, 0)).toBe(30025);
      expect(puzzleMusicId(16, 2)).toBe(30027);
      expect(puzzleMusicId(16, 3)).toBeNull();
      expect(puzzleMusicId(17, 3)).toBe(30033);
      expect(puzzleMusicId(18, 1)).toBe(30036);
      for (const screen of [7, 8, 9, 10, 11, 12, 13, 15]) expect(puzzleMusicId(screen, 0), String(screen)).toBeNull();
      expect(puzzleMusicId(17, -1)).toBeNull();
      const withMusic = await start({ screen: 17, setup: standing((game) => (game.levels = [0, 0, 0, 2])) });
      const queue = vi.spyOn(withMusic.sound, "queue");
      expect(withMusic.kit().playMusic()).toBe(30032);
      expect(queue).toHaveBeenCalledWith(30032);
      await withMusic.ticks(3);
      expect(withMusic.sound.lastMusicId).toBe(30032);
      const none = await start({ screen: 7, setup: standing() });
      expect(none.kit().playMusic()).toBeNull();
    });

    it("tous les ids de PUZZLE_MUSIC existent comme tMID de MIDIMPC.MHK", async () => {
      const host = new TestHost();
      const midi = MohawkArchive.parse(await host.loadFile("MIDIMPC.MHK"));
      const ids = midi.ids(TAG_TMID);
      for (const [screen, music] of Object.entries(PUZZLE_MUSIC)) {
        if (!music) continue;
        for (let level = 0; level <= music.maxLevel; level++) expect(ids, `écran ${screen}, niveau ${level}`).toContain(music.base + level);
      }
    });
  });

  describe("animations d'attente du groupe", () => {
    it("des animations d'attente partent, une à la fois par Zoombini, et le groupe reste en place", async () => {
      const { kit, tickOnce, engine } = await start({ setup: standing() });
      const seen = new Set<number>();
      let max = 0;
      for (let i = 0; i < 3000; i++) {
        await tickOnce();
        const playing = kit().members.filter((m) => m.snoid.playingWait);
        for (const m of playing) {
          seen.add(m.snoid.scriptId);
          expect(m.snoid.scriptId).toBeGreaterThanOrEqual(130);
          expect(m.snoid.scriptId).toBeLessThanOrEqual(137);
        }
        max = Math.max(max, playing.length);
      }
      expect(seen.size).toBeGreaterThan(1);
      expect(max).toBeGreaterThanOrEqual(1);
      kit().members.forEach((m, i) => expect(m.snoid.position).toEqual({ x: kit().waitingPlaces[i]!.x, y: ROW_Y }));
      expect(engine.error).toBeNull();
    });

    it("désactivées par l'épreuve (waitAnimations = false) : aucune", async () => {
      const { kit, tickOnce } = await start({ size: 8, setup: standing(), spec: { waitAnimations: false } });
      for (let i = 0; i < 1500; i++) {
        await tickOnce();
        expect(kit().members.some((m) => m.snoid.playingWait)).toBe(false);
      }
    });

    it("pas d'animation d'attente pendant un transport ni une boîte de dialogue", async () => {
      const { host, kit, tickOnce, dialog, engine } = await start({ size: 8, setup: standing((game) => (game.options.magneticMouse = true)) });
      const rect = kit().members[0]!.snoid.feature.rect!;
      host.input.moveMouse(Math.floor((rect.left + rect.right) / 2), Math.floor((rect.top + rect.bottom) / 2));
      host.input.mouseDown("left");
      await tickOnce();
      host.input.mouseUp("left");
      expect(kit().carrying).not.toBeNull();
      for (let i = 0; i < 1500; i++) {
        await tickOnce();
        expect(kit().members[0]!.snoid.playingWait).toBe(false);
      }
      expect(dialog.isOpen).toBe(false);
      expect(engine.error).toBeNull();
    });
  });
});
