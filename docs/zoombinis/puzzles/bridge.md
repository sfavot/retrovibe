# Les gorges allergiques (`BRIDGE.MHK`, écran 7) : étude de rétro-ingénierie

Tâche T6. Première épreuve de l'étape 1 de L'Odyssée des Zoombinis (`ZOOMBINI.EXE` 1.0FR). Le moteur (table des écrans, `SCRB` / `SCRS`, `REGS`, RNG, ticks de 17 ms) est dans [../engine.md](../engine.md) ; le parcours, les niveaux, le tampon de partie `S` et la logique de sortie `1168:36e1` dans [../screens.md](../screens.md). Les fonctions citées sont dans le corpus `archives/zoombinis/re/ZOOMBINI/` ; les routines que Ghidra n'avait pas créées (callbacks d'événements, corps de `switch`) ont été lues sur une copie jetable du projet.

Confiance : **sûr** = lu dans le code ; **probable** = déduit de plusieurs indices ; **hypothèse** = non vérifié.

## 0. Résumé

- Deux ponts (haut et bas) relient la falaise gauche à la falaise droite. Chaque pont **refuse** les Zoombinis qui ne portent pas ses traits (les falaises sont allergiques). Le joueur **glisse chaque Zoombini sur l'un des deux ponts** ; s'il est accepté il traverse, sinon la falaise éternue et le Zoombini revient en arrière (une erreur de plus). **Six erreurs** ferment les ponts. Les Zoombinis qui n'ont pas traversé quand le joueur quitte sont perdus (sûr).
- La règle cachée est tirée à l'entrée : un « ensemble de traits » (1 à 3 conditions, combinées par **OU**) accepté par un pont ; **l'autre pont accepte tous les autres** Zoombinis. Le tirage choisit une règle qui sépare le groupe en deux moitiés aussi égales que possible (sûr, avec un défaut de balayage au §2.2).
- Le niveau (0 à 3) ne change **que la forme de la règle** (nombre de conditions). Le nombre d'erreurs (6), les files d'attente et les temporisations sont les mêmes à tous les niveaux (sûr).

## 1. Identification

| Élément | Valeur |
|---|---|
| Écran | 7 (`DS:8552`), descripteur `1530:0a98`, première épreuve de l'étape 1 |
| Archive | `BRIDGE.MHK` (chaîne `1530:0b77`) |
| Enter | `10c0:00e6` |
| Exit | `10c0:058d` (appelle `11a8:021c`, qui appelle `1168:36e1(0,1)` : voir §6) |
| Tick | `10c0:05e4` |
| Key | `10c0:0d20` (débogage seulement, §4.5) |
| Clic de région | `10c0:0a99(id)` (table de régions `DS:0a8c`, `1038:0000(0xc000, 1, 0x0a8c)`) |
| Callback d'événements des Zoombinis (`+0x10`) | `10c0:0f68` (non fonction Ghidra ; table de `switch` `CS:12ee`) |
| Callback d'événements des objets de décor | `10c0:0e5a` (table `CS:0f3c`) |
| Règle : génération | `10c0:131a` (appelée par Enter, `DS:7060` = niveau) |
| Règle : test d'acceptation | `10c0:2059` |
| Réinitialisation des variables | `10c0:002b` |

Ressources de `BRIDGE.MHK` (vérifiées) : `tBMP` 1000 (fond 640 × 480, palette `SHPL` 1000), 1100 (7 images), 1200 (182 images), 1300 (4 images), 1400 (6 images : boutons), 1600 (160 images vides, inutilisées) ; `SCRB` 1100–1106, 1200–1248, 1300–1301 ; `SCRS` 1000–1019 et 2000–2024 ; `\0SND` 1000–1012, 1200–1226, 2000–2008. Pas de `NODE`, `PATH` ni `REGS` : les parties de `SCRB` sont posées sans recalage (`11a0:0000(0, k, id)`, indicateur 0).

