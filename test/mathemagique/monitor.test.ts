import { describe, expect, it, vi } from "vitest";
import { MohawkArchive } from "../../src/data/mohawk/mohawk";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import type { GadgetGroup } from "../../src/games/mathemagique/engine/gadgets";
import { parseFon, type FonFont } from "../../src/games/mathemagique/engine/graphics/fon";
import { encodeText, measureText } from "../../src/games/mathemagique/engine/graphics/text";
import type { KeyEvent } from "../../src/games/mathemagique/engine/input";
import { Archive } from "../../src/games/mathemagique/engine/resources";
import {
  ASCII_NAME_RULES,
  LATIN1_NAME_RULES,
  MAX_PLAYERS,
  Roster,
  RosterStore,
  canAppendNameChar,
  formatPlayerName,
  isNameChar,
  isValidPlayerName,
} from "../../src/games/mathemagique/engine/roster";
import { SceneId, type Scene, type SceneContext } from "../../src/games/mathemagique/engine/scene";
import { installServices, type MathServices } from "../../src/games/mathemagique/engine/services";
import {
  MONITOR_NAME_RULES,
  MonitorOverlay,
  type MonitorMode,
  type MonitorOpenOptions,
  type MonitorResult,
  type TextInputPort,
} from "../../src/games/mathemagique/scenes/monitor";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles, readOriginal } from "./helpers";

// --- Règles de nom (sans les fichiers du jeu) -----------------------------------------------------------------------------------

describe("règles de nom : lettres accentuées (roster.ts)", () => {
  it("garde le comportement d'origine par défaut : ASCII seulement", () => {
    expect(isNameChar("é")).toBe(false);
    expect(isValidPlayerName("Zoé")).toBe(false);
    expect(formatPlayerName("élodie")).toBe("élodie");
    const roster = Roster.createEmpty();
    expect(roster.addPlayer("Zoé")).toEqual({ ok: false, reason: "invalid" });
    expect(roster.addPlayer("zoe")).toEqual({ ok: true, id: 1, name: "Zoe" });
  });

  it("Latin-1 : accepte À–ÿ sauf × et ÷, refuse ce qui sort du Latin-1", () => {
    for (const c of ["À", "É", "Ñ", "ß", "à", "é", "ÿ", "ø"]) expect(isNameChar(c, LATIN1_NAME_RULES), c).toBe(true);
    for (const c of ["×", "÷", "Ω", "€", "œ", "😀", "-", "'"]) expect(isNameChar(c, LATIN1_NAME_RULES), c).toBe(false);
    expect(isNameChar("é", ASCII_NAME_RULES)).toBe(false);
    expect(canAppendNameChar("", "é", undefined, LATIN1_NAME_RULES)).toBe(true);
    expect(canAppendNameChar("", " ", undefined, LATIN1_NAME_RULES)).toBe(false);
  });

  it("met en majuscule les lettres accentuées, sans sortir du Latin-1 (ß et ÿ restent tels quels)", () => {
    expect(formatPlayerName("élodie çelik", LATIN1_NAME_RULES)).toBe("Élodie Çelik");
    expect(formatPlayerName("ßeta ÿves", LATIN1_NAME_RULES)).toBe("ßeta ÿves");
    expect(formatPlayerName("zoé  ñandú", LATIN1_NAME_RULES)).toBe("Zoé  Ñandú");
  });

  it("addPlayer / renamePlayer avec accents : un octet par lettre, aller-retour exact, doublon sensible à l'accent", () => {
    const roster = Roster.createEmpty();
    const added = roster.addPlayer("zoé", LATIN1_NAME_RULES);
    expect(added).toEqual({ ok: true, id: 1, name: "Zoé" });
    expect(roster.addPlayer("zoé", LATIN1_NAME_RULES)).toEqual({ ok: false, reason: "duplicate" });
    expect(roster.addPlayer("zoe", LATIN1_NAME_RULES).ok).toBe(true);
    expect(roster.addPlayer("Ωmega", LATIN1_NAME_RULES)).toEqual({ ok: false, reason: "invalid" });
    expect(roster.renamePlayer(1, "chloé", LATIN1_NAME_RULES)).toEqual({ ok: true, name: "Chloé" });
    const copy = Roster.decode(roster.encode());
    expect(copy.players().map((p) => p.name).sort()).toEqual(["Chloé", "Zoe"]);
  });

  it("règles du moniteur : seules les lettres dont la police a le glyphe (pas Ð ð Þ þ Ý ý)", () => {
    expect(MONITOR_NAME_RULES.isLetter("é")).toBe(true);
    expect(MONITOR_NAME_RULES.isLetter("Ö")).toBe(true);
    for (const c of ["Ð", "ð", "Þ", "þ", "Ý", "ý", "×", "÷"]) expect(MONITOR_NAME_RULES.isLetter(c), c).toBe(false);
    expect([...encodeText("Aé Öç")]).toEqual([0x41, 0x8e, 0x20, 0x85, 0x8d]);
  });
});

