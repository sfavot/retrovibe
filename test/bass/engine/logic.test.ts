import { describe, expect, it } from "vitest";
import { CompactField as F } from "../../../src/games/bass/data/compact-fields";
import { FADE_STEPS, SCROLL_STEPS } from "../../../src/games/bass/engine/effects";
import { Cpt, F_MODULE_0, L, Var } from "../../../src/games/bass/engine/ids";
import { mcodeNumber } from "../../../src/games/bass/engine/mcodes/index";
import { Op } from "../../../src/games/bass/engine/script";
import { NullScreen } from "../../../src/games/bass/engine/services";
import { TraceRecorder } from "../../../src/games/bass/engine/trace";
import { BassEngine, type BassEngineOptions } from "../../../src/games/bass/engine/game";
import { TestHost } from "../../../src/games/bass/engine/host";
import { skyCpt, skyDisk } from "../data/helpers";
import { hasOriginalFiles, makeEngine } from "./helpers";

/** Module de scripts 15 (absent du jeu) fabriqué pour les tests : un script par liste de mots. */
function module15(...scripts: number[][]): Uint8Array {
  const words: number[] = [];
  let pos = scripts.length;
  for (const s of scripts) {
    words.push(pos);
    pos += s.length;
  }
  for (const s of scripts) words.push(...s);
  const bytes = new Uint8Array(words.length * 2);
  words.forEach((w, i) => {
    bytes[i * 2] = w & 0xff;
    bytes[i * 2 + 1] = w >> 8;
  });
  return bytes;
}

const call = (name: string, argc: number) => [Op.CALL_MCODE, argc, mcodeNumber(name) * 4];
const push = (n: number) => [Op.PUSH_NUMBER, n];
/** Fin des scripts de test : Foster passe sans logique (`fnIdle`) et le script se suspend (`fnQuit`). */
const END = [...call("fn_idle", 0), ...call("fn_quit", 0)];
/** Marque « le reste du script a tourné » : variable 600 = 1. */
const MARK = [...push(1), Op.POP_VAR, 600 * 4];

class SpyScreen extends NullScreen {
  readonly calls: string[] = [];
  override fadeDown(scroll: number): void {
    this.calls.push(`fadeDown ${scroll}`);
  }
  override drawNewScreen(): void {
    this.calls.push("drawNewScreen");
  }
  override fadeUp(palette: number, scroll: number): void {
    this.calls.push(`fadeUp ${palette} ${scroll}`);
  }
}

/** Moteur sur les vrais fichiers, avec en plus le module de scripts 15 fabriqué par le test. */
function engineWith(mod: Uint8Array, options: Partial<BassEngineOptions> = {}): BassEngine {
  const disk = skyDisk();
  return new BassEngine({
    host: new TestHost(),
    ...options,
    data: {
      disk: { has: (id) => id === F_MODULE_0 + 15 || disk.has(id), load: (id) => (id === F_MODULE_0 + 15 ? mod : disk.load(id)) },
      cpt: skyCpt(),
    },
  });
}

