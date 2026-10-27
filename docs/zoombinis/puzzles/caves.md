# La tanière du sphinx (`CAVES.MHK`, écran 16) : étude de rétro-ingénierie

Tâche T9. Épreuve 10 du parcours (étape 4, 1re épreuve), `CAVES.MHK`, de `ZOOMBINI.EXE` (NE 16 bits, version 1.0FR). Cadre moteur : [../engine.md](../engine.md) ; parcours, niveaux, sortie d'épreuve : [../screens.md](../screens.md) (§1.6, §3.4). Corpus Ghidra : `archives/zoombinis/re/ZOOMBINI/`. Conventions : adresses `segment:offset` du code, `[xxxx]` = `DS:xxxx`, `S+0xNN` = tampon de partie. Confiance : **sûr** (lu dans le code ou les données), **probable**, **hypothèse**.

Pièges de lecture propres à cette étude : la décompilation Ghidra affiche beaucoup d'immédiats comme des pointeurs de chaînes (`s_Picker_MHK + 4` = 0x1770 = 6000, etc.) ; toutes les valeurs ci-dessous ont été relues dans le désassemblage. Pour un terminateur de script d'octet bas `b ≠ 0`, le rappel d'événement reçoit `b − 1`.

## 0. Résumé

- Le joueur range les Zoombinis du groupe (jusqu'à 16) sur 20 dalles en file le long d'un chemin, devant un lion de pierre. L'ordre à respecter est **un tri caché** : les dalles sont découpées en blocs consécutifs, un bloc par valeur d'un attribut A (et, aux niveaux 3 et 4, des sous-blocs par valeur d'un attribut B), dans un ordre de valeurs tiré au hasard (permutation de 1 à 5) (sûr).
- Déposer un Zoombini sur une dalle qui n'est pas de son bloc ne le perd pas : le jeu le place lui-même sur une dalle libre valide tirée au hasard, mais le lion se réveille d'un cran. **Quand le lion atteint son dernier cran (4, 5, 6 ou 7 selon le niveau), la pose est verrouillée** ; les Zoombinis restés hors des dalles sont perdus (renvoyés au camp 2) (sûr pour le mécanisme).
- Indices : une rangée de hiéroglyphes sur le mur montre l'ordre des valeurs : complète au niveau 1, partielle (2 sur 5) au niveau 2, partielle sur deux rangées au niveau 3, absente au niveau 4 (sûr).
- Aucune notion de score. Réussite = tous les Zoombinis posés ; sortie par le bouton « go ».

## 1. Identification

| Élément | Valeur |
|---|---|
| Écran | 16, descripteur `1530:0bc4` |
| Enter / Exit / Tick / Key | `10c8:0000` / `10c8:0945` / `10c8:09a6` / `10c8:1cf5` |
| Archive | `CAVES.MHK` (chaîne `1530:0f2f`), ouverte par `11b8:0fa2`, puis `11b8:0011` |
| Nom | « la tanière du sphinx » : **probable → quasi sûr**. La chaîne `Hieroglyphs` (`1530:0f39`, nom de la `tBMP` 10000 chargée par `11b8:0497`), le fond (patte et tête de lion sculptées, dalles dorées) et l'ordre de l'étape 4 concordent. Le lion est une statue de sphinx ; aucune autre confirmation textuelle n'existe |
| Dans l'original | « Lion's Lair » (souvenir, **hypothèse**) |
| Callbacks hors corpus Ghidra | `10c8:1137` (événements des dalles et du Zoombini, créée), `10c8:1245` (événements du lion, non créée : lue avec un script jetable), `10c8:18c7` / `10c8:18d3` (deux petits stubs qui appellent `10c8:18df` avec la rangée de hiéroglyphes), `10c8:1a1f` / `10c8:1ad0` et `10c8:1846` / `10c8:1864` (rappels de redessin) |

Le **Key** `10c8:1cf5` n'agit que si `[a43f]` (mode de débogage) est non nul ou si la touche est `0x16f` : table de 14 touches à `1530:1eff` (relance des tirages `10c8:27d7`, affichage de débogage `10c8:2d1c`…). **Aucune touche n'a d'effet en jeu normal** (sûr ; la table n'a pas été détaillée).

Ressources utilisées (sûr, d'après `10c8:0000`, `10c8:1afe`) :

| Ressource | Rôle |
|---|---|
| `tBMP 100` (160×120) | « terrain » (`11a8:1783(100)`), non exploité par cette épreuve en pratique |
| `tBMP 5000` + `SHPL 5000` | fond 640×480 (`11a8:1475(5000)`) |
| `tBMP 11000` (6 images) | boutons carte / go : `[0bd8]`, dessinés par `10c8:1799` (images 5 à 8 de `11000` pour les deux boutons, voir §4.3) |
| groupe de formes 0 = `tBMP 6000` (71 images), `SCRB 6000–6012` | lion, patte, voile de poussière |
| groupe 1 = `tBMP 9000` (20), `SCRB 9000–9019` | dalle `k` allumée : script `8999 + k` |
| groupe 2 = `tBMP 7000` (41), `SCRB 7000–7019` | dalle `k` normale : script `6999 + k` (20 dalles) |
| groupe 3 = `tBMP 8200` (188), `SCRB 8200–8279` | 4 scripts par dalle : `8200 + 4(k−1) + {0,1,2,3}` (retournement de dalle, §5) |
| groupe 4 = `tBMP 9025` (4), `SCRB 9025–9028` | dalles de remplissage au début du chemin |
| `tBMP 10000` (20 images, nommée `Hieroglyphs`) | hiéroglyphes : image `valeur + 5 × attribut` (1 à 20), dessinés par `10c8:18df` |
| `REGS 200`, `REGS 201` | tailles / ancrages des 20 hiéroglyphes ; `REGS 202` est dans l'archive mais jamais chargé (la boucle de `10c8:1afe` fait `i = 0, 1`) |
| `NODE 1000`, `PATH 1000` | 21 points : les 20 dalles et un point de sortie hors écran `(701, 363)` ; un seul chemin `[1,2,…,21]` (`1168:2a5c(1000)`) |
| `SCRS 12000–12013` (14) | scripts « rejet » des Zoombinis, chargés par `1168:03ef(12000, 14)` |
| `SCRS 13000–13004` (5) | marche normale selon le type de pieds, chargés par `1168:04d0(13000, 5)` |
| `\0SND` 6000–6008, 8000–8004, 8200–8204, 8400–8404, 12000 | sons de l'archive (voir §5.3) |
| `tBMP 8000`, `tBMP 8400`, `SCRS 12000–12003`, `12008–12011`, sons 8000 et 8400 | **variantes 0 et 2 inutilisées** : `10c8:0000` pose `[0c06] = 1` puis `[0c04] = 8000 + 200 × [0c06]` (= 8200) et `[0c06] = 12000 + 4 × [0c06]` (= 12004). Les autres jeux sont présents dans l'archive mais jamais sélectionnés (sûr ; l'intention d'un tirage supprimé est une hypothèse) |
| musique | `tMID` `30025 + (niveau 0 à 2)` (`11a0:0ee7(0, 0x7549 + niveau)` seulement si `[7106] < 4`, c'est-à-dire aux trois premiers niveaux ; au niveau 3 aucune musique n'est mise en file ici). Ids ≥ 30000 = `MIDIMPC.MHK` |

Le groupe de formes 3 charge ses `SCRB` par `11a8:15a6(…, 0x50, [0c04])` : 80 scripts. Les valeurs `[0c04] = 0x2008` (8200) et `[0c06] = 0x2ee4` (12004) sont aussi les valeurs initiales du segment de données.

## 2. Règles

### 2.1 Données de départ

- `[7106]` = niveau + 1 (1 à 4), `1168:515d()` + 1. `10c8:1f37([7106])` remet les compteurs à zéro et fixe, par niveau (sûr) :

| Niveau (`[7106]`) | 1 (« pas si facile ») | 2 | 3 | 4 |
|---|---:|---:|---:|---:|
| crans du lion `[0c0a]` | 4 | 5 | 6 | 7 |
| script de base du lion `[0c08]` | 6006 | 6005 | 6004 | 6003 |
| lignes de tri `[0bfc]` (attributs triés) | 1 | 1 | 2 | 2 |
| hiéroglyphes affichés | 5 sur 5 | 2 sur 5 | 2 sur 5 par ligne (2 lignes) | aucun |

(`[0bfc]` : `10c8:201a` pose 1 si `[7106] < 3`, sinon 2. `[0bfa] = 5` valeurs par attribut, constant.)

- `N` = `[0c1c]` = nombre de Zoombinis du groupe présents (`1168:365d()` renvoie le tableau `[9a28]` : mot 0 = compte, puis 4 octets d'attributs par Zoombini ; compte = Zoombinis dont `+0xe0 ≠ 0` et `+0x127 ≠ 0`). En jeu normal `N ≤ 16`.
- Dalles utilisées : numéros `[0c14] … 20` avec `[0c14] = 21 − N`. Les `[0c1e] = min(4, 20 − N)` premières dalles (numéros 1 à `[0c1e]`) ne servent pas : la zone de dépôt correspondante est occupée par un objet de remplissage `[71f8]` (script `9024 + [0c1e]`, groupe 4) et personne n'y est posé (sûr).
- `[0c1e]` ne dépend que de `N` : pour `N = 16`, dalles 1 à 4 occupées, dalles 5 à 20 en jeu.

### 2.2 Tirage de la règle (`10c8:201a`)

1. Deux attributs distincts parmi 0 à 3 : `A = [7108]` tiré dans `{0,1,2,3}` par `10a8:04e8(3, 0)` ; `B = [710a]` tiré par `04e8(2, 0)` dans les 3 indices restants (sûr). L'indice d'attribut `a` désigne l'octet `+0xec + a` de la fiche du Zoombini (valeur 1 à 5). L'ordre cheveux / yeux / nez / pieds est une hypothèse (voir `screens.md` §2.1) ; la feature `+0xef` (4e attribut) sert à choisir le script de marche (`12999 + valeur`, §5.2).
2. Pour chacune des deux lignes, une **permutation des valeurs 1 à 5** par tirages successifs sans remise : `[710c .. 7110]` (ligne A), `[7116 .. 711a]` (ligne B). La ligne B est toujours tirée mais n'est utilisée qu'aux niveaux 3 et 4.
3. `[0c20]` (toujours 0 en jeu : la branche qui forcerait un tirage fixe appartient au mode de débogage) (sûr).

### 2.3 Disposition des dalles (`10c8:21c4`, `10c8:2508`)

- `10c8:21c4` compte, pour le groupe : `[7120 + v]` = nombre de Zoombinis dont l'attribut A vaut `v` ; si 2 lignes, `[7120 + v + 6 × w]` = nombre dont A = `v` et B = `w` (tableau 6×6, indices 1 à 5).
- `10c8:2508` remplit, pour les dalles `s` de `[0c14]` à 20 :
  - `[71a4 + 2s]` = valeur A exigée : les dalles sont rangées par blocs consécutifs dans l'ordre de la permutation A ; le bloc de la valeur `v` a `[7120 + v]` dalles ;
  - `[71ce + 2s]` = valeur B exigée (2 lignes) : dans chaque bloc A, sous-blocs consécutifs dans l'ordre de la permutation B, de taille `[7120 + v + 6 × w]`.
  - Les tirages sont donc **toujours solubles** (il y a exactement autant de dalles que de Zoombinis dans chaque classe) (sûr).
- Le sens de lecture est du numéro `[0c14]` (début du chemin, en haut à gauche) au numéro 20 (près de la sortie, en bas à droite). Le tri n'est pas décrit au joueur ; **les hiéroglyphes de la rangée A suivent l'ordre de la permutation** : emplacement `k` (1 à 5) montre la valeur `perm[k − 1]` (sûr, `10c8:2279`).

### 2.4 Indices (`10c8:2279`)

`[70ce + k]` = « emplacement `k` affiché » (`k` = 1 à 5 pour la ligne A, 6 à 10 pour la ligne B), `[70e4 + k]` = image du hiéroglyphe : `valeur + 5 × attribut` (1-basé dans `tBMP 10000`) (sûr).

| Niveau | Emplacements affichés |
|---|---|
| 1 | 1 à 5 (ligne A complète) |
| 2 | 2 emplacements parmi 1 à 5, tirés sans remise (`04e8(2,2)` vaut toujours 2) |
| 3 | 2 parmi 1 à 5 **et** 2 parmi 6 à 10 |
| 4 | aucun |

Emplacements à l'écran (`DS:0e14` x, `DS:0e2a` y) : ligne A x = 326, 348, 375, 397, 423 ; y = 36, 39, 42, 44, 46 ; ligne B x = 324, 347, 373, 395, 422 ; y = 77, 80, 83, 86, 90. Au niveau 1, un clignotement d'introduction fait redessiner la rangée 3 fois à 30 ticks d'intervalle (`[70fa]`, Tick `10c8:09a6` ; **probable**).

### 2.5 Pose d'un Zoombini (`10c8:130f` cas 3)

Conditions pour pouvoir saisir un Zoombini : `[0bf8] == 0` (pas de verrou), `[9702] < 1` (pas de sortie en cours), la feature n'est pas déjà dans un emplacement `[717a + 2s]` (sûr).

Le glisser-déposer est `1168:1742`. `[0c18] = 1168:166e()` donne la dalle déposée (1 à 20) ou 0.

1. **Dépôt hors dalle (`[0c18] == 0`)** : test du point `+0xd6` du Zoombini contre 11 rectangles `DS:0d0a + 8i` (`i = 1 … 11`, zone du sol à gauche : de `(0,0)-(195,130)` à `(0,356)-(36,394)`). Dans l'un d'eux : le Zoombini reste là où il est lâché (hors file, libre). Sinon : il est ramené à sa position d'origine (`[724a + 4 × [729a]]` empilée, `10c8:0e74(2)` : script `SCRS 12012`, chute dans le gouffre, puis `SCRS 12013` de retour, événements 10 puis `0x14`) ; aucune pénalité, aucun cran du lion (sûr).
2. **Dépôt sur une dalle `[0c18]`** : le Zoombini reçoit `+0x127 = 1` (« posé ») et `+0x20 = 0x4008001`. `[0c1a] = 10c8:2635([0c18], id)` donne la dalle finale :
   - `10c8:2635` : valeur A du Zoombini `a = octet(+0xec + A)` ; si 2 lignes, `b = octet(+0xec + B)`. Si la dalle `[0c18]` est libre, exige `[71a4 + 2s] == a` (et `[71ce + 2s] == b`) : renvoie `[0c18]`. Sinon renvoie une dalle choisie au hasard (`04e8(n − 1, 0)`) parmi les dalles libres `[0c14 … 20]` valides pour `(a, b)` ; s'il n'y en a aucune (cas impossible en jeu), renvoie 1 (sûr).
   - **Pose correcte (`[0c1a] == [0c18]`)** : `[717a + 2s] = id` ; `[0c16]++` (nombre de posés) ; décalages de pose `+0xf1 = DS:0dba[2s]`, `+0xf2 = DS:0de4[2s]` ; première pose (`[0c16] == 1`) : `[0bf0] = 1` (bouton « go » activé, rectangle redessiné) ; le Zoombini est ajouté à la file de marche `[7224]` (cible `[7176] = DS:0cae + 4s`) ; si `[0c16] == [0c1c]` (tous posés) : `[7240] = 1`, `[0bf8] = 1` (verrou), voix `04e8(0x4e5f, 0x4e57)` (ids 20055 à 20063, choisie au hasard) (sûr).
   - **Pose rejetée (`[0c1a] ≠ [0c18]`)** : le Zoombini est enregistré sur la dalle correcte : `[717a + 2 × [0c1a]] = id`, `[7228] = id`, `[7168] = [71f8 + 2 × [0c18]]`, `[716a] = [71f8 + 2 × [0c1a]]`, `[0c16]++`, `[0bf8] = 1` (verrou le temps de l'animation), `[7104] = 1` (le Tick lance `10c8:0e74(0)`), `1168:1647()` libère la case de dépôt `[99d8]`. Même gestion de `[0bf0]` et de la fin que ci-dessus (sûr).
3. Le cran du lion est incrémenté par `10c8:1137` cas 4 (§5.1), donc **quand l'animation de rejet se termine** (une fois par rejet).

### 2.6 Fin de l'épreuve

- **Tolérance** : `[0c0c]` = cran courant du lion (0 au départ). À chaque rejet, `[0c0c]++` et le lion passe au script `[0c08] + [0c0c]` (`10c8:1c92`, si `[0c0c] ≤ [0c0a]`). Quand `[0c0c] == [0c0a]`, l'événement `0x14` du dernier script du lion fixe `[0bf8] = 1` : **plus aucune prise de Zoombini**. Le rejet qui atteint le dernier cran est encore traité (le Zoombini est posé sur une dalle correcte). Donc `[0c0a]` rejets au total, le dernier compris : 4 (niveau 1), 5, 6, 7 (niveau 4) (sûr).
- À ce moment, si des Zoombinis ne sont pas posés (`1168:02cc() < [0c1c]`), une phrase de consolation est dite au hasard (conditions : `04e8(4, 0) > [7106] − 1` ou `(S+0x40 & 0xfff) < 4`) : voix `04e8(0x4e50, 0x4e4d)` (ids 20045 à 20048) (`10c8:1245`, événement `0x14`) (sûr).
- **Aucun échec explicite** : on peut toujours cliquer « go » dès qu'un Zoombini est posé. Les Zoombinis hors dalle sont perdus (§6).
- **Bouton « go » (`10c8:130f` cas 2)** : actif si `[0bf0] ≠ 0` (au moins un posé). Séquence : si `[7100] == 0` alors `[70fe] = 1` et `[0bf8] = 1` ; flash du bouton (`10c8:1799`) ; `1168:3ead()` (tous les Zoombinis dans une case de dépôt `[02f0 + 2i]` reçoivent `+0x127 = 1`) ; `[8556] = 0x11` (écran suivant : Smoke). Le Tick lance alors l'éveil final du lion (§4.2).
- **Bouton « carte » (cas 1)** : son 999, flash, `[9704] = 1`, `[8556] = 1`, `11a0:16da()` (même sortie par `1198` que les autres épreuves ; la confirmation « ce groupe sera perdu » est celle de `screens.md` §3.4, hors de cette épreuve).

## 3. Les quatre niveaux (récapitulatif)

Voir §2.1, §2.4 : seuls changent `[0c0a]` (4, 5, 6, 7 rejets tolérés), `[0c08]` (6006, 6005, 6004, 6003 : le script du lion à l'étape `n` est `[0c08] + n`, donc 6007 à 6010 au niveau 1, 6004 à 6010 au niveau 4), le nombre de lignes de tri (1, 1, 2, 2) et les indices (5, 2, 2+2, 0). Le nombre de dalles (`N`) dépend du groupe, pas du niveau. Le dernier script du lion est toujours `SCRB 6010`.

Deux niveaux croissent donc en difficulté de **deux façons** : plus de règle (un second attribut) et moins d'indices, mais aussi plus de tolérance.

## 4. Déroulé et état

### 4.1 Enter (`10c8:0000`)

Ordre (sûr, relu dans le désassemblage) : niveau `[7106]` ; `10c8:1f37` ; remise à zéro des variables ; ouverture de l'archive ; groupes de formes 0 à 4 et plages de `SCRB` ; `SCRS` REJECT/NORMAL ; création des features décoratives : lion `[722a]`, `[722c]` (scripts 6000, 6001), tête `[722e]` (6002, `+0x10` = `10c8:1245` posé plus tard) ; `1168:0858(0)` crée les Zoombinis du groupe ; `1168:365d()` donne `N` ; `[723c] = N − 1` ; dalles et objets de remplissage ; `10c8:1afe` (REGS 200 / 201, `tBMP 10000`), `10c8:1ffd` (tirage 2.2 à 2.4) ; `10c8:2279`, deux features de redessin (`+0x10` `1ad0` / `1864`) ; `1168:2505(0)`, `1168:274e(0x2d, 0x1e)` : positionnement des Zoombinis en attente sur la table de zones ; `1038:0000(DS, 0x0ca6, 1, 0xc000)` : régions cliquables ; boutons `10c8:1799(0,0,1)`, `(0,0,2)` ; `1168:3dd0(0, 0)` met `+0x127 = 0` à tous (aucun posé) ; `11a8:313a` déclare les plages de sons à précharger ; `[a2c4] = 0x4e61`. La tête du lion démarre sur le script `[0c08] + 1` (feature `[7232]`, délai 9).

### 4.2 Machine à états du Tick (`10c8:09a6`)

Garde `[0e0e]` (non réentrant) et `[0bf4]` (écran actif). À chaque tour : `11a8:04b9()` (avance les features).

1. **Sortie demandée (`[8556] ≠ 0`)** : attend la fin de la voix `0x4e44` (`1028:0d9e`), puis, si `([a406] ≠ 0 || [9702] == 0 || [9704] > 0)` **et** (`[7100] == 3 || [8556] == 1 || [a406] ≠ 0`) : `[8554] = [8556]`, `[8556] = 0`, `10c8:0945` (Exit), fin. Sinon, si `[7100] == 2` : `[7100] = 3`, son 996 (`0x3e4`), `10c8:16c2(0x1e, 0, 0x178, 0x294)` : les Zoombinis posés (dalles 20 à 1, 3 au plus lancés explicitement, 30 ticks d'écart) partent en file vers la sortie (`+0xda`, `1168:4231(0, 10)`), `[9702] = 1`, `[9704] = 0` (le `[9704]` est remis à 1 par l'arrivée des Zoombinis, côté `1168`).
2. **Éveil du lion (`[70fe] ≠ 0 && [7102] == 0`)** : `[70fe] = 0`, `[7100] = 1`, le lion `[722e]` joue `SCRB 6002` (29 images, événement final 11 → `10c8:1245(10)` : `[7100] = 2`).
3. **Retournement de dalle (`[7222] ≠ 0`)** : les deux dalles (`[7168]`, `[716a]`) reçoivent leur script allumé (`8999 + [0c18]`, `8999 + [0c1a]`) et le Zoombini ses décalages de pose.
4. `[7104] ≠ 0` : `[7104] = 0`, `10c8:0e74(0)` (phase 1 du rejet). `[0c0e] ≠ 0` : `[0c0e] = 0`, `10c8:0e74(1)` (phase 2).
5. File de marche `[7224]` : chaque Zoombini posé lance `SCRS 12999 + feet` (`feet` = `+0xef`, 1 à 5 → 13000 à 13004) vers `[7176]/[7178]`, avec `+0x10 = 10c8:12f3` (rappel vide).
6. **Danse de victoire (`[7240] ≠ 0` et `[723e] < [723c]`)** : toutes les 30 ticks, un Zoombini tiré au hasard (`1098:0098`) parmi ceux qui sont actifs lance son script de marche en place ; à `[723e] == [723c]`, remise à zéro (probable).
7. `1108:035b()`.

États de `[7100]` : 0 repos, 1 lion se réveille, 2 réveil terminé, 3 Zoombinis en marche vers la sortie.

### 4.3 Entrées et zones cliquables

`1038:0000(DS, 0x0ca6, 1, 0xc000)` : régions (entrées de 0x24 octets à partir de `DS:0c2a`, callback `10c8:130f`) :

| Région | Rectangle | Identifiant | Rôle |
|---:|---|---:|---|
| `DS:0c2a` | (589, 392)-(628, 429) | 1 | bouton carte |
| `DS:0c4e` | (589, 430)-(628, 467) | 2 | bouton « go » |
| `DS:0c72` | (0, 0)-(640, 480) | 3 | saisie d'un Zoombini (objet sous la souris, `11a8:0d61`) |

La région 3 déclare aussi un polygone de 20 points à `DS:0cb2` qui épouse le chemin (positions des dalles, ancre `DS:0cae + 4s`) ; ces coordonnées valent, pour les dalles 1 à 20 : (254,140), (296,148), (340,146), (373,163), (364,187), (337,212), (316,234), (301,263), (314,292), (346,311), (388,316), (429,301), (458,281), (482,261), (521,247), (556,263), (567,290), (543,314), (529,342), (554,359) (sûr, données).

Souris : seul le clic gauche (glisser-déposer) joue. Clavier : voir §1 (rien en jeu normal).

Bouton « go » : `10c8:1799` dessine l'image `tBMP 11000` n° 5, 6 (carte, normale / enfoncée) ou 1, 2 (+1 si enfoncé ; 1 = « go » désactivé tant que `[0bf0] == 0`) : formule `iVar1 = 5` (bouton 1) ou `2` (bouton 2, `1` si désactivé), `+1` si enfoncé.

### 4.4 Variables d'écran principales

`[7106]` niveau+1 ; `[0c1c]` N ; `[0c14]` première dalle ; `[0c1e]` dalles de remplissage ; `[7108]`, `[710a]` attributs A et B ; `[710c…]`, `[7116…]` permutations ; `[7120…]` comptes ; `[71a4…]`, `[71ce…]` valeurs exigées ; `[717a…]` occupant de chaque dalle (id de feature, 0 si libre) ; `[0c16]` posés ; `[0c0c]` cran du lion ; `[0c0a]`, `[0c08]` réglages du lion ; `[0bf0]` « go » actif ; `[0bf8]` verrou de saisie ; `[7100]` état de sortie ; `[70fe]` éveil demandé ; `[7102]` feature occupée par une animation ; `[7228]` Zoombini en cours de rejet ; `[7168]`, `[716a]` dalles du rejet ; `[7104]`, `[0c0e]`, `[7222]` demandes de phase au Tick ; `[7224]`, `[7176/78]` file de marche ; `[7240]`, `[723c]`, `[723e]` danse ; `[729a]` pile des positions d'origine (`DS:724a`) ; `[9702]`, `[9704]` sortie en marche / terminée (communs aux épreuves).

## 5. Animations, événements, sons

### 5.1 Événements

Rappel `10c8:1137` (dalles, Zoombini ; événement = octet bas − 1) :

| Arg. | Origine | Action |
|---:|---|---|
| 1 | `SCRB 8200 + 4(s−1)` image 1 (octet 2) | le Zoombini joue `SCRS [0c06]` = 12004 (recul) via `10c8:10d1(1, …)` |
| 2 | `SCRB … + 2` image 1 (octet 3) | le Zoombini joue `SCRS [0c06] + 1` = 12005 (saut vers la dalle correcte) |
| 4 | fin de `SCRS 12005` (octet 5) | `[7222] = 1`, **`[0c0c]++`**, `10c8:1c92([0c0c])` (le lion monte d'un cran) |
| 5 | fin de `SCRB … + 0` (octet 6) | `[0c0e] = 1` (phase 2) |
| 10 | fin de `SCRS 12012` (octet 11) | retour du Zoombini : `[729a]--`, `SCRS 12013` vers l'origine |
| 0x14 | fin de `SCRS 12013`, des scripts lion 6004 à 6010 (octet 21) | `[7102] = 0` ; `[0bf8] = ([0c0c] == [0c0a])` (déverrouille sauf au dernier cran) |
| 0x15 | octet 22 | `[7102] = 0`, `[0bf8] = 1` (en entraînement `[96f2] ≠ 0` : `[9702] = 0`, `[9704] = 1`) |

Rappel `10c8:1245` (lion) : arg 10 (octet 11, fin de `6002`) : `[7100] = 2` ; arg `0x14` : voir §2.6 ; arg `0x15` : verrou.

### 5.2 Scripts

- `SCRB 6000`, `6001` : patte (décor, sprites 14, 15). `6002` (29 images) : éveil final du lion. `6003` : lion de départ. `6004` à `6009` : têtes de plus en plus éveillées (13 à 14 images, sons 6004 et 6005 aux images 1 et 5). `6010` (24 images) : dernier cran (sons 6000, 6008, 6001). `6011`, `6012` : décors fixes.
- `SCRB 7000–7019` : dalle `k` normale (2 images : grise puis dorée, `tBMP 7000` images `k` et `k + 20`). `9000–9019` : dalle `k` allumée. `9025–9028` : remplissage (1 image chacun).
- `SCRB 8200 + 4(s−1)` : retournement de la dalle `s` (17 images, sons 8200, 8201, 8202 aux images 1, 6, 12, événement 2 à l'image 1, 6 à la fin) ; `+1` : poussière associée ; `+2` (14 images, événement 3 à l'image 1, sons 8203, 8204) ; `+3` : poussière associée. La phase 1 (`10c8:0e74(0)`) joue `+0` et `+1` sur la dalle déposée, la phase 2 (`0e74(1)`) joue `+2` et `+3` sur la dalle d'arrivée (sûr pour l'enchaînement ; le détail visuel est probable).
- `SCRS 12004` (5 images) : recul sur la dalle refusée ; `12005` (29 images, son du Zoombini à l'image 10, événement 5 final) : saut vers la dalle correcte ; `12012` / `12013` : chute puis retour ; `13000–13004` : marche. Les `SCRS 12000–12003` et `12008–12011` sont les deux variantes non retenues.

### 5.3 Sons

`\0SND` de l'archive : 6000 à 6008 (lion), 8200 à 8204 (dalles), 8000 à 8004 et 8400 à 8404 (variantes inutilisées), 12000 (Zoombini). Dans `ZOOMBINI.MHK` : 999 (bouton carte), 996 (`0x3e4`, départ en file), 20036 (`0x4e44`, voix attendue avant de quitter), 20045 à 20048 (consolation), 20055 à 20063 (réussite), 20065 (`0x4e61`, mis dans `[a2c4]`). Musique : voir §1.

## 6. Écrit dans le tampon de partie à la sortie

Rien de propre à l'épreuve. Exit `10c8:0945` : `11b8:00e8(1)`, `11a8:021c` (qui appelle **`1168:36e1(0, 1)`**, sauf entraînement), libération des `tBMP`, de l'archive (`11b8:1076`). Selon `screens.md` §3.4 :

- les Zoombinis avec `+0x127 ≠ 0` (posés, ou comptés par `1168:3ead` au « go ») restent dans le groupe ; les autres sont perdus et renvoyés à la réserve du **camp 2** (`S−0x5938`, `S+0x4C += perdus`) ;
- marque de réussite `S+0x56 + (16 − 7) = S+0x5F`, bit `1 << niveau_de_l'étape` ; bit `0x10 << niveau` en plus s'il n'y a aucune perte. **Le code pose le premier bit quelle que soit la sortie** (y compris par le bouton carte) : le texte de `36e1` ne le conditionne pas à un succès (probable ; `screens.md` §3.4) ;
- l'épreuve n'est pas la dernière de l'étape : ni monument ni augmentation du niveau de l'étape ici. Écran suivant : 17 (Smoke), `DS:8556 = 0x11`.

## 7. Points ouverts

1. Le test des 11 rectangles du sol (`DS:0d0a`) : qu'un dépôt sur le sol laisse le Zoombini « libre » (et qu'il soit ensuite repris) est lu dans `10c8:130f` mais n'a pas été vérifié visuellement ; l'effet de `[724a]` (pile de positions) est supposé.
2. Correspondance exacte attribut ↔ nom (cheveux, yeux, nez, pieds) et ↔ images de `tBMP 10000` : l'indice `valeur + 5 × attribut` est établi, pas le nom des attributs (hypothèse commune à toutes les épreuves).
3. Le détail visuel des scripts `8200 + …` (qui fait quoi à chaque image) et le rôle exact des `SCRS 12004` / `12005` pendant le rejet.
4. Une pose correcte déclenche-t-elle un son ? Aucun id n'a été relevé dans `10c8:130f` ; seul le rejet en joue (probable).
5. Les `SCRB 6000–6012` ne sont pas tous référencés depuis `Enter` (le lion de départ `6003` n'apparaît que par `[0c08]`) ; `SCRS 12000–12003`, `12008–12011`, `tBMP 8000`, `tBMP 8400` et `REGS 202` sont des restes (voir §1).
6. Comportement si la valeur d'un attribut vaut 0 ou plus de 5 (jamais produit en jeu).
7. `10c8:2d1c` (affichage de débogage) et la table de touches `DS:1eff` non détaillées.
8. Cohérence du nombre d'exemplaires : au plus 2 Zoombinis identiques dans un groupe (`screens.md` §2.2) ; le tirage n'en dépend pas.
