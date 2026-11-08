import { describe, expect, it } from "vitest";
import { parseCutaway } from "../../../src/games/fotaq/data/cut";
import { parseDog } from "../../../src/games/fotaq/data/dog";
import { GameFiles, parseVoiceName } from "../../../src/games/fotaq/data/files";
import { parseQueenJas } from "../../../src/games/fotaq/data/jas";
import { readSongBank } from "../../../src/games/fotaq/data/music";
import { decodePcx } from "../../../src/games/fotaq/data/pcx";
import { parseGameTexts } from "../../../src/games/fotaq/data/text";
import {
  composePalette,
  cutExtraEntry,
  decorHeightClass,
  describeVoice,
  dialogsByKey,
  dogLevels,
  family,
  familyOf,
  isGameRoom,
  lastObjectImage,
  lastObjectPositions,
  maskHistogram,
  maskRowColor,
  neighborAreas,
  roomObjects,
  roomsByImage,
  sentenceVoices,
  songRow,
  stem,
} from "../../../src/games/fotaq/ui/viewer-data";
import { dataFiles, hasOriginalFiles, readManifest, readOriginal } from "../helpers";

describe("groupes de la barre latérale", () => {
  it("range chaque famille de fichiers dans son groupe", () => {
    expect(family("B1.PCX")).toBe("Images : décors et écrans (PCX)");
    expect(family("JOE_A.BBK")).toBe("Banques : objets et personnages (BBK)");
    expect(family("AMAZON.ACT")).toBe("Banques : acteurs (ACT)");
    expect(family("T26A.SAM")).toBe("Banques : sprites (SAM, pas des sons)");
    expect(family("B1.MSK")).toBe(family("B1.LUM"));
    expect(family("QUEEN.JAS")).toBe("Données logiques");
    expect(family("QUEEN2.JAS")).toBe("Textes");
    expect(family("AND1.DOG")).toBe("Dialogues (DOG)");
    expect(family("C21A.CUT")).toBe("Cinématiques (CUT)");
    expect(family("CREDIT1.CRD")).toBe("Génériques");
    expect(family("DATA")).toBe("Génériques");
    expect(family("AQ.RL")).toBe("Musique : tables de morceaux (MIDI)");
    expect(family("README-FOTAQ.txt")).toBe("Documentation");
  });

  it("classe les voix par famille ; un nom de cinématique n'est reconnu que s'il existe", () => {
    expect(family("voices/020001P2.mp3")).toBe("Voix : dialogue 02");
    expect(family("voices/12SSSSJ1.mp3")).toBe("Voix : dialogue 12");
    expect(family("voices/JOE00011.mp3")).toBe("Voix : Joe, réponses");
    expect(family("voices/JOE00411.mp3")).toBe("Voix : Joe, descriptions");
    expect(family("voices/BLANK000.mp3")).toBe("Voix : effets");
    const cutaways = new Set(["C21A"]);
    expect(family("voices/C21A_012.mp3", cutaways)).toBe("Voix : cinématique C21A");
    expect(family("voices/MON_0001.mp3", cutaways)).toBe("Voix : effets");
  });

  it("familyOf prend les cinématiques du manifeste", () => {
    const files = new GameFiles([
      { path: "C21A.CUT", size: 1 },
      { path: "voices/C21A_012.mp3", size: 1 },
      { path: "voices/MON_0001.mp3", size: 1 },
    ]);
    expect(familyOf(files)({ path: "voices/C21A_012.mp3" })).toBe("Voix : cinématique C21A");
    expect(familyOf(files)({ path: "voices/MON_0001.mp3" })).toBe("Voix : effets");
    expect(stem("dir/Lev.bin")).toBe("LEV");
  });
});

describe("palette composée", () => {
  it("prend 0 à 143 du décor et 144 à 255 du panneau", () => {
    const decor = new Uint8Array(768).fill(1);
    const panel = new Uint8Array(768).fill(2);
    const palette = composePalette(decor, panel);
    expect(palette[143 * 3 + 2]).toBe(1);
    expect(palette[144 * 3]).toBe(2);
    expect(palette[767]).toBe(2);
    expect(composePalette(decor, panel, 256)[767]).toBe(1);
  });
});

