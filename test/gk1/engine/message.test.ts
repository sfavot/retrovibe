import { describe, expect, it } from "vitest";
import { decodeCp850 } from "../../../src/data/cp850";
import { ResourceType } from "../../../src/games/gk1/data/ids";
import { findMessage, type MessageEntry, type MessageResource, type MessageTuple, readMessages } from "../../../src/games/gk1/data/message";
import { eventsOf, MouseButton, SciKey } from "../../../src/games/gk1/engine/events";
import { ArrayType, MessageMode } from "../../../src/games/gk1/engine/ids";
import { MessageOp } from "../../../src/games/gk1/engine/kernel/message";
import { currentRoom, runFrame, useGameClock } from "../../../src/games/gk1/engine/loop";
import { SciArray, SciError, SIGNAL_REG } from "../../../src/games/gk1/engine/memory";
import { formatMessageText, messageModeOf, messagesOf, narratorVoiceOf, setMessageMode } from "../../../src/games/gk1/engine/message";
import { lookupSelector, newLookup, readSelector, SelectorKind } from "../../../src/games/gk1/engine/object";
import { remapKey } from "../../../src/games/gk1/engine/patches";
import { RunStatus, Vm } from "../../../src/games/gk1/engine/vm";
import { GK1_FIXES } from "../../../src/games/gk1/game/fixes";
import { frameoutOf } from "../../../src/games/gk1/render/frameout";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "../../../src/games/gk1/render/ids";
import { mainIndex, original } from "../data/real";
import { Scene } from "../render/scene";

const MESSAGE_COUNT = 10982;
const REFERENCE_COUNT = 2441;
const MODULE_COUNT = 77;
const STAGE_DIRECTION_COUNT = 140;
/** Module sans ressource message (il n'a qu'un clip de voix). */
const MODULE_WITHOUT_MESSAGES = 339;
const TITLE_ROOM = 375;
const DREAM_ROOM = 370;
const BOOKSHOP = 210;
const NARRATOR = 99;

const bytes = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const unicode = (text: string): string => decodeCp850(bytes(text));

/** Noyau `Message` sur les ressources réelles, avec un tampon de chaîne et un tableau d'entiers. */
function stage() {
  const scene = new Scene();
  const { vm } = scene;
  const buffer = vm.memory.arrays.allocate(new SciArray(ArrayType.String, 1));
  const keys = vm.memory.arrays.allocate(new SciArray(ArrayType.Int16, 5));
  const message = (...args: number[]): number => scene.kernelOn("Message", ...args);
  return {
    scene,
    vm,
    buffer,
    message,
    get: (module: number, t: MessageTuple): number => message(MessageOp.Get, module, t.noun, t.verb, t.cond, t.seq, buffer),
    next: (): number => message(MessageOp.Next, buffer),
    text: (): string => vm.memory.getString(buffer),
    last: (): number[] => {
      message(MessageOp.LastMessage, keys);
      return Array.from({ length: 5 }, (_, index) => vm.memory.array(keys).get(index));
    },
  };
}

/** Modèle indépendant : entrée dont le texte est rendu pour cette clé, renvois suivis. */
function resolve(resource: MessageResource, entry: MessageEntry): MessageEntry {
  let at = entry;
  for (let hops = 0; at.ref; hops++) {
    expect(hops).toBeLessThan(10);
    at = findMessage(resource, at.ref)!;
    expect(at).toBeDefined();
  }
  return at;
}

