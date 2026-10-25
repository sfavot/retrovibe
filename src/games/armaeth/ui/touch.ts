import type { HostKey } from "../engine/host";

/**
 * Contenu permanent du champ de saisie caché : il reste toujours un caractère à effacer, sinon le clavier virtuel
 * n'émet rien pour un retour arrière dans un champ vide.
 */
export const TEXT_SENTINEL = " ";

/**
 * Touches du jeu qui font passer le texte du champ de saisie de `before` à `after` : ce qui a été retiré à la fin devient des
 * retours arrière, ce qui a été ajouté devient des caractères (accents compris ; saut de ligne : Entrée). Les caractères de
 * contrôle sont ignorés. Un texte accentué composé en deux temps (« e » puis « é ») ne donne que le retour arrière et la lettre qui diffèrent.
 */
export function textFieldKeys(before: string, after: string): HostKey[] {
  let common = 0;
  while (common < before.length && common < after.length && before[common] === after[common]) common++;
  const keys: HostKey[] = Array.from({ length: [...before.slice(common)].length }, () => ({ type: "char", char: "\b" }));
  for (const char of after.slice(common)) {
    if (char === "\n" || char === "\r") keys.push({ type: "char", char: "\r" });
    else if (char >= " " && char !== "\x7f") keys.push({ type: "char", char });
  }
  return keys;
}

/**
 * « Tenir » : équivalent tactile de Ctrl + clic (prendre un objet de l'inventaire en main). Armé, il s'applique au prochain
 * toucher ou appui long, puis se désarme tout seul : on n'oublie pas un Ctrl enfoncé.
 */
export class HoldToggle {
  private on = false;

  /** Appelée à chaque changement d'état (le bouton « Tenir » en reflète l'état). */
  onChange: (armed: boolean) => void = () => {};

  get armed(): boolean {
    return this.on;
  }

  toggle(): void {
    this.set(!this.on);
  }

  /** Lit l'état pour un clic et désarme. */
  consume(): boolean {
    const was = this.on;
    this.set(false);
    return was;
  }

  private set(armed: boolean): void {
    if (armed === this.on) return;
    this.on = armed;
    this.onChange(armed);
  }
}

/**
 * Cases cibles du doigt. Barre du haut : 10 cases 20×16 (x0 = 25 + 24k puis 178 + 24k, y 2..17) ; inventaire : 12 cases
 * (x0 = 18 + 24k, y 182..197). Fenêtre de jeu : y 20..179 (screens.md E7).
 */
const CELL_WIDTH = 20;
const CELL_HEIGHT = 16;
const TOP_Y0 = 2;
const INVENTORY_Y0 = 182;
const INVENTORY_X0 = 18;
const INVENTORY_CELLS = 12;
const PITCH = 24;
/**
 * Marge verticale vers la salle : 6 px logiques. La bande fait ainsi 24 px (1,5 × la hauteur d'une case, ≈ 28 px CSS sur un
 * téléphone de 375 px, de quoi viser avec le pouce) sans manger plus de 6 des 160 lignes de la salle, dont les coins arrondis
 * (lignes 20 à 22 et 177 à 179) sont de toute façon vides : un toucher volontaire dans la scène vise rarement ces bords.
 */
const BAND_MARGIN_Y = 6;
/** Tolérance horizontale au-delà du bord d'une case : la moitié de l'espacement (2 px) + 4 px de marge. Aucune au-delà. */
const TOLERANCE_X = 6;

function topCellX0(slot: number): number {
  return slot < 5 ? 25 + 24 * slot : 178 + 24 * (slot - 5);
}

/** Centre de la case de `cells` (abscisses de départ) la plus proche de `x`, si `x` est à moins de `TOLERANCE_X` de son bord. */
function nearestCellCentre(x: number, x0s: readonly number[]): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (const x0 of x0s) {
    const centre = x0 + CELL_WIDTH / 2;
    const distance = Math.abs(x - centre);
    if (distance <= CELL_WIDTH / 2 + TOLERANCE_X && distance < bestDistance) {
      best = centre;
      bestDistance = distance;
    }
  }
  return best;
}

const TOP_X0S = Array.from({ length: 10 }, (_, slot) => topCellX0(slot));
const INVENTORY_X0S = Array.from({ length: INVENTORY_CELLS }, (_, k) => INVENTORY_X0 + PITCH * k);

/**
 * Cible d'un toucher (coordonnées logiques 320×200) : dans la bande de la barre d'icônes ou de l'inventaire et assez près d'une
 * case, le point devient le centre de la case la plus proche ; sinon il est rendu tel quel (scène, espace entre les deux groupes
 * d'icônes, bords). Réservé au doigt : souris et stylet restent exacts.
 */
export function snapTouchTarget(x: number, y: number): { x: number; y: number } {
  if (y >= 0 && y < TOP_Y0 + CELL_HEIGHT + BAND_MARGIN_Y + 2) {
    const centre = nearestCellCentre(x, TOP_X0S);
    if (centre !== null) return { x: centre, y: TOP_Y0 + CELL_HEIGHT / 2 };
  } else if (y >= INVENTORY_Y0 - BAND_MARGIN_Y && y < 200) {
    const centre = nearestCellCentre(x, INVENTORY_X0S);
    if (centre !== null) return { x: centre, y: INVENTORY_Y0 + CELL_HEIGHT / 2 };
  }
  return { x, y };
}
