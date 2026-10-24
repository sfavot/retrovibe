import { describe, expect, it } from "vitest";
import { Engine } from "../../src/games/mathemagique/engine/engine";
import { SceneId, type Scene } from "../../src/games/mathemagique/engine/scene";
import { installServices, type MathServices } from "../../src/games/mathemagique/engine/services";
import { clockFrame } from "../../src/games/mathemagique/scenes/title";
import type { HubScene, MonitorDetail, MonitorMode } from "../../src/games/mathemagique/scenes/hub";
import {
  HUB_CONSOLE_EDGES,
  HUB_HELP_CHAINS,
  HUB_HELP_EDGES,
  HUB_LAUNCH,
  HUB_OBJECT_EDGES,
  HUB_TOYS,
  KeyHistory,
  QuitPrompt,
  SECRETS,
  historyOf,
  secretKeyCode,
} from "../../src/games/mathemagique/scenes/hub-logic";
import { registerScenes, type RegisterScenesOptions } from "../../src/games/mathemagique/scenes";
import { TestHost, runFor, runUntil } from "./engine-test-host";
import { hasOriginalFiles } from "./helpers";

// --- Logique pure ----------------------------------------------------------------------------------------------------------------

describe("séquences secrètes (hub-logic)", () => {
  // Couples (X, H) lus dans le code de MATH (`common.md` §4.3, vérifiés par simulation).
  const DOCUMENTED: Record<number, [string, number, number]> = {
    303: ["mr", 0x369f, 0x36f2],
    309: ["hn", 0x3406, 0x346e],
    310: ["pb", 0x3812, 0x3862],
    311: ["ah", 0x3089, 0x30e8],
    312: ["mb", 0x368f, 0x36e2],
    313: ["mc", 0x368e, 0x36e3],
    315: ["cm", 0x318e, 0x31ed],
    316: ["sp", 0x3983, 0x39f0],
    317: ["ba", 0x3103, 0x3161],
    318: ["mm", 0x3680, 0x36ed],
    319: ["dm", 0x3209, 0x326d],
    320: ["je", 0x350f, 0x3565],
  };

  function type(history: KeyHistory, keys: string): void {
    for (const c of keys) history.pushKey({ key: c, ctrl: false });
  }

  it("connaît exactement les 12 codes décodés, avec les couples X / H de la doc", () => {
    expect(SECRETS).toHaveLength(12);
    for (const secret of SECRETS) {
      const [keys, x, h] = DOCUMENTED[secret.shpl]!;
      expect(secret.keys).toBe(keys);
      expect(secret.x).toBe(x);
      expect(secret.h).toBe(h);
    }
  });

  it("reconnaît chaque code tapé depuis un historique vide ou après Ctrl+A", () => {
    for (const secret of SECRETS) {
      const fresh = new KeyHistory();
      type(fresh, secret.keys);
      expect(fresh.match()).toBe(secret.shpl);

      const noisy = new KeyHistory();
      type(noisy, "xyz123");
      noisy.pushKey({ key: "a", ctrl: true });
      type(noisy, secret.keys);
      expect(noisy.match()).toBe(secret.shpl);
    }
  });

  it("ne reconnaît pas un code précédé de touches sans Ctrl+A, ni une autre frappe", () => {
    const history = new KeyHistory();
    type(history, "xmr");
    expect(history.match()).toBeUndefined();
    const other = new KeyHistory();
    type(other, "zz");
    expect(other.match()).toBeUndefined();
    expect(new KeyHistory().match()).toBeUndefined();
  });

  it("Ctrl+A remet l'historique à zéro, pas la frappe de la lettre a", () => {
    const history = new KeyHistory();
    type(history, "mr");
    expect(history.match()).toBe(303);
    history.pushKey({ key: "a", ctrl: true });
    expect(history.h).toBe(0);
    expect(history.x).toBe(0);
    expect(history.match()).toBeUndefined();
    // La lettre « a » seule est une touche comme une autre (code 0x61).
    history.pushKey({ key: "a", ctrl: false });
    expect(history.h).toBe(0x61);
  });

  it("calcule H et X comme l'original (décalage de 7 bits, XOR cumulé, 32 bits)", () => {
    expect(historyOf("mr")).toEqual({ x: 0x369f, h: 0x36f2 });
    const history = new KeyHistory();
    for (const c of "mike") history.push(c.charCodeAt(0));
    // `H` de « mike » est celui du code 301 de la doc (0x0dba75e5) ; `X` dépend des touches qui précèdent.
    expect(history.h).toBe(0x0dba75e5);
  });

  it("traduit les touches comme WM_CHAR : ASCII, Ctrl + lettre, flèches ; rien pour Maj ou Ctrl seuls", () => {
    expect(secretKeyCode({ key: "m", ctrl: false })).toBe(0x6d);
    expect(secretKeyCode({ key: "M", ctrl: false })).toBe(0x4d);
    expect(secretKeyCode({ key: "a", ctrl: true })).toBe(1);
    expect(secretKeyCode({ key: "A", ctrl: true })).toBe(1);
    expect(secretKeyCode({ key: "Enter", ctrl: false })).toBe(13);
    expect(secretKeyCode({ key: "ArrowUp", ctrl: false })).toBe(0xa5);
    expect(secretKeyCode({ key: "ArrowDown", ctrl: false })).toBe(0xa7);
    expect(secretKeyCode({ key: "F1", ctrl: false })).toBe(0x70 + 0x7f);
    expect(secretKeyCode({ key: "Shift", ctrl: false })).toBeNull();
    expect(secretKeyCode({ key: "Control", ctrl: true })).toBeNull();
  });
});

