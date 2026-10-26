/**
 * Page de contrôle visuel du rendu logiciel de SWIV 3D : outil de développement, hors du build du site.
 * Page : `/src/games/swiv3d/ui/render-test.html` (serveur de dev Vite). Pose les objets du niveau à leur position
 * d'enregistrement (aucune simulation) et fait voler une caméra libre ; l'image 320×400 est étirée en 4:3 (pixels non carrés).
 */
import { IndexedPresenter } from "../../../ui/indexed-canvas";
import { parseBd } from "../data/bd";
import { parseGlobal } from "../data/global";
import { parseLevel, type Level } from "../data/level";
import { listModels, parseModel, type Model } from "../data/model";
import { createRenderAssets, type RenderAssets } from "../render/assets";
import { createRenderer, type Renderer } from "../render/renderer";
import { placeLevelObjects, terrainHeight, type StaticScene } from "../render/static-scene";
import { COS, SIN } from "../render/tables";
import { SCREEN_HEIGHT, SCREEN_WIDTH, type RenderCamera, type RenderSprite } from "../render/view";

const BASE = "/swiv3d";
const LEVELS = ["TERRAN00", "TERRAN01", "TERRAN02", "TERRAN03", "DEMO"];
/** Cadence de la simulation d'origine (pas de 25 ms). */
const TICK_MS = 25;

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("screen");
const levelSelect = $<HTMLSelectElement>("level");
const objectsToggle = $<HTMLInputElement>("objects");
const spritesButton = $<HTMLButtonElement>("sprites");
const stats = $("stats");
const errorBox = $("error");

const presenter = IndexedPresenter.forCanvas(canvas, SCREEN_WIDTH, SCREEN_HEIGHT);
const framebuffer = new Uint8Array(SCREEN_WIDTH * SCREEN_HEIGHT);

async function fetchBytes(name: string): Promise<Uint8Array> {
  const response = await fetch(`${BASE}/${name}`);
  if (!response.ok) throw new Error(`${name} : ${response.status} (lancer scripts/swiv3d-extract.sh)`);
  return new Uint8Array(await response.arrayBuffer());
}

interface Loaded {
  level: Level;
  models: Model[];
  assets: RenderAssets;
  renderer: Renderer;
  scene: StaticScene;
}

let globalData: ReturnType<typeof parseGlobal> | null = null;

async function load(name: string): Promise<Loaded> {
  globalData ??= parseGlobal(parseBd(await fetchBytes("GLOBAL.BD"), "GLOBAL.BD"));
  const bytes = await fetchBytes(`${name}.SLV`);
  const level = parseLevel(bytes, name);
  const bd = parseBd(bytes, name);
  const models = listModels(bd).map((id) => parseModel(bd.get(id), id));
  const assets = createRenderAssets({ level, models, global: globalData });
  return { level, models, assets, renderer: createRenderer(assets), scene: placeLevelObjects(level, models) };
}

// --- Caméra libre ---------------------------------------------------------------------------------------------------------------

const camera: RenderCamera = { x: 0, y: 0, z: 0, yaw: 0, pitch: 20 };
const keys = new Set<string>();
let current: Loaded | null = null;
let sprites: RenderSprite[] = [];

function resetCamera(): void {
  if (!current) return;
  const p = current.scene.player ?? { x: 16000, y: 0, z: 16000, yaw: 0 };
  // Même point de vue que la poursuite du jeu : 550 unités derrière la cible, élévation 30.
  const yaw = p.yaw & 511;
  const elevation = 30;
  const horizontal = (COS[elevation]! * 550) >> 8;
  camera.yaw = yaw;
  camera.pitch = elevation;
  camera.x = p.x + (SIN[yaw]! >> 1) - ((SIN[yaw]! * horizontal) >> 8);
  camera.z = p.z + (COS[yaw]! >> 1) - ((COS[yaw]! * horizontal) >> 8);
  camera.y = p.y + ((SIN[elevation]! * 550) >> 8);
  applyUrlOverrides();
}

/** `?x=&z=&yaw=&pitch=&alt=` : position de départ reproductible (alt = altitude au-dessus du sol). */
function applyUrlOverrides(): void {
  const query = new URLSearchParams(location.search);
  const number = (name: string): number | null => (query.has(name) && Number.isFinite(Number(query.get(name))) ? Number(query.get(name)) : null);
  camera.x = number("x") ?? camera.x;
  camera.z = number("z") ?? camera.z;
  camera.yaw = number("yaw") ?? camera.yaw;
  camera.pitch = number("pitch") ?? camera.pitch;
  const alt = number("alt");
  if (alt !== null && current) camera.y = terrainHeight(current.level, camera.x, camera.z) + alt;
}

