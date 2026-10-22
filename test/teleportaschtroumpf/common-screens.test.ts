import { describe, expect, it } from "vitest";
import { encodeCp437 } from "../../src/data/cp437";
import { parsePfn } from "../../src/games/teleportaschtroumpf/data/font";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { PictureScene } from "../../src/games/teleportaschtroumpf/engine/picture";
import { BorlandRandom } from "../../src/games/teleportaschtroumpf/engine/rng";
import type { Scene } from "../../src/games/teleportaschtroumpf/engine/scene";
import { parseConfirmationTexts } from "../../src/games/teleportaschtroumpf/data/text";
import { CHARACTER_NAMES } from "../../src/games/teleportaschtroumpf/game/tables";
import { quitGame } from "../../src/games/teleportaschtroumpf/scenes/flow";
import { Game } from "../../src/games/teleportaschtroumpf/game/rules";
import { HOVER_COLOR } from "../../src/games/teleportaschtroumpf/scenes/common/choice";
import { wrapText } from "../../src/games/teleportaschtroumpf/scenes/common/text";
import { drawInfo, loadInfo, pointsText, timeGraduations } from "../../src/games/teleportaschtroumpf/scenes/s03-info";
import { createHelpScene } from "../../src/games/teleportaschtroumpf/scenes/s45-help";
import { IDLE_SECONDS, createPauseScene, type PauseChoice } from "../../src/games/teleportaschtroumpf/scenes/s48-pause";
import { createConfirmScene, TEXT_MAX_WIDTH } from "../../src/games/teleportaschtroumpf/scenes/s49-confirm";
import { CONFIRM_BY_CHARACTER, createAbandonScene, slotsFor, type AbandonResult } from "../../src/games/teleportaschtroumpf/scenes/s46-abandon";
import { FINAL_WAIT_SECONDS, createCreditsScene, parseCreditsText } from "../../src/games/teleportaschtroumpf/scenes/s52-credits";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles, readData } from "./helpers";

/** Écran de la partie factice sur lequel les écrans communs sont empilés. */
class Board extends PictureScene {
  constructor() {
    super({ mcg: "s01a001d.mcg" });
  }
}

/** Hôte qui sert en plus un fichier absent des données (`s52dsphi.doc`). */
class DocHost extends TestHost {
  constructor(private readonly doc: Uint8Array) {
    super();
  }
  override async loadFile(name: string): Promise<Uint8Array> {
    return name.toLowerCase() === "s52dsphi.doc" ? this.doc : super.loadFile(name);
  }
}

/** Hôte sans `s52dsphi.doc` (échec de chargement), pour le repli du générique sans texte. */
class NoDocHost extends TestHost {
  override async loadFile(name: string): Promise<Uint8Array> {
    if (name.toLowerCase() === "s52dsphi.doc") throw new Error("absent");
    return super.loadFile(name);
  }
}

