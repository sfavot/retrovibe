import { describe, expect, it } from "vitest";
import {
  decodeGameText,
  JOE_RESPONSE_COUNT,
  parseGameTexts,
  splitLines,
  splitSpeech,
  VERB_COUNT,
  voiceSuffix,
} from "../../../src/games/fotaq/data/text";
import { parseQueenJas } from "../../../src/games/fotaq/data/jas";
import { dataFiles, hasOriginalFiles, readOriginal } from "../helpers";

const bytes = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));

describe("decodeGameText", () => {
  it("décode le Latin-1 quand aucun octet 0x80 à 0x9F n'apparaît", () => {
    expect(decodeGameText(Uint8Array.of(0x43, 0x61, 0x20, 0xe9, 0x74, 0xe9, 0x20, 0xc7))).toBe("Ca été Ç");
  });

  it("décode le CP850 dès qu'un octet 0x80 à 0x9F apparaît", () => {
    // « Vous avez appris à parler français ? » tel que dans CHIEF4.DOG : à = 0x85, ç = 0x87.
    expect(decodeGameText(Uint8Array.of(0x61, 0x70, 0x70, 0x72, 0x69, 0x73, 0x20, 0x85, 0x20, 0x66, 0x72, 0x61, 0x6e, 0x87, 0x61, 0x69, 0x73))).toBe("appris à français");
    expect(decodeGameText(Uint8Array.of(0x90, 0x8a, 0x82))).toBe("Éèé");
  });
});

describe("splitLines", () => {
  it("coupe sur \\r\\n, \\n et \\r, et garde les lignes vides", () => {
    expect(splitLines(bytes("a\r\nb\n\r\nc\rd\r\n"))).toEqual(["a", "b", "", "c", "d"]);
  });

  it("garde une dernière ligne sans terminateur (écart avec ScummVM)", () => {
    expect(splitLines(bytes("a\r\nb"))).toEqual(["a", "b"]);
    expect(splitLines(new Uint8Array(0))).toEqual([]);
  });
});

describe("parseGameTexts (données synthétiques)", () => {
  const counts = { descriptions: 1, names: 2, rooms: 1, actorAnimations: 1, actorNames: 1, actorFiles: 1 };

  it("répartit les lignes par section, numérotées à partir de 1", () => {
    const lines = ["desc", "n1", "n2", "room", ...Array.from({ length: VERB_COUNT }, (_, i) => `v${i + 1}`), ...Array.from({ length: JOE_RESPONSE_COUNT }, (_, i) => `r${i + 1}`), "anim", "actor", "x.act"];
    const texts = parseGameTexts(bytes(`${lines.join("\r\n")}\r\n`), counts);
    expect(texts.objectDescriptions).toEqual(["", "desc"]);
    expect(texts.objectNames).toEqual(["", "n1", "n2"]);
    expect(texts.roomNames[1]).toBe("room");
    expect(texts.verbs[12]).toBe("v12");
    expect(texts.joeResponses[40]).toBe("r40");
    expect(texts.actorFiles).toEqual(["", "x.act"]);
  });

  it("refuse un nombre de lignes différent de la somme des sections", () => {
    expect(() => parseGameTexts(bytes("a\r\nb\r\n"), counts)).toThrow(/lignes au lieu de/);
  });
});

describe("splitSpeech", () => {
  it("rend un seul segment sans commande", () => {
    expect(splitSpeech("Bonjour!")).toEqual([{ text: "Bonjour!", command: { kind: "none" }, index: 0 }]);
    expect(splitSpeech("")).toEqual([]);
  });

  it("coupe sur chaque * et lit la commande de deux caractères", () => {
    const segments = splitSpeech("Ah!*03Oui.*FLNon.*AO*WTFin");
    expect(segments.map((s) => [s.index, s.text, s.command.kind])).toEqual([
      [0, "Ah!", "mouth"],
      [1, "Oui.", "face"],
      [2, "Non.", "amalOn"],
      [3, "", "pause"],
      [4, "Fin", "none"],
    ]);
    expect(segments[0].command).toEqual({ kind: "mouth", animation: 3 });
    expect(segments[1].command).toEqual({ kind: "face", direction: "left" });
  });

  it("reconnaît les quatre orientations et les deux saisies", () => {
    const directions = splitSpeech("*FL*FR*FF*FB").map((s) => (s.command.kind === "face" ? s.command.direction : null));
    expect(directions).toEqual(["left", "right", "front", "back"]);
    expect(splitSpeech("*GD*GM").map((s) => s.command)).toEqual([
      { kind: "grab", pose: "down" },
      { kind: "grab", pose: "mid" },
    ]);
  });

  it("lit *XY00(237,112) comme un déplacement et saute ses treize caractères", () => {
    const segments = splitSpeech("Allons-y.*XY07(237,112)Voilà.");
    expect(segments[0].command).toEqual({ kind: "move", animation: 7, x: 237, y: 112 });
    expect(segments[1]).toEqual({ text: "Voilà.", command: { kind: "none" }, index: 1 });
  });

  it("garde une commande inconnue et un * final tronqué sans planter", () => {
    expect(splitSpeech("A*ZZB")[0].command).toEqual({ kind: "unknown", raw: "ZZ" });
    expect(splitSpeech("fin*")).toEqual([{ text: "fin", command: { kind: "unknown", raw: "" }, index: 0 }]);
  });

  it("numérote la voix du segment de rang n par n + 1 en hexadécimal majuscule", () => {
    expect([0, 8, 9, 14, 15].map(voiceSuffix)).toEqual(["1", "9", "A", "F", "10"]);
  });
});

