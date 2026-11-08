import { describe, expect, it, vi } from "vitest";
import { confirmLeaveToMap } from "../../src/games/zoombinis/engine/dialog";
import { ScreenId } from "../../src/games/zoombinis/engine/scene";
import { MAX_SAVES } from "../../src/games/zoombinis/game/saves";
import { originalFiles } from "../support/original";
import { BACKGROUND, startDialogs, type DialogEnv } from "./dialog-test-env";

// Les écrans simulent des centaines de ticks : 20 s de marge pour une machine chargée.
vi.setConfig({ testTimeout: 20_000 });

const original = originalFiles("zoombinis", "files.json");

/** Centres des boutons (cases de `SCRB` 2, 3, 5, 6, 8, 9 et 11 de `ZOOMBINI.MHK`). */
const MENU = {
  new: [179, 110],
  load: [179, 131],
  save: [179, 152],
  quit: [179, 173],
  effects: [179, 229],
  music: [179, 250],
  magnetic: [179, 271],
  transitions: [179, 292],
  ok: [460, 339],
  team: [363, 339],
} as const;
const LOAD = { up: [436, 132], down: [436, 255], go: [404, 319], cancel: [238, 319], row: (n: number) => [300, 120 + 20 * n] as const } as const;
const SAVE = { go: [404, 346], cancel: [238, 346] } as const;
const YES = [404, 258] as const;
const NO = [238, 258] as const;
const ONLY = [314, 258] as const;

/** Un clic puis de quoi laisser passer les 2 ticks d'enfoncement du bouton. */
async function click(env: DialogEnv, at: readonly [number, number] | readonly number[]): Promise<void> {
  env.host.click(at[0]!, at[1]!);
  await env.run(100);
}

