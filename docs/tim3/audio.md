# The Incredible Machine 3 : son

Vague A, partie propre au jeu (`src/games/tim3/audio/`, tests `test/tim3/audio/`). Sources : `formats.md` § 8 à 10, plan D4 à D6, et le désassemblage de `TIMWIN.EXE` et de `SOSLIBS2.DLL` (adresses entre parenthèses, lues, pas exécutées). Le niveau de certitude est dit pour chaque fait.

## Architecture

| Fichier | Rôle |
| --- | --- |
| `ids.ts` | numéros de sons, drapeaux, `VoiceRef`, noms de fichiers |
| `effects.ts` | `EffectMixer` : 16 emplacements avec priorité (effets WAV) |
| `music.ts` | `Tim3Music` : `parseHmi` → `MidiPlayer` → synthétiseur General MIDI |
| `voices.ts` | `Tim3Voices` : voix MP3 à la demande (`VoiceBank` + `SampleChannel`), synchro labiale |
| `lipsync.ts` | décodage de `lipsync.json`, `mouthAt` |
| `audio.ts` | `WebTim3Audio` (hôte) et l'interface `Tim3Audio` (ce que demandent l'interface et le moteur) |

Un seul contexte audio et un seul gain général (`WebSampleOutput`) : le synthétiseur (`WebGmSynth`, soundfont `${BASE_URL}mathemagique/mathemagique-gm.sf2`, **sans copie**) s'y branche par `connection()`. Donc `setMuted` (préférence « Son » du site, `SoundPrefs`) coupe musique, effets et voix, et `suspend()` / `resume()` figent tout, horloge de la musique comprise. Le temps du jeu ne dépend jamais du son (voix et effets durent sur l'horloge de l'hôte).

`TrackPlayer` (cité dans le brief) lit des fichiers audio par un `HTMLAudioElement` : il ne sert pas pour du MIDI. La musique utilise le séquenceur commun `MidiPlayer` de `src/engine/mohawk/audio/sequencer.ts` (pur, déjà utilisé par Mathémagique et Zoombinis). **Dette** : ce séquenceur est générique mais vit sous `engine/mohawk/` ; à promouvoir dans `src/audio/` (évolution à décider, non faite ici).

### Interface proposée (`Tim3Audio`, dans `audio.ts`)

```ts
playMusic(music) / stopMusic() / musicNumber        // 1000 à 1023, 0 = aucune ; même morceau = pas de relance
playEffect(id, priority = 1, flags = 0): boolean    // SX_<id>.WAV ; stopEffect(id) ; stopEffects()
playVoice(ref: VoiceRef): boolean / stopVoice() / voiceActive
mouth(): MouthPose                                   // pose du professeur à l'instant courant
voicesEnabled (get/set, mémorisé)                    // D4, activées par défaut
enterPuzzle(music)                                   // coupe voix et effets, lance la musique du niveau
stopAll()
```
`WebTim3Audio` ajoute `setMuted`, `unlock` (au premier geste), `suspend` / `resume` (onglet masqué), `update` (à chaque image), `close`. Options : `now`, `resources` (le `ResourceIndex`, qui porte les `SX_*.WAV` et `SX_*.HMI`), `voices` (`SoundFiles<string>`, clé `goals/017` → `voices/goals/017.mp3`), `lipsync` (`parseLipSyncJson(voices/lipsync.json)`), `storage`, `soundfontUrl`. Si l'agent de l'interface définit une autre interface, `WebTim3Audio` y répond en adaptant les noms ; la sémantique est ci-dessous.

## Musique (D6)

- Numéro de musique du puzzle : `LevInfo.music`, de 1000 à 1023 (4 puzzles à 0 : pas de musique) ; il désigne directement `SX_<n>.HMI` (classe 1 de `PlaySound`, `411b0c`). La classe 2000 à 2999 (pistes CD, repli HMI par une table de 23 entrées, `0x470088`) n'est jamais demandée par les puzzles et l'ISO n'a pas de piste CD : non portée.
- Boucle : `FE 14` → `FE 15` du fichier (marqueurs de `parseHmi`), introduction jouée une fois ; `SX_1022` (jingle) se joue une fois. Redemander le morceau en cours ne fait rien (`449c10`). Arrêt net : `WebGmSynth.reset` coupe aussi les notes déjà planifiées.
- Le synthétiseur se charge en tâche de fond : un morceau demandé avant qu'il soit prêt démarre dès qu'il l'est.
- **Tempo : 120 ticks par seconde, confirmé par le code de la bibliothèque SOS** (non par une écoute). `SOSLIBS2.DLL` (16 bits, `0xB37C` dans le fichier) : `sosMIDISongAlterTempo` calcule le nouveau rythme du minuteur par `u16(+0xD4) × pourcentage / 100` et l'envoie à `sosTIMERAlterEventRate` ; `0xD4` est donc la cadence du minuteur à 100 % (un tick par évènement, ce qui reste supposé). `0xD2` (192, 480) ne sert qu'aux positions mesure:temps. `src/audio/hmi.ts` garde ses 120 ticks/s ; seul son commentaire a été corrigé.

