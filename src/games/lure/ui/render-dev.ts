/**
 * Page de développement du rendu de Lure of the Temptress (vague R) : outil, hors du build du site. Page :
 * `/src/games/lure/ui/render-dev.html` (serveur de dev Vite), paramètres `?room=10&seed=1&fast=4&cursor=0&intro=1`. Charge les quatre disques et
 * `LURE-FR.DAT` depuis `/lure/`, monte le moteur sans tête avec un hôte minimal (souris, clavier, pas de son, pas de sauvegarde) et peint
 * ses images avec `LureRenderer` ; l'hôte du jeu (vague J) remplacera celui-ci. Les libellés sont ceux d'un outil de développement.
 *
 * Souris : clic gauche, clic droit (menus surgissants), molette ; clavier : Échap, o / n (confirmation), flèches haut / bas et Entrée
 * (menus). `room` va dans une pièce comme la touche de débogage de ScummVM (le joueur y est placé) ; `fast` fait passer le temps N fois plus
 * vite ; `cursor=0` laisse le curseur du système ; `intro=1` joue l'introduction (Échap : la passer ; sans `intro`, la partie commence directement). L'état est exposé dans `window.lure` (`engine`, `host`, `renderer`, `step(n)` : n ticks
 * à la main, pour les vérifications : un onglet masqué ne reçoit pas `requestAnimationFrame`).
 */
import { MemoryStorage } from "../../../engine/storage";
import { fetchBytes } from "../../../ui/files";
import { IndexedPresenter } from "../../../ui/indexed-canvas";
import { DAT_FILE_NAME, DISK_FILE_NAMES } from "../data/container";
import { gameTextToUnicode } from "../data/charset";
import { loadLureData } from "../data/lure-data";
import { MAX_CATCH_UP_TICKS, TICK_MS } from "../engine/cadence";
import { LureEngine } from "../engine/game";
import type { LureAction, LureHost, LureInput } from "../engine/host";
import { Field, HotspotId } from "../engine/ids";
import { LureRenderer } from "../render/renderer";

const BASE = "/lure";
const app = document.getElementById("app")!;

class DevHost implements LureHost {
  readonly storage = new MemoryStorage();
  readonly input: LureInput[] = [];
  readonly logs: string[] = [];
  clock = 0;
  now(): number {
    return this.clock;
  }
  exit(): void {
    this.logs.push("sortie demandée");
  }
  log(message: string): void {
    this.logs.push(message);
    if (this.logs.length > 200) this.logs.shift();
  }
  pollInput(): readonly LureInput[] {
    return this.input.splice(0);
  }
}

const KEY_ACTIONS: Record<string, LureAction> = {
  Escape: "escape",
  ArrowUp: "indexPrevious",
  ArrowDown: "indexNext",
  Enter: "indexSelect",
  o: "yes",
  y: "yes",
  n: "no",
};

async function start(): Promise<void> {
  app.textContent = "chargement des fichiers…";
  const params = new URLSearchParams(location.search);
  let data: ReturnType<typeof loadLureData>;
  try {
    const [d1, d2, d3, d4, dat] = await Promise.all([...DISK_FILE_NAMES, DAT_FILE_NAME].map((name) => fetchBytes(BASE, name)));
    data = loadLureData({ disks: [d1!, d2!, d3!, d4!], dat: dat! });
  } catch (error) {
    app.textContent = `Fichiers indisponibles : ${(error as Error).message}`;
    return;
  }
  const number = (name: string): number | null => (params.has(name) ? Number(params.get(name)) : null);
  const host = new DevHost();
  const engine = new LureEngine({ data, host, seed: number("seed") ?? 1, intro: params.get("intro") === "1" });
  const renderer = new LureRenderer(data, { cursor: params.get("cursor") !== "0" });

  const form = document.createElement("form");
  form.innerHTML = `<label>pièce <input name="room" type="number" min="1" max="55" value="${params.get("room") ?? ""}" /></label>
    <label>graine <input name="seed" type="number" min="0" value="${params.get("seed") ?? "1"}" /></label>
    <label>vitesse <input name="fast" type="number" min="1" max="20" value="${params.get("fast") ?? "1"}" /></label>
    <label><input name="cursor" type="checkbox" value="1" ${params.get("cursor") === "0" ? "" : "checked"} /> curseur dessiné</label>
    <button>Recharger</button>`;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(form)) if (value !== "") next.set(key, String(value));
    if (!next.has("cursor")) next.set("cursor", "0");
    location.search = next.toString();
  });

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
  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    host.input.push({ type: "wheel", delta: event.deltaY < 0 ? -1 : 1 });
  });
  canvas.addEventListener("keydown", (event) => {
    const action = KEY_ACTIONS[event.key];
    if (action) host.input.push({ type: "action", action });
  });

  // Aller dans une pièce (touches de débogage de ScummVM) : le moteur change de pièce au tick suivant, le joueur y est placé.
  const room = number("room");
  if (room !== null) {
    engine.tick();
    engine.world.fields.set(Field.NEW_ROOM_NUMBER, room);
    engine.world.requireActiveHotspot(HotspotId.PLAYER).roomNumber = room;
  }

  const fast = Math.max(1, Number(params.get("fast") ?? 1));
  const tick = (): void => {
    host.clock += TICK_MS;
    if (!renderer.fading) engine.tick();
  };
  const present = (elapsedMs: number): void => {
    renderer.render(engine, elapsedMs);
    presenter.present(renderer.output, renderer.palette);
  };
  // Avance de `n` ticks à la main et repeint (vérifications).
  const step = (n = 1): void => {
    for (let i = 0; i < n; i++) {
      tick();
      present(TICK_MS);
    }
  };

  let last = performance.now();
  let carry = 0;
  const frame = (now: number): void => {
    const dt = now - last;
    carry += dt;
    last = now;
    let ticks = Math.floor(carry / TICK_MS);
    carry -= ticks * TICK_MS;
    ticks = Math.min(ticks, MAX_CATCH_UP_TICKS) * fast;
    for (let i = 0; i < ticks; i++) tick();
    present(dt * fast);
    const r = engine.room;
    const hotspot = r.hotspotId ? ` ; sous le pointeur : ${gameTextToUnicode(r.hotspotName)}` : "";
    status.textContent = `pièce ${r.roomNumber}, ${engine.world.activeHotspots.length} hotspots actifs, pointeur (${engine.mouse.x}, ${engine.mouse.y})${hotspot}${
      renderer.fading ? " ; fondu" : ""
    }${engine.busy ? " ; séquence bloquante" : ""}`;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  (window as unknown as { lure: unknown }).lure = { engine, host, renderer, step };
}

void start();
