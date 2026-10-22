import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BorlandRandom } from "../../src/games/teleportaschtroumpf/engine/rng";
import { DEFAULT_OPTIONS } from "../../src/games/teleportaschtroumpf/engine/options";
import { arrival, doorAt, doorClassAt, resolveEdges, settleX } from "../../src/games/teleportaschtroumpf/game/board";
import { Game, newGame, type GameSetup } from "../../src/games/teleportaschtroumpf/game/rules";
import { popcount } from "../../src/games/teleportaschtroumpf/game/state";
import {
  BESPECTACLED_DESTINATIONS,
  BIRD_HINT_SCENES,
  CHARACTER_TEXT_INDEX,
  DOORS,
  DOOR_CLASSES,
  GOAL_TABLE,
  HAZARDS,
  INGREDIENT_SCENES,
  MAP_CELLS,
  MAP_LOCATIONS,
  MINIGAMES,
  SCENE_CODES,
  WISH_DESTINATIONS,
  type DoorClass,
  type Hazard,
  type Row,
} from "../../src/games/teleportaschtroumpf/game/tables";

const EXE = "original/teleportaschtroumpf/SMURF.EXE";

/** Hasard dont on dicte les tirages (`below(n)` consomme la file, puis 0). */
class ScriptedRandom extends BorlandRandom {
  constructor(readonly queue: number[]) {
    super(1);
  }
  override below(n: number): number {
    const v = this.queue.length > 0 ? this.queue.shift()! : 0;
    return v % n;
  }
}

/** Parties de test : les événements de mise en place sont purgés (voir `Game.takeEvents`). */
function solo(rng: BorlandRandom = new BorlandRandom(7), options = DEFAULT_OPTIONS): Game {
  const game = newGame({ players: [{ character: 0 }], options }, rng);
  game.takeEvents();
  return game;
}
function duo(rng: BorlandRandom = new BorlandRandom(7)): Game {
  const game = newGame({ players: [{ character: 0 }, { character: 3, level: 2 }], options: DEFAULT_OPTIONS }, rng);
  game.takeEvents();
  return game;
}
/** Tirages dictés : `goalDraws` zéros pour l'objectif (6 seul, 4 à deux, 30 min), puis `rest`. */
const scripted = (goalDraws: number, ...rest: number[]) => new ScriptedRandom([...Array<number>(goalDraws).fill(0), ...rest]);

/** Place le pion du joueur courant (l'état est de la donnée sérialisable : modifiable directement dans les tests). */
function place(game: Game, screen: number, row: Row, x: number) {
  const p = game.player;
  p.screen = screen;
  p.row = row;
  p.x = x;
}

describe.skipIf(!existsSync(EXE))("tables lues dans SMURF.EXE", () => {
  const exe = existsSync(EXE) ? new Uint8Array(readFileSync(EXE)) : new Uint8Array();
  const u16 = (o: number) => exe[o] | (exe[o + 1] << 8);
  /** Octet de fichier d'une donnée DGROUP (`DS:xxxx`) et d'une adresse de code (`seg:off`), `engine.md` §0. */
  const ds = (off: number) => 0x4200 + 0x26460 + off;
  const code = (seg: number, off: number) => 0x4200 + seg * 16 + off - 0x10000;

  it("objectif : DS:19E0, 4 durées × 4 nombres de joueurs", () => {
    expect(GOAL_TABLE.length).toBe(4);
    for (let d = 0; d < 4; d++) {
      for (let n = 0; n < 4; n++) {
        const o = ds(0x19e0) + d * 16 + n * 4;
        expect(GOAL_TABLE[d][n]).toEqual({ ingredients: u16(o), points: exe[o + 2] });
      }
    }
  });

  it("portes : les constantes de `MOV AX, imm` des 18 fonctions 2813:010b..06b4", () => {
    const funcs: [number, number, Row, number][] = [
      // [offset, taille, rangée, écran]
      [0x10b, 66, "top", 1], [0x14d, 83, "top", 2], [0x1a0, 83, "top", 3], [0x1f3, 83, "top", 4], [0x246, 83, "top", 5],
      [0x299, 83, "top", 6], [0x2ec, 83, "top", 7], [0x33f, 73, "top", 8], [0x388, 116, "top", 9],
      [0x3fc, 117, "bottom", 1], [0x474, 83, "bottom", 2], [0x4c7, 83, "bottom", 3], [0x51a, 83, "bottom", 4], [0x56d, 78, "bottom", 5],
      [0x5bb, 83, "bottom", 6], [0x60e, 83, "bottom", 7], [0x661, 83, "bottom", 8], [0x6b4, 116, "bottom", 9],
    ];
    for (const [off, size, row, screen] of funcs) {
      const start = code(0x2813, off);
      const movs: number[] = [];
      for (let i = start; i < start + size - 2; i++) if (exe[i] === 0xb8) movs.push(u16(i + 1));
      const fromExe = movs.filter((v) => v !== 0xffff);
      const zones = DOORS[screen - 1][row].filter((v): v is number => v !== null);
      const compact = zones.filter((v, i) => i === 0 || v !== zones[i - 1]);
      expect(fromExe, `écran ${screen} ${row}`).toEqual(compact);
    }
  });

  it("classes de zones : CS:291e:11f4 (52 mots)", () => {
    const byTarget: Record<number, DoorClass> = { 0xe94: "none", 0xe9b: "well", 0xead: "notFull", 0xebe: "state", 0xec7: "door" };
    expect(DOOR_CLASSES.length).toBe(54);
    for (let i = 0; i < 52; i++) expect(DOOR_CLASSES[i]).toBe(byTarget[u16(code(0x291e, 0x11f4) + 2 * i)]);
  });

  it("codes de scène traités par la partie : CS:28a3:0474 (26 mots)", () => {
    const words = Array.from({ length: 26 }, (_, i) => u16(code(0x28a3, 0x474) + 2 * i));
    expect(SCENE_CODES).toEqual(words);
    // Chaque mini-jeu du tableau est dans la table (sauf 100/101/201..203, qui ne sont pas des scènes jouables).
    for (const m of MINIGAMES) expect(SCENE_CODES).toContain(m.scene);
  });

  it("carte S02 : DS:15BA (cases) et DS:1470 (54 cases)", () => {
    expect(MAP_CELLS.length).toBe(54);
    for (const loc of MAP_LOCATIONS) expect(loc.cell).toBe(u16(ds(0x15ba) + 2 * loc.k));
    for (let i = 0; i < 54; i++) expect([...MAP_CELLS[i]]).toEqual([u16(ds(0x1470) + 6 * i), u16(ds(0x1470) + 6 * i + 2), u16(ds(0x1470) + 6 * i + 4)]);
  });

  it("indices de l'oiseau DS:25F5 et table personnage → texte DS:1058", () => {
    expect(BIRD_HINT_SCENES).toEqual(Array.from({ length: 17 }, (_, i) => exe[ds(0x25f5) + i]));
    expect(CHARACTER_TEXT_INDEX).toEqual(Array.from({ length: 6 }, (_, i) => u16(ds(0x1058) + 2 * i)));
  });
});

