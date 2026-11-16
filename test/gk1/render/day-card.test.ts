import { describe, expect, it } from "vitest";
import { eventsOf } from "../../../src/games/gk1/engine/events";
import { CONFIG_LANGUAGE, GAME_SCRIPT } from "../../../src/games/gk1/engine/ids";
import { soundManagerOf } from "../../../src/games/gk1/engine/kernel/sound";
import { currentRoom, runFrame, useGameClock } from "../../../src/games/gk1/engine/loop";
import { toSint16 } from "../../../src/games/gk1/engine/memory";
import { readSelector } from "../../../src/games/gk1/engine/object";
import { Vm } from "../../../src/games/gk1/engine/vm";
import { type Frameout, frameoutOf } from "../../../src/games/gk1/render/frameout";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../src/games/gk1/render/ids";
import { clipRect, isEmptyRect, makeRect, rectContains, rectsIntersect } from "../../../src/games/gk1/render/rect";
import type { ScreenItem } from "../../../src/games/gk1/render/screen-item";
import { fnv1a, mainIndex, original } from "../data/real";

const TITLE_ROOM = 375;
/** Pièce du carton « Jour N » des jours 1 à 7 ; les jours 8, 9 et 10 ont le leur en Allemagne, en Afrique et à la librairie. */
const DAY_CARD_ROOM = 370;
/** Vue du carton : boucle 0, le mot « JOUR » qui se dévoile ; boucle N, le chiffre N qui se trace ; boucle 10, le zéro. */
const DAY_VIEW = 375;
/** Globales des scripts : jour en cours ; pièce demandée, où `Game::doit` emmène le jeu. */
const GLOBAL_DAY = 123;
const GLOBAL_NEW_ROOM = 13;
const MAX_FRAMES = 6000;
/** Position française du mot et du chiffre (`proc13_6` : troisième valeur, `printLang` 33). */
const WORD_AT = [45, 50];
const DIGIT_AT = [250, 52];

/** Une partie lancée depuis l'écran titre, arrêtée à l'entrée de la pièce du carton, jour forcé à `day`. */
class Game {
  readonly vm = new Vm(mainIndex());
  readonly frameout: Frameout;
  private frames = 0;

  constructor(day: number) {
    useGameClock(this.vm);
    this.vm.boot();
    this.frameout = frameoutOf(this.vm);
    const events = eventsOf(this.vm);
    while (!(currentRoom(this.vm) === TITLE_ROOM && this.item("playButt"))) this.step();
    this.step(120);
    const play = this.item("playButt")!.screenRect;
    while (currentRoom(this.vm) === TITLE_ROOM) {
      this.globals[GLOBAL_DAY] = day;
      events.move(play.left + 5, play.top + 3);
      events.down(0, play.left + 5, play.top + 3);
      events.up(0, play.left + 5, play.top + 3);
      this.step(20);
    }
    expect(currentRoom(this.vm)).toBe(DAY_CARD_ROOM);
  }

  get globals(): Uint32Array {
    return this.vm.memory.localsSegment(this.vm.scripts.loaded(GAME_SCRIPT)!.localsSegment)!.values;
  }

  step(count = 1): void {
    for (let i = 0; i < count; i++) {
      if (++this.frames > MAX_FRAMES) throw new Error(`carton jamais atteint (pièce ${currentRoom(this.vm)})`);
      runFrame(this.vm);
      soundManagerOf(this.vm).advanceTo(this.vm.ticks);
    }
  }

  item(name: string): ScreenItem | undefined {
    return this.frameout.planes.flatMap((plane) => plane.items).find((candidate) => candidate.object !== 0 && this.vm.nameOf(candidate.object) === name);
  }

  /** Demande une autre pièce, comme le ferait un script, et attend d'y être. */
  goTo(room: number): void {
    this.globals[GLOBAL_NEW_ROOM] = room;
    while (currentRoom(this.vm) !== room) this.step();
  }

  /** Attend que ces éléments soient tous à l'écran, sur le dernier cel de leur boucle, et les rend. */
  settled(names: readonly string[]): ScreenItem[] {
    const done = (): boolean =>
      names.every((name) => {
        const item = this.item(name);
        return item !== undefined && item.cel === this.frameout.cels.view(item.view)!.loops[item.loop].cels.length - 1;
      });
    while (!done()) this.step();
    this.step(10);
    return names.map((name) => this.item(name)!);
  }

  /** Nombre de pixels de l'écran où les deux éléments ont chacun un pixel opaque. */
  sharedPixels(a: ScreenItem, b: ScreenItem): number {
    const plane = this.frameout.locate(a.object)!.plane.gameRect;
    const both = clipRect(a.screenRect, b.screenRect);
    let shared = 0;
    for (let y = both.top; y < both.bottom; y++) {
      for (let x = both.left; x < both.right; x++) {
        if (this.frameout.isOnMe(a.object, x - plane.left, y - plane.top, true) && this.frameout.isOnMe(b.object, x - plane.left, y - plane.top, true)) shared++;
      }
    }
    return shared;
  }
}

const SCREEN = makeRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
const place = (item: ScreenItem): number[] => [item.view, item.loop, item.x, item.y];

