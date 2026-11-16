/**
 * Lecteur de cinématiques SEQ : joue un fichier décodé par `data/seq.ts` dans le tampon du compositeur (`frameout.ts`),
 * à la cadence et à la position données par `ShowMovie` (`docs/gk1/formats.md` § 12, `docs/gk1/plan.md`, vague Q).
 *
 * Références : `engines/sci/graphics/video32.cpp` (`SEQPlayer::play`, `VideoPlayer::playUntilEvent`, `checkForEvent`,
 * `submitPalette`), `engines/sci/video/seq_decoder.h` (`SEQVideoTrack::getFrameRate`) et `engines/sci/engine/kvideo.cpp`
 * (`kShowMovie32`) de ScummVM, GPL v3 ou ultérieure, lus puis réécrits.
 *
 * - **Cadence** : le deuxième argument de `ShowMovie` est la durée d'une image en ticks de 1/60 s (ScummVM : 60 / durée
 *   images par seconde). L'image `i` s'affiche au tick `début + i × durée`.
 * - **Position** : (`x`, `y`) est le coin haut gauche de la toile de 320×200 à l'écran ; ce qui dépasse est coupé.
 * - **Palette** : celle du fichier remplace les 256 couleurs de l'écran pendant la lecture (les couleurs qu'elle ne définit
 *   pas sont noires), sans toucher à la palette source du jeu. À la fin, l'écran est rempli de la couleur 0 et la palette
 *   de l'écran d'avant la cinématique est remise.
 * - **Interruption** : `skip()` arrête la lecture au tick suivant ; c'est ce que font un clic ou Échap dans l'original.
 *   Le module des entrées appelle `skip()` tant que `playing` est vrai (et ne transmet pas l'évènement au jeu).
 * - **Fichier** : `source(nom)` rend les octets, `undefined` si le fichier manque, ou `MOVIE_LOADING` tant qu'il n'est pas
 *   arrivé : la lecture (et son horloge) ne commence qu'à son arrivée.
 *
 * Écarts volontaires : ScummVM ignore (`x`, `y`) et centre l'image (sans effet ici : en 320×200 les scripts passent 0, 0) ;
 * il arrête la lecture dès la dernière image décodée, ici elle reste affichée sa durée entière ; il lit l'horloge de la
 * machine et peut sauter des images, ici une image n'est jamais sautée et seuls les ticks du jeu comptent. L'état du lecteur
 * (toile en cours) n'est pas sérialisable : pas de sauvegarde pendant une cinématique (`plan.md`, « Cas limites »).
 */
import { createSeqCanvas, decodeSeqFrame, readSeq, type Seq } from "../data/seq";
import { SEQ_HEIGHT, SEQ_WIDTH } from "../data/ids";
import type { Vm } from "../engine/vm";
import { type Frameout, frameoutOf } from "./frameout";
import { SCREEN_HEIGHT, SCREEN_WIDTH } from "./ids";

/** Réponse de `MovieSource` pour un fichier demandé mais pas encore chargé. */
export const MOVIE_LOADING = Symbol("gk1.movie.loading");

/** Donne les octets d'un fichier `SEQ` par son nom en majuscules (`1.SEQ`). */
export type MovieSource = (name: string) => Uint8Array | undefined | typeof MOVIE_LOADING;

/** Couleur dont l'écran est rempli après la cinématique. */
const CLEAR_COLOR = 0;

interface Movie {
  readonly name: string;
  readonly ticksPerFrame: number;
  readonly x: number;
  readonly y: number;
  /** Absent tant que le fichier n'est pas arrivé. */
  seq?: Seq;
  canvas: Uint8Array;
  startTick: number;
  /** Nombre d'images déjà décodées. */
  decoded: number;
  savedPalette: Uint8Array;
}

export class SeqPlayer {
  source: MovieSource = () => undefined;
  private movie: Movie | undefined;
  private skipRequested = false;

  constructor(
    private readonly frameout: Frameout,
    private readonly warn: (message: string) => void,
  ) {}

