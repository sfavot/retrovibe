/**
 * Fenêtres du jeu. Dessinées comme dans l'original (`.ITF`, `ui/itf-dialog.ts`, plan D7) : messages et confirmations
 * (GENERIC), puzzle réussi (PUZZSOLV). En DOM, en attendant leur `.ITF` ou parce qu'elles sont propres au site : choix du puzzle
 * par catégorie avec la progression, options (voix, musique), réglages du Labo (gravité, pression, décor, musique), machines du
 * Labo, description d'une pièce, « programmer » une pièce. Chaque fenêtre est modale (`role="dialog"`, `aria-modal`), prend le focus en s'ouvrant, garde la
 * tabulation à l'intérieur et se ferme avec Échap ou un clic sur le fond ; le focus revient alors à l'élément d'avant.
 */
import { h, type Child } from "../../../ui/dom";
import { copy } from "../copy";
import type { LevelText, PartInfo } from "../data/text";
import { BUCKET_MAX, type BallSetting, type PartProgram } from "../engine/program";
import { readItf } from "../data/itf";
import { NAME_MAX } from "../engine/save";
import { itfText } from "../render/itf-draw";
import { openItfDialog, type ItfDialogOptions, type ItfHost } from "./itf-dialog";
import { CATEGORIES, puzzleList, type LabSettings, type Progress, type PuzzleRef } from "../engine/session";

let dialogCount = 0;

export interface DialogHandle {
  element: HTMLElement;
  close(): void;
}

/**
 * Pose une fenêtre modale dans `host` (la page du jeu, qui est l'élément en plein écran). `onClose` est appelé une fois, à la
 * fermeture, quelle qu'en soit la cause.
 */
