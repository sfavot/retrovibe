import { FRAME_TICKS } from "../../../src/games/drascula/engine/cadence";
import type { SaveData } from "../../../src/games/drascula/engine/save";
import type { GameState } from "../../../src/games/drascula/engine/state";
import { createSaveSlots } from "../../../src/games/drascula/ui/saves";
import { FakeStorage } from "../../support/fake-host";
import { Player } from "../engine/test-host";
import { playChapter6Intro } from "../solutions";
import { Walkthrough, type WalkthroughOptions, scriptWithout } from "../walkthrough";

/**
 * Comment la partie sauvegardée est reprise : `fresh` dans un moteur tout neuf qui ne sait rien d'autre que la sauvegarde (la reprise depuis
 * l'écran titre) ; `other-chapter` dans un moteur déjà en jeu, dans un autre chapitre (`loadGame` en cours de partie, avec changement de chapitre).
 */
export type ResumeMode = "fresh" | "other-chapter";

/**
 * Un `Walkthrough` qui, au `at`-ième repos du jeu (retour de `settle()`), sauvegarde la partie dans un emplacement, la recharge dans un autre
 * moteur et continue la solution sur ce moteur : si la partie reprise n'est pas exactement la partie sauvegardée, les attentes de la solution
 * (drapeaux, pièce, inventaire, chapitre suivant) échouent. `at: 0` ne fait rien : on dénombre alors les repos où l'on peut sauvegarder.
 */
export class CheckpointWalkthrough extends Walkthrough {
  /** Numéros (à partir de 1) des repos où l'on pouvait sauvegarder, dans l'ordre de la solution. Inventaire ouvert, on ne compte pas : il se referme au chargement, comme dans ScummVM. */
  readonly savable: number[] = [];
  /** Après la bascule : pixels différents entre l'image juste avant la sauvegarde et celle de la partie reprise. */
  pixelDiff: number | null = null;
  /** Après la bascule : ce qui diffère dans l'état (`stateDifferences`), la pièce et l'état d'avant. */
  differences: string[] = [];
  roomAtSwap: number | null = null;
  before: GameState | null = null;
  readonly slots = createSaveSlots(new FakeStorage());
  private rests = 0;

  constructor(
    options: WalkthroughOptions,
    private readonly at = 0,
    private readonly mode: ResumeMode = "fresh",
  ) {
    super({ ...options, settle: false });
    if (options.chapter === 6) return; // l'introduction attend des clics : l'appelant la joue
    this.player.settle();
  }

  override settle(limit?: number): this {
    super.settle(limit);
    if (this.engine.canSave && !this.state.menuScreen) {
      this.rests++;
      this.savable.push(this.rests);
      if (this.rests === this.at) this.swap();
    }
    return this;
  }

  private swap(): void {
    const old = this.player;
    // La souris loin de tout : ni nom d'objet survolé ni curseur dans l'image qu'on compare.
    old.move(319, 199);
    old.run(FRAME_TICKS);
    const data = old.engine.saveGame();
    if (!data) throw new Error("sauvegarde refusée au repos");
    if (data.flags === old.state.flags || data.inventory === old.state.inventory || data.hero === old.state.hero || data.anim === old.state.anim) {
      throw new Error("la sauvegarde partage une structure avec l'état");
    }
    if (!this.slots.write(1, data, 0)) throw new Error("écriture refusée");
    const stored = this.slots.read(1);
    if (!stored) throw new Error("sauvegarde illisible");
    old.engine.render();
    const shown = Uint8Array.from(old.host.screen!);

    const player = this.mode === "fresh" ? this.freshEngine(stored.save) : this.otherChapterEngine(stored.save);
    player.host.sounds.push(...old.host.sounds); // les attentes de la solution comptent les voix depuis un repère
    player.host.exits = old.host.exits;
    player.move(319, 199);
    player.settle();
    player.run(FRAME_TICKS);
    this.differences = stateDifferences(old.state, player.state);
    // Les images d'animation avancent avec le temps pendant que la pièce rejoue son entrée : seul le temps les distingue.
    Object.assign(player.state.anim, old.state.anim);
    player.engine.render();
    this.pixelDiff = shown.reduce((n, pixel, i) => n + (pixel === player.host.screen![i] ? 0 : 1), 0);
    this.before = old.state;
    this.roomAtSwap = old.state.room?.number ?? null;
    (this as { player: Player }).player = player;
  }

  private freshEngine(save: SaveData): Player {
    return new Player({ seed: 1, script: scriptWithout("1_1"), restore: save });
  }

  private otherChapterEngine(save: SaveData): Player {
    const player = new Player({ seed: 1, chapter: save.chapter === 1 ? 4 : 1, script: scriptWithout("1_1") });
    player.settle();
    if (player.state.chapter === save.chapter) throw new Error("le moteur d'accueil doit être dans un autre chapitre");
    if (!player.engine.loadGame(save)) throw new Error("chargement refusé");
    return player;
  }
}

/**
 * Les champs de l'état qui diffèrent entre deux parties, hors ce que seul le temps change (images d'animation, dates) et ce qui est
 * transitoire (nom sous le curseur, écran d'inventaire). Pièce : son numéro et ses objets (visibilité, portes, zones). Le héros invisible
 * (pendule du chapitre 6) dérive de lui-même : sa position n'est pas comparée.
 */
export function stateDifferences(a: GameState, b: GameState): string[] {
  const out: string[] = [];
  const skip = new Set(["hasName", "textName", "menuScreen", "menuBar", "previousMusic", "anim", "savedTime", "room", "hero"]);
  const differ = (x: unknown, y: unknown) => JSON.stringify(x) !== JSON.stringify(y);
  for (const key of Object.keys(a) as (keyof GameState)[]) {
    if (!skip.has(key) && differ(a[key], b[key])) out.push(`${key}: ${JSON.stringify(a[key])} -> ${JSON.stringify(b[key])}`);
  }
  if (differ(a.room?.number, b.room?.number)) out.push(`room: ${a.room?.number} -> ${b.room?.number}`);
  if (differ(a.room?.objects, b.room?.objects)) out.push(`room.objects diffèrent (pièce ${a.room?.number})`);
  const ignored = new Set(["startTime", ...(a.hero.visible ? [] : ["x", "y", "frame", "scaledWidth", "scaledHeight"])]);
  for (const field of Object.keys(a.hero) as (keyof GameState["hero"])[]) {
    if (!ignored.has(field) && a.hero[field] !== b.hero[field]) out.push(`hero.${field}: ${a.hero[field]} -> ${b.hero[field]}`);
  }
  return out;
}

/** Démarre le chapitre `chapter` comme les tests de passage : le chapitre 6 avec son introduction jouée. */
export function startCheckpoint(chapter: number, at: number, mode: ResumeMode = "fresh"): CheckpointWalkthrough {
  const w = new CheckpointWalkthrough({ chapter }, at, mode);
  if (chapter === 6) playChapter6Intro(w);
  return w;
}
