import { parsePfn, type PfnFont } from "./data/font";
import { parseHy8, type Hy8 } from "./data/hy8";
import { parseMcc } from "./data/mcc";
import { parseMcg, type Mcg, type Picture } from "./data/mcg";
import type { Sound } from "./audio/sound";
import { parseAudioIndex, type AudioEntry } from "./data/audio-index";
import type { Host } from "./host";
import { muxClip, vidClip, type VideoClip } from "./video";

/** Suffixe du conteneur vidéo d'un `.MUX` ou d'un `.MUK` réencodé (`data/vid.ts`), ajouté au nom d'origine. */
const VID_SUFFIX = ".vid";
const VIDEO_EXTENSIONS = [".mux", ".muk", VID_SUFFIX];

function isVideo(key: string): boolean {
  return VIDEO_EXTENSIONS.some((extension) => key.endsWith(extension));
}

/** Index des sons, à la racine du dossier du jeu. */
const AUDIO_INDEX = "audio.json";

/**
 * Chargement des ressources par nom d'origine (`s07a001d.mcg`, `s52d001f.pfn`…) : fichiers lus via
 * `host.loadFile`, décodés une fois et gardés en mémoire (les décodés sont des vues sur les octets lus).
 * Les sons (`sound()`) sont des MP3 accompagnés de l'index `audio.json`, qui en donne la durée exacte.
 *
 * Les vidéos (`.mux`, `.muk`, et leurs conteneurs `.vid`) ne sont pas gardées (plusieurs Mo, jouées une fois) : `bytes()`
 * les relit à chaque fois, sauf si `prefetch()` les a demandées avant, auquel cas la lecture en cours est consommée une
 * seule fois. Une vidéo se demande par son nom d'origine (`video("m06ab.mux")`) : si le jeu la versionne en conteneur
 * (`M06AB.MUX.vid`), c'est lui qui est lu, avec le son du MP3 voisin.
 */
export class Resources {
  private readonly cache = new Map<string, Promise<unknown>>();
  private readonly prefetched = new Map<string, Promise<Uint8Array>>();

  constructor(private readonly host: Host) {}

  /** Octets bruts d'un fichier. */
  bytes(name: string): Promise<Uint8Array> {
    const key = name.toLowerCase();
    const early = this.prefetched.get(key);
    if (early) {
      this.prefetched.delete(key);
      return early;
    }
    if (isVideo(key)) return this.host.loadFile(name);
    return this.memo(`raw:${key}`, () => this.host.loadFile(name));
  }

  /** Lance des lectures en tâche de fond (sans attendre ni échouer bruyamment) ; elles servent aux `load` suivants. */
  prefetch(...names: string[]): void {
    for (const requested of names) {
      const name = isVideo(requested.toLowerCase()) ? this.videoFile(requested) : requested;
      const key = name.toLowerCase();
      if (!isVideo(key)) {
        void this.bytes(name).catch(() => undefined);
      } else if (!this.prefetched.has(key)) {
        const promise = this.host.loadFile(name);
        promise.catch(() => undefined);
        this.prefetched.set(key, promise);
      }
    }
  }

  mcg(name: string): Promise<Mcg> {
    return this.memo(`mcg:${name.toLowerCase()}`, async () => parseMcg(await this.bytes(name)));
  }

  /** Image `.MCC` (Astérix), décodée par séries ; s'affiche et se charge comme un MCG. */
  mcc(name: string): Promise<Picture> {
    return this.memo(`mcc:${name.toLowerCase()}`, async () => parseMcc(await this.bytes(name)));
  }

  /** Image plein écran d'après son extension : `.mcc` ou `.mcg`. */
  picture(name: string): Promise<Picture> {
    return name.toLowerCase().endsWith(".mcc") ? this.mcc(name) : this.mcg(name);
  }

  /** Fichier réellement versionné d'une vidéo demandée par son nom d'origine : son conteneur `.vid` s'il existe. */
  private videoFile(name: string): string {
    if (name.toLowerCase().endsWith(VID_SUFFIX)) return name;
    const container = `${name}${VID_SUFFIX}`;
    return this.host.filePath(container) === undefined ? name : container;
  }

  /**
   * Vidéo demandée par son nom d'origine (`s06a.mux`, `m06ab.mux`, `m34ag.muk`) : le fichier d'origine avec son son en
   * PCM, ou son conteneur `.vid` avec le son de `<nom d'origine>.mp3` (absent pour une vidéo muette ou un MUK). Jamais
   * gardée en mémoire : chaque appel rend une vidéo neuve, prête à être décodée depuis sa première image.
   */
  async video(name: string): Promise<VideoClip> {
    const file = this.videoFile(name);
    if (file === name && !name.toLowerCase().endsWith(VID_SUFFIX)) return muxClip(await this.bytes(name));
    const original = file.slice(0, -VID_SUFFIX.length);
    const hasSound = this.host.filePath(`${original}.mp3`) !== undefined;
    const [bytes, audio] = await Promise.all([this.bytes(file), hasSound ? this.sound(original) : null]);
    return vidClip(bytes, audio);
  }

  hy8(name: string): Promise<Hy8> {
    return this.memo(`hy8:${name.toLowerCase()}`, async () => parseHy8(await this.bytes(name)));
  }

  pfn(name: string): Promise<PfnFont> {
    return this.memo(`pfn:${name.toLowerCase()}`, async () => parsePfn(await this.bytes(name)));
  }

  /**
   * Son demandé par son nom d'origine (`s07a001b.voc`) : le fichier versionné est `<nom>.mp3`, et sa longueur d'origine
   * (nombre d'échantillons, fréquence) vient de l'index `audio.json`, dont les clés sont les chemins des MP3. Le son est
   * préparé pour la sortie (`AudioBackend.prepare` : décodage dans le navigateur, rien sous node) avant d'être rendu.
   */
  sound(name: string): Promise<Sound> {
    return this.memo(`sound:${name.toLowerCase()}`, async () => {
      const file = `${name}.mp3`;
      const [index, data] = await Promise.all([this.audioIndex(), this.bytes(file)]);
      const path = this.host.filePath(file);
      const entry = path === undefined ? undefined : index.get(path);
      if (!entry) throw new Error(`${AUDIO_INDEX} : pas d'entrée pour ${file}`);
      const sound: Sound = { format: "mp3", data, sampleCount: entry.samples, sampleRate: entry.sampleRate };
      await this.host.audio.prepare(sound);
      return sound;
    });
  }

  private audioIndex(): Promise<Map<string, AudioEntry>> {
    return this.memo(`index:${AUDIO_INDEX}`, async () => parseAudioIndex(new TextDecoder().decode(await this.host.loadFile(AUDIO_INDEX))));
  }

  /** Oublie tout ce qui est gardé en mémoire (par exemple en quittant une famille de scènes). */
  clear(): void {
    this.cache.clear();
    this.prefetched.clear();
  }

  private memo<T>(key: string, load: () => Promise<T>): Promise<T> {
    let entry = this.cache.get(key) as Promise<T> | undefined;
    if (!entry) {
      entry = load();
      this.cache.set(key, entry);
      // Un échec n'est pas gardé : on pourra réessayer.
      entry.catch(() => this.cache.delete(key));
    }
    return entry;
  }
}
