import { describe, expect, it } from "vitest";
import { parseBd } from "../../../src/games/swiv3d/data/bd";
import { parseGlobal, type GlobalData } from "../../../src/games/swiv3d/data/global";
import { AMMO_SLOTS } from "../../../src/games/swiv3d/screens/pilots";
import type { PlayerInput } from "../../../src/games/swiv3d/engine/input";
import { Controls } from "../../../src/games/swiv3d/ui/controls";
import { startLevel, summarize, type AppStats, type LevelServices } from "../../../src/games/swiv3d/ui/level-session";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../src/games/swiv3d/render/view";
import { hasOriginalFiles, readOriginal } from "../helpers";
import { maybeDumpPng } from "./png";

const available = hasOriginalFiles;
let cachedGlobal: GlobalData | undefined;
const global = (): GlobalData => (cachedGlobal ??= parseGlobal(parseBd(readOriginal("GLOBAL.BD"), "GLOBAL.BD")));

function services(): LevelServices & { framebuffer: Uint8Array } {
  const stats: AppStats = { renderMs: 0, frameMs: 0, ticks: 0 };
  return {
    read: async (name) => readOriginal(name),
    global: global(),
    sound: null,
    music: null,
    audio: null,
    controls: new Controls(),
    touch: { reset() {} },
    focusCanvas() {},
    framebuffer: new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT),
    stats,
  };
}