describe.skipIf(!hasOriginalFiles)("QUEEN2.JAS du jeu", () => {
  const jas = parseQueenJas(readOriginal("QUEEN.JAS"));
  const raw = readOriginal("QUEEN2.JAS");
  const texts = parseGameTexts(raw, {
    descriptions: jas.descriptionCount,
    names: jas.nameCount,
    rooms: jas.roomCount,
    actorAnimations: jas.actorAnimationCount,
    actorNames: jas.actorNameCount,
    actorFiles: jas.actorFileCount,
  });

  it("compte 1 427 lignes terminées par \\r\\n, qui se découpent exactement : 724 + 325 + 126 + 12 + 40 + 62 + 74 + 64", () => {
    expect(splitLines(raw)).toHaveLength(1427);
    expect(724 + 325 + 126 + 12 + 40 + 62 + 74 + 64).toBe(1427);
    expect(texts.objectDescriptions).toHaveLength(724 + 1);
    expect(texts.objectNames).toHaveLength(325 + 1);
    expect(texts.roomNames).toHaveLength(126 + 1);
    expect(texts.verbs).toHaveLength(12 + 1);
    expect(texts.joeResponses).toHaveLength(40 + 1);
    expect(texts.actorAnimations).toHaveLength(62 + 1);
    expect(texts.actorNames).toHaveLength(74 + 1);
    expect(texts.actorFiles).toHaveLength(64 + 1);
  });

  it("est en Latin-1 : é (0xE9) 362 fois, à 86, ç 43, Ç 18, et aucun octet 0x80 à 0x9F", () => {
    const count = (byte: number) => raw.filter((b) => b === byte).length;
    expect([count(0xe9), count(0xe0), count(0xe7), count(0xc7)]).toEqual([362, 86, 43, 18]);
    expect(raw.some((b) => b >= 0x80 && b <= 0x9f)).toBe(false);
    expect(texts.objectNames[1]).toBe("porte");
    expect(texts.verbs.slice(1, 4)).toEqual(["ouvrir", "fermer", "déplacer"]);
  });

  it("donne aux verbes, aux réponses de Joe et aux acteurs le contenu attendu", () => {
    expect(texts.verbs.slice(1)).toEqual(["ouvrir", "fermer", "déplacer", "----", "donner", "utiliser", "prendre", "parler à", "examiner", "aller vers", "avec", "à"]);
    expect(texts.joeResponses[1]).toBe("On dirait que ça ne s'ouvre pas.*03");
    expect(texts.actorNames.slice(1, 4)).toEqual(["SPARKY", "FAYE", "APE"]);
    expect(texts.actorFiles[1]).toBe("sparky.act");
    expect(texts.actorFiles[64]).toBe("X11_JOE.ACT");
  });

  it("nomme les pièces d'après leurs images : chacune a son décor PCX", () => {
    const pcx = new Set(dataFiles("PCX").map((name) => name.toUpperCase()));
    for (const name of texts.roomNames.slice(1)) expect(pcx.has(`${name}.PCX`), name).toBe(true);
    expect(texts.roomNames.slice(1, 6)).toEqual(["C1", "C2", "C3", "C4", "C5"]);
  });

  it("découpe une réponse de Joe avec sa commande de bouche", () => {
    expect(splitSpeech(texts.objectDescriptions[1])).toEqual([
      { text: "Je ne vois rien de spécial.", command: { kind: "mouth", animation: 24 }, index: 0 },
    ]);
  });
});
