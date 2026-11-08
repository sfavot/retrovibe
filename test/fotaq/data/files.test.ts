import { describe, expect, it } from "vitest";
import {
  cutawayVoicePrefix,
  dialogOpeningVoicePrefix,
  dialogVoicePrefix,
  extensionOf,
  GameFiles,
  joeVoicePrefix,
  parseVoiceName,
  roomImageFile,
  roomLightFile,
  roomMaskFile,
  stemOf,
  voiceFile,
} from "../../../src/games/fotaq/data/files";
import { parseCutaway } from "../../../src/games/fotaq/data/cut";
import { parseDog } from "../../../src/games/fotaq/data/dog";
import { parseQueenJas } from "../../../src/games/fotaq/data/jas";
import { parseGameTexts, splitSpeech } from "../../../src/games/fotaq/data/text";
import { dataFiles, hasOriginalFiles, listOriginal, readManifest, readOriginal } from "../helpers";

const synthetic = new GameFiles([
  { path: "AND1.DOG", size: 1 },
  { path: "C21A.CUT", size: 1 },
  { path: "BLUEP.CUT", size: 1 },
  { path: "B1.MSK", size: 1 },
  { path: "B1.LUM", size: 1 },
  { path: "T4.MSK", size: 1 },
  { path: "voices/020001P2.mp3", size: 1 },
  { path: "voices/C21A_012.mp3", size: 1 },
  { path: "voices/MON_0001.mp3", size: 1 },
]);

describe("noms de fichiers", () => {
  it("donne l'extension et le nom sans extension", () => {
    expect(extensionOf("original/fotaq/B1.pcx")).toBe("PCX");
    expect(extensionOf("DATA")).toBe("");
    expect(stemOf("voices/020001P2.mp3")).toBe("020001P2");
    expect(stemOf("DATA")).toBe("DATA");
  });

  it("compose les noms des images d'une pièce et le chemin d'une voix", () => {
    expect([roomImageFile("B1"), roomMaskFile("B1"), roomLightFile("B1")]).toEqual(["B1.PCX", "B1.MSK", "B1.LUM"]);
    expect(voiceFile("020001p2")).toBe("voices/020001P2.mp3");
  });

  it("compose les préfixes de voix des dialogues, des cinématiques et de Joe", () => {
    expect(dialogVoicePrefix(2, 1, "P")).toBe("020001P");
    expect(dialogVoicePrefix(2, 0xa4, "J")).toBe("0200A4J");
    expect(dialogOpeningVoicePrefix(12, "SSSS", "J")).toBe("12SSSSJ");
    expect(cutawayVoicePrefix("c21a.CUT", 1)).toBe("C21A_01");
    expect(cutawayVoicePrefix("C100A.CUT", 3)).toBe("C100A03");
    expect(joeVoicePrefix(41)).toBe("JOE0041");
  });
});

describe("parseVoiceName", () => {
  it("reconnaît les répliques de dialogue et d'ouverture", () => {
    expect(parseVoiceName("020001P2")).toEqual({ kind: "dialog", talkKey: 2, head: 1, who: "P", segment: 2 });
    expect(parseVoiceName("0200a4j1")).toEqual({ kind: "dialog", talkKey: 2, head: 0xa4, who: "J", segment: 1 });
    expect(parseVoiceName("12SSSSJ1")).toEqual({ kind: "dialogOpening", talkKey: 12, opening: "SSSS", who: "J", segment: 1 });
    expect(parseVoiceName("12XXXXP3")).toEqual({ kind: "dialogOpening", talkKey: 12, opening: "XXXX", who: "P", segment: 3 });
  });

  it("reconnaît les voix de Joe et les voix de cinématique, complétées par _ à 5 caractères", () => {
    expect(parseVoiceName("JOE00411")).toEqual({ kind: "joe", number: 41, segment: 1 });
    expect(parseVoiceName("C21A_012")).toEqual({ kind: "cutaway", cutaway: "C21A", objectRank: 1, segment: 2 });
    expect(parseVoiceName("C100A032")).toEqual({ kind: "cutaway", cutaway: "C100A", objectRank: 3, segment: 2 });
    expect(parseVoiceName("voices/BLUEP011.mp3")).toEqual({ kind: "cutaway", cutaway: "BLUEP", objectRank: 1, segment: 1 });
  });

  it("départage un effet qui a la forme d'une cinématique avec la liste des .CUT", () => {
    expect(parseVoiceName("ZZ___011")).toMatchObject({ kind: "cutaway", cutaway: "ZZ" });
    expect(parseVoiceName("ZZ___011", new Set(["C21A"]))).toEqual({ kind: "effect", name: "ZZ___011" });
    // Le rang d'un objet commence à 1 : ces effets ne sont pas pris pour des cinématiques.
    expect(parseVoiceName("UNGH_001")).toEqual({ kind: "effect", name: "UNGH_001" });
    expect(parseVoiceName("MON_0001")).toEqual({ kind: "effect", name: "MON_0001" });
    expect(parseVoiceName("116BSSSS")).toEqual({ kind: "effect", name: "116BSSSS" });
    expect(parseVoiceName("BLANK000")).toEqual({ kind: "effect", name: "BLANK000" });
  });
});

