import { describe, expect, it, vi } from "vitest";
import { Engine } from "../../src/games/teleportaschtroumpf/engine/engine";
import { BorlandRandom } from "../../src/games/teleportaschtroumpf/engine/rng";
import type { Scene } from "../../src/games/teleportaschtroumpf/engine/scene";
import { Game, newGame } from "../../src/games/teleportaschtroumpf/game/rules";
import { createGrandSchtroumpfScene } from "../../src/games/teleportaschtroumpf/scenes/grand-schtroumpf";
import { Commentary, elapsedPercent, isCommentVideo } from "../../src/games/teleportaschtroumpf/scenes/grand-schtroumpf/commentary";
import { ingredientsScript } from "../../src/games/teleportaschtroumpf/scenes/grand-schtroumpf/ingredients";
import { forceMinigameStubs } from "../../src/games/teleportaschtroumpf/scenes/minigames";
import { TestHost } from "./engine-test-host";
import { Session, advance } from "./game-helpers";
import { hasOriginalFiles } from "./helpers";

// Ces tests traversent un mini-jeu sans le jouer : la souche commune les garde indépendants des vrais mini-jeux.
forceMinigameStubs();

/** Hasard scripté : `below(n)` rend les valeurs dans l'ordre et note les `n` demandés. */
function scripted(...values: number[]): { rng: BorlandRandom; asked: number[] } {
  const asked: number[] = [];
  const queue = [...values];
  const rng = {
    below(n: number): number {
      asked.push(n);
      const value = queue.shift();
      if (value === undefined) throw new Error(`tirage imprévu below(${n})`);
      return value;
    },
    next(): number {
      throw new Error("next() imprévu");
    },
  };
  return { rng: rng as unknown as BorlandRandom, asked };
}

/** Partie à `count` joueurs (personnages 0, 1…), durée 30 min, objectif tiré avec la graine 7. */
function gameOf(count: number): Game {
  return newGame({ players: Array.from({ length: count }, (_, i) => ({ character: i })) }, new BorlandRandom(7));
}

describe("S19 : déroulé de l'annonce des ingrédients (1e52:0324)", () => {
  it("objectif de la graine 7, un joueur : voix d'ouverture, chaque ingrédient, « points », nombre de points", () => {
    const game = gameOf(1);
    // Ingrédients 0, 1, 2, 3, 4 et 7, 20 points (rang × `DS:1A20`, le dernier avec `DS:1A30`).
    expect(game.state.goal).toEqual({ ingredients: 0b10011111, points: 20 });
    const script = ingredientsScript(game.state.goal.ingredients, game.state.goal.points);
    expect(script.map((b) => b.voice)).toEqual(
      ["s19v001t.voc", "s19v008t.voc", "s19v007t.voc", "s19v002t.voc", "s19v003t.voc", "s19v005t.voc", "s19v010t.voc", "s19v018t.voc", "s19v020t.voc"],
    );
    expect(script.filter((b) => b.icon).map((b) => [b.icon!.ingredient, b.icon!.slot])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4], [7, 5]]);
    expect(script.map((b) => b.pauseSeconds)).toEqual([1, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 0.5, 2]);
    expect(script.at(-1)!.points).toBe(true);
  });

  it("trois ingrédients : les deux premiers « énumérés », le dernier avec la voix de fin de liste", () => {
    const script = ingredientsScript(0b00100101, 50);
    expect(script.map((b) => b.voice)).toEqual(["s19v001t.voc", "s19v008t.voc", "s19v002t.voc", "s19v015t.voc", "s19v018t.voc", "s19v023t.voc"]);
  });
});

/** Lance `scene` seule sur un moteur de test (sortie audio coupée : les voix durent le temps de leur chargement). */
async function launch(scene: Scene) {
  const host = new TestHost();
  host.audio.enabled = false;
  const engine = new Engine(host, { seed: 7 });
  await engine.start(scene);
  const loaded = (pattern: RegExp) => host.loaded.filter((f) => pattern.test(f)).map((f) => f.split("/").at(-1)!.toUpperCase());
  return { host, engine, loaded };
}

