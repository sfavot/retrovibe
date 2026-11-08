import { FotaqCutaways } from "../../../src/games/fotaq/engine/cutaway";
import { FotaqTalk } from "../../../src/games/fotaq/engine/dialogs";
import { FotaqEngine } from "../../../src/games/fotaq/engine/loop";
import { resetRoomImages } from "../../../src/games/fotaq/engine/room";
import { type SaveData, type SavedBam, restoreState } from "../../../src/games/fotaq/engine/save";
import { fotaqScript } from "../../../src/games/fotaq/engine/specials";
import { GameStage } from "../../../src/games/fotaq/engine/stage";
import type { GameState } from "../../../src/games/fotaq/engine/state";
import { createSaveSlots } from "../../../src/games/fotaq/ui/saves";
import { SONGS, TUNES } from "../../../src/games/fotaq/audio/tables";
import { FakeStorage } from "../../support/fake-host";
import { TestHost, gameData } from "../engine/test-host";
import { Walkthrough, type WalkthroughOptions } from "../walkthrough";

/** Hôte de test qui retient le dernier morceau de musique, comme `FotaqAudio.lastSong` (`Sound::_lastOverride`). */
export class SongHost extends TestHost {
  last = 0;

  override playSong(song: number): void {
    super.playSong(song);
    const entry = SONGS[song - 1];
    if (entry && entry.override === 1 && !TUNES[entry.tune - 1]?.sfx) this.last = song;
  }

  lastSong(): number {
    return this.last;
  }
}

/** Le même moteur que `Walkthrough`, sur un hôte qui connaît `lastSong`. */
export function newSongHost(from?: TestHost): SongHost {
  const host = new SongHost();
  if (from) {
    host.voices = from.voices;
    host.clock = from.clock;
    host.exits = from.exits;
    host.songs.push(...from.songs);
    host.spoken.push(...from.spoken);
    if (from instanceof SongHost) host.last = from.last;
  }
  return host;
}