describe.skipIf(!original.has)("carton « Jour 1 » de l'ouverture", () => {
  it("la langue de RESOURCE.CFG est dans printLang : « JOUR » et « 1 » sont posés côte à côte, à la mise en page française", { timeout: 60_000 }, () => {
    const game = new Game(1);
    const { vm, frameout } = game;
    // L'objet du jeu vaut 1 (anglais) dans les scripts : c'est l'interpréteur qui y range la langue du CD.
    expect(toSint16(readSelector(vm.memory, vm.gameObject, vm.selectors.id("printLang")))).toBe(CONFIG_LANGUAGE);

    // Le mot se dévoile (cels 0 à 7), puis le chiffre se trace (cels 0 à 2).
    const [day, dayNumber] = game.settled(["day", "dayNumber"]);
    expect([day.view, day.loop, day.cel, day.x, day.y]).toEqual([DAY_VIEW, 0, 7, ...WORD_AT]);
    expect([dayNumber.view, dayNumber.loop, dayNumber.cel, dayNumber.x, dayNumber.y]).toEqual([DAY_VIEW, 1, 2, ...DIGIT_AT]);
    // Sur une ligne, le chiffre à droite du mot, sans chevauchement (en anglais : (76, 68) et (88, 115), l'un sur l'autre avec le mot français, plus large).
    expect(day.screenRect).toEqual({ left: 26, top: 60, right: 208, bottom: 123 });
    expect(dayNumber.screenRect).toEqual({ left: 242, top: 62, right: 270, bottom: 120 });
    expect(rectsIntersect(day.screenRect, dayNumber.screenRect)).toBe(false);
    // Image de référence : fond de nuit, « JOUR 1 » rouge, avant le texte du rêve.
    expect(fnv1a(frameout.present())).toBe(164941228);
    expect([...vm.warnings.keys()]).toEqual([]);
  });
});

describe.skipIf(!original.has)("cartons « Jour 2 » à « Jour 10 », mise en page française", () => {
  /** Le mot et chaque chiffre : entiers à l'écran, sur une ligne, sans se toucher. */
  function expectLaidOut(game: Game, word: ScreenItem, digits: readonly ScreenItem[]): void {
    for (const item of [word, ...digits]) {
      expect(isEmptyRect(item.screenRect)).toBe(false);
      expect(rectContains(SCREEN, item.screenRect)).toBe(true);
      // Entier : le rectangle visible a la taille du cel (rien de rogné par le bord du plan).
      const cel = game.frameout.cels.viewCel(item.view, item.loop, item.cel)!;
      expect([item.screenRect.right - item.screenRect.left, item.screenRect.bottom - item.screenRect.top]).toEqual([cel.width, cel.height]);
    }
    for (const digit of digits) {
      expect(rectsIntersect(word.screenRect, digit.screenRect)).toBe(false);
      expect(digit.screenRect.left).toBeGreaterThan(word.screenRect.right);
      expect(Math.abs(digit.screenRect.bottom - word.screenRect.bottom)).toBeLessThanOrEqual(3);
    }
  }

  it.each([2, 3, 4, 5, 6, 7])("jour %i (pièce 370) : le chiffre du jour, à droite du mot", { timeout: 60_000 }, (day) => {
    const game = new Game(day);
    const [word, digit] = game.settled(["day", "dayNumber"]);
    expect(place(word)).toEqual([DAY_VIEW, 0, ...WORD_AT]);
    expect(place(digit)).toEqual([DAY_VIEW, day, ...DIGIT_AT]);
    expectLaidOut(game, word, [digit]);
    // La troisième ligne du carton (`dayPeriod`) n'existe qu'en allemand.
    expect(game.item("dayPeriod")).toBeUndefined();
    expect([...game.vm.warnings.keys()]).toEqual([]);
  });

  it.each([
    [8, 500, "day", "eight"],
    [9, 700, "theDay", "theDayNum"],
  ])("jour %i (pièce %i) : même mise en page que la pièce 370", { timeout: 60_000 }, (day, room, wordName, digitName) => {
    const game = new Game(day);
    game.goTo(room);
    const [word, digit] = game.settled([wordName, digitName]);
    expect(place(word)).toEqual([DAY_VIEW, 0, ...WORD_AT]);
    // Pièce 700 : `theDayNum::init` passe six valeurs à `proc13_6` pour `y` ; la française, la troisième, est bien 52.
    expect(place(digit)).toEqual([DAY_VIEW, day, ...DIGIT_AT]);
    expectLaidOut(game, word, [digit]);
    expect(game.item("dayPeriod")).toBeUndefined();
    expect([...game.vm.warnings.keys()]).toEqual([]);
  });

  it("jour 10 (pièce 216) : « 1 » et « 0 » côte à côte, le mot décalé à gauche pour leur faire de la place", { timeout: 60_000 }, () => {
    const game = new Game(10);
    game.goTo(216);
    const [word, one, zero] = game.settled(["day", "one", "zero"]);
    expect(place(word)).toEqual([DAY_VIEW, 0, 35, 50]);
    expect(place(one)).toEqual([DAY_VIEW, 1, ...DIGIT_AT]);
    expect(place(zero)).toEqual([DAY_VIEW, 10, 275, 52]);
    expectLaidOut(game, word, [one, zero]);
    // Les deux chiffres penchés : leurs rectangles se recouvrent de deux colonnes, pas leurs pixels.
    expect(clipRect(one.screenRect, zero.screenRect)).toEqual({ left: 268, top: 62, right: 270, bottom: 120 });
    expect(game.sharedPixels(one, zero)).toBe(0);
    expect(zero.screenRect.right).toBe(301);
  });
});
