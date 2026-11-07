import { describe, expect, it } from "vitest";
import { pauseTicks } from "../../../src/games/drascula/engine/cadence";
import type { Sequence } from "../../../src/games/drascula/engine/sequence";
import { placeDrascula, placeIgor } from "../../../src/games/drascula/render/actors";
import { IgorType } from "../../../src/games/drascula/render/heads";
import { Plane } from "../../../src/games/drascula/render/plane";
import { TextColor } from "../../../src/games/drascula/render/palette";
import { hasOriginalFiles, readManifest } from "../helpers";
import { Player, type TestHost } from "./test-host";

/** Durée d'une voix en ticks (les `.ALS` sont à 11 025 Hz, 64 octets de marges ; le tick vaut 10 ms). */
function voiceTicks(file: string): number {
  const entry = readManifest().find((e) => e.path.toUpperCase() === file.toUpperCase());
  if (!entry) throw new Error(`voix absente : ${file}`);
  return ((entry.size - 64) * 1000) / 11025 / 10;
}

/** Le banc d'essai note les voix en minuscules. */
const lower = (names: string[]): string[] => names.map((name) => name.toLowerCase());

/** Un tour de réplique : 3 `pause` (9 ticks). */
const TURN = pauseTicks(3);

interface Said {
  voice: string;
  text: string;
  /** Ticks entre le début de la voix et celui de la voix suivante (ou la fin de la séquence). */
  ticks: number;
  color?: number;
}

/** Joue `sequence` et rend les répliques dites, dans l'ordre (voix, sous-titre, durée) ; lève au-delà de `max` ticks. */
function listen(player: Player, sequence: Sequence, max = 20_000): { said: Said[]; ticks: number } {
  const host: TestHost = player.host;
  const said: Said[] = [];
  const start = host.sounds.length;
  let seen = start;
  let began = 0;
  let current: Said | null = null;
  player.engine.run(sequence);
  let ticks = 0;
  for (; ticks < max && player.engine.busy; ticks++) {
    player.run(1);
    while (seen < host.sounds.length) {
      if (current) current.ticks = ticks - began;
      const sub = player.engine.subtitle;
      current = { voice: host.sounds[seen], text: sub?.text ?? "", ticks: 0, color: sub?.color };
      said.push(current);
      began = ticks;
      seen++;
    }
  }
  if (player.engine.busy) throw new Error("la séquence ne s'est pas terminée");
  if (current) current.ticks = ticks - began;
  return { said, ticks };
}