## Effets (§ 9)

Numéro et drapeaux de `PlaySound(id, priorité, drapeaux)` (`41126d`, lu) :
- classe par `id / 1000` ; effets en 3000 et plus ; **un numéro < 92 est une ambiance** : `3800 + id`, drapeaux 7 (boucle, sans relance). Les animations de pièces utilisent ces petits numéros (PART24 : 24, PART5 : 5…) ;
- drapeau 1 : ne pas relancer ; drapeau 2 : boucle ; drapeau 4 : chercher d'abord le même numéro déjà en cours (le rejouer, ou, avec le drapeau 1, laisser le premier) ;
- **16 emplacements simultanés** (`449ea0` boucle sur 16 entrées, `41126d` sur 16) ; plus de place : on remplace l'emplacement de plus basse priorité parmi ceux de priorité strictement inférieure (ou égale, pour le même numéro sans le drapeau 1), sinon la demande est perdue. C'est ce que fait `EffectMixer` ;
- le jeu met les demandes d'un pas dans une file de 48 entrées (`411863`, dédoublonnée) et les exécute d'un coup (`411950`) : regrouper les `playEffect` d'un pas suffit.
- `SX_3400.WAV` est en 16 bits 22 050 Hz : `readSoundEffect` s'en charge.

## Effets déclenchés par les pièces : API demandée au noyau

Constat (lu, `44b548` / `44b094`) : **presque aucun handler de pièce n'appelle le son.** Les sons des pièces sont des **commandes des animations** : `5 son {SX_n}` joue `(n, priorité 1, drapeaux 0)` et `8 son étendu {SX_n, a, b}` joue `(n, a, b)` (les champs `unknown04` et `unknown06` de `anm.ts` sont donc la **priorité** et les **drapeaux**) ; la commande `7` (absente des données) arrête le son de son numéro (`41151e`). Elles s'exécutent quand le jeu **dessine l'image** (`44b094` appelé par les routines de dessin des pièces), pas pendant la simulation. De nombreuses ANM de pièces en portent (relevé partiel : PART4, 5, 6, 12, 13, 15, 16, 19, 24 à 27, 35 à 37, 39, 41, 42, 50, 51, 54, 55, 58, 61, 64, 80, 81, 89 à 93, 107 à 109, 116, 117, 137), des sons 3xxx comme des ambiances ; les INFO*.ANM (fiches d'aide) et l'interface en portent aussi.

Quelques appels viennent aussi de code de handler (lu) : bascule 3 et 139 (3139), impulsion Phazer (3021), Message Computer (3136, 3237), Egg Timer (3137), plus des sons de l'interface (3611 = clic, `0xe1b`) dans les fonctions de dessin et de menu de `0x42e660` et voisines.

**API à fournir par le noyau / le rendu** (à transmettre à la session principale) :
```ts
interface SoundEvent { id: number; priority: number; flags: number }
// côté rendu : quand l'image affichée d'une pièce CHANGE (index d'image différent du dessin précédent), exécuter les commandes
// `sound` / `soundEx` de `anm.frames[i].commands` et appeler `world.onSound?.(event)` ; la commande 7 appelle `onStopSound(id)`.
world.onSound: ((e: SoundEvent) => void) | null      // brancher sur Tim3Audio.playEffect(e.id, e.priority, e.flags)
world.onStopSound: ((id: number) => void) | null     // Tim3Audio.stopEffect(id)
```
Points à trancher en vague R/U : (1) le jeu rejoue la commande à chaque dessin de l'image (dédoublonnée dans la file), et ne redessine sans doute que les zones modifiées ; « une fois à chaque changement d'image » en est la meilleure approximation, **à vérifier à l'écoute** ; (2) les ambiances (< 92) en boucle doivent être arrêtées quand la pièce disparaît ou que la machine s'arrête (`stopEffects` à l'arrêt et à l'entrée dans un puzzle) ; (3) les sons de handlers (liste ci-dessus) demandent un `onSound` appelé depuis le handler, donc au noyau (groupes `creatures`, `pyro`, `misc`).

## Voix (D4, D5)