/** Les différences d'état entre la sauvegarde `save` (images remises en ordre comme à une sortie de pièce) et le moteur qui l'a reprise. */
export function stateDifferences(save: SaveData, engine: FotaqEngine): string[] {
  const expected = restoreState(save);
  resetRoomImages({ data: engine.data, state: expected }, expected.room);
  const actual = engine.state;
  const out: string[] = [];
  const differ = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
  const keys: (keyof GameState)[] = ["room", "entryObject", "objects", "items", "areas", "walkOffs", "objectDescriptions", "gameStates", "talkSelected", "inventory", "puzzleAttemptCount"];
  for (const key of keys) {
    if (!differ(expected[key], actual[key])) continue;
    const a = expected[key];
    const b = actual[key];
    if (Array.isArray(a) && Array.isArray(b)) {
      const index = a.findIndex((row, i) => differ(row, b[i]));
      out.push(`${key}[${index}] : ${JSON.stringify(a[index])} -> ${JSON.stringify(b[index])}`);
    } else {
      out.push(`${key} : ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    }
  }
  for (const key of ["x", "y", "facing", "prevFacing", "scale"] as const) {
    if (expected.joe[key] !== actual.joe[key]) out.push(`joe.${key} : ${expected.joe[key]} -> ${actual.joe[key]}`);
  }
  return out;
}

/** Les animations des bobs sont figées sur leur première image : deux moteurs ne les ont jamais dans la même phase. */
export function freezeAnimations(stage: GameStage): void {
  for (let n = 0; n < 64; n++) {
    const bob = stage.bobs.bob(n);
    if (!bob.animating) continue;
    bob.frameNum = bob.anim.string ? (bob.anim.string[0]?.frame ?? bob.frameNum) : bob.anim.normal.firstFrame;
    bob.animating = false;
  }
}

export let lastDiffBox = "";

/** Hauteur de la zone de jeu (au-dessous : le panneau et la ligne de commande). */
const ROOM_ROWS = 150;

/** Un moteur et ce qui l'entoure. */
export interface Rig {
  host: TestHost;
  stage: GameStage;
  engine: FotaqEngine;
}

/** Nombre de pixels de l'écran de jeu (hors panneau) qui diffèrent entre deux moteurs, animations figées. */
export function roomPixelDiff(a: Rig, b: Rig): number {
  // Un pixel est le même si l'indice ou la couleur affichée l'est : la lumière dynamique change l'indice d'un même pixel selon la phase,
  // et les couleurs qui tournent changent la couleur d'un même indice.
  const shot = (rig: Rig): { pixels: Uint8Array; palette: Uint8Array } => {
    freezeAnimations(rig.stage);
    rig.engine.render();
    const { pixels, palette } = rig.host.frames.at(-1)!;
    return { pixels: pixels.slice(0, 320 * ROOM_ROWS), palette: palette.slice() };
  };
  const x = shot(a);
  const y = shot(b);
  let minX = 999, minY = 999, maxX = -1, maxY = -1;
  const count = x.pixels.reduce((n, pixel, i) => {
    const other = y.pixels[i];
    if (pixel === other || [0, 1, 2].every((c) => x.palette[pixel * 3 + c] === y.palette[other * 3 + c])) return n;
    minX = Math.min(minX, i % 320); maxX = Math.max(maxX, i % 320); minY = Math.min(minY, Math.trunc(i / 320)); maxY = Math.max(maxY, Math.trunc(i / 320));
    return n + 1;
  }, 0);
  lastDiffBox = count ? `${minX},${minY}-${maxX},${maxY}` : "";
  return count;
}

/** Ce que l'on relève à chaque bascule. */
export interface Swap {
  /** Numéro (à partir de 1) du repos où l'on a basculé. */
  rest: number;
  room: number;
  /** Ce qui diffère dans l'état entre la sauvegarde et le moteur qui l'a reprise (`stateDifferences`). */
  differences: string[];
  /** Pixels de l'écran de jeu qui diffèrent entre l'ancien moteur et le nouveau, et la boîte qui les contient. */
  pixelDiff: number;
  box: string;
  save: SaveData;
  /** Ligne de la table de la course ou du combat, de l'ancien moteur et du nouveau, une image plus tard. */
  bamBefore: SavedBam;
  bamAfter: SavedBam;
  /** Le nouveau moteur, une fois la partie reprise : la tenue (état du jeu et banques de la scène), la lumière, le dernier morceau. */
  outfit: number;
  stageOutfit: number;
  dark: boolean;
  lastSong: number;
  /** Taille du JSON de l'emplacement. */
  bytes: number;
}

/**
 * Un `Walkthrough` qui, aux repos choisis par `when` (retour de `settle()` où l'on peut sauvegarder), sauvegarde la partie dans un
 * emplacement, la recharge dans un **moteur neuf** (hôte, scène, répliques et cinématiques neufs ; option `restore`) et continue la
 * solution sur ce moteur : si la partie reprise n'est pas exactement la partie sauvegardée, les attentes de la solution (pièces,
 * états, objets d'inventaire) échouent. Chaque bascule compare aussi l'état et l'image de l'ancien et du nouveau moteur.
 */
export class CheckpointWalkthrough extends Walkthrough {
  readonly swaps: Swap[] = [];
  readonly slots = createSaveSlots(new FakeStorage());
  /** Les repos où l'on pouvait sauvegarder, dans l'ordre : numéro du repos, pièce, course ou combat en cours. */
  readonly savable: { rest: number; room: number; bam: boolean }[] = [];
  /** Nombre de `settle()` joués. */
  rests = 0;
  /** Choisit les repos de bascule ; `index` est le rang du repos parmi ceux où l'on peut sauvegarder. */
  when: (rest: number, index: number, w: CheckpointWalkthrough) => boolean = () => false;

  constructor(options: WalkthroughOptions = {}) {
    super({ ...options, voices: options.voices ?? false, host: new SongHost() });
  }

  override settle(limit?: number): number {
    const ticks = super.settle(limit);
    this.rests++;
    // Un verbe choisi qui attend son objet n'est pas repris au chargement (comme ScummVM, la commande repart de zéro) : la solution,
    // qui joue la suite du clic, n'y survivrait pas. Le reste est un repos où la sauvegarde est permise.
    if (this.engine.canSave && !this.engine.command.pending) {
      this.savable.push({ rest: this.rests, room: this.room, bam: this.stage.bam.flag !== 0 });
      if (this.when(this.rests, this.savable.length - 1, this)) this.swap();
    }
    return ticks;
  }

  /** Sauvegarde dans l'emplacement 1 (lève si le moteur refuse) et rend ce que le stockage en relit. */
  save(): SaveData {
    const data = this.engine.saveGame();
    if (!data) throw new Error("sauvegarde refusée au repos");
    if (!this.slots.write(1, data, 0)) throw new Error("écriture refusée");
    const stored = this.slots.read(1);
    if (!stored) throw new Error("emplacement illisible");
    return stored.save;
  }

  /** Sauvegarde, recharge dans un moteur neuf, compare, remplace l'ancien moteur. */
  swap(): Swap {
    const save = this.save();
    const bytes = JSON.stringify(save).length;
    const before: Rig = { host: this.host, stage: this.stage, engine: this.engine };
    const { mouseX, mouseY } = before.engine.input;

    const host = newSongHost(this.host);
    host.last = 0; // le dernier morceau ne peut venir que de la sauvegarde
    const stage = new GameStage();
    const talk = new FotaqTalk();
    const cutaways = new FotaqCutaways();
    cutaways.played.push(...this.cutaways.played);
    const engine = new FotaqEngine(host, { data: gameData(), seed: 1, script: fotaqScript, stage, talk, cutaways, restore: save });
    Object.assign(this, { host, stage, talk, cutaways, engine });
    super.settle();
    return this.compare(before, save, mouseX, mouseY, bytes);
  }

  /**
   * Charge `save` dans le moteur **en cours** (une partie déjà avancée, qui reprend un moment plus ancien) au lieu d'en créer un
   * neuf, puis compare comme `swap`.
   */
  reload(save: SaveData): Swap {
    const before: Rig = { host: this.host, stage: this.stage, engine: this.engine };
    const { mouseX, mouseY } = before.engine.input;
    // L'image « d'avant » est celle de la partie sauvegardée, rejouée dans un moteur neuf : le moteur en cours est celui qu'on recharge.
    const reference = new GameStage();
    const refHost = newSongHost(this.host);
    const refEngine = new FotaqEngine(refHost, { data: gameData(), seed: 1, script: fotaqScript, stage: reference, talk: new FotaqTalk(), cutaways: new FotaqCutaways(), restore: save });
    for (let i = 0; i < 400 && refEngine.busy; i++) {
      refHost.clock += 100;
      refEngine.tick();
    }
    if (!this.engine.loadGame(save)) throw new Error("chargement refusé");
    super.settle();
    return this.compare({ host: refHost, stage: reference, engine: refEngine }, save, mouseX, mouseY, JSON.stringify(save).length);
  }

  private compare(before: Rig, save: SaveData, mouseX: number, mouseY: number, bytes: number): Swap {
    // Une image de plus des deux côtés, la souris au même endroit : la course et le combat appliquent la même ligne de leur table.
    for (const rig of [before, this]) {
      rig.host.push({ type: "pointer", x: mouseX, y: mouseY, buttons: 0 });
      rig.host.clock += 100;
      rig.engine.tick();
    }
    const swap: Swap = {
      rest: this.rests,
      room: this.room,
      differences: stateDifferences(save, this.engine),
      pixelDiff: roomPixelDiff(before, this),
      box: lastDiffBox,
      save,
      bamBefore: before.stage.bam.snapshot(),
      bamAfter: this.stage.bam.snapshot(),
      outfit: this.engine.gameState(19),
      stageOutfit: this.stage.outfit,
      dark: this.stage.display.palette.dark,
      lastSong: (this.host as SongHost).last,
      bytes,
    };
    this.swaps.push(swap);
    return swap;
  }
}