describe("invite « quitter » (hub-logic)", () => {
  it("deux temps : Quit ouvre, le sifflet confirme", () => {
    const quit = new QuitPrompt();
    expect(quit.confirm()).toBe(false);
    expect(quit.ask()).toBe(true);
    expect(quit.open).toBe(true);
    expect(quit.ask()).toBe(false);
    expect(quit.confirm()).toBe(true);
    expect(quit.phase).toBe("leaving");
    expect(quit.cancel()).toBe(false);
  });

  it("un clic ailleurs annule et laisse recommencer", () => {
    const quit = new QuitPrompt();
    quit.ask();
    expect(quit.cancel()).toBe(true);
    expect(quit.phase).toBe("idle");
    expect(quit.cancel()).toBe(false);
    expect(quit.ask()).toBe(true);
  });
});

describe("tables du hub (hub-logic)", () => {
  it("14 objets, 3 boutons, 9 jouets, 15 zones d'aide", () => {
    expect(HUB_OBJECT_EDGES).toHaveLength(14);
    expect(HUB_CONSOLE_EDGES).toHaveLength(3);
    expect(HUB_TOYS).toHaveLength(9);
    expect(HUB_HELP_EDGES).toHaveLength(15);
    expect(HUB_HELP_CHAINS).toHaveLength(15);
  });

  it("les objets 2 à 11 lancent les 7 activités du hub (table de saut CS:0d86)", () => {
    expect(Object.keys(HUB_LAUNCH).map(Number)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(HUB_LAUNCH[2]!.scene).toBe(SceneId.patternWindows);
    expect(HUB_LAUNCH[5]!.scene).toBe(SceneId.patternWindows);
    expect(HUB_LAUNCH[6]!.scene).toBe(SceneId.sticklers);
    expect(HUB_LAUNCH[7]!.scene).toBe(SceneId.rhythm);
    expect(HUB_LAUNCH[8]!.scene).toBe(SceneId.rockets);
    expect(HUB_LAUNCH[9]!.scene).toBe(SceneId.patterns);
    expect(HUB_LAUNCH[10]!.scene).toBe(SceneId.bowling);
    expect(HUB_LAUNCH[11]!.scene).toBe(SceneId.hidden);
  });
});

describe("horloge du titre", () => {
  it("image = heure × 12 + minute arrondie au pas de 5", () => {
    expect(clockFrame(12, 0, 0)).toBe(0);
    expect(clockFrame(0, 0, 0)).toBe(0);
    expect(clockFrame(3, 0, 5)).toBe(36);
    expect(clockFrame(15, 15, 0)).toBe(39);
    expect(clockFrame(6, 32, 0)).toBe(6 * 12 + 6);
    expect(clockFrame(6, 33, 0)).toBe(6 * 12 + 7);
    // Arrondi à la demi-minute près : 2 min 29 s reste, 2 min 30 s passe au pas suivant.
    expect(clockFrame(1, 2, 29)).toBe(12);
    expect(clockFrame(1, 2, 30)).toBe(13);
  });

  it("à 55 minutes et plus, l'aiguille passe à l'heure suivante", () => {
    expect(clockFrame(2, 58, 0)).toBe(36);
    expect(clockFrame(11, 59, 0)).toBe(0);
  });
});

// --- Scènes (fichiers du jeu) ---------------------------------------------------------------------------------------------------

interface Game {
  host: TestHost;
  engine: Engine;
  services: MathServices;
  monitor: { mode: MonitorMode; detail: MonitorDetail | undefined }[];
}

/** Moteur de test avec les vraies scènes ; `openMonitor` enregistre les appels. */
function boot(options: RegisterScenesOptions = {}, setup?: (host: TestHost) => void): Game {
  const host = new TestHost();
  host.audio.unlock();
  setup?.(host);
  const engine = new Engine(host, { seed: 3 });
  const services = installServices(engine);
  const monitor: Game["monitor"] = [];
  registerScenes(engine, services, { openMonitor: (mode, detail) => monitor.push({ mode, detail }), ...options });
  engine.start();
  return { host, engine, services, monitor };
}

const sceneOf = (game: Game): SceneId | undefined => game.engine.scenes.currentId;
const hubOf = (game: Game): HubScene => game.engine.scenes.current as HubScene;
const isRunning = (game: Game, script: number): boolean => game.services.scr.running.some((a) => a.scrId === script);

/** Passe le logo (un clic) et attend que le titre soit prêt (fondus terminés, musique lancée). */
async function toTitle(game: Game): Promise<void> {
  await runFor(game.engine, game.host, 800);
  game.host.press("Space");
  await runFor(game.engine, game.host, 2500);
}

/** Connecte un joueur qui a déjà vu l'introduction, pour que le hub ne joue pas la longue présentation. */
function signIn(game: Game): void {
  const { roster } = game.engine.ctx.roster;
  const result = roster.addPlayer("Zoe");
  if (!result.ok) throw new Error("joueur refusé");
  game.engine.ctx.roster.currentPlayerId = result.id;
  roster.setVar(result.id, "hubPolyIntroSeen", 1);
}

/** Titre → porte → hub, puis laisse finir l'accueil de Poly (clic) : le hub est au repos, le moniteur de connexion « fermé ». */
async function toHub(game: Game): Promise<HubScene> {
  await toTitle(game);
  game.host.click(290, 300);
  await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.hub, 30_000);
  await runFor(game.engine, game.host, 1200);
  // Accueil de Poly : un clic le passe, le moniteur de connexion « s'ouvre » (simulé) puis se referme.
  game.host.click(520, 20);
  await runFor(game.engine, game.host, 300);
  const hub = hubOf(game);
  if (hub.monitorOpen) hub.monitorClosed();
  await runFor(game.engine, game.host, 12_000);
  return hub;
}