  /** Vrai entre `play` et la fin de la cinématique (chargement compris). */
  get playing(): boolean {
    return this.movie !== undefined;
  }

  /** Nom du fichier en cours, ou `undefined`. */
  get current(): string | undefined {
    return this.movie?.name;
  }

  /** Indice de l'image affichée (−1 avant la première, ou hors lecture). */
  get frameIndex(): number {
    return this.movie ? this.movie.decoded - 1 : -1;
  }

  /** Prépare la lecture de `name` : `ticksPerFrame` ticks par image, toile posée en (`x`, `y`). `advance` fait le reste. */
  play(name: string, ticksPerFrame: number, x: number, y: number): void {
    if (ticksPerFrame < 1) {
      this.warn(`ShowMovie : durée d'image ${ticksPerFrame} invalide (${name})`);
      ticksPerFrame = 1;
    }
    this.skipRequested = false;
    this.movie = { name: name.toUpperCase(), ticksPerFrame, x, y, canvas: createSeqCanvas(), startTick: 0, decoded: 0, savedPalette: new Uint8Array(0) };
  }

  /** Abandonne la cinématique en cours sans rien rétablir : la reprise d'une sauvegarde remplace tout l'état graphique. */
  cancel(): void {
    this.movie = undefined;
    this.skipRequested = false;
  }

  /** Demande l'arrêt de la cinématique en cours. Renvoie faux si rien ne se jouait. */
  skip(): boolean {
    if (!this.movie) return false;
    this.skipRequested = true;
    return true;
  }

  /**
   * Met l'écran à l'heure `now` (ticks du jeu) : décode et pose les images dues. Renvoie vrai quand la cinématique est
   * finie (ou qu'il n'y en a pas) : l'écran et sa palette sont alors rendus au jeu.
   */
  advance(now: number): boolean {
    const movie = this.movie;
    if (!movie) return true;
    if (!movie.seq) {
      const data = this.source(movie.name);
      if (data === MOVIE_LOADING) {
        if (!this.skipRequested) return false;
        this.movie = undefined;
        return true;
      }
      if (!data) {
        this.warn(`cinématique ${movie.name} absente`);
        this.movie = undefined;
        return true;
      }
      movie.seq = readSeq(data);
      movie.startTick = now;
      const screenPalette = this.frameout.palette.screen;
      movie.savedPalette = screenPalette.slice();
      screenPalette.set(movie.seq.palette.rgb);
    }
    const due = Math.floor((now - movie.startTick) / movie.ticksPerFrame);
    if (this.skipRequested || due >= movie.seq.frames.length) {
      this.finish(movie);
      return true;
    }
    if (movie.decoded <= due) {
      while (movie.decoded <= due) decodeSeqFrame(movie.seq, movie.decoded++, movie.canvas);
      this.blit(movie);
    }
    return false;
  }

  private blit(movie: Movie): void {
    const screen = this.frameout.screen;
    const left = Math.max(0, movie.x);
    const right = Math.min(SCREEN_WIDTH, movie.x + SEQ_WIDTH);
    if (left >= right) return;
    for (let row = 0; row < SEQ_HEIGHT; row++) {
      const y = movie.y + row;
      if (y < 0 || y >= SCREEN_HEIGHT) continue;
      const from = row * SEQ_WIDTH + (left - movie.x);
      screen.set(movie.canvas.subarray(from, from + (right - left)), y * SCREEN_WIDTH + left);
    }
  }

  private finish(movie: Movie): void {
    this.frameout.screen.fill(CLEAR_COLOR);
    this.frameout.palette.screen.set(movie.savedPalette);
    this.movie = undefined;
    this.skipRequested = false;
  }
}

const instances = new WeakMap<Vm, SeqPlayer>();

/** Lecteur de cinématiques de cette machine virtuelle, créé au premier appel. */
export function seqPlayerOf(vm: Vm): SeqPlayer {
  let player = instances.get(vm);
  if (!player) instances.set(vm, (player = new SeqPlayer(frameoutOf(vm), (message) => vm.warn(message))));
  return player;
}
