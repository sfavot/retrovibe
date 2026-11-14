import { describe, expect, it } from "vitest";
import { MUSIC_LIST, SFX_DEFS } from "../../../src/games/bass/data/tables/sfx-list";
import { BassSfx } from "../../../src/games/bass/audio/sfx";
import { FakeOutput, buildSfxFile, effectOfDef, standardSounds, type TestSound } from "./sfx-support";

function setup(options: { screen?: number; sounds?: TestSound[]; mainVolume?: number } = {}) {
  const output = new FakeOutput();
  const state = { screen: options.screen ?? 1 };
  const loaded: number[] = [];
  const sfx = new BassSfx({
    output,
    screen: () => state.screen,
    mainVolume: options.mainVolume,
    loadFile: (section) => (loaded.push(section), buildSfxFile(options.sounds ?? standardSounds())),
  });
  sfx.loadSection(1);
  return { sfx, output, state, loaded };
}

/** Gain attendu pour un volume de table `v` et un volume général `m` : `((v * m) >> 8) & 0x7F) << 1` sur 255. */
const gainOf = (v: number, m = 255): number => ((((v * m) >> 8) & 0x7f) << 1) / 255;

// Définitions de `SFX_DEFS` utilisées (voir `data/tables/sfx-list.ts`).
const DEF_ROOM_LIST = 0; // [5, 0, pièce 0 : 50, 255]
const DEF_ALL_ROOMS = 3; // [5, 0, 255, 127]
const DEF_SAVED_ROOM_1 = 2; // [17, 0x20, pièce 1 : 127]
const DEF_SAVED_ALL = 4; // [19, 0x20, 255, 60]
const DEF_DELAYED = 32; // [9, 0x83, 255, 127]

describe("BassSfx : volume par pièce", () => {
  it("joue l'effet dans une pièce de sa liste, au volume de la table (colonne AdLib × volume général)", () => {
    const { sfx, output, state } = setup({ screen: 0 });
    sfx.startFx(effectOfDef(DEF_ROOM_LIST), 0);
    expect(output.played).toHaveLength(1);
    expect(output.played[0]!.options?.volume).toBeCloseTo(gainOf(50), 10);
    expect(output.played[0]!.sample.data).toHaveLength(100);
    state.screen = 3; // pas dans la liste (0 seulement)
    sfx.startFx(effectOfDef(DEF_ROOM_LIST), 1);
    expect(output.played).toHaveLength(1);
  });

  it("une liste qui commence par 255 vaut pour toutes les pièces", () => {
    const { sfx, output, state } = setup({ screen: 77 });
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    state.screen = 3;
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 1);
    expect(output.played.map((p) => p.options?.volume)).toEqual([gainOf(127), gainOf(127)]);
  });

  it("le volume général des effets entre dans le calcul (v × général >> 8)", () => {
    const { sfx, output } = setup({ mainVolume: 128 });
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    expect(output.played[0]!.options?.volume).toBeCloseTo(gainOf(127, 128), 10);
    sfx.volume = 64;
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    expect(output.played[1]!.options?.volume).toBeCloseTo(gainOf(127, 64), 10);
  });

  it("ignore les numéros hors de 256 à 393, et tous les effets quand ils sont coupés", () => {
    const { sfx, output } = setup();
    sfx.startFx(255, 0);
    sfx.startFx(394, 0);
    sfx.startFx(0, 0);
    expect(output.played).toHaveLength(0);
    sfx.fxOff = true;
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    expect(output.played).toHaveLength(0);
  });

  it("l'effet 278 de la pièce 25 devient le 394 (soudure)", () => {
    const weld = 278;
    const normal = SFX_DEFS[MUSIC_LIST[weld - 256]!]!; // [4, 0, 15, ..., 7, ..., 6, ..., 12, ..., 13, ...]
    const replaced = SFX_DEFS[MUSIC_LIST[138]!]!; // [15, 0, 255, 127, 127]
    const room25 = setup({ screen: 25, sounds: standardSounds({ [replaced[0]!]: { rate: 8000, size: 33 } }) });
    room25.sfx.startFx(weld, 0);
    expect(room25.output.played).toHaveLength(1);
    expect(room25.output.played[0]!.sample.data).toHaveLength(33); // le son de l'entrée 394
    const room15 = setup({ screen: 15, sounds: standardSounds({ [normal[0]!]: { rate: 8000, size: 44 } }) });
    room15.sfx.startFx(weld, 0);
    expect(room15.output.played[0]!.sample.data).toHaveLength(44); // pièce 15 : l'effet 278 lui-même
    const other = setup({ screen: 25 });
    other.sfx.startFx(weld + 1, 0); // 279 n'est pas remplacé et n'est pas joué dans la pièce 25
    expect(other.output.played).toHaveLength(0);
  });
});