/** Clique sur un objet du hub et renvoie la scène atteinte. */
async function launches(game: Game, x: number, y: number): Promise<SceneId | undefined> {
  game.host.click(x, y);
  await runFor(game.engine, game.host, 6000);
  return sceneOf(game);
}

describe.skipIf(!hasOriginalFiles)("titre", () => {
  it("montre le logo à la première entrée seulement, puis le titre avec sa porte", async () => {
    const game = boot();
    await runFor(game.engine, game.host, 800);
    expect(sceneOf(game)).toBe(SceneId.title);
    // Pendant le logo, un clic le passe sans ouvrir la porte.
    game.host.click(290, 300);
    await runFor(game.engine, game.host, 3000);
    expect(sceneOf(game)).toBe(SceneId.title);
    expect(game.host.audio.waves.length).toBeGreaterThan(0);
  });

  it("la porte mène au hub (animation, fondu, scène demandée)", async () => {
    const game = boot();
    await toTitle(game);
    game.host.click(290, 300);
    // La porte s'ouvre d'abord (SCR 10000, bloquante), puis le fondu, puis le hub.
    await runFor(game.engine, game.host, 200);
    expect(sceneOf(game)).toBe(SceneId.title);
    expect(isRunning(game, 10000)).toBe(true);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.hub, 20_000);
    expect(game.host.exited).toBe(false);
  });

  it("la fin du son 1000 ouvre la porte toute seule", async () => {
    const game = boot();
    await toTitle(game);
    const music = game.host.audio.waves.find((w) => w.sound.samples.length / w.sound.sampleRate > 10)!;
    expect(music).toBeDefined();
    const seconds = music.sound.samples.length / music.sound.sampleRate;
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.hub, 60_000);
    // Pas avant la fin de la musique : le titre reste jusque-là.
    expect(game.host.time - music.at).toBeGreaterThanOrEqual(seconds * 1000 - 100);
  });

  it("la plaque mène aux crédits, EXIT revient au titre sans le logo", async () => {
    const game = boot();
    await toTitle(game);
    game.host.click(130, 340);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.credits, 20_000);
    await runFor(game.engine, game.host, 1500);
    // Les crédits : EXIT (62, 92, 103, 124).
    game.host.click(80, 105);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.title, 20_000);
    // Sans logo : la porte répond dès la fin du fondu d'entrée.
    await runFor(game.engine, game.host, 1500);
    game.host.click(290, 300);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.hub, 20_000);
  });

  it("la musique du titre est coupée en allant aux crédits", async () => {
    const game = boot();
    await toTitle(game);
    const music = game.host.audio.waves.find((w) => w.sound.samples.length / w.sound.sampleRate > 10)!;
    game.host.click(130, 340);
    await runFor(game.engine, game.host, 100);
    expect(game.host.audio.stopped).toContain(music.handle);
  });
});

