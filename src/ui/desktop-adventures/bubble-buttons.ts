import type { Bitmap } from "../../engine/desktop-adventures/data/resources";

/**
 * Les trois boutons de la bulle de dialogue d'origine (DIALOG 134 de l'exécutable) : préfixe de leurs BITMAP. Les noms de l'exécutable
 * désignent le sens de déplacement du texte : la flèche ▲ (remonter le texte) est « DNA », la flèche ▼ est « UPA ».
 */
export const BUBBLE_BUTTONS = { up: "DNA", down: "UPA", close: "CLOSE" } as const;
export type BubbleButton = keyof typeof BUBBLE_BUTTONS;

/** États d'un bouton : relâché, enfoncé, désactivé, au clavier (focus) ; suffixe de la BITMAP. */
export const BUBBLE_STATES = { rest: "U", pressed: "D", disabled: "X", focus: "F" } as const;
export type BubbleState = keyof typeof BUBBLE_STATES;

/** Nom de la ressource BITMAP d'un bouton dans un état (ex. « UPAD » : flèche haut enfoncée). */
export function bubbleBitmapId(button: BubbleButton, state: BubbleState): string {
  return `${BUBBLE_BUTTONS[button]}${BUBBLE_STATES[state]}`;
}

/** Nom de la variable CSS qui porte l'image d'un bouton dans un état (lue par `style.css`). */
export function bubbleVariable(button: BubbleButton, state: BubbleState): string {
  return `--bubble-${button}-${state}`;
}

/**
 * Variables CSS (`url(data:…)`) des images des boutons, décodées de l'exécutable à l'exécution : rien n'est copié dans le dépôt.
 * Renvoie null si une image manque (la feuille de style garde alors des boutons à glyphe).
 */
export function bubbleButtonImages(bitmaps: Map<string, Bitmap>): Record<string, string> | null {
  const vars: Record<string, string> = {};
  for (const button of Object.keys(BUBBLE_BUTTONS) as BubbleButton[]) {
    for (const state of Object.keys(BUBBLE_STATES) as BubbleState[]) {
      const bitmap = bitmaps.get(bubbleBitmapId(button, state));
      if (!bitmap) return null;
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(bitmap.rgba), bitmap.width, bitmap.height), 0, 0);
      vars[bubbleVariable(button, state)] = `url("${canvas.toDataURL("image/png")}")`;
    }
  }
  return vars;
}
