/**
 * Panneaux de visionneuse des formats du moteur Infogrames (outil de développement) : images MCG et MCC, palettes,
 * sprites HY8, vidéos (MUX d'origine ou conteneur `.vid`), sons MP3, polices PFN. Les visionneuses des jeux
 * (`src/games/<jeu>/ui/panels.ts`) les associent aux extensions de leurs fichiers et y ajoutent leurs propres formats.
 */
import { createMonoBuffer, u8ToFloat32 } from "../../../audio/pcm";
import { formatSize, h, hexDump, paletteSwatch } from "../../../ui/asset-viewer/helpers";
import { extensionOf, type PanelContext } from "../../../ui/asset-viewer/viewer";
import { soundDuration, type Sound } from "../audio/sound";
import { audioDuration, parseAudioIndex } from "../data/audio-index";
import { LETTER_SPACING, advance, parsePfn } from "../data/font";
import { parseHy8, type Hy8 } from "../data/hy8";
import { parseMcc } from "../data/mcc";
import { SCREEN_HEIGHT, SCREEN_WIDTH, parseMcg, parsePal, type Picture } from "../data/mcg";
import { boundsOf, placeFrame, placeSprite, type Bounds, type PlacedImage } from "../sprites";
import { VideoBackdrop, VideoPlayer, type VideoClip } from "../video";
import { indexedCanvas, makeCanvas, paintIndexed, paintPlaced, paletteTable } from "./render";

/** Rendu d'un fichier : un panneau de visionneuse est un `Render` associé à des extensions par le jeu. */
export type Render = (ctx: PanelContext) => Promise<HTMLElement> | HTMLElement;

const SCALE = 2;
const SCREEN_PIXELS = SCREEN_WIDTH * SCREEN_HEIGHT;
/** Fréquence de décodage des MP3 du site (celle de leur encodage). */
const DECODE_RATE = 22050;

export function info(...pairs: [string, string | number][]): HTMLElement {
  const list = h("dl", { class: "info" });
  for (const [key, value] of pairs) list.append(h("dt", {}, key), h("dd", {}, String(value)));
  return list;
}

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = h("button", { type: "button" }, label);
  el.addEventListener("click", onClick);
  return el;
}

export function section(title: string, ...children: (Node | string)[]): HTMLElement {
  return h("section", {}, h("h3", {}, title), ...children);
}