describe.skipIf(!hasOriginalFiles)("crédits", () => {
  async function toCredits(game: Game): Promise<void> {
    await toTitle(game);
    game.host.click(130, 340);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.credits, 20_000);
    await runFor(game.engine, game.host, 1500);
  }
  const lastPixels = (game: Game): Uint8Array => game.host.frames[game.host.frames.length - 1]!.pixels.slice();
  const differs = (a: Uint8Array, b: Uint8Array): number => a.reduce((n, v, i) => n + (v !== b[i] ? 1 : 0), 0);

  it("change de page toutes les 20 s avec un balayage, et boucle", async () => {
    const game = boot();
    await toCredits(game);
    const first = lastPixels(game);
    await runFor(game.engine, game.host, 17_000);
    expect(differs(first, lastPixels(game))).toBe(0);
    // 20 s après l'entrée : balayage qui efface, pause, balayage qui révèle la page suivante.
    await runFor(game.engine, game.host, 4000);
    expect(differs(first, lastPixels(game))).toBeGreaterThan(1000);
    expect(sceneOf(game)).toBe(SceneId.credits);
  });

  it("un clic sur la page l'efface tout de suite", async () => {
    const game = boot();
    await toCredits(game);
    const first = lastPixels(game);
    game.host.click(300, 200);
    await runFor(game.engine, game.host, 2000);
    expect(differs(first, lastPixels(game))).toBeGreaterThan(1000);
  });

  it("du bouton EXIT au titre", async () => {
    const game = boot();
    await toCredits(game);
    game.host.click(80, 105);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.title, 20_000);
  });
});

describe.skipIf(!hasOriginalFiles)("hub : activités", () => {
  const cases: [string, number, number, SceneId][] = [
    ["verrière", 300, 12, SceneId.patternWindows],
    ["verrière (4e tranche)", 300, 85, SceneId.patternWindows],
    ["chevalet", 100, 120, SceneId.sticklers],
    ["engrenage", 300, 160, SceneId.rhythm],
    ["étagère", 430, 130, SceneId.rockets],
    ["cadre", 195, 250, SceneId.patterns],
    ["rideau", 330, 280, SceneId.bowling],
    ["télévision", 500, 300, SceneId.hidden],
  ];

  it.each(cases)("%s lance l'activité (animation de départ, fondu, scène demandée)", async (_name, x, y, scene) => {
    const game = boot();
    const hub = await (async () => {
      const h = await toHub(game);
      signIn(game);
      return h;
    })();
    expect(hub.monitorOpen).toBe(false);
    game.host.click(x, y);
    await runFor(game.engine, game.host, 100);
    // L'animation de départ est en cours, la scène n'a pas encore changé.
    expect(sceneOf(game)).toBe(SceneId.hub);
    await runUntil(game.engine, game.host, () => sceneOf(game) === scene, 20_000);
    expect(game.host.exited).toBe(false);
  });

  it("sans joueur connecté, l'activité ne se lance pas : Poly demande de se connecter puis le moniteur s'ouvre", async () => {
    const game = boot();
    await toHub(game);
    game.monitor.length = 0;
    hubOf(game).monitorClosed();
    game.host.click(330, 280);
    await runFor(game.engine, game.host, 400);
    expect(isRunning(game, 5000)).toBe(true);
    // Un clic passe le clip, le moniteur s'ouvre en mode connexion.
    game.host.click(520, 20);
    await runFor(game.engine, game.host, 300);
    expect(game.monitor).toEqual([{ mode: "signin", detail: undefined }]);
    expect(sceneOf(game)).toBe(SceneId.hub);
  });

  it("une fabrique fournie à registerScenes remplace celle de la table", async () => {
    let created = 0;
    const custom: Scene = {
      enter: (ctx) => ctx.requestPresent(),
      leave: () => {},
      tick: () => {},
    };
    const game = boot({
      factories: {
        [SceneId.rockets]: () => {
          created++;
          return custom;
        },
      },
    });
    await toHub(game);
    signIn(game);
    expect(await launches(game, 430, 130)).toBe(SceneId.rockets);
    expect(created).toBe(1);
    expect(game.engine.scenes.current).toBe(custom);
  });
});

