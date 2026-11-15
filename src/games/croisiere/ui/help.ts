import { renderHelpPage } from "../../../ui/point-click-pages";
import { copy } from "../copy";

/**
 * Page d'aide et de crédits : comment jouer, raccourcis, sauvegardes, puis l'origine du jeu et de son moteur, le statut des données
 * (abandonware, sans licence de redistribution, plan.md D1) et la mention de version modifiée (moteur réécrit, protection retirée).
 * `onBack` : retour à l'écran titre, ou au jeu en cours (`backLabel`).
 */
export function renderHelp(_base: string, onBack: () => void, backLabel: string = copy.helpBack): HTMLElement {
  return renderHelpPage(
    copy.helpTitle,
    [
      { title: copy.helpHowTitle, paragraphs: copy.helpHow },
      { title: copy.helpKeysTitle, keys: copy.helpKeys },
      { title: copy.helpSavesTitle, paragraphs: [copy.helpSaves] },
      {
        title: copy.helpAboutTitle,
        paragraphs: copy.helpAbout,
        links: [
          [copy.sourceUrl, copy.helpSource],
          ["https://www.scummvm.org", copy.helpScummvm],
        ],
      },
    ],
    onBack,
    backLabel,
  );
}
