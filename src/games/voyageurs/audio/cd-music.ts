/**
 * Musique CD des *Voyageurs du temps* : logique pure de `PCSound` pour la version CD (`GF_CD`), sans lecteur ni navigateur. Elle
 * décide quelle piste jouer et envoie des ordres à un `MusicSink` (le lecteur MP3 dans le jeu, un enregistreur dans les tests).
 *
 * Référence : ScummVM engines/cine/sound.cpp, `PCSound::loadMusic` / `playMusic` / `setBgMusic` / `stopMusic` / `fadeOutMusic`
 * (l.1230-1324) et tables `musicFileNames`, `musicCDTracks`, `bgCDTracks` (GPL v3 ou ultérieure) ; docs/voyageurs/formats.md § 5.
 *
 * Les nombres des tables sont des numéros de piste CD d'origine (20 à 30). ScummVM joue `piste - 1` (`AudioCDManager::play(n - 1, -1)`),
 * d'où les fichiers `music/track19.mp3` à `track29.mp3` (D3). Toute lecture est en boucle infinie (`numLoops = -1`).
 *
 * L'état (`current`, `status`, `slot`) reprend `_currentMusic`, `_currentMusicStatus` et `_currentBgSlot` : le banc l'écrit dans le
 * champ `mus=` des traces (`traceField`). `status` est la piste demandée par un script (0 = aucune musique de script) ; `current`
 * la piste CD censée jouer.
 *
 * Écarts, tous voulus :
 * - **`fadeOutMusic` (D8)** : ScummVM relance `play(_currentBgSlot - 1)`, soit le n° du décor moins 1 au lieu de la piste du décor
 *   (`bgCDTracks[slot] - 1`), ce qui joue une piste sans rapport. Ici on revient à `bgCDTracks[slot]`. Le reste (état, cas du décor 1) est
 *   inchangé, donc le champ `mus=` reste celui du banc.
 * - Le CD de ScummVM s'arrête net ; ici le retour au fond passe par `MusicSink.fade` (fondu court, au choix du lecteur).
 * - `setBgMusic` d'un décor hors de la table (>= 49, ou négatif : ScummVM lit hors tableau) est ignoré, mais retient le numéro de décor.
 * - Une piste hors de 19..29 (fichier non livré, D3) n'est pas jouée ; les noms de module inconnus mettent la piste à 0 comme ScummVM.
 * - `stopMusic` ne remet pas `current`/`status` à 0 (comme ScummVM) : `setBgMusic` ne relancera donc pas le fond tant qu'un script a
 *   demandé de la musique, sauf passage par `fadeOut`.
 */

/** `musicFileNames` : nom de module (sensible à la casse, comme `strcmp`) et piste CD (`musicCDTracks`). */
export const MUSIC_CD_TRACKS: Readonly<Record<string, number>> = {
  "DUGGER.DAT": 20,
  "SUITE21.DAT": 21,
  "FWARS.DAT": 22,
  "SUITE23.DAT": 23,
  "SUITE22.DAT": 24,
  ESCAL: 25,
  "MOINES.DAT": 26,
  "MEDIAVAL.DAT": 27,
  SFUTUR: 28,
  ALIENS: 30,
  "TELESONG.DAT": 22,
};

/** `bgCDTracks[49]` : piste CD du fond `L<n>.PI1` (0 = pas de musique propre). */
export const BG_CD_TRACKS: readonly number[] = [
  0, 21, 21, 23, 0, 29, 0, 0, 0, 0,
  0, 27, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 22, 22, 23, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0,
];

/** Pistes livrées (D3) : valeurs de table 20 à 30, fichiers `track19` à `track29`. */
const FIRST_CD_TRACK = 20;
const LAST_CD_TRACK = 30;

/** Fichier (relatif au dossier du jeu) de la piste CD `track` de la table : `music/track{track-1}.mp3`. */
export function trackFile(track: number): string {
  return `music/track${track - 1}.mp3`;
}

/** Une lecture à lancer. */
export interface MusicRequest {
  readonly file: string;
  readonly loop: boolean;
}

/** Destination des ordres de `CdMusic` ; tout ordre `play`/`fade`/`stop` remplace la lecture en cours. */
export interface MusicSink {
  play(file: string, loop: boolean): void;
  stop(): void;
  /** Fondu court de la piste en cours, puis `next` (ou silence si `null`). */
  fade(next: MusicRequest | null): void;
}

export class CdMusic {
  /** `_currentMusic` : piste CD censée jouer (0 = aucune). */
  current = 0;
  /** `_currentMusicStatus` : piste demandée par un script (0 = aucune). */
  status = 0;
  /** `_currentBgSlot` : n° du fond courant. */
  slot = 0;

  constructor(private readonly sink: MusicSink) {}

  /** `loadMusic(name)` : choisit la piste du module, sans jouer. Nom inconnu : 0. */
  loadMusic(name: string): void {
    this.current = 0;
    this.status = 0;
    const track = Object.hasOwn(MUSIC_CD_TRACKS, name) ? MUSIC_CD_TRACKS[name]! : 0;
    if (track) {
      this.current = track;
      this.status = track;
    }
  }

  /** `playMusic()` : relance en boucle la piste chargée (arrête d'abord la lecture). */
  playMusic(): void {
    this.start(this.current);
  }

  /** `setBgMusic(num)` : musique d'ambiance du fond `L<num>`. */
  setBgMusic(num: number): void {
    this.slot = num;
    const track = bgTrack(num);
    if (!track) return;
    if (num === 1 || (this.status === 0 && this.current !== track)) {
      this.current = track;
      this.start(track);
    }
  }

  /** `stopMusic()` (opcode `stopSample`) : coupe le CD, sauf sur le fond 1. */
  stopMusic(): void {
    if (this.slot !== 1) this.sink.stop();
  }

  /** `fadeOutMusic()` : rend la main à la musique du fond (D8 : `bgCDTracks[slot]`, pas `slot`). */
  fadeOut(): void {
    if (!this.status) return;
    if (this.slot === 1) {
      this.status = 0;
      return;
    }
    this.current = 0;
    this.status = 0;
    const track = bgTrack(this.slot);
    this.sink.fade(track && isShipped(track) ? { file: trackFile(track), loop: true } : null);
  }

  /** Champ `mus=` des traces du banc : `_currentMusic,_currentMusicStatus,_currentBgSlot`. */
  traceField(): string {
    return `${this.current},${this.status},${this.slot}`;
  }

  private start(track: number): void {
    if (isShipped(track)) this.sink.play(trackFile(track), true);
    else this.sink.stop();
  }
}

function bgTrack(num: number): number {
  return Number.isInteger(num) && num >= 0 && num < BG_CD_TRACKS.length ? BG_CD_TRACKS[num]! : 0;
}

function isShipped(track: number): boolean {
  return track >= FIRST_CD_TRACK && track <= LAST_CD_TRACK;
}
