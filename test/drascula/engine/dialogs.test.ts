import { describe, expect, it } from "vitest";
import { parseCal } from "../../../src/games/drascula/data/cal";
import { CommandType } from "../../../src/games/drascula/engine/dialogs";
import { TextColor } from "../../../src/games/drascula/render/palette";
import { hasOriginalFiles, readManifest, readOriginal } from "../helpers";
import { Player } from "./test-host";

describe.skipIf(!hasOriginalFiles)("choix de dialogue (.CAL)", () => {
  const voices = new Set(readManifest().map((e) => e.path.toUpperCase()));

  it("les 13 fichiers OP_n.CAL donnent quatre choix dont les voix existent", () => {
    const player = new Player({ chapter: 2 });
    for (let n = 1; n <= 13; n++) {
      const cal = parseCal(readOriginal(`OP_${n}.CAL`));
      const { phrases, voices: files, answers } = player.engine.dialogs.choices(n);
      expect(phrases, `OP_${n}`).toEqual(cal.choices.map((c) => c.text));
      expect(files.every((file) => voices.has(file.toUpperCase())), `OP_${n}`).toBe(true);
      expect(answers).toEqual(cal.answers);
      // Les espaces codés par 0xA7 sont des espaces.
      expect(phrases.join("")).not.toContain("º");
    }
  });

  it("OP_5 (chapitre 2, drapeaux 38 et 33) et OP_12 (chapitre 6, drapeaux 7 puis 10) remplacent leur troisième choix", () => {
    const ch2 = new Player({ chapter: 2 });
    const plain = ch2.engine.dialogs.choices(5);
    ch2.state.flags[38] = 1;
    expect(ch2.engine.dialogs.choices(5).phrases[2]).toBe(plain.phrases[2]);
    ch2.state.flags[33] = 1;
    const replaced = ch2.engine.dialogs.choices(5);
    expect(replaced.phrases[2]).toBe(ch2.engine.data.text("text", 405));
    expect(replaced.voices[2]).toBe("405.als");
    expect(replaced.answers[2]).toBe(31);
    expect(replaced.phrases.slice(0, 2)).toEqual(plain.phrases.slice(0, 2));

    const ch6 = new Player({ chapter: 6 });
    const base = ch6.engine.dialogs.choices(12);
    ch6.state.flags[7] = 1;
    expect(ch6.engine.dialogs.choices(12)).toMatchObject({ voices: [base.voices[0], base.voices[1], "273.als", base.voices[3]], answers: [base.answers[0], base.answers[1], 14] });
    ch6.state.flags[10] = 1;
    expect(ch6.engine.dialogs.choices(12).answers[2]).toBe(15);
    expect(ch6.engine.dialogs.choices(12).phrases[2]).toBe(ch6.engine.data.text("text", 274));
    // Hors de leur chapitre, les remplacements ne s'appliquent pas.
    ch2.state.chapter = 4;
    expect(ch2.engine.dialogs.choices(5).phrases[2]).toBe(plain.phrases[2]);
  });

  it("les bords des choix sont ceux de print_abc_opc : 8 pixels par ligne, les choix l'un sous l'autre", () => {
    const player = new Player({ chapter: 2 });
    const { phrases } = player.engine.dialogs.choices(1);
    const bottoms = player.engine.dialogs.bottoms(phrases);
    const lines = phrases.map((p) => player.engine.gfx.font.measureChoice(p));
    expect(bottoms).toEqual([lines[0] * 8, (lines[0] + lines[1]) * 8, (lines[0] + lines[1] + lines[2]) * 8, lines.reduce((a, b) => a + b) * 8]);
    expect(lines.every((n) => n >= 1)).toBe(true);
  });

  it("le joueur choisit : la réplique est dite par le héros, sa réponse jouée, puis le quatrième choix quitte", () => {
    const player = new Player({ chapter: 2 });
    player.settle();
    const { engine, host } = player;
    const { phrases, voices: files, answers } = engine.dialogs.choices(1);
    const bottoms = engine.dialogs.bottoms(phrases);
    engine.run(engine.dialogs.converse(1));
    player.run(5);
    expect(engine.choices?.phrases).toEqual(phrases);
    expect(engine.choices?.states).toEqual(["unselected", "unselected", "unselected", "unselected"]);
    expect(engine.choices?.hovered).toBe(-1);
    expect(engine.gfx.palette.textColor).toBe(TextColor.LightGreen);

    // Survol du premier choix.
    player.move(100, 1);
    player.run(2);
    expect(engine.choices?.hovered).toBe(0);

    // Clic : la réplique du héros, puis la réponse.
    const before = host.sounds.length;
    player.move(100, 1, 1);
    player.move(100, 1, 0);
    player.run(25); // `delay(100)` : le choix reste affiché, puis le héros parle
    expect(engine.choices).toBeNull(); // le menu s'efface pendant que le héros parle
    player.run(100);
    expect(host.sounds[before]).toBe(files[0].toLowerCase());
    expect(engine.choices?.states[0] ?? "clicked").toBe("clicked");
    const sequence = engine.dialogs.commands(answers[0]);
    expect(sequence.length).toBeGreaterThan(0);
    expect(sequence.some((c) => c.commandType >= CommandType.TalkerGeneral)).toBe(true);
    // Laisser jouer la réponse jusqu'au retour du menu.
    for (let t = 0; t < 20_000 && !engine.choices; t++) player.run(1);
    expect(engine.choices).not.toBeNull();
    expect(engine.choices!.states[0]).toBe("clicked");
    expect(engine.choices!.states[1]).toBe("unselected");

    // Quatrième choix : sort du dialogue.
    const y4 = bottoms[2] + 2;
    player.move(100, y4);
    player.run(2);
    expect(engine.choices!.hovered).toBe(3);
    player.move(100, y4, 1);
    player.move(100, y4, 0);
    player.run(1);
    for (let t = 0; t < 5_000 && engine.busy; t++) player.run(1);
    expect(engine.busy).toBe(false);
    expect(engine.choices).toBeNull();
    expect(host.sounds.at(-1)).toBe(files[3].toLowerCase());
  });

  it("un clic hors des choix ne fait rien", () => {
    const player = new Player({ chapter: 2 });
    player.settle();
    player.engine.run(player.engine.dialogs.converse(1));
    player.run(5);
    const sounds = player.host.sounds.length;
    player.move(100, 199);
    player.move(100, 199, 1);
    player.move(100, 199, 0);
    player.run(30);
    expect(player.host.sounds.length).toBe(sounds);
    expect(player.engine.busy).toBe(true);
  });
});

