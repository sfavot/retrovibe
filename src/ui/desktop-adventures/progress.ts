import { storage } from "./storage";

/** Progression locale, équivalent du .INI de l'original : objectifs des dernières histoires et victoires (« Count »). */
export interface Progress {
  /** Puzzles d'objectif, du plus ancien au plus récent. */
  history: number[];
  victories: number;
  /** Yoda : planète de la dernière histoire, exclue du tirage suivant. */
  lastWorld?: number;
}

export interface ProgressRules {
  /** Historique à conserver une fois l'objectif d'une histoire choisi. */
  recordGoal(history: readonly number[], goal: number): number[];
  /** Plafond du compteur de victoires. */
  maxVictories: number;
}

export type ProgressStore = ReturnType<typeof createProgressStore>;

const isCount = (n: unknown, max: number): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;

/** Progression d'un jeu (clé `key`). Le stockage peut être indisponible ou altéré : on retombe sur la copie de la session. */
export function createProgressStore(key: string, rules: ProgressRules) {
  /** Copie de la session : sert quand le stockage est indisponible (« Rejouer cette histoire » marche alors encore). */
  let memory: Progress = { history: [], victories: 0 };

  const load = (): Progress | null => {
    const raw = storage.get(key);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw) as Partial<Progress>;
      if (!Array.isArray(data.history) || !data.history.every((id) => isCount(id, 0xffff)) || !isCount(data.victories, rules.maxVictories)) return null;
      const progress: Progress = { history: data.history, victories: data.victories };
      if (isCount(data.lastWorld, 0xffff)) progress.lastWorld = data.lastWorld;
      return progress;
    } catch {
      return null;
    }
  };

  const save = (progress: Progress): void => {
    memory = progress;
    // stockage plein ou bloqué : la progression ne vaut que pour cette session
    storage.set(key, JSON.stringify(progress));
  };

  return {
    read(): Progress {
      const stored = load();
      if (stored) memory = stored;
      return { ...memory, history: memory.history.slice() };
    },
    /** Enregistre l'objectif (et, pour Yoda, la planète) d'une histoire qui démarre. */
    recordGoal(goal: number, lastWorld?: number): void {
      const progress = this.read();
      const next: Progress = { ...progress, history: rules.recordGoal(progress.history, goal) };
      if (lastWorld !== undefined) next.lastWorld = lastWorld;
      save(next);
    },
    recordVictory(): void {
      const progress = this.read();
      save({ ...progress, victories: Math.min(rules.maxVictories, progress.victories + 1) });
    },
  };
}
