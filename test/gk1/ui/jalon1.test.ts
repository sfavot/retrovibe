import { describe, expect, it } from "vitest";
import { WebSampleOutput } from "../../../src/audio/web-sample-output";
import { decodeCp850 } from "../../../src/data/cp850";
import { EventType, KeyModifier, SciKey } from "../../../src/games/gk1/engine/events";
import { soundManagerOf } from "../../../src/games/gk1/engine/kernel/sound";
import { currentRoom, useGameClock } from "../../../src/games/gk1/engine/loop";
import { toSint16 } from "../../../src/games/gk1/engine/memory";
import { lookupSelector, newLookup, readSelector, SelectorKind } from "../../../src/games/gk1/engine/object";
import { Vm } from "../../../src/games/gk1/engine/vm";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../src/games/gk1/render/ids";
import { BrowserHost } from "../../../src/games/gk1/ui/browser-host";
import { Gk1Loop, MAX_CATCH_UP_TICKS, TICK_MS } from "../../../src/games/gk1/ui/loop";
import { TickScheduler } from "../../../src/ui/tick-scheduler";
import { FakeAudioContext } from "../../support/fake-audio-context";
import { ManualClock } from "../../support/fake-host";
import { mainIndex, original } from "../data/real";

const TITLE_ROOM = 375;
const BOOKSHOP = 210;
/** Vue des curseurs d'action, et leurs boucles : marcher, regarder. */
const ACTION_CURSOR_VIEW = 958;
const WALK_LOOP = 4;
const LOOK_LOOP = 5;
/** Vue de Gabriel quand il marche. */
const WALK_VIEW = 901;
const GLOBAL_EGO = 0;
/** Le tableau du père de Gabriel, au mur de droite. */
const PAINTING = { x: 267, y: 52 };
const MAX_FRAMES = 30000;

/** La page du jeu sans navigateur : machine virtuelle, hôte (faux contexte audio, faux synthétiseur) et boucle. */
function mount() {
  const vm = new Vm(mainIndex());
  useGameClock(vm);
  vm.boot();
  const ctx = new FakeAudioContext(false);
  const clock = new ManualClock();
  const output = new WebSampleOutput({ now: () => clock.now(), createContext: () => ctx.asContext() });
  output.unlock();
  const midi: Uint8Array[] = [];
  const host = new BrowserHost({
    vm,
    output,
    soundfontUrl: "gm.sf2",
    createSynth: () => ({ ready: true, send: (message) => void midi.push(message), reset: () => {}, load: async () => {}, close: () => {} }),
  });
  const presented: { pixels: Uint8Array; palette: Uint8Array }[] = [];
  const loop = new Gk1Loop({
    vm,
    present: (pixels, palette) => void (presented.length = 0, presented.push({ pixels, palette })),
    beforeFrame: () => {
      host.music.beginFrame();
      ctx.currentTime += TICK_MS / 1000;
    },
  });
  let frames = 0;
  const step = (count = 1): void => {
    for (let i = 0; i < count; i++) {
      if (++frames > MAX_FRAMES) throw new Error(`parcours trop long (pièce ${currentRoom(vm)})`);
      loop.tick();
      expect(loop.finished).toBe(false);
    }
  };
  const until = (done: () => boolean, each = 1, between?: () => void): void => {
    while (!done()) {
      between?.();
      step(each);
    }
  };
  const frameout = frameoutOf(vm);
  const item = (name: string) => frameout.planes.flatMap((plane) => plane.items).find((candidate) => candidate.object !== 0 && vm.nameOf(candidate.object) === name);
  return { vm, ctx, host, loop, midi, presented, step, until, frameout, item };
}

/** Textes des fenêtres de texte à l'écran (éléments qui montrent un bitmap et ont une propriété `text`). */
function shownTexts(vm: Vm): string[] {
  const selector = vm.selectors.id("text");
  const out: string[] = [];
  for (const plane of frameoutOf(vm).planes) {
    for (const item of plane.items) {
      const object = item.object !== 0 && item.bitmap !== 0 ? vm.memory.getObject(item.object) : undefined;
      if (!object || lookupSelector(vm.memory, object, selector, newLookup()) !== SelectorKind.Variable) continue;
      const raw = vm.memory.getString(readSelector(vm.memory, item.object, selector));
      out.push(decodeCp850(Uint8Array.from(raw, (char) => char.charCodeAt(0))));
    }
  }
  return out;
}

