# L'hôtel du temps-compté (`HOTEL.MHK`, écran 14) : étude de rétro-ingénierie

Tâche T8. Écran 14 de `ZOOMBINI.EXE` (version 1.0FR), archive `HOTEL.MHK` (5,0 Mo), deuxième épreuve de l'itinéraire B de l'étape 3. Document d'étude seul. Cadre : [../engine.md](../engine.md), [../screens.md](../screens.md). Même conventions que [fleens.md](fleens.md) : adresses `segment:offset`, `[xxxx]` = globale `DS:xxxx`, `S+0xNN` = tampon de partie, tableaux de travail du module en segment `1428` (rangés `1428:xxxx` ci-dessous), confiance **sûr** / **probable** / **hypothèse**. Le nom anglais « Hotel Dimly » est une lecture de l'effet principal (la lumière baisse à chaque erreur, 3.4), pas une chaîne du jeu.

Les rappels d'événements `10e8:0674`, `35cb`, `3aa6` et la table de `switch` de l'Enter (`10e8:05bf`) ne sont pas des fonctions du corpus ; les trois premiers ont été relus dans une copie du projet Ghidra.

## 0. Résumé

- Épreuve de **tri par deux (ou trois) attributs** : le joueur fait glisser chaque Zoombini dans une **chambre** ; une chambre n'accueille que des Zoombinis qui ont **la même valeur** pour chacun des attributs choisis par le jeu. Rangées et colonnes de la grille de chambres correspondent aux valeurs de ces attributs ; les étiquettes sont **apprises à la volée** (le premier Zoombini posé les définit) sauf au niveau 2 où elles sont pré-établies. **Sûr.**
- Niveau 0 : 5 chambres, 1 attribut. Niveaux 1 et 2 : grille 5 × 5 = 25 chambres, 2 attributs. Niveau 3 : 5 × 5 × 5 = 125 chambres, 3 attributs. **Sûr.**
- Une chambre refusée est une **erreur** : la lumière du hall baisse (palette multipliée par 88 % / 90 % / 92 % à chaque erreur) et le personnage guide avance dans ses répliques ; l'épreuve est **perdue** à la `(12 − F)`-ième erreur (`F` = 5, 2, 4, 2 selon le niveau) : 7, 10, 8, 10 erreurs. **Sûr** pour le code, **probable** pour la lecture « tolérance ».
- Le bouton « Go » (écran 15 : la muraille de signes) est disponible dès qu'au moins un Zoombini a été accepté ; les Zoombinis non rangés sont perdus. **Sûr.**

## 1. Identification

### 1.1 Handlers

Écran 14, descripteur `1530:129e`.

