# QA Lost in Time (passe 2, jouée avec walkthrough Sierra Help)

**Progression atteinte** : navire complet (cale, pont, porte du marin, cinématique), arrivée au manoir (chapitre 2) : portail (batterie, pipette/acide, pomme, cheval, mot, cadenas), jardin, entrée du manoir (bûche, portrait), caveau (portrait posé, plaque 1812-1840 résolue avec 28, monte-charge arrivé, bouton « hors d'usage » comme prévu), façade nord du phare (vinaigre, fléchette sur le tonneau, tonneau en main, soupirail découvert). Arrêt volontaire là : environ un tiers du jeu, pas de blocage rencontré.

## Méthode et limites de l'environnement
- Le volet navigateur est souvent masqué ou recouvert : `requestAnimationFrame` tombe alors à ~1,5 fps, même quand `document.visibilityState` vaut « visible ». Le moteur est cadencé par rAF, donc le jeu devient ~100 fois trop lent (clics ignorés, curseur et libellés en retard, textes qui semblent bloqués). Pour jouer à vitesse normale, j'ai remplacé `window.requestAnimationFrame` par un `setTimeout(16)` dans la page (aucun fichier modifié). Les « bugs » de latence vus au début de la session venaient de cet état et ne sont pas des bugs du jeu.
- Clics injectés par `PointerEvent` (déplacement, pause 150 ms, appui 80 ms, relâchement) ; clic de 30 ms accepté à pleine vitesse.
- Son activé (piste CD « EXT_3 » en lecture, 348 pistes chargées) ; je n'ai pas pu écouter, seulement vérifier l'état. Console propre : aucun avertissement watchdog `TOT@` ni erreur.

## Bugs / constats

### 1. Titre de la carte : « Prunelière » sans le « è » (mineur, à confirmer)
- Scène : carte du domaine (icône carte de la barre du haut), titre « Manoir de la Prunel_i_re ».
- Attendu : « Manoir de la Prunelière » avec l'accent. Constaté : le « è » n'est pas dessiné (trou entre « i » et « re »).
- Hypothèse : glyphe accentué absent de la grosse police de la carte (ou du jeu de caractères CP850 → police). À comparer à l'original.
- **Statut : corrigé.** Cause : la planche de caractères de la carte (police en sprite) est indexée par octet CP850 non signé (« è » = 0x8a, case 73, présente dans la planche) ; le port lisait un octet signé, d'où un index négatif et un trou. Correction dans `engine/graphics/draw.ts`, test `test/lost-in-time/sprite-font.test.ts`. Vérifié dans le navigateur : « Prunelière » s'affiche.

### 2. Moteur quasi à l'arrêt quand le volet est masqué (mineur)
- Étapes : jouer, masquer/recouvrir le volet. Constaté : boucle de jeu cadencée par rAF → ~1,5 fps, saisies perdues au retour. Attendu : au minimum une pause explicite. Voir « Méthode ».
- **Statut : corrigé.** L'interface met le jeu en pause quand l'onglet est masqué (`document.hidden`) : horloge de jeu gelée (`ui/clock.ts`, `ui/browser-host.ts`), piste CD et contexte Web Audio suspendus puis repris au même point (`html-cd.ts`, `web-audio.ts`, `ui/app.ts`). Les volets « visibles » mais très ralentis par le navigateur ne sont pas concernés. Tests : `test/lost-in-time/pause.test.ts` ; vérifié en simulant `visibilitychange` (horloge, CD et position de plage gelés puis repris).

### 3. Premier caractère des libellés rogné à gauche (cosmétique)
- Texte du bas (« Utiliser … sur … », « Est-ce qu'il fait partie de l'héritage? ») : la première lettre touche/dépasse le bord gauche du canvas (« U » vu comme « J », « E » coupé). À vérifier contre l'original (marge d'une colonne ?).
- **Statut : corrigé (n'a rien à voir avec le jeu).** Le texte est bien dessiné à x = 0 ; c'est l'anneau de focus du canvas (3 px, décalé vers l'intérieur) qui recouvrait la première colonne. Il entoure désormais l'écran (`ui/style.css`). Test : `test/lost-in-time/pause.test.ts` (style) ; vérifié dans le navigateur (« Utiliser TONNEAU sur », « Un poteau »).