- Une voix = un MP3 `voices/<archive>/<index sur 3 chiffres>.mp3` : `goals` (index = puzzle de `LEVELS.INF`, 0 à 205), `hint1` à `hint7` (même index ; seules 104, 74, 30, 10, 5, 4, 1 entrées existent), `help` (index de `HELP.RES`), `profesor`. Fabriques : `goalVoice`, `hintVoice(n, puzzle)` (`HINT8.VOC` n'existe pas : `null`), `helpVoice`, `professorVoice`.
- `playVoice` rend **faux si les voix sont désactivées ou si le fichier manque** : l'interface affiche alors le texte seul (le but et les indices restent toujours en français). Une voix lente à charger est « active » au plus 5 s (`LOAD_TIMEOUT_MS`).
- Une seule voix à la fois (la nouvelle remplace l'ancienne). L'interface appelle `enterPuzzle` (ou `stopVoice`) au changement de puzzle.
- Préférence « voix activées » : `retrovibe:tim3:voices`, activée par défaut (`SoundPrefs` avec clé propre) ; la désactiver coupe la voix en cours. Distincte du muet du site.
- Identifiants d'origine (pour mémoire, `4247c0`) : le jeu désigne les voix par `4000 + 500 × archive + entrée` (PROFESOR 4000, HELP 4500, GOALS 5000, HINT1 à 8 ensuite), l'id 6000 (`0x1770`) est la voix en cours, lue par flux.

## Synchro labiale (établie par le code, à valider à l'œil)

Format des octets `sync` (`voices/lipsync.json`, `HELP` et `PROFESOR` seulement ; lu par `4247c0`, consommé par `4241ae`) :
```
u32 142 ; u16 initial (lu et ignoré) ; { u16 instant ; i16 valeur }* ; u16 0xFFFF (fin)
```
- Instant en **soixantièmes de seconde** depuis le début de la voix : le jeu le tire de la position de lecture (`octets × 60 / 11025`, `4242fb`). Vérifié sur les données : le dernier instant de chacune des 220 synchros tombe dans la durée de la voix, à une exception près (`profesor/015` : 9 s de synchro pour 3,4 s de voix, donnée d'origine incohérente) ; le rapport durée / dernier instant est de 0,0167 s, soit 1/60.
- Un évènement s'applique quand l'instant courant le **dépasse strictement**. Valeur **0 à 15** : forme de la bouche, état `MOUTH_STATES[v]` de `PROFSPCH.ANM` = `[27,34,30,33,35,37,26,31,38,28,40,39,29,36,32,27]` (table `0x472ba4` de l'exe ; la bouche est l'image seule de cet état, dessinée par-dessus le visage) ; valeur **16 à 26** : geste du corps, état `GESTURE_STATES` = `[5,25,7,10,49,52,55,70,60,61,172]` (table `0x472b78`), animation qui revient au repos (état 5) ; autre valeur positive (93, 108 dans les données) : ignorée ; valeur négative (dernier évènement) : fin de la parole, bouche au repos. `GOALS` et `HINTn` n'ont pas de synchro : bouche au repos.
- Les `M*.RES` (`MGOALS`, `MHELP`, `MHINT1-7`, `MPROF`) sont les **mêmes octets** : `u16 n`, `u32 offset[n]`, et pour chaque enregistrement `u32 longueur`, la synchro, puis `01 00 00 00 31` (sens inconnu) ; ceux de `GOALS` et `HINT` sont vides (longueur 0). Rien de plus à en tirer : non lus.
- API : `WebTim3Audio.mouth()` (ou `mouthAt(sync, ms)`) rend `{ viseme, mouthState, gestureState, gestureStartMs }` : états à passer aux séquences de `PROFSPCH.ANM` (états 27 à 40 : une image chacun). Fenêtre du professeur : `PROFSPCH.ANM` (640×400, corps) et `PROFAMBT.ANM` (ambiance, quand il ne parle pas).
- À vérifier à l'œil : l'alignement bouche / voix (décalage éventuel d'une ou deux images), le sens du mot initial (peut-être l'état de départ), et le rendu des gestes 16 à 26.

## Cas limites traités

| Cas | Comportement |
| --- | --- |
| Effets nombreux au même pas | 16 emplacements, priorité (ci-dessus) |
| Musique changée par niveau | `enterPuzzle(music)` ; même morceau : pas de relance ; 0 : silence |
| Voix coupée au changement de puzzle | `enterPuzzle`, `stopVoice`, `stopAll` |
| « Sans son » | `setMuted(true)` : gain général à 0, rien n'est arrêté ni décalé |
| Onglet masqué | `suspend()` / `resume()` : contexte figé, voix et musique ne vieillissent pas |
| Voix absente / voix désactivées | `playVoice` faux, pas d'attente |
| Soundfont pas encore chargée | la musique démarre dès que le synthétiseur est prêt |
| Fichier d'effet illisible | effet abandonné, aucun emplacement occupé |

## À écouter (non vérifiable sans oreille)

- Tempo de chaque morceau (120 ticks/s) : durées plausibles (14 à 155 s), à comparer à l'original si possible.
- Boucles : raccord à la fin du tour, et note tenue coupée proprement.
- Rendu General MIDI de la soundfont réduite de Mathémagique sur les 24 morceaux (instruments, batterie canal 9) : elle a été réduite pour d'autres morceaux.
- Effets : doublons d'une même pièce (relance à chaque changement d'image ?), ambiances en boucle bien arrêtées, niveau relatif effets / musique / voix (le jeu n'a pas de réglage de volume propre : tout est à 1).
- Voix : synchro labiale, délai de chargement du premier MP3.
