import { h } from "../../../ui/dom";
import { copy } from "../copy";

/**
 * Page d'aide et de crédits : comment jouer, raccourcis, sauvegardes, puis l'origine du jeu et de son moteur, la licence des données
 * et la mention de version modifiée que cette licence exige. `base` : URL du dossier des fichiers du jeu (pour les textes de licence,
 * servis tels quels avec les données). `onBack` : retour à l'écran titre, ou au jeu en cours (`backLabel`).
 */
export function renderHelp(base: string, onBack: () => void, backLabel: string = copy.helpBack): HTMLElement {
  const back = h("button", { type: "button", class: "secondary", onclick: onBack }, backLabel);
  const section = (title: string, ...content: (HTMLElement | null)[]): HTMLElement => h("section", { class: "dra-help-section" }, h("h2", {}, title), ...content);
  const paragraphs = (texts: readonly string[]): HTMLElement[] => texts.map((text) => h("p", {}, text));
  const page = h(
    "article",
    { class: "dra-help" },
    h("header", { class: "dra-help-bar" }, h("h1", {}, copy.helpTitle), back),
    section(copy.helpHowTitle, ...paragraphs(copy.helpHow)),
    section(
      copy.helpKeysTitle,
      h(
        "dl",
        { class: "dra-help-keys" },
        ...copy.helpKeys.flatMap(([keys, effect]) => [h("dt", {}, h("kbd", {}, keys)), h("dd", {}, effect)]),
      ),
    ),
    section(copy.helpSavesTitle, h("p", {}, copy.helpSaves)),
    section(
      copy.helpAboutTitle,
      ...paragraphs(copy.helpAbout),
      h(
        "ul",
        { class: "dra-help-links" },
        ...copy.helpLicenceLinks.map(([file, label]) =>
          h("li", {}, h("a", { href: `${base}/${file}`, target: "_blank", rel: "noopener" }, label)),
        ),
        h("li", {}, h("a", { href: copy.sourceUrl, target: "_blank", rel: "noopener" }, copy.helpSource)),
        h("li", {}, h("a", { href: "https://www.scummvm.org", target: "_blank", rel: "noopener" }, copy.helpScummvm)),
      ),
    ),
    h("footer", { class: "dra-help-foot" }, h("button", { type: "button", class: "secondary", onclick: onBack }, backLabel)),
  );
  queueMicrotask(() => back.focus({ preventScroll: true }));
  return page;
}
