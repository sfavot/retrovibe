import { describe, expect, it } from "vitest";
import { MsvcRandom } from "../../src/engine/mohawk/rng";
import { ScreenId as S } from "../../src/games/zoombinis/engine/scene";
import {
  FIRST_PUZZLE,
  MAP_PLACE_SCREEN,
  TRANSFER_ROUTES,
  changeScreen,
  currentLevel,
  enterTraining,
  exitPuzzle,
  leaveMap,
  leaveTraining,
  mapClick,
  newGameInPlay,
  nextScreen,
  placeActivation,
  resumeScreen,
  stageOf,
  transferId,
} from "../../src/games/zoombinis/game/route";
import { type GameDate, type GameState, type Session, type Zoombini, createSession, makeZoombini, newGame } from "../../src/games/zoombinis/game/state";
import {
  addZoombini,
  atCamp,
  campArrive,
  campExitAllowed,
  campLeave,
  groupComplete,
  isGameOver,
  pickRandomType,
  pickerEnter,
  pickerLeave,
  takeFromShelf,
  townArrive,
} from "../../src/games/zoombinis/game/team";

const DATE: GameDate = { year: 1996, month: 11, day: 3 };

function party(n: number): Zoombini[] {
  return Array.from({ length: n }, (_, i) => makeZoombini([(i % 5) + 1, Math.trunc(i / 5) + 1, 1, 1], i + 1));
}

/** Une partie jouée écran par écran, comme le feront les scènes : l'état et la session sont ceux des modules, la « scène » est la liste `party`. */
class Run {
  readonly game: GameState = newGame();
  readonly session: Session = createSession();
  readonly rng: MsvcRandom;
  /** Numéros de trajet `XFER` joués, dans l'ordre. */
  readonly transfers: number[] = [];
  /** Écrans réellement initialisés (`XFER` compris), dans l'ordre. */
  readonly visited: number[] = [];
  party: Zoombini[] = [];
  private nextId = 1;

  constructor(seed: number) {
    this.rng = new MsvcRandom(seed);
  }

  /** Demande un écran ; si `XFER` est intercalé, il est joué jusqu'au bout. */
  go(to: number): void {
    const ch = changeScreen(this.game, this.session, to);
    this.visited.push(ch.screen);
    if (ch.screen === S.xfer) {
      this.transfers.push(ch.transfer!);
      const after = changeScreen(this.game, this.session, ch.target!);
      this.visited.push(after.screen);
    }
  }

  /** Logo → reprise → écran 3. */
  start(): void {
    this.session.screen = S.logo;
    this.go(resumeScreen(this.game, this.session));
  }

  /** Écran 3 : composer un groupe (les revenants du choix d'abord), puis partir. */
  compose(): void {
    this.party = pickerEnter(this.game).map((z) => ({ ...z }));
    this.game.group.members = this.party;
    while (!groupComplete(this.game)) {
      const pick = pickRandomType(this.game, this.rng, [0, 0, 0, 0]);
      if (!pick.available) break;
      const added = addZoombini(this.game, pick.attrs, this.rng, this.nextId++);
      if (!added) break;
    }
  }

  depart(): void {
    pickerLeave(this.game, this.session, this.party, false);
    this.party = this.game.group.members;
    this.go(S.bridge);
  }

  /** Joue une épreuve, perd `lose` Zoombinis, enchaîne sur la suite. */
  puzzle(screen: number, lose = 0): void {
    expect(this.session.screen).toBe(screen);
    this.party.slice(this.party.length - lose).forEach((z) => (z.present = false));
    exitPuzzle(this.game, this.session, screen, this.party, DATE);
    this.party = this.game.group.members.filter((z) => z.present);
  }

  /** Arrivée au camp, remplissage depuis le présentoir, sortie si elle est permise ; renvoie vrai si le groupe est parti. */
  camp(camp: 1 | 2): boolean {
    const arrival = campArrive(this.game, camp);
    this.party = arrival.party;
    const reserve = camp === 1 ? this.game.camp1 : this.game.camp2;
    for (let i = 0; i < 625 && this.party.length < 16; i += 1) {
      const z = takeFromShelf(this.game, camp, i);
      if (z) this.party.push(z);
    }
    if (!campExitAllowed(this.game, camp, this.party.length)) {
      campLeave(this.game, this.session, camp, this.party, true);
      expect(reserve.count).toBeGreaterThanOrEqual(0);
      return false;
    }
    campLeave(this.game, this.session, camp, this.party, false);
    this.party = this.game.group.members;
    return true;
  }