function dir(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

const PICTURE_EXTENSIONS = ["MCG", "MCC"];

/** Image plein écran d'un fichier `.MCG` ou `.MCC`. */
function parsePicture(path: string, bytes: Uint8Array): Picture {
  return extensionOf(path) === "MCC" ? parseMcc(bytes) : parseMcg(bytes);
}

/** Palette d'une image (MCG, MCC) ou d'un PAL du jeu. */
export async function loadPalette(ctx: PanelContext, path: string): Promise<Uint8Array> {
  const bytes = await ctx.fetchBytes(path);
  return PICTURE_EXTENSIONS.includes(extensionOf(path)) ? parsePicture(path, bytes).palette : parsePal(bytes);
}

/**
 * Fichiers de la scène ou du module du fichier ouvert (ses deux premiers dossiers : `DATA/Snn`, `MDF/NN`) portant une
 * de ces extensions, ceux de son dossier d'abord.
 */
function filesNear(ctx: PanelContext, extensions: string[]): string[] {
  const scene = ctx.path.split("/").slice(0, 2).join("/") + "/";
  const folder = dir(ctx.path) + "/";
  const candidates = ctx.files.list((p) => p.startsWith(scene) && extensions.includes(extensionOf(p)));
  return [...candidates.filter((p) => p.startsWith(folder)), ...candidates.filter((p) => !p.startsWith(folder))];
}

/** Nom d'un fichier voisin, sans les dossiers de la scène. */
function shortName(path: string): string {
  return path.split("/").slice(2).join("/");
}

/** Image MCG ou MCC, avec sa palette. */
export const picturePanel: Render = (ctx) => {
  const bytes = ctx.bytes;
  const facts: [string, string | number][] = [["Taille", `${SCREEN_WIDTH}×${SCREEN_HEIGHT}`]];
  let picture: Picture;
  if (extensionOf(ctx.path) === "MCC") {
    const mcc = parseMcc(bytes);
    picture = mcc;
    facts.push(["Séries", (bytes.length - 768) / 2], ["Pixels en trop (dernière série coupée)", mcc.overflow]);
  } else {
    const mcg = parseMcg(bytes);
    picture = mcg;
    facts.push(["En-tête", `0x${mcg.header.toString(16).padStart(4, "0")}`]);
  }
  const canvas = indexedCanvas(picture.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, paletteTable(picture.palette, false), SCALE);
  return h("div", {}, info(...facts), canvas, section("Palette", paletteSwatch(picture.palette)));
};

export const palPanel: Render = (ctx) => {
  const palette = parsePal(ctx.bytes);
  return h("div", {}, section("Palette", paletteSwatch(palette, 18)));
};

export const hy8Panel: Render = async (ctx) => {
  const hy8 = parseHy8(ctx.bytes);
  const root = h("div", {});
  const palettes = filesNear(ctx, [...PICTURE_EXTENSIONS, "PAL"]);
  const select = h("select", {}, h("option", { value: "" }, "niveaux de gris"));
  for (const p of palettes) select.append(h("option", { value: p }, shortName(p)));
  let table = paletteTable(null, true);
  let palette: Uint8Array | null = null;
  const body = h("div", {});
  let stopPlayer = () => {};
  ctx.onDispose(() => stopPlayer());

  const render = () => {
    stopPlayer();
    body.replaceChildren();
    body.append(info(["Images", hy8.images.length], ["Sprites", hy8.sprites.length], ["Animations", hy8.animations.length]));
    body.append(animationSection(hy8, table, (stop) => (stopPlayer = stop)));
    body.append(imagesSection(hy8, table), spritesSection(hy8, table));
  };

  const apply = async () => {
    try {
      palette = select.value ? await loadPalette(ctx, select.value) : null;
      table = paletteTable(palette, true);
    } catch (error) {
      palette = null;
      table = paletteTable(null, true);
      body.prepend(h("p", { class: "error" }, `Palette : ${(error as Error).message}`));
    }
    render();
  };
  select.addEventListener("change", apply);
  if (palettes.length > 0) select.value = palettes[0];
  root.append(h("label", {}, "Palette ", select), body);
  await apply();
  return root;
};

function imagesSection(hy8: Hy8, table: Uint32Array): HTMLElement {
  const grid = h("div", { class: "grid" });
  hy8.images.forEach((image, index) => {
    const canvas = indexedCanvas(image.pixels, image.width, image.height, table, SCALE);
    canvas.classList.add("alpha");
    grid.append(h("figure", {}, canvas, h("figcaption", {}, `#${index} ${image.width}×${image.height}`)));
  });
  return section(`Images (${hy8.images.length})`, hy8.images.length ? grid : h("p", { class: "empty" }, "aucune"));
}

function spritesSection(hy8: Hy8, table: Uint32Array): HTMLElement {
  const grid = h("div", { class: "grid" });
  hy8.sprites.forEach((_, index) => {
    try {
      const placed = placeSprite(hy8, index, false);
      const bounds = boundsOf(placed);
      if (!(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY)) {
        grid.append(h("figure", {}, h("figcaption", { class: "empty" }, `sprite ${index} : vide`)));
        return;
      }
      const canvas = makeCanvas(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, SCALE);
      canvas.classList.add("alpha");
      paintPlaced(canvas, placed, bounds, table);
      const rect = placed.some((p) => p.opaque) ? " (rectangle plein)" : "";
      grid.append(h("figure", {}, canvas, h("figcaption", {}, `sprite ${index}${rect}`)));
    } catch (error) {
      grid.append(h("figure", {}, h("figcaption", { class: "error" }, `sprite ${index} : ${(error as Error).message}`)));
    }
  });
  return section(`Sprites (${hy8.sprites.length})`, hy8.sprites.length ? grid : h("p", { class: "empty" }, "aucun"));
}

/** Lecture des animations à 11 images/s ; `register` reçoit la fonction d'arrêt. */
function animationSection(hy8: Hy8, table: Uint32Array, register: (stop: () => void) => void): HTMLElement {
  const wrap = section(`Animations (${hy8.animations.length})`);
  if (hy8.animations.length === 0) {
    wrap.append(h("p", { class: "empty" }, "aucune"));
    return wrap;
  }
  const select = h("select", {});
  hy8.animations.forEach((animation, index) => select.append(h("option", { value: String(index) }, `#${index} (${animation.frames.length} images)`)));
  const anchor = h("input", { type: "checkbox" });
  const counter = h("span", { class: "counter" });
  const stage = h("div", { class: "stage" });
  let timer = 0;
  let paused = false;
  let frameNo = 0;
  let canvas: HTMLCanvasElement | null = null;
  let frames: PlacedImage[][] = [];
  let bounds: Bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };

  const draw = () => {
    if (!canvas || frames.length === 0) return;
    paintPlaced(canvas, frames[frameNo], bounds, table);
    if (anchor.checked) {
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f0f";
      ctx.fillRect(-bounds.minX - 1, -bounds.minY - 1, 2, 2);
    }
    counter.textContent = `image ${frameNo + 1}/${frames.length}`;
  };
  const stop = () => window.clearInterval(timer);
  const load = () => {
    stop();
    stage.replaceChildren();
    canvas = null;
    frameNo = 0;
    try {
      const animation = hy8.animations[Number(select.value)];
      frames = animation.frames.map((frame) => placeFrame(hy8, frame));
      if (frames.length === 0) {
        stage.append(h("p", { class: "empty" }, "animation vide"));
        counter.textContent = "";
        return;
      }
      bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const placed of frames) boundsOf(placed, bounds);
      if (!(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY)) bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
      canvas = makeCanvas(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 3);
      canvas.classList.add("alpha");
      stage.append(canvas);
      draw();
      timer = window.setInterval(() => {
        if (paused) return;
        frameNo = (frameNo + 1) % frames.length;
        draw();
      }, 1000 / 11);
    } catch (error) {
      stage.append(h("p", { class: "error" }, (error as Error).message));
    }
  };
  select.addEventListener("change", load);
  anchor.addEventListener("change", draw);
  const toggle = button("pause", () => {
    paused = !paused;
    toggle.textContent = paused ? "lecture" : "pause";
  });
  const next = button("image +1", () => {
    paused = true;
    toggle.textContent = "lecture";
    if (frames.length) frameNo = (frameNo + 1) % frames.length;
    draw();
  });
  wrap.append(h("div", { class: "bar" }, select, toggle, next, h("label", {}, anchor, " ancre"), counter), stage);
  register(stop);
  load();
  return wrap;
}

