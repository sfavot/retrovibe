# Ween: The Prophecy : son

État de la vague A (son) : **aucun changement du moteur commun** (`src/engine/coktel/audio/`) n'a été nécessaire (la sortie AdLib a depuis rejoint la sortie OPL commune, D8, § 1) ; tout ce qui suit est vérifié par des tests (`test/ween/audio/`) et par un script d'écoute (`scripts/ween/render-music.mts`). Lost in Time reste vert (`test/lost-in-time`, dont ses hachages AdLib, et `test/coktel`).

Références : `plan.md` (D6, D8), `engine.md` (§ 8, § 13), `formats.md` (§ 8 SND, § 9 ADL). ScummVM : `engines/gob/sound/` (`adlplayer.cpp`, `adlib.cpp`, `sound.cpp`, `sounddesc.cpp`, `soundmixer.cpp`, `pcspeaker.cpp`).

## 1. Musiques AdLib (ADL)

- **Six morceaux dans `ADL.EXT`** (ressources 30000 à 30005, appelées par `ADL.TOT` : `o2_loadSound` slot négatif, puis `o1_playSound` → `adlibLoadADL` + `adlibSetRepeating(répétitions - 1)` + `adlibPlay`). Tous en mode mélodique (octet de mode 0) :

| # | octets | timbres | octets du morceau | durée d'un passage |
| --- | --- | --- | --- | --- |
| 0 | 5 212 | 8 | 4 761 | 55,3 s |
| 1 | 22 999 | 11 | 22 380 | 210,3 s |
| 2 | 13 934 | 8 | 13 483 | 180,6 s |
| 3 | 4 959 | 22 | 3 724 | 16,8 s |
| 4 | 5 767 | 6 | 5 428 | 65,5 s |
| 5 | 10 940 | 20 | 9 817 | 109,2 s |

- L'introduction et les salles chargent aussi d'autres morceaux (slot −19) : l'introduction regardée en entier en joue cinq autres (5 264, 3 662, 4 466, 1 278 et 15 003 octets, ce dernier en boucle) ; le morceau 0 est celui du menu et de l'ouverture (en boucle dans `MENU`). Les 7 morceaux vus sur ce trajet sont tous lus par le test `game.test.ts` contre la lecture de référence.
- **Lecteur** : `AdlPlayer` (`src/engine/coktel/audio/adlib/adl-player.ts`, port de `adlplayer.cpp`, sur `adlib.ts`, port de `adlib.cpp`). Séquenceur à 1 000 ticks par seconde (`AdLib(1000)`). Comme `OPL::Config::create`, la puce est au choix :
  - **navigateur** (`OplAdlibOutput`, `adlib/output.ts`) : le lecteur tourne sur le fil principal, cadencé par l'horloge du jeu (`host.now()`, arrêtée pendant la pause ; `WebAudioSoundBackend.update()` à chaque image, et avant chaque commande du moteur) ; chaque écriture est datée par son tick et part vers la **sortie OPL commune** `src/audio/web-opl.ts` (`tickRate` 1 000), qui la rejoue à l'échantillon près dans l'émulateur `src/audio/opl2.ts` de son AudioWorklet (`opl-stream.ts`, 40 ms d'avance). Même schéma que BASS, FOTAQ, Lure, Armaeth, Croisière et Voyageurs. La musique a son propre contexte audio (comme celle de BASS) ; coupure du son, suspension (onglet masqué), déblocage au premier geste et fermeture suivent ceux des effets. Avant le premier geste, l'état des registres est gardé puis rejoué à la connexion du worklet ;
  - **hors ligne** (`AdlPlayer(fréquence).render`, mécanique de `EmulatedChip::readBuffer`) : tests et script d'écoute.