  /** Les trois épreuves d'un chemin puis l'arrivée, sans perte. */
  stage(first: number): void {
    for (let s = first; s < first + 3; s += 1) {
      this.puzzle(s);
      this.go(nextScreen(s, "success"));
    }
  }

  /** Un groupe de bout en bout, sans perte : choix → étape 1 → camp 1 → chemin → camp 2 → étape 4 → ville. */
  fullGroup(path: "A" | "B"): void {
    this.compose();
    this.depart();
    this.stage(S.bridge);
    expect(this.session.screen).toBe(S.baseCamp);
    expect(this.camp(1)).toBe(true);
    this.go(nextScreen(S.baseCamp, "success", path));
    this.stage(path === "A" ? S.ferry : S.fleens);
    expect(this.session.screen).toBe(S.bcTwo);
    expect(this.camp(2)).toBe(true);
    this.go(nextScreen(S.bcTwo, "success"));
    this.stage(S.caves);
    expect(this.session.screen).toBe(S.town);
    this.arriveTown();
  }

  arriveTown(): void {
    townArrive(this.game);
    this.party = [];
  }
}

describe("étapes et niveaux (1108:02f9, 1168:515d)", () => {
  it("l'étape d'un écran d'épreuve", () => {
    expect([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((s) => stageOf(s).stage)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4]);
    expect([7, 9, 12, 15, 18].map((s) => stageOf(s).last)).toEqual([false, true, true, true, true]);
    expect([0, 1, 2, 3, 4, 5, 6, 19].map((s) => stageOf(s))).toEqual(new Array(8).fill({ stage: 0, last: false }));
  });

  it("le niveau courant : étape en aventure, entraînement − 1", () => {
    const game = newGame();
    const session = createSession();
    game.levels = [0, 1, 2, 3];
    expect([7, 10, 13, 16].map((s) => currentLevel(game, session, s))).toEqual([0, 1, 2, 3]);
    expect(currentLevel(game, session, S.map)).toBe(0);
    enterTraining(session, 2);
    expect(currentLevel(game, session, 7)).toBe(2);
    expect(() => enterTraining(session, 4)).toThrow();
  });
});

