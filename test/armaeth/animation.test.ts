import { describe, expect, it } from "vitest";
import type { Sprite, SpriteFig, SpriteSequence } from "../../src/games/armaeth/data/sprite";
import { SPRITE_FAMILIES, parseAni, parseDef, type AniTable } from "../../src/games/armaeth/data/tables";
import { readCountedArchive } from "../../src/games/armaeth/data/vga-archive";
import {
  type SpriteKey,
  type SpriteSource,
  SpriteLibrary,
  animStep,
  currentFrame,
  loadObjectSprite,
  randomizeDecorPhase,
  setFig,
  spriteKeyOf,
  startScriptedAnimation,
  tickScriptedAnimation,
} from "../../src/games/armaeth/engine/animation";
import { RAW_OFFSET, type GameObject, WorldState, rawU16 } from "../../src/games/armaeth/engine/state";
import { hasOriginalFiles, readOriginal } from "./helpers";
import type { World } from "../../src/games/armaeth/data/world";

/** Monde vide : trois salles (0 = cadre), aucun objet. */
function emptyWorld(): World {
  const room = (id: number) => ({
    id, lightOffset: 0, outdoor: 1, musicClass: 0x4d, musicId: 0, musicNumber: 0, exits: [0, 0, 0, 0, 0, 0], barriers: [0, 0, 0, 0, 0, 0], words: new Array(21).fill(0),
  });
  return {
    header: { words: new Array(27).fill(0), lastSerial: 0, dictionaryLetters: 8, chapterLevel: 3, score: 0, heroSerial: 0, currentRoom: 1, objectCount: 0, roomCount: 3 },
    scoreTable: [{ id: 0, points: 10, sound: 0, repeats: 0 }],
    deferredEvents: { capacity: 4, events: [] },
    rooms: [room(0), room(1), room(2)],
    objects: [],
  };
}

const seq = (start: number, steps: [number, number, boolean?][]): SpriteSequence => ({
  start,
  headerHigh: 0,
  steps: steps.map(([frame, duration, mirror]) => ({ frame, duration, mirror: mirror ?? false })),
});

/** Ressource `OBJ` 7 : Fig 0 = marche (droite 3 images de durées 1, 2, 1 ; gauche idem en miroir ; avant : 2 images, la 2e en miroir ; fond : 1 image). */
function fakeSprite(): Sprite {
  const walk = seq(0, [[0, 1], [1, 2], [2, 1]]);
  const fig: SpriteFig = {
    index: 0,
    mirrorLeft: 255,
    dpX: 2,
    dpY: 4,
    directions: [walk, walk, seq(4, [[3, 1], [3, 1, true]]), seq(7, [[4, 3]])],
  };
  const frames = Array.from({ length: 5 }, (_, i) => ({ width: 4 + i, height: 6, pixels: new Uint8Array((4 + i) * 6) }));
  return { id: 2007, frames, animation: { records: 1, words: 0, bytes: new Uint8Array(), figs: [fig] }, memoryPointers: new Uint8Array() };
}

function source(sprites: Record<string, Sprite>): SpriteSource {
  return { get: (key: SpriteKey) => sprites[`${key.family}${key.id}`] };
}

function newObject(fields: Partial<GameObject> & { typ?: number } = {}): { state: WorldState; obj: GameObject } {
  const state = new WorldState(emptyWorld());
  const obj = state.createObject({ typ: 2, num: 7, ...fields });
  return { state, obj };
}

