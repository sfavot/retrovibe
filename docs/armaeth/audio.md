# Armaeth : musique et sons

Comment *Armaeth* (DOS 1994, Grandslam) joue sa musique et ses effets, et comment lire ses données. Sources : la rétro-ingénierie de `AM1.EXE` (`docs/armaeth/re-index.md`, corpus `archives/armaeth/re/` ; adresses `segment:offset` Ghidra) et le fichier `A1FMIX.SYS`. Les lecteurs sont `src/games/armaeth/data/mix.ts` et `src/games/armaeth/data/music.ts`, testés par `test/armaeth/{mix,music}.test.ts`.

Confiance : **certain** = lu dans le code et recoupé par un calcul sur les fichiers (les tests le vérifient quand c'est indiqué) ; **probable** = déduit des appelants et des arguments ; **hypothèse** = lecture plausible non vérifiée.

## Réponses courtes

- **Périphériques** (certain) : le moteur embarque son propre pilote musical (code `40f7`, données `406e`, 5,6 Ko) qui gère trois sorties : haut-parleur du PC (monophonique), AdLib / OPL2 (ports `0x388`/`0x389`), interface MIDI MPU-401 en mode UART (ports `0x330`/`0x331` ; probable : Roland MT-32, voir « Programmes MIDI »). **Aucun son numérique** : pas de Sound Blaster DSP (aucun accès aux ports `0x22x`), pas d'échantillons. `SOS.EXE` est l'aide en jeu, pas un pilote ; `SC0.EXE`/`SC1.EXE`/`VGA.EXE` sont empaquetés (aucune chaîne lisible, aucun signe de format connu) et n'ont pas d'interface avec `AM1.EXE` : non analysés.
- **Données** (certain) : tout le son est dans `A1FMIX.SYS` (99,5 Ko) : un annuaire (68 + 55 entrées) puis 55 « banques » contiguës. Une banque est un morceau de séquenceur propriétaire (motifs de notes, instruments OPL2, programmes MIDI, effets), pas du MIDI/XMI/CMF. Musique et effets utilisent le même format. `AM1.EXE` ne contient que les **tables** du pilote (durées, fréquences, opérateurs OPL2, notes de percussion) ; aucune musique.
- **Déclenchement** (certain pour les chemins, probable pour le sens des arguments) : `gm_sound_play(id, classe, numéro, ...)` (`2f33:000e`) charge une banque et la lance ; `gm_sound_select_track(classe, numéro, priorité, boucle)` (`2f9b:000e`) lance un effet dans la banque courante. Appelants : chargement de salle, animations (ANI), comportements de salles et d'objets, et jetons de script `mus`, `brt`, `fbt`, `msl`, `mst`.
- **Lecture pour le port** : réutiliser l'émulateur OPL2 de *Lost in Time* (`Opl2`, avec mode rythme) et réécrire un petit séquenceur à 50 Hz qui reproduit le pilote ; voir « Recommandation ».

## Architecture

Deux couches, qui ne communiquent que par `FUN_40f7_05a9` (commandes) et `snd_start_track` :

| Couche | Fonctions | Rôle |
|---|---|---|
| Moteur son (modules `2f33`-`3024`) | `gm_load_mix` `3024:0002`, `gm_sound_init` `3024:0207`, `gm_sound_play` `2f33:000e`, `gm_sound_stop` `2f33:03f2`, `gm_sound_select_track` `2f9b:000e`, `2fec:0027` (volume), `2fe0:0026` (coupure musique), `2f86:0008` (reprise), `3024:0357` (arrêt) | annuaire MIX, chargement des banques dans deux tampons, choix du périphérique, priorités |
| Pilote embarqué (`40f7` code, `406e` données) | `snd_start_isr` `40f7:0214`, `snd_stop_isr` `40f7:02e2`, `snd_isr_opl` `40f7:0cf8`, `snd_isr_midi` `40f7:12d1`, ISR haut-parleur `40f7:0e6b`, `snd_start_track` `40f7:156b`, `40f7:05a9` (commandes), `40f7:070b` (charge un morceau) | séquenceur sur IRQ0 et sortie matérielle |

Variables du moteur (DGROUP) : `5298` périphérique (0 haut-parleur, 1 AdLib, 2 MIDI, -1 aucun), `529c` son activé, `529a` musique coupée, `52d0` banque courante, `52a0` et `52b8` les deux tampons.

### Choix du périphérique (certain)

`gm_sound_init` (`3024:0207`) : le pilote démarre au haut-parleur (octet `406e:0076` = 0), puis détecte dans cet ordre et prend le premier qui répond :

1. **MPU-401** (`40f7:0fef`, jeton `rol`, périphérique 2) : lit le port d'état `0x331` jusqu'à 65 535 fois ; présent si le bit 6 (DRR) reste à 0 (probable). Initialisation `40f7:0f75` : commande `0x3F` (mode UART) puis attente de l'accusé `0xFE` sur `0x330`.
2. **AdLib** (`40f7:014d`, jeton `adl`, périphérique 1) : test classique des temporisateurs de l'OPL2 (registre 4 = `0x60`/`0x80`, minuterie 1 démarrée par `0x21`, état lu sur `0x388`, attendu `0xC0`).
3. **Haut-parleur** (jeton `buz`, périphérique 0).

Les jetons du groupe 5 (`buz`, `adl`, `rol`, `111f:0006`) forcent un choix. Si la détection finale (`40f7:0f3f`) ne redonne pas le périphérique choisi, le moteur s'arrête sur l'erreur `0xBE`. L'installation de la carte se faisait hors du jeu (`SC0`/`SC1`, hypothèse).

### Interruption et tempo (certain)

`snd_start_isr` masque IRQ0, sauvegarde le vecteur `INT 08h` (table des vecteurs `0000:0020`), installe l'ISR du périphérique et reprogramme le PIT avec le diviseur `0x5D37` : **50 Hz**. Une IRQ sur trois seulement est transmise à l'ancien gestionnaire (BIOS : compteur `CS:0e6a`), les autres ne font qu'un EOI (`OUT 0x20`). L'ISR OPL2/MIDI/haut-parleur tourne donc à 50 Hz.

Un **pas** de séquenceur dure `tempo` IRQ (50/tempo pas par seconde). Le compteur `[0x52+0xf]` est décrémenté à chaque IRQ ; les délais de voix `[voix+0x1a]` ne diminuent que lorsqu'il atteint 0, puis il est rechargé de `[0x52+0x10]`. Le tempo initial est le mot 0 de l'en-tête du morceau ; `gm_sound_play` le remplace par l'octet 2 de l'entrée de la table 1 (commande `0x400`). Les durées de note sont en pas (`NOTE_DURATIONS`, tableau `406e:0018`) : la première musique (tempo 3) dure 904 pas, soit 54,2 s (les 10 pistes actives ont exactement cette longueur : test).

## `A1FMIX.SYS`

Lu par `mix.ts`. Le fichier est consommé exactement (test) : annuaire (`8 + 68 × 8 + 55 × 42` = 2 862 octets = `0xB2E`) puis les banques contiguës, jusqu'à 101 893 octets.

### En-tête (4 mots, `gm_load_mix` `3024:0002` ; certain)

| Mot | Valeur | Rôle |
|---|---|---|
| 0 | 68 | nombre d'entrées de la table 1 |
| 1 | 55 | nombre d'enregistrements de la table 2 |
| 2 | 4 666 | taille du tampon des musiques (+10 octets alloués) = la plus grande banque de classe `M` |
| 3 | 2 122 | taille du tampon des autres sons (+10) = la plus grande banque des autres classes |

### Clés (certain)

Un son est identifié par une **classe** (une lettre) et un **numéro**, combinés en clé : `classe × 1000 + numéro + 0x218` en `int` 16 bits (`2ffa:000a`, `2ffa:007e`, `2f9b:000e` : `MUL 1000` puis `ADD 0x218`). Comme le produit déborde, `M` (77) donne `77000 mod 65536 = 11464`, d'où `M1` = 12 001. Classes présentes : `A` (clés 1 à 309), `B` (1002 à 1305), `E` (4001 à 4306), `J` (9001 à 9003), `M` (12001 à 12307). `M` est la musique de fond (tampon de 4 666 octets, choix de `gm_sound_play` : `DL == 0x4D`) ; les autres classes passent par le tampon des effets. Le sens des lettres est inconnu (hypothèse : `M` musique, `B` bruitage, `J`/`E` jingles ou événements, `A` ambiances ; le jeton `brt` appelle `gm_sound_select_track`).

### Table 1 (68 entrées de 8 octets ; `2ffa:000a`, utilisée par `2f33:000e` ; certain)

`{ u16 clé, u8 tempo, u8 volume, u16 masque de voix, u8 piste haut-parleur, u8 remplissage }`. `gm_sound_play` envoie au pilote, par `05a9(valeur, drapeaux, masque)` :

1. `05a9(tempo, 0x400, masque)` : tempo de la musique (2 ou 3) ;
2. `05a9(volume, 0x2000, masque)` : affaiblissement initial (0 à 16) ;
3. `05a9(0, 0x80 [| 0x20 si boucle] [| 0x100 si fondu entrant], masque)` : démarrage des voix du masque. Au haut-parleur (`FUN_3024_0382` vrai), le masque est remplacé par `piste << 11` : une seule voix, la piste donnée (`042d` : `[0x3a1]`).

Le masque a 11 bits (une voix par bit). Exemple : `M1` = `0x5FF` (voix 0 à 8 et 10 ; la voix 9 est muette : son motif 0 ne contient que « volume 31 »). L'octet 7 est du remplissage non initialisé (il diffère selon la langue), jamais lu.

### Table 2 (55 enregistrements de 42 octets ; `2ffa:007e` ; certain)

`{ u16 id, u16 clé, u16 clés d'effet[16], u16 taille, u32 offset }`.

- `id` : premier paramètre de `gm_sound_play` ; plusieurs enregistrements peuvent partager une clé (12 201 : ids 201 et 308), la recherche exige l'égalité sur `id` et, si la clé est non nulle, sur la clé. Les appelants passent des numéros de salle : `M` salle 304 = clé 12 304 (id 304), jingle `E4` de la salle 14 (id 14), etc. (probable).
- clés d'effet : les clés des effets sélectionnables pendant la banque (`gm_sound_select_track` en lit 16 mots, rangement `+4`) ; le rang dans cette liste est l'indice de l'effet (0 à 15).
- taille et offset : `fseek` + `fread` dans le fichier (`2f33:01ea`..`0227`). Les banques ne se chevauchent pas et sont triées par offset (test).

La taille d'une banque de classe `M` ne dépasse pas 4 666 octets, celle des autres 2 122 (test).

## Format d'une banque (certain)

Une banque est chargée telle quelle en mémoire ; `snd_start_isr`/`070b` la lit avec des offsets **relatifs au sous-morceau**. Lecteur : `music.ts` (`parseSongBank`).

```
banque
  u16[n]  offsets des sous-morceaux (n = premier mot / 2 ; toujours 1 dans les données : 2)
sous-morceau (base = offset)
  +0   u16 tempo initial (pas)
  +2   u16 nombre de voix (9 ou 11)
  +4   u16 offset des programmes MIDI
  +6   u16 offset de la table d'effets (0 = aucune)
  +8   u16 offset des enveloppes de hauteur (13 octets chacune)
  +10  u16 offset des instruments OPL2 (12 octets chacun)
  +12  u16[11] offsets des listes de motifs, un par piste (11 emplacements ; seuls les « nombre de voix » premiers servent)
  +34  u16[p] offsets des motifs (p = (premier offset de liste - 34) / 2)
  ...  listes de motifs (octets, terminées par 0xFF), puis motifs (octets, terminés par 0xFF)
  ...  enveloppes de hauteur, instruments, programmes MIDI, table d'effets
```

Preuves : `070b`/`05d9` (chargement : `ES:[DI+0..0x22]`), `0a3d` (`[SI+8]` = motifs), `0a52`..`0af6` (octets de motif), `07b7` (enveloppes), `082d` (instruments), `10cc` (programmes MIDI), `15a7` (effets). Les tests vérifient sur les 55 banques que tout se suit sans trou : listes → motifs contigus → 1 enveloppe → N instruments → programmes MIDI → (150 octets d'effets) → fin de banque.

### Pistes, listes et motifs

Une piste (voix) lit une **liste de numéros de motifs** terminée par `0xFF` (`09d4`..`0a4f`) ; la fin de la liste arrête la piste, ou la reboucle si l'indicateur de boucle `0x20` de la voix est posé. Dans les données, chacune des 533 listes des voix actives ne contient qu'un seul motif (test). Les motifs sont des octets, lus par le séquenceur à chaque pas (`0a52`) :

| Code | Effet | Source |
|---|---|---|
| `00`-`7F` | **note** n : OPL2 = fréquence `OPL_FNUMBERS[n % 12] \| (n / 12) << 10` (`406e:06e5`, n de 0 à 95, 0 = do 0 ≈ 16,35 Hz) ; MIDI = note n + 12 (`40f7:1356`) ; haut-parleur = diviseur `SPEAKER_DIVISORS[n]` (`406e:07a7`) | `0a60`..`0a91` |
| `80`-`9F` | durée courante = `NOTE_DURATIONS[code & 0xF]` pas | `0acb` |
| `A0`-`BF` | instrument `code & 0x1F` | `0aaf` |
| `C0`-`DF` | niveau de volume `v = code & 0x1F` : atténuation ajoutée `2v + 1` (OPL2/MIDI) ; `DF` = 63 = muet. Haut-parleur : `v ^ 0x1F` = 0 coupe la voix | `0ae3`, `0cb7` |
| `E0 xx` | transposition (octet `xx`, ajouté à chaque note ; toujours 0) | `072c` |
| `E1 xx` | enveloppe de hauteur `xx` (toujours 0) | `074d` |
| `E2 xx` | tempo des voix d'effet (`[0x52+0x1b]`, `[0x52+0x1c]`), 1 à 3 | `073b` |
| `E3 xx` | instrument `xx & 0x7F` (indices ≥ 32) | `0a94` |
| `E4`...`FE` | selon les bits 0-1 comme `E0`-`E3` ; bits 0-1 à 1 hors `E3` = rien (aucun argument) | `0aef`, `078f` |
| `FF` | fin du motif | `09d0` |

Particularités vérifiées :

- **Pas de silence explicite** : une voix qui ne joue pas répète la note 0 avec le volume 31 (motif 0 de la première musique : `DF A0 84 00 FF`). Une note sans commande d'instrument devant elle ne rallume pas la touche (probable) : changement de hauteur seul (`[0x6de]` n'est posé que par la commande d'instrument ; l'ISR coupe alors la touche, `0b37`, avant de la rallumer).
- **Longueur** : toutes les pistes actives d'une musique ont la même durée totale (904 pas pour la première, 8 pas pour une piste muette).
- Les banques à 9 voix ont quand même 11 pointeurs de piste ; les emplacements 9 et 10 ne sont pas lus.
- Instruments au-delà de la table : l'indice 31 (`BF`) revient souvent, plusieurs banques réclament un indice supérieur à la table ; le moteur lirait alors les octets suivants (hypothèse : sans effet audible, la voix est muette).

### Instruments OPL2 (12 octets ; `082d` ; certain)

| Octet | Registre / usage |
|---|---|
| 0 | **jamais lu** par le pilote (valeurs 0, 1, 2, 4, 8, 16 : ressemble à un bit de percussion du registre `BD`) |
| 1 | `C0+voix` (rétroaction, connexion) ; le bit 0 = additif : le volume agit alors aussi sur le modulateur |
| 2-6 | modulateur : `20` (tremolo/vibrato/maintien/KSR/multiplicateur), `40` (KSL + niveau), `60` (attaque/déclin), `80` (maintien/relâchement), `E0` (onde) |
| 7-11 | porteuse : mêmes registres ; pour `40` seuls les bits 6-7 (KSL) sont écrits, le niveau vient du volume |

Opérateurs par voix : `OPL_VOICE_OPERATORS_MELODIC` (9 voix) ou `OPL_VOICE_OPERATORS_RHYTHM` (11 voix : 6 mélodiques puis grosse caisse, caisse claire, tom, cymbale, charleston, mode rythme `BD` = `0x20` ; les quatre dernières n'ont qu'un opérateur) ; décalages `OPL_OPERATOR_OFFSETS`. Le pilote tient une image des 256 registres (`406e:03de`) et n'envoie que les différences (`40f7:00b0`, avec les délais d'accès standard). À l'initialisation : registre `01` = `0x20`, tous les niveaux à `0x3F`, image par défaut en `406e:05de` (percussions réglées en `A7`/`B7`, `A8`/`B8`).