### 4. Boîtes de dialogue Sauver/Charger collées ou rognées à droite (cosmétique)
- Boîte « NOM DE LA SAUVEGARDE : … » / « TAPER LE NOM… » : bord droit au ras ou au-delà du canvas selon la longueur du nom ; traits parasites (petits « ι ι ι ») à droite de la boîte après saisie dans le champ de nom.
- **Statut : non élucidé, non corrigé.** Le cadre est positionné par le script (x 16..318 pour la boîte de saisie) et rien dans le moteur ne le décale. Les traits jaunes viennent d'un sprite temporaire de 272x31 (sprite 30) recopié par le script, qui contient ces traits dans ses colonnes de droite ; ils n'apparaissent qu'après certaines suites de saisie (retour arrière jusqu'à vider le champ puis frappe). Sans original pour comparer, pas de correction faite ; piste : tracer qui remplit le sprite 30 (copie d'écran avant la boîte ?).

### 5. Libellé de survol périmé après un chargement (cosmétique)
- Après CHARGER « JARDIN », le libellé « Un puits » reste affiché alors que le curseur est dans la zone noire du bas.
- **Statut : non reproduit.** Après chargement de JARDIN, le libellé affiché correspond à une zone réellement sous le curseur et disparaît dès qu'on le déplace dans la zone noire. La logique de survol (`checkHotspotChanged`, `clear` qui remet la clé courante à 0) est identique à ScummVM : pas de « leave » à la recharge, comme dans l'original.

### 6. Saisie du nom de sauvegarde : lettres manquantes à partir de 10 caractères (mineur, à confirmer)
- Taper « CALE TORCHON » (12 car.) affiche « CALE TORCN » ; « HOHOAB » et « TORCHON » seuls passent. Probablement limite de 10 caractères d'origine avec un comportement de dépassement étrange ; à comparer à l'original.
- **Statut : conforme à l'original.** La largeur du champ donne 10 caractères (`width / largeur de police`, `Hotspots::updateInput`) ; au maximum, chaque frappe écrase le dernier caractère (`CALE TORCHON` donne `CALE TORCN`). Le code du port reproduit le comportement de ScummVM ligne à ligne.

### 7. Scènes très sombres (cosmétique, à confirmer)
- Cale arrière / porte du marin / mur des boulets : image rougeâtre et très sombre, détails à peine visibles. Peut être voulu (cale non éclairée) ; à comparer à l'original.
- **Statut : non reproduit / à comparer visuellement.** Aucun défaut de palette trouvé : la palette affichée est égale à la palette voulue (0 écart) et la conversion 6 bits vers 8 bits est celle de ScummVM (à ≤ 3/255 près, plus claire). L'obscurité vient donc des données de la scène.

### 8. Zones de navigation recouvertes par des hotspots de scène (mineur, comportement d'origine probable)
- Cale (cuisine, canon à gauche) : cliquer sur le bord gauche/droit à hauteur du canon ou du bac déclenche l'objet au lieu de la navigation (les flèches 0-39 / 279-318 sont derrière). Contournement : cliquer plus haut/bas. Comportement conforme à l'ordre des zones ScummVM, signalé pour mémoire.
- **Statut : conforme à l'original.** `checkMouse` retient la première zone sous la souris dans l'ordre du tableau, comme `Hotspots::checkMouse` de ScummVM ; l'ordre est celui des `addHotspot` du script.

## Vérifié OK
- Titre/crédits (~22 s), transition ondulée de réveil, monologues, hover (libellés), zooms animés, curseur objet (« Utiliser X sur Y »), « Non, ça ne donne rien… », inventaire (clic droit, 10 objets, combinaison via mallette de la barre), barre d'icônes du haut (Sauver/Charger/Quitter/Version).
- Vidéos et voix/sous-titres : trou dans la cloison (prisonnier Yoruba), marin à la porte, ouverture du cadenas, pomme au cheval, fouille du tracteur, lecture du mot (fond vidéo + texte vert).
- Énigmes : tabouret/clou/tenailles, lampe, éponge humide, huile + pompe, tire-bouchon, taquets, savon/copeaux/glissière, acide sur cadenas, portrait + plaque 1812-1840 = 28, fléchette sur le tonneau.
- Sauvegarde/chargement : 5 emplacements créés (TORCHON, ENTREPONT1, PORTAIL, JARDIN, CAVEAU), rechargement de PORTAIL (« INVENTAIRE VIDE ») et JARDIN (fléchette, paquet, pipette, batterie) : état et inventaire restitués. L'enregistrement par-dessus un emplacement existant (nom prérempli) fonctionne.
- Musique CD en lecture (piste EXT_3), son activé.

## Non testé
Fin du chapitre 2 (barre de fer, résine, cheminée, dalle, trappe), chapitres 3 et 4 (phare, crypte, jeux chronométrés), minuteries, jokers (aide), « Quitter », fin du jeu, perf sur machine lente, écoute réelle de l'audio (synchro voix/lèvres, silences), clavier au-delà du champ de nom, mobile/tactile.

## Autre point

- **Préférence « Son » modifiée sans action (non confirmé)** : cause plausible trouvée et corrigée : plusieurs onglets du jeu gardaient chacun leur valeur en mémoire et réécrivaient l'ancienne au prochain clic. Les onglets suivent maintenant l'évènement `storage` (`AudioPrefs.reload`, `ui/app.ts`). Test : `test/lost-in-time/pause.test.ts`. Rien d'autre dans le code ne réécrit la préférence (la migration de l'ancienne clé « Musique » ne s'exécute qu'une fois).