describe("animStep : cas synthétiques", () => {
  const sprites = source({ OBJ7: fakeSprite() });

  it("choisit la ressource d'après Typ, Num et Anm", () => {
    expect(spriteKeyOf({ typ: 0, num: 4, animId: 0 })).toEqual({ family: "INT", id: 4 });
    expect(spriteKeyOf({ typ: 1, num: 9, animId: 0 })).toEqual({ family: "DEC", id: 9 });
    expect(spriteKeyOf({ typ: 2, num: 7, animId: 0 })).toEqual({ family: "OBJ", id: 7 });
    expect(spriteKeyOf({ typ: 2, num: 7, animId: 12 })).toEqual({ family: "ANM", id: 12 });
    expect(spriteKeyOf({ typ: 9, num: 7, animId: 0 })).toBeUndefined();
  });

  it("l'objet à l'arrêt ne bouge pas sans force, la direction mémorisée est gardée avec force", () => {
    const { obj } = newObject();
    expect(animStep(obj, sprites, 0)).toBe(false);
    obj.anim.dir = 3;
    expect(animStep(obj, sprites, 7)).toBe(true);
    expect(obj.anim).toMatchObject({ dir: 3, frame: 4, remaining: 3, total: 1, index: 1, dpX: 2, dpY: 4 });
  });

  it("marche à droite : durées 1, 2, 1 puis boucle", () => {
    const { obj } = newObject({ speedX: 1 });
    const frames: number[] = [];
    animStep(obj, sprites, 7);
    for (let t = 0; t < 9; t++) {
      frames.push(obj.anim.frame);
      animStep(obj, sprites, 0);
    }
    expect(frames).toEqual([0, 1, 1, 2, 0, 1, 1, 2, 0]);
    expect(obj.anim.mirror).toBe(0);
  });

  it("vers la gauche : même séquence, miroir de direction", () => {
    const { obj } = newObject({ speedX: -1 });
    animStep(obj, sprites, 7);
    expect(obj.anim).toMatchObject({ dir: 1, frame: 0, mirror: 1 });
  });

  it("miroir de pas combiné par XOR, vers l'avant", () => {
    const { obj } = newObject({ speedP: 1 });
    animStep(obj, sprites, 7);
    expect(obj.anim).toMatchObject({ dir: 2, frame: 3, mirror: 0 });
    animStep(obj, sprites, 0);
    expect(obj.anim).toMatchObject({ frame: 3, mirror: 1, index: 2 });
  });

  it("un changement de direction relance la séquence au pas 1", () => {
    const { obj } = newObject({ speedX: 1 });
    animStep(obj, sprites, 7);
    animStep(obj, sprites, 0);
    animStep(obj, sprites, 0);
    expect(obj.anim.index).toBe(2);
    obj.speedX = 0;
    obj.speedP = -1;
    animStep(obj, sprites, 0);
    expect(obj.anim).toMatchObject({ dir: 3, index: 1, frame: 4 });
  });

  it("Dep 4 immobile en vertical se tourne vers le fond", () => {
    const { obj } = newObject({ dep: 4, speedY: 1 });
    obj.anim.dir = 0;
    animStep(obj, sprites, 0);
    expect(obj.anim.dir).toBe(3);
  });

  it("Fig sans enregistrement : rien ne change ; setFig relance la séquence", () => {
    const { obj } = newObject({ speedX: 1, fig: 5 });
    expect(animStep(obj, sprites, 7)).toBe(false);
    loadObjectSprite(obj, sprites);
    expect(obj.anim.frame).toBe(-1);
    expect(currentFrame(obj, sprites)).toBeUndefined();
    setFig(obj, sprites, 0);
    expect(obj.anim.frame).toBe(0);
    expect(obj.anim.dpP).toBe(1);
    expect(currentFrame(obj, sprites)?.width).toBe(4);
  });

  it("phase aléatoire d'un décor : Ind = rand % Tot + 1, puis un pas", () => {
    const { obj } = newObject({ speedX: 1 });
    randomizeDecorPhase(obj, sprites, () => 4); // 4 % 3 + 1 = 2, puis pas suivant -> 3
    expect(obj.anim).toMatchObject({ index: 3, frame: 2 });
  });
});

/** Table ANI synthétique : animation 5 = deux pas (Fig 1 x 2 boucles, Fig 2 x 1), son de classe A (7, 27). */
function fakeAni(): AniTable {
  const words = Uint16Array.of((1 << 8) | 2, (2 << 8) | 1);
  return {
    records: [{ id: 5, kind: 65, unknown2: 7, unknown3: 27, steps: 2, start: 0 }],
    words,
    sequence: () => words,
  };
}

