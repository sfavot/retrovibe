# Math Workshop : audio (WAVE, MIDI, soundfont)

Tâche F3 du [plan](plan.md). Références sur l'original : [engine.md](engine.md) §6, [screens/rhythm.md](screens/rhythm.md) §2.3, §2.4 et §3, [formats.md](formats.md).
Code : `src/engine/mohawk/audio/` (partagé avec Zoombinis : `sink.ts`, `pcm.ts`, `smf.ts`, `sequencer.ts`, `programs.ts`), `src/ui/mohawk/web-sink.ts` (navigateur, partagé) et `src/games/mathemagique/audio/rhythm-rewrite.ts` (propre au jeu). Tests : `test/mathemagique/audio-engine.test.ts`.

## Architecture

| Fichier | Rôle | Environnement |
|---|---|---|
| `sink.ts` | contrat `AudioSink` / `MidiSink` / `PcmSound` (fait par le lead) | pur |
| `pcm.ts` | ressource `WAVE` → `PcmSound` (8 bits non signé → flottants), cache par (archive, id) | pur |
| `smf.ts` | fichier MIDI standard → `Song` (événements triés, temps en ms, table des tempos) | pur |
| `sequencer.ts` | `MidiPlayer` (lecture, boucle, repères, tempo, réécriture), `parsePrograms` (`Prg#`), `parseSysx` (`MIDIMAP.DAT`) | pur |
| `rhythm-rewrite.ts` | réécriture du Rhythm Shop : une mesure, notes des emplacements vides à vélocité 0 | pur |
| `programs.ts` | inventaire des timbres joués (banque / programme / touches), pour la soundfont | pur |
| `web-sink.ts` | `AudioSink` du navigateur : Web Audio (WAVE) + `spessasynth_lib` (MIDI) | navigateur |

Le moteur ne connaît que `AudioSink` ; le séquenceur ne connaît que `MidiSink` et une horloge `now()`. Rien n'utilise de minuteur : tout est piloté par le tick du moteur (60 Hz), donc testable avec une horloge simulée et un faux `MidiSink`.

## WAVE

