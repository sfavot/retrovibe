import { describe, expect, it, vi } from "vitest";
import { charCodeOf, MIDI_TEST_SONGS } from "../../src/games/zoombinis/engine/shortcuts";
import { ZOOMBINIS_SOUND } from "../../src/games/zoombinis/engine/sound";
import type { GameOptions } from "../../src/games/zoombinis/game/state";
import { originalFiles } from "../support/original";
import { BACKGROUND, startDialogs } from "./dialog-test-env";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

/** Ticks de 17 ms qui couvrent les 90 ticks d'un message. */
const MESSAGE_MS = 17 * 95;

interface Case {
  /** Lettre tapée avec Ctrl. */
  letter: string;
  option: keyof GameOptions;
  /** Valeur après le premier appui, puis après le second. */
  values: [boolean, boolean];
  /** Indices (1-based) de `STRL` 2023 affichés après le premier puis le second appui. */
  messages: [number, number];
  /** Préférence de session qui suit l'option. */
  pref?: [keyof ReturnType<typeof prefsOf>, (value: boolean) => boolean];
}

function prefsOf(env: Awaited<ReturnType<typeof startDialogs>>) {
  return env.engine.ctx.prefs;
}

const CASES: Case[] = [
  { letter: "v", option: "music", values: [false, true], messages: [2, 1], pref: ["music", (v) => v] },
  { letter: "b", option: "music", values: [false, true], messages: [2, 1], pref: ["music", (v) => v] },
  { letter: "y", option: "effects", values: [false, true], messages: [4, 3], pref: ["effects", (v) => v] },
  { letter: "t", option: "transitionsOff", values: [true, false], messages: [12, 11], pref: ["transitions", (v) => !v] },
  { letter: "j", option: "magneticMouse", values: [false, true], messages: [10, 9], pref: ["magneticMouse", (v) => v] },
  { letter: "u", option: "autoMagnet", values: [true, false], messages: [13, 14], pref: ["autoMagnet", (v) => v] },
  { letter: "g", option: "lessAction", values: [true, false], messages: [5, 6] },
  { letter: "h", option: "hideCursorWhileCarrying", values: [false, true], messages: [8, 7], pref: ["hideCursorWhileCarrying", (v) => v] },
];