describe("changement d'écran (1108:0000)", () => {
  it("trajets : les 16 paires et rien d'autre", () => {
    expect(TRANSFER_ROUTES).toHaveLength(16);
    expect(transferId(3, 7)).toBe(1);
    expect(transferId(18, 6)).toBe(16);
    expect(transferId(4, 13)).toBe(9);
    expect(transferId(7, 9)).toBeNull();
  });

  it("transition intercalée : écran 2, destination derrière, numéro de trajet", () => {
    const game = newGame();
    const session = createSession();
    session.screen = S.picker;
    expect(changeScreen(game, session, S.bridge)).toEqual({ screen: S.xfer, target: S.bridge, transfer: 1 });
    expect(session.finalTarget).toBe(S.bridge);
    expect(game.previousScreen).toBe(S.picker);
    expect(game.resumeScreen).toBe(S.bridge);
    expect(game.stageUnbroken).toBe(false);
    // fin de la transition : la destination, S+0xCA = 2, S+0x54 levé à l'entrée de 7
    expect(changeScreen(game, session, S.bridge)).toEqual({ screen: S.bridge, target: null, transfer: null });
    expect(game.previousScreen).toBe(S.xfer);
    expect(game.stageUnbroken).toBe(true);
  });

  it("pas de transition : vers la carte, depuis la carte / la ville, option, reprise", () => {
    const game = newGame();
    const session = createSession();
    session.screen = S.bridge;
    expect(changeScreen(game, session, S.map).screen).toBe(S.map);
    expect(changeScreen(game, session, S.picker).screen).toBe(S.picker);
    session.screen = S.map;
    expect(changeScreen(game, session, S.baseCamp).screen).toBe(S.baseCamp);
    session.screen = S.town;
    expect(changeScreen(game, session, S.map).screen).toBe(S.map);
    game.options.transitionsOff = true;
    session.screen = S.picker;
    expect(changeScreen(game, session, S.bridge).screen).toBe(S.bridge);
    game.options.transitionsOff = false;
    session.screen = S.picker;
    session.resuming = true;
    expect(changeScreen(game, session, S.bridge).screen).toBe(S.bridge);
    expect(session.resuming).toBe(false);
  });

  it("l'écran de reprise n'est jamais 0 ni 2", () => {
    const game = newGame();
    const session = createSession();
    session.screen = S.xfer;
    changeScreen(game, session, S.map);
    session.screen = S.map;
    changeScreen(game, session, S.logo);
    expect(game.resumeScreen).toBe(S.map);
  });

  it("progression des étapes à la sortie de 9, 12, 15, 18 (bit 1 << niveau)", () => {
    const game = newGame();
    const session = createSession();
    game.levels = [2, 1, 0, 3];
    session.screen = S.pizza;
    changeScreen(game, session, S.baseCamp);
    session.screen = S.slides;
    changeScreen(game, session, S.bcTwo);
    session.screen = S.net;
    changeScreen(game, session, S.bcTwo);
    session.screen = S.maze2;
    changeScreen(game, session, S.town);
    expect(game.masks).toEqual({ stage1: 4, stage2: 2, stage3: 1, stage4: 8 });
    expect(session.lastFinal).toBe(S.maze2);
    // sortie vers la carte (abandon) : aucun bit
    const g2 = newGame();
    const s2 = createSession();
    s2.screen = S.pizza;
    changeScreen(g2, s2, S.map);
    expect(g2.masks.stage1).toBe(0);
  });

  it("le niveau déjà monté par 1168:36e1 ne compte pas pour la fin d'étape (drapeau [9700])", () => {
    const game = newGame();
    const session = createSession();
    session.screen = S.pizza;
    game.levels[0] = 1;
    session.levelRaised = true;
    changeScreen(game, session, S.baseCamp);
    expect(game.masks.stage1).toBe(1);
  });

  it("entraînement : jamais de transition, tout mène à la carte sauf 3 et 0", () => {
    const game = newGame();
    const session = createSession();
    enterTraining(session, 0);
    session.screen = S.picker;
    expect(changeScreen(game, session, S.bridge)).toMatchObject({ screen: S.map, transfer: null });
    session.screen = S.bridge;
    expect(changeScreen(game, session, S.baseCamp).screen).toBe(S.map);
    session.screen = S.map;
    expect(changeScreen(game, session, S.fleens).screen).toBe(S.fleens);
    session.screen = S.fleens;
    expect(changeScreen(game, session, S.picker).screen).toBe(S.picker);
    expect(game.stageUnbroken).toBe(false);
    expect(game.masks.stage1).toBe(0);
  });
});

describe("reprise après le logo (1160:0521)", () => {
  it("partie neuve → choix des Zoombinis", () => {
    const game = newGame();
    const session = createSession();
    expect(resumeScreen(game, session)).toBe(S.picker);
    expect(session.resuming).toBe(false);
  });

  it("carte, choix, camps, ville : reprise directe ; épreuve : seulement avec un groupe", () => {
    const session = createSession();
    for (const s of [S.map, S.picker, S.baseCamp, S.bcTwo, S.town]) {
      const game = newGame();
      game.resumeScreen = s;
      expect(resumeScreen(game, session)).toBe(s);
      expect(session.resuming).toBe(true);
    }
    const game = newGame();
    game.resumeScreen = S.hotel;
    expect(resumeScreen(game, createSession())).toBe(S.picker);
    game.group.members = party(3);
    const s2 = createSession();
    expect(resumeScreen(game, s2)).toBe(S.hotel);
    expect(s2.resuming).toBe(true);
    game.resumeScreen = 19;
    expect(resumeScreen(game, createSession())).toBe(S.picker);
  });

  it("nouvelle partie en cours de jeu", () => {
    const session = createSession();
    session.screen = S.map;
    session.name = "Léa";
    enterTraining(session, 1);
    const { game, screen } = newGameInPlay(session);
    expect(screen).toBe(S.map);
    expect(game.previousScreen).toBe(S.picker);
    expect(session).toMatchObject({ name: null, training: 0, resuming: true });
    session.screen = S.baseCamp;
    expect(newGameInPlay(session).screen).toBe(S.picker);
  });
});