`loadPcm(archive, id)` convertit la ressource `\0SND` (PCM 8 bits mono non signé, 0x80 = silence) en `Float32Array` dans [-1, 1[ et garde la fréquence de l'en-tête (11025 Hz en pratique) ; le résultat est mis en cache par archive et id (`WeakMap`). Les repères `Cue#` et les points de boucle internes ne sont pas utilisés (l'original ne les lit pas ; `PcmSound` n'a pas de point de boucle, la boucle porte sur tout le son).

`WebAudioSink.playWave` : un `AudioBufferSourceNode` par voix, donc plusieurs sons en même temps (voix de Poly + bruitage, 1 WAVE + 1 MIDI par défaut dans l'original), boucle, handle, fin détectée par `onended` (`isWavePlaying`). Sortie verrouillée (avant `unlock()`) : un handle valide est renvoyé, rien ne joue, `isWavePlaying` est faux. Les tampons `AudioBuffer` sont mis en cache par `PcmSound`.

## Séquenceur MIDI

### Lecture du fichier (`smf.ts`)

`parseSong(smf)` lit un SMF (format 0 des ressources, format 1 fusionné), division en ticks par noire (480 dans les 66 MIDI ; SMPTE refusé). La liste d'événements est triée par tick (stable) et chaque événement porte son `tick` et son `ms` (table des tempos : un seul tempo par fichier dans les données, plusieurs gérés) :

- `midi` : message de voix (`8n` à `En`, statut courant résolu) ou SysEx (`F0…`), octets prêts à envoyer ;
- `marker` : méta `FF 01` (texte), `FF 06` (marqueur), `FF 07` (point de repère), avec son `metaType` ;
- `tempo` (`FF 51`) : informatif, jamais envoyé ; `end` (`FF 2F`, ajouté s'il manque).

`Song` expose aussi le nom de piste, le numérateur de mesure (`FF 58`, 4 par défaut), `endTick` / `endMs`. L'original arrondit le tempo à un bpm entier (`60 000 000 / bpm`, rhythm.md §3.4) ; ici le tempo exact du fichier est gardé (écart inférieur à 0,5 bpm, imperceptible ; `PlayOptions.bpm` permet d'imposer l'entier si on tient à la fidélité).

### `MidiPlayer`

```
const player = new MidiPlayer(sink.midi, { now: () => sink.now(), initMessages: parseSysx(sysx) });
player.play(song, { loop, startMarker, loopMarkers, rewrite, bpm, programs, onMarker, onEnd });
player.tick();   // à chaque tick du moteur
player.setBpm(140); player.stop();
```

- **Fenêtre d'avance** (100 ms, `lookaheadMs`) : à chaque `tick()`, les messages dont l'heure tombe avant `now + 100 ms` partent par `MidiSink.send(message, atMs)` avec leur heure exacte sur l'horloge audio. La gigue du tick (17 ms) n'a donc aucun effet sur le rythme.
- **Démarrage** : `sink.reset()`, puis les 64 messages d'initialisation de `MIDIMAP.DAT`, puis un `Cn pp` par couple (programme, masque de canaux) du bloc `Prg#` (la mise en cache des patchs `midiOutCachePatches` n'existe pas ici), puis la première note 20 ms plus tard (`startDelayMs`) pour que l'initialisation parte la première.
- **Repères** (`FF 01/06/07`) : signalés par `onMarker` quand leur heure est **passée** (testé à chaque tick avec l'horloge du puits), et non quand ils sont planifiés : l'affichage reste synchrone avec le son, à un tick près. L'original appelle `1028:26b0` de la même façon. Les noms sont comparés sans casse ni espaces de fin (`"loop end "` existe dans les données).
- **Boucle** (`loop: true`) : de `loop start` (sinon `setup end`, sinon le début) à `loop end` (sinon la fin de piste), sur le premier repère de chaque nom. Dans les données : `setup end` au tick 2 ou 3 et `loop end` juste avant la fin dans 21 MIDI (musiques de fond des activités, 2000 à 2010, 100 / 101, 200 / 201, 1000 / 1001, 65000 / 65001) ; `loop start` n'existe que dans le 2010 (tick 1913). `PATTERNS.DAT` 101 a des repères en double (`loop end` au tick 107519 puis 122878) : le premier gagne. Au retour, le temps continue sans trou ni recouvrement, les notes encore tenues sont coupées, et les repères du début de boucle (dont `setup end`) sont signalés à nouveau.
- **`startMarker`** : la lecture commence au repère ; ce qui le précède est réduit aux réglages (contrôleurs, changements de programme, pitch bend, SysEx envoyés tout de suite), pas aux notes.
- **Tempo** : `play(…, { bpm })` ou `setBpm(bpm)` (rapport au tempo de départ du fichier). Un changement en cours de route se recale à la fin de la fenêtre déjà planifiée, ce qui évite d'inverser l'ordre des messages.
- **Fin** : sans boucle, `onEnd` une seule fois après l'heure de fin de piste (jamais après `stop()`), notes tenues coupées. `stop()` appelle `MidiSink.reset()`.

### Réécriture (Rhythm Shop)

`PlayOptions.rewrite(events, song)` remplace la liste d'événements avant la lecture (le `Song` n'est pas modifié). `rhythm-rewrite.ts` fournit la réécriture de `1058:125e` : `rhythmRewrite(filled)` = `keepFirstMeasure` puis `silenceEmptySlots`.

- Repères `Cue Point` (`FF 07`) d'un seul caractère : `a` à `x` = emplacement (début de pièce), `1` à `8` = temps. Un repère peut être complété d'espaces (`"e  "`) : seul le premier caractère compte pour l'emplacement ; `"z - end"` est ignoré.
- `keepFirstMeasure` : coupe à la plus proche des deuxièmes occurrences de `a` et de `1` après le plus tardif des deux premiers ; la fin de piste est remplacée par une fin à cet endroit. Sans `a` et `1`, le morceau est inchangé.
- `silenceEmptySlots(events, filled)` : l'emplacement courant est celui du dernier repère `a`–`x` (0 avant le premier) ; les Note On d'un emplacement vide passent à vélocité 0 (la note reste dans le flux, les durées ne bougent pas ; pour le synthétiseur, c'est un Note Off).
- `filled` est lu à l'appel de la fonction : pour rejouer un motif modifié, rappeler `play` avec `rhythmRewrite(nouveauTableau)`.

### Un seul séquenceur : `SoundService.playSong`

Le `MidiPlayer` appartient au `SoundService` (`engine/sound.ts`), et aucune scène n'en crée un second sur `host.audio.midi` (deux séquenceurs sur un même puits se couperaient mutuellement : `reset()` à chaque départ, musique jamais arrêtée, `stopMusic` / `releaseAll` / ambiance / reprise à la fin du chargement contournés). `playMusic(archive, id, { loop, ambient, onEnd })` joue un `\0SND` MIDI ; `playSong(song, options)` joue un `Song` déjà décodé avec toutes les `PlayOptions` (`rewrite`, `bpm`, `programs`, `onMarker`, `onEnd`, `loop`, repères de boucle) plus `ambient`. Les deux passent par le même chemin (`start`) :

- une seule musique à la fois : un nouveau départ remplace l'ancien (poignée précédente `stopped`) ;
- `stop(handle)`, `stopMusic()`, `releaseAll()` (donc `endScene()` à la sortie de la scène) et `stopAmbient()` (si `ambient`) l'arrêtent ; `onEnd` n'est jamais appelé après un arrêt ;
- le séquenceur est avancé par `SoundService.tick()` (le moteur l'appelle à chaque tick) : la scène n'a plus de `tick()` de lecteur ;
- le son coupé est un réglage du puits (`AudioSink.setMuted`) : il s'applique à tout ce que le séquenceur envoie ;
- **reprise quand le synthétiseur devient prêt** : `restartMusic()` rejoue aussi un morceau lancé par `playSong`, avec les mêmes options, donc la même réécriture (celle du Rhythm Shop est pure : rejouer la mesure donne les mêmes notes). Les repères déjà passés sont signalés de nouveau et `onEnd` n'arrive qu'à la fin de la lecture rejouée.

## Navigateur : `web-sink.ts` (`src/ui/mohawk/`)

- **Déblocage** : le `AudioContext` est créé au premier `unlock()` (à appeler depuis un geste). Avant, `now()` vaut 0 et rien ne sort ; le MIDI n'est pas initialisé. `suspend()` / `resume()` (onglet masqué) suspendent le contexte : l'horloge `now()` s'arrête avec lui, la musique et les repères restent cohérents. Les transitions `suspend` / `resume` sont chaînées (le dernier appel gagne), comme dans le Téléportaschtroumpf.
- **Son coupé** : gain maître à 0 pour les WAVE et le MIDI ; la lecture continue (le moteur suit les repères et les fins de sons à l'identique).
- **API spessasynth_lib 4.3.14 utilisée** : `new WorkletSynthesizer(ctx)` (processeur AudioWorklet ; pas de `Sequencer`), `synth.connect(masterGain)`, `synth.soundBankManager.addSoundBank(arrayBuffer, "main")`, `await synth.isReady`, puis `synth.sendMessage(octets, 0, { time })` pour **tout** message brut (note, CC, pitch bend, changement de programme, SysEx), `time` en secondes sur l'horloge du contexte ; `synth.stopAll(true)` pour couper net. Le worklet range les messages futurs dans une file triée et les exécute à l'heure ; passé, un message s'exécute tout de suite.
- **File côté page** : le worklet ne sait pas annuler un message planifié, or `reset()` doit pouvoir couper ce que le séquenceur a planifié d'avance (jusqu'à 100 ms). Le puits garde donc les messages dans une file JavaScript et ne les envoie au worklet que 30 ms avant leur heure (minuterie de 8 ms) ; `reset()` vide la file, fait `stopAll(true)` et envoie CC123 / CC121 sur les 16 canaux. Reste au plus 30 ms de messages déjà partis au worklet : une note isolée peut encore sonner juste après un arrêt.
- **Chargement** : le contexte est créé à `unlock()` (geste), mais le worklet, le synthétiseur et la soundfont (`mathemagique-gm.sf2`, servie par `publicDir` = `original/`, donc `${BASE_URL}mathemagique/mathemagique-gm.sf2`, environ 18 Mo) ne se chargent qu'après `startMidiLoading()`. `BrowserHost.present` l'appelle à la **première image affichée** : le premier écran n'attend pas la soundfont. Tant que ce n'est pas fini, les messages MIDI sont ignorés sans erreur ; en cas d'échec, un avertissement console et le jeu continue sans MIDI. `ready` / `onReady(listener)` signalent le moment où le synthétiseur devient prêt (jamais en cas d'échec). La musique lancée avant est rattrapée : `app.ts` branche `onReady` sur `SoundService.restartMusic()`, qui rejoue depuis le début la dernière musique demandée si elle est toujours voulue (pas après `stopMusic`, `releaseAll`, `endScene` sans `keepMusic` ni la fin naturelle du morceau).
- **Fermeture** : `close()` (définitif, idempotent) coupe le MIDI (`reset`), arrête les voix WAVE, détruit le synthétiseur et ferme le `AudioContext` (derrière les transitions `suspend` / `resume` en cours) ; un chargement en cours est abandonné sans avertissement et `unlock()` ne fait plus rien. `BrowserHost.close()` l'appelle ; l'app l'appelle dans son `dispose` (page remplacée, détectée par la boucle d'images, ou erreur d'exécution), donc plus de contexte suspendu laissé derrière un changement de route. `exit()` ne fait que couper le son : la fermeture suit au tour de boucle suivant, quand le canvas n'est plus dans la page.
- **Processeur du worklet avec Vite** : `import processorUrl from "spessasynth_lib/dist/spessasynth_processor.min.js?url"` ; Vite le copie tel quel dans `dist/assets/` (nom haché, 400 Ko, hors du paquet principal) et la valeur importée est une URL relative au module, donc compatible avec `base: "./"` (vérifié avec une construction de page minimale ; `npm run build` ne le verra qu'une fois `web-sink.ts` importé par le jeu). Aucun `exports` dans le `package.json` de la bibliothèque : l'import par chemin est permis. L'ancien mode « bibliothèque » de Vite incruste le fichier en `data:` : ne pas s'en servir.

## Soundfont réduite

Source : *GeneralUser GS* v2.0.3 de S. Christian Collins (`archives/mathemagique/soundfont/GeneralUser-GS.sf2`, 30,8 Mo, non versionnée), choisie pour sa licence et sa couverture GM complète (décision du [plan](plan.md)).

`npx vite-node scripts/mathemagique/soundfont.mts [source.sf2]` (collecte les MIDI de Mathémagique, puis la réduction elle-même est dans `scripts/lib/soundfont.mts`, réutilisable par un autre jeu) :

1. lit les 66 MIDI de tous les `original/mathemagique/*.DAT` ;
2. `collectPrograms` (`src/engine/mohawk/audio/programs.ts`) dresse l'inventaire des timbres réellement joués : 31 470 Note On, 399 pitch bends, **80 timbres mélodiques**, **5 kits de batterie** (canal 10, le programme choisit le kit), **41 touches de batterie** ; les 45 morceaux du Rhythm Shop retrouvent les totaux documentés (15 931 notes, 367 pitch bends) ;
3. `BasicMIDI.getUsedProgramsAndKeys` (spessasynth_core) donne pour chaque morceau les presets et les couples touche / vélocité utilisés ; fusion sur les 66 MIDI ; `BasicSoundBank.trim` retire presets, instruments et échantillons inutiles ;
4. écriture en SF2 (`writeSF2`) : `original/mathemagique/mathemagique-gm.sf2`, plus `mathemagique-gm-LICENSE.txt` (copie de `LICENSE.txt`) et `files.json` régénéré (`scripts/manifest.py`).

Résultat : 287 → **84 presets**, 324 → 144 instruments, 920 → 457 échantillons ; **18,2 Mo** en SF2 (échantillons 16 bits). Le format SF3 (Vorbis) réduirait nettement cette taille (gain non mesuré), mais spessasynth_core ne fournit pas d'encodeur Vorbis et aucun n'est installé : à reconsidérer si la taille gêne (ajouter un encodeur, ou rééchantillonner les gros échantillons de batterie et de nappes). `scripts/mathemagique-extract.sh` conserve ces deux fichiers à chaque nouvelle extraction du CD.

Limite : la réduction porte sur les MIDI du jeu tels quels. Le Rhythm Shop ne change ni les programmes ni les touches (il ne fait que mettre des vélocités à 0), donc rien ne manque ; un nouveau MIDI exigerait de relancer le script.

## Licence de GeneralUser GS

Texte complet dans `mathemagique-gm-LICENSE.txt` (licence v2.0) :

- usage libre sans restriction, y compris commercial, pour la création musicale ; la banque est offerte à la communauté, on peut l'utiliser dans un logiciel et **la modifier ou changer son conditionnement** (la réduction en relève) ;
- pas d'obligation d'attribution explicite, mais le fichier de licence est joint à la banque réduite par prudence (et le script d'extraction le conserve) ;
- les échantillons gardent les droits de leurs sources, qui autorisent l'usage en production musicale ; l'auteur reconnaît ne pas pouvoir garantir à 100 % la provenance de chacun (aucun ne vient de produits commerciaux) et prévient que cela peut concerner un **produit logiciel commercial** : sans objet ici (projet non commercial) ;
- si on présente la banque sur un site, **ne pas faire de lien direct vers ses fichiers de téléchargement** : lier son site ou héberger sa propre copie, ce que fait ce dépôt.

`spessasynth_lib` / `spessasynth_core` sont sous Apache-2.0 (licence dans `node_modules`, à reprendre dans les mentions du site si une page en liste).

## Préférence « Son »

`src/ui/sound-prefs.ts` : `SoundPrefs(storage, cible, jeu)` générique (clé `retrovibe:<jeu>:sound`, `"0"` = coupé, activée par défaut, `toggle`, `reload`, appliquée par `cible.setMuted`). Même sémantique que `SoundPrefs` du Téléportaschtroumpf (`ui/prefs.ts`) et `AudioPrefs` de Lost in Time (`engine/audio/prefs.ts`) ; utilisée seulement par Math Workshop pour l'instant. **À faire hors F3** : migrer les deux autres jeux (clés `retrovibe:teleportaschtroumpf:sound` inchangée ; Lost in Time stocke `audio.sound` dans son propre magasin, donc la migration y change la clé et demande une reprise de l'ancienne valeur). Le réglage « Ambient Sounds » de l'original (moniteur, `DS:2d64`) est distinct : il appartient au roster et commande la musique de fond des activités ; la préférence du site coupe tout, indépendamment.

## Non vérifié en navigateur

`web-sink.ts` n'a pas été lancé dans un navigateur (typage et construction Vite uniquement) : chargement du worklet et de la soundfont, rendu des 80 timbres et de la batterie, heure des messages planifiés (`time`), coupure à `reset()`, `suspend` / `resume`, ou comportement avec l'autoplay. Le séquenceur et la soundfont sont vérifiés par les tests (horloge simulée, données réelles, rechargement du SF2 réduit).