describe("tables : cohérence interne", () => {
  it("les lieux de la carte, du puits et du Schtroumpf à lunettes pointent sur la porte du bon mini-jeu", () => {
    expect(WISH_DESTINATIONS.length).toBe(MAP_LOCATIONS.length);
    MAP_LOCATIONS.forEach((loc, i) => {
      const d = WISH_DESTINATIONS[i];
      expect(doorAt(d.screen, d.row, d.x), `k=${loc.k}`).toBe(loc.scene);
    });
    expect(BESPECTACLED_DESTINATIONS.length).toBe(16);
    for (const d of BESPECTACLED_DESTINATIONS) {
      const scene = doorAt(d.screen, d.row, d.x);
      expect(MINIGAMES.some((m) => m.scene === scene && m.kind !== "well")).toBe(true);
    }
  });

  it("chaque ingrédient a sa scène, chaque scène d'ingrédient pointe vers l'ingrédient", () => {
    INGREDIENT_SCENES.forEach((scene, ing) => expect(MINIGAMES.find((m) => m.scene === scene)?.ingredient).toBe(ing));
    expect(new Set(INGREDIENT_SCENES).size).toBe(8);
  });

  it("portes : classes et zones du plateau", () => {
    expect(doorAt(1, "bottom", 0x0b)).toBe(23);
    expect(doorAt(2, "top", 0x120)).toBe(14);
    expect(doorAt(9, "bottom", 0x100)).toBe(36);
    expect(doorAt(1, "top", 0x50)).toBeNull();
    expect(doorAt(2, "top", 0x6b)).toBeNull(); // ligne de séparation
    expect(doorClassAt(3, "bottom", 0x90)).toBe("state");
    expect(doorClassAt(8, "bottom", 0x90)).toBe("notFull");
    expect(settleX(0x6b, true)).toBe(0x70);
    expect(settleX(0x6b, false)).toBe(0x66);
  });

  it("chemin du plateau : bords entre rangées et écrans", () => {
    expect(resolveEdges({ screen: 3, row: "top", x: 0x140 }).position).toEqual({ screen: 3, row: "bottom", x: 0x0b });
    expect(resolveEdges({ screen: 3, row: "bottom", x: 0x140 }).position).toEqual({ screen: 4, row: "top", x: 0x0b });
    expect(resolveEdges({ screen: 3, row: "top", x: -1 }).position).toEqual({ screen: 2, row: "bottom", x: 0x134 });
    expect(resolveEdges({ screen: 3, row: "bottom", x: 0 }).position).toEqual({ screen: 3, row: "top", x: 0x134 });
    expect(resolveEdges({ screen: 1, row: "top", x: 0 }).exit).toBe("left");
    expect(resolveEdges({ screen: 9, row: "bottom", x: 0x13f }).exit).toBe("right");
  });

  it("arrivée après téléportation : une position cohérente avec la table, pour chaque écran", () => {
    const rng = new BorlandRandom(3);
    for (let screen = 1; screen <= 9; screen++) {
      for (let k = 0; k < 30; k++) {
        const pos = arrival(screen, rng);
        expect(pos.screen).toBe(screen);
        expect(pos.x).toBeGreaterThanOrEqual(0x10);
        expect(pos.x).toBeLessThanOrEqual(0x10c);
      }
    }
  });

  it("événements du plateau : zones dans les limites et plages non vides", () => {
    for (const h of HAZARDS) {
      for (const r of [h.walk, h.press, h.dwell, h.counted]) if (r) expect(r[0]).toBeLessThanOrEqual(r[1]);
      expect(h.walk || h.press || h.dwell || h.counted).toBeTruthy();
    }
  });
});