async function session(host = new TestHost()) {
  const engine = new Engine(host, { seed: 7 });
  await engine.start(new Board());
  const top = () => engine.ctx.scenes.top?.constructor.name;
  const settle = async (name: string) => {
    await runUntil(engine, host, () => top() === name && !engine.loading && !engine.ctx.scenes.transitioning && !engine.ctx.fade.active);
    await runFor(engine, host, 100);
  };
  await settle("Board");
  const board = { screen: engine.ctx.surface.work.slice(), palette: engine.ctx.palette.colors.slice() };
  const push = async (scene: Scene, name: string) => {
    engine.ctx.scenes.push(scene, { fade: true });
    await settle(name);
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
  /** Le pointeur est posé quelque part : sa position ne désigne rien (clavier d'origine seul). */
  const moveTo = async (x: number, y: number) => {
    host.input.mouseMove(x, y);
    await runFor(engine, host, 100);
  };
  const lastSound = () => host.audio.plays.at(-1)?.sound;
  const voc = (name: string) => engine.ctx.resources.voc(name);
  /** Entrées de palette en couleur de survol, parmi `entries`. */
  const lit = (entries: number[]) =>
    entries.filter((e) => HOVER_COLOR.every((v, k) => engine.ctx.palette.colors[e * 3 + k] === v));
  const restored = () =>
    engine.ctx.surface.work.every((v, i) => v === board.screen[i]) && engine.ctx.palette.colors.every((v, i) => v === board.palette[i]);
  return { host, engine, top, settle, push, press, click, moveTo, lastSound, voc, lit, board, restored };
}

type Session = Awaited<ReturnType<typeof session>>;

describe("utilitaires des écrans communs", () => {
  it("parseCreditsText : CR, LF, CRLF, lignes vides, dernière ligne sans fin", () => {
    const text = (s: string) => parseCreditsText(Uint8Array.from(s, (c) => c.charCodeAt(0))).map((l) => String.fromCharCode(...l));
    expect(text("a\r\nb\r\n\r\nc\rd\ne")).toEqual(["a", "b", "", "c", "d", "e"]);
    expect(text("")).toEqual([]);
  });

  it("timeGraduations : 27 graduations, calcul 16 bits de l'original", () => {
    expect(timeGraduations(0, 1800)).toBe(0);
    expect(timeGraduations(600, 1800)).toBe(9);
    expect(timeGraduations(1800, 1800)).toBe(27);
    expect(timeGraduations(2000, 1800)).toBe(27);
    // 3000 × 27 = 81000 dépasse 16 bits : 15464 / 3600 = 4 (défaut de l'original).
    expect(timeGraduations(3000, 3600)).toBe(4);
  });

  it("pointsText : points/objectif sur deux chiffres", () => {
    expect(pointsText(5, 13)).toBe("5/13");
    expect(pointsText(12, 13)).toBe("12/13");
    expect(pointsText(0, 5)).toBe("0/05");
  });

  it("slotsFor : emplacements de la rangée de joueurs", () => {
    expect([1, 2, 3, 4].map(slotsFor)).toEqual([[1], [1, 2], [0, 1, 2], [0, 1, 2, 3]]);
  });

  it("S46 : message S49 de chaque personnage", () => {
    // Costaud, Poète, Grognon, Gourmand, Farceur, Bricoleur → S49_01T, 05T, 06T, 02T, 03T, 04T.
    expect(CONFIRM_BY_CHARACTER.map((n) => n + 1)).toEqual([1, 5, 6, 2, 3, 4]);
  });
});

describe.skipIf(!hasOriginalFiles)("mise en page du texte S49", () => {
  it("le message de chaque personnage nomme ce personnage", () => {
    const texts = parseConfirmationTexts(readData("S49/S49A/S49A.DAT"));
    CHARACTER_NAMES.forEach((name, character) => {
      expect(texts[`S49_${String(CONFIRM_BY_CHARACTER[character] + 1).padStart(2, "0")}T`]).toContain(name);
    });
  });

  it("coupe à 190 px aux espaces sans rien perdre", () => {
    const font = parsePfn(readData("S52/S52D/S52D001F.PFN"));
    const text = "Schtroumpf Bricoleur, c'est pas une blague? Tu veux vraiment arrêter, Schtroumpf Gourmand?";
    const lines = wrapText(font, encodeCp437(text), TEXT_MAX_WIDTH);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((l) => String.fromCharCode(...l)).join(" ").length).toBeGreaterThan(0);
    const widths = lines.map((l) => l.reduce((w, c) => w + (font.glyphs.get(c)?.width || 2) + 1, 0));
    for (const w of widths) expect(w).toBeLessThanOrEqual(TEXT_MAX_WIDTH);
    const joined = lines.map((l) => [...l].map((c) => c)).map((l) => Buffer.from(l).toString("latin1"));
    expect(joined.join(" ").replace(/\s+/g, " ")).toBe(Buffer.from(encodeCp437(text)).toString("latin1"));
  });
});

