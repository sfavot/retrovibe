import { describe, expect, it, vi } from "vitest";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { DIALOG } from "../../src/games/zoombinis/engine/dialog";
import { resumeScreen } from "../../src/games/zoombinis/game/route";
import { correctEntrances, type Entrance } from "../../src/games/zoombinis/game/puzzles/tunnels";
import { resetTunnelsVisits, type TunnelsScene } from "../../src/games/zoombinis/scenes/puzzles/tunnels";
import { originalFiles } from "../support/original";
import { boot, CAMP_EXITS, dragMember, leaveCamp, MIDDLE_STAGE, nameOf, pickGroup, PATH_SCREENS, playAdventure, playTunnels, puzzle, reach, screenIs, tick, until } from "./full-game-robot";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");
const S = ScreenId;

describe.skipIf(!original.has)("partie complète à travers les vrais écrans", () => {
  it.each(["A", "B"] as const)("chemin %s : de la partie neuve à Zoombiniville avec les 16 Zoombinis, monuments et marques de réussite", async (path) => {
    const r = await boot();
    await playAdventure(r, path);
    const { game } = r.zb;

    // Écrans traversés dans l'ordre du parcours (les transitions sont coupées, aucun écran de transfert).
    expect(r.visited.map(nameOf)).toEqual(PATH_SCREENS[path].map(nameOf));
    // Le groupe entier entre dans chaque épreuve et chaque camp.
    expect(r.arrivals.map(([id]) => id)).toEqual(PATH_SCREENS[path].slice(1));
    expect(r.arrivals.map(([, n]) => n)).toEqual(new Array(r.arrivals.length).fill(16));

    // Arrivée : 16 habitants, plus de groupe, aucun Zoombini resté dans un camp ni au choix.
    expect(r.engine.scenes.currentId).toBe(S.town);
    expect(game.counters).toMatchObject({ created: 16, camp1: 0, camp2: 0, town: 16 });
    expect(game.group.members).toHaveLength(0);
    expect(game.pickerGroup.members).toHaveLength(0);
    // Les copies de groupe rangées aux camps à chaque départ sont marquées « à purger » : aucun perdu n'y attend.
    expect([game.camp1Group.flagA, game.camp2Group.flagA]).toEqual([true, true]);
    expect([game.camp1.count, game.camp2.count]).toEqual([0, 0]);
    expect(game.population.count).toBe(16);

    // Monuments : dernière épreuve de chaque étape jouée, sans perte, niveau 1.
    const middle = MIDDLE_STAGE[path];
    expect(game.monuments.filter((m) => m !== null).map((m) => [m!.stage, m!.level])).toEqual([
      [1, 1],
      [middle, 1],
      [4, 1],
    ]);
    expect(game.levels).toEqual([1, middle === 2 ? 1 : 0, middle === 3 ? 1 : 0, 1]);
    expect(game.masks).toMatchObject({ stage1: 1, stage4: 1 });
    expect(path === "A" ? game.masks.stage2 : game.masks.stage3).toBe(1);

    // Marque « passée » et « sans perte » du niveau 0 de chacune des 11 épreuves jouées.
    for (const screen of PATH_SCREENS[path].filter((id) => id >= S.bridge && id <= S.maze2 && id !== S.baseCamp && id !== S.bcTwo)) {
      expect(game.successes[screen - S.bridge]! & 0x11, nameOf(screen)).toBe(0x11);
    }
    // Les épreuves de l'autre chemin ne sont pas jouées.
    for (const screen of path === "A" ? [S.fleens, S.hotel, S.net] : [S.ferry, S.lilly, S.slides]) expect(game.successes[screen - S.bridge], nameOf(screen)).toBe(0);

    // Zoombiniville affiche les 16 habitants.
    await tick(r, 200);
    expect(r.zb.session.screen).toBe(S.town);
    expect(r.engine.error).toBeNull();
  }, 240_000);

  it("chemin A avec les fondus d'écran (11a8:302b / 11a8:3065) : chaque écran sort du noir et la partie va jusqu'au bout", async () => {
    const r = await boot();
    r.services.fades.enabled = true;
    const { palette } = r.services.graphics;
    // Luminance la plus haute affichée sur chaque écran (somme des entrées 1 à 254 de la palette présentée).
    const brightest = new Map<number, number>();
    r.engine.addTickHook((c) => {
      const id = c.scenes.currentId as number;
      const lum = palette.output().slice(3, 255 * 3).reduce((sum, v) => sum + v, 0);
      brightest.set(id, Math.max(brightest.get(id) ?? 0, lum));
    });
    await playAdventure(r, "A");
    expect(r.visited.map(nameOf)).toEqual(PATH_SCREENS.A.map(nameOf));
    expect(r.arrivals.map(([, n]) => n)).toEqual(new Array(r.arrivals.length).fill(16));
    await tick(r, 60);
    for (const id of PATH_SCREENS.A) expect(brightest.get(id) ?? 0, nameOf(id)).toBeGreaterThan(0);
    // Zoombiniville, fondu d'entrée fini : la palette affichée est celle de l'écran.
    expect(palette.fade).toBeNull();
    expect(Array.from(palette.output())).toEqual(Array.from(palette.colors));
    expect(r.engine.error).toBeNull();
  }, 240_000);

  it("chemin A avec des pertes à l'étape 4 : un Zoombini laissé dans la tanière et un au gouffre sont rendus au camp 2, sans monument ni niveau pour l'étape", async () => {
    const r = await boot();
    await playAdventure(r, "A", { [S.caves]: 1, [S.maze2]: 1 });
    const { game } = r.zb;
    expect(r.visited.map(nameOf)).toEqual(PATH_SCREENS.A.map(nameOf));
    // 16 entrent dans la tanière, 15 au piège, 14 au gouffre ; 14 arrivent en ville.
    expect(r.arrivals.filter(([id]) => id === S.caves || id === S.smoke || id === S.maze2).map(([, n]) => n)).toEqual([16, 15, 15]);
    expect(game.counters).toMatchObject({ created: 16, camp1: 0, town: 14 });
    // Les deux perdus attendent au camp 2 (réserve de groupe du camp, compteur du camp).
    expect(game.camp2Group.members.filter((z) => z.present)).toHaveLength(2);
    expect(game.counters.camp2).toBe(2);
    expect(game.pickerGroup.members).toHaveLength(0);
    expect(game.population.count).toBe(14);
    // L'étape brisée ne pose ni monument ni niveau ; les deux premières étapes, oui.
    expect(game.monuments.filter((m) => m !== null).map((m) => [m!.stage, m!.level])).toEqual([
      [1, 1],
      [2, 1],
    ]);
    expect(game.levels).toEqual([1, 1, 0, 0]);
    expect(game.stageUnbroken).toBe(false);
    for (const screen of [S.caves, S.smoke, S.maze2]) expect(game.successes[screen - S.bridge], nameOf(screen)).toBe(1);
  }, 240_000);

  it("pertes à l'étape 1 : les deux Zoombinis laissés aux grottes retournent au choix, le camp 1 refuse la sortie à 14", async () => {
    const r = await boot();
    await pickGroup(r);
    await puzzle(r, S.bridge, S.tunnels);
    await puzzle(r, S.tunnels, S.pizza, 2);
    expect(r.zb.game.pickerGroup.members.filter((z) => z.present)).toHaveLength(2);
    await puzzle(r, S.pizza, S.baseCamp);
    await tick(r, 300);
    const { game } = r.zb;
    expect(r.arrivals.map(([id, n]) => [nameOf(id), n])).toEqual([
      ["bridge", 16],
      ["tunnels", 16],
      ["pizza", 14],
      ["baseCamp", 14],
    ]);
    expect(game.counters).toMatchObject({ camp1: 14, camp2: 0 });
    expect(game.camp1.count).toBe(0);
    expect(game.stageUnbroken).toBe(false);
    expect(game.monuments.every((m) => m === null)).toBe(true);
    // Avec 14 Zoombinis, aucune des deux sorties ne s'ouvre.
    for (const exit of CAMP_EXITS[S.baseCamp]!) {
      r.host.click(exit.x, exit.y);
      await tick(r, 600);
      expect(screenIs(r, S.baseCamp)).toBe(true);
    }
    expect(r.engine.error).toBeNull();
  }, 240_000);

  it("pertes à l'étape 3 (chemin B) : les deux Zoombinis laissés à l'hôtel sont rendus au camp 1 et seuls 14 entrent à la muraille", async () => {
    const r = await boot();
    await pickGroup(r);
    for (const [screen, next] of [
      [S.bridge, S.tunnels],
      [S.tunnels, S.pizza],
      [S.pizza, S.baseCamp],
    ] as const)
      await puzzle(r, screen, next);
    await leaveCamp(r, S.baseCamp, 1);
    await puzzle(r, S.fleens, S.hotel);
    await puzzle(r, S.hotel, S.net, 2);
    await tick(r, 100);
    const { game } = r.zb;
    expect(r.arrivals.slice(-3).map(([id, n]) => [nameOf(id), n])).toEqual([
      ["fleens", 16],
      ["hotel", 16],
      ["net", 14],
    ]);
    // Les perdus des étapes 2 et 3 reviennent au camp 1 (réserve de groupe et compteur du camp), pas au choix ni au camp 2.
    expect(game.camp1Group.members.filter((z) => z.present)).toHaveLength(2);
    expect(game.counters).toMatchObject({ camp1: 2, camp2: 0 });
    expect(game.pickerGroup.members).toHaveLength(0);
    expect(game.stageUnbroken).toBe(false);
    expect(game.group.members.filter((z) => z.present)).toHaveLength(14);
  }, 240_000);

  it("enregistrer en pleine épreuve puis recharger : on reprend aux grottes avec les 16 Zoombinis et la partie se termine", async () => {
    const r = await boot();
    await pickGroup(r);
    await puzzle(r, S.bridge, S.tunnels);
    await reach(r, S.tunnels);
    const scene = r.scenes.get(S.tunnels) as TunnelsScene;
    await until(r, "grottes : sonde", () => (scene.debug.kit?.members.length ?? 0) > 0 && scene.debug.rules !== null);
    // Trois Zoombinis déjà passés, puis on enregistre (le groupe affiché dans l'épreuve est rendu entier à la partie).
    const kit = scene.debug.kit!;
    for (let i = 0; i < 3; i++) {
      const entrance = correctEntrances(scene.debug.rules!, kit.members[i]!.zoombini.attrs)[0] as Entrance;
      await dragMember(r, kit, i, scene.debug.entranceAnchor(entrance));
      await until(r, `grottes : le membre ${i} arrive`, () => scene.debug.statusOf(i) === "arrived", 3000);
      await until(r, "grottes : file vide", () => !scene.debug.busy && scene.debug.queueLength === 0 && !kit.members[i]!.snoid.walking, 3000);
    }
    const dialogs = r.engine.services.get(DIALOG) as unknown as { beforeSave: (() => void)[] };
    expect(dialogs.beforeSave).toHaveLength(1);
    for (const hook of dialogs.beforeSave) hook();
    r.zb.saves.save("Reprise", r.zb.game);
    const savedAttrs = r.zb.game.group.members.map((z) => z.attrs.join());
    expect(savedAttrs).toHaveLength(16);

    // Nouveau moteur sur le même stockage : la partie est rechargée comme par la boîte « Charger ».
    resetTunnelsVisits();
    const r2 = await boot(r.host, 29);
    expect(r2.zb.saves.list().map((e) => e.name)).toContain("Reprise");
    const loaded = r2.zb.saves.load("Reprise");
    r2.zb.game = loaded;
    r2.zb.session.name = "Reprise";
    const screen = resumeScreen(loaded, r2.zb.session);
    expect(screen).toBe(S.tunnels);
    r2.zb.session.screen = screen;
    r2.engine.start(screen as ScreenId);
    await reach(r2, S.tunnels);
    expect(r2.visited[0]).toBe(S.tunnels);
    const scene2 = r2.scenes.get(S.tunnels) as TunnelsScene;
    await until(r2, "grottes (rechargées) : sonde", () => (scene2.debug.kit?.members.length ?? 0) > 0 && scene2.debug.rules !== null);
    expect(scene2.debug.kit!.members.map((m) => m.zoombini.attrs.join())).toEqual(savedAttrs);
    expect(r2.zb.game.group.members.filter((z) => z.present)).toHaveLength(16);
    // L'épreuve reprise se joue jusqu'au bout et mène à la hutte à pizza avec le groupe entier.
    await playTunnels(r2, 0);
    await reach(r2, S.pizza);
    expect(r2.zb.game.group.members.filter((z) => z.present)).toHaveLength(16);
  }, 240_000);
});