describe("mise en place", () => {
  it("1 joueur : au départ de l'écran 1, objectif de la table", () => {
    const game = newGame({ players: [{ character: 0 }] }, new BorlandRandom(7));
    const s = game.state;
    expect(s.players).toHaveLength(1);
    expect(s.players[0]).toMatchObject({ character: 0, level: 1, screen: 1, row: "top", x: 0x0b, ingredients: 0, points: 0, status: 0, facingRight: true });
    expect(s.durationSeconds).toBe(1800);
    expect(popcount(s.goal.ingredients)).toBe(6);
    expect(s.goal.points).toBe(20);
    expect(s.round).toBe(1);
    expect(s.phase).toBe("turn");
    expect(game.takeEvents().map((e) => e.type)).toContain("turn");
  });

  it("4 joueurs : objectif réduit, personnages et niveaux conservés", () => {
    const setup: GameSetup = {
      players: [{ character: 4, level: 0 }, { character: 0 }, { character: 5, level: 2 }, { character: 2 }],
      options: { ...DEFAULT_OPTIONS, durationIndex: 3 },
    };
    const game = newGame(setup, new BorlandRandom(11));
    const s = game.state;
    expect(s.players.map((p) => [p.character, p.level])).toEqual([[4, 0], [0, 1], [5, 2], [2, 1]]);
    expect(s.durationSeconds).toBe(7200);
    expect(popcount(s.goal.ingredients)).toBe(6);
    expect(s.goal.points).toBe(20);
    expect(s.current).toBe(0);
  });

  it("refuse 0 ou 5 joueurs, personnage répété ou hors plage, niveau invalide", () => {
    const rng = () => new BorlandRandom(1);
    expect(() => newGame({ players: [] }, rng())).toThrow(RangeError);
    expect(() => newGame({ players: Array.from({ length: 5 }, (_, i) => ({ character: i })) }, rng())).toThrow(RangeError);
    expect(() => newGame({ players: [{ character: 1 }, { character: 1 }] }, rng())).toThrow(RangeError);
    expect(() => newGame({ players: [{ character: 6 }] }, rng())).toThrow(RangeError);
    expect(() => newGame({ players: [{ character: 1, level: 3 }] }, rng())).toThrow(RangeError);
  });

  it("déterministe : même graine, même objectif et même déroulé", () => {
    const a = duo(new BorlandRandom(42));
    const b = duo(new BorlandRandom(42));
    expect(a.state).toEqual(b.state);
    for (const g of [a, b]) {
      for (let i = 0; i < 50; i++) g.walk(1);
    }
    expect(a.state).toEqual(b.state);
  });
});

describe("tours et mini-jeux", () => {
  it("marche jusqu'à la porte 23 (écran 1 bas), mini-jeu à points, joueur suivant", () => {
    const game = duo();
    game.takeEvents();
    // Écran 1, rangée haute : pas de porte ; en marchant jusqu'au bord on passe en rangée basse.
    expect(game.press()).toEqual([]); // zone sans porte : le bouton ne fait rien
    let crossed = false;
    for (let i = 0; i < 100 && !crossed; i++) crossed = game.walk(1).some((e) => e.type === "moved");
    expect(crossed).toBe(true);
    expect(game.player).toMatchObject({ screen: 1, row: "bottom" });
    const events = game.press();
    const launch = events.find((e) => e.type === "minigame");
    expect(launch).toMatchObject({ type: "minigame", request: { scene: 23, player: 0, character: 0, level: 1, bonus: false } });
    expect(game.state.phase).toBe("minigame");
    expect(() => game.walk(1)).toThrow();
    expect(() => game.resolveMinigame({ kind: "ingredient", success: true })).toThrow(TypeError);

    const after = game.resolveMinigame({ kind: "points", points: 3 });
    expect(game.state.players[0].points).toBe(3);
    expect(after.find((e) => e.type === "gain")).toMatchObject({ player: 0, points: 3 });
    expect(game.state.current).toBe(1);
    expect(game.state.phase).toBe("turn");
    expect(after.find((e) => e.type === "turn")).toMatchObject({ player: 1, round: 1 });
  });

  it("alternance : au dernier joueur, nouveau tour de plateau", () => {
    const game = duo();
    for (let t = 0; t < 4; t++) {
      place(game, 1, "bottom", 0x0b);
      game.press();
      game.resolveMinigame({ kind: "points", points: 0 });
    }
    expect(game.state.current).toBe(0);
    expect(game.state.round).toBe(3);
  });

  it("points : plafonnés à 60 et jamais négatifs", () => {
    const game = solo();
    place(game, 1, "bottom", 0x0b);
    game.state.goal = { ingredients: 0, points: 99 };
    game.press();
    game.resolveMinigame({ kind: "points", points: 100 });
    expect(game.state.players[0].points).toBe(60);
  });

  it("ingrédient : la réussite donne celui de la scène, une seule fois", () => {
    const game = solo();
    game.state.goal = { ingredients: 0b0001, points: 99 }; // jamais atteint : on teste le gain seul
    place(game, 5, "top", 0x1f); // porte 27 (luge) → ingrédient 2
    game.press();
    expect(game.state.pending?.scene).toBe(27);
    game.resolveMinigame({ kind: "ingredient", success: true });
    expect(game.player).toMatchObject({ ingredients: 0b100, ingredientCount: 1 });
    game.press();
    const events = game.resolveMinigame({ kind: "ingredient", success: true });
    expect(game.player.ingredientCount).toBe(1);
    expect(events.find((e) => e.type === "gain")).toMatchObject({ ingredient: 2, already: true });
  });

  it("échec : rien n'est gagné", () => {
    const game = solo();
    game.state.goal = { ingredients: 0b0001, points: 99 };
    place(game, 5, "top", 0x1f);
    game.press();
    game.resolveMinigame({ kind: "ingredient", success: false });
    expect(game.player.ingredients).toBe(0);
  });

  it("S32 : réussite 1 chance sur niveau + 2, certaine avec l'indice de l'oiseau", () => {
    const game = duo();
    place(game, 7, "bottom", 0x1f); // porte 32
    game.press();
    expect(game.state.pending).toMatchObject({ scene: 32, successChance: 1 / 3 });
    game.resolveMinigame({ kind: "ingredient", success: false });
    // Joueur 1 (niveau 2) : 1/4 ; avec l'oiseau : certain.
    game.state.bonusTag = 32;
    place(game, 7, "bottom", 0x1f);
    game.press();
    expect(game.state.pending).toMatchObject({ scene: 32, bonus: true, successChance: 1 });
    expect(game.state.bonusTag).toBe(0);
    expect(game.rollChezGargamel()).toBe(true);
  });

  it("zones sans porte : le bouton est ignoré ; le puits fermé aussi", () => {
    const game = newGame({ players: [{ character: 0 }] }, scripted(6, 99));
    game.takeEvents();
    expect(game.state.turn.wellOpen).toBe(false);
    place(game, 4, "top", 0x120); // porte du puits, fermé ce tour
    expect(game.press()).toEqual([]);
    expect(game.state.phase).toBe("turn");
    place(game, 4, "bottom", 0xb0); // piège (par la marche) : le bouton ne fait rien
    expect(game.press()).toEqual([]);
  });
});

