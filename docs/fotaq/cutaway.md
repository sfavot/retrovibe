# Flight of the Amazon Queen : cinématiques (vague C)

Interpréteur des cinématiques scriptées (`*.CUT`, « cutaways », 302 fichiers) : objets qui changent de pièce, animations d'objets et de personnes, marche, texte et voix, états finaux, enchaînement, générique. Code : `src/games/fotaq/engine/` (`cutaway.ts`, `credits.ts`, et `loop.ts` pour `playCutaway`, `showCurrentRoom`, la scène, le générique), lecture du fichier dans `data/cut.ts`. Tests : `test/fotaq/engine/` (`cutaway.test.ts`, `cutaway-details.test.ts`, `credits.test.ts`, `bobs.test.ts`).
Référence de comportement : `Cutaway` du moteur `queen` de ScummVM (`engines/queen/cutaway.cpp`, `cutaway.h`, GPL v3 ou ultérieure) et `Logic::sceneStart`, `sceneStop`, `playCutaway`, `startCredits`, **lus en entier**, réécrits. Le format est dans `formats.md` § 7.
**Confiance** : **lu** = lu dans ScummVM ; **vérifié** = couvert par un test sur les fichiers du jeu ; **vérifié à l'écran** = vu dans le navigateur (`ui/render-dev.html`).

## 1. Déroulement

`FotaqEngine.playCutaway(fichier)` (efface la ligne de commande) appelle `Cutaways.play`, qui rend la cinématique à enchaîner (`""` : aucune). **Lu, vérifié** :

1. **Chargement** (`load`) : `cutawayQuit` remis à faux ; `canQuit` = le nombre d'objets est positif ; une pièce finale (drapeaux < 0) remet `entryObject` à 0 ; la banque propre à la cinématique (première de `bankNames`) va à l'emplacement 8 ; Joe se tourne comme il l'était (`cutFacing`) puis comme la phrase d'entrée le demande (`*FL`, `*FR`, `*FF`, `*FB`). `COMIC.CUT` retient le morceau en cours (`host.lastSong`) pour le reprendre après.
2. **Début** : `cutawayRunning` (le joueur ne peut plus commander), mode d'écran (`comPanel` 0 ou 2 : « scène » = curseur caché, panneau gris, compteur `g.scene`).
3. **Pour chaque enregistrement** : mouvement spécial s'il n'y a pas de déplacement (`specialMove` > 0 sans `moveTo` : hook de la vague L) ; pièce (0 = la courante) ; boîte de découpe du bob ; changement de pièce (`changeRooms`) ; copie d'objet (`fromObject`) ; morceau ; puis selon la nature (`data/cut.ts`) :
   - **animation** (`handleAnimation`) : chaîne d'animations de bobs (§ 2) ;
   - **personne** (Joe ou une personne : `handlePersonRecord`) : placée à `bobStart`, marche jusqu'à `moveTo` (`stage.moveJoe`, `walk.movePerson`), puis dit sa phrase par `makePersonSpeak` (voix `findCdCut` + rang de l'enregistrement, voir `talk.md`) ; une phrase `#fichier.crd` lance le générique ; `*` : rien à dire ;
   - **texte** dit, dit et affiché, affiché seul (`handleText`) : `setBobText` à (`bobStart`, couleur = `specialMove`) ou centré ; la voix est celle du rang de l'enregistrement + `1` ; durée = voix, ou 50 caractères au moins (trois fois plus pour un texte seulement affiché) comme `countSpaces` ;
   - **sans animation** : rien (l'objet a seulement été copié).
   Après chaque enregistrement : `cutawayQuit` interrompt la boucle ; l'enregistrement « fondu de pièce » (`-1`) ajoute une image puis le fondu d'entrée de la pièce.
4. **Fin** (`stop`) : si la pièce finale de Joe diffère de la courante, `displayRoom` avec Joe à sa position ; **si la cinématique est sautée** : générique arrêté, bobs immobiles, personnes revues retrouvent leur image, **états finaux « extra »** (§ 3), mouvement spécial et morceau de fin ; Joe est posé à sa position finale s'il est dans la pièce de fin (sauf 37, 105, 106). Puis `updateGameState` (états posés ou testés, objets montrés ou cachés, zones allumées ou éteintes), la banque 8 est fermée, **le dialogue de fin** (`talkFile` `.DOG`, avec la personne `talkTo`, voir `talk.md`) et la scène se ferme.
5. **Retour** : si rien ne s'enchaîne (ni dialogue ni cinématique, `anotherCutaway` faux, pièce 110 exceptée) : plein écran désactivé ; avec une pièce finale, `newRoom` et `entryObject` retombent à 0 ; sinon la pièce de départ est rétablie (`showCurrentRoom` : `displayRoom` avec Joe à sa place d'arrivée, `newRoom` remis à zéro si c'est elle), les personnes reprennent leur animation, les objets de l'hôtel sont retirés de l'inventaire (pièce 1, une fois : `removeHotelItems`). `cutawayRunning`, `cutawayQuit` sont remis à faux, la voix et l'effet en cours sont coupés si la cinématique a été sautée, le morceau d'avant reprend.

**Vérifié** (`cutaway.test.ts`) : les **302** cinématiques se jouent **jusqu'au bout depuis leur contexte** (la pièce et les états de la liste de commandes qui la lance, sinon la pièce de son nom, les acteurs des pièces visitées rendus valides ; les dialogues qu'elles lancent sont joués en prenant la première option) : sans erreur ni avertissement ; **toutes les voix existantes** de chaque cinématique sont demandées (sauf `C30E_102` et la voix d'une ligne `#credit2.crd`) et toute voix demandée mais absente est un segment sans texte, un bruitage dit (« CLIC », « snap ») ou l'une des deux cinématiques sans voix de l'archive (`PC73E` ; `GM`, dont la voix est rangée sous `GM011___`, un nom que ScummVM ne calcule pas non plus) ; l'état de fin est propre (`cutawayRunning`, `cutawayQuit`, `newRoom`, `scene`, Joe de nouveau en mode normal au premier tour). **Échap** (`skipCutaway`) : les cinématiques sautables s'abrègent et finissent proprement (états finaux, pièce finale atteinte, même pièce qu'au bout), les 98 non sautables ignorent la touche (même durée). `cutaway-details.test.ts` : retour à la pièce de départ et à la place de Joe, `newRoom` remis à zéro ; `c73d.CUT` jouée par une commande (prendre la clef, pièce 73) ; objets de l'hôtel retirés.

