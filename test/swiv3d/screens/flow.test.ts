import { beforeEach, describe, expect, it } from "vitest";
import type { MusicContext, MusicPreference } from "../../../src/games/swiv3d/audio";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { Flow, format, type FlowHost, type LevelRequest, type UiInput, type UiKey } from "../../../src/games/swiv3d/screens/flow";
import { ADVENTURE_COMPLETED, PilotStore, type Volumes } from "../../../src/games/swiv3d/screens/pilots";
import { hasOriginalFiles } from "../helpers";
import { loadGlobal, stubText } from "./support";

class FakeHost implements FlowHost {
  sounds: number[] = [];
  contexts: MusicContext[] = [];
  preferences: MusicPreference[] = [];
  volumeCalls: Volumes[] = [];
  levels: LevelRequest[] = [];
  ended = 0;
  paused: boolean[] = [];
  left = 0;
  existing = new Set(["TERRAN00", "TERRAN01", "TERRAN02", "TERRAN03"]);
  sound(n: number): void {
    this.sounds.push(n);
  }
  music(c: MusicContext): void {
    this.contexts.push(c);
  }
  musicPreference(p: MusicPreference): void {
    this.preferences.push(p);
  }
  volumes(v: Volumes): void {
    this.volumeCalls.push({ ...v });
  }
  startLevel(r: LevelRequest): void {
    this.levels.push(r);
  }
  endLevel(): void {
    this.ended++;
  }
  pauseLevel(p: boolean): void {
    this.paused.push(p);
  }
  hasLevel(name: string): boolean {
    return this.existing.has(name);
  }
  leave(): void {
    this.left++;
  }
}

const NONE: UiInput = { keys: [], chars: [], taps: [], pressed: false };

class Driver {
  now = 1000;
  constructor(readonly flow: Flow) {}
  /** `n` images sans entrée (16 ms chacune). */
  idle(n = 6): void {
    for (let i = 0; i < n; i++) {
      this.now += 16;
      this.flow.update(this.now, NONE);
    }
  }
  /** Laisse passer la garde d'Entrée, appuie, laisse passer une image. */
  press(...keys: UiKey[]): void {
    this.idle();
    this.now += 16;
    this.flow.update(this.now, { keys, chars: [], taps: [], pressed: keys.length > 0 });
    this.idle(1);
  }
  type(text: string): void {
    this.idle();
    this.now += 16;
    this.flow.update(this.now, { keys: [], chars: [...text], taps: [], pressed: true });
  }
  anyKey(): void {
    this.now += 16;
    this.flow.update(this.now, { ...NONE, pressed: true });
  }
  wait(ms: number): void {
    this.now += ms;
    this.flow.update(this.now, NONE);
  }
  get ids(): number[] {
    const v = this.flow.view;
    return v.kind === "menu" ? v.menu.ids() : [];
  }
  get selected(): number {
    const v = this.flow.view;
    return v.kind === "menu" ? v.menu.selected : -1;
  }
  /** Choisit l'élément `id` du menu courant : descend jusqu'à lui puis valide. */
  choose(id: number): void {
    const v = this.flow.view;
    if (v.kind !== "menu") throw new Error("pas de menu");
    for (let i = 0; i < 20 && this.selected !== id; i++) this.press("down");
    expect(this.selected).toBe(id);
    this.press("enter");
  }
}