| Rôle | Adresse | Remarque |
|---|---|---|
| Enter | `10e8:0000` | 1471 octets |
| Exit | `10e8:06f5` | 213 octets |
| Tick | `10e8:07ca` | 2860 octets ; garde `[132a]` (réentrance) et `[74a4]` (scène prête) |
| Key | `10e8:2289` | 78 octets, aucun effet en jeu |
| Clic (région 1 carte, 2 Go, 3 scène) | `10e8:1cea(n)` | 1431 octets |
| Mise en place du jeu (tirage des attributs, étiquettes pré-établies, chambres bloquées) | `10e8:1896` | 1108 octets |
| Comptage des valeurs distinctes par attribut | `10e8:2784` | 206 octets ; appelle `1168:365d` |
| Pose d'étiquettes (niveau 1 et 2) | `10e8:2496(chambre, B, A)` | 123 octets |
| Validité d'une pose (niveaux 1 et 2) | `10e8:2511(chambre, B, A)` | 391 octets |
| Validité d'une pose (niveau 3) / pose d'étiquettes | `10e8:2e30(chambre, C, B, A)` / `10e8:320f` | 991 / 121 octets |
| Éclairage (obscurcissement) | `10e8:2698` | 236 octets |
| Relance (après l'introduction) | `10e8:12f6` | 1440 octets |
| Chargeur de `SCRB` | `10e8:2ade` | 850 octets |
| Boutons | `10e8:05c7(redessiner, appuyé, bouton)` | comme Fleens `04cb` |
| Réactions de Zoombini (refus, acceptation) | `10e8:3288`, `32cb`, `330e`, `3620`, `3ace`, `3bae`, `3ccc`, `3dd4`, `3e14` | animations |
| Barrières de chambres bloquées (niveau 2) | `10e8:0674`, `10e8:35cb`, `10e8:3aa6` | rappels |

### 1.2 Ressources de `HOTEL.MHK`

| Tag | Ids | Usage |
|---|---|---|
| `tBMP` | 100 | « terrain » 160 × 120 (`11a8:1783(100)`) |
| `tBMP` + `SHPL` | 5000, 5001, 5002 | fonds 640 × 480 : l'Enter charge 5000 (`11a8:1475(0x1388)`) ; la relance (`10e8:0cc8`…) recharge selon le niveau (**probable** : 5000 niveau 0, 5001 niveaux 1–2, 5002 niveau 3 ; non vérifié) |
| `tBMP` | 6000 (groupe 0, niveaux 0 à 2), 9000 (groupe 0, niveau 3) | planches principales (personnage guide, chambres) |
| `tBMP` | 7000 (groupe 1), 7500 (groupe 5, niveaux 0 à 2), 8000, 10000 (groupe 2), 11500 (groupe 3), 11800 (groupe 4) | planches d'objets, de barrières, d'enseignes, de signes |
| `tBMP` | 11000 (niveau 2, `[7540]`), 12000 (niveau 3, `[7544]`) | enseignes d'étiquettes (une image par valeur d'attribut, 1 à 5) |
| `REGS` | 11000–11005 (niveau 2), 9000–9003 et 12002–12005 (niveau 3) | points d'ancrage des enseignes (un `REGS` par attribut et par axe ; 1168:01f4) |
| `SCRB` | 6000–6087 (88), 7000–7010 (11), 7500–7509 (10), 9000–9011 (12), 10000–10149 (150), 11000–11007, 11500–11505, 11800, 12000–12003 | scripts : l'Enter en inscrit 88 (6000+) + 11 (7000+) + 25 (10000+) + 6 (11500+) + 1 (11800+) + 10 (7500+) aux niveaux 0–2 ; 12 (9000+) + 11 + 125 (10025+) + 6 + 1 au niveau 3 |
| `SCRS` | 13000–13069 (70) et 14000–14049 (50) | Zoombinis (niveaux 0–2 : 13000 × 70, 14000 × 25 ; niveau 3 : 13025 × 45, 14025 × 25 ; `1168:04d0(…, mode 5)` / `1168:03ef(…, 5)`) |
| `\0SND` | 6000–6008, 7000–7023, 7500–7535, 8900–8901, 9000–9008 | voix du guide (6000–6008), bruitages |
| `NODE` / `PATH` | 1000 | présents mais l'écran n'appelle pas `1168:2a5c` |

Sons préchargés par l'Enter (`11a8:313a(flux, haut, bas)`) : 20000–29999 (flux), 996–997, 99, 6000–6007 (flux), 425–499, 6004–6006, 6000…, 9000–9008, 9999, 10000–11007 ; voir `10e8:0482…050a`.

## 2. Règles

### 2.1 Mise en place (`10e8:1896`, **sûr**)

Soit `n` le nombre de Zoombinis vivants de l'écran (`[74d8]`, de `1168:365d`). `10e8:2784` calcule, pour chaque attribut `i` (0 à 3), `c[i]` = nombre de valeurs distinctes (1 à 5) présentes dans le groupe (`DS:74f6[i]`). Le jeu tire ensuite trois indices d'attributs `A = [74ce]`, `B = [74d0]`, `C = [74d2]`, chacun `rand(0..3)` (`1080:0028(3)`), jusqu'à ce que la condition du niveau soit vraie :

