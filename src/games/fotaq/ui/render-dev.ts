/**
 * Page de développement du rendu de Flight of the Amazon Queen (vague R) : outil, hors du build du site. Page :
 * `/src/games/fotaq/ui/render-dev.html` (serveur de dev Vite), paramètres `?room=1&x=160&y=120&scale=100&outfit=dress`.
 * Précharge les fichiers de données (pas les voix ni la musique), monte le moteur avec la scène réelle (`GameStage`) et un hôte
 * minimal (souris, pas de son) et peint ses images ; l'hôte du jeu (vague J) remplacera celui-ci. Les libellés sont ceux d'un outil
 * de développement. L'état est exposé dans `window.fotaq` (`engine`, `host`, `stage`, `step(n)` : n ticks à la main) pour les vérifications.
 *
 * Répliques, dialogues et cinématiques (vagues T et C, voix absentes : les textes durent le temps d'un texte sans voix) : `line` (texte
 * dit par Joe, ou par la personne `person` de la pièce), `dog` (dialogue joué avec la personne `person`), `cut` (cinématique, avec celles
 * qu'elle enchaîne), `states` (états du jeu à poser avant, `19=1,145=1`) ; Échap saute la cinématique, espace passe le texte, clic droit
 * coupe un dialogue.
 *
 * Paramètres : `room` (pièce de départ, 95 par défaut : l'introduction), `entry` (objet d'entrée : Joe y arrive comme dans le jeu), `x` et `y` (Joe, après l'entrée dans la pièce), `scale`
 * (échelle de Joe en %), `outfit` (`normal`, `underwear` ou `dress`), `fullscreen=1` (plein écran), `say` (texte dit par Joe, au-dessus
 * de lui), `font=1` (texte de contrôle des accents), `fast` (le temps du moteur passe N fois plus vite), `cursor=0` (sans curseur).
 */
import { MemoryStorage } from "../../../engine/storage";
import { fetchBytes } from "../../../ui/files";
import { IndexedPresenter } from "../../../ui/indexed-canvas";
import { type GameFiles, extensionOf, fetchGameFiles } from "../data/files";
import { MAX_CATCH_UP_TICKS, TICK_MS } from "../engine/cadence";
import type { FotaqHost, FotaqInput } from "../engine/host";
import { FotaqEngine } from "../engine/loop";
import { Outfit } from "../engine/services";
import { fotaqScript } from "../engine/specials";
import { GameStage } from "../engine/stage";
import { roomName } from "../engine/room";

const BASE = "/fotaq";
const app = document.getElementById("app")!;
/** Extensions préchargées : tout sauf les voix, la musique et les textes de générique. */
const EXTENSIONS = new Set(["JAS", "PCX", "BBK", "ACT", "SAM", "MSK", "LUM", "DOG", "CUT", "CRD"]);

async function preload(): Promise<{ bytes: Map<string, Uint8Array>; files: GameFiles }> {
  const files = await fetchGameFiles(BASE);
  const wanted = files.list((path) => !path.includes("/") && EXTENSIONS.has(extensionOf(path)));
  const bytes = new Map<string, Uint8Array>();
  await Promise.all(wanted.map(async (path) => bytes.set(path.toUpperCase(), await fetchBytes(BASE, path))));
  return { bytes, files };
}

class DevHost implements FotaqHost {
  readonly storage = new MemoryStorage();
  readonly input: FotaqInput[] = [];
  screen = new Uint8Array(64000);
  palette = new Uint8Array(768);
  /** Horloge simulée : avance de `TICK_MS` par tick, pour que `?fast` accélère aussi le moteur. */
  clock = 0;
  constructor(private readonly bytes: Map<string, Uint8Array>) {}
  now(): number {
    return this.clock;
  }
  exit(): void {}
  readFile(name: string): Uint8Array {
    const found = this.bytes.get(name.toUpperCase());
    if (!found) throw new Error(`fichier absent : ${name}`);
    return found;
  }
  fileExists(name: string): boolean {
    return this.bytes.has(name.toUpperCase());
  }
  pollInput(): readonly FotaqInput[] {
    return this.input.splice(0);
  }
  present(pixels: Uint8Array, palette: Uint8Array): void {
    this.screen.set(pixels);
    this.palette.set(palette);
  }
  playSong(): void {}
  /** Pas de voix dans cet outil : les répliques durent le temps de leur texte. */
  playSpeech(): boolean {
    return false;
  }
}

