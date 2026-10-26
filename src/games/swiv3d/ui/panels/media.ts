/** Panneaux des sons (SOUNDS.BD), des vidéos Smacker (+ textes .SCR), de la musique MP3, des scripts .SCR et du manuel. */
import { riffWaveToChannels } from "../../../../data/riff-wave";
import { SmackerDecoder, type SmackerFrame } from "../../../../data/smacker";
import { TrackPlayer } from "../../../../audio/track-player";
import { h, hexDump } from "../../../../ui/asset-viewer/helpers";
import type { Panel, PanelContext } from "../../../../ui/asset-viewer/viewer";
import { makeCanvas } from "../../../../ui/indexed-canvas";
import { parseScr, type ScrLine } from "../../data/scr";
import { parseSoundBank } from "../../data/sounds";
import type { StringTables } from "../../data/strings";
import { errorBox, info, section, select, table } from "./common";
import { loadStrings, nameOf } from "./shared";

// --- SOUNDS.BD -----------------------------------------------------------------------------------------------------------------------

export const soundsPanel: Panel = {
  matches: (entry) => nameOf(entry.path) === "SOUNDS.BD",
  render(ctx: PanelContext) {
    const bank = parseSoundBank(ctx.bytes);
    let source: AudioBufferSourceNode | null = null;
    let playing: HTMLButtonElement | null = null;
    const stop = (): void => {
      try {
        source?.stop();
      } catch {
        /* déjà arrêtée */
      }
      source = null;
      if (playing) playing.textContent = "▶";
      playing = null;
    };
    ctx.onDispose(stop);
    const tbody = h("tbody", {});
    for (const s of bank.sounds) {
      const { wave } = s;
      const frames = Math.floor(wave.data.length / (wave.channels * (wave.bitsPerSample / 8)));
      const button = h("button", { type: "button", "aria-label": `Jouer ${s.id}` }, "▶");
      button.addEventListener("click", () => {
        const was = playing;
        stop();
        if (was === button) return;
        try {
          const audio = ctx.audio();
          void audio.resume();
          const channels = riffWaveToChannels(wave);
          const buffer = audio.createBuffer(channels.length, frames, Math.max(3000, wave.sampleRate));
          channels.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
          const node = audio.createBufferSource();
          node.buffer = buffer;
          node.connect(audio.destination);
          node.onended = () => {
            if (source === node) stop();
          };
          node.start();
          source = node;
          playing = button;
          button.textContent = "■";
        } catch (error) {
          button.title = error instanceof Error ? error.message : String(error);
          button.textContent = "!";
        }
      });
      const cells: (string | Node)[] = [button, String(s.id), String(wave.channels), `${wave.sampleRate} Hz`, `${wave.bitsPerSample} bits`, `${(frames / wave.sampleRate).toFixed(2)} s`, `${wave.data.length} o`];
      const row = h("tr", {});
      cells.forEach((c, i) => {
        const td = h("td", i >= 1 ? { class: "num" } : {});
        td.append(c);
        row.append(td);
      });
      tbody.append(row);
    }
    return h(
      "div",
      {},
      info(["Sons", bank.sounds.length]),
      h("table", {}, h("thead", {}, h("tr", {}, ...["", "id", "canaux", "fréquence", "format", "durée", "données"].map((t) => h("th", {}, t)))), tbody),
    );
  },
};

// --- Vidéos Smacker -----------------------------------------------------------------------------------------------------------------

/** Images décodées d'avance et leur audio : l'horloge est celle du contexte audio. */
const LOOKAHEAD = 12;

interface Decoded {
  frame: SmackerFrame;
}

function languageOf(strings: StringTables): number {
  const i = strings.languages.findIndex((name) => name.toLowerCase().startsWith("fran"));
  return i < 0 ? 0 : i;
}

/** Texte d'une ligne .SCR : la table 200 (nom de mission) prend l'index de la mission courante au lieu du numéro de chaîne. */
function scrText(strings: StringTables, language: number, line: ScrLine, mission: number): string {
  const [tableId, id] = line.values;
  return strings.get(language, tableId, tableId === 200 ? mission : id) ?? `(table ${tableId} n° ${id} absente)`;
}