describe("événements du plateau", () => {
  it("piège de Gargamel : marche → téléportation, le tour continue", () => {
    const game = duo();
    place(game, 4, "bottom", 0x92);
    const events = game.walk(1);
    expect(events.map((e) => e.type)).toEqual(["hazard", "moved"]);
    expect(game.player).toMatchObject({ screen: 9, row: "top", x: 0x10 });
    expect(game.state.current).toBe(0);
    expect(game.state.phase).toBe("turn");
  });

  it("un saut franchit un piège sans le déclencher", () => {
    const game = duo();
    place(game, 4, "bottom", 0x8c);
    expect(game.jump(1)).toEqual([]);
    expect(game.player).toMatchObject({ screen: 4, row: "bottom", x: 0x8c + 0x44 });
    // En revanche, atterrir dans la zone la déclenche.
    place(game, 4, "bottom", 0x60);
    expect(game.jump(1).map((e) => e.type)).toContain("hazard");
  });

  it("prison : état 2, le tour s'arrête, un tour passé, puis libération", () => {
    const game = duo();
    place(game, 3, "bottom", 0xa0);
    const events = game.press();
    expect(events.find((e) => e.type === "hazard")).toMatchObject({ kind: "jail", scene: 20 });
    const jailed = game.state.players[0];
    expect(jailed.status).toBe(2);
    expect(jailed.x).toBe(0xac);
    expect(game.state.current).toBe(1); // le tour du joueur 0 est fini
    // Joueur 1 joue, puis le tour du joueur 0 est passé (états 2 → 1).
    place(game, 1, "bottom", 0x0b);
    game.press();
    const out = game.resolveMinigame({ kind: "points", points: 1 });
    expect(out.find((e) => e.type === "skip")).toMatchObject({ player: 0, reason: "jail" });
    expect(jailed.status).toBe(1);
    expect(game.state.current).toBe(1);
    // Joueur 1 rejoue, puis le joueur 0 est libéré (1 → 3 → 0) et joue normalement.
    place(game, 1, "bottom", 0x0b);
    game.press();
    const next = game.resolveMinigame({ kind: "points", points: 0 });
    expect(next.find((e) => e.type === "release")).toMatchObject({ player: 0, from: "jail" });
    expect(next.find((e) => e.type === "turn")).toMatchObject({ player: 0 });
    expect(jailed.status).toBe(0);
  });

  it("prison par attente : 16 s dans la zone du piège ; seul, les tours passent d'eux-mêmes", () => {
    const game = solo();
    place(game, 3, "bottom", 0xa0);
    expect(game.tick(15).filter((e) => e.type === "hazard")).toEqual([]);
    const events = game.tick(1.5);
    expect(events.map((e) => e.type)).toEqual(["hazard", "skip", "release", "turn"]);
    expect(game.player.status).toBe(0);
  });

  it("Turlusiphon : bouton dans la zone droite, état 4, un tour passé", () => {
    const game = duo();
    place(game, 3, "bottom", 0x120);
    const events = game.press();
    expect(events.find((e) => e.type === "hazard")).toMatchObject({ kind: "turlusiphon", scene: 21 });
    expect(game.state.players[0].status).toBe(4);
    expect(game.state.current).toBe(1);
  });

  it("Turlusiphon : relâché au tour suivant (6 → 5), le pion recule de 20 px", () => {
    const game = duo();
    place(game, 3, "bottom", 0x120);
    game.press();
    place(game, 1, "bottom", 0x0b);
    game.press();
    game.resolveMinigame({ kind: "points", points: 0 }); // joueur 0 passe (4 → 6)
    expect(game.state.players[0].status).toBe(6);
    place(game, 1, "bottom", 0x0b);
    game.press();
    const events = game.resolveMinigame({ kind: "points", points: 0 }); // 6 → 5 → libéré
    expect(events.find((e) => e.type === "release")).toMatchObject({ from: "turlusiphon" });
    expect(game.state.players[0]).toMatchObject({ status: 0, x: 0x109 - 0x14 });
  });

  /** Entre dans la plage d'un événement compté, puis en ressort (pas de 4 px), comme un joueur qui franchit le lac ou le pont. */
  function crossRange(game: Game, hazard: Hazard) {
    const [min, max] = hazard.counted!;
    place(game, hazard.screen, hazard.row, min - 4);
    for (let i = 0; i < 100 && game.state.phase === "turn" && game.player.screen === hazard.screen && game.player.x <= max + 4; i++) game.walk(1);
  }

  it("lac glacé : la cinquième entrée fait tomber sur l'écran 5 à 9", () => {
    const game = solo();
    const ice = HAZARDS.find((h) => h.kind === "ice")!;
    for (let entry = 1; entry <= 4; entry++) {
      crossRange(game, ice);
      expect(game.state.iceCrossings).toBe(entry);
      expect(game.player.screen).toBe(4);
    }
    crossRange(game, ice);
    expect(game.player.screen).toBeGreaterThanOrEqual(5);
    expect(game.state.iceCrossings).toBeLessThan(4); // remis à 0..3
  });

  it("pont branlant : la cinquième entrée fait tomber sur l'écran 8 ou 9", () => {
    const game = solo();
    const bridge = HAZARDS.find((h) => h.kind === "bridge")!;
    for (let entry = 1; entry <= 5; entry++) crossRange(game, bridge);
    expect([8, 9]).toContain(game.player.screen);
  });

  it("fusée de l'écran 6 : bouton sur la zone, envoie sur l'écran 1 à 5", () => {
    const game = solo();
    place(game, 6, "bottom", 0xb0);
    game.press();
    expect(game.player.screen).toBeLessThanOrEqual(5);
    expect(game.state.phase).toBe("turn");
  });

  it("puits S14 (écran 2) : envoie sur un autre écran que le 2, le tour continue", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const game = solo(new BorlandRandom(seed));
      place(game, 2, "top", 0x120);
      game.press();
      expect(game.player.screen).not.toBe(2);
      expect(game.state.phase).toBe("turn");
    }
  });

  it("puits aux vœux S13 : ouvert, ingrédient choisi ou voyage vers un lieu de la carte", () => {
    // Seul : le puits est ouvert si le tirage (0..99) est < 33 ; mode ingrédient : below(2) = 1.
    const game = newGame({ players: [{ character: 0 }] }, scripted(6, 0, 1));
    game.takeEvents();
    expect(game.state.turn.wellOpen).toBe(true);
    place(game, 4, "top", 0x120);
    const events = game.press();
    expect(events.find((e) => e.type === "hazard")).toMatchObject({ kind: "wellDoor", scene: 13 });
    expect(game.state.pending).toMatchObject({ scene: 14, wellMode: "ingredient" });
    game.resolveMinigame({ kind: "well", ingredient: 5 });
    expect(game.state.players[0].ingredients).toBe(1 << 5);

    // Mode voyage : le lieu 18 de la carte (mine, scène 36) téléporte devant sa porte.
    const g2 = newGame({ players: [{ character: 0 }] }, scripted(6, 0, 0));
    g2.takeEvents();
    place(g2, 4, "top", 0x120);
    g2.press();
    expect(g2.state.pending?.wellMode).toBe("travel");
    g2.resolveMinigame({ kind: "well", destination: 18 });
    expect(g2.state.players[0]).toMatchObject({ screen: 9, row: "bottom", x: 0xc9, facingRight: true });
  });

  it("puits : un ingrédient déjà possédé n'est pas redonné ; annuler le voyage ne bouge pas", () => {
    const game = newGame({ players: [{ character: 0 }] }, scripted(6, 0, 1));
    game.takeEvents();
    game.player.ingredients = 1 << 5;
    game.player.ingredientCount = 1;
    place(game, 4, "top", 0x120);
    game.press();
    game.resolveMinigame({ kind: "well", ingredient: 5 });
    expect(game.state.players[0].ingredientCount).toBe(1);
    const g2 = newGame({ players: [{ character: 0 }] }, scripted(6, 0, 0));
    g2.takeEvents();
    place(g2, 4, "top", 0x120);
    g2.press();
    g2.resolveMinigame({ kind: "well", destination: null });
    expect(g2.state.players[0]).toMatchObject({ screen: 4, row: "top" });
  });

  it("puits fermé : on ne peut pas y entrer ; tous les ingrédients : toujours le voyage", () => {
    const closed = newGame({ players: [{ character: 0 }] }, scripted(6, 99));
    closed.takeEvents();
    place(closed, 6, "top", 0x30);
    expect(closed.press()).toEqual([]);
    const full = newGame({ players: [{ character: 0 }] }, scripted(6, 0, 1));
    full.takeEvents();
    full.player.ingredients = 0xff;
    full.player.ingredientCount = 8;
    place(full, 6, "top", 0x30);
    full.press();
    expect(full.state.pending?.wellMode).toBe("travel");
  });

  it("puits à plusieurs : ouvert au joueur en retard de plus de 5 points, sinon 15 % de chances", () => {
    // Tour du joueur 1 (le joueur 0 a 10 points) : 67 % passent, puis « en retard » → ouvert.
    const rng = new ScriptedRandom([0, 0, 0, 0, 0, 50]);
    const game = newGame({ players: [{ character: 0 }, { character: 1 }] }, rng);
    game.takeEvents();
    game.state.players[0].points = 10;
    place(game, 1, "bottom", 0x0b);
    game.press();
    const events = game.resolveMinigame({ kind: "points", points: 0 });
    expect(events.find((e) => e.type === "turn")).toMatchObject({ player: 1, wellOpen: true });
    // Joueur 0 de nouveau, pas en retard : 15 % (tirage 50 refuse puis 14 accepte).
    place(game, 1, "bottom", 0x0b);
    rng.queue.push(50, 14);
    game.press();
    const again = game.resolveMinigame({ kind: "points", points: 0 });
    expect(again.find((e) => e.type === "turn")).toMatchObject({ player: 0, wellOpen: true });
  });
});