describe("BassSfx : voies", () => {
  it("deux voies indépendantes ; un nouvel effet remplace celui de sa voie", () => {
    const { sfx, output } = setup();
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 1);
    expect(output.live).toHaveLength(2);
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 2); // voie & 1 = 0 : remplace la première
    expect(output.played[0]!.stopped).toBe(true);
    expect(output.played[1]!.stopped).toBe(false);
    expect(output.live).toHaveLength(2);
  });

  it("stopFx coupe les deux voies", () => {
    const { sfx, output } = setup();
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 1);
    sfx.stopFx();
    expect(output.live).toHaveLength(0);
    expect(sfx.channelActive(0)).toBe(false);
  });

  it("un son hors du fichier est ignoré, un son direct (séquence) joue au volume donné", () => {
    const { sfx, output } = setup();
    sfx.playSound(40, 127, 0); // rang = nombre de sons : hors table
    expect(output.played).toHaveLength(0);
    sfx.playSound(3, 0x7f, 1);
    expect(output.played[0]!.options?.volume).toBeCloseTo(254 / 255, 10);
    sfx.playSound(3, 0x81, 1); // volume & 0x7F
    expect(output.played[1]!.options?.volume).toBeCloseTo(2 / 255, 10);
    expect(output.played[0]!.stopped).toBe(true);
  });
});

describe("BassSfx : file des départs différés", () => {
  it("le départ attend `drapeaux & 0x7F` tours, comptés par checkFxQueue", () => {
    const { sfx, output } = setup();
    sfx.startFx(effectOfDef(DEF_DELAYED), 0);
    expect(output.played).toHaveLength(0);
    sfx.checkFxQueue();
    sfx.checkFxQueue();
    expect(output.played).toHaveLength(0);
    sfx.checkFxQueue(); // 0x83 & 0x7F = 3
    expect(output.played).toHaveLength(1);
    expect(output.played[0]!.options?.volume).toBeCloseTo(gainOf(127), 10);
    sfx.checkFxQueue();
    expect(output.played).toHaveLength(1);
  });

  it("quatre places : le cinquième effet différé est perdu", () => {
    const { sfx, output } = setup();
    for (let i = 0; i < 5; i++) sfx.startFx(effectOfDef(DEF_DELAYED), i & 1);
    for (let i = 0; i < 3; i++) sfx.checkFxQueue();
    expect(output.played).toHaveLength(4);
  });

  it("un effet différé sort au tour voulu même si la voie a servi entre-temps", () => {
    const { sfx, output } = setup();
    sfx.startFx(effectOfDef(DEF_DELAYED), 0);
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    expect(output.played).toHaveLength(1);
    for (let i = 0; i < 3; i++) sfx.checkFxQueue();
    expect(output.played).toHaveLength(2);
    expect(output.played[0]!.stopped).toBe(true); // remplacé par l'effet différé
  });

  it("le changement de section vide la file ; juste après une restauration, il la garde", () => {
    const a = setup();
    a.sfx.startFx(effectOfDef(DEF_DELAYED), 0);
    a.sfx.loadSection(2);
    for (let i = 0; i < 5; i++) a.sfx.checkFxQueue();
    expect(a.output.played).toHaveLength(0);
    const b = setup();
    b.sfx.startFx(effectOfDef(DEF_DELAYED), 0);
    b.sfx.loadSection(2, true);
    for (let i = 0; i < 5; i++) b.sfx.checkFxQueue();
    expect(b.output.played).toHaveLength(1);
  });
});

