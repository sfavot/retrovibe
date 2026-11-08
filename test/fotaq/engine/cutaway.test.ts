import { describe, expect, it } from "vitest";
import { type Cutaway, parseCutaway } from "../../../src/games/fotaq/data/cut";
import { parseDog } from "../../../src/games/fotaq/data/dog";
import { cutawayVoicePrefix, parseVoiceName } from "../../../src/games/fotaq/data/files";
import { splitSpeech } from "../../../src/games/fotaq/data/text";
import { dataFiles, hasOriginalFiles, listOriginal, readOriginal } from "../helpers";
import { cutawayContext, enableActors, perform, requiredStates } from "./contexts";
import { realPlayer } from "./test-host";

/** Cinématiques sans voix dans l'archive. */
const SILENT = new Set(["PC73E.CUT", "GM.CUT"]);
const isEmpty = (text: string | undefined): boolean => (text ?? "") === "";

const dogs = new Map<number, ReturnType<typeof parseDog>>();
const cuts = new Map<string, Cutaway>();
if (hasOriginalFiles) {
  for (const path of dataFiles("DOG")) {
    const dog = parseDog(readOriginal(path));
    dogs.set(dog.talkKey, dog);
  }
  for (const path of dataFiles("CUT")) cuts.set(path.toUpperCase(), parseCutaway(readOriginal(path), () => false));
}

/** Une voix absente est celle d'un segment sans texte, d'une réplique de Joe ou d'une cinématique (`*04*03`, texte vide). */
function explainsMissing(file: string, name: string): boolean {
  const voice = parseVoiceName(name);
  if (voice.kind === "dialog") {
    const dog = dogs.get(voice.talkKey);
    const list = voice.who === "J" ? dog?.joeSentences : dog?.personSentences;
    const sentence = list?.find((s) => s.head === voice.head);
    return sentence !== undefined && isEmpty(splitSpeech(sentence.text)[voice.segment - 1]?.text);
  }
  if (voice.kind === "dialogOpening") {
    const dog = dogs.get(voice.talkKey);
    const text = voice.opening === "SSSS" ? dog?.joeSentences[0]?.text : voice.who === "P" ? dog?.person2.greeting : dog?.person2.joe;
    return isEmpty(splitSpeech(text ?? "")[voice.segment - 1]?.text);
  }
  // Nom d'une cinématique : préfixe sur cinq caractères, rang de l'enregistrement sur deux, rang du segment en hexadécimal.
  const rank = Number(name.slice(5, 7));
  const segment = Number.parseInt(name.slice(7), 16);
  const object = cuts.get(file)?.objects[rank - 1];
  if (!object || name.slice(0, 5) !== cutawayVoicePrefix(file, rank).slice(0, 5)) return false;
  // Un texte de bruitage (« CLIC », « snap ») n'a pas de voix ; deux cinématiques n'en ont pas du tout dans l'archive (`PC73E`, et `GM` dont
  // la voix est rangée sous `GM011___`, un nom que ScummVM ne calcule pas non plus).
  if (object.objectNumber <= -2 || SILENT.has(file)) return true;
  const text = splitSpeech(object.sentence)[segment - 1]?.text;
  return isEmpty(text) || text === "CLIC";
}

interface Played {
  rig: ReturnType<typeof realPlayer>;
  ticks: number;
  next: string;
  room: number;
  spoken: { name: string; duration: number | undefined; start: number }[];
}

/** Joue une cinématique dans son contexte ; `skipAfter` : nombre de ticks avant d'appuyer sur Échap. */
function playCutaway(file: string, skipAfter?: number): Played {
  const context = cutawayContext(file);
  const rig = realPlayer({ room: context.room });
  const { player, engine, host } = rig;
  player.settle();
  for (const [slot, value] of requiredStates(context.list)) engine.state.gameStates[slot] = value;
  const cut = cuts.get(file) as Cutaway;
  enableActors(engine, context.room);
  for (const object of cut.objects) if (object.room > 0) enableActors(engine, object.room);
  let next = "";
  const ticks = perform(
    player,
    (function* () {
      next = yield* engine.playCutaway(file);
    })(),
    { onTick: (tick) => (tick === skipAfter ? host.push({ type: "action", action: "skipCutaway" }) : undefined) },
  );
  return { rig, ticks, next, room: context.room, spoken: host.spoken };
}

