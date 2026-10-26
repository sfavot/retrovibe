# SWIV 3D : objets, comportements, IA, chemins et collisions (`SWIV_WIN.EXE`)

Rétro-ingénierie des objets du jeu : tout ce qu'un moteur doit reproduire pour les types présents dans `TERRAN00` à `TERRAN03` et `DEMO`. Complète `slv.md` (format du bloc 105 des niveaux), `models.md` (modèles 3D) et `re-index.md` (fonctions nommées). Le joueur (formes 990/991, armes, HUD) relève de `player.md` et `rules.md`.

Légende : **(confirmé)** = lu dans le désassemblage / la décompilation ; **(hypothèse)** = déduit (forme des données, usage, nom probable). Les adresses sont des adresses linéaires de `SWIV_WIN.EXE` (base `00400000`). `REC[i]` désigne le champ `i` (u32) de l'enregistrement de 64 octets du bloc 105. Notation du pseudo-code : `o.xxx` = champ de l'objet à l'offset `+xxx`.

Méthode : le compilateur (Watcom, sans optimisation) laisse un code très lisible, mais Ghidra n'a pas isolé les ~80 fonctions de comportement (`00446… – 00452…`, « instructions hors fonction » de `disasm.txt`). Elles ont été lues dans le désassemblage avec un traducteur jetable (désassemblage → pseudo-C), puis recoupées avec les données réelles des niveaux (extraction des types, des champs et des nœuds avec un script jetable).

## 1. Résumé pour l'auteur du moteur

- Tout est un **objet** de 0x70 octets (28 champs de 4 octets, voir §3), dans un pool de 3 000 emplacements, rangé dans une **grille de 64 × 64 cellules** de 512 unités. Les niveaux n'ont que 581 à 827 objets : le pool sert surtout aux projectiles, éclats et fumées.
- Un objet = `classe` (bits de comportement, 0 = libre), `pv`, `modèle`, position/vitesse en virgule fixe 24.8, cap sur 512 pas, et un **pointeur de fonction de mise à jour** (`+0x68`). Il n'y a pas de table « type → comportement » à l'exécution : le type du bloc 105 n'est lu qu'à la création (§4), qui fixe classe, pv, modèle et fonction.
- Les comportements « intelligents » sont des **machines à états** écrites objet par objet (états dans `+0x50`, minuteurs dans `+0x14` / `+0x18`). Les ennemis visent le joueur le plus proche, tirent selon un **programme d'arme** (§8), suivent des **nœuds de route** (bloc 107) et meurent en faisant de la **monnaie de dégâts** : à chaque contact, les deux objets perdent `min(pv_a, pv_b, 100)` (§10). Un projectile n'est donc qu'un objet dont les pv valent les dégâts.
- Rien n'est instancié à la volée par distance, sauf les générateurs (§7). Tous les objets du bloc 105 existent dès le chargement ; seuls ceux situés dans l'anneau de cellules autour d'un joueur sont mis à jour (§2).
- Le monde est torique pour les **positions** (masque 2²³ sur x et z) et pour la **grille** (`& 63`), mais **aucune distance n'est calculée « en tore »** : deux objets de part et d'autre de la couture 0 / 32768 ne se voient pas (§10.5).

## 2. Boucle de mise à jour (confirmé)

`gm_game_tick` (`0043c234`) appelle `0042a084` (mode solo, `DAT_00480c50 == 0`) ou `0042a940` (réseau : toutes les 4 096 cellules, sans anneaux), puis fait avancer les joueurs (struct de 0x228 octets, hors objet standard, fonction en `+0xa8`).

`0042a084` dans l'ordre :

1. **Cellules actives.** Pour chaque joueur (liste `005af3ac`), on parcourt un carré de 11 × 11 cellules centré sur sa cellule (`(x >> 17) - 5 …`), et pour chacune on lit le mode dans la table `00480c90` (11 × 11 u32) :

   ```
   2 2 2 1 1 1 1 1 2 2 2
   2 2 1 1 0 0 0 1 1 2 2
   2 1 1 0 0 0 0 0 1 1 2
   1 1 0 0 0 0 0 0 0 1 1
   1 0 0 0 0 0 0 0 0 0 1
   1 0 0 0 0 0 0 0 0 0 1      (ligne centrale = celle du joueur)
   1 0 0 0 0 0 0 0 0 0 1
   1 1 0 0 0 0 0 0 0 1 1
   2 1 1 0 0 0 0 0 1 1 2
   2 2 1 1 0 0 0 1 1 2 2
   2 2 2 1 1 1 1 1 2 2 2
   ```

   Mode 0 = cellule « proche », 1 = cellule « moyenne », 2 = ignorée. Avec plusieurs joueurs, le mode minimal gagne. Une liste annexe (`0058770c`, 16 enregistrements `x, z, durée, drapeau`) ajoute des zones temporaires (utilisée par la caméra de scénario `00446a7c`).
2. **Cellule en mode 0**, pour chaque objet de la cellule (la liste de la cellule est détachée puis les objets sont réinsérés selon leur nouvelle position) :
   - si `o.+6 & 0x20` (gelé) : rien ; sinon `pos += vitesse` (`+0x1c += +0x28`, `+0x20 += +0x2c`, `+0x24 += +0x30`), **puis appel de la fonction `+0x68`** avec l'objet dans EAX, puis `x`, `z` repliés (`mot haut & 0x7f`, soit modulo 2²³ = 32 768 unités = 512 cellules) ;
   - `o.+0x18 += 1` (âge), même pour un objet gelé ;
   - classe 0 → l'objet est libéré (queue de la liste libre `00587700`, tête = `005876d4` : allocation FIFO) ;
   - puis **collisions de la cellule** (§10) : toutes les paires de la même cellule.
3. **Cellule en mode 1** : pour chaque objet, `o.+6 &= ~0x02` ; si `classe & 0x20` est faux, simple réinsertion ; sinon la classe est **mise à -1** avant l'appel de `+0x68`, et si elle vaut toujours -1 au retour l'objet est **supprimé**. Les fonctions de comportement testent `classe == -1` en tête et se contentent de libérer leurs ressources (ex. compteur de nœud, §9) : c'est le **dépeuplement** des objets créés dynamiquement (projectiles, avions, chars des fabriques ; tous ont le bit `0x20`) quand ils quittent la zone proche. Les objets posés par le niveau n'ont pas `0x20` : hors de la zone proche ils sont simplement figés (aucune mise à jour) et reprennent quand un joueur revient.

Conséquences pour un moteur : pas de « rayon d'activation » par objet ; la zone active (mode 0) est un octogone de **±4 cellules de 512 unités** autour de la cellule du joueur (soit de 1 800 à 2 300 unités selon la position dans la cellule, 28 à 36 cellules de carte), entourée d'un anneau de dépeuplement (mode 1) jusqu'à ±5 cellules ; au-delà, tout est gelé. L'ordre de traitement des cellules est celui de découverte ; l'ordre dans une cellule est celui de la liste (insertion en tête, donc inversé à chaque image).

## 3. L'objet (0x70 octets, confirmé)

Créé par `gm_object_init` (`004265ec`) ou cloné d'un parent par `004261a0` (§4). Offsets en octets.