describe("suites d'épreuves", () => {
  it("réussite : la chaîne ; échec : la carte", () => {
    expect([S.picker, S.bridge, S.tunnels, S.pizza].map((s) => nextScreen(s, "success"))).toEqual([7, 8, 9, 4]);
    expect(nextScreen(S.baseCamp, "success", "A")).toBe(S.ferry);
    expect(nextScreen(S.baseCamp, "success", "B")).toBe(S.fleens);
    expect(() => nextScreen(S.baseCamp, "success")).toThrow();
    expect([S.ferry, S.lilly, S.slides].map((s) => nextScreen(s, "success"))).toEqual([11, 12, 5]);
    expect([S.fleens, S.hotel, S.net].map((s) => nextScreen(s, "success"))).toEqual([14, 15, 5]);
    expect([S.bcTwo, S.caves, S.smoke, S.maze2].map((s) => nextScreen(s, "success"))).toEqual([16, 17, 18, 6]);
    expect(nextScreen(S.hotel, "failure")).toBe(S.map);
    expect(() => nextScreen(S.map, "success")).toThrow();
  });
});

describe("sortie d'épreuve (1168:36e1)", () => {
  function atStage(screen: number): { game: GameState; session: Session } {
    const game = newGame();
    const session = createSession();
    session.screen = screen;
    game.stageUnbroken = true;
    return { game, session };
  }

  it("sans perte : marques de réussite, sans monument hors dernière épreuve", () => {
    const { game, session } = atStage(S.tunnels);
    const out = exitPuzzle(game, session, S.tunnels, party(16), DATE);
    expect(out).toMatchObject({ stage: 1, survivors: 16, lost: 0, monument: null, levelRaised: false });
    expect(game.successes[1]).toBe(0x11);
    expect(game.monuments.every((m) => m === null)).toBe(true);
    expect(game.group.members).toHaveLength(16);
  });

  it("dernière épreuve sans perte : monument daté, niveau + 1, drapeau [9700] ; pas de doublon", () => {
    const { game, session } = atStage(S.pizza);
    const out = exitPuzzle(game, session, S.pizza, party(16), DATE);
    expect(out.monument).toEqual({ stage: 1, level: 1, ...DATE });
    expect(game.monuments[0]).toEqual({ stage: 1, level: 1, ...DATE });
    expect(game.levels[0]).toBe(1);
    expect(session.levelRaised).toBe(true);
    expect(game.successes[2]).toBe(0x11);
    // le même niveau refait (niveau remis à 0 à la main) : pas de second monument, niveau relevé quand même
    game.levels[0] = 0;
    exitPuzzle(game, session, S.pizza, party(16), { year: 2000, month: 1, day: 1 });
    expect(game.monuments.filter((m) => m !== null)).toHaveLength(1);
    expect(game.levels[0]).toBe(1);
  });

  it("le niveau plafonne à 3 et le 4e monument est quand même posé", () => {
    const { game, session } = atStage(S.maze2);
    game.levels[3] = 3;
    const out = exitPuzzle(game, session, S.maze2, party(16), DATE);
    expect(out.monument).toMatchObject({ stage: 4, level: 4 });
    expect(game.levels[3]).toBe(3);
    expect(out.levelRaised).toBe(false);
    expect(game.successes[11]).toBe(0x88);
  });

  it("étape interrompue (S+0x54 = 0) : marque de réussite mais ni marque sans perte ni monument ni niveau", () => {
    const { game, session } = atStage(S.pizza);
    game.stageUnbroken = false;
    exitPuzzle(game, session, S.pizza, party(16), DATE);
    expect(game.successes[2]).toBe(0x01);
    expect(game.monuments[0]).toBeNull();
    expect(game.levels[0]).toBe(0);
  });

  it("perdus de l'étape 1 : rendus à la réserve du choix, survivants seuls dans le groupe", () => {
    const { game, session } = atStage(S.tunnels);
    const p = party(16);
    p[14]!.present = false;
    p[15]!.present = false;
    const out = exitPuzzle(game, session, S.tunnels, p, DATE);
    expect(out).toMatchObject({ survivors: 14, lost: 2 });
    expect(game.group.members).toHaveLength(14);
    expect(game.pickerGroup.members.map((m) => m.attrs)).toEqual([p[14]!.attrs, p[15]!.attrs]);
    expect(game.pickerGroup.members.every((m) => m.present)).toBe(true);
    expect(game.counters).toMatchObject({ camp1: 0, camp2: 0 });
    expect(game.stageUnbroken).toBe(false);
    expect(game.successes[1]).toBe(0x01);
    // les perdus de deux épreuves de l'étape 1 s'ajoutent
    session.screen = S.pizza;
    game.stageUnbroken = true;
    const q = party(14);
    q[13]!.present = false;
    exitPuzzle(game, session, S.pizza, q, DATE);
    expect(game.pickerGroup.members).toHaveLength(3);
    expect(game.monuments[0]).toBeNull();
    expect(game.levels[0]).toBe(0);
  });

  it("perdus des étapes 2 et 3 : réserve de groupe du camp 1 (S+0x4A augmente) ; étape 4 : camp 2 (S+0x4C)", () => {
    const a = atStage(S.lilly);
    const p = party(16);
    p[15]!.present = false;
    exitPuzzle(a.game, a.session, S.lilly, p, DATE);
    expect(a.game.camp1Group.members).toHaveLength(1);
    expect(a.game.counters.camp1).toBe(1);
    const b = atStage(S.hotel);
    const q = party(16);
    q[0]!.present = false;
    exitPuzzle(b.game, b.session, S.hotel, q, DATE);
    expect(b.game.camp1Group.members).toHaveLength(1);
    expect(b.game.group.members).toHaveLength(15);
    expect(b.game.group.members.every((m) => m.present)).toBe(true);
    const c = atStage(S.smoke);
    const r = party(16);
    r[3]!.present = false;
    r[4]!.present = false;
    exitPuzzle(c.game, c.session, S.smoke, r, DATE);
    expect(c.game.camp2Group.members).toHaveLength(2);
    expect(c.game.counters.camp2).toBe(2);
  });

  it("la réserve de groupe du camp est purgée du groupe parti avant d'accueillir les perdus", () => {
    const { game, session } = atStage(S.ferry);
    game.counters.camp1 = 16;
    campLeave(game, session, 1, party(16), false);
    expect(game.camp1Group.members).toHaveLength(16);
    const p = party(16);
    p[15]!.present = false;
    exitPuzzle(game, session, S.ferry, p, DATE);
    expect(game.camp1Group.members).toHaveLength(1);
    expect(game.camp1Group.flagA).toBe(false);
  });

  it("groupe abandonné à la carte ([a406]) : rien n'est recopié ; entraînement vers la carte : groupe vidé", () => {
    const { game, session } = atStage(S.bridge);
    session.leftToMap = true;
    expect(exitPuzzle(game, session, S.bridge, party(16), DATE).survivors).toBe(0);
    expect(game.successes[0]).toBe(0);
    const t = atStage(S.bridge);
    enterTraining(t.session, 0);
    exitPuzzle(t.game, t.session, S.bridge, party(16), DATE, true);
    expect(t.game.group.members).toHaveLength(0);
    expect(t.game.successes[0]).toBe(0);
  });

  it("hors épreuve (camp, ville) : le groupe est seulement recopié", () => {
    const { game, session } = atStage(S.baseCamp);
    const p = party(5);
    p[4]!.present = false;
    const out = exitPuzzle(game, session, S.baseCamp, p, DATE);
    expect(out).toMatchObject({ stage: 0, survivors: 4, lost: 1 });
    expect(game.group.members).toHaveLength(5);
  });
});