describe.skipIf(!hasOriginalFiles)("réplique : durée et voix", () => {
  it("la durée d'une réplique du héros est celle de sa voix (au tour près)", () => {
    for (const index of [1, 167, 214, 300]) {
      const player = new Player({ chapter: 1 });
      player.settle();
      const { said } = listen(player, player.engine.talk(index));
      expect(said).toHaveLength(1);
      expect(said[0].voice).toBe(`${index}.als`);
      expect(said[0].text).toBe(player.engine.data.text("text", index));
      // La voix se termine dans le tour en cours : la réplique dure au moins la voix, et au plus un tour de plus.
      expect(said[0].ticks).toBeGreaterThanOrEqual(Math.floor(voiceTicks(`${index}.als`)));
      expect(said[0].ticks).toBeLessThanOrEqual(Math.ceil(voiceTicks(`${index}.als`)) + TURN);
    }
  });

  it("chaque personnage dit sa voix avec son texte, sa couleur et la durée de la voix", () => {
    const cases: { name: string; chapter?: number; play: (p: Player) => Sequence; voice: string; section: string; index: number; color: number }[] = [
      { name: "Igor", play: (p) => p.engine.talkers.igor(8, IgorType.Right), voice: "I8.als", section: "texti", index: 8, color: TextColor.White },
      { name: "Drascula", play: (p) => p.engine.talkers.drascula(2), voice: "d2.als", section: "textd", index: 2, color: TextColor.Red },
      { name: "barman", play: (p) => p.engine.talkers.bartender(3, 1), voice: "t3.als", section: "textt", index: 3, color: TextColor.Maroon },
      { name: "B.J.", play: (p) => p.engine.talkers.bj(2), voice: "BJ2.als", section: "textbj", index: 2, color: TextColor.White },
      { name: "pianiste", chapter: 2, play: (p) => p.engine.talkers.pianist(6), voice: "P6.als", section: "textp", index: 6, color: TextColor.White },
      { name: "ivrogne", play: (p) => p.engine.talkers.drunk(1), voice: "B1.als", section: "textb", index: 1, color: TextColor.DarkGreen },
      { name: "Von Braun", chapter: 2, play: (p) => p.engine.talkers.vonBraun(1), voice: "VB1.als", section: "textvb", index: 1, color: TextColor.Brown },
      { name: "loup-garou", chapter: 3, play: (p) => p.engine.talkers.werewolf(1), voice: "L1.als", section: "textl", index: 1, color: TextColor.Red },
      { name: "musicien", chapter: 3, play: (p) => p.engine.talkers.musician(1), voice: "E1.als", section: "texte", index: 1, color: TextColor.White },
    ];
    for (const c of cases) {
      const player = new Player({ chapter: c.chapter ?? 1 });
      player.settle();
      const { said } = listen(player, c.play(player));
      expect(said, c.name).toHaveLength(1);
      expect(said[0].voice, c.name).toBe(c.voice.toLowerCase());
      expect(said[0].text, c.name).toBe(player.engine.data.text(c.section as "texti", c.index));
      expect(said[0].color, c.name).toBe(c.color);
      expect(said[0].ticks, c.name).toBeGreaterThanOrEqual(Math.floor(voiceTicks(c.voice)));
      expect(said[0].ticks, c.name).toBeLessThanOrEqual(Math.ceil(voiceTicks(c.voice)) + TURN);
    }
  });

  it("l'aveugle suit la chaîne de synchronisation, un chiffre par tour de deux pauses", () => {
    const player = new Player({ chapter: 2 });
    player.settle();
    const voice = "d68.als";
    const { said } = listen(player, player.engine.talkers.blind(1));
    expect(said[0].voice).toBe(voice);
    expect(said[0].text).toBe(player.engine.data.text("textd", 68));
    expect(said[0].ticks).toBeLessThanOrEqual(Math.ceil(voiceTicks(voice)) + pauseTicks(2));
  });

  it("une voix absente laisse le texte un temps proportionnel à sa longueur", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { said, ticks } = listen(player, player.engine.say("PAS DE VOIX POUR CETTE REPLIQUE", "absente.als"));
    expect(said[0].voice).toBe("absente.als");
    expect(ticks).toBeGreaterThanOrEqual(31 * 6);
  });

  it("une touche coupe la réplique ; Échap aussi, sans sauter la cinématique qui la contient", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    player.engine.run(player.engine.talk(214));
    player.run(12);
    expect(player.host.soundActive()).toBe(true);
    player.key("Escape");
    player.run(TURN);
    expect(player.engine.busy).toBe(false);
  });
});