describe("animations scénarisées", () => {
  const anm = fakeSprite();
  anm.animation.figs = [0, 1, 2].map((index) => ({ ...anm.animation.figs[0], index, directions: [seq(0, [[index, 1]]), seq(0, [[index, 1]]), seq(0, [[index, 1]]), seq(0, [[index, 1]])] as SpriteFig["directions"] }));
  const sprites = source({ OBJ7: fakeSprite(), ANM5: anm });

  it("démarre, enchaîne les pas selon les boucles puis rend l'id et coupe le son", () => {
    const { state, obj } = newObject();
    const partner = state.createObject({ typ: 2, num: 8 });
    const events = startScriptedAnimation(obj, sprites, fakeAni(), { id: 5, gst: 7, mob: 1, ego: 6, hor: 0, ver: 1, prf: 0, partner, audible: true });
    expect(events).toEqual([{ type: "sound", soundClass: "A", id: 7, number: 27, loop: true }]);
    expect(obj).toMatchObject({ animId: 5, gst: 7, mob: 1, ego: 6, speedY: 1, fig: 1 });
    expect(rawU16(obj, RAW_OFFSET.tim)).toBe(2);
    expect(rawU16(obj, RAW_OFFSET.nbr)).toBe(2);
    expect(rawU16(obj, RAW_OFFSET.bag)).toBe(partner.serial);
    expect(rawU16(partner, RAW_OFFSET.bag)).toBe(obj.serial);
    expect(spriteKeyOf(obj)).toEqual({ family: "ANM", id: 5 });

    const finished: number[] = [];
    const figs: number[] = [];
    for (let t = 0; t < 6 && finished.length === 0; t++) {
      animStep(obj, sprites, 0);
      figs.push(obj.fig);
      const tick = tickScriptedAnimation(obj, sprites, fakeAni(), true);
      if (tick.finished) {
        finished.push(tick.finished);
        expect(tick.events).toEqual([{ type: "soundStop" }]);
      }
    }
    expect(finished).toEqual([5]);
    expect(figs).toEqual([1, 1, 2]);
    expect(obj.animId).toBe(0);
    expect(spriteKeyOf(obj)).toEqual({ family: "OBJ", id: 7 });
  });

  it("hors de la salle active la séquence est toujours terminée ; sans son pour un objet inaudible", () => {
    const { obj } = newObject();
    expect(startScriptedAnimation(obj, sprites, fakeAni(), { id: 5, gst: 7, mob: 1, ego: 6, hor: 0, ver: 0, prf: 0, audible: false })).toEqual([]);
    expect(tickScriptedAnimation(obj, sprites, fakeAni(), false).finished).toBe(0); // Tim 2 -> 1
    expect(tickScriptedAnimation(obj, sprites, fakeAni(), false).finished).toBe(0); // Tim 0 -> pas 2
    expect(obj.fig).toBe(2);
    expect(tickScriptedAnimation(obj, sprites, fakeAni(), false).finished).toBe(5);
  });
});