Chargement par Enter (sûr) : groupe de formes 0 = `tBMP` 1100 (`SCRB` 1100–1106), 1 = `tBMP` 1200 (`SCRB` 1200–1248, 49 scripts), 2 = `tBMP` 1300 (`SCRB` 1300–1301) ; `1168:03ef(20, 20, 1000)` charge les 20 `SCRS` 1000–1019 (« REJECT ») et `1168:04d0(5, 25, 2000)` les 25 `SCRS` 2000–2024 (« NORMAL », 5 par pied) ; `11a8:2ae6(1400)` charge la planche des boutons en `DS:70ae/70b0` ; palette sauvée `1058:048a(236, 10)`.

Préchargement de sons : Enter appelle sept fois `11a8:313a` (plages `\0SND` 20000–29999, 1200–1201, 1000–1099, 1216–1226, 1214–1215 avec l'indicateur 1 ; 175–199 avec l'indicateur 0) ; le sens de l'indicateur n'est pas vérifié.

## 2. Règle

### 2.1 Zoombinis et attributs

Un Zoombini est décrit par 4 octets de valeurs 1 à 5, copiés en `+0xec…+0xef` de l'objet (`1168:365d` les range dans un tableau `DS:9a28` : mot = nombre de Zoombinis présents, puis 4 octets par Zoombini) ; `2059` les lit en `+0xbb + n` pour `n` = 1 à 4 (même donnée, **sûr**). Dans la suite « attribut n » = octet n−1 de la fiche (attribut 1 = octet 0). L'attribut 4 (`+0xef`) choisit aussi le script de marche : c'est très probablement le **pied** (cinq façons de se déplacer, `SCRS` indexés par `+0xef`) ; les trois autres noms restent un point ouvert de `screens.md` (**hypothèse** : cheveux, yeux, nez dans cet ordre).

Le tableau `DS:9a28` ne contient que les Zoombinis actifs (`+0xe0 ≠ 0`) **et** à `+0x127 ≠ 0` : à l'appel de `131a` ce sont les 16 membres du groupe (n = 16 en partie normale).

### 2.2 Tirage de la règle (`10c0:131a`)

1. **Candidates** (tableau de dwords, un octet par attribut ; les valeurs vont dans l'octet de l'attribut, 1 à 5) :

| Niveau | Forme de la règle | Candidates | Détail |
|---:|---|---:|---|
| 0 | 1 condition « attribut a = v » | 20 | 4 attributs × 5 valeurs |
| 1 | 1 attribut, **deux valeurs** (« a = v1 **ou** a = v2 ») | 40 | 4 attributs × 10 paires `{1,2},{1,3},{1,4},{1,5},{2,3},{2,4},{2,5},{3,4},{3,5},{4,5}` |
| 2 | 2 conditions sur 2 attributs différents (OU) | 150 | 6 paires d'attributs × 5 × 5 |
| 3 | 3 conditions sur 3 attributs différents (OU) | 500 | 4 triplets d'attributs × 5 × 5 × 5 |

(Tables du code : paires de valeurs `DS:0b1e`, bases `DS:0b46`, pas `DS:0b5e` ; boucles de `131a`, sûr.)

