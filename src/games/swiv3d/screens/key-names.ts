/** Noms de touches pour l'écran des commandes (`KeyboardEvent.code` -> libellé), avec les flèches de la police du jeu (CP437 0x18-0x1b). */
import { copy } from "../copy";

const ARROWS: Record<string, string> = { ArrowLeft: "\u001b", ArrowRight: "\u001a", ArrowUp: "\u0018", ArrowDown: "\u0019" };

export function keyLabel(code: string, language: number): string {
  if (code in ARROWS) return ARROWS[code]!;
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  switch (code) {
    case "Space":
      return copy.keys.space![language]!;
    case "ControlLeft":
      return copy.keys.control![language]!;
    case "ShiftLeft":
      return copy.keys.shift![language]!;
    case "PageUp":
      return copy.keys.pageUp![language]!;
    case "PageDown":
      return copy.keys.pageDown![language]!;
    case "Comma":
      return ",";
    case "Period":
      return ".";
    case "BracketLeft":
      return "[";
    case "BracketRight":
      return "]";
    default:
      return code;
  }
}