describe("S38 (Schtroumpf à lunettes), S39 (oiseau), S41 (magicien)", () => {
  it("S38 seul sans rien : promenade vers une porte, rien n'est perdu", () => {
    const rng = new ScriptedRandom([]);
    const game = newGame({ players: [{ character: 0 }] }, rng);
    game.takeEvents();
    game.state.goal = { ingredients: 0b1, points: 99 };
    place(game, 5, "top", 0xe0); // porte 38
    game.press();
    expect(game.state.pending?.scene).toBe(38);
    rng.queue.push(0); // vidéo 9 + 0
    const events = game.resolveMinigame({ kind: "none" });
    expect(events.find((e) => e.type === "bespectacled")).toMatchObject({ result: "nothing", video: 9 });
    expect(game.state.players[0]).toMatchObject({ screen: 7, row: "top", x: 0x1f });
  });

  it("S38 seul avec un ingrédient : pile → l'ingrédient est perdu (face → promenade)", () => {
    const make = () => {
      const rng = new ScriptedRandom([]);
      const game = newGame({ players: [{ character: 0 }] }, rng);
      game.takeEvents();
      game.state.goal = { ingredients: 0b1, points: 99 };
      game.player.ingredients = 0b1000;
      game.player.ingredientCount = 1;
      place(game, 5, "top", 0xe0);
      game.press();
      return { game, rng };
    };
    const tails = make();
    tails.rng.queue.push(0, 3); // pile (0), puis l'ingrédient 3 est tiré
    const lost = tails.game.resolveMinigame({ kind: "none" });
    expect(lost.find((e) => e.type === "bespectacled")).toMatchObject({ result: "ingredientLost", ingredient: 3 });
    expect(tails.game.state.players[0]).toMatchObject({ ingredients: 0, ingredientCount: 0 });

    const heads = make();
    heads.rng.queue.push(1, 5);
    const kept = heads.game.resolveMinigame({ kind: "none" });
    expect(kept.find((e) => e.type === "bespectacled")).toMatchObject({ result: "nothing", video: 14 });
    expect(heads.game.state.players[0].ingredientCount).toBe(1);
  });

  it("S38 seul avec seulement des points : pile → un point de moins", () => {
    const rng = new ScriptedRandom([]);
    const game = newGame({ players: [{ character: 0 }] }, rng);
    game.takeEvents();
    game.state.goal = { ingredients: 0b1, points: 99 };
    game.player.points = 4;
    place(game, 5, "top", 0xe0);
    game.press();
    rng.queue.push(0);
    game.resolveMinigame({ kind: "none" });
    expect(game.state.players[0].points).toBe(3);
  });

  it("S38 à plusieurs : les points vont du plus riche au plus pauvre", () => {
    const rng = new ScriptedRandom([]);
    const game = newGame({ players: [{ character: 0 }, { character: 1 }, { character: 2 }] }, rng);
    game.takeEvents();
    game.state.goal = { ingredients: 0b1, points: 99 };
    game.state.players[0].points = 2; // joueur courant
    game.state.players[1].points = 9; // le plus riche
    game.state.players[2].points = 0; // le plus pauvre
    place(game, 5, "top", 0xe0);
    game.press();
    rng.queue.push(0); // pile : Robin des Bois ; plus de points que d'ingrédients → transfert de points
    const events = game.resolveMinigame({ kind: "none" });
    expect(events.find((e) => e.type === "bespectacled")).toMatchObject({ result: "pointsMoved", from: 1, to: 2 });
    expect(game.state.players.map((p) => p.points)).toEqual([2, 8, 1]);
  });

  it("S38 à plusieurs : les ingrédients vont du mieux fourni au moins fourni", () => {
    const rng = new ScriptedRandom([]);
    const game = newGame({ players: [{ character: 0 }, { character: 1 }] }, rng);
    game.takeEvents();
    game.state.goal = { ingredients: 0b1, points: 99 };
    game.state.players[1].ingredients = 0b110;
    game.state.players[1].ingredientCount = 2;
    place(game, 5, "top", 0xe0);
    game.press();
    rng.queue.push(0);
    const events = game.resolveMinigame({ kind: "none" });
    expect(events.find((e) => e.type === "bespectacled")).toMatchObject({ result: "ingredientMoved", from: 1, to: 0, ingredient: 1 });
    expect(game.state.players.map((p) => p.ingredients)).toEqual([0b010, 0b100]);
    expect(game.state.players.map((p) => p.ingredientCount)).toEqual([1, 1]);
  });

  it("S39 : l'oiseau désigne une scène, la prochaine partie de cette scène reçoit le bonus (une seule fois)", () => {
    const rng = new ScriptedRandom([]);
    const game = newGame({ players: [{ character: 0 }] }, rng);
    game.takeEvents();
    game.state.goal = { ingredients: 0b1, points: 99 };
    place(game, 3, "bottom", 0x10); // porte 39
    game.press();
    expect(game.state.pending?.scene).toBe(39);
    rng.queue.push(2); // BIRD_HINT_SCENES[2] = 31 (les tortues)
    const events = game.resolveMinigame({ kind: "none" });
    expect(events.find((e) => e.type === "bird")).toEqual({ type: "bird", scene: 31 });
    expect(game.state.bonusTag).toBe(31);
    place(game, 7, "bottom", 0x120); // porte 31
    game.press();
    expect(game.state.pending).toMatchObject({ scene: 31, bonus: true });
    expect(game.state.bonusTag).toBe(0);
    game.resolveMinigame({ kind: "ingredient", success: false });
    place(game, 7, "bottom", 0x120);
    game.press();
    expect(game.state.pending?.bonus).toBe(false);
  });

  it("S41 : refus sans 3 points ; échange 3 points contre un ingrédient", () => {
    const game = solo();
    game.state.goal = { ingredients: 0b1, points: 99 };
    place(game, 8, "bottom", 0xa0); // porte 41
    game.press();
    expect(game.state.pending?.scene).toBe(41);
    expect(game.canTrade(0)).toBe(false);
    game.resolveMinigame({ kind: "magician", choice: 2 });
    expect(game.player.ingredients).toBe(0);

    game.player.points = 5;
    expect(game.canTrade(0)).toBe(true);
    place(game, 8, "bottom", 0xa0);
    game.press();
    game.resolveMinigame({ kind: "magician", choice: 2 });
    expect(game.player).toMatchObject({ ingredients: 1 << 2, ingredientCount: 1, points: 2 });
  });

  it("S41 : fermé quand on a déjà les 8 ingrédients", () => {
    const game = solo();
    game.player.ingredients = 0xff;
    game.player.ingredientCount = 8;
    game.state.goal = { ingredients: 0b1, points: 99 };
    place(game, 8, "bottom", 0xa0);
    expect(game.press()).toEqual([]);
  });
});