describe.skipIf(!hasOriginalFiles)("S49 confirmation", () => {
  async function ask(t: Session, n: number) {
    const answers: boolean[] = [];
    await t.push(
      createConfirmScene(n, (ctx, yes) => {
        answers.push(yes);
        ctx.scenes.pop({ fade: true });
      }),
      "ConfirmScene",
    );
    return answers;
  }

  it("refuse un numéro de message hors 0 à 11", () => {
    expect(() => createConfirmScene(12, () => undefined)).toThrow(RangeError);
    expect(() => createConfirmScene(-1, () => undefined)).toThrow(RangeError);
  });

  it.each([0, 1, 2, 3, 4, 5, 8, 9, 10])("n = %i : texte affiché, voix d'entrée s49v%03dt, Oui au départ", async (n) => {
    const t = await session();
    await ask(t, n);
    // Texte dessiné dans le haut (couleur 126) ; l'image seule n'en a pas autant.
    const ink = t.engine.ctx.surface.work.subarray(10 * 320, 60 * 320).filter((v) => v === 0x7e).length;
    expect(ink).toBeGreaterThan(150);
    expect(t.lastSound()).toBe(await t.voc(`s49v${String(n + 1).padStart(3, "0")}t.voc`));
    expect(t.lit([124, 125])).toEqual([124]);
  });

  it.each([6, 7, 11])("n = %i : texte déjà dans l'image, rien n'est redessiné", async (n) => {
    const t = await session();
    await ask(t, n);
    const mcg = readData("S49/S49A/S49A001D.MCG").subarray(770);
    expect(t.engine.ctx.surface.work.subarray(0, 100 * 320).every((v, i) => v === mcg[i])).toBe(true);
  });

  it("Espace = Oui, restitue l'écran du dessous", async () => {
    const t = await session();
    const answers = await ask(t, 10);
    await t.press("Space");
    await t.settle("Board");
    expect(answers).toEqual([true]);
    expect(t.restored()).toBe(true);
  });

  it("droite puis Espace = Non ; pas de rebouclage", async () => {
    const t = await session();
    const answers = await ask(t, 0);
    await t.press("ArrowLeft");
    expect(t.lit([124, 125])).toEqual([124]);
    await t.press("ArrowRight");
    expect(t.lit([124, 125])).toEqual([125]);
    await t.press("ArrowRight");
    expect(t.lit([124, 125])).toEqual([125]);
    await t.press("Space");
    await t.settle("Board");
    expect(answers).toEqual([false]);
  });

  it("clic droit : voix du choix courant, sans valider", async () => {
    const t = await session();
    const answers = await ask(t, 3);
    await t.press("Enter");
    expect(t.lastSound()).toBe(await t.voc("s49v007t.voc"));
    await t.press("ArrowRight");
    await t.press("Enter");
    expect(t.lastSound()).toBe(await t.voc("s49v008t.voc"));
    expect(answers).toEqual([]);
    expect(t.top()).toBe("ConfirmScene");
  });

  it("boutons de la souris : gauche valide le choix courant, droit joue sa voix ; la position du pointeur ne compte pas", async () => {
    const t = await session();
    const answers = await ask(t, 1);
    await t.moveTo(300, 150); // sur l'étiquette de Non : sans effet
    expect(t.lit([124, 125])).toEqual([124]);
    await t.click(2);
    expect(t.lastSound()).toBe(await t.voc("s49v007t.voc"));
    expect(answers).toEqual([]);
    await t.click(0);
    await t.settle("Board");
    expect(answers).toEqual([true]);
  });

  it("Échap n'a pas d'effet (l'original l'ignore)", async () => {
    const t = await session();
    const answers = await ask(t, 2);
    await t.press("Escape");
    await runFor(t.engine, t.host, 500);
    expect(answers).toEqual([]);
    expect(t.top()).toBe("ConfirmScene");
  });

  it("flux « Quitter » : Non → menu ; Oui → générique puis sortie du jeu", async () => {
    const t = await session();
    quitGame(t.engine.ctx);
    await t.settle("ConfirmScene");
    await t.press("ArrowRight");
    await t.press("Space"); // Non
    await t.settle("MenuScene");
    expect(t.host.exited).toBe(false);

    quitGame(t.engine.ctx);
    await t.settle("ConfirmScene");
    await t.press("Space"); // Oui
    await t.settle("CreditsScene");
    expect(t.host.exited).toBe(false);
    // Texte réel du générique : un appui saute au repère suivant (@2, @3), le dernier ferme la page finale.
    for (let i = 0; i < 3; i++) {
      await t.press("Space");
      await runFor(t.engine, t.host, 800);
    }
    await runUntil(t.engine, t.host, () => t.host.exited);
  }, 60_000);

  it("remplaçant la scène courante (replace), il rend la main sans empiler", async () => {
    const t = await session();
    const answers: boolean[] = [];
    t.engine.ctx.scenes.replace(createConfirmScene(10, (_, yes) => answers.push(yes)), { fade: true });
    await t.settle("ConfirmScene");
    await t.press("Space");
    expect(answers).toEqual([true]);
    expect(t.engine.ctx.scenes.depth).toBe(1);
  });
});

