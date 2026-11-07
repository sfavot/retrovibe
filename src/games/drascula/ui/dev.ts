import "../../../ui/style.css";
import { mountApp } from "./app";

/**
 * Page de développement : monte le jeu seul, hors de l'application (ouverte à `/src/games/drascula/ui/dev.html`). `?chapter=N` n'est pas
 * géré ici (voir `render-dev.html` pour entrer dans une pièce) ; `window.__drascula` expose `engine`, `host`, `loader` et `slots`.
 */
void mountApp(document.getElementById("app")!, { base: `${import.meta.env.BASE_URL}drascula`, debug: true });
