import { describe, expect, it, vi } from "vitest";
import { Direction } from "../../../../src/games/lure/data/ids";
import type { LureEngine } from "../../../../src/games/lure/engine/game";
import { HANDLER_CATALOG } from "../../../../src/games/lure/engine/handlers/catalog";
import { GROUP_2_HANDLERS } from "../../../../src/games/lure/engine/handlers/group-2/index";
import { HandlerTable } from "../../../../src/games/lure/engine/handlers/index";
import { CharacterMode, Field, GameState, HotspotId, TickProc } from "../../../../src/games/lure/engine/ids";
import type { SilentSound } from "../../../../src/games/lure/engine/services";
import { hasOriginalFiles } from "../test-host";
import { run, stand, started } from "./helpers";

const PLAYER = HotspotId.PLAYER;
const SKORL = HotspotId.SKORL;
const CAUGHT = GameState.RESTORE_RESTART | GameState.CAUGHT;
const TORCH = 0x40e;
const STRAW_FIRE = 0x41c;
const FIRE = 0x418;
const SONIC_RAT = 0x41d;
const SEWER_FALL = 0x416;
const PRISONER = 0x412;
const names = ["jailorAnimHandler", "sonicRatAnimHandler", "droppingTorchAnimHandler", "playerSewerExitAnimHandler", "prisonerAnimHandler"] as const;

/** Joueur et Skorl l'un sur l'autre dans la pièce 3, le Skorl retenu (`frameCtr`) pour que `standardCharacterAnimHandler` ne fasse rien d'autre. */
function skorlOnPlayer(engine: LureEngine, id: number = SKORL) {
  const player = stand(engine, PLAYER, 3, 100, 160);
  const skorl = stand(engine, id, 3, 100, 160);
  skorl.frameCtr = 5;
  engine.gameState = 0;
  return { player, skorl };
}

describe("gestionnaires du groupe L2 : table", () => {
  it("fournit exactement les cinq fonctions du catalogue du groupe L2 (numéros 9-10, 13, 14, 15, 20)", () => {
    const l2 = HANDLER_CATALOG.filter((h) => h.group === "L2");
    expect(l2.map((h) => h.name).sort()).toEqual([...names].sort());
    expect(Object.keys(GROUP_2_HANDLERS).sort()).toEqual([...names].sort());
    expect(l2.find((h) => h.name === "jailorAnimHandler")!.ids).toEqual([9, 10]);
    expect(l2.flatMap((h) => h.ids).sort((a, b) => a - b)).toEqual([9, 10, 13, 14, 15, 20]);
  });

  it("une table sans le groupe garde ces fonctions en souches, avec le groupe elles sont portées", () => {
    const ctx = { journal: { log: () => {} } } as never;
    expect(new HandlerTable(ctx, []).stubs).toEqual(expect.arrayContaining([...names]));
    expect(new HandlerTable(ctx, [GROUP_2_HANDLERS]).stubs).not.toEqual(expect.arrayContaining(["jailorAnimHandler"]));
  });
});