describe("BassSfx : boucle sur la fin", () => {
  it("rejoue les derniers octets en boucle (loopStart = taille − boucle), pas de boucle sans longueur de boucle", () => {
    const [soundNo] = SFX_DEFS[DEF_ALL_ROOMS]!;
    const { sfx, output } = setup({ sounds: standardSounds({ [soundNo!]: { rate: 8000, size: 100, loop: 30 } }) });
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    expect(output.played[0]!.options?.loopStart).toBe(70);
    output.advance(60_000);
    expect(output.live).toHaveLength(1); // boucle jusqu'à stopFx
    sfx.stopFx();
    expect(output.live).toHaveLength(0);

    const plain = setup();
    plain.sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    expect(plain.output.played[0]!.options?.loopStart).toBeUndefined();
    plain.output.advance(100);
    expect(plain.output.live).toHaveLength(0); // une passe de 100 / 8000 s = 12,5 ms
  });

  it("une boucle aussi longue que le son reboucle tout le son", () => {
    const [soundNo] = SFX_DEFS[DEF_ALL_ROOMS]!;
    const { sfx, output } = setup({ sounds: standardSounds({ [soundNo!]: { rate: 8000, size: 100, loop: 100 } }) });
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    expect(output.played[0]!.options?.loopStart).toBe(0);
  });

  it("les taux sous 3 000 Hz sont rééchantillonnés à 11 025 Hz en gardant la durée et la boucle", () => {
    const [soundNo] = SFX_DEFS[DEF_ALL_ROOMS]!;
    const { sfx, output } = setup({ sounds: standardSounds({ [soundNo!]: { rate: 256, size: 32, loop: 16 } }) });
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    const { sample, options } = output.played[0]!;
    expect(sample.rate).toBe(11025);
    expect(sample.data).toHaveLength(Math.round((32 * 11025) / 256));
    expect(options?.loopStart).toBe(Math.round((16 * 11025) / 256));
  });
});

describe("BassSfx : effets sauvegardés (drapeau 0x20)", () => {
  it("un effet 0x20 est retenu (numéro | volume << 8), vidé par stopFx ou par un effet non retenu de la même voie", () => {
    const { sfx } = setup({ screen: 1 });
    expect(sfx.savedSounds).toEqual([0xffff, 0xffff]);
    sfx.startFx(effectOfDef(DEF_SAVED_ROOM_1), 0);
    sfx.startFx(effectOfDef(DEF_SAVED_ALL), 1);
    const v1 = (127 * 255) >> 8;
    const v2 = (60 * 255) >> 8;
    expect(sfx.savedSounds).toEqual([17 | (v1 << 8), 19 | (v2 << 8)]);
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0); // sans 0x20 : la voie 0 n'est plus retenue
    expect(sfx.savedSounds).toEqual([0xffff, 19 | (v2 << 8)]);
    sfx.stopFx();
    expect(sfx.savedSounds).toEqual([0xffff, 0xffff]);
  });

  it("un effet refusé (hors pièce) vide quand même l'emplacement de sa voie, sans arrêter le son", () => {
    const { sfx, output, state } = setup({ screen: 1 });
    sfx.startFx(effectOfDef(DEF_SAVED_ROOM_1), 0);
    state.screen = 2;
    sfx.startFx(effectOfDef(DEF_SAVED_ROOM_1), 0);
    expect(sfx.savedSounds[0]).toBe(0xffff);
    expect(output.played[0]!.stopped).toBe(false);
  });

  it("restauration : les effets repartent un tour après le chargement, avec leur volume, sur leur voie", () => {
    const first = setup({ screen: 1 });
    first.sfx.startFx(effectOfDef(DEF_SAVED_ROOM_1), 0);
    first.sfx.startFx(effectOfDef(DEF_SAVED_ALL), 1);
    const saved = first.sfx.savedSounds;

    const second = setup({ screen: 1 });
    second.sfx.restoreState(saved);
    second.sfx.loadSection(1, true); // fnEnterSection juste après un chargement de partie
    expect(second.output.played).toHaveLength(0);
    second.sfx.checkFxQueue();
    expect(second.output.played).toHaveLength(2);
    const volumes = second.output.played.map((p) => p.options?.volume);
    expect(volumes[0]).toBeCloseTo(((((127 * 255) >> 8) & 0x7f) << 1) / 255, 10);
    expect(volumes[1]).toBeCloseTo(((((60 * 255) >> 8) & 0x7f) << 1) / 255, 10);
    // ScummVM : relancés par la file, ils ne sont plus retenus pour une nouvelle sauvegarde (`loadSection` a vidé `_saveSounds`)
    expect(second.sfx.savedSounds).toEqual([0xffff, 0xffff]);
  });

  it("restauration avec une seule voie retenue : un seul effet repart", () => {
    const { sfx, output } = setup();
    sfx.restoreState([0xffff, 17 | (100 << 8)]);
    sfx.checkFxQueue();
    expect(output.played).toHaveLength(1);
    expect(output.played[0]!.options?.volume).toBeCloseTo(200 / 255, 10);
  });
});