## Partie 2 (2026-10-23, après les correctifs)

**Progression atteinte** : rejoué depuis le début (les sauvegardes de la passe précédente avaient disparu du localStorage de l'onglet « seed »). Navire entier (cale, pont, porte du marin, dialogues), portail du manoir (acide, pomme, cheval, mot, cadenas), jardin, entrée (bûche, portrait, fil de fer, poignée, électroaimant, clé sous la porte), salon du manoir (rame/godille, tournebroche, barre de fer), caveau (portrait, plaque, monte-charge), façade nord (vinaigre, fléchette, tonneau, tuyau d'arrosage via soupirail), tuyau relié à la porte du phare puis à l'appui du monte-charge. Arrêt : le monte-charge répond encore « hors d'usage » (poids/liège de la tonne non trouvé, sans walkthrough exploitable), donc **chapitres 3 et 4 non atteints**. Aucun blocage dû au moteur.

### Vérification des correctifs
- Carte : « Manoir de la Prunelière » affiché avec le « è » : OK.
- Premier caractère des libellés (« Utiliser PAQUET sur … ») entier : OK.
- Pause onglet masqué : quand le volet est réellement masqué, la partie reste figée (mes macros se bloquent et reprennent au retour du volet) : cohérent avec le correctif.
- Sauvegarde/chargement : 4 emplacements recréés, nom prérempli, confirmation : OK (rechargement non rejoué cette passe).

### Nouveaux constats
- **Plaque du caveau variable** (info) : « 1812 - 1840 » (réponse 28) à la première partie, « 1805 - 1840 » (réponse 35) à la seconde. Comportement aléatoire de l'énigme : à noter pour les walkthroughs, pas un bug. Les deux solutions ont été validées par le jeu (« Victoire! »).
- **Jokers** : message « Je n'ai pas droit à un joker ici » dans le jardin et dans le salon du manoir ; disponible devant la porte du phare : boîte « UTILISER UN JOKER / JE CONFIRME / J'ANNULE », puis page d'indice avec le portrait du marin et un texte clair et exact (« Reliez la poignée de la porte du phare au monte-charge du caveau à l'aide du tuyau d'arrosage… »), qui correspond bien à l'étape suivante du jeu. Aucun défaut d'affichage. Non vérifié : décrémentation du compteur de jokers, disponibilité scène par scène par rapport à l'original.
- **Menu** : VERSION affiche « V1.00 (CD)(c)MDO 1993 » ; QUITTER affiche « QUITTER LE JEU » avec JE CONFIRME / J'ANNULE ; l'annulation reprend la partie ; la confirmation fond au noir puis « La partie est terminée. » avec le bouton « Rejouer », qui recharge le jeu (« Chargement du jeu… »). Tout est conforme.
- **Interface d'inventaire** (info, usage) : clic droit = ouvre/ferme l'inventaire (l'objet en main revient dans l'inventaire à la fermeture) ; pour combiner deux objets il faut passer par l'icône mallette de la barre du haut avec l'objet en main. Une confusion sur ce point a coûté beaucoup d'essais, mais c'est le comportement d'origine apparent.
- **Pas de bug moteur nouveau** : console propre (aucun avertissement watchdog `TOT@`), vidéos et voix OK (prisonnier, marin, portail, poignée, électroaimant, tuyau), musique CD en lecture.

