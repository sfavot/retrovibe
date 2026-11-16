/**
 * Gestionnaire de ressources de la machine virtuelle : ce que voient `Load`, `Unload`, `Lock`, `ResCheck` et le chargeur de
 * scripts, au-dessus de l'index de `data/resource-map.ts`.
 *
 * Référence : `engines/sci/resource/resource.cpp` (`ResourceManager::findResource`, `testResource`, `unlockResource`) de
 * ScummVM, GPL v3 ou ultérieure, lu puis réécrit.
 *
 * Écarts volontaires : pas de cache borné ni d'éviction, l'index garde chaque ressource décompressée (12,7 Mo pour tout le
 * volume) ; `Unload` et `Purge` n'ont donc rien à libérer. Les verrous ne sont que comptés, pour répondre aux scripts et
 * pour la sauvegarde. Les ressources audio, audio36 et sync36 ne passent pas par ici (`plan.md`, D3).
 */
import { resourceTypeName } from "../data/ids";
import type { ResourceIndex } from "../data/resource-map";

export class ResourceManager {
  /** Nombre de verrous par ressource (`type << 16 | numéro`). */
  private readonly locks = new Map<number, number>();

  constructor(readonly index: ResourceIndex) {}

  has(type: number, number: number): boolean {
    return this.index.has(type, number);
  }

  /** Données décompressées ; lève une erreur si la ressource manque. */
  get(type: number, number: number): Uint8Array {
    return this.index.get(type, number);
  }

  /** Données décompressées, ou `undefined` si la ressource manque. */
  find(type: number, number: number): Uint8Array | undefined {
    return this.index.has(type, number) ? this.index.get(type, number) : undefined;
  }

  /** Pose un verrou ; renvoie faux si la ressource n'existe pas. */
  lock(type: number, number: number): boolean {
    if (!this.has(type, number)) return false;
    const key = lockKey(type, number);
    this.locks.set(key, (this.locks.get(key) ?? 0) + 1);
    return true;
  }

  /** Retire un verrou (sans effet s'il n'y en a pas). */
  unlock(type: number, number: number): void {
    const key = lockKey(type, number);
    const count = this.locks.get(key) ?? 0;
    if (count <= 1) this.locks.delete(key);
    else this.locks.set(key, count - 1);
  }

  /** Retire tous les verrous des ressources de ce type. */
  unlockAll(type: number): void {
    for (const key of [...this.locks.keys()]) if (key >>> 16 === type) this.locks.delete(key);
  }

  lockCount(type: number, number: number): number {
    return this.locks.get(lockKey(type, number)) ?? 0;
  }

  describe(type: number, number: number): string {
    return `${resourceTypeName(type)} ${number}`;
  }
}

function lockKey(type: number, number: number): number {
  return ((type << 16) | number) >>> 0;
}
