import type { Scene, SceneContext } from "../engine/scene";
import { VideoScene } from "../engine/video";
import type { Game } from "../game/rules";
import { isCommentVideo } from "./grand-schtroumpf/commentary";
import { IngredientsScene } from "./grand-schtroumpf/ingredients";
import { ClipSequence, CommentVoiceScene, type Clip } from "./grand-schtroumpf/videos";

export { Commentary, isCommentVideo } from "./grand-schtroumpf/commentary";

/**
 * Grand Schtroumpf : voix des ingrédients (S19), vidéos et répliques (S42), victoire (S11). Détail RE, adresses et confiance :
 * `docs/teleportaschtroumpf/screens-grand-schtroumpf.md`.
 *
 * ### `createGrandSchtroumpfScene(request, onDone)`
 *
 * - reçoit : `request` :
 *   - `ingredients` : S19 (`1e52:0324`), début de partie, une fois, après le premier affichage du plateau : voix d'ouverture,
 *     puis chaque ingrédient de l'objectif (icône dessinée au bas de l'écran, voix `s19v`), « points », leur nombre et le
 *     texte « points/objectif » avec la goutte (`scenes/grand-schtroumpf/ingredients.ts`) ; un clic coupe la voix en cours ;
 *   - `timeWarning` : avertissement `video` = 31..33 (10 min restantes) ou 34..35 (5 min), `s42a031..035.mux` ;
 *   - `timeout` : fin du temps, `video` = 41..76 (`s42a041..076.mux`, 4 variantes × 9 messages parents) ;
 *     ces deux-là sont habillées comme `154c:097b` : clip `s42a..e`, la vidéo, `s42g`, clip `s42h..l` (tirés au hasard) ;
 *   - `victory` : le joueur `winner` a réuni l'objectif, `s11a.mux` (`28a3:0080`), seule ;
 *   - `progress` : commentaire d'avancement `26ee:0f17`, `code` 201..204 (en retard) ou 211..215 (en avance, précédé et suivi
 *     d'un clip `s42m..r`) ; vidéo `s42a201..215.mux` ;
 *   - `comment` : réplique `26ee:027e`, `code` à jouer : voix `s42vNNNt.voc` ou, pour les codes de `isCommentVideo`, vidéo
 *     `s42aNNN.mux` habillée comme `154c:097b` ;
 *   Les codes `progress` et `comment` sont choisis par `Commentary` (`scenes/grand-schtroumpf/commentary.ts`) ;
 * - rend : `onDone(ctx)` à la fin de la voix ou de la dernière vidéo ;
 * - appelant : `scenes/game.ts`, qui **empile** la scène et la retire dans `onDone` ; elle redessine ensuite le plateau, ou
 *   revient au menu S07 (`timeout`, `victory`) ;
 * - écran suivant : l'appelant ; pas de sauvegarde ici (l'heure de fin de partie est enregistrée par `scenes/game.ts`) ;
 * - passer : Échap, Espace ou clic coupent la vidéo `message` et la victoire ; les clips d'habillage ne sont pas passables
 *   (drapeaux `0x1040` sans `0x400 | 0x800` dans `154c:097b`) ; l'original ne passe les vidéos de victoire et d'avancement
 *   qu'au clic gauche (`0x400`), ici Échap les passe aussi ;
 * - références : `28a3:0080`, `28a3:00ad` (fin du temps), `291e:0401` (avertissements, répliques), `1e52:0324`, `154c:097b`,
 *   `154c:0954`, `26ee:0f17`, `26ee:027e`.
 */
export type GrandSchtroumpfRequest =
  | { kind: "ingredients"; game: Game }
  | { kind: "timeWarning"; video: number }
  | { kind: "timeout"; video: number }
  | { kind: "victory"; winner: number }
  | { kind: "progress"; code: number }
  | { kind: "comment"; code: number };

/** Fichier de la vidéo `s42aNNN.mux` (`s42a0%d` sous 100, `s42a%d` au-delà, `291e:0401`). */
export function s42VideoFile(n: number): string {
  return n < 100 ? `s42a0${n}.mux` : `s42a${n}.mux`;
}

/** Lettre d'un clip d'habillage `s42X.mux` : `first` + 0..`count − 1`. */
function clipLetter(first: string, offset: number): string {
  return String.fromCharCode(first.charCodeAt(0) + offset);
}

/**
 * `154c:097b` : clip d'ouverture `s42a..e`, la vidéo (passable), `s42g`, clip de fermeture `s42h..l`. Les deux lettres
 * viennent de `rand × 5000 / 0x8000 % 5`, tirées dans cet ordre.
 */
function framedClips(file: string, ctx: SceneContext): Clip[] {
  const opening = clipLetter("a", ctx.rng.below(5000) % 5);
  const closing = clipLetter("h", ctx.rng.below(5000) % 5);
  return [
    { file: `s42${opening}.mux`, skippable: false },
    { file, skippable: true },
    { file: "s42g.mux", skippable: false },
    { file: `s42${closing}.mux`, skippable: false },
  ];
}

/** `291e:0401` autour d'un commentaire d'avancement 211..215 : clip `s42m..r` (`'m' + rand × 6 / 0x8000`) avant et après. */
function progressClips(code: number, ctx: SceneContext): Clip[] {
  const message: Clip = { file: s42VideoFile(code), skippable: true };
  if (code < 211 || code > 215) return [message];
  const opening: Clip = { file: `s42${clipLetter("m", ctx.rng.below(6))}.mux`, skippable: true };
  const closing: Clip = { file: `s42${clipLetter("m", ctx.rng.below(6))}.mux`, skippable: true };
  return [opening, message, closing];
}

export function createGrandSchtroumpfScene(request: GrandSchtroumpfRequest, onDone: (ctx: SceneContext) => void): Scene {
  switch (request.kind) {
    case "ingredients":
      return new IngredientsScene(request.game, onDone);
    case "timeWarning":
    case "timeout":
      return new ClipSequence((ctx) => framedClips(s42VideoFile(request.video), ctx), onDone);
    case "victory":
      return new VideoScene({ file: "s11a.mux", fadeOutAtEnd: true, onEnd: onDone });
    case "progress":
      return new ClipSequence((ctx) => progressClips(request.code, ctx), onDone);
    case "comment":
      return isCommentVideo(request.code)
        ? new ClipSequence((ctx) => framedClips(s42VideoFile(request.code), ctx), onDone)
        : new CommentVoiceScene(request.code, onDone);
  }
}