- La fin d'un morceau (`onStopped`, le `_playing` de `AdLib::onTimer`) arrive pendant le rattrapage des ticks, sur l'horloge du jeu. Écart avec l'ancien worklet : avant le premier geste, la musique avance quand même (elle restait figée avec le contexte suspendu), comme dans les autres jeux.
- **Vérification de la lecture du format contre `adlplayer.cpp`** (`adl.test.ts`) : `adl-trace.ts` refait, indépendamment du portage, la lecture des commandes (délai initial ignoré, commandes de voix 0x00 / 0x80 / 0x90 / 0xA0 / 0xB0 / 0xC0, 0xFE + 0xD0 et plus pour modifier un timbre et le recharger sur les voix qui l'utilisent, marqueur de fin 0xFF, délais sur 1 ou 2 octets) et la cadence de `AdLib::onTimer` (après un délai d > 0, la commande suivante tombe d + 1 ticks plus loin). Pour les six morceaux, `AdlPlayer` fait **exactement** les mêmes appels de voix aux mêmes ticks (de 1 734 à 9 468 commandes) et s'arrête au même tick (16 811 à 210 287). Répétitions : n passages durent n × (fin + 1) ticks, la répétition négative boucle sans fin.
- **Non-régression** : hachage des écritures de registres OPL (`tick reg valeur`, rewind et reset compris) d'un passage de chaque morceau (de 4 800 à 19 439 écritures). Elles ne prouvent que la stabilité, pas l'identité avec ScummVM.
- **Sortie du navigateur** (`adl.test.ts`) : pour les six morceaux (deux passages), `OplAdlibOutput` cadencé par des images irrégulières fait exactement les mêmes écritures aux mêmes ticks que le rendu hors ligne. Seul change le placement d'un tick dans le flux : `round(n × fréquence / 1 000)` échantillons au lieu de l'accumulateur 16.16 de `EmulatedChip`, moins d'un échantillon d'écart.
- **Aucune note tenue** (`test/coktel/adlib-output.test.ts`) : après un arrêt, une fin naturelle (marqueur ou fin des données), entre deux passages, un chargement ou un déchargement pendant la lecture, aucune voix n'est « key on » (bit 5 de `0xB0`-`0xB8`, bits 0-4 de `0xBD`), en mode mélodique comme en percussions et sur les six morceaux de Ween ; à travers `OplStream` + `Opl2`, le son retombe à zéro après l'arrêt. `OplStream` garde désormais toujours l'ordre d'arrivée des écritures : un recalage (ticks très en avance, contexte audio qui ne tourne pas encore) pouvait faire passer une coupure de note avant la note qu'elle coupe, ce qui la laissait tenue (`test/shared/opl-stream.test.ts`).
- **Synthèse** : les trois premières secondes de chaque morceau sortent du son fini, borné à ±1, d'énergie non nulle (`AdlPlayer.render`).

### Comparaison OPL au banc : non faite, à proposer

Le banc (`scripts/ween/bench/README.md`, `scummvm-ween-bench.patch`) trace les scripts, les variables et les images, pas les écritures OPL ; rien dans `out/scummvm` ne les expose, et le banc n'est pas recompilé ici. Proposition (une dizaine de lignes, à ajouter à `gob-trace.patch`, derrière une variable `GOB_OPL=1`) : dans `engines/gob/sound/adlib.cpp`, afficher sur stderr `OW <tick> <reg> <val>` à chaque `AdLib::writeOPL`, où `tick` est le nombre d'appels de `AdLib::onTimer` depuis `startPlay`. Le format est celui de `tracePlayer().writes` (`test/ween/audio/adl-trace.ts`) : on compare alors morceau par morceau (`ADL.TOT` en charge un à la fois ; scénario : entrée Échap puis choix du morceau dans `MENU`). Les diagnostics à lire en cas d'écart : ordre des écritures dans un même tick, `reset()` (arrêt de toutes les voix) à la fin d'un passage, volume (`DEFAULT_MUSIC_VOLUME` 192/256 du portage contre le mélangeur réel).

## 2. Échantillons SND

- 192 échantillons distincts (274 références), 8 bits **signés**, mono, 1 048 944 octets, de 3 024 à 11 363 Hz dans les fichiers.
- **Fréquence** : comme `SoundDesc::loadSND` (`MAX(freq, 4700)`), `parseSnd` relève à 4 700 Hz : 18 fichiers (de 3 024 à 4 673 Hz) sont lus un peu plus vite que leur en-tête ne l'annonce, comme dans ScummVM. Durée totale à ces fréquences : 156 s.
- **Lecture** : `SoundEngine.play` → `backend.playSample(pcm, fréquence, passes)`, la durée du son est taille / fréquence (le mixeur de ScummVM, `soundmixer.cpp`, est reproduit à la trame près quand l'hôte a l'horloge exacte ; sinon temps continu). Une fréquence donnée par le script (3e valeur de `o1_playSound`) remplace celle du fichier.
- **Rééchantillonnage** : aucun dans le jeu. `WebAudioSoundBackend` crée un `AudioBuffer` à la fréquence de l'échantillon (jamais sous le minimum de 3 000 Hz de `createBuffer`, car 4 700 Hz est le plancher) et laisse Web Audio le rééchantillonner à la lecture (ScummVM : mixeur linéaire à 44 100 Hz). Écart possible de timbre, pas de durée ; à écouter.
- Tests : `snd.test.ts` (192 échantillons : appel du backend, durée avant / après, fréquence imposée ; tampons Web Audio).

## 3. Compositions et attente

- `o1_playComposition` n'apparaît que dans `INTRO0` (@349) : liste de 50 entrées lues dans les variables (int16, puis int8 : 255 vaut −1), `0, 1, 1, 1` puis des zéros. `Sound::blasterPlayComposition` attend d'abord la fin du son en cours (`waitEndPlay`), puis `nextCompositionPos` enchaîne les emplacements (les vides ou non SND sont sautés, −1 termine).
- Dans l'introduction, `o1_waitEndPlay` (image 142) met fin à la composition **après l'échantillon en cours** : on entend 0, 1, 1 (le troisième est celui en cours), jamais le quatrième ni les zéros. Le test `game.test.ts` le vérifie sur le script réel (chaînage à la durée près, une image de marge) ; l'attente de ScummVM (`blasterWaitEndPlay`, un `longDelay(200)` par tour) est déjà couverte par le banc (variables identiques sur 7 800 images).
- Tests : `composition.test.ts` (chaînage, vides, int8, `waitEndPlay`, attente du son en cours, remplacement d'un son).

## 4. Haut-parleur du PC

`src/engine/coktel/audio/pcspeaker.ts` (écrit en U2) : onde carrée, durée infinie jusqu'à `speakerOff`, fin avancée par `o1_keyFunc` (`PCSpeaker::onUpdate`). Sortie navigateur : oscillateur carré, gain 20 × 128 / 32 768 (volume par défaut de ScummVM).

- `MENU.TOT` @4038-4054 : deux bips, 500 Hz puis 100 Hz, 50 ms chacun. Testé sur le **chemin réel** (`speaker.test.ts`) : le bloc @4033 est exécuté par l'interpréteur après l'entrée dans `MENU` ; l'état du haut-parleur, les appels du backend et l'horloge du jeu (100 ms) sont comparés. La condition qui y mène n'a pas été retrouvée (déclencheur du bloc : hors périmètre), le bloc est donc lancé directement.
- `EMAJ1031.TOT` @133-135 : trois `speakerOff` en tête de salle, **aucun `speakerOn`** : pas de bip (vérifié au désassemblage). La salle elle-même n'est pas jouée dans les tests.
- `INTRO.TOT` @1508 et `INTRO5.TOT` @2183 : grille de protection, sautée (D2) : aucun appel au haut-parleur sur les 7 800 images de l'introduction (testé).
- Pas de contournement « 50 Hz = bruit de pas » (réservé à Gobliins 2 / `o3_speakerOn`, qui n'est pas Ween).

## 5. Écoute

`node scripts/ween/render-music.mts <dossier> [<n>[=<secondes>] ...]` rend les six morceaux en WAV 16 bits mono 44 100 Hz (défaut : 60 s chacun, `=0` pour le morceau entier), comme `scripts/bass/render-music.mts`. Les six morceaux entiers ont été rendus et leur amplitude est saine (crête de 9 300 à 17 400, jamais écrêtée), mais **personne ne les a écoutés** : le rendu doit être comparé à l'oreille avec ScummVM (AdLib, émulateur DOSBox) avant de conclure sur le timbre, les volumes et les fins.

## 6. Dette et points ouverts

- **D8, fait** : la musique AdLib de Lost in Time et de Ween passe par la sortie OPL commune (§ 1) ; le worklet propre au moteur Coktel (`adlib/worklet.ts`, `worklet-output.ts`, `protocol.ts`, `synth.ts`) est supprimé. **Reste une écoute** des deux jeux (début, fin, arrêt, enchaînement des morceaux).
- `parseAdl` accepte un fichier tronqué **comme ScummVM** (vérifié : `ADLPlayer::load` ne teste que `err()`, que `MemoryReadStream` ne lève pas au-delà de la fin ; le morceau est vide et s'arrête au premier tick). Seul écart : les mots manquants valent 0 au lieu d'une valeur non initialisée. Testé (`test/lost-in-time/adlib.test.ts`) ; aucun fichier de Ween n'est concerné.
- Comparaison OPL au banc à faire (§ 1) ; écoute à faire (§ 5) ; rééchantillonnage navigateur des SND à écouter (§ 2).
