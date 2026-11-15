// Rend les musiques AdLib de Ween (les six de ADL.EXT, jouées par ADL.TOT) en WAV (16 bits, mono, 44 100 Hz), hors ligne, pour les écouter
// à côté de ScummVM.
// Usage : node scripts/ween/render-music.mts <dossier de sortie> [<numéro 0-5>[=<secondes>] ...]   (défaut : 0 à 5, 60 s chacune ; 0 s = tout le morceau)
// Le morceau passe par le lecteur commun (`src/engine/coktel/audio/adlib/synth.ts`, port de `adlplayer.cpp` sur `src/audio/opl2.ts`), comme dans
// le worklet du navigateur ; l'original est lu dans `original/ween/INTRO.STK`. Les modules TypeScript sont chargés par Vite.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const racine = resolve(import.meta.dirname, "../..");
const sortie = resolve(process.argv[2] ?? "ween-ecoute");
const demandes = (process.argv.length > 3 ? process.argv.slice(3) : ["0", "1", "2", "3", "4", "5"]).map((arg) => {
  const [numero, secondes] = arg.split("=");
  return { numero: Number(numero), secondes: secondes === undefined ? 60 : Number(secondes) };
});

const RATE = 44100;
const server = await createServer({ root: racine, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
try {
  const { AdlibSynth } = await server.ssrLoadModule("/src/engine/coktel/audio/adlib/synth.ts");
  const { Archive } = await server.ssrLoadModule("/src/engine/coktel/data/archive.ts");
  const { parseExtTable, readExtResource } = await server.ssrLoadModule("/src/engine/coktel/data/ext.ts");
  const archive = new Archive(new Uint8Array(readFileSync(resolve(racine, "original/ween/INTRO.STK"))));
  const adl: Uint8Array = archive.get("ADL.EXT");
  const common: Uint8Array = archive.get("COMMUN.EX1");
  const items = parseExtTable(adl);
  mkdirSync(sortie, { recursive: true });

  for (const { numero, secondes } of demandes) {
    const item = items[numero];
    if (!item) throw new Error(`pas de morceau ${numero} (0 à ${items.length - 1})`);
    const synth = new AdlibSynth(RATE);
    synth.load(readExtResource(adl, item, common).data);
    synth.setRepeating(0);
    synth.play();
    const limite = secondes > 0 ? secondes * RATE : Infinity;
    const blocs: Int16Array[] = [];
    const bloc = new Float32Array(RATE / 10);
    let total = 0;
    while (synth.playing && total < limite) {
      synth.render(bloc);
      blocs.push(Int16Array.from(bloc, (v) => Math.max(-32768, Math.min(32767, Math.round(v * 32768)))));
      total += bloc.length;
    }
    const pcm = new Int16Array(total);
    blocs.forEach((b, i) => pcm.set(b, i * bloc.length));

    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + pcm.byteLength, 4);
    header.write("WAVEfmt ", 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(pcm.byteLength, 40);
    const fichier = resolve(sortie, `ween-adl-${numero}.wav`);
    writeFileSync(fichier, Buffer.concat([header, Buffer.from(pcm.buffer)]));
    console.log(`${fichier} : morceau ${numero}, ${(total / RATE).toFixed(1)} s${synth.playing ? " (coupé)" : " (fin du morceau)"}`);
  }
} finally {
  await server.close();
}