describe("fin de partie", () => {
  it("victoire : objectif atteint à la fin du tour (ingrédients requis et points)", () => {
    const game = duo();
    game.state.goal = { ingredients: 0b100, points: 3 };
    // Joueur 0 : les points seuls ne suffisent pas.
    place(game, 1, "bottom", 0x0b);
    game.press();
    game.resolveMinigame({ kind: "points", points: 3 });
    expect(game.isOver()).toBe(false);
    // Joueur 1 passe son tour, puis le joueur 0 gagne l'ingrédient 2 (luge, porte 27).
    place(game, 1, "bottom", 0x0b);
    game.press();
    game.resolveMinigame({ kind: "points", points: 0 });
    place(game, 5, "top", 0x1f);
    game.press();
    const events = game.resolveMinigame({ kind: "ingredient", success: true });
    expect(game.isOver()).toBe(true);
    expect(game.winner()).toBe(0);
    expect(events.at(-1)).toEqual({ type: "over", result: { kind: "victory", winner: 0 } });
    expect(() => game.press()).toThrow();
  });

  it("victoire du joueur dont c'est le tour : seul celui-ci est examiné", () => {
    const game = duo();
    game.state.goal = { ingredients: 0, points: 1 };
    game.state.players[1].points = 5; // a déjà l'objectif, mais ce n'est pas son tour
    place(game, 1, "bottom", 0x0b);
    game.press();
    game.resolveMinigame({ kind: "points", points: 0 });
    expect(game.isOver()).toBe(false);
    place(game, 1, "bottom", 0x0b);
    game.press();
    game.resolveMinigame({ kind: "points", points: 0 });
    expect(game.winner()).toBe(1);
    expect(game.standings()[0].player).toBe(1);
  });

  it("temps écoulé : le tour en cours se termine et la partie est perdue (vidéo s42a0NN)", () => {
    const game = newGame({ players: [{ character: 0 }], options: { ...DEFAULT_OPTIONS, messageIndex: 4 } }, scripted(6, 99, 2));
    game.takeEvents();
    game.tick(1799);
    expect(game.isOver()).toBe(false);
    const events = game.tick(2);
    expect(game.isOver()).toBe(true);
    expect(game.winner()).toBeNull();
    // 0x29 + message 4 + 9 × variante (below(4) = 2) = 41 + 4 + 18 = 63.
    expect(events.at(-1)).toEqual({ type: "over", result: { kind: "timeout", video: 63 } });
  });

  it("le mini-jeu en cours à la fin du temps est joué, puis la partie s'arrête", () => {
    const game = solo();
    game.state.goal = { ingredients: 0, points: 99 };
    place(game, 1, "bottom", 0x0b);
    game.press();
    game.tick(2000);
    expect(game.isOver()).toBe(false); // le mini-jeu continue
    game.resolveMinigame({ kind: "points", points: 3 });
    expect(game.state.players[0].points).toBe(3);
    expect(game.state.result?.kind).toBe("timeout");
  });

  it("victoire sur le fil : l'objectif atteint au dernier tour l'emporte sur le temps écoulé", () => {
    const game = solo();
    game.state.goal = { ingredients: 0, points: 3 };
    place(game, 1, "bottom", 0x0b);
    game.press();
    game.tick(1900);
    game.resolveMinigame({ kind: "points", points: 3 });
    expect(game.winner()).toBe(0);
  });

  it("avertissements du Grand Schtroumpf à 10 puis 5 minutes de la fin", () => {
    const game = duo();
    const announces = (events: ReturnType<Game["tick"]>) => events.filter((e): e is Extract<typeof e, { type: "announce" }> => e.type === "announce").map((e) => e.video);
    // Chaque `tick` long termine le tour courant (action automatique à 36 s) et en commence un autre.
    expect(announces(game.tick(1000))).toEqual([]); // il reste 800 s
    const ten = announces(game.tick(250)); // il reste 550 s (< 601)
    expect(ten).toHaveLength(1);
    expect([31, 32, 33]).toContain(ten[0]);
    const five = announces(game.tick(260)); // il reste 290 s (< 301)
    expect(five).toHaveLength(1);
    expect([34, 35]).toContain(five[0]);
    expect(announces(game.tick(40))).toEqual([]); // chaque avertissement n'est donné qu'une fois
  });

  it("abandon : un joueur compacte la liste ; plus personne termine sans victoire", () => {
    const game = newGame({ players: [{ character: 0 }, { character: 1 }, { character: 2 }] }, new BorlandRandom(5));
    game.abandon(1);
    expect(game.state.players.map((p) => p.character)).toEqual([0, 2]);
    expect(game.state.current).toBe(0);
    game.abandon(0);
    expect(game.state.players.map((p) => p.character)).toEqual([2]);
    game.abandon("all");
    expect(game.state.result).toEqual({ kind: "abandoned" });
    expect(game.winner()).toBeNull();
  });
});

