/**
 * Fonctions natives du groupe F2 : acteurs, marche, zones de marche (CT), zoom.
 *
 * Référence : `engines/cruise/function.cpp` de ScummVM (GPL v3+, release 2026.4.0) : `Op_LoadCt`, `Op_AddAnimation`,
 * `Op_RemoveAnimation`, `Op_SetZoom`, `Op_SetObjectAtNode`, `Op_SetNodeState`, `Op_SetNodeColor`, `Op_TrackAnim`, `Op_GetNodeX`,
 * `Op_GetNodeY`, `Op_EndAnim`, `Op_GetZoom` (`computeZoom`), `Op_GetStep` (`subOp23`), `Op_XClick`, `Op_YClick`, `Op_GetPixel`,
 * `Op_FreeCT`, `Op_Narrator`, `Op_CTOn`, `Op_CTOff`, `Op_MouseMove`, `Op_MouseEnd`, `Op_FreezeAni` (`Op_60Sub`), `Op_ComputeLine`
 * (`perso.cpp::cor_droite`), `Op_AniDir`. Lu puis réécrit (vagues C, F2 et E) ; zones de marche et trajets : `walk.ts`, `perso.ts`,
 * `actors.ts`.
 */
import { ACTOR_END, addAnimation, findActor, isAnimFinished, removeAnimation } from "../actors";
import { readCString, strlcpy, writeI16 } from "../memory";
import { getMultipleObjectParam, setObjectPosition } from "../objects";
import { computeZoom, corDroite, subOp23 } from "../perso";
import { freeCtp, getNode, getPixel, loadCt, setNodeColor, setNodeState } from "../walk";
import { orCurrent, type NativeGroup } from "./types";