export const videoPanel: Panel = {
  matches: (entry) => nameOf(entry.path).endsWith(".SMK"),
  async render(ctx: PanelContext) {
    const decoder = new SmackerDecoder(ctx.bytes);
    const file = decoder.file;
    const doubled = file.flags.yDouble || file.flags.yInterlaced;
    const outH = file.height * (doubled ? 2 : 1);
    const duration = file.frameDurationMs / 1000;

    // Textes superposés des briefings : BR_TERn.SMK + BR_TERn.SCR (chaînes de GLOBAL.BD).
    const baseName = nameOf(ctx.path).replace(/\.SMK$/, "");
    const missionMatch = /^BR_TER(\d)$/.exec(baseName);
    let scr: ScrLine[] = [];
    let strings: StringTables | null = null;
    let scrError: string | null = null;
    if (missionMatch) {
      try {
        const scrPath = ctx.files.resolve(`${ctx.path.replace(/\.SMK$/i, "")}.SCR`);
        if (scrPath) scr = parseScr(await ctx.fetchBytes(scrPath));
        strings = (await loadStrings(ctx)).strings;
      } catch (error) {
        scrError = error instanceof Error ? error.message : String(error);
      }
    }
    const mission = missionMatch ? Number(missionMatch[1]) : 0;
    let language = strings ? languageOf(strings) : 0;

    // --- affichage
    let aspect: "tv" | "square" = "tv";
    const screen = makeCanvas(file.width, outH);
    screen.classList.add("video");
    const overlay = document.createElement("canvas");
    overlay.className = "overlay";
    const stage = h("div", { class: "stage-video" }, screen, overlay);
    const screenCtx = screen.getContext("2d", { alpha: false })!;
    const image = screenCtx.createImageData(file.width, outH);
    const out = new Uint32Array(image.data.buffer);
    const little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

    const applySize = (): void => {
      const cssW = aspect === "tv" ? 640 : file.width * 2;
      const cssH = aspect === "tv" ? 480 : outH * 2;
      for (const c of [screen, overlay]) {
        c.style.width = `${cssW}px`;
        c.style.height = `${cssH}px`;
      }
      overlay.width = cssW;
      overlay.height = cssH;
      drawOverlay();
    };

    let shown = -1;
    let currentFrame: SmackerFrame | null = null;
    const status = h("span", { class: "empty" });

    function drawOverlay(): void {
      const c = overlay.getContext("2d")!;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, overlay.width, overlay.height);
      if (!strings || scr.length === 0) return;
      c.setTransform(overlay.width / file.width, 0, 0, overlay.height / outH, 0, 0);
      const n = Math.max(0, shown);
      c.textBaseline = "top";
      for (const line of scr) {
        const [, , first, last, x, y] = line.values;
        if (n < first || n > last) continue;
        const bold = line.codes[0] === "b";
        c.font = `${bold ? "bold " : ""}13px ui-monospace, Menlo, monospace`;
        c.textAlign = line.codes[1] === "l" ? "left" : line.codes[1] === "c" ? "center" : "right";
        scrText(strings, language, line, mission)
          .split("|")
          .forEach((text, i) => {
            c.fillStyle = "#000";
            c.fillText(text, x + 1, y + i * 14 + 1);
            c.fillStyle = bold ? "#ffe9a0" : "#ffffff";
            c.fillText(text, x, y + i * 14);
          });
      }
    }

    function paint(frame: SmackerFrame): void {
      const lut = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        const r = frame.palette[i * 3]!;
        const g = frame.palette[i * 3 + 1]!;
        const b = frame.palette[i * 3 + 2]!;
        lut[i] = little ? (0xff000000 | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0;
      }
      for (let y = 0; y < outH; y++) {
        const sy = doubled ? y >> 1 : y;
        for (let x = 0; x < file.width; x++) out[y * file.width + x] = lut[frame.pixels[sy * file.width + x]!]!;
      }
      screenCtx.putImageData(image, 0, 0);
      shown = frame.index;
      currentFrame = frame;
      status.textContent = `image ${frame.index + 1}/${file.frameCount} · ${((frame.index * file.frameDurationMs) / 1000).toFixed(2)} s`;
      drawOverlay();
    }

    // --- lecture : horloge = AudioContext, images décodées avec un peu d'avance
    const queue: Decoded[] = [];
    let playing = false;
    let raf = 0;
    let t0 = 0;
    let audioCursor = 0;
    let desync = true;
    let sources: AudioBufferSourceNode[] = [];
    let suspendedByUs = false;
    const playButton = h("button", { type: "button" }, "▶ lecture");

    const stopSources = (): void => {
      for (const s of sources) {
        try {
          s.stop();
        } catch {
          /* déjà finie */
        }
      }
      sources = [];
    };

    function scheduleAudio(frame: SmackerFrame): void {
      const track = frame.audio[0];
      if (!track || track.samples.length === 0) return;
      const audio = ctx.audio();
      const frames = Math.floor(track.samples.length / track.channels);
      const buffer = audio.createBuffer(track.channels, frames, Math.max(3000, track.rate));
      for (let c = 0; c < track.channels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < frames; i++) data[i] = track.samples[i * track.channels + c]! / 32768;
      }
      const node = audio.createBufferSource();
      node.buffer = buffer;
      node.connect(audio.destination);
      const at = Math.max(audioCursor, audio.currentTime);
      node.start(at);
      audioCursor = at + buffer.duration;
      node.onended = () => void (sources = sources.filter((s) => s !== node));
      sources.push(node);
    }

    function fillQueue(): void {
      while (queue.length < LOOKAHEAD && !decoder.done) {
        const frame = decoder.nextFrame();
        if (!frame) break;
        queue.push({ frame });
        if (playing) scheduleAudio(frame);
      }
    }

    /** Recale l'horloge sur la prochaine image à montrer et reprogramme l'audio des images déjà décodées. */
    function resync(): void {
      const audio = ctx.audio();
      stopSources();
      const base = shown + 1;
      t0 = audio.currentTime + 0.1 - base * duration;
      audioCursor = audio.currentTime + 0.1;
      desync = false;
      for (const d of queue) scheduleAudio(d.frame);
    }

    function tick(): void {
      if (!playing) return;
      const audio = ctx.audio();
      fillQueue();
      const target = Math.floor((audio.currentTime - t0) / duration);
      while (queue.length > 0 && queue[0]!.frame.index <= target) paint(queue.shift()!.frame);
      if (queue.length === 0 && decoder.done) {
        pause();
        status.textContent += " · fin";
        return;
      }
      raf = requestAnimationFrame(tick);
    }

    function play(): void {
      if (playing) return;
      if (queue.length === 0 && decoder.done) restart();
      const audio = ctx.audio();
      playing = true;
      playButton.textContent = "❚❚ pause";
      void audio.resume();
      suspendedByUs = false;
      if (desync) resync();
      fillQueue();
      raf = requestAnimationFrame(tick);
    }

    function pause(): void {
      if (!playing) return;
      playing = false;
      cancelAnimationFrame(raf);
      playButton.textContent = "▶ lecture";
      const audio = ctx.audio();
      if (audio.state === "running") {
        suspendedByUs = true;
        void audio.suspend();
      }
    }

    function step(): void {
      pause();
      fillQueue();
      const next = queue.shift();
      if (next) paint(next.frame);
      desync = true;
    }

    function restart(): void {
      const was = playing;
      pause();
      stopSources();
      decoder.reset();
      queue.length = 0;
      shown = -1;
      desync = true;
      fillQueue();
      if (queue[0]) {
        paint(queue[0].frame);
        shown = -1; // l'image 0 reste à montrer : la lecture repart d'elle
      }
      if (was) play();
    }

    ctx.onDispose(() => {
      playing = false;
      cancelAnimationFrame(raf);
      stopSources();
      if (suspendedByUs) void ctx.audio().resume();
    });

    playButton.addEventListener("click", () => (playing ? pause() : play()));
    const stepButton = h("button", { type: "button" }, "image suivante");
    stepButton.addEventListener("click", step);
    const restartButton = h("button", { type: "button" }, "⏮ début");
    restartButton.addEventListener("click", restart);

    // Première image affichée sans la consommer.
    fillQueue();
    if (queue[0]) {
      paint(queue[0].frame);
      shown = -1;
    }
    applySize();

    const tracks = file.audioTracks.map((t) => `piste ${t.index} : ${t.rate} Hz ${t.channels === 2 ? "stéréo" : "mono"} ${t.bits} bits${t.packed ? " (DPCM)" : ""}`).join(" ; ") || "aucune";
    const bar = h(
      "div",
      { class: "bar" },
      playButton,
      stepButton,
      restartButton,
      select(
        "affichage",
        [
          ["tv", "4:3 (écran VGA, 640×480)"],
          ["square", "pixels carrés ×2"],
        ] as ["tv" | "square", string][],
        aspect,
        (value) => {
          aspect = value;
          applySize();
        },
      ),
      status,
    );
    if (strings && scr.length > 0) {
      const s = strings;
      bar.append(
        select(
          "langue",
          s.languages.map((name, i) => [i, name] as [number, string]),
          language,
          (value) => {
            language = value;
            drawOverlay();
          },
        ),
      );
    }
    const children: Node[] = [
      info(
        ["Signature", file.signature],
        ["Taille", `${file.width}×${file.height}${doubled ? " (Y doublé/entrelacé : affichée en hauteur double)" : " (sans Y doublé ni entrelacé)"}`],
        ["Images", `${file.frameCount} à ${file.fps.toFixed(2)} i/s (${file.frameDurationMs} ms) = ${(file.frameCount * duration).toFixed(1)} s`],
        ["Drapeaux", `anneau ${file.flags.ring}, Y entrelacé ${file.flags.yInterlaced}, Y doublé ${file.flags.yDouble}`],
        ["Audio", tracks],
      ),
      bar,
      stage,
    ];
    if (scrError) children.push(h("p", { class: "error" }, `Textes .SCR indisponibles : ${scrError}`));
    if (strings && scr.length > 0) {
      const s = strings;
      children.push(
        section(
          `Textes superposés (${baseName}.SCR)`,
          table(
            ["table", "n°", "première", "dernière", "x", "y", "style", "align.", "texte"],
            scr.map((line) => [...line.values.slice(0, 6), line.codes[0] === "b" ? "gras" : "normal", { l: "gauche", c: "centre", r: "droite" }[line.codes[1].toLowerCase()] ?? line.codes[1], scrText(s, language, line, mission)]),
            ["num", "num", "num", "num", "num", "num", "", "", "text"],
          ),
        ),
      );
    }
    void currentFrame;
    return h("div", {}, ...children);
  },
};

