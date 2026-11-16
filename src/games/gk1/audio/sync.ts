/**
 * Synchronisation des lèvres de Gabriel Knight : repères d'un clip de voix, lus dans `voices/<module>/sync.json` et servis
 * un par un à `DoSync` (`docs/gk1/formats.md` § 11, `docs/gk1/plan.md` vague A2).
 *
 * Référence : `engines/sci/sound/sync.cpp` de ScummVM (`Sync::start`, `next`, `stop`), GPL v3 ou ultérieure, lu puis réécrit.
 *
 * - `start` : ouvre les repères du clip ; le script reçoit `syncCue` = 0, ou −1 si le clip n'a pas de synchronisation.
 * - `next` : repère suivant, `syncTime` (ticks de 1/60 s depuis le début du clip) et `syncCue` ; après le dernier, une fois,
 *   `syncTime` = −1 et `syncCue` = −1 (le tick final `0xFFFF` du bloc d'origine, que `sync.json` ne garde pas) ; ensuite rien.
 * - **Sens d'un repère** (lu dans `Sync::syncCheck` et `MouthSync::doit`, script 64929) : les 4 bits bas sont le cel de la
 *   bouche du personnage ; un repère dont les bits hauts sont nuls garde les bits hauts du précédent. Le script avance tant
 *   que `syncTime` ne dépasse pas la position de l'audio (`DoAudio(Position)` sans clé).
 *
 * Un seul clip à la fois, comme ScummVM (`start` referme le précédent).
 */
import { parseSyncJson, type SyncCue, syncPath, voiceClipName, type VoiceKey } from "../data/audio-index";
import { DIGITAL_LOADING, type DigitalFiles, type DigitalLoading } from "./digital";
import { declareState } from "../engine/save-codec";

/** `syncCue` et `syncTime` de fin, et `syncCue` d'un clip sans synchronisation. */
export const SYNC_END = 0xffff;
/** `syncCue` écrit par `start` quand le clip a des repères. */
export const SYNC_STARTED = 0;

export interface SyncStep {
  readonly time: number;
  readonly cue: number;
}

export class LipSync {
  private cues: readonly SyncCue[] | undefined;
  private index = 0;
  private readonly modules = new Map<number, Map<string, SyncCue[]> | undefined>();

  /** `files` : fichiers du jeu, relus à chaque appel (l'hôte peut les brancher après coup). */
  constructor(
    private readonly files: () => DigitalFiles,
    private readonly warn: (message: string) => void = () => {},
  ) {}

  /** Repères du clip, `undefined` s'il n'en a pas, `DIGITAL_LOADING` tant que le fichier du module est en route. */
  cuesOf(key: VoiceKey): readonly SyncCue[] | undefined | DigitalLoading {
    if (!this.modules.has(key.module)) {
      const path = syncPath(key.module);
      const files = this.files();
      if (!files.has(path)) return undefined;
      const text = files.text(path);
      if (text === DIGITAL_LOADING) return DIGITAL_LOADING;
      let parsed: Map<string, SyncCue[]> | undefined;
      if (text === undefined) this.warn(`synchro : ${path} introuvable`);
      else {
        try {
          parsed = parseSyncJson(text);
        } catch {
          this.warn(`synchro : ${path} illisible`);
        }
      }
      this.modules.set(key.module, parsed);
    }
    return this.modules.get(key.module)?.get(voiceClipName(key));
  }

  /** Ouvre les repères du clip ; rend la valeur de `syncCue`. Un fichier encore en route compte comme absent. */
  start(key: VoiceKey): number {
    this.stop();
    const cues = this.cuesOf(key);
    if (cues === undefined || cues === DIGITAL_LOADING) return SYNC_END;
    this.cues = cues;
    return SYNC_STARTED;
  }

  /** Repère suivant, ou `undefined` s'il n'y a plus rien à écrire. */
  next(): SyncStep | undefined {
    const cues = this.cues;
    if (!cues || this.index > cues.length) return undefined;
    const cue = cues[this.index++];
    return cue ? { time: cue.tick, cue: cue.cue } : { time: SYNC_END, cue: SYNC_END };
  }

  stop(): void {
    this.cues = undefined;
    this.index = 0;
  }

  get active(): boolean {
    return this.cues !== undefined;
  }
}

// État sauvegardé (`engine/save.ts`) : les repères en cours et le prochain à rendre.
declareState(LipSync, { name: "LipSync", skip: ["modules", "files"] });