describe.skipIf(!original.has)("boîte de dialogue de Zoombinis", () => {
  it("ouvre le menu par-dessus l'écran, prend les clics et les touches, puis restitue l'écran", async () => {
    const env = await startDialogs();
    const { host, dialogs, log } = env;
    expect(dialogs.isOpen).toBe(false);
    expect(env.screen().get(300, 200)).toBe(BACKGROUND);

    dialogs.openMenu(env.engine.ctx);
    await env.run(100);
    expect(dialogs.modes).toEqual([1]);
    // L'écran est recomposé sous la boîte et la boîte est présentée.
    const frame = host.frames[host.frames.length - 1]!;
    expect(frame.pixels[200 * 640 + 300]).not.toBe(BACKGROUND);
    expect(frame.pixels[10 * 640 + 10]).toBe(BACKGROUND);

    const ticks = log.ticks;
    host.click(300, 200);
    env.press("KeyX", "x");
    await env.run(100);
    expect(log.clicks).toBe(0);
    expect(log.keys).toBe(0);
    // L'écran dessous continue de jouer.
    expect(log.ticks).toBeGreaterThan(ticks);

    await click(env, MENU.ok);
    expect(dialogs.isOpen).toBe(false);
    expect(env.screen().get(300, 200)).toBe(BACKGROUND);
    host.click(300, 200);
    env.press("KeyX", "x");
    await env.run(100);
    // Appui et relâchement.
    expect(log.clicks).toBe(2);
    expect(log.keys).toBe(1);
  });

  it("un changement d'écran pendant que la boîte est ouverte l'abandonne", async () => {
    const env = await startDialogs();
    env.dialogs.openMenu(env.engine.ctx);
    await env.run(100);
    env.engine.scenes.request(ScreenId.picker);
    await env.run(100);
    expect(env.dialogs.isOpen).toBe(false);
    expect(env.engine.scenes.currentId).toBe(ScreenId.picker);
    expect(env.screen().get(300, 200)).toBe(BACKGROUND);
  });

  it("déclenche un bouton 2 ticks après le clic et joue le son du clic", async () => {
    const env = await startDialogs();
    env.dialogs.openMenu(env.engine.ctx);
    await env.run(100);
    const waves = env.host.audio.waves.length;
    env.host.click(...(MENU.ok as unknown as [number, number]));
    await env.run(17 * 1.5);
    // Enfoncé, pas encore parti.
    expect(env.dialogs.isOpen).toBe(true);
    expect(env.host.audio.waves.length).toBeGreaterThan(waves);
    await env.run(100);
    expect(env.dialogs.isOpen).toBe(false);
  });

  it("bascule les options depuis les boutons du menu", async () => {
    const env = await startDialogs();
    const { dialogs, zb, engine, services } = env;
    dialogs.openMenu(engine.ctx);
    await env.run(100);
    await click(env, MENU.effects);
    expect(zb.game.options.effects).toBe(false);
    expect(engine.ctx.prefs.effects).toBe(false);
    expect(services.sound.effectsEnabled).toBe(false);
    await click(env, MENU.music);
    expect(zb.game.options.music).toBe(false);
    expect(engine.ctx.prefs.music).toBe(false);
    expect(services.sound.musicEnabled).toBe(false);
    await click(env, MENU.music);
    expect(zb.game.options.music).toBe(true);
    expect(services.sound.musicEnabled).toBe(true);
    await click(env, MENU.magnetic);
    expect(zb.game.options.magneticMouse).toBe(false);
    await click(env, MENU.transitions);
    expect(zb.game.options.transitionsOff).toBe(true);
    expect(engine.ctx.prefs.transitions).toBe(false);
    // Le menu reste ouvert et aucun message de raccourci n'est affiché.
    expect(dialogs.modes).toEqual([1]);
    expect(dialogs.message).toBeNull();
  });

  it("menu : toucher le libellé d'une ligne déclenche son bouton (ajout du port)", async () => {
    const env = await startDialogs();
    const { dialogs, zb, engine } = env;
    dialogs.openMenu(engine.ctx);
    await env.run(100);
    // Libellé de la ligne 5 (« Dialogues & effets »), loin à droite du bouton rouge.
    await click(env, [400, 230]);
    expect(zb.game.options.effects).toBe(false);
    // Libellé de la ligne 6 (« Musique de fond »).
    await click(env, [400, 252]);
    expect(zb.game.options.music).toBe(false);
    // Hors des lignes : rien.
    await click(env, [400, 200]);
    expect(zb.game.options.effects).toBe(false);
    expect(dialogs.modes).toEqual([1]);
  });

  it("nouvelle partie : confirmation adaptée à l'état, puis partie neuve et retour à la carte", async () => {
    const env = await startDialogs();
    const { dialogs, zb, engine, str } = env;
    dialogs.openMenu(engine.ctx);
    await env.run(100);
    await click(env, MENU.new);
    expect(dialogs.modes).toEqual([1, 4]);
    expect(dialogs.prompt).toBe(str(2018, 37));
    await click(env, NO);
    expect(dialogs.modes).toEqual([1]);

    zb.game.counters.created = 5;
    zb.session.name = null;
    await click(env, MENU.new);
    expect(dialogs.prompt).toBe(str(2018, 22));
    await click(env, YES);
    expect(dialogs.isOpen).toBe(false);
    expect(zb.game.counters.created).toBe(0);
    expect(zb.session.name).toBeNull();
    expect(zb.session.screen).toBe(ScreenId.map);
    expect(engine.scenes.currentId).toBe(ScreenId.map);
  });

  it("nouvelle partie depuis un autre écran : retour au choix des Zoombinis", async () => {
    const env = await startDialogs();
    const { dialogs, zb, engine } = env;
    zb.session.screen = ScreenId.picker;
    zb.game.counters.created = 2;
    env.ctrl("n");
    await env.run(100);
    expect(dialogs.modes).toEqual([4]);
    await click(env, YES);
    expect(zb.game.counters.created).toBe(0);
    expect(zb.session.screen).toBe(ScreenId.picker);
    expect(engine.scenes.currentId).toBe(ScreenId.picker);
  });

  it("enregistre puis charge une partie sur le stockage, et reprend à son écran", async () => {
    const env = await startDialogs();
    const { dialogs, zb, engine } = env;
    zb.game.counters.created = 3;
    env.ctrl("s");
    await env.run(100);
    expect(dialogs.modes).toEqual([3]);
    await env.type("Léa");
    await click(env, SAVE.go);
    expect(dialogs.isOpen).toBe(false);
    expect(zb.saves.list()).toEqual([{ name: "Léa", file: "ZOOM0000" }]);
    expect(zb.session.name).toBe("Léa");
    expect(dialogs.isDirty()).toBe(false);

    zb.game.counters.created = 9;
    expect(dialogs.isDirty()).toBe(true);
    zb.session.screen = ScreenId.map;
    env.ctrl("l");
    await env.run(100);
    expect(dialogs.modes).toEqual([2]);
    await click(env, LOAD.go);
    expect(dialogs.isOpen).toBe(false);
    expect(zb.game.counters.created).toBe(3);
    expect(zb.session.name).toBe("Léa");
    expect(engine.scenes.currentId).toBeDefined();
    expect(zb.lastChange).not.toBeNull();
  });

  it("remplace une partie existante après confirmation, avec le nom dans la question", async () => {
    const env = await startDialogs();
    const { dialogs, zb, str } = env;
    zb.saves.save("Zoé", zb.game);
    zb.game.counters.created = 4;
    env.ctrl("s");
    await env.run(100);
    await env.type("Zoé");
    env.press("Enter", "Enter");
    await env.run(100);
    expect(dialogs.modes).toEqual([3, 4]);
    expect(dialogs.prompt).toBe(`${str(2018, 28)}Zoé"?`);
    await click(env, NO);
    expect(dialogs.modes).toEqual([3]);
    expect(zb.saves.load("Zoé").counters.created).toBe(0);
    env.press("Enter", "Enter");
    await env.run(100);
    await click(env, YES);
    expect(dialogs.isOpen).toBe(false);
    expect(zb.saves.list()).toHaveLength(1);
    expect(zb.saves.load("Zoé").counters.created).toBe(4);
  });

  it("refuse la 51e partie avec le message de STRL 2018 et laisse la boîte ouverte", async () => {
    const env = await startDialogs();
    const { dialogs, zb, str } = env;
    for (let i = 0; i < MAX_SAVES; i++) zb.saves.save(`N${i}`, zb.game);
    env.ctrl("s");
    await env.run(100);
    await env.type("Zed");
    env.press("Enter", "Enter");
    await env.run(100);
    expect(dialogs.modes).toEqual([3, 4]);
    expect(dialogs.prompt).toBe(str(2018, 38));
    await click(env, ONLY);
    expect(dialogs.modes).toEqual([3]);
    expect(zb.saves.list()).toHaveLength(MAX_SAVES);
  });

  it("filtre la saisie : jeu de STRL 1100, 18 caractères, espaces de tête, retour arrière et flèches", async () => {
    const env = await startDialogs();
    const { dialogs, zb } = env;
    const saveAs = async (typed: () => Promise<void>): Promise<string> => {
      env.ctrl("s");
      await env.run(100);
      await typed();
      env.press("Enter", "Enter");
      await env.run(100);
      return zb.saves.list()[zb.saves.list().length - 1]!.name;
    };
    expect(await saveAs(() => env.type("a€~b"))).toBe("ab");
    expect(await saveAs(() => env.type("abcdefghijklmnopqrst"))).toBe("abcdefghijklmnopqr");
    expect(await saveAs(() => env.type("  x"))).toBe("x");
    expect(
      await saveAs(async () => {
        await env.type("abc");
        env.press("ArrowLeft", "ArrowLeft");
        env.press("Backspace", "Backspace");
        await env.run(40);
        await env.type("z");
      }),
    ).toBe("azc");
    // Un nom vide ne ferme pas la boîte.
    env.ctrl("s");
    await env.run(100);
    env.press("Enter", "Enter");
    await env.run(100);
    expect(dialogs.modes).toEqual([3]);
    await click(env, SAVE.cancel);
    expect(dialogs.isOpen).toBe(false);
    expect(zb.saves.list()).toHaveLength(4);
  });

  it("saisie par le champ invisible : focus, texte composé, caractères refusés, limite, effacement, Entrée, focus rendu", async () => {
    const env = await startDialogs();
    const { dialogs, zb, host } = env;
    const field = host.textInput;
    expect(field.subscribed).toBe(false);
    env.ctrl("s");
    await env.run(100);
    expect(dialogs.modes).toEqual([3]);
    expect(field.focused).toBe(true);
    expect(field.subscribed).toBe(true);

    field.emit("Lé");
    field.emit("a€~ç");
    field.emit("\b");
    field.emit("ç");
    // Les touches simples continuent de marcher, sans doublon avec le champ.
    await env.type("z");
    await env.run(40);
    field.emit("abcdefghijklmnopqrst");
    field.emit("\n");
    await env.run(100);
    expect(dialogs.isOpen).toBe(false);
    expect(zb.saves.list().map((e) => e.name)).toEqual(["Léaçzabcdefghijklm"]);
    // Fermeture : le champ est rendu au canvas et le service ne l'écoute plus.
    expect(field.focused).toBe(false);
    expect(field.subscribed).toBe(false);
    field.emit("x");
    await env.run(40);
    expect(zb.saves.list()).toHaveLength(1);
  });

  it("le champ invisible rend le focus quand la boîte d'enregistrement est annulée ou recouverte", async () => {
    const env = await startDialogs();
    const field = env.host.textInput;
    env.ctrl("s");
    await env.run(100);
    expect(field.focused).toBe(true);
    await click(env, SAVE.cancel);
    expect(field.focused).toBe(false);
    expect(field.subscribed).toBe(false);
    // La boîte de chargement n'utilise pas le champ.
    env.zb.saves.save("Zoé", env.zb.game);
    env.ctrl("l");
    await env.run(100);
    expect(field.subscribed).toBe(false);
  });

  it("charger : liste paginée de 8 en 8, clic sur une ligne, double clic qui valide", async () => {
    const env = await startDialogs();
    const { dialogs, zb } = env;
    for (let i = 0; i < 10; i++) {
      zb.game.counters.created = i;
      zb.saves.save(`P${i}`, zb.game);
    }
    zb.game.counters.created = 99;
    env.ctrl("l");
    await env.run(100);
    expect(dialogs.modes).toEqual([2]);
    // Défilement (`11a0:3914`) : 10 parties, la page suivante recule à 10 − 8 = 2 ; la 2e ligne est alors P3 (2 clics en 30 ticks : validée).
    await click(env, LOAD.down);
    host(env).click(300, 120 + 20);
    await env.run(40);
    host(env).click(300, 120 + 20);
    await env.run(100);
    expect(dialogs.isOpen).toBe(false);
    expect(zb.session.name).toBe("P3");
    expect(zb.game.counters.created).toBe(3);
  });

  it("charger sans partie enregistrée : message « aucune partie », bouton unique", async () => {
    const env = await startDialogs();
    env.ctrl("l");
    await env.run(100);
    expect(env.dialogs.modes).toEqual([4]);
    expect(env.dialogs.prompt).toBe(env.str(2018, 20));
    await click(env, ONLY);
    expect(env.dialogs.isOpen).toBe(false);
  });

  it("les actions de partie sont refusées en entraînement et hors des écrans 1 à 18", async () => {
    const env = await startDialogs();
    const { dialogs, zb, str } = env;
    zb.session.training = 1;
    for (const [letter, index] of [
      ["s", 36],
      ["l", 39],
      ["n", 40],
    ] as const) {
      env.ctrl(letter);
      await env.run(100);
      expect(dialogs.prompt).toBe(str(2018, index));
      await click(env, ONLY);
      expect(dialogs.isOpen).toBe(false);
    }
    zb.session.training = 0;
    zb.session.screen = ScreenId.logo;
    for (const letter of ["s", "l", "n"]) {
      env.ctrl(letter);
      await env.run(100);
      expect(dialogs.isOpen).toBe(false);
    }
  });

  it("crédits : cadre et défilement de STRL 2020, un clic les ferme sans fermer le menu", async () => {
    const env = await startDialogs();
    const { dialogs, host, engine } = env;
    dialogs.openMenu(engine.ctx);
    await env.run(100);
    const waves = host.audio.waves.length;
    await click(env, MENU.team);
    expect(dialogs.modes).toEqual([1, 5]);
    expect(host.audio.waves.length).toBeGreaterThan(waves);
    await env.run(17 * 40);
    const pixels = env.screen().pixels;
    // Texte du rôle en rouge (index 38) dans la zone de défilement ; le cadre, lui, est hors de la zone.
    let red = 0;
    for (let y = 15; y < 466; y++) for (let x = 170; x < 470; x++) if (pixels[y * 640 + x] === 0x26) red++;
    expect(red).toBeGreaterThan(0);
    expect(pixels[240 * 640 + 20]).not.toBe(BACKGROUND);
    // Les deux Zoombinis du cadre (SCRB 20, une seule image) ne bougent pas pendant que le texte défile.
    const corners = () => {
      const copy: number[] = [];
      for (const [x0, x1] of [[20, 85], [540, 620]] as const) for (let y = 374; y < 466; y++) for (let x = x0; x < x1; x++) copy.push(env.screen().pixels[y * 640 + x]!);
      return copy;
    };
    const before = corners();
    expect(before.some((p) => p !== 0x2d)).toBe(true);
    await env.run(17 * 60);
    expect(corners()).toEqual(before);
    const clicks = env.log.clicks;
    host.click(300, 200);
    await env.run(60);
    expect(dialogs.modes).toEqual([1]);
    expect(env.log.clicks).toBe(clicks);
  });

  it("« À propos » : boîte blanche, fermée par n'importe quelle touche", async () => {
    const env = await startDialogs();
    env.ctrl("i");
    await env.run(100);
    expect(env.dialogs.modes).toEqual(["about"]);
    expect(env.screen().get(155, 170)).toBe(255);
    env.press("KeyX", "x");
    await env.run(60);
    expect(env.dialogs.isOpen).toBe(false);
    expect(env.screen().get(155, 170)).toBe(BACKGROUND);
  });

  it("avertissement de retour à la carte : « Tant pis… » confirme, « Ah non ! » annule", async () => {
    const env = await startDialogs();
    const { dialogs, engine, str } = env;
    let left = 0;
    let stayed = 0;
    confirmLeaveToMap(engine.ctx, () => left++, () => stayed++);
    await env.run(60);
    expect(dialogs.prompt).toBe(str(2018, 1));
    await click(env, NO);
    expect([left, stayed]).toEqual([0, 1]);
    expect(dialogs.isOpen).toBe(false);
    confirmLeaveToMap(engine.ctx, () => left++);
    await env.run(60);
    await click(env, YES);
    expect([left, stayed]).toEqual([1, 1]);
    // Entrée accepte, Échap refuse.
    confirmLeaveToMap(engine.ctx, () => left++, () => stayed++);
    await env.run(60);
    env.press("Escape", "Escape");
    await env.run(60);
    confirmLeaveToMap(engine.ctx, () => left++, () => stayed++);
    await env.run(60);
    env.press("Enter", "Enter");
    await env.run(60);
    expect([left, stayed]).toEqual([2, 2]);
  });

  describe("quitter", () => {
    it("sans modification : sortie directe", async () => {
      const env = await startDialogs();
      env.ctrl("q");
      await env.run(60);
      expect(env.host.exited).toBe(true);
    });

    it("hors des écrans 1 à 18 : sortie directe même modifiée", async () => {
      const env = await startDialogs();
      env.zb.session.screen = ScreenId.logo;
      env.zb.game.counters.created = 1;
      env.ctrl("q");
      await env.run(60);
      expect(env.host.exited).toBe(true);
    });

    it("partie modifiée : propose d'enregistrer, « Non » quitte", async () => {
      const env = await startDialogs();
      env.zb.game.counters.created = 1;
      env.ctrl("q");
      await env.run(60);
      expect(env.dialogs.prompt).toBe(env.str(2018, 33));
      expect(env.host.exited).toBe(false);
      await click(env, NO);
      expect(env.host.exited).toBe(true);
    });

    it("partie modifiée : « Oui » ouvre l'enregistrement puis quitte une fois la partie écrite", async () => {
      const env = await startDialogs();
      env.zb.game.counters.created = 1;
      env.ctrl("q");
      await env.run(60);
      await click(env, YES);
      expect(env.dialogs.modes).toEqual([3]);
      expect(env.host.exited).toBe(false);
      await env.type("Fin");
      env.press("Enter", "Enter");
      await env.run(100);
      expect(env.zb.saves.list().map((e) => e.name)).toEqual(["Fin"]);
      expect(env.host.exited).toBe(true);
    });

    it("depuis le menu : confirmation « Es-tu sûr de vouloir quitter? », « Non » revient au menu", async () => {
      const env = await startDialogs();
      env.dialogs.openMenu(env.engine.ctx);
      await env.run(100);
      await click(env, MENU.quit);
      expect(env.dialogs.modes).toEqual([1, 4]);
      expect(env.dialogs.prompt).toBe(env.str(2018, 42));
      await click(env, NO);
      expect(env.dialogs.modes).toEqual([1]);
      expect(env.host.exited).toBe(false);
      await click(env, MENU.quit);
      await click(env, YES);
      expect(env.host.exited).toBe(true);
    });
  });

  it("touches du menu ouvert : Ctrl+N, Ctrl+L, Ctrl+V (boutons), Entrée ferme", async () => {
    const env = await startDialogs();
    const { dialogs, zb } = env;
    dialogs.openMenu(env.engine.ctx);
    await env.run(100);
    // Dans le menu, la touche Ctrl+V actionne le bouton « Dialogues & effets » (voix et effets), comme `11a0:316d`.
    env.ctrl("v");
    await env.run(100);
    expect(zb.game.options.effects).toBe(false);
    expect(zb.game.options.music).toBe(true);
    env.ctrl("y");
    await env.run(100);
    expect(zb.game.options.music).toBe(false);
    env.ctrl("n");
    await env.run(100);
    expect(dialogs.modes).toEqual([1, 4]);
    env.press("Escape", "Escape");
    await env.run(100);
    expect(dialogs.modes).toEqual([1]);
    env.press("Enter", "Enter");
    await env.run(100);
    expect(dialogs.isOpen).toBe(false);
  });
});

function host(env: DialogEnv) {
  return env.host;
}