// --- Scripts .SCR ------------------------------------------------------------------------------------------------------------------

export const scrPanel: Panel = {
  matches: (entry) => nameOf(entry.path).endsWith(".SCR"),
  async render(ctx: PanelContext) {
    const lines = parseScr(ctx.bytes);
    const mission = Number(/BR_TER(\d)/.exec(nameOf(ctx.path))?.[1] ?? 0);
    let strings: StringTables | null = null;
    let problem: HTMLElement | null = null;
    try {
      strings = (await loadStrings(ctx)).strings;
    } catch (error) {
      problem = errorBox(error);
    }
    const language = strings ? languageOf(strings) : 0;
    return h(
      "div",
      {},
      info(["Format", "table, n° de chaîne, première image, dernière image, x, y, style (g/b), alignement (l/c/r)"]),
      problem,
      table(
        ["table", "n°", "première", "dernière", "x", "y", "codes", "texte (français)"],
        lines.map((line) => [...line.values, line.codes.join(" "), strings ? scrText(strings, language, line, mission) : ""]),
        ["num", "num", "num", "num", "num", "num", "", "text"],
      ),
      h("details", { class: "resource" }, h("summary", {}, "Octets"), h("pre", {}, hexDump(ctx.bytes, 256))),
    );
  },
};

// --- Musique ---------------------------------------------------------------------------------------------------------------------------