2. **Effectif** : pour chaque candidate, nombre de Zoombinis du groupe qui la **satisfont** (≥ 1 condition vraie : le test est un OU, un octet nul de la candidate ne correspond jamais, car les valeurs vont de 1 à 5).
3. **Choix de l'effectif cible** `c` : on teste, dans l'ordre, la suite `c₀ = ⌊n/2⌋, c₀+1, c₀−1, c₀, c₀−2, c₀−1, c₀−3, …` (le pas alterne +1 / −2 : `pas ← −(pas+1)`), en ignorant `c = 0` et `c ≥ 16`, jusqu'à ce qu'**au moins une** candidate ait exactement `c` Zoombinis satisfaisants. Ordre effectif des valeurs distinctes : `n/2`, `n/2+1`, `n/2−1`, `n/2−2`, `n/2−3`, … ; on ne teste **jamais** `n/2+2` ou plus. (Pour n = 16 : 8, 9, 7, 6, 5…). La suite est une asymétrie probablement involontaire de l'original ; une valeur négative est traitée en non signé et ignorée ; si aucune candidate ne convient la boucle ne se termine pas (cas impossible avec 16 membres de valeurs aléatoires, non testé).
4. Parmi les candidates d'effectif `c`, tirage **uniforme** (`10a8:04e8(k, 1)`, k = nombre de candidates à égalité, `k`-ième dans l'ordre d'énumération).
5. **Placement** (`DS:7092…`, 28 octets remis à 0 par `002b`) :

