# Flight of the Amazon Queen : son

Vague A. Référence de comportement : `sound.cpp`, `music.cpp`, `midiadlib.cpp`, `musicdata.cpp` du moteur `queen` de ScummVM (GPL v3 ou ultérieure), **lus en entier** puis réécrits ; chaque module cite sa source et ses écarts en tête. Décision de musique (utilisatrice) : **AdLib** (`AQBANK.MUS` sur l'émulateur OPL2 commun) ; la voie MIDI / soundfont (~16 Mo) est écartée pour le poids (`plan.md`, D2). Modèle du côté hôte : `docs/drascula/audio.md`.

| Module | Rôle | ScummVM |
| --- | --- | --- |
| `src/audio/web-sample-output.ts` (M4, commun) | `decode(bytes)` : MP3 / Ogg vers `Sample` mono (`decodeAudioData`), à la fréquence du contexte | `AudioStreamWrapper`, `MP3Sound` |
| `src/audio/web-opl.ts`, `opl-stream.ts`, `opl-worklet.ts` (M5, communs) | sortie OPL2 en AudioWorklet, écritures datées par tick ; cadence réglable (`tickRate`), `setVolume` | `OPL::Config` |
| `src/audio/smf.ts` (M6, commun) | analyseur SMF ; événement `sequencerSpecific` (`FF 7F`, octets bruts) | `MidiParser_SMF` |
| `audio/adlib-driver.ts` | `QueenAdLibDriver` : messages MIDI et `FF 7F` vers registres OPL2 | `AdLibMidiDriver` |
| `audio/music.ts` | `QueenMusic` : file de 14 morceaux, listes (`_tune`), boucles, aléatoire, fin de piste, volume, séquenceur à 250 Hz | `MidiMusic` |
| `audio/tables.ts` | `SONGS` (`_song`), `TUNES` (`_tune`), `SFX_NAMES` (`_sfxName`), `JUNGLE_LIST` ; données transcrites avec provenance | `musicdata.cpp` |
| `audio/sound.ts` | `QueenSound` : `playSong`, `playSfx`, `playSpeech`, bascules son / voix / musique, `lastOverride` | `Sound`, `PCSound` |
| `audio/voices.ts`, `audio/channel.ts` | `VoiceBank` (chargement, décodage, cache à limite de mémoire, `preload`), `SampleChannel` (une voie, un son à la fois) | `PCSound::playSound` |
| `audio/audio.ts` | `FotaqAudio` : assemble le tout pour l'hôte ; `createSoundPrefs` (`retrovibe:fotaq:sound`) | — |
| `audio/web-music.ts` | `createWebMusicOutput()` : `WebOpl` à 250 ticks par seconde (à part pour que les tests n'importent pas le worklet) | — |
| `scripts/fotaq/render-music.mts` | rendu WAV hors ligne d'un morceau, par le même pilote et le même émulateur | — |

## Musique

- **Données** (`data/music.ts`, vague D) : `AQBANK.MUS`, 102 morceaux SMF (division 420), chacun commence par des `FF 7F` qui portent les instruments. Format d'un `FF 7F` (**vérifié** sur les 2 810 du fichier) : `00 00 3F 00`, type, valeur(s) ; type 1 (34 octets) = canal MIDI + instrument de 28 octets (modulateur 13, porteuse 13, deux formes d'onde), type 2 (6) = mode rythme, type 3 (6) = multiplicateur de pitch bend. (`formats.md` § 9 écrivait `00 3F 00 00` : le préfixe est `00 00 3F 00`, lu comme `0x3F00` en grand-boutiste par ScummVM.)
- **Horloge** : le pilote demande 250 Hz (`getBaseTempo` = 1 000 000 / 250 µs). Un tick = 4 ms ; les événements dont la date est échue partent au tick qui la couvre. Chaque tick est numéroté (`beginTick`) : le worklet place les écritures à l'échantillon près, l'hôte n'a pas à être régulier (`FotaqAudio.update()` une fois par image d'écran suffit).
- **Pilote** (**lu**) : 9 voix, ou 6 + percussions (mode rythme) ; seuls `8n`/`9n`, `Dn` (volume du canal) et `En` (pitch bend 14 bits) agissent ; hauteur = note - 12 à travers une table de 192 fréquences, octave déduit ; niveau des opérateurs = niveau de l'instrument x vélocité x volume du canal. Détail et écarts en tête de `adlib-driver.ts`. Constat de ScummVM reporté tel quel : en mode rythme, seuls les canaux 9 et 10 déclenchent les bits de percussion de `BD` (les canaux 7 et 8 gardent une voix mélodique par la condition `channel < 9`) ; à confirmer à l'écoute.
- **Quel morceau joue** : `Sound::playSong(n)` (listes de commandes, cinématiques) : `_song[n].tuneList[0]` désigne une liste `_tune` ; si elle a un effet, il est joué à la place ; sinon `overrideCmd` 1 = musique (retenue : `lastOverride`), 2 = bascule de volume, 0 = rien. Les listes ont un mode (0 hasard, 1 séquentiel en boucle, 2 une fois) ; 1001 à 1999 enchaînent une autre liste, 2000 reprend le morceau d'avant ; la liste 3 est la jungle (`JUNGLE_LIST`, tirée au hasard).
- **Morceaux manquants = silence**, comme ScummVM : un indice au-delà de la table (le 177 de la fin de course de voiture) n'est pas mis en file ; l'indice 0 de la table ne peut pas être joué (la file marque une place libre par 0).
- **Bizarreries de ScummVM reportées** (à confirmer à l'écoute) : après une fanfare « 2000 », le morceau repris ne boucle pas (la file est vidée) ; `toggleVChange` divise puis multiplie par deux le volume général à chaque morceau « Vnormal / Vmedium / Vsoft ». Écart : un numéro de morceau négatif (liste « Waterfall Off ») n'est pas mis en file (ScummVM lit hors de ses tables, et ce morceau a `overrideCmd` 0 : jamais joué).
- **Volume** : le curseur de volume règle la musique seule (`FotaqAudio.volume`, gain de `WebOpl`), comme `Sound::setVolume` (type « musique » du mélangeur). La table de volumes du pilote reste à 128 tant que `toggleVChange` n'est pas appelé (comme ScummVM avec son volume par défaut de 192).

## Voix et effets

- Fichiers `voices/<NOM>.mp3` (D1) ; nom = nom calculé par le moteur, espaces remplacés par `0`, majuscules (`soundFileName`). Les effets viennent de `SFX_NAMES` (135 des 136 noms ont leur fichier, test sur les fichiers du jeu) ; l'effet de la pièce est `roomSfx[pièce]`, joué par `GameStage` (`onSfx`, image d'animation > 500) via `host.playSfx`.
- **Deux voies** : voix (`_speechHandle`) et effet (`_sfxHandle`), un son à la fois. Écart : ScummVM attend la fin de la voix précédente avant de jouer la suivante (boucle bloquante) ; ici la nouvelle remplace l'ancienne, c'est le moteur (vague T) qui attend ses répliques.
- **Le temps du jeu ne dépend pas du son.** Un son est « actif » pendant sa durée sur `host.now()` que le contexte existe, soit bloqué (autoplay) ou que le son soit coupé ; la coupure passe les gains à 0. Le décodage est asynchrone : un son en cours de chargement est actif, puis dure sa vraie durée à partir du début de la lecture ; au bout de `LOAD_TIMEOUT_MS` (5 s) ou d'un échec de chargement ou de décodage, la voie est libre (une voix manquante ou illisible ne bloque jamais une réplique). `suspend()` fige l'horloge des voix et de la musique, `resume()` ajoute le temps d'absence. `decode` crée le contexte au besoin (suspendu) pour permettre de précharger avant le premier geste.
- **Préchargement** : `FotaqAudio.preload(noms)` (concurrence 4, doublons et fichiers absents ignorés) ; le moteur (vague T, `engine/preload.ts`) donne à `FotaqHost.preloadSpeech` les voix déduites des `.DOG` et `.CUT` de la scène à chaque changement de pièce. Cache de voix décodées limité à 12 millions de flottants (environ 48 Mo), les plus anciennes sont oubliées.
- `speechFound` reprend `speechSfxExists` (utile à la vague T pour savoir si une réplique a une voix) ; `hasSpeech(nom)` répond sans charger.

