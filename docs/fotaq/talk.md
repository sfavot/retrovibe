# Flight of the Amazon Queen : répliques et dialogues (vague T)

Répliques de Joe et des personnages (segments `*NN`, voix par segment, texte au-dessus du personnage, bouche et torse qui bougent) et dialogues à choix (`.DOG`). Code : `src/games/fotaq/engine/` (`talk.ts`, `dialogs.ts`, `speech-data.ts`, `preload.ts`), tests : `test/fotaq/engine/` (`talk.test.ts`, `dialogs.test.ts`, `cutaway-details.test.ts`).
Référence de comportement : `Talk` du moteur `queen` de ScummVM (`engines/queen/talk.cpp`, `talk.h`, GPL v3 ou ultérieure), **lu en entier**, réécrit ; les en-têtes des modules citent les fonctions reprises et leurs écarts. Modèle : la prise de main de Drascula (`docs/drascula/talk.md`) et les séquences communes `src/engine/sequence.ts`.
**Confiance** : **lu** = lu dans ScummVM ; **vérifié** = couvert par un test sur les fichiers du jeu ; **vérifié à l'écran** = vu dans le navigateur (`ui/render-dev.html`).

## 1. Modules

| Module | Rôle | ScummVM |
| --- | --- | --- |
| `talk.ts` | `speakSentence` : une réplique en segments (commandes `*`, voix, texte, animation) ; `speakLine` (`Talk.speak` du moteur) | `Talk::speak`, `getSpeakCommand`, `speakSegment`, `defaultAnimation`, `stringAnimation`, `headStringAnimation`, `countSpaces` |
| `speech-data.ts` | table des paroles par personnage (362 lignes + fin de table), `findSpeechParameters` | `Talk::_speechParameters`, `findSpeechParameters` |
| `dialogs.ts` | `FotaqTalk` (`Talk` du moteur) : arbre `.DOG`, options cachées ou déjà dites, menu du panneau, mémoire, états et objets de fin ; `splitOption` | `Talk::talk`, `load`, `initialTalk`, `findDialogueString`, `disableSentence`, `selectSentence`, `splitOption` |
| `preload.ts` | noms des voix d'une pièce (dialogues et cinématiques de ses commandes) | — (ScummVM lit le fichier au moment de jouer) |

Branchement : `FotaqEngine` crée `FotaqTalk` et `FotaqCutaways` par défaut (options `talk`, `cutaways` pour les tests) ; `StubTalk` reste pour les tests qui n'ont pas besoin de la scène. `FotaqTalk` demande la scène réelle (`GameStage` : bobs, banques, écran).

## 2. Une réplique

`Talk.speak(g, texte, personne, préfixe de voix)` (`personne` : numéro dans la pièce, `null` pour Joe) remet `talkQuit` à faux (comme `Talk::Talk`), met `g.joeWalk` à `Speak` (ce qui signale le dialogue aux entrées : clic droit = `talkQuit`) et dit les segments un à un. **Lu, vérifié** :