| Offset | Champ | Sens |
|---|---|---|
| `+0x00` | `next` | objet suivant dans la liste de la cellule (grille `0056b2d8`, index `((x >> 17) & 63) + ((z >> 11) & 0xfc0)`) |
| `+0x04` | `classe` | bits de comportement, **0 = emplacement libre**, voir ci-dessous |
| `+0x06` | `drapeaux` | octet bas : `0x01` texture non animée, `0x02` éclair de dégât (rendu plein feu, effacé à chaque image en mode 1), `0x04` **invulnérable** (aucun dégât de contact), `0x08` pas de recul, `0x80` « neuf » (posé à la création) et `0x100` « touché » (posé par un contact), tous deux lus par la synchronisation réseau (`0042a940`), `0x10` posé par le canon `3001` (rôle inconnu), `0x20` **gelé** (ni déplacement ni fonction). Un contact efface `0x20` |
| `+0x08` | `pv` | points de vie ; ≤ 0 = mort (traité par la fonction elle-même) |
| `+0x0c` | `param` | vitesse/poussée propre au type : `REC[8]` pour les véhicules (poussée `3 × param`), `REC[15]` pour les avions des hangars et fabriques |
| `+0x14` | `minuteur` | initialisé à 10 ; **recharge d'arme** et délais (décrémenté par la fonction de comportement) |
| `+0x18` | `âge` | images depuis la création (ou depuis la dernière remise à 0 par le comportement : cadence de ciblage, de génération) |
| `+0x1c, +0x20, +0x24` | `x, y, z` | position en 24.8 (`unité d'objet << 8`), y vers le haut |
| `+0x28, +0x2c, +0x30` | `vx, vy, vz` | vitesse (1/256 unité par image) |
| `+0x34` | `cap` | 512 pas par tour. Vecteur avant : `(SIN(cap), COS(cap))` sur `(x, z)` |
| `+0x38`, `+0x3c` | `tangage`, `roulis` | mêmes unités |
| `+0x40` | `nœud` | indice du nœud courant du bloc 107, -1 au départ (§9) |
| `+0x10`, `+0x44`, `+0x48` | - | jamais lus par les comportements étudiés (`+0x44` reçoit l'argument `param2` de `gm_object_init`, 0 partout ; `+0x10` et `+0x48` ne sont pas écrits) |
| `+0x4c` | `modèle` | `< 10000` : modèle 3D `005b09b0[id]` (bloc `10000 + id`) ; `≥ 10000` ou 0 : sprite ou rien (rayon de collision forcé à 100). Ex. `0x2710` = 10000 : sprite de balle ; `0x2af8-0x2afc` = 11000-11004 : explosions et fumées |
| `+0x50` | `état` | état de la machine à états **ou** image du sprite (explosions, fumées) **ou** numéro de pièce enfant |
| `+0x54` | `sous-type` | `REC[7]` : code d'arme (100-701), bonus porté (1000-1999) ; pour un projectile, rien |
| `+0x58` | `cible` | cible courante ; = soi-même quand il n'y en a pas. Après un contact : **racine du dernier agresseur** (crédit de score) |
| `+0x5c` | `propriétaire` | racine (parent, joueur) ; = soi-même à la création, = le parent pour un enfant ou un projectile |
| `+0x60` | `chaîne` | liste temporaire des résultats de requête de grille (`0042ae7c`) |
| `+0x64` | `REC` | pointeur sur l'enregistrement du bloc 105 d'origine (les fabriques et hangars relisent leurs paramètres 11-15 à chaque génération) |
| `+0x68` | `update` | **fonction de comportement** (EAX = objet) |
| `+0x6c` | - | -1 à la création (index réseau) |

**Le type du bloc 105 n'est pas conservé** dans l'objet : seul `+0x64` pointe sur l'enregistrement (`REC[0]` = type) pour les objets posés par le niveau ; les clones (tourelles, projectiles…) n'ont plus d'identité que par leur modèle, leur classe et leur fonction.

Dans la structure joueur (0x228 octets), `+0x108`/`+0x10c`/`+0x110` sont le score cible / affiché / de niveau, `+0x118` le niveau de la jauge de pv (écrit par `0043c234`), `+0x128 + 4·i` les munitions, `+0x194`/`+0x198` les bonus dropés / posés ramassés, `+0x1bc…0x1c8` les 4 chasseurs de `6300`. Hors de ce document (voir `player.md`).

### Bits de classe (`+0x04`)

Confirmés par les tests du code ; les bits « décor » viennent des seules constantes de création.

| Bit | Rôle |
|---|---|
| `0x0001` | objet vivant (classe 0 = libre) |
| `0x0002` | **corps solide** : participe aux poussées et aux dégâts de contact (§10) ; les projectiles, les chars, les joueurs, les avions actifs l'ont |
| `0x0004` | cible des ennemis : le joueur (`0x207` / `0x217`) ; masque de ciblage `mask=4` (`00443938`) |
| `0x0008` | **dangereux** : un contact avec lui inflige des dégâts même si l'autre n'est pas solide (projectiles, éclats) |
| `0x0010` | en vol (joueur `0x217`, avions actifs, hélicoptère qui décolle) |
| `0x0020` | dépeuplable : appelé en mode 1 avec classe -1 (§2) |
| `0x0040` | **ignoré** de toutes les collisions (fumées, épaves, bonus, décalques) |
| `0x0080` | observé sur `2002` (arbres plats), sans test dans le code lu (hypothèse : sprite à face unique) |
| `0x0200` | joueur ; `0x20c == 0x204` = joueur éligible au score |
| `0x0800`, `0x1000`, `0x4000` | non testés au combat : lus par le **radar** (`004362b8` : masque `0x787f`). `0x1000` + `0x1/0x3/0x13/0x23/0x33` = unité ennemie (point rouge `0x107f`) ; classe 1 = cible fixe (`0x147f`) ; `0x4000`/`0x0800` = décor, pas de point |
| `0x2000` | membre d'un **groupe d'objectifs** (posé par `0043cda4`) |

## 4. Création des objets (confirmé)

### 4.1 `gm_object_init` (`004265ec`) et ses enveloppes

Convention Watcom : EAX = objet, EDX = classe (`+4`), EBX = pv (`+8`), ECX = modèle (`+0x4c`), pile = `(mode, x, y, z, cap (+0x34), param2 (+0x44), update (+0x68))`. Enveloppes : `00426814` (alloue dans la liste libre `005876d4` puis appelle `gm_object_init`), `00426890` (idem sans test du mode réseau 2).

Placement vertical selon `mode` :

| Mode | Hauteur `y` |
|---|---|
| 0 | `terrain(x, z) + y × 256` |
| 1 | `x, y, z` bruts (déjà en 24.8) |
| **2** | **`terrain(x, z) − modèle[+0x10] × 256`** : le pied du modèle touche le sol (l'argument `y` est ignoré). **Seul mode utilisé pour les objets du niveau** |
| 3 | sol, puis **creuse un cratère** (`gm_terrain_crater`) |

Ensuite : `x`, `z` repliés (`& 0x7f` du mot haut), `+0x14 = 10`, vitesse et angles 0, `+0x40 = -1`, `+0x58 = +0x5c = soi`, `+0x6c = -1`, `+0x06 |= 0x80`, insertion dans la cellule.

### 4.2 `004261a0` : cloner un enfant

EAX = classe, EDX = pv, EBX = **modèle parent** (copie de 0x70 octets : position, vitesse, cap, pv, cible… héritées), ECX = modèle de l'enfant, pile = update. Remet `+0x18 = 0`, `+0x40 = -1`, `+0x50 = +0x54 = 0`, `+0x5c = parent`, `+0x6c = -1`. L'enfant naît donc **à la position et au cap de son parent** (tourelles, roues, antennes, projectiles, avions des hangars).

### 4.3 Champs de l'enregistrement du bloc 105 (confirmé)

`gm_level_spawn_objects` (`0043e958`) lit les enregistrements jusqu'au type `-1`. Pour les types des niveaux livrés :

| Champ | Sens (confirmé sauf mention) |
|---|---|
| `REC[0]` | type |
| `REC[1]`, `REC[2]` | `x`, `z` (unités d'objet) |
| `REC[3]` | cap initial (`+0x34`) |
| `REC[4]` | **modèle du corps** (`+0x4c`) ; modèle des avions engendrés pour `6300` ; non lu pour `1000-1002` |
| `REC[5]` | **modèle de l'enfant** (tourelle, antenne, bonus). Pour `2000` : modèle du **bonus largué** si `REC[7] ∈ [1000, 2000[`. Pour `7000`/`7002` : modèle du bonus |
| `REC[6]` | **pv** du corps ; l'enfant reprend les mêmes pv |
| `REC[7]` | sous-type : **code d'arme** des tourelles, chars, bateaux, avions (§8) ; **bonus** `1000 + n` (porté ou posé) ; **groupe d'objectifs** `5000 + g` (`g` de 0 à 9, §11) ; aucune autre valeur n'est lue |
| `REC[8]` | `+0x0c` : vitesse/poussée (chars, bateaux : 0, 40 ou 50) |
| `REC[9]`, `REC[10]` | **non lus** par le jeu (`REC[10]` recopie l'indice de la carte 102 sous l'objet dans 84 % des cas : valeur d'éditeur, hypothèse) |
| `REC[11]` à `REC[15]` | paramètres des **fabriques et hangars** (`6000` : modèle du char, modèle de la tourelle, pv, arme, vitesse ; `6100-6110` : modèle de l'avion, -, pv, arme, vitesse ; `6300` n'en lit aucun) |

Le champ `REC[7]` n'est donc **pas** un « sous-modèle `REC[7] - 5000` » (affirmation de `slv.md`) : c'est un groupe d'objectifs quand il vaut 5000-5009 (`0043cda4`).

### 4.4 Table de création par type

`Cl.` = classe initiale (`+0x04`), `pv` = `+0x08`, `Upd` = fonction `+0x68`. « Enfants » = objets clonés avec `004261a0`.

| Type | Cl. | pv | Modèle (`+0x4c`) | Upd | Enfants (classe / modèle / upd) |
|---|---|---|---|---|---|
| 1000 | (forme) | profil (`profil+0x3c`) | 0, puis 990/991 | joueur | struct joueur 0x228 (pool `005a936c`) ; forme = `profil+0x38` (`0043de0c`) ; créée si le compteur de joueurs `00484204` vaut 0 |
| 1001 | `0x40` (forme 42) | profil | 990 | `00449af8` | démo : joueur piloté |
| 1002 | (forme 43) | 300 puis profil | - | - | non présent ; crée aussi un compagnon `0x3df` ; départ scripté `00438744` (`player.md` §3.12, non porté) |
| 2000 | `0x0001` | `REC[6]` | `REC[4]` | `00446d24` | - |
| 2001 | `0x0841` | `REC[6]` | `REC[4]` | `00446d24` | non présent |
| 2002 | `0x4081` | `REC[6]` | `REC[4]` | `00446d24` | - |
| 2003 | `0x4001` | `REC[6]` | `REC[4]` | `00446d24` | - |
| 2004 | `0x0001` | `REC[6]` | `REC[4]` | `00446d24` | antenne `0x40`/`REC[5]`/`0044de9c` (non présent) |
| 3000 | `0x4801` | `REC[6]` | `REC[4]` (400) | `00446d24` | tourelle `0x1001`/`REC[5]` (401)/`0044ac88`, arme `REC[7]`, param `REC[8]` |
| 3001 | `0x1001` | `REC[6]` | `REC[4]` (402) | `0044b848` | - (arme `REC[7]`) |
| 4001 | `0x1001` | `REC[6]` | `REC[4]` (100) | `0044e438` | - |
| 4002 | `0x1001` | `REC[6]` | `REC[4]` (103) | `0044e758` | - (arme `REC[7]`) |
| 5000 | `0x1003` | `REC[6]` | `REC[4]` (200, 203) | `0044bca8` | tourelle `0x1003`/`REC[5]`/`0044d470`, arme `REC[7]` |
| 5002 | `0x1003` | `REC[6]` | `REC[4]` (204) | `0044bca8` | 4 roues `0x40`/984/`004450c4` (états 0-3) + tourelle `REC[5]` (205) |
| 5500 | `0x1003` | `REC[6]` | `REC[4]` (300) | `0044cf1c` | tourelle `0x1003`/`REC[5]` (301)/`0044d470` |
| 6000 | `0x0001` | `REC[6]` | `REC[4]` (515, 501) | `0044d804` | - (génère des chars, §6.7) |
| 6100 | `0x0001` | `REC[6]` | `REC[4]` (507) | `0044df98` | antenne `0x40`/`REC[5]` (508)/`0044de9c`, état 1 |
| 6101 | `0x0001` | `REC[6]` | `REC[4]` (507) | `0044e0f8` | antenne, état 2 |
| 6110 | `0x0001` | `REC[6]` | `REC[4]` (509) | `0044e2d8` | antenne (510), état 3 |
| 6300 | `0x40` | 100 | 0 (invisible) | `0045199c` | - (génère des chasseurs, §6.9) |
| 7000 | `0x0841` puis `0x41` | `REC[6]` | décor `REC[4]` puis bonus `REC[5]` | `00446d24`, `004469fc` | deux objets indépendants (§6.10) |
| 7001 | `0x0841` | `REC[6]` | `REC[4]` | `004468cc` | non présent |
| 7002 | `0x0841` | `REC[6]` | `REC[4]` | `00446964` | bonus `REC[5]` créé plus tard |
| 7010 | `0x0001` | `REC[6]` (puis 1 000) | `REC[4]` (504) | `004482dc` | - |
| 7011 | `0x0001` | idem | `REC[4]` (504) | `004482dc` | hélicoptère posé `0x40`/990/`0044822c`, `cap + 64`, `y + 10000/256`, reculé de 32 unités |

`2000` et `2004` incrémentent le compteur `005b03f4` (« porteurs de bonus ») si `REC[7] ∈ [1000, 2000[` ; `7000/7001/7002` incrémentent `005b03d8` (bonus posés). Ces deux compteurs servent au pourcentage de l'écran de fin de niveau (`004194b0`).

Types absents des niveaux livrés mais câblés dans le même `switch` (code présent, comportements non lus ici sauf mention) : 2001, 2004, 3002 (hélicoptère-tourelle `0044b178` + `0044b310`), 5001/5003 (`0044cc78`), 5004/5005 (bateaux/chars à 2 canons `0044c41c`), 5501 (`0044d218`), 6200 (`0044edc8`), 7001, 7012/7013 (variantes de pad), 7800-7801 (caméra de scénario `00446a7c`, `REC[7]` = numéro de caméra), 7900 (hauteur de référence `005b03cc`), 8000-8040 (boss à segments : `0044fef0`, `004505dc`, `00451100`, `00451b10`, `00452398` ; leur mort passe par `gm_object_explode` ; **non portés**, absents des niveaux livrés : `test/swiv3d/level.test.ts`), 14000 (`0044b9d4`), plus les formes de joueur 42/43.

## 5. Table des types présents

Nombres d'objets par niveau (vérifié sur les fichiers) : `T00 / T01 / T02 / T03 / DEMO`. Pv = `REC[6]` observés. Score = points ajoutés au joueur qui porte le coup fatal (`0042ebc4`, §10.3).

| Type | Nombre | Modèles (`REC[4]` / `REC[5]`) | Rôle | Comportement résumé | Pv | Score |
|---|---|---|---|---|---|---|
| 1000 | 1/1/1/1/0 | - | départ du joueur | crée le joueur à `(x, terrain + 80, z)` cap `REC[3]` | profil | - |
| 1001 | 0/0/0/0/1 | - | départ de la démo | joueur piloté (forme 42) | profil | - |
| 2000 | 114/321/221/150/40 | 500-518, 552-553 (bâtiments, pylônes) ; 101/102 (avions au sol) / 850, 401, 606, 800... | cible destructible, éventuellement porteuse d'un bonus ou d'un groupe | statique ; fumée à la 1ʳᵉ blessure, explosion + éclats + épave à la mort ; largue le bonus `REC[7]` | 10, 50, 75, **100**, 160, 200 | **73** |
| 2002 | 165/141/353/260/0 | 562, 563 (arbres, 3 sommets) / 401 | décor destructible | idem `2000` | 10 | 73 |
| 2003 | 225/131/24/143/263 | 560, 561, 564, 565 (arbres) / 401 | décor destructible | idem | 10 | 73 |
| 3000 | 18/77/72/40/9 | 400 + 401 | tourelle au sol | base statique (idem `2000`), tourelle qui vise et tire | 100 + 100 | 73 (base) + 111 |
| 3001 | 0/2/0/8/0 | 402 | canon à faisceau fixe | vise à moins de 640 unités, faisceau 700/701 (dégâts directs) | 160 | 0 |
| 4001 | 5/11/0/0/0 | 100 (hélicoptère) | **hélicoptère kamikaze** | posé jusqu'à l'alerte, décolle, fonce sur le joueur (contact) | 25, 50 | 210 |
| 4002 | 0/7/10/3/0 | 103 (avion) | avion sur nœuds aériens | suit le bloc 107 (colonne `+0x1c`), poursuit et tire (600/601/603) | 75 | 210 |
| 5000 | 5/17/23/9/0 | 200, 203 + 202, 206, 201 | char | suit les routes (colonne `+0x20`), vise et tire | 100, 160, 200 | 59 |
| 5002 | 0/7/13/6/0 | 204 + roues 984 + 205 | véhicule à roues | comme `5000`, 4 roues décoratives | 160 | 59 |
| 5500 | 0/0/20/0/6 | 300 + 301 | navire | suit les nœuds d'eau (colonne `+0x18`) | 100 | 59 |
| 6000 | 0/1/8/1/0 | 515, 501 | **fabrique de chars** | une fois par 141 images, si un nœud est libre, crée un char + tourelle | 160 | 500 |
| 6100 | 0/0/7/0/0 | 507 + 508 | **piste d'avions** (un avion / 90 images) | si un joueur est repéré, crée un avion de ligne droite | 200 | 500 |
| 6101 | 0/0/0/3/0 | 507 + 508 | piste, **escadrille** (6 avions / 160 images) | idem | 200 | 500 |
| 6110 | 0/2/0/0/0 | 509 + 510 | piste, **passes de tir** | avion qui vise puis traverse (1 / 100 images) | 75, 100 | 500 |
| 6300 | 0/0/0/3/0 | invisible ; avions 103 | **générateur de chasseurs** | maintient jusqu'à 4 chasseurs autour du joueur | 100 (inattaquable) | 210 par chasseur |
| 7000 | 48/96/73/61/0 | décor 601-604, 609 / bonus 606, 608, 800, 801, 811... | **bonus posé** | bonus qui flotte, attiré par le joueur qui le prend | 10 (décor) | - |
| 7002 | 0/0/0/5/0 | 604 / 981, 813 | bonus caché | n'apparaît qu'après la destruction du groupe 9 (§11) | - | - |
| 7010 | 0/0/1/0/0 | 504 | **plate-forme de transformation** | capte le joueur et change sa forme (hélicoptère ↔ véhicule) | 1 000 | - |
| 7011 | 0/0/1/2/0 | 504 + hélicoptère posé 990 | idem, avec appareil en décor | idem | 1 000 | - |

Le niveau 2 (`TERRAN01`) est le plus peuplé en cibles (`2000` ×321) ; `TERRAN02` concentre les bateaux, les hangars de type 6100 et les 20 `5500` ; `TERRAN03` possède les 8 canons à faisceau, les 3 générateurs de chasseurs et le seul `7002`.

## 6. Comportements par type

Pseudo-code : `o` = l'objet, `joueur` = cible, `D²` = distance au carré en unités d'objet (`(Δ >> 8)²`). Les constantes sont celles du code.

### 6.1 Cible statique `00446d24` (2000, 2002, 2003, base de 3000, décor de 7000) (confirmé)

```
si âge == 0 : o.+0x50 = o.pv                       # pv de référence
si pv != o.+0x50 et pv > 0 : o.+0x50 = pv ;        # blessé : une bouffée de fumée
    clone (classe 0xe1, pv 100, modèle 11004=0x2afc, upd 00443f78, +0x50 = 55)   # suit l'objet 50 images
si pv <= 0 :
    classe = 0                                      # libère l'objet
    explosion (00443ac0), éclats + épave (004442ec), score +73 (0042ebc4), désinscription du groupe (0043ce6c)
    si +0x54 dans [1000, 2000[ : crée le bonus (classe 0x41, pv 1000, modèle REC[5], upd 00446a3c)
sinon : o.+6 |= 0x20                                # reste gelé tant qu'il est intact
```

Aucune IA, aucun tir, pas de mouvement. Le gel (`+6 & 0x20`) est levé par le premier contact. **Un joueur ou un char qui percute ces objets ne les détruit pas** (poussée seulement, §10.1) : ils tombent sous les tirs.

### 6.2 Tourelle de `3000` (`0044ac88`) (confirmé)

- Base : §6.1. Tourelle (enfant, `+0x5c` = base) :
  - `o.f14` décrémente ; `00443938(40, o, 4, 4, 1)` recherche une cible (§8.1) ;
  - si cible : parmi 5 directions candidates (table `00484238` : `(0,0,1000)`, `(±44,0,999)`, `(0,±44,999)`) choisit celle qui maximise le produit scalaire avec la direction de la cible ; l'option 1/2 tourne le **cap de ∓3**, 3/4 le **tangage de ±2** ; tangage borné à **[-15, 55]** ; appelle ensuite **sans test d'alignement** `gm_enemy_fire` (`0046d1f8`) : elle tire dès que son minuteur et le code d'arme `REC[7]` le permettent ;
  - sans cible : tangage rejoint 55 (+1 par image), cap rejoint le cap de la base (±1) ;
  - si la base meurt (`base.pv <= 0`) : la tourelle est **éjectée** (`vy = 0x4b0`, classe `|= 0x4012`, `+0x5c = soi`), accorde **111 points**, tourne (`cap += 25`, gravité 30) et retombe. Au contact du sol elle lance une dernière **fusée à tête chercheuse** (classe `0x3b`, pv 20, modèle 800, `0044a8e8`, tangage 128, `vy = 800`) puis explose (sprite 11003, son 1001) ;
  - si la tourelle est détruite seule (`pv <= 0`) : explosion 11003, aucun score.
- Armes observées : 100 (82), 110 (63), 400 (28), 111 (18), 405 (12), 0 = muette (9), 112 (2), 121 (1), 408 (1).

### 6.3 Canon fixe `3001` (`0044b848`) (confirmé)

Une seule pièce, classe `0x1001` + drapeau `+6 |= 0x11` à chaque image. Retire une cible (période 40 images, 160 avec cible) ; si `D² >> 8 < 0x640` (**portée 640 unités**) appelle `gm_enemy_fire` ; sinon remet `minuteur = 41`. L'arme `REC[7]` vaut 700 ou 701 : **faisceau** sans projectile (§8). À `pv <= 0` : explosion 11003, pas de score.

### 6.4 Hélicoptère kamikaze `4001` (`0044e438`) (confirmé, interprétation en hypothèse)

- Au sol (`classe & 0x10 == 0`) : `00443938(70, …)` ; si cible trouvée, `âge = 0`, `classe |= 0x12` (en vol, solide).
- En vol : la cible est conservée tant qu'elle garde le bit `0x04` (sinon nouvelle recherche, période 10) ; pendant les **80 premières images** il monte (`vy += 2·âge`) et pivote (`cap += 2`) ; ensuite il vole vers le joueur avec `00444af8(o, h)` puis `004420a4(o, 25, cible)` (virage). Avec `d = ((Δx >> 12)² + (Δz >> 12)²)` (distance/16 au carré) : si `d < 5 000` (≈ 1 130 unités) la hauteur visée `h` au-dessus du sol vaut `70 + 4·d/256` pour un joueur en vol, `10 + 7·d/256` pour un joueur au sol (il descend en s'approchant) ; au-delà `h = 150`. **Il percute le joueur** (aucun tir ; choc de §10.1 : `min(pv)` retiré des deux côtés).
- Si la cible disparaît : hauteur 80 et nouvelle recherche (période 20).
- À `pv <= 0` : fumée (11004), explosion 11002, **210 points**, `+0x68 = 00449c10` (épave qui tombe : `cap += âge/4`, gravité 50 par image, pv remis à 100) et classe `|= 0x4020` (épave dépeuplable).

### 6.5 Avion `4002` (`0044e758`) (confirmé)

Réserve un nœud aérien (§9, colonne `+0x1c`, `004264d4`). Cible : `00443938(40, …, 2)` (rayon de grille 2 = 5 × 5 cellules). Dynamique de vol par `00444af8` (hauteur 80, contact au sol §10.2) ; il **vire vers son nœud courant** (`004420a4`/`00442398`, ±25) :
- sans cible : `00444ef4` à hauteur 40, nœud suivant à tour de rôle (`00442bc8`) quand `D² < 2 000` ;
- avec cible : hauteur 70, `gm_enemy_fire` en continu, et à l'arrivée il choisit le voisin libre le plus proche du joueur (`00442a28`) : il **passe devant le joueur en tirant** plutôt qu'il ne le poursuit en vol libre.

Arme 600 (11), 603 (7) ou 601 (2 : sans programme, muet). À la mort : épave `00449c10`, 210 points, nœud rendu.

### 6.6 Véhicules `5000`, `5002`, `5500` (`0044bca8`, `0044cf1c`) (confirmé)

Corps (classe `0x1003`, solide) :

1. Première image (`nœud == -1`) : `gm_node_claim_*` (§9). Si `classe == -1` (dépeuplement) : rend le nœud et sort.
2. **Suspension** : `00443510(o, 3·REC[8], mode)` échantillonne la hauteur (`00425c94`, avec vagues d'eau) aux 4 coins `(±5120, ±7680)` (24.8, soit ±20 × ±30 unités), en déduit `tangage`/`roulis` (`>> 9`), et la compression minimale `m`. Frottement `v *= 14/16`. Si `m > 0` (en l'air) : `vy -= 150` (**gravité**) ; si `m < 0` (enfoncé) : `y -= m` et `vy` clampé à ≥ 0. Au sol, la poussée avant vaut `3·REC[8]` par image (150 pour 50), soit une vitesse limite d'environ 4,7 unités par image.
3. **Route** : `00443284(o, 10)` oriente le cap vers le nœud courant (−10, 0 ou +10 par image, le meilleur alignement) et calcule `D²` jusqu'à lui. La **poussée avant** (`3 × REC[8]` le long de l'axe du véhicule, donc en tenant compte du tangage) n'est appliquée que si le véhicule est au sol (`m < 1 000`) **et** à plus de 31 unités du nœud (`D² > 1 000`). À l'arrivée (`D² < 1 000`), `004426c0` (avec cible : voisin libre qui rapproche du joueur) ou `00442860` (sans cible : voisin libre suivant, à tour de rôle) choisit le nœud suivant. Un nœud est **réservé** (§9). Le char continue donc de suivre la route en tirant : il ne quitte jamais le graphe.
4. **Cible** : `00443938(40, o, 4, 4, 1)` ; la tourelle enfant reprend `o.+0x58`.
5. Mort (`pv <= 0`) : rend le nœud, classe 0, **59 points**, désinscription du groupe, éclats (`004442ec`), explosion 11003 + son 1001. Pas de cratère (contrairement à `00443ac0`).

Enfants :
- **Tourelle** (`0044d470`, `5000`, `5002`, `5500`) : colle à la position du corps, cible = cible du corps, vise avec `0044167c` (5 options comme §6.2) et **tire seulement quand l'option « tout droit » est la meilleure** (alignée) ; sans cible, rejoint le cap du corps (±1) ; `00441c00(o, 10, 0)` borne tangage/roulis à ±10 autour de ceux du corps. Si le corps meurt, elle est éjectée comme en §6.2 (sans la fusée finale, ni score).
- **Roues de `5002`** (`004450c4`, modèle 984, états 0-3 : AG, AD, ArG, ArD) [confirmé, porté : `enemies.wheel`] : vitesse recopiée du corps ; rotation `tangage −= (SIN[cap]·vx + COS[cap]·vz) >> 13` avec le cap **précédent** de la roue ; placées en `(∓6000, -4000, +8000 / -4000)` (latéral, vertical, avant, 24.8) par `004580f0` dans le repère complet du corps (tangage, roulis puis cap : elles suivent l'inclinaison de la suspension) ; cap = cap du corps ; effacées (`+4 = 0`) quand le corps n'existe plus. Le port les plaçait auparavant au seul cap du corps.
- Pour `5500`, `004263bc` réserve la colonne `+0x18` et les virages passent par `00442eac` / `0044304c`.

Les armes des chars : 100 (`5000`), 111, 400, 101, 405, 110 ; `5500` : 110, 400 ou aucune.

### 6.7 Fabrique de chars `6000` (`0044d804`) (confirmé)

```
si nœud == -1 : claim (004262a4) puis rend aussitôt la réservation   # sert juste à trouver le nœud le plus proche
si âge > 140 et nœud.capacité(+0x20) > 0 :
    char  = clone (classe 0x1023, pv REC[13], modèle REC[11], upd 0044bca8), +0x0c = REC[15]
    tour. = clone du char (classe 0x1023, pv REC[13], modèle REC[12], upd 0044d470), +0x54 = REC[14]   # arme
    âge = 0                                                                                    # un char toutes les 141 images
si pv <= 0 : explosion + éclats + score 500 + désinscription du groupe
```

Les chars créés ont le bit `0x20` : ils sont **dépeuplés** quand ils sortent de la zone proche. Données : `REC[11]` = 200, `REC[12]` = 202 ou 201, `REC[13]` = 100, `REC[14]` ∈ {100, 101, 405}, `REC[15]` = 50. `REC[7]` (1002, 100, 0) n'est pas lu. L'usine est la seule source de réapparition continue des unités terrestres (**pas de respawn** pour les autres objets).

### 6.8 Pistes d'avions `6100`, `6101`, `6110` (`0044df98`, `0044e0f8`, `0044e2d8`) (confirmé)

Le hangar reste en place (classe 1, pv `REC[6]`, **500 points**, explosion + éclats à la mort). Il cherche un joueur avec `00443938(30, …, 1)`. Quand il en voit un :

| Type | Cadence | Avion engendré |
|---|---|---|
| 6100 | `âge > 90` (une fois par 91 images) | classe `0x1033`, pv `REC[13]` (= 10), modèle `REC[11]` (101), upd `0044d938`, vitesse `REC[15]` (50), arme `REC[14]` (600) ; position = joueur − `SIN/COS(cap_hangar) × 1500`, altitude = hangar + 99 999/256 (≈ 390 unités) |
| 6101 | minuteur 160 ; engendre quand `minuteur < 48` et `minuteur & 7 == 0` (6 avions espacés de 8 images ; cap décalé de `2·minuteur − 50`, position décalée de 256 unités le long du nouveau cap) | idem avec `0x708` (1 800 unités) de recul |
| 6110 | `âge > 100` | idem mais upd `0044db38` |

Avion `0044d938` : vole droit (`vx = SIN(cap)·REC[15] / 4`, `vz = COS(cap)·REC[15] / 4`, soit jusqu'à ≈ 12,5 unités par image), suit le relief à **190** de hauteur (`vy += 2·ecart` si trop bas, `ecart/2` si trop haut), appelle `gm_enemy_fire` en continu, meurt à `pv <= 0` (explosion 11003, **50 points**). `0044db38` : état 0 = vire vers le joueur (±1 cap) en tirant ; il passe à l'état 1 quand `D² < 2 000` (44 unités), puis 2 = s'éloigne (plus de tir).

L'antenne enfant (`0044de9c`, modèle 508/510) colle au hangar : état 1 oscille de `SIN(âge·8)/4`, état 2 de `SIN(âge·4)`, état 3 tourne de +5 par image ; elle meurt avec lui.

### 6.9 Générateur de chasseurs `6300` (`0045199c` + `004516f4`) (confirmé)

Objet invisible et inattaquable (classe `0x40`). Toutes les 31 images (`âge > 30`) il cherche le joueur le plus proche à moins de 2 449 unités (`0043c164`, `D² < 6 000 000`) ; tant que ce joueur a moins de 4 chasseurs (tableau de 4 pointeurs en `joueur+0x1bc`), il crée un chasseur : classe `0x1033`, pv `REC[6]` (75), modèle `REC[4]` (103), `+0x0c = REC[8]`, arme `REC[7]` (602), numéro d'orbite 0 à 3, position = joueur − `SIN/COS(cap) × 1500`, +390 unités d'altitude. Chasseur (`004516f4`) : vole avec `00444af8`/`00444ef4` (hauteur 70), vise un point à ±700 unités du joueur selon son numéro d'orbite (quatre points cardinaux), tire (`gm_enemy_fire`), meurt à `pv <= 0` (épave `00449c10`, **210 points**).

**Anomalie apparente (hypothèse forte)** : à la mort, le chasseur remet à 0 l'emplacement `+0x5c + 0x1bc + 4·n`, or `+0x5c` est le **générateur** (le chasseur est un clone du générateur) et non le joueur : l'emplacement du joueur n'est jamais libéré. En pratique, un joueur n'est donc harcelé que par **4 chasseurs au total par niveau** (les emplacements restent « pleins » même après leur mort), quel que soit le nombre de générateurs ; l'écriture parasite touche le champ `+0x0c` d'un objet voisin du pool. Un moteur peut reproduire ou corriger ce comportement.

### 6.10 Bonus `7000`, `7002` et bonus largués (`004469fc`, `00446a3c`, `004463c0`) (confirmé)

- `7000` crée **deux objets** : un décor plat (`REC[4]` ∈ 601-604, 609, classe `0x841` : jamais touché) et le **bonus** (classe `0x41`, pv `REC[6]`, modèle `REC[5]`, `+0x54 = REC[7]`, upd `004469fc`). `7002` attend que le groupe 9 soit détruit (`005b03e4 == 9`) pour créer le sien ; `7001` (absent) attendrait que tous les groupes soient finis (`005af3a4 == 1`).
- `004463c0` (partagé, états `+0x50`) : **état 0** : flotte à `terrain + 6 000/256 (≈ 23 unités) ± 8` (sinus de `4·minuteur`, `minuteur` incrémenté à chaque image), tourne (`cap += SIN/16`) ; toutes les 32 images cherche le joueur le plus proche ; s'il est à `D² < 10 000` (**100 unités**) et que `gm_pickup_can_take(joueur, REC[7] - 1000)` accepte (par exemple munition pas pleine) → état 1 (joueur en vol : 130 images, classe `|= 0x1000400`, son 4000) ou état 2 (joueur au sol : 70 images, son 4002). **États 1-2** : `minuteur` décroît ; le bonus est placé à `joueur − dir × minuteur` (dir = direction normalisée à 256, donc une approche linéaire de 130 ou 70 unités) pendant que le joueur est tiré vers lui (`v_joueur −= dir/4`) ; quand `minuteur <= 10` : classe 0, `gm_pickup_apply(joueur, REC[7] - 1000)`.
- `004469fc` ajoute 1 à `joueur+0x198` (bonus posé ramassé) ; `00446a3c` (largué par une cible `2000`) ajoute 1 à `joueur+0x194`. Ces deux compteurs, rapportés à `005b03d8` / `005b03f4`, donnent les pourcentages de l'écran de fin.
- Codes `REC[7]` : `1000 + n` avec `n` de 0 à 19 (le joueur refuse le bonus tant que son stock `joueur+0x128+4n` n'est pas sous un plafond propre à `n` : 100, 60, 30, 40, 20, 20, 20, 10, 20, 10, 40, 30, 15, 40, 20, 5…) ou `n` de 100 à 113 (autres bonus : 100-102, 105, 107, 108, 110, 112, 113). Dans les niveaux : 1000 (79 `7000`), 1001 (55), 1101 (81), 1010, 1007, 1110… Le sens de chaque `n` relève de `rules.md`. Modèles associés dans les données : 800/801 (1000, 1001, 1010, 1011), 606 (1101), 608 (1110, 1111), 812 (1007), 850 (1002), 855 (1005), 811 (1006), 853 (1107).

### 6.11 Plates-formes de transformation `7010`, `7011` (`004482dc`, `0044822c`, `00446efc`, `00447080`) [C]

**7010 naît à l'état 0 (attend un hélicoptère : → véhicule) ; 7011 naît à l'état 5 (attend un véhicule au sol : → hélicoptère)** et crée un hélicoptère posé (modèle 990, classe `0x40`, `0044822c`) décalé de cap + 64, 39 u plus haut, 32 u en arrière. Indestructible (pv 1 000 réécrits). Joueur cherché tous les 32 ticks, `D² < 15 000` (122 u). États `+0x50` : 0 capte un joueur `& 0x21c == 0x214` (pilote coupé, classe `0x40`, `+0x180 = 1` : armes retirées, minuteur 70) ; 1 attend la fin de l'amarrage ; 2 pose le joueur sur la plate-forme et `set_form(1)` (qui rend le pilote, `+0x5c = soi`, `+0x180 = 0`) ; 3 pousse 40 ticks à 4 u/tick le long du cap ; 4 pause 200 ; 5 capte un joueur `& 0x21c == 0x204` ; 6 attend l'arrivée (`+0x50 == 0x20`) ; 7 attend l'objet auxiliaire qui replace le joueur (position, angles) → 8 `set_form(0)`, 200 ticks → 9 → 0.

- **Amarrage en vol** (`00446efc`) : cap vers la plate-forme (pas 4) ; état 0 : vol stationnaire à 130 u du relief, glissement de 1/16 de l'écart vers le point à 32 u de la plate-forme (cap + 0x140), le compteur de 70 baisse de 2 par tick (35 ticks) ; état 1 : descente de 550/256 u par tick jusqu'à 9 500/256 u au-dessus de la plate-forme ; état 2 = arrivé.
- **Amarrage au sol** (`00447080`) : suspension des 4 roues (le pilote du joueur devient `00438694`, qui anime les roues enfants : `player.md` §3.6), frottement 14/16, gravité 150 ; état 0 choisit l'approche par le point à 256 u devant ou derrière (le plus proche du point à 32 u devant le véhicule) ; états 10/0x14 (vise ce point, pas 2), 0xb/0x15 (avance de 4 u par tick jusqu'à 100 u), 0x1e (vise la plate-forme, pas 3), 0x1f (avance jusqu'à 70 u) → 0x20.
- Variantes 7012 et suivantes (`004477b0`, `00447afc`, `0044878c`, `004490cc`, `004493e8`, `004495f8`) : non lues. `004495f8` est le comportement des types 7012 et 7013 (le 7013 crée en plus l'hélicoptère posé `0x3de` à l'état 5, comme 7011) et installe le pilote `00438c68` (motoneige amarrée : braquage par pas de 8, roues 1, 1, 2) ; absents des niveaux livrés, non portés. 7010 sans hélicoptère posé reste bloquée à l'état 7 au retour.

### 6.12 Ce qui n'est pas des « types » mais des objets créés

- **Projectiles** (§8.3), **explosions**, **fumées**, **éclats**, **épaves** (§10.4), **antennes**, **roues**, **tourelles**.
- **Caméra de scénario** (`00446a7c`, types 7800-7801 : absents).

## 7. Génération et apparition

1. **Fabrique `6000`** : chars, §6.7. Cadence 141 images, conditionnée par un nœud libre (pas de plafond global).
2. **Pistes `6100-6110`** : avions, §6.8, conditionnés par la présence d'un joueur à portée de ciblage. Pas de plafond ; chaque avion fonce droit devant lui et disparaît à sa mort ou dès qu'il quitte la zone proche (dépeuplement).
3. **Générateur `6300`** : plafond de 4 chasseurs par joueur (§6.9).
4. **Hélicoptère `4001`** : se « réveille » (classe `|= 0x12`) quand un joueur entre dans la grille 3 × 3 de cellules et à moins de ≈ 2 530 unités.
5. **Bonus** : posés au chargement (`7000`), révélés par un événement (`7001`, `7002`), largués à la mort d'un porteur (`2000`).

Aucun mécanisme de respawn après mort d'un objet du niveau. Les bonus ne réapparaissent pas.

## 8. Ciblage et tirs

### 8.1 Ciblage (`gm_acquire_target`, `00443938`) (confirmé)

Signature : `(EAX = période, EDX = objet, EBX = masque, ECX = valeur, pile = rayon de grille)`.

- Ne fait rien en réseau client. Pose le drapeau réseau `+7 |= 1`.
- **Période** : si l'objet a déjà une cible (`+0x58 != soi`), la période est multipliée par 4 ; la recherche n'a lieu que si `âge > période` (donc toutes les 40 images sans cible, toutes les 160 avec), puis `cible = soi`, `âge = 0`.
- **Requête** (`gm_grid_query`, `0042ae7c`) : tous les objets des `(2r + 1)²` cellules centrées sur l'objet (**r = 1** pour les tourelles, chars, hangars → 3 × 3 cellules de 512 unités ; **r = 2** pour les avions `4002` et les navires) dont `(classe & (masque | 0x40)) == valeur` ; avec masque/valeur = 4/4 : **bit 0x04 posé, bit 0x40 absent** (les joueurs).
- Parmi les candidats : `D'² = ((Δx >> 10)² + (Δy >> 10)² + (Δz >> 10)²)` (unités / 4) ; retient le plus proche si `D'² < 400 000`, c'est-à-dire **à moins de 2 530 unités en 3D** ; la cible est la **racine propriétaire** de l'objet trouvé (`+0x5c`).
- `0043c164` (variante simple) cherche le joueur le plus proche en 2D (`D² < max`, max = 6 000 000, soit 2 449 unités, dans tous les appels vus) sans passer par la grille ; elle sert aux pads, aux générateurs `6300` et aux bonus, qui appliquent ensuite leur propre seuil (15 000 ; 6 000 000 ; 10 000).

La portée réelle est donc bornée par la grille (cellules voisines seulement) : avec `r = 1`, entre 512 et 1 024 unités selon la position de l'ennemi dans sa cellule ; avec `r = 2` (`4002`, `5500`), entre 1 024 et 1 536 unités. Le seuil de 2 530 unités ne joue donc jamais seul.

### 8.2 `gm_enemy_fire` (`0046d1f8`) : programmes d'armes (confirmé)

Un `switch` sur `o.+0x54` (code d'arme). Le minuteur `+0x14` fait office d'horloge : la fonction n'est pas « appelée pour tirer », elle est **appelée à chaque image** par le comportement dès qu'il y a une cible, et c'est la valeur du minuteur qui déclenche le tir (le comportement le décrémente ; l'arme le recharge à la valeur de recharge `R` quand il atteint 0). Les projectiles sont des clones (§4.2) de classe **`0x3b`** (`0x20 + 0x10 + 0x08 + 0x02 + 0x01`) dont les pv sont les dégâts. Vitesse : `00456814(proj, latéral, vertical, avant)` pose `v` dans le repère du tireur (cap, tangage), composantes en 1/256 unité par image. Les sprites `0x2710/0x2711/0x2715` sont les images 10000/10001/10005 ; `0x320`/`0x321` (800/801) sont de vrais modèles 3D de missile.

| Code | Tir quand `minuteur ==` | Recharge | Projectile (latéral / vertical / avant) | Dégâts | Son |
|---|---|---|---|---|---|
| 100 | 0 | 50 | 1 balle 10005, `0044a2d0`, avant 9 000 (35 u/image) | 35 | 2001 |
| 101 | 10, 5, 1 | 120 | 2 balles 10005, latéral ±200, avant 9 300 | 35 | 2001 |
| 109 | 3, 0 | 15 | 1 balle 10000, avant 9 000 | 45 | 2002 |
| 110 | 5, 1 | 35 | 1 balle 10000, avant 9 000 | 45 | 2002 |
| 111 | 7, 4, 1 | 33 | 1 balle 10000 : vertical +150 (à 7), latéral -100 (à 4), +100 (à 1), avant 9 500 | 45 | 2002 |
| 112 | 7, 5, 3, 1 | 120 | 4 balles 10000 en croix (±`(12 - m)·64` en latéral puis en vertical), avant 9 300 | 35 | 2002 |
| 120 | pairs de 18 à 0 | 150 | 10 balles 10001 balayées : latéral `2·SIN(m·32)`, avant 7 000 | 60 | 2002 |
| 121 | pairs de 34 à 0 | 150 | 18 balles 10001 en cercle : latéral `SIN(m·32)`, vertical `COS(m·32)`, avant 7 000 | 60 | 2002 |
| 400 | 0 | 37 | obus (modèle **800**), `0044a2d0`, avant 5 000 | 55 | 2003 |
| 405 | 0 | 39 | missile modèle 800, **`00456f78`** (guidage faible : virage 1/512 par image) | 55 | 2000 |
| 408 | 0 | 41 | missile modèle 801, **`00455278`** (virage 4/512) | 55 | 2000 |
| 500 | 0 | 50 | 2 balles 10005 de part et d'autre (±8 unités), avant 9 000 | 35 | 2001 |
| 501 | 0 | 47 | 2 balles 10001 (±8 unités), avant 9 000 | 45 | 2002 |
| 510 | 0 puis 1 | 39 | 2 missiles 800 alternés (g puis d, ±8 unités), `00456f78` | 55 | 2000 |
| 511 | 0 puis 1 | 41 | 2 missiles 801 alternés, `00455278` | 55 | 2000 |
| 600 | 0 | 60 | **visé** : vitesse = direction vers la cible × 32 u/image (norme 8 192), 10001 | 50 | 2002 |
| 602 | 0 | 55 | visé, 10005 | 25 | 2002 |
| 603 | 5, 0 | 40 | visé, 10005 (2 coups) | 35 | 2002 |
| 610 / 611 / 612 | 0 | 60 | fusée à phases (`00457d4c`, phase de départ 0 / 10 / 20), modèle 801, `vy = 600`, tangage 128, minuteur 40 | 50 | 2000 |
| 666 | 5, 0 | 40 | **suiveur** (`0044a1a0` : revise sa vitesse vers la cible à chaque image), 10005 | **1** | 2002 |
| 700 | cycle 100 : de 30 à 0 | 100 | **faisceau** sans projectile : à `minuteur & 7 == 0` (24, 16, 8, 0) `cible.pv -= 11`, éclair de la cible, **repousse** la cible de `8 · dir` ; son à 30 | 11 × 4 | 2004 |
| 701 | cycle 110 : de 40 à 0 | 110 | faisceau : (32, 24, 16, 8, 0) `cible.pv -= 19` ; son à 40 | 19 × 5 | 2005 |
| 999, autres | - | - | rien | - | - |

Dans les niveaux : 100, 101, 110, 111, 112, 121, 400, 405, 408 (tourelles et chars) ; 600, 601 (muet), 603 (avions et chasseurs `4002`, `6100-6300`) ; 602 (chasseurs `6300`) ; 700, 701 (canon `3001`). Les autres codes sont câblés mais absents des données lues.

Les tirs « droits » partent dans la **direction du canon** (cap et tangage de l'objet) ; les armes 600-603 et 666 sont **visées** sur la position de la cible au moment du tir (pas de prédiction de son mouvement). Le faisceau 700/701 n'a pas de portée propre : celle de `3001` (640 unités).

### 8.3 Projectiles (confirmé)

| Fonction | Rôle |
|---|---|
| `0044a2d0` | balle : aucun lifetime ; **explose au contact du sol** (`terrain(x, z) >= y`) ou quand `pv <= 0` (sprite 11000 frame 39) ; sinon avance en ligne droite |
| `0044a1a0` | suiveur : recale sa vitesse vers la cible (norme 8 192) à chaque image |
| `0044a374`, `0044a430` | variantes à durée de vie (`+0x14`) (non présentes dans les niveaux) |
| `00456f78` / `00455278` | missiles : `00454ce0` donne `v = 5 000` vers l'avant et vire vers la cible (taux 1 ou 4) après 6 images ; fumée toutes les 6 ou 3 images (sprite 11001) ; **après 100 images** passe en `00455190` (vol droit, fumée toutes les 7) |
| `00457d4c` | fusée à phases (montée, virage, descente) |

Tous les projectiles ont le bit `0x20` : dès que leur cellule passe en mode 1, ils sont supprimés (§2).

## 9. Chemins : bloc 107 (confirmé)

Nœud de 36 octets (9 u32) : `(l0, l1, l2, l3, x, z, c6, c7, c8)`, `l0..l3` = indices de nœuds voisins ou -1, `x`, `z` en unités d'objet, **`c6`, `c7`, `c8` = compteurs de capacité** (octets 0x18, 0x1c, 0x20 du nœud) pour trois classes de véhicules :

| Compteur | Classe | Réservé par | Valeurs dans les niveaux |
|---|---|---|---|
| `c8` (`+0x20`) | véhicules terrestres | `004262a4` (`5000`, `5002`, `6000` et ses chars) | 1 sur presque tous (15 nœuds à 0 dans `TERRAN02`, 51 dans `DEMO`) |
| `c6` (`+0x18`) | navires | `004263bc` (`5500`) | 0 partout sauf **245 nœuds d'eau** de `TERRAN02` et 51 de `DEMO` |
| `c7` (`+0x1c`) | aéronefs | `004264d4` (`4002`, et joueur démo `00449ad0`) | 1 partout sauf `DEMO` (0 sur les nœuds d'eau) |

Règles (confirmé) :

- **Capacité** : un nœud accepte un véhicule de la classe tant que son compteur est `> 0`. Un véhicule qui s'y engage fait `c -= 1`, en partant `c += 1`. Avec `c = 1`, **un seul véhicule** par nœud et par classe.
- **Premier nœud** (`o.+0x40 == -1`) : `004262a4` libère l'éventuel nœud courant, puis cherche, parmi **tous les nœuds** (balayage linéaire jusqu'au nœud terminal `c6 == -1`), celui de `c > 0` le plus proche (`D²` en unités) et le réserve.
- **Nœud suivant** (à l'arrivée) : parmi les 4 voisins `l0..l3` non `-1` dont `c > 0` : sans cible, à tour de rôle (`(âge + k) & 3`) ; avec cible, **le plus proche du joueur** en distance de graphe approchée (`004425c0`, récursion de profondeur 4, `D²` à vol d'oiseau + profondeur) ; reste sur place si rien ne rapproche.
- **Arrivée** : `D² < 1 000` (**31 unités**) pour les véhicules terrestres et les navires ; `D² < 2 000` (**44 unités**) pour les avions `4002`.
- Les nœuds suivent les routes et chemins de la carte 103 (tracé de `slv.md`) ; le jeu n'en tient aucun compte, il ne lit que les positions et les liens.
- La capacité est rendue à la mort (`c += 1`) et au dépeuplement (`classe == -1`).
- Les 86/265/757/182/83 nœuds sont lus **tous en entier** à chaque réservation initiale : pas d'indexation spatiale.

## 10. Dégâts, destruction et collisions

### 10.1 Objet ↔ objet (confirmé, `0042a084`)

Dans une même cellule, pour tout couple `(A, B)` :

```
traité si  (A.classe & 2) ou (B.classe & 2)       # au moins un corps solide
       et  ni A ni B n'a 0x40
       et  A != B.propriétaire, A != propriétaire(B.propriétaire),
           B != A.propriétaire, B != propriétaire(A.propriétaire),
           A.propriétaire != B.propriétaire        # un objet n'entre jamais en collision avec sa famille
D² = ((Δx >> 8)² + (Δy >> 8)² + (Δz >> 8)²)        # 3D, unités d'objet
contact si D² <= rayon²(A) + rayon²(B)
rayon²(M) = modèle[+0x0c]  (100 si modèle 0 ou ≥ 10000)
```

Le « rayon » est donc le **rayon² d'en-tête du modèle** (valeur d'auteur ; `models.md`) ; la somme de deux rayon² remplace `(r_a + r_b)²` (approximation par défaut, plus tolérante que l'exact). Valeurs : 100 : 1 250 ; 200 : 1 677 ; 400 : 749 ; 506 : 3 016 ; 560-565 : 2 138-5 968 ; 990 : 1 451.

**Réaction** (vecteur `n` = `(B - A) >> 4` normalisé à longueur 256 par `00415374`) :

- `(A.classe & 10) + (B.classe & 10) == 2` : exactement un des deux est solide et aucun n'est dangereux → **poussée douce** : le solide reçoit `v += n · 4` (`∓4` pour A, `+4` pour B). Un joueur ou un char contre un arbre : simple rebond.
- sinon → **dégâts** : `A.+0x58 = propriétaire(B)`, `B.+0x58 = propriétaire(A)` ; `m = min(A.pv, B.pv, 100)` ; pour chaque objet dont `+6 & 4 == 0` (non invulnérable) : `pv -= m`, `+6 |= 0x102`, `+6 &= ~0x20` (dégel), et si l'objet est solide (`classe & 2`) et sans `+6 & 8` : recul `v ∓= n · 8`.

Conséquences : les **projectiles** (`0x3b`) abîment tout ce qu'ils touchent, même les décors de classe 1 ; leurs pv fondent du montant infligé : une balle de 35 contre un arbre à 10 pv inflige 10 et **garde 25** (elle peut en traverser un autre). **Limite de la grille** : seuls les couples **de la même cellule** (512 unités de côté) sont testés ; deux objets au contact de part et d'autre d'une limite de cellule ne se heurtent pas. Entre un char et le joueur : les deux solides (`0x2`) → échange `min(pv)` des deux côtés (collision frontale).

### 10.2 Objet ↔ terrain

- **Projectiles** : disparaissent (`0044a2d0`, `00456f78`) dès que `terrain_height(x, z) >= y` (`004256c0`, interpolation bilinéaire de la carte 100, `(octet) << 10` en 24.8).
- **Chars, bateaux** : appui à 4 points avec ressorts (§6.6), gravité 150, vagues d'eau animées via `00425c94` (cellules de la carte 102 `< 0x20`).
- **Avions** (`00444af8`, utilisée par `4001`, `4002`, hangars, chasseurs) : anticipation du relief (point à `pos + v·32`) pour corriger la montée (`vy += 2·écart` si trop bas) ; si `y - 0x7d0 (7,8 unités) <= sol` : **choc** : parmi 16 directions (pas de 32/512, rayon 1 unité) il retient celle où le sol est le plus bas, `vx, vz = dir · 16` (≈ 16 unités/image), `vy = 0x3e8` (+3,9 unités/image), `pv -= 10` (plancher 0), explosion 11003, son 1001 et bouffée de fumée.
- **Objets du niveau** : posés une fois au chargement (`terrain − modèle[+0x10]·256`), ne suivent pas les cratères ultérieurs.
- **Cratères** : voir §10.4.

### 10.3 Score, crédit et groupes

`gm_score_add(obj, n)` (`0042ebc4`) : `racine = obj.+0x58.+0x5c.+0x5c` ; si `racine.classe & 0x20c == 0x204` (**joueur** : bit `0x200` posé, bit `0x08` absent), `racine.+0x108 += n`, `racine.+0x110 += n`. La cible du dernier choc (`+0x58`) est donc le crédit : un ennemi tué par un autre ennemi ne rapporte rien. Le score affiché rejoint la valeur cible de 1 à 3 par image (`0043c234`).

Points (confirmé, constantes de chaque fonction) : cible statique **73**, tourelle éjectée **111**, véhicule/navire **59**, avion de piste **50**, hélicoptère/avion/chasseur **210**, fabrique et hangars **500** ; rien pour une tourelle détruite seule, pour le canon `3001`, pour un bonus. Les bonus donnent leur effet, pas de points.

### 10.4 Explosion, éclats, épave, cratère

Sur mort d'une cible lourde (`2000`, `3000` base, `6000`, hangars) : `00443ac0(o)` :

- rayon² du modèle `r2 = modèle[+0x0c]` : `< 1 000` : **petite**, `< 5 000` : **moyenne**, sinon **grande** ;
- crée un décalque d'explosion (classe `0xe1`, pv 3 000, **modèle 900, 901 ou 902**, `00443a70`, durée 24 images) à la position, appelle `gm_terrain_explosion_crater` (`00424f44`, voir plus bas) et `gm_ground_flash_add` (`004259b4`, éclair au sol d'intensité taille + 1, `render.md` §6.1), joue le son 1000.

`004442ec(o, 0)` :
1. cherche dans le **bloc 11004** le nœud de clé `modèle` (liste chaînée de `(suivant, sous-liste, clé)`) : s'il existe, crée une **épave** (classe `0x4041`, pv 3 000, modèle = prochain de la sous-liste, en rotation à chaque destruction, upd `00444108` qui la gèle `+6 |= 0x20`, même cap) : la ruine reste définitivement ;
2. clé `modèle + 0x10000` : **gros éclats** : une pièce **par entrée** de la sous-liste, classe `0xc03b`, pv 20 (remis à 15 à chaque image : **les éclats blessent aussi**), upd `0044412c`, vitesse = triplet du tableau pseudo-aléatoire `00481588` (256 triplets) × `n` (3 petite, 5 moyenne, 8 grande explosion) ; gravité 40, rotation, drag 31/32, sprite d'explosion 11000 à l'impact ;
3. clé `modèle + 0x20000` : **petits éclats** : `n` pièces piochées en rotation dans la sous-liste (3, 5 ou 8), vitesse × `(n + 1) / 2`, upd `0044420c`.

Le bloc 11004 (identique dans les 5 niveaux, 80 nœuds) : 990/991 (joueur) : éclats seulement (clés `+0x10000`/`+0x20000` : modèles 700-708, pas d'épave) ; 400 : épave 709, petits éclats 710-711 ; 500-522 : épaves 712-754 (2 ou 3 variantes par modèle), gros éclats 715-756 ; 552/553 : épaves 757-758, éclats 759-760, 733 ; **560-565 (arbres) : 6 épaves 761-766, gros éclats 767-770, petits 769-770**. Les types sans clé (200-206, 300, 401…) ne laissent ni épave ni éclats.

`gm_terrain_explosion_crater` (`00424f44`, taille 0/1/2) [C] : 1) `gm_crater_site_ok` (`00424db4`) refuse si un objet « décor » (classe `& 0x12 == 0`) autre que le mourant est à `√(10 000 / 20 000 / 30 000)` u (cases de grille de la cellule, +4, avec un défaut : l'abscisse n'est pas remise à zéro pour la seconde ligne) ; 2) refus si l'une des 36 cellules `cx−2 … cx+3` de la carte 102 vaut 0 ; 3) sur les 16 cellules `cx−1 … cx+2` : carte 102 = `min(240, v + 2·profondeur)` si `v ≠ 0` (même à profondeur 0), hauteur −= profondeur (plancher 0), profil du bloc 700 `taille·0x400 + ((z>>12&3)·4 + (x>>12&3))·0x40` ; 4) passe finale en place sur les 16 cellules : si un des 8 voisins diffère de plus de 19, la cellule prend la moyenne entière des 9. Le cratère est persistant. `gm_terrain_crater` (`00424a24`, création en mode 3) creuse seulement 4 cellules sans lissage. Les gouttes de napalm creusent aussi (modèle 901).

### 10.5 Tore (confirmé / limite)

- Les coordonnées sont **toujours** repliées (`mot haut & 0x7f` sur `x` et `z` après chaque appel et à la création) : **modulo 32 768 unités**. `TERRAN03` contient des `x`/`z` jusqu'à 46 022 : ils sont repliés au chargement.
- La grille est **toroïdale** (`& 63`) : les requêtes de cellules voisines passent la couture.
- Mais **toutes les distances sont brutes** (`x_a - x_b`), sans correction de période : une cible de l'autre côté de la couture est vue « à 32 000 unités » et ignorée. Ni la collision (même cellule seulement), ni le ciblage, ni les routes ne traversent la couture. Un moteur fidèle doit reproduire cette limite, ou la corriger en connaissance de cause.
- La hauteur du terrain, elle, est torique (masque `0x1ff` sur les cellules) : un projectile qui traverse la couture voit le relief de l'autre côté.

## 11. Groupes d'objectifs, bonus et fin de niveau (confirmé, détails dans `rules.md`)

- **Enregistrement** : `gm_objective_register` (`0043cda4`, appelé pour `REC[7] - 5000 ∈ [0, 9]`) pose le bit `0x2000`, ajoute l'objet à une liste triée par groupe **décroissant** (`005af3a8`, noeuds de 12 octets, 100 au plus), incrémente `005b03e0`.
- **Désinscription** (`0043ce6c`, appelée par tous les corps à leur mort) : retire l'objet, incrémente `005b0400` (détruits). Quand plus aucun objet du groupe ne reste : message d'objectif (`gm_mission_message`, `00422f8c(20, groupe, …)`) ; groupe 9 → `005b03e4 = 9` (révèle les `7002`) ; **groupe 0** terminé (avec `005b0414`/`005b03e8`) → séquence de fin de niveau. Quand le groupe de tête de la liste est 0 : `005af3a4 = 1` (révèle les `7001`).
- Le radar affiche en rouge vif les objets du groupe de tête, en rouge sombre les autres : l'ordre de destruction des groupes est 9 → 0.
- Dans les données seuls des `2000` portent un groupe : `TERRAN00` : groupe 9 (6 objets, modèle 511) puis groupe 0 (3, modèle 514) ; `TERRAN01` : 9 (12), 8 (9), 7 (9), 0 (6) ; `TERRAN02` : 9 (9), 8 (13), 7 (7), 0 (10) ; `TERRAN03` : 9 (16), 8 (6), 0 (10, modèle 517) ; `DEMO` : aucun. L'ordre de destruction est donc 9 → 8 → 7 → 0, le groupe 0 étant l'objectif final.
- Statistiques de fin de niveau : `% groupes = 005b0400·100 / 005b03e0`, `% bonus posés = joueur+0x198·100 / 005b03d8`, `% bonus largués = joueur+0x194·100 / 005b03f4`.

## 12. Fonctions à nommer

Noms proposés dans la convention `gm_*` (rien n'a été ajouté à `keyfuncs.def.tsv`). Confiance : certain (C), probable (P), hypothèse (H).

| adresse | nom gm_* | rôle |
|---|---|---|
| `0042a084` | `gm_objects_update` | boucle de mise à jour des objets (§2) : anneaux autour des joueurs, mouvement, appel `+0x68`, collisions (C) |
| `0042a940` | `gm_objects_update_net` | variante réseau (les 4 096 cellules, pas d'anneaux) (C) |
| `0042a010` | `gm_model_radius2` | rayon² d'un modèle (100 si sprite ou 0) (C) |
| `00415374` | `gm_vec_normalize256` | normalise un vecteur 3D à la longueur 256 (tables `0055a4c8`, `005836ac`) (C) |
| `0043c234` | `gm_game_tick` | un pas de jeu : objets, joueurs (`+0xa8`), jauge de pv (P) |
| `004261a0` | `gm_object_clone` | alloue et clone un enfant de EBX (§4.2) (C) |
| `00426814` | `gm_object_spawn` | alloue un objet et appelle `gm_object_init` (C) |
| `00426890` | `gm_object_spawn_raw` | idem sans test du mode réseau (P) |
| `0043cda4` | `gm_objective_register` | inscrit un objet dans un groupe d'objectifs 0-9 (C) |
| `0043ce6c` | `gm_objective_unregister` | désinscrit à la mort, déclenche messages/fin de niveau (C) |
| `00422f8c` | `gm_mission_message` | message d'objectif (table de chaînes 20) (H) |
| `0042ebc4` | `gm_score_add` | ajoute des points au joueur qui a donné le coup fatal (C) |
| `0043c164` | `gm_find_nearest_player` | joueur le plus proche (non ignoré) dans `+0x58` (C) |
| `00443938` | `gm_acquire_target` | ciblage périodique par grille (§8.1) (C) |
| `0042ae7c` | `gm_grid_query` | objets des `(2r+1)²` cellules dont la classe vérifie `masque == valeur`, chaînés par `+0x60` (C) |
| `0042af88` | `gm_grid_query_cells` | variante sans la liste de la cellule de l'objet (P) |
| `004256c0` | `gm_terrain_height` | déjà nommé |
| `00425c94` | `gm_terrain_height_waves` | hauteur avec vagues d'eau animées (C) |
| `00424f44` | `gm_terrain_explosion_crater` | cratère d'explosion (bloc 700) (C) |
| `00424db4` | `gm_crater_site_ok` | test d'emplacement avant cratère (H) |
| `004259b4` | `gm_ground_flash_add` | éclair au sol dans la table 64 × 64 `005624c8`, ajouté à la lumière du terrain (C, `render.md` §6.1) |
| `00443ac0` | `gm_object_explode` | explosion par classe de rayon (modèles 900-902, son 1000) (C) |
| `004442ec` | `gm_object_debris` | épave et éclats du bloc 11004 (C) |
| `00443c88` | `gm_projectile_burst` | petite explosion de projectile (sprite 11000) (C) |
| `00443ed0` | `gm_spawn_smoke_rise` | bouffée de fumée montante (sprite 11004 frame 46) (C) |
| `00444084` | `gm_smoke_trail` | traînée de fumée de missile (sprite 11001) (C) |
| `00444af8` | `gm_aircraft_fly` | vol : cabrage/roulis, suivi du relief, choc au sol (C) |
| `00444ef4` | `gm_hover_follow_terrain` | `vy` pour suivre le relief à une hauteur donnée (C) |
| `00443510` | `gm_vehicle_suspension` | 4 coins, ressorts, poussée (C) |
| `00443114` | `gm_steer_to_point` | choix entre 5 virages vers un point (C) |
| `00443284` | `gm_steer_to_node` | cap vers le nœud courant, `D²` (C) |
| `004420a4` | `gm_aircraft_turn_to_point` | virage avion avec roulis (P) |
| `00442398` | `gm_aircraft_turn_to_point2` | variante (P) |
| `0044167c` | `gm_turret_aim_fire` | vise parmi 5 options et tire (C) |
| `00441c00` | `gm_child_limit_angles` | borne tangage/roulis d'un enfant (P) |
| `00441d40` | `gm_child_copy_tilt` | tangage/roulis d'un enfant selon le parent (P) |
| `00441dfc`, `00441af4` | `gm_aim_toward_target`, `gm_turn_toward_target` | virages vers la cible (P) |
| `004262a4` | `gm_node_claim_ground` | nœud 107 libre le plus proche, compteur `+0x20` (C) |
| `004263bc` | `gm_node_claim_boat` | idem compteur `+0x18` (C) |
| `004264d4` | `gm_node_claim_air` | idem compteur `+0x1c` (C) |
| `004425c0`, `00442928`, `00442dac` | `gm_node_distance_ground/air/boat` | distance de graphe approchée (C) |
| `004426c0`, `00442a28`, `00442eac` | `gm_node_chase_ground/air/boat` | nœud voisin libre le plus proche de la cible (C) |
| `00442860`, `00442bc8`, `0044304c` | `gm_node_patrol_ground/air/boat` | nœud voisin libre suivant (C) |
| `0046d1f8` | `gm_enemy_fire` | programmes d'armes ennemis (§8.2) (C) |
| `00456814` | `gm_set_local_velocity` | vitesse d'un projectile en repère du tireur (C) |
| `004580f0` | `gm_attach_offset` | place un enfant à un décalage rotatif du parent (C) |
| `00454ce0` | `gm_missile_steer` | poussée et guidage de missile (C) |
| `004463c0` | `gm_pickup_update` | comportement d'un bonus : flotte, attiré, appliqué (C) |
| `00458f88` | `gm_pickup_can_take` | le joueur peut-il prendre ce bonus (plafond) ? (C) |
| `004585c4` | `gm_pickup_apply` | applique le bonus (voir `rules.md`) (C) |
| `0043cab4` | `gm_player_init_state` | initialise la structure joueur de 0x228 octets (P) |
| `0043de0c` | `gm_player_set_form` | change la forme du joueur (990/991, classe, update) (C) |

Fonctions de comportement (champ `+0x68`) :

| adresse | nom gm_* | rôle |
|---|---|---|
| `00446d24` | `gm_upd_destructible` | cible statique (§6.1) (C) |
| `004468cc` | `gm_upd_pickup_after_all` | attend `005af3a4 == 1` puis crée le bonus (7001) (C) |
| `00446964` | `gm_upd_pickup_after_group9` | attend `005b03e4 == 9` (7002) (C) |
| `004469fc` | `gm_upd_pickup_placed` | bonus posé (compteur `+0x198`) (C) |
| `00446a3c` | `gm_upd_pickup_dropped` | bonus largué (compteur `+0x194`) (C) |
| `00446a7c`, `00446e90` | `gm_upd_camera`, `gm_upd_companion` | caméra de scénario (7800-7801), compagnon de `1002` (P) |
| `00446efc`, `00447080` | `gm_upd_dock_flying`, `gm_upd_dock_ground` | mouvements d'amarrage du joueur sur une plate-forme (lus ; P) |
| `004477b0`, `00447afc`, `0044878c`, `004490cc`, `004493e8`, `004495f8` | `gm_upd_pad_*` | variantes de plates-formes (7012-7013 et au-delà), **non lues** (H) |
| `004482dc` | `gm_upd_transform_pad` | plate-forme de transformation (§6.11) (C) |
| `0044822c` | `gm_upd_pad_helper` | objet auxiliaire du pad (C) |
| `0044ac88` | `gm_upd_turret` | tourelle de 3000 (C) |
| `0044b848` | `gm_upd_beam_gun` | canon à faisceau (3001) (C) |
| `0044bca8` | `gm_upd_ground_vehicle` | char / véhicule à roues (C) |
| `0044cf1c` | `gm_upd_boat` | navire (C) |
| `0044d470` | `gm_upd_vehicle_turret` | tourelle de véhicule (C) |
| `004450c4` | `gm_upd_wheel` | roue de 5002 (C) |
| `0044d804` | `gm_upd_vehicle_factory` | fabrique de chars (6000) (C) |
| `0044d938`, `0044db38` | `gm_upd_attack_plane`, `gm_upd_attack_plane2` | avions des pistes (C) |
| `0044de9c` | `gm_upd_antenna` | antenne/radar décoratif (C) |
| `0044df98`, `0044e0f8`, `0044e2d8` | `gm_upd_airstrip_*` | pistes d'avions 6100/6101/6110 (C) |
| `0044e438` | `gm_upd_kamikaze_heli` | 4001 (C) |
| `0044e758` | `gm_upd_node_plane` | 4002 (C) |
| `00449c10` | `gm_upd_falling_wreck` | épave d'avion qui tombe (C) |
| `0045199c`, `004516f4` | `gm_upd_fighter_spawner`, `gm_upd_fighter` | 6300 et ses chasseurs (C) |
| `0044a2d0`, `0044a1a0`, `0044a374`, `0044a430` | `gm_upd_bullet`, `gm_upd_bullet_tracking`… | balles (C) |
| `00456f78`, `00455278`, `00455190`, `00457d4c` | `gm_upd_missile_a/b`, `gm_upd_missile_coast`, `gm_upd_rocket` | missiles et fusées (C) |
| `00443a70`, `00443c40`, `00443cf4`, `00443db8`, `00443e7c`, `00443f78`, `00444050`, `00444108`, `0044412c`, `0044420c`, `00441630` | `gm_upd_fx_*` | décalque d'explosion, sprites d'explosion, fumées, épave gelée, éclats, objet inerte (C) |
| `00445228`, `00445670`, `00445a84`, `00445f44`, `004450a8` | `gm_upd_player_*` | formes du joueur et armes embarquées (voir `player.md`) (P) |

## 13. Ce qui reste ouvert

- **Bits de classe** `0x0080`, `0x0800`, `0x1000`, `0x4000` : seule l'utilisation par le radar est établie (pas de test de combat) ; `0x0004` exact (cible des ennemis ou joueur) à confirmer par les types absents.
- **Types absents** : 2001, 2004, 3002, 5001, 5003-5005, 5501, 6200, 7001, 7012/7013, 7800-7900, 8000-8040, 14000 : adresses de création données (§4.4), comportements non lus (`00449aa8`… sont des formes du joueur).
- **Échelle de temps** : cadences en images du jeu ; la conversion en secondes relève de `player.md` (R1).
- **Sons** : numéros passés à `gm_sound_play` établis (1000 grande explosion, 1001 petite, 1003 chute, 2000-2005 armes, 4000/4002 bonus), correspondance avec les WAV de `SOUNDS.BD` à voir avec `sounds.ts`.
- **Sprites ≥ 10000** : numérotation et planches (GLOBAL 504/505/506…) à voir avec `render.md` (R4) ; ici seuls le numéro et le rôle de l'image `+0x50` sont établis.
- `REC[9]`, `REC[10]`, `+0x44`, `+0x6c` : sans effet constaté.
- Le point exact de gel/dégel d'un objet (drapeau `+6 & 0x20`) est posé par les fonctions de comportement ; seule la base de `00446d24` et des épaves a été lue.