describe("pièces et masques", () => {
  it("classe les hauteurs de décor et les pièces de jeu", () => {
    expect(decorHeightClass(150)).toBe("150");
    expect(decorHeightClass(200)).toBe("200");
    expect(decorHeightClass(256)).toBe("autre");
    expect(isGameRoom(75)).toBe(true);
    expect(isGameRoom(76)).toBe(false);
    expect(isGameRoom(97)).toBe(true);
    expect(isGameRoom(105)).toBe(false);
  });

  it("compte les cellules du masque par ligne de la table et hors table", () => {
    const mask = new Uint8Array(8000);
    mask[1] = 3;
    mask[2] = 255;
    const histogram = maskHistogram(mask);
    expect(histogram.rows[0]).toBe(7998);
    expect(histogram.rows[3]).toBe(1);
    expect(histogram.other).toBe(1);
    expect(maskRowColor(8)).toMatch(/^rgba\(255,255,255/);
    expect(maskRowColor(2)).toMatch(/^hsla\(90,/);
  });

  it("lit les zones voisines dans les bits (supposé)", () => {
    expect(neighborAreas(5)).toEqual([1, 3]);
    expect(neighborAreas(0)).toEqual([]);
  });

  it("deux pièces peuvent partager un décor", () => {
    const texts = { roomNames: ["", "N8", "n8", "B1", ""] } as unknown as Parameters<typeof roomsByImage>[0];
    expect([...roomsByImage(texts)]).toEqual([["N8", [1, 2]], ["B1", [3]]]);
  });
});

describe("voix d'une réplique", () => {
  const has = (path: string) => path === "voices/110006J1.mp3" || path === "voices/110006J2.mp3";

  it("donne une voix par segment et saute les segments « saisir » et les segments vides sans fichier", () => {
    const voices = sentenceVoices("110006J", "Bonjour*17Joe*GDÇa va?*05*04", has);
    expect(voices.map((v) => [v.segment, v.voice, v.exists])).toEqual([
      [1, "110006J1", true],
      [2, null, false],
      [3, "110006J3", false],
      [4, null, false],
    ]);
  });
});

describe("section supplémentaire d'un .CUT", () => {
  it("nomme les sept mots", () => {
    expect(cutExtraEntry([679, 0, 546, 129, 100, 1000, 1])).toEqual({ object: 679, entryObject: 0, x: 546, y: 129, room: 100, image: 1000, state: 1 });
  });

  it("déduit la dernière image et la dernière position d'un objet des enregistrements", () => {
    const record = (objectNumber: number, bobStartX: number, bobStartY: number, moveToX: number, moveToY: number, animations: { object: number; unpackFrame: number; flip: boolean }[]) => ({ objectNumber, bobStartX, bobStartY, moveToX, moveToY, animations });
    const cut = {
      objects: [record(5, 10, 20, 0, 0, [{ object: 5, unpackFrame: 3, flip: true }]), record(5, 0, 0, 30, 40, [{ object: 5, unpackFrame: 0, flip: false }]), record(6, 0, 0, 0, 0, [])],
    } as unknown as Parameters<typeof lastObjectImage>[0];
    expect(lastObjectPositions(cut, 5)).toEqual([{ x: 30, y: 40 }]);
    expect(lastObjectPositions(cut, 6)).toEqual([]);
    expect(lastObjectImage(cut, 5)).toBe(1000);
    expect(lastObjectImage(cut, 6)).toBeNull();
    cut.objects.pop();
    cut.objects.pop();
    expect(lastObjectImage(cut, 5)).toBe(-3);
  });
});

describe.skipIf(!hasOriginalFiles)("sur les fichiers du jeu", () => {
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
  const cuts = dataFiles("CUT").map((name) => ({ name, cut: parseCutaway(readOriginal(name), isPerson) }));
  const dogs = dataFiles("DOG").map((name) => ({ name, dog: parseDog(readOriginal(name)) }));

  it("liste les objets d'une pièce avec leur nom et leur boîte", () => {
    const rows = roomObjects(jas, texts, 1);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({ number: 1, name: "sac marin", box: { x1: 121, y1: 105, x2: 148, y2: 133 } });
  });

  it("hauteurs des décors : toutes les pièces d'écran font 200 lignes, les pièces de jeu 150 (44) ou 200 (39)", () => {
    const counts = { game: { "150": 0, "200": 0, autre: 0 }, screen: { "150": 0, "200": 0, autre: 0 } };
    for (let room = 1; room <= jas.roomCount; room++) {
      const { height } = decodePcx(readOriginal(`${texts.roomNames[room]}.PCX`));
      counts[isGameRoom(room) ? "game" : "screen"][decorHeightClass(height)]++;
    }
    expect(counts).toEqual({ game: { "150": 44, "200": 39, autre: 0 }, screen: { "150": 0, "200": 43, autre: 0 } });
  });

  it("section supplémentaire des .CUT : la pièce, la position et l'image de fin se déduisent des enregistrements", () => {
    let total = 0;
    let positions = 0;
    let positionHits = 0;
    let withAnimation = 0;
    let imageHits = 0;
    let sameRoomAsObject = 0;
    for (const { cut } of cuts) {
      for (const words of cut.extra.entries) {
        const entry = cutExtraEntry(words);
        total++;
        if (jas.objects[entry.object].room === entry.room) sameRoomAsObject++;
        if (entry.x !== 0 || entry.y !== 0) {
          positions++;
          if (lastObjectPositions(cut, entry.object).some((p) => p.x === entry.x && p.y === entry.y)) positionHits++;
        }
        const image = lastObjectImage(cut, entry.object);
        if (image !== null) {
          withAnimation++;
          if (image === entry.image) imageHits++;
        }
      }
    }
    expect(total).toBe(333);
    expect(positions).toBe(230);
    expect(positionHits).toBe(230);
    expect(withAnimation).toBe(234);
    expect(imageHits).toBe(231);
    expect(sameRoomAsObject).toBe(323);
  });

  it("arbres .DOG : chaque valeur de nœud désigne un niveau existant ou -1, le niveau de départ a la tête 1", () => {
    for (const { name, dog } of dogs) {
      const levels = dogLevels(dog);
      expect(levels, name).toHaveLength(dog.levelCount);
      expect(
        levels.some((level) => level.head === 1),
        name,
      ).toBe(true);
      for (const level of levels) {
        for (const option of level.options) {
          if (option.option.node === 0) continue;
          expect(option.next === undefined && option.option.node > 0, `${name} niveau ${level.head} option ${option.index}`).toBe(false);
        }
      }
    }
  });

  it("décrit les voix : dialogue, cinématique, réponse de Joe, effet", () => {
    const loaded = dialogsByKey(dogs);
    const data = { jas, texts, dialogs: loaded };
    const cutaways = new Set(cuts.map(({ name }) => stem(name)));
    expect(describeVoice(parseVoiceName("020001P2", cutaways), data)).toMatchObject({ text: "Tu ne pourrais même pas piloter dans un simulateur!" });
    const c21a = cuts.find(({ name }) => name === "C21A.CUT")!.cut;
    expect(describeVoice(parseVoiceName("C21A_012", cutaways), { ...data, cut: c21a }).text).toBe("Je voudrais acheter ceci.");
    expect(describeVoice(parseVoiceName("JOE00011", cutaways), data).origin).toContain("réponse de Joe 1");
    expect(describeVoice(parseVoiceName("BLANK000", cutaways), data).text).toBeNull();
  });

  it("résume les tables de morceaux", () => {
    const roland = readSongBank(readOriginal("AQ.RL")).songs.map(songRow);
    expect(roland).toHaveLength(106);
    expect(roland.filter((song) => song.defect !== "")).toHaveLength(2);
    expect(roland[48].defect).toBe("souche de 22 octets");
    expect(roland[88].defect).toBe("piste coupée");
  });

  it("le manifeste ne contient que des fichiers qui ont un groupe", () => {
    const files = new GameFiles(readManifest());
    const group = familyOf(files);
    for (const entry of files.entries) expect(group(entry), entry.path).not.toBe("");
  });
});
