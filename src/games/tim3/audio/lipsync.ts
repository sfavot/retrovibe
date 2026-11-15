/**
 * Synchronisation labiale du professeur (`docs/tim3/audio.md` § Synchro labiale).
 *
 * Les octets `sync` de `HELP.VOC` et `PROFESOR.VOC` (gardés bruts dans `voices/lipsync.json`, base64) sont lus par `4247c0` de `TIMWIN.EXE`
 * et consommés par `4241ae` :
 * ```
 * u32 142 ; u16 initial (lu et ignoré par le jeu) ; { u16 instant, i16 valeur }* ; u16 0xFFFF (fin)
 * ```
 * - l'instant est en **soixantièmes de seconde** depuis le début de la voix (le jeu le tire de la position de lecture : `octets × 60 / 11025`) ;
 *   un évènement s'applique quand l'instant courant dépasse strictement le sien ;
 * - valeur 0 à 15 : forme de la bouche, état `MOUTH_STATES[v]` de `PROFSPCH.ANM` (image de la bouche, dessinée à part) ;
 * - valeur 16 à 26 : geste du professeur, état `GESTURE_STATES[v - 16]` de `PROFSPCH.ANM` (animation du corps, qui revient à l'état de repos 5) ;
 * - autre valeur positive (93 et 108 dans les données) : ignorée ; valeur négative (`0xFFFF`, dernier évènement) : fin de la parole, bouche au repos.
 * `GOALS.VOC` et `HINTn.VOC` n'ont pas de synchro (`lenSync` = 0) : le professeur garde la bouche au repos pendant ces voix.
 * Les tables `M*.RES` de `RESOURCE.001` sont les mêmes octets (chaque enregistrement est suivi de `01 00 00 00 31`, de sens inconnu) : non lues.
 */

/** Cadence des instants de synchro. */
export const LIPSYNC_TICKS_PER_SECOND = 60;

/** États de `PROFSPCH.ANM` pour les formes de bouche 0 à 15 (table `0x472ba4` de l'exe) ; la forme 0 est le repos. */
export const MOUTH_STATES: readonly number[] = [27, 34, 30, 33, 35, 37, 26, 31, 38, 28, 40, 39, 29, 36, 32, 27];
/** États de `PROFSPCH.ANM` pour les gestes 16 à 26 (table `0x472b78` de l'exe) ; le premier (5) est l'état de repos du corps. */
export const GESTURE_STATES: readonly number[] = [5, 25, 7, 10, 49, 52, 55, 70, 60, 61, 172];
export const MOUTH_REST_STATE = MOUTH_STATES[0];
export const GESTURE_REST_STATE = GESTURE_STATES[0];

export interface LipSyncEvent {
  /** Instant, en soixantièmes de seconde depuis le début de la voix. */
  readonly tick: number;
  /** Valeur brute (signée : -1 = fin). */
  readonly value: number;
}

export interface LipSync {
  /** Mot initial, ignoré par le jeu. */
  readonly initial: number;
  readonly events: readonly LipSyncEvent[];
}

/** Pose du professeur à un instant : états de `PROFSPCH.ANM` à dessiner. */
export interface MouthPose {
  /** Forme de la bouche, 0 (repos) à 15. */
  readonly viseme: number;
  /** État de `PROFSPCH.ANM` de la bouche. */
  readonly mouthState: number;
  /** État du geste en cours (`GESTURE_REST_STATE` au repos). */
  readonly gestureState: number;
  /** Instant (ms depuis le début de la voix) où le geste a commencé : l'animation du corps part de là. 0 au repos. */
  readonly gestureStartMs: number;
}

/** Bouche fermée, corps au repos : pose des voix sans synchro, et avant la première. */
export const REST_POSE: MouthPose = { viseme: 0, mouthState: MOUTH_REST_STATE, gestureState: GESTURE_REST_STATE, gestureStartMs: 0 };

/** Lit les octets `sync` d'une entrée (`u32 142` en tête). Lève une erreur si la structure n'est pas celle attendue. */
export function parseLipSync(bytes: Uint8Array): LipSync {
  if (bytes.length < 6) throw new Error("TIM3 : synchro labiale trop courte");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 142) throw new Error("TIM3 : en-tête de synchro labiale inattendu");
  const initial = view.getUint16(4, true);
  const events: LipSyncEvent[] = [];
  let last = -1;
  for (let p = 6; p + 2 <= bytes.length; p += 4) {
    const tick = view.getUint16(p, true);
    if (tick === 0xffff) break; // le jeu s'arrête dès que l'instant vaut -1
    if (p + 4 > bytes.length) throw new Error("TIM3 : synchro labiale tronquée");
    if (tick < last) throw new Error("TIM3 : instants de synchro labiale décroissants");
    last = tick;
    events.push({ tick, value: view.getInt16(p + 2, true) });
  }
  return { initial, events };
}

/**
 * Pose à `ms` millisecondes du début de la voix. Les évènements dont l'instant est strictement inférieur à l'instant courant s'appliquent,
 * dans l'ordre, comme dans `4241ae`.
 */
export function mouthAt(sync: LipSync | undefined, ms: number): MouthPose {
  if (!sync || !(ms > 0)) return REST_POSE;
  const now = Math.round((ms * LIPSYNC_TICKS_PER_SECOND) / 1000);
  let viseme = 0;
  let gestureState = GESTURE_REST_STATE;
  let gestureStartMs = 0;
  for (const event of sync.events) {
    if (event.tick >= now) break;
    const v = event.value;
    if (v < 0) {
      viseme = 0;
      gestureState = GESTURE_REST_STATE;
      gestureStartMs = 0;
    } else if (v < 16) viseme = v;
    else if (v < 27) {
      gestureState = GESTURE_STATES[v - 16];
      gestureStartMs = (event.tick * 1000) / LIPSYNC_TICKS_PER_SECOND;
    }
  }
  return { viseme, mouthState: MOUTH_STATES[viseme], gestureState, gestureStartMs };
}

/** Synchros d'une archive : index d'entrée → synchro. */
export type LipSyncTable = ReadonlyMap<string, LipSync>;

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/**
 * Lit `voices/lipsync.json` (`{archive: {index: base64}}`). Les clés du résultat sont celles de `voiceKey` (`help/042`). Une entrée illisible
 * est ignorée (la voix jouera bouche fermée) plutôt que de faire échouer le chargement.
 */
export function parseLipSyncJson(json: unknown): LipSyncTable {
  const table = new Map<string, LipSync>();
  if (typeof json !== "object" || json === null) return table;
  for (const [archive, entries] of Object.entries(json as Record<string, unknown>)) {
    if (typeof entries !== "object" || entries === null) continue;
    for (const [index, encoded] of Object.entries(entries as Record<string, unknown>)) {
      if (typeof encoded !== "string") continue;
      try {
        table.set(`${archive}/${index.padStart(3, "0")}`, parseLipSync(base64ToBytes(encoded)));
      } catch {
        // entrée illisible : bouche fermée
      }
    }
  }
  return table;
}