describe("texte d'un message", () => {
  it("\\xx donne un octet, les lettres A à F valant 11 à 16 ; \\c donne c", () => {
    expect(formatMessageText(bytes("a\\41b"))).toBe("aAb");
    expect(formatMessageText(bytes("\\1d\\1e\\1E"))).toBe("\x1e\x1f\x1f");
    expect(formatMessageText(bytes("\\0a\\ff"))).toBe("\x0b\x10");
    expect(formatMessageText(bytes("\\(MAJ) \\z\\4"))).toBe("(MAJ) z4");
    expect(formatMessageText(bytes("fin\\"))).toBe("fin\\");
  });

  it("une parenthèse sans minuscule est une didascalie : retirée avec les blancs qui suivent", () => {
    expect(formatMessageText(bytes('"(SEC) Ca me laisse de marbre."'))).toBe('"Ca me laisse de marbre."');
    expect(formatMessageText(bytes("(TON 2, VEX\x90)\r\n  Oui (enfin, non)."))).toBe("Oui (enfin, non).");
    expect(formatMessageText(bytes("Un (Deux) (TROIS"))).toBe("Un (Deux) (TROIS");
    expect(formatMessageText(bytes("(A)(B) c"))).toBe("c");
  });
});

describe.skipIf(!original.has)("noyau Message sur les messages réels", () => {
  const modules = mainIndex().numbers(ResourceType.Message);
  const resources = new Map(modules.map((number) => [number, readMessages(mainIndex().get(ResourceType.Message, number))]));

  it("les 10 982 messages sont atteints par Get ; un renvoi rend le texte visé, jamais la copie « R »", () => {
    const { vm, message, get, text, last } = stage();
    let count = 0;
    let references = 0;
    let stageDirections = 0;
    for (const [module, resource] of resources) {
      for (const entry of resource.entries) {
        count++;
        // Une clé que le jeu corrige (`game/fixes.ts`, une seule existe : 420 2-32-0-1) rend le message de la clé corrigée.
        const mapped = remapKey(GK1_FIXES.messageRemaps, module, entry).tuple;
        const target = resolve(resource, mapped === entry ? entry : findMessage(resource, mapped)!);
        const expected = formatMessageText(target.raw);
        const key = `${module} ${entry.noun}-${entry.verb}-${entry.cond}-${entry.seq}`;
        expect(get(module, entry), key).toBe(target.talker);
        expect(text(), key).toBe(expected);
        expect(message(MessageOp.Size, module, entry.noun, entry.verb, entry.cond, entry.seq), key).toBe(expected.length + 1);
        expect(last(), key).toEqual([module, target.noun, target.verb, target.cond, target.seq]);
        expect(target.ref).toBeUndefined();
        if (entry.ref) {
          references++;
          expect(String.fromCharCode(...entry.raw).startsWith("R"), key).toBe(true);
          expect(text(), key).not.toBe(formatMessageText(entry.raw));
          expect(message(MessageOp.RefNoun, module, entry.noun, entry.verb, entry.cond, entry.seq), key).toBe(entry.ref.noun);
          expect(message(MessageOp.RefVerb, module, entry.noun, entry.verb, entry.cond, entry.seq), key).toBe(entry.ref.verb);
          expect(message(MessageOp.RefCond, module, entry.noun, entry.verb, entry.cond, entry.seq), key).toBe(entry.ref.cond);
        } else if (expected.length < entry.raw.length && entry.raw.includes(0x28)) stageDirections++;
      }
    }
    expect([resources.size, count, references, stageDirections]).toEqual([MODULE_COUNT, MESSAGE_COUNT, REFERENCE_COUNT, STAGE_DIRECTION_COUNT]);
    expect(vm.warnings.size).toBe(0);
    expect(vm.kernel.journal.stubs.has("Message")).toBe(false);
  });

  it("une suite se lit par Get puis Next jusqu'à 0 ; LastMessage donne la clé de chaque texte", () => {
    const { get, next, text, last } = stage();
    const opening = resources.get(BOOKSHOP)!.entries.filter((entry) => entry.noun === 11 && entry.verb === 0 && entry.cond === 34);
    expect(opening.map((entry) => entry.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    const read: [number, string, number[]][] = [];
    for (let talker = get(BOOKSHOP, opening[0]); talker !== 0; talker = next()) read.push([talker, text(), last()]);
    expect(read).toEqual(opening.map((entry) => [entry.talker, formatMessageText(entry.raw), [BOOKSHOP, 11, 0, 34, entry.seq]]));
    expect(read.map(([talker]) => talker)).toEqual([2, 2, 2, 2, 2, 1, 2, 1, 2, 1, 2]);
    expect(unicode(read[5][1])).toBe('"Ouais"');
    // Après la fin : 0, le texte d'erreur de l'original, et la dernière clé lue reste celle du dernier message.
    expect(text()).toBe("Msg 210: 11, 0, 34, 12 not found");
    expect(next()).toBe(0);
    expect(last()).toEqual([BOOKSHOP, 11, 0, 34, 11]);
  });

  it("renvois dans une suite : la suite visée est lue, puis la suite d'origine reprend ; un renvoi peut viser un renvoi", () => {
    const { get, next, text, last } = stage();
    // Module 15 (inventaire) : 5-4-5-1 → 111-0-38 ; 5-4-5-2 → 6-7-0 → 111-0-39 ; pas de 5-4-5-3.
    expect(get(15, { noun: 5, verb: 4, cond: 5, seq: 1 })).toBe(NARRATOR);
    expect(unicode(text())).toBe("Gabriel regarde à la loupe l'écaille de python du Musée Vaudou.");
    expect(last()).toEqual([15, 111, 0, 38, 1]);
    expect(next()).toBe(NARRATOR);
    expect(unicode(text())).toBe("L'écaille irisée est brillamment teintée de vert et de pourpre.");
    expect(last()).toEqual([15, 111, 0, 39, 1]);
    expect(next()).toBe(0);

    // 5-4-4 : renvoi, texte direct, renvoi.
    const read: number[][] = [];
    for (let talker = get(15, { noun: 5, verb: 4, cond: 4, seq: 1 }); talker !== 0; talker = next()) read.push(last());
    expect(read).toEqual([[15, 111, 0, 38, 1], [15, 5, 4, 4, 2], [15, 111, 0, 31, 1]]);
  });

  it("sans tampon, Get et Next répondent sans déplacer le curseur ; Push et Pop le gardent ; clés absentes", () => {
    const { vm, message, get, next, text, last } = stage();
    const key = [BOOKSHOP, 11, 0, 34];
    expect(message(MessageOp.Get, ...key, 1)).toBe(2);
    expect(message(MessageOp.Next)).toBe(2);
    expect(message(MessageOp.Next)).toBe(2);
    expect(next()).toBe(2);
    expect(last()).toEqual([...key, 1]);
    for (let seq = 2; seq <= 5; seq++) expect(next()).toBe(2);
    // Le curseur est sur 6 (Gabriel) : mis de côté, déplacé ailleurs, repris.
    expect(message(MessageOp.Next)).toBe(1);
    message(MessageOp.Push);
    expect(get(DREAM_ROOM, { noun: 1, verb: 0, cond: 3, seq: 1 })).toBe(64);
    message(MessageOp.Pop);
    expect(next()).toBe(1);
    expect(unicode(text())).toBe('"Ouais"');
    expect(() => message(MessageOp.Pop)).toThrow(SciError);

    // Un tampon nul vaut « sans tampon » (`Interrogation::sayMessage`, script 51) : le talker, rien d'écrit, curseur en place.
    expect(message(MessageOp.Get, ...key, 1, 0)).toBe(2);
    expect(message(MessageOp.Next, 0)).toBe(2);
    expect(next()).toBe(2);
    expect(last()).toEqual([...key, 1]);
    expect(message(MessageOp.Get, BOOKSHOP, 250, 250, 250, 1, 0)).toBe(0);

    expect(message(MessageOp.Get, BOOKSHOP, 250, 250, 250, 1)).toBe(0);
    expect(message(MessageOp.Size, BOOKSHOP, 250, 250, 250, 1)).toBe(0);
    expect(message(MessageOp.RefNoun, BOOKSHOP, 250, 250, 250, 1)).toBe(SIGNAL_REG);
    expect(message(MessageOp.RefNoun, ...key, 1)).toBe(0);
    expect(() => message(3)).toThrow(SciError);
    expect(vm.warnings.size).toBe(0);
    expect(get(MODULE_WITHOUT_MESSAGES, { noun: 1, verb: 0, cond: 0, seq: 1 })).toBe(0);
    expect(text()).toBe("Msg 339: 1, 0, 0, 1 not found");
    expect([...vm.warnings.keys()]).toEqual(["Message : pas de ressource pour le module 339"]);
  });

  it("les flèches des listes de sauvegardes viennent des deux seules séquences \\xx du jeu", () => {
    const { get, text } = stage();
    get(64990, { noun: 39, verb: 0, cond: 0, seq: 1 });
    expect(text()).toBe("\x1e");
    get(64990, { noun: 40, verb: 0, cond: 0, seq: 1 });
    expect(text()).toBe("\x1f");
  });
});

/** Textes des fenêtres de texte à l'écran : éléments qui montrent un bitmap et ont une propriété `text`. */
function shownTexts(vm: Vm): { text: string; left: number; top: number; right: number; bottom: number }[] {
  const selector = vm.selectors.id("text");
  const out = [];
  for (const plane of frameoutOf(vm).planes) {
    for (const item of plane.items) {
      const object = item.object !== 0 && item.bitmap !== 0 ? vm.memory.getObject(item.object) : undefined;
      if (!object || lookupSelector(vm.memory, object, selector, newLookup()) !== SelectorKind.Variable) continue;
      out.push({ text: unicode(vm.memory.getString(readSelector(vm.memory, item.object, selector))), ...item.screenRect });
    }
  }
  return out;
}

describe.skipIf(!original.has)("parcours sans tête : du titre au premier dialogue", () => {
  const DREAM = '"Je rêvais de sang sur la rive, d\'yeux qui parlaient de pêchés.\r\nLe lac était lisse, profond et noir, comme sa peau parfumée..."';
  const GRACE = '"Mmmmm-hmmm. Je l\'aurais parié. Un instant."';

  /** Démarre, clique sur JOUER dans ce mode, et rend de quoi avancer. */
  function play(mode: MessageMode, narratorVoice: boolean) {
    const vm = new Vm(mainIndex());
    useGameClock(vm);
    vm.boot();
    const frameout = frameoutOf(vm);
    const events = eventsOf(vm);
    let frames = 0;
    const step = (count = 1): void => {
      for (let i = 0; i < count; i++) {
        if (++frames > 12000) throw new Error(`parcours trop long (pièce ${currentRoom(vm)})`);
        expect(runFrame(vm)).toEqual({ status: RunStatus.Suspended, reason: "FrameOut" });
      }
    };
    const until = (done: () => boolean, each = 1, between?: () => void): void => {
      while (!done()) {
        between?.();
        step(each);
      }
    };
    const button = () => frameout.planes.flatMap((plane) => plane.items).find((item) => item.object !== 0 && vm.nameOf(item.object) === "playButt");
    until(() => currentRoom(vm) === TITLE_ROOM && button() !== undefined);
    step(120);
    // Réglage de départ du jeu : texte et voix, narratrice doublée (il y a une sortie numérique).
    expect([messageModeOf(vm), narratorVoiceOf(vm)]).toEqual([MessageMode.Both, true]);
    setMessageMode(vm, mode, narratorVoice);
    const { left, top } = button()!.screenRect;
    events.move(left + 5, top + 3);
    step(3);
    events.down(MouseButton.Left, left + 5, top + 3);
    events.up(MouseButton.Left, left + 5, top + 3);
    until(() => currentRoom(vm) === DREAM_ROOM);
    const enter = (): void => {
      events.keyDown(SciKey.Enter);
      events.keyUp(SciKey.Enter);
    };
    return { vm, frameout, step, until, enter };
  }

  it.each([
    ["texte seul", MessageMode.Text, false],
    ["texte et voix", MessageMode.Both, true],
  ] as const)("%s : JOUER, le rêve (pièce 370) puis Grace au téléphone dans la librairie, en français dans une fenêtre de texte", { timeout: 120_000 }, (_name, mode, narratorVoice) => {
    const { vm, frameout, step, until, enter } = play(mode, narratorVoice);

    // Pièce 370 : le poème du rêve, message 370 1-0-3-1.
    until(() => shownTexts(vm).length > 0);
    expect(shownTexts(vm).map((shown) => shown.text)).toEqual([DREAM]);
    expect(messagesOf(vm).lastQuery()).toEqual({ module: DREAM_ROOM, tuple: { noun: 1, verb: 0, cond: 3, seq: 1 } });
    // Talker en texte seul, sans voix : le texte reste tant que le joueur ne le ferme pas.
    step(30);
    expect(shownTexts(vm).map((shown) => shown.text)).toEqual([DREAM]);
    // Le talker du rêve (64) est toujours en texte : `Messager` passe en texte seul le temps de ce message.
    expect(messageModeOf(vm)).toBe(MessageMode.Text);

    // Entrée ferme la fenêtre ; la scène d'ouverture mène à la librairie, où Grace répond au téléphone.
    until(() => currentRoom(vm) === BOOKSHOP && shownTexts(vm).length > 0, 30, () => {
      if (shownTexts(vm).length > 0) enter();
    });
    const [window] = shownTexts(vm);
    expect(window.text).toBe(GRACE);
    expect(messageModeOf(vm)).toBe(mode);
    expect(messagesOf(vm).lastQuery()).toEqual({ module: BOOKSHOP, tuple: { noun: 11, verb: 0, cond: 34, seq: 1 } });
    // La fenêtre est à l'écran, et on y lit quelque chose : plusieurs couleurs dans son rectangle.
    expect(window.left).toBeGreaterThanOrEqual(0);
    expect(window.top).toBeGreaterThanOrEqual(0);
    expect(window.right).toBeLessThanOrEqual(SCREEN_WIDTH);
    expect(window.bottom).toBeLessThanOrEqual(SCREEN_HEIGHT);
    const colors = new Set<number>();
    for (let y = window.top; y < window.bottom; y++) for (let x = window.left; x < window.right; x++) colors.add(frameout.screen[y * SCREEN_WIDTH + x]);
    expect(colors.size).toBeGreaterThan(1);

    // Le dialogue se poursuit à chaque Entrée : les répliques suivantes, dans l'ordre.
    const said = [window.text];
    until(() => said.length === 6, 5, () => {
      const [shown] = shownTexts(vm);
      if (!shown) return;
      if (shown.text !== said[said.length - 1]) said.push(shown.text);
      else enter();
    });
    expect(said.slice(1, 3)).toEqual(['"C\'est dur à ce que je vois. Veux-tu parler à \'Lolita\'?"', '"<soupir> Je suis désolée, mais Gabriel est pris...Je veux dire il est sorti."']);
    expect(said[5]).toBe('"Ouais"');

    expect(vm.kernel.journal.stubs.has("Message")).toBe(false);
    expect(vm.kernel.journal.counts[vm.kernel.indexOf("Message")]).toBeGreaterThan(0);
    expect([...vm.warnings.keys()]).toEqual([]);
  });

  it("voix seule : le talker du rêve reste en texte, puis le mode du joueur revient", { timeout: 120_000 }, () => {
    const { vm, step, until, enter } = play(MessageMode.Speech, true);
    until(() => shownTexts(vm).length > 0);
    expect(shownTexts(vm).map((shown) => shown.text)).toEqual([DREAM]);
    expect(messageModeOf(vm)).toBe(MessageMode.Text);
    enter();
    step(30);
    expect(shownTexts(vm)).toEqual([]);
    expect([messageModeOf(vm), narratorVoiceOf(vm)]).toEqual([MessageMode.Speech, true]);
  });
});
