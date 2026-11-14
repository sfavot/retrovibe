// Rend des morceaux AdLib de Beneath a Steel Sky en WAV (16 bits, mono, 44 100 Hz), hors ligne, pour les écouter à côté de ScummVM.
// Usage : node scripts/bass/render-music.mts <dossier de sortie> [<nom>=<secondes>:<section>:<morceau>[:<volume>] ...]
//   section : 0 à 6 ; morceau : 1 à 11 selon la section (voir docs/bass/audio.md) ; volume : 0 à 127 (127 par défaut).
//   (défaut : decor=60:0:1 section4=90:4:5 section6=60:6:1)
// Les originaux sont lus dans `original/bass/`. Le pilote (`src/games/bass/audio/adlib-music.ts`) écrit ses registres OPL2 tick par tick (50 Hz) ;
// l'émulateur `src/audio/opl2.ts` les applique à l'échantillon près, comme le worklet du navigateur. Les modules TypeScript sont chargés par
// Vite (imports sans extension).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "vite";

const racine = resolve(import.meta.dirname, "../..");
const sortie = resolve(process.argv[2] ?? "bass-ecoute");
const DEFAUT = ["decor=60:0:1", "section4=90:4:5", "section6=60:6:1"];

const demandes = (process.argv.length > 3 ? process.argv.slice(3) : DEFAUT).map((arg) => {
  const [nom, reste] = arg.split("=");
  const [secondes, section, morceau, volume] = (reste ?? "").split(":").map(Number);
  if (!nom || !secondes || section === undefined || !morceau) throw new Error(`demande invalide : ${arg}`);
  return { nom, secondes, section, morceau, volume: volume ?? 127 };
});

const RATE = 44100;
const TICK_RATE = 50;
const server = await createServer({ root: racine, logLevel: "error", server: { middlewareMode: true }, appType: "custom" });
try {
  const { AdlibMusic } = await server.ssrLoadModule("/src/games/bass/audio/adlib-music.ts");
  const { Opl2 } = await server.ssrLoadModule("/src/audio/opl2.ts");
  const { SkyDisk } = await server.ssrLoadModule("/src/games/bass/data/disk.ts");
  const { musicFile } = await server.ssrLoadModule("/src/games/bass/data/ids.ts");
  const lire = (nom: string) => new Uint8Array(readFileSync(resolve(racine, "original/bass", nom)));
  const disk = new SkyDisk(lire("sky.dnr"), lire("sky.dsk"));
  mkdirSync(sortie, { recursive: true });

  for (const { nom, secondes, section, morceau, volume } of demandes) {
    const writes: { tick: number; reg: number; value: number }[] = [];
    let tick = 0;
    const sink = { beginTick: (t: number) => (tick = t), write: (reg: number, value: number) => writes.push({ tick, reg, value }) };
    const music = new AdlibMusic(sink, (s: number) => disk.load(musicFile(s)));
    music.setVolume(volume);
    music.loadSection(section);
    music.startMusic(morceau);
    const ticks = Math.ceil(secondes * TICK_RATE);
    for (let i = 0; i < ticks; i++) music.tick();

    const chip = new Opl2(RATE);
    const pcm = new Int16Array(secondes * RATE);
    let position = 0;
    let next = 0;
    const generate = (until: number) => {
      const end = Math.min(until, pcm.length);
      if (end > position) chip.generate(pcm, position, end - position);
      position = Math.max(position, end);
    };
    for (let t = 0; t <= ticks; t++) {
      generate(Math.round((t * RATE) / TICK_RATE));
      while (next < writes.length && writes[next].tick <= t) chip.writeReg(writes[next].reg, writes[next++].value);
    }
    generate(pcm.length);

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
    const fichier = resolve(sortie, `${nom}.wav`);
    writeFileSync(fichier, Buffer.concat([header, Buffer.from(pcm.buffer)]));
    console.log(`${fichier} : section ${section} morceau ${morceau}, volume ${volume}, ${secondes} s, ${writes.length} écritures`);
  }
} finally {
  await server.close();
}