describe.skipIf(!hasOriginalFiles)("S48 pause", () => {
  async function pause(t: Session) {
    const choices: PauseChoice[] = [];
    await t.push(
      createPauseScene((ctx, choice) => {
        choices.push(choice);
        ctx.scenes.pop({ fade: true });
      }),
      "PauseScene",
    );
    return choices;
  }

  it("dessine la barre et le parchemin par-dessus l'écran de la partie, « Retour » en surbrillance", async () => {
    const t = await session();
    await pause(t);
    const { work } = t.engine.ctx.surface;
    // Le haut de l'écran de la partie est intact, la barre du bas vient de l'image de la pause.
    expect(work.subarray(0, 40 * 320).every((v, i) => v === t.board.screen[i])).toBe(true);
    const bar = readData("S48/S48A/S48A001D.MCG").subarray(770);
    expect(work.subarray(152 * 320).every((v, i) => v === bar[152 * 320 + i])).toBe(true);
    expect(work.subarray(60 * 320, 100 * 320).some((v, i) => v !== t.board.screen[60 * 320 + i])).toBe(true);
    expect(t.lit([251, 252, 253, 254])).toEqual([251]);
  });

  it.each([
    [0, "resume"],
    [1, "abandon"],
    [2, "map"],
    [3, "help"],
  ] as const)("quatre choix : %i fois droite puis Espace = %s", async (rights, expected) => {
    const t = await session();
    const choices = await pause(t);
    for (let i = 0; i < rights; i++) await t.press("ArrowRight");
    expect(t.lit([251, 252, 253, 254])).toEqual([251 + rights]);
    await t.press("Space");
    await t.settle("Board");
    expect(choices).toEqual([expected]);
    expect(t.restored()).toBe(true);
  });

  it("pas de rebouclage, surbrillance rendue en quittant un bouton", async () => {
    const t = await session();
    await pause(t);
    await t.press("ArrowLeft");
    expect(t.lit([251, 252, 253, 254])).toEqual([251]);
    for (let i = 0; i < 6; i++) await t.press("ArrowRight");
    expect(t.lit([251, 252, 253, 254])).toEqual([254]);
    // Les autres boutons ont la couleur normale (entrée 250).
    const c = t.engine.ctx.palette.colors;
    expect([...c.subarray(251 * 3, 251 * 3 + 3)]).toEqual([...c.subarray(250 * 3, 250 * 3 + 3)]);
  });

  it("souris : le clic gauche valide le bouton courant, sans tenir compte du pointeur", async () => {
    const t = await session();
    const choices = await pause(t);
    await t.moveTo(160, 172); // sur un autre parchemin : sans effet
    expect(t.lit([251, 252, 253, 254])).toEqual([251]);
    await t.click();
    await t.settle("Board");
    expect(choices).toEqual(["resume"]);
  });

  it("clic droit : voix du bouton ; Échap sans effet", async () => {
    const t = await session();
    const choices = await pause(t);
    await t.press("Enter");
    const expected = [await t.voc("s48v005t.voc"), await t.voc("s48v006t.voc")];
    expect(expected).toContain(t.lastSound());
    await t.press("ArrowRight");
    await t.press("Enter");
    expect(t.lastSound()).toBe(await t.voc("s48v007t.voc"));
    await t.press("Escape");
    expect(choices).toEqual([]);
    expect(t.top()).toBe("PauseScene");
  });

  it("voix de rappel après 30 s sans réponse", async () => {
    const t = await session();
    await pause(t);
    const before = t.host.audio.plays.length;
    await runFor(t.engine, t.host, (IDLE_SECONDS + 1) * 1000);
    const idle = [await t.voc("s48v008t.voc"), await t.voc("s48v009t.voc"), await t.voc("s48v010t.voc")];
    expect(t.host.audio.plays.slice(before).some((p) => idle.includes(p.sound as never))).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("S46 abandon", () => {
  async function abandon(t: Session, players: number | number[]) {
    const results: AbandonResult[] = [];
    await t.push(
      createAbandonScene(players, (ctx, result) => {
        results.push(result);
        ctx.scenes.pop({ fade: true });
      }),
      "AbandonScene",
    );
    return results;
  }

  it("refuse un nombre de joueurs ou un personnage invalide", () => {
    expect(() => createAbandonScene(0, () => undefined)).toThrow(RangeError);
    expect(() => createAbandonScene(5, () => undefined)).toThrow(RangeError);
    expect(() => createAbandonScene([0, 6], () => undefined)).toThrow(RangeError);
  });

  it("choisit un joueur au clavier (sans rebouclage), S49 du personnage, Oui = player", async () => {
    const t = await session();
    const results = await abandon(t, [0, 3, 5]);
    await t.press("ArrowLeft");
    await t.press("ArrowRight");
    await t.press("Space");
    await t.settle("ConfirmScene");
    // Joueur 1 = Gourmand (3) → S49_02T, voix s49v002t.
    expect(t.lastSound()).toBe(await t.voc("s49v002t.voc"));
    await t.press("Space"); // Oui
    await t.settle("Board");
    expect(results).toEqual([{ kind: "player", index: 1 }]);
    expect(t.restored()).toBe(true);
  });

  it("Non à S49 : on reste sur S46, puis un autre choix", async () => {
    const t = await session();
    const results = await abandon(t, [0, 3, 5]);
    await t.press("Space");
    await t.settle("ConfirmScene");
    await t.press("ArrowRight");
    await t.press("Space"); // Non
    await t.settle("AbandonScene");
    expect(results).toEqual([]);
    // L'écran de S46 est revenu (surbrillance des boutons éteinte, main dessinée au prochain rendu).
    expect(t.lit([121, 122])).toEqual([]);
    await t.press("ArrowRight");
    await t.press("ArrowRight");
    await t.press("ArrowRight");
    await t.press("Space");
    await t.settle("ConfirmScene");
    expect(t.lastSound()).toBe(await t.voc("s49v004t.voc")); // 3e joueur = Bricoleur (5) → S49_04T
    await t.press("Space");
    await t.settle("Board");
    expect(results).toEqual([{ kind: "player", index: 2 }]);
  });

  it("« tous » : S49 n = 10, Oui = all, Non = cancel", async () => {
    const t = await session();
    const results = await abandon(t, [0, 3]);
    await t.press("ArrowDown");
    expect(t.lit([121, 122])).toEqual([121]);
    await t.press("Space");
    await t.settle("ConfirmScene");
    expect(t.lastSound()).toBe(await t.voc("s49v011t.voc"));
    await t.press("Space");
    await t.settle("Board");
    expect(results).toEqual([{ kind: "all" }]);

    const results2 = await abandon(t, [0, 3]);
    await t.press("ArrowDown");
    await t.press("Space");
    await t.settle("ConfirmScene");
    await t.press("ArrowRight");
    await t.press("Space"); // Non
    await t.settle("Board");
    expect(results2).toEqual([{ kind: "cancel" }]);
  });

  it("« retour » : cancel sans S49 ; haut/bas bornés", async () => {
    const t = await session();
    const results = await abandon(t, [1, 2]);
    await t.press("ArrowUp");
    expect(t.lit([121, 122])).toEqual([]);
    await t.press("ArrowDown");
    await t.press("ArrowDown");
    await t.press("ArrowDown");
    expect(t.lit([121, 122])).toEqual([122]);
    await t.press("Space");
    await t.settle("Board");
    expect(results).toEqual([{ kind: "cancel" }]);
    expect(t.restored()).toBe(true);
  });

  it("un seul joueur : S49 tout de suite (Oui = all, Non = cancel)", async () => {
    const t = await session();
    const results: AbandonResult[] = [];
    t.engine.ctx.scenes.push(
      createAbandonScene([2], (ctx, result) => {
        results.push(result);
        ctx.scenes.pop({ fade: true });
      }),
      { fade: true },
    );
    await t.settle("ConfirmScene");
    expect(t.lastSound()).toBe(await t.voc("s49v006t.voc")); // Grognon → S49_06T
    await t.press("Space");
    await t.settle("Board");
    expect(results).toEqual([{ kind: "all" }]);

    t.engine.ctx.scenes.push(
      createAbandonScene(1, (ctx, result) => {
        results.push(result);
        ctx.scenes.pop({ fade: true });
      }),
      { fade: true },
    );
    await t.settle("ConfirmScene");
    await t.press("ArrowRight");
    await t.press("Space");
    await t.settle("Board");
    expect(results.at(-1)).toEqual({ kind: "cancel" });
    expect(t.restored()).toBe(true);
  });

  it("souris : le clic droit joue la voix du joueur courant, le clic gauche le valide ; la position ne compte pas", async () => {
    const t = await session();
    const results = await abandon(t, [0, 3, 5]);
    await t.moveTo(250, 80); // au-dessus du troisième joueur : sans effet
    await t.press("ArrowRight"); // joueur 2
    await t.click(2);
    expect(t.lastSound()).toBe(await t.voc("s46a003t.voc"));
    await t.click();
    await t.settle("ConfirmScene");
    await t.press("Space");
    await t.settle("Board");
    expect(results).toEqual([{ kind: "player", index: 1 }]);
  });

  it("dessine portraits, cloches et boutons", async () => {
    const t = await session();
    await abandon(t, [0, 3, 5, 1]);
    const mcg = readData("S46/S46A/S46A001D.MCG").subarray(770);
    const changed = t.engine.ctx.surface.work.filter((v, i) => v !== mcg[i]).length;
    expect(changed).toBeGreaterThan(15000);
  });
});

describe.skipIf(!hasOriginalFiles)("S45 aide / écran info S03", () => {
  const game = () => Game.create({ players: [{ character: 1 }, { character: 4 }] }, new BorlandRandom(1));

  it("dessine l'état de la partie : barre de temps, portraits, ingrédients, points", async () => {
    const t = await session();
    const draw = async (elapsed: number, points: number) => {
      const g = game();
      g.state.elapsed = elapsed;
      g.state.players[0].points = points;
      const surface = t.engine.ctx.surface;
      const info = await loadInfo(t.engine.ctx);
      drawInfo(t.engine.ctx, info, g);
      return surface.work.slice();
    };
    const mcg = readData("S03/S03A/S03A001D.MCG").subarray(770);
    const count = (screen: Uint8Array, x0: number, x1: number, y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (screen[y * 320 + x] !== mcg[y * 320 + x]) n++;
      return n;
    };
    const start = await draw(0, 0);
    const half = await draw(900, 0); // 13 graduations sur 27 (900 × 27 / 1800)
    const full = await draw(1800, 5);
    // La barre de temps (x 290 à 311) se remplit ; la rangée du joueur 1 (x 85 à 280, y 54 à 100) change avec ses points.
    expect(count(half, 290, 312, 40, 195)).toBeGreaterThan(count(start, 290, 312, 40, 195));
    expect(count(full, 290, 312, 40, 195)).toBeGreaterThan(count(half, 290, 312, 40, 195));
    expect(count(start, 10, 85, 10, 100)).toBeGreaterThan(500); // portraits
    expect(count(full, 85, 280, 30, 60)).not.toBe(count(start, 85, 280, 30, 60));
    // Troisième et quatrième rangées vides : rien n'est dessiné.
    expect(count(start, 0, 285, 58, 101)).toBeGreaterThan(0); // joueur 2, deuxième rangée
    expect(count(start, 0, 285, 101, 195)).toBe(0);
  });

  it("clic gauche ferme (écran du dessous rétabli) ; clic droit joue la voix s45v003t sans fermer", async () => {
    const t = await session();
    let closed = 0;
    await t.push(
      createHelpScene(game(), (ctx) => {
        closed++;
        ctx.scenes.pop({ fade: true });
      }),
      "HelpScene",
    );
    await t.click(2);
    expect(t.lastSound()).toBe(await t.voc("s45v003t.voc"));
    expect(closed).toBe(0);
    await t.click(0);
    await t.settle("Board");
    expect(closed).toBe(1);
    expect(t.restored()).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("S52 générique", () => {
  const doc = (lines: string[]) => Uint8Array.from(lines.join("\r\n"), (c) => c.charCodeAt(0));
  const filler = (n: number, label: string) => Array.from({ length: n }, (_, i) => `${label} ${i}`);
  const TEXT = doc(["@1TITRE", ...filler(20, "intro"), "@2PARTIE DEUX", ...filler(20, "suite"), "@3FIN", "Merci", ...filler(15, "fin")]);

  async function credits(host: TestHost) {
    const t = await session(host);
    let ended = 0;
    t.engine.ctx.scenes.replace(createCreditsScene(() => ended++), { fade: true });
    await t.settle("CreditsScene");
    return { t, ended: () => ended };
  }

  it("texte réel : s52dsphi.doc est chargé (« Bruno Bonnell »), le générique défile", async () => {
    const real = readData("S52/S52D/S52DSPHI.DOC");
    const lines = parseCreditsText(real).map((l) => String.fromCharCode(...l));
    expect(lines).toContain("@1Bruno Bonnell");
    expect(lines.some((l) => l.startsWith("@2"))).toBe(true);
    expect(lines.some((l) => l.startsWith("@3"))).toBe(true);
    const { t, ended } = await credits(new TestHost());
    await runFor(t.engine, t.host, 500);
    const a = t.engine.ctx.surface.work.slice();
    await runFor(t.engine, t.host, 3000);
    const b = t.engine.ctx.surface.work.slice();
    expect(b.subarray(20 * 320, 180 * 320).filter((v) => v === 0x7f).length).toBeGreaterThan(0);
    expect(b.some((v, i) => v !== a[i])).toBe(true);
    expect(ended()).toBe(0);
  });

  it("sans fichier de texte : fond et musique, page finale, clic = fin après le fondu", async () => {
    const { t, ended } = await credits(new NoDocHost());
    expect(t.engine.ctx.voice.hasMusic).toBe(true);
    await t.click();
    expect(ended()).toBe(0);
    await runUntil(t.engine, t.host, () => ended() === 1);
    expect(t.engine.ctx.voice.hasMusic).toBe(false);
  });

  it(`sans clic, la page finale se termine seule après ${FINAL_WAIT_SECONDS} s`, async () => {
    const { t, ended } = await credits(new NoDocHost());
    await runFor(t.engine, t.host, (FINAL_WAIT_SECONDS - 5) * 1000);
    expect(ended()).toBe(0);
    await runUntil(t.engine, t.host, () => ended() === 1);
  }, 60_000);

  it("fait défiler le texte centré, avec contour, dans la fenêtre 20 à 179", async () => {
    const { t, ended } = await credits(new DocHost(TEXT));
    const mcg = readData("S52/S52D/S52D001D.MCG").subarray(770);
    const first = t.engine.ctx.surface.work.slice();
    await runFor(t.engine, t.host, 1000);
    const later = t.engine.ctx.surface.work.slice();
    // Du texte blanc (0x7F) et son contour (0x7E) dans la fenêtre ; l'extérieur garde le fond.
    expect(later.subarray(20 * 320, 180 * 320).filter((v) => v === 0x7f).length).toBeGreaterThan(200);
    expect(later.subarray(20 * 320, 180 * 320).filter((v) => v === 0x7e).length).toBeGreaterThan(200);
    expect(later.subarray(0, 20 * 320).every((v, i) => v === mcg[i])).toBe(true);
    expect(later.subarray(180 * 320).every((v, i) => v === mcg[180 * 320 + i])).toBe(true);
    // Le texte monte (l'image change d'un instant à l'autre).
    expect(later.some((v, i) => v !== first[i])).toBe(true);
    // Centré : autant de blanc de part et d'autre du milieu, à quelques pixels près.
    const row = (y: number) => later.subarray(y * 320, y * 320 + 320);
    let left = 0;
    let right = 0;
    for (let y = 20; y < 180; y++) {
      row(y).forEach((v, x) => {
        if (v === 0x7f) (x < 160 ? left++ : right++);
      });
    }
    expect(Math.abs(left - right)).toBeLessThan((left + right) * 0.35);
    expect(ended()).toBe(0);
  });

  it("un clic saute au repère suivant (@2 puis @3), la page finale s'arrête sur @3", async () => {
    const { t, ended } = await credits(new DocHost(TEXT));
    await runFor(t.engine, t.host, 800);
    await t.click(); // saute à @2 (au relâchement)
    await runFor(t.engine, t.host, 600);
    await t.click(); // saute à @3
    await runFor(t.engine, t.host, 600);
    // Page finale fixe : deux images successives sont identiques.
    const a = t.engine.ctx.surface.work.slice();
    await runFor(t.engine, t.host, 500);
    expect(t.engine.ctx.surface.work.every((v, i) => v === a[i])).toBe(true);
    expect(ended()).toBe(0);
    await t.press("Space");
    await runUntil(t.engine, t.host, () => ended() === 1);
    expect(t.host.exited).toBe(false);
  }, 60_000);

  it("défile jusqu'au bout sans clic", async () => {
    const { t, ended } = await credits(new DocHost(TEXT));
    // 2 × 20 lignes × 0,2 s environ, puis la page finale attend un clic.
    await runFor(t.engine, t.host, 14_000);
    await t.press("Space");
    await runUntil(t.engine, t.host, () => ended() === 1);
  }, 60_000);
});