Volume final d'une voix : `min(63, max(volume de voix, volume maître) + décalage C0-DF)`, écrit dans le niveau de la porteuse (et du modulateur si additif). Le volume de voix glisse d'un cran vers sa cible tous les `[0x52+0x12] + 1` ticks de 50 Hz (fondus).

### Enveloppes de hauteur (13 octets ; `07b7`, `074d` ; certain pour la structure)

Un octet de drapeaux (bit 7 = boucle sur le deuxième segment) puis 4 segments `{ nombre de pas, incrément signé, durée d'un pas en ticks }`. Les 55 banques n'en contiennent qu'une, neutre (`00 | 01 00 01 ×4`), appelée par `E1 00` : les modulations de hauteur ne servent pas.

### Programmes MIDI (`10cc` ; certain)

Un octet par instrument (indice d'instrument = indice dans cette table, `& 0x7F`) : changement de programme `Cn` sur le canal (numérotation 0-based) rang de la voix + 1, soit les canaux 2 à 9 ; les voix 7 à 11 en mode rythme jouent des percussions sur le canal 10 (`0x99`) avec les notes `MIDI_DRUM_NOTES` = 35, 38, 48, 51, 46 (`40f7:10a4`). Ce plan (parties mélodiques sur les canaux 2-9, rythme sur le 10) est celui du Roland MT-32 (probable) : les programmes seraient des timbres MT-32, pas du GM. Longueur observée : 128 octets quand la banque n'a pas d'effets, nombre d'instruments − 2 sinon (le reste de la banque est la table d'effets).

### Effets (30 entrées de 5 octets ; `snd_start_track` `40f7:156b` ; certain)

La table d'effets (150 octets, à la fin de la banque, présente dans 28 des 55 banques) associe à chaque indice d'effet (0 à 29 ; refus au-delà de 29, `157e`) jusqu'à 5 **numéros de motifs** (`0xFF` = fin) joués chacun sur une voix d'effet (`1546` : un motif par octet, le masque de voix décalé d'un cran à chaque octet). Exemple, 2e musique : l'effet 0 (clé `J1`, 9001) joue les motifs 6, 7, 8 ; l'effet 1 (`J2`) les motifs 9, 10, 11. Ces motifs ne sont référencés par aucune piste de musique : ils ne servent qu'aux effets.

Chaque voix de musique `k` a une voix d'effet jumelle (enregistrements `406e:02c9` + k × 0x36, lien `[voix+0xe]`). Lancer un effet pose l'indicateur `0x02` sur la voix de musique : tant qu'il dure, l'ISR joue la voix d'effet à sa place (`0d4c` : `DI = [DI+0xe]`), puis rend la voix à la musique (`09e3`..`0a0c`). La banque 302 définit un effet de plus (4) que de clés déclarées dans la table 2 ; sinon les deux comptes concordent (test).

## Commandes du pilote (`40f7:05a9` ; certain)

`05a9(valeur, drapeaux, masque)` aiguille vers le pilote du périphérique courant. Commandes globales (table `406e:0038`, `011a`) : `0x08` lire le tempo, `0x400` régler le tempo, `0x800` volume maître (`[0x52+0x11]`, utilisé par `2fec:0027`, plafonné à 63), `0x1000` vitesse des fondus (`[0x52+0x12]`). Drapeaux par voix (masque de 11 bits) : `0x80` démarrer, `0x40` arrêter (et couper les notes), `0x20` boucle, `0x10` lire le compteur de motifs, `0x100` fondu entrant, `0x200` fondu sortant puis arrêt, `0x2000` régler volume courant et cible, `0x8000` régler la cible. Fin de musique : `gm_sound_stop` utilise `0x40` (immédiat) ou `0x200` (fondu).

## Déclenchement (probable pour le sens, certain pour les chemins)

| Source | Appel | Remarques |
|---|---|---|
| Chargement de salle `1cc3:082a` | `gm_sound_play(id, classe, numéro, boucle = 7, drapeaux = 0, force = 7)` | les trois premières valeurs viennent de l'en-tête de la salle (locales `[BP-0x64]`, `[BP-0x62]`, `[BP-0x14]`) ; la musique est bouclée |
| `147f:029f`, `147f:041e`, `2caf:004d` | `gm_sound_play(id, 'M', id)` avec id = 304, 108, 307 | musiques de salles, id = numéro de la musique |
| `2405:0052`, `246c:00be`, `2594:02db` | `gm_sound_play(14, 'E', 4)` | jingle `E4` (clé 4004) : joué à **chaque mort** du héros (`characters.md` § 6) |
| `246c:*` (chute, glissade), KO | `gm_sound_select_track(7)` à chaque tic des états de chute / glissade, `(0)` à l'entrée du KO | `characters.md` § 13 |
| `2bea:0273`, `345e:009a` | `gm_sound_play(316, 'E', 306)`, `gm_sound_play(315, 'E', 305)` | jingles `E306`/`E305` (clés 4306/4305) |
| `16f5:0295` | `gm_sound_play` avec id, classe, numéro lus dans un enregistrement `ANI` | déclenchement par animation : **mot 1 de l'enregistrement `ANI` = classe de son `A`** (`0x41`, ou `0x20` = aucun son), mots 2 et 3 = numéros de son, pour 28 animations (`characters.md` § 1.3) |
| `2500:003d`, `27ed:0040`, `29fd:0029`, `2c4d:0057`, `343c:006a` | `gm_sound_select_track('B', 7 ou 2, priorité 0, boucle)` | bruitages de classe `B` (`B7` = clé 1007 ; `B2` = 1002) |
| `2832:010d`, `2846:0093`, `2846:0332`, `2846:0417` | `gm_sound_select_track('B', 101…103, 0, …)` | bruitages `B101`-`B103` |
| `2bd6:00a3`, `2c1e:029a`, `340b:0029` | `gm_sound_select_track('B', 304 / 305 / 104, priorité 0 ou 2, …)` | bruitages `B304`, `B305`, `B104` |
| `25ea:0513`, `26ab:0087`, `26ab:01bf` | `gm_sound_select_track('J', 1 / 2 / 3, priorité 10, …)` | effets `J1`-`J3`, communs à presque toutes les banques de musique |
| Jetons de script (groupe 5, `111f:0006`) | `mus id classe numéro boucle drapeaux force` → `gm_sound_play` ; `brt classe numéro priorité boucle` → `gm_sound_select_track` ; `fbt indice …` → `snd_start_track` direct (le signe du 3e argument choisit la boucle) ; `msl n` → son activé (`529c`) ; `mst 0` → initialiser, autre valeur → arrêter | ordre des arguments : `111f:0140`..`016f` |

Paramètres de `gm_sound_play(AX=id, DL=classe, BX=numéro ; pile : force, drapeaux, boucle)` : si `force` = 0 et que ce son joue déjà (`300b:0102`), rien ne se passe ; bit 0 des drapeaux : arrêter l'ancienne musique par un fondu sortant ; bit 1 : fondu entrant (hors haut-parleur) ; `boucle` ≠ 0 : musique bouclée.

`gm_sound_select_track(AX=classe, DX=numéro, BX=priorité ; pile : boucle)` : retourne 0 (introuvable ou son coupé), 1 (refusé : priorité inférieure à celle de l'effet en cours, ou, au haut-parleur, entrée de la table 1 sans piste) ou 2 (lancé). Il cherche la clé dans les 16 clés d'effet de la **banque courante** (`52d0`) ; l'indice trouvé est passé à `snd_start_track`. 
## Haut-parleur (certain)

Une seule voix : la piste `piste_hp` de l'entrée de la table 1 (`042d`/`0bdb`), les autres sont ignorées. Fréquence : diviseur du PIT canal 2 (`OUT 0x42`, mot `[0x74]`) pris dans `SPEAKER_DIVISORS`, sortie activée par les bits 0-1 du port `0x61` (`0ede`). Les deux premières notes valent `0xFFFF` (≈ 18,2 Hz, inaudibles). La note n correspond à la même hauteur qu'à l'OPL2 (n = 2 : 18,3 Hz = ré 0).

## Lecteurs TypeScript

- `mix.ts` : `parseMix(bytes)` → `{ musicBufferSize, effectBufferSize, tracks (table 1), banks (table 2), data }` ; `mixKey(classe, numéro)`, `decodeMixKey(clé)`, `findTrack(mix, clé)`, `findBank(mix, id, clé?)` (même recherche que le moteur), `bankData(mix, banque)`.
- `music.ts` : `parseSongBank(bytes)` → `{ songOffsets, songs[] }` ; un `Song` donne tempo, nombre de voix, listes de motifs par piste, motifs (octets et événements décodés), enveloppes, instruments OPL2 (champs nommés + octets bruts), programmes MIDI, effets ; `trackSteps(song, piste)` ; `decodePattern`. Constantes du pilote : `NOTE_DURATIONS`, `OPL_FNUMBERS`, `oplFrequency(note)`, `midiNote(note)`, `SPEAKER_DIVISORS`, `MIDI_DRUM_NOTES`, tables d'opérateurs ; `readDriverTables(am1)` relit ces tables dans `AM1.EXE` (offset `0x346E0` = segment `406e`) et le test vérifie qu'elles sont identiques aux constantes.

Les champs inconnus sont conservés : octet 7 de la table 1 (`padding`), octet 0 d'un instrument (`unknown`), drapeaux d'enveloppe, indices d'instrument hors table.

## Recommandation pour le port

**Jouer l'OPL2 avec l'émulateur de *Lost in Time*, piloté par un séquenceur neuf qui reproduit le pilote.**

1. **Pourquoi l'OPL2.** C'est la seule sortie qui donne la musique complète avec les instruments des données : 9 ou 11 voix, instruments de 12 octets déjà au format registres, percussions en mode rythme. Le haut-parleur n'a qu'une voix et le MIDI exige un banc de sons (les instruments sont des numéros de programme pour un Roland, pas des échantillons). L'OPL2 est aussi ce qu'un joueur de 1994 avec carte AdLib entendait.
2. **Ce qu'on réutilise.** La classe `Opl2` (`src/audio/opl2.ts`) est autonome (YM3812 : `writeReg(reg, val)`, `generate(buffer, offset, length)`, mode rythme `BD` géré par `calcRh`) et convient telle quelle : le pilote d'*Armaeth* n'écrit que des registres. Le montage Web Audio (`worklet-output.ts`, `worklet.ts`, `synth.ts`) est réutilisable comme modèle. À ne pas réutiliser : la classe `AdLib`/`AdlPlayer`, qui implante le séquenceur Coktel à 1 000 ticks par seconde et son propre jeu d'instruments (format ADL), incompatibles avec le pilote d'*Armaeth*.
3. **Ce qu'on écrit.** Un séquenceur pur (sans navigateur, testable sous Node) : 50 ticks par seconde, 11 voix de musique + 11 voix d'effet jumelles, mêmes compteurs (`tempo`, délai de voix), même ordre d'opérations que `40f7:0cf8` (pas, décodage des motifs, instrument, volume, écriture des registres à la fin de chaque tick), même rythme de touche (coupure puis rallumage sur commande d'instrument). Les données et tables viennent de `parseMix`/`parseSongBank`/constantes de `music.ts`. L'interface de haut niveau reprend `gm_sound_play`/`gm_sound_select_track`/`gm_sound_stop` (priorités, deux tampons, fondus). Le résultat est vérifiable hors ligne : les registres écrits tick par tick peuvent être comparés à une exécution du pilote d'origine sous DOSBox (journal `OUT 388/389`).
4. **Dette résolue.** `Opl2` a été déplacé dans le module partagé `src/audio/opl2.ts` ; *Lost in Time* et *Armaeth* l'importent de là.
5. **Plus tard, facultatif.** Le MIDI (programmes + notes `n + 12` + percussions du canal 10) pourrait sortir des mêmes événements, mais les programmes visent probablement le MT-32 : un SoundFont GM (le SoundFont réduit ajouté pour *Mathémagique*, commit `1383573`) donnerait d'autres timbres, à juger à l'écoute avant de s'y engager. Le haut-parleur (une seule voix) n'a qu'un intérêt historique.
6. **Pas de son numérique** à prévoir : le jeu n'en a pas.

## Inconnues et hypothèses

- Sens des lettres de classe (`B`, `E`, `J`, `M` ; `A` = sons des animations `ANI`) et du premier mot `id` de la table 2 (numéro de salle, hypothèse).
- Comment le choix du périphérique est mémorisé entre deux parties (détection automatique à chaque lancement ; `SC0`/`SC1` empaquetés, non analysés).
- Octet 0 des instruments (non lu), octet 7 de la table 1 (remplissage), bits non lus des drapeaux d'enveloppe.
- Rôle précis de l'indice de piste haut-parleur (octet 6 de la table 1 : piste jouée seule, très probable ; non écouté).
- Table d'effets : l'ordre des octets d'une entrée correspond aux voix d'effet 0 à 4 (probable) ; la vitesse d'un effet dépend de `E2` (valeurs 1 à 3).
- Le crochet par IRQ `[406e:0884]` (`15cf`) n'a aucun appelant : inutilisé.
- Aucune écoute n'a été faite : la vérification porte sur la cohérence structurelle (somme des longueurs, contiguïté, tables identiques à celles de l'exécutable), pas sur le rendu.

## Séquenceur : précisions

Lecture de `40f7:0cf8` et des fonctions voisines pour écrire `src/games/armaeth/audio/{opl-driver,sequencer}.ts` (tests `test/armaeth/{opl-driver,sequencer}.test.ts`). Confiance « certain » sauf mention.

Validé à l'écoute (24 octobre 2026) : les 10 premières secondes de la première musique, rendues par ce séquenceur sur l'émulateur OPL2 de Lost in Time, sonnent juste.

- **Images de registres** : le pilote tient l'image de travail `406e:03de` et l'image envoyée `406e:04de`. `40f7:00b0` écrit, par registre croissant, ceux qui diffèrent (registres `00` à `FE`, jamais `FF`), après avoir forcé l'octet envoyé du registre `01` à `0xFF` : **`01` = `0x20` est réécrit à chaque tick**. Seules la coupure de touche (`0b37`) et l'initialisation écrivent directement. Initialisation (`0299`, `01af`) : `01` = `0x20`, `BD` = 0, puis tout ce que l'image par défaut `406e:05de` fixe (inclut le registre `00` = 0, sans effet sur la puce).
- **Ordre d'un tick** : décrémenter les deux compteurs de pas (musique `[0x52+0xf]`, effets `[0x52+0x1b]`) ; pour chaque voix k : musique (`096a`), puis, si l'indicateur `0x02` est posé, voix d'effet jumelle (`0919`, qui remet la sortie à « muet » avant) ; si une commande d'instrument a été lue dans ce dernier traitement, coupure directe de la touche (`0b37`) ; écriture de la hauteur et des niveaux dans l'image ; enfin rechargement des compteurs tombés à 0 (tempo ; `E2` pour les effets) et `flush`. Un chargement de morceau sans commande de démarrage fait sauter le tick suivant (`[0x52+0xe]`).
- **Note et pas** : le démarrage d'une voix (indicateur `0x01`) lit ses événements au premier tick sans toucher au délai : un motif doit donc commencer par une durée (c'est le cas dans les données). Le délai ne diminue qu'aux ticks où le compte à rebours du pas atteint 0 : la première note d'une piste dure `tempo * pas - 1` ticks (la première musique se termine au tick 2 712 = 904 × 3, vérifié). La note 0 (mot `0x159`) est un silence : `A0` = `B0` = 0.
- **Touche** : chaque commande d'instrument (`A0`-`BF`, `E3`), même identique à l'instrument chargé, coupe la touche tout de suite (`B0+voix` sans le bit 5 de l'image envoyée, ou `BD` sans le bit de la percussion) avant que le `flush` la rallume. Une note sans commande d'instrument ne fait que changer la hauteur.
- **Niveau** : `min(63, max(volume de la voix, volume maître) + atténuation C0-DF)` écrit dans le niveau de la porteuse, et du modulateur si la connexion est additive ; les bits KSL sont conservés. Une voix arrêtée écrit 63. Les fondus (`0x100`, `0x200`, `0x2000`, `0x8000`) déplacent le volume d'un cran tous les `fadeSpeed + 1` ticks.
- **Mode rythme (11 voix)** : voix 6 (grosse caisse) écrit `A6`/`B6` sans bit de touche ; voix 7 à 10 n'écrivent aucune hauteur (`A7`/`B7`/`A8`/`B8` viennent de l'image par défaut, `A9`+ n'existent pas). Chaque percussion qui sonne pose son bit de `BD` (`1 << (10 - voix)`) ; seul `0b37` le retire (dans l'image envoyée), donc une percussion ne se rejoue que par une commande d'instrument. Le bit 5 de `BD` (mode rythme) est posé ou retiré par chaque commande selon le nombre de voix.
- **Effets** (`1424`, `1546`) : un effet lance chacun de ses motifs sur la voix d'effet jumelle de la voix de musique 0, 1, 2… (un motif par voix, masque décalé d'un cran) ; seules les voix 0 à 3 en ont, et un masque nul après troncature à 4 bits vaut « les quatre » (le 5e motif d'un effet jouerait sur les voix 0 à 3 ; absent des données). Chaque démarrage invalide le cache d'instrument des voix 0 à 3 ; la fin d'un effet, ou la fin de la voix de musique, rend la voix à la musique (indicateur `0x02` retiré) sans recharger l'instrument de celle-ci avant sa prochaine commande. Le cache d'instrument est partagé par la voix de musique et son jumeau (`[voix+4]`).
- **Priorités** (`gm_sound_select_track`) : la priorité du dernier effet demandé reste en vigueur après sa fin (seul `2f9b:026c`/`0375`, ou un nouveau morceau, la libère) ; une demande identique (classe, numéro, priorité, boucle) retourne 2 sans relancer ; un effet bouclé remplacé est mis de côté et relancé par `0375`.
- **Hypothèses** : (1) le volume maître vaut 0 au démarrage du jeu (l'image de `406e` contient 63, mais le moteur le règle par `2fec:0027` avant la première musique ; non retrouvé) ; (2) les enveloppes de hauteur (`E1`) sont ignorées, ce qui est exact tant que leurs incréments sont nuls (test sur les 55 banques) ; (3) `AH` n'est pas modélisé : `E0`/`E2` le laissent à 7 dans le pilote et fausseraient une note qui les suivrait sans durée ni instrument entre-deux (test : n'arrive jamais) ; (4) notes ≥ 96 : même formule que le tableau ; (5) un effet sans ligne dans la table 1 aurait un volume lu au hasard : 0 ici ; (6) `gm_sound_play` arrête l'effet en cours (registres de l'appel de `026c` non lisibles) ; (7) la détection de la carte (`014d`) n'est pas rejouée ; (8) la reprise de la musique après un jingle (`2f86:00f8`) n'est pas modélisée ; (9) une liste de motifs vide ou un motif sans note ni durée arrête la voix, là où le pilote bouclerait sans fin.
