# La hutte à pizza (`PIZZA.MHK`, écran 9) : étude de rétro-ingénierie

Tâche T6. Troisième et dernière épreuve de l'étape 1 de L'Odyssée des Zoombinis (`ZOOMBINI.EXE` 1.0FR). Cadre commun (attributs, régions, niveaux, tampon `S`) : [bridge.md](bridge.md) ; moteur : [../engine.md](../engine.md) ; parcours et sortie : [../screens.md](../screens.md). Cette épreuve est **différente** des deux précédentes : les Zoombinis n'y sont pas triés, ils sont les « livreurs » d'une pizza ; la règle porte sur la **composition du repas** et il y a **un à trois trolls** à satisfaire (Arno, Willa, Shyler : noms des lignes de la table de débogage `1130:3355`).

Confiance : **sûr** = lu dans le code ; **probable** = déduit de plusieurs indices ; **hypothèse** = non vérifié.

## 0. Résumé

- Le joueur compose un **repas** en basculant des ingrédients (5 « pizzas » et 0 à 3 « sundaes » selon le niveau), puis le **sert**. **Chaque troll encore présent** juge le repas : *parfait* si l'ensemble d'ingrédients est **exactement** celui qu'il aime ; sinon il réagit selon qu'il y a **un seul** ingrédient de trop, **plusieurs**, ou que tout ce qui est servi est aimé mais **incomplet** (sûr).
- Un troll parfait part. Quand tous les trolls sont partis, le bouton Continuer s'active et **tous les Zoombinis passent** d'un coup (`1168:3dd0(0,1)`). Il n'y a pas de passage partiel : si le joueur quitte autrement, **tout le groupe est perdu** (sûr pour les appels, voir §6).
- Chaque repas **non parfait** (pour au moins un troll) entame un budget : **6 tolérés au niveau 0, 7 au niveau 1 à 3** ; le repas qui l'épuise (le 6e, resp. le 7e) met fin à l'épreuve (trolls furieux). Servir deux fois le **même** repas ne coûte rien (sûr pour le compteur, **probable** pour l'interprétation de fin).

## 1. Identification

| Élément | Valeur |
|---|---|
| Écran | 9, descripteur `1530:1b50` |
| Archive | `PIZZA.MHK` (chaîne `1530:1bb8`) |
| Enter | `1130:0000` |
| Exit | `1130:0d28` (→ `11a8:021c` → `1168:36e1(0, 1)`) |
| Tick | `1130:0d85` (machine d'états d'animations) |
| Key | `1130:1a66` (touche `0x16f` seulement : aide vocale `DS:a2c4`) |
| Clic de région | `1130:1803(id)` (table copiée de `seg144` à `DS:…`, `1038:0000(0xc000, 1, 0x1b44)`) |
| Repas : génération | `1130:35e6` (ensemble de base), `1130:2669` (répartition entre trolls), `1130:2a29` (indice aléatoire) |
| Repas : verdict | `1130:2a9d(troll)` ; doublon `1130:3b38` ; historique `1130:3aa6` |
| Réaction d'un troll | `1130:2c0b(–, troll)`, `1130:5091(mode, troll)` ; départ des trolls `1130:3893` |
| Compteur de repas | `1130:4620` ; livreur `1130:4cb5`, `4571`, `4ff7`, `4ec8`, `4de0` |
| Bascule d'ingrédient | `1130:1e08(id)` ; remise à zéro `1130:55d9` ; four `1130:1c58` (callback `1ce0`) |
| Historique de départ (niveau 3) | `1130:595f` |
| Animations d'attente | `1130:5d0b` |
| Aide de fin d'écran | `1130:5ea9` (appelé par Continuer si `8e7a ≠ 0`) |

Ressources de `PIZZA.MHK` (vérifiées) : `tBMP` 100 (« Terrain »), 5000 (fond 640 × 480, palette `SHPL` 5000), 6000 (palette sans image utile ; `SHPL` 6000 : 1 couleur), 7000 (119 images), 8000 (206), 9000 (213), 10000 (204), 12000 (41) ; `NODE` / `PATH` 1000 (chargés par `1168:2a5c`, pour les Zoombinis qui font la queue) ; `SCRB` 7000–7068, 8000–8035, 9000–9034, 10000–10038, 12000–12044 ; `SCRS` 13000–13039 (NORMAL, `1168:04d0`), 14000–14005 (REJECT, `1168:03ef`) ; `\0SND` 7000–7009, 8000–8040, 9000–9033, 10000–10040, 11000–11007, 12000–12004, 13000–13008, 14000, 15000–15006 (156 sons). Groupes de formes (`11a0:0000(0, k, id)` sans `REGS`) : 0 = 7000 (`SCRB` 7000–7068 : 69), 1 = 8000 (36), 2 = 12000 (45), 3 = 9000 (35 ; niveaux 1 à 3), 4 = 10000 (39 ; niveaux 2 et 3).

## 2. Règle

### 2.1 Ingrédients et niveau

`DS:8d58` = niveau (0 à 3, `1168:515d`). Paramètres posés par Enter (sûr) :

| Niveau | Trolls présents | Ingrédients `8d5e` | Probabilité `8d60` (‰) | Minimum d'ingrédients aimés `8d62` | Repas tolérés `8d5a` | Particularités |
|---:|---|---:|---:|---:|---:|---|
| 0 | 1 (Arno) | 5 : 5 pizzas | 500 | 2 | 6 | |
| 1 | 2 (Arno, Willa) | 7 : 4 pizzas (la 5e n'existe pas) + 2 sundaes | 800 | 3 | 7 | l'ingrédient d'indice 4 n'est jamais aimé |
| 2 | 3 | 7 : 5 pizzas + 2 sundaes | 1000 | 3 | 7 | |
| 3 | 3 | 8 : 5 pizzas + 3 sundaes | 1000 | 4 | 7 | historique de départ de 4 assiettes |

Un ingrédient = un indice `k` de 0 à `8d5e − 1` : 0 à 4 = les cinq pizzas (boutons 4 à 8), 5 à 7 = les sundaes (boutons 9 à 11). `8d52`, `8d54`, `8d56` valent 1 pour chaque troll présent (Arno, Willa, Shyler), 0 sinon. Valeurs `8d5c = 1, 2, 2, 3` et `8d64 = 0, 0, 1, 2` posées mais jamais lues utilement (**probable** : résidus).

### 2.2 Ensemble de base (`1130:35e6`)

```
base = {} ; reste = 8d62 ; exclu = (niveau == 1) ? 4 : -1
répéter
    pour k = 0 .. 8d5e-1 :                       // tout le passage est exécuté, même si reste atteint 0
        si rand(0..1000) < 8d60  et  k ∉ base  et  k ≠ exclu :
            ajouter k à base ; reste -= 1
jusqu'à reste ≤ 0
si aucun ajout n'a eu lieu : (cas impossible) ajouter rand(0..3)
```

(`1080:0028(1000)` donne 0 à 1000 : au niveaux 2 et 3 `< 1000` est vrai à 1 000 chances sur 1 001, donc **presque tous les ingrédients sont dans la base**.) Le nombre d'ingrédients aimés au total est donc **au moins** `8d62`, pas exactement `8d62` ; au niveau 0 la base fait en moyenne 2,5 éléments (plus si le premier passage en donne moins de 2 : un second passage ne ré-ajoute pas les déjà pris).

### 2.3 Répartition entre trolls (`1130:2669`)

`S_A = 8dc0[]` (Arno), `S_W = 8dd0[]` (Willa), `S_S = 8de0[]` (Shyler) : tableaux de 8 mots (1 = aimé).

- **Niveau 0** : `S_A = base`.
- **Niveau 1** : chaque ingrédient de la base va à `S_A` ou à `S_W` selon `rand(0..1)` (pile ou face indépendant). Si les deux sont vides (base vide, impossible) un ingrédient est tiré. **Aucune garantie que les deux ensembles soient non vides** : avec `s` éléments dans la base, un troll a un ensemble vide avec la probabilité `2 × 2⁻ˢ` (25 % pour 3, 12,5 % pour 4…). Un troll à ensemble vide n'est parfait que pour un repas **vide** (point ouvert §7).
- **Niveaux 2 et 3** : chaque ingrédient de la base va à `S_A`, `S_W` ou `S_S` selon `rand(0..2)`, puis une boucle de **réparation** déplace des ingrédients (tirés au hasard dans le plus gros ensemble qui en a au moins deux) jusqu'à ce que les **trois ensembles soient non vides** et disjoints. Résultat : une partition de la base en trois parties non vides.
- **Niveau 3 seulement** : on repère le plus gros ensemble (comparaison stricte `A < W`, puis `W < S`, sinon `A < S` : en cas d'égalité le plus petit indice gagne), on tire **deux** ingrédients distincts `p₁, p₂` dans cet ensemble (`2a29`) et un ingrédient dans chacun des deux autres `p₃, p₄` ; `595f(p₁, p₂, p₃, p₄)` crée **quatre assiettes de départ** dans l'historique (§4.5), de repas `{p₃, p₄}`, `{p₂, p₃}`, `{p₁, p₂}`, `{p₁, p₄}` (**probable** pour l'ordre des paramètres : décompilé sans arguments).

### 2.4 Verdict d'un troll (`1130:2a9d(k)`)

`M` = repas servi (`DS:8e14[]`, copie des bascules `8e04[]` au moment du service), `S` = ensemble du troll k, `trop = |M \ S|`, `bon = |M ∩ S|`, `n = |S|` :

| `trop` | `bon` | Code | Sens |
|---:|---|---:|---|
| 1 | tout | **0** | un seul ingrédient indésirable |
| ≥ 2 | tout | **4** | plusieurs ingrédients indésirables |
| 0 | `= n` | **2** | **parfait** : `M = S` |
| 0 | `< n` | **1** | tout est aimé mais il en manque |

(Le code 3 existe dans les réactions de `2c0b` mais `2a9d` ne le renvoie jamais.) Un repas vide donne 1 si `n > 0` et 2 si `n = 0` (sûr pour le calcul).

### 2.5 Service, doublon et fin (`1130:1803`, `0d85`, `4620`)

1. **Service** : régions 3 ou 12 (§4.2), seulement si tout est au repos (`8e58 = 0` et `8d9a = 8d9c = 8d94 = 8d3a = 8d3c = 8d3e = 8d46 = 0`, `DS:seg165:02f0 ≠ 0`). `8e58 = 1`, `8e14 ← 8e04`, le premier livreur monte au comptoir si besoin (`4cb5`), puis `1e08(3)` lance l'animation du four (`SCRB` 7057/7058 selon le niveau) et remet les bascules à zéro (`55d9`).
2. **Doublon** (`1130:3b38`) : on compare le masque du repas aux masques de l'**historique** (`8e26[0…8e42]`, 1 octet par repas servi). S'il existe déjà : `8dae = 1`, **pas de nouveau verdict** : chaque troll dont le dernier verdict calculé est 1 réagit par `5091(1, k)` (grognement), les autres sont ignorés ; le repas **ne compte pas** dans le budget.
3. **Nouveau repas** : chaque troll présent (état 1) réagit à tour de rôle (Arno, Willa, Shyler : le Tick enchaîne `2c0b(0,0)`, `(1,1)`, `(2,2)` quand l'animation du précédent est finie) avec la réaction du §5. Verdict 2 : le troll passe à l'état 2 (« content ») puis 3 (« parti ») ; verdicts 0, 1, 4 : `8d38 = k + 1`.
4. Si `8d38 ≠ 0` à la fin de la chaîne (au moins un troll insatisfait), `4620` : `8d5a −= 1` ; si le résultat vaut 0 : `8d82 = 1`. Tant que `8d82 = 0` le jeu continue (le repas est ajouté à l'historique par `3aa6`, le livreur revient) ; quand le compteur est épuisé, le troll suivant joue la réaction de fureur (`SCRB` 8022 + `8d80`, 9029, 10029, état `8df6`) et l'épreuve est **perdue** : plus de nouveau repas utile, `8d20` reste 0 (Continuer grisé).
5. Quand tous les trolls présents sont à l'état ≥ 2 (`8d9c = 1`, posé par `2c0b`) : `3893` joue la scène de départ (`SCRB` 8024…8031, 9030…9033, 10035…10037 selon la composition ; ids du §5), `8d20 = 1` : **Continuer actif**.

Donc **budget d'erreurs** : le 6e repas non parfait (niveau 0) ou le 7e (niveaux 1 à 3) termine l'épreuve ; 5 (resp. 6) erreurs sont tolérées. (Sûr pour le calcul ; que le dernier repas manqué soit *fatal* est **probable** : après lui, la seule issue observée dans le code est la carte.)

Livreur (`4cb5`, `DS:8d10` = rang, `1b6c` = objet) : le premier Zoombini de la file (`DS:0000…`, liste d'ids du groupe) monte au comptoir (`+0x28 = 2`, position `DS:1b6e`) ; l'avancement au suivant n'est déclenché que si `DS:8d14 ≠ 0`, drapeau qui n'est **jamais posé** dans le code lu : **probable** que le même Zoombini porte tous les plateaux (point ouvert).

## 3. Les quatre niveaux

Voir le tableau §2.1. En résumé : plus de trolls (1, 2, 3, 3), plus d'ingrédients (5, 6 effectifs, 7, 8), ensembles aimés plus gros, budget de repas 6 puis 7, historique de départ au niveau 3. Le niveau 1 retire la 5e pizza et le bouton 8 est désactivé (`1130:1803`, `case 8` : `8d58 ≠ 1`).

## 4. Déroulé et état

### 4.1 Variables (DS)

| Adresse | Rôle |
|---|---|
| `8d0a/8d0c` | poignée d'archive ; `8d0e` taille du groupe (16) ; `8d16` tableau `1168:365d` |
| `8d10` | rang du livreur (−1 au départ) ; `8d12` = 1 : livreur prêt ; `8d14` ; `8d94` plus de livreur |
| `8d1e` | écran actif ; `8d20` = Continuer actif |
| `8d26…8d46` | états de la chaîne d'animations (chaque mot = identifiant d'objet en cours, 0 = libre ; consulté par `*(id*2 + 0x6da) = 0` : « animation finie ») |
| `8d2a` | objet du four (`SCRB` 7000) ; `8d2c` animation du four en cours |
| `8d48`, `8d4a`, `8d4c` | trolls Arno (`SCRB` 8032, `0x1f60`), Willa (9034, `0x234a`), Shyler (10038, `0x2736`) ; `8d50` objet « assiette » (8033) |
| `8d52`, `8d54`, `8d56` | état des trolls 0, 1, 2 : 0 absent, 1 présent, 2 content, 3 parti |
| `8d58` | niveau ; `8d5a` repas tolérés restants ; `8d5e` ingrédients ; `8d60` probabilité ; `8d62` minimum |
| `8d68` | objet du four animé (`SCRB` 7001 + niveau) ; `8d70…8d7e` objets des 5 à 8 boutons d'ingrédients (`SCRB` `base + 2k + état`) |
| `8d80`, `8d82` | « il restait du budget » ; budget épuisé |
| `8d8c…8d92` | bascule de chaque ingrédient (1 = servi) pour les boutons 4, 5, 6, 7, 8, 9, 10, 11 |
| `8d96`, `8d98`, `8d9a`, `8d9c`, `8d9e` | divers : réaction déjà jouée, séquence d'introduction (0…4), fureur, tous contents, son |
| `8da6` | ancienne valeur de `9706` (rayon de prise : mis à **25** px dans l'écran) |
| `8dae` | 1 = repas déjà servi |
| `8db0[8]` | ensemble de base ; `8dc0[8]`, `8dd0[8]`, `8de0[8]` = ensembles aimés d'Arno, Willa, Shyler |
| `8e04[8]` | bascules affichées ; `8e14[8]` = repas servi |
| `8e26[28]` | historique : 1 octet de masque par repas (bit k = ingrédient k) ; `8e42` index du dernier |
| `8e4a…8e7a` | choix des animations d'assiette et d'attente (`8e4c` compteur d'assiettes, `0x924 + 8·i` table d'assiettes) |
| `8df0…8e02` | compteurs de répliques par troll et par verdict (une réplique différente à chaque fois) |

### 4.2 Zones cliquables (13 rectangles de 0x24 octets, un jeu par niveau à `seg144:0x1d4 × (niveau + 1)`, copié en tête de `seg144` par Enter)

Rectangles `(x1, y1)–(x2, y2)` ; `id` = numéro passé à `1130:1803`. Les ids 1, 2, 3, 12 et 13 sont identiques à tous les niveaux : 1 = (600,403)–(639,440), 2 = (600,441)–(639,478), 3 = (33,97)–(120,157), 12 = (130,99)–(174,308), 13 = (0,0)–(640,480).

| id | Rôle | Niveau 0 | Niveau 1 | Niveau 2 | Niveau 3 |
|---:|---|---|---|---|---|
| 1 | bouton **carte** (son 999, `8556 = 1`, dialogue de perte) | | | | |
| 2 | bouton **Continuer** (§6) | | | | |
| 3 | **servir** (bouche du four) | | | | |
| 4 | pizza 1 | (48,185)–(100,210) | (33,196)–(85,221) | (33,182)–(85,210) | (33,182)–(85,210) |
| 5 | pizza 2 | (48,211)–(100,236) | (33,222)–(85,247) | (33,211)–(85,236) | (33,211)–(85,236) |
| 6 | pizza 3 | (48,237)–(100,263) | (33,248)–(85,275) | (33,237)–(85,262) | (33,237)–(85,262) |
| 7 | pizza 4 | (48,264)–(100,288) | (33,276)–(85,301) | (33,263)–(85,288) | (33,263)–(85,288) |
| 8 | pizza 5 | (48,289)–(100,317) | inerte | (33,289)–(85,316) | (33,289)–(85,316) |
| 9 | sundae 1 | inerte | (88,215)–(115,254) | (88,215)–(115,254) | (88,195)–(115,232) |
| 10 | sundae 2 | inerte | (88,255)–(115,294) | (88,255)–(115,295) | (88,237)–(115,274) |
| 11 | sundae 3 | inerte | inerte | inerte | (88,276)–(115,314) |
| 12 | **servir** (bande de comptoir) | | | | |
| 13 | tout l'écran (glisser un Zoombini) | | | | |

(« inerte » : le rectangle existe dans la table mais `1130:1803` ignore l'id à ce niveau ; les rectangles des niveaux 0 pour les ids 9 à 11, du niveau 1 pour 8 et 11 et du niveau 2 pour 11 ne servent pas.)

Les ids 4 à 8 appellent `1e08` pour basculer l'ingrédient d'indice `id − 4` (id 4 → 8d8c, … ; id 9, 10 refusés au niveau 0, id 11 seulement au niveau 3). Les ids 3 et 12 appellent le service (§2.5). **Id 13** (glisser un Zoombini sur le comptoir pour servir) exige `8d22 > 5` : `8d22` n'est jamais incrémenté, la branche est **inerte** dans cette version (sûr pour le code).

### 4.3 Tick `1130:0d85`

Protégé contre la ré-entrée (`DS:1b86`) ; ne tourne que si `8d1e ≠ 0`. Dans l'ordre :

1. **Sortie demandée** (`8556 ≠ 0`) : attend la fin du son 996 puis dialogue de perte (`a2de` 0 / 3 : on part ; 2 : annule) et changement d'écran, comme dans [bridge.md](bridge.md) §4.3.
2. Ambiance (`1130:5d0b`) si aucun dialogue (`a2da = 0`) et `FUN_1090_0132` indique une période écoulée.
3. **Chaîne d'états** (`8d2e`, `8d30`, `8d3a`, `8d3c`, `8d3e`, `8d42`, `8d36`, `8d38`, `8d40`, `8d44`, `8d46`, `8d26`, un seul actif à la fois ; chaque état attend que l'animation correspondante soit terminée) : four fini (`8d30`) → test du doublon (`3b38`) puis verdict du premier troll → animation de réaction du troll k (`8d3a`, `8d3c`, `8d3e`) → verdict du suivant → départ du troll content (états 2 → 3 : le troll s'efface, son assiette est reprise) → `4620` si insatisfait → retour du livreur (`4571`, `8d34`) → reprise (`4de0`).
4. **Tous contents** (`8d9c = 1`) : `3893` (scène de départ) et `8d20 = 1`.
5. Animations d'attente : un Zoombini du groupe (hors livreur) joue un script `SCRS` dépendant de son pied : **13034 + pied**, soit 13035…13039 toutes les 30 ticks tant que le quota `8e76` n'est pas atteint (`8e76` = 3, ou taille du groupe − 1 une fois tous les trolls contents).

### 4.4 Clavier

Aucun raccourci, sauf `0x16f` : coupe ou rejoue la consigne vocale `DS:a2c4 = 0x4e67` (niveau 0, `\0SND` 20071) ou `0x4e68` (20072) (`11a0:155e`). Mode de débogage : `1130:3355` affiche les quatre lignes `Arno / Willa / Shyler / Meal` de 8 entiers (ensembles aimés et repas).

### 4.5 Historique des assiettes

Chaque repas servi laisse une **assiette visible** sur le décor (`SCRB` 12025 + `8e48`, 12000-12044) : `3aa6` range son masque dans `8e26` ; `8e4c` compte les assiettes (28 au plus, table `0x926 + 8·i` : masque, type, scène) ; types d'assiette 4 à 7 (`478e`) : un type par verdict de troll (4 = repas commun, 5 à 7 = repas d'Arno, Willa, Shyler) ; les assiettes d'un même troll défilent sur trois emplacements (`8e4e`, `8e50`, `8e52`). Au niveau 3 l'historique démarre avec 4 assiettes (§2.3).

## 5. Animations et sons

Les réactions des trolls sont des `SCRB` ids `base + compteur` (valeurs lues dans `2c0b` ; les trois trolls ont des banques de scripts séparées : 8000, 9000, 10000) :

| Verdict | Arno (`SCRB`, objet 8032) | Willa (`SCRB`, objet 9034) | Shyler (`SCRB`, objet 10038) |
|---|---|---|---|
| 0 (un ingrédient de trop) | 8006 + {0, 1} alterné | 9000 + (0 à 4, boucle) | 10014 + (0 à 5, boucle) |
| 1 (aimé mais incomplet) | 8000 + (0 à 5, plafonné à 5) | 9021 + (0 à 4, plafonné à 4) | 10009 + (0 à 4, plafonné à 4) |
| 2 (parfait) | 8017 + `rand(0..1)` | 9010 + `rand(0..6)` | 10023 + `rand(0..3)` |
| 4 (plusieurs de trop) | 8008 + (0 à 5, boucle) | 9005 + (0 à 4, boucle) | 10020 + (0 à 2, boucle) |
| fureur (budget épuisé) | 8022 + `8d80` | 9028 + `8d80` | 10032 + `8d80` |
| départ (`3893`, chaque base + `rand(0..1)`, selon les trolls présents) | 8024 (Arno seul), 8026 (Arno + Willa), 8028 (Arno + Shyler), 8030 (les trois) | 9030 (Arno + Willa), 9032 (les trois) | 10035 (Arno + Shyler), 10036 (les trois) |

(Valeurs d'immédiat sûres ; l'association précise à chaque situation est **probable**. Les compteurs `8df0…8e02` font défiler les variantes : une réplique différente à chaque réaction.) Les `SCRB` 7005…7055 sont les paires hors/en service des boutons (`base` niveau 0 = 7005, 1 = 7015, 2 = 7027, 3 = 7041 ; `+ 2k + état`) ; 7001–7004 le four ; 7057–7058 l'animation « servir » (7057 niveau 0, 7058 sinon). Les `SCRS` 13000–13039 sont les gestes des Zoombinis (marche, attente, voix : événement 211), 14000–14005 les renvois.

Sons : voix d'introduction `20071` ou `20072` ; boutons 999 (carte) et 996 (Continuer) ; chaque réplique de troll porte son `\0SND` dans le `SCRB` (8000–8040, 9000–9033, 10000–10040) ; plages 7000–7009 (ingrédients, four), 11000–11007, 12000–12004 (assiettes), 13000–13008, 14000, 15000–15006 (non attribuées ; voir §7). Musique : aucune repérée. Le narrateur d'introduction est choisi par `1168:5c57(S+0x2e)` puis `1130:5358(code)` (codes 0 à 4 : 1 voix ou 2 ou 3 voix en séquence).

## 6. Écriture dans le tampon de partie `S`

À l'**entrée** : `S+0x2e` (mémoire de dialogue de l'écran 9) +1 (`1168:5c57`) ; `S+0xCA/CC` par le changement d'écran.

**Continuer** (région 2, seulement si `8d20 ≠ 0`) : `1168:3dd0(0, 1)` met `+0x127 = 1` aux 20 premiers Zoombinis actifs ; `970c = 0` ; son 996 ; `1168:2982(45, 0, 250, 690)` (sortie des Zoombinis) ; `8556 = 4` (**camp de base 1**).

**Carte** (région 1) : `8556 = 1`, sans `3dd0` : tous les Zoombinis restent à `+0x127 = 0`.

Dans les deux cas `Exit` appelle `1168:36e1(0, 1)` (hors entraînement) :

- les Zoombinis à `+0x127 = 0` sont **perdus** (donc : **tout le groupe** si on quitte par la carte ou après une défaite, **personne** après un Continuer) ; ils sont rangés avec `fiche[8] = 0` puis renvoyés avec les perdus de l'étape : **réserve du choix des Zoombinis** (`S+0xA1FC`) ; `S+0x54 = 0` ;
- masque de réussite : `S+0x58` (écran 9 − 7 = 2) reçoit le bit `1 << niveau` quelle que soit l'issue ; sans perdu et avec `S+0x54 ≠ 0` (étape faite d'une traite) et hors entraînement : bit `0x10 << niveau` ;
- **c'est la dernière épreuve de l'étape 1** : sans perdu, et pour un couple (étape 1, niveau + 1) absent de la liste des 16 monuments, un **monument** est ajouté (`S+0xA2+k` = 1, `S+0xB2+k` = niveau + 1, date du jour) ; le niveau de l'étape 1 (`S+0xC2`) augmente de 1 (3 au plus, `DS:9700 = 1`) ; `1108:0000` pose en plus `S+0x50 |= 1 << niveau` (étape 1 terminée) en quittant l'écran 9 vers 4.

Détail de la logique : [../screens.md](../screens.md) §1.2, §3.4.

## 7. Points ouverts

1. Ensemble aimé **vide** au niveau 1 (probabilité 8 à 25 % selon la taille de la base) : le comportement d'origine (servir un plateau vide ?) n'a pas été observé ; l'algorithme est lu tel quel.
2. Les ingrédients : noms (pepperoni, champignons… ; sundaes), appariement indice → image et rôle de `8d5c`, `8d64` (aucune lecture utile).
3. Livreur : un seul Zoombini porte-t-il tous les plateaux (`8d14` jamais posé) ou le suivant du groupe prend-il le relais ? Nombre exact de repas par Zoombini non établi.
4. Effet exact du repas qui épuise le budget (`8d82`) : la chaîne `8df6`, `8d9a`, `4de0`, `4ff7` n'a été lue que partiellement ; la fin de l'épreuve (trolls furieux, plus de Continuer) est **probable**.
5. Ordre exact des paramètres de `595f` au niveau 3 ; association des plages sonores 7000–7009, 11000–11007, 12000–12004, 13000–13008, 14000, 15000–15006.
6. Clic id 13 (glisser un Zoombini) : code mort ou activé par un autre chemin (`8d22`) ; `1130:5ea9` (« bctwo.mhk ») : préchargement du camp suivant, non vérifié.
7. Associations Arno = troll 0, Willa = 1, Shyler = 2 à confirmer sur les `SCRB` (8032, 9034, 10038).