## 2. Animations (`handleAnimation`)

Une chaîne d'animations (`CutAnimation`, 10 mots) vise un bob : Joe (bob 0, image 31), une personne (bobs 1 à 3, image `31 + bob`) ou un objet (`findBob`, `findFrame`). La **vitesse** du fichier devient `vitesse / 3 + 1` images de jeu par étape ; la banque : 0 objets de la pièce (emplacement 15), 13 Joe (7), sinon rang + 1 dans les noms de banques, chargée dans l'emplacement 8 (**une seule banque à la fois** : la dernière chargée sert à toutes les animations de l'enregistrement, comme ScummVM).
- **Animation « normale »** (`animType` 0 ou 2) : chaque étape pose l'image (`unpack`, sauf pour une personne qui marche), l'échelle (Joe : `Cutaway::scale`), la position (`cx`, `cy`), le miroir, puis dure sa vitesse ; l'image 0 éteint le bob.
- **Animation complexe** (`animType` 1, `makeComplexAnimation`) : les images distinctes sont rangées dans la table à la suite de `currentImage` (par numéro croissant) et la chaîne devient l'animation du bob du premier enregistrement (`Bobs.setCutawayAnim`, `_cutAnim` de ScummVM). Pièces 47 et 63, personne 1 : la chaîne part de la première image libre de la personne (l'oracle).
- **Déplacements** (`mx`, `my`) : les bobs partent ensemble (`BobSlot.move`, vitesse `specialMove` s'il est positif, sinon 4), puis la cinématique attend que plus aucun ne bouge ; au temple (pièce 43), le bateau emporte Joe de 346 pixels.
- Un effet sonore (image > 500) est joué par le bob ; `song` d'une étape et de l'enregistrement : `host.playSong`.

## 3. États finaux « extra » (cinématique sautée)

Section **lue par ScummVM** dans `Cutaway::stop` quand on saute la cinématique (`formats.md` § 7 la disait « non lue » : c'est vrai du chargement, pas de `stop`). Sept mots par entrée : objet, objet modèle, x, y, pièce, image (négative : miroir), banque ; puis le mouvement spécial et le morceau de fin. Pour chaque objet : copié depuis le modèle (ou allumé) puis son bob refait si on est dans la pièce de l'objet, position (échelle d'une personne recalculée), image (banque comme celle des animations ; l'image 1000 de la donnée, « l'objet finit sur l'image 0 », éteint le bob : ScummVM compare le numéro d'image de la table à 1000, jamais vrai, et lirait l'image 1000 de la banque). **Écart** : une zone absente des données (`C47A`) est ignorée (zone vide dans ScummVM).

## 4. Scène, générique, voix

- **Scène** : `g.scene` (`Logic::_scene`) compte les cinématiques sans panneau imbriquées ; `sceneStart` cache le curseur, grise le panneau (`palette.greyPanel`) et fait une image ; `sceneStop` à la dernière rend curseur, panneau et zones (`grid.setupPanel`). Une cinématique qui en enchaîne une autre (`anotherCutaway`) laisse la scène ouverte.
- **Générique** (`CreditsRunner`, `credits.ts`) : `#credit1.crd` et `#credit2.crd` (`data/credits.ts`) ; une page s'affiche d'un coup (une ligne de texte à sa place de la grille 3 x 3), reste N x 10 images (`.p N`) ou jusqu'au changement de pièce (`.p 0`, `nextRoom`) ; `update` à chaque image du jeu (`FotaqEngine.update` et tour de la boucle), arrêt par `stopCredits` (cinématique sautée). **Vérifié** (`credits.test.ts` : les deux fichiers se déroulent jusqu'à leur fin).
- **Voix** : `host.playSpeech` (voir `talk.md` § 4) ; sans voix, une réplique dure le temps de son texte.

## 5. Accroches de la vague L

Appelées par les cinématiques, **implémentées groupe par groupe** (`specials.md` : 15 à 18, 34 et 36 à 39 le sont, les autres attendent leur groupe ; un numéro sans fonction ne fait rien) (sans effet tant que `GameScript.specialMoves` ne les définit pas, comme ScummVM pour un numéro vide) :

| Quand | Mouvements spéciaux (cinématiques qui les lancent) |
| --- | --- |
| à l'arrivée à un enregistrement sans déplacement (`specialMove` > 0, `moveTo` nul : `staticSpecialMoves` du test, qui vérifie qu'ils sont appelés une fois chacun dans l'ordre du fichier) | 3 : C74A ; 4 : C73A ; 5 : CDRES, CUDRS ; 6 : CDCLO, PC73E ; 7 : C73E, C73F ; 8, 31 : C74A ; 9 : C69E, C69F, C69Z ; 10 : C69E, C69F, C69G ; 11, 12 : C69Z ; 13, 26, 27, 29, 30 : C69G ; 14 : C69G, PC73E ; 15 : C67A ; 16 : C67A, CINTR ; 17, 18 : CINTR ; 19 : C41A ; 20, 24 : C100C, C100D ; 21, 22 : C103F, C103I, C103J, C103K, C25E ; 23 : C103F ; 25 : C63C ; 28, 32 : C75B ; 33 : C102C, C102D ; 34 : CRED ; 36 à 39 : CDINT |
| à la fin d'une cinématique **sautée** (section « extra ») | 7 : C73E, C73F ; 8 : C74A ; 9 : C69Z ; 14 : PC73E ; 16 : CDINT, CINTR |

Le tableau de `engine.md` § 9 comptait aussi les enregistrements qui ont un déplacement : leur `specialMove` est alors une **vitesse** de bob, pas un mouvement (la liste ci-dessus est le relevé exact ; les numéros 1, 2 et 35 ne sont lancés par aucune cinématique). Autres accroches :
- `GameScript.changeToSpecialRoom` : appelée à chaque retour à la pièce de départ (`showCurrentRoom`) comme à chaque changement de pièce (pièces 7 et 95).
- `stage.roomUpdates` (voiture de la pièce 74, combat de la pièce 69 : `BamScene`), couleurs qui tournent (déjà dans la scène), `shake` (C75B) : rendu et animations de pièce.
- Les cas de pièce de `cutaway.cpp` sont dans le moteur : panneau forcé de `c41f` et `c62c` (pièce 41), têtes parlantes (pièces 37, 106, 107 : panneau caché), bateau du temple, oracle (pièces 47 et 63), pas de retour à la pièce après le générique de fin (110). `c41f` et `c62c` sont aussi cités pour des cas de pièce de la vague L (`engine.md` § 9).

## 6. Écarts avec ScummVM

- La nature d'un enregistrement (`getObjectType`) est calculée à la lecture du fichier (état des objets au début de la cinématique) ; les copies d'objets se font à l'arrivée à l'enregistrement.
- Une personne sans acteur valide qui doit être placée ou déplacée (ScummVM planterait) est ignorée avec un avertissement (`engine.warnings`) ; une personne cherchée mais jamais utilisée (`*` sans déplacement, objet d'une autre pièce) ne donne rien, comme ScummVM.
- Versions démo, Amiga et interview : non portées. Le saut n'abandonne pas la séquence : la cinématique va jusqu'à ses états finaux, comme `Cutaway::run`.
- L'attente de la fin des déplacements n'a pas de garde : un bob dont le déplacement ne peut pas finir (inactif) bloquerait, comme ScummVM. **Trouvé en jouant `C62B`** : un bug de la vague G2 (coordonnées non signées, voir `talk.md` § 5) en était la cause.

## 7. Vérifié à l'écran

`ui/render-dev.html` (`cut=`, `dog=`, `line=`, `entry=`, `states=`) : `CLOGO.CUT` (pièce 82), `COPY.CUT` (95), `CDINT.CUT` (les pièces 115 à 125 de l'introduction : panoramiques, textes, Joe et Faye ligotés) jouées à la suite, **sans avertissement** ; Échap pendant `CDINT` : la cinématique s'arrête à l'image suivante (la scène reste ouverte pour l'enchaînement) ; `C73D.CUT` dans l'hôtel (texte de Joe au-dessus de lui, panneau gris, curseur caché). L'introduction **est** une suite de cinématiques lancée par la pièce 95 (`changeToSpecialRoom`, vague L : logo, `COPY`, `CLOGO`, `CDINT`, `CRED`, puis le hall de l'hôtel). Un onglet masqué ne reçoit pas `requestAnimationFrame` : la page expose `window.fotaq.step(n)` pour avancer à la main.