describe("cadence de la page", () => {
  it("60 images du jeu par seconde sur l'ordonnanceur commun, rattrapage borné", () => {
    const scheduler = new TickScheduler(TICK_MS, MAX_CATCH_UP_TICKS);
    let ticks = scheduler.due(0);
    for (let now = 1; now <= 1000; now++) ticks += scheduler.due(now);
    expect(ticks).toBeGreaterThanOrEqual(59);
    expect(ticks).toBeLessThanOrEqual(61);
    // Onglet resté dix secondes en arrière-plan : pas de défilement en accéléré au retour.
    expect(scheduler.due(11_000)).toBeLessThanOrEqual(MAX_CATCH_UP_TICKS);
  });
});

describe.skipIf(!original.has)("hôte du navigateur", () => {
  it("souris, doigt et clavier arrivent dans la file des évènements du jeu ; le volume et la pause vont à la sortie audio", () => {
    const { vm, host, ctx, step } = mount();
    step(5);
    const events = host.input;
    const next = () => events.next(EventType.MousePress | EventType.MouseRelease | EventType.KeyDown | EventType.KeyUp);

    // Souris : bouton droit = Maj (curseur suivant), positions bornées à l'écran.
    host.input.down(2, 400.7, -3);
    host.input.up(2, 400.7, -3);
    expect(next()).toMatchObject({ type: EventType.MousePress, modifiers: KeyModifier.Shift, x: SCREEN_WIDTH - 1, y: 0 });
    expect(next()).toMatchObject({ type: EventType.MouseRelease, modifiers: KeyModifier.Shift });

    // Doigt : toucher = clic gauche, appui long = clic droit, là où le doigt est posé.
    host.tap(0, 100, 150);
    expect(next()).toMatchObject({ type: EventType.MousePress, modifiers: KeyModifier.None, x: 100, y: 150 });
    expect(next()).toMatchObject({ type: EventType.MouseRelease, x: 100, y: 150 });
    host.tap(2, 20, 30);
    expect(next()).toMatchObject({ type: EventType.MousePress, modifiers: KeyModifier.Shift, x: 20, y: 30 });
    expect(next()).toMatchObject({ type: EventType.MouseRelease, modifiers: KeyModifier.Shift });

    // Clavier : une touche connue va au jeu ; une touche sans code SCI, ou un raccourci du système, reste au navigateur.
    const enter = host.key({ key: "Enter", code: "Enter" } as KeyboardEvent);
    expect(enter).toBeDefined();
    (enter as { engine(): void }).engine();
    expect(next()).toMatchObject({ type: EventType.KeyDown, message: SciKey.Enter });
    expect(host.keyUp({ key: "Enter", code: "Enter" } as KeyboardEvent)).toBe(true);
    expect(next()).toMatchObject({ type: EventType.KeyUp, message: SciKey.Enter });
    expect(host.key({ key: "Shift", code: "ShiftLeft" } as KeyboardEvent)).toBeUndefined();
    expect(host.key({ key: "r", code: "KeyR", metaKey: true } as KeyboardEvent)).toBeUndefined();
    expect(host.keyUp({ key: "Shift", code: "ShiftLeft" } as KeyboardEvent)).toBe(false);

    // Pause : le bouton tenu est relâché, le contexte audio suspendu ; reprise.
    host.input.down(0, 10, 10);
    expect(next().type).toBe(EventType.MousePress);
    host.setPaused(true);
    expect(next().type).toBe(EventType.MouseRelease);
    host.setPaused(false);
    expect(ctx.suspends).toBe(0); // La suspension est mise en file : elle n'a pas encore eu lieu, la reprise l'annule ou la suit.

    host.setUserVolume(0.25);
    expect(host.volume).toBe(0.25);
    expect(soundManagerOf(vm).clock).toBeDefined();
  });
});

