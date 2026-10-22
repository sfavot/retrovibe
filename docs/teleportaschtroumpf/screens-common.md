# Écrans communs : S49, S48, S46, S45 (S03) et générique S52

Tâche E1b-2. Comportement de chaque écran d'après la rétro-ingénierie (`archives/teleportaschtroumpf/re/`, adresses `segment:offset`), et ce que reproduit le code (`src/games/teleportaschtroumpf/scenes/`). Confiance : **sûr** (code lu et cohérent), **probable**, **hypothèse**. Tests : `test/teleportaschtroumpf/common-screens.test.ts`.

| Écran | Fichier | Fonction d'origine |
|---|---|---|
| S49 confirmation | `s49-confirm.ts` | `1823:000c(n)` (+ `1823:170a` pour le texte) |
| S48 pause | `s48-pause.ts` | `269a:0007` |
| S46 abandon | `s46-abandon.ts` | `1823:0415` (`1823:0e21` en est une copie de désassemblage) |
| S45 aide / S03 info | `s45-help.ts`, `s03-info.ts` | `1e20:027c` → `1e20:0007` |
| S52 générique | `s52-credits.ts` | `154c:052e` (`154c:03e8`, `154c:046e`, `154c:0214`) |
| aides | `common/choice.ts`, `common/text.ts` | — |

## Points communs