describe.skipIf(!hasOriginalFiles)("la tête qui parle", () => {
  /** Compose l'image de la réplique en cours avec ou sans la tête, sans sous-titre. */
  function headDifference(player: Player): { x0: number; y0: number; x1: number; y1: number } | null {
    const { engine } = player;
    const base = { state: engine.state, mouseX: 0, mouseY: 0, subtitle: null, main: false, cursorVisible: false } as const;
    engine.gfx.compose({ ...base, talk: null });
    const idle = engine.gfx.screen.pixels.slice();
    engine.gfx.compose({ ...base, talk: engine.head });
    const talking = engine.gfx.screen.pixels;
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    for (let i = 0; i < idle.length; i++) {
      if (idle[i] === talking[i]) continue;
      const x = i % 320;
      const y = Math.trunc(i / 320);
      box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
    }
    return box;
  }

  it("le héros parle : seul le haut de sa silhouette change, et la bouche varie d'un tour à l'autre", () => {
    const player = new Player({ chapter: 1, seed: 7 });
    player.settle();
    const { engine, hero } = player;
    engine.run(engine.talk(214));
    player.run(1);
    expect(engine.head).not.toBeNull();
    const faces = new Set<number>();
    const seenBoxes: string[] = [];
    for (let turn = 0; turn < 12; turn++) {
      faces.add(engine.head!.roll.face);
      const box = headDifference(player);
      if (box) {
        expect(box.x0).toBeGreaterThanOrEqual(hero.x - 1);
        expect(box.x1).toBeLessThanOrEqual(hero.x + hero.width + 1);
        expect(box.y0).toBeGreaterThanOrEqual(hero.y);
        expect(box.y1).toBeLessThanOrEqual(hero.y + 30);
        seenBoxes.push(`${box.x0},${box.y0},${box.x1},${box.y1}`);
      }
      player.run(TURN);
    }
    expect(faces.size).toBeGreaterThan(2);
    expect(faces.size).toBeLessThanOrEqual(6);
    expect(seenBoxes.length).toBeGreaterThan(0);
  });

  it("hors réplique, plus de tête ni de sous-titre", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    listen(player, player.engine.talk(214));
    expect(player.engine.head).toBeNull();
    expect(player.engine.subtitle).toBeNull();
  });

  it("le visage est tiré dans la plage du personnage (n visages : 0 à n - 1)", () => {
    const cases: [string, (p: Player) => Sequence, number][] = [
      ["héros", (p) => p.engine.talk(214), 6],
      ["Igor de profil", (p) => p.engine.talkers.igor(8, IgorType.Right), 8],
      ["Igor assis", (p) => p.engine.talkers.igor(8, IgorType.Seated), 4],
      ["Drascula", (p) => p.engine.talkers.drascula(2), 8],
      ["barman", (p) => p.engine.talkers.bartender(3, 0), 9],
      ["B.J.", (p) => p.engine.talkers.bj(2), 5],
    ];
    for (const [name, play, count] of cases) {
      const player = new Player({ chapter: 1, seed: 3 });
      player.settle();
      player.engine.run(play(player));
      const faces: number[] = [];
      for (let t = 0; t < 400 && player.engine.busy; t++) {
        player.run(1);
        if (player.engine.head) faces.push(player.engine.head.roll.face);
      }
      expect(Math.max(...faces), name).toBeLessThan(count);
      expect(Math.min(...faces), name).toBeGreaterThanOrEqual(0);
      expect(new Set(faces).size, name).toBeGreaterThan(1);
    }
  });
});