describe.skipIf(!hasOriginalFiles)("scènes du Grand Schtroumpf", () => {
  it("S19 dit les voix de l'objectif tiré, dans l'ordre, puis rend la main et dessine icônes et points", async () => {
    const game = gameOf(1);
    let done = false;
    const { host, engine, loaded } = await launch(createGrandSchtroumpfScene({ kind: "ingredients", game }, () => (done = true)));
    await advance(engine, host, 500);
    expect(done).toBe(false);
    await advance(engine, host, 9000);
    expect(done).toBe(true);
    expect(loaded(/S19V/i)).toEqual(["S19V001T.VOC", "S19V008T.VOC", "S19V007T.VOC", "S19V002T.VOC", "S19V003T.VOC", "S19V005T.VOC", "S19V010T.VOC", "S19V018T.VOC", "S19V020T.VOC"]);
    // Les six icônes (x = 0x50 + 0x12 × rang, au-dessus de la ligne 0xB6) et le texte sont à l'écran.
    const { surface } = host.lastPresentation;
    const inked = (x0: number, x1: number, y0: number, y1: number) => {
      let n = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) if (surface[y * 320 + x] !== 0) n++;
      return n;
    };
    for (let slot = 0; slot < 6; slot++) expect(inked(0x50 + slot * 0x12, 0x50 + slot * 0x12 + 0x10, 0xa0, 0xb6)).toBeGreaterThan(0);
    expect(inked(0x50 + 6 * 0x12, 0x50 + 6 * 0x12 + 0x20, 0xa7, 0xb0)).toBeGreaterThan(0);
  }, 60_000);

  it("S19 : un clic coupe la voix en cours mais pas la pause qui suit", async () => {
    const game = gameOf(1);
    let done = false;
    const { host, engine } = await launch(createGrandSchtroumpfScene({ kind: "ingredients", game }, () => (done = true)));
    host.audio.enabled = true;
    await advance(engine, host, 300);
    const stopsBefore = host.audio.stops;
    host.input.keyDown("Space");
    await advance(engine, host, 200);
    host.input.keyUp("Space");
    expect(host.audio.stops).toBeGreaterThan(stopsBefore);
    expect(done).toBe(false);
  }, 60_000);

  it("avertissement de temps : clip d'ouverture, s42a033, s42g, clip de fermeture ; seule la vidéo est passable", async () => {
    let done = false;
    const { host, engine, loaded } = await launch(createGrandSchtroumpfScene({ kind: "timeWarning", video: 33 }, () => (done = true)));
    await advance(engine, host, 300);
    // Les clips d'habillage durent plus de 2 s et ne se passent pas (drapeaux `0x1040` de `154c:097b`).
    host.input.keyDown("Escape");
    await advance(engine, host, 200);
    host.input.keyUp("Escape");
    await advance(engine, host, 800);
    expect(loaded(/S42/i)).toHaveLength(1);
    expect(loaded(/S42/i)[0]).toMatch(/^S42[A-E]\.MUX$/);
    while (loaded(/S42A033/i).length === 0) await advance(engine, host, 200);
    await advance(engine, host, 1000);
    host.input.keyDown("Escape");
    await advance(engine, host, 200);
    host.input.keyUp("Escape");
    await advance(engine, host, 500);
    expect(loaded(/S42G/i)).toEqual(["S42G.MUX"]);
    while (!done) await advance(engine, host, 500);
    const mux = loaded(/S42/i);
    expect(mux).toHaveLength(4);
    expect(mux[1]).toBe("S42A033.MUX");
    expect(mux[2]).toBe("S42G.MUX");
    expect(mux[3]).toMatch(/^S42[H-L]\.MUX$/);
  }, 120_000);

  it("victoire : s11a.mux seule, passable, puis rend la main", async () => {
    let done = false;
    const { host, engine, loaded } = await launch(createGrandSchtroumpfScene({ kind: "victory", winner: 0 }, () => (done = true)));
    await advance(engine, host, 1500);
    expect(loaded(/S11A/i)).toEqual(["S11A.MUX"]);
    expect(loaded(/S42/i)).toEqual([]);
    expect(done).toBe(false);
    host.input.keyDown("Escape");
    await advance(engine, host, 200);
    host.input.keyUp("Escape");
    await advance(engine, host, 1500);
    expect(done).toBe(true);
  }, 60_000);

  it("réplique parlée : voix s42v du code, rend la main à la fin", async () => {
    let done = false;
    const { host, engine, loaded } = await launch(createGrandSchtroumpfScene({ kind: "comment", code: 0x82 }, () => (done = true)));
    await advance(engine, host, 1000);
    expect(loaded(/S42V/i)).toEqual(["S42V130T.VOC"]);
    expect(done).toBe(true);
  }, 60_000);

  it("réplique en vidéo (prisonnier) : habillée comme 154c:097b", async () => {
    let done = false;
    const { host, engine, loaded } = await launch(createGrandSchtroumpfScene({ kind: "comment", code: 173 }, () => (done = true)));
    while (!done) await advance(engine, host, 1000);
    const mux = loaded(/S42/i);
    expect(mux[0]).toMatch(/^S42[A-E]\.MUX$/);
    expect(mux.slice(1, 3)).toEqual(["S42A173.MUX", "S42G.MUX"]);
    expect(mux[3]).toMatch(/^S42[H-L]\.MUX$/);
  }, 120_000);

  it("avancement en avance (211..215) : un clip s42m..r avant et après la vidéo", async () => {
    let done = false;
    const { host, engine, loaded } = await launch(createGrandSchtroumpfScene({ kind: "progress", code: 213 }, () => (done = true)));
    while (!done) await advance(engine, host, 1000);
    const mux = loaded(/S42/i);
    expect(mux).toHaveLength(3);
    expect(mux[0]).toMatch(/^S42[M-R]\.MUX$/);
    expect(mux[1]).toBe("S42A213.MUX");
    expect(mux[2]).toMatch(/^S42[M-R]\.MUX$/);
  }, 120_000);
});

