import { renderHelpPage } from "../../../ui/point-click-pages";
import { copy } from "../copy";

/**
 * Page d'aide et de crédits : comment jouer, raccourcis, sauvegardes, puis l'origine du jeu et de son moteur (copyright de
 * Sierra, ScummVM comme référence : `docs/gk1/plan.md`, « Point légal » et convention), le manuel et la bande dessinée d'origine.
 * `base` : URL du dossier des fichiers du jeu (les deux PDF y sont servis tels quels). `onBack` : retour à l'écran titre, ou au
 * jeu en cours (`backLabel`).
 */
export function renderHelp(base: string, onBack: () => void, backLabel: string = copy.helpBack): HTMLElement {
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
          ...copy.helpDocumentLinks.map(([file, label]) => [`${base}/${file}`, label] as const),
          [copy.sourceUrl, copy.helpSource],
          ["https://www.scummvm.org", copy.helpScummvm],
        ],
      },
    ],
    onBack,
    backLabel,
  );
}
