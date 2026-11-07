# Drascula : dialogues et répliques

Vague T. Référence de comportement : `talk.cpp` et `converse.cpp` d'`engines/drascula` (ScummVM, GPL v3+) : chaque module cite ses fonctions d'origine et ses écarts en tête.
Les formats (`.CAL`, `talkSequences`, `.ALS`) sont dans `formats.md`, le moteur dans `engine.md`, l'image dans `graphics.md` (§ 11 : comment une réplique prend la main sur l'image).
**Confiance** : **lu** = lu en entier dans ScummVM ; **vérifié** = couvert par un test (`test/drascula/engine/talk.test.ts`, `dialogs.test.ts`, `render/takeover.test.ts`) ; **vu** = contrôlé dans le navigateur ; **supposé** = à confirmer à l'œil ou à l'écoute.

## 1. Modules

| Module | Rôle | ScummVM |
| --- | --- | --- |
| `engine/talk.ts` | `speak(speaker, ligne)` : la réplique (voix, sous-titre, tour de visage, fin) ; `TalkLine` | `talkInit`, `isTalkFinished`, la boucle de chaque `talk_*` |
| `engine/talkers.ts` | `Talkers` (`engine.talkers`) : un personnage par méthode (voix, texte, couleur, place du sous-titre) ; `placeVonBraun` | `talk_igor`, `talk_drascula`, `talk_drascula_big`, `talk_solo`, `talk_bartender`, `talk_bj`, `talk_bj_bed`, `talk_pianist`, `talk_drunk`, `talk_vonBraun`, `talk_blind`, `talk_hacker`, `talk_werewolf`, `talk_mus`, `talk_pen`, `talk_htel`, `talk_trunk`, `talk_sync`, `grr`, `placeVonBraun` |
| `engine/dialogs.ts` | `Dialogs` (`engine.dialogs`) : scénarios `talkSequences`, choix `.CAL`, réponses | `playTalkSequence`, `doTalkSequenceCommand`, `converse`, `response`, `cleanupString` |
| `render/heads.ts` | les têtes : l'image de chaque personnage pendant sa réplique (vues, `TalkView`) | le corps des boucles de `talk_*` |
| `render/actors.ts` | Igor, Drascula, Von Braun dessinés | `placeIgor`, `placeDrascula`, `moveVonBraun` |
| `engine/loop.ts` | le héros : `talk(index)`, `say(texte, voix)` | `talk`, `talk_pen` (chapitre 6) |

## 2. Une réplique

**Lu** (`talkInit`, `isTalkFinished`, les boucles de `talk_*`). La voix démarre (`talkInit`), puis une boucle : tirer un visage au hasard, dessiner, `pause(3)` (9 ticks), tester la fin. La réplique dure donc **la durée de la voix** (`.ALS` à 11 025 Hz, marges de 32 octets), arrondie au tour suivant (**vérifié** : au moins la voix, au plus un tour de plus).
`isTalkFinished` : une touche arrête la voix ; le son qui n'est plus « en cours » finit la réplique. Le sous-titre est `centerText` de la ligne de texte, dans la couleur du personnage. Le visage est tiré dans `0 .. n - 1` (`getRandomNumber(n - 1)`), à chaque tour, par le hasard du jeu (`engine.rng`, graine injectable).

- **Échap** (**vérifié**) : une réplique est une attente **protégée** (`unskippable`, `sequence.ts`) : Échap pendant une réplique d'une cinématique ne coupe que la réplique, comme dans ScummVM (`isTalkFinished` consomme l'action). Exception, **lue** : `talk_drascula_big` lit Échap *avant* `isTalkFinished` et en fait un saut de la cinématique ; la voix va alors à son terme (`escapeSkips` de `TalkLine`, `speak` rend vrai).
- **Voix absente** (écart du plan) : le texte reste `6 ticks` par caractère.
- **Fin de réplique** : sous-titre et tête effacés (`finally`, y compris à l'abandon d'un chapitre) ; la pièce est redessinée (`updateRoom`) ; musique relancée selon le personnage (§ 3).
- Vague J : sous-titres masquables (touche `t`, `engine.subtitlesEnabled` : la réplique se joue sans texte), pause à la barre d'espace (l'hôte suspend les ticks et le son pendant une voix, `kActionPauseSpeech`), toucher de l'écran = couper la réplique. Non repris : synthèse vocale.

## 3. Les personnages

Chaque ligne : voix, texte du `.dat`, couleur (`TextColor`), point du sous-titre `(x, y)`, visages tirés, tête (`render/heads.ts`). Le héros : `engine.talk(n)` (voix `n.als`, texte `text[n]`) ou `engine.say(texte, voix)`.