describe("temps du tour", () => {
  it("multijoueur : action automatique à 36 s (entre dans la porte sous le pion)", () => {
    const game = duo();
    place(game, 1, "bottom", 0x0b);
    game.tick(35);
    expect(game.state.phase).toBe("turn");
    const events = game.tick(1.5);
    expect(events.find((e) => e.type === "minigame")).toMatchObject({ request: { scene: 23 } });
  });

  it("seul : pas d'action automatique ; indices à 12 s puis 24 s (annulés si le joueur bouge)", () => {
    const game = solo();
    expect(game.tick(12).filter((e) => e.type === "hint")).toEqual([{ type: "hint", player: 0, n: 1 }]);
    expect(game.tick(12).filter((e) => e.type === "hint")).toEqual([{ type: "hint", player: 0, n: 2 }]);
    expect(game.state.turn.elapsed).toBe(0); // le chrono du tour est relancé en solo
    expect(game.tick(100).filter((e) => e.type === "minigame")).toEqual([]);

    const active = solo();
    active.walk(1);
    expect(active.tick(30).filter((e) => e.type === "hint")).toEqual([]);
  });

  it("pause : le chrono du tour est gelé, pas celui de la partie", () => {
    const game = duo();
    game.setPaused(true);
    game.tick(100);
    expect(game.state.turn.elapsed).toBe(0);
    expect(game.state.elapsed).toBe(100);
  });
});