/** Décode un MP3 hors du contexte de sortie : possible avant tout geste (`decodeAudioData` détache le tampon qu'on lui passe). */
function decodeMp3(bytes: Uint8Array): Promise<AudioBuffer> {
  return new OfflineAudioContext(1, 1, DECODE_RATE).decodeAudioData(bytes.slice().buffer);
}

/** Tampon audio d'un son du moteur (PCM d'une vidéo MUX, ou MP3). */
async function audioBuffer(sound: Sound): Promise<AudioBuffer> {
  if (sound.format === "mp3") return decodeMp3(sound.data);
  return createMonoBuffer(new OfflineAudioContext(1, 1, DECODE_RATE), u8ToFloat32(sound.data), sound.sampleRate);
}

/** Ce qu'un jeu fournit au panneau vidéo pour un fichier. */
export interface OpenedVideo {
  /** Une vidéo neuve à chaque appel, prête à être décodée depuis sa première image. */
  clip(): VideoClip;
  /** Lignes d'information propres au fichier (origine, format). */
  facts?: [string, string | number][];
}

type Composition = "full" | "overlay" | "callback";

/**
 * Panneau vidéo commun : lit la vidéo avec le `VideoPlayer` du moteur (image = floor(temps × cadence), temps du son),
 * dans les trois compositions du lecteur d'origine (docs/asterix/engine.md §4.6), sur un décor choisi parmi les images
 * du module. Affiche la valeur du marqueur (`DS:6425`) et la liste des marqueurs rencontrés.
 */
