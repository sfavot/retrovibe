import { describe, expect, it } from "vitest";
import { FotaqEngine } from "../../../src/games/fotaq/engine/loop";
import { type SaveData, parseSave } from "../../../src/games/fotaq/engine/save";
import { fotaqScript } from "../../../src/games/fotaq/engine/specials";
import { BamFlag } from "../../../src/games/fotaq/engine/specials/bam";
import { CAR_DATA } from "../../../src/games/fotaq/engine/specials/group-4/car-data";
import { FIGHT_TABLES } from "../../../src/games/fotaq/engine/specials/group-5/fight-data";
import { hasOriginalFiles } from "../helpers";
import { gameData } from "../engine/test-host";
import { FULL_GAME_START, PLAY_ORDER } from "../solutions";
import { Walkthrough } from "../walkthrough";
import { CheckpointWalkthrough, SongHost } from "./checkpoint";

const ARRIVALS = ["6a:70", "4a:75", "5a:1", "1a-1c:17", "2a:22", "1d:17", "3a+4b:41", "2b:21", "4c:69", "5b+6c:110"];

/** Joue `passages` de la partie complète (de `from` inclus à `to` exclu) sur `w`, et rend les pièces d'arrivée. */
function play(w: Walkthrough, from: number, to: number = PLAY_ORDER.length): string[] {
  const arrivals: string[] = [];
  for (const passage of PLAY_ORDER.slice(from, to)) {
    passage.play(w);
    arrivals.push(`${passage.id}:${w.room}`);
  }
  return arrivals;
}