describe("état sérialisable", () => {
  it("aller-retour JSON puis reprise", () => {
    const game = duo(new BorlandRandom(9));
    place(game, 1, "bottom", 0x0b);
    game.press();
    const saved = JSON.parse(JSON.stringify(game.state));
    const copy = Game.restore(saved, new BorlandRandom(9));
    expect(copy.state).toEqual(game.state);
    game.resolveMinigame({ kind: "points", points: 2 });
    copy.resolveMinigame({ kind: "points", points: 2 });
    expect(copy.state.players).toEqual(game.state.players);
    expect(copy.state.current).toBe(1);
  });
});

describe("parties jouées au hasard (invariants)", () => {
  /** Joue une partie complète avec une politique aléatoire ; vérifie les invariants à chaque action. */
  function play(seed: number, nPlayers: number, durationIndex: number): Game {
    const policy = new BorlandRandom(seed * 31 + 5);
    const game = newGame(
      { players: Array.from({ length: nPlayers }, (_, i) => ({ character: i, level: i % 3 })), options: { ...DEFAULT_OPTIONS, durationIndex } },
      new BorlandRandom(seed),
    );
    for (let step = 0; step < 200000 && !game.isOver(); step++) {
      const s = game.state;
      if (s.phase === "minigame") {
        const scene = s.pending!.scene;
        const info = MINIGAMES.find((m) => m.scene === scene)!;
        switch (info.kind) {
          case "ingredient":
            game.resolveMinigame({ kind: "ingredient", success: policy.below(2) === 0 });
            break;
          case "points":
            game.resolveMinigame({ kind: "points", points: policy.below(4) });
            break;
          case "well":
            game.resolveMinigame(s.pending!.wellMode === "ingredient" ? { kind: "well", ingredient: policy.below(8) } : { kind: "well", destination: 2 + policy.below(17) });
            break;
          case "trade":
            game.resolveMinigame({ kind: "magician", choice: policy.below(10) === 9 ? null : policy.below(9) });
            break;
          default:
            game.resolveMinigame({ kind: "none" });
        }
        game.tick(20 + policy.below(60));
      } else {
        const roll = policy.below(10);
        if (roll < 6) game.walk(policy.below(2) === 0 ? -1 : 1, policy.below(4) === 0);
        else if (roll < 7) game.jump(policy.below(2) === 0 ? -1 : 1);
        else if (roll < 9) game.press();
        else game.tick(policy.below(5));
      }
      for (const p of game.state.players) {
        expect(p.points).toBeGreaterThanOrEqual(0);
        expect(p.points).toBeLessThanOrEqual(60);
        expect(p.ingredientCount).toBe(popcount(p.ingredients));
        expect(p.screen).toBeGreaterThanOrEqual(1);
        expect(p.screen).toBeLessThanOrEqual(9);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(0x140);
        expect(p.status).toBeGreaterThanOrEqual(0);
        expect(p.status).toBeLessThanOrEqual(6);
      }
    }
    return game;
  }

  it.each([1, 2, 3, 4].flatMap((n) => [1, 2, 3].map((seed) => [n, seed] as const)))("%i joueur(s), graine %i : la partie se termine proprement", (n, seed) => {
    const game = play(seed, n, 0);
    expect(game.isOver()).toBe(true);
    const r = game.state.result!;
    expect(["victory", "timeout"]).toContain(r.kind);
    if (r.kind === "victory") expect(game.goalReached(r.winner)).toBe(true);
    else expect(game.state.elapsed).toBeGreaterThanOrEqual(game.state.durationSeconds);
  });
});