describe("Commentary : 26ee:0f17 (avancement)", () => {
  it("cinq fois sur six seulement, selon l'avance ou le retard sur le temps", () => {
    const game = gameOf(2);
    game.state.elapsed = 360; // 20 % du temps, personne n'a rien
    // Tirage 2 sur 6 : rien.
    expect(new Commentary().progressComment(game, scripted(2).rng)).toBe(0);
    // En retard (0 < 20 × 10 / 15) : 0xc9 + tirage.
    const late = scripted(0, 1);
    expect(new Commentary().progressComment(game, late.rng)).toBe(202);
    expect(late.asked).toEqual([6, 4]);
    // En avance : un joueur a tout.
    const ahead = gameOf(2);
    ahead.state.elapsed = 360;
    Object.assign(ahead.state.players[0], { ingredients: ahead.state.goal.ingredients, points: ahead.state.goal.points });
    const lead = scripted(0, 3);
    expect(new Commentary().progressComment(ahead, lead.rng)).toBe(214);
    expect(lead.asked).toEqual([6, 5]);
  });

  it("chaque code n'est dit qu'une fois", () => {
    const game = gameOf(2);
    game.state.elapsed = 360;
    const commentary = new Commentary();
    expect(commentary.progressComment(game, scripted(0, 1).rng)).toBe(202);
    expect(commentary.progressComment(game, scripted(0, 1).rng)).toBe(0);
    expect(commentary.progressComment(game, scripted(0, 2).rng)).toBe(203);
  });

  it("au plus tous les 5 tours, à partir du tour 6", () => {
    const game = gameOf(2);
    game.state.elapsed = 360;
    const commentary = new Commentary();
    const at = (round: number, ...values: number[]) => {
      game.state.round = round;
      return commentary.beforeTurn(game, scripted(...values).rng);
    };
    expect(at(5, 0, 0)).toBe(0);
    expect(at(6, 0, 0)).toBe(201);
    expect(at(10, 0, 1)).toBe(0);
    expect(at(11, 0, 1)).toBe(202);
  });

  it("la part du temps ne déborde plus au-delà de 656 s (défaut 16 bits de l'original corrigé)", () => {
    const game = gameOf(1);
    game.state.elapsed = 600;
    expect(elapsedPercent(game)).toBe(33); // 60000 / 1800
    game.state.elapsed = 1000;
    expect(elapsedPercent(game)).toBe(55); // 100000 / 1800 (l'original donnait 19)
  });
});