export function openDialog(host: HTMLElement, title: string, body: (close: () => void) => Child[], onClose?: () => void, role: "dialog" | "alertdialog" = "dialog"): DialogHandle {
  const id = `tim3-dialog-${++dialogCount}`;
  const previous = document.activeElement as HTMLElement | null;
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    onClose?.();
    if (previous?.isConnected) previous.focus({ preventScroll: true });
  };
  const dialog = h("div", { class: "tim3-dialog", role, "aria-modal": "true", "aria-labelledby": id, tabindex: "-1" }, h("h2", { id }, title), ...body(close));
  const backdrop = h("div", { class: "tim3-overlay" }, dialog);
  backdrop.addEventListener("pointerdown", (event) => {
    if (event.target === backdrop) close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    // Tabulation gardée dans la fenêtre.
    const items = [...dialog.querySelectorAll<HTMLElement>("button, select, input, a[href], [tabindex='0']")].filter((e) => !e.hasAttribute("disabled"));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  host.append(backdrop);
  queueMicrotask(() => (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog.querySelector<HTMLElement>("button, select, input") ?? dialog).focus());
  return { element: dialog, close };
}

/** Choix du puzzle : une liste par catégorie (repliable), chaque puzzle avec son titre et sa marque « résolu ». */
export function puzzleChooser(
  host: HTMLElement,
  options: { progress: Progress; titles: readonly LevelText[]; current: string | null; pick(p: PuzzleRef): void; lab(): void; onClose?(): void },
): DialogHandle {
  const list = puzzleList();
  return openDialog(
    host,
    copy.chooserTitle,
    (close) => {
      const sections = CATEGORIES.map((c, category) => {
        const puzzles = list.filter((p) => p.category === category);
        const solved = options.progress.count(puzzles.map((p) => p.name));
        const open = options.current ? options.current.startsWith(c.prefix) && /\d+$/.test(options.current) : category === 0;
        const items = puzzles.map((p) => {
          const done = options.progress.isSolved(p.name);
          const title = options.titles[p.index]?.title ?? "";
          const button = h(
            "button",
            {
              type: "button",
              class: `tim3-puzzle${done ? " is-solved" : ""}`,
              "aria-current": p.name === options.current ? "true" : false,
              "data-autofocus": p.name === options.current ? true : false,
            },
            h("span", { class: "tim3-puzzle-number" }, String(p.number)),
            h("span", { class: "tim3-puzzle-title" }, title || copy.puzzleNumber(p.number)),
            done ? h("span", { class: "tim3-puzzle-solved" }, copy.solvedMark) : null,
          );
          button.addEventListener("click", () => {
            close();
            options.pick(p);
          });
          return h("li", {}, button);
        });
        const details = h(
          "details",
          { class: "tim3-category" },
          h("summary", {}, h("span", {}, copy.categories[category]!), h("span", { class: "tim3-category-progress" }, copy.progress(solved, puzzles.length))),
          h("ol", { class: "tim3-puzzles" }, ...items),
        );
        details.open = open;
        return details;
      });
      const lab = h("button", { type: "button", class: "secondary tim3-lab-button" }, copy.lab);
      lab.addEventListener("click", () => {
        close();
        options.lab();
      });
      return [
        ...sections,
        h("p", { class: "muted tim3-note" }, copy.labDescription),
        h("div", { class: "tim3-dialog-actions" }, lab, h("button", { type: "button", class: "primary", onclick: () => close() }, copy.close)),
      ];
    },
    options.onClose,
  );
}

/** Options : voix du professeur (anglaises, D4), musique. */
export function optionsDialog(
  host: HTMLElement,
  options: { voices: boolean; music: boolean; setVoices(on: boolean): void; setMusic(on: boolean): void; onClose?(): void },
): DialogHandle {
  return openDialog(
    host,
    copy.optionsTitle,
    (close) => [
      checkbox(copy.voices, options.voices, options.setVoices, copy.voicesNote),
      checkbox(copy.music, options.music, options.setMusic),
      h("div", { class: "tim3-dialog-actions" }, h("button", { type: "button", class: "primary", onclick: () => close() }, copy.done)),
    ],
    options.onClose,
  );
}

function checkbox(label: string, checked: boolean, change: (on: boolean) => void, note?: string): HTMLElement {
  const input = h("input", { type: "checkbox" });
  input.checked = checked;
  input.addEventListener("change", () => change(input.checked));
  return h("label", { class: "tim3-check" }, input, h("span", {}, label, note ? h("small", { class: "muted" }, note) : null));
}

/** Réglages du Labo (GRAVITY.ITF, MUSICBOX.ITF) : gravité, pression, couleur du décor, musique. */
export function labDialog(
  host: HTMLElement,
  options: { settings: LabSettings; music: readonly { id: number; text: string }[]; change(s: Partial<LabSettings>): void; onClose?(): void },
): DialogHandle {
  const s = options.settings;
  const range = (label: string, value: number, min: number, max: number, def: number, key: "gravity" | "pressure"): HTMLElement => {
    const input = h("input", { type: "range", min, max, step: 1, value });
    const out = h("output", {}, String(value));
    input.addEventListener("input", () => {
      out.textContent = input.value;
      options.change({ [key]: Number(input.value) });
    });
    return h("label", { class: "tim3-range" }, h("span", {}, label, h("small", { class: "muted" }, copy.defaultValue(def))), input, out);
  };
  const background = h("select", {});
  copy.backgroundNames.forEach((name, i) => background.append(h("option", { value: i + 1, selected: s.background === i + 1 }, name)));
  background.addEventListener("change", () => options.change({ background: Number(background.value) }));
  const music = h("select", {});
  music.append(h("option", { value: 0, selected: s.music === 0 }, copy.noMusic));
  for (const m of options.music) music.append(h("option", { value: m.id, selected: s.music === m.id }, m.text));
  music.addEventListener("change", () => options.change({ music: Number(music.value) }));
  return openDialog(
    host,
    copy.labTitle,
    (close) => [
      range(copy.gravity, s.gravity, 0, 999, 272, "gravity"),
      range(copy.pressure, s.pressure, 0, 999, 67, "pressure"),
      h("label", { class: "tim3-select" }, h("span", {}, copy.background), background),
      h("label", { class: "tim3-select" }, h("span", {}, copy.music), music),
      h("div", { class: "tim3-dialog-actions" }, h("button", { type: "button", class: "primary", onclick: () => close() }, copy.done)),
    ],
    options.onClose,
  );
}

/** PUZZSOLV.ITF : identifiants des boutons (17002 « Même Puzzle », 17003 « Puzzle Suivant », 17004 « Rejouer la Solution »). */
export const PUZZSOLV = { same: 17002, next: 17003, replay: 17004, title: 21060 } as const;

/**
 * Puzzle réussi (PUZZSOLV.ITF, 4260f0) : rester sur le puzzle, rejouer la solution du joueur ou passer au suivant. « Puzzle Suivant »
 * reçoit le focus (450d44 : drapeau 0x10) et se grise s'il n'y a pas de puzzle suivant ; Échap ferme la fenêtre comme « Même Puzzle »
 * (le jeu donne Échap à « Rejouer la Solution », drapeau 0x20 : écart choisi, Échap ne relance pas la machine).
 */
export function solvedDialog(
  host: ItfHost,
  options: { hasNext: boolean; canReplay: boolean; same(): void; replay(): void; next(): void; onClose?(): void },
): DialogHandle {
  const disabled = [...(options.hasNext ? [] : [PUZZSOLV.next]), ...(options.canReplay ? [] : [PUZZSOLV.replay])];
  return openItfDialog(host, readItf(host.assets.index.get("PUZZSOLV.ITF")), {
    title: itfText(host.assets, PUZZSOLV.title),
    state: { disabled },
    defaultId: PUZZSOLV.next,
    choose: (id) => {
      if (id === PUZZSOLV.next) options.next();
      else if (id === PUZZSOLV.replay) options.replay();
      else options.same();
    },
    ...(options.onClose ? { onClose: options.onClose } : {}),
  });
}

/** Description d'une pièce (INFO.ITF) : nom et description de `INFO.RES`. */
export function partInfoDialog(host: HTMLElement, info: PartInfo | undefined, onClose?: () => void): DialogHandle {
  return openDialog(
    host,
    info?.name ?? copy.partInfoTitle,
    (close) => [h("p", {}, info?.description ?? ""), h("div", { class: "tim3-dialog-actions" }, h("button", { type: "button", class: "primary", onclick: () => close() }, copy.ok))],
    onClose,
  );
}

/** Un emplacement de machine tel que la fenêtre l'affiche. */
export interface MachineRow {
  slot: number;
  /** Nom de la machine, `null` si l'emplacement est vide. */
  name: string | null;
  /** Date de sauvegarde, déjà mise en forme (vide pour un emplacement vide). */
  date: string;
}

/** Réponse de l'application à un clic sur « Sauvegarder » ou « Charger » : le message à dire, et si l'action a abouti. */
export interface MachineReply {
  ok: boolean;
  message: string;
  /** Sauvegarde : l'emplacement est plein, il faut confirmer le remplacement. */
  occupied?: boolean;
}

/**
 * Machines du Labo : dix emplacements, chacun avec son nom et sa date. Sauvegarder (au Labo seulement) demande un nom et, sur un
 * emplacement plein, confirme par « Remplacer » ; Charger ferme la fenêtre quand la machine est chargée ; Effacer vide l'emplacement.
 */
export function machinesDialog(
  host: HTMLElement,
  options: {
    canSave: boolean;
    /** Nom proposé (la dernière machine sauvegardée ou chargée). */
    name: string;
    rows(): MachineRow[];
    save(slot: number, name: string, replace: boolean): MachineReply;
    /** Charge l'emplacement ; la fenêtre se ferme si `ok`. */
    load(slot: number): MachineReply;
    erase(slot: number): string;
    onClose?(): void;
  },
): DialogHandle {
  return openDialog(
    host,
    copy.machinesTitle,
    (close) => {
      const name = h("input", { type: "text", maxlength: NAME_MAX, autocomplete: "off", value: options.name, "data-autofocus": options.canSave });
      const status = h("p", { class: "tim3-machines-status", role: "status", "aria-live": "polite" });
      const list = h("ol", { class: "tim3-machines" });
      let confirming = 0;
      let focus = "";
      const say = (message: string): void => {
        status.textContent = message;
      };
      const render = (): void => {
        list.replaceChildren(
          ...options.rows().map((row) => {
            const filled = row.name !== null;
            const button = (key: string, label: string, kind: "primary" | "secondary", act: () => void, disabled = false): HTMLButtonElement => {
              const b = h("button", { type: "button", class: kind, "data-key": `${key}-${row.slot}`, disabled }, label);
              b.setAttribute("aria-label", `${label} : ${copy.machineSlot(row.slot)}${filled ? `, ${row.name}` : `, ${copy.machineEmpty}`}`);
              b.addEventListener("click", () => {
                focus = `${key}-${row.slot}`;
                act();
              });
              return b;
            };
            const actions: HTMLElement[] = [];
            if (options.canSave) {
              if (confirming === row.slot) {
                actions.push(
                  button("save", copy.machineReplace, "primary", () => {
                    confirming = 0;
                    const reply = options.save(row.slot, name.value, true);
                    say(reply.message);
                    render();
                  }),
                  button("cancel", copy.cancel, "secondary", () => {
                    confirming = 0;
                    say("");
                    render();
                  }),
                );
              } else {
                actions.push(
                  button("save", copy.machineSave, "secondary", () => {
                    const reply = options.save(row.slot, name.value, false);
                    confirming = reply.occupied ? row.slot : 0;
                    say(reply.message);
                    if (!reply.ok && !reply.occupied && !name.value.trim()) name.focus();
                    render();
                  }),
                );
              }
            }
            if (confirming !== row.slot) {
              actions.push(
                button(
                  "load",
                  copy.machineLoad,
                  "secondary",
                  () => {
                    const reply = options.load(row.slot);
                    say(reply.message);
                    if (reply.ok) close();
                    else render();
                  },
                  !filled,
                ),
              );
              if (filled)
                actions.push(
                  button("erase", copy.machineErase, "secondary", () => {
                    say(options.erase(row.slot));
                    render();
                  }),
                );
            }
            return h(
              "li",
              { class: `tim3-machine${filled ? "" : " is-empty"}` },
              h("span", { class: "tim3-machine-number" }, String(row.slot)),
              h("span", { class: "tim3-machine-name" }, filled ? row.name : copy.machineEmpty, filled ? h("small", { class: "muted" }, row.date) : null),
              h("span", { class: "tim3-machine-actions" }, ...actions),
            );
          }),
        );
        if (focus) list.querySelector<HTMLElement>(`[data-key="${focus}"]`)?.focus();
      };
      render();
      focus = "";
      return [
        options.canSave ? h("label", { class: "tim3-select tim3-machine-field" }, h("span", {}, copy.machineName), name) : h("p", { class: "muted tim3-note" }, copy.machinesLoadOnly),
        status,
        list,
        h("div", { class: "tim3-dialog-actions" }, h("button", { type: "button", class: "primary", onclick: () => close() }, copy.close)),
      ];
    },
    options.onClose,
  );
}

/** GENERIC.ITF : texte, boutons, et textes d'origine de la fenêtre (`INTRFACE.RES`). */
export const GENERIC = { text: 65004, ok: 65001, cancel: 65002, frame: 65000, title: 2393, okLabel: 31107, yes: 31114, no: 31115 } as const;

/**
 * Message ou question du jeu (GENERIC.ITF, 422267) : `text` dans la zone de texte, un ou deux boutons dont les libellés sont des
 * identifiants de `INTRFACE.RES`. Un seul bouton : le second est caché et le premier centré sous le cadre (42253a). Entrée : premier
 * bouton ; Échap : le second, ou le seul (450d44). `choose` reçoit 1 (premier bouton) ou 0 (second) ; fermer autrement ne choisit rien.
 */
export function genericDialog(
  host: ItfHost,
  options: { text: string; buttons: readonly [number] | readonly [number, number]; title?: string; choose(result: 0 | 1): void; onClose?(): void },
): DialogHandle {
  const itf = readItf(host.assets.index.get("GENERIC.ITF"));
  const [first, second] = options.buttons;
  const texts: Record<number, string> = { [GENERIC.text]: options.text, [GENERIC.ok]: itfText(host.assets, first) };
  const state: ItfDialogOptions["state"] = { texts };
  if (second === undefined) {
    const frame = itf.controls.find((c) => c.id === GENERIC.frame);
    const ok = itf.controls.find((c) => c.id === GENERIC.ok);
    state.hidden = [GENERIC.cancel];
    if (frame && ok) state.moved = { [GENERIC.ok]: { x: frame.x + Math.trunc((frame.width - ok.width) / 2) } };
  } else texts[GENERIC.cancel] = itfText(host.assets, second);
  return openItfDialog(host, itf, {
    title: options.title ?? itfText(host.assets, GENERIC.title),
    state,
    defaultId: GENERIC.ok,
    cancelId: second === undefined ? GENERIC.ok : GENERIC.cancel,
    choose: (id) => options.choose(id === GENERIC.ok ? 1 : 0),
    ...(options.onClose ? { onClose: options.onClose } : {}),
  });
}

/** Question oui / non (GENERIC.ITF, boutons « Oui » et « Non ») : `yes` au premier. */
export function confirmDialog(host: ItfHost, text: string, yes: () => void, onClose?: () => void): DialogHandle {
  return genericDialog(host, { text, buttons: [GENERIC.yes, GENERIC.no], choose: (r) => r === 1 && yes(), ...(onClose ? { onClose } : {}) });
}

/** Message (GENERIC.ITF, bouton « OK » seul). */
export function messageDialog(host: ItfHost, text: string, onClose?: () => void): DialogHandle {
  return genericDialog(host, { text, buttons: [GENERIC.okLabel], choose: () => undefined, ...(onClose ? { onClose } : {}) });
}

/** Textes de la fenêtre « programmer » lus dans `INTRFACE.RES` (rubrique « PROGRAM PART »). */
export interface ProgramTexts {
  done: string;
  mass: string;
  elasticity: string;
  density: string;
  friction: string;
  /** Refus de « Terminé » : boîte, ballon trop gros. */
  box: string;
  balloon: string;
}

/**
 * Fenêtre « programmer » (`PROG<type>.ITF`, 4249f8) : aperçu du choix (`PROGPART.ANM`) avec flèches haut / bas, compteur
 * du pistolet laser, réglettes de la balle programmable et du seau troué, « Terminé ». Fermer autrement (Échap, fond)
 * annule (`PartProgram.cancel`).
 */
export function programDialog(
  host: HTMLElement,
  options: {
    title: string;
    program: PartProgram;
    texts: ProgramTexts;
    /** Image de l'état de `PROGPART.ANM` (aperçu), `null` si absente. */
    preview(state: number): HTMLCanvasElement | null;
    /** Après « Terminé » accepté. */
    changed(): void;
    onClose?(): void;
  },
): DialogHandle {
  const prog = options.program;
  const t = options.texts;
  let finished = false;
  return openDialog(
    host,
    options.title,
    (close) => {
      const body: Child[] = [];
      const status = h("p", { class: "tim3-program-status", "aria-live": "polite" });
      const alert = h("p", { class: "tim3-program-alert", role: "alert", hidden: true });
      const view = h("div", { class: "tim3-program-preview" });
      const refresh = (): void => {
        if (prog.kind === "counter") {
          view.replaceChildren(h("output", { class: "tim3-program-counter" }, String(prog.counter)));
          status.textContent = copy.programCounter(prog.counter);
        } else {
          const c = prog.choice;
          const canvas = c ? options.preview(c.preview) : null;
          if (canvas) {
            canvas.setAttribute("role", "img");
            canvas.setAttribute("aria-label", copy.programChoice(prog.index + 1, prog.choices.length));
          }
          view.replaceChildren(...(canvas ? [canvas] : []));
          status.textContent = prog.choices.length ? copy.programChoice(prog.index + 1, prog.choices.length) : "";
        }
        if (!prog.fits) {
          alert.textContent = prog.refusal === "balloon" ? t.balloon : t.box;
          alert.hidden = false;
        } else alert.hidden = true;
        if (bucketInput) bucketInput.value = String(prog.bucket);
      };
      const arrow = (label: string, text: string, act: () => void): HTMLButtonElement => {
        const b = h("button", { type: "button", class: "secondary tim3-program-arrow", "aria-label": label }, text);
        b.addEventListener("click", () => {
          act();
          refresh();
        });
        return b;
      };
      let bucketInput: HTMLInputElement | null = null;
      if (prog.kind === "bucket") {
        const input = h("input", { type: "range", min: 0, max: BUCKET_MAX, step: 1, value: prog.bucket });
        bucketInput = input;
        input.addEventListener("input", () => {
          prog.setBucket(Number(input.value));
          refresh();
        });
        body.push(view, h("label", { class: "tim3-range" }, h("span", {}, copy.programBucket), input, h("span", {})));
      } else {
        const up = arrow(prog.kind === "counter" ? copy.programMore : copy.programPrevious, "▲", () => prog.up());
        const down = arrow(prog.kind === "counter" ? copy.programLess : copy.programNext, "▼", () => prog.down());
        body.push(h("div", { class: "tim3-program-choice" }, view, h("div", { class: "tim3-program-arrows" }, up, down)));
      }
      if (prog.kind === "ball") {
        const labels: Record<BallSetting, string> = { mass: t.mass, elasticity: t.elasticity, density: t.density, friction: t.friction };
        for (const key of ["mass", "elasticity", "density", "friction"] as const) {
          const input = h("input", { type: "range", min: 0, max: 10, step: 1, value: prog.ball[key] });
          const out = h("output", {}, String(prog.ball[key]));
          input.addEventListener("input", () => {
            prog.setBall(key, Number(input.value));
            out.textContent = input.value;
          });
          body.push(h("label", { class: "tim3-range" }, h("span", {}, labels[key]), input, out));
        }
      }
      const done = h("button", { type: "button", class: "primary", "data-autofocus": true }, t.done);
      done.addEventListener("click", () => {
        if (!prog.done()) {
          refresh();
          return;
        }
        finished = true;
        options.changed();
        close();
      });
      refresh();
      return [...body, status, alert, h("div", { class: "tim3-dialog-actions" }, done)];
    },
    () => {
      if (!finished) prog.cancel();
      options.onClose?.();
    },
  );
}