describe.skipIf(!hasOriginalFiles)("9-10 jailorAnimHandler", () => {
  it("le Skorl de la cellule et celui du château (3F3) ont ce gestionnaire (numéro 9 ou 10)", () => {
    const engine = started();
    expect(engine.world.requireHotspot(SKORL).tickProcId).toBe(TickProc.JAILOR);
    expect([9, 10]).toContain(engine.world.requireHotspot(HotspotId.CASTLE_SKORL).tickProcId);
  });

  it("champ 11 à zéro : le Skorl ne capture pas, même sur le joueur ; il fait ce que fait un PNJ ordinaire (`frameCtr` décompté)", () => {
    const engine = started();
    const { skorl } = skorlOnPlayer(engine);
    engine.world.fields.set(11, 0);
    run(engine, "jailorAnimHandler", skorl);
    expect(engine.gameState & CAUGHT).toBe(0);
    expect(skorl.frameCtr).toBe(4);
  });

  it("champ 11 non nul et contact avec le joueur dans la même pièce : capture (fin de partie, redémarrage)", () => {
    const engine = started();
    const { skorl } = skorlOnPlayer(engine);
    engine.world.fields.set(11, 1);
    run(engine, "jailorAnimHandler", skorl);
    expect(engine.gameState).toBe(CAUGHT);
    expect(skorl.frameCtr).toBe(4);
  });

  it("pas de capture : pièces différentes, loin du joueur, personnage qui vient d'arriver (`skipFlag`), avance rapide (`preloadFlag`)", () => {
    const engine = started();
    engine.world.fields.set(11, 1);
    // Une autre pièce.
    let { skorl } = skorlOnPlayer(engine);
    skorl.roomNumber = 4;
    run(engine, "jailorAnimHandler", skorl);
    expect(engine.gameState & CAUGHT).toBe(0);
    // Loin (même pièce, 80 pixels).
    ({ skorl } = skorlOnPlayer(engine));
    skorl.setPosition(180, skorl.y);
    run(engine, "jailorAnimHandler", skorl);
    expect(engine.gameState & CAUGHT).toBe(0);
    // `skipFlag`.
    ({ skorl } = skorlOnPlayer(engine));
    skorl.skipFlag = true;
    run(engine, "jailorAnimHandler", skorl);
    expect(engine.gameState & CAUGHT).toBe(0);
    // `preloadFlag`.
    ({ skorl } = skorlOnPlayer(engine));
    engine.preloadFlag = true;
    run(engine, "jailorAnimHandler", skorl);
    expect(engine.gameState & CAUGHT).toBe(0);
    engine.preloadFlag = false;
  });

  it("le Skorl du château capture même avec le champ 11 à zéro", () => {
    const engine = started();
    const { skorl } = skorlOnPlayer(engine, HotspotId.CASTLE_SKORL);
    engine.world.fields.set(11, 0);
    run(engine, "jailorAnimHandler", skorl);
    expect(engine.gameState).toBe(CAUGHT);
  });

  it("appelle d'abord `handleTalkDialog` (via le gestionnaire standard) : la bulle du Skorl se décompte", () => {
    const engine = started();
    const { skorl } = skorlOnPlayer(engine);
    skorl.res.talkCountdown = 12;
    run(engine, "jailorAnimHandler", skorl);
    expect(skorl.res.talkCountdown).toBe(11);
  });
});

describe.skipIf(!hasOriginalFiles)("13 sonicRatAnimHandler", () => {
  it("le rat attend : tant que le joueur n'est pas à son contact, `actionCtr` reste à 0 et l'animation ne bouge pas", () => {
    const engine = started();
    stand(engine, PLAYER, 4, 100, 160);
    const rat = engine.world.activateHotspot(SONIC_RAT)!;
    rat.setPosition(260, 100);
    rat.frameCtr = 3;
    run(engine, "sonicRatAnimHandler", rat);
    expect(rat.actionCtr).toBe(0);
    expect(rat.frameCtr).toBe(3);
  });

  it("au contact du joueur il se déclenche (`actionCtr` = 1), sans jouer son script cette image-là", () => {
    const engine = started();
    const player = stand(engine, PLAYER, 4, 100, 160);
    const rat = engine.world.activateHotspot(SONIC_RAT)!;
    rat.setPosition(player.x, rat.y);
    rat.frameCtr = 3;
    // Le rat est au niveau des pieds du joueur.
    rat.setPosition(player.x, player.y + player.heightCopy - rat.heightCopy);
    run(engine, "sonicRatAnimHandler", rat);
    expect(rat.actionCtr).toBe(1);
    expect(rat.frameCtr).toBe(3);
  });

  it("une fois déclenché il joue son animation (`standardAnimHandler`) et sort du jeu à la fin du script", () => {
    const engine = started();
    stand(engine, PLAYER, 4, 100, 160);
    const rat = engine.world.activateHotspot(SONIC_RAT)!;
    rat.actionCtr = 1;
    rat.frameCtr = 2;
    run(engine, "sonicRatAnimHandler", rat);
    expect(rat.frameCtr).toBe(1);
    rat.frameCtr = 0;
    let guard = 0;
    while (engine.world.getActiveHotspot(SONIC_RAT) && guard++ < 2000) run(engine, "sonicRatAnimHandler", rat);
    expect(engine.world.getActiveHotspot(SONIC_RAT)).toBeNull();
    // Comme `standardAnimHandler` : le hotspot quitte le jeu (pièce `| 0x8000`).
    expect(engine.world.requireHotspot(SONIC_RAT).roomNumber & 0x8000).toBe(0x8000);
  });
});