describe.skipIf(!hasOriginalFiles)("sauvegardes : la course de voiture et le combat final (BamScene)", () => {
  it("une partie sauvée pendant la course ou le combat les reprend (`bam.prepare` au chargement) et se finit", () => {
    const w = new CheckpointWalkthrough({ ...FULL_GAME_START });
    w.when = (_rest, _index, walk) => walk.stage.bam.flag !== BamFlag.Stop;
    expect(play(w, 0)).toEqual(ARRIVALS);
    expect(w.engine.ended).toBe(true);

    const race = w.swaps.filter((s) => s.room === 74);
    const fight = w.swaps.filter((s) => s.room === 69);
    expect(race.length, "reprises pendant la course").toBeGreaterThanOrEqual(3);
    expect(fight.length, "reprises pendant le combat").toBeGreaterThanOrEqual(5);
    for (const swap of [...race, ...fight]) {
      const where = `repos ${swap.rest} (pièce ${swap.room})`;
      expect(swap.differences, where).toEqual([]);
      expect(swap.save.bam.flag, where).not.toBe(BamFlag.Stop);
      // L'animation continue là où elle en était : même état, même ligne de la table, une image plus tard.
      expect(swap.bamAfter, where).toEqual(swap.bamBefore);
    }
    // La course : une ligne de la table par image, et les trois bobs sont à la place de la ligne précédente.
    for (const swap of race) expect(swap.save.bam.index).toBeLessThan(CAR_DATA.length);
    for (const swap of fight) expect(FIGHT_TABLES[swap.save.bam.fightTable]).toBeDefined();
  }, 300_000);

  it("la course reprend sur la ligne sauvegardée : les bobs du camion, de Rico et des tirs sont à la place de la table", () => {
    const w = new CheckpointWalkthrough({ ...FULL_GAME_START });
    let checked = false;
    w.when = (_rest, _index, walk) => {
      if (checked || walk.room !== 74 || walk.stage.bam.index < 20) return false;
      checked = true;
      const swap = walk.swap();
      const { bobs, bam } = walk.stage;
      // `swap` a avancé la partie d'une image : la ligne appliquée est celle qui était la prochaine à la sauvegarde.
      const row = CAR_DATA[swap.save.bam.index];
      expect(bam.index).toBe(swap.save.bam.index + 1);
      expect([bobs.bob(5).x, bobs.bob(5).y, bobs.bob(5).frameNum]).toEqual([row.obj1.x, row.obj1.y, 40 + row.obj1.frame]);
      expect([bobs.bob(6).x, bobs.bob(6).y, bobs.bob(6).frameNum]).toEqual([row.obj2.x, row.obj2.y, 30 + row.obj2.frame]);
      expect([bobs.bob(7).x, bobs.bob(7).y, bobs.bob(7).frameNum]).toEqual([row.fx.x, row.fx.y, 41 + row.fx.frame]);
      expect(bobs.bob(5).active && bobs.bob(6).active && bobs.bob(7).active).toBe(true);
      return false;
    };
    play(w, 0, 2);
    expect(checked).toBe(true);
    // Elle va jusqu'au bout : le mouvement 8 l'arrête comme dans une partie sans chargement.
    expect(w.stage.bam.flag).toBe(BamFlag.Stop);
  }, 120_000);

  it("une partie sauvée hors course reprend sans course (flag Stop, bobs 5 à 7 éteints)", () => {
    const w = new CheckpointWalkthrough({ ...FULL_GAME_START });
    let done = false;
    w.when = (_rest, _index, walk) => !done && walk.room === 70 && (done = true);
    play(w, 0, 2);
    const [swap] = w.swaps;
    expect(swap.save.bam).toEqual({ flag: BamFlag.Stop, index: 0, screenShaked: false, fightTable: 0 });
    expect(w.stage.bam.flag).toBe(BamFlag.Stop);
    expect([5, 6, 7].some((n) => w.stage.bobs.bob(n).active)).toBe(false);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("sauvegardes : le chargement depuis un autre moment de la partie", () => {
  it("un moteur avancé dans la partie reprend une sauvegarde plus ancienne, et la partie se rejoue jusqu'au bout", () => {
    const w = new CheckpointWalkthrough({ ...FULL_GAME_START });
    // Les passages 0 à 3 (jusqu'à la cachette des Amazones), sauvegarde, puis la suite jusqu'au labyrinthe.
    expect(play(w, 0, 4)).toEqual(ARRIVALS.slice(0, 4));
    w.settle();
    const early = w.save();
    expect(early.room).toBe(17);
    expect(play(w, 4, 7)).toEqual(ARRIVALS.slice(4, 7));
    const late = w.engine.state;
    expect(late.room).toBe(41);
    expect(w.engine.gameState(40)).toBe(1); // Azura est libérée : pas encore dans la sauvegarde

    // On recharge l'ancienne partie dans le même moteur : tout ce qui s'est passé depuis est effacé.
    const swap = w.reload(early);
    expect(swap.differences).toEqual([]);
    expect(swap.pixelDiff).toBeLessThan(500);
    expect(w.room).toBe(17);
    expect(w.engine.state).not.toBe(late);
    expect(w.engine.gameState(40)).toBe(0);
    expect(w.engine.busy).toBe(false);

    // Et la partie reprend de là : les passages 4 à 9 se rejouent et finissent le jeu.
    expect(play(w, 4)).toEqual(ARRIVALS.slice(4));
    expect(w.engine.ended).toBe(true);
  }, 300_000);

  it("charger pendant une cinématique l'abandonne : voix coupée, entrées remises à zéro, la main revient dans la pièce chargée", () => {
    const source = new Walkthrough({ room: 1, voices: false });
    source.settle();
    const save = source.engine.saveGame()!;

    // Un moteur au milieu de l'introduction : cinématique en cours, rien à sauvegarder.
    const w = new Walkthrough({ ...FULL_GAME_START, voices: true });
    w.until(() => w.engine.input.cutawayRunning, 500, "une cinématique");
    expect(w.engine.canSave).toBe(false);
    expect(w.engine.saveGame()).toBeNull();
    const stops = w.host.speechStops;
    expect(w.engine.loadGame(save)).toBe(true);
    w.settle();
    expect(w.host.speechStops).toBeGreaterThan(stops);
    expect(w.engine.input.cutawayRunning).toBe(false);
    expect(w.engine.input.dialogueRunning).toBe(false);
    expect(w.engine.scene).toBe(0);
    expect(w.room).toBe(save.room);
    expect(w.engine.canSave).toBe(true);
    expect(w.engine.state.joe.x).toBe(save.joe.x);
  }, 60_000);

  it("charger pendant un dialogue abandonne le menu de choix", () => {
    const w = new Walkthrough({ entryObject: 6, items: [58], voices: false });
    w.settle();
    const save = w.engine.saveGame();
    expect(save).not.toBeNull();
    w.act("Talk", 2);
    w.waitForChoices();
    expect(w.engine.canSave).toBe(false);
    expect(w.engine.saveGame()).toBeNull();
    expect(w.engine.loadGame(save!)).toBe(true);
    w.settle();
    expect(w.engine.input.dialogueRunning).toBe(false);
    expect(w.choices()).toEqual([]);
    expect(w.engine.canSave).toBe(true);
    // Le dialogue se relance comme avant.
    w.act("Talk", 2);
    expect(w.waitForChoices().length).toBeGreaterThan(0);
  }, 60_000);
});

describe.skipIf(!hasOriginalFiles)("sauvegardes : ce que la reprise remet", () => {
  it("une pièce dans le noir (mouvement 21) est reprise dans le noir, et la lumière revient avec le mouvement 22", () => {
    const w = new CheckpointWalkthrough({ room: 103 });
    w.settle();
    w.engine.run(w.engine.executeSpecialMove(21));
    w.settle();
    expect(w.stage.display.palette.dark).toBe(true);
    const swap = w.swap();
    expect(swap.save.lightsOff).toBe(true);
    expect(w.stage.display.palette.dark).toBe(true);
    expect(w.stage.display.palette.screen.slice(32 * 3, 223 * 3).every((c) => c === 0)).toBe(true);
    w.engine.run(w.engine.executeSpecialMove(22));
    w.settle();
    expect(w.stage.display.palette.dark).toBe(false);
    expect(w.stage.display.palette.screen.slice(32 * 3, 223 * 3).some((c) => c !== 0)).toBe(true);
  });

  it("la tenue (robe) : banques et palette de Joe reprises, même dans un moteur qui avait une autre tenue", () => {
    const dressed = new Walkthrough({ room: 73, outfit: 2, voices: false });
    dressed.settle();
    const save = dressed.engine.saveGame()!;
    expect(save.gameStates[19]).toBe(2);

    const w = new Walkthrough({ room: 73, voices: false });
    w.settle();
    expect(w.stage.outfit).toBe(0);
    expect(w.engine.loadGame(save)).toBe(true);
    w.settle();
    expect(w.stage.outfit).toBe(2);
    // Les couleurs de Joe en robe (0x50 pour la deuxième), pas celles de ses vêtements (0x60).
    expect(w.stage.display.palette.room[144 * 3 + 3]).toBe(0x50);
  });

  it("la musique en cours est relancée au chargement, et aucune musique arrête celle du moteur qui charge", () => {
    const host = new SongHost();
    const w = new Walkthrough({ room: 1, voices: false, host });
    w.settle();
    const save = { ...w.engine.saveGame()!, lastSong: 3 }; // « Jungle »
    host.songs.length = 0;
    expect(w.engine.loadGame(save)).toBe(true);
    w.settle();
    expect(host.songs).toEqual([3]);
    expect(host.last).toBe(3);
    expect(w.engine.saveGame()!.lastSong).toBe(3);
    expect(w.engine.loadGame({ ...save, lastSong: 0 })).toBe(true);
    w.settle();
    expect(host.songs.at(-1)).toBe(0);
  });

  it("le moteur reprend le hasard, les verbes et le panneau à zéro : commande, entrées, mode de Joe", () => {
    const w = new Walkthrough({ room: 1, voices: false });
    w.settle();
    const save = w.engine.saveGame()!;
    w.verb("Use");
    expect(w.engine.command.pending).toBe(true);
    w.engine.input.receive([{ type: "action", action: "look" }]);
    w.engine.input.checkKeys();
    expect(w.engine.input.keyVerb).not.toBe(0);
    expect(w.engine.loadGame(save)).toBe(true);
    w.settle();
    expect(w.engine.command.pending).toBe(false);
    expect(w.engine.input.keyVerb).toBe(0);
    expect(w.engine.joeWalk).toBe(0);
  });

  it("une sauvegarde qui ne correspond pas aux données du jeu est refusée sans rien changer", () => {
    const w = new Walkthrough({ room: 1, voices: false });
    w.settle();
    const save = w.engine.saveGame()!;
    const state = w.engine.state;
    for (const broken of [
      { ...save, objects: save.objects.slice(1) },
      { ...save, areas: save.areas.slice(1) },
      { ...save, room: 0 },
      { ...save, room: 9999 },
      { ...save, inventory: [9999, 0, 0, 0] },
      { ...save, walkOffs: [] },
    ] as SaveData[]) {
      expect(w.engine.loadGame(broken)).toBe(false);
      expect(w.engine.state).toBe(state);
    }
    expect(() => new FotaqEngine(new SongHost(), { data: gameData(), script: fotaqScript, restore: { ...save, objects: [] } })).toThrow("sauvegarde inutilisable");
    expect(parseSave(JSON.parse(JSON.stringify(save)))).toEqual(save);
  });

  it("après la fin du jeu on ne charge plus", () => {
    const w = new Walkthrough({ room: 1, voices: false });
    w.settle();
    const save = w.engine.saveGame()!;
    w.engine.endGame();
    expect(w.engine.canSave).toBe(false);
    expect(w.engine.loadGame(save)).toBe(false);
  });
});