export function videoPanel(open: (ctx: PanelContext) => Promise<OpenedVideo> | OpenedVideo): Render {
  return async (ctx) => {
    const opened = await open(ctx);
    const first = opened.clip();
    const sound = first.audio;
    const buffer = sound ? await audioBuffer(sound) : null;
    const audioSeconds = sound ? soundDuration(sound) : 0;

    const canvas = makeCanvas(SCREEN_WIDTH, SCREEN_HEIGHT, SCALE);
    const counter = h("span", { class: "counter" });
    const status = h("p", { class: "error" });
    const markerList = h("ol", { class: "markers" });
    // Décors : les images du module d'abord, puis toutes les autres (un calque se pose souvent sur l'écran d'un autre module).
    const near = filesNear(ctx, PICTURE_EXTENSIONS);
    const decors = [...near, ...ctx.files.list((p) => PICTURE_EXTENSIONS.includes(extensionOf(p)) && !near.includes(p))];
    const modeSelect = h(
      "select",
      { "aria-label": "Composition" },
      h("option", { value: "full" }, "plein écran : image cumulée"),
      h("option", { value: "overlay" }, "surimpression (0x1000) sur le décor"),
      h("option", { value: "callback" }, "rappel d'image (0x80) : image courante posée sur le décor"),
    );
    const decorSelect = h("select", { "aria-label": "Décor" });
    for (const path of decors) decorSelect.append(h("option", { value: path }, near.includes(path) ? shortName(path) : path));

    const paletteSelect = h(
      "select",
      { "aria-label": "Palette" },
      h("option", { value: "video" }, "de la vidéo"),
      h("option", { value: "decor" }, "du décor (0x4 : palette courante gardée)"),
    );

    let player = new VideoPlayer(first);
    let decor: Picture | null = null;
    let backdrop: VideoBackdrop | null = null;
    let playing = false;
    let raf = 0;
    let actx: AudioContext | null = null;
    let node: AudioBufferSourceNode | null = null;
    /** Temps du contexte audio auquel correspond le début de la vidéo. */
    let startTime = 0;
    const written = [new Uint8Array(SCREEN_PIXELS), new Uint8Array(SCREEN_PIXELS)];
    const rgba = canvas.getContext("2d")!.createImageData(SCREEN_WIDTH, SCREEN_HEIGHT);
    const out = new Uint32Array(rgba.data.buffer);

    const mode = (): Composition => (decor ? (modeSelect.value as Composition) : "full");
    /** Palette des pixels de la vidéo : la sienne, ou celle du décor (un MUK sans palette se lit avec celle de l'écran). */
    const videoPalette = (): Uint8Array => (decor && paletteSelect.value === "decor" ? decor.palette : player.palette);

    const paint = () => {
      if (player.shown < 0) return;
      if (mode() === "callback" && decor) {
        // Pixels écrits par l'image courante : ceux qui prennent la même valeur sur deux fonds différents. Le fond magenta
        // ou noir d'un calque n'en fait pas partie (il n'est écrit que par la première image) : pas de couleur clé.
        written[0].fill(0);
        written[1].fill(1);
        player.compose(written[0]);
        player.compose(written[1]);
        const video = paletteTable(videoPalette(), false);
        const back = paletteTable(decor.palette, false);
        for (let i = 0; i < SCREEN_PIXELS; i++) {
          out[i] = written[0][i] === written[1][i] ? video[written[0][i]] : back[decor.pixels[i]];
        }
        canvas.getContext("2d")!.putImageData(rgba, 0, 0);
      } else {
        const palette = backdrop ? backdrop.combine(player.palette) : videoPalette();
        paintIndexed(canvas, player.pixels, SCREEN_WIDTH, SCREEN_HEIGHT, paletteTable(palette, false));
      }
      const shown = Math.min(player.shown, player.frameCount - 1);
      counter.textContent = `image ${shown + 1}/${player.frameCount} · marqueur ${player.marker}`;
    };

    /** Décode jusqu'à `frame`, en notant les marqueurs rencontrés. */
    const seek = (frame: number) => {
      try {
        const changed = player.seek(frame, (index, markers) => {
          if (markers.length > 0) markerList.append(h("li", {}, `image ${index + 1} : ${player.marker}`));
        });
        if (changed) paint();
      } catch (error) {
        status.textContent = (error as Error).message;
        pause();
      }
    };

    const stopAudio = () => {
      try {
        node?.stop();
      } catch {
        /* déjà arrêté */
      }
      node = null;
    };
    const pause = () => {
      playing = false;
      cancelAnimationFrame(raf);
      stopAudio();
      playBtn.textContent = "lecture";
    };
    const restart = () => {
      pause();
      status.textContent = "";
      markerList.replaceChildren();
      backdrop = null;
      if (decor && mode() === "overlay") {
        backdrop = new VideoBackdrop();
        backdrop.set(decor.pixels, decor.palette);
      }
      player = new VideoPlayer(opened.clip(), backdrop ?? undefined);
      seek(0);
    };
    const tick = () => {
      if (!playing || !actx) return;
      const time = actx.currentTime - startTime;
      seek(player.frameAt(time));
      // Comme la scène vidéo du moteur : la fin attend celle du son, qui déborde un peu la dernière image.
      if (playing && player.endedAt(time) && time >= audioSeconds) pause();
      else if (playing) raf = requestAnimationFrame(tick);
    };
    const play = () => {
      if (playing) return;
      actx = ctx.audio();
      void actx.resume();
      if (player.shown >= player.frameCount - 1) restart();
      const from = Math.max(0, player.shown) / player.fps;
      startTime = actx.currentTime - from;
      if (buffer && from < audioSeconds) {
        node = actx.createBufferSource();
        node.buffer = buffer;
        node.connect(actx.destination);
        node.start(0, from, audioSeconds - from);
      }
      playing = true;
      playBtn.textContent = "pause";
      raf = requestAnimationFrame(tick);
    };
    const playBtn = button("lecture", () => (playing ? pause() : play()));
    const stepBtn = button("image +1", () => {
      pause();
      seek(player.shown + 1);
    });
    const restartBtn = button("début", restart);

    const applyDecor = async () => {
      decor = null;
      const wanted = decorSelect.value;
      paletteSelect.disabled = modeSelect.value === "overlay";
      if (wanted) {
        try {
          decor = parsePicture(wanted, await ctx.fetchBytes(wanted));
        } catch (error) {
          status.textContent = `Décor : ${(error as Error).message}`;
        }
      }
      restart();
    };
    modeSelect.addEventListener("change", () => void applyDecor());
    decorSelect.addEventListener("change", () => void applyDecor());
    paletteSelect.addEventListener("change", paint);
    ctx.onDispose(pause);
    await applyDecor();
    // Vidéo sans palette (`34/M34AG.MUK`) : celle du décor par défaut, sinon tout est noir.
    if (decor && player.palette.every((value) => value === 0)) {
      paletteSelect.value = "decor";
      paint();
    }

    const cadence = first.source.framesPerSecond
      ? `${first.source.framesPerSecond.toFixed(2)} images/s`
      : `aucune dans le fichier, lue ici à ${player.fps} images/s`;
    const composition =
      decors.length > 0
        ? h("div", { class: "bar" }, h("label", {}, "Composition ", modeSelect), h("label", {}, "Décor ", decorSelect), h("label", {}, "Palette ", paletteSelect))
        : h("p", { class: "empty" }, "aucune image dans ce jeu : composition plein écran seulement");
    return h(
      "div",
      {},
      info(
        ["Taille", `${SCREEN_WIDTH}×${SCREEN_HEIGHT}`],
        ["Images", first.source.frameCount],
        ["Cadence", cadence],
        ["Son", sound ? `${sound.sampleRate} Hz, ${audioSeconds.toFixed(2)} s (${sound.format === "mp3" ? "MP3 à part" : "PCM 8 bits des blocs"})` : "aucun"],
        ...(opened.facts ?? []),
      ),
      composition,
      canvas,
      h("div", { class: "bar" }, playBtn, stepBtn, restartBtn, counter),
      status,
      section("Marqueurs rencontrés", markerList),
    );
  };
}