describe.skipIf(!original.has)("raccourcis clavier de Zoombinis", () => {
  it.each(CASES)("Ctrl+$letter bascule $option et affiche son message de STRL 2023", async ({ letter, option, values, messages, pref }) => {
    const env = await startDialogs();
    const { zb, dialogs, str } = env;
    env.ctrl(letter);
    await env.run(50);
    expect(zb.game.options[option]).toBe(values[0]);
    expect(dialogs.message).toBe(str(2023, messages[0]));
    if (pref) expect(prefsOf(env)[pref[0]]).toBe(pref[1](values[0]));
    env.ctrl(letter);
    await env.run(50);
    expect(zb.game.options[option]).toBe(values[1]);
    expect(dialogs.message).toBe(str(2023, messages[1]));
    if (pref) expect(prefsOf(env)[pref[0]]).toBe(pref[1](values[1]));
  });

  it("les messages du code : Ctrl+V est la musique, Ctrl+Y les voix et effets", async () => {
    const env = await startDialogs();
    expect(env.str(2023, 1)).toMatch(/^musique/);
    expect(env.str(2023, 3)).toMatch(/^sonores/);
    env.ctrl("v");
    await env.run(50);
    expect(env.services.sound.musicEnabled).toBe(false);
    expect(env.services.sound.effectsEnabled).toBe(true);
    expect(env.dialogs.message).toBe(env.str(2023, 2));
    env.ctrl("y");
    await env.run(50);
    expect(env.services.sound.effectsEnabled).toBe(false);
    expect(env.dialogs.message).toBe(env.str(2023, 4));
  });

  it("le message est une plaque au bas de l'écran pendant 90 ticks, puis l'écran est restitué", async () => {
    const env = await startDialogs();
    expect(env.screen().get(337, 466)).toBe(BACKGROUND);
    env.ctrl("g");
    await env.run(50);
    expect(env.dialogs.message).not.toBeNull();
    // Plaque de 198 points de large (type 2) à 237…437, hauteur 19 à partir de 458.
    expect(env.screen().get(240, 467)).not.toBe(BACKGROUND);
    expect(env.screen().get(236, 467)).toBe(BACKGROUND);
    await env.run(MESSAGE_MS);
    expect(env.dialogs.message).toBeNull();
    expect(env.screen().get(240, 467)).toBe(BACKGROUND);
    expect(env.dialogs.isOpen).toBe(false);
    // Ctrl+H : plaque plus étroite (type 1, 257…387).
    env.ctrl("h");
    await env.run(50);
    expect(env.screen().get(240, 467)).toBe(BACKGROUND);
    expect(env.screen().get(260, 467)).not.toBe(BACKGROUND);
  });

  it("un nouveau message remplace le précédent", async () => {
    const env = await startDialogs();
    env.ctrl("g");
    await env.run(50);
    env.ctrl("t");
    await env.run(50);
    expect(env.dialogs.message).toBe(env.str(2023, 12));
  });

  it("l'option est dans la partie : enregistrée, rechargée, et reprise par les préférences", async () => {
    const env = await startDialogs();
    const { zb, engine } = env;
    env.ctrl("v");
    await env.run(50);
    zb.saves.save("Opt", zb.game);
    zb.session.name = "Opt";
    env.ctrl("v");
    await env.run(50);
    expect(zb.game.options.music).toBe(true);
    env.ctrl("l");
    await env.run(100);
    env.press("Enter", "Enter");
    await env.run(150);
    expect(zb.game.options.music).toBe(false);
    expect(engine.ctx.prefs.music).toBe(false);
  });

  it("/ et ? ouvrent le menu ; pendant qu'il est ouvert, les raccourcis vont à la boîte", async () => {
    const env = await startDialogs();
    const { dialogs, zb, log } = env;
    env.press("Slash", "/");
    await env.run(100);
    expect(dialogs.modes).toEqual([1]);
    // La touche d'ouverture est passée par l'écran (qui ne l'a pas prise) ; ensuite il ne reçoit plus rien.
    const keys = log.keys;
    expect(keys).toBe(1);
    env.press("Slash", "?");
    env.ctrl("h");
    env.ctrl("g");
    await env.run(100);
    expect(dialogs.modes).toEqual([1]);
    expect(zb.game.options.hideCursorWhileCarrying).toBe(true);
    expect(zb.game.options.lessAction).toBe(false);
    expect(log.keys).toBe(keys);
    env.press("Enter", "Enter");
    await env.run(100);
    env.press("Slash", "?");
    await env.run(100);
    expect(dialogs.modes).toEqual([1]);
  });

  it("une touche prise par l'écran n'est pas un raccourci", async () => {
    const env = await startDialogs(new Set(["KeyV"]));
    env.ctrl("v");
    await env.run(50);
    expect(env.zb.game.options.music).toBe(true);
    expect(env.dialogs.message).toBeNull();
    env.ctrl("y");
    await env.run(50);
    expect(env.zb.game.options.effects).toBe(false);
  });

  it("ignore les touches sans Ctrl, avec Alt, et les lettres sans raccourci", async () => {
    const env = await startDialogs();
    env.press("KeyV", "v");
    env.host.press("KeyV", { key: "v", ctrl: true, alt: true });
    env.ctrl("z");
    await env.run(100);
    expect(env.zb.game.options.music).toBe(true);
    expect(env.dialogs.isOpen).toBe(false);
    expect(env.host.exited).toBe(false);
  });

  it("suit la lettre tapée : Ctrl+Q quitte même sur un clavier AZERTY (touche physique « A »)", async () => {
    const env = await startDialogs();
    env.host.press("KeyA", { key: "q", ctrl: true });
    await env.run(60);
    expect(env.host.exited).toBe(true);
  });

  it("Ctrl+I ouvre « À propos », Ctrl+C et Ctrl+L la liste, Ctrl+S l'enregistrement", async () => {
    const env = await startDialogs();
    env.zb.saves.save("A", env.zb.game);
    for (const [letter, mode] of [
      ["i", "about"],
      ["c", 2],
      ["l", 2],
      ["s", 3],
    ] as const) {
      env.ctrl(letter);
      await env.run(100);
      expect(env.dialogs.modes).toEqual([mode]);
      env.press("Escape", "Escape");
      env.press("KeyX", "x");
      await env.run(100);
      expect(env.dialogs.isOpen).toBe(false);
    }
  });
});

