import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { isLocked, saveOptions } from "../../src/games/teleportaschtroumpf/engine/options";
import type { GameScene } from "../../src/games/teleportaschtroumpf/scenes/game";
import { MENU_PARENTS, PARENTS_HOLD_SECONDS, createMenuScene, paletteBounds } from "../../src/games/teleportaschtroumpf/scenes/s07-menu";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles } from "./helpers";

const HOVER = [0x10, 0xa4, 0xcc];

/** Moteur sur le menu S07, avec les gestes de l'utilisateur. */
async function startMenu() {
  const host = new TestHost();
  const engine = new Engine(host, { seed: 7 });
  await engine.start(createMenuScene());
  const top = () => engine.ctx.scenes.top?.constructor.name;
  /** Attend une scène (par le nom de sa classe), la fin des chargements et des fondus. */
  const settle = async (name: string) => {
    await runUntil(engine, host, () => top() === name && !engine.loading && !engine.ctx.scenes.transitioning && !engine.ctx.fade.active);
    await runFor(engine, host, 100);
  };
  const press = async (code: string, ms = 100) => {
    host.input.keyDown(code);
    await runFor(engine, host, ms);
    host.input.keyUp(code);
    await runFor(engine, host, 100);
  };
  const click = async (button = 0) => {
    host.input.mouseDown(button);
    await runFor(engine, host, 100);
    host.input.mouseUp(button);
    await runFor(engine, host, 100);
  };
  /** Indices des boutons dont le texte est en surbrillance. */
  const lit = () => [0, 1, 2, 3, 4, 5].filter((i) => [...engine.ctx.palette.colors.subarray((120 + i) * 3, (120 + i) * 3 + 3)].every((v, k) => v === HOVER[k]));
  const select = async (index: number) => {
    for (let guard = 0; lit()[0] !== index && guard < 6; guard++) await press("ArrowDown");
    expect(lit()).toEqual([index]);
  };
  /** Fichiers lus depuis le début (sert à reconnaître un écran par son fond). */
  const lastFile = () => host.loaded.join("\n");
  return { host, engine, top, settle, press, click, lit, select, lastFile };
}