describe("GameFiles (données synthétiques)", () => {
  it("résout les noms sans tenir compte de la casse", () => {
    expect(synthetic.resolve("and1.dog")).toBe("AND1.DOG");
    expect(synthetic.resolve("voices/020001p2.MP3")).toBe("voices/020001P2.mp3");
    expect(synthetic.resolve("999.dog")).toBeUndefined();
  });

  it("liste les dialogues, les cinématiques, les voix et les pièces à lumière dynamique", () => {
    expect(synthetic.dialogs()).toEqual(["AND1"]);
    expect(synthetic.cutaways()).toEqual(["BLUEP", "C21A"]);
    expect(synthetic.voices()).toEqual(["020001P2", "C21A_012", "MON_0001"]);
    expect(synthetic.roomsWithLight()).toEqual(["B1"]);
  });
});

describe.skipIf(!hasOriginalFiles)("files.json du jeu", () => {
  // `COVER.png` (jaquette de l'accueil, `scripts/fotaq-cover.mts`) est servie avec les données mais n'en fait pas partie.
  const manifest = readManifest().filter((entry) => entry.path !== "COVER.png");
  const files = new GameFiles(manifest);
  const count = (extension: string) => manifest.filter((entry) => !entry.path.includes("/") && extensionOf(entry.path) === extension).length;

  it("décrit 7 671 fichiers : 920 de données, 6 751 voix", () => {
    expect(manifest).toHaveLength(7671);
    expect(files.voices()).toHaveLength(6751);
    expect(manifest.filter((entry) => !entry.path.startsWith("voices/"))).toHaveLength(920);
  });

  it("compte les fichiers par extension comme la table de queen.1c", () => {
    expect(
      Object.fromEntries(["SAM", "PCX", "BBK", "ACT", "MSK", "LUM", "RL", "MUS", "CUT", "DOG", "JAS", "CRD", "TXT"].map((ext) => [ext, count(ext)])),
    ).toEqual({ SAM: 86, PCX: 128, BBK: 131, ACT: 64, MSK: 65, LUM: 63, RL: 1, MUS: 1, CUT: 302, DOG: 73, JAS: 2, CRD: 2, TXT: 1 });
  });

  it("annonce les tailles des fichiers de données telles qu'elles sont sur le disque", () => {
    for (const entry of manifest.filter((e) => !e.path.startsWith("voices/"))) {
      expect(readOriginal(entry.path).length, entry.path).toBe(entry.size);
    }
  });

  it("liste exactement les voix présentes dans le dossier voices/", () => {
    const onDisk = listOriginal((name) => name.endsWith(".mp3")).map((path) => stemOf(path).toUpperCase());
    expect(onDisk.sort()).toEqual(files.voices());
  });

  it("résout les noms en majuscules ou minuscules, comme le jeu les demande (c75b.CUT, sparky.act)", () => {
    expect(files.resolve("c75b.CUT")).toBe("C75B.CUT");
    expect(files.resolve("sparky.act")).toBe("SPARKY.ACT");
    expect(files.resolve("queen.jas")).toBe("QUEEN.JAS");
  });
});

