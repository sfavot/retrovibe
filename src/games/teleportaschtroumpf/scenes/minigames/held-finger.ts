import type { Input } from "../../engine/input";

/**
 * Doigt lu comme des flèches tenues (ajout du port, S22, S27, S36) : la scène compare la position du doigt à celle de son personnage
 * et en déduit les directions qu'elle retient comme des touches. Le doigt compte **tant qu'il est posé** (`touchHeldAt`) ; un toucher
 * ou un glissement si bref qu'aucun pas de scène ne l'a vu posé est lu une fois, comme un appui bref, au point touché (à l'arrivée
 * pour un glissement). Un doigt déjà vu posé ne produit rien de plus à son relâchement.
 */
export class HeldFinger {
  /** Le doigt en cours a été vu posé par un pas de scène. */
  private seen = false;

  /** Position du doigt à prendre en compte à ce pas, ou `null`. À appeler à chaque mise à jour où la scène lit ses touches. */
  read(input: Input): { x: number; y: number } | null {
    const held = input.touchHeldAt;
    if (held) {
      this.seen = true;
      return held;
    }
    const seen = this.seen;
    this.seen = false;
    const gesture = input.touchGesture;
    if (!gesture || seen) return null;
    return gesture.kind === "swipe" ? { x: gesture.x + gesture.dx, y: gesture.y + gesture.dy } : { x: gesture.x, y: gesture.y };
  }

  /** Oublie le doigt en cours (entrée dans la scène). */
  reset(): void {
    this.seen = false;
  }
}