- **Segments** : `*` termine un segment et introduit une commande de deux caractères (`splitSpeech`, `data/text.ts`). Chaque segment a **sa voix** `<préfixe><rang + 1 en hexadécimal>` (`JOE00011`, `0200A4P3`, `C100A032`), jouée **avant** toute autre chose (même pour une pause ou un changement d'orientation). La voix `c30e_102` du français est un doublon : jamais jouée.
- **Commandes** : `*NN` (animation de bouche de la table, 0 = normale), `*FL`, `*FR`, `*FF`, `*FB` (orientation du personnage ; Joe : `joe.facing`), `*AO` (l'oracle : quatre images de bouche s'ajoutent à son animation), `*WT` (pause de dix images), `*GD` et `*GM` (Joe saisit : le texte qui les précède **n'est pas dit**), `*XYnn(x,y)` (Joe ou la personne marche jusqu'à (x, y) ; comme `getSpeakCommand`, le déplacement a lieu **avant** le segment qui précède la commande). La demande de passage (`cutawayQuit`, `talkQuit`) est testée avant chaque segment qui a du texte et après chaque commande.
- **Texte** : `stage.setBobText` (texte au-dessus du personnage, couleur de l'acteur ; Joe : 14). Têtes parlantes (`FAYE-H`, `FRANK-H`, `AZURA-H`, `X3_RITA`, Joe dans les pièces 37, 106, 107) : texte fixe à (15 ou 150, 30 pour Joe et 60 pour l'autre), bob 2 pour la bouche (`headStringAnimation`). Les sous-titres sont toujours affichés.
- **Animation** : la table donne, par personnage, état (`*NN`) et orientation de Joe, l'image du corps (`body`), de la bouche fermée (`bf`), le nombre d'images de bouche tirées au hasard (`rf`), l'alternée (`af`), la fermée de fin (`ff`) et une chaîne d'images (`T…` : torse posé sur le corps ; chiffres seuls : images complètes ; `E…` : tête parlante ; > 500 : effet sonore de la pièce). `rf` = -1 et -2 : mouvement du torse puis paramètres de l'animation 0 ou 14. L'image dessinée est la **surimpression** de la bouche sur le début des pixels du corps (`BankManager::overpack`) : `FrameTable.overpack` note la surimpression (`FrameRef.overs`, une fois par image), le rendu la compose octet après octet comme ScummVM (`overpackFrame`), avec le repli sur `unpack` quand la source est plus grande. **Vérifié** (`bobs.test.ts`, `sprites.test.ts`, `talk.test.ts`), **vérifié à l'écran** (Joe : bouche 33 sur la pose 3 de `JOE_B.BBK`).
- **Durée = voix** : à chaque tour de `defaultAnimation`, la voix lancée est-elle finie (`host.speechActive`) ? Un tour dure **deux images de jeu** (une pour une tête parlante), puis une image de fin de segment (et `joeFace` si Joe était de face ou de dos). **Vérifié** (`talk.test.ts`) : la réplique dure la durée de la voix au tour de deux images près (les MP3 sont à débit constant de 24 kb/s : la durée se déduit de la taille, voir `voiceDurationMs` du test), pour les 40 réponses de Joe.
  **Sans voix** (hôte muet, voix coupées, fichier absent, ou `host.playSpeech` rend faux) : `textFrames(segment)` tours de deux images (`countSpaces` : deux images par caractère, dix caractères au moins, divisées par le tiers de la vitesse du texte), plus l'image de fin : une réplique de 55 caractères dure 32 images (3,2 s).
- **Passer** : un clic droit ou la touche `skipText` coupent le segment (et sa voix : `host.stopSpeech`) ; Échap (`skipCutaway`) passe aussi la réplique si `canQuit`.
- **Fin d'un segment de Joe** : orienté de face ou de dos, il reprend sa pose par `joeFace` (sauf pièce 69, où il tient le pistolet) ; de profil, la bouche reste fermée à l'image `ff` (10 s'il n'y en a pas) selon la commande.

## 3. Les dialogues

`Talk.dialogue(g, fichier, personne)` joue un `.DOG` (73 fichiers, `formats.md` § 7) et rend la cinématique à enchaîner. L'écran passe en plein écran (`Logic::startDialogue`) et en revient si aucune cinématique ne suit. **Lu, vérifié sur les 73 fichiers** :

- **Arbre** : `levelMax` niveaux (de 1) de 6 options ; l'option 0 porte la tête du niveau, les options 1 à 4 les répliques de Joe (tête, valeur de nœud = tête du niveau suivant ou -1, condition d'état `indice < 0`) ; recopié à chaque dialogue (il est modifié en jouant). `levelMax` < 0 : on ne peut pas quitter (`canQuit` faux).
- **Mémoire** (`state.talkSelected[uniqueKey]`, 86 entrées sauvegardées) : `hasTalkedTo`, et par option du premier niveau : > 0 = redéfinie (une autre tête), -1 = déjà dite (n'est plus proposée), 0 = intacte. Quitter en cours de route (clic droit) **rend** la dernière valeur et Joe dit la réponse 15.
- **Déroulement** : ouverture (Joe dit sa première phrase à la première rencontre, ou celle des retrouvailles ensuite ; la chaîne `0` = rien), puis tant que la valeur de nœud n'est pas -1 : la personne dit la phrase de la tête, Joe a ses choix ; **s'il n'en reste qu'un** (en général la sortie) il le dit tout de suite ; sinon le menu. Le niveau suivant est celui dont l'en-tête a la tête choisie, sinon celui que désigne la valeur de nœud. États posés par le niveau et par la réplique choisis ; réplique finale de la personne à la sortie.
- **Menu** (`selectSentence`) : les choix sont des lignes de 10 pixels du panneau en plein écran (de y = 156), au plus quatre lignes à la fois, texte coupé à l'étoile puis à 302 pixels (`splitOption`, lignes suivantes décalées de 24) ; **deux flèches** (bobs 62 et 63, zones 5 et 6 à droite) font défiler les options ; le survol colore (encre 14, 7 sinon) ; un clic gauche choisit ; le clic droit ou Échap quitte. **Vérifié à l'écran** (le portier, `laris.DOG`).
- **Fin** : objets ajoutés ou retirés et états des deux conditions de l'en-tête, panneau rétabli, cinématique de fin si son état est bon (Joe peut alors parler : `talkQuit` remis à faux), `hasTalkedTo` posé (sauf si le dialogue a été interrompu), Joe se remet de face, la personne reprend sa place et son animation, `joeWalk` normal.

**Parcours exhaustif** (`dialogs.test.ts`) : pour chacun des 73 fichiers, depuis la pièce et la personne de la commande ou de la cinématique qui le lance (`contexts.ts`), une exploration en profondeur des choix (952 parties, avec et sans les états qui conditionnent les options) : **toutes les options affichées (785) ont été choisies**, sans erreur ni avertissement, les dialogues finissent, `talkQuit` et `joeWalk` sont propres, et toute voix demandée existe ou est celle d'un segment sans texte (`*04*03`). Parcours par les commandes (pièce 73, le portier, `laris.DOG`) : plein écran pendant le dialogue, flèches éteintes à la fin, mémoire du dialogue, retrouvailles (`XXXX`), interruption par clic droit (réponse 15 de Joe).

## 4. Voix et préchargement

Contrat de l'hôte (`FotaqHost`, tous facultatifs) : `playSpeech(nom)` (rend vrai si les voix sont actives et le fichier existe : `speechOn() && speechSfxExists()`), `speechActive()`, `stopSpeech()`, `stopSfx()`, `preloadSpeech(noms)`, `lastSong()`. Le nom est celui du fichier : majuscules, espaces remplacés par `0` (`020001P2`, `C73D_011`). Le moteur garde `speechFound` (le dernier `playSpeech` a trouvé sa voix) ; `FotaqAudio` (`audio.md`) a `playSpeech`, `stopSpeech`, `speechActive`, `speechFound` et `preload` : l'hôte du navigateur (vague J) fait la liaison.
**Préchargement** (`preload.ts`) : au changement de pièce (hors cinématique), `host.preloadSpeech` reçoit les voix de la scène : les dialogues et cinématiques nommés par les descriptions des listes de commandes de ses objets (avec les cinématiques que ces dialogues enchaînent, et réciproquement) et les voix de Joe des autres descriptions. **Vérifié** : sur les 126 pièces, 2 000 noms et plus ; tous existent sauf 17 (bruitages dits « CLIC » et « snap », `GM`, trois voix de la clé 29). Les segments sans texte et les phrases `0`, `*`, `#fichier` n'ont pas de voix.

## 5. Écarts avec ScummVM

- Une image de jeu est un tick de 100 ms ; le temps ne dépend pas du son (`audio.md`).
- Les sous-titres sont toujours affichés ; le rectangle de focus (`setFocusRect`, loupe du système) n'est pas porté.
- Les chiffres du clavier ne choisissent pas une option (`VERB_DIGIT_*` : l'hôte n'a pas d'action pour eux) ; la variante hébraïque (`splitOptionHebrew`) et l'anglaise (une colonne sans flèches) ne sont pas portées.
- ScummVM remet `speechSfxExists` à faux quand un effet est joué (`Sound::playSfx`), y compris celui d'une animation de parole (images > 500) : ici une réplique qui a sa voix attend sa fin malgré l'effet (rare : `KLUNK`, `DEATH`).
- `CHIEF1.DOG` et `CHIEF2.DOG` sont lus dans l'archive (ScummVM préfère un fichier du dossier du jeu, `formats.md` § 7).
- `Talk::talk` appelle `initPerson(..., false)` (la banque de la personne est déjà chargée) ; ici `true` (même effet quand elle l'est, et pas d'erreur sinon).
- Une personne sans acteur valide (ScummVM : `error("Invalid person object")` ou plantage) est dite sans animation (texte sur son bob) ; l'avertissement est noté dans `engine.warnings` et `FotaqTalk.warnings`, vide sur les 73 dialogues et les 302 cinématiques jouées depuis leur contexte.
- Correctif de la vague G2 trouvé en jouant les cinématiques : les coordonnées des bobs (`BobSlot.curPos`) sont des entiers 16 bits **signés** (65444 = -92 : un objet qui entre par le haut de l'écran).

## 6. Points ouverts

- **Écoute** : la durée est celle du fichier MP3 (CBR) ; à vérifier au casque sur le navigateur réel (vague J) avec `FotaqAudio`.
- **Vague L** : aucune accroche n'est appelée par les `.DOG` ni par les répliques (`*XY` marche par les services de la scène). Les têtes parlantes (pièces 37, 106, 107), l'oracle et le combat final (Joe qui ne se retourne pas, pièce 69) sont dans le moteur ; la liste des mouvements spéciaux lancés par les cinématiques est dans `cutaway.md` § 5.
- Touches de choix (chiffres) : à ajouter avec les actions du clavier (vague J) si on les veut.