describe.skipIf(!hasOriginalFiles)("hub : moniteur", () => {
  it("Sign-in ouvre la connexion, Ctrl + clic les préférences, l'appui long aussi", async () => {
    const game = boot();
    const hub = await toHub(game);
    game.monitor.length = 0;
    game.host.click(247, 362);
    await runFor(game.engine, game.host, 200);
    expect(game.monitor).toEqual([{ mode: "signin", detail: undefined }]);
    expect(hub.monitorOpen).toBe(true);
    hub.monitorClosed();
    expect(hub.monitorOpen).toBe(false);
    await runFor(game.engine, game.host, 2000);

    game.monitor.length = 0;
    game.host.input.moveMouse(247, 362);
    game.host.input.mouseDown("left", { ctrl: true });
    game.host.input.mouseUp("left", { ctrl: true });
    await runFor(game.engine, game.host, 200);
    expect(game.monitor.map((m) => m.mode)).toEqual(["preferences"]);
    hub.monitorClosed();
    await runFor(game.engine, game.host, 2000);

    game.monitor.length = 0;
    hub.longPress(247, 362);
    expect(game.monitor.map((m) => m.mode)).toEqual(["preferences"]);
    // Appui long ailleurs que sur Sign-in : rien.
    hub.monitorClosed();
    await runFor(game.engine, game.host, 2000);
    game.monitor.length = 0;
    hub.longPress(400, 300);
    expect(game.monitor).toEqual([]);
  });

  it("Poly ouvre Math Trivia ; la séquence secrète tapée est transmise, puis oubliée", async () => {
    const game = boot();
    const hub = await toHub(game);
    game.monitor.length = 0;
    game.host.click(100, 280);
    // « Hmm » de Poly (SCR 5900), qu'un clic passe, puis le moniteur.
    await runFor(game.engine, game.host, 200);
    expect(isRunning(game, 5900)).toBe(true);
    game.host.click(520, 20);
    await runFor(game.engine, game.host, 300);
    expect(game.monitor).toEqual([{ mode: "trivia", detail: undefined }]);
    hub.monitorClosed();
    await runFor(game.engine, game.host, 2000);

    // Ctrl+A, puis « m » « r » : photo 303.
    game.host.press("KeyA", { ctrl: true, key: "a" });
    game.host.press("KeyM", { key: "m" });
    game.host.press("KeyR", { key: "r" });
    await runFor(game.engine, game.host, 100);
    game.monitor.length = 0;
    game.host.click(100, 280);
    await runFor(game.engine, game.host, 200);
    game.host.click(520, 20);
    await runFor(game.engine, game.host, 300);
    expect(game.monitor).toEqual([{ mode: "trivia", detail: { secret: 303 } }]);
    // L'historique est remis à zéro après l'ouverture.
    expect(hub.history.match()).toBeUndefined();
  });

  it("l'historique ignore les touches tapées pendant que le moniteur est ouvert", async () => {
    const game = boot();
    const hub = await toHub(game);
    game.host.click(247, 362);
    await runFor(game.engine, game.host, 200);
    expect(hub.monitorOpen).toBe(true);
    game.host.press("KeyQ", { key: "q" });
    await runFor(game.engine, game.host, 100);
    expect(hub.history.h).toBe(0);
  });

  it("à la fermeture, un nouveau joueur reçoit l'introduction de Poly et le roster est mis à jour", async () => {
    const game = boot();
    const hub = await toHub(game);
    game.host.click(247, 362);
    await runFor(game.engine, game.host, 200);
    const { roster } = game.engine.ctx.roster;
    const added = roster.addPlayer("Lea");
    if (!added.ok) throw new Error("joueur refusé");
    game.engine.ctx.roster.currentPlayerId = added.id;
    hub.monitorClosed();
    expect(roster.getVar(added.id, "hubPolyIntroSeen")).toBe(1);
    await runFor(game.engine, game.host, 200);
    expect(isRunning(game, 5800)).toBe(true);
  });

  it("décocher Ambient Sounds dans le moniteur coupe la musique du hub", async () => {
    const game = boot();
    const hub = await toHub(game);
    game.host.click(247, 362);
    await runFor(game.engine, game.host, 200);
    expect(game.services.sound.musicPlaying).toBe(true);
    game.engine.ctx.roster.roster.ambient = false;
    hub.monitorClosed();
    expect(game.services.sound.musicPlaying).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("hub : quitter", () => {
  const QUIT = [173, 362] as const;

  it("Quit seul n'éteint rien : le sifflet apparaît", async () => {
    const game = boot();
    const hub = await toHub(game);
    game.host.click(...QUIT);
    await runFor(game.engine, game.host, 100);
    expect(hub.quitPhase).toBe("prompt");
    expect(isRunning(game, 10300)).toBe(true);
    await runFor(game.engine, game.host, 5000);
    expect(game.host.exited).toBe(false);
    expect(sceneOf(game)).toBe(SceneId.hub);
  });

  it("un clic ailleurs annule : le sifflet se range, le jeu continue", async () => {
    const game = boot();
    const hub = await toHub(game);
    game.host.click(...QUIT);
    await runFor(game.engine, game.host, 1500);
    game.host.click(400, 420);
    await runFor(game.engine, game.host, 100);
    expect(hub.quitPhase).toBe("idle");
    expect(isRunning(game, 10200)).toBe(true);
    await runFor(game.engine, game.host, 3000);
    expect(game.host.exited).toBe(false);
    expect(sceneOf(game)).toBe(SceneId.hub);
    // On peut recommencer.
    game.host.click(...QUIT);
    await runFor(game.engine, game.host, 300);
    expect(hub.quitPhase).toBe("prompt");
  });

  it("un clic sur un objet pendant l'invite l'annule sans quitter", async () => {
    const game = boot();
    const hub = await toHub(game);
    signIn(game);
    game.host.click(...QUIT);
    await runFor(game.engine, game.host, 1500);
    game.host.click(330, 280);
    await runFor(game.engine, game.host, 100);
    expect(hub.quitPhase).toBe("idle");
    expect(game.host.exited).toBe(false);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.bowling, 20_000);
  });

  it("le sifflet confirme : il retentit, se range, puis host.exit()", async () => {
    const game = boot();
    const hub = await toHub(game);
    game.host.click(...QUIT);
    await runFor(game.engine, game.host, 1500);
    // Le sifflet (zone 152, 317, 228, 403).
    game.host.click(200, 330);
    await runFor(game.engine, game.host, 300);
    expect(hub.quitPhase).toBe("leaving");
    expect(isRunning(game, 10100)).toBe(true);
    expect(game.host.exited).toBe(false);
    await runUntil(game.engine, game.host, () => game.host.exited, 20_000);
    expect(sceneOf(game)).toBe(SceneId.hub);
  });

  it("Ctrl+Q reste la sortie directe du moteur", async () => {
    const game = boot();
    await toHub(game);
    game.host.press("KeyQ", { ctrl: true, key: "q" });
    await runFor(game.engine, game.host, 100);
    expect(game.host.exited).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("hub : aide, jouets, ambiance", () => {
  it("Help : le clic sur un objet joue son explication, Poly met fin à l'aide", async () => {
    const game = boot();
    const hub = await toHub(game);
    game.host.click(210, 362);
    await runFor(game.engine, game.host, 300);
    expect(hub.helpMode).toBe(true);
    // Introduction jouée (4800 : le joueur a déjà tout vu dans ce test) ; un clic la passe.
    game.host.click(300, 20);
    await runFor(game.engine, game.host, 200);
    game.host.click(300, 20);
    await runFor(game.engine, game.host, 6000);
    // Le « ? » apparaît sur l'engrenage (zone 11), pas sur Poly (zone 1).
    game.host.input.moveMouse(300, 160);
    await runFor(game.engine, game.host, 100);
    expect(game.host.cursor).toBe("help");
    game.host.input.moveMouse(100, 280);
    await runFor(game.engine, game.host, 100);
    expect(game.host.cursor).toBe("arrow");
    game.host.click(300, 160);
    await runFor(game.engine, game.host, 200);
    expect(isRunning(game, 4100)).toBe(true);
    expect(sceneOf(game)).toBe(SceneId.hub);
    // Un clic pendant l'explication passe à la suivante de la chaîne.
    game.host.click(520, 20);
    await runFor(game.engine, game.host, 200);
    expect(isRunning(game, 4200)).toBe(true);
    game.host.click(520, 20);
    await runFor(game.engine, game.host, 200);
    game.host.click(520, 20);
    await runFor(game.engine, game.host, 200);
    // Poly : fin du mode aide.
    game.host.click(100, 280);
    await runFor(game.engine, game.host, 200);
    game.host.click(520, 20);
    await runFor(game.engine, game.host, 6000);
    expect(hub.helpMode).toBe(false);
    expect(game.host.cursor).toBe("arrow");
  });

  it("en mode aide, les objets ne lancent pas d'activité", async () => {
    const game = boot();
    const hub = await toHub(game);
    signIn(game);
    game.host.click(210, 362);
    await runFor(game.engine, game.host, 300);
    game.host.click(520, 20);
    await runFor(game.engine, game.host, 6000);
    expect(hub.helpMode).toBe(true);
    game.host.click(330, 280);
    await runFor(game.engine, game.host, 3000);
    expect(sceneOf(game)).toBe(SceneId.hub);
  });

  it("le levier de la télé gèle sa boucle et la relance au second clic", async () => {
    const game = boot();
    await toHub(game);
    expect(isRunning(game, 2000)).toBe(true);
    game.host.click(110, 405);
    await runFor(game.engine, game.host, 4000);
    expect(isRunning(game, 2000)).toBe(false);
    game.host.click(110, 405);
    await runFor(game.engine, game.host, 4000);
    expect(isRunning(game, 2000)).toBe(true);
  });

  it("Ctrl à l'entrée : mode sans animations (pas de boucles d'ambiance)", async () => {
    const game = boot();
    await toTitle(game);
    game.host.input.keyDown({ code: "ControlLeft", key: "Control", ctrl: true });
    game.host.click(290, 300);
    await runUntil(game.engine, game.host, () => sceneOf(game) === SceneId.hub, 30_000);
    await runFor(game.engine, game.host, 500);
    expect(isRunning(game, 1400)).toBe(false);
    expect(isRunning(game, 1700)).toBe(false);
  });

  it("par défaut les boucles d'ambiance tournent", async () => {
    const game = boot();
    await toHub(game);
    for (const script of [1400, 1700, 2000, 1800, 1500]) expect(isRunning(game, script)).toBe(true);
  });

  it("MIDI 65000 seulement si « Ambient Sounds » est coché", async () => {
    const on = boot();
    await toTitle(on);
    on.host.click(290, 300);
    await runUntil(on.engine, on.host, () => sceneOf(on) === SceneId.hub, 30_000);
    await runFor(on.engine, on.host, 500);
    expect(on.services.sound.musicPlaying).toBe(true);

    const off = boot();
    off.engine.ctx.roster.roster.ambient = false;
    await toTitle(off);
    off.host.click(290, 300);
    await runUntil(off.engine, off.host, () => sceneOf(off) === SceneId.hub, 30_000);
    await runFor(off.engine, off.host, 500);
    expect(off.services.sound.musicPlaying).toBe(false);
  });

  it("Poly joue des clips d'attente quand rien ne se passe", async () => {
    const game = boot();
    await toHub(game);
    const seen = new Set<number>();
    await runFor(game.engine, game.host, 40_000, () => {
      for (const a of game.services.scr.running) seen.add(a.scrId);
    });
    const idle = [6000, 6100, 2700, 2800, 2900];
    expect(idle.some((id) => seen.has(id))).toBe(true);
  });
});
