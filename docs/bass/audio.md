# BASS : audio (partie musique AdLib, vague A)

Les effets sonores et les voix (M1, M3) viennent plus tard ; ce fichier ne décrit que la musique. Format des fichiers : `formats.md` § 7 ; analyse du pilote d'origine : `engine.md` § 8.

## Modules (`src/games/bass/audio/`)

| Fichier | Rôle | Référence ScummVM (GPL v3+) |
| --- | --- | --- |
| `adlib-channel.ts` | `AdlibChannel` : flux d'un canal (delta en varint 7 bits, opcodes `0x00-0x9C`), instruments, niveaux de sortie, `getNextNote`, miroir de registres | `music/adlibchannel.cpp`, `.h` |
| `adlib-music.ts` | `AdlibMusic` (= `MusicBase` + `AdLibMusic`) : sections, morceaux, tempo, volume, minuterie, état | `music/musicbase.cpp`, `.h`, `adlibmusic.cpp`, `.h` |

Le lecteur du fichier (`data/music-file.ts`) ne fait que lire : `AdlibMusic` en copie le miroir de registres (ScummVM l'écrit dans le tampon du fichier) et ne modifie jamais le fichier.

## Utilisation

```ts
const music = new AdlibMusic(sink /* OplSink */, (section) => disk.load(musicFile(section)));
music.loadSection(3);     // coupe le morceau en cours, charge, envoie la séquence d'initialisation (102 écritures)
music.startMusic(2);      // prend effet au prochain tick (0 = silence) ; relancer le morceau en cours ne le redémarre pas
music.setVolume(127);     // 0 à 127 ; entre dans le calcul des niveaux de sortie des notes suivantes
music.tick();             // un tick de 50 Hz, à appeler depuis l'horloge audio : `sink.beginTick(n)` puis `pollMusic`
```

- **Cadence** : 50 Hz, le `tickRate` par défaut de `OplStream` / `WebOpl` ; l'application bat à 20 ms (`tickMs: 20`), donc un tick par battement. Aucune minuterie dans le pilote : l'appelant (l'hôte du jeu) appelle `tick()`. Les écritures de `loadSection` / `startMusic` / `setVolume` tombent dans le tick en cours de l'`OplWriteBuffer`.
- **Tempo** : `tempo0 × tempo1 / 2999` en 16.16 (`updateTempo` à l'identique, y compris la fraction par division de `(reste << 16) | quotient`) ; `aktTime += tempo` à chaque tick et chaque canal avance de `aktTime >> 16` ticks de morceau ; opcode `0x93` : nouveau `tempo1`. Au chargement d'une section : `tempo0 = 0x78`, `tempo1 = 0xC0`, `tempo = aktTime = 0x10001`.
- **Volume** : calcul des niveaux de sortie de l'opérateur (`setupChannelVolume`), pas de gain global ; il ne touche donc que les notes qui suivent (comme l'original). Défaut 127.
- **État** (vague S) : `getState()` rend `{ section, song, volume }`, `restoreState()` recharge la section puis relance le morceau, comme le jeu.
- **Lecture** : `musicIsPlaying()` (un canal actif), `giveCurrentMusic()`, `giveVolume()`.

## Écarts avec ScummVM

- Pas de pistes numériques (Music Enhancement Project) ni de minuterie ni de mutex.
- `startMusic` lève une erreur pour un morceau absent de la section (ScummVM : `error()` au tick suivant).
- `stopMusic()` (fidèle à ScummVM) coupe les notes et libère les canaux sans remettre le morceau en cours à zéro : le jeu coupe par `startMusic(0)`.
- Les octets après la fin du fichier se lisent comme des zéros. La table des instruments dépasse la fin du fichier (jusqu'à 450 octets) et le morceau 10 de la section 4 utilise l'instrument 127, donc hors du fichier : ScummVM lit le tas, ici un instrument vide.
- Conservés : le bogue de `getNextNote` (branche sans octave : `freqData >> 1` signé, « ce que dit le code assembleur »), la lecture de la table des fréquences avant son début pour un indice négatif, les entiers 16 bits, l'`assert` du niveau de sortie (`RangeError`).

## Preuve : mêmes écritures de registres que ScummVM

Méthode de `docs/lure/audio.md` : le pilote de ScummVM n'est pas réimplémenté de mémoire, il est **exécuté**. Le harnais `bench/sky-music/` du banc (hors dépôt, `scummvm-build/bench/sky-music/`, voir son `README.md`) relie les vrais `adlibmusic.o`, `adlibchannel.o` et `musicbase.o` du moteur `sky` à un OPL « journal » (qui remplace l'émulateur), à un `Disk` qui lit les fichiers de musique extraits et à un mixeur vide ; il déclenche à la main le rappel de 50 Hz que le pilote enregistre, et journalise `tick registre valeur`.

`test/bass/audio/adlib-reference.test.ts` rejoue les mêmes scénarios (`test/bass/audio/reference.ts`) dans le code TypeScript et exige les mêmes écritures :

- **31 morceaux** (chacun lancé seul sur sa section), **12 000 ticks** (4 minutes) : empreinte SHA-1 cumulée du journal, une toutes les 200 ticks (61 par morceau), avec le nombre d'écritures. Une divergence est localisée à sa fenêtre ;
- 7 scénarios : volume (0, 40, 90, 127 en cours de morceau), volume avant le morceau, enchaînement de morceaux et silence, rechargement de section pendant un morceau, même morceau relancé, `stopMusic`, morceau demandé avant les ticks ; les lignes `status` (`giveCurrentMusic`, `musicIsPlaying`, `giveVolume`) sont comparées aussi ;
- journal complet (1 500 premiers ticks, compressé) pour 5 scénarios.

Résultat : les 38 scénarios sont identiques. Les fixtures (`test/bass/audio/fixtures/adlib-reference.json`, ~72 Ko) se régénèrent avec `bench/sky-music/gen.mts` (`node <banc>/bench/sky-music/gen.mts <dossier de travail>` depuis la racine du dépôt, `original/bass/` requis). Les tests qui lisent `original/bass/` sont ignorés sans lui ; `adlib-synthetic.test.ts` (fichier de musique minimal construit en mémoire : initialisation, instrument, fréquence, niveaux, coupure, volume, état) tourne toujours.

## Écoute

`node scripts/bass/render-music.mts <dossier> [nom=secondes:section:morceau[:volume] ...]` rend des WAV (OPL2 commun `src/audio/opl2.ts`, 44 100 Hz mono) ; défaut : `decor=60:0:1 section4=90:4:5 section6=60:6:1`.

## Reste à faire (vagues suivantes)

- Branchement à `WebOpl` (hôte, vague A/B) : `createWebMusicOutput` sur le modèle de FOTAQ, avec l'import du worklet à part des tests.
- Lancement de la musique par le moteur (`fnStartMusic`, `fnPauseFx`…) et sauvegarde (`getState` / `restoreState`) : vagues du moteur et S.

## Effets et voix

Code : `src/games/bass/audio/{sfx,speech,audio}.ts` ; modules communs : `src/audio/{voice-bank,sample-channel,web-sample-output}.ts` ; tests : `test/bass/audio/{sfx,speech,audio}.test.ts`, `test/audio/voice-bank.test.ts`, `test/shared/web-sample-output.test.ts`. Référence : ScummVM `engines/sky/sound.cpp` et `logic.cpp`.

### Modules communs (M1, M3)

- **M1** : `VoiceBank<K>` et `SampleChannel<K>` (clés `string | number`, `SoundFiles<K>`, `SampleDecoder`, `SamplePlayer`, `LOAD_TIMEOUT_MS`) viennent de FOTAQ (`voices.ts`, `channel.ts` supprimés) ; FOTAQ garde `soundFileName` (`audio/sound.ts`) et normalise ses noms avant `preload`. `SampleChannel.play(clé, options?)` transmet les `PlayOptions` à la sortie.
- **M3** : `PlayOptions.volume` (gain de la voix, 0 à 1 ; un gain n'est ajouté que si ≠ 1) et `PlayOptions.loopStart` (en échantillons : une passe complète, puis boucle sur `[loopStart, fin[` jusqu'à `stop()` ; prioritaire sur `loop` et `passes`, ignoré hors de l'échantillon). L'arrêt progressif d'une voix à gain passe par son gain.

### Effets (`sfx.ts`, `BassSfx`)

- `startFx(son, voie)` (`fnStartFx`) : numéros 256 à 393 seulement ; `278` dans la pièce 25 devient `394` ; `MUSIC_LIST` → `SFX_DEFS` ; liste de pièces en triplets `pièce, AdLib, Roland` (une liste qui commence par 255 vaut pour toutes les pièces, 255 en fin de liste = pièce absente). Volume = `(AdLib × volume général) >> 8`, puis au mélangeur `(v & 0x7F) << 1` sur 255 (`PlayOptions.volume`). La voie est `voie & 1` ; l'emplacement sauvegardé de la voie est vidé avant tout autre test.
- Drapeau `0x80` : départ différé de `drapeaux & 0x7F` tours dans une file de 4 (cinquième perdu) ; `checkFxQueue` au début de chaque tour. Drapeau `0x20` : l'effet est retenu (`numéro | volume << 8`) pour la sauvegarde ; `restoreState` met les effets retenus dans la file (départ au tour suivant), `loadSection(section, true)` garde cette file (sinon elle est vidée).
- Boucle : `loopStart = taille − boucle` (octets de fin rejoués). Taux sous 3 000 Hz (128 et 256 Hz dans les données, taille 32 à 7 996 octets) : rééchantillonnés à 11 025 Hz au plus proche voisin.
- Pause : la voie est arrêtée puis reprise à la même position par un échantillon tronqué (position lue sur l'horloge du jeu, qui se fige avec l'onglet masqué ; dans une boucle, la boucle entière suit la fin de la passe en cours).
- Écarts : son de rang `soundsTotal` ignoré (ScummVM le lit hors table) ; colonne Roland non portée ; `SF_FX_OFF` = `fxOff`. Bizarreries gardées : un effet refusé vide l'emplacement sauvegardé de sa voie sans arrêter le son ; les effets relancés par la file après une restauration ne sont pas retenus pour une nouvelle sauvegarde (`loadSection` a vidé `_saveSounds`).

### Voix (`speech.ts`, `BassSpeech`)

`start(textNum)` : `speechFileOfText` → `VoiceBank<number>` (`voices/<id>.mp3`, chargé à la demande) → `SampleChannel`. Faux si les voix sont interdites (`allowed`, `SF_ALLOW_SPEECH`), si la section est hors table (8 à 15) ou si le fichier n'existe pas (le sous-titre s'affiche : `stdSpeak`) ; dans ce cas la voix en cours n'est pas coupée. `finished()` est faux pendant le chargement et la lecture, mais **au plus `LOAD_TIMEOUT_MS` (5 s) pour un fichier en retard ou perdu** ; un décodage raté libère la voie tout de suite. La durée suit l'horloge du jeu, pas le son réel.

### Assemblage (`audio.ts`, `BassAudio`)

Implémente `BassSound` (`engine/services.ts`) et `Muteable`. Options : `now`, `loadFile(id)` (octets décompressés de `sky.dsk`), `voices: SoundFiles<number>`, `music: MusicOutput` (`OplSink` + `Muteable` + `unlock/suspend/resume/close`, p. ex. `WebOpl`), `screen()` (variable `SCREEN`). `loadSection(section, gameRestored?)` charge musique et effets et coupe la voix (comme `_mixer->stopAll()`). `update()` (une fois par image d'écran) lance la musique à 50 ticks par seconde de l'horloge de l'hôte (rattrapage borné à 2 s, figé pendant `suspend`). Réglages : `musicVolume` (0 à 127, jamais un gain), `fxOff`, `speechOn`, `setMuted` (préférence « Son » : `createSoundPrefs`, clé `retrovibe:bass:sound`). Sauvegarde : `getState()` / `restoreState()` (`sounds`, `music`).

### À brancher ensuite

- Hôte (vague J) : `MusicOutput` navigateur (`WebOpl` + adaptateur, comme `web-music.ts` de FOTAQ), `SoundFiles<number>` (liste de `files.json`, `fetch` de `voices/<id>.mp3`), appel de `update()` à chaque image, `unlock()` au premier geste, `suspend()` / `resume()` sur l'onglet masqué.
- Moteur : appeler `loadSection(section, restored)` à `fnEnterSection` (`SF_GAME_RESTORED`), `sfx.fxOff` / `speechOn` depuis les drapeaux du panneau, `playSound` pour `IC_MAKE_SOUND` / `IC_FX_VOLUME` des séquences, `preloadSpeech` par scène (optionnel), `restoreState` avant la reprise d'une partie.
- À écouter : taux 128 / 256 Hz rééchantillonnés, reprise après pause d'un effet bouclé, voix en retard (délai de 5 s).