describe.skipIf(!hasOriginalFiles)("cinématiques (cutaway.cpp)", () => {
  it("les 302 cinématiques se jouent jusqu'au bout depuis leur contexte : sans erreur, voix attendues, état propre", () => {
    expect(cuts.size).toBe(302);
    const voiceFiles = new Set(listOriginal((name) => name.endsWith(".mp3")).map((path) => path.replace(/^voices\//, "").replace(/\.mp3$/, "")));
    const issues: string[] = [];
    let spokenTotal = 0;
    for (const [file, cut] of cuts) {
      let played: Played;
      try {
        played = playCutaway(file);
      } catch (error) {
        issues.push(`${file}: ${(error as Error).message}`);
        continue;
      }
      const { rig, spoken } = played;
      const { engine } = rig;
      if (engine.warnings.length) issues.push(`${file}: ${engine.warnings.join("; ")}`);
      const names = new Set(spoken.map((voice) => voice.name));
      spokenTotal += spoken.length;
      for (const voice of spoken) if (voice.duration === undefined && !explainsMissing(file, voice.name)) issues.push(`${file}: voix absente ${voice.name}`);
      // Toutes les voix de la cinématique sont demandées (celles des enregistrements de texte, de Joe et des personnes), sauf celle d'une
      // réplique inutile du français (`c30e_102`) et celle d'un « enregistrement » qui lance un générique (`#credit2.crd`).
      cut.objects.forEach((object, i) => {
        const prefix = cutawayVoicePrefix(file, i + 1);
        const wanted = [...voiceFiles].filter((voice) => voice.startsWith(prefix) && voice.length === prefix.length + 1);
        for (const voice of wanted) {
          if (!names.has(voice) && voice !== "C30E_102" && !object.sentence.startsWith("#")) issues.push(`${file}: voix ${voice} jamais demandée`);
        }
      });
      // L'état de fin est propre ; la scène ne se ferme pas si une autre cinématique la prolonge.
      if (engine.input.cutawayRunning || engine.input.cutawayQuit || engine.state.newRoom !== 0 || (engine.scene !== 0 && !cut.anotherCutaway)) {
        issues.push(`${file}: état de fin sale`);
      }
      if (engine.joeWalk !== 0 && played.next === "") {
        // Joe parlait : la boucle principale le remet en mode normal à son premier tour.
        rig.player.run(1);
        if (engine.joeWalk !== 0) issues.push(`${file}: Joe n'est pas revenu au mode normal (${engine.joeWalk})`);
      }
    }
    expect(issues).toEqual([]);
    expect(spokenTotal).toBeGreaterThan(1500);
  }, 120_000);

  it("Échap saute les cinématiques sautables, pas les autres ; l'état de fin est le même", () => {
    const issues: string[] = [];
    let skipped = 0;
    for (const [file, cut] of cuts) {
      let full: Played;
      let quick: Played;
      try {
        full = playCutaway(file);
        if (full.ticks < 12) continue;
        quick = playCutaway(file, 6);
      } catch (error) {
        issues.push(`${file}: ${(error as Error).message}`);
        continue;
      }
      const { engine } = quick.rig;
      if (engine.input.cutawayQuit || engine.input.cutawayRunning || engine.state.newRoom !== 0 || (engine.scene !== 0 && !cut.anotherCutaway)) {
        issues.push(`${file}: état de fin sale après le saut`);
      }
      if (engine.warnings.length) issues.push(`${file}: ${engine.warnings.join("; ")}`);
      if (cut.skippable) {
        // Une cinématique qui enchaîne un dialogue attend un clic : le saut ne la raccourcit pas en dessous de ses images de fin.
        if (full.ticks >= 40 && quick.ticks >= full.ticks && !/\.DOG$/i.test(cut.talkFile)) issues.push(`${file}: le saut n'a rien raccourci (${quick.ticks} contre ${full.ticks})`);
        skipped++;
      } else if (quick.ticks !== full.ticks) {
        issues.push(`${file}: non sautable mais ${quick.ticks} ticks au lieu de ${full.ticks}`);
      }
      // Dans les deux cas, la pièce finale demandée par la cinématique est atteinte.
      const finalRoom = cut.finalRoom !== 0 && cut.joeFinal.room !== 0 && !cut.anotherCutaway && !/\.DOG$/i.test(cut.talkFile);
      if (finalRoom && quick.rig.engine.state.room !== cut.joeFinal.room) issues.push(`${file}: pièce finale ${quick.rig.engine.state.room} au lieu de ${cut.joeFinal.room}`);
      if (finalRoom && full.rig.engine.state.room !== cut.joeFinal.room) issues.push(`${file}: pièce finale ${full.rig.engine.state.room} au lieu de ${cut.joeFinal.room} (sans saut)`);
    }
    expect(issues).toEqual([]);
    expect(skipped).toBeGreaterThan(100);
  }, 120_000);
});