describe("carte (1110:*)", () => {
  it("lieux : 16 écrans, d'après la table de 1110:0819", () => {
    expect(MAP_PLACE_SCREEN).toHaveLength(16);
    expect(MAP_PLACE_SCREEN[0]).toBe(S.picker);
    expect(MAP_PLACE_SCREEN[15]).toBe(S.town);
    expect(new Set(MAP_PLACE_SCREEN).size).toBe(16);
  });

  it("partie neuve : seul Zoombinîle est actif et cliquable", () => {
    const game = newGame();
    const session = createSession();
    expect(placeActivation(game, session)).toEqual([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(mapClick(game, session, 1)).toEqual({ screen: S.picker, leaveTraining: false });
    for (let p = 2; p <= 16; p += 1) expect(mapClick(game, session, p)).toBeNull();
  });

  it("l'avancement ouvre les camps et la ville", () => {
    const game = newGame();
    const session = createSession();
    game.masks.stage1 = 1;
    expect(mapClick(game, session, 5)).toEqual({ screen: S.baseCamp, leaveTraining: false });
    expect(mapClick(game, session, 12)).toBeNull();
    game.masks.stage3 = 2;
    expect(mapClick(game, session, 12)).toEqual({ screen: S.bcTwo, leaveTraining: false });
    game.masks.stage4 = 1;
    expect(mapClick(game, session, 16)).toEqual({ screen: S.town, leaveTraining: false });
    // les lieux d'épreuve ne se choisissent pas en aventure
    expect(mapClick(game, session, 8)).toBeNull();
  });

  it("activation : masques au niveau 0, niveau + 1 ensuite", () => {
    const game = newGame();
    const session = createSession();
    game.successes = [1, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    game.masks = { stage1: 1, stage2: 0, stage3: 0, stage4: 0 };
    expect(placeActivation(game, session).slice(0, 5)).toEqual([1, 1, 3, 0, 1]);
    game.levels = [1, 0, 2, 3];
    game.masks.stage3 = 4;
    const a = placeActivation(game, session);
    expect(a.slice(0, 5)).toEqual([1, 2, 2, 2, 2]);
    expect(a.slice(8, 11)).toEqual([3, 3, 3]);
    expect(a[16]).toBe(3);
    expect(a.slice(12, 16)).toEqual([4, 4, 4, 4]);
    expect(a[11]).toBe(0);
  });

  it("entraînement : tous les lieux répondent, l'activation vaut le niveau + 1, Zoombinîle et les camps atteints quittent l'entraînement", () => {
    const game = newGame();
    const session = createSession();
    enterTraining(session, 2);
    expect(placeActivation(game, session)).toEqual(new Array(17).fill(3));
    expect(mapClick(game, session, 8)).toEqual({ screen: S.slides, leaveTraining: false });
    expect(mapClick(game, session, 1)).toEqual({ screen: S.picker, leaveTraining: true });
    expect(mapClick(game, session, 5)).toBeNull();
    game.masks.stage1 = 1;
    expect(mapClick(game, session, 5)).toEqual({ screen: S.baseCamp, leaveTraining: true });
    leaveTraining(session);
    expect(session.training).toBe(0);
  });

  it("quitter la carte : le groupe est perdu en aventure, un groupe d'essai est tiré en entraînement", () => {
    const game = newGame();
    const session = createSession();
    session.screen = S.map;
    game.group.members = party(16);
    leaveMap(game, session, new MsvcRandom(4));
    expect(game.group.members).toHaveLength(0);
    expect(session.leftToMap).toBe(true);
    changeScreen(game, session, S.picker);
    expect(session.leftToMap).toBe(false);
    enterTraining(session, 0);
    session.screen = S.map;
    leaveMap(game, session, new MsvcRandom(4));
    expect(game.group.members).toHaveLength(16);
  });
});

describe("parcours complets", () => {
  it("un groupe sans perte, chemin A : les 16 trajets dans l'ordre et les 12 épreuves", () => {
    const run = new Run(100);
    run.start();
    expect(run.session.screen).toBe(S.picker);
    expect(run.visited).toEqual([S.picker]);
    run.fullGroup("A");
    expect(run.transfers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16]);
    expect(run.game.counters).toEqual({ created: 16, camp1: 0, camp2: 0, town: 16 });
    expect(run.game.population.count).toBe(16);
    expect(run.game.levels).toEqual([1, 1, 0, 1]);
    expect(run.game.masks).toEqual({ stage1: 1, stage2: 1, stage3: 0, stage4: 1 });
    expect(run.game.monuments.filter((m) => m !== null).map((m) => [m!.stage, m!.level])).toEqual([
      [1, 1],
      [2, 1],
      [4, 1],
    ]);
    expect(run.game.successes).toEqual([0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0, 0, 0, 0x11, 0x11, 0x11]);
    expect(run.game.resumeScreen).toBe(S.town);
    // S+0x54 n'est effacé que par un retour de perdus : il reste levé après une étape parfaite
    expect(run.game.stageUnbroken).toBe(true);
  });

  it("chemin B : trajets 9 à 12", () => {
    const run = new Run(101);
    run.start();
    run.fullGroup("B");
    expect(run.transfers).toEqual([1, 2, 3, 4, 9, 10, 11, 12, 13, 14, 15, 16]);
    expect(run.game.levels).toEqual([1, 0, 1, 1]);
    expect(run.game.masks).toEqual({ stage1: 1, stage2: 0, stage3: 1, stage4: 1 });
  });

  it("avec pertes : les perdus reviennent au choix (étape 1) et au présentoir du camp (arrivée suivante)", () => {
    const run = new Run(102);
    run.start();
    // groupe A : 2 perdus à la grotte (étape 1)
    run.compose();
    run.depart();
    run.puzzle(S.bridge);
    run.go(S.tunnels);
    run.puzzle(S.tunnels, 2);
    run.go(S.pizza);
    run.puzzle(S.pizza);
    run.go(S.baseCamp);
    expect(run.game.pickerGroup.members).toHaveLength(2);
    expect(run.game.levels[0]).toBe(0);
    expect(run.game.monuments[0]).toBeNull();
    // 14 au camp : pas de départ, retour à la carte puis au choix
    expect(run.camp(1)).toBe(false);
    expect(run.game.counters.camp1).toBe(14);
    expect(run.game.camp1Group.members).toHaveLength(14);
    expect(run.game.group.members).toHaveLength(0);
    run.go(S.map);
    leaveMap(run.game, run.session, run.rng);
    run.go(S.picker);
    // groupe B : les 2 revenants + 14 nouveaux
    const returned = run.game.pickerGroup.members.map((z) => z.attrs);
    run.compose();
    expect(run.party.slice(0, 2).map((z) => z.attrs)).toEqual(returned);
    expect(run.party).toHaveLength(16);
    expect(run.game.counters.created).toBe(30);
    run.depart();
    run.stage(S.bridge);
    expect(run.session.screen).toBe(S.baseCamp);
    // arrivée : les 14 du groupe A (réserve de groupe) sont versés au présentoir, le groupe B part
    expect(run.camp(1)).toBe(true);
    expect(run.game.counters.camp1).toBe(14);
    expect(atCamp(run.game, 1)).toBe(14);
    expect(run.game.camp1.count).toBe(14);
    expect(run.game.monuments[0]).toMatchObject({ stage: 1, level: 1 });
    expect(run.game.levels[0]).toBe(1);
    // chemin A, 3 perdus au bac : leurs fiches attendent dans la réserve de groupe du camp 1
    run.go(nextScreen(S.baseCamp, "success", "A"));
    run.puzzle(S.ferry, 3);
    run.go(S.lilly);
    run.puzzle(S.lilly);
    run.go(S.slides);
    run.puzzle(S.slides);
    run.go(S.bcTwo);
    expect(run.game.camp1Group.members).toHaveLength(3);
    expect(run.game.counters.camp1).toBe(17);
    expect(run.game.levels[1]).toBe(0);
    expect(run.party).toHaveLength(13);
    // 13 au camp 2 : impossible de partir
    expect(run.camp(2)).toBe(false);
    expect(run.game.counters.camp2).toBe(13);
  });

  it("le jeu entier sans perte : 625 Zoombinis, 40 groupes, fin de jeu à 625, monuments et niveaux au maximum", () => {
    const run = new Run(2024);
    run.start();
    let groups = 0;
    while (!isGameOver(run.game)) {
      expect(groups).toBeLessThan(45);
      run.fullGroup(groups % 2 === 0 ? "A" : "B");
      groups += 1;
    }
    expect(groups).toBe(40);
    const g = run.game;
    expect(g.counters).toEqual({ created: 625, camp1: 0, camp2: 0, town: 625 });
    expect(g.population.count).toBe(625);
    expect(g.typeCounts.reduce((n, c) => n + c, 0)).toBe(625);
    expect(g.typeCounts.every((c) => c <= 2)).toBe(true);
    expect(g.levels).toEqual([3, 3, 3, 3]);
    expect(g.monuments.every((m) => m !== null)).toBe(true);
    expect(g.masks).toEqual({ stage1: 15, stage2: 15, stage3: 15, stage4: 15 });
    expect(placeActivation(g, createSession())).toEqual([1, ...new Array<number>(16).fill(4)]);
    // les bâtiments : 16 emplacements, un par (étape, niveau)
    const pairs = new Set(g.monuments.map((m) => `${m!.stage}/${m!.level}`));
    expect(pairs.size).toBe(16);
    expect(FIRST_PUZZLE).toBe(7);
  });
});
