import type { HelpDocument, HelpImage, HelpParagraph, HelpSpan } from "../data/help";
import { copy } from "../copy";
import { h } from "../../../ui/dom";

/** À partir de cette taille (en points), un paragraphe qui n'ouvre pas la rubrique est un intertitre. */
const HEADING_SIZE = 14;
const WIDE_LAYOUT = "(min-width: 801px)";

interface OutlineEntry {
  topic: number;
  depth: number;
}

/** Le manuel d'origine : sommaire à gauche, rubrique à droite ; les liens du texte ouvrent d'autres rubriques. */
export function renderManual(doc: HelpDocument, onBack: () => void): HTMLElement {
  const page = h("article", { class: "manual-page", tabindex: -1 });
  const navButtons = new Map<number, HTMLButtonElement>();
  const nav = h("details", { class: "manual-nav" }, h("summary", {}, copy.manualContents));
  nav.open = window.matchMedia(WIDE_LAYOUT).matches;

  const show = (topic: number): void => {
    page.replaceChildren(...renderTopic(doc, topic, show));
    for (const [id, button] of navButtons) {
      if (id === topic) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    }
    if (!window.matchMedia(WIDE_LAYOUT).matches) nav.open = false;
    window.scrollTo(0, 0);
    page.focus({ preventScroll: true });
  };

  const list = h("ul", {});
  for (const { topic, depth } of outline(doc)) {
    const button = h("button", { type: "button", class: "manual-nav-item", style: `--depth: ${depth}`, onclick: () => show(topic) }, doc.topics[topic].title);
    navButtons.set(topic, button);
    list.append(h("li", {}, button));
  }
  nav.append(h("nav", { "aria-label": copy.manualContents }, list));

  const back = h("button", { type: "button", class: "secondary", onclick: onBack }, copy.manualBack);
  const root = h(
    "section",
    { class: "manual" },
    h("header", { class: "manual-bar" }, back, h("h1", {}, doc.title), h("p", { class: "muted" }, copy.manualNote)),
    h("div", { class: "manual-body" }, nav, page),
  );
  show(0);
  return root;
}

/** Arbre des rubriques déduit des liens, à partir du sommaire : une rubrique prend sa place sous la première qui la cite. */
function outline(doc: HelpDocument): OutlineEntry[] {
  const entries: OutlineEntry[] = [{ topic: 0, depth: 0 }];
  const seen = new Set([0]);
  const walk = (topic: number, depth: number): void => {
    for (const target of links(doc.topics[topic].paragraphs)) {
      if (seen.has(target)) continue;
      seen.add(target);
      entries.push({ topic: target, depth });
      walk(target, depth + 1);
    }
  };
  walk(0, 1);
  return entries;
}

function links(paragraphs: HelpParagraph[]): number[] {
  return paragraphs.flatMap((p) => p.spans.flatMap((s) => ("link" in s && s.link !== undefined ? [s.link] : [])));
}

function renderTopic(doc: HelpDocument, topic: number, open: (topic: number) => void): HTMLElement[] {
  const out: HTMLElement[] = [];
  let menu: HTMLUListElement | null = null;
  doc.topics[topic].paragraphs.forEach((paragraph, index) => {
    const target = soleLink(paragraph);
    if (target !== null) {
      // Une suite de paragraphes qui ne sont qu'un lien forme un menu.
      if (!menu) {
        menu = h("ul", { class: "manual-links" });
        out.push(menu);
      }
      menu.append(h("li", {}, linkButton(plainText(paragraph), target, open)));
      return;
    }
    menu = null;
    if (paragraph.spans.length === 0) return;
    out.push(renderParagraph(doc, paragraph, index === 0, open));
  });
  return out;
}

/** La cible, si le paragraphe n'est qu'un lien. */
function soleLink(paragraph: HelpParagraph): number | null {
  const spans = paragraph.spans;
  const first = spans[0];
  if (!first || !("link" in first) || first.link === undefined) return null;
  return spans.every((s) => "link" in s && s.link === first.link) ? first.link : null;
}

function plainText(paragraph: HelpParagraph): string {
  return paragraph.spans.map((s) => (s.kind === "text" ? s.text : "")).join("").trim();
}

function renderParagraph(doc: HelpDocument, paragraph: HelpParagraph, first: boolean, open: (topic: number) => void): HTMLElement {
  const hasImage = paragraph.spans.some((s) => s.kind === "image");
  // Chaque rubrique commence par son titre ; plus loin, seuls les gros caractères marquent un intertitre.
  const size = Math.max(0, ...paragraph.spans.map((s) => (s.kind === "text" ? s.font.size : 0)));
  if (first && !hasImage) return h("h2", {}, plainText(paragraph));
  if (size >= HEADING_SIZE) return h("h3", {}, plainText(paragraph));
  return h("p", { class: hasImage ? "has-image" : "" }, ...paragraph.spans.map((s) => renderSpan(doc, s, open)));
}

function renderSpan(doc: HelpDocument, span: HelpSpan, open: (topic: number) => void): Node | null {
  switch (span.kind) {
    case "text": {
      let node: Node = document.createTextNode(span.text);
      if (span.font.monospace) node = h("code", {}, node);
      if (span.font.italic) node = h("em", {}, node);
      if (span.font.bold) node = h("strong", {}, node);
      return span.link === undefined ? node : linkButton(node, span.link, open);
    }
    case "image":
      return imageCanvas(doc.images[span.image]);
    case "break":
      return h("br");
    case "tab":
      return document.createTextNode(" ");
  }
}

function linkButton(content: Node | string, topic: number, open: (topic: number) => void): HTMLButtonElement {
  return h("button", { type: "button", class: "manual-link", onclick: () => open(topic) }, content);
}

function imageCanvas(image: HelpImage): HTMLCanvasElement {
  const canvas = h("canvas", { class: "manual-image", width: image.width, height: image.height, "aria-hidden": "true" });
  canvas.getContext("2d")!.putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
  return canvas;
}