describe.skipIf(!hasOriginalFiles)("flux des écrans depuis le menu S07", () => {
  it("affiche le menu : fond, musique, premier bouton en surbrillance, aucun bip à l'entrée", async () => {
    const t = await startMenu();
    await t.settle("MenuScene");
    expect(t.lit()).toEqual([0]);
    expect(t.host.audio.plays.every((p) => p.loop)).toBe(true); // seule la musique de fond joue
    expect(t.engine.ctx.voice.hasMusic).toBe(true);
  });

  it("navigue au clavier avec rebouclage ; la position de la souris ne sélectionne rien", async () => {
    const t = await startMenu();
    await t.settle("MenuScene");
    await t.press("ArrowDown");
    expect(t.lit()).toEqual([1]);
    await t.press("ArrowUp");
    await t.press("ArrowUp");
    expect(t.lit()).toEqual([5]);
    await t.press("ArrowDown");
    expect(t.lit()).toEqual([0]);

    t.host.input.mouseMove(250, 110); // sur le bouton Jouer
    await runFor(t.engine, t.host, 100);
    expect(t.lit()).toEqual([0]);
  });

  it("joue le bip s07a001b à chaque changement de bouton, pas à l'entrée", async () => {
    const t = await startMenu();
    await t.settle("MenuScene");
    const beep = (await t.engine.ctx.resources.voc("s07a001b.voc")).samples;
    const beeps = () => t.host.audio.effects.filter((p) => p.sound.samples === beep).length;
    expect(beeps()).toBe(0);
    await t.press("ArrowDown");
    expect(beeps()).toBe(1);
    await t.press("ArrowUp");
    await t.press("ArrowUp"); // rebouclage : encore un changement
    expect(beeps()).toBe(3);
    await t.press("ArrowRight"); // pas un changement de bouton
    expect(beeps()).toBe(3);
  });

  it("joue la voix d'aide du bouton au clic droit", async () => {
    const t = await startMenu();
    await t.settle("MenuScene");
    const before = t.host.audio.plays.length;
    await t.press("Enter");
    expect(t.host.audio.plays.length).toBe(before + 1);
    const voice = t.host.audio.plays.at(-1)!;
    expect(voice.loop).toBe(false);
    expect(t.top()).toBe("MenuScene");
  });

  it.each([
    ["Règles", 0, "s10a.mux"],
    ["Introduction", 1, "s06a.mux"],
  ])("%s : vidéo passable puis retour au menu, sans rejouer le démarrage", async (_name, index, file) => {
    const t = await startMenu();
    await t.settle("MenuScene");
    await t.select(index);
    await t.press("Space");
    await t.settle("VideoScene");
    expect(t.lastFile().toLowerCase()).toContain(file.replace(".mux", ""));
    await runFor(t.engine, t.host, 1500);
    await t.press("Escape");
    await t.settle("MenuScene");
    expect(t.lit()).toEqual([0]);
    expect(t.host.loaded.some((path) => /S52D0\.MUX|S05ASPHI/i.test(path))).toBe(false);
    // La musique a été relancée une fois la vidéo terminée.
    expect(t.engine.ctx.voice.hasMusic).toBe(true);
  }, 60_000);

  it("Schtroumpf : carte libre puis retour au menu", async () => {
    const t = await startMenu();
    await t.settle("MenuScene");
    await t.select(2);
    await t.click(0);
    await t.settle("FreeModeScene");
    expect(t.lastFile()).toMatch(/S02A00[12]D\.MCG/i);
    await t.click();
    await t.settle("MenuScene");
  });

  it("Jouer : S09 → S08 → partie sur le plateau → abandon → menu", async () => {
    const t = await startMenu();
    t.host.audio.enabled = false; // sortie son verrouillée : aucune voix à attendre
    await t.settle("MenuScene");
    await t.select(3);
    await t.press("Space");
    await t.settle("PlayersScene");
    expect(t.lastFile()).toMatch(/S09A001D\.MCG/i);
    await runFor(t.engine, t.host, 400); // pause entre la voix d'accueil et le choix
    await t.press("Space"); // 1 joueur
    await t.settle("CharactersScene");
    expect(t.lastFile()).toMatch(/S08A001D\.MCG/i);
    await t.press("Space"); // personnage de départ, niveau 1
    await runFor(t.engine, t.host, 1500); // la capsule se pose
    await t.press("Space"); // bouton Jouer
    await t.settle("GameScene");
    expect(t.host.loaded.some((path) => /S01A001D\.MCG/i.test(path))).toBe(true);
    // Annonce du personnage (S19 est une souche vide), puis le joueur a la main.
    await runUntil(t.engine, t.host, () => (t.engine.ctx.scenes.top as GameScene).board?.playing === true);
    // P → pause → abandon → Oui : retour au menu.
    await t.press("KeyP");
    await t.settle("PauseScene");
    await runFor(t.engine, t.host, 300);
    await t.press("ArrowRight");
    await t.press("Space");
    await t.settle("ConfirmScene"); // un seul joueur : S49 tout de suite
    await t.press("Space");
    await t.settle("MenuScene");
  });

  it("Jouer est bloqué par le verrou parental", async () => {
    const t = await startMenu();
    const { options } = t.engine.ctx;
    options.pauseIndex = 2;
    options.lastGameMinutes = Math.floor(t.host.unixSeconds() / 60) - 10;
    saveOptions(t.host.storage, options);
    expect(isLocked(options, Math.floor(t.host.unixSeconds() / 60))).toBe(true);
    t.host.audio.enabled = false;
    await t.settle("MenuScene");
    await t.select(3);
    await t.press("Space");
    await runFor(t.engine, t.host, 1500);
    expect(t.top()).toBe("MenuScene");
    expect(t.host.loaded.some((path) => /S09A001D/i.test(path))).toBe(false);

    // Le verrou levé, Jouer passe.
    options.lastGameMinutes = 0;
    await t.press("Space");
    await t.settle("PlayersScene");
    expect(t.lastFile()).toMatch(/S09A001D\.MCG/i);
  });

  it("Parents : valider ne fait rien ; seule la touche droite maintenue 4 s ouvre S04", async () => {
    const t = await startMenu();
    t.host.audio.enabled = false;
    await t.settle("MenuScene");
    await t.select(4);
    await t.press("Space");
    await t.click(0);
    await runFor(t.engine, t.host, 1000);
    expect(t.top()).toBe("MenuScene");
    // Une touche droite tenue moins de 4 s non plus.
    await t.press("ArrowRight", (PARENTS_HOLD_SECONDS - 1) * 1000);
    expect(t.top()).toBe("MenuScene");

    t.host.input.keyDown("ArrowRight");
    await runFor(t.engine, t.host, PARENTS_HOLD_SECONDS * 1000 + 300);
    t.host.input.keyUp("ArrowRight");
    await t.settle("ParentsScene");
    expect(t.lastFile()).toMatch(/S04A001D\.MCG/i);
    await runFor(t.engine, t.host, 1000);
    await t.press("Space"); // valide : retour au menu
    await t.settle("MenuScene");

    // Le clic gauche maintenu 4 s ailleurs que sur le bouton Parents n'ouvre rien (le pointeur est au centre de l'écran).
    await t.select(4);
    t.host.input.mouseDown(0);
    await runFor(t.engine, t.host, PARENTS_HOLD_SECONDS * 1000 + 300);
    t.host.input.mouseUp(0);
    await runFor(t.engine, t.host, 500);
    expect(t.top()).toBe("MenuScene");
  }, 60_000);

  it("Parents à la souris ou au doigt : appui tenu 4 s sur le bouton (ajout du port) ; plus court, rien ne part", async () => {
    const t = await startMenu();
    t.host.audio.enabled = false;
    await t.settle("MenuScene");
    const mcg = await t.engine.ctx.resources.mcg("s07a001d.mcg");
    const area = paletteBounds(mcg.pixels, 120 + MENU_PARENTS)!;
    expect(area).not.toBeNull();
    const x = (area.x0 + area.x1) / 2;
    const y = (area.y0 + area.y1) / 2;
    // « Jouer » sélectionné : un appui court sur Parents ne le lance pas, il sélectionne Parents (qui ne fait rien).
    await t.select(3);
    t.host.input.mouseMove(x, y);
    await t.click(0);
    await runFor(t.engine, t.host, 1000);
    expect(t.top()).toBe("MenuScene");
    expect(t.lit()).toEqual([MENU_PARENTS]);
    // Tenu moins de 4 s : rien.
    t.host.input.mouseDown(0);
    await runFor(t.engine, t.host, (PARENTS_HOLD_SECONDS - 1) * 1000);
    t.host.input.mouseUp(0);
    await runFor(t.engine, t.host, 300);
    expect(t.top()).toBe("MenuScene");
    // Tenu 4 s : menu parents.
    t.host.input.mouseDown(0);
    await runFor(t.engine, t.host, PARENTS_HOLD_SECONDS * 1000 + 300);
    t.host.input.mouseUp(0);
    await t.settle("ParentsScene");
  }, 60_000);

  it("Quitter : Non → menu ; Oui → générique puis sortie du jeu", async () => {
    const t = await startMenu();
    t.host.audio.enabled = false;
    await t.settle("MenuScene");
    await t.select(5);
    await t.press("Space");
    await t.settle("ConfirmScene");
    await t.press("ArrowRight");
    await t.press("Space"); // Non
    await t.settle("MenuScene");
    expect(t.host.exited).toBe(false);

    await t.select(5);
    await t.press("Space");
    await t.settle("ConfirmScene");
    await t.press("Space"); // Oui
    await t.settle("CreditsScene");
    expect(t.lastFile()).toMatch(/S52DSPHI\.DOC|S52D001D\.MCG|S52M002M\.VOC/i);
    expect(t.host.exited).toBe(false);
    // Les appuis sautent aux repères @2 puis @3 (le tout premier est absorbé par le premier pas de défilement) ; le suivant
    // ferme la page finale, puis le jeu se ferme.
    for (let i = 0; i < 6 && !t.host.exited; i++) {
      await t.press("Space");
      await runFor(t.engine, t.host, 800);
    }
    await runUntil(t.engine, t.host, () => t.host.exited);
    expect(t.host.exited).toBe(true);
  }, 60_000);
});