## Branchement dans l'hôte du navigateur (vague J, fait : `ui/app.ts`, `ui/browser-host.ts`, `docs/fotaq/engine.md` § 13)

```ts
const audio = new FotaqAudio({ now: () => performance.now(), files, musicData: host.readFile("AQBANK.MUS"), music: createWebMusicOutput() });
const prefs = createSoundPrefs(storage, audio);   // coupe le son dès la création si la préférence est « non »
// hôte du moteur : playSong -> audio.playSong, playSfx -> audio.playSfx ;
// vague T : playSpeech(nom) -> { audio.playSpeech(nom); return audio.speechOn && audio.speechFound }, stopSpeech, speechActive -> audio.speechActive,
//   stopSfx, preloadSpeech(noms) -> audio.preload(noms), lastSong -> audio.lastSong (talk.md § 4)
// par image d'écran : audio.update() ; premier geste : audio.unlock() ; onglet masqué / visible : suspend() / resume() ; sortie : close()
```

`files.has(nom)` doit être synchrone (liste de `files.json`, nom en majuscules sans `voices/` ni extension), `files.load(nom)` rend les octets du MP3. Les cases « Effets », « Voix », « Musique » du journal sont `sfxOn`, `speechOn`, `musicOn` (éteindre la musique l'arrête, la rallumer reprend `lastSong`) ; `lastSong` est à sauvegarder avec la partie (ScummVM : `Sound::saveState`).

## Modules communs touchés (vague A)

| Évolution | Jeux concernés | Résultat |
| --- | --- | --- |
| M4 `decode` | Drascula (seul utilisateur de `WebSampleOutput`) | `test/shared/web-sample-output.test.ts`, `test/drascula/audio/` verts |
| M5 sortie OPL2 dans `src/audio/` | Armaeth (`browser-host.ts`, `opl-driver.ts`, `sequencer.ts`, `host.ts`) | `test/armaeth/` vert, `test/shared/opl-stream.test.ts`, build Vite : `opl-worklet-*.js` produit, nom `retrovibe-opl`, `processorOptions.tickRate` lu |
| M6 `src/audio/smf.ts` + `FF 7F` | Mathémagique, Zoombinis, `scripts/lib/soundfont.mts`, séquenceur `src/engine/mohawk/audio/` | `test/mathemagique/`, `test/zoombinis/`, `test/shared/smf.test.ts` verts ; aucun `switch` exhaustif sur `SongEvent` (le séquenceur teste `kind === "midi"` / `"marker"` et ignore le reste, `web-sink.ts` ne lit pas les événements) |

## Vérifié, lu, à écouter

- **Vérifié** (tests) : registres exacts pour le do central (`A0 = 0xB2`, `B0 = 0x2E`), les notes à fréquence négative ou trop basses, le chargement d'un instrument (`20`, `40`, `60`, `80`, `C0`, `E0`), les niveaux de la porteuse selon la vélocité, le mode rythme ; datation par tick de 4 ms ; file, listes (séquentiel, hasard, jungle, `2000`, `1003`) ; les 102 morceaux de `AQBANK.MUS` se jouent sans écriture hors des registres 1 à 0xF5 ; tables aux tailles et valeurs de ScummVM ; logique de `playSong` ; voix : cache, délai, remplacement, durée sur l'horloge du jeu, mutisme, suspension.
- **Lu, non vérifié à l'oreille** : fidélité du timbre et du tempo à ScummVM (même émulateur OPL, mais pas le même mixage), bizarreries ci-dessus. Extraits de comparaison : `scripts/fotaq/render-music.mts <dossier> [nom=indice:secondes ...]` (par défaut le thème « Intro Credits » = indice 20, un morceau de jungle = indice 16, « Hotel Gangsters » = indice 31, 30 s ou 24 s), à écouter à côté de ScummVM (`FOTAQ_Fr_Talkie_1.0`, musique AdLib).
- **Fait en vague J** : curseur de volume (fenêtre commune, `FotaqAudio.volume`, préférence `retrovibe:fotaq:music-volume`), préférence « Son », `lastSong` dans la sauvegarde, préchargement des voix par scène ; vérifié dans le navigateur : une réplique parlée trouve sa voix (`speechFound`) et dure sa durée. **Restent à faire (par une personne)** : écoute réelle (musique AdLib, timbre, mixage, voix), autoplay et iOS / Safari (voix MP3, D1), latence du premier chargement d'une voix.
