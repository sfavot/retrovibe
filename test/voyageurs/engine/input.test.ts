import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { VoyageursEngine } from "../../../src/games/voyageurs/engine/game";
import type { TestHost, VoyageursInput } from "../../../src/games/voyageurs/engine/host";
import { objectUnderCursor, relEntryForObject } from "../../../src/games/voyageurs/engine/input";
import { type FrameView, NullRenderer } from "../../../src/games/voyageurs/engine/services";
import { OverlayType, VAR_MOUSE_X_POS, VAR_MOUSE_Y_POS } from "../../../src/games/voyageurs/engine/state";
import { FAILURE_MESSAGES, VERBS } from "../../../src/games/voyageurs/engine/texts";
import { hasOriginalFiles, parseBenchInputs, replay } from "./helpers";

const intro = () => parseBenchInputs(readFileSync(fileURLToPath(new URL("../fixtures/intro-first-scene.inputs", import.meta.url)), "utf8")).filter((i) => i.tick < 460);

class SpyRenderer extends NullRenderer {
  frames: { failures: number[]; menus: string[] }[] = [];
  override drawFrame(view: FrameView): void {
    this.frames.push({
      failures: view.state.overlays.filter((o) => o.type === OverlayType.Failure).map((o) => o.failure!),
      menus: view.menus.map((m) => `${m.kind}:${m.selection}`),
    });
  }
}

/** Première scène jouable (tick 470, héros immobile), avec un rendu espion. */
function firstScene(): { engine: VoyageursEngine; host: TestHost; renderer: SpyRenderer } {
  const renderer = new SpyRenderer();
  const { engine, host } = replay(intro(), 470, { renderer });
  return { engine, host, renderer };
}

const click = (x: number, y: number, button: "left" | "right" | "both" = "left"): VoyageursInput[] => [
  { type: "move", x, y },
  { type: "down", button, x, y },
  { type: "up", button, x, y },
];

/** Avance de `n` pas de 10 ms. */
function pump(engine: VoyageursEngine, n: number): void {
  for (let i = 0; i < n; i++) engine.step();
}

