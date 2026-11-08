# Drascula : son

Vague A. Référence de comportement : `sound.cpp` de ScummVM (`playFile`, `stopSound`, `soundIsActive`, `playMusic`, `stopMusic`, `musicStatus`). Chaque module cite ses écarts en tête.

| Module | Rôle |
| --- | --- |
| `src/audio/web-sample-output.ts` (E3, commun) | `WebSampleOutput` : contexte créé à `unlock()`, gain général, coupure sans arrêt des sources, `suspend()` / `resume()`, `play(sample, {loop, passes})` rend une `SampleVoice` (`playing`, `duration`, `stop(fadeSeconds?)`) ; `onContext` / `connection()` laissent un jeu brancher une autre source sur le même contexte (Lost in Time : file `queuePcm` et musique AdLib). |
| `audio/voice.ts` | `SoundChannel` : voie unique des `.ALS` (voix, effets `S*.ALS`), marges de 32 octets et contournement de `3.ALS` (`data/als.ts`), chargement synchrone ou différé (`SoundFiles`). |
| `audio/music.ts` | `DrasculaMusic` : piste `p` du `.ALD` -> `track<p>.mp3` (1 à 31) par `TrackPlayer`, jouée une fois. |
| `audio/audio.ts` | `DrasculaAudio` (les six méthodes de son de l'hôte + `unlock`, `suspend`, `resume`, `setMuted`, `close`) et `createSoundPrefs` (`retrovibe:drascula:sound`). |

## Choix

- **Le temps du jeu ne dépend pas du son réel.** Une voix est « en cours » pendant sa durée sur `host.now()`, que le contexte existe, soit bloqué (autoplay) ou que le son soit coupé. La coupure ne fait que passer le gain à 0. `suspend()` fige l'horloge des voix et `resume()` ajoute le temps d'absence.
- **Musique** : `musicPlaying()` est l'état demandé (vrai dès `playMusic`, faux à la fin de la piste ou à `stopMusic`), pas l'état du flux : sinon `loop.ts` relancerait la piste à chaque image pendant le chargement ou tant que l'autoplay bloque. Elle démarre au premier geste (`unlock`).
- **Fondu** (E2, **fait en vague C**) : ScummVM n'a qu'un `MusicFadeout` (fin de chapitre, introduction, générique), pas de baisse du volume pendant les voix. `TrackPlayer` gagne un `volume` (0 à 1, accesseur facultatif, rétrocompatible : défaut 1, sans effet sur `muted` ; Lost in Time et SWIV 3D l'utilisent sans l'appeler), `DrasculaMusic.volume`, `DrasculaAudio.setMusicVolume(niveau)` ; le moteur fait le fondu (`engine.musicFadeout()`, `engine.md` § 9) par `host.setMusicVolume?`. À brancher dans l'hôte du navigateur : `setMusicVolume: (v) => audio.setMusicVolume(v)`.
- Un son remplace le précédent sur la voie (contrat de l'hôte, `host.ts`) ; non vérifié contre le mixeur de ScummVM, où `playStream` sur un handle déjà utilisé ne coupe peut-être pas l'ancien.
- La fin de `3.ALS` (contournement) reste **à confirmer à l'écoute**.

## Branchement dans l'hôte du navigateur

```ts
const audio = new DrasculaAudio({ now: () => performance.now(), files, trackUrl });
const prefs = createSoundPrefs(storage, audio);   // coupe le son dès la création si la préférence est « non »
// hôte : playSound/stopSound/soundActive/playMusic/stopMusic/musicPlaying -> audio.*
// premier geste -> audio.unlock() ; onglet masqué/visible -> audio.suspend()/resume() ; sortie -> audio.close()
```

`files.has(name)` doit être synchrone (liste de `files.json`) ; `files.load(name)` peut rendre une promesse.

**Branché en vague J** (`ui/app.ts`, `ui/browser-host.ts`) : `createSoundFiles(files, fetcher)` (`has` sur le manifeste, `load` en différé avec cache : les 783 voix ne sont pas préchargées), `trackUrl: (fichier) => base + "/" + fichier`, `unlock()` au moment du clic de lancement (avant le chargement) puis à chaque geste, `suspend()` / `resume()` à l'onglet masqué, à une fenêtre ouverte et à la pause (espace), `setMusicVolume(fondu x volume choisi)`, `close()` à la sortie. La musique et les voix démarrent après le premier geste (autoplay) : le temps du jeu, lui, ne dépend pas du son. Écoute réelle non faite par l'agent (pas de son vérifiable dans le navigateur de test) : à faire par une personne (`3.ALS`, pistes, voix en retard au premier chargement d'un fichier).