// --- Moniteur dans un moteur complet ---------------------------------------------------------------------------------------------

class FakeTextInput implements TextInputPort {
  focused = false;
  focusCalls = 0;
  private callback: ((text: string) => void) | null = null;
  focus(): void {
    this.focused = true;
    this.focusCalls++;
  }
  blur(): void {
    this.focused = false;
  }
  onText(callback: (text: string) => void): () => void {
    this.callback = callback;
    return () => {
      this.callback = null;
    };
  }
  emit(text: string): void {
    this.callback?.(text);
  }
  get subscribed(): boolean {
    return this.callback !== null;
  }
}

/** Scène de test : héberge le moniteur comme le ferait le hub (un groupe plein écran qui doit se taire pendant l'ouverture). */
class HostScene implements Scene {
  overlay!: MonitorOverlay;
  readonly sceneClicks: number[] = [];
  readonly keysSeen: string[] = [];
  group!: GadgetGroup;

  constructor(
    private readonly services: MathServices,
    private readonly archive: Archive,
    private readonly font: FonFont,
    private readonly textInput: TextInputPort,
    private readonly hub: boolean,
  ) {}

  enter(ctx: SceneContext): void {
    this.services.useArchive(this.archive);
    this.services.graphics.screen.fill(7);
    this.group = this.services.gadgets.addGroup({ records: [{ rect: { x: 0, y: 0, w: 576, h: 432 } }], onActivate: (i) => this.sceneClicks.push(i) });
    this.overlay = new MonitorOverlay({
      ctx,
      services: this.services,
      archive: this.archive,
      font: this.font,
      textInput: this.textInput,
      sceneGroups: () => [this.group],
      hub: this.hub,
    });
  }
  leave(): void {
    this.overlay.dispose();
    this.services.endScene();
  }
  tick(): void {
    this.overlay.tick();
  }
  key(event: KeyEvent): boolean {
    this.keysSeen.push(event.key);
    return this.overlay.key(event);
  }
}

/** Positions des gadgets (common.md §3.2), au centre de leur rectangle. */
const AT = {
  ok: [278, 284],
  up: [320, 311],
  down: [320, 347],
  newPlayer: [390, 376],
  roster: [385, 379],
  prefs: [344, 376],
  ambient: [330, 320],
  click: [330, 337],
  row: (k: number) => [397, 307 + 22 * k] as [number, number],
  del: [405, 376],
  add: [449, 376],
  screen: [380, 340],
  polyHead: [100, 280],
} as const;