describe("code WM_CHAR d'une touche (condensat des codes secrets)", () => {
  const ev = (key: string, mods: { ctrl?: boolean; alt?: boolean; code?: string } = {}) => ({
    key,
    code: mods.code ?? "",
    ctrl: mods.ctrl ?? false,
    alt: mods.alt ?? false,
    shift: false,
    repeat: false,
  });
  it("caractère tapé, Ctrl+lettre = code de contrôle, Alt Gr donne son caractère, touches sans caractère ignorées", () => {
    expect(charCodeOf(ev("Z"))).toBe(0x5a);
    expect(charCodeOf(ev(" "))).toBe(0x20);
    expect(charCodeOf(ev("é"))).toBe(0xe9);
    expect(charCodeOf(ev("a", { ctrl: true }))).toBe(1);
    expect(charCodeOf(ev("@", { ctrl: true, alt: true }))).toBe(0x40);
    expect(charCodeOf(ev("Enter"))).toBe(0x0d);
    expect(charCodeOf(ev("Backspace"))).toBe(0x08);
    expect(charCodeOf(ev("ArrowLeft"))).toBeNull();
    expect(charCodeOf(ev("Shift"))).toBeNull();
    expect(charCodeOf(ev("€"))).toBeNull();
  });
});

describe.skipIf(!original.has)("codes secrets et mode de test (1198:05b3)", () => {
  /** Ctrl+A puis `text` (lettres, chiffres, espace). */
  async function typeCode(env: Awaited<ReturnType<typeof startDialogs>>, text: string): Promise<void> {
    env.ctrl("a");
    for (const c of text) env.host.press(c === " " ? "Space" : /\d/.test(c) ? `Digit${c}` : `Key${c.toUpperCase()}`, { key: c });
    await env.run(50);
  }

  it("le code du mode de test suivi d'Espace lève [a43f] et affiche « you got it »", async () => {
    const env = await startDialogs();
    env.host.press("Space", { key: " " });
    await env.run(50);
    expect(env.zb.game.options.testMode).toBe(false);
    expect(env.dialogs.message).toBeNull();
    await typeCode(env, "5oids ");
    expect(env.zb.game.options.testMode).toBe(true);
    expect(env.dialogs.message).toBe("you got it");
  });

  it("le test MIDI : « midi » et Espace, puis Espace rejoue et Maj+Espace avance dans les 18 morceaux", async () => {
    const env = await startDialogs();
    const queue = vi.spyOn(env.engine.services.get(ZOOMBINIS_SOUND), "queue");
    await typeCode(env, "midi ");
    expect(env.dialogs.message).toBe("midi test on");
    await env.run(MESSAGE_MS);
    env.host.press("Space", { key: " " });
    await env.run(50);
    expect(queue).toHaveBeenLastCalledWith(MIDI_TEST_SONGS[0]);
    expect(env.dialogs.message).toBe(`midi test:${MIDI_TEST_SONGS[0]}`);
    env.host.press("Space", { key: " ", shift: true });
    await env.run(50);
    expect(queue).toHaveBeenLastCalledWith(MIDI_TEST_SONGS[1]);
    await env.run(MESSAGE_MS);
    await typeCode(env, "midi ");
    expect(env.dialogs.message).toBe("midi test off");
  });

  it("« @ » ne marque les étapes 1, 2 et 4 réussies qu'en mode de test", async () => {
    const env = await startDialogs();
    const masks = env.zb.game.masks;
    env.host.press("Digit0", { key: "@" });
    await env.run(50);
    expect(masks).toEqual({ stage1: 0, stage2: 0, stage3: 0, stage4: 0 });
    env.zb.game.options.testMode = true;
    env.host.press("Digit0", { key: "@", ctrl: true, alt: true });
    await env.run(50);
    expect(masks).toEqual({ stage1: 1, stage2: 1, stage3: 0, stage4: 1 });
  });
});
