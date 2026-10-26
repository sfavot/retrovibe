import { h } from "../../../ui/dom";
import { copy } from "../copy";

export interface ManualSection {
  /** Titre de la section (vide pour l'en-tête du fichier : titre du jeu et table des matières). */
  title: string;
  /** Texte, avec ses retours à la ligne d'origine. */
  body: string;
}

/**
 * Découpe `MANUEL.TXT` : chaque titre est une ligne soulignée de tirets (« Scénario » puis « -------- »). Le texte avant le
 * premier titre (en-tête et table des matières) forme une première section sans titre, que la page ne montre pas.
 */
export function parseManual(text: string): ManualSection[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const sections: ManualSection[] = [];
  let current: { title: string; lines: string[] } = { title: "", lines: [] };
  const close = (): void => {
    sections.push({ title: current.title, body: current.lines.join("\n").trim() });
  };
  for (let i = 0; i < lines.length; i++) {
    if (i + 1 < lines.length && lines[i]!.trim() !== "" && /^-{3,}\s*$/.test(lines[i + 1]!)) {
      close();
      current = { title: lines[i]!.trim(), lines: [] };
      i++;
    } else current.lines.push(lines[i]!);
  }
  close();
  return sections;
}

/** Décode le fichier du manuel (Windows-1252, comme les textes d'origine). */
export function decodeManual(bytes: Uint8Array): string {
  return new TextDecoder("windows-1252").decode(bytes);
}

/** Page du manuel d'origine : une section par titre, avec un sommaire et un bouton de retour à l'écran titre. */
export function renderManual(sections: readonly ManualSection[], onBack: () => void): HTMLElement {
  const shown = sections.filter((section) => section.title !== "");
  const back = (): HTMLElement => h("button", { type: "button", class: "secondary", onclick: onBack }, copy.manualBack);
  const page = h(
    "article",
    { class: "sw3-manual" },
    back(),
    h("h1", {}, copy.manualTitle),
    h("p", { class: "muted" }, copy.manualOriginal),
    h(
      "nav",
      { "aria-label": copy.manualContents },
      h(
        "ul",
        { class: "sw3-manual-toc" },
        ...shown.map((section, i) =>
          h("li", {}, h("button", { type: "button", class: "link", onclick: () => page.querySelector(`#sw3-manual-${i}`)?.scrollIntoView({ behavior: "smooth" }) }, section.title)),
        ),
      ),
    ),
    ...shown.flatMap((section, i) => [h("h2", { id: `sw3-manual-${i}` }, section.title), h("p", { class: "sw3-manual-text" }, section.body)]),
    back(),
  );
  queueMicrotask(() => page.querySelector("button")?.focus());
  return page;
}