describe.skipIf(!hasOriginalFiles)("scénarios de dialogue (talkSequences)", () => {
  it("une commande inconnue lève une erreur", () => {
    const player = new Player({ chapter: 1 });
    player.settle();
    expect(() => player.perform(player.engine.dialogs.run({ chapter: 1, sequence: 0, commandType: 99, action: 0 }))).toThrow(/commande 99/);
  });

  it("les 225 lignes de talkSequences n'emploient que les 25 commandes connues", () => {
    const player = new Player({ chapter: 1 });
    const known = new Set<number>(Object.values(CommandType));
    expect(known.size).toBe(25);
    const table = player.engine.data.dat.talkSequences;
    expect(table).toHaveLength(225);
    for (const command of table) expect(known.has(command.commandType), `${command.chapter}/${command.sequence}`).toBe(true);
  });

  it("les commandes d'état : drapeaux, orientation, objet, fin de dialogue", () => {
    const player = new Player({ chapter: 6 });
    player.settle();
    const { engine } = player;
    // Scénario 6/14 : le barman parle, l'objet 21 est ajouté, le drapeau 10 se lève, le dialogue se termine.
    const commands = engine.dialogs.commands(14);
    expect(commands.map((c) => c.commandType)).toEqual([CommandType.TalkerBartender1, CommandType.AddObject, CommandType.SetFlag, CommandType.BreakOut]);
    player.perform(engine.dialogs.play(14));
    expect(engine.hasObject(21)).toBe(true);
    expect(player.state.flags[10]).toBe(1);
    expect(engine.dialogs.breakOut).toBe(true);
  });
});