describe.skipIf(!hasOriginalFiles)("enchaînement des écrans (textes et script du jeu)", () => {
  let raw: MemoryStorage;
  let store: PilotStore;
  let host: FakeHost;

  function start(boot = false): Driver {
    const global = loadGlobal();
    const flow = new Flow(
      { strings: global.strings, script: global.missions, text: stubText(), store, bindingLabel: (action) => action },
      host,
      boot,
    );
    return new Driver(flow);
  }

  /** Crée « Suzy » et arrive sur le menu principal. */
  function mainMenuAs(name = "Suzy"): Driver {
    const d = start();
    d.choose(0);
    d.type(name);
    d.press("enter");
    return d;
  }

  beforeEach(() => {
    raw = new MemoryStorage();
    store = new PilotStore(prefixedStorage(raw, "swiv3d:"));
    host = new FakeHost();
  });

  it("chaque menu a le titre 3D et la teinte de l'exécutable, et un bandeau sans le titre", () => {
    const strings = loadGlobal().strings;
    const title = (table: number, id: number, tint: number) => ({ text: strings.getBytes(1, table, id), tint });
    const d = mainMenuAs();
    const view = (): { title: unknown; menu: { texts(): string[] } } => d.flow.view as never;
    expect(view().title).toEqual(title(1, 0, 0x1000));
    expect(view().menu.texts()[0]).toBe("Menu principal pour les"); // le bandeau (1, 1), pas le titre
    d.choose(40); // Installer
    expect(view().title).toEqual(title(2, 0, 0x1500));
    expect(view().menu.texts()).toContain("Volume");
    expect(view().menu.texts()).not.toContain("Installer");
    d.choose(11);
    expect(view().title).toEqual(title(8, 0, 0x1500));
    d.press("escape");
    d.choose(12);
    expect(view().title).toEqual(title(2, 100, 0x400)); // « Langue »
    d.press("escape");
    d.choose(14);
    expect(view().title).toEqual(title(9, 0, 0x1500));
    d.press("escape");
    d.choose(10);
    expect(view().title).toEqual(title(3, 0, 0x400)); // « Configuration du|contrôleur »
    d.press("escape");
    d.press("escape");
    d.choose(80);
    expect(view().title).toEqual(title(13, 20, 0x1400));
    d.press("escape");
    d.choose(70);
    expect(view().title).toEqual(title(0, 0, 0x1500));
  });

  it("écran de fin : pas de titre 3D, bandeaux encadrés (mission puis « Mission accomplie ! », ou « Game over » puis mission)", () => {
    const d = mainMenuAs();
    d.choose(10);
    d.flow.videoEnded(false);
    d.flow.levelEnded("gameOver", { seconds: 5 });
    const view = d.flow.view as { title: unknown; backdrop: string; menu: { texts(): string[] } };
    expect(view).toMatchObject({ backdrop: "level", title: null });
    expect(view.menu.texts().slice(0, 2)).toEqual(["Game over", "Fastoche"]);
  });

  it("sans pilote : la sélection propose seulement « Nouveau pilote », musique des menus", () => {
    const d = start();
    expect(d.flow.phaseName).toBe("menu");
    expect(d.flow.view).toMatchObject({ kind: "menu", backdrop: "demo" });
    expect(d.ids).toEqual([0]);
    expect(host.contexts.at(-1)).toBe("menu");
  });

  it("crée un pilote par la saisie du nom (15 caractères au plus, Retour arrière) puis ouvre le menu principal", () => {
    const d = start();
    d.choose(0);
    expect(d.flow.phaseName).toBe("name");
    d.type("Capitaine Haddock XYZ");
    d.press("backspace");
    d.press("enter");
    expect(d.flow.phaseName).toBe("menu");
    expect(store.list().map((p) => p.name)).toEqual(["Capitaine Hadd"]);
    // Menu principal d'un pilote qui n'a rien joué : seulement « Commencer le jeu ».
    expect(d.ids).toEqual([10, 40, 50, 60, 70, 80]);
    expect(host.preferences.at(-1)).toBe("swiv");
  });

  it("une saisie vide ne crée rien ; Échap revient à la liste", () => {
    const d = start();
    d.choose(0);
    d.press("enter");
    expect(d.flow.phaseName).toBe("name");
    d.press("escape");
    expect(d.flow.phaseName).toBe("menu");
    expect(store.list()).toHaveLength(0);
  });

  it("Commencer le jeu : briefing BR_TER0 (musique coupée), puis TERRAN00 avec l'état de la mission", () => {
    const d = mainMenuAs();
    d.choose(10);
    expect(d.flow.view).toMatchObject({ kind: "video", name: "BR_TER0", mission: 0, overlay: true });
    expect(host.contexts.at(-1)).toBe("silent");
    d.flow.videoEnded(false);
    expect(d.flow.view.kind).toBe("level");
    expect(host.levels).toHaveLength(1);
    expect(host.levels[0]).toMatchObject({ name: "TERRAN00", mission: 0 });
    expect(host.levels[0]!.vars.get(1)).toBe(496);
    expect(host.levels[0]!.pilot.name).toBe("Suzy");
  });

  it("mission accomplie : écran de fin (touches ignorées au début), puis briefing de la mission suivante", () => {
    const d = mainMenuAs();
    d.choose(10);
    d.flow.videoEnded(false);
    d.flow.levelEnded("complete", { seconds: 75 });
    expect(d.flow.phaseName).toBe("end");
    expect(d.flow.view).toMatchObject({ kind: "menu", backdrop: "level" });
    d.idle(70); // ~1,1 s : compteur de fin à 99 sur 110
    d.anyKey();
    expect(d.flow.phaseName).toBe("end");
    d.idle(20);
    d.anyKey();
    expect(host.ended).toBe(1);
    expect(d.flow.view).toMatchObject({ kind: "video", name: "BR_TER1", mission: 1 });
    // meilleure mission = celle qui est démarrée ; temps de jeu cumulé ; tout est enregistré
    expect(store.get(0)).toMatchObject({ bestMission: 1, playSeconds: 75 });
  });

  it("enchaîne les 4 missions, puis l'aventure est terminée : plus de « Continuer », « Rejouer » ouvert aux 4", () => {
    const d = mainMenuAs();
    d.choose(10);
    for (let mission = 0; mission < 4; mission++) {
      expect(d.flow.view).toMatchObject({ kind: "video", name: `BR_TER${mission}` });
      d.flow.videoEnded(false);
      expect(host.levels.at(-1)?.name).toBe(`TERRAN0${mission}`);
      d.flow.levelEnded("complete", { seconds: 10 });
      d.idle(130);
      d.anyKey();
    }
    expect(d.flow.view).toMatchObject({ kind: "menu", backdrop: "demo" });
    expect(store.get(0)?.bestMission).toBe(ADVENTURE_COMPLETED);
    expect(d.ids).toEqual([30, 40, 50, 60, 70, 80]);
    expect(host.contexts.at(-1)).toBe("menu");
    d.choose(30);
    expect(d.ids).toEqual([0, 1, 2, 3]);
  });

  it("l'état d'arrivée suit les missions : fiche 1000 + n écrite à l'élément 200, variables semées, pas de report après un game over", () => {
    const d = mainMenuAs();
    d.choose(10);
    d.flow.videoEnded(false);
    expect(host.levels[0]!.state).toBeNull();
    const ammo = Array.from({ length: 20 }, (_, k) => (k === 1 ? 3 : 0));
    const state = { ammo, score: 800, form: 0, energy: 400, cannonPower: 2 };
    d.flow.levelEnded("complete", { seconds: 10, state });
    d.idle(130);
    d.anyKey();
    expect(store.get(0)!.states[1]).toEqual(state);
    d.flow.videoEnded(false);
    const next = host.levels.at(-1)!;
    expect(next).toMatchObject({ name: "TERRAN01", mission: 1, state });
    expect([next.vars.get(1), next.vars.get(2), next.vars.get(101)]).toEqual([400, 800, 3]);
    // game over : rien n'est reporté, la fiche d'arrivée reste celle de la mission
    d.flow.levelEnded("gameOver", { seconds: 5, state: { ...state, score: 9999 } });
    d.idle(130);
    d.anyKey();
    expect(store.get(0)!.states[1]!.score).toBe(800);
    expect(store.get(0)!.states[2]).toBeUndefined();
  });

  it("« Rejouer la mission 1 » repart de l'état d'arrivée enregistré", () => {
    const pilot = store.create("Suzy", 1)!;
    pilot.bestMission = 2;
    pilot.states[1] = { ammo: new Array<number>(20).fill(2), score: 123, form: 0, energy: 111, cannonPower: 1 };
    store.save(pilot);
    const d = start();
    d.press("enter");
    d.choose(30);
    d.choose(1);
    d.flow.videoEnded(false);
    const request = host.levels.at(-1)!;
    // énergie 111 relevée à 248 par l'élément `101 1 248`, score et munitions repris de la fiche
    expect([request.vars.get(1), request.vars.get(2), request.vars.get(100)]).toEqual([248, 123, 2]);
    expect(request.state?.cannonPower).toBe(1);
  });

  it("écran de fin : score du niveau et total, temps, pourcentages ; bonus et secrets seulement s'il y en a", () => {
    const { strings } = loadGlobal();
    const d = mainMenuAs();
    d.choose(10);
    d.flow.videoEnded(false);
    d.flow.levelEnded("complete", {
      seconds: 3725,
      levelScore: 1500,
      score: 4200,
      objectivesPercent: 66,
      bonusPercent: 25,
      secretsPercent: 0,
      bonusTotal: 4,
      secretsTotal: 0,
    });
    d.idle(1500); // décompte terminé (scores de plusieurs milliers : 12 par tick)
    const view = d.flow.view;
    if (view.kind !== "menu") throw new Error("pas de menu");
    const texts = view.menu.texts();
    const s = (table: number, id: number): string => strings.get(1, table, id)!;
    expect(texts).toEqual(
      expect.arrayContaining([format(s(7, 10), 1500), format(s(7, 11), 4200), format(s(7, 12), 1, 2, 5), format(s(7, 14), 66), format(s(7, 15), 25)]),
    );
    expect(texts.some((t) => t === format(s(7, 16), 0))).toBe(false);
  });

  it("game over : même écran sans bonus ni secrets, avec le nom de la mission", () => {
    const d = mainMenuAs();
    d.choose(10);
    d.flow.videoEnded(false);
    d.flow.levelEnded("gameOver", { seconds: 5, levelScore: 10, score: 10, objectivesPercent: 0, bonusPercent: 10, bonusTotal: 3, secretsTotal: 3 });
    const view = d.flow.view;
    if (view.kind !== "menu") throw new Error("pas de menu");
    const texts = view.menu.texts();
    expect(texts.some((t) => t.includes("Bonus"))).toBe(false);
    expect(texts.some((t) => t.includes("Secrets"))).toBe(false);
    expect(texts.some((t) => t.includes("Fastoche"))).toBe(true);
  });

  it("game over : écran de fin puis retour au menu principal, « Continuer » à la mission atteinte", () => {
    const d = mainMenuAs();
    d.choose(10);
    d.flow.videoEnded(false);
    d.flow.levelEnded("gameOver", { seconds: 5 });
    expect(d.flow.phaseName).toBe("end");
    d.idle(130);
    d.anyKey();
    expect(d.flow.view).toMatchObject({ kind: "menu", backdrop: "demo" });
    expect(host.ended).toBe(1);
    expect(host.contexts.at(-1)).toBe("menu");
    // Mission 0 seulement atteinte : toujours « Commencer le jeu » (la meilleure mission est celle qui a été démarrée).
    expect(d.ids).toContain(10);
  });

  it("Continuer reprend à la meilleure mission ; Rejouer propose les missions jusque-là", () => {
    const d = mainMenuAs();
    const pilot = store.get(0)!;
    pilot.bestMission = 2;
    store.save(pilot);
    const again = start();
    again.press("enter"); // pilote Suzy
    expect(again.ids).toEqual([20, 30, 40, 50, 60, 70, 80]);
    again.choose(30);
    expect(again.ids).toEqual([0, 1, 2]);
    expect(again.selected).toBe(2);
    again.press("escape");
    expect(again.selected).toBe(30);
    again.choose(20);
    expect(again.flow.view).toMatchObject({ kind: "video", name: "BR_TER2", mission: 2 });
    void d;
  });

  it("Rejouer la mission 1 enchaîne 1, 2 puis 3, sans toucher à la meilleure mission", () => {
    const pilot = store.create("Suzy", 1)!;
    pilot.bestMission = 3;
    store.save(pilot);
    const d = start();
    d.press("enter");
    d.choose(30);
    d.choose(1);
    d.flow.videoEnded(false);
    d.flow.levelEnded("complete");
    d.idle(130);
    d.anyKey();
    expect(d.flow.view).toMatchObject({ kind: "video", name: "BR_TER2" });
    expect(store.get(0)?.bestMission).toBe(3);
  });

  it("Échap en niveau : confirmation sur l'image figée ; « Non » reprend, « Oui » revient au menu", () => {
    const d = mainMenuAs();
    d.choose(10);
    d.flow.videoEnded(false);
    d.flow.abortRequested();
    expect(host.paused).toEqual([true]);
    expect(d.flow.view).toMatchObject({ kind: "menu", backdrop: "frozen" });
    expect(d.selected).toBe(2); // « Non » d'office
    d.press("escape");
    expect(host.paused).toEqual([true, false]);
    expect(d.flow.view.kind).toBe("level");
    d.flow.abortRequested();
    d.choose(1);
    expect(host.ended).toBe(1);
    expect(d.flow.view).toMatchObject({ kind: "menu", backdrop: "demo" });
    expect(host.contexts.at(-1)).toBe("menu");
  });

  it("un niveau qui ne se charge pas ramène au menu principal", () => {
    const d = mainMenuAs();
    d.choose(10);
    d.flow.videoEnded(false);
    d.flow.levelFailed();
    expect(d.flow.view).toMatchObject({ kind: "menu", backdrop: "demo" });
  });

  it("Setup : volumes réglés par curseur, appliqués et enregistrés", () => {
    const d = mainMenuAs();
    d.choose(40);
    expect(d.ids).toEqual([10, 11, 12, 14]); // contrôleur, volume, langue, musique : ni gamma, ni écran, ni détail
    d.choose(11);
    expect(d.ids).toEqual([1, 2, 3]);
    d.press("left");
    expect(host.volumeCalls.at(-1)).toEqual({ master: 247, music: 255, effects: 255 });
    d.press("down");
    d.press("left", "left");
    expect(host.volumeCalls.at(-1)).toEqual({ master: 247, music: 239, effects: 255 });
    expect(store.loadGlobal().volumes).toEqual({ master: 247, music: 239, effects: 255 });
    d.press("escape");
    expect(d.ids).toEqual([10, 11, 12, 14]);
    expect(host.sounds).toContain(6004);
  });

  it("Setup : la langue change les textes et se retient par pilote", () => {
    const d = mainMenuAs();
    expect(d.flow.language).toBe(1);
    d.choose(40);
    d.choose(12);
    expect(d.ids).toEqual([1, 0]);
    d.choose(0);
    expect(d.flow.language).toBe(0);
    expect(store.get(0)?.language).toBe(0);
    expect(store.loadGlobal().language).toBe(0);
    d.press("escape");
    expect(d.flow.phaseName).toBe("menu");
  });

  it("Setup : la préférence musicale change la piste tout de suite et se retient", () => {
    const d = mainMenuAs();
    d.choose(40);
    d.choose(14);
    expect(d.ids).toEqual([10, 11, 12]);
    expect(d.selected).toBe(10);
    d.choose(11);
    expect(host.preferences.at(-1)).toBe("classical");
    expect(store.get(0)?.music).toBe(1);
  });

  it("Setup : les commandes sont listées avec leurs touches, en lecture seule", () => {
    const d = mainMenuAs();
    d.choose(40);
    d.choose(10);
    expect(d.ids).toEqual([21, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
    d.press("enter");
    expect(d.ids).toEqual([10, 11, 12, 14]);
  });

  it("Crédits : 1003, 1002 puis 1001, une touche entre chaque, musique coupée puis rétablie", () => {
    const d = mainMenuAs();
    d.choose(60);
    expect(d.flow.view).toEqual({ kind: "screen", id: 1003 });
    expect(host.contexts.at(-1)).toBe("silent");
    d.anyKey();
    expect(d.flow.view).toEqual({ kind: "screen", id: 1002 });
    d.anyKey();
    expect(d.flow.view).toEqual({ kind: "screen", id: 1001 });
    d.anyKey();
    expect(d.flow.view.kind).toBe("menu");
    expect(host.contexts.at(-1)).toBe("menu");
  });

  it("Revoir l'intro : INTRO1 puis INTRO2 sans les logos, retour au menu principal", () => {
    const d = mainMenuAs();
    d.choose(50);
    expect(d.flow.view).toMatchObject({ kind: "video", name: "INTRO1", overlay: false });
    d.flow.videoEnded(false);
    expect(d.flow.view).toMatchObject({ kind: "video", name: "INTRO2" });
    d.flow.videoEnded(true);
    expect(d.flow.view.kind).toBe("menu");
    expect(host.contexts.at(-1)).toBe("menu");
  });

  it("Nouveau joueur ramène à la sélection ; la liste propose Supprimer, avec confirmation", () => {
    const d = mainMenuAs();
    d.choose(70);
    expect(d.ids).toEqual([0, 1, 100]);
    expect(d.selected).toBe(100); // le dernier pilote est sélectionné d'office
    d.choose(1);
    expect(d.ids).toEqual([0]);
    d.choose(0);
    expect(d.ids).toEqual([1, 0]); // « Non » d'abord
    expect(store.list()).toHaveLength(1);
    d.choose(0);
    expect(store.list()).toHaveLength(0);
    expect(d.ids).toEqual([0]);
  });

  it("Quitter : confirmation, « Non » revient au menu, « Oui » quitte le jeu", () => {
    const d = mainMenuAs();
    d.choose(80);
    expect(d.ids).toEqual([1, 0]);
    d.press("enter"); // « Non »
    expect(host.left).toBe(0);
    expect(d.selected).toBe(80);
    d.choose(80);
    d.choose(0);
    expect(host.left).toBe(1);
  });

  it("10 pilotes au plus : « Nouveau pilote » disparaît de la liste", () => {
    for (let i = 0; i < 10; i++) store.create(`P${i}`, 1);
    const d = start();
    expect(d.ids[0]).toBe(1);
    expect(d.ids).not.toContain(0);
    expect(d.ids).toHaveLength(11);
  });

  it("toucher un choix le valide ; toucher hors du cadre annule", () => {
    const d = mainMenuAs();
    d.choose(40);
    d.idle();
    d.now += 16;
    d.flow.update(d.now, { keys: [], chars: [], taps: [{ x: 3, y: 3 }], pressed: true });
    expect(d.flow.view.kind).toBe("menu");
    expect(d.ids).toEqual([10, 40, 50, 60, 70, 80]); // retour au menu principal
  });

  it("démarrage complet : IPLAY, attente, 1004, 1005, INTRO1, INTRO2, puis la sélection du pilote", () => {
    const d = start(true);
    const seen: string[] = [];
    const note = (): void => {
      const v = d.flow.view;
      seen.push(v.kind === "video" ? v.name : v.kind === "screen" ? String(v.id) : v.kind);
    };
    note();
    expect(host.contexts.at(-1)).toBe("silent");
    d.flow.videoEnded(false);
    d.wait(1);
    note();
    d.wait(3500);
    note();
    d.wait(3500);
    note();
    d.wait(3500);
    note();
    d.flow.videoEnded(false);
    note();
    d.flow.videoEnded(false);
    d.wait(1);
    note();
    expect(seen).toEqual(["IPLAY", "hold", "1004", "1005", "INTRO1", "INTRO2", "menu"]);
    expect(d.flow.phaseName).toBe("menu");
    expect(host.contexts.at(-1)).toBe("menu");
  });
});

describe("format", () => {
  it("remplace %d, %02d, %s et %%", () => {
    expect(format("Temps : %dh %02dm %02ds", 1, 5, 9)).toBe("Temps : 1h 05m 09s");
    expect(format("Objectifs : %d%%", 80)).toBe("Objectifs : 80%");
    expect(format("[%s_]", "Suzy")).toBe("[Suzy_]");
    expect(format("Rien")).toBe("Rien");
  });
});