/** Lignes de contrôle de la police : alphabet, chiffres, signes, tous les accents français. */
const FONT_LINES = [
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789",
  "abcdefghijklmnopqrstuvwxyz",
  "àâäçéèêëîïôöùûüÿ ÀÂÇÉÈÊËÎÏÔÙÛ",
  "« Où est-ce, l'été ? » — Ça va, Joe !",
  "Réducteur de cheveux, œuvre déçue…",
];

async function start(): Promise<void> {
  app.textContent = "chargement des fichiers…";
  const params = new URLSearchParams(location.search);
  let loaded: Awaited<ReturnType<typeof preload>>;
  try {
    loaded = await preload();
  } catch (error) {
    app.textContent = `Fichiers indisponibles : ${(error as Error).message}`;
    return;
  }
  const number = (name: string): number | null => (params.has(name) ? Number(params.get(name)) : null);
  const host = new DevHost(loaded.bytes);
  const stage = new GameStage({ render: { cursor: params.get("cursor") !== "0" } });
  const room = number("room") ?? 95;
  const entry = number("entry");
  const engine = new FotaqEngine(host, entry === null ? { room, stage, seed: 1, script: fotaqScript } : { entryObject: entry, stage, seed: 1, script: fotaqScript });

  const form = document.createElement("form");
  form.innerHTML = `<label>pièce <input name="room" type="number" min="1" max="126" value="${room}" /></label>
    <label>x <input name="x" type="number" value="${params.get("x") ?? ""}" /></label>
    <label>y <input name="y" type="number" value="${params.get("y") ?? ""}" /></label>
    <label>échelle <input name="scale" type="number" min="1" max="100" value="${params.get("scale") ?? ""}" /></label>
    <label>tenue <select name="outfit"><option>normal</option><option>underwear</option><option>dress</option></select></label>
    <label><input name="fullscreen" type="checkbox" value="1" ${params.has("fullscreen") ? "checked" : ""} /> plein écran</label>
    <label>texte <input name="say" value="${(params.get("say") ?? "").replace(/"/g, "&quot;")}" /></label>
    <label>réplique <input name="line" value="${(params.get("line") ?? "").replace(/"/g, "&quot;")}" /></label>
    <label>personne <input name="person" type="number" min="1" value="${params.get("person") ?? ""}" /></label>
    <label>dialogue <input name="dog" value="${params.get("dog") ?? ""}" /></label>
    <label>cinématique <input name="cut" value="${params.get("cut") ?? ""}" /></label>
    <label>états <input name="states" value="${params.get("states") ?? ""}" /></label>
    <button>Afficher</button>`;
  (form.elements.namedItem("outfit") as HTMLSelectElement).value = params.get("outfit") ?? "normal";

  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 200;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Image du jeu");
  canvas.tabIndex = 0;
  const status = document.createElement("output");
  app.replaceChildren(form, canvas, status);
  const presenter = IndexedPresenter.forCanvas(canvas, 320, 200);

  let buttons = 0;
  const point = (event: PointerEvent): { x: number; y: number } => {
    const box = canvas.getBoundingClientRect();
    return { x: Math.floor(((event.clientX - box.left) / box.width) * 320), y: Math.floor(((event.clientY - box.top) / box.height) * 200) };
  };
  const push = (event: PointerEvent): void => {
    host.input.push({ type: "pointer", ...point(event), buttons });
  };
  canvas.addEventListener("pointermove", push);
  canvas.addEventListener("pointerdown", (event) => {
    buttons = event.button === 2 ? 2 : 1;
    push(event);
  });
  canvas.addEventListener("pointerup", (event) => {
    buttons = 0;
    push(event);
  });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("keydown", (event) => {
    if (event.key === "Escape") host.input.push({ type: "action", action: "skipCutaway" });
    if (event.key === " ") host.input.push({ type: "action", action: "skipText" });
  });

  // Une fois la pièce affichée : Joe, tenue, mode d'écran et textes demandés.
  const afterStart = (action: () => void): void => {
    let tries = 0;
    const timer = setInterval(() => {
      if ((!engine.busy && engine.state.newRoom === 0) || ++tries > 600) {
        clearInterval(timer);
        action();
      }
    }, 20);
  };
  afterStart(() => {
    const joe = stage.bobs.bob(0);
    const x = number("x");
    const y = number("y");
    if (x !== null && y !== null && joe.active) {
      joe.curPos(x, y);
      engine.state.joe.x = x;
      engine.state.joe.y = y;
    }
    const scale = number("scale");
    if (scale !== null && joe.active) joe.scale = scale;
    const outfit = params.get("outfit");
    if (outfit === "dress") stage.setOutfit(engine, Outfit.Dress);
    if (outfit === "underwear") stage.setOutfit(engine, Outfit.Underwear);
    if (params.has("fullscreen")) stage.display.fullscreen = true;
    // Les textes sont posés en coordonnées d'écran : après quelques images, quand la caméra a réglé le défilement.
    setTimeout(() => {
      const say = params.get("say");
      if (say && joe.active) stage.setBobText(engine, 0, say, 14);
      if (params.has("font")) {
        stage.display.textCurrentColor(7);
        FONT_LINES.forEach((line, i) => stage.display.setText(8, 12 + i * 12, line));
      }
    }, 400);
  });
  // Réplique, dialogue ou cinématique demandés (une fois la pièce affichée).
  afterStart(() => {
    for (const pair of (params.get("states") ?? "").split(",")) {
      const [slot, value] = pair.split("=").map(Number);
      if (Number.isFinite(slot) && Number.isFinite(value)) engine.setGameState(slot, value);
    }
    const person = number("person");
    const line = params.get("line");
    const dog = params.get("dog");
    const cut = params.get("cut");
    if (cut) {
      engine.run(
        (function* () {
          let next = yield* engine.playCutaway(cut);
          while (next) next = yield* engine.playCutaway(next);
        })(),
      );
    } else if (dog && person !== null) {
      engine.run(
        (function* () {
          let next = yield* engine.talk.dialogue(engine, dog, person);
          while (next) next = yield* engine.playCutaway(next);
        })(),
      );
    } else if (line) {
      engine.run(engine.makePersonSpeak(line, person, "DEV"));
    }
  });
  const fast = Math.max(1, Number(params.get("fast") ?? 1));
  // Avance de `n` ticks à la main et repeint (vérifications : un onglet masqué ne reçoit pas `requestAnimationFrame`).
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      host.clock += TICK_MS;
      engine.tick();
    }
    engine.render();
    presenter.present(host.screen, host.palette);
  };

  let last = performance.now();
  let carry = 0;
  const frame = (now: number): void => {
    carry += now - last;
    last = now;
    let ticks = Math.floor(carry / TICK_MS);
    carry -= ticks * TICK_MS;
    ticks = Math.min(ticks, MAX_CATCH_UP_TICKS) * fast;
    for (let i = 0; i < ticks; i++) {
      host.clock += TICK_MS;
      engine.tick();
    }
    engine.render();
    presenter.present(host.screen, host.palette);
    const s = engine.state;
    const joe = stage.bobs.bob(0);
    const d = stage.display;
    status.textContent = `pièce ${s.room} (${roomName(engine.data, s.room)}), décor ${d.bdWidth}x${d.bdHeight}, défilement ${engine.horizontalScroll}, ${
      d.fullscreen ? "plein écran" : "panneau"
    }, Joe (${joe.x}, ${joe.y}) échelle ${joe.scale}${engine.busy ? ", séquence en cours" : ""}${engine.input.cutawayRunning ? " (cinématique)" : ""}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as unknown as { fotaq: unknown }).fotaq = { engine, host, stage, step };
}

void start();