export const musicPanel: Panel = {
  matches: (entry) => nameOf(entry.path).endsWith(".MP3"),
  render(ctx: PanelContext) {
    const player = new TrackPlayer();
    const time = h("span", { class: "empty" }, "arrêté");
    const length = h("span", {}, "…");
    const probe = new Audio();
    probe.preload = "metadata";
    probe.addEventListener("loadedmetadata", () => {
      length.textContent = Number.isFinite(probe.duration) ? `${Math.floor(probe.duration / 60)} min ${Math.round(probe.duration % 60)} s` : "inconnue";
    });
    probe.src = ctx.url;
    const button = h("button", { type: "button" }, "▶ lecture");
    let on = false;
    const stop = (): void => {
      player.stop();
      on = false;
      button.textContent = "▶ lecture";
      time.textContent = "arrêté";
    };
    button.addEventListener("click", () => {
      if (on) return stop();
      player.onEnded = stop;
      player.play(ctx.url);
      on = true;
      button.textContent = "■ arrêt";
    });
    const timer = setInterval(() => {
      if (on) time.textContent = `${player.currentTime.toFixed(1)} s${player.playing ? "" : " (en attente)"}`;
    }, 250);
    ctx.onDispose(() => {
      clearInterval(timer);
      player.stop();
      probe.removeAttribute("src");
    });
    return h("div", {}, info(["Piste du CD", (/TRACK(\d+)/.exec(nameOf(ctx.path))?.[1] ?? "?")], ["Durée", length], ["Format", "MP3 128 kbit/s, 44,1 kHz stéréo (voir docs/swiv3d/files.md)"]), h("div", { class: "bar" }, button, time));
  },
};

// --- Manuel --------------------------------------------------------------------------------------------------------------------------------

export const manualPanel: Panel = {
  matches: (entry) => nameOf(entry.path).endsWith(".TXT"),
  render(ctx: PanelContext) {
    const text = new TextDecoder("windows-1252").decode(ctx.bytes);
    return h("div", {}, info(["Encodage", "Windows-1252 (é = 0xE9) ; tabulations et CR/LF conservés"], ["Lignes", text.split(/\r?\n/).length]), h("pre", { class: "manual" }, text));
  },
};