describe.skipIf(!available)("session de niveau : HUD, état de départ, bilan", () => {
  it("part de l'état d'arrivée (munitions, score, canon) et dessine le HUD par-dessus la vue", async () => {
    const ammo = Array.from({ length: AMMO_SLOTS }, (_, k) => (k === 3 ? 7 : 0));
    const s = services();
    const withHud = await startLevel(s, { name: "TERRAN00", mission: 0, language: 1, ammo, score: 1234, cannonPower: 2 });
    expect(withHud.world.status.specialAmmo[3]).toBe(7);
    expect(withHud.world.status.score).toBe(1234);
    expect(withHud.world.status.cannonPower).toBe(2);
    expect(withHud.world.debris).not.toBeNull();
    withHud.onFrame(16);
    withHud.onFrame(33);
    const hudPixels = Uint8Array.from(s.framebuffer);

    // Sans HUD (décor des menus) : la même vue, sans le score ni la jauge.
    const s2 = services();
    const bare = await startLevel(s2, { name: "TERRAN00", ammo, score: 1234, cannonPower: 2, hud: false });
    bare.onFrame(16);
    bare.onFrame(33);
    let differing = 0;
    for (let i = 0; i < hudPixels.length; i++) if (hudPixels[i] !== s2.framebuffer[i]) differing++;
    expect(differing).toBeGreaterThan(1500);
    // Le score s'affiche en bas à droite (x 230 à 310, y 370) : zone vide dans la vue sans HUD ? Au moins différente.
    maybeDumpPng("level-hud", hudPixels, withHud.palette);
  });

  it("une partie neuve démarre sans munition ni score", async () => {
    const session = await startLevel(services(), { name: "TERRAN00", mission: 0 });
    expect(session.world.status.specialAmmo.every((n) => n === 0)).toBe(true);
    expect(session.world.status.score).toBe(0);
    expect(session.world.status.energy).toBe(496);
  });

  it("le bilan reprend scores, pourcentages et état d'arrivée du joueur", async () => {
    const session = await startLevel(services(), { name: "TERRAN00", mission: 0, ammo: [1, 2, 3], score: 10 });
    const g = session.world.game;
    g.addScore(500);
    g.objectivesRegistered = 8;
    g.objectivesDestroyed = 3;
    g.bonusPlaced = 4;
    g.pickedPlaced = 1;
    session.world.player.obj.hp = 300;
    const stats = summarize(session.world, 61.5);
    expect(stats).toMatchObject({ seconds: 61.5, levelScore: 500, score: 510, objectivesPercent: 37, bonusPercent: 25, secretsPercent: 0, bonusTotal: 4 });
    expect(stats.state).toMatchObject({ score: 510, energy: 300, form: 0, cannonPower: 0 });
    expect(stats.state!.ammo.slice(0, 4)).toEqual([1, 2, 3, 0]);
  });

  it("une explosion devant le joueur change l'image, une fois", async () => {
    const s = services();
    const session = await startLevel(s, { name: "TERRAN00", mission: 0, hud: false });
    const w = session.world;
    session.onFrame(16);
    session.onFrame(33);
    const before = Uint8Array.from(s.framebuffer);
    const p = w.player.obj;
    const yaw = (p.yaw * 2 * Math.PI) / 512;
    for (const [d, side, model, frame] of [[320, -70, 11003, 14], [340, 80, 11002, 16], [260, 0, 11004, 40]] as const) {
      const e = w.spawn({
        classe: 0xe1,
        hp: 100,
        x: p.x + Math.round((Math.sin(yaw) * d + Math.cos(yaw) * side) * 256),
        y: p.y - 60 * 256,
        z: p.z + Math.round((Math.cos(yaw) * d - Math.sin(yaw) * side) * 256),
        model,
        update: "fx_explosion",
      });
      e!.state = frame;
    }
    expect(w.effects()).toHaveLength(3);
    session.onFrame(34);
    let differing = 0;
    for (let i = 0; i < before.length; i++) if (before[i] !== s.framebuffer[i]) differing++;
    expect(differing).toBeGreaterThan(500);
    maybeDumpPng("level-explosions", s.framebuffer, session.palette);
  });

  it("pause : le monde est figé mais dessiné avec le titre 3D, n'importe quelle touche la ferme ; fin de niveau : le monde continue sans commandes", async () => {
    const s = services();
    const session = await startLevel(s, { name: "TERRAN00", mission: 0, language: 1 });
    let now = 1000;
    const frame = (n = 1): void => {
      for (let k = 0; k < n; k++) session.onFrame((now += 25));
    };
    frame(4);
    const tick = session.world.tickCount;
    s.controls.keyDown({ code: "KeyP" });
    frame(); // la pause se pose
    expect(session.userPaused).toBe(true);
    frame(10);
    expect(session.world.tickCount).toBe(tick);
    const early = Uint8Array.from(s.framebuffer);
    frame(30); // le titre « Pause » arrive : l'image change alors que le monde ne bouge pas
    let differing = 0;
    for (let i = 0; i < early.length; i++) if (early[i] !== s.framebuffer[i]) differing++;
    expect(differing).toBeGreaterThan(200);
    maybeDumpPng("level-paused", s.framebuffer, session.palette);
    s.controls.keyDown({ code: "KeyZ" }); // une touche quelconque
    frame(2);
    expect(session.userPaused).toBe(false);
    frame(4);
    expect(session.world.tickCount).toBeGreaterThan(tick);

    // Fin de niveau : le monde continue de tourner, le joueur n'a plus de commandes.
    session.complete();
    const ended = session.world.tickCount;
    s.controls.keyDown({ code: "ArrowUp" });
    frame(8);
    expect(session.world.tickCount).toBeGreaterThan(ended);
    s.controls.keyDown({ code: "KeyP" });
    frame(2);
    expect(session.userPaused).toBe(false);
  });

  it("séquence de fin : ni pause ni menus ; derrière l'écran de fin, le clavier est vidé à chaque image et la manette reste lue", async () => {
    /** Commandes avec une manette simulée, qui notent les entrées données au monde. */
    class RecordingControls extends Controls {
      buttons: number[] = [];
      samples: PlayerInput[] = [];
      override poll(): void {
        const pressed = new Set(this.buttons);
        super.poll(() => [{ connected: true, mapping: "standard", buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i) })), axes: [0, 0, 0, 0] }]);
      }
      override sample(): PlayerInput {
        const input = super.sample();
        this.samples.push(input);
        return input;
      }
    }
    const s = services();
    const controls = new RecordingControls();
    s.controls = controls;
    const session = await startLevel(s, { name: "TERRAN00", mission: 0 });
    let ended: number | undefined;
    session.events.levelComplete.push(() => (ended = session.summary().endCounter));
    let now = 1000;
    const frame = (n = 1): void => {
      for (let k = 0; k < n; k++) session.onFrame((now += 25));
    };
    frame(2);
    expect(session.menusAllowed).toBe(true);
    // Victoire (`DAT_005b0414 = 1`) : la pause n'est plus lue.
    session.world.game.endState = "victory";
    session.world.game.endCounter = 0;
    expect(session.menusAllowed).toBe(false);
    controls.keyDown({ code: "KeyP" });
    frame();
    expect(session.userPaused).toBe(false);
    for (let k = 0; k < 100 && ended === undefined; k++) frame();
    expect(ended).toBeGreaterThanOrEqual(0x37);
    // Écran de fin : une touche tenue n'arrive pas au monde, un bouton de manette si.
    controls.keyDown({ code: "ArrowUp" });
    controls.buttons = [0];
    controls.samples.length = 0;
    frame(4);
    expect(controls.samples.length).toBeGreaterThan(0);
    for (const input of controls.samples) expect(input).toMatchObject({ forward: false, firePrimary: true });
  });
});