describe.skipIf(!hasOriginalFiles)("14 droppingTorchAnimHandler", () => {
  it("attend `frameCtr` images avant de jouer son script", () => {
    const engine = started();
    const torch = engine.world.activateHotspot(TORCH)!;
    torch.frameCtr = 3;
    run(engine, "droppingTorchAnimHandler", torch);
    expect(torch.frameCtr).toBe(2);
    expect(engine.world.getActiveHotspot(TORCH)).toBe(torch);
  });

  it("à la fin de la chute : la torche part, le feu (418) prend avec son animation, bruit 8", () => {
    const engine = started();
    const world = engine.world;
    const torch = world.activateHotspot(TORCH)!;
    expect(world.getActiveHotspot(STRAW_FIRE)).toBeNull();
    expect(world.getActiveHotspot(FIRE)).toBeNull();
    torch.frameCtr = 0;
    const sound = engine.sound as SilentSound;
    let guard = 0;
    while (world.getActiveHotspot(TORCH) && guard++ < 500) run(engine, "droppingTorchAnimHandler", torch);
    expect(guard).toBeLessThan(500);
    expect(world.getActiveHotspot(TORCH)).toBeNull();
    // `activateHotspot(0x41C)` est sans effet : ce hotspot a le chargement 2 (« pas encore »), comme dans ScummVM.
    expect(world.getActiveHotspot(STRAW_FIRE)).toBeNull();
    const fire = world.getActiveHotspot(FIRE)!;
    expect(fire).not.toBeNull();
    expect(fire.res.flags & 0x80).toBe(0x80);
    // Le feu est lancé avec le chargement 4 (animation), puis retrouve son chargement d'origine (2).
    expect(world.requireHotspot(FIRE).loadOffset).toBe(2);
    expect(sound.calls).toContain("addSound 8");
  });
});

describe.skipIf(!hasOriginalFiles)("15 playerSewerExitAnimHandler", () => {
  function fall(engine: LureEngine) {
    const world = engine.world;
    stand(engine, PLAYER, 7, 10, 160);
    const ratpouch = world.activateHotspot(HotspotId.RATPOUCH)!;
    ratpouch.characterMode = CharacterMode.PAUSED;
    ratpouch.delayCtr = 0x7fff;
    ratpouch.currentActions.addFront(2, 8);
    const hole = world.activateHotspot(SEWER_FALL)!;
    return { hole, ratpouch };
  }

  it("attend `frameCtr` images avant de jouer son script", () => {
    const engine = started();
    const { hole } = fall(engine);
    hole.frameCtr = 4;
    run(engine, "playerSewerExitAnimHandler", hole);
    expect(hole.frameCtr).toBe(3);
    expect(engine.world.getActiveHotspot(SEWER_FALL)).toBe(hole);
  });

  it("à la fin de la chute : Diermot au milieu de l'écran, face au bas, libre ; Ratpouch libre, sans attente, avec les actions du suiveur", () => {
    const engine = started();
    const world = engine.world;
    const { hole, ratpouch } = fall(engine);
    hole.frameCtr = 0;
    let guard = 0;
    while (world.getActiveHotspot(SEWER_FALL) && guard++ < 2000) run(engine, "playerSewerExitAnimHandler", hole);
    expect(guard).toBeLessThan(2000);

    const player = world.requireActiveHotspot(PLAYER);
    expect([player.x, player.y]).toEqual([160, 96]);
    expect(player.direction).toBe(Direction.DOWN);
    expect(player.characterMode).toBe(CharacterMode.NONE);
    expect(hole.layer).toBe(0);

    expect(ratpouch.characterMode).toBe(CharacterMode.NONE);
    expect(ratpouch.delayCtr).toBe(0);
    expect(ratpouch.res.actions).toBe(0x821c00);
    expect(ratpouch.currentActions.isEmpty()).toBe(true);
  });

  it("Ratpouch doit être actif : sinon erreur", () => {
    const engine = started();
    stand(engine, PLAYER, 7, 10, 160);
    const hole = engine.world.activateHotspot(SEWER_FALL)!;
    hole.frameCtr = 0;
    expect(() => {
      for (let i = 0; i < 2000; i++) run(engine, "playerSewerExitAnimHandler", hole);
    }).toThrow();
  });
});