| Personnage | Méthode | Voix | Texte | Couleur | Sous-titre | Visages |
| --- | --- | --- | --- | --- | --- | --- |
| héros | `engine.talk` / `say` | `n.als` | `text` | jaune (chapitre 4 : celle en cours si le drapeau 29 est levé, hors pièce 24) | sa tête `(x, y)` ; tours du château (ch. 5, pièce 45) `(160, 25)` | 6 |
| héros sous le pendule | `say` (ch. 6, drapeau 0 bas, pièces 102 / 58) | idem | idem | jaune | `(160, 105)` / `(195, 107)` | 8 / 5 |
| héros, bouche synchronisée | `talkers.heroSync(texte, voix, chiffres)` | | | jaune | sa tête | un chiffre par tour |
| Igor | `igor(n, type)` | `In.als` | `texti` | blanc | profil et face `(igor.x + 26, igor.y)`, porte `(87, 66)`, assis / perruque `(221, 102)` | 8 (assis, perruque : 4) |
| Drascula | `drascula(n, côté)` | `dn.als` | `textd` | rouge | `(drascula.x + 19, drascula.y)` | 8 |
| Drascula en gros plan | `drasculaBig(n)` | `dn.als` | `textd` | rouge | `(191, 69)` | 4 |
| voix off | `solo(texte, voix)` | | | chapitre 1 : `colorSolo` ; 5 : rouge | ch. 1 `(156, 90)`, 5 `(173, 92)`, 6 `(213, 72)` ; aucun texte ailleurs | — |
| barman | `bartender(n, 0 ou 1)` | `tn.als` (82 : `d82.als`, `textd`) | `textt` | bordeaux | `(132, 45)` | 9 / 6 |
| B.J. | `bj(n)` | `BJn.als` | `textbj` | blanc | ch. 1-4, 6 `(177, 90)` ; 5 `(93, 80)` | 5 |
| B.J. au lit | `bjBed(n)` | `BJn.als` | `textbj` | blanc | `(104, 102)` | 5 |
| pianiste | `pianist(n)` | `Pn.als` | `textp` | blanc | `(221, 128)` | 4 |
| ivrogne | `drunk(n)` | `Bn.als` | `textb` | vert foncé | `(181, 54)` | 8 |
| Von Braun | `vonBraun(n, porte)` | `VBn.als` | `textvb` | brun | `(vonBraun.x, 66)` ; porte `(150, 80)` | 6 |
| aveugle | `blind(n)` | `d(n + 67).als` | `textd[n + 67]`, bouche : `textd1[n - 1]` | brun | `(260, 71)` | chiffres, tour de 2 pauses |
| hacker | `hacker(n)` | `dn.als` | `textd` | jaune | `(156, 170)` | — |
| loup-garou | `werewolf(n)` | `Ln.als` | `textl` | rouge | `(203, 78)` | 9 |
| musicien | `musician(n)` | `En.als` | `texte` | blanc | `(197, 64)` | 8 |
| téléphone | `phone(n)` | `n.als` | `text` | jaune | `(90, 50)` | 3, et une feuille parmi 3 |
| coffre | `trunk(n)` | `dn.als` (**lu** : voix `d`, texte `text`) | `text` | bordeaux | `(263, 69)` | le drapeau 19 alterne, tour de 4 pauses |
| grognement | `growl()` | `s10.als` | `textmisc[6]` | vert foncé | `(153, 65)` | — |

Particularités **lues** :
- **Musique relancée** : le barman (type 0), l'ivrogne, Von Braun et `talk_sync` relancent la piste de la pièce si elle est finie (chapitre 1 : toujours ; chapitre 2 : drapeau 11 bas et piste non nulle). Le héros le fait au chapitre 1 (`say`). Le barman le fait à chaque tour de sa réplique.
- **Ivrogne** : au chapitre 1 sa feuille `an11y13.alg` remplace `front` le temps de la réplique (`96.ALG` revient après) ; le drapeau 13 annonce qu'il parle ; la réplique attend la chute du drapeau 12 (le geste de la pièce, vague P : sans accroche qui le baisse, elle attendrait toujours, comme l'original).
- **Von Braun** : tourné vers la gauche, l'original ne redessine rien à ce tour : la composition ordinaire de la pièce reste (écart).
- **Coffre** : `flags[19]` alterne 1, 0, 1… à chaque tour ; sa valeur d'avant est remise à la fin.
- **Pendule** : le drapeau 1 est levé le temps de la réplique.

## 4. Scénarios (`talkSequences`)

`playTalkSequence(n)` (**lu**) : les lignes de `talkSequences` du chapitre en cours et du scénario `n`, dans l'ordre ; la recherche s'arrête à la première ligne d'un autre scénario après celles de `n`. Les 25 commandes (`CommandType`) :