function toggleSprites(): void {
  if (sprites.length > 0) {
    sprites = [];
    return;
  }
  // Une rangée de sprites devant la caméra : séries 0..5 du bloc 505 et quelques images de 504.
  const forward = { x: SIN[camera.yaw & 511]!, z: COS[camera.yaw & 511]! };
  const right = { x: COS[camera.yaw & 511]!, z: -SIN[camera.yaw & 511]! };
  for (let i = 0; i < 6; i++) {
    const side = (i - 2.5) * 70;
    const x = camera.x + (forward.x * 700) / 256 + (right.x * side) / 256;
    const z = camera.z + (forward.z * 700) / 256 + (right.z * side) / 256;
    const y = terrainHeight(current!.level, x, z) + 40;
    sprites.push({ setId: 505, frame: i, x, y, z });
    sprites.push({ setId: 504, frame: i * 9, x: x + (forward.x * 300) / 256, y: y + 20, z: z + (forward.z * 300) / 256, size: 23 });
  }
}

function step(dt: number): void {
  const fast = keys.has("shift") ? 4 : 1;
  const turn = 90 * dt;
  if (keys.has("arrowleft")) camera.yaw -= turn;
  if (keys.has("arrowright")) camera.yaw += turn;
  if (keys.has("arrowup")) camera.pitch = Math.max(-100, camera.pitch - turn);
  if (keys.has("arrowdown")) camera.pitch = Math.min(127, camera.pitch + turn);
  camera.yaw = ((camera.yaw % 512) + 512) % 512;
  const speed = 400 * fast * dt;
  const yaw = camera.yaw & 511;
  const fx = SIN[yaw]! / 256;
  const fz = COS[yaw]! / 256;
  let ahead = 0;
  let side = 0;
  if (keys.has("w")) ahead += 1;
  if (keys.has("s")) ahead -= 1;
  if (keys.has("d")) side += 1;
  if (keys.has("a")) side -= 1;
  camera.x += (fx * ahead + fz * side) * speed;
  camera.z += (fz * ahead - fx * side) * speed;
  if (keys.has("pageup")) camera.y += speed;
  if (keys.has("pagedown")) camera.y -= speed;
  if (current) camera.y = Math.max(camera.y, terrainHeight(current.level, camera.x, camera.z) + 40);
}

addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === "r") resetCamera();
  keys.add(key);
  if (key.startsWith("arrow") || key.startsWith("page")) event.preventDefault();
});
addEventListener("keyup", (event) => keys.delete(event.key.toLowerCase()));
addEventListener("blur", () => keys.clear());
spritesButton.addEventListener("click", toggleSprites);

// --- Boucle ---------------------------------------------------------------------------------------------------------------------

let last = performance.now();
let smoothed = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (current) {
    step(dt);
    const t0 = performance.now();
    current.renderer.render(
      {
        camera: { ...camera, yaw: Math.floor(camera.yaw), pitch: Math.floor(camera.pitch) },
        objects: objectsToggle.checked ? current.scene.objects : [],
        sprites,
        time: Math.floor(now / TICK_MS),
      },
      framebuffer,
    );
    const ms = performance.now() - t0;
    presenter.present(framebuffer, current.renderer.palette);
    smoothed = smoothed === 0 ? ms : smoothed * 0.9 + ms * 0.1;
    stats.textContent = `rendu ${smoothed.toFixed(1)} ms · ${current.renderer.stats.queued} primitives · x ${camera.x | 0} z ${camera.z | 0} alt ${camera.y | 0}`;
  }
  requestAnimationFrame(frame);
}

async function start(): Promise<void> {
  for (const name of LEVELS) levelSelect.append(new Option(name, name));
  const select = async (): Promise<void> => {
    errorBox.textContent = "";
    try {
      current = await load(levelSelect.value);
      sprites = [];
      resetCamera();
    } catch (error) {
      current = null;
      errorBox.textContent = `Chargement impossible : ${(error as Error).message}`;
    }
  };
  levelSelect.addEventListener("change", () => void select());
  await select();
  canvas.focus();
  requestAnimationFrame(frame);
}

void start();