describe.skipIf(!hasOriginalFiles)("20 prisonerAnimHandler", () => {
  const prisoner = (engine: LureEngine) => engine.world.activateHotspot(PRISONER)!;

  it("appelle `handleTalkDialog` en tête : la bulle du prisonnier se décompte (sinon la conversation reste bloquée)", () => {
    const engine = started();
    const h = prisoner(engine);
    h.frameCtr = 5;
    h.res.talkCountdown = 9;
    run(engine, "prisonerAnimHandler", h);
    expect(h.res.talkCountdown).toBe(8);
    expect(h.frameCtr).toBe(4);
  });

  it("attend `frameCtr` images, sans tirer au hasard", () => {
    const engine = started();
    const h = prisoner(engine);
    const rng = vi.spyOn(engine.rng, "number");
    h.frameCtr = 2;
    run(engine, "prisonerAnimHandler", h);
    expect(h.frameCtr).toBe(1);
    expect(rng).not.toHaveBeenCalled();
  });

  it("vivant, au repos : un tirage de 6 ou plus (sur 65536) lance son geste (script 0x3F6, `actionCtr` = 1)", () => {
    const engine = started();
    const h = prisoner(engine);
    h.frameCtr = 0;
    h.actionCtr = 0;
    engine.world.fields.set(Field.PRISONER_DEAD, 0);
    vi.spyOn(engine.rng, "number").mockReturnValue(6);
    run(engine, "prisonerAnimHandler", h);
    expect(h.actionCtr).toBe(1);
    expect(h.hotspotScript).toBe(0x3f6);
  });

  it("vivant, au repos : un tirage de 0 à 5 ne fait rien", () => {
    const engine = started();
    const h = prisoner(engine);
    h.frameCtr = 0;
    h.actionCtr = 0;
    const script = h.hotspotScript;
    vi.spyOn(engine.rng, "number").mockReturnValue(5);
    run(engine, "prisonerAnimHandler", h);
    expect(h.actionCtr).toBe(0);
    expect(h.hotspotScript).toBe(script);
  });

  it("mort (champ 15 non nul) : il ne bouge plus, et ne tire même pas au hasard", () => {
    const engine = started();
    const h = prisoner(engine);
    h.frameCtr = 0;
    h.actionCtr = 0;
    engine.world.fields.set(Field.PRISONER_DEAD, 3);
    const rng = vi.spyOn(engine.rng, "number").mockReturnValue(60000);
    run(engine, "prisonerAnimHandler", h);
    expect(h.actionCtr).toBe(0);
    expect(rng).not.toHaveBeenCalled();
  });

  it("pendant son geste (`actionCtr` != 0) : le script joue ; comme dans ScummVM (`executeScript() == 0`) c'est un script pas fini qui revient au script de repos 0x3E0", () => {
    const engine = started();
    const h = prisoner(engine);
    h.frameCtr = 0;
    h.actionCtr = 1;
    h.setHotspotScript(0x3f6);
    const spy = vi.spyOn(h, "executeScript").mockReturnValue(false);
    run(engine, "prisonerAnimHandler", h);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(h.actionCtr).toBe(0);
    expect(h.hotspotScript).toBe(0x3e0);
  });

  it("pendant son geste : un script fini (`UNLOAD`) laisse tout en place", () => {
    const engine = started();
    const h = prisoner(engine);
    h.frameCtr = 0;
    h.actionCtr = 1;
    h.setHotspotScript(0x3f6);
    vi.spyOn(h, "executeScript").mockReturnValue(true);
    run(engine, "prisonerAnimHandler", h);
    expect(h.actionCtr).toBe(1);
    expect(h.hotspotScript).toBe(0x3f6);
  });
});
