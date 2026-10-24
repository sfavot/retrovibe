# Rhythm Shop (scène 2, `RHYTHM.DAT` + `RSHELP.DAT` + `MidiMPC.DAT`) : étude de rétro-ingénierie

Tâche E3. Math Workshop MPC v1.01 (Brøderbund, 1994, Win16). Activité « Rhythm Shop » : la machine **Fractionaire 2000** d'Algebird. Les adresses sont des `sélecteur:offset` de la décompilation (`archives/mathemagique/re/MATH/decomp/`), les `DS:xxxx` sont des offsets du segment de données `1108` (relus dans l'image du NE, relocations appliquées). Un fait sans mention est lu dans le code ou dans les données ; **hypothèse** marque une déduction non vérifiée. Cadre global : [../engine.md](../engine.md) ; index des fonctions : [../re-index.md](../re-index.md) ; formats : [../formats.md](../formats.md) ; manuel (v2 1997) : [../manual-en.md](../manual-en.md) pages 36-38.

Code : segment `1028` (16 Ko, scène et dessin), `1058` (6,6 Ko, listes de pièces, glisser-déposer, patch MIDI), `1038` (4 Ko : tables des pièces, validation des coupes, minuterie 4 ms, gadgets partagés). Les `Enter`/`Leave`/`Tick`/`Exit`/`Key` de la scène sont `1028:0f99`/`13f7`/`15cd`/`173a`/`2de2` (engine.md §1.4).

## 0. Résumé en dix lignes

