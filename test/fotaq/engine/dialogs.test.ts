import { describe, expect, it } from "vitest";
import { parseDog } from "../../../src/games/fotaq/data/dog";
import { parseVoiceName } from "../../../src/games/fotaq/data/files";
import { splitSpeech } from "../../../src/games/fotaq/data/text";
import { splitOption } from "../../../src/games/fotaq/engine/dialogs";
import { textWidth } from "../../../src/games/fotaq/render/font";
import { dataFiles, hasOriginalFiles, readOriginal } from "../helpers";
import { dialogContext, enableActors, perform, requiredStates } from "./contexts";
import { realPlayer } from "./test-host";

describe("choix de dialogue (splitOption)", () => {
  it("un texte court tient sur une ligne et s'arrête à l'étoile", () => {
    expect(splitOption("Bonjour.*17Suite")).toEqual(["Bonjour."]);
  });

  it("un texte long est coupé aux espaces, chaque ligne tient dans l'écran", () => {
    const text = "Je voudrais savoir comment on peut arriver jusqu'à cette pièce qui semble si difficile à atteindre depuis ici, mon ami";
    const lines = splitOption(text);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join("").replace(/ $/, "")).toBe(text.replace(/ $/, ""));
    lines.forEach((line, i) => expect(textWidth(line)).toBeLessThanOrEqual(i === 0 ? 302 : 302 - 24 + textWidth(" ")));
  });
});

/** Dialogue joué avec une suite de choix, dans son contexte ; rend ce qui s'est passé. */
function playDialog(file: string, picks: number[], allStates: boolean) {
  const context = dialogContext(file);
  const rig = realPlayer({ room: context.room });
  const { player, engine, host, talk } = rig;
  player.settle();
  for (const [slot, value] of requiredStates(context.list)) engine.state.gameStates[slot] = value;
  enableActors(engine, context.room);
  const dog = parseDog(readOriginal(file));
  if (allStates) for (const level of dog.tree) for (const option of level) if (option.stateIndex < 0) engine.state.gameStates[-option.stateIndex] = option.stateValue;
  const menus: { options: string[]; picked: number }[] = [];
  let next = "";
  const ticks = perform(
    player,
    (function* () {
      next = yield* talk.dialogue(engine, file, context.noun);
    })(),
    {
      choose: (menu, index) => {
        const picked = Math.min(picks[index] ?? 0, menu.length - 1);
        menus.push({ options: menu.map((m) => m.text), picked });
        return picked;
      },
    },
  );
  return { rig, dog, menus, next, ticks, warnings: [...talk.warnings, ...engine.warnings], spoken: host.spoken };
}

/** Un nom de voix manquant est celui d'un segment vide de la réplique (`*04*03` : un segment sans texte, donc sans voix). */
function isEmptySegment(name: string, dogs: Map<number, ReturnType<typeof parseDog>>): boolean {
  const voice = parseVoiceName(name);
  if (voice.kind === "dialog") {
    const dog = dogs.get(voice.talkKey);
    const list = voice.who === "J" ? dog?.joeSentences : dog?.personSentences;
    const sentence = list?.find((s) => s.head === voice.head);
    return sentence !== undefined && (splitSpeech(sentence.text)[voice.segment - 1]?.text ?? "") === "";
  }
  if (voice.kind === "dialogOpening") {
    const dog = dogs.get(voice.talkKey);
    const text = voice.opening === "SSSS" ? dog?.joeSentences[0]?.text : voice.who === "P" ? dog?.person2.greeting : dog?.person2.joe;
    return (splitSpeech(text ?? "")[voice.segment - 1]?.text ?? "") === "";
  }
  return false;
}

describe.skipIf(!hasOriginalFiles)("dialogues (talk.cpp)", () => {
  const dogs = new Map<number, ReturnType<typeof parseDog>>();
  for (const path of dataFiles("DOG")) {
    const dog = parseDog(readOriginal(path));
    dogs.set(dog.talkKey, dog);
  }

  it("les 73 dialogues se parcourent : chaque option affichée est jouée, sans erreur, et le dialogue finit", () => {
    let menusSeen = 0;
    let optionsSeen = 0;
    let optionsChosen = 0;
    let runs = 0;
    const issues: string[] = [];
    for (const path of dataFiles("DOG")) {
      const file = path.toUpperCase();
      const seen = new Set<string>();
      const chosen = new Set<string>();
      for (const allStates of [false, true]) {
        const stack: number[][] = [[]];
        let count = 0;
        while (stack.length > 0 && count++ < 150) {
          const picks = stack.pop() as number[];
          let run: ReturnType<typeof playDialog>;
          try {
            run = playDialog(file, picks, allStates);
          } catch (error) {
            issues.push(`${file} ${JSON.stringify(picks)}: ${(error as Error).message}`);
            continue;
          }
          runs++;
          if (run.warnings.length) issues.push(`${file}: ${run.warnings.join("; ")}`);
          for (const voice of run.spoken) {
            if (voice.duration === undefined && !isEmptySegment(voice.name, dogs)) issues.push(`${file}: voix absente ${voice.name}`);
          }
          expect(run.rig.engine.joeWalk).toBe(0);
          expect(run.rig.engine.input.talkQuit).toBe(false);
          run.menus.forEach((menu, m) => {
            menu.options.forEach((option) => seen.add(option));
            chosen.add(menu.options[menu.picked]);
            if (m >= picks.length) {
              menu.options.forEach((option, alt) => {
                if (alt !== menu.picked && !chosen.has(option)) stack.push([...run.menus.slice(0, m).map((x) => x.picked), alt]);
              });
            }
          });
        }
      }
      menusSeen += seen.size > 0 ? 1 : 0;
      optionsSeen += seen.size;
      optionsChosen += chosen.size;
      expect([...seen].filter((option) => !chosen.has(option)), `${file} options affichées jamais choisies`).toEqual([]);
    }
    expect(issues).toEqual([]);
    // La plupart des dialogues ont un menu ; toutes les options affichées ont été choisies.
    expect(menusSeen).toBeGreaterThan(60);
    expect(optionsChosen).toBe(optionsSeen);
    expect(runs).toBeGreaterThan(73);
  }, 120_000);
});
