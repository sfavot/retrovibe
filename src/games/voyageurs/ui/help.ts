import { renderHelpPage } from "../../../ui/point-click-pages";
import { copy } from "../copy";

/**
 * Page d'aide et de crédits : comment jouer, raccourcis, sauvegardes, puis l'origine du jeu, de sa traduction et de son moteur, et le
 * régime des données (abandonware, propriété de leurs ayants droit). `base` : URL du dossier des fichiers du jeu (sans usage ici : aucun
 * fichier de licence n'est livré avec les données). `onBack` : retour à l'écran titre, ou au jeu en cours (`backLabel`).
 */
export function renderHelp(base: string, onBack: () => void, backLabel: string = copy.helpBack): HTMLElement {
  void base;
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