| Niveau | Condition d'acceptation du tirage |
|---|---|
| 0 et 1 | (a) `c[A] == 5` et `c[B] == 5` et `A ≠ B` ; **sinon** (b) si au moins deux attributs ont 5 valeurs (le nombre d'attributs avec `c < 5` est inférieur à 3) : `A ≠ B`, `c[A] > 3`, `c[B] > 3` ; **sinon** (c) `A ≠ B` |
| 2 | (b) avec « 5 » remplacé par « 4 » : si moins de 3 attributs ont `c < 4` : `A ≠ B`, `c[A] > 3`, `c[B] > 3` ; sinon `A ≠ B` |
| 3 | `A`, `B`, `C` deux à deux distincts |

Au niveau 0 seul `A` sert (l'attribut `B` est tiré mais ignoré). Les valeurs des attributs sont lues dans les octets `+0xEC + index` de l'objet Zoombini (1 à 5).

**Niveau 2 uniquement** (`10e8:1896`, seconde moitié) : étiquettes **pré-établies**. Le jeu remplit `1428:0316` et `1428:0348` (25 mots chacun) avec deux permutations aléatoires de {1..5} : pour `i` de 0 à 4, `10e8:2496(6·i, a_i, b_i)` avec `a_i` = valeur de colonne et `b_i` = valeur de ligne tirées sans remise (« chambre `6·i` » = cases (i, i), donc ligne `i` ↔ valeur `b_i`, colonne `i` ↔ valeur `a_i`). Puis il calcule, pour chaque chambre, combien de Zoombinis du groupe lui correspondent (`valeur de A == étiquette de colonne` et `valeur de B == étiquette de ligne`) : les chambres **sans aucun** Zoombini correspondant sont candidates ; `k = min(8, rand(0..cand−1) + 1, cand)` d'entre elles sont **bloquées** (`1428:[2·chambre] = −1`, un des 4 dessins de barrière tiré `rand(0..3)` en `1428:02EE + 2·j`), et un objet `SCRB` de barrière est créé pour chacune (flags `0x808000`, rappel `0674`). Un dépôt sur une chambre bloquée est ignoré (aucune erreur, aucune acceptation).

Niveaux 0, 1 et 3 : tables mises à zéro (`11c8:6a5c` sur `0316` / `0348` / `037A`, 0x32 octets chacune), étiquettes inconnues.

### 2.2 Ce que fait le joueur

Clic de scène (`10e8:1cea(3)`), seulement si : aucune animation en cours (`[74e2] == [74e4] == 0`), `[74d6] == 0` (pas déjà perdu), `[74cc] == 0` (pas d'essai en traitement), `[9702] < 1`, `[74be] == 0` (pas de refus en cours) :
1. objet Zoombini sous le curseur (`11a8:0d61`), dans l'état d'attente (pas déjà rangé : `+0x127 == 0`) ; l'état d'animation `+0x124` ne doit pas valoir 7, 8 ou 9 ;
2. les listes de dépôt `1520:0x2f0` sont remises à zéro, puis `1168:1742` lance le **glisser-déposer** ; `D74c4 = 1168:166e()` = indice 1-based de l'emplacement de dépôt visé (0 = hors chambre) ;
3. niveau 0 : `D74c4 > 5` → 0 ; **chambre** `r = [74dc]` = `(D74c4 − 1) × 5 + 4` au niveau 0, `D74c4 − 1` sinon ; si `r < 0` ou chambre bloquée (`1428:[2r] < 0`), le dépôt est annulé ;
4. sinon `[74cc]++` et validation selon le niveau (2.3) ; `[7570]` = id du Zoombini déposé ; accepté (`DI = 0`) : `+0x127 = 1`, et si `1168:02cc() == [74d8]` (tous rangés) : voix `0xAF + rand(0..23)` (175 à 198, félicitation) ; refusé (`DI = 1`) : `[74be] = 1`, `[74cc] = 0` ;
5. un objet **déjà rangé** (`+0x127 ≠ 0`) peut être saisi et déplacé (`[96fe] = 1`, `[9708] = 0` pendant le glisser, le point de départ est restauré) : il ne change pas de chambre (le Tick ne retraite pas la dépose), c'est un geste de tri visuel (**probable**).

Boutons : « carte » (rectangle (600,403)-(639,440)) : voix 999, `[8556] = 1` ; « Go » ((600,441)-(639,478)) : seulement si `[74a6] ≠ 0` : voix 996, `[8556] = 15` (écran suivant : la muraille de signes).

### 2.3 Validité d'une pose

Soit `a`, `b`, `c` les valeurs (1 à 5) du Zoombini pour les attributs `A`, `B`, `C`.

**Niveau 0** (`[74dc] = 5·(D74c4−1) + 4` : seules cinq chambres comptent) : si `[74ca] ≠ 0` (première pose, 2.4) : étiquette de la chambre := `a`, accepté. Sinon, si l'étiquette `1428:[0316 + 2·r]` est vide (0) : refusé si `a` est déjà l'étiquette de l'une des 5 chambres, sinon la chambre prend l'étiquette `a` et accepte ; si elle est posée : accepté **ssi** `étiquette == a`.

**Niveaux 1 et 2** (`10e8:2511(r, b, a)`, `[74a8] = 0`) : `col(r) = r mod 5`, `row(r) = ⌊r/5⌋` ; les tables par chambre `1428:0316[r]` (étiquette de colonne, valeur de `A`) et `1428:0348[r]` (étiquette de ligne, valeur de `B`) sont **remplies par colonne / par ligne** (`2496` écrit la valeur de colonne sur toute la colonne `r mod 5` et la valeur de ligne sur toute la ligne de `r`). Résultat (en lisant `2511`) :
- chambre **vierge** (étiquettes 0 / 0) : accepté **ssi** aucune chambre n'a déjà l'étiquette de ligne `b` ni l'étiquette de colonne `a` (chaque valeur d'un attribut n'occupe qu'une seule ligne / colonne) ;
- étiquettes (colonne, ligne) = (`a`, `b`) : accepté ;
- colonne vierge et ligne égale à `b`, ou colonne égale à `a` et ligne vierge : accepté **ssi** la valeur manquante n'est déjà prise par aucune autre ligne / colonne ;
- sinon refusé.
Accepté, `2496(r, b, a)` pose les étiquettes de la colonne et de la ligne.

**Niveau 3** (`10e8:2e30(r, c, b, a)`) : indices `iA = (r mod 25) / 5`, `iB = r / 25`, `iC = r mod 5` ; trois tables de 5 étiquettes `1428:0316[iA]` (valeur de `A`), `1428:0348[iB]` (valeur de `B`), `1428:037A[iC]` (valeur de `C`). Règle identique en trois dimensions : accepté ssi chaque étiquette déjà posée est égale à la valeur du Zoombini, et que toute valeur pas encore posée n'est portée par aucune autre ligne / colonne / étage ; une étiquette vierge est posée à l'acceptation (`10e8:320f`).

Dans tous les niveaux, `[74a8] ≠ 0` accepte tout (réservé au mode de test ; vaut 0 à l'Enter).

### 2.4 Première pose gratuite

`[74ca] = 1` à l'Enter : la **première** pose (quel que soit l'essai) est acceptée sans condition et définit les étiquettes de sa chambre ; elle remet `[74ca] = 0` et `[74ee] = [74f0]` (voir 2.5). Aux niveaux 1 et 3 et 0 c'est simplement la première étiquette ; **au niveau 2 elle écraserait des étiquettes pré-établies** (`2496` appelée sans test) : **point ouvert** (7.1).

### 2.5 Erreurs tolérées

`[74ee]` (initial 1) est à la fois le compteur d'erreurs et l'indice de la réplique du guide (`SCRB 6000 + [74ee]`). `F = [74f0]` = 5 (niveau 0), 4 (niveau 2), 2 (niveaux 1 et 3). L'introduction (niveaux 0 à 2) joue, avant la première pose, les répliques `6000 + 1` à `6000 + F` (incrémente `[74ee]` à chaque, `[74ec]`) ; à la première pose `[74ee] = F` (donc `[74ee]` vaut toujours `F` avant la première erreur).

Un refus (`[74ee]++`, à tous les niveaux) :
- niveaux 0 à 2 : joue la réplique `6000 + [74ee]` (`SCRB`) si `[74ee] < 11`, sinon l'animation de défaite (`10e8:3ace`) ;
- `[74ee] == 9` : réplique supplémentaire tirée (`SCRB 7007 + rand(0..1)` : 0x1B5F + `rand(0..2)`, **probable**) ;
- `[74ee] ≥ 12` : `[74d6]++` (jeu perdu : plus de pose possible, `[74cc]` etc.), voix 6006 (0x1776), `11a8:04b9`, attente de 60 ticks (`1090:00c1(1, 0, 60, 0)`), et au niveau 3 voix `0x1D4F + rand(0..2)` (7503–7505).

Donc, après la pose gratuite, l'épreuve est **perdue au `(12 − F)`-ième refus** : 7e (niveau 0), 10e (niveau 1), 8e (niveau 2), 10e (niveau 3). Un refus sur chambre bloquée n'existe pas (annulé avant).

### 2.6 Succès, échec, perdus

- **Tous rangés** : `1168:02cc() == [74d8]` → voix de félicitation ; le Tick (`[74e6]`) finit l'animation et lève `[74a6]` (Go autorisé). Le joueur peut cliquer sur « Go ».
- **Échec** (`[74d6] ≠ 0`) : plus de pose ; le Tick lève `[74a6]` après la séquence de défaite : Go reste disponible.
- **Go à tout moment après la première acceptation** (`[74a6]` est levé par `10e8:3620` après chaque acceptation, ligne `D74a6 = 1`).
- **Perdus** : à la sortie, `1168:36e1` marque perdus les objets avec `+0x127 == 0` : les Zoombinis jamais acceptés dans une chambre (en cas d'échec : tous ceux restés en attente ; en cas de sortie anticipée : idem). Perdus rendus au **camp 1** (`S−0x5B9E`, `S+0x4A += perdus`).
- **Carte** : abandon (`[8556] = 1`), le groupe est perdu (règle générale).
- Entraînement : Exit → `3e5f(1)` / `3dd0(0, 1)`, tous sauvés.

## 3. Niveaux

| Niveau | Chambres | Attributs | Étiquettes | Bloquées | `F` | Erreurs avant défaite | Objets `SCRB` | Palette par erreur |
|---|---:|---:|---|---:|---:|---:|---|---|
| 0 | 5 (rooms `5·k+4`) | 1 (`A`) | apprises | non | 5 | 7 | 6000–6087 | × 0,88 |
| 1 | 25 (5 × 5) | 2 (`A`, `B`) | apprises | non | 2 | 10 | idem | × 0,92 |
| 2 | 25 (5 × 5) | 2 | **pré-établies** (permutations) | 1 à 8 (jamais sur une chambre utile) | 4 | 8 | idem + barrières (10000+, 0x808000) | × 0,90 |
| 3 | 125 (5 × 5 × 5) | 3 (`A`, `B`, `C`) | apprises | non | 2 | 10 | 9000–9011, 10025–10149… | × 0,92 |

Autres écarts : les niveaux 0 à 2 jouent l'introduction du guide (répliques `6000+1 … 6000+F`, groupe 5 `tBMP 7500` pour les petites bulles) ; le niveau 3 a un guide différent (groupe `tBMP 9000`) et un autre jeu de `SCRS` (13025 × 45 / 14025 × 25). Les niveaux 2 et 3 chargent des enseignes d'étiquettes (`tBMP 11000` / `12000` + `REGS`) : le niveau 2 affiche donc les signes dès le début, le niveau 3 les révèle (**probable**).

3.4 Obscurcissement (`10e8:2698`, **sûr**) : à chaque refus, la palette `10..245` (236 entrées) est lue (`1058:03b5`), chaque composante R, V, B est multipliée par `0x58/100` (niveau 0), `0x5A/100` (niveau 2) ou `0x5C/100` (niveaux 1 et 3), et réécrite (`1050:0043`). L'effet est cumulatif ; il est annulé par la relance (`10e8:12f6`, rechargement du fond `11a8:1475`).

## 4. Déroulé et état

### 4.1 Variables

| DS | Rôle |
|---|---|
| `74c8` | niveau (0–3, `1168:515d`) |
| `74ce` / `74d0` / `74d2` | indices d'attributs `A`, `B`, `C` |
| `74d8` | nombre de Zoombinis vivants |
| `74d4` | nombre de poses acceptées |
| `74de` | nombre de chambres : 25 ou 125 |
| `74dc` | chambre visée |
| `74c4` | indice 1-based de l'emplacement de dépôt |
| `74cc` | essai en cours |
| `74be` | refus en cours |
| `74ca` | première pose gratuite (1 → 0) |
| `74ee`, `74f0` | indice de réplique / erreurs, et sa base `F` |
| `74d6` | épreuve perdue |
| `74a6` | Go autorisé |
| `74a4` | scène prête (garde du Tick) |
| `74a8` | mode de test : tout accepter |
| `74ae` | variante d'introduction : niveau 0 : 0 ou 2 selon `S+0x3A` ; 1, 2, 3 : 4, 5, 6 (`1168:5c57(S+0x3A)` donne 0 à 3, voir code d'Enter `10e8:041f`) |
| `74b0`, `7504`, `7502`, `7508` | état de l'introduction (rejouable, abandonnée par clic, attente 181 ticks) |
| `7570` | id du Zoombini à traiter par le Tick |
| `74fe` | id du dernier Zoombini traité |
| `7572` | pointeur vers la liste des Zoombinis (`1168:365d`) |
| `1428:0316`, `0348`, `037A` | étiquettes (colonnes / lignes / étages) |
| `1428:[2·r]` | compteur de pile de la chambre `r` (0 = vide, 1–6 = hauteur de pile affichée, −1 = bloquée) |

### 4.2 Tick (`10e8:07ca`)

Garde `[132a] == 0` et `[74a4] ≠ 0`. Dans l'ordre : pompe `11a8:04b9` ; sortie demandée (`[8556] ≠ 0`, même schéma que Fleens : attend la voix 20036, `[a2de]`, puis `[8554] = [8556]` et Exit) ; si `[74e0] == 0` : introduction du guide (`[74ae]`, `[74b0]`, `[7508]` : jusqu'à 181 ticks d'attente, voix) ; traitement d'un Zoombini déposé (`[7570]`, 2.2/2.5) ; fin d'animation de refus (`[74e0]`, `[74e4]`, `[74ec]`) ; relance (`[74e2]`, qui recharge le fond, recrée le groupe `1168:0858`, réinstalle les emplacements `11a8:0ed9` et relance `10e8:12f6`). Le niveau 1 joue en plus `10e8:3e14` quand `[74c6] == 2`.

### 4.3 Zones

- Boutons : carte (600,403)-(639,440), Go (600,441)-(639,478) ; troisième région : tout l'écran (0,0)-(640,480) (**sûr**, `DS:1216`, `123a`, `1262`).
- Chambres : positions des emplacements de dépôt inscrits par `11a8:0ed9` (niveaux 0–2 : 5 / 25 rectangles ; niveau 3 : 125). Table `DS:12d6` (16 couples, de (455,423) à (226,421) : ligne d'attente des Zoombinis dans le hall, **probable**). Coordonnées des chambres : non extraites (dans les `SCRB` 10000+).
- Pas de clavier utile (Key vide).

## 5. Animations et sons

- Scripts du guide : `SCRB 6000 + k` (k = 0 à 8 : introductions et répliques selon `[74ee]` ; 9 + : réactions) ; tirage de répliques `SCRB 7007…`, `0x1B5F` (7007) `+ rand(0..2)` à `[74ee] == 9`, `SCRB 0x1D4F + rand(0..2)` (7503–7505, niveau 3, défaite) ; sons 6000–6008 (voix du guide) ; sons des chambres 7000–7023 (ouverture / fermeture de portes), 7500–7535 (grincements / bulles), 9000–9008, 8900–8901.
- Réactions de Zoombini : `10e8:330e` (refus : le Zoombini repart, `+0x116` cible = position d'origine `[757a]`), `10e8:3620` (acceptation : arrive dans la chambre, pile `1428:[2r]`), `3288` / `32cb` (portes), `3ace` (défaite : joue `1b89(0, 0, …)` sur 2 chambres de pile, rappel `3aa6`), `3bae` (séquence de défaite des Zoombinis). Détail des ids non relevé.
- Voix : 999 (carte), 996 (Go), 175–198 (tous rangés), 6006 (défaite), 7503–7505 (défaite, niveau 3), 20036 (attente de fin de son avant sortie).

## 6. Tampon de partie

- Aucun octet propre à l'hôtel n'est écrit hors règles communes (contrairement aux nizibooms, pas de règle persistante) : `S+0x3A` (mémoire de dialogue de l'écran 14, `S+0x28 + 2 × (14 − 5)`) est lu par `1168:5c57` pour choisir l'introduction `[74ae]`.
- Groupe courant reconstruit par `1168:36e1` : attributs inchangés (les objets reprennent les octets d'origine), fiche[8] = 1 pour les rangés, 0 sinon.
- Progression : `S+0x5D |= 1 << niveau` ; si aucun perdu : `S+0x5D |= 0x10 << niveau` ; perdus rendus au camp 1 (`S+0x4A`). Le monument et le passage de niveau se font à l'écran 15.

## 7. Points ouverts

1. Niveau 2 : la première pose étant « gratuite » (`[74ca] = 1` à tous les niveaux), il faut vérifier en jeu si les étiquettes pré-établies sont écrasées (peut-être que `[74ca]` est remis à 0 par la relance `10e8:12f6` au niveau 2).
2. Coordonnées des chambres et du hall (les tables de `11a8:0ed9`) ; ordre exact des emplacements 1…25 / 1…125 (`D74c4`) ; chaîne `SCRB` complète de chaque réaction.
3. Variante d'introduction `[74ae]` (0 à 6) et rôle de `S+0x3A`.
4. Écart exact « fond de niveau » (tBMP 5000 / 5001 / 5002) ; rôle de `[74c6] == 2` (niveau 1).
5. Sort des Zoombinis déjà rangés en cas d'échec : tous sauvés si acceptés avant la défaite (cohérent avec `+0x127`), non testé.
6. Détail du nombre d'erreurs : `[74ee]` dépend de la complétion de l'introduction ; confirmer en jeu les seuils 7 / 10 / 8 / 10.
