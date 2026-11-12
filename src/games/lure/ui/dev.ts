import "../../../ui/style.css";
import { mountApp } from "./app";

/**
 * Page de développement : monte le jeu seul, hors de l'application (ouverte à `/src/games/lure/ui/dev.html`). `window.__lure` expose
 * `engine`, `loop`, `renderer`, `host`, `audio`, `slots` et `step(n)`. Pour entrer dans une pièce précise, voir `render-dev.html`.
 */
void mountApp(document.getElementById("app")!, { base: `${import.meta.env.BASE_URL}lure`, debug: true });