/**
 * Son du jeu : un VOC d'origine (ou le son d'une vidéo) versionné en MP3. Sa fréquence et sa longueur d'origine viennent
 * de l'index `audio.json` ; la lecture s'arrête à cette durée, comme dans le jeu.
 */
export const soundPanel: Render = async (ctx) => {
  const index = parseAudioIndex(new TextDecoder().decode(await ctx.fetchBytes("audio.json")));
  const entry = index.get(ctx.path);
  const decoded = await decodeMp3(ctx.bytes);
  const data = decoded.getChannelData(0);
  const duration = entry ? audioDuration(entry) : decoded.duration;
  const wave = makeCanvas(640, 80);
  const g = wave.getContext("2d")!;
  g.fillStyle = "#8cf";
  const step = Math.max(1, Math.floor(data.length / 640));
  for (let x = 0; x < 640; x++) {
    let min = 1;
    let max = -1;
    for (let i = x * step; i < Math.min(data.length, (x + 1) * step); i++) {
      min = Math.min(min, data[i]);
      max = Math.max(max, data[i]);
    }
    if (max >= min) g.fillRect(x, 40 - max * 40, 1, Math.max(1, (max - min) * 40));
  }
  let source: AudioBufferSourceNode | null = null;
  const stop = () => {
    try {
      source?.stop();
    } catch {
      /* déjà arrêté */
    }
    source = null;
  };
  ctx.onDispose(stop);
  const play = button("lecture", () => {
    stop();
    const actx = ctx.audio();
    void actx.resume();
    source = actx.createBufferSource();
    source.buffer = decoded;
    source.connect(actx.destination);
    source.start(0, 0, duration);
  });
  return h(
    "div",
    {},
    info(
      ["Fréquence d'origine", entry ? `${entry.sampleRate} Hz` : "inconnue (absent de audio.json)"],
      ["Échantillons d'origine", entry ? entry.samples : "inconnu"],
      ["Durée", `${duration.toFixed(2)} s`],
      ["Fichier", `MP3, ${formatSize(ctx.bytes.length)}`],
    ),
    wave,
    h("div", { class: "bar" }, play, button("stop", stop)),
  );
};