describe.skipIf(!original.has)("Jalon 1 : la page du jeu, du titre à la librairie", () => {
  it("JOUER au doigt, scène d'ouverture, puis un clic « regarder » et un déplacement, avec la musique", { timeout: 180_000 }, () => {
    const { vm, host, loop, midi, presented, step, until, frameout, item } = mount();
    const cursor = frameout.cursor;

    // Écran titre : la musique part dès que la sortie est prête ; l'image présentée est celle du compositeur, curseur compris.
    until(() => currentRoom(vm) === TITLE_ROOM && item("playButt") !== undefined);
    step(120);
    expect(midi.some((message) => (message[0] & 0xf0) === 0x90 && message[2] > 0)).toBe(true);
    loop.render();
    expect(presented[0].pixels).toHaveLength(SCREEN_WIDTH * SCREEN_HEIGHT);
    expect(presented[0].palette).toBe(frameout.palette.screen);
    expect(loop.canSkip).toBe(false);
    expect(loop.canSave).toBe(true);

    // JOUER, d'un toucher.
    const play = item("playButt")!.screenRect;
    until(() => currentRoom(vm) !== TITLE_ROOM, 20, () => host.tap(0, play.left + 5, play.top + 3));

    // « Jour 1 », le rêve, le dialogue d'ouverture : un toucher ferme chaque fenêtre de texte, jusqu'à ce que le jeu rende la main.
    until(() => currentRoom(vm) === BOOKSHOP && cursor.view === ACTION_CURSOR_VIEW && item("GKEgo")?.view === WALK_VIEW, 40, () => host.tap(0, 160, 100));
    step(60);
    expect(shownTexts(vm)).toEqual([]);

    // Regarder : le curseur de départ ; un clic sur le tableau affiche sa description, en français.
    expect([cursor.view, cursor.loop]).toEqual([ACTION_CURSOR_VIEW, LOOK_LOOP]);
    host.input.move(PAINTING.x, PAINTING.y);
    step(3);
    host.input.down(0, PAINTING.x, PAINTING.y);
    host.input.up(0, PAINTING.x, PAINTING.y);
    until(() => shownTexts(vm).length > 0);
    expect(shownTexts(vm)).toEqual(['"Trois Serpents dans un Crâne." C\'est le père de Gabriel qui l\'a peint.']);
    until(() => shownTexts(vm).length === 0, 20, () => host.tap(0, 160, 100));
    step(30);

    // Barre d'icônes au doigt (D7) : un toucher au-dessus de la pièce ne fait que poser le curseur, la barre s'ouvre.
    const ego = vm.memory.localsSegment(vm.scripts.loaded(0)!.localsSegment)!.values[GLOBAL_EGO];
    const position = () => ({ x: toSint16(readSelector(vm.memory, ego, vm.selectors.id("x"))), y: toSint16(readSelector(vm.memory, ego, vm.selectors.id("y"))) });
    const start = position();
    const planes = (): number => frameout.planes.filter((plane) => plane.priority >= 0).length;
    const closed = planes();
    host.tap(0, 160, 3);
    expect(host.input.pending).toBe(0);
    step(60);
    expect(planes()).toBe(closed + 1);
    expect(position()).toEqual(start);
    // Le toucher suivant choisit une icône : « marcher » (la botte), et la barre se referme.
    const boot = item("icon2")!.screenRect;
    host.tap(0, boot.left + 8, boot.top + 6);
    step(30);
    expect(planes()).toBe(closed);
    expect([cursor.view, cursor.loop]).toEqual([ACTION_CURSOR_VIEW, WALK_LOOP]);

    // Marcher : un toucher sur le plancher, Gabriel y va (trajet détaillé dans `engine/walk.test.ts`).
    host.tap(0, 280, 140);
    until(() => readSelector(vm.memory, ego, vm.selectors.id("mover")) !== 0);
    // Il s'arrête un instant à chaque coin pour se tourner : l'arrivée est une demi-seconde sans bouger.
    for (let still = 0, last = position(); still < 30; still++) {
      step();
      const at = position();
      if (at.x !== last.x || at.y !== last.y) still = 0;
      last = at;
    }
    expect(position()).toEqual({ x: 280, y: 130 });

    // Appui long = bouton droit : curseur suivant.
    host.tap(2, 150, 120);
    step(10);
    expect([cursor.view, cursor.loop]).not.toEqual([ACTION_CURSOR_VIEW, WALK_LOOP]);
    expect(currentRoom(vm)).toBe(BOOKSHOP);
    // Une image du jeu par tick de la page, à l'horloge du jeu près (tranches épuisées).
    expect(vm.ticks).toBeGreaterThanOrEqual(loop.frames);
  });
});