| N° | Commande | N° | Commande |
| --- | --- | --- | --- |
| 0 | pause (en unités de `pause`) | 13 | le héros parle (`text[n]`) |
| 1, 2 | lever, baisser un drapeau | 14 | ivrogne |
| 3 | mettre l'objet en main (`pickObject`) | 15 | pianiste |
| 4 | ajouter l'objet à l'inventaire | 16 | B.J. |
| 5 | `breakOut` : fin du dialogue en cours | 17, 18 | Von Braun, Von Braun derrière la porte |
| 6 | `converse(n)` | 19 | Igor assis |
| 7 | Von Braun marche jusqu'à l'abscisse `n` | 20 | loup-garou |
| 8 | `updateRoom` | 21 | musicien |
| 9 | `updateScreen` (un tick : l'état se montre) | 22 | Drascula (côté droit) |
| 10 | orientation du héros | 23, 24 | barman (type 0, type 1) |
| 11 | effet sonore `Sn.ALS` | | |
| 12 | attendre la fin du son | | |

Une commande inconnue lève une erreur (ScummVM : `error`). **Vérifié** : les 225 lignes (chapitres 1, 2, 4, 5, 6) n'utilisent que ces numéros.

**Chapitre 1** (vérifié, `talk.test.ts`) : cinq scénarios, un test chacun : **2** (B.J. et le héros, 17 répliques ; voix `BJ2`, `215`, `BJ3`, `216`… `BJ10`, `222`), **3** (barman et héros, 20 répliques `192`, `t1`, `193`… `202`, puis le drapeau 0), **10, 11, 12** (l'ivrogne : `B1`, `B2`, `B3`). Chaque test vérifie les voix, les textes, les couleurs ; la durée d'un scénario est la somme des durées de ses voix, au tour près. Les scénarios des autres chapitres sont lus par les mêmes commandes ; ils seront joués avec leurs pièces (vague P).

## 5. Choix de dialogue (`.CAL`)

`converse(n)` (**lu**) : `OP_n.CAL` donne quatre répliques, quatre voix et trois numéros de réponse (`formats.md`). Le quatrième choix quitte. Remplacements du troisième choix : `OP_5` (chapitre 2, drapeaux 38 et 33 : `text[405]`, voix `405.als`, réponse 31), `OP_12` (chapitre 6, drapeau 7 : `text[273]`, réponse 14 ; drapeau 10 : `text[274]`, réponse 15 — le second l'emporte).

- À l'ouverture : `selectVerb(aucun)`, couleur du texte vert clair. Boucle : `updateRoom` (le héros avance, la musique est relancée), les choix l'un sous l'autre à partir de y = 2 (8 pixels par ligne de choix, `bottoms()`), celui qui est sous la souris (`y` strictement entre les bords) est redessiné « survolé » ; un choix déjà fait reste « cliqué » et passe en blanc au survol. Les bords sont ceux de `print_abc_opc` (**vérifié** : `measureChoice`).
- Un clic : `delay(100)`, le choix devient « cliqué », le héros dit la réplique (le menu est masqué pendant qu'il parle), puis `response`. `engine.takeClick()` : le clic gauche depuis la dernière image, pendant `listenForClicks` ; un clic bref compte (écart : ScummVM lit l'état du bouton).
- `response(n)` : le scénario `n` (sauf 31), puis au chapitre 2 les cinématiques des réponses 16, 20, 23, 29, 31 (`animations["16_2"]`… fournies par la vague P ; ignorées si le jeu n'en donne pas), au chapitre 3 `grr()`. `breakOut` reste levé à la sortie : un dialogue lancé par la réponse d'un autre termine aussi le premier (comme l'original).
- **Vérifié** : les 13 `.CAL` donnent quatre choix dont les voix existent ; remplacements ; un parcours complet (survol, clic, réponse jouée, retour du menu, sortie) ; clic hors des choix sans effet. **Vu** : le menu au chapitre 2.
- Écart : les glyphes viennent de `CAR.ALG` lu à part (ScummVM le charge dans `backSurface`, ce qui change la feuille du héros de dos le temps du dialogue).

## 6. Écarts et points ouverts

- Hasard des visages : celui du jeu, pas un hasard rebattu à chaque réplique (`talkInit`).
- `menuBackground` (chapitre 2, rechargement des icônes après un dialogue) : sans objet (les icônes sont lues à part) ; la tête du héros est toujours remise sur le décor.
- Les visages et les positions de bouche sont ceux du code de ScummVM, **non comparés à une capture** : à voir (Igor de face, barman, B.J., pianiste, ivrogne, loup-garou, musicien, Von Braun, aveugle, pendule : seuls le héros, Drascula en gros plan, Igor de profil ont été vus dans le navigateur).
- Les voix `B*.ALS` / `textb` (15 lignes pour des voix jusqu'à 62) : le chapitre 1 n'utilise que `B1` à `B3` ; au-delà, à vérifier avec les pièces (vague P).
- `talk_drunk` : attente de la chute du drapeau 12 : c'est `tickInn` (chapitre 1, `rooms/chapter-1/room-62.ts`) qui fait avancer et retomber le geste (vérifié : `room-62.test.ts`).
- Les animations de pièce propres aux dialogues du chapitre 2 (`16_2`…) : vague P, chapitre 2. Au chapitre 1, `room_62` appelle `converse(13)` (l'ivrogne) : joué à la souris dans `test/drascula/rooms/chapter-1/`.
