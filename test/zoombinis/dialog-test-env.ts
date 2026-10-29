import { Surface } from "../../src/engine/mohawk/graphics/surface";
import { installDialog } from "../../src/games/zoombinis/engine/dialog";
import { createZoombinisEngine } from "../../src/games/zoombinis/engine/engine";
import { FEATURES } from "../../src/games/zoombinis/engine/features";
import { type Scene, ScreenId } from "../../src/games/zoombinis/engine/scene";
import { GRAPHICS, installServices, SCREEN_HEIGHT, SCREEN_WIDTH } from "../../src/games/zoombinis/engine/services";
import { installShortcuts } from "../../src/games/zoombinis/engine/shortcuts";
import { ZOOMBINIS_TEXT } from "../../src/games/zoombinis/engine/text";
import { runFor, TestHost } from "./engine-test-host";

/** Couleur du fond de l'écran factice. */
export const BACKGROUND = 20;

export interface FakeScreen {
  clicks: number;
  keys: number;
  ticks: number;
  entered: number;
}

/** Écran factice sur un écran de 1 à 18 : fond uni (posé comme fond des features), compte ses clics, touches et ticks ; `consume` : touches qu'il prend. */
export function fakeScene(log: FakeScreen, consume: ReadonlySet<string> = new Set()): () => Scene {
  return () => ({
    enter(ctx) {
      log.entered++;
      const features = ctx.services.get(FEATURES);
      const background = new Surface(SCREEN_WIDTH, SCREEN_HEIGHT);
      background.fill(BACKGROUND);
      features.setBackground(background);
      ctx.services.get(GRAPHICS).screen.fill(BACKGROUND);
      ctx.requestPresent();
    },
    leave(ctx) {
      ctx.services.get(FEATURES).clear();
    },
    tick(ctx) {
      log.ticks++;
      log.clicks += ctx.input.buttonEvents.length;
    },
    key(event) {
      log.keys++;
      return consume.has(event.code);
    },
  });
}

export async function startDialogs(consume?: ReadonlySet<string>) {
  const host = new TestHost();
  host.audio.unlock();
  const engine = createZoombinisEngine(host, { seed: 1 });
  const services = await installServices(engine);
  const dialogs = await installDialog(engine);
  installShortcuts(engine);
  const log: FakeScreen = { clicks: 0, keys: 0, ticks: 0, entered: 0 };
  for (const id of [ScreenId.map, ScreenId.picker]) engine.register(id, fakeScene(log, consume));
  engine.start(ScreenId.map);
  services.game.session.screen = ScreenId.map;
  await runFor(engine, host, 100);
  const text = engine.ctx.services.get(ZOOMBINIS_TEXT);
  /** Texte de `STRL` (index 1-based). */
  const str = (list: number, index: number): string => text.strings.get(list, index) ?? "";
  const run = (ms: number) => runFor(engine, host, ms);
  const press = (code: string, key: string, mods: { ctrl?: boolean } = {}) => host.press(code, { key, ctrl: mods.ctrl ?? false });
  const ctrl = (letter: string) => host.press(`Key${letter.toUpperCase()}`, { key: letter, ctrl: true });
  const screen = () => engine.ctx.services.get(GRAPHICS).screen;
  const type = async (text: string) => {
    for (const c of text) {
      host.press(`Key${c.toUpperCase()}`, { key: c });
      await run(40);
    }
  };
  return { host, engine, services, dialogs, log, zb: services.game, str, run, press, ctrl, screen, type };
}

export type DialogEnv = Awaited<ReturnType<typeof startDialogs>>;