describe.skipIf(!hasOriginalFiles)("tour de logique reprenable (effets bloquants au milieu de Logic::engine)", () => {
  it("fnFadeDown : la logique s'arrête après le compact qui l'a demandé, 32 pas de 20 ms, puis reprend au compact suivant", () => {
    const mod = module15([...push(0), ...call("fn_fade_down", 1), ...MARK, ...END], [...push(4316), ...push(0), ...call("fn_draw_screen", 2), ...MARK, ...END], [...push(4316), ...push(123), ...call("fn_draw_screen", 2), ...MARK, ...END]);
    const screen = new SpyScreen();
    const stamped: string[] = [];
    const engine: BassEngine = engineWith(mod, {
      screen,
      trace: new TraceRecorder(3, (line) => stamped.push(`${engine.timeMs} ${line}`)),
    });
    engine.startAfterIntro();
    engine.runCycles(2);

    const runScript = (n: number) => {
      const foster = engine.compacts.require(Cpt.FOSTER);
      foster[F.logic] = L.SCRIPT;
      foster[F.mode] = 0;
      foster[F.baseSub] = 0xf000 | n;
      foster[F.baseSub_off] = 0;
      engine.vars[600] = 0;
      stamped.length = 0;
      screen.calls.length = 0;
      engine.runCycles(1);
      // Lignes du tour : CY, LG Foster, MC…, LG du compact suivant.
      const lg = stamped.filter((l) => l.includes(" LG "));
      const fosterAt = Number(lg.find((l) => l.includes("id=3 "))!.split(" ")[0]);
      const nextAt = Number(lg[lg.findIndex((l) => l.includes("id=3 ")) + 1]!.split(" ")[0]);
      return { fosterAt, nextAt, mark: engine.vars[600] };
    };

    const fade = runScript(0);
    expect(fade.nextAt - fade.fosterAt).toBe(FADE_STEPS * 20);
    expect(fade.mark).toBe(1); // le reste du script de Foster a tourné avant l'effet
    expect(screen.calls).toEqual(["fadeDown 0"]);

    const draw = runScript(1);
    expect(draw.nextAt - draw.fosterAt).toBe(2 * FADE_STEPS * 20);
    expect(screen.calls).toEqual(["fadeDown 0", "drawNewScreen", "fadeUp 4316 0"]);
    expect(engine.system.currentPalette).toBe(4316);

    const scroll = runScript(2);
    expect(scroll.nextAt - scroll.fosterAt).toBe(SCROLL_STEPS * 20); // défilement : pas de fondu au noir
    expect(screen.calls).toEqual(["fadeDown 123", "drawNewScreen", "fadeUp 4316 123"]);
  });

  it("après un effet, le tour suivant part tout de suite (go : delayCount remis à l'heure), puis toutes les 80 ms", () => {
    const mod = module15([...push(0), ...call("fn_fade_down", 1), ...END]);
    const cycles: number[] = [];
    const engine: BassEngine = engineWith(mod, { trace: { cycle: () => cycles.push(engine.timeMs) } });
    engine.startAfterIntro();
    engine.runCycles(3);
    expect(cycles).toEqual([0, 80, 160]);
    const foster = engine.compacts.require(Cpt.FOSTER);
    foster[F.logic] = L.SCRIPT;
    foster[F.mode] = 0;
    foster[F.baseSub] = 0xf000;
    foster[F.baseSub_off] = 0;
    engine.runCycles(3);
    // Tour 4 à 240 ms : fondu de 640 ms, le tour 5 part à 880 ms, le 6 à 960 ms.
    expect(cycles.slice(3)).toEqual([240, 880, 960]);
    expect(engine.blocked).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("logiques (Logic::engine, types de logique)", () => {
  /** Foster exécute le script `n` du module 15 à partir du tour suivant. */
  function startFoster(engine: BassEngine, n: number): Uint16Array {
    const foster = engine.compacts.require(Cpt.FOSTER);
    foster[F.logic] = L.SCRIPT;
    foster[F.mode] = 0;
    foster[F.baseSub] = 0xf000 | n;
    foster[F.baseSub_off] = 0;
    return foster;
  }

  it("L_PAUSE décompte flag puis reprend le script là où il s'était suspendu", () => {
    const engine = engineWith(module15([...push(3), ...call("fn_pause", 1), ...MARK, ...END]));
    engine.startAfterIntro();
    engine.runCycles(2);
    const foster = startFoster(engine, 0);
    engine.runCycles(1); // fnPause(3) : L_PAUSE, flag 3
    expect([foster[F.logic], foster[F.flag]]).toEqual([L.PAUSE, 3]);
    engine.runCycles(2);
    expect([foster[F.logic], foster[F.flag], engine.vars[600]]).toEqual([L.PAUSE, 1, 0]);
    engine.runCycles(1);
    expect([foster[F.logic], engine.vars[600]]).toEqual([0, 1]);
  });

  it("L_WAIT_SYNC attend un sync ; le sync reçu est effacé à la fin du tour du compact", () => {
    const engine = engineWith(module15([...call("fn_await_sync", 0), ...MARK, ...END]));
    engine.startAfterIntro();
    engine.runCycles(2);
    const foster = startFoster(engine, 0);
    engine.runCycles(2);
    expect([foster[F.logic], engine.vars[600]]).toEqual([L.WAIT_SYNC, 0]);
    foster[F.sync] = 5;
    engine.runCycles(1);
    expect([foster[F.logic], foster[F.sync], engine.vars[600]]).toEqual([0, 0, 1]);
  });

  it("un compact sans le bit de logique (64) n'est pas traité ; CUR_ID suit quand même toute la liste", () => {
    const lg: string[] = [];
    const { engine } = makeEngine({ trace: new TraceRecorder(3, (l) => lg.push(l)) });
    engine.startAfterIntro();
    engine.runCycles(1);
    const lastId = engine.vars[Var.CUR_ID];
    lg.length = 0;
    engine.compacts.require(4100)[F.status] &= ~64;
    engine.runCycles(1);
    expect(lg.some((l) => l.includes("LG") && l.includes("id=4100 "))).toBe(false);
    expect(engine.vars[Var.CUR_ID]).toBe(lastId);
  });
});
