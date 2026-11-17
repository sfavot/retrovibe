import { encodeCp850 } from "../../../data/cp850";
import { parseAudioIndex } from "../../../engine/infogrames/data/audio-index";
import { VidDecoder } from "../../../engine/infogrames/data/vid";
import type { Sound } from "../../../engine/infogrames/audio/sound";
import {
  hy8Panel,
  info,
  palPanel,
  pfnPanel,
  picturePanel,
  rawPanel,
  soundPanel,
  videoPanel,
  type Render,
} from "../../../engine/infogrames/ui/panels";
import { vidClip } from "../../../engine/infogrames/video";
import { h } from "../../../ui/asset-viewer/helpers";
import { extensionOf, type Panel } from "../../../ui/asset-viewer/viewer";
import { parseCredits } from "../data/credits";
import { parseQuiz, type QuizLevel } from "../data/quiz";

/**
 * Panneaux de la visionneuse d'Astérix : ceux des formats du moteur commun (`src/engine/infogrames/ui/panels.ts`), plus
 * le quiz et le générique.
 */

/**
 * Vidéo d'un conteneur `.vid` (MUX ou MUK d'origine) : le son est le MP3 voisin (`M06AB.MUX.vid` → `M06AB.MUX.mp3`),
 * avec la durée exacte de `audio.json` ; aucun pour une vidéo muette ou un MUK.
 */
const vidPanel = videoPanel(async (ctx) => {
  const { header } = new VidDecoder(ctx.bytes);
  const mp3 = ctx.path.replace(/\.vid$/, ".mp3");
  let audio: Sound | null = null;
  if (ctx.files.size(mp3) !== undefined) {
    const entry = parseAudioIndex(new TextDecoder().decode(await ctx.fetchBytes("audio.json"))).get(mp3);
    if (!entry) throw new Error(`audio.json : pas d'entrée pour ${mp3}`);
    audio = { format: "mp3", data: await ctx.fetchBytes(mp3), sampleCount: entry.samples, sampleRate: entry.sampleRate };
  }
  return {
    clip: () => vidClip(ctx.bytes, audio),
    facts: [["Origine", header.source === "mux" ? "MUX (vidéo avec son)" : "MUK (animation sans son ni cadence)"]],
  };
});

const LEVELS: Record<QuizLevel, string> = { F: "facile", M: "moyen", D: "difficile" };

const quizPanel: Render = (ctx) => {
  const questions = parseQuiz(ctx.bytes);
  const count = (level: QuizLevel) => questions.filter((q) => q.level === level).length;
  const filter = h("select", { "aria-label": "Niveau" }, h("option", { value: "" }, "tous les niveaux"));
  for (const level of Object.keys(LEVELS) as QuizLevel[]) filter.append(h("option", { value: level }, `${LEVELS[level]} (${count(level)})`));
  const body = h("tbody", {});
  const render = () => {
    body.replaceChildren(
      ...questions
        .filter((q) => !filter.value || q.level === filter.value)
        .map((q) =>
          h(
            "tr",
            {},
            h("td", {}, String(q.number)),
            h("td", {}, LEVELS[q.level]),
            h("td", {}, q.question),
            ...q.answers.map((answer, i) => h("td", i === q.correct ? { class: "right" } : {}, i === q.correct ? `✓ ${answer}` : answer)),
          ),
        ),
    );
  };
  filter.addEventListener("change", render);
  render();
  const head = h("thead", {}, h("tr", {}, ...["N°", "Niveau", "Question", "Réponse 1", "Réponse 2", "Réponse 3"].map((label) => h("th", { scope: "col" }, label))));
  return h(
    "div",
    {},
    info(["Questions", questions.length], ["Faciles", count("F")], ["Moyennes", count("M")], ["Difficiles", count("D")]),
    h("div", { class: "bar" }, h("label", {}, "Niveau ", filter)),
    h("table", { class: "quiz" }, head, body),
  );
};

const creditsPanel: Render = (ctx) => {
  const lines = parseCredits(ctx.bytes);
  const list = h("div", { class: "credits" });
  for (const line of lines) {
    const tag = line.style ? h("span", { class: "tag" }, `@${line.style} `) : null;
    list.append(h("div", line.style === 1 ? { class: "title" } : {}, tag, line.text || " "));
  }
  return h("div", {}, info(["Lignes", lines.length], ["Titres (@1)", lines.filter((line) => line.style === 1).length]), list);
};

const BY_EXTENSION: Record<string, Render> = {
  MCG: picturePanel,
  MCC: picturePanel,
  PAL: palPanel,
  HY8: hy8Panel,
  VID: vidPanel,
  MP3: soundPanel,
  PFN: pfnPanel("Astérix : le défi de César 0123456789", encodeCp850),
  TXT: quizPanel,
  DAT: creditsPanel,
};

/** Panneaux d'Astérix, du plus précis au plus général (le dernier prend tout le reste). */
export const PANELS: Panel[] = [
  { matches: (entry) => Object.hasOwn(BY_EXTENSION, extensionOf(entry.path)), render: (ctx) => BY_EXTENSION[extensionOf(ctx.path)](ctx) },
  { matches: () => true, render: rawPanel },
];
