import "../../../ui/style.css";
import { mountApp } from "./app";

/**
 * Page de développement : monte le jeu seul, hors de l'application (ouverte à `/src/games/fotaq/ui/dev.html`). `window.__fotaq` expose
 * `engine`, `host`, `rooms` et `slots`. Pour entrer dans une pièce précise, voir `render-dev.html`.
 */
void mountApp(document.getElementById("app")!, { base: `${import.meta.env.BASE_URL}fotaq`, debug: true });