- L'enfant doit **reconstituer la mesure d'un morceau** : un « Teletune » affiche la recette (ex. `Fanfare (2) 1/2 bars`) ; la barre entière `1/1` est dans le bac de pièces ; avec trois outils (**Cutter** coupe en n parts égales, **Gluer** colle des pièces égales, **Melder** fusionne des pièces quelconques en une pièce de taille fixée) il fabrique les fractions demandées et les glisse dans le **Pattern Bin** (emplacements imposés, dans l'ordre).
- Mathématiques : fractions (équivalence, addition = Melder, division = Cutter, multiplication/addition répétée = Gluer), unité interne **1/144 de mesure** (§1.2).
- 45 morceaux = 3 niveaux (« Level Brothers ») × 15. Chaque morceau a une `PLST` (id 30000 + k) de **4 variantes** (« énoncés » ayant le même motif cible mais des outils différents) ; la variante suivante est servie après chaque réussite (compteur sauvegardé dans le roster).
- Pas de score ni de limite de temps ni de nombre d'essais. Réussite = Pattern Bin sans emplacement vide : le morceau (MIDI) est alors joué **avec Algebird qui danse** (poses de `SHPL` 31000 synchronisées sur les marqueurs `Cue` du MIDI), suivi d'une animation de félicitations.
- Les erreurs (coupe impossible, collage de pièces inégales…) déclenchent une réaction parlée d'Algebird (`SCR` 4000-11300 de `RHYTHM.DAT`, voix `SND` 187xx) tirée au hasard dans une table par type d'erreur (§1.8).
- L'aide (bouton « Help ») : mode « point d'interrogation » ; un clic sur une zone de l'écran joue une animation de Poly de `RSHELP.DAT` (31 `SCR`, 82 voix `SND` 186xx).
- Formats décodés : `STLV` (45 couples id MIDI → id `PLST`), `PLST` (386 octets : motif cible + 4 variantes de 24 pièces + 9 outils), bloc `Prg#` (liste « programme → masque de canaux » pour `midiOutCachePatches`), `SYSX` de `MIDIMAP.DAT` (64 messages d'initialisation des 16 canaux) : §2.
- Musique : le jeu **réécrit le MIDI en mémoire** avant de le jouer (§3.3) : il ne garde que la première mesure (jusqu'au 2e marqueur `a`/`1`), met la vélocité à 0 des notes dont l'emplacement du Pattern Bin n'est pas rempli, relit le tempo ; les marqueurs `Cue` (`a`-`x` = emplacement, `1`-`8` = temps) rappellent le jeu (`1028:26b0`) pour l'éclairage des pièces et la danse.
- Côté navigateur : il faut un séquenceur à marqueurs (facile) et surtout un **synthé General MIDI** : le petit synthé d'Indy (`src/games/indy/audio/midi.ts` + `audio.ts`) est insuffisant (§3.6). Décision de dépendance à demander à l'utilisatrice.
- Roster : 3 variables de scène (offsets 88, 133, 135), pas de masque de réussite (le Rhythm Shop n'écrit rien dans le masque 30 bits des certificats, §6).
- Plan d'implémentation : module pur (`rhythm/logic.ts`) + machine à états de scène + service audio MIDI (§8).

## 1. Règles et gameplay

### 1.1 Écran et vocabulaire (manuel p. 36-38 ↔ code)

Fond plein écran 576 × 432 = `SHAP` 30000 de `RHYTHM.DAT` (§4). Éléments, coordonnées en pixels du repère de jeu, rectangles `(gauche, haut, droite, bas)` lus dans le segment de données :

| Élément (manuel) | Rect | Rôle | Source |
|---|---|---|---|
| Cutter / Gluer / Melder (3 groupes de 3 boutons) | 9 rects de 20 × 33 : y 54-86 ; x 222, 242, 262 \| 320, 340, 360 \| 419, 439, 459 (largeur 19) | choix de l'outil et de son réglage | `DS:159c` (pas de 20 octets) |
| Fractionator | (194,148)-(485,191) | pièces en cours de traitement | `DS:1588` |
| Parts Bin | (205,231)-(496,274) | pièces disponibles (au départ la barre entière) | `DS:1560` |
| Pattern Bin | (205,305)-(496,348) | emplacements cibles | `DS:1574` |
| Play Parts / Play Pattern | (172,232)-(199,271) / (172,306)-(199,345) | écoute des pièces / du motif | `DS:1672…` |
| Do It! | (286,199)-(386,227) | exécute l'outil | idem |
| Empty / Undo | (444,201)-(499,223) / (172,201)-(227,223) | vide le Fractionator / annule | idem |
| Level Brothers (3 boutons) | (44,155)-(73,183), (79,155)-(108,183), (115,155)-(144,183) | niveau 1, 2, 3 | idem |
| Help / Exit | (104,198)-(133,226) / (60,199)-(97,225) | aide / sortie | idem |
| Tuning (Timing) Arrows | (46,132)-(82,151) / (107,132)-(143,151) | morceau précédent / suivant | idem |
| Teletune (écran) | texte dans (36,28)-(147,125) | nom du morceau + recette | `DS:1830`, `1028:1774` |
| Algebird | (19,257)-(166,410) | personnage (clic = réplique) | `DS:1850`, `DS:11d6` |

L'ordre des 12 boutons de la liste `DS:1672` est celui des identifiants de rappel (`FUN_1028_0000(n)`) : 1 Play Parts, 2 Play Pattern, 3 Do It, 4 Empty, 5 Undo, 6/7/8 niveaux, 9 Help, 10/11 flèches (précédent/suivant), 12 Exit (§1.9). Le bouton **Demo** du manuel 1997 n'existe pas dans le code de la v1 (§7).

### 1.2 Modèle de données : pièces en 1/144 de mesure

Tout est exprimé en entiers dans des tableaux de **24 mots signés** (`int16`) : une valeur `v > 0` est une pièce de taille `v` (unités de 1/144 de mesure) ; `v < 0` est un **fantôme** (emplacement vide dont la forme est `-v`) ; `0` termine/vide. La mesure vaut `0x90 = 144` ; un bac fait 288 px de large (2 px par unité). Les 30 tailles autorisées sont exactement celles qui ont un sprite (`1038:05d5`, table `DS:1b94`, 30 mots) :

| Fraction | Tailles (unités) |
|---|---|
| 1/1, 1/2, 1/3, 2/3, 1/4, 3/4, 1/6, 5/6 | 144, 72, 48, 96, 36, 108, 24, 120 |
| 1/8, 3/8, 5/8, 7/8 | 18, 54, 90, 126 |
| 1/9, 2/9, 4/9, 5/9, 7/9, 8/9 | 16, 32, 64, 80, 112, 128 |
| 1/12, 5/12, 7/12, 11/12 | 12, 60, 84, 132 |
| 1/16, 3/16, 5/16, 7/16, 9/16, 11/16, 13/16, 15/16 | 9, 27, 45, 63, 81, 99, 117, 135 |

(Les fractions affichées sur les pièces sont les réduites `taille/144` : 54 → `3/8`, 16 → `1/9`.) Ni 1/5, ni 1/7, ni 1/10, ni 1/11 : les cinquièmes et septièmes n'apparaissent que comme 5/9, 7/9… Les 5 tableaux de travail (tous de 24 mots) du segment de données :

| Tableau | Adresse | Contenu |
|---|---|---|
| Parts Bin | `DS:7596` | pièces dispo (> 0) et fantômes (< 0) des pièces sorties du bac |
| Pattern Bin | `DS:75c6` | initialement `-cible[i]` ; une pièce posée met `+taille` |
| Fractionator | `DS:75f6` | pièces à traiter (> 0), compactées à gauche |
| Parts initial | `DS:7626` | copie de la variante (pour réinitialiser) |
| Cible | `DS:7656` | `-motif[i]` (jamais modifié) |
| Sauvegarde annulation | `DS:768e` | Fractionator avant le dernier « Do It » |

Le dessin d'une pièce (`1058:0592`, `1058:113b`) : abscisse = `rect.gauche + 2 + 2 × (somme des tailles précédentes)`, largeur = `2 × taille`, hauteur 43 ; sprite = `SHAP` `30000 + idx - 1` avec `idx` donné par `1038:0698` : 144→2, 72→3, 48→4, 96→5, 36→6, 108→7, 24→8, 120→9, 18→10, 54→11, 90→12, 126→13, 16→14, 32→15, 64→16, 80→17, 112→18, 128→19, 12→20, 60→21, 84→22, 132→23, 9→24, 27→25, 45→26, 63→27, 81→28, 99→29, 117→30, 135→31 (couleur par famille de dénominateur : violet 1/1, jaune 1/2, bleu 1/3, orange 1/4, vert foncé 1/6, rouge 1/8, turquoise 1/9, cyan 1/12, magenta 1/16). Les fantômes utilisent le sprite `idx + 30` (vert vif, 32-61 : « trou » à remplir). Une valeur hors table : `idx = 0` (rien dessiné).

### 1.3 Le motif, les variantes, les outils : la ressource `PLST`

Voir le format exact au §2.2. Pour un morceau `k` (0-44) et un niveau `s = k / 15`, `slot = k % 15` :

1. `STLV` donne `(idMIDI, idPLST)` (§2.1).
2. `PLST` contient le **motif cible** (la mesure découpée en 1 à 16 pièces, somme = 144), 4 variantes, et pour chaque variante la liste de **9 outils au plus**.
3. Variante courante = `roster[88 + 15 s + slot]` (octet), remise à 0 si ≥ nombre de variantes (`1058:0000`, `1058:0560` incrémente modulo 4).
4. Chargement d'un morceau (`1028:1774`, appelé à l'entrée, au changement de niveau et de morceau) : Parts Bin = pièces de la variante (toujours la barre `144` pour les niveaux faciles, sinon parfois plusieurs pièces : ex. morceau 30003 `Elephant` démarre avec la cible mais le Parts est `[144]`), Pattern Bin = `-motif`, Fractionator vide, Teletune = nom + recette.

Les variantes d'un même morceau ne changent **ni le motif ni la musique** : elles changent la liste d'outils proposés (les réglages à utiliser pour y arriver ; certains boutons peuvent être des leurres) : ex. `Boogi Woogi` (4 × 1/4) variante 0 : Cutter ×2 seulement ; variante 1 : Cutter ×2, ×4, Gluer 1/8, Melder 1/1 ; variante 2 : Cutter ×2, ×4, Melder 1/4, Melder 1/1.

Outils (`kind`, `param`) de la `PLST` → boutons (`1058:0000`) :

| kind | param | Outil | Boutons (index 0-8) |
|---|---|---|---|
| 2 | `n` (2, 3, 4, 6, 8, 12, 16) | **Cutter** : coupe en `n` parts égales | 0, 1, 2 (premier libre) |
| 3 | `-s` (< 2) | **Gluer** : ne colle que des pièces de taille `s` | 3, 4, 5 |
| 3 | `T` (≥ 2) | **Melder** : fusionne en une pièce de taille `T` | 6, 7, 8 |
| 0 | – | bouton grisé | – |

Les outils sont rangés dans les 3 emplacements de leur famille dans l'ordre de la liste (`DS:76be`/`76c0`, tableau de 9 couples de 4 octets). Un bouton gris (kind 0) est sans effet. Le bouton actif (0 par défaut, `DS:2582`) est choisi par clic ou par les touches `1`-`9` (`1028:2de2`, `0x31`-`0x39`) ; **Tab** passe à l'outil suivant non vide ; un clic sur l'outil courant ne fait rien (`1038:0da3`). Le libellé du bouton (`1028:2c6c`) : Cutter = sprite `0x41` + `n` ; Gluer/Melder = fraction `|param|/144` réduite, écrite `%d\r%d` (numérateur au-dessus du dénominateur).

### 1.4 Déplacer des pièces (glisser-déposer, `1058:0a63`, `1058:0e0d`)

- Un clic dans un des 3 bacs (rappels de groupe `1028:079b` cas 1, 2, 3) prend la pièce sous la souris (`1038:0602` convertit l'abscisse en indice : position en unités = `((x - gauche) × 288 / (largeur - 4)) / 2`, puis premier emplacement dont la somme cumulée dépasse la position). La pièce est retirée (la case devient `-taille`, un fantôme) et suit la souris, clippée au rectangle du bac de destination (`1058:1963`). Son `SND` 30005 (`0x7535`) est joué au départ.
- **Dépôt** (relâchement du bouton) :
  - dans le **Fractionator** : la pièce est insérée au premier emplacement libre (compactage à gauche) ; si le bac ne peut pas l'accueillir elle retourne à sa place (`1058:10f5`) ;
  - dans le **Pattern Bin** : acceptée **seulement si l'emplacement visé contient le fantôme de la même taille** (`75c6[i] == -taille`) ; sinon retour d'où elle vient avec `SND` 30004 (`0x7534`, `1058:10df`) ;
  - dans le **Parts Bin** : elle retrouve son fantôme (`1058:09f1`) ;
  - ailleurs : retour.
- Après tout dépôt (`1028:079b`) : recalcul de la faisabilité de l'outil courant (`1028:3a38`) ; si l'outil est un **Melder** de cible `T > 1` et que la somme du Fractionator dépasse `T`, la dernière pièce est rendue et Algebird commente (`1058:087c`, voir §1.8) ; mise à jour des boutons Undo/Empty/Do It (§1.6) ; test de victoire (§1.7).
- Le **Pattern Bin** peut être rempli depuis le Parts Bin ou le Fractionator indifféremment (l'ordre importe : chaque emplacement impose sa taille). Un clic sur une pièce déjà posée la reprend.

### 1.5 Les trois outils (bouton Do It !, `FUN_1028_0000(3)`, validation `1028:38e3`)

Préconditions communes (`1028:38e3(annonce, …)` ; avec `annonce = 1` le message d'erreur est aussi joué) :

- **Cutter** (kind 2, param `n`) : **exactement une** pièce dans le Fractionator (sinon message type 5). Validité (`1038:0fc4(9, n, taille)`, `1038:0ccd`) : `q = taille / n` (division entière C) ; `|q| < 9` → erreur 3 (« trop petit », plus petit que 1/16) ; `taille ≠ q × n` → erreur 4 (non divisible) ; `q` absent de la table des 30 tailles → erreur 4 ; sinon la pièce est remplacée par `n` pièces de taille `q` (décalage du tableau de 24 cases ; le fantôme correspondant du Parts Bin est découpé de la même façon pour que « Empty » les rende). Exemples : `(n=16, 144)` OK (9) ; `(16, 72)` → erreur 3 (4) ; `(5, 144)` → erreur 4 ; `(8, 144)` OK (18) ; `(3, 72)` OK (24) ; `(7, 144)` → 4.
- **Gluer** (kind 3, param `-s`) : au moins **2** pièces (sinon message 7) et **toutes** de taille `s` (sinon message 6). Résultat : une pièce de taille `somme` (le code ne vérifie pas que `somme` figure dans la table : les données des `PLST` l'évitent, hypothèse).
- **Melder** (kind 3, param `T ≥ 2`) : la **somme** `S` du Fractionator doit être une taille valide ; `S < T` → message 2 (« pas assez ») ; `S > T` → échec silencieux (mais déjà refusé au dépôt, §1.4) ; `S = T` avec ≥ 2 pièces → fusion en une pièce `T` ; `S = T` avec une seule pièce → rien (déjà fait). Les pièces peuvent être de tailles quelconques (ex. 1/4 + 1/8 = 3/8).

Effets visuels/sonores (animations dessinées à la main, boucles d'attente de 30 unités de la minuterie de 4 ms = 120 ms par image : `1028:2eb1`) : coupe `1028:3147` (10 images, `SND` 30002 au début puis `30003`), collage `1028:364e` (18 images, `SND` 30001), fusion = `\0SCR` 20000 de `RHYTHM.DAT` (hook `1028:354a` qui dessine les pièces, `SND` 30000 de 2,2 s). Les outils sont dessinés par `SHAP` 71-106 de `SHPL` 30000 (scie 73-81, pistolet à colle 88-98, etc.). Bouton Do It ! : clignote (bascule toutes les 7 puis 21 ticks de 17 ms, `1028:3a92`) tant que l'opération est faisable (`DS:504c == 1`).

**Empty** (`FUN_1028_0000(4)`, `1058:024a`) : toutes les pièces du Fractionator retournent au Parts Bin (le fantôme `-v` redevient `+v`). **Undo** (cas 5) : restaure le Fractionator depuis `768e` et défait coupe/collage/fusion en ajustant les fantômes du Parts Bin (`1038:0c3b`/`0bf6` = suppression/insertion dans un tableau de 24 cases). Les deux sont grisés si le Fractionator est vide (`1028:2f37`) ; Do It est grisé si l'outil n'est pas applicable (`1028:2ed1`).

### 1.6 Écouter

- **Play Parts** (`FUN_1028_1c54(1)`) : joue le rythme des pièces du Parts Bin dans l'ordre : une impulsion courte (`SND` 30006, 0,08 s) au début de chaque pièce, sur une chronologie en ticks de 4 ms : `ticksParMesure = nbTemps × 15000 / bpm`, début de pièce `i` = `ticksParMesure × (Σ tailles avant i) / 144`. L'impulsion est lancée/arrêtée depuis le rappel 4 ms (`1038:0e95` → `1038:0f87`/`0fb1`) et la pièce active est éclairée. Pas de MIDI (hypothèse : sert de métronome rythmique des seules durées).
- **Play Pattern** (`FUN_1028_1c54(2)`) : joue le MIDI du morceau avec les seuls emplacements remplis (§3.3). Algebird ne danse que si le motif est **complet**.

Les deux boutons sont des demandes différées : le rappel écrit `DS:2584 = 1|2`, et le `Tick` (`1028:15cd`) exécute `1c54` (boucle bloquante jusqu'à la fin ou à un clic/une touche, `1098:04d9`).

### 1.7 Victoire, niveaux, rejouer

- **Victoire** : après tout dépôt dans le Pattern Bin (`1028:079b`, fin), si aucune case de `75c6` n'est négative (`DS:2594 = 1`). Si `DS:2592 == 0` (première fois) : tirage d'une réaction d'Algebird (`DS:1132`, `DS:111a`…), tirage de l'animation finale `DS:4ff6 = [10600, 10700, 10800, 10900, 11000][rand 0-4]` (`DS:115a`, `SCR` de `RHYTHM.DAT`), `DS:2592 = 1`, **compteur de variante +1** (`1058:0560`, modulo 4, sauvegardé), puis `DS:2584 = 2` : le `Tick` joue le morceau complet avec la danse puis l'animation finale (`1028:15cd` : `1028:1c54` puis `1028:3ca6(0, 4ff6)`). Les dépôts ultérieurs sur un motif déjà complet ne recomptent pas (`2592 += 1`).
- **Pas de score, pas de limite d'essais, pas de chronomètre**. Aucun masque de réussite n'est écrit (§6) : le seul « acquis » est la variante suivante.
- **Niveaux** : 3 « Level Brothers » (cas 6, 7, 8 : `style = cas - 6` ; si le style change, tout est remis à zéro et le morceau `slot` du nouveau niveau est chargé : `1028:1774`, puis tirage de chorégraphie `1028:28e0`). 15 morceaux par niveau ; flèches : `slot = (slot ± 1) mod 15` (cas 10/11 : `DS:2590`) ; le morceau courant n'est **pas** sauvegardé (le `slot` revient à 0 à chaque entrée). Le niveau (style) est sauvegardé (§6).
- Difficulté (observée dans les 45 motifs) : niveau 1 : demis/quarts/huitièmes/seizièmes + tiers/sixièmes ; niveau 2 : motifs asymétriques, neuvièmes, 3/8, 3/16 ; niveau 3 : tailles composées (108, 54, 27, 60…), plusieurs Melders.

### 1.8 Réactions d'Algebird et messages d'erreur (`1058:087c`)

`1058:087c(type)` tire une animation de `RHYTHM.DAT` dans une table (`FUN_10a8_13af` = tirage entier) et la joue par `1028:3ca6` (`SCR` + `SNDL` = voix `SND` 187xx, interruptible, flags du descripteur `DS:119e` = 0x1b). Tables (ids de `\0SCR` de `RHYTHM.DAT`) :

| type | Déclencheur | `SCR` |
|---|---|---|
| 1 | changer d'outil en laissant des pièces non fusionnées (`1038:0da3`) | 4800, 4900, 5000, 5100, 5600 |
| 2 | Melder : somme trop petite (`38e3`) | 4400, 4500, 4600, 4700, 6400 |
| 3 | pièce/résultat trop petit ou trop grand : `v = (taille du 1er élément × 10) / param de l'outil` ; `v = 45` → 9800, `60` → 9700, `80` → 9600 ; sinon au hasard | 7100, 7200, 7300, 7400, 11300, 4100 |
| 4 | Cutter : non divisible / résultat hors table | 4000, 4100, 4200, 4300 |
| 5 | Cutter avec plusieurs pièces | 6500, 6600, 6700, 6800, 6900, 7000 |
| 6 | Gluer : pièces de tailles différentes | 5700, 5800, 5900, 6000 |
| 7 | Gluer : une seule pièce | 6100, 6200, 6300, 6400 |
| 8 | (non relevé en appel direct) | 5600, 5100, 5000, 4900, 4800 |
| 9 | (non relevé en appel direct) | 5300, 5400, 5500, 5600, 4900 |
| 10 | sortie (bouton Exit) | 8600, 8700, 8800, 8900, 9000, 9100, 9200, 9300, 7800, 7900, 8000, 8200, 8300, 8400 |
| 11 | clic sur Algebird en mode aide | 8500 (9 voix 18770-18778) |

Clic sur Algebird (hors aide) : réplique au hasard parmi `DS:1132` = 7500, 7700, 8100, 9400, 9500, 11200 (`1028:079b` cas 13). Le cas 3 avec ratio 4,5 / 6 / 8 correspond à une coupe donnant des pièces de 4,5 / 6 / 8 unités (moins de 1/16).

**Bavardage d'attente** : toutes les 120 à 300 ticks de 17 ms (`1028:309c(0)` : `FUN_1018_04e1(0x78012c)` = tirage entre `0x78` et `0x12c`, hypothèse sur le codage de la borne) Algebird joue une courte séquence de poses de `SHPL` 33000 : lignes `DS:1168` (5 mots chacune) `7,8,7,0,0` / `7,9,7,0,0` / `7,10,11,10,7` / `7,12,7,12,7` (clignement, regard…), image suivante après 6 ticks (`1028:2fcc`).

### 1.9 Boutons de sortie et d'aide

- **Exit** (cas 12) : réplique de type 10 puis `1028:173a` : curseur d'attente, `Leave` (`1028:13f7`), fondu vers le noir (`1088:1b25(1,30,236,10,0)`), `1b20 = 0` (retour au hub, engine.md §1.4).
- **Help** (cas 9, `RSHELP.DAT`) : bascule en **mode aide** (`DS:4fde = 1`) : tous les boutons sont désactivés, le curseur devient `?` quand la souris est au-dessus d'une zone d'indice ≥ 3 (`1028:3c6b`/`15cd`), `SND` 3012 ou 3013 (50/50, voix de Poly), animation `SCR` 1100 de `RSHELP` puis la **première fois** (flag sauvegardé `DS:4ff4`) 1800 sinon 1600 (explications générales). `1028:3d71` dessine la **main stop** (`SHAP` 106 de `SHPL` 30000, à (450,388) ou (452,365) selon `DS:8bd4`). Un clic sur la main (zones 1 et 2) sort de l'aide (`SCR` au hasard parmi `DS:111a` = 2700…3600 puis 1200 ; `1028:079b`). Si aucune activité en aide pendant 300 ticks (`DS:4fe2`), Poly relance 1800/1600.
- Zones d'aide (indice de `1028:3c6b`, rects `DS:17d0` + 8 × (i-1), 19 zones) et `SCR` de `RSHELP.DAT` joués (chaque zone enchaîne 2200 « intro commune » + animation propre + 2300 « conclusion commune », chaque étape interrompue par un clic sautant la suite) :

| Zone | Rect | Élément | `SCR` propre |
|---|---|---|---|
| 1, 2 | (435,273,494,432), (418,378,516,425) | main stop (sortir) | 2700-3600 puis 1200 |
| 3 | (205,231,496,274) | Parts Bin | 1900 |
| 4 | (205,305,496,348) | Pattern Bin | 1400 |
| 5 | (194,148,485,191) | Fractionator | 1300 (seule) |
| 6, 7 | (172,232,199,270), (172,306,199,344) | Play Parts / Pattern | 2000 |
| 8 | (282,198,384,227) | Do It! | 2500 |
| 9 | (444,201,499,223) | Empty | 1000 |
| 10 | (172,201,227,223) | Undo | 1700 |
| 11 | (101,197,132,226) | Help | 1500 (seule) |
| 12 | (36,128,147,152) | flèches Teletune | 2400 |
| 13 | (36,28,147,125) | Teletune | 2100 |
| 14 | (192,47,286,101) | Cutter | 3800 |
| 15 | (36,154,147,186) | Level Brothers | 2600 |
| 16 | (55,197,96,226) | Exit | 3700 (seule) |
| 17 | (19,257,166,410) | Algebird | `1058:087c(11)` : 8500 |
| 18 | (290,47,384,101) | Gluer | 3900 |
| 19 | (388,47,482,101) | Melder | 900 |

Les zones d'indice ≥ 3 jouent en plus `1028:3d71` (redessin de la main stop). Le texte parlé de Poly et d'Algebird est uniquement en `SND` (voix) ; aucun texte d'interface n'est affiché hors Teletune.

## 2. Formats

### 2.1 `STLV` (id 30000, 180 octets)

45 enregistrements de 4 octets, big-endian : `u16 idMIDI`, `u16 idPLST`. Ordre = ordre de sélection (niveau 1 : idMIDI 101-115, niveau 2 : 201-215, niveau 3 : 301-315 ; idPLST = 30000 + indice global 0-44). Lecture : `1028:0f99` (`10a8:058c` avec le tag `STLV`, tampon `DS:76e4`, 0xb4 = 180 octets). Adresse d'un morceau : `DS:76e4 + niveau × 0x3c + slot × 4` (`+0` = id MIDI utilisé par `1028:1c54`, `+2` = id `PLST` lu par `1058:0000`). Les noms sont dans `STRL` 30001 (45 chaînes, même ordre) :

| Niv. 1 | Niv. 2 | Niv. 3 |
|---|---|---|
| Fanfare, Tango, Boogi Woogi, Elephant, Spys, Polka, Funk, Merengue, Techno, Bach, Waltz, Soap, Scots, Appalaic, Swan | Pompadoo, Mosmode, Bebop, OrangaTango, Shop Hop, Montuno, Gyroscope, Machito, Soulsa, Falsreel, Beethoven, Slinky, Flamingo, Parlour, Cricket | Gospel, The Biz, Nuage, Mars, Veda, del Jardin, Star ratS, African, Schumann, Rave, Fanfoul, Magical, Lilt, Mexico, Doodlydoo |

Motifs cibles (en unités 1/144, ordre des emplacements `a`, `b`, `c`…), tempo et mesure du MIDI : 0 Fanfare `72,72` (170 bpm, 4/4) ; 1 Tango `72,36,36` (130) ; 2 Boogi Woogi `36×4` (170) ; 3 Elephant `72,36,18,18` (140) ; 4 Spys `36,36,18×4` (123) ; 5 Polka `18×8` (125) ; 6 Funk `36,36,18,18,18,9,9` (113) ; 7 Merengue `36,36,36,9×4` (130) ; 8 Techno `72,36,18,9,9` (115) ; 9 Bach `9×16` (110) ; 10 Waltz `48×3` (160, 3/4) ; 11 Soap `48,48,24,24` (130, 3/4) ; 12 Scots `24×6` (120, 3/4) ; 13 Appalaic `48,24,48,12,12` (105, 3/4) ; 14 Swan `24,12,12,24,24,12,12,24` (80, 3/4) ; 15 Pompadoo `36,72,36` (83) ; 16 Mosmode `18,36,18,36,36` (115) ; 17 Bebop `18,36,18,18,36,18` (120) ; 18 OrangaTango `54,18,36,36` (100) ; 19 Shop Hop `36,18,9,18,9,18,36` (109) ; 20 Montuno `18,9,18,18,18,18,9,18,18` (90) ; 21 Gyroscope `18,9,18,9,18,9,18,9,18,18` (90) ; 22 Machito `27,27,36,18,36` (120) ; 23 Soulsa `27,27,18,54,18` (136) ; 24 Falsreel `48,24,48,24` (176, 3/4) ; 25 Beethoven `24,24,24,72` (155) ; 26 Slinky `72,36,24,12` (113) ; 27 Flamingo `36,24,12,36,12,12,12` (107) ; 28 Parlour `12,24,24,12,36,36` (105) ; 29 Cricket `24,12,12,12,12,24,12,24,12` (90, 3/4) ; 30 Gospel `108,36` (128) ; 31 The Biz `24,24,36,24,36` (90, 3/4) ; 32 Nuage `36,24,12,48,24` (122, 6/4) ; 33 Mars `36,72,9,18,9` (107) ; 34 Veda `36,27,27,18,36` (80) ; 35 del Jardin `36,18,36,18,18,18` (133) ; 36 Star ratS `54,36,54` (113) ; 37 African `24,12,12,24,24,24,24` (115) ; 38 Schumann `48,48,36,12` (110, 3/4) ; 39 Rave `27,27,27,27,18,18` (120) ; 40 Fanfoul `108,18,9,9` (113) ; 41 Magical `54,54,18,9,9` (134) ; 42 Lilt `27,27,18,36,36` (125) ; 43 Mexico `54,54,12,12,12` (120) ; 44 Doodlydoo `24,24,24,60,12` (128, 3/4).
Mesure : 4/4 sauf 3/4 (indices 10-14, 24, 29, 31, 38, 44) et 6/4 (indice 32, Nuage, numérateur 6).

### 2.2 `PLST` (id 30000 + k, 386 octets, big-endian, 45 ressources)

| Mots (u16) | Contenu |
|---|---|
| 0-23 | **motif cible** : tailles des pièces (somme 144), complété par 0 |
| 24 | **nombre de variantes** `N` (4 dans les 45 ressources) |
| 25 + 42 j + 0..23 | variante `j` : **pièces du Parts Bin** (toujours `[144]` dans les 45 ressources, hypothèse sur la généralité du format) |
| 25 + 42 j + 24 + 2 m, +1 | outil `m` (0-8) : `u16 kind`, `i16 param` (voir §1.3) |

Taille `50 + 84 N = 386` ✓. Lecture : `1058:0000` (`DS:7656 = -motif`, `DS:7626 = parts`, outils → `DS:76be/76c0`). Exemple `PLST` 30002 (Boogi Woogi, `36×4`) variante 1 : parts `[144]`, outils `(2,2) (2,4) (3,-18) (3,144)`. Le champ `kind` vaut 0 (inutilisé), 2 ou 3. Les **dix-huit octets d'outils par variante couvrent 9 couples** (dont des couples `(0,0)` de remplissage). L'ordre des couples dans la liste n'est pas l'ordre des boutons : `1058:0000` les range par famille (§1.3).

### 2.3 Bloc `Prg#` du MIDI Mohawk

`Prg#` (après `MThd`, taille u32 big-endian = 22 pour Fanfare) : `u16 n` puis `n` couples `u16 programme GM`, `u16 masque de canaux` (bit `c` = le canal MIDI `c` utilise ce programme). Vérifié sur Fanfare : `(0, 0x200) (32, 0x2) (47, 0x1) (56, 0x14) (63, 0x8)` ↔ `Program Change` du fichier `c0 2f`, `c1 20`, `c2 38`, `c3 3f`, `c4 38`, `c9 00` (canal 9 = batterie, masque 0x200 sur le programme 0). C'est la structure `PATCHARRAY` de `midiOutCachePatches` (une entrée par programme, un bit par canal) : le jeu **précharge les timbres** utilisés avant la lecture sur les cartes à mémoire d'échantillons (appels `MIDIOUTCACHEPATCHES`/`MIDIOUTCACHEDRUMPATCHES` de `10d0:12e0`, `12f9`, `13e6`, `1133`, `114c`, `1239`). Hypothèse : le bloc est lu par le pilote `10d0` (aucune constante `Prg#` dans le code, il est reconnu par sa position/taille). **Inutile en navigateur** (le synthé n'a pas de cache de patchs) ; il reste utile pour **précharger les échantillons d'un soundfont** par morceau.

### 2.4 `MIDIMAP.DAT` (`SYSX` id 1, 192 octets)

64 messages courts (3 octets) = 4 groupes de 16 canaux : `Bn 79 00` (reset all controllers), `Bn 07 7F` (volume 127), `Bn 0B 5A` (expression 90), `Bn 0A 40` (pan centre). Envoyés à l'ouverture de la sortie MIDI (`10d0:1a78` charge la ressource, `10d0:1be5`/`1404` l'envoient). Pour le navigateur : à l'ouverture d'une lecture, mettre sur chaque canal CC7 = 127, CC11 = 90, CC10 = 64.

### 2.5 Fichiers MIDI du morceau (`MIDIMPC.DAT`, 45 `\0SND`)

MThd format 0, division 480 (0x1E0), un `MTrk`. Contenu relevé sur les 45 : méta `FF 03` (nom `101Fanfare.mff`), `FF 54` (SMPTE offset, ignoré), `FF 58` (mesure, ex. `04 02 18 08`), `FF 51` (tempo ; **un seul** par fichier, 80 à 176 bpm), `FF 07` (**Cue Point**, les marqueurs) ; événements : Program Change (78 programmes GM distincts : 0-7, 10-12, 15-18, 20-29, 32, 33, 35, 36, 38-43, 45, 47, 48, 52, 53, 55-63, 65-73, 75-80, 94, 95, 102, 104-110, 112, 114-116), Note On/Off (15 931 notes, canaux 0-11 et 15, canal 9 batterie avec 40 touches 35-87), Control Change (CC 93 chorus ×234, CC 1 ×43, CC 10 ×10, CC 91 ×3 seulement), **Pitch Bend ×367**, aucun SysEx, aucun tempo variable. 2 à 9 canaux sonnent par morceau. Les 5 octets `FF 07 01 xx` : `xx` = `'a'`…`'x'` (indice d'emplacement du Pattern Bin, 24 max) ou `'1'`…`'8'` (temps de la mesure). Marqueurs posés à chaque début de pièce (lettre) et à chaque temps (chiffre, ex. ticks 0, 479, 959, 1439 pour 4 temps de 480 ticks, chiffre à `+479`).

## 3. Moteur musical

### 3.1 Appareils et chargement (`1028:0f99`, `1028:273a`, `10d0:0ead`)

- `Enter` ouvre `MidiMPC.DAT` (`DS:505c`), `RHYTHM.DAT` (`5058`, archive courante) et `RSHELP.DAT` (`5060`) ; précharge **14 `SND` de `RHYTHM.DAT`** par `1088:1125` (3008, 3009, 3010, 3012, 3013, 3030, 3031, 3032, 3047 et 30001-30005, libérés par `1088:134a` dans `Leave`), charge `STRL` 30001 (`DS:5064`) et le `SND` 30006 (`DS:5068`, l'impulsion de 0,08 s) dont `10d0:0ead` fait un **appareil WAVE dédié** (`DS:77c5`) ; ces objets s'ajoutent aux « 1 WAVE + 1 MIDI » du moteur (engine.md §6) : c'est le « mixage » du Rhythm Shop (confirmation de l'hypothèse de l'engine.md).
- `1028:273a(complet, tampon, idMIDI)` (lecture du morceau) : `10c0:086e/0aac` trouve et verrouille le `SND` dans l'archive **courante** (alors `MidiMPC.DAT`) ; vérifie `MHWK`…`MIDI` (`0x4d494449`) ; **modifie la copie en mémoire** (§3.3) ; `1058:16e8` lit le tempo ; `10d0:0ead` crée l'appareil MIDI ; `10d0:0676`/`0819` (arrêt / test de lecture) ; la lecture démarre par `10d0:0979` (`1028:1c54`), pause `10d0:0a59`, arrêt `10d0:0a05`, libération `10d0:0116`.

### 3.2 Appel de retour pour les marqueurs (`1028:26b0`)

Le séquenceur logiciel (`10d0:2ae4`, `2c06`, `2d02`, `2e02`, minuterie `timeSetEvent`, engine.md §6) appelle `1028:26b0` à chaque événement texte/fin (le segment `1028` est verrouillé en mémoire pour cela : `1098:08be` = `GlobalPageLock`, déverrouillé dans `Leave` par `1098:08cd`). Type du message (`*param_3`) :

| Type | Effet |
|---|---|
| 0 (texte) | si le 1er caractère est `'a'`-`'z'` → `DS:5082 = lettre` (emplacement) ; si `'1'`-`'8'` → `DS:5083 = chiffre` (temps de la mesure) |
| 1 | `DS:5082 = 0xFF` (fin de séquence → la boucle de `1c54` s'arrête) |
| 4 / 5 | `DS:5084 = 1 / 0` (début/fin d'état, usage non établi) |

La boucle de `1028:1c54` (mode 2) consomme `5082` : lettre `a` + `n` → éclaire le sprite de la pièce de l'emplacement `n` (surbrillance par `FUN_10d8_3211`, rects `DS:79a3 + 8n`, restauration de la précédente) et, si le motif est complet, **avance la danse** (`1028:2ab4`, §3.5). Le temps de la mesure (`5083`) fait avancer le curseur de l'indicateur de temps (sprite 7/0x3e de `SHPL` 33000, `DS:502a`). Toutes les 25 itérations la boucle teste une interruption (`1098:04d9`).

### 3.3 Réécriture du MIDI avant lecture (`1058:125e`)

Entrées : `flags[24]` (1 si `75c6[i] > 0`, c.-à-d. emplacement rempli), tampon MIDI. Algorithme (octet par octet, sans parseur général) :

1. Vérifie `MThd` (`0x4d546864`), format 0 (`mot == 0`), cherche `MTrk` (`0x4d54726b`), saute l'en-tête de 8 octets.
2. Cherche le **premier** `FF 07 01 61` (cue `a`) et le premier `FF 07 01 31` (cue `1`) ; prend le plus tardif des deux `+ 4` ; cherche à partir de là le **2e** `a` et le 2e `1` ; coupe la piste au plus proche des deux en écrivant `FF 2F 00 00` (fin de piste). Résultat : **une seule mesure** (de la 1re à la 2e apparition du marqueur de début de mesure : tick 0 → tick 1920 en 4/4) est jouée.
3. Parcourt la mesure : à chaque `FF 07 …` dont la donnée est une lettre `a`-`x`, mémorise l'**emplacement courant** `i = lettre - 'a'` (borné à 0-23) ; à chaque **Note On** (`0x9n`) dont `flags[i] == 0`, met la **vélocité à 0** (note muette). Les Note Off (`0x8n`) sont sautés ; les autres événements courants (`Cn`, `Bn`, `En`…) sont avancés heuristiquement (1 octet de données + delta nul).
4. Le MIDI en mémoire ainsi modifié est lu une seule fois (pas de boucle : le jeu laisse le motif complet se terminer, puis l'animation finale).

Conséquence : **on peut jouer un motif partiellement rempli** (seules les pièces posées sonnent, batterie et basse comprises car elles suivent aussi les lettres) ; l'ordre des emplacements = l'ordre temporel. Piège : sans `flags` à 1 pour l'emplacement visé, la note est lue avec vélocité 0 (silence) mais l'événement subsiste (durées inchangées).

### 3.4 Tempo (`1058:16e8`)

Cherche `FF 51 03` (`FUN_1058_1504` avec la valeur 16 bits `0xff51`), lit les 3 octets `µs/noire`, calcule `bpm = 60 000 000 / µs` (**entier**, par défaut 170 = `0xaa` si absent) ; garde dans `DS:1fe8` le bpm de base au premier chargement du morceau (`DS:2594 == 0`) et **réécrit** les 3 octets avec `60 000 000 / DS:1fe8` (identité à l'arrondi près : ex. 130 bpm → 461 538 µs au lieu de 461 538,46 ; un bpm non entier est ainsi arrondi). Le numérateur de mesure (`FF 58` : octet suivant ; `1058:16e8` second appel `FUN_1058_1504`, champ `*param_1`) devient `DS:258c` : 3, 4 ou 6 (sinon 4) ; `DS:2588` = bpm. Unités de temps du jeu pour `Play Parts` et la danse (minuterie de 4 ms, `1038:0543` = `timeSetEvent(4 ms)` + `GlobalPageLock`) :

- `ticksParTemps = 15000 / bpm` (170 bpm → 88) ; `ticksParMesure = nbTemps × 15000 / bpm` (170, 4/4 → 352) ; `ticksParSeizième = 15000 / (4 × bpm)` (→ 22) (`DS:14f6 = 4` seizièmes par temps) ;
- `pas de danse par mesure = clamp(nbTemps × 4, 4, 24)` (3/4 → 12, 4/4 → 16, 6/4 → 24).

### 3.5 Danse d'Algebird (`1028:28e0`, `1028:2ab4`, `1028:2c32`)

- **Chorégraphie** (tirée à chaque chargement de morceau, `1028:28e0`) : `DS:5044 = 4 × rand(1…3)` mesures (4, 8 ou 12) ; pour chaque mesure une **famille de pose** `0-4` (5 si bpm ≥ 110 et 1 chance sur 2) tirée au hasard, jamais trois fois la même d'affilée et, pour la dernière mesure, ≠ la première ; puis chaque mesure peut recevoir un **pas spécial** `1-14` si le couple `(pose, pose suivante)` figure dans la table `DS:136e`/`138a` (14 couples, 33 % de chance de ne pas l'appliquer pour les trois premiers, toujours après) ; `DS:5038[mesure] = n` (0 = pas normal).
- **Pas normal** (`1028:2ab4(mesure)`) : table `DS:11de` = 5 × 5 lignes de 8 mots `[depuis, f1, f2, f3, f4, f5, f6, vers]` (indices de poses de `SHPL` 31000, 174 formes : 1-174) ; remplit `DS:4ff8[0…n-1]` (n = pas par mesure, 4-24) : pas 0-1 = `f1, f2` (ou `f3, f4` si la mesure précédente est de même famille), pas 2…n-3 = `f3…f6` en boucle (période 4), 2 derniers = `f1, f2` ou `f5, f6` (selon que la famille ne change pas). **Pas spécial** : `DS:13a6 + 24 n` = 12 mots de pose (`1028:2c32`, 12 pas de la mesure).
- À chaque cue `a`-`x` de la mesure, `1028:261d` dessine la pose `DS:502c[mesure]`+1 de `SHPL` 33000 (7 = neutre) dans le rect Algebird, avec attente `1028:2eb1`.
- **Hypothèse** : la table de 3 entrées `DS:2aa2` (comparée à `DS:258c` au début de `1028:28e0`) est un reliquat (valeurs `0xFFFF0000`) sans effet.

Remarque d'implémentation : le détail de la danse (lissage, enchaînement exact des poses) est de la mise en scène ; on peut le simplifier (animer les `SHPL` 31000/33000 en suivant les cues des temps).

### 3.6 Ce qu'il faut côté navigateur, et le synthé d'Indy

`src/games/indy/audio/midi.ts` (`parseMidi`, ~117 lignes) : lit un MIDI standard en liste de notes absolues (temps, durée, touche, vélocité, canal, programme) ; ignore Control Change, **Pitch Bend** (367 événements ici), les marqueurs et le Note-On de vélocité 0 est traité comme Note-Off. `audio.ts` (`synthesize`) : un oscillateur par note (`triangle` si programme < 8, `square` si < 48, sinon `sawtooth`), **toute la batterie** (canal 9) = un bruit blanc de 0,12 s, enveloppe fixe ; pas d'instruments distincts, pas de pitch bend ni de CC, pas de volume par canal, pas de boucle ni de callbacks. Évaluation :

| Besoin du Rhythm Shop | Indy synthé | Verdict |
|---|---|---|
| marqueurs `Cue` (lettres/chiffres) | non lus | à ajouter (facile) |
| silence par emplacement | non | à ajouter (muter les notes d'un emplacement) |
| tempo, mesure | tempo oui, mesure non | ok / ajouter |
| 78 programmes GM distincts | 3 timbres | **insuffisant** |
| batterie GM (40 touches : kick, caisse claire, charleys, toms, cymbales, percussions latines) | un seul bruit | **insuffisant** (le caractère du morceau est dans le rythme) |
| pitch bend (367) | non | à ajouter (détune de l'oscillateur) |
| CC 7/10/11 (init `SYSX`), 93/91/1 | non | volume/pan/expression à ajouter ; chorus/reverb optionnels |
| précision de synchronisation (animation sur marqueurs) | planification Web Audio absolue | bonne base : planifier aussi les marqueurs au même horloge `AudioContext` |

Recommandation : (a) **séquenceur propre** (module TS testable : liste d'événements triée, marqueurs, mute par emplacement, horloge `AudioContext`) ; (b) synthé : au minimum un **synthé GM maison** (une quinzaine de familles de timbres + batterie synthétisée par touche) ; qualité fidèle seulement avec un **soundfont GM** et une bibliothèque de synthèse (nouvelle dépendance + fichier de 1-30 Mo à fournir : **décision utilisatrice**, ni installée ni téléchargée ici). Le CD d'origine s'appuyait sur le pilote GM de la carte (Roland SC-55 type) ; le rendu de référence est donc « General MIDI ». `Prg#` permet de ne charger que les programmes d'un morceau.

## 4. Mise en page, sprites, scripts d'animation

### 4.1 Ressources de `RHYTHM.DAT` (tags : `\0SCR` 76, `\0SND` 134, `PLST` 45, `SHAP` 1362, `SHPL` 80, `SNDL` 76, `STLV` 1, `STRL` 1)

| `SHPL` | Formes | Contenu |
|---|---|---|
| 30000 | 106 (`SHAP` 30000-30105) | 1 fond plein écran 576 × 432 (le meuble Fractionaire 2000, la télé du Teletune, 3 boutons CUT IT / GLUE IT / MELD IT avec leurs icônes) ; 2-31 les 30 pièces ; 32-61 les 30 fantômes (vert) ; 62 coin de fond (redessin) ; 63-66 voyants vert/gris ; 67 filet ; 68 écran Teletune vide ; 69-70 tampons de bacs ; 71-106 animations d'outils (scie 73-81, colle 88-98, fusion 99-105), 106 main stop |
| 31000 | 174 | poses d'Algebird (danse) |
| 32000 | 29 | 14 pavés de boutons (états des gadgets, tuiles de 100 × 27 et 37 × 28) |
| 33000 | 15 | poses d'Algebird (attente, parole, 7 = neutre) |
| 4000-11300 par 100 | 6-27 | une `SHPL` par animation de réaction (même id que le `\0SCR`) |
| 20000 | 20 | animation de fusion ; 21000 : 32 formes, animation d'entrée |

La palette de l'écran = `SHPL` 999 de `RSHELP.DAT` (0 forme, entrées de palette seules ; chargée par `10a8:0640`, `1028:0f99`) puis les palettes des `SHPL` ci-dessus. `RSHELP.DAT` : 31 `SCR` (900-3900) avec leurs `SHPL` (Poly en 5 à 25 poses), 82 voix `SND` (18061, 18332, 18382, 18600-18671, 19023-19028, 19540, 19541).

### 4.2 Descripteurs d'animation (`DS`) et déclencheurs

| Descripteur | `SCR` | Drapeaux | Usage |
|---|---|---|---|
| `DS:119e` | dynamique (`DS:11a2`, table §1.8) | 0x1b | réactions d'Algebird (`1028:3ca6`) ; zone d'effet = (`DS:11d6…`) |
| `DS:11aa` | 20000 | 0x13 | fusion (hook `1028:354a` posé à `+0x236`) |
| `DS:11b6` | 21000 | 0x1f | **animation d'entrée** (fondu d'entrée puis `1090:0ff9`) ; `SNDL` 21000 = `SND` 13100 (6 s) |
| `DS:11c2` | dynamique (`DS:11c6`, `RSHELP`) | 0x13 (+bit 3 si interruptible) | animations d'aide (`1028:3b34`) |

Flags : engine.md §3.5 (bit 0 sauvegarde du fond, 1 ne pas arrêter le MIDI, 3 interruptible, 4 attendre les sons).

### 4.3 Séquence d'`Enter` (`1028:0f99`)

Initialise les variables (`DS:2592 = 0`, `4fe0 = 1`, `4fe2 = 0`, `4fe6 = 0`, `504c = 0`, `504a = 1`, `5052 = 0`, `5048 = 0`, `7688 = 0`, `768a = 0`) ; boutons Do It/Undo/Empty désactivés (`16b2`, `16c6`, `16da |= 2`) ; ouvre les 3 archives ; précharge les sons ; charge `STRL` 30001, `SND` 30006 et l'appareil WAVE ; crée les ports (`10a8:0eb8`) ; `STLV` ; `SHPL` 30000, 999 (palette), 33000, 31000, 32000 ; dessine le fond (`10a8:0ce4`) ; **charge le morceau 0 du niveau mémorisé** (`1028:1774` : `PLST`, Teletune ; `1028:28e0` : chorégraphie) ; dessine les 3 bacs (`1058:0592` modes 0, 1, 2) ; installe les groupes de boutons (`10a0:0000`, `10a0:1dd4`, `10a0:0d4d`) ; arrête tous les MIDI ; fondu (`1088:1b25(1,30,236,10,palette)`) ; joue `SCR` 21000 ; `DS:155c = 1`, minuterie d'attente (`1028:309c(0)`), `DS:155e = DS:11d0 = 1`.

### 4.4 `Tick` (`1028:15cd`)

Boucle d'une itération : (a) si aucune lecture demandée → bavardage (`1028:2fcc`) + clignotement de Do It (`1028:3a92`) ; (b) si `DS:2584 ∈ {1,2}` : `1028:308a` (finit le bavardage), `1028:1c54(2584)`, réaction finale (`4ff6`) ; (c) en mode aide : curseur `?` si la zone survolée est d'indice ≥ 3, retour auto après 300 ticks d'inactivité (`DS:4fe2 + 300 < DS:8722`).

## 5. Sons

| `SND` | Durée | Rôle |
|---|---|---|
| 3008, 3009, 3010 | 0,7-0,85 s | voix courtes (parole de Poly/Algebird : bruitages ; table `DS:1770` : 3030, 3010, 3008, 3009, 3012, 3047) |
| 3012, 3013 | 0,8 / 1,1 s | `Help` : phrase d'invite de Poly (`DS:1788` = 3013 si tirage < 51, sinon 3012 : `1028:0000` cas 9) |
| 3030, 3047 | 0,19 s | clic de bouton |
| 3031, 3032 | 0,02 s | clic de bac / sélection : `0xbd7` (3031) = clic Do It/Empty/Undo (`1028:0000` cas 3, 4, 5, début), `0xbd8` (3032) = choix d'un outil (`1028:0e12`) |
| 30000 | 2,2 s | fusion (animation `SCR` 20000) |
| 30001 | 1,0 s | collage (`1028:364e`) |
| 30002, 30003 | 1,8 / 1,1 s | coupe (début, fin ; `1028:3147`) |
| 30004 | 0,02 s | dépôt refusé |
| 30005 | 0,07 s | prise d'une pièce |
| 30006 | 0,08 s | impulsion de Play Parts (appareil WAVE dédié) |
| 13100 | 6,0 s | voix d'ouverture (`SCR` 21000) |
| 18700-18826 | 0,4-3,4 s | voix d'Algebird des `SCR` 4000-11300 (liste `SNDL` de même id, 1 à 9 sons ; ex. 8500 → 18770-18778) |
| `RSHELP` 18061…19541 | | voix de Poly (aide) |

Format : WAVE PCM 8 bits non signé 11 025 Hz (formats.md). Les voix sont synchronisées par les `\0SCR` (opcode `SND_PLAY`) ; aucun `Cue#` n'est lu. Jouer un son : `1088:1498(canal, '\0SND', id)` ; pour les voix des réactions, `1090:111c` attend la fin si le flag bit 4 est posé.

## 6. Progression et roster

Variables enregistrées (`1050:0000`, 3 variables ; engine.md §7.1, offsets dans l'enregistrement du joueur, big-endian) :

| Offset | Variable (DS) | Contenu |
|---|---|---|
| 88 | `7798` × 45 u8 | **compteur de variante** (0-3) par morceau : `3 niveaux × 15 + slot` ; remis à 0 si ≥ nombre de variantes ; +1 modulo 4 à chaque première victoire du morceau |
| 133 | `76e2` u16 | niveau (style) courant 0-2 (`Level Brothers`) |
| 135 | `4ff4` u16 | indicateur « présentation de l'aide déjà vue » (1 après la 1re ouverture de l'aide) |

Les 3 variables sont lues/écrites par le mécanisme standard à l'entrée/sortie de la scène (`DS:11d0 = 1` → `1050:0302` dans `Leave`). **Écart avec engine.md §7.1** : `7798` n'est pas « l'indice de séquence PLST choisie » mais le numéro de variante dans la `PLST` ; `4ff4` = drapeau d'aide. `76e2` ≥ 3 n'est pas validé (hypothèse : valeurs 0-2 uniquement). Le morceau courant (`DS:2590`) n'est **pas** sauvegardé. Aucun bit du masque de réussites (30 bits, bowling) n'est touché ; le Hall of Fame ne montre pas le Rhythm Shop. Aucun joueur → le hub demande d'abord la connexion (engine.md §1.5), donc la progression est par joueur (`1108:1e90`).

## 7. Différences avec le manuel de 1997 (v2)

| Manuel 1997 | Code v1 (cette étude) |
|---|---|
| « Level 2 in the Control Room » (étage) | hub à un seul écran (engine.md §8.1) : zone n° 7 du hub → scène 2 |
| Bouton **Demo** (« shows you how to make fractions ») | aucune trace dans `1028` (les 19 zones/boutons ne le contiennent pas) ; l'aide est faite d'animations de Poly (hypothèse : le Demo de 1997 remplace/étend l'aide) |
| Tuning Arrows, Level Brothers, Teletune `Fanfare (2) 1/2 bars`, Whole Bar, Cutter/Gluer/Melder, Do It! qui clignote, Undo « tant que les pièces sont dans le Fractionator », Empty, Play Parts, Play Pattern, Algebird qui danse | tous présents et vérifiés (Undo : `DS:768e` n'existe que tant que le Fractionator n'a pas été vidé : hypothèse) |
| Melder : exemple 1/4 + 1/8 = 3/8 (lecture douteuse du scan) | cohérent avec le code : 36 + 18 = 54 = 3/8 est dans la table |
| Gluer réglé sur 1/2 | param `-72` (oui) |
| Cutter « 2 Cutter cuts into two equal pieces » | ✓ ; les réglages 2, 3, 4, 6, 8, 12, 16 existent |
| Fractions « 45 morceaux » non citées | 3 × 15 ; 4 variantes par morceau (non documentées) |

## 8. Plan d'implémentation TS

### 8.1 Modules

```
src/games/mathemagique/rhythm/
  pieces.ts      // tailles valides, fractions, sprite idx, plafond 144
  logic.ts       // état pur : Parts/Pattern/Fractionator (tableaux de 24), opérations, validation, victoire
  songs.ts       // STLV + PLST + STRL + MIDI id ; variantes ; recette Teletune
  sequencer.ts   // patch MIDI (§3.3), cues, tempo, planification (horloge injectée)
  dance.ts       // chorégraphie pure (RNG injecté) + tables DS:11de/136e/13a6 (à extraire de MATH)
  scene.ts       // machine à états de la scène (entrée, jeu, glisser, lecture, aide, sortie)
```

- **Pur et testable** (`pieces.ts`, `logic.ts`, `songs.ts`, `dance.ts`, patch de `sequencer.ts`) : aucune dépendance DOM/audio ; RNG injectable (le jeu appelle `1018:04e1`).
- **Services moteur nécessaires** : (1) lecteur `\0SCR` + `SHPL`/`SHAP` (déjà décrit dans engine.md/scr.md) pour fond, réactions, danse, animations d'outils (certaines sont codées en dur : coupe `1028:3147`, collage `1028:364e`, fusion = `SCR` 20000 + hook) ; (2) bus audio : voix WAVE (`wave.ts`), appareil impulsion, **séquenceur MIDI** (§3.3/3.6) ; (3) gadgets/boutons (`10a0`) : 12 boutons + états + clavier Tab/Entrée ; (4) roster (`MWRoster` offsets 88/133/135) ; (5) curseur `?`.
- **Machine à états de scène** : `entering` (fondu + `SCR` 21000) → `idle` (bavardage, clic → prise de pièce ou bouton) ↔ `dragging(piece, origine)` ↔ `playing(parts|pattern)` (bloquant, interruptible par clic/touche) ↔ `animating(coupe|collage|fusion|réaction)` (bloquant, 120 ms/image) ↔ `help` (clic zone → animations RSHELP, main stop pour sortir) → `exiting` (réplique + fondu → hub). Le bloquage des vieilles boucles `1090:111c` se traduit par des états sans entrée (sauf interruption).
- **Logique pure** (signatures indicatives) : `applyCut(frac, n)`, `applyGlue(frac, size)`, `applyMeld(frac, target)` → `{ok, error?, nextState}` ; `canDrop(pattern, slot, size)` ; `isComplete(pattern)` ; `songRecipe(pattern)` ; `nextVariant(counter, count)` ; `parsePlst`, `parseStlv`.

### 8.2 Tests unitaires (valeurs issues du code et des données)

1. **Tailles/fractions** : `validSizes` = les 30 valeurs du §1.2 ; `reduce(54) = 3/8`, `reduce(16) = 1/9`, `reduce(144) = 1/1`, `reduce(9) = 1/16` ; `spriteIndex(144) = 2`, `(72) = 3`, `(9) = 24`, `(135) = 31`, `(7) = 0` ; fantôme `+30`.
2. **Coupe** : `checkCut(16,144)` = ok (9) ; `(16,72)` = erreur 3 ; `(5,144)` = erreur 4 ; `(8,144)` = ok (18) ; `(3,72)` = ok (24) ; `(7,144)` = erreur 4 ; `(2, 9)` = erreur 3 (`4 < 9`). Message 3 : ratio `10 × taille / n` = 45 pour `(16, 72)` → `SCR` 9800.
3. **Collage** : 1 pièce → erreur 7 ; `[18, 36]` avec Gluer `-18` → erreur 6 ; `[18,18]` → `[36]`. **Fusion** : `[36, 18]` Melder `54` → `[54]` ; `[18]` Melder `54` → erreur 2 ; `[72]` Melder `54` au dépôt → rendue ; `[72]` Melder `72` → inchangé.
4. **Ghosts** : couper `[144]` en 4 : Parts `[-144]` → après « Empty » `[144]` (`[144]` découpé en fantômes `-36×4` restitués : voir `1038:0ccd`).
5. **`parseStlv`** : 45 couples ; indice 0 → `(101, 30000)`, 14 → `(115, 30014)`, 15 → `(201, 30015)`, 44 → `(315, 30044)`. **`parsePlst(30000)`** : motif `[72,72]`, 4 variantes, outils variante 0 `(2,2) (3,144)`. **PLST 30002** : motif `[36,36,36,36]`, variante 1 outils `(2,2) (2,4) (3,-18) (3,144)`. Taille d'une `PLST` = 386.
6. **Teletune** : `recipe([72,36,36])` = `["(1) 1/2 bar", "(2) 1/4 bars"]` (tri décroissant, groupes de tailles égales) ; `recipe(Fanfare) = ["(2) 1/2 bars"]` ; `recipe(Doodlydoo [24,24,24,60,12]) = ["(1) 5/12 bar", "(3) 1/6 bars", "(1) 1/12 bar"]`.
7. **Placement** : `slotAt(x)` : `pos = ((x - gauche) × 288 / (largeur - 4)) / 2` : coder avec les rects `DS:1560/1574/1588` ; `canDrop` : un 1/8 (18) ne va pas sur un emplacement `-36`.
8. **Variante** : `nextVariant(3, 4) = 0` ; `nextVariant(1, 4) = 2` ; si le compteur sauvegardé ≥ nombre de variantes → 0.
9. **Patch MIDI** (`sequencer.ts`, avec `MIDIMPC` 101 s'il est présent) : une seule mesure conservée (fin de piste à 1920 ticks) ; avec Pattern `[a rempli, b vide]` : toutes les notes dont l'emplacement courant est `b` (cue `b` à tick 959) ont une vélocité 0 ; `Prg#` Fanfare = `{0:0x200, 32:2, 47:1, 56:0x14, 63:8}` ; tempo 170 bpm ; mesure 4/4.
10. **Temps** : `ticksParMesure(170, 4) = 352` ; `ticksParTemps(170) = 88` ; `ticksParSeizième(170) = 22` ; `pas de danse(3) = 12`, `(4) = 16`, `(6) = 24` ; début de pièce `i` de Tango à 130 bpm : `15000 / 130 = 115` ticks/temps, mesure 461.
11. **Danse (pur, RNG fixe)** : pas de 3 familles consécutives identiques ; 4, 8 ou 12 mesures.
12. **SYSX** : 64 messages, 16 par groupe `121/7/11/10` avec valeurs `0/127/90/64`.

## 9. Questions ouvertes

1. **Algorithme exact de la lecture MIDI** (`10d0:2ae4…`, `1000:47e8`/`4a75`/`4b99`) : événements texte vs boucle ; message de type 4/5 de `1028:26b0` ; comportement si on interrompt. Non lu à l'octet (séquenceur partagé avec le reste du moteur).
2. **Play Parts** (`1028:1c54` mode 1) : rôle exact de `DS:5083`, des 4 répétitions (`DS:7b47`) et de l'accélération (`>> 4`) ; durée audible de l'impulsion par pièce.
3. **Type 3, 8, 9 de `1058:087c`** : arguments perdus par Ghidra dans `1028:079b` (cas du Melder trop grand) ; qui appelle 8 et 9 (0 appel direct trouvé).
4. **Existence d'un « Demo »** en v1 (manuel 1997 : oui ; code : non) ; rôle de la zone 1/2 (main stop) vs bouton Help.
5. **Table `DS:2aa2`** (3 entrées) et pas spéciaux de danse (poses exactes) : mise en scène seulement.
6. **Gluer : validation de la somme** (non testée dans `38e3`) ; comportement si somme ≥ 145 (tableaux de 24 cases seulement ; non rencontré dans les `PLST`).
7. **`Prg#`** : lu par `10d0` ? (aucune constante `Prg#`, hypothèse : relu par offset).
8. **Soundfont GM** : fichier et bibliothèque à choisir (décision utilisatrice, dépendance).
9. **Copie (texte)** : tout le texte d'interface du Rhythm Shop est dessiné dans les `SHAP` ; seuls les noms de morceaux (`STRL` 30001, 45 chaînes en anglais) et le format `(%d) %d/%d %s` + `bar`/`bars` sont des chaînes : si on traduit ou réécrit, la copie est **« à valider »** (règle utilisateur).
10. **Aide** : détail des zones 12, 15 (arrow vs Level Brothers) déduit de la géométrie ; à confirmer en rejouant les `SCR` 2400/2600 sur le fond (non fait).
11. **Roster** : bornes de `76e2` à la lecture d'un vieux fichier ; sauvegarde de `4ff4`/variantes ailleurs que par la sortie de scène.
12. **Sortie à la fermeture de fenêtre pendant une lecture** (`DS:5080`/`10d0:0a05` libération des sons) : cas limite non étudié.

## 10. Écarts avec les autres documents

- engine.md §5.3 (touches) : « Rhythm Shop : `1`-`9` choisissent l'instrument » → ce sont les **boutons d'outils** (Cutter/Gluer/Melder), Tab = outil suivant.
- engine.md §6 / re-index.md (ligne 210) : « `1028:0f99` = écran de choix du périphérique/rythme MIDI » → faux : c'est l'`Enter` du Rhythm Shop (le logiciel ouvre bien `MidiMPC.DAT`, `RHYTHM.DAT`, `RSHELP.DAT`).
- engine.md §6 : « Prg# usage non établi » → **décodé** (§2.3) ; « 1 WAVE + 1 MIDI par défaut, le Rhythm Shop mélange via 10d0 » → confirmé (appareils dédiés `DS:77c5`, MIDI via `10d0:0ead`).
- engine.md §7.1 : `7798` « indice de séquence PLST choisie » → compteur de variante 0-3 ; `4ff4` « réglage » → flag d'aide ; `76e2` ✓ (niveau).
- formats.md : `PLST` (386 octets) et `STLV` (180 octets) **décodés** ici ; « `STRL` 30001 = 45 titres » ✓.
- engine.md §4.6 : minuterie de 4 ms ✓ (`1038:0543`).
- engine.md §2.4 : plages d'ids MIDI `MIDIMPC` 101… ✓ (101-115, 201-215, 301-315).
