# Lure of the Temptress : son

Vague A. Référence de comportement : `engines/lure/sound.cpp`, `sound.h` (`SoundManager`, `MidiMusic`, `MidiDriver_ADLIB_Lure`) et, de ScummVM commun, `audio/adlib_ms.cpp`, `adlib_ms.h`, `mididrv_ms.cpp`, `midiparser.cpp`, `midiparser_smf.cpp` (GPL v3 ou ultérieure), **lus en entier** puis réécrits ; chaque module cite sa source et ses écarts en tête. Décision (utilisatrice, D7 de `plan.md`) : **musique AdLib sur l'émulateur OPL2 commun du site** ; le MT-32 n'est pas porté. Données : `formats.md` § 6 (`data/sound.ts`). Modèle côté hôte : `docs/fotaq/audio.md`.

Tout le son du jeu est MIDI (aucun échantillon) : musique et bruitages sont des fichiers SMF joués par le même pilote, qui les fait se partager les 9 voix d'une puce OPL2.

| Module | Rôle | ScummVM |
| --- | --- | --- |
| `src/audio/web-opl.ts`, `opl-stream.ts`, `opl-worklet.ts`, `opl2.ts` (communs) | sortie OPL2 en AudioWorklet, écritures datées par tick (`WebOpl({ tickRate: 250 })`), `setVolume`, `setMuted` ; émulateur à l'échantillon près | `OPL::Config` |
| `src/audio/smf.ts` (commun) | analyseur SMF ; `FF 7F` en `sequencerSpecific` | `MidiParser_SMF` |
| `audio/adlib-multisource.ts` | `AdlibMultisourceDriver` : pilote OPL2 multi-sources **sans référence à Lure** (allocation des 9 voix, vol de voix, instruments BNK, fréquences, volumes, inflexion de hauteur, volume par source et fondu) | `MidiDriver_ADLIB_Multisource`, `MidiDriver_Multisource` |
| `audio/lure-adlib.ts` | `LureAdlibDriver` : instruments `FF 7F`, allocation statique, notes abaissées d'une octave, table de fréquences, pression de canal | `MidiDriver_ADLIB_Lure` |
| `audio/smf-player.ts` | `SmfPlayback` / `SmfPlayer` : lecteur SMF à plusieurs sources, minuterie de 250 Hz (4 000 µs), tempos du fichier, boucle, arrêt, pause | `MidiParser::onTimer`, `jumpToTick`, `MidiMusic` |
| `audio/sound.ts` | `SoundManager` (implémente `LureSound`) : sections, descriptions `0x3F18`, sources, sons actifs, `SF_RESTORE`, cloches, fondu | `SoundManager` |
| `audio/audio.ts` | `LureAudio` : assemble pour l'hôte (`update()` par image d'écran, `unlock`, `suspend`, `resume`, `setMuted`, `volume`, `close`) | — |
| `audio/web-music.ts` | `createWebMusicOutput()` : `WebOpl` à 250 ticks par seconde (à part pour que les tests n'importent pas le worklet) | — |
| `scripts/lure/render-music.mts` | rendu WAV hors ligne d'un ou plusieurs sons (sources distinctes), par le même gestionnaire et le même émulateur | — |

Règle des deux usages : le pilote multi-sources reste dans le dossier du jeu ; promotion vers `src/audio/adlib-multisource.ts` au deuxième moteur de ScummVM qui s'en sert (M4 de `plan.md`). Rien de `src/audio/` n'a été modifié.

## Les sons du jeu (vérifié sur les 78)

- 73 sons principaux, 4 d'introduction, 1 de fin. **Division 420 ticks par noire** (et non 96) ; le tempo est celui du fichier (65 événements de tempo en tout), à défaut 500 000 µs par noire. Les seuls événements sont : Note On / Note Off (7 626 de chaque), inflexion de hauteur `En` (183), pression de canal `Dn` (70), tempo, `FF 7F` (530) et fin de piste. **Aucun** changement de programme, contrôleur, SysEx : volume de canal et expression ne servent jamais.
- **14 sons de la section principale sont des coquilles vides** (2, 6, 11, 13, 20, 26, 35 à 40, 42, 72) : seulement les deux `FF 7F` de réglage (mode rythme, sensibilité), aucune note. Ils « jouent » donc en silence.
- Sensibilité de l'inflexion de hauteur : **toujours 1** demi-ton.
- Description `0x3F18` n° 2 (`soundNumber` 129 : le son 1 en boucle, 36,6 s, les cloches de la ville : `bellsBodge` la lance en zone 1) a `numChannels` = 2 : **zéro voix AdLib** (bits 2 et 3). `addSound` ne joue pas les sons sans voix AdLib : avec AdLib, ScummVM ne joue donc jamais cette description. Reporté tel quel (à confirmer à l'écoute si les cloches manquent).

## Horloge et lecteur SMF

- Le pilote demande 250 Hz (`getBaseTempo` = 1 000 000 / 250 = 4 000 µs). `SoundManager.advance(ms)` découpe le temps de l'hôte en ticks de 4 ms **numérotés** (`beginTick`) : le worklet place les écritures à l'échantillon près, l'hôte n'a pas à être régulier (`LureAudio.update()` une fois par image d'écran suffit ; au-delà d'une seconde de retard, le surplus est oublié).
- Chaque tick : fondu du pilote (`updateFading`), puis chaque morceau en cours, dans l'ordre où il a été lancé. Un morceau envoie les événements dont la date est **≤ la fin de l'intervalle** ; une date vaut la précédente + écart en ticks × µs par tick, entier arrondi comme `MidiParser::setTempo` (`(tempo + (division >> 2)) / division` : 1 190 µs à 420 ticks et 500 000 µs).
- **Boucle** (bit 7 du numéro de son) : à la fin de piste, un Note Off pour chaque note tenue (notes puis canaux croissants), la lecture repart du tick 0 **à l'appel suivant** (le reste de l'intervalle est perdu) ; le tempo courant et les instruments de la source sont gardés. **Sans boucle** : la fin de piste rend la source au pilote (`deinitSource` : notes tenues relâchées, notes coupées, voix rendues) et le son est retiré au prochain `tidy`.
- **Pause** (`pausePlaying`) : notes coupées, temps du morceau arrêté, reprise sans les rejouer ; `LureSound.pause()` coupe en plus les 9 voix par une écriture forcée.

## Pilote AdLib

- **OPL2, 9 voix, 10 sources** (`MAXIMUM_SOURCES`) : musique = source 0, bruitages = sources 1 à 9 (première libre). Le pilote suit séparément, pour chaque source, les contrôleurs de ses 16 canaux MIDI.
- **Instruments** : dans le fichier, par les `FF 7F` de type 1 (canal + 28 octets BNK sans les deux premiers champs), propres à la source et au canal ; modifiés **en place** (une note en cours suit, comme les pointeurs de ScummVM). Conversion BNK → registres : `2x` = multiplicateur | échelle de débit 0x10 | enveloppe soutenue 0x20 | vibrato 0x40 | modulation d'amplitude 0x80 ; `4x` = niveau | échelle de niveau << 6 ; `6x` = déclin | attaque << 4 ; `8x` = relâchement | sustain << 4 ; `Ex` = forme d'onde ; `Cx` = (connexion 0 ? 1 : 0) | rétroaction << 1 (la répartition gauche / droite n'existe pas sur OPL2).
- **Allocation** : le pilote générique sait les deux modes de ScummVM, **dynamique** (voix libre la plus basse, sinon la plus anciennement relâchée, sinon la plus ancienne note du même instrument, sinon la plus ancienne : vol de voix, la note volée est coupée) et **statique** (une voix fixe par couple source / canal MIDI, première arrivée première servie). **Lure est en statique** (`_allocationMode = ALLOCATION_MODE_STATIC`) : les canaux sont monophoniques, il n'y a **pas de vol de voix** ; quand les 9 voix sont attribuées, la note d'un nouveau canal **n'est pas jouée**. Les voix d'une source reviennent à sa fin. Conséquence : une musique à 9 canaux (introduction, fin) ne laisse aucune voix aux bruitages ; ce sont les bruitages qui sont muets (ordre d'arrivée), jamais la musique déjà installée.
- **Fréquence** (Lure) : note − 12 (première octave = 0), inflexion = (valeur 14 bits − 0x2000) >> 5, doublée par demi-ton de sensibilité au-delà de 1 (entier de 16 bits), en 1/16 de demi-ton (+8 pour arrondir), note bornée à 0..0x5FF (les notes 60 à 7F valent 5F) ; octave = ton ÷ 12, F-num dans `OPL_FREQUENCY_LOOKUP` (192 entrées, les valeurs ≥ 0xF000 sont d'une octave au-dessus), un bloc de moins sinon. `Ax` = F-num bas, `Bx` = F-num haut | bloc << 2 | 0x20 (mise en marche).
- **Niveau** (Lure) : `(0x3F − niveau) × vélocité + 0x40 >> 7`, inversé ; seuls les **porteurs** (synthèse FM : opérateur 1 ; additive : les deux) suivent la vélocité, un modulateur garde le niveau de l'instrument ; l'échelle de niveau (bits 6-7 de `4x`) est rajoutée. La pression de canal `Dn` remplace la vélocité de la note en cours du canal et réécrit les niveaux. Ni volume de canal ni expression.
- Pilote générique (non utilisé par Lure, vérifié contre ScummVM) : fréquences et volumes du pilote SB16 de Windows 95 (`OPL_NOTE_FREQUENCIES`, `OPL_VOLUME_LOOKUP`, inflexion à ± 2 demi-tons), pédale de sustain, RPN de sensibilité, volume de source et fondu.
- Registres : les écritures qui ne changent pas la valeur d'un registre sont supprimées (`_shadowRegisters`), sauf à l'initialisation (124 écritures : minuteries, 18 opérateurs, 9 voix, `BD`) et à l'arrêt général. `BD` = 0 (profondeurs de modulation et de vibrato faibles ; le pilote générique les met à 1 et 1).

## Sons actifs (`SoundManager`)

- **Sections** : `loadSection("main" | "intro" | "ending")` coupe tout puis choisit la section (ScummVM : `loadSection(id)` des ressources `0x0D`, `0x31`, `0xFF11`).
- `addSound(i)` : copie la description `0x3F18` n° `i` dans la liste des sons actifs **avant** de jouer, sauf pendant le préchargement d'une pièce ; ne joue que si le champ AdLib de `numChannels` (`(n >> 2) & 3`) n'est pas nul ; le volume de la description (0x80 par défaut) est retenu mais **sans effet sur AdLib** (ScummVM ne met la vélocité à l'échelle que pour le MT-32). `addSound2(i)` : comme `addSound` sauf si le son joue ; `i = 6` (torture chinoise) l'arrête d'abord. `stopSound`, `killSound(n)` (méthode 9), `killSounds`, `removeSounds` (arrête les sons `SF_IN_USE` après `bellsBodge`), `isSoundActive(n)` (`tidySounds` puis `findSound` ; méthode 66), `playMusic(n, isMusic)` (`musicInterface_Play` : source 0 pour la musique), `trashReverb` et `continuePlaying` sans effet, `pause` / `resume`.
- Le numéro de son porte la boucle (bit 7) ; l'arrêt, le test « joue ? » et la recherche de source comparent les 7 bits bas, mais `findSound` / `isSoundActive` comparent le numéro entier de la description (bit de boucle compris), comme ScummVM. Un son démarré directement (`playMusic`, sans `addSound`) rend sa source au prochain tidy (arrêt, test, volume), pas avant.
- `bellsBodge` (au changement de pièce) : si l'indicateur de zone de la pièce n'est plus celui du champ `AREA_FLAG`, le champ est mis à jour puis : zone 0 coupe le son 1 ; zone 1 lance la description 2 et coupe le 33 ; zone 2 règle le volume du son 0 à 15 puis coupe le 1 ; autre : coupe le 1. L'état de la pièce n'est pas du ressort du son : `LureSoundOptions.area` (`roomAreaFlag`, `getAreaField`, `setAreaField`) le fournit ; sans lui, `bellsBodge` est sauté.
- **Sauvegardes** : `activeSoundNumbers()` rend les numéros des sons actifs (`saveToStream` : tous, dans l'ordre) ; `restoreSounds(numéros)` (`loadFromStream`) coupe tout puis relance par `addSound2` ceux dont la **première description de ce numéro** porte `SF_RESTORE` (2) ; `replayRestorable()` est le `restoreSounds()` sans argument de ScummVM (relance les sons actifs `SF_RESTORE`).
- **Fondu** (introduction : `Sound.fadeOut`, boucle bloquante de 3 s dans ScummVM) : `startFadeOut()`, puis attendre `fading === false` (ou une interruption du joueur), puis `finishFadeOut(aborted)` : coupe tout et remet le volume des sources à 255.

## Interface `LureSound` (`engine/services.ts`)

Suffisante pour la logique du jeu telle qu'elle l'appelle (`addSound`, `addSound2`, `stopSound`, `killSound`, `killSounds`, `removeSounds`, `isSoundActive`, `playMusic`, `trashReverb`, `continuePlaying`, `pause`, `resume`) ; `SoundManager` l'implémente sans la changer. Ce que ScummVM appelle par ailleurs et que l'interface n'expose pas (à brancher par le moteur ou l'hôte, sur `SoundManager` directement) : `loadSection` (menu de démarrage : introduction, jeu, fin ; `scripts.cpp` : fin de partie), `activeSoundNumbers` / `restoreSounds` (sauvegarde, vague S), `setVolume`, `fadeOut` (introduction), `syncSounds`. Ce que `SoundManager` reçoit du moteur par ses options : `soundEnabled` (`Game::soundFlag`, menu « Son »), `preloading` (`Game::preloadFlag`), `area` (cloches).

## Branchement dans l'hôte du navigateur (à faire par la vague J)

```ts
const audio = new LureAudio({ now: () => performance.now(), music: createWebMusicOutput(), sections, descs, soundEnabled: () => game.soundFlag, preloading: () => game.preloadFlag, area });
audio.sound.loadSection("main");          // le moteur reçoit audio.sound (LureSound)
// une fois par image d'écran : audio.update() ; au premier geste : audio.unlock() ; onglet masqué : suspend() / resume()
```

**Le temps du jeu ne dépend pas du son.** Un son est « en cours » pendant sa durée sur l'horloge de l'hôte, que le contexte audio existe, soit bloqué (autoplay) ou que le son soit coupé : `setMuted` passe le gain de `WebOpl` à 0, l'émulation continue au même rythme (testé : mêmes durées, mêmes écritures de registres). `suspend()` fige l'horloge sonore, `resume()` repart sans rattraper. La préférence « Son » (`SoundPrefs`, clé `retrovibe:lure:sound`) se branche sur `LureAudio.setMuted` par l'hôte ; elle n'est pas confondue avec `soundFlag` du jeu (le menu « Son » du jeu, qui supprime les sons et coupe `killSounds`).

## Preuve : mêmes écritures de registres que ScummVM

Le pilote de ScummVM n'est pas réimplémenté de mémoire : un **harnais** (`test/lure/audio/reference-tools/`) compile les vrais `adlib_ms.o`, `mididrv_ms.o`, `midiparser*.o` d'une compilation de ScummVM et y ajoute `MidiDriver_ADLIB_Lure` **extrait tel quel** de `sound.h` / `sound.cpp` à la compilation (jamais copié dans le dépôt), avec un OPL « journal » à la place de l'émulateur ; un équivalent de `MidiMusic` (même parser, mêmes appels) joue de vrais fichiers. Il journalise `tick registre valeur`. `gen.py` en tire `test/lure/audio/reference.json` (régénération : `build.sh`, `dump-sounds.mts`, `gen.py`, vérifiée identique à l'octet).

`reference.test.ts` rejoue chaque scénario dans le code TypeScript et exige **exactement** la même suite d'écritures :

- scénarios courts, toutes écritures comparées : une note et son instrument BNK ; 90 notes (de la note 0 à 127, vélocités 1 / 64 / 127, deux instruments, canaux 0 et 1) ; inflexion de hauteur (0000 à 3FFF, sensibilités 0, 1, 2, 3 et 12, notes graves et aiguës) ; pression de canal ; **deux sources** sur 9 voix (allocation statique, canaux sans voix, voix rendues à la fin de piste) ; pilote générique dynamique (12 notes sur 9 voix : vol de voix, pédale, volume de canal, expression, inflexion SB16, RPN, volume de source, volume utilisateur, tous sons coupés) et statique ; fondu avec et sans fin de source ;
- sons du jeu, comparés par empreinte SHA-1 et nombre d'écritures (`original/lure/` requis, sinon ignorés) : **chacun des 78 sons seul**, jusqu'au bout ; une boucle coupée à 12 s ; musique + bruitages lancés et arrêtés à des instants différents ; fondus sur de vrais sons.

Résultat : les 95 scénarios sont identiques (9 courts, 86 sur les sons du jeu, dont les 14 coquilles vides).

## Tests (`test/lure/audio/`)

- `reference.test.ts` : ci-dessus.
- `driver.test.ts` : registres d'une note, conversion d'un instrument BNK, inflexion de hauteur, bornes de notes, deux sources (allocation fixe, plus de voix libre, voix rendues), vol de voix du pilote générique, pédale, volume de source ; valeurs vérifiées à la main et contre ScummVM.
- `player.test.ts` : durée des ticks (96 et 420 ticks par noire, tempo du fichier), Note On de vélocité 0, boucle, fin de piste, pause, deux sources.
- `sound.test.ts` : sources, sons actifs, description sans voix AdLib, `soundFlag`, préchargement, boucle, `addSound2`, `removeSounds`, `SF_RESTORE`, cloches, horloge, pause, fondu.
- `real.test.ts` : **les 78 sons jouent jusqu'au bout** sans écriture hors des registres de l'OPL2, la source est rendue et aucune voix ne reste allumée ; les 12 boucles tournent sans fin ; `LureAudio` : **un son coupé ne décale ni la durée des sons ni les écritures**, onglet masqué, volume, fermeture.

## Écarts avec ScummVM

- Pas de verrous ni de fil de minuterie : le son avance avec l'horloge de l'hôte (`advance`).
- **Volume de l'utilisateur** de ScummVM (musique et bruitages, 192 / 256 par défaut, soit « 63 − niveau » multiplié par 0,75 sur chaque porteur) non appliqué : le volume de la page passe par `WebOpl.setVolume`. `setUserVolumes` le rétablit.
- Pilote : OPL2 seul, pas de mode rythme (jamais activé dans les données), pas d'OPL3, pas d'instruments à quatre opérateurs, pas de précision General MIDI, pas de valeurs de contrôleur par défaut, pas de SysEx General MIDI ; l'instrument est réécrit à chaque note. Un `FF 7F` d'instrument invalide (longueur, canal) lève une exception (ScummVM : `assert`).
- Lecteur : SysEx et méta-événements texte non transmis (aucun dans les données).
- Un numéro de son hors de la section lève une exception (ScummVM lit hors de ses tables).
- Pas de MT-32 (`isRoland`, `initCustomTimbres`, `allocateSourceChannels`) ; pas de fenêtre « initialisation de l'audio ».

## Points ouverts : à écouter, par une personne

Les écritures de registres sont prouvées identiques ; ce qui dépend de l'oreille :

1. **Timbre** : ScummVM joue ces registres sur son émulateur OPL (MAME ou DOSBox) ; ce site, sur celui de Lost in Time (`src/audio/opl2.ts`). Les registres sont les mêmes, le rendu des enveloppes, du vibrato ou de la rétroaction peut différer légèrement. Comparer à côté de ScummVM.
2. **Niveau** : sans le volume utilisateur de ScummVM (voir ci-dessus), la page est plus forte que ScummVM à son réglage par défaut (192) ; vérifier l'équilibre musique / bruitages, que le volume de chaque son (0x80, 200, 15…) ne règle pas (comme ScummVM).
3. **Voix** : les notes de nouveaux canaux sont perdues quand les 9 voix sont attribuées (allocation statique de ScummVM) ; écouter l'introduction et la fin (9 canaux) avec des bruitages. L'original DOS affecte lui aussi une voix fixe par canal (commentaire de ScummVM), pas vérifié ici.
4. Les cloches de la ville (description 2) ne jouent pas avec AdLib (zéro voix AdLib) ; les 14 sons vides sont silencieux.
5. Le fondu de l'introduction (`startFadeOut`) et le déroulé de l'introduction restent à brancher (vague de l'introduction).