- **Entrées** : toutes les boucles de l'original lisent les drapeaux de navigation (`DS:4BBB`, gauche 4, droite 8, haut 1, bas 2) et le bouton (`DS:4BBD`, 1 = gauche, 2 = droit), voir `engine.md` §4. **Aucune ne reboucle** : les index sont bornés (`if (i < 0) i = 0; if (i > max) i = max`). `engine/menu.ts` reboucle ; `common/choice.ts` `updateMenu` annule le rebouclage de `Menu` et applique la navigation de l'écran (le survol, le clic, la voix et le curseur restent ceux de `Menu`). Décision `plan.md` : survol + clic, flèches actives.
- **Surbrillance** : toujours un changement de palette (`10 A4 CC`, `HOVER_COLOR`), jamais un sprite, sauf la main de S46.
- **Sauvegarde / restauration d'écran** (`engine.md` §3) : S48, S46, S45 et S49 (en mode `push`) s'affichent par-dessus la partie ou un autre écran. `ScreenSnapshot` mémorise les tampons A et B et la palette à l'entrée et les rétablit à la sortie, seulement si l'écran est empilé (`ctx.scenes.depth ≥ 2`) ; en `replace` il n'y a rien à reprendre. Le plateau n'a donc pas à tout redessiner pour reprendre.
- **Fondus** : S49, S46, S45 font leur fondu d'entrée (`1523:00ee`) ; S48 n'en fait pas (la palette est envoyée d'un coup, `3311:01b1`). Le fondu au noir de sortie (S49 : `1523:01fa`) est celui de la transition (`push` / `pop` avec `{ fade: true }`).
- **Fin d'écran** : `1343:0037` est un fondu sonore du son courant puis `15f9:089f(0, 0x400000)` coupe la voie. `VoiceChannel` n'a pas de fondu : `ctx.voice.stop()` (écart mineur, la musique repart au tick suivant comme dans l'original).
- Pas de pas lent : `step = 1` (les boucles de l'original tournent aussi vite que `1764:018a` les rend).

## S49 : confirmation (`1823:000c`)

- **Ressources** : `s49a001d.mcg` (chargé dans le tampon A, palette entière), `s49a.dat`, police par défaut `S52D001F` (16 px, couleur `0x7e`), voix `s49v%03dt.voc`. Sûr.
- **Texte** : `1823:170a` cherche la clé `"S49_NNT"` dans `s49a.dat` (caractère par caractère) et copie la ligne. `n` → clé `S49_(n+1)T` (table de saut `CS:[BX+0x3FD]`, un `PUSH "S49_0NT"` par cas, lue dans le désassemblage). **Sûr.**
- **Mise en page** : tant que `32f4:0192(ligne) ≤ 0xBE` (190 px) on ajoute un caractère ; au dépassement on recule jusqu'à l'espace précédente (remplacée par 0) et la ligne suivante commence après. Chaque ligne est dessinée à `x = 0x55 + ((0xC3 − largeur) >> 1)`, `y = 10 + 20 × ligne`, avec `32f4:0018`. Reproduit tel quel (`wrapText`). Un mot plus large que 190 px fait boucler l'original ; ici il est coupé net. Sûr.
- **Textes dans l'image** : `s49a.dat` signale `S49_07T` (OUI), `S49_08T` (NON) et `S49_12T` comme « directement sur les images ». Aucun appelant n'utilise `n = 6`, `7` ni `11` (appelants de `1823:000c` : S46 avec une table de personnages et 9 / 10, `21ee:0006` avec 10, `1823:0da4` sans appelant). Pour ces `n` rien n'est dessiné (sinon l'original dessinerait le texte). Les boutons « Oui » / « Non » sont dessinés dans `s49a001d.mcg`.
- **Boutons** : Oui (gauche) et Non (droite) ; textes des entrées de palette **124 et 125** (`DS:BD94`/`BD97` = `DS:57C0 + 3 × 124`). Au départ Oui est en surbrillance (`local_c = 1`). Droite → Non (`bd94` restauré, `bd97` surbrillance), gauche → Oui ; l'original n'accepte un changement que lorsque ni gauche ni droite n'est tenue (`local_b`), ce que `justPressed` donne naturellement. Clic gauche (`DS:3B01D == 1`) valide : le résultat est `local_c` (1 = Oui). Sûr.
- **Voix** : entrée `s49v` + `1 + n` (`15f9:0db1(…, 1, n)`) ; clic droit : `s49v007t.voc` si Oui, `s49v008t.voc` si Non (la voix dit « oui » / « non », 8 à 9 Ko). Sûr.
- **Souris** : aucune zone dans l'original ; les boutons de la souris valident (gauche) ou jouent la voix (droit), la position du pointeur ne compte pas.
- **Écarts** : aucun pour Échap (sans effet, comme l'original). Mot trop long coupé net.

## S48 : pause (`269a:0007`)

- **Ressources** : `s48a000s.hy8` (sprite 0 = parchemin « Pause »), `s48a001d.mcg`, voix `s48v001t` à `s48v010t`. Sûr.
- **Affichage** : l'écran de la partie reste ; `13fc:067d` recopie le rectangle `(0, 0x98, 0x13F, 0x2F)` de l'image (barre du bas, y 152 à 199, quatre parchemins « Retour », « Abandon », « Carte », « Info ») puis `31fe:0481(0, x 0x64, y 0x3C)` dessine le parchemin. La palette de l'image ne diffère de celle du plateau (`s01a00Nd.mcg`, vérifié sur les 9 écrans 1 à 9) que par les entrées **250 à 254** : seules celles-ci sont chargées. Le reste de l'image (rose `FF00AF`, jamais affiché) est ignoré. Sûr.
- **Boutons** : textes des entrées **251, 252, 253, 254** (`DS:BF11`, `BF14`, `BF17`, `BF1A`) ; au départ elles prennent la couleur de l'entrée **250** (`DS:BF0E`), sauf la première en `10 A4 CC`. Sélection de gauche à droite, **bornée à 0..3** (`if (v < 0) v = 0; if (v > 3) v = 3`). Retour : 200, 201, 202, 203 (table `CS:[0x538 + 2i]`) : reprendre, abandon (S46), carte (S02), aide (S45) ; 200 et 201 lus dans le code, 202 et 203 déduits de `engine.md` §1.4 (**probable**).
- **Voix** (clic droit, table `CS:[0x530 + 2i]`) : Retour `s48v` 5 + `rand·2/0x8000` (005 ou 006), Abandon `s48v007`, Carte 1 + rand2 (001 ou 002), Info 3 + rand2 (003 ou 004). Rappel : si la pause dure plus de 30 s (`local_8 + 3000` centièmes, `1764:0300`) sans clic droit, `s48a` + (8 + `rand·3/0x8000`), et le minuteur repart. Sûr pour la logique.
- **Écart / probable** : le code construit `s48a008t.voc` à `s48a010t.voc`, fichiers absents (ils s'appellent `s48v008t` à `s48v010t` dans les données, les seules voix « inemployées » de S48) : faute de lettre de l'original ; ici `s48v`. Le chrono d'inactivité du plateau est gelé par l'appelant, pas par S48.
- **Armement** : l'original ignore gauche / droite pendant les 0,7 s qui suivent l'entrée (`local_8 = now + 70`) et tant qu'une direction est tenue ; les appuis d'avant l'entrée sont oubliés par le moteur (`justPressed`), l'effet est le même. Non reproduit en tant que tel.
- **Écart** : Échap n'a pas d'effet (comme l'original). Pas de rebouclage (comme l'original : `Menu` avec `wrap: false`).

## S46 : abandon (`1823:0415`)

- **Ressources** : `s46a001d.mcg` (palette entière, tampon A), `s46a000s.hy8` (17 sprites), voix `s46a002t` à `s46a004t`. Sûr.
- **Plusieurs joueurs** (`d28c > 1`) : table de personnages → sprite de portrait `{8, 11, 10, 12, 7, 9}` (octets lus sur la pile, `1823:0434-044d`). Emplacements x : `0x40, 0x83, 0xC4, 0x106` (ligne de base y `0x64`) ; 2 joueurs sur les emplacements 1 et 2, 3 joueurs sur 0 à 2, 4 sur 0 à 3, **1 sur l'emplacement 1** (la table de sauts `0xD94` / `0xD9C`). Ordre de dessin : parchemins (sprites 0 à 3 par emplacement), sprite 5 en (0x9E, 0xB4) et sprite 4 en (0xA0, 0x9A) (les deux boutons), portraits, cloches (sprites `0xD + emplacement`), puis, à chaque image, la main (sprite 6 en (x de l'emplacement, 0x73)) quand la ligne « joueurs » est choisie. Sûr.
- **Sélection** : ligne 0 = les joueurs (`iVar6`, 1..d28c, gauche / droite), ligne 1 = bouton « Abandon général » (sprite 4, texte en entrée **121**), ligne 2 = « Quitter l'abandon » (sprite 5, entrée **122**) ; base `123`. Haut / bas changent de ligne, bornés à 0..2 ; gauche / droite ne comptent que sur la ligne 0 ; l'index du joueur est conservé en visitant les boutons. Voix du clic droit (`local_1a`) : joueurs `s46a003t`, « général » `s46a002t`, « quitter » `s46a004t`. Sûr. Les zones de souris (cloche + main ; sprites 4 et 5) viennent des bornes des sprites.
- **Validation** : ligne 0 : S49 avec `n = table[personnage]`, `{0, 4, 5, 1, 2, 3}` (Costaud → `S49_01T`, Poète → 05, Grognon → 06, Gourmand → 02, Farceur → 03, Bricoleur → 04, vérifié par un test sur `CHARACTER_NAMES`) ; ligne 1 : S49 avec `n = 10` si plusieurs joueurs, 9 sinon (`1823:0cb9`) ; ligne 2 : retour sans S49.
- **Effets** (`1823:0cd5-0d4f`) : après un Oui sur un joueur, la structure est compactée, `d28a` ajusté, `d28c − 1`, et **la boucle `do … while (SI == 0 && d28c != 0)` réaffiche S46** avec les joueurs restants ; un Non sur un joueur réaffiche aussi S46. La fonction rend 1 (fin de partie sans vidéo) si le choix « général » est confirmé ou s'il ne reste plus aucun joueur, 0 sinon. Un Non sur « général » rend 0 (comme « quitter »).
- **Un seul joueur** (`d28c == 1`, `1823:047a`) : pas d'écran S46, S49 est appelé tout de suite avec le message du personnage ; Oui rend 1, Non rend 0.
- **Contrat** (`AbandonResult`) : `cancel` ; `player` + `index` (Oui sur un joueur : **au plateau de compacter** via `game/` puis de recréer `createAbandonScene` avec les personnages restants, ou de terminer la partie s'il n'en reste plus) ; `all` (« général » confirmé, et le Oui du joueur unique). Chaîne S49 par `askConfirmation(…, "push")` ; la réponse est gardée et traitée au pas suivant (le gestionnaire de scènes ne permet pas de lancer une transition depuis `resume`).
- **Écart de signature (à valider)** : l'original a besoin du **personnage** de chaque joueur (portraits et message S49) ; la souche ne recevait que `players: number`. `createAbandonScene(players: number | readonly number[], …)` accepte donc aussi la liste des personnages (compatible : un nombre suppose les personnages 0 à n − 1, repli). Le plateau doit passer `game.state.players.map(p => p.character)`.

## S45 aide et S03 info (`1e20:027c`, `1e20:0007`)

- **S45** : dessine S03, copie à l'écran, fondu d'entrée, boucle : clic gauche (`DS:3B01D == 1`) sort, clic droit joue la voix `"s45a" + 3` ; puis `1343:0037` et arrêt du son. Sûr.
- **S03** (`s03-info.ts`, `drawInfo`) : lit `1f33:019a(0)` (secondes du chrono 0 = `game.state.elapsed`) et `DS:6EA4` (durée) ; graduations = `min(27, ⌊secondes × 27 / durée⌋)`. L'original tronque le produit à 16 bits (`IMUL AX,AX,0x1b` puis `DIV` non signé, `1e20:0015`), si bien que sa barre retombe au-delà de 2427 s écoulées : **défaut corrigé** dans `timeGraduations` (décision du 2026-10-22).
  - Barre : `i < graduations` : sprite `0x18` en (0x126, `0xB3 − 5i`).
  - Par joueur `i` (0..d28c−1) : portrait = sprite `personnage` (0 à 5) en (0x59, `0x2E·i + 0x36`) ; ingrédients : d'abord ceux de l'objectif (`1e52:0008`, masque `DS:19B8`) : sprite `6 + k` s'ils sont possédés (`1e52:0034`), `0xF + k` sinon ; puis les possédés hors objectif (`6 + k`) ; x = `14 × rang + 0x57` (rang à partir de 1), y = `0x2E·i + 0x30`.
  - Texte « points/objectif » (`DS:6EC2 + 0x14·i`, objectif `DS:19B9`, deux chiffres : `5/13`, `12/13`, `3/05`) en (`14 × rang + 0x52`, `0x2E·i + 0x20`), police par défaut ; puis la goutte de rosée : sprite `0xE` (`0x17`, grisée, si 0 point) à `x = 14 × rang + 0x59 + largeur du texte`. Sûr.
  - `1fc6:0c20` (S38) appelle aussi `1e20:0007` : `drawInfo` est exporté pour E2.
- **Écart** : le code nomme la voix `s45a003t.voc` ; le fichier livré est `s45v003t.voc` (même faute de lettre que `s48a`) ; ici `s45v003t.voc`.

## S52 : générique (`154c:052e`)

- **Ressources** : `s52d001d.mcg` (fond, noir 0x7E, blanc 0x7F), polices `s52d3.pfn` (12 px, gras, lignes `@1`) et `s52d2.pfn` (10 px), texte `s52dsphi.doc`, musique `s52m002m.voc` en boucle. Sûr.
- **Format du texte** : CP437, lignes séparées par CR / LF (l'original remplace les deux par 0 puis saute un ou deux 0 par ligne : `154c:0141`). Une ligne `@1…` s'affiche en police grasse, `@2…` et `@3…` sont des **repères** (ils s'affichent sans leur préfixe). Sûr.
- **Défilement** : une page de 15 lignes (y `14 + 12k − décalage`, k = 0..14) ; `154c:046e` fait 12 pas d'un pixel (un par tick, `1764:0339(1)`), puis avance d'une ligne ; seules les lignes d'écran 20 à 179 sont recopiées (`0x1900` et `0xC800` octets). Phase 1 jusqu'à ce que la ligne du haut soit `@2`, phase 2 jusqu'à `@3` ; un clic ou Échap, **pris en compte au relâchement** (drapeau 1 puis 2, `DS:365FF`), saute au repère de la phase. Le premier pas de 12 pixels précède la boucle (son drapeau est remis à zéro). Page finale : page fixe à partir de `@3` ; attente d'un clic gauche, 200 s au plus (`1f33:0279(200)`) ; fondu au noir de 64 pas (`1523:01fa(0x40)`) ; musique coupée. Sûr.
- **Texte d'une ligne** (`154c:0214`) : centrée sur 320 px (`(0x140 − largeur) / 2`), 8 passes décalées de ±1 px en couleur 0x7E puis une passe en 0x7F. Police `s52d2` (aucune balise ou `@2`/`@3`) avec avance `largeur + 1`, ou `s52d3` (`@1`) avec `−1` à la mesure et au dessin (`154c:018b` / `154c:01c6` reçoivent `0xFFFF`). Sûr.
- **Fichier du texte** : `s52dsphi.doc` (texte CP437, repères `@1`, `@2`, `@3`) est extrait avec les autres fichiers (`DATA/S52/S52D/S52DSPHI.DOC`, ainsi que `S52D.DOC`) ; l'extension `.DOC` a été ajoutée aux extensions gardées par `scripts/teleportaschtroumpf/extract_utils.py`. Sans le fichier (repli défensif), le générique montre le fond et la musique, la page finale attend un clic, puis fondu et sortie.
- **Écart** : à la page finale, Échap vaut aussi clic (l'original ne teste que le bouton).

## Pour l'appelant (plateau, `flow.ts`)

- Pause : `ctx.scenes.push(createPauseScene(cb), { fade: true })` ; `cb` : `ctx.scenes.pop({ fade: true })` pour reprendre ; pour S46 / S45, `pop` puis `push`, ou `push` au-dessus de S48.
- Abandon : passer les personnages ; sur `player`, compacter, puis rouvrir S46 avec ceux qui restent (ou terminer s'il n'y en a plus) ; sur `all`, `goMainMenu`.
- `test/teleportaschtroumpf/flow.test.ts` couvre le parcours réel des écrans (S09, S08, S04, S49, S52) ; un appui saute au repère de défilement suivant, le premier étant absorbé par le premier pas.