### Non testé (reste)
Fin du chapitre 2 (monte-charge, porte du phare arrachée, phare, cave), chapitres 3 et 4, jeux chronométrés, fin du jeu, décrément du compteur de jokers, écoute réelle de l'audio.

## Partie 3 — chapitres 3 et 4 (2026-10-23)

### Comment les parties 3 et 4 ont été atteintes
- **Ce que fait le jeu d'origine** (désassemblage de `INTRO.TOT` / `MENU.TOT`) : `INTRO.TOT` (sous-routine à 0x270) ouvre le premier `PARTIEn.ITK` présent (1, puis 2, 3, 4) et fixe la scène de départ : `EMAM1017` (partie 1), `EMAM1000` (partie 2), `EMAM1104` (partie 3), `EMAM1036` (partie 4). `MENU.TOT` lit ensuite les deux derniers chiffres de la scène (`switch` près de l'offset 24868) : 0 charge `CAT2.INF`, 4 charge `CAT3.INF`, 36 charge `CAT4.INF` (variables de départ de la partie). Il n'y a donc **aucun écran ou menu de choix de partie** qui déclenche ce chemin : il correspond à une installation où seul le `PARTIEn.ITK` voulu est présent (le jeu d'origine affiche d'ailleurs « CECI NECESSITE L'INSTALLATION D'UNE PARTIE DU JEU QUI EFFACERA CELLE EN COURS. VOULEZ-VOUS L'INSTALLER ? » quand on charge une sauvegarde dont la partie manque). Le passage normal d'un chapitre à l'autre se fait en jouant (`sub_23174` change d'ITK selon le numéro de scène).
- **Ce que j'ai fait, exactement** (aucun fichier modifié) : après « Jouer », pendant l'écran de crédits (avant la sélection de partie par `INTRO.TOT`), j'ai exécuté dans la console de la page, via l'aide `window.__lit.host`, un remplacement de `host.loadFile` et `host.fileSize` pour que `PARTIE1.ITK` et `PARTIE2.ITK` paraissent absents (partie 3), puis `PARTIE1/2/3.ITK` (partie 4). Le jeu démarre alors lui-même à `EMAM1104` (CAT3.INF) ou `EMAM1036` (CAT4.INF). J'ai en plus remplacé `requestAnimationFrame` par un `setTimeout(16)` (volet masqué, voir « Méthode ») et injecté des clics `PointerEvent` en coordonnées jeu.
- **Partie 2** : non rejouée (voir plus bas, une sauvegarde de partie 2 a été chargée à titre de test).

### Progression
- **Partie 3 (la Briscarde, intro EMAM1104)** : cinématique d'introduction (prisonnier Yoruba, explications sur Jarlath, voyage dans le temps) jouée en entier, puis départ à l'« Entrepont » avec 10 objets dans l'inventaire et le crochet en main. Fait : carte « La Briscarde » (Entrepont et Cale droite accessibles), navigation (4 vues par scène, avancer/reculer, demi-tour), cale droite : crochet sur le cadenas de la malle (« Ça a marché! »), vêtements féminins (animation du personnage en robe), ruban, combinaison ruban + rame (« Mettons-les ensemble. »), puis rame + autre objet = « BATON » ; boucle de la pièce de l'entrepont : « Elle manque un peu de longueur… » puis « Ça glisse, je ne peux la saisir ainsi. Je n'ai pas de prise. » Bloqué sur la dernière combinaison (voir « Non testé » : la combinaison attendue par le walkthrough Sierra Help, tire-bouchon sur le bâton, n'a pas abouti dans mes essais ; je n'ai pas pu trancher entre erreur de manipulation et défaut). Sauvegarde créée (« ENTREPONT1 »).
- **Partie 4 (île de St Cristofald, intro EMAM1036)** : cinématique d'introduction jouée en entier (Doralice, Yoruba, Melkior), puis jeu libre sur la plage (holocom en main), carte de l'île (seule la plage disponible), cascade (EMAM1035) : dialogue avec l'enfant, tire-bouchon puis pipette sur le coco (« Un coco percé »), eau de coco donnée au manicou (« Voici un mini-biberon… »), lecture de l'inscription (« …Makandal serait-il misogyne? »), passage (« Amilcar va m'indiquer comment franchir ce passage… »), dialogue avec Melkior. Arrêt là : il manque le perroquet (étape suivante non trouvée sans walkthrough précis pour cet état de départ).
- **Chapitre 2** : non rejoué. Test de chargement croisé : depuis la partie 4, chargement de la sauvegarde « SOUPIRAIL » (façade nord, partie 2) : la scène et l'inventaire (tournebroche, cordage, etc.) sont restitués (voir l'avertissement dans les constats).

### Musique AdLib (tranche 19, `DORA*.ADL`)
Méthode : `AnalyserNode` branché en dérivation sur le nœud AudioWorklet (`backend.adlib.node`) et mesure du RMS toutes les 150 ms, avec suivi de `sound.adl` et de `adlibPlaying`.
- **Lecture réelle dans le jeu** : à l'ouverture de la partie 3 (`EMAM1104`, `MAMPARLOIN`), `DORA12` est chargée puis jouée une fois : `playing` passe à vrai à t=16,1 s, RMS non nul tout de suite (0,12 au pic, décroissance jusqu'à ~0,01), `playing` repasse à faux à t=23,2 s (morceau de 962 octets, environ 7 s) : le signalement de fin (`onStopped`) fonctionne.
- **Autres scènes** : les scripts (`EMAMADL.TOT` : DORA14 pour les scènes 0–15, DORA16 pour 36/37/112, DORA17 pour 101/104/111, DORA11 pour 28/102/103, DORA10 pour 43, etc., et `EMAM1000`, `EMAM1012`, `EMAM1024`, `MENU` pour DORA12/11/18) ne chargent un morceau que si le nom en mémoire (`var8_4424`) change ET que la variable de musique (`var16_13350`) vaut 1. Dans la partie 4, `CAT4.INF` fournit déjà `var8_4424 = "DORA16"` alors que rien n'est chargé : tant qu'aucune scène ne change de morceau, la musique AdLib reste silencieuse (état `loaded=false`). Cohérent avec le script (même situation dans l'original), pas un défaut.
- **Lecture forcée des 14 fichiers** (tranche 19 chargée par `sound.load` puis `adlLoad`/`adlPlay`, 8 s d'écoute chacun) : tous produisent un signal (RMS max) : DORA 0,22 ; DORA1 0,21 ; DORA2 0,54 ; DORA3 0,32 ; DORA4 0,27 ; DORA10 0,36 ; DORA11 0,21 ; DORA12 0,12 (se termine seule à 7 s) ; DORA13 0,22 ; DORA14 0,06 (faible sur ces 8 s) ; DORA15 0,19 ; DORA16 0,36 ; DORA17 0,11 ; DORA18 0,34 ; les autres jouent encore après 8 s (boucle). `stopAdlib` ramène le RMS à ~0. Ce n'est qu'un indicateur : le contenu musical, la justesse des timbres et un éventuel écrêtage (DORA2) n'ont pas été écoutés.
- Je n'ai pas pu confronter la musique AdLib à celle de l'original ou aux pistes CD : les scènes visitées jouaient les pistes CD (ex. « ENT62 »), l'AdLib n'étant sollicitée qu'aux changements de morceau décrits ci-dessus.

### Constats
Aucun blocage, aucune erreur console (seulement les messages `[vite]`), aucun avertissement `TOT@` ni exception pendant ces ~1 h de jeu. Décompte : 0 bloquant, 0 majeur, 2 mineurs à confirmer, 1 cosmétique déjà connu.

1. **Icônes de la barre du haut sans effet quand un objet est en main (mineur, à confirmer)** : partie 3, bâton en main, clic sur la disquette (Sauver) : rien ne se passe (boucle de menu active, aucune boîte, aucun message) ; partie 4, holocom en main, clic sur « Déplacement » : rien non plus. Après avoir reposé l'objet (clic droit), les deux icônes fonctionnent. Attendu : soit l'icône agit, soit un message explique pourquoi. Pas d'erreur console. Le comportement d'origine n'est pas connu ; de plus la mallette (combiner) et le joker fonctionnent objet en main, donc la règle n'est pas uniforme. Je n'ai pas isolé la cause (hypothèse : `Utiliser X sur` mode « objet en main » qui masque ces zones de la barre).
2. **Perçage du coco sans aucun retour (mineur, à confirmer)** : partie 4, cascade, tire-bouchon sur le coco : ni message ni son visible ; seul le libellé de survol passe de « Un coco » à « Un coco percé » et l'identifiant du point chaud change. Attendu : un retour (texte ou bruitage) comme ailleurs (« Ça a marché! »). À comparer à l'original ; si c'est conforme, à clore.
3. **Boîte de nom de sauvegarde : traits parasites à droite (cosmétique, déjà connu, point 4 ci-dessus)** : reproduit en partie 4 à la saisie du nom (« TAPER LE NOM… », barres vertes verticales à droite du cadre), toujours sans cause identifiée.
4. **Chargement croisé de partie : fichier ITK de l'ancienne partie conservé (non conclusif)** : partie 4 → chargement de « SOUPIRAIL » (partie 2) : `game.files` montre toujours `PARTIE4.ITK` ouvert et jamais `PARTIE2.ITK`, alors que `INTRO.TOT` / `MENU.TOT` ouvrent le bon ITK selon la scène (`sub_23174`). Mon test est biaisé : j'avais masqué `PARTIE2.ITK` à l'hôte (le jeu a affiché l'invite d'installation citée plus haut), j'ai rétabli l'hôte puis choisi « J'ANNULE » ; `host.fileSize` garde en cache le résultat « absent ». À refaire sans aucune manipulation (partie jouée normalement jusqu'à la partie 3 puis chargement d'une sauvegarde de la partie 2) avant d'en faire un bug.
5. Comportements notés sans être des défauts : l'aide « joker » est refusée dans toutes les scènes visitées de ces parties (« Je n'ai pas droit à un joker ici ») ; les libellés en capitales (« COCO PERCE », « VERS LA FACADE EST », invite d'installation) n'ont pas d'accent, ce qui est cohérent avec la police de ces textes (en minuscules, les accents s'affichent : « Un coco percé », « Hé bien, Doralice ») ; le nom proposé à l'enregistrement est celui de l'emplacement choisi (en cliquant sur un emplacement existant, on l'écrase : c'est ce que j'ai fait par erreur avec « ENTREPONT1 », remplacé par « PLAGE4GE4 » ; les quatre sauvegardes préexistantes PORTAIL, CAVEAU, MAISON, SOUPIRAIL sont intactes).

### Méthode et limites (complément)
- Le volet navigateur était masqué : `requestAnimationFrame` ~2 fps, remplacé par `setTimeout(16)` dans la page (comme à la passe précédente). Sa latence d'un cycle sur le curseur (le curseur affiché retarde d'un déplacement après une saisie injectée) vient très probablement de mes événements synthétiques, pas du jeu.
- Les clics natifs de l'outil navigateur n'ont pas déplacé le curseur du jeu : tout est passé par des `PointerEvent` synthétiques, y compris clavier (`KeyboardEvent`) pour le nom de sauvegarde. Les lettres tapées sont consommées une par image, d'où des frappes retardées (« PLAGE4GE4 » au lieu de « PLAGE4 »).
- Les noms d'objets s'affichent avec un retard d'un survol ; pour savoir quels objets se combinent, la liste des points chauds du panneau de la mallette ne contient que les partenaires valides.
- Walkthroughs : Sierra Help et GameBoomers (anglais) ; ils ne correspondent pas toujours aux états de départ CAT3/CAT4 (objets déjà acquis, ordre différent), d'où des essais à l'aveugle.

### Non testé
Fin de la partie 3 (cabine du capitaine, perroquet, coffre, Yoruba), partie 4 au-delà de la cascade (cabanes de Delia et Makandal, maison de Sérapion, pont, Jarlath, fin du jeu), jokers (aucune scène n'en accorde ici), jeux chronométrés, chapitre 2 après le monte-charge, qualité audible de la musique AdLib, minuteries, mobile/tactile.