describe("BassSfx : pause", () => {
  it("pauseFx arrête les voies, unPauseFx les reprend à la même position", () => {
    const { sfx, output } = setup({ sounds: standardSounds({ 5: { rate: 5000, size: 100 } }) }); // 20 ms
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0); // son 5
    output.advance(8); // 40 échantillons
    sfx.pauseFx();
    expect(output.live).toHaveLength(0);
    expect(sfx.channelActive(0)).toBe(true); // figée, pas finie
    output.advance(10_000);
    sfx.unPauseFx();
    const resumed = output.played[1]!;
    expect(resumed.sample.data).toHaveLength(60); // 100 − 40 échantillons
    expect(resumed.sample.data[0]).toBe(output.played[0]!.sample.data[40]);
    expect(resumed.options?.volume).toBe(output.played[0]!.options?.volume);
    output.advance(11.5); // 60 échantillons = 12 ms
    expect(output.live).toHaveLength(1);
    output.advance(0.5);
    expect(output.live).toHaveLength(0);
  });

  it("un effet fini avant la pause n'est pas relancé", () => {
    const { sfx, output } = setup();
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    output.advance(1000);
    sfx.pauseFx();
    sfx.unPauseFx();
    expect(output.played).toHaveLength(1);
  });

  it("reprise d'un son en boucle : dans la boucle, la boucle entière se répète ensuite", () => {
    const [soundNo] = SFX_DEFS[DEF_ALL_ROOMS]!;
    const { sfx, output } = setup({ sounds: standardSounds({ [soundNo!]: { rate: 5000, size: 100, loop: 20 } }) });
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    output.advance(18); // 90 échantillons, dans la partie jouée une fois (boucle sur [80, 100[)
    sfx.pauseFx();
    sfx.unPauseFx();
    let resumed = output.played[1]!;
    expect(resumed.sample.data).toHaveLength(10 + 20); // fin de la première passe puis la boucle
    expect(resumed.options?.loopStart).toBe(10);
    output.advance(23); // 115 échantillons : position 80 + ((90 + 115 − 80) % 20) = 85
    sfx.pauseFx();
    sfx.unPauseFx();
    resumed = output.played[2]!;
    expect(resumed.sample.data).toHaveLength(15 + 20);
    expect(resumed.options?.loopStart).toBe(15);
    sfx.stopFx();
    expect(output.live).toHaveLength(0);
  });

  it("un effet lancé pendant la pause joue ; la pause ne le concerne pas", () => {
    const { sfx, output } = setup();
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    sfx.pauseFx();
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    expect(output.played).toHaveLength(2);
    sfx.unPauseFx();
    expect(output.played).toHaveLength(2); // la voie 0 a été remplacée : rien à reprendre
  });
});

describe("BassSfx : sections", () => {
  it("loadSection charge le fichier de la section et coupe les voies", () => {
    const { sfx, output, loaded } = setup();
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    sfx.loadSection(4);
    expect(loaded).toEqual([1, 4]);
    expect(output.live).toHaveLength(0);
  });

  it("avant tout chargement de section, rien ne joue", () => {
    const output = new FakeOutput();
    const sfx = new BassSfx({ output, screen: () => 1, loadFile: () => buildSfxFile(standardSounds()) });
    sfx.startFx(effectOfDef(DEF_ALL_ROOMS), 0);
    sfx.playSound(1, 100, 0);
    expect(output.played).toHaveLength(0);
  });
});
