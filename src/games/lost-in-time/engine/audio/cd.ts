import { parseLic, type LicTrack } from "../../data/lic";
import type { CdSystem } from "../host";
import type { CdBackend } from "./backend";

/** Secteurs CD par seconde. */
export const SECTORS_PER_SECOND = 75;

/**
 * Décalage (en secondes) entre un secteur du LIC et l'instant correspondant dans MUSIC.mp3.
 *
 * Les secteurs du LIC sont relatifs au début de la piste audio : ScummVM les passe tels quels à
 * AudioCDManager::play(piste 1, début, durée) et la première plage (FIN8) commence au secteur 2,
 * alors qu'une adresse HSG absolue ne pourrait pas être inférieure à 150 (pregap de 2 s).
 * MUSIC.mp3 est le rip de cette piste : aucun décalage. La dernière plage (DE15) finit à 3164,5 s,
 * dans les 3170,9 s du fichier.
 */
export const CD_TRACK_OFFSET_SECONDS = 0;

/** Secteurs ajoutés par ScummVM à la durée d'une plage avant de la considérer terminée (pregap). */
const TAIL_SECTORS = 150;

export interface CdAudioOptions {
  backend: CdBackend;
  /** Millisecondes monotones (Host.now). */
  now(): number;
  /** Fichier des archives ouvertes (LOST.LIC). */
  getFile(name: string): Uint8Array | undefined;
}

/** Port de gob/sound/cdrom.cpp : plages nommées d'une piste CD, découpées par LOST.LIC. */
export class CdAudio implements CdSystem {
  private tracks: LicTrack[] | null = null;
  /** Plage en cours (par identité, comme le pointeur de ScummVM) ; null après stop. */
  private current: LicTrack | null = null;
  private curName = "";
  private cdPlaying = false;
  private startMs = 0;
  private startSec = 0;
  private trackStopMs = 0;

  constructor(private readonly options: CdAudioOptions) {}

  loadLic(name: string): void {
    const file = this.options.getFile(name);
    if (!file) return;
    this.tracks = parseLic(file);
    this.curName = "";
  }

  unloadLic(): void {
    this.tracks = null;
  }

  /** Plage de ce nom (insensible à la casse), null si inconnue ou sans LIC. */
  find(name: string): LicTrack | null {
    if (!this.tracks || !name) return null;
    const upper = name.toUpperCase();
    return this.tracks.find((t) => t.name.toUpperCase() === upper) ?? null;
  }

  play(track: string): void {
    if (!this.tracks) return;
    const match = this.find(track);
    if (!match) {
      console.warn(`CDROM : plage « ${track} » introuvable`);
      return;
    }
    this.curName = track.toUpperCase().slice(0, 15);
    this.stop();
    this.current = match;
    const { startSector: start, endSector: end } = match;
    // Lecture de `start` à `end` inclus
    this.startSec = start / SECTORS_PER_SECOND + CD_TRACK_OFFSET_SECONDS;
    this.options.backend.play(this.startSec, (end + 1) / SECTORS_PER_SECOND + CD_TRACK_OFFSET_SECONDS);
    this.cdPlaying = true;
    this.startMs = this.options.now();
    this.trackStopMs = this.startMs + Math.trunc(((end - start + 1 + TAIL_SECTORS) * 40) / 3);
  }

  stop(): void {
    this.current = null;
    this.options.backend.stop();
    this.cdPlaying = false;
  }

  /**
   * Position dans la plage jouée, en secondes/75 (secteurs) depuis son début, -1 si rien ne joue.
   * Avec le nom d'une plage incluse dans la plage jouée (« plage-clé ») : -2 tant qu'elle n'a pas
   * commencé, -1 une fois finie, la position (relative à la plage jouée) entre les deux.
   * Comme dans ScummVM, la lecture est tenue pour active 150 secteurs (2 s) après la fin de la plage.
   */
  getTrackPos(keyTrack?: string): number {
    const now = this.options.now();
    if (!this.cdPlaying || now >= this.trackStopMs) return -1;
    const pos = this.position(now);
    const key = keyTrack ? this.find(keyTrack) : null;
    const cur = this.current;
    if (key && cur && key !== cur && key.startSector >= cur.startSector && key.endSector <= cur.endSector) {
      if (key.startSector - cur.startSector > pos) return -2;
      if (key.endSector - cur.startSector < pos) return -1;
    }
    return pos;
  }

  getCurrentTrack(): string {
    return this.curName;
  }

  /** Position en secteurs : celle du flux audio quand il joue vraiment, sinon l'horloge (comme ScummVM). */
  private position(now: number): number {
    const backend = this.options.backend;
    const elapsedMs = backend.playing ? (backend.currentTime - this.startSec) * 1000 : now - this.startMs;
    return Math.max(0, Math.trunc((elapsedMs * 3) / 40));
  }
}