| Adresse | Contenu |
|---|---|
| `7092` mot | 1 (règle présente) |
| `7094` mot | **w** = `10a8:04e8(1, 0)` : 1 = la règle est acceptée par le pont du **haut**, 0 = par le pont du **bas** |
| `7096` octet | nombre de conditions (1 au niveau 0, 2 au niveau 1, 2 ou 3 aux niveaux 2 et 3 = nombre d'octets non nuls) |
| `7097…709b` | numéro d'attribut (1 à 4) de chaque condition |
| `709c…70a0` | valeur (1 à 5) de chaque condition |

Au niveau 1 les deux conditions portent sur le même attribut (deux valeurs). Aux niveaux 2 et 3 les conditions sont rangées par octet de candidate croissant, c'est-à-dire par attribut 4, 3, 2, 1 (ordre sans effet : OU).

Au niveau 0, si une seule candidate avait l'effectif retenu, `DS:96ec` = la candidate et `DS:96f0` = l'effectif sont mémorisés ; sinon remis à 0 (sûr). `1190:2748` (grottes, niveau 0) les relit pour ne pas retomber sur le même effectif (voir [tunnels.md](tunnels.md)).

### 2.3 Acceptation (`10c0:2059(snoid+0x30, pont, &7092)`)

`pont` = numéro de la **zone de dépôt** : 1 = pont du haut (`SCRB` 1300), 2 = pont du bas (`SCRB` 1301) (sûr).

```
A = vrai si au moins une condition i vérifie  attribut[idx_i](Zoombini) == valeur_i
accepté_haut = A ? w : (w == 0)                // w = DS:7094
refusé(pont 1) = (accepté_haut == 0)
refusé(pont 2) = (accepté_haut != 0)
```

Donc si w = 1 le pont du haut accepte exactement les Zoombinis qui vérifient A, le pont du bas accepte les autres ; si w = 0 c'est l'inverse. **Aucun Zoombini n'est accepté par les deux ponts**, et chaque Zoombini est accepté par exactement un pont (sûr). Les chaînes de débogage `Upper bridge accepts:` / `Lower bridge accepts:` (touche `A`, §4.5) affichent la règle A côté w.

### 2.4 Erreurs, perte, fin

- Une **erreur** = un Zoombini refusé (compteur `DS:7068`, 0 à 6, incrémenté à la fin du script de rejet : événement 20 de `0f68`, plafonné à 6). **Au sixième refus, l'épreuve est condamnée** : le compteur vaut 6, la condition d'entrée du clic (`7068 < 6`) échoue, le Tick n'accepte plus de décision (§4.3) et une animation de fin (`SCRB` 1221, événement `0`) est lancée. On tolère donc **5 erreurs, la 6e est fatale** (sûr pour le compteur, **probable** pour le mot « condamnée » : aucune fin automatique de l'écran n'existe).
- Les Zoombinis refusés restent disponibles (ils retournent sur une place d'attente).
- Le bouton **Continuer** n'est actif qu'après qu'**au moins un** Zoombini a traversé (`DS:705a` ≠ 0). Il est donc possible de partir avec des Zoombinis restés sur la falaise : ils sont **perdus** (§6).
- Aucun écran ne s'arrête tout seul : même quand les 16 ont traversé il faut cliquer Continuer (sûr). Quand le dernier traverse, la voix `20055…20063` (`0x4e57…0x4e5f`) est tirée au sort (`0f68` cas 3/6 et `05e4`).

## 3. Les quatre niveaux

| | Niveau 0 | Niveau 1 | Niveau 2 | Niveau 3 |
|---|---|---|---|---|
| Règle | 1 valeur d'un attribut | 2 valeurs d'un même attribut | 1 valeur de chacun de 2 attributs | 1 valeur de chacun de 3 attributs |
| Nombre de candidates | 20 | 40 | 150 | 500 |
| Erreurs | 6 | 6 | 6 | 6 |
| Voix de regret (`0e5a` événement −1) | tirage `rand(0..4) > niveau` (donc 4 fois sur 5 au niv. 0, 0 au niv. 4) | idem | idem | idem |

(Niveau lu par `1168:515d` dans `DS:7060` ; en aventure il vient du niveau de l'étape 1, en entraînement du niveau choisi. Sûr.) Sons : à `0eea` (événement −1 d'un objet de décor) la voix `0x4e4d…0x4e50` (20045–20048) n'est jouée que si `rand(0..4) > niveau` **ou** si le compteur de visites `S+0x2a & 0xfff < 4`, et seulement s'il reste des Zoombinis sur la falaise.

## 4. Déroulé et état

### 4.1 Variables de l'écran

| Adresse (DS) | Rôle |
|---|---|
| `7054/7056` | poignée d'archive |
| `7058` | écran actif (1 après Enter) |
| `705a` | 0 tant qu'aucun Zoombini n'a traversé ; reçoit le nombre de traversés au premier |
| `705c`, `705e` | nombre de Zoombinis arrivés par le pont du haut / du bas (index dans les listes de places d'arrivée) |
| `7060` | niveau |
| `7062/7064` | horodatage (ticks) du dernier démarrage de décision (`10c0:0000`, lu par `0014`) |
| `7066` | 1 dès qu'un Zoombini a été manipulé |
| `7068` | erreurs (0 à 6) |
| `706a`, `706e` | objets « socle » du haut (`SCRB` 1201) et du bas (`SCRB` 1200) |
| `706c` | objet « clôture » (6 poteaux, `SCRB` 1202 + erreurs) |
| `7070` | objet « visage de la falaise » (départ `SCRB` 1105) |
| `7072` | objet `SCRB` 1103 (indicateur d'arrière-plan, indicateur 0x100000) |
| `7074` | drapeau « fin » posé par l'événement 0 de `0e5a` |
| `7076`, `7078`, `707a` | décision en cours : refusé (1) ou accepté (0) ; copie de `7076` posée au démarrage et remise à 0 à l'événement −1 (donc **un seul rejet à la fois**, les acceptations peuvent se chevaucher) ; pont (1 haut, 2 bas) |
| `707c` | nombre de Zoombinis en cours de déplacement |
| `707e` | dernier objet-animation créé |
| `7080` | socle à animer au prochain Tick (`706a` ou `706e`) |
| `708e` | longueur de la file de décisions (0 à 2) ; `7082/7084` ponts, `7086/7088` identifiants d'objet, `708a/708c` drapeaux « refusé » des deux entrées |
| `7090` | type d'éternuement (1 à 5) posé par les `SCRB` du visage (événements 1 à 5) |
| `70b2` | 1 entre la fin du script de rejet et le tour suivant |
| `70b8`, `70ba` | animations d'attente autorisées / jouées ; `70bc` taille du groupe ; `70be/70c0` dernier instant ; `70c2` période (**60 ticks**, 120 si `DS:908a ≠ 0`) ; `70c6` état du tirage sans remise de `1098:0098` |

Valeurs initiales : `10c0:002b` (sûr). Le groupe initial est posé par `1168:0858` (création des 16 objets) puis `1168:2505(0)` : les 3/4 du groupe vont sur les places d'attente (liste `DS:0ac8`), le reste est « en file » ; `1168:274e(0, 45)` échelonne l'arrivée : un Zoombini toutes les 45 ticks (765 ms). Au Enter tous les Zoombinis sont à `+0x127 = 0` (`1168:3dd0(0,0)`).

### 4.2 Zones cliquables (région `DS:0a8c`, rectangles de 0x24 octets à `DS:09ec + 0x24 × id`)

| id | Rectangle (x1, y1)–(x2, y2) | Rôle |
|---:|---|---|
| 1 | (600, 403)–(639, 440) | bouton **carte** : joue le son 999, `DS:8556 = 1`, ouvre le dialogue de perte (`11a0:16da`) ; la sortie se fait au Tick suivant (§4.3) |
| 2 | (600, 441)–(639, 478) | bouton **Continuer** : seulement si `705a ≠ 0` ; son 996, `8556 = 8` (grottes), `1168:2982(45, 0, 316, 680)` (les Zoombinis sortent) |
| 3 | (0, 0)–(640, 480) | reste de l'écran : prise d'un Zoombini |

Boutons dessinés par `10c0:045f(redessin, appuyé, id)` à partir de la planche 1400 : image 5 (normal) / 6 (appuyé) pour la carte ; image 2 / 3 pour Continuer, ou image 1 (grisé) tant que `705a = 0`.

Clic sur un Zoombini (région 3, `0a99`) : autorisé si `(9702 < 1 || 7066 ≠ 0)` **et** `7068 < 6` (`9702` = Zoombinis encore en train de rejoindre leur place au démarrage). L'objet visé (`11a8:0d61` à la position du curseur, `GetCursorPos`) doit avoir `+0x124 ≠ 8` et `+0x127 = 0` ; si `+0x124 = 9` il faut en plus `70b2 ≠ 0`. Le glisser-déposer est `1168:1742` (rayon de prise `DS:9706 = 55` pixels autour de la boule, rectangles de dépôt = 2 zones de pont + 16 places d'attente). Zones de pont (créées à Enter, `SCRB` 1300 et 1301, indicateur `0x108a000`) : pont du haut ≈ (73, 99)–(140, 146), pont du bas ≈ (69, 198)–(147, 246) ; points d'accroche `DS:0b08` : (116, 104) et (128, 203).

Retour de `1168:166e` = numéro de zone (1 ou 2) si le Zoombini a été lâché sur un pont, 0 sinon. Si 0 le Zoombini retourne vers une place d'attente (logique de `1168:1742`) ; sinon la décision est ajoutée à la file : `7082[708e] = pont`, `7086[708e] = id`, `708a[708e] = 2059(...)` (1 = refusé). Une file pleine (2 entrées) **ignore** le dépôt ; relâcher un Zoombini déjà en file remplace son entrée (`708e` ramené à 1 ou 0 selon sa position, sûr dans le code, effet visuel non testé).

Deux places d'attente : seize points `(x, y)` de `DS:0ac8` : (176,304) (169,327) (144,283) (147,355) (124,318) (119,379) (108,284) (99,345) (88,414) (69,262) (79,303) (78,370) (61,346) (45,301) (36,359) (30,404).

### 4.3 Tick `10c0:05e4`

Protégé contre la ré-entrée (`DS:0b14`). Dans l'ordre :

1. **Sortie demandée** (`DS:8556 ≠ 0`) : attend la fin du son 996 (`1028:0d9e(0x4e44…, 996)`) puis, si le dialogue de perte est résolu (`a2de` = 0 ou 3, 3 = « Tant pis ») et (`a406 ≠ 0` ou `9702 = 0` ou `9704 > 0`), recopie `8556` dans `8554` (changement d'écran) et appelle Exit. `a2de = 2` (« Ah non ! ») annule.
2. **`7074 ≠ 0`** (fin des ponts) : `9708 = 0`, `96f4 = 1`, éteint `706a`, passe `706c` sur le script 1235 (`0x4d3`) et `706e` sur `SCRB` 1221 (`0x4c5`, callback `0e5a`), précharge les sons.
3. **File non vide** (`708e ≠ 0`) et aucun rejet en cours (`7078 = 0`) : on traite l'entrée 0 seulement si `7068 < 6`, **et** non (`708a ≠ 0` **et** `707c > 4`) (au plus 5 rejets simultanés), **et** au moins **45 ticks** depuis `7062` ; sinon l'identifiant visé est forcé à 0 (rien). Le Zoombini est rendu actif par `1168:521e(id)` ; `10c0:0000` horodate ; la file avance (entrée 1 → entrée 0, `708e −= 1`). Pont = `707a`, refusé = `7076`.
   - script `SCRS` = `base + (+0xef) − 1` avec `base` : **2000** (rejet, pont du bas), **2005** (accepté, bas), **2010** (rejet, haut), **2015** (accepté, haut) ; `1168:170f(0, pont)` libère la zone ; `707c += 1` ; `7078 = 7076`.
   - si accepté : `+0x127 = 1` (traverse) et `+0x28 = rand(4..5)` (délai entre images).
   - rappel d'événements `+0x10 = 10c0:0f68`, `+0x2f = 1`.
4. **`7080 ≠ 0`** (socle à animer) : si une décision est en cours, `7080` passe sur son script (`SCRB` 1214 pour le bas, 1222 pour le haut, `0x4be` / `0x4c6`) ; accepté : `706c` joue `SCRB` 1237 + erreurs (bas) ou 1243 + erreurs (haut) (ondulation de la corde à la traversée) ; refusé : le visage `7070` joue `SCRB` 1208 + erreurs (bas) ou 1223 + erreurs (haut) (éternuement n° « erreurs + 1 ») et `706c` joue `SCRB` 1215 + erreurs (bas) ou 1229 + erreurs (haut) (le poteau tombe). Les ids exacts sont `7068 + base` avec les bases ci-dessus (`0x4b8`, `0x4c7`, `0x4bf`, `0x4cd`, `0x4d5`, `0x4db`).
5. `1108:035b` (animations globales).
6. **Animations d'attente** : si `70ba < 70b8` et plus de `70c2` ticks depuis `70be`, un Zoombini déjà arrivé (`+0x127 ≠ 0`, `+0x20 & 1`) est tiré (tirage sans remise sur 16 : `1098:0098`) et joue le script `0x7e3 + pied` = **2020…2024** (événement 211 = son dépendant du Zoombini) ; `70ba += 1`. Le quota `70b8` augmente à l'arrivée du 10e et du 12e Zoombini (+1), du 14e (+2) et du dernier (+2) (`0f68`).

### 4.4 Machine à événements des Zoombinis (`10c0:0f68`, argument = octet bas du terminateur − 1)

| Événement | Source | Effet |
|---:|---|---|
| 1, 4 | début des `SCRS` de traversée / rejet **bas** (terminateurs `e2`, `e5`) | `7080 = 706e` |
| 2, 5 | début des scripts **haut** (`e3`, `e6`) | `7080 = 706a` |
| 3 | fin du script « accepté bas » (`e4`) | arrivée par le bas : `705e` = rang, place `DS:seg130:0x80 + 4 × rang` (16 points), `+0x127 = 2`, ordre de dessin devant le précédent ; `707c −= 1` ; voir « arrivée » ci-dessous |
| 6 | fin du script « accepté haut » (`e7`) | arrivée par le haut : rang `705c`, places `seg130:0x20 + 4 × rang` |
| 10 | fin des scripts de rejet 2000–2004 / 2010–2014 (`e11`) | éternuement : script `SCRS` 1016/1017 (type 1), 1012 (2), 1008 (3), 1000 (4), 1004 (5), +2 pour le pont du haut, +`rand(0..1)`, position imposée (38, 106) (haut) ou (56, 205) (bas) ; `7090 = 0` |
| 20 | fin des `SCRS` 1000–1019 (`e21`) | `707c −= 1`, `7068 += 1` (plafond 6), `70b2 = 1` |
| −1 | fin de tout script de traversée | libère `7078`, `70b2 = 0`, relance de marche vers la zone (`1168:5482(0x24, 1, …)`, rectangles `DS:0ab0` haut / `0ab8` bas : (10,50)–(57,105) et (10,165)–(65,212)) |

« Arrivée » (sûr) : le Zoombini est posé sur la liste de places du pont (16 points, haut : (618,45) (582,49) (552,36) (524,32) (493,25) (464,27) (422,36) (618,86) (588,81) (556,76) (615,129) (580,122) (550,116) (522,112) (493,106) (530,69) ; bas : (610,369) (593,340) (579,303) (549,290) (522,281) (492,271) (621,319) (602,283) (573,267) (533,248) (622,257) (596,242) (561,235) (621,197) (594,187) (566,178)). Puis le compte `1168:02cc()` des Zoombinis ayant `+0x127 ≠ 0` : si `705a = 0` il y est copié (Continuer s'active).

Types d'éternuement (`7090`) : les `SCRB` 1208–1213 (bas) et 1223–1228 (haut) portent chacun un terminateur de type 1 à 5 : bas : 1208 → 1, 1209 → 2, 1210 → 3, 1211 → 4, 1212 → 5, 1213 → 1 ; haut : 1223 → 2, 1224 → 5, 1225 → 1, 1226 → 4, 1227 → 3, 1228 → 2. Le n-ième refus (n = 1 à 6) joue donc le n-ième de ces scripts : l'éternuement et l'animation de recul du Zoombini sont **déterministes par numéro d'erreur** (sûr).

### 4.5 Clavier (`10c0:0d20`)

Sans le mode de débogage (`DS:a43f = 0`) la seule touche examinée est le code `0x16f`, qui appelle `11a0:155e` (coupe ou rejoue la voix `DS:a2c4`) ; `a2c4 = 0` dans cette épreuve : **aucun effet**. En mode de débogage : `A` affiche la règle (`Upper/Lower bridge accepts:` + les conditions), `R` affiche `Snoid Script: … Type:`. Pas d'autre raccourci : tout se joue à la souris.

## 5. Animations et sons

`SCRB` (tous à une image sauf mention ; terminateur `eN` = événement N−1 ; `sNNNN` = son `\0SND` joué à l'image) :

| `SCRB` | Rôle (probable) |
|---|---|
| 1100–1106 | premiers plans fixes ; 1103 (`7072`) animé par `0e5a` (événements 100/101, scripts 1236 / 1103) ; 1105 (`7070`) puis remplacé par le visage |
| 1200 / 1201 | socles du bas / du haut (3 pièces chacun) |
| 1202–1207 | clôture à 6…1 poteaux (état « erreurs 0…5 ») |
| 1208–1213, 1223–1228 | éternuements du visage de la falaise (bas / haut) ; sons 1213, 1209–1211, 1218–1223 (bas), 1208, 1206, 1202, 1203, 1204, 1205, 1224–1226, 1216, 1217 (haut) ; 1213 et 1228 portent l'événement 0 (fin) et le son 1200 |
| 1214, 1222 | secousse du socle bas / haut (événement 10) |
| 1215–1220, 1229–1234 | chute du poteau n (bas / haut) ; sons 1214 et 1215 ; 1220 et 1234 portent l'événement 0 (6e erreur) |
| 1221 | animation de fin (`706e`, son 1201, événements 101 puis 102) |
| 1235–1248 | ondulation de la corde (accepté) par numéro d'erreur |
| 1300–1301 | zones de dépôt (pas d'animation) |

`SCRS` de crossing (`+0xef` = pied 1 à 5) : 2000–2004 rejet bas (33 images, sons 2000–2008 de marche, événements 1 puis 10), 2005–2009 accepté bas (59 images, événements 4 puis 3), 2010–2014 rejet haut (30 images, 2 puis 10), 2015–2019 accepté haut (50 images, 5 puis 6), 2020–2024 attente (événement 211), 1000–1019 réactions au rejet (33 à 40 images, sons 1000–1012, événement 20 à la dernière image). Les terminateurs `0xffc9…0xffd9` (201, 205, 207, 209, 212) déclenchent les voix dépendant du Zoombini (engine.md §3.7).

Autres sons (sûr) : `11a0:0ee7(0, 997)` à l'entrée ; 999 (carte), 996 (Continuer) ; voix de regret 20045–20048 (`0x4e4d…0x4e50`) ; voix de réussite 20055–20063 (`0x4e57…0x4e5f`) quand tous ont traversé ; voix d'introduction : **aucune** dans cette épreuve (`a2c4 = 0`). Pas de musique `tMID` repérée.

## 6. Écriture dans le tampon de partie `S`

À l'**entrée** : `S+0x2a` (mot de mémoire de dialogue de l'écran 7) +1 jusqu'à 0xfff (`1168:5c57`) ; `S+0x54 = 1` (étape commencée d'une traite, par `1108:0000`) ; `S+0xCA/CC` mis à jour par le changement d'écran.

À la **sortie** (`Exit` → `11a8:021c` → `1168:36e1(0, 1)`, uniquement hors entraînement ; en entraînement seul le groupe est vidé) (sûr, voir screens.md 3.4) :

- **Perdus** = les Zoombinis du groupe encore à `+0x127 = 0` (restés sur la falaise ou refusés) ; ils sont rangés avec `fiche[8] = 0` ; ceux qui ont traversé gardent `fiche[8] = 1` et seront de nouveau sur le présentoir du camp.
- Masque de réussite : `S+0x56` (écran 7 − 7 = 0) reçoit le bit `1 << niveau` **quelle que soit l'issue** (même 0 traversée) ; si aucun Zoombini n'est perdu, que `S+0x54 ≠ 0` et hors entraînement, le bit `0x10 << niveau` est aussi posé (réussi sans perte).
- Étape 1 : les Zoombinis perdus retournent à la **réserve du choix des Zoombinis** (`S+0xA1FC`), pas au camp ; `S+0x54 = 0`. Le monument et la montée de niveau ne se produisent qu'à la fin de la **3e épreuve** (hutte à pizza).

## 7. Points ouverts

1. Noms des 5 valeurs de chaque attribut et des 3 attributs autres que le pied (screens.md, point 1).
2. Suite `⌊n/2⌋, +1, −1…` : confirmer en jeu que l'effectif cible ne dépasse jamais `n/2+1` (lecture du code ; aucune exécution).
3. Effet exact du 6e refus : l'animation 1221 et le drapeau `7074` sont certains, la fin de partie n'a pas d'écran propre ; non testé en jeu.
4. Rôle exact de `+0x124` (types 0, 6, 7, 8, 9, 0x70 d'objets) et de `9702` / `9704` (arrivées en cours).
5. Chemins de marche (`1168:5482`, `1168:4231`, rectangles `0ab0/0ab8`) : seule la liste des points est donnée.
6. `DS:908a` (période d'attente 120 au lieu de 60 ticks) : probablement le réglage « moins d'action », à vérifier.
7. Code de touche `0x16f` (aide vocale) : identité de la touche non établie.
8. Le niveau 1 de la règle (« deux valeurs du même attribut ») est lu dans le code ; la présentation à l'écran de la règle n'existe pas (le joueur la déduit).
