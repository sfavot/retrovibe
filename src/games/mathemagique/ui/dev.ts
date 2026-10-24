import "../../../ui/style.css";
import { mountApp } from "./app";

/**
 * Page de développement : monte le jeu seul, hors de l'application (ouverte à `/src/games/mathemagique/ui/dev.html`).
 * En dev, `__mw` expose `{ engine, host, services }` dans la console.
 */
void mountApp(document.getElementById("app")!, { base: `${import.meta.env.BASE_URL}mathemagique`, debug: import.meta.env.DEV });
