import { describe, expect, it } from "vitest";
import { type SpriteBank, parseBank } from "../../../src/games/fotaq/data/bank";
import { MAX_FRAMES, SFX_FRAME } from "../../../src/games/fotaq/engine/bobs";
import { findActor } from "../../../src/games/fotaq/engine/actors";
import { areaScale } from "../../../src/games/fotaq/engine/grid";
import { isPerson } from "../../../src/games/fotaq/engine/room";
import { Outfit } from "../../../src/games/fotaq/engine/services";
import { GameStage } from "../../../src/games/fotaq/engine/stage";
import { Direction, Grab, toInt16 } from "../../../src/games/fotaq/engine/state";
import { hasOriginalFiles } from "../helpers";
import { Player, gameData } from "./test-host";

function enter(room: number, options: { x?: number; y?: number } = {}) {
  const stage = new GameStage();
  const player = new Player({ room, stage });
  player.settle();
  if (options.x !== undefined) {
    stage.bobs.bob(0).curPos(options.x, options.y ?? 100);
    player.state.joe.x = options.x;
    player.state.joe.y = options.y ?? 100;
  }
  return { player, stage, engine: player.engine, bobs: stage.bobs };
}

/** Nombre de ticks qu'une séquence met à finir, à partir de la boucle principale libre. */
function ticksOf(player: Player, sequence: Parameters<Player["perform"]>[0]): number {
  player.engine.run(sequence);
  let ticks = 0;
  while (player.engine.busy && ticks < 500) {
    player.run(1);
    ticks++;
  }
  return ticks;
}

