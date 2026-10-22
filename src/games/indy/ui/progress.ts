import { MAX_VICTORIES, addVictory, recordGoal } from "../engine/history";
import { storage } from "./storage";

const KEY = "indy-desktop-progress";

/** Équivalent de DESKADV.INI : objectifs des dernières histoires (« Wyoming ») et victoires (« Count »). */
export interface Progress {
  /** Puzzles d'objectif, du plus ancien au plus récent. */
  history: number[];
  victories: number;
}

const isCount = (n: unknown, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;

/** Copie de la session : sert quand le stockage est indisponible (« Rejouer cette histoire » marche alors encore). */
let memory: Progress = { history: [], victories: 0 };

function load(): Progress | null {
  const raw = storage.get(KEY);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<Progress>;
    if (!Array.isArray(data.history) || !data.history.every((id) => isCount(id, 0xffff)) || !isCount(data.victories, MAX_VICTORIES)) return null;
    return { history: data.history, victories: data.victories };
  } catch {
    return null;
  }
}

function save(progress: Progress): void {
  memory = progress;
  // stockage plein ou bloqué : la progression ne vaut que pour cette session
  storage.set(KEY, JSON.stringify(progress));
}

/** Progression locale. Le stockage peut être indisponible ou altéré : on retombe sur la copie de la session. */
export const progressStore = {
  read(): Progress {
    const stored = load();
    if (stored) memory = stored;
    return { history: memory.history.slice(), victories: memory.victories };
  },
  /** Enregistre l'objectif d'une histoire qui démarre. */
  recordGoal(goal: number): void {
    const progress = this.read();
    save({ ...progress, history: recordGoal(progress.history, goal) });
  },
  recordVictory(): void {
    const progress = this.read();
    save({ ...progress, victories: addVictory(progress.victories) });
  },
};