describe.runIf(hasOriginalFiles)("MonitorOverlay (MAINSCRN.DAT réel)", () => {
  const archive = new Archive("MAINSCRN.DAT", MohawkArchive.parse(readOriginal("MAINSCRN.DAT")));
  const font = parseFon(readOriginal("NCSCLB10.FON"))[0]!;

  async function boot(options: { hub?: boolean; players?: string[]; roster?: (roster: Roster) => void } = {}) {
    const host = new TestHost();
    const seeded = Roster.createEmpty();
    for (const name of options.players ?? []) seeded.addPlayer(name, LATIN1_NAME_RULES);
    options.roster?.(seeded);
    new RosterStore(host.storage).save(seeded);
    const engine = new Engine(host, { seed: 3 });
    const services = installServices(engine);
    const textInput = new FakeTextInput();
    const scene = new HostScene(services, archive, font, textInput, options.hub ?? false);
    engine.register(SceneId.hub, () => scene);
    engine.start(SceneId.hub);
    await runFor(engine, host, 100);
    const roster = () => engine.ctx.roster;
    const stored = () => new RosterStore(host.storage).load().roster;
    const results: MonitorResult[] = [];
    const open = async (mode: MonitorMode, openOptions?: MonitorOpenOptions) => {
      scene.overlay.open(mode, (result) => results.push(result), openOptions);
      await runUntil(engine, host, () => scene.overlay.ready);
      await runFor(engine, host, 50);
    };
    const wait = (ms = 80) => runFor(engine, host, ms);
    const click = async (at: readonly [number, number] | readonly number[], mods: { ctrl?: boolean } = {}) => {
      host.input.moveMouse(at[0]!, at[1]!);
      host.input.mouseDown("left", mods);
      host.input.mouseUp("left", mods);
      await wait();
      host.input.keyUp("ControlLeft", { ctrl: false, shift: false, alt: false });
    };
    const type = async (text: string) => {
      for (const c of text) host.press(c === " " ? "Space" : `Key${c.toUpperCase()}`, { key: c });
      await wait();
    };
    const press = async (code: string) => {
      host.press(code, { key: code });
      await wait();
    };
    return { host, engine, services, scene, textInput, roster, stored, results, open, wait, click, type, press };
  }

  it("ouvre en glissant depuis le bas, neutralise les groupes de la scène, puis les rend à la fermeture", async () => {
    const t = await boot({ players: ["Alice"] });
    const before = t.services.graphics.screen.pixels.slice();
    t.scene.overlay.open("signin", (r) => t.results.push(r));
    expect(t.scene.overlay.isOpen).toBe(true);
    expect(t.scene.group.active).toBe(false);
    await runUntil(t.engine, t.host, () => t.scene.overlay.ready);
    await t.wait();
    expect(t.services.graphics.screen.pixels.some((v, i) => v !== before[i])).toBe(true);

    // Les clics ne touchent que le moniteur : le groupe plein écran de la scène reste muet.
    await t.click(AT.row(0));
    expect(t.scene.sceneClicks).toEqual([]);
    await t.click(AT.ok);
    await runUntil(t.engine, t.host, () => !t.scene.overlay.isOpen);
    expect(t.results).toHaveLength(1);
    expect(t.scene.group.active).toBe(true);
    expect(t.services.graphics.screen.pixels).toEqual(before);
    await t.click([20, 20]);
    expect(t.scene.sceneClicks).toEqual([1]);
  });

  it("connexion : une liste alphabétique de 3 noms, flèches, clic sur un nom = joueur courant, double clic = OK", async () => {
    const t = await boot({ players: ["Delta", "Alice", "Charly", "Bob", "Écho"] });
    await t.open("signin");
    // Ordre alphabétique : Alice, Bob, Charly, Delta, Écho ; 3 lignes visibles.
    await t.click(AT.row(1));
    expect(t.roster().currentPlayer?.name).toBe("Bob");
    await t.click(AT.down);
    await t.click(AT.down);
    await t.click(AT.down); // ne dépasse pas la fin
    await t.click(AT.row(0));
    expect(t.roster().currentPlayer?.name).toBe("Charly");
    await t.click(AT.up);
    await t.click(AT.row(0));
    expect(t.roster().currentPlayer?.name).toBe("Bob");
    // Les chiffres 1 à 3 sélectionnent les lignes.
    await t.type("3");
    expect(t.roster().currentPlayer?.name).toBe("Delta");
    // Double clic sur la même ligne dans les 15 ticks.
    t.host.input.moveMouse(...AT.row(2));
    t.host.input.mouseDown("left");
    t.host.input.mouseUp("left");
    await runFor(t.engine, t.host, 34);
    t.host.input.mouseDown("left");
    t.host.input.mouseUp("left");
    await runUntil(t.engine, t.host, () => t.results.length === 1);
    expect(t.results[0]).toMatchObject({ mode: "signin", playerId: t.roster().currentPlayerId, previousPlayerId: 0 });
    expect(t.roster().currentPlayer?.name).toBe("Delta");
    expect(t.scene.overlay.isOpen).toBe(false);
  });

  it("un seul joueur : présélectionné ; roster vide : passe tout de suite à la saisie d'un nom", async () => {
    const one = await boot({ players: ["Alice"] });
    await one.open("signin");
    expect(one.roster().currentPlayer?.name).toBe("Alice");

    const none = await boot();
    await none.open("signin");
    expect(none.scene.overlay.typedName).toBe("");
    expect(none.textInput.focused).toBe(true);
  });

  it("ajoute un joueur avec des accents (clavier physique et clavier virtuel), mis en forme et enregistré", async () => {
    const t = await boot({ players: ["Alice"] });
    await t.open("signin");
    await t.click(AT.newPlayer);
    expect(t.scene.overlay.typedName).toBe("");
    expect(t.textInput.focused).toBe(true);
    await t.type("zoé");
    t.textInput.emit(" çé");
    t.textInput.emit("\bt");
    await t.wait();
    expect(t.scene.overlay.typedName).toBe("zoé çt");
    await t.press("Enter");
    const added = t.roster().roster.players().find((p) => p.name === "Zoé Çt");
    expect(added).toBeDefined();
    expect(t.roster().currentPlayerId).toBe(added!.id);
    expect(t.scene.overlay.typedName).toBeNull();
    expect(t.textInput.focused).toBe(false);
    // Enregistré tout de suite, accents compris.
    expect(t.stored().players().map((p) => p.name)).toEqual(["Alice", "Zoé Çt"]);
  });

  it("roster vide : le nom tapé puis New Player crée le joueur, le sélectionne et ramène la liste (pas de nouvelle saisie vide)", async () => {
    const t = await boot();
    await t.open("signin");
    await t.type("suz");
    await t.click(AT.newPlayer);
    expect(t.roster().roster.players().map((p) => p.name)).toEqual(["Suz"]);
    expect(t.roster().currentPlayer?.name).toBe("Suz");
    expect(t.scene.overlay.typedName).toBeNull();
    expect(t.textInput.focused).toBe(false);
    // Un nouveau clic commence bien la saisie d'un autre joueur.
    await t.click(AT.newPlayer);
    expect(t.scene.overlay.typedName).toBe("");
  });

  it("refuse les caractères hors règles (ponctuation, lettres sans glyphe, 1er caractère non alphanumérique)", async () => {
    const t = await boot({ players: ["Alice"] });
    await t.open("signin");
    await t.click(AT.newPlayer);
    t.textInput.emit(" .-'");
    t.textInput.emit("Ð");
    expect(t.scene.overlay.typedName).toBe("");
    t.textInput.emit("a-b'c.d 1×÷Ω");
    expect(t.scene.overlay.typedName).toBe("abc.d 1");
  });

  it("doublon : le joueur n'est pas créé, la saisie reste ouverte, un son d'erreur est joué (ailleurs que dans le hub)", async () => {
    const t = await boot({ players: ["Alice"] });
    await t.open("signin");
    const waves = t.host.audio.waves.length;
    await t.click(AT.newPlayer);
    await t.type("alice");
    await t.press("Enter");
    expect(t.roster().roster.playerCount).toBe(1);
    expect(t.scene.overlay.typedName).toBe("alice");
    expect(t.host.audio.waves.length).toBeGreaterThan(waves);
    expect(t.scene.overlay.isOpen).toBe(true);
    // Un nom qui ne diffère que par l'accent n'est pas un doublon.
    t.textInput.emit("\b\b\b\b\bélodie");
    await t.press("Enter");
    expect(t.roster().roster.players().map((p) => p.name)).toEqual(["Alice", "Élodie"]);
  });

  it("doublon dans le hub : Poly joue la chaîne 8500, 8600, 8700", async () => {
    const t = await boot({ hub: true, players: ["Alice"] });
    const started: number[] = [];
    const start = t.services.scr.start.bind(t.services.scr);
    vi.spyOn(t.services.scr, "start").mockImplementation((arch, id, options) => {
      started.push(id);
      return start(arch, id, options);
    });
    await t.open("signin");
    await t.click(AT.newPlayer);
    await t.type("alice");
    await t.press("Enter");
    expect(t.roster().roster.playerCount).toBe(1);
    // Poly demande de cliquer sur son nom dans la liste : la saisie s'arrête pour la montrer, sans changer de joueur.
    expect(t.scene.overlay.typedName).toBeNull();
    expect(t.scene.overlay.isOpen).toBe(true);
    await runUntil(t.engine, t.host, () => started.length >= 3, 120_000);
    expect(started.slice(0, 3)).toEqual([8500, 8600, 8700]);
  });

  it("limites : 28 caractères au plus et moins de 110 px en NCSclB10", async () => {
    const t = await boot({ players: ["Alice"] });
    await t.open("signin");
    await t.click(AT.newPlayer);
    // Caractères étroits : c'est le plafond de 28 caractères qui compte.
    t.textInput.emit("i" + ".".repeat(60));
    const narrow = t.scene.overlay.typedName!;
    expect(measureText(font, encodeText(narrow))).toBeLessThan(110);
    expect(narrow).toHaveLength(28);
    t.textInput.emit("\b".repeat(40));
    expect(t.scene.overlay.typedName).toBe("");
    // Caractères larges : c'est la largeur qui compte, bien avant 28.
    t.textInput.emit("W".repeat(40));
    const wide = t.scene.overlay.typedName!;
    expect(wide.length).toBeLessThan(28);
    expect(measureText(font, encodeText(wide))).toBeLessThan(110);
    expect(measureText(font, encodeText(wide + "W"))).toBeGreaterThanOrEqual(110);
  });

  it("40 joueurs au plus : New Player est refusé quand la liste est pleine", async () => {
    const names = Array.from({ length: MAX_PLAYERS }, (_, i) => `Joueur ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? "." : ""}${i}`);
    const t = await boot({ players: names });
    expect(t.roster().roster.playerCount).toBe(MAX_PLAYERS);
    await t.open("signin");
    await t.click(AT.newPlayer);
    expect(t.scene.overlay.typedName).toBeNull();
    expect(t.roster().roster.playerCount).toBe(MAX_PLAYERS);
  });

  it("édition du roster : sélectionner puis Delete retire le joueur, désélectionne et enregistre", async () => {
    const t = await boot({ players: ["Alice", "Bob", "Charly"] });
    await t.open("roster");
    await t.click(AT.del); // personne de sélectionné : sans effet
    expect(t.roster().roster.playerCount).toBe(3);
    await t.click(AT.row(1));
    expect(t.roster().currentPlayer?.name).toBe("Bob");
    await t.click(AT.del);
    expect(t.roster().roster.players().map((p) => p.name)).toEqual(["Alice", "Charly"]);
    expect(t.roster().currentPlayerId).toBe(0);
    expect(t.stored().players().map((p) => p.name)).toEqual(["Alice", "Charly"]);
    // Add crée un joueur comme New Player.
    await t.click(AT.add);
    await t.type("dora");
    await t.press("Enter");
    expect(t.roster().roster.players().map((p) => p.name)).toEqual(["Alice", "Charly", "Dora"]);
  });

  it("préférences : bascules appliquées tout de suite, timer 1 à 999 s, enregistrées à la fermeture", async () => {
    const t = await boot({ players: ["Alice"] });
    const stopAmbient = vi.spyOn(t.services.sound, "stopAmbient");
    await t.open("preferences");
    expect(t.textInput.focused).toBe(true);
    expect(t.roster().roster.ambient).toBe(true);
    expect(t.roster().roster.clickAndStick).toBe(true);
    await t.click(AT.ambient);
    expect(t.roster().roster.ambient).toBe(false);
    expect(stopAmbient).toHaveBeenCalled();
    await t.click(AT.click);
    expect(t.roster().roster.clickAndStick).toBe(false);
    // Timer : « 180 » → effacer, taper 90.
    await t.press("Backspace");
    await t.press("Backspace");
    await t.press("Backspace");
    await t.type("90");
    expect(t.stored().ambient).toBe(true); // rien n'est écrit avant la fermeture
    // 0 : refusé à la fermeture (l'ancienne valeur reste) ; 3 chiffres au plus ; lettres ignorées.
    await t.press("Backspace");
    await t.press("Backspace");
    await t.type("0x");
    t.textInput.emit("\b\b\b12345");
    await t.press("Enter"); // Entrée = OK, même si la souris est restée sur « Click & Stick »
    expect(t.roster().roster.clickAndStick).toBe(false);
    await runUntil(t.engine, t.host, () => t.results.length === 1);
    expect(t.results[0]).toMatchObject({ mode: "preferences", ambientChanged: true });
    const saved = t.stored();
    expect([saved.ambient, saved.clickAndStick, saved.bowlingTicks]).toEqual([false, false, 123 * 60]);
  });

  it("un timer invalide à la fermeture garde l'ancienne valeur", async () => {
    const t = await boot();
    await t.open("preferences");
    for (let i = 0; i < 3; i++) await t.press("Backspace");
    await t.type("0");
    await t.click(AT.ok);
    await runUntil(t.engine, t.host, () => t.results.length === 1);
    expect(t.stored().bowlingSeconds).toBe(180);
  });

  it("préférences : Click & Stick change le mode du pointeur, Roster ouvre l'édition et Preferences en revient", async () => {
    const t = await boot({ players: ["Alice", "Bob"] });
    await t.open("preferences");
    await t.click(AT.click);
    t.services.pointer.carry({ item: "pièce", x: 100, y: 100, width: 10, height: 10 }, "left", 100, 100);
    expect(t.services.pointer.mode).toBe("drag");
    t.services.pointer.cancel();
    await t.click(AT.roster);
    await t.click(AT.row(0));
    expect(t.roster().currentPlayer?.name).toBe("Alice");
    await t.click(AT.prefs);
    // De retour dans les préférences : le champ du timer est affiché avec la valeur du roster (« 180 », 3 chiffres déjà), éditable.
    await t.press("Backspace");
    await t.type("5");
    await t.click(AT.ok);
    await runUntil(t.engine, t.host, () => t.results.length === 1);
    expect(t.stored().bowlingSeconds).toBe(185);
  });

  it("Math Trivia : Poly annonce (5900) puis raconte l'histoire 6100 + 100 n ; Ctrl + clic passe à la suivante, un clic rejoue", async () => {
    const t = await boot({ hub: true });
    const started: number[] = [];
    const start = t.services.scr.start.bind(t.services.scr);
    vi.spyOn(t.services.scr, "start").mockImplementation((arch, id, options) => {
      started.push(id);
      return start(arch, id, options);
    });
    await t.open("trivia");
    expect(started[0]).toBe(5900);
    const story = started[1]!;
    expect(story % 100).toBe(0);
    const n = (story - 6100) / 100;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(19);
    // Le dessin de la trivia (SHPL 399 + n) est dans l'écran du moniteur.
    const shape = archive.shap(399 + n);
    const screen = t.services.graphics.screen;
    let compared = 0;
    for (let y = 40; y < 80; y++) {
      for (let x = 60; x < 120; x++) {
        const v = shape.pixels[y * shape.width + x]!;
        if (v === 0) continue;
        expect(screen.pixels[(282 + y) * 576 + 291 + x]).toBe(v);
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(100);
    // Un clic rejoue la même histoire ; Ctrl + clic sur Poly passe à la suivante du cycle 1…19.
    await t.click(AT.polyHead);
    expect(started.at(-1)).toBe(story);
    await t.click(AT.screen, { ctrl: true });
    expect(started.at(-1)).toBe(6100 + 100 * ((n % 19) + 1));
    await t.click(AT.ok);
    await runUntil(t.engine, t.host, () => t.results.length === 1);
    expect(t.results[0]!.mode).toBe("trivia");
  });

  it("Math Trivia : la dernière trivia (19) est suivie de la première ; les tirages ne se répètent pas avant d'avoir fait le tour", async () => {
    const t = await boot();
    const seen: number[] = [];
    const start = t.services.scr.start.bind(t.services.scr);
    vi.spyOn(t.services.scr, "start").mockImplementation((arch, id, options) => {
      if (id >= 6200) seen.push((id - 6100) / 100);
      return start(arch, id, options);
    });
    for (let i = 0; i < 19; i++) {
      await t.open("trivia");
      await t.click(AT.ok);
      await runUntil(t.engine, t.host, () => !t.scene.overlay.isOpen);
    }
    expect(new Set(seen).size).toBe(19);
  });

  it("séquence secrète : montre la photo de l'équipe (palette propre rendue ensuite), sans histoire de Poly", async () => {
    const t = await boot();
    const stories: number[] = [];
    const start = t.services.scr.start.bind(t.services.scr);
    vi.spyOn(t.services.scr, "start").mockImplementation((arch, id, options) => {
      if (id >= 6200) stories.push(id);
      return start(arch, id, options);
    });
    const palette = t.services.graphics.palette;
    const before = palette.snapshot(216, 18);
    await t.open("trivia", { secretPhoto: 303 });
    expect(palette.snapshot(216, 18)).not.toEqual(before);
    expect(stories).toEqual([]);
    await t.click(AT.screen); // sans Ctrl : rien à rejouer
    expect(stories).toEqual([]);
    await t.click(AT.ok);
    await runUntil(t.engine, t.host, () => t.results.length === 1);
    expect(palette.snapshot(216, 18)).toEqual(before);
  });

  it("dispose ferme tout de suite, rend les groupes et enregistre ; Ctrl + touche n'est pas consommé", async () => {
    const t = await boot({ players: ["Alice"] });
    await t.open("signin");
    expect(t.scene.overlay.key({ key: "q", code: "KeyQ", ctrl: true, shift: false, alt: false, repeat: false })).toBe(false);
    expect(t.textInput.subscribed).toBe(true);
    t.scene.overlay.dispose();
    expect(t.scene.overlay.isOpen).toBe(false);
    expect(t.scene.group.active).toBe(true);
    expect(t.textInput.subscribed).toBe(false);
    expect(t.results).toEqual([]);
    expect(t.scene.overlay.key({ key: "a", code: "KeyA", ctrl: false, shift: false, alt: false, repeat: false })).toBe(false);
  });

  it("les lettres accentuées ont les bons glyphes de la police (Mac Roman) : même fond que la lettre de base", () => {
    const pairs: [string, string][] = [["é", "e"], ["è", "e"], ["ê", "e"], ["ë", "e"], ["à", "a"], ["â", "a"], ["ä", "a"], ["ö", "o"], ["ô", "o"], ["û", "u"], ["ù", "u"], ["ü", "u"], ["ñ", "n"]];
    for (const [accented, base] of pairs) {
      const g = font.glyph(encodeText(accented)[0]!);
      const b = font.glyph(base.charCodeAt(0));
      const rows = 6;
      const bottom = (glyph: typeof g) => [...glyph.pixels.subarray((font.height - rows - 2) * glyph.width, (font.height - 2) * glyph.width)].join("");
      expect(bottom(g), accented).toBe(bottom(b));
    }
  });
});
