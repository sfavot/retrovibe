import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStorage, prefixedStorage } from "../../../src/engine/storage";
import { defaultProfile } from "../../../src/games/swiv3d/screens/controllers";
import { Flow, TEST_MODE_CODE, type FlowView } from "../../../src/games/swiv3d/screens/flow";
import { PilotStore, type Pilot } from "../../../src/games/swiv3d/screens/pilots";
import { ROW, type MenuLine } from "../../../src/games/swiv3d/ui-draw/menu";
import { hasOriginalFiles } from "../helpers";
import { Driver, FakeHost } from "./flow-driver";
import { loadGlobal, stubText } from "./support";

type MenuView = Extract<FlowView, { kind: "menu" }>;

describe.skipIf(!hasOriginalFiles)("menus Gamma, Contrôleur, mode test et Tricher (textes du jeu)", () => {
  let store: PilotStore;
  let host: FakeHost;

  beforeEach(() => {
    store = new PilotStore(prefixedStorage(new MemoryStorage(), "swiv3d:"));
    host = new FakeHost();
  });

  const strings = () => loadGlobal().strings;
  const view = (d: Driver): MenuView => {
    const v = d.flow.view;
    if (v.kind !== "menu") throw new Error(`pas de menu : ${v.kind}`);
    return v;
  };
  const texts = (d: Driver): string[] => view(d).menu.texts();
  const title = (table: number, id: number, tint: number) => ({ text: strings().getBytes(1, table, id), tint });
  /** Lignes du menu courant (cadre compris), lues dans l'objet `Menu`. */
  const lines = (d: Driver): MenuLine[] => (view(d).menu as unknown as { lines: MenuLine[] }).lines;

  function seed(patch: Partial<Pilot> = {}): Pilot {
    const pilot = store.create("Suzy", 1)!;
    Object.assign(pilot, { controller: defaultProfile(1) }, patch);
    store.save(pilot);
    return pilot;
  }

  /** Sélection du pilote déjà enregistré, puis menu principal. */
  function mainMenu(): Driver {
    const global = loadGlobal();
    const d = new Driver(new Flow({ strings: global.strings, script: global.missions, text: stubText(), store }, host, false));
    d.press("enter");
    return d;
  }

  describe("gamma", () => {
    it("titre (6, 0) teinte 0x100, cadre de l'exe, quatre niveaux ; choisir applique et enregistre, le menu reste", () => {
      seed();
      const d = mainMenu();
      expect(host.gammas).toEqual([0]); // sélection du pilote : gamma de la fiche réappliquée
      d.choose(40);
      d.choose(13);
      expect(view(d).title).toEqual(title(6, 0, 0x100));
      expect(texts(d)).toEqual(["Sélectionnez un niveau adéquat", "pour votre écran", "Aucune correction gamma", "Faible Correction", "Correction moyenne", "Haute Correction"]);
      // espaceur, trait, espaceur, bandeau, espaceur, trait, espaceur, choix, espaceur, trait, espaceur (`00417ffc`)
      expect(lines(d).slice(0, 3)).toEqual([
        { type: "spacer", height: 3, row: ROW.veil },
        { type: "spacer", height: 1, row: ROW.rule },
        { type: "spacer", height: 3, row: ROW.veil },
      ]);
      expect(d.selected).toBe(0);
      const before = d.flow.view;
      d.choose(2);
      expect(host.gammas.at(-1)).toBe(2);
      expect(store.get(0)!.gamma).toBe(2);
      expect(d.flow.view).toBe(before); // même écran : le titre 3D n'est pas recréé
      d.press("escape");
      expect(d.ids).toEqual([10, 11, 12, 13, 14]);
      expect(d.selected).toBe(13);
    });

    it("la gamma suit le pilote choisi", () => {
      seed({ gamma: 3 });
      mainMenu();
      expect(host.gammas).toEqual([3]);
    });
  });

  describe("contrôleur", () => {
    it("premier passage : choix du type sans annulation (souris et manette seulement si présentes), puis la configuration", () => {
      store.create("Neuf", 1);
      host.devices.add(3);
      const d = mainMenu();
      expect(view(d).title).toEqual(title(3, 100, 0x1000));
      expect(texts(d)).toEqual(["Sélectionnez le type du", "contrôleur principal", "Clavier", "Manette de jeu"]);
      d.press("escape"); // pas d'annulation (drapeaux 0x21)
      expect(d.ids).toEqual([1, 3]);
      d.choose(3);
      expect(store.get(0)!.controller).toEqual(defaultProfile(3));
      expect(view(d).title).toEqual(title(3, 0, 0x400));
      // Manette : liens d'axes ; tourner et avancer sont sur les axes, leurs touches disparaissent.
      expect(d.ids).toEqual([1, 20, 26, 27, 28, 29, 30, 31, 32]);
      expect(texts(d)).toContain("Arme principale [Manette 1]");
      d.press("escape");
      expect(d.ids[0]).toBe(10); // menu principal
    });

    it("un pilote réglé sur la souris sans souris repasse par le choix du type", () => {
      const pilot = seed({ controller: defaultProfile(2) });
      expect(pilot.controller?.type).toBe(2);
      const d = mainMenu();
      expect(d.ids).toEqual([1]);
      expect(store.get(0)!.controller).toBeNull();
    });

    it("changer de type remet les touches par défaut du type ; reprendre le même type les garde", () => {
      const keys = defaultProfile(1).keys.map((k, i) => (i === 6 ? 0x1e : k));
      seed({ controller: { ...defaultProfile(1), keys } });
      host.devices.add(2);
      const d = mainMenu();
      d.choose(40);
      d.choose(10);
      d.choose(1);
      d.choose(1);
      expect(store.get(0)!.controller!.keys[6]).toBe(0x1e);
      d.choose(1);
      d.choose(2);
      expect(store.get(0)!.controller).toEqual(defaultProfile(2));
      expect(d.ids).toEqual([1, 20, 24, 25, 26, 27, 28, 29, 30, 31, 32]);
      expect(texts(d)).toContain("Arme principale [Souris 1]");
    });

    it("capture d'une touche : titre (3, 33), action et touche actuelle ; touches sans nom refusées ; la touche est enregistrée", () => {
      seed();
      const d = mainMenu();
      d.choose(40);
      d.choose(10);
      d.choose(29);
      expect(d.flow.phaseName).toBe("capture");
      expect(view(d).title).toEqual(title(3, 33, 0x1400));
      expect(texts(d)).toEqual(["Appuyez sur la touche pour", "Arme principale [Espace]"]);
      expect(view(d).menu.ids()).toEqual([]);
      d.press("escape", "enter", "down"); // pas de navigation ni d'annulation
      d.scan(0x01); // Échap : « #1 », refusée
      d.scan(0x3b); // F1 : « #59 », refusée
      expect(d.flow.phaseName).toBe("capture");
      d.scan(0x1e); // A en QWERTY, Q en AZERTY
      expect(host.sounds.at(-1)).toBe(6003);
      expect(store.get(0)!.controller!.keys[6]).toBe(0x1e);
      expect(d.selected).toBe(29);
      expect(texts(d)).toContain("Arme principale [Q]");
    });

    it("mode test : les touches sans nom se lient aussi", () => {
      seed({ testMode: true });
      const d = mainMenu();
      d.choose(40);
      d.choose(10);
      d.choose(31);
      d.scan(0x3b);
      expect(store.get(0)!.controller!.keys[8]).toBe(0x3b);
      expect(texts(d)).toContain("Sélectionner \u0018 [#59]");
    });

    it("axes : titre (3, 1000), chaque mouvement passe à l'axe suivant puis « Clavier » ; « Attacher au centre » pour la manette", () => {
      seed({ controller: defaultProfile(3) });
      host.devices.add(3);
      const d = mainMenu();
      d.choose(40);
      d.choose(10);
      d.choose(20);
      expect(view(d).title).toEqual(title(3, 1000, 0x500));
      expect(texts(d)).toEqual([
        "Liez l'axe du contrôleur",
        "au déplacement de l'appareil",
        "Lier \u001c \u001d à [Axe des X]",
        "Lier \u0018 \u0019 à [Axe des Y]",
        "Lier \u001b \u001a à [Clavier]",
        "Attacher au centre [Non]",
      ]);
      d.choose(3);
      d.choose(3);
      d.choose(3);
      expect(store.get(0)!.controller!.axes).toEqual([1, 2, 3]);
      d.choose(3);
      expect(store.get(0)!.controller!.axes[2]).toBe(0);
      d.choose(4);
      expect(store.get(0)!.controller!.clip).toBe(0);
      expect(texts(d)).toContain("Attacher au centre [Oui]");
      d.choose(1); // tourner : X -> Y -> Z -> clavier
      expect(store.get(0)!.controller!.axes[0]).toBe(2);
      d.press("escape");
      expect(view(d).title).toEqual(title(3, 0, 0x400));
      expect(d.selected).toBe(20);
    });

    it("souris : deux axes, pas de « Attacher au centre »", () => {
      seed({ controller: defaultProfile(2) });
      host.devices.add(2);
      const d = mainMenu();
      d.choose(40);
      d.choose(10);
      d.choose(20);
      expect(d.ids).toEqual([1, 2, 3]);
      d.choose(2);
      d.choose(2);
      d.choose(2);
      expect(store.get(0)!.controller!.axes[1]).toBe(0); // 0 -> X -> Y -> clavier
    });
  });

  describe("menu principal", () => {
    it("cadre de `gm_menu_main` : « Quitter » et le mode test isolés entre deux traits (espaceurs de 2 px)", () => {
      seed({ testMode: true });
      const d = mainMenu();
      const veil = (height: number): MenuLine => ({ type: "spacer", height, row: ROW.veil });
      const rule: MenuLine = { type: "spacer", height: 1, row: ROW.rule };
      const l = lines(d);
      expect(l.slice(0, 2)).toEqual([veil(3), rule]);
      expect(l.at(-1)).toEqual(veil(3));
      const quit = l.findIndex((line) => line.type === "choice" && line.id === 80);
      expect(l.slice(quit - 3, quit)).toEqual([veil(2), rule, veil(2)]);
      expect(l.slice(quit + 1)).toEqual([{ type: "choice", id: 90, text: "Entrez le mode test niveau" }, veil(2), rule, veil(3)]);
      expect(l[quit - 4]).toMatchObject({ type: "choice", id: 70 });
    });
  });

  describe("Setup en jeu (F1)", () => {
    function inLevel(): Driver {
      seed();
      const d = mainMenu();
      d.choose(10);
      d.flow.videoEnded(false);
      expect(d.flow.view).toEqual({ kind: "level" });
      return d;
    }

    it("F1 ouvre le Setup sur l'image figée (son 6000) ; ses sous-menus aussi ; Échap recharge les touches et reprend (son 6001)", () => {
      const d = inLevel();
      d.flow.setupRequested();
      expect(host.paused.at(-1)).toBe(true);
      expect(host.sounds.at(-1)).toBe(6000);
      expect(view(d)).toMatchObject({ backdrop: "frozen", title: title(2, 0, 0x1500) });
      expect(d.ids).toEqual([10, 11, 12, 13, 14]);
      expect(d.selected).toBe(10);
      d.choose(11); // Volume
      expect(view(d)).toMatchObject({ backdrop: "frozen", title: title(8, 0, 0x1500) });
      d.press("escape");
      d.choose(10); // Contrôleur, puis capture d'une touche
      expect(view(d).backdrop).toBe("frozen");
      d.choose(28);
      expect(d.flow.phaseName).toBe("capture");
      expect(view(d).backdrop).toBe("frozen");
      d.scan(0x1f); // S
      expect(store.get(0)!.controller!.keys).toContain(0x1f);
      d.press("escape"); // configuration du contrôleur
      expect(d.ids).toEqual([10, 11, 12, 13, 14]);
      expect(host.loadedControls).toEqual([]);
      d.press("escape");
      expect(d.flow.view).toEqual({ kind: "level" });
      expect(host.loadedControls).toEqual(["Suzy"]);
      expect(host.paused.at(-1)).toBe(false);
      expect(host.sounds.at(-1)).toBe(6001);
      // Plus tard, le Setup du menu principal revient au menu principal, sur le décor.
      d.flow.levelEnded("gameOver", {});
      d.idle(130);
      d.anyKey();
      d.choose(40);
      expect(view(d).backdrop).toBe("demo");
      d.press("escape");
      expect(d.ids).toContain(80);
    });

    it("hors niveau, rien", () => {
      seed();
      const d = mainMenu();
      const before = d.flow.view;
      d.flow.setupRequested();
      expect(d.flow.view).toBe(before);
      expect(host.sounds).not.toContain(6000);
    });
  });

  describe("mode test et Tricher", () => {
    it(`le nom ${TEST_MODE_CODE} n'est pas créé : il débloque le mode test du pilote saisi ensuite`, () => {
      const global = loadGlobal();
      const d = new Driver(new Flow({ strings: global.strings, script: global.missions, text: stubText(), store }, host, false));
      d.choose(0);
      d.type(TEST_MODE_CODE);
      d.press("enter");
      expect(d.flow.phaseName).toBe("name");
      expect(store.list()).toHaveLength(0);
      d.type("Testeur");
      d.press("enter");
      expect(store.get(0)).toMatchObject({ name: "Testeur", testMode: true });
      d.choose(1);
      d.press("escape");
      expect(d.ids).toEqual([10, 40, 50, 60, 70, 80, 90]);
      expect(texts(d).at(-1)).toBe("Entrez le mode test niveau");
    });

    it("sans le code, pas d'entrée de mode test", () => {
      seed();
      expect(mainMenu().ids).not.toContain(90);
    });

    it("« Tester la mission » : 4 missions, espaceurs de 19 px à la place de Retour / Suivant et des lignes vides", () => {
      seed({ testMode: true });
      const d = mainMenu();
      d.choose(90);
      expect(view(d).title).toEqual(title(11, 20, 0x400));
      expect(d.ids).toEqual([0, 1, 2, 3]);
      expect(texts(d)).toEqual(["Sélectionner la mission à", "tester/Tricher", "Fastoche", "Chercher et Détruire", "L'Estuaire Sanglant", "Montagnes Russes"]);
      expect(lines(d).filter((l) => l.type === "spacer" && l.height === 19)).toHaveLength(6);
      d.press("escape");
      expect(d.selected).toBe(90);
    });

    it("mission de test : état à zéro et 400 d'énergie, pas de progression ; F12 ouvre Tricher, qui applique bonus et véhicules", () => {
      seed({ testMode: true });
      const d = mainMenu();
      d.choose(90);
      d.choose(2);
      d.flow.videoEnded(false);
      const request = host.levels.at(-1)!;
      expect(request).toMatchObject({ name: "TERRAN02", state: null });
      expect(request.vars.get(1)).toBe(400);
      expect(request.vars.get(100)).toBe(0);
      expect(store.get(0)!.bestMission).toBe(0);
      expect(d.flow.testMode).toBe(true);

      d.flow.cheatRequested();
      expect(host.paused.at(-1)).toBe(true);
      expect(host.sounds.at(-1)).toBe(6000);
      expect(view(d)).toMatchObject({ backdrop: "frozen", title: title(100, 1000, 0x100) });
      expect(d.ids).toEqual([-9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(texts(d).slice(0, 4)).toEqual(["Sélectionnez", "bornes", "Autres tricheries", "Missiles"]);
      d.choose(1);
      expect(host.cheats).toEqual([{ pickup: 1 }]);
      const screen = d.flow.view;
      d.choose(-9);
      expect(d.flow.view).toBe(screen); // même écran, le titre 3D reste
      expect(d.ids.slice(1)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
      d.choose(-9);
      expect(d.ids).toEqual([-9, 100, 101, 102, 105, 106, 107, 108, 113, 200, 201]); // zone 0 : Héli., Buggy
      d.choose(201);
      expect(host.cheats.at(-1)).toEqual({ form: 1 });
      d.press("escape");
      expect(d.flow.view).toEqual({ kind: "level" });
      expect(host.paused.at(-1)).toBe(false);
      expect(host.sounds.at(-1)).toBe(6001);

      // Mission accomplie en test : pas d'état d'arrivée pour la suivante.
      d.flow.levelEnded("complete", { state: { ammo: new Array<number>(20).fill(9), score: 1, form: 0, energy: 100, cannonPower: 2 } });
      d.idle(130);
      d.anyKey();
      d.flow.videoEnded(false);
      expect(host.levels.at(-1)).toMatchObject({ name: "TERRAN03", state: null });
      expect(host.levels.at(-1)!.vars.get(1)).toBe(400);
      expect(store.get(0)!.states).toEqual({});
    });

    it("F12 hors mission de test : rien", () => {
      seed({ testMode: true });
      const d = mainMenu();
      d.choose(10);
      d.flow.videoEnded(false);
      d.flow.cheatRequested();
      expect(d.flow.view).toEqual({ kind: "level" });
      expect(d.flow.testMode).toBe(false);
    });
  });
});