describe("Commentary : 26ee:027e (réplique)", () => {
  it("prisonnier : 0xab..0xaf, 0xb5..0xb7 passé la moitié du temps, 0xc1..0xc4, 0x82, puis l'ingrédient manquant", () => {
    const game = gameOf(1);
    game.state.elapsed = 360;
    const commentary = new Commentary();
    const say = (...values: number[]) => commentary.turnComment(game, scripted(0, ...values).rng, true);
    expect(say(2)).toBe(173);
    expect(say(2, 0)).toBe(193); // 173 déjà dit : tirage suivant (pas de 0xb5 avant 51 %)
    expect(say(2, 0)).toBe(0x82); // 173 et 193 déjà dits
    // Puis l'ingrédient demandé que le joueur n'a pas, dans l'ordre 0, 1, 2… (code 0x82 + `DS:27A2[k]`).
    expect(say(2, 0)).toBe(0x88);
    expect(say(2, 0)).toBe(0x84);
  });

  it("prisonnier : au-delà de 50 % du temps, les 0xb5..0xb7 s'intercalent", () => {
    const game = gameOf(1);
    game.state.durationSeconds = 600;
    game.state.elapsed = 400; // 40000 / 600 = 66 %
    const commentary = new Commentary();
    expect(commentary.turnComment(game, scripted(0, 4).rng, true)).toBe(175);
    expect(commentary.turnComment(game, scripted(0, 4, 1).rng, true)).toBe(182);
  });

  it("une chance sur deux de parler au tour passé, une sur trois sinon", () => {
    const game = gameOf(1);
    const jailed = scripted(1);
    expect(new Commentary().turnComment(game, jailed.rng, true)).toBe(0);
    expect(jailed.asked).toEqual([2]);
    const normal = scripted(2);
    expect(new Commentary().turnComment(game, normal.rng, false)).toBe(0);
    expect(normal.asked).toEqual([3]);
  });

  it("joueur seul sans avancement : retard sur le temps, puis personne n'a rien, puis nombre d'ingrédients manquants", () => {
    const game = gameOf(1);
    game.state.elapsed = 360;
    const commentary = new Commentary();
    const say = (...values: number[]) => commentary.turnComment(game, scripted(0, ...values).rng, false);
    // 20 % du temps : un joueur à 0 est « en retard » (0xd, 0xe, 0xf) puis la voix de son personnage (0x8f..0x90, Costaud).
    expect([say(), say(), say(), say(1)]).toEqual([0xd, 0xe, 0xf, 0x90]);
    game.state.elapsed = 540; // 30 % : « personne n'a rien » (0x71), puis « il manque 6 ingrédients ».
    expect(say()).toBe(0x71);
    expect(say(1)).toBe(0x7a); // 6 manquants : 0x72 ou 0x7a (tirage 1)
  });

  it("l'ingrédient manquant est cité par sa vidéo (0x83..0x8a), une fois chacun", () => {
    const game = gameOf(1);
    game.state.elapsed = 540;
    Object.assign(game.state.players[0], { ingredients: 0b00011110 }); // il ne manque que l'ingrédient 0 et 7
    const commentary = new Commentary();
    // Ni voix « en retard » ni comptage : on épuise les répliques précédentes pour atteindre la vidéo.
    const seen: number[] = [];
    for (let i = 0; i < 12; i++) {
      const code = commentary.turnComment(game, scripted(0, 0, 0, 0, 0).rng, false);
      if (code) seen.push(code);
    }
    expect(seen.filter((c) => c >= 0x83 && c <= 0x8a)).toEqual([0x88, 0x89]);
    expect(isCommentVideo(0x88)).toBe(true);
  });

  it("hors tour passé, la réplique de la partie normale n'est jamais atteinte (écart de tours au dernier passage)", () => {
    const game = gameOf(2);
    game.state.elapsed = 360;
    const commentary = new Commentary();
    for (let round = 1; round < 30; round++) {
      game.state.round = round;
      // Le bloc est parcouru à chaque tour : le dernier passage date toujours du tour précédent (écart de 1) ou du même tour.
      expect(commentary.afterAnnouncement(game, scripted().rng, { warned: false, skipped: false })).toBe(0);
      expect(commentary.afterAnnouncement(game, scripted().rng, { warned: false, skipped: false })).toBe(0);
    }
  });

  it("au tour passé, la réplique est toujours tentée, avertissement de temps ou non", () => {
    const game = gameOf(1);
    game.state.elapsed = 360;
    const commentary = new Commentary();
    expect(commentary.afterAnnouncement(game, scripted(0, 3).rng, { warned: false, skipped: true })).toBe(174);
  });

  it("classe les codes en voix et en vidéos", () => {
    for (const code of [31, 35, 41, 76, 131, 138, 171, 175, 181, 193, 196, 201, 215]) expect(isCommentVideo(code)).toBe(true);
    for (const code of [1, 5, 11, 15, 30, 36, 40, 77, 100, 108, 111, 130, 139, 141, 163, 170, 176, 182, 183, 197]) expect(isCommentVideo(code)).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("Grand Schtroumpf dans la partie", () => {
  it("le commentaire d'avancement (en retard) passe avant le plateau du tour 7", async () => {
    const s = await Session.start();
    await s.ready();
    const below = s.ctx.rng.below.bind(s.ctx.rng);
    // 5 fois sur 6 : le tirage « 2 sur 6 » est écarté pour ce test.
    vi.spyOn(s.ctx.rng, "below").mockImplementation((n: number) => (n === 6 ? 0 : below(n)));
    s.game.state.round = 6;
    s.setElapsed(600);
    s.place({ screen: 2, row: "top", x: 0x20 });
    await s.tap("Space");
    await s.settle("MinigameStub");
    await s.tap("Space");
    await s.settle("ClipSequence");
    await s.until(() => s.host.loaded.some((f) => /S42A20[1-4]\.MUX/i.test(f)));
    expect(s.game.state.round).toBe(7);
    await s.run(1000);
    await s.tap("Escape");
    await s.ready();
    expect(s.top()).toBe("GameScene");
  }, 120_000);
});