describe.skipIf(!hasOriginalFiles)("dialogues du chapitre 1", () => {
  /** Voix attendues d'un scénario : (type de commande, action) -> fichier de voix, comme `talk.cpp`. */
  const VOICE: Record<number, (n: number) => string> = {
    13: (n) => `${n}.als`,
    14: (n) => `B${n}.als`,
    16: (n) => `BJ${n}.als`,
    23: (n) => (n === 82 ? `d${n}.als` : `t${n}.als`),
  };

  it("scénario 2 : B.J. et le héros (17 répliques)", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { said } = listen(player, player.engine.dialogs.play(2));
    expect(said.map((s) => s.voice)).toEqual(lower([
      "BJ2.als", "215.als", "BJ3.als", "216.als", "BJ4.als", "BJ5.als", "BJ6.als", "217.als", "BJ7.als", "218.als", "BJ8.als", "219.als", "BJ9.als",
      "220.als", "221.als", "BJ10.als", "222.als",
    ]));
    const { engine } = player;
    const expectedText = [
      ["textbj", 2], ["text", 215], ["textbj", 3], ["text", 216], ["textbj", 4], ["textbj", 5], ["textbj", 6], ["text", 217], ["textbj", 7], ["text", 218],
      ["textbj", 8], ["text", 219], ["textbj", 9], ["text", 220], ["text", 221], ["textbj", 10], ["text", 222],
    ] as const;
    expect(said.map((s) => s.text)).toEqual(expectedText.map(([section, index]) => engine.data.text(section, index)));
    expect(said.map((s) => s.color)).toEqual(expectedText.map(([section]) => (section === "text" ? TextColor.Yellow : TextColor.White)));
  });

  it("scénario 3 : le barman et le héros, puis le drapeau 0 se lève", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    expect(player.state.flags[0]).toBe(0);
    const { said } = listen(player, player.engine.dialogs.play(3));
    expect(said.map((s) => s.voice)).toEqual(lower([
      "192.als", "t1.als", "193.als", "t2.als", "194.als", "t3.als", "195.als", "t4.als", "196.als", "t5.als", "t6.als", "197.als", "t7.als", "198.als",
      "t8.als", "199.als", "t9.als", "200.als", "201.als", "202.als",
    ]));
    expect(player.state.flags[0]).toBe(1);
    const barman = said.filter((s) => /^t\d/.test(s.voice));
    expect(barman.every((s) => s.color === TextColor.Maroon)).toBe(true);
    expect(barman[0].text).toBe(player.engine.data.text("textt", 1));
  });

  it.each([
    [10, "B1.als", 1],
    [11, "B2.als", 2],
    [12, "B3.als", 3],
  ])("scénario %i : l'ivrogne dit %s", (sequence, voice, index) => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { said } = listen(player, player.engine.dialogs.play(sequence));
    expect(said.map((s) => s.voice)).toEqual([voice.toLowerCase()]);
    expect(said[0].text).toBe(player.engine.data.text("textb", index));
    expect(said[0].color).toBe(TextColor.DarkGreen);
    // La feuille de l'ivrogne remplace `front` le temps de la réplique, puis le héros revient (96.ALG).
    expect(player.state.flags[13]).toBe(0);
  });

  it("les cinq scénarios du chapitre 1 sont exactement ceux du fichier de données", () => {
    const player = new Player({ chapter: 1 });
    const sequences = new Set(player.engine.data.dat.talkSequences.filter((c) => c.chapter === 1).map((c) => c.sequence));
    expect([...sequences].sort((a, b) => a - b)).toEqual([2, 3, 10, 11, 12]);
    // Chaque commande de parole du chapitre 1 est dans la table des voix attendues ci-dessus.
    for (const command of player.engine.data.dat.talkSequences.filter((c) => c.chapter === 1)) {
      if (command.commandType >= 13) expect(VOICE[command.commandType], `commande ${command.commandType}`).toBeDefined();
    }
  });

  it("la durée d'un scénario est la somme des durées de ses voix, au tour près", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { said, ticks } = listen(player, player.engine.dialogs.play(2));
    const sum = said.reduce((total, s) => total + voiceTicks(s.voice), 0);
    expect(ticks).toBeGreaterThanOrEqual(Math.floor(sum));
    expect(ticks).toBeLessThanOrEqual(Math.ceil(sum) + said.length * TURN);
  });

  it("une touche coupe une réplique du scénario, pas le scénario", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    player.engine.run(player.engine.dialogs.play(2));
    player.run(12);
    const first = player.host.sounds.length;
    player.key(" ");
    player.run(TURN + 2);
    expect(player.host.sounds.length).toBeGreaterThan(first);
    expect(player.engine.busy).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("placement des personnages secondaires", () => {
  it("Von Braun marche vers un point, tourné vers lui, puis s'arrête", () => {
    const player = new Player({ chapter: 2 });
    player.settle();
    const vb = player.state.vonBraun;
    vb.x = 120;
    player.perform(player.engine.talkers.placeVonBraun(42));
    expect(vb.track).toBe(0);
    expect(vb.x).toBeLessThanOrEqual(42);
    expect(vb.moving).toBe(false);
    player.perform(player.engine.talkers.placeVonBraun(99));
    expect(vb.track).toBe(1);
    expect(vb.x).toBeGreaterThanOrEqual(99);
  });

  it("Igor et Drascula sont dessinés à leur place, selon leur état", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    const { engine } = player;
    const target = new Plane();
    const state = player.state;
    state.igor = { x: 66, y: 97, track: 1 };
    state.drascula = { x: 129, y: 95, track: 0 };
    engine.gfx.loadPic("auxigor.alg", engine.gfx.front);
    engine.gfx.loadPic("auxdr.alg", engine.gfx.back);
    placeIgor(engine.gfx, state, target);
    placeDrascula(engine.gfx, state, target);
    let igorPixels = 0;
    let drasculaPixels = 0;
    for (let y = 0; y < 200; y++) {
      for (let x = 0; x < 320; x++) {
        if (target.at(x, y) === 0) continue;
        if (x >= 66 && x < 120 && y >= 97 && y < 158) igorPixels++;
        if (x >= 129 && x < 174 && y >= 95 && y < 172) drasculaPixels++;
      }
    }
    expect(igorPixels).toBeGreaterThan(200);
    expect(drasculaPixels).toBeGreaterThan(200);
    // Rien en dehors de leurs rectangles.
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) if (target.at(x, y) !== 0) expect((x >= 66 && x < 174 && y >= 95 && y < 172)).toBe(true);
  });
});