/** Police PFN : `sample` est le texte d'essai proposé, `encode` le codage des textes du jeu (CP437, CP850). */
export function pfnPanel(sample: string, encode: (text: string) => Uint8Array): Render {
  return (ctx) => {
    const font = parsePfn(ctx.bytes);
    const input = h("input", { type: "text", value: sample, size: "40" });
    const preview = makeCanvas(1, 1);
    const render = () => {
      const codes = encode(input.value);
      const width = Math.max(1, codes.reduce((sum, c) => sum + advance(font, c), 0));
      preview.width = width;
      preview.height = font.height;
      preview.style.width = `${width * 3}px`;
      preview.style.height = `${font.height * 3}px`;
      const table = paletteTable(null, true);
      table[1] = 0xffffffff;
      const pixels = new Uint8Array(width * font.height);
      let x = 0;
      for (const code of codes) {
        const glyph = font.glyphs.get(code);
        if (glyph && glyph.width > 0) {
          for (let row = 0; row < font.height; row++) {
            for (let col = 0; col < glyph.width; col++) pixels[row * width + x + col] = glyph.bitmap[row * glyph.width + col];
          }
        }
        x += advance(font, code);
      }
      paintIndexed(preview, pixels, width, font.height, table);
    };
    input.addEventListener("input", render);
    render();
    const grid = h("div", { class: "grid glyphs" });
    const white = paletteTable(null, true);
    white[1] = 0xffffffff;
    for (const [code, glyph] of font.glyphs) {
      const cell = h("figure", {});
      if (glyph.width > 0) {
        const canvas = indexedCanvas(glyph.bitmap, glyph.width, font.height, white, 4);
        canvas.classList.add("alpha");
        cell.append(canvas);
      } else {
        cell.append(h("div", { class: "blank" }, "∅"));
      }
      cell.append(h("figcaption", {}, `0x${code.toString(16)} ${glyph.width}px`));
      grid.append(cell);
    }
    return h(
      "div",
      {},
      info(["Hauteur", font.height], ["Premier code", `0x${font.firstChar.toString(16)}`], ["Glyphes", font.glyphs.size], ["Espacement", LETTER_SPACING]),
      h("div", { class: "bar" }, h("label", {}, "Texte ", input)),
      h("div", { class: "preview" }, preview),
      section("Glyphes", grid),
    );
  };
}

export const rawPanel: Render = (ctx) => h("div", {}, info(["Taille", formatSize(ctx.bytes.length)]), h("pre", {}, hexDump(ctx.bytes)));
