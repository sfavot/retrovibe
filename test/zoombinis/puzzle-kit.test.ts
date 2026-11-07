import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../src/data/mohawk/mohawk";
import type { Shape } from "../../src/data/mohawk/shap";
import { screenInfo, TAG_TMID } from "../../src/games/zoombinis/data/archives";
import { Surface } from "../../src/engine/mohawk/graphics/surface";
import { DIALOG } from "../../src/games/zoombinis/engine/dialog";
import { FEATURES, type Feature } from "../../src/games/zoombinis/engine/features";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { ZOOMBINIS_GAME } from "../../src/games/zoombinis/engine/game";
import { ScreenId, type Scene, type SceneContext } from "../../src/games/zoombinis/engine/scene";
import { installServices } from "../../src/games/zoombinis/engine/services";
import { ZOOMBINIS_SOUND } from "../../src/games/zoombinis/engine/sound";
import type { Point } from "../../src/games/zoombinis/data/zoombini";
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
  sheetButtonImages,
  PUZZLE_MUSIC,
  puzzleMusicId,
  REGRET_VOICES,
  SOUND_ENTRY,
  SOUND_GO,
  SOUND_MAP,
  SUCCESS_VOICES,
  type ArrivalSpec,
  type DropInfo,
  type DropTarget,
  type ObjectCarrySpec,
  type ObjectDrop,
  type PointerInfo,
  type PuzzleKit,
  type PuzzleKitSpec,
} from "../../src/games/zoombinis/scenes/puzzle-kit";
import { BACKGROUNDS } from "../../src/games/zoombinis/scenes/puzzle-stub";
import { closeScreen, openScreen } from "../../src/games/zoombinis/scenes/screen-kit";
import { originalFiles } from "../support/original";
import { FRAME_MS, runFor, TestHost } from "./engine-test-host";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

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
  /** Spec qui dépend de l'archive de l'écran (images de boutons). */
  specOf?: (archive: { tbmpImages(id: number): Shape[] }) => Partial<PuzzleKitSpec>;
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
          ...config.specOf?.(archive),
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
      const { host, kit, zoombinis, sound, tickOnce, engine, ticks } = await start({ setup: standing(), spec: { buttons: { go: {} } } });
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

    it("« go » : l'écran suit la fin du son 996 même si un pas en boucle d'un Zoombini qui part joue encore (1028:0d9e(996), pas le silence)", async () => {
      const { host, kit, zoombinis, sound, tickOnce, ticks } = await start({ setup: standing(), spec: { buttons: { go: {} } } });
      kit().markAll(false);
      for (const i of [0, 4, 9]) kit().members[i]!.zoombini.present = true;
      kit().goEnabled = true;
      host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
      await tickOnce();
      expect(kit().departing).toBe(true);
      // Les scripts de marche des pieds 4 relancent le son 2000 (répété 0xffff) toutes les deux images.
      let loops = 0;
      for (let i = 0; i < 600 && !zoombinis.lastChange; i++) {
        sound.queue(2000);
        await tickOnce();
        loops = host.audio.waves.filter((w) => w.loop && host.audio.isWavePlaying(w.handle)).length;
      }
      await ticks(1);
      expect(zoombinis.lastChange).toMatchObject({ screen: S.xfer });
      expect(loops).toBeLessThanOrEqual(1);
    });

    it("un clic pendant la marche de sortie change d'écran tout de suite", async () => {
      const { host, kit, zoombinis, tickOnce, ticks } = await start({ setup: standing(), spec: { buttons: { go: {} } } });
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
  describe("API de branchement des épreuves (H-kit)", () => {
    const grabPoint = (kit: PuzzleKit, i: number) => {
      const rect = kit.members[i]!.snoid.feature.rect!;
      return { x: Math.floor((rect.left + rect.right) / 2), y: Math.floor((rect.top + rect.bottom) / 2) };
    };
    const hold = (setup?: Config["setup"]): Config["setup"] =>
      standing((game, session) => {
        game.options.magneticMouse = false;
        setup?.(game, session);
      });
    /** Prend le membre `i` et le dépose en `dest` (pieds), bouton tenu. */
    async function dragTo(h: Awaited<ReturnType<typeof start>>, i: number, dest: { x: number; y: number }) {
      const place = h.kit().waitingPlaces[i]!;
      const grab = grabPoint(h.kit(), i);
      h.host.input.moveMouse(grab.x, grab.y);
      h.host.input.mouseDown("left");
      await h.tickOnce();
      h.host.input.moveMouse(grab.x + (dest.x - place.x), grab.y + (dest.y - place.y));
      await h.ticks(2);
      h.host.input.mouseUp("left");
      await h.tickOnce();
    }

    describe("boutons carte et « go »", () => {
      it("images fournies par l'épreuve : le kit les dessine selon l'état (grisé, normal, enfoncé) ; goEnabled redessine", async () => {
        const h = await start({
          setup: standing(),
          specOf: (archive) => {
            const images = sheetButtonImages(archive.tbmpImages(1400));
            return { buttons: { map: { images: images.map, hold: 4, onPress: () => true }, go: { images: images.go, hold: 4, onPress: () => true }, depth: 0.5 } };
          },
        });
        const features = h.engine.services.get(FEATURES);
        const drawer = features.features.filter((f) => f.onAfterDraw);
        expect(drawer).toHaveLength(1);
        expect(drawer[0]!.depth).toBe(0.5);
        const paint = (): Uint8Array => {
          const surface = new Surface(640, 480);
          drawer[0]!.onAfterDraw!(drawer[0]!, surface);
          return surface.pixels.slice();
        };
        const region = (pixels: Uint8Array, rect: { left: number; top: number; right: number; bottom: number }): string => {
          const out: number[] = [];
          for (let y = rect.top; y <= rect.bottom; y++) for (let x = rect.left; x <= rect.right; x++) out.push(pixels[y * 640 + x]!);
          return out.join(",");
        };
        const invalidate = vi.spyOn(features, "invalidate");
        const greyed = paint();
        expect(h.kit().buttonState("go")).toBe("disabled");
        h.kit().goEnabled = true;
        expect(invalidate).toHaveBeenCalledTimes(1);
        h.kit().goEnabled = true;
        expect(invalidate).toHaveBeenCalledTimes(1);
        const normal = paint();
        expect(h.kit().buttonState("go")).toBe("normal");
        expect(region(normal, BUTTON_GO)).not.toBe(region(greyed, BUTTON_GO));
        expect(region(normal, BUTTON_MAP)).toBe(region(greyed, BUTTON_MAP));
        // Clic sur la carte : image enfoncée pendant 4 ticks (l'épreuve a traité le clic, pas d'avertissement).
        h.host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
        await h.tickOnce();
        expect(h.kit().pressed).toBe("map");
        expect(h.kit().buttonState("map")).toBe("down");
        expect(region(paint(), BUTTON_MAP)).not.toBe(region(normal, BUTTON_MAP));
        await h.ticks(5);
        expect(h.kit().pressed).toBeNull();
        expect(region(paint(), BUTTON_MAP)).toBe(region(normal, BUTTON_MAP));
        expect(h.dialog.isOpen).toBe(false);
      });

      it("sans durée, l'image est enfoncée tant que la souris est tenue sur le bouton (« go » seulement actif, pas pendant un transport)", async () => {
        const h = await start({ setup: hold(), spec: { buttons: { map: { onPress: () => true }, go: {} } } });
        h.host.input.moveMouse(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
        h.host.input.mouseDown("left");
        await h.tickOnce();
        expect(h.kit().pressed).toBeNull();
        h.host.input.mouseUp("left");
        h.kit().goEnabled = true;
        h.host.input.moveMouse(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
        await h.tickOnce();
        expect(h.kit().pressed).toBeNull();
        h.host.input.mouseDown("left");
        await h.tickOnce();
        expect(h.kit().pressed).toBe("go");
        h.host.input.mouseUp("left");
        await h.tickOnce();
        expect(h.kit().pressed).toBeNull();
      });

      it("rappel de pression : vrai garde la main à l'épreuve, faux ou rien laisse l'action par défaut ; « go » grisé n'appelle rien mais prend le clic", async () => {
        const onGo = vi.fn((): boolean | void => undefined);
        const onMap = vi.fn((): boolean | void => true);
        const onPointerDown = vi.fn(() => false);
        const h = await start({ setup: standing(), spec: { buttons: { map: { onPress: onMap }, go: { onPress: onGo } }, onPointerDown } });
        h.host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
        await h.tickOnce();
        expect(onGo).not.toHaveBeenCalled();
        expect(onPointerDown).not.toHaveBeenCalled();
        h.host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
        await h.tickOnce();
        expect(onMap).toHaveBeenCalledWith(h.kit());
        expect(h.dialog.isOpen).toBe(false);
        h.kit().goEnabled = true;
        h.host.click(BUTTON_GO.left + 5, BUTTON_GO.top + 5);
        await h.tickOnce();
        expect(onGo).toHaveBeenCalledTimes(1);
        expect(h.kit().departing).toBe(true);
      });

      it("rectangle propre à l'épreuve ; un clic hors des boutons passe à onPointerDown", async () => {
        const rect = { left: 10, top: 10, right: 49, bottom: 47 };
        const onMap = vi.fn(() => true);
        const onPointerDown = vi.fn(() => true);
        const h = await start({ setup: standing(), spec: { buttons: { map: { rect, onPress: onMap } }, onPointerDown } });
        h.host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
        await h.tickOnce();
        expect(onMap).not.toHaveBeenCalled();
        expect(onPointerDown).toHaveBeenCalledTimes(1);
        h.host.click(20, 20);
        await h.tickOnce();
        expect(onMap).toHaveBeenCalledTimes(1);
      });
    });

    describe("crochet de pointeur", () => {
      it("reçoit chaque appui et relâchement avant le kit ; vrai sur un appui le prend (ni bouton ni prise)", async () => {
        const events: PointerInfo[] = [];
        let take = false;
        const onPointerDown = vi.fn(() => false);
        const h = await start({ setup: hold(), spec: { onPointer: (e) => (events.push(e), take && e.down), onPointerDown } });
        const grab = grabPoint(h.kit(), 0);
        h.host.input.moveMouse(grab.x, grab.y);
        h.host.input.mouseDown("left");
        await h.tickOnce();
        h.host.input.mouseUp("left");
        await h.tickOnce();
        expect(events.map((e) => e.down)).toEqual([true, false]);
        expect(events[0]).toMatchObject({ x: grab.x, y: grab.y, button: "left" });
        expect(onPointerDown).toHaveBeenCalledTimes(1);
        // Un appui pris par l'épreuve n'est ni un clic de bouton ni une prise.
        take = true;
        events.length = 0;
        h.host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
        await h.tickOnce();
        expect(h.dialog.isOpen).toBe(false);
        const before = h.kit().carrying;
        h.host.input.moveMouse(grab.x, grab.y);
        h.host.input.mouseDown("left");
        await h.tickOnce();
        expect(h.kit().carrying).toBe(before);
        expect(onPointerDown).toHaveBeenCalledTimes(1);
        expect(events.filter((e) => e.down)).toHaveLength(2);
      });

      it("est encore appelé quand le kit est suspendu, mais plus une fois l'épreuve finie ni pendant un dialogue", async () => {
        const down = vi.fn();
        const h = await start({ setup: hold(), spec: { onPointer: (e) => void (e.down && down()) } });
        h.kit().suspend();
        const grab = grabPoint(h.kit(), 0);
        h.host.input.moveMouse(grab.x, grab.y);
        h.host.input.mouseDown("left");
        await h.tickOnce();
        h.host.input.mouseUp("left");
        expect(down).toHaveBeenCalledTimes(1);
        expect(h.kit().carrying).toBeNull();
        h.kit().resume();
        h.kit().finish("success");
        h.host.click(300, 300);
        await h.ticks(2);
        expect(down).toHaveBeenCalledTimes(1);
      });
    });

    describe("dépôt non accepté (onDropOutside)", () => {
      it("renvoie une position : le Zoombini y est posé d'un coup, sa place d'origine reste libre, onReturn n'est pas appelé", async () => {
        const onReturn = vi.fn();
        const seen: DropInfo[] = [];
        const h = await start({ size: 6, setup: hold(), spec: { onReturn, onDropOutside: (drop) => (seen.push(drop), { at: drop.position }) } });
        const member = h.kit().members[0]!;
        const place = h.kit().waitingPlaces[0]!;
        await dragTo(h, 0, { x: 300, y: 150 });
        expect(seen).toHaveLength(1);
        expect([seen[0]!.member === member, seen[0]!.target, seen[0]!.from === place]).toEqual([true, null, true]);
        expect(onReturn).not.toHaveBeenCalled();
        expect(member.snoid.position).toEqual({ x: 300, y: 150 });
        expect(member.snoid.feature.depth).toBeCloseTo(1 + 150 / 1000);
        expect(place.owner).toBeNull();
        expect(member.target).toBeNull();
        expect(member.waiting).toBeNull();
        expect(member.walking).toBe(false);
        expect(h.host.cursor).toBe("system");
      });

      it("à pied : la marche est celle du kit (non comptée), le Zoombini garde sa profondeur de transport puis prend celle de l'arrivée ; une place d'attente devient la sienne", async () => {
        const dest = { x: 330, y: 200 };
        let spot: DropTarget | undefined;
        const h = await start({ size: 6, setup: hold(), spec: { onDropOutside: () => ({ at: dest, walk: true, place: spot }) } });
        const kit = h.kit();
        const member = kit.members[0]!;
        spot = h.out.free[0]!;
        await dragTo(h, 0, { x: 300, y: 150 });
        expect(member.walking).toBe(true);
        expect(kit.walking).toBe(0);
        expect(member.target === spot && member.waiting === spot && spot.owner === member).toBe(true);
        expect(member.snoid.feature.depth).toBeCloseTo(1 + ROW_Y / 1000);
        await h.ticks(2);
        expect(member.snoid.walking).toBe(true);
        for (let i = 0; i < 600 && member.walking; i++) await h.tickOnce();
        expect(member.walking).toBe(false);
        expect(member.snoid.position).toEqual(dest);
        expect(member.snoid.feature.depth).toBeCloseTo(1 + dest.y / 1000);
        expect(kit.arrived).toBe(0);
      });

      it("est aussi appelé quand decide refuse ou quand le Zoombini est reposé sur sa place ; rien renvoyé : retour par défaut puis onReturn", async () => {
        const onReturn = vi.fn();
        const onDropOutside = vi.fn((_drop: DropInfo): undefined => undefined);
        const h = await start({ size: 6, setup: hold(), spec: { decide: () => false, onReturn, onDropOutside } });
        const member = h.kit().members[0]!;
        const place = h.kit().waitingPlaces[0]!;
        await dragTo(h, 0, h.out.free[1]!);
        expect(onDropOutside).toHaveBeenCalledTimes(1);
        expect(onDropOutside.mock.calls[0]![0].target === h.out.free[1]).toBe(true);
        expect(onReturn).toHaveBeenCalledTimes(1);
        expect(member.snoid.position).toEqual({ x: place.x, y: place.y });
        expect(place.owner === member).toBe(true);
        await h.ticks(2);
        await dragTo(h, 0, place);
        expect(onDropOutside).toHaveBeenCalledTimes(2);
        expect(onDropOutside.mock.calls[1]![0].target === place).toBe(true);
        expect(onReturn).toHaveBeenCalledTimes(2);
        expect(place.owner === member).toBe(true);
      });

      it("n'est pas appelé pour un dépôt accepté", async () => {
        const onDropOutside = vi.fn((_drop: DropInfo): undefined => undefined);
        const onDrop = vi.fn();
        const h = await start({ size: 6, setup: hold(), spec: { onDropOutside, onDrop } });
        await dragTo(h, 0, h.out.free[1]!);
        expect(onDrop).toHaveBeenCalledTimes(1);
        expect(onDropOutside).not.toHaveBeenCalled();
      });
    });

    describe("marches lancées par l'épreuve (walk)", () => {
      it("tient les compteurs : le membre est en marche, walking monte puis redescend et arrived monte à l'arrivée", async () => {
        const h = await start({ size: 4, setup: standing() });
        const kit = h.kit();
        const member = kit.members[0]!;
        const arrive = vi.fn();
        const dest = { x: member.snoid.position.x + 60, y: member.snoid.position.y };
        kit.walk(member, dest, arrive);
        expect([member.walking, kit.walking, kit.arrived]).toEqual([true, 1, 0]);
        // Un membre en marche ne se prend pas.
        const grab = grabPoint(kit, 0);
        h.host.click(grab.x, grab.y);
        await h.tickOnce();
        expect(kit.carrying).toBeNull();
        for (let i = 0; i < 400 && member.walking; i++) await h.tickOnce();
        expect([member.walking, kit.walking, kit.arrived]).toEqual([false, 0, 1]);
        expect(arrive).toHaveBeenCalledWith(member);
        expect(member.snoid.position).toEqual(dest);
        expect(member.snoid.onArrive).toBeUndefined();
      });

      it("non comptée : ni walking ni arrived", async () => {
        const h = await start({ size: 4, setup: standing() });
        const kit = h.kit();
        const member = kit.members[0]!;
        kit.walk(member, { x: member.snoid.position.x + 40, y: member.snoid.position.y }, undefined, { counted: false });
        expect([member.walking, kit.walking]).toEqual([true, 0]);
        for (let i = 0; i < 400 && member.walking; i++) await h.tickOnce();
        expect([kit.walking, kit.arrived]).toEqual([0, 0]);
      });

      it("saisissable : reprendre le marcheur annule sa marche (pas de rappel d'arrivée) et rend le compteur", async () => {
        // Tant que des marcheurs comptent, la prise par défaut est refusée : l'épreuve autorise la prise.
        const h = await start({ size: 4, setup: hold(), spec: { canPick: () => true } });
        const kit = h.kit();
        const member = kit.members[0]!;
        const arrive = vi.fn();
        kit.walk(member, { x: member.snoid.position.x, y: member.snoid.position.y - 120 }, arrive, { pickable: true });
        expect([member.walking, kit.walking]).toEqual([false, 1]);
        await h.ticks(3);
        const grab = grabPoint(kit, 0);
        h.host.input.moveMouse(grab.x, grab.y);
        h.host.input.mouseDown("left");
        await h.tickOnce();
        expect(kit.carrying === member).toBe(true);
        expect(kit.walking).toBe(0);
        expect(kit.arrived).toBe(0);
        expect(member.snoid.onArrive).toBeUndefined();
        h.host.input.mouseUp("left");
        await h.ticks(30);
        expect(arrive).not.toHaveBeenCalled();
      });

      it("une nouvelle marche remplace la précédente sans compter deux fois", async () => {
        const h = await start({ size: 4, setup: standing() });
        const kit = h.kit();
        const member = kit.members[0]!;
        const first = vi.fn();
        const second = vi.fn();
        kit.walk(member, { x: member.snoid.position.x + 100, y: member.snoid.position.y }, first);
        kit.walk(member, { x: member.snoid.position.x + 20, y: member.snoid.position.y }, second);
        expect(kit.walking).toBe(1);
        for (let i = 0; i < 400 && member.walking; i++) await h.tickOnce();
        expect(first).not.toHaveBeenCalled();
        expect(second).toHaveBeenCalledTimes(1);
        expect([kit.walking, kit.arrived]).toEqual([0, 1]);
      });
    });

    describe("suspension du kit", () => {
      it("suspend() gèle prises et boutons (left vrai), resume() les rend ; après finish() resume est sans effet", async () => {
        const h = await start({ setup: hold(), spec: { buttons: { map: { onPress: () => true } } } });
        const kit = h.kit();
        const onMapPress = vi.spyOn(kit, "pressMap");
        kit.suspend();
        expect(kit.left).toBe(true);
        const grab = grabPoint(kit, 0);
        h.host.input.moveMouse(grab.x, grab.y);
        h.host.input.mouseDown("left");
        await h.tickOnce();
        h.host.input.mouseUp("left");
        expect(kit.carrying).toBeNull();
        expect(kit.pick(grab.x, grab.y)).toBe(false);
        h.host.click(BUTTON_MAP.left + 5, BUTTON_MAP.top + 5);
        await h.tickOnce();
        expect(kit.pressed).toBeNull();
        kit.resume();
        expect(kit.left).toBe(false);
        h.host.input.moveMouse(grab.x, grab.y);
        h.host.input.mouseDown("left");
        await h.tickOnce();
        expect(kit.carrying).not.toBeNull();
        h.host.input.mouseUp("left");
        await h.tickOnce();
        kit.finish("success");
        kit.resume();
        expect(kit.left).toBe(true);
        expect(onMapPress).not.toHaveBeenCalled();
      });
    });

    describe("départ par « go » explicite", () => {
      it("saveAll marque tout le groupe sauvé avant le départ ; sans lui le kit ne marque personne", async () => {
        const h = await start({ size: 6, setup: standing() });
        const kit = h.kit();
        kit.markAll(false);
        kit.goEnabled = true;
        expect(kit.pressGo()).toBe(true);
        expect(kit.members.some((m) => m.zoombini.present)).toBe(false);
        const other = await start({ size: 6, setup: standing() });
        other.kit().markAll(false);
        other.kit().goEnabled = true;
        expect(other.kit().pressGo({ saveAll: true })).toBe(true);
        expect(other.kit().members.every((m) => m.zoombini.present)).toBe(true);
      });

      it("depart : le départ de l'épreuve remplace la marche de sortie ; le kit attend le son (ou un clic) puis finish", async () => {
        const depart = vi.fn();
        const h = await start({ size: 6, setup: standing() });
        const kit = h.kit();
        kit.goEnabled = true;
        expect(kit.pressGo({ saveAll: true, depart })).toBe(true);
        expect(depart).toHaveBeenCalledTimes(1);
        expect(kit.departing).toBe(true);
        expect(kit.members.some((m) => m.snoid.walking)).toBe(false);
        for (let i = 0; i < 400 && !h.zoombinis.lastChange; i++) await h.tickOnce();
        expect(h.zoombinis.lastChange).toMatchObject({ screen: S.xfer });
        expect(h.zoombinis.game.group.members).toHaveLength(6);
        expect(h.engine.error).toBeNull();
      });
    });

    describe("son", () => {
      it("soundIdle() dit si aucun son n'est en file ni en cours", async () => {
        const h = await start({ setup: standing(), spec: { introVoice: 20071 } });
        await h.ticks(2);
        expect(h.kit().soundIdle()).toBe(true);
        h.kit().replayIntro();
        expect(h.kit().soundIdle()).toBe(false);
        await h.ticks(3);
        expect(h.kit().soundIdle()).toBe(false);
        h.sound.stopEffects();
        expect(h.kit().soundIdle()).toBe(true);
      });
    });
  });

  describe("transport d'un objet de l'épreuve (carryObject, 1168:58c7)", () => {
    /** Une épreuve dont l'appui sur l'écran prend un « objet » : un dessin (feature) que le kit fait suivre au pointeur. */
    async function objectStart(options: { magnetic?: boolean; decide?: ObjectCarrySpec["decide"]; targets?: boolean } = {}) {
      const holder: { kit: PuzzleKit | null; feature: Feature | null; moves: Point[]; spec: ObjectCarrySpec | null } = { kit: null, feature: null, moves: [], spec: null };
      const onDrop = vi.fn();
      const onReturn = vi.fn();
      const onHover = vi.fn();
      const h = await start({
        size: 4,
        setup: standing((game) => (game.options.magneticMouse = options.magnetic ?? false)),
        spec: {
          canPick: () => false,
          onPointer: (event) => {
            if (!event.down || !holder.kit || holder.kit.left || holder.kit.carryingObject) return false;
            return holder.kit.carryObject(holder.spec!);
          },
        },
      });
      holder.kit = h.kit();
      holder.feature = h.engine.services.get(FEATURES).create({ script: 0, delay: 0, depth: 0.5, flags: 0 });
      const target = createTarget({ x: 300, y: 200 });
      holder.spec = {
        origin: { x: 50, y: 60 },
        feature: holder.feature,
        targets: options.targets === false ? undefined : [target],
        onMove: (at) => holder.moves.push(at),
        onHover,
        decide: options.decide,
        onDrop,
        onReturn,
      };
      return { ...h, holder, target, onDrop, onReturn, onHover };
    }

    it("le kit porte l'objet : profondeur de transport, curseur masqué, suit le pointeur borné, survol de cible ; relâcher dépose sur la cible", async () => {
      const h = await objectStart();
      h.host.input.moveMouse(100, 100);
      h.host.input.mouseDown("left");
      await h.tickOnce();
      expect(h.kit().carryingObject).toBe(true);
      expect(h.kit().carrying).toBeNull();
      expect(h.holder.feature!.depth).toBe(CARRY_DEPTH);
      expect(h.host.cursor).toBe(HIDDEN_CURSOR);
      // Un second transport est refusé tant que le premier dure.
      expect(h.kit().carryObject({ origin: { x: 0, y: 0 } })).toBe(false);
      h.host.input.moveMouse(305, 195);
      await h.ticks(2);
      expect(h.holder.moves.at(-1)).toEqual({ x: 305, y: 195 });
      expect(h.onHover.mock.lastCall![0] === h.target).toBe(true);
      h.host.input.moveMouse(5000, -40);
      await h.ticks(2);
      expect(h.holder.moves.at(-1)).toEqual({ x: 639, y: 0 });
      expect(h.onHover.mock.lastCall![0]).toBeNull();
      h.host.input.moveMouse(300, 200);
      await h.ticks(2);
      h.host.input.mouseUp("left");
      await h.tickOnce();
      expect(h.kit().carryingObject).toBe(false);
      expect(h.onReturn).not.toHaveBeenCalled();
      expect(h.onDrop).toHaveBeenCalledTimes(1);
      const drop: ObjectDrop = h.onDrop.mock.calls[0]![0];
      expect([drop.target === h.target, drop.from, drop.position, drop.origin]).toEqual([true, null, { x: 300, y: 200 }, { x: 50, y: 60 }]);
      expect(h.host.cursor).toBe("system");
      expect(h.engine.error).toBeNull();
    });

    it("hors de toute cible, ou refusé par decide : onReturn ; decide reçoit la cible prise", async () => {
      const refused = vi.fn((_drop: ObjectDrop) => false);
      const a = await objectStart({ decide: refused });
      a.host.input.moveMouse(300, 200);
      a.host.input.mouseDown("left");
      await a.ticks(2);
      a.host.input.mouseUp("left");
      await a.tickOnce();
      expect(refused.mock.calls[0]![0].target === a.target).toBe(true);
      expect(a.onReturn).toHaveBeenCalledTimes(1);
      expect(a.onDrop).not.toHaveBeenCalled();
      const b = await objectStart();
      b.host.input.moveMouse(100, 100);
      b.host.input.mouseDown("left");
      await b.ticks(2);
      b.host.input.mouseUp("left");
      await b.tickOnce();
      expect(b.onReturn).toHaveBeenCalledTimes(1);
      expect(b.onReturn.mock.calls[0]![0].target).toBeNull();
    });

    it("souris aimantée : relâcher ne dépose pas, le clic suivant dépose ; « keep » garde l'objet et le clic suivant décide de nouveau", async () => {
      let verdicts: (boolean | "keep")[] = ["keep", true];
      const decide = vi.fn(() => verdicts.shift()!);
      const h = await objectStart({ magnetic: true, decide });
      h.host.input.moveMouse(300, 200);
      h.host.input.mouseDown("left");
      await h.tickOnce();
      h.host.input.mouseUp("left");
      await h.ticks(3);
      expect(h.kit().carryingObject).toBe(true);
      expect(decide).not.toHaveBeenCalled();
      h.host.click(300, 200);
      await h.ticks(2);
      expect(decide).toHaveBeenCalledTimes(1);
      expect(h.kit().carryingObject).toBe(true);
      expect(h.host.cursor).toBe(HIDDEN_CURSOR);
      // Un clic du bouton droit ne décide pas.
      h.host.click(300, 200, "right");
      await h.ticks(2);
      expect(decide).toHaveBeenCalledTimes(1);
      h.host.click(300, 200);
      await h.ticks(2);
      expect(decide).toHaveBeenCalledTimes(2);
      expect(h.kit().carryingObject).toBe(false);
      expect(h.onDrop).toHaveBeenCalledTimes(1);
      verdicts = [];
    });

    it("auto-aimantation et curseur : un appui court devient collé ; cursor non masqué si l'option est coupée ; cancelObjectCarry rend le curseur sans rien décider", async () => {
      const h = await objectStart();
      h.holder.spec!.hideCursor = false;
      h.zoombinis.game.options.autoMagnet = true;
      h.zoombinis.game.unknown02 = 20;
      h.host.input.moveMouse(300, 200);
      h.host.input.mouseDown("left");
      await h.tickOnce();
      h.host.input.mouseUp("left");
      await h.ticks(3);
      expect(h.kit().carryingObject).toBe(true);
      expect(h.host.cursors).not.toContain(HIDDEN_CURSOR);
      h.kit().cancelObjectCarry();
      expect(h.kit().carryingObject).toBe(false);
      await h.ticks(2);
      expect(h.onDrop).not.toHaveBeenCalled();
      expect(h.onReturn).not.toHaveBeenCalled();
      const g = await objectStart();
      g.host.input.moveMouse(300, 200);
      g.host.input.mouseDown("left");
      await g.tickOnce();
      expect(g.host.cursor).toBe(HIDDEN_CURSOR);
      g.kit().cancelObjectCarry();
      await g.ticks(2);
      expect(g.host.cursor).toBe("system");
    });

    it("endCarry dépose l'objet là où il est ; le kit gelé ou en sortie refuse le transport", async () => {
      const h = await objectStart();
      h.host.input.moveMouse(300, 200);
      h.host.input.mouseDown("left");
      await h.ticks(2);
      h.kit().endCarry();
      await h.ticks(2);
      expect(h.onDrop).toHaveBeenCalledTimes(1);
      h.host.input.mouseUp("left");
      h.kit().suspend();
      expect(h.kit().carryObject({ origin: { x: 0, y: 0 } })).toBe(false);
    });
  });

  describe("arrivée « tous debout » (ArrivalSpec.standing)", () => {
    it("tout le groupe est debout sans entrée à pied, hors reprise et sans « moins d'action » ; la reprise est consommée", async () => {
      const h = await start({ size: 8, setup: (game, session) => ((game.options.lessAction = false), (session.resuming = true)), arrival: { startDelay: 30, step: 45, standing: true } });
      expect(h.kit().walking).toBe(0);
      expect(h.kit().members.every((m) => !m.walking && m.snoid.position.x > 0)).toBe(true);
      expect(h.zoombinis.session.resuming).toBe(false);
      const plain = await start({ size: 8, setup: (game) => (game.options.lessAction = false) });
      expect(plain.kit().walking).toBe(2);
      const flat = await start({ size: 8, setup: (game) => (game.options.lessAction = false), arrival: { startDelay: 30, step: 45, standing: true } });
      expect(flat.kit().walking).toBe(0);
      expect(flat.kit().waitingPlaces.slice(0, 8).every((p) => p.owner !== null)).toBe(true);
    });
  });

  describe("départ paramétrable de « go » (GoOptions.sound / end)", () => {
    it("sound « later » : aucun son tout de suite, playGoSound() le joue sans couper les effets ; end « depart » : le kit est gelé et n'attend pas le son", async () => {
      const h = await start({ size: 6, setup: standing(), spec: { buttons: { go: {} } } });
      const queue = vi.spyOn(h.sound, "queue");
      const stop = vi.spyOn(h.sound, "stopEffects");
      const kit = h.kit();
      kit.goEnabled = true;
      const depart = vi.fn();
      expect(kit.pressGo({ sound: "later", end: "depart", depart })).toBe(true);
      expect(depart).toHaveBeenCalledTimes(1);
      expect(kit.departing).toBe(true);
      expect(kit.left).toBe(true);
      expect(queue).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
      // Pas de marche de sortie du kit ni de fin au son : l'épreuve mène le départ.
      await h.ticks(60);
      expect(kit.members.some((m) => m.snoid.walking)).toBe(false);
      expect(h.zoombinis.lastChange).toBeNull();
      kit.playGoSound();
      expect(queue).toHaveBeenCalledWith(SOUND_GO);
      expect(h.sound.isPlaying(SOUND_GO)).toBe(true);
      await h.ticks(200);
      expect(h.zoombinis.lastChange).toBeNull();
      expect(kit.finishing).toBe(false);
      kit.finish("success");
      expect(kit.finishing).toBe(true);
      await h.ticks(2);
      expect(h.zoombinis.lastChange).toMatchObject({ screen: S.xfer });
    });

    it("end « depart » : un clic pendant le départ quitte tout de suite", async () => {
      const h = await start({ size: 6, setup: standing(), spec: { buttons: { go: {} } } });
      h.kit().goEnabled = true;
      h.kit().pressGo({ sound: "later", end: "depart", depart: () => undefined });
      await h.ticks(3);
      expect(h.zoombinis.lastChange).toBeNull();
      h.host.click(100, 100);
      await h.ticks(2);
      expect(h.zoombinis.lastChange).toMatchObject({ screen: S.xfer });
      expect(h.kit().finishing).toBe(true);
    });

    it("par défaut (sound « now », end « sound ») : 996 tout de suite, effets coupés, fin au son", async () => {
      const h = await start({ size: 6, setup: standing(), spec: { buttons: { go: {} } } });
      const queue = vi.spyOn(h.sound, "queue");
      const stop = vi.spyOn(h.sound, "stopEffects");
      h.kit().goEnabled = true;
      h.kit().pressGo({ depart: () => undefined });
      expect(stop).toHaveBeenCalled();
      expect(queue).toHaveBeenCalledWith(SOUND_GO);
      expect(h.kit().left).toBe(false);
    });
  });

  describe("son par identifiant (isPlaying)", () => {
    it("le kit expose ZoombinisSound.isPlaying", async () => {
      const h = await start({ setup: standing(), spec: { introVoice: 20071 } });
      await h.ticks(2);
      expect(h.kit().isPlaying(20071)).toBe(false);
      h.kit().replayIntro();
      expect(h.kit().isPlaying(20071)).toBe(true);
      expect(h.kit().isPlaying(20072)).toBe(false);
      h.sound.stopEffects();
      expect(h.kit().isPlaying(20071)).toBe(false);
    });
  });
});