describe.skipIf(!hasOriginalFiles)("rattachement des voix aux données", () => {
  const manifest = readManifest();
  const files = new GameFiles(manifest);
  const jas = parseQueenJas(readOriginal("QUEEN.JAS"));
  const texts = parseGameTexts(readOriginal("QUEEN2.JAS"), {
    descriptions: jas.descriptionCount,
    names: jas.nameCount,
    rooms: jas.roomCount,
    actorAnimations: jas.actorAnimationCount,
    actorNames: jas.actorNameCount,
    actorFiles: jas.actorFileCount,
  });
  const isPerson = (n: number) => jas.objects[n].image === -3 || jas.objects[n].image === -4;
  const dogs = dataFiles("DOG").map((name) => parseDog(readOriginal(name)));
  const cuts = new Map(dataFiles("CUT").map((name) => [stemOf(name), parseCutaway(readOriginal(name), isPerson)]));
  const voices = files.voices();
  const parsed = voices.map((name) => ({ name, voice: parseVoiceName(name, new Set(cuts.keys())) }));
  /** Nombre de segments qui peuvent avoir une voix dans une réplique. */
  const slots = (sentence: string) => splitSpeech(sentence).length;

  it("classe les 6 751 voix : 3 756 de dialogue, 228 d'ouverture, 564 de Joe, 2 040 de cinématique, 163 effets", () => {
    const kinds = new Map<string, number>();
    for (const { voice } of parsed) kinds.set(voice.kind, (kinds.get(voice.kind) ?? 0) + 1);
    expect(Object.fromEntries([...kinds].sort())).toEqual({ cutaway: 2040, dialog: 3756, dialogOpening: 228, effect: 163, joe: 564 });
  });

  it("rattache chaque voix de dialogue à une phrase d'un .DOG (tête et rang de segment), sauf 480409P5", () => {
    const orphans: string[] = [];
    for (const { name, voice } of parsed) {
      if (voice.kind !== "dialog") continue;
      const found = dogs.some(
        (dog) =>
          dog.talkKey === voice.talkKey &&
          (voice.who === "P" ? dog.personSentences : dog.joeSentences).some((s) => s.head === voice.head && slots(s.text) >= voice.segment),
      );
      if (!found) orphans.push(name);
    }
    expect(orphans).toEqual(["480409P5"]);
  });

  it("rattache chaque voix d'ouverture à la première phrase de Joe ou aux phrases du personnage 2", () => {
    for (const { name, voice } of parsed) {
      if (voice.kind !== "dialogOpening") continue;
      const found = dogs.some((dog) => {
        if (dog.talkKey !== voice.talkKey) return false;
        const text = voice.opening === "SSSS" ? (voice.who === "J" ? dog.joeSentences[0].text : null) : voice.who === "J" ? dog.person2.joe : dog.person2.greeting;
        return text !== null && slots(text) >= voice.segment;
      });
      expect(found, name).toBe(true);
    }
  });

  it("rattache chaque voix de cinématique à un objet d'un .CUT (rang et segment, ou texte dit : segment 1)", () => {
    for (const { name, voice } of parsed) {
      if (voice.kind !== "cutaway") continue;
      const cut = cuts.get(voice.cutaway);
      expect(cut, name).toBeDefined();
      const object = cut!.objects[voice.objectRank - 1];
      expect(object, name).toBeDefined();
      const spokenText = object.kind === "textSpeak" || object.kind === "textDisplayAndSpeak";
      expect(slots(object.sentence) >= voice.segment || (spokenText && voice.segment === 1), name).toBe(true);
    }
  });

  it("rattache chaque voix de Joe à une réponse (1 à 40) ou à une description d'objet (numéro + 40)", () => {
    for (const { name, voice } of parsed) {
      if (voice.kind !== "joe") continue;
      const text = voice.number <= 40 ? texts.joeResponses[voice.number] : texts.objectDescriptions[voice.number - 40];
      expect(text, name).toBeDefined();
      expect(slots(text) >= voice.segment, name).toBe(true);
    }
  });

  it("laisse 28 effets sans rattachement dans les données : ils n'ont pas de nom de la table `_sfxName` de ScummVM (vague A)", () => {
    // 135 des 163 effets portent un nom `<n>SSSS…` de cette table ; les 28 autres sont des sons propres à des scènes
    // (dinosaure, monstre, grognements…) dont le moteur donne le nom dans son code.
    const tableLike = /^\d{1,4}[A-D]?S+$/;
    const notInTable = new Set(["130SSSSS", "21BSSSSS", "66ASSSSS", "66SSSSSS"]);
    const effects = parsed.filter(({ voice }) => voice.kind === "effect").map(({ name }) => name);
    expect(effects.filter((name) => tableLike.test(name))).toHaveLength(135 + 4);
    const unattached = effects.filter((name) => !tableLike.test(name) || notInTable.has(name));
    expect(unattached).toHaveLength(28);
    expect(unattached.filter((name) => /^(DINO|MON_|UNGH_|NOTDRAG)/.test(name))).toHaveLength(7 + 5 + 5 + 3);
  });
});
