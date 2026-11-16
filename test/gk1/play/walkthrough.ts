/**
 * Déroulé d'un parcours par étapes, avec points de reprise (`docs/gk1/qa.md`).
 *
 * Une étape commence là où le joueur a la main (en général à l'arrivée dans une pièce) : son point de reprise est pris à
 * cet instant. `runStages` les joue dans l'ordre et vérifie le score à la fin de chacune.
 *
 * - `PLAY_CHECKPOINTS=<dossier>` : écrit le point de reprise de chaque étape dans `<dossier>/<nom>.json` ;
 * - `PLAY_FROM=<nom>` : repart du point de reprise de cette étape (lu dans ce dossier) au lieu de rejouer ce qui précède.
 *
 * Les points de reprise sont des images de sauvegarde du moteur (`engine/save.ts`) : ils cessent d'être lisibles quand
 * leur format change (`SAVE_VERSION`) ; il suffit alors de rejouer le parcours pour les récrire.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SaveImage } from "../../../src/games/gk1/engine/save";
import { Play, PlayError, type PlayOptions } from "./harness";

export interface Stage {
  /** Nom court, sans espace : c'est aussi le nom du fichier du point de reprise. */
  readonly name: string;
  /** Ce que l'étape fait, pour le journal et les messages d'échec. */
  readonly title: string;
  /** Score attendu à la fin de l'étape. */
  readonly score: number;
  run(play: Play): void;
}

export interface StageRun {
  readonly play: Play;
  /** Score à la fin de chaque étape jouée, dans l'ordre. */
  readonly scores: { name: string; score: number }[];
}

export interface StageOptions extends PlayOptions {
  /** Dossier des points de reprise (défaut : `PLAY_CHECKPOINTS`). */
  checkpointDir?: string;
  /** Étape d'où repartir (défaut : `PLAY_FROM`). */
  from?: string;
  /** Partie déjà en cours à continuer (les étapes d'un jour à la suite de celles du précédent). */
  play?: Play;
  /** Appelé à l'entrée de chaque étape où un point de reprise peut être pris (un test y garde une image pour une variante). */
  onStage?: (name: string, play: Play) => void;
}

/** Chemin du point de reprise d'une étape. */
export function checkpointPath(dir: string, stage: string): string {
  return resolve(dir, `${stage}.json`);
}

/**
 * Joue les étapes. La première part d'une partie neuve (ou de `options.play`) ; avec `from`, la partie repart du point de
 * reprise de cette étape. Une étape qui finit avec un autre score que prévu arrête le parcours.
 */
export function runStages(stages: readonly Stage[], options: StageOptions = {}): StageRun {
  const dir = options.checkpointDir ?? process.env.PLAY_CHECKPOINTS;
  const from = options.from ?? process.env.PLAY_FROM;
  let first = 0;
  let play = options.play;
  if (from !== undefined && stages.some((stage) => stage.name === from)) {
    if (!dir) throw new PlayError("PLAY_FROM demande PLAY_CHECKPOINTS : le dossier des points de reprise");
    const path = checkpointPath(dir, from);
    if (!existsSync(path)) throw new PlayError(`pas de point de reprise ${path} : rejouer le parcours avec PLAY_CHECKPOINTS=${dir}`);
    first = stages.findIndex((stage) => stage.name === from);
    play = Play.resume(Play.parse(readFileSync(path, "utf8")), options);
  }
  play ??= Play.boot(options);
  const scores: StageRun["scores"] = [];
  for (const stage of stages.slice(first)) {
    play.note(`— étape « ${stage.name} » : ${stage.title}`);
    // La toute première étape part du démarrage du jeu, où rien n'est encore à sauver.
    if (play.canCheckpoint()) {
      if (dir) {
        mkdirSync(dir, { recursive: true });
        writeFileSync(checkpointPath(dir, stage.name), JSON.stringify(play.checkpoint(stage.name)));
      }
      options.onStage?.(stage.name, play);
    }
    stage.run(play);
    if (play.score() !== stage.score) play.fail(`étape « ${stage.name} » : score ${play.score()}, attendu ${stage.score}`);
    scores.push({ name: stage.name, score: play.score() });
  }
  return { play, scores };
}

/**
 * Garde en mémoire l'image de quelques étapes pendant un parcours (`onStage`), pour en faire partir des variantes dans le
 * même fichier de test sans rejouer ce qui précède. `of` rend une copie de l'image ; si `PLAY_FROM` a fait sauter l'étape,
 * elle est lue dans `PLAY_CHECKPOINTS`.
 */
export function stageImages(kept: readonly string[]): { onStage: (name: string, play: Play) => void; of: (name: string) => SaveImage } {
  const images = new Map<string, SaveImage>();
  return {
    onStage(name, play) {
      if (kept.includes(name)) images.set(name, play.checkpoint(name));
    },
    of(name) {
      const image = images.get(name);
      if (image) return structuredClone(image);
      const dir = process.env.PLAY_CHECKPOINTS;
      if (!dir || !existsSync(checkpointPath(dir, name))) throw new PlayError(`pas d'image de l'étape ${name} : rejouer sans PLAY_FROM, ou avec PLAY_CHECKPOINTS`);
      return Play.parse(readFileSync(checkpointPath(dir, name), "utf8"));
    },
  };
}