describe.skipIf(!hasOriginalFiles)("pièces : bobs et images (graphics.cpp)", () => {
  const banks = new Map<string, SpriteBank>();
  const bank = (player: Player, name: string): SpriteBank => {
    let parsed = banks.get(name);
    if (!parsed) banks.set(name, (parsed = parseBank(player.host.readFile(name))));
    return parsed;
  };

  it("dans les 126 pièces, chaque image des bobs et de la table existe dans sa banque, sous 256 images", () => {
    const data = gameData();
    for (let room = 1; room <= data.jas.roomCount; room++) {
      const { player, bobs } = enter(room);
      const check = (frameNum: number, what: string) => {
        const ref = bobs.frames.frame(frameNum);
        expect(ref, `pièce ${room} : ${what} (image ${frameNum})`).toBeDefined();
        if (!ref) return;
        const frames = bank(player, ref.bank).frameCount;
        expect(ref.image, `pièce ${room} : ${what} (${ref.bank})`).toBeLessThanOrEqual(frames);
      };
      expect(bobs.frames.highestFrame).toBeLessThan(MAX_FRAMES);
      for (let n = 0; n < MAX_FRAMES; n++) if (bobs.frames.frame(n)) check(n, "table");
      bobs.slots.forEach((bob, index) => {
        if (!bob.active) return;
        check(bob.frameNum, `bob ${index}`);
        if (bob.animating && bob.anim.string) {
          for (const step of bob.anim.string) check(step.frame > SFX_FRAME ? step.frame - SFX_FRAME : step.frame, `chaîne du bob ${index}`);
        } else if (bob.animating) {
          for (let n = bob.anim.normal.firstFrame; n <= bob.anim.normal.lastFrame; n++) check(n, `animation du bob ${index}`);
        }
      });
    }
  }, 60_000);

  it("findBob et findFrame retrouvent le bob et l'image de chaque objet fixe visible", () => {
    const data = gameData();
    let checked = 0;
    for (let room = 1; room <= data.jas.roomCount; room++) {
      if (room === 123) continue; // l'explosion de l'introduction déplace son bob à chaque image
      const { player, bobs, engine } = enter(room);
      const first = engine.currentRoomData + 1;
      const last = data.jas.roomFirstObject[room + 1];
      // ScummVM numérote les bobs et les images des objets qui suivent une image collée dans le décor (> 5000) comme si elle avait un
      // bob : écart avec la mise en place de la pièce, reproduit (pièce 102, objets 698 et 699 : voir engine.md, § 11).
      let afterPaste = false;
      for (let object = first; object <= last; object++) {
        const { name, image } = player.state.objects[object];
        if (image > 5000) afterPaste = true;
        if (afterPaste || name <= 0 || image <= 0 || image >= 5000) continue;
        const graphic = data.jas.graphics[image];
        if (graphic.lastFrame !== 0 || graphic.firstFrame <= 0) continue;
        const where = `pièce ${room}, objet ${object}`;
        const bobNum = bobs.findBob(engine, object);
        expect(bobNum, where).toBeGreaterThanOrEqual(20);
        const bob = bobs.bob(bobNum);
        // Les coordonnées du fichier sont des `uint16` rangés dans des `int16` (65521 est -15).
        expect([bob.active, bob.x, bob.y], where).toEqual([true, toInt16(graphic.x), toInt16(graphic.y)]);
        expect(bob.frameNum, where).toBe(bobs.findFrame(engine, object));
        expect(bobs.frames.frame(bob.frameNum)?.image, where).toBe(graphic.firstFrame);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(150);
  }, 60_000);

  it("les personnes : bob à la position de l'acteur, échelle de sa zone, image debout dans la banque de l'acteur, tourné comme son objet", () => {
    const data = gameData();
    let checked = 0;
    for (let room = 1; room <= data.jas.roomCount; room++) {
      // Introduction : les personnages glissent dès la première image (parallaxe de la pièce).
      if (room === 116 || room === 123) continue;
      const { player, bobs, engine } = enter(room);
      const first = engine.currentRoomData + 1;
      const last = data.jas.roomFirstObject[room + 1];
      for (let object = first; object <= last; object++) {
        const { name, image } = player.state.objects[object];
        if (!isPerson(image) || name <= 0) continue;
        const actor = findActor(engine, object - engine.currentRoomData, null);
        if (!actor) continue;
        const where = `pièce ${room}, objet ${object}`;
        const bob = bobs.bob(actor.bobNumber);
        expect(bob.active, where).toBe(true);
        expect([bob.x, bob.y], where).toEqual([toInt16(actor.x), toInt16(actor.y)]);
        const area = engine.grid.findAreaForPos(bob.x, bob.y);
        expect(bob.scale, where).toBe(area === 0 ? 100 : areaScale(player.state.areas[room][area], bob.y));
        expect(bob.xflip, where).toBe(image === -3);
        if (actor.animation === 0) {
          expect(bobs.frames.frame(31 + actor.bobNumber), where).toMatchObject({ image: actor.standingFrame });
        } else {
          expect(bob.animating, where).toBe(true);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(60);
  }, 60_000);

  it("une personne animée parcourt sa chaîne : images renumérotées après celles des objets, durée en quarts", () => {
    const { stage, bobs, player } = enter(1);
    const bob = bobs.bob(1);
    expect(bob.animating).toBe(true);
    const chain = bob.anim.string ?? [];
    expect(chain.length).toBe(7);
    // « 038,008,039,006,040,004,041,016,040,004,039,006,038,008 » : 4 images distinctes, rangées dans l'ordre des numéros.
    const base = chain[0].frame;
    expect(chain.map((step) => step.frame - base)).toEqual([0, 1, 2, 3, 2, 1, 0]);
    expect(chain.map((step) => step.speed)).toEqual([8, 6, 4, 16, 4, 6, 8]);
    expect(bobs.frames.frame(base)).toMatchObject({ image: 38 });
    expect(bobs.frames.frame(base + 3)).toMatchObject({ image: 41 });
    const seen = new Set<number>();
    for (let i = 0; i < 40; i++) {
      player.run(1);
      seen.add(bob.frameNum);
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([base, base + 1, base + 2, base + 3]);
    expect(stage.actors.personFrames[1]).toBe(base);
  });

  it("une animation par chaîne d'objet (graphicAnimations) joue ses images triées", () => {
    const data = gameData();
    const { jas } = data;
    // Premier objet visible dont l'image est une animation par chaîne.
    let found: { room: number; object: number } | null = null;
    for (let room = 1; room <= jas.roomCount && !found; room++) {
      for (let object = jas.roomFirstObject[room] + 1; object <= jas.roomFirstObject[room + 1]; object++) {
        const o = jas.objects[object];
        if (o.name > 0 && o.image > 0 && o.image < 5000 && jas.graphics[o.image].firstFrame < 0) {
          found = { room, object };
          break;
        }
      }
    }
    expect(found).not.toBeNull();
    const { room, object } = found as { room: number; object: number };
    const { player, bobs, engine } = enter(room);
    const graphic = jas.graphics[jas.objects[object].image];
    const bob = bobs.bob(bobs.findBob(engine, object));
    expect(bob.active).toBe(true);
    expect([bob.x, bob.y]).toEqual([graphic.x, graphic.y]);
    expect(bob.animating).toBe(true);
    const steps = jas.graphicAnimations.slice(1).filter((a) => a.keyFrame === graphic.firstFrame);
    expect(bob.anim.string?.length).toBe(steps.length);
    expect(bob.anim.string?.map((s) => s.speed)).toEqual(steps.map((s) => s.speed));
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      player.run(1);
      seen.add(bob.frameNum);
    }
    for (const frame of seen) {
      expect(bobs.frames.frame(frame), `image ${frame}`).toBeDefined();
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("refreshObject refait le bob d'un objet, le cache s'il est caché ; clearObjectBob l'éteint", () => {
    const { player, stage, engine, bobs } = enter(1);
    const { graphics } = engine.data.jas;
    const object = player.state.objects[1];
    // Le sac ouvert (image 4, comme après la commande « ouvrir »).
    object.image = 4;
    stage.refreshObject(engine, 1);
    const bob = bobs.bob(bobs.findBob(engine, 1));
    expect(bob.active).toBe(true);
    expect([bob.x, bob.y]).toEqual([graphics[4].x, graphics[4].y]);
    expect(bobs.frames.frame(bob.frameNum)).toMatchObject({ image: graphics[4].firstFrame });
    object.name = -Math.abs(object.name);
    stage.refreshObject(engine, 1);
    expect(bob.active).toBe(false);
    object.name = Math.abs(object.name);
    stage.refreshObject(engine, 1);
    expect(bob.active).toBe(true);
    stage.clearObjectBob(engine, 1);
    expect(bob.active).toBe(false);
    // Objet d'une autre pièce : sans effet.
    const other = engine.data.jas.roomFirstObject[2] + 1;
    const before = bobs.slots.filter((b) => b.active).length;
    stage.refreshObject(engine, other);
    expect(bobs.slots.filter((b) => b.active).length).toBe(before);
  });

  it("changer de pièce efface les images de la pièce quittée et ferme ses banques", () => {
    const { player, bobs } = enter(1);
    const before = bobs.frames.frame(40);
    expect(before).toBeDefined();
    expect(bobs.frames.bank(15)).toBe(`${gameData().texts.roomNames[1]}.BBK`);
    player.state.newRoom = 2;
    player.settle();
    expect(player.state.room).toBe(2);
    expect(bobs.frames.bank(15)).toBe(`${gameData().texts.roomNames[2]}.BBK`);
    for (let n = 38; n < MAX_FRAMES; n++) {
      const ref = bobs.frames.frame(n);
      if (ref) expect(ref.bank).not.toBe(`${gameData().texts.roomNames[1]}.BBK`);
    }
    // Les images de Joe restent.
    expect(bobs.frames.frame(11)).toEqual({ bank: "JOE_A.BBK", image: 1 });
  });
});

describe.skipIf(!hasOriginalFiles)("caméra et parallaxe", () => {
  it("le décor de 640 défile avec Joe : 0 jusqu'à 160, x - 160 au milieu, 320 à partir de 480", () => {
    const { player, stage, engine } = enter(20);
    expect(stage.backdropWidth).toBe(640);
    const scrollAt = (x: number) => {
      stage.bobs.bob(0).curPos(x, 110);
      player.run(1);
      return engine.horizontalScroll;
    };
    expect(scrollAt(100)).toBe(0);
    expect(scrollAt(160)).toBe(0);
    expect(scrollAt(161)).toBe(1);
    expect(scrollAt(400)).toBe(240);
    expect(scrollAt(479)).toBe(319);
    expect(scrollAt(480)).toBe(320);
    expect(scrollAt(620)).toBe(320);
    // Caméra libérée : le défilement ne bouge plus.
    stage.bobs.cameraBob = -1;
    expect(scrollAt(200)).toBe(320);
  });

  it("un décor de 320 ne défile pas", () => {
    const { player, stage, engine } = enter(2);
    expect(stage.backdropWidth).toBe(320);
    stage.bobs.bob(0).curPos(300, 110);
    player.run(1);
    expect(engine.horizontalScroll).toBe(0);
  });

  it("les largeurs de décor : 15 pièces de 640 pixels", () => {
    const wide: number[] = [];
    for (let room = 1; room <= 126; room++) if (enter(room).stage.backdropWidth > 320) wide.push(room);
    expect(wide).toEqual([7, 17, 20, 43, 51, 67, 90, 100, 108, 109, 111, 115, 116, 120, 122]);
  }, 60_000);

  it("pièce 108 : Joe vu de dos, banque JOE_E.ACT, défilement 320 sans caméra", () => {
    const { stage, engine, bobs } = enter(108);
    expect(engine.horizontalScroll).toBe(320);
    expect(bobs.cameraBob).toBe(-1);
    expect(bobs.frames.frame(31)).toEqual({ bank: "JOE_E.ACT", image: 1 });
    expect(engine.state.joe.facing).toBe(Direction.Right);
    expect(stage.bobs.bob(0).active).toBe(true);
  });

  it("parallaxe : le décor mobile de la pièce 17 glisse à demi-vitesse", () => {
    const { player, stage, engine, bobs } = enter(17);
    stage.bobs.bob(0).curPos(600, 110);
    player.run(1);
    expect(engine.horizontalScroll).toBe(320);
    expect(bobs.bob(8).x).toBe(250 - 160);
    stage.bobs.bob(0).curPos(100, 110);
    player.run(1);
    expect(bobs.bob(8).x).toBe(250);
  });

  it("une animation propre à une pièce (vague L) est appelée à chaque image", () => {
    const stage = new GameStage();
    let calls = 0;
    stage.roomUpdates.set(2, () => calls++);
    const player = new Player({ room: 2, stage });
    player.settle();
    const before = calls;
    player.run(5);
    expect(calls).toBe(before + 5);
  });
});

describe.skipIf(!hasOriginalFiles)("échelle de Joe", () => {
  it("l'échelle suit la zone pendant la marche : celle du haut, celle du bas, strictement croissante vers le bas", () => {
    const { player, stage, engine } = enter(73);
    const area = player.state.areas[73][1];
    const x = Math.trunc((area.box.x1 + area.box.x2) / 2);
    expect(areaScale(area, area.box.y1)).toBe(area.bottomScaleFactor);
    expect(areaScale(area, area.box.y2)).toBe(area.topScaleFactor);
    stage.bobs.bob(0).curPos(x, area.box.y1);
    player.state.joe.x = x;
    player.state.joe.y = area.box.y1;
    const seen: number[] = [];
    engine.run(stage.moveJoe(engine, Direction.None, x, area.box.y2, false));
    while (engine.busy) {
      player.run(1);
      seen.push(stage.bobs.bob(0).scale);
    }
    expect(seen[0]).toBeLessThanOrEqual(area.bottomScaleFactor + 3);
    expect(seen[seen.length - 1]).toBeGreaterThanOrEqual(area.topScaleFactor - 3);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    // La marche est plus lente en haut (petit Joe) qu'en bas : moins de pixels par image.
    expect(player.state.joe.y).toBe(area.box.y2);
  });

  it("à l'arrivée dans une pièce, Joe prend l'échelle de la zone où il entre", () => {
    const stage = new GameStage();
    const p = new Player({ entryObject: 8, stage });
    p.settle();
    const { state, engine } = p;
    const area = engine.grid.findAreaForPos(state.joe.x, state.joe.y);
    expect(stage.bobs.bob(0).scale).toBe(area === 0 ? 100 : areaScale(state.areas[state.room][area], state.joe.y));
  });
});

describe.skipIf(!hasOriginalFiles)("Joe : orientation, saisie, tenues", () => {
  it("se tourner : une image, deux quand il passe par le profil (face / dos, gauche / droite)", () => {
    const { player, stage, engine, bobs } = enter(2, { x: 100, y: 110 });
    const joe = engine.state.joe;
    const turn = (facing: number, prev: number) => {
      joe.facing = facing;
      joe.prevFacing = prev;
      return ticksOf(player, stage.joeFace(engine));
    };
    expect(turn(Direction.Front, Direction.Front)).toBe(1);
    expect(turn(Direction.Front, Direction.Back)).toBe(2);
    expect(turn(Direction.Back, Direction.Front)).toBe(2);
    expect(turn(Direction.Left, Direction.Right)).toBe(2);
    expect(turn(Direction.Right, Direction.Left)).toBe(2);
    expect(turn(Direction.Left, Direction.Front)).toBe(1);
    expect(joe.prevFacing).toBe(Direction.Left);
    expect(bobs.bob(0).xflip).toBe(true);
    expect(bobs.frames.frame(31)).toEqual({ bank: "JOE_B.BBK", image: 1 });
    turn(Direction.Right, Direction.Right);
    expect(bobs.bob(0).xflip).toBe(false);
    turn(Direction.Front, Direction.Front);
    expect(bobs.frames.frame(31)).toEqual({ bank: "JOE_B.BBK", image: 3 });
    turn(Direction.Back, Direction.Back);
    expect(bobs.frames.frame(31)).toEqual({ bank: "JOE_B.BBK", image: 5 });
    expect(bobs.bob(0).scale).toBe(joe.scale);
  });

  it("saisir : une image (milieu, haut), trois images vers le bas ; images de saisie selon l'orientation", () => {
    const { player, stage, engine, bobs } = enter(2, { x: 100, y: 110 });
    const joe = engine.state.joe;
    joe.facing = Direction.Right;
    expect(ticksOf(player, stage.joeGrab(engine, Grab.None))).toBe(0);
    expect(ticksOf(player, stage.joeGrab(engine, Grab.Mid))).toBe(1);
    expect(bobs.frames.frame(31)).toMatchObject({ image: 2 });
    joe.facing = Direction.Front;
    ticksOf(player, stage.joeGrab(engine, Grab.Mid));
    expect(bobs.frames.frame(31)).toMatchObject({ image: 4 });
    joe.facing = Direction.Back;
    ticksOf(player, stage.joeGrab(engine, Grab.Mid));
    expect(bobs.frames.frame(31)).toMatchObject({ image: 6 });
    expect(ticksOf(player, stage.joeGrab(engine, Grab.Down))).toBe(3);
    expect(bobs.frames.frame(31)).toMatchObject({ image: 9 });
    joe.facing = Direction.Left;
    expect(ticksOf(player, stage.joeGrab(engine, Grab.Up))).toBe(3);
    expect(bobs.frames.frame(31)).toMatchObject({ image: 7 });
    expect(bobs.bob(0).xflip).toBe(true);
  });

  it("les tenues rechargent les banques de marche et de pose", () => {
    const { stage, engine, bobs } = enter(2);
    stage.setOutfit(engine, Outfit.Dress);
    expect(bobs.frames.frame(11)).toEqual({ bank: "JOED_A.BBK", image: 1 });
    expect(bobs.frames.frame(30)).toEqual({ bank: "JOED_A.BBK", image: 20 });
    expect(bobs.frames.frame(36)).toEqual({ bank: "JOED_B.BBK", image: 3 });
    stage.setOutfit(engine, Outfit.Underwear);
    expect(bobs.frames.frame(11)).toEqual({ bank: "JOEU_A.BBK", image: 1 });
    stage.setOutfit(engine, Outfit.Normal);
    expect(bobs.frames.frame(37)).toEqual({ bank: "JOE_B.BBK", image: 5 });
    expect(stage.outfit).toBe(Outfit.Normal);
  });
  it("changer de tenue se voit à l'image suivante, sans attendre que Joe change d'image", () => {
    const { stage, engine } = enter(2, { x: 160, y: 120 });
    stage.render(engine);
    const before = stage.renderer.output.slice();
    stage.setOutfit(engine, Outfit.Dress);
    stage.render(engine);
    expect(stage.renderer.output).not.toEqual(before);
    stage.setOutfit(engine, Outfit.Normal);
    stage.render(engine);
    expect(stage.renderer.output).toEqual(before);
  });
});
