import "../../../ui/point-click.css";
import { renderHelpPage } from "../../../ui/point-click-pages";
import { copy } from "./copy";

/**
 * Page d'aide et de crédits (même page que les autres jeux, `renderHelpPage`) : le jeu, les commandes à la souris, au
 * toucher et au clavier, la sauvegarde, puis l'origine du jeu, ses ayants droit, le manuel et la carte du jeu d'origine.
 * `base` : URL du dossier des fichiers du jeu (les deux PDF y sont servis tels quels). `onBack` : retour à l'écran titre.
 */
export function renderHelp(base: string, onBack: () => void): HTMLElement {
  return renderHelpPage(
    copy.helpTitle,
    [
      { title: copy.helpRulesTitle, paragraphs: copy.helpRules },
      { title: copy.helpPointerTitle, paragraphs: copy.helpPointer },
      { title: copy.helpKeysTitle, keys: copy.helpKeys },
      { title: copy.helpSavesTitle, paragraphs: [copy.helpSaves] },
      {
        title: copy.helpAboutTitle,
        paragraphs: copy.helpAbout,
        links: [...copy.helpDocumentLinks.map(([file, label]) => [`${base}/${file}`, label] as const), [copy.sourceUrl, copy.helpSource]],
      },
    ],
    onBack,
    copy.helpBack,
  );
}