export const F2_ACTORS: NativeGroup = {
  0x17: {
    name: "LoadCt",
    args: 1,
    impl(e) {
      const p = e.vm.popPtr();
      if (!p) throw new Error("LoadCt : pointeur nul");
      return loadCt(e, strlcpy(readCString(p), 40));
    },
  },
  0x18: {
    name: "AddAnimation",
    args: 7,
    impl(e) {
      const stepY = e.vm.popVar();
      const stepX = e.vm.popVar();
      const direction = e.vm.popVar();
      const start = e.vm.popVar();
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      if (direction < 0 || direction > 3) return 0;
      const actor = addAnimation(e, ovl, obj, direction, type);
      // ScummVM : `params` non initialisé si l'objet n'existe pas (zéros ici).
      const params = getMultipleObjectParam(e, ovl, obj) ?? { X: 0, Y: 0 };
      actor.x = params.X;
      actor.y = params.Y;
      actor.x_dest = -1;
      actor.y_dest = -1;
      actor.endDirection = -1;
      actor.start = start;
      actor.stepX = stepX;
      actor.stepY = stepY;
      const end = ACTOR_END[direction]!;
      let zoom = computeZoom(e, params.Y);
      if (end < 0) zoom = -zoom;
      getPixel(e, params.X, params.Y);
      setObjectPosition(e, ovl, obj, 3, Math.abs(end) - 1 + start);
      setObjectPosition(e, ovl, obj, 4, zoom);
      setObjectPosition(e, ovl, obj, 5, e.walk.numPoly);
      e.animationStart = false;
      return 0;
    },
  },
  0x19: {
    name: "RemoveAnimation",
    args: 3,
    impl(e) {
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      return removeAnimation(e, ovl, obj, type);
    },
  },
  0x1a: {
    name: "SetZoom",
    args: 4,
    impl(e) {
      e.var46 = e.vm.popVar();
      e.var45 = e.vm.popVar();
      e.var42 = e.vm.popVar();
      e.var39 = e.vm.popVar();
      return 0;
    },
  },
  0x1b: {
    name: "SetObjectAtNode",
    args: 3,
    impl(e) {
      const node = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      const pos = getNode(e, node);
      if (pos) {
        setObjectPosition(e, ovl, obj, 0, pos[0]);
        setObjectPosition(e, ovl, obj, 1, pos[1]);
        setObjectPosition(e, ovl, obj, 2, pos[1]);
        setObjectPosition(e, ovl, obj, 4, computeZoom(e, pos[1]));
      }
      return 0;
    },
  },
  0x1c: {
    name: "SetNodeState",
    args: 2,
    impl(e) {
      const state = e.vm.popVar();
      const node = e.vm.popVar();
      return setNodeState(e, node, state);
    },
  },
  0x1d: {
    name: "SetNodeColor",
    args: 2,
    impl(e) {
      const color = e.vm.popVar();
      const node = e.vm.popVar();
      return setNodeColor(e, node, color);
    },
  },
  0x1e: {
    name: "TrackAnim",
    args: 6,
    impl(e) {
      const endDirection = e.vm.popVar();
      const y = e.vm.popVar();
      const x = e.vm.popVar();
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      const actor = findActor(e, ovl, obj, type);
      if (!actor) return 1;
      e.animationStart = false;
      actor.x_dest = x;
      actor.y_dest = y;
      actor.flag = 1;
      actor.endDirection = endDirection;
      return 0;
    },
  },
  0x1f: {
    name: "GetNodeX",
    args: 1,
    impl(e) {
      const node = e.vm.popVar();
      const pos = getNode(e, node);
      if (!pos) throw new Error(`GetNodeX : nœud ${node} absent`);
      return pos[0];
    },
  },
  0x20: {
    name: "GetNodeY",
    args: 1,
    impl(e) {
      const node = e.vm.popVar();
      const pos = getNode(e, node);
      if (!pos) throw new Error(`GetNodeY : nœud ${node} absent`);
      return pos[1];
    },
  },
  0x21: {
    name: "EndAnim",
    args: 3,
    impl(e) {
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      return isAnimFinished(e, ovl, obj, type) ? 1 : 0;
    },
  },
  0x22: {
    name: "GetZoom",
    args: 1,
    impl(e) {
      return computeZoom(e, e.vm.popVar());
    },
  },
  0x23: {
    name: "GetStep",
    args: 2,
    impl(e) {
      const si = e.vm.popVar();
      const dx = e.vm.popVar();
      return subOp23(dx, si);
    },
  },
  0x25: {
    name: "XClick",
    args: 1,
    impl(e) {
      const x = e.vm.popVar();
      if (x !== -1) {
        e.aniX = x;
        e.animationStart = true;
      }
      return e.aniX;
    },
  },
  0x26: {
    name: "YClick",
    args: 1,
    impl(e) {
      const y = e.vm.popVar();
      if (y !== -1) {
        e.aniY = y;
        e.animationStart = true;
      }
      return e.aniY;
    },
  },
  0x27: {
    name: "GetPixel",
    args: 2,
    impl(e) {
      const x = e.vm.popVar();
      const y = e.vm.popVar();
      getPixel(e, x, y);
      return e.walk.numPoly;
    },
  },
  0x29: {
    name: "FreeCT",
    args: 0,
    impl(e) {
      freeCtp(e);
      return 0;
    },
  },
  0x37: {
    name: "Narrator",
    args: 2,
    impl(e) {
      const idx = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      e.narratorOvl = ovl;
      e.narratorIdx = idx;
      return 0;
    },
  },
  0x3a: {
    name: "CTOn",
    args: 0,
    impl(e) {
      e.flagCt = 1;
      return 0;
    },
  },
  0x3b: {
    name: "CTOff",
    args: 0,
    impl(e) {
      e.flagCt = 0;
      return 0;
    },
  },
  0x51: {
    name: "MouseMove",
    args: 2,
    impl(e) {
      e.vm.popVar();
      e.vm.popVar();
      return 0;
    },
  },
  0x52: {
    name: "MouseEnd",
    args: 0,
    impl(e) {
      return e.automoveInc < e.automoveMax ? 0 : 1;
    },
  },
  0x60: {
    name: "FreezeAni",
    args: 5,
    impl(e) {
      const newFreeze = e.vm.popVar();
      const oldFreeze = e.vm.popVar();
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      const actor = findActor(e, ovl, obj, type);
      if (actor && (actor.freeze === oldFreeze || oldFreeze === -1)) actor.freeze = newFreeze;
      return 0;
    },
  },
  0x71: {
    name: "ComputeLine",
    args: 5,
    impl(e) {
      const y2 = e.vm.popVar();
      const x2 = e.vm.popVar();
      const y1 = e.vm.popVar();
      const x1 = e.vm.popVar();
      const dest = e.vm.popPtr();
      if (!dest) throw new Error("ComputeLine : pointeur nul");
      const points = corDroite(x1, y1, x2, y2);
      e.flagObstacle = 0;
      // `flipGen` : les points sont rangés en mots grand-boutistes dans la mémoire du script.
      points.forEach(([x, y], i) => {
        writeI16(dest.block, dest.offset + i * 4, x);
        writeI16(dest.block, dest.offset + i * 4 + 2, y);
      });
      return points.length;
    },
  },
  0x75: {
    name: "AniDir",
    args: 3,
    impl(e) {
      const type = e.vm.popVar();
      const obj = e.vm.popVar();
      const ovl = orCurrent(e, e.vm.popVar());
      return findActor(e, ovl, obj, type)?.startDirection ?? -1;
    },
  },
};
