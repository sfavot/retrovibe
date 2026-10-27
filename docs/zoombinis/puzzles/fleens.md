# Les nizibooms (`FLEENS.MHK`, écran 13) : étude de rétro-ingénierie

Tâche T8. Écran 13 de `ZOOMBINI.EXE` (L'Odyssée des Zoombinis, version 1.0FR), archive `FLEENS.MHK`, première épreuve de l'itinéraire B de l'étape 3 (la forêt de chaussée : nizibooms, hôtel du temps-compté, muraille de signes). Document d'étude seul. Cadre général (table d'écrans, `SCRB` / `SCRS`, `REGS`, RNG, tick) : [../engine.md](../engine.md) ; parcours, niveaux, tampon de partie : [../screens.md](../screens.md).

Conventions : adresses `segment:offset` du code ; `DS` = `1530` (`DS:xxxx`, ou `[xxxx]` seul pour une globale) ; `S+0xNN` = tampon de partie (`[2362]`, [../screens.md](../screens.md) 6.3). Le segment « données du module » `1420` (tableaux locaux de l'écran : `1420:0` handles, `1420:0x20` drapeaux, `1420:0x30+4i` pointeurs `SCRS`) et `1520` / `14c0` (listes d'emplacements de dépose) sont de la mémoire de travail sans valeur initiale. Confiance : **sûr** (lu dans le code), **probable**, **hypothèse**. Le texte parlé (aide, commentaires) n'existe que sous forme de `\0SND` : aucune copy à valider ici.

Les routines de rappel de cet écran (`10e0:0578`, `20ec`, `227e`, `2a06`, `2acb`, `2b90`, `2e44`, `2f0d`) et les corps de `switch` à tables en segment de code (`10e0:2189` à `2fda`) ne sont pas des fonctions du corpus Ghidra : elles ont été lues dans une copie du projet (fonctions créées à la main, désassemblage des cibles de `switch`). Les adresses de ces routines sont donc absentes de `functions.tsv`.

## 0. Résumé

- Le joueur voit ses Zoombinis (jusqu'à 16) sur les terrasses de droite d'une forêt, trois emplacements « spéciaux » en haut (sur la branche aux cocons), et quinze emplacements de dépose sur le chemin en bas à gauche. Il **glisse des Zoombinis sur le chemin** ; une dépose est un « essai ». Le jeu tient un décompte de **trois cocons** (`[7324]` de 0 à 3) : un essai « juste » remplit un cocon. Quand les trois sont remplis, le bouton « Go » (flèche) s'active et mène à l'hôtel (écran 14). **Sûr** pour le mécanisme de comptage ; l'identité de ce qui rend un essai « juste » est discutée en 2.3.
- Règle cachée **sûre** (code `10e0:1b29`) : les attributs affichés d'un Zoombini de l'écran ne sont pas ceux du groupe mais des **attributs décalés** : `T_j = ((a_j + S[0x0C+j] − 2) mod 5) + 1`, avec 4 décalages `S[0x0C..0x0F]` tirés dans [1, 5] ; aux niveaux 2 et 3, les attributs sont en plus **permutés** entre les quatre positions (`S[0x10..0x13]`). Les nouveaux attributs sont réécrits dans le groupe à la sortie (`1168:36e1` relit les octets de l'objet), donc les Zoombinis qui traversent **changent d'apparence** (**probable** : le code de sortie est commun, aucune routine de l'écran ne restaure les attributs).
- Zoombinis perdus : tous ceux qui n'ont pas le drapeau `+0x127` (« placé ») levé à la sortie, **sauf** si l'écran de fin a eu lieu (`2f0d` remet le drapeau à tous). Détail en 2.5 et 6.
- Points ouverts majeurs : sémantique visuelle de « spécial » (qui est spécial et comment le joueur le sait), nombre d'essais acceptés avant échec, règle de remplacement des essais (file de 7).

## 1. Identification

### 1.1 Écran, handlers, archive

Écran 13, descripteur `1530:119c` (table `1530:14fe`, engine.md 2.1). Archive `FLEENS.MHK` (2,7 Mo).

| Rôle | Adresse | Remarque |
|---|---|---|
| Enter | `10e0:00ea` | 993 octets ; ouvre l'archive (chaîne `1530:120a`, handle `[7378]`), crée la scène |
| Exit | `10e0:0600` | libère ; ne fait rien si `[737c]` = 0 (écran jamais complètement entré) |
| Tick | `10e0:06a8` | protégé par `[1200]` (réentrance) et `[737c]` |
| Key | `10e0:0def` | seulement en mode de test (`[a43f]`) : touches `L` / `l` (code 0x4c / 0x6c) → `1198:03cf(niveau+1)` ; code `0x16f` → `11a0:155e` (toujours) |
| Clic (région 1 « carte », 2 « Go », 3 « scène ») | `10e0:0ae5(n)` | pointeur en `DS:1198` du bloc de régions `DS:1190` |
| Initialisation des variables | `10e0:0000` | 234 octets, appelée par Enter |
| Hook de dessin des parties de nizibooms | `10e0:0e54` | dessin des 6 parties d'un objet « Fleen » (tBMP 4000) |
| Hook de tick d'un Zoombini de l'écran | `10e0:0f9f` | animation et idle |
| Hook de bouton (dessin) | `10e0:0578` / `10e0:0596` | `0578` : redessine les deux boutons ; `0596` : rectangles sales |
| Mise à jour des boutons | `10e0:04cb(redessiner, appuyé, bouton)` | bouton 1 « carte » ; bouton 2 « Go » (grisé tant que pas prêt) |
| Fabrication d'un Zoombini de l'écran | `10e0:1b29` (boucle), `10e0:1f25` (création) | 1020 + 172 octets |
| Choix du script d'animation | `10e0:292a(type, objet)` (switch en segment de code) et `10e0:1fd1(type, objet)` | voir 5.2 |
| Chargement d'un `SCRS` dans un objet | `10e0:18a7(…)` et `10e0:1194` (lecture d'une image) | voir 5.1 |
| Rappels d'événements d'animation | `10e0:227e` (général), `215c`, `2a06`, `2acb`, `2b90`, `2d63`, `2e44`, `2f0d` | voir 5.3 |

Le bloc de régions `DS:1190` (`1038:0000(0xc000, 1, DS:1190)`, engine.md 7.1) pointe vers le rectangle de la région « carte » `DS:1114` = (600, 403, 639, 440) et de la région « Go » `DS:1138` = (600, 441, 639, 478) (bas droit de l'écran) ; la troisième région est le reste de la scène. Rectangles lus dans `DS` (**sûr**).

### 1.2 Ressources de `FLEENS.MHK`

| Tag | Ids | Usage |
|---|---|---|
| `tBMP` | 300 | fond 640 × 480 (forêt) ; `SHPL` 300 = palette (couleurs 10 à ~246) |
| `tBMP` | 400 | planche des deux boutons : 1 à 3 = flèche « Go » (3 états), 4 à 6 = rouleau « carte » (3 états) (**sûr** par le dessin `04cb`) |
| `tBMP` | 500 | « terrain » 160 × 120 (`11a8:1783(500)`), déplacements |
| `tBMP` | 1000 | planche du décor animé : branche aux cocons (groupe 0, `SCRB` 1000–1006) ; 1 = branche 147 × 35, 2 à 5 = cocons, 6 à 8 = petites formes |
| `tBMP` | 1100 | une image (groupe 1, `SCRB` 1100) |
| `tBMP` | 1200 | poussière et brillance (groupe 2, `SCRB` 1200–1206) |
| `tBMP` | 4000 | planche de 568 parties de nizibooms (yeux, nez, cheveux, pieds en 5 variantes par partie ; chargée par `11a8:2ae6`, DS `[7396]`), `REGS` 4000 / 4001 = points d'ancrage X / Y (741 mots) |
| `REGS` | 5000 / 5001 | listes de positions : 5000 = 3 points (407,62) (441,63) (473,61) ; 5001 = 17 points de la terrasse (618,65) (591,64) (562,62) (536,68) (616,126) (587,125) (537,131) (603,155) (552,151) (573,157) (516,150) (490,142) (541,222) (490,214) (449,206) (512,226) (467,220) |
| `SCRB` | 1000–1006 | 1000 : branche seule (1 image, position (377, 82), cocon (448, 89)) ; 1001 / 1002 / 1003 : branche avec 1, 2, 3 cocons remplis (12 / 20 / 79 images) ; 1004–1006 : séquences de clôture de l'épreuve (45 / 47 / 45 images, sans partie visible : elles ne portent que sons et événements) |
| `SCRB` | 1100 | 5 images (position (393, 353)) |
| `SCRB` | 1200–1206 | poussière, brillances aux endroits (125,142), (562,137), (304,289)… |
| `SCRS` | 4000–4058 | animations de nizibooms (59 scripts) ; 6000–6004 ; 7000–7045 (46 scripts) ; en tout 110 |
| `\0SND` | 1000–1002, 1200, 1800–1814, 4000–4018, 4100–4124, 7000–7008 | sons ; 1800–1814 : répliques tirées au hasard ; plages préchargées dans `10e0:00ea` (`11a8:313a(flux, haut, bas)`) : 20000–29999 (flux), 1000–1002 (flux), 300–324, 425–499, 99, 375–399, 175–199, 900–944, 7000–7035, 1200–4099 (flux), 4100–4199 |

Ressources communes chargées par l'écran : `ZOOMBINI.MHK` (Zoombinis et voix, plages 99–499 et 20000+), `MIDIMPC.MHK` (musique, ids ≥ 30000). `NODE` / `PATH` : l'écran **n'appelle pas** `1168:2a5c` (non utilisés ici).

Lecture de l'`Enter` (`10e0:00ea`), dans l'ordre (**sûr**) : copie du bloc `DS:11b4` (64 octets : 15 points de dépose, voir 4.3) ; `[737e] = [737c] = 0` ; `10e0:0000` ; `[7370] = 1168:515d()` (niveau) ; préchargements de sons ; ouverture de `Fleens.MHK` ; fond 300 (`11a8:1475`) ; terrain 500 (`11a8:1783`) ; planches 4000 (`[7396]`) et 400 (`[11b0]`) ; groupes de formes 0 (tBMP 1000), 1 (1100), 2 (1200) ; `REGS` 4000 (`[739a]`) et 4001 (`[739e]`) ; `SCRB` 1000 (7 scripts), 1100 (1), 1200 (7) ; les 59 `SCRS` communs `10e0:0ee1` (4000–4058, tableau `1420:0x30+4i`, ids 0 à 58) ; `1168:03ef` / `1168:04d0` (tables de `SCRS` de Zoombinis : `6000` × 5, `7000` × 46 ; le premier paramètre est l'id de départ, le deuxième le nombre) ; création de la branche (`SCRB` 1000, flags `0x108000`, handle `[7322]`), de l'objet de position `DS:11f4` (`SCRB` 1100, flags `0x108a000`), d'un objet « boutons » (hooks `0578` / `0596`, pas de script), des 7 objets de poussière (`SCRB` 1200–1206) ; `1058:048a(236, 10)` ; `1168:0858(0)` (crée les Zoombinis du groupe) ; `10e0:1b29` (transformation, 2.1) ; `1168:2505(0)` ; `1168:274e(200, 45)` ; **animation d'introduction** (voir 5.4) ; régions ; boutons ; `[737c] = 1` ; voix d'aide `[a2c4]` ; `[73a2] = 1168:032c()` (nombre total d'objets Zoombini) ; `[7490] = 8`.

## 2. Règles

### 2.1 Fabrication des Zoombinis de l'écran (`10e0:1b29`, **sûr**)

Soit `n` = nombre de Zoombinis vivants du groupe (`1168:0824`), `a_j` les 4 attributs (1 à 5) de la fiche de chaque membre (octets 0 à 3, voir [../screens.md](../screens.md) 6.3). Si `n = 0` rien n'est créé.

1. **Spéciaux** : `[733a] = rand(1..n)` ; si `n ≥ 2`, `[733c]` = tirage dans [1..n] différent de `[733a]` ; si `n ≥ 3`, `[733e]` différent des deux. Les trois nombres sont des **rangs 1-based dans le groupe**. Effets sur `n < 3` : `n = 1` → `[7324] = 2`, `[7334] = 1` ; `n = 2` → `[7324] = 1`. Donc le nombre de cocons à remplir est `min(n, 3)` et la victoire est `[7324] == 3`.
2. **Règle cachée** : si `S[0x0C] == 0` (jamais tirée) **ou** niveau = 1 **ou** niveau = 3 : pour j = 0..3, `S[0x0C+j] = rand(1..5)`. (Aux niveaux 0 et 2 la règle déjà présente dans la partie est conservée : un deuxième passage au même niveau retrouve la même règle.)
3. **Permutation** : niveau 0 ou 1 : `S[0x10..0x13] = 0` (pas de permutation). Niveau 2 ou 3 : si `S[0x10] == 0` ou niveau = 3, `S[0x10] = k = rand(2..4)` ; masque `1 << (k−1)` ; pour j = 1..3, `S[0x10+j] = p + 1` où `p` est tiré par `1098:0098(0, 4, &masque)` (tirage sans remise parmi {0,1,2,3} privé de `k−1`, donc `S[0x11..0x13]` est une permutation des trois valeurs de {1,2,3,4} \ {k}). Résultat : l'attribut 0 est rangé à la position `k` (2, 3 ou 4), les attributs 1 à 3 occupent, dans un ordre aléatoire, les trois autres positions de 1 à 4.
4. **Attributs affichés** de chaque Zoombini `i` du groupe qui a le drapeau vivant : pour j = 0..3, `T_j = ((a_j + S[0x0C+j] − 2) mod 5) + 1` ; l'objet reçoit `T_j` à la position `π(j)` = `S[0x10+j]` si non nulle, sinon `j+1` (positions 1 à 4 ↔ octets `+0xEC…+0xEF` de l'objet, ou `+0xBC…+0xBF` dans l'enregistrement de création). Un décalage `S[0x0C+j] = 1` laisse l'attribut inchangé ; `S` de 2 à 5 le décale de 1 à 4 crans (cyclique).
5. **Position de départ** : le Zoombini de rang `i+1` (0-based `i`) qui est spécial prend le point suivant de la liste `REGS 5000` ; les autres prennent le point suivant de `REGS 5001` (ordre du fichier ; 17 points, assez pour 16 membres). L'indice de position est stocké en `+0x120` de l'objet (0 à 16 = terrasse, **17, 18, 19 = spéciaux**). Compteur d'idle initial `+0x128 = rand(0..80)` ; `+0x127 = 1` à la création (copié de l'enregistrement, `1168:3dd0(0, 0)` le remet à 0 juste après).
6. **Création** `10e0:1f25` : objet snoid (flags 1), hooks `0e54` (dessin) et `0f9f` (tick), script nul puis `10e0:18a7` avec le script d'attente `SCRS 4000` ; flags de l'objet mis à `0x4000002`. Le handle est rangé en `DS:[2i]` ; `DS:[0x20+i] = 0` (drapeau « essayé »). Les trois spéciaux et trois autres handles sont mémorisés dans `[14a…]` (liste locale `local_14a`) pour des scripts de mise en scène (appels `11a8:2a0a` d'attachement entre objets).

Conséquence **sûre** pour le tampon : `S[0x0C..0x13]` (8 octets, jusque-là inconnus) sont les paramètres de la règle.

### 2.2 Effet de la règle sur le jeu

À l'exécution, les attributs d'un objet ne sont jamais réécrits (aucune écriture aux offsets `+0xEC…+0xEF` dans les routines de l'écran) : le dessin « Zoombini » (moteur commun) et le dessin « nizibooms » (`10e0:1194`, tables `DS:011c`, `0128`, `0134`, `0140` qui indexent, par valeur d'attribut 0 à 5, la partie de la planche 4000) utilisent **les mêmes** valeurs `T_j`. À la sortie, `1168:36e1` recopie `+0xEC…+0xEF` de chaque objet dans la fiche du groupe (octets 0 à 3), donc la règle est **appliquée de manière permanente** aux Zoombinis qui passent (**probable**).

### 2.3 Ce que fait le joueur et ce qui est « juste » (**sûr** pour la mécanique, **hypothèse** pour sa lecture)

Clic (handler `10e0:0ae5(3)`, uniquement si `[7384] == 0` : pas d'animation de séquence en cours, `[9702] < 1` : pas de sortie en cours, `[7324] < 3`) : prend l'objet sous le curseur (`11a8:0d61`) s'il est dans l'état `+0x124 ∈ {0, 6}` (au repos ou idle) :
- objet **pas encore placé** (`+0x127 == 0`) : le marque dans `DS:[0x20+rang] = 1` (« essayé »), lance un **glisser-déposer** `1168:1742` ; le dépôt est valide si `1168:166e() ≠ 0` (la dépose a eu lieu sur un des 15 emplacements). Alors `[7376]` = handle et `[7374]` = id de l'objet. Sinon, s'il a bougé, retour à sa position (`1168:5cd1`, 500 ms, mode 0x10).
- objet **déjà placé** : si `[7382] == 0`, `[96fe] = 1` et glisse-dépose pour le déplacer (le déplacement d'un objet déjà placé ne compte pas comme nouvel essai : le Tick teste `[96fe] == 0`).

Le Tick traite une dépose (`[7376] ≠ 0`, `[96fe] == 0`) : `+0x127 = 1` (placé) ; `[7336] = handle` ; `[7338] = id` (sert de verrou : un seul essai à la fois) ; `[7382] = 1` ; `[235c] = 0` (arrête l'idle des autres) ; pour chaque `r` de 0 à 2 : si `[733a+2r] ≠ 0` et `handle du rang [733a+2r] == [7336]`, alors **`[7324]++`** ; l'essai est enregistré dans la file `[7350+2·[734c]] = id`, `[735e+2·[734c]] = handle`, `[734c]++` ; si `[7324] > 2`, `[96f4] = 1` (aide au dépôt dans `1168:1742`). L'objet joue le script de type 2 (`10e0:292a(2)` : `SCRS 7000 + (attribut 3 − 1)` si `[7334] == 0`, sinon `SCRS 7041 + …`, voir 5.2), rappel d'événements `10e0:227e`.

**Conclusion sûre** : un essai remplit un cocon seulement si l'objet déposé est l'un des **trois rangs tirés** en 2.1.1. **Hypothèse** (non confirmée par le code) : ces trois Zoombinis sont ceux dont l'apparence affichée correspond aux trois nizibooms de la branche ; le joueur doit retrouver, parmi les Zoombinis visibles, ceux qui deviennent ces nizibooms d'après la règle `T`. Le code ne dit pas comment les trois nizibooms de référence sont montrés : ce sont les scripts `SCRS 7000+` / `4000+` joués par les événements de `227e` (4, 5, 6, 7) qui contiennent l'information visuelle, non décodée ici.

Événements de pose et dépose (`10e0:227e`, tables de `switch` à `10e0:28c2`, valeurs de l'événement = octet bas du terminateur − 1, voir engine.md 3.2) :

| Événement | Effet (**sûr**) |
|---|---|
| −1 (fin de script) | `[235c] = 0x40` ; `[7384] = [7382] = [7338] = [7336] = 0` : libère le verrou, reprise de l'idle |
| 0 | bascule `+0xF2` (direction du regard) ; applique la pose en attente `[731e]` (`1168:4dc9`) |
| 4 | `[734a] = 1` ; si le dernier objet placé est dans les positions 0 à 16 (non spécial), prépare une réaction de type 5 |
| 5 | prépare une réaction de type 6 à la position (429, 223) |
| 6 | si l'objet placé est spécial (position 17 à 19) et `1 ≤ [7324] ≤ 3` : le script de la branche `[7322]` passe à `SCRB 1000 + [7324]` (cocons remplis), retire le spécial de la liste, anime les spéciaux restants (type `6 + [7324]`), puis `[737e] = ([7324] == 3)` (bouton Go prêt) |
| 7 | réaction de fin d'essai : type 9 (cas `n = 1`), 11 (3 cocons pleins, décalage (−56, 241)) ou 10 ; `1168:170f(1, 0)` (libère l'emplacement de dépose) ; `[7348] = 1` |
| 8 | l'objet passe en idle (+0x20 |= 0x4000000) |
| 9 | marque la fin du script de réaction |
| 28 (0x1C) | relance avec l'événement 8 |
| 30 (0x1E) | joue au hasard `SCRB 1004 + rand(0..2)` (clôture), rappel `2f0d` |
| 132 (0x84) | si `[7372] ≠ 0` : balaie la file des essais, joue pour chacun un script de type 12 (`SCRS 4040 + attribut 3`), et fait sortir le plus ancien si la file contient déjà 7 éléments (`[734c] == 7`, voir 2.4) |
| 133 / 134 / 135 | réactions de groupe : sélectionne des Zoombinis non essayés (`DS:[0x20+i] < 2`) dont la position est dans [0,3], [4,16] ou [20,25], leur fait jouer un script de type 14 et marque `DS:[0x20+i] = 2` |
| 137 (0x89) | `+0xE0 = 0` : l'objet **disparaît** (désactivé, donc perdu à la sortie) |
| 240–243 | mémorise la pose suivante `[731e] = événement − 239` (déplacement) |
| 250–253 | applique immédiatement la pose `événement − 250` (`1168:4dc9`) |

### 2.4 File d'essais

`[734c]` = longueur de la file ; `[7350..]` ids, `[735e..]` handles (max 7 : le test `[734c] == 7` pose `local_1c`). **Probable** : l'aire de dépose retient les 7 derniers essais ; le huitième repousse le plus ancien, qui rejoue un script de sortie (type 7016 / 7021 : `SCRS 7015+attribut 3` ou `7020+…`) ; le Go lance les scripts de sortie de tous les essais restants (`10e0:2c91`, 2.5).

### 2.5 Fin, erreurs tolérées, Zoombinis perdus

- **Aucune pénalité explicite d'essai raté n'a été trouvée** (**probable**) : un essai non spécial joue une réaction (événement 4/5) mais ne décrémente aucun compteur ; il n'y a pas de variable de « vies ». Le nombre d'erreurs tolérées est donc **illimité** (le joueur peut continuer tant qu'il n'a pas rempli les trois cocons ou quitté).
- **Succès** : `[7324] == 3` (3 spéciaux trouvés, ou `min(n,3)` avec les cocons pré-remplis, 2.1.1) → `[737e] = 1`. L'événement 6 déclenche la séquence de clôture (événement 30 → `SCRB 1004 + rand(0..2)`), qui se termine (événement −1 de `2f0d`) par : `[7380] = 1` (« Go » prêt), **`1168:3dd0(0, 1)`** : tous les objets actifs reçoivent `+0x127 = 1` (max 20), donc **tous les Zoombinis encore actifs sont sauvés** ; commentaire vocal : si `1168:02cc()` (nombre d'objets actifs et marqués) vaut `[73a2]` (aucun disparu), un des ids 20055–20063 (`rand(0x4e57..0x4e5f)`, file « voix ») ; sinon, si `rand(0..4) ≤ niveau` **ou** `(S+0x38 & 0xFFF) > 3`, un id de 20045 à 20048 (musique/voix, file 1) ; ensuite `11a8:20e8([732c])` et `[7320] = 13` (16 membres) ou `n − 8` (si `n > 8`) : plafond du nombre de petites animations d'attente (2.6).
- **Go** (région 2, uniquement si `[737e] ≠ 0` et `[7380] ≠ 0`) : voix 20 004 (`0x3e4`), anime le bouton, `[7346] = 1`, `1168:3dd0(0, 1)`, `[9704] = 0`, `[9702] = [734c]` ; `[8556] = 14` (écran suivant : l'hôtel). Le Tick déclenche `10e0:2c91` : pour chaque essai restant, script de sortie (type 7021 `SCRS 7020 + attribut 3`) et, pour le dernier de la file, type 8 (`SCRS 7025 + …`) avec rappel `2d63` qui (événement 131 / 0x83) relance la file ; la fin est attendue (`[9702] == 0` ou `[9704] ≠ 0` ou `[a406]`, voir 4.2) avant le changement d'écran.
- **Carte** (région 1) : voix 999, `[8556] = 1` : retour à la carte, **abandon** : le groupe est perdu (règle générale, screens.md 3.4). Le bouton est toujours actif.
- **Perdus** : à la sortie (`1168:36e1`, `11a8:021c`), un objet dont `+0x127 == 0` (jamais déposé, et clôture non atteinte) est marqué perdu ; un objet désactivé (`+0xE0 == 0`, événement 137) l'est aussi. Mise à zéro initiale : `1168:3dd0(0, 0)` dans l'Enter donne `+0x127 = 0` à tous les objets actifs. Après la clôture, `+0x127 = 1` pour tous les actifs. Perdus rendus au **camp 1** (`S−0x5B9E`, `S+0x4A += perdus`).
- En **entraînement** (`[22e8] ≠ 0`), l'Exit fait `1168:3e5f(1)` et `3dd0(0, 1)` : tous sauvés.

### 2.6 Animations de décor (idle)

Les spéciaux et les autres objets jouent, quand rien ne se passe (`[7338] == 0`, `[7376] == 0`, `[7380] ≠ 0`, `[734e] < [7320]`, et au moins `[7496]` ticks depuis la dernière : **60** ticks, **120** si `[908a] ≠ 0` (mode lent / modem ?)), une petite animation de « joie » sur un Zoombini tiré par `1098:0098(0, [73a2], &[749a])` (tirage sans remise) : celui doit être actif, de flags 1, et en état de repos ; `292a(5)` donne `SCRS 7030 + attribut 3 − …` ; elle est lancée seulement si `x < 271`. `[734e]` compte ces animations (plafond `[7320]`, 2.5). Idle individuel (`10e0:0f9f`) : un compteur `+0x128` ; au-delà de `[235c] + 16` ticks (`[235c]` = 64 au repos, 0 pendant un essai), tirage `rand(1..100) < 51 → type 2, sinon type 3` (scripts `SCRS 4000` ou `4001`, **sûr** par `1fd1`), puis `+0x128 = 1`.

## 3. Niveaux de difficulté

Niveau lu par `1168:515d` (0 à 3 en aventure ; `[96f2] − 1` en entraînement). **Seuls effets trouvés** (**sûr**) :

| Niveau | Règle cachée | Permutation | Effet sur la voix d'aide `[a2c4]` |
|---|---|---|---|
| 0 | tirée une fois, conservée tant que `S[0x0C] ≠ 0` | aucune (`S[0x10..0x13] = 0`) | 20079 (`0x4e6f`) |
| 1 | retirée à chaque entrée | aucune | tirage 20079 ou 20080 |
| 2 | conservée ; **permutation** tirée une fois (`S[0x10] == 0`) | oui | 20079 |
| 3 | retirée à chaque entrée, **permutation** retirée à chaque entrée | oui | tirage 20079 ou 20080 |

Dans tous les cas, si `1168:5c57(S+0x38) == 2` (premier passage ?), la voix d'aide est 20080 (`0x4e70`). `10e0:2f0d` : probabilité du commentaire de perte = `rand(0..4) ≤ niveau`. Il n'y a **pas** d'autre paramètre qui varie : nombre de spéciaux (min(n,3)), nombre de positions (20), file (7), cadence (60 / 120 ticks) sont identiques à tous les niveaux. Le nombre de décalages possibles par attribut est 5 et la règle porte toujours sur les 4 attributs (même si un décalage vaut 1 : attribut inchangé).

## 4. Déroulé et état

### 4.1 Variables de l'écran (segment de données)

| DS | Rôle (noms inventés) |
|---|---|
| `7370` | niveau (0–3) |
| `7378` / `737a` | handle de l'archive |
| `737c` | écran entré (1 après l'Enter ; garde du Tick et de l'Exit) |
| `737e` | 3 cocons remplis (bouton Go grisé tant que 0) |
| `7380` | séquence de clôture terminée (bouton Go autorisé) |
| `7382` | un essai est en cours (verrou) |
| `7384` | animation d'introduction ou de séquence en cours |
| `7322` | handle de la branche (script 1000 + `[7324]`) |
| `7324` | cocons remplis (0–3) ; démarre à 2 (`n = 1`), 1 (`n = 2`), 0 sinon |
| `7334` | 1 si `n = 1` (variante du script d'essai) |
| `733a`, `733c`, `733e` | rangs 1-based des spéciaux (0 = absent) |
| `7336`, `7338` | handle / id de l'objet en cours d'essai |
| `7374`, `7376` | id / handle déposés, à traiter par le Tick |
| `7350[7]`, `735e[7]` | file des essais (ids, handles) ; `734c` longueur |
| `736c`, `736e` | id et handle du plus ancien essai éjecté |
| `731e` | pose en attente (0 = aucune) |
| `7340`, `7342`, `7344`, `7346`, `7348`, `734a` | drapeaux d'événements (voir 4.2) |
| `7320`, `734e` | plafond et compteur des animations de joie |
| `7490` | compte à rebours de l'ouverture (8) : un son d'ambiance par tick, `10e0:0f51(0xfdb − n)` charge le `SCRS` `4059 − n`… (voir points ouverts) |
| `7496` | délai entre deux animations de joie : 60 ou 120 ticks |
| `749e` | `n` : nombre de Zoombinis vivants |
| `73a2` | nombre d'objets Zoombini |
| `a2c4` | id de voix d'aide (bouton « ? » commun) |
| `1200` | garde de réentrance du Tick |
| `1420:0` à `1420:0x1f` | handles des 16 objets ; `1420:0x20…` états d'essai |

### 4.2 Machine à états du Tick (`10e0:06a8`)

Chaque tour, si `[1200] == 0` et `[737c] ≠ 0` (garde) :
1. `11a8:04b9()` (pompe d'animations).
2. **Sortie demandée** (`[8556] ≠ 0`) : attend la fin du son 20 036 / `0x4e44` (`1028:0d9e`) ; selon `[a2de]` : 0 ou 3 (3 : `3dd0(0, 0)` d'abord) → si `[a406] ≠ 0` ou `[9702] == 0` ou `[9704] ≠ 0`, `[8554] = [8556]`, `[8556] = 0`, `11b8:0011(0, 0)`, `10e0:0600()` : fin ; `[a2de] == 2` : annule la sortie.
3. Si `[7338] == 0` (pas d'essai) : si `[7376] == 0` : animation de joie (2.6) ; sinon traitement de la dépose (2.3).
4. `[7342]`, `[7340]`, `[7344]` (déposés par les rappels `2a06`, `2acb`, `2b90`) : jouent à tour de rôle une animation de réaction sur le dernier objet essayé (types 3, 9, 4).
5. `[7346]` ≠ 0 : `10e0:2c91()` (sorties de file après Go).
6. `[7490] ≠ 0` : `10e0:0f51(0xfdb − [7490])` puis décrémente (8 tours : chargement progressif d'animations d'ambiance, **hypothèse**).
7. `1108:035b()` (service commun).

Clic (`10e0:0ae5(n)`) : `n = 1` carte, `n = 2` Go, `n = 3` scène ; Key `10e0:0def`. Si `[8556] ≠ 0` au moment du clic : sortie en cours, `[8554] = [8556]`, `[8556] = 0`, `10e0:0600()`.

### 4.3 Zones

- 3 points spéciaux en haut à droite, 17 points de terrasse à droite : zones de départ (listes `REGS` 5000 / 5001, 2.1.5).
- **15 emplacements de dépose** en bas à gauche (copiés de `DS:11b4` dans un tampon de 64 octets, enregistrés par `11a8:0ed9(1, tampon, 16)`) : (238,368), (185,417), (155,448), (197,396), (160,357), (164,384), (150,416), (116,357), (130,386), (109,418), (117,448), (74,348), (89,384), (67,418), (76,450). Aucun n'est « juste » ou « faux » : ils sont équivalents (**probable**).
- Boutons : « carte » (600,403)-(639,440), « Go » (600,441)-(639,478).
- Pas de clic droit, pas de touche utile hors mode de test.

## 5. Animations et sons

### 5.1 Scripts

Le dessin d'un Zoombini de l'écran se fait par `10e0:1194` : lit l'image courante d'un `SCRS` (jusqu'à 6 parties), traduit chaque partie `w` en un indice de la planche 4000 par `index = (valeur d'attribut sélectionnée + w) × 2 − 1` (tables par attribut `DS:011c`, `0128`, `0134`, `0140`, quatre cas de « pose » selon le second mot d'en-tête du `SCRS` : 0, 1, 2, 3 déterminent quelles parties sont masquées, ex. pose 0 : pas de partie « avant »), puis soustrait les points d'ancrage `REGS 4000` / `4001`. Les terminateurs `0xFF00 | n` donnent l'événement `n − 1` du tableau 2.3 ; `< −0x100` : id de son qui suit. **Sûr** pour la structure ; les valeurs des tables `DS` de variantes sont lisibles dans `DS` mais non reportées ici.

### 5.2 Choix du script (`10e0:292a(type, objet)` / `10e0:1fd1`)

Soit `a` = attribut 3 de l'objet (octet `+0xEF`, de 1 à 5) et `pos` = `+0x120` (indice de position).

`292a` (SCRS de comportement, après lecture du `switch` `10e0:29e2`) :

| type | script `SCRS` |
|---|---|
| 1 | 7035 + a (7036–7040) : introduction de l'objet 0 |
| 2 | `[7334] == 0` : 7041 + a − 1 ; sinon, `[7324] == 3` : 7005 + a − 1, sinon 7000 + a − 1 : réaction d'essai |
| 3 | 7010 |
| 4 | 7010 + a |
| 5 | 7030 + a |
| 8 | 7025 + a (sortie du dernier essai) |
| 9 | 5999 + a (6000–6004) |
| 7016 | 7015 + a (7016–7020) |
| 7021 | 7020 + a (7021–7025) |

`1fd1` (SCRS d'état) : 1 / 2 : 4000 ; 3 : 4001 ; 4 : 4002 ; 5 : 4003 ; 6 : `4004 + pos` si `pos ≤ 16`, sinon `4000 + pos` ; 7 / 8 : `4020 + 2·(pos − 17)` (+1 pour le type 8) pour `pos` de 17 à 19 ; 9 / 10 / 11 : `4025 + a`, `4030 + a`, `4040 + a` ; 12 : `4040 + a` ; 13 : `4045 + a` ; 14 : 4058 (`pos < 4`), 4057 (`pos < 12`), 4056 (`pos < 17`), sinon `4050 + a`. Ce sont les scripts joués par les événements du tableau 2.3.

### 5.3 Sons connus

Voix du narrateur et commentaires en `ZOOMBINI.MHK` (plage 20000+) : 20036 attendue avant la sortie ; 20 004 au clic sur « Go » ; 999 au clic sur « carte » ; 20045–20048, 20055–20063, 20079, 20080 (2.5, 3). Sons d'archive : 1000–1002 (musique de forêt, flux), 1800–1814 (répliques aléatoires), 4000–4018 et 4100–4124 (effets de nizibooms), 7000–7008 (poussière). Les sons joués par un script sont ceux du mot qui suit le terminateur ; non catalogués ici.

### 5.4 Introduction (`10e0:00ea` fin)

`1168:274e(200, 45)` échelonne l'arrivée (retard des objets de la file de départ) ; puis le premier objet du groupe (`1420:0`) joue le type 1 (`SCRS 7035 + a`), rappel `10e0:227e`, `[7384] = 1` ; `[9702]` décrémenté si > 0. Le verrou `[7384]` tombe à la fin du script (événement −1).

## 6. Tampon de partie à la sortie

- `S+0x0C..0x0F` (règle) et `S+0x10..0x13` (permutation) : écrits à l'Enter (2.1), conservés dans la sauvegarde. **Sûr**.
- Groupe courant (`S−0x56D2…`) : reconstruit par `1168:36e1` ; attributs = ceux de l'objet (donc transformés, **probable** 2.2) ; fiche[8] = 1 si `+0x127 ≠ 0`, 0 sinon (perdu).
- `S+0x5C |= 1 << niveau` (réussite de l'épreuve, écran 13 : `S+0x56 + 6`) ; si aucun perdu : `S+0x5C |= 0x10 << niveau` (marque « sans perte ») ; la progression d'étape (`S+0x52`, monument, niveau + 1) n'est faite qu'à la dernière épreuve (écran 15). Règles communes : [../screens.md](../screens.md) 3.4.
- Perdus rendus au camp 1 (`S+0x4A += perdus`).
- `S+0x38` (mémoire de dialogue de l'écran, 16 bits, `S+0x28 + 2 × (écran − 5)`) : lue par `1168:5c57` (premier passage ? voir 3) ; non écrite par cet écran.

## 7. Points ouverts

1. **Qui est spécial et comment le joueur le sait** : le code montre que 3 rangs aléatoires du groupe sont « corrects » et que les trois sont dessinés en haut (positions 17–19) ; il n'est pas prouvé que ces positions soient une aide visuelle, ni comment les trois nizibooms de référence sont affichés. À trancher en décodant les `SCRS` 7000–7045 et en observant le jeu.
2. **Permanence de la transformation** (2.2) : l'objet porte `T(a)` en permanence ; à vérifier en jeu que le groupe d'après a bien changé d'apparence.
3. **Aucune pénalité d'erreur** trouvée : confirmer qu'il n'y a pas de limite d'essais.
4. **File de 7 essais** (2.4) : sens exact du remplacement, et lien avec `[9702]` / `[9704]` à la sortie.
5. Lecture de `[7490]` / `10e0:0f51` (chargement des 8 premiers `SCRS` d'ambiance), rôle de `[a2c4]` (aide), de `[908a]`, et du `SCRS` de pose (second mot d'en-tête 0 à 3) pour le dessin des parties.
6. Valeur exacte des tables `DS:011c`…`0140` (index de partie) ; positions des parties dans la planche 4000 (568 images).
7. Écrits de l'écran non étudiés : événements 2, 3, 10, 11, 19 (`26be` : sans effet), 133–135 (groupes), 137 ; rappels `20ec` (réactive deux objets sur événement 136), `2e44`.