describe.skipIf(!hasOriginalFiles)("entrées du joueur dans la première scène", () => {
  let scene: ReturnType<typeof firstScene>;
  beforeAll(() => {
    scene = firstScene();
  });

  it("objet sous le curseur : masque MSK (fenêtre), masque de transparence (héros), ligne du haut non cliquable", () => {
    const { state } = scene.engine;
    const fenetre = state.objects[19]!;
    expect(fenetre.name).toBe("fenetre");
    expect(objectUnderCursor(state, 175, 40)).toBe(19);
    const hero = state.objects[1]!;
    expect(objectUnderCursor(state, hero.x + 8, hero.y)).not.toBe(1);
    expect(objectUnderCursor(state, 5, 5)).toBe(-1);
    expect(relEntryForObject(state, 1, 1, 19, -1)).toBeGreaterThanOrEqual(0);
    expect(relEntryForObject(state, 5, 1, 19, -1)).toBe(-1);
  });

  it("clic gauche dans le vide : cible de marche (globales 249 / 250, x = 0 devient 1)", () => {
    const { engine } = firstScene();
    engine.input(...click(0, 150));
    engine.runTick();
    expect([engine.state.globals[VAR_MOUSE_X_POS], engine.state.globals[VAR_MOUSE_Y_POS]]).toEqual([1, 150]);
  });

  it("verbe au clavier (F2), survol « PRENDRE fenetre », clic : la relation est lancée et la ligne vidée", () => {
    const { engine } = firstScene();
    engine.input({ type: "action", action: "take" });
    engine.runTick();
    expect(engine.state.playerCommand).toBe(1);
    expect(engine.state.commandLine).toBe("PRENDRE");
    engine.input({ type: "move", x: 175, y: 40 });
    engine.runTick();
    expect(engine.state.commandLine).toBe("PRENDRE fenetre");
    engine.input(...click(175, 40));
    engine.runTick();
    expect(engine.state.playerCommand).toBe(-1);
    expect(engine.state.commandBuffer).toBe("");
    expect(engine.state.objectScripts.length + engine.state.relTable[relEntryForObject(engine.state, 1, 1, 19, -1)]!.runCount).toBeGreaterThan(0);
  });

  it("verbe sans relation : message d'échec tiré au hasard parmi les 4 du verbe, puis attente d'un clic", () => {
    const { engine, renderer } = firstScene();
    engine.input({ type: "action", action: "speak" });
    engine.runTick();
    expect(engine.state.commandLine).toBe("PARLER a");
    engine.input(...click(175, 40));
    expect(engine.runTick(300)).toBe(false);
    const failure = renderer.frames.at(-1)!.failures[0]!;
    expect(failure).toBeGreaterThanOrEqual(20);
    expect(failure).toBeLessThan(24);
    expect(FAILURE_MESSAGES[failure]).toBeTruthy();
    expect(engine.modal).toBe(1);
    engine.input(...click(160, 100));
    expect(engine.runTick()).toBe(true);
  });

  it("clic droit : menu des verbes (largeur 70) suivi à la souris ; clic gauche sur PARLER ; clic droit annule", () => {
    const { engine, renderer } = firstScene();
    engine.input(...click(200, 60, "right"));
    pump(engine, 30);
    expect(engine.menus).toHaveLength(1);
    expect(engine.menus[0]).toMatchObject({ kind: "verbs", items: VERBS, x: 200, y: 60, width: 70 });
    expect(engine.modal).toBe(2);
    engine.input({ type: "move", x: 210, y: 64 + 9 * 5 + 3 });
    pump(engine, 5);
    expect(engine.menus[0]!.selection).toBe(5);
    expect(renderer.frames.at(-1)!.menus).toEqual(["verbs:5"]);
    engine.input({ type: "down", button: "left" }, { type: "up", button: "left" });
    engine.runTick();
    expect(engine.state.playerCommand).toBe(5);
    expect(engine.menus).toEqual([]);

    engine.input(...click(300, 190, "right"));
    pump(engine, 30);
    // Menu ramené dans l'écran (X + largeur <= 319, Y + hauteur <= 199).
    expect(engine.menus[0]).toMatchObject({ x: 249, y: 199 - (6 * 9 + 10) });
    engine.input({ type: "down", button: "right" }, { type: "up", button: "right" });
    engine.runTick();
    expect(engine.state.playerCommand).toBe(-1);
  });

  it("UTILISER sans objet porté : la commande est abandonnée ; INVENTAIRE affiche les objets portés jusqu'au clic", () => {
    const { engine } = firstScene();
    engine.input({ type: "action", action: "use" });
    engine.runTick();
    expect(engine.state.playerCommand).toBe(-1);
    const bucket = engine.state.objects[3]!;
    bucket.costume = -2;
    engine.input({ type: "action", action: "inventory" });
    pump(engine, 20);
    expect(engine.menus[0]).toMatchObject({ kind: "inventory", items: ["seau d'eau"], width: 140 });
    expect(engine.modal).toBe(5);
    engine.input(...click(10, 10));
    engine.runTick();
    expect(engine.menus).toEqual([]);
    expect(engine.state.playerCommand).toBe(-1);
    // UTILISER avec le seau : choix de l'objet porté, puis « UTILISER seau d'eau sur ».
    engine.input({ type: "action", action: "use" });
    pump(engine, 20);
    expect(engine.menus[0]).toMatchObject({ kind: "object", items: ["seau d'eau"] });
    engine.input(...click(engine.menus[0]!.x + 10, engine.menus[0]!.y + 6));
    engine.runTick();
    expect(engine.state.commandLine).toBe("UTILISER seau d'eau sur");
    expect(engine.state.commandVar1).toBe(1);
  });

  it("deux boutons : menu système (sans « Lecteur de Svg. A: ») ; Sauver ouvre le dialogue du site", () => {
    const { engine, host } = firstScene();
    engine.input(...click(20, 20, "both"));
    pump(engine, 30);
    expect(engine.menus[0]).toMatchObject({ kind: "system", items: ["Pause", "Nouvelle partie", "Quitter", "Charger une partie", "Sauver la partie"] });
    engine.input({ type: "move", x: 30, y: 20 + 4 + 9 * 4 + 2 }, { type: "down", button: "left" }, { type: "up", button: "left" });
    engine.runTick();
    expect(host.saveRequests).toBe(1);
    expect(engine.inMenu).toBe(false);
  });

  it("menu système : Quitter demande confirmation, puis le moteur s'arrête", () => {
    const { engine, host } = firstScene();
    engine.input(...click(20, 20, "both"));
    pump(engine, 30);
    engine.input({ type: "move", x: 30, y: 20 + 4 + 9 * 2 + 2 }, { type: "down", button: "left" }, { type: "up", button: "left" });
    pump(engine, 30);
    expect(engine.menus.at(-1)).toMatchObject({ kind: "confirm", items: ["Ok , Vas-y ...", "Surtout Pas !"] });
    const confirm = engine.menus.at(-1)!;
    engine.input({ type: "move", x: confirm.x + 10, y: confirm.y + 5 }, { type: "down", button: "left" }, { type: "up", button: "left" });
    pump(engine, 30);
    expect(engine.quitRequested).toBe(true);
    expect(host.exited).toBe(true);
  });
});