describe.skipIf(!hasOriginalFiles)("animation sur les ressources du jeu", () => {
  const archives = Object.fromEntries(
    SPRITE_FAMILIES.map((f) => [f, readCountedArchive(readOriginal(`A1F${f}.VGA`))]),
  ) as ConstructorParameters<typeof SpriteLibrary>[0];
  const def = parseDef(readOriginal("A1FDEF.SYS"));
  const library = new SpriteLibrary(archives, def);
  const velocity = [
    { speedX: 1, speedP: 0 },
    { speedX: -1, speedP: 0 },
    { speedX: 0, speedP: 1 },
    { speedX: 0, speedP: -1 },
  ];
  const typeOf = { INT: 0, DEC: 1, OBJ: 2, ANM: 2 } as const;

  it("DEF décide des ressources existantes", () => {
    expect(library.has({ family: "OBJ", id: 1 })).toBe(true);
    expect(library.has({ family: "OBJ", id: 307 })).toBe(false);
    expect(library.get({ family: "OBJ", id: 307 })).toBeUndefined();
    expect(library.defRecord({ family: "ANM", id: 47 })?.id).toBe(47);
  });

  it("chaque Fig et chaque direction de chaque ressource avance sans erreur et rejoue sa séquence", () => {
    const state = new WorldState(emptyWorld());
    let checked = 0;
    for (const family of SPRITE_FAMILIES) {
      for (const entry of archives[family].entries) {
        const sprite = library.get({ family, id: entry.id })!;
        sprite.animation.figs.forEach((fig, figIndex) => {
          for (let d = 0; d < 4; d++) {
            const obj = state.createObject({ typ: typeOf[family], num: entry.id, animId: family === "ANM" ? entry.id : 0, fig: figIndex, ...velocity[d] });
            const steps = fig.directions[d].steps;
            expect(animStep(obj, library, 7)).toBe(true);
            const seen: number[] = [];
            for (let i = 0; i < steps.length * 2; i++) {
              const step = steps[i % steps.length];
              expect(obj.anim.frame).toBe(step.frame);
              expect(obj.anim.mirror).toBe(step.mirror !== (d === 1 && fig.mirrorLeft !== 0) ? 1 : 0);
              expect(obj.anim.index).toBe((i % steps.length) + 1);
              for (let t = 0; t < step.duration; t++) {
                expect(obj.anim.remaining).toBe(step.duration - t);
                animStep(obj, library, 0);
              }
              seen.push(step.frame);
            }
            checked++;
            state.deleteObject(obj);
          }
        });
      }
    }
    expect(checked).toBe(1844);
  });

  it("le héros marche : 8 images de 1 tic de profil (miroir à gauche), 6 en profondeur (3 puis les mêmes en miroir)", () => {
    const state = new WorldState(emptyWorld());
    const hero = state.createObject({ typ: 2, num: 1, fig: 0, speedX: 1 });
    animStep(hero, library, 7);
    const right: number[] = [];
    for (let t = 0; t < 16; t++) {
      right.push(hero.anim.frame);
      animStep(hero, library, 0);
    }
    expect(right).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7]);
    expect(hero.anim).toMatchObject({ dpX: 2, dpY: 4, mirror: 0 });
    hero.speedX = -1;
    animStep(hero, library, 0);
    expect(hero.anim).toMatchObject({ dir: 1, frame: 0, mirror: 1 });
    hero.speedX = 0;
    hero.speedP = 1;
    animStep(hero, library, 0);
    const depth: [number, number][] = [];
    for (let t = 0; t < 6; t++) {
      depth.push([hero.anim.frame, hero.anim.mirror]);
      animStep(hero, library, 0);
    }
    expect(depth).toEqual([[8, 0], [9, 0], [10, 0], [8, 1], [9, 1], [10, 1]]);
    // Fig 2 : durées de 2 tics
    hero.fig = 2;
    hero.speedP = 0;
    hero.speedX = 1;
    animStep(hero, library, 7);
    const slow: number[] = [];
    for (let t = 0; t < 6; t++) {
      slow.push(hero.anim.frame);
      animStep(hero, library, 0);
    }
    expect(slow).toEqual([28, 28, 29, 29, 30, 30]);
  });

  it("ANI : les 47 animations se jouent jusqu'à leur fin avec le total de boucles de leurs pas", () => {
    const ani = parseAni(readOriginal("A1FANI.SYS"));
    const state = new WorldState(emptyWorld());
    for (const record of ani.records) {
      const obj = state.createObject({ typ: 2, num: 1 });
      startScriptedAnimation(obj, library, ani, { id: record.id, gst: 7, mob: 1, ego: 6, hor: 0, ver: 1, prf: 0, audible: true });
      const expected = [...ani.sequence(record.id)].reduce((sum, w) => sum + (w & 0xff), 0);
      // chaque boucle d'une séquence dure la somme de ses durées de pas
      let tics = 0;
      let done = 0;
      while (!done && tics < 100000) {
        animStep(obj, library, 0);
        done = tickScriptedAnimation(obj, library, ani, true).finished;
        tics++;
      }
      expect(done, `ANI ${record.id}`).toBe(record.id);
      expect(tics).toBeGreaterThanOrEqual(expected);
      state.deleteObject(obj);
    }
  });
});
