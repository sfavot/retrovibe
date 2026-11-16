/**
 * Noyau, groupe « polygones » : `AvoidPath`, `InPolygon`, `MergePoly`.
 *
 * Référence : `engines/sci/engine/kpathing.cpp` (`kAvoidPath`, `kInPolygon`, `kMergePoly`, `convert_polygon`,
 * `convert_polygon_set`, `allocateOutputArray`) de ScummVM, GPL v3 ou ultérieure, lu puis réécrit. Les calculs sont dans
 * `engine/polygons.ts`.
 *
 * - `AvoidPath(x, y, xFin, yFin, obstacles, largeur, hauteur[, opt])` : `obstacles` est l'objet liste des scripts (ou 0),
 *   dont la propriété `elements` est la liste du noyau ; rend un tableau d'entiers neuf : les points du chemin, x puis y,
 *   terminé par (0x7777, 0x7777). Le script le recopie puis le libère.
 * - `AvoidPath(x, y, polygon)` et `InPolygon(x, y, polygon)` : 1 si le point est dans le polygon ou sur son bord.
 * - `MergePoly(points, liste, taille)` : `points` est un tableau terminé par 0x7777 ; rend le contour fusionné (même
 *   forme) et ajoute 0x10 au `type` de chaque polygon absorbé.
 * - Un objet `Polygon` donne ses points par `points` (un tableau du noyau, ou un objet `IntArray` dont `data` est le
 *   tableau), leur nombre par `size`, son genre par `type`.
 *
 * Écarts volontaires : le tableau rendu a juste la taille du chemin (ScummVM réserve deux points de plus) ; un polygon
 * illisible est ignoré avec un avertissement.
 */
import { ArrayType } from "../ids";
import { fromInt, NULL_REG, type Reg, SciArray, toSint16 } from "../memory";
import { readSelector, writeSelector } from "../object";
import { findPath, mergePolygons, PATH_END, type Point, pointInPolygon, POLYGON_MERGED, type PolygonInput } from "../polygons";
import type { Vm } from "../vm";
import type { Kernel } from "./kernel";

const WORD_MASK = 0xffff;
const IN_POLYGON_ARGC = 3;
const PATH_MIN_ARGC = 7;
const PATH_OPT_ARG = 7;

/** Tableau du noyau derrière une valeur : le tableau lui-même, ou celui d'un objet `IntArray`. */
function arrayOf(vm: Vm, reg: Reg): SciArray | undefined {
  if (vm.memory.isArray(reg)) return vm.memory.array(reg);
  if (!vm.memory.getObject(reg)) return undefined;
  const data = readSelector(vm.memory, reg, vm.selectors.id("data"));
  return vm.memory.isArray(data) ? vm.memory.array(data) : undefined;
}

function readPolygon(vm: Vm, object: Reg): PolygonInput | undefined {
  if (!vm.memory.getObject(object)) return undefined;
  const size = readSelector(vm.memory, object, vm.selectors.id("size")) & WORD_MASK;
  if (size === 0) return undefined;
  const array = arrayOf(vm, readSelector(vm.memory, object, vm.selectors.id("points")));
  if (!array || array.size < size * 2) {
    vm.warn(`polygon ${vm.nameOf(object)} illisible`);
    return undefined;
  }
  const points: Point[] = [];
  for (let i = 0; i < size; i++) points.push({ x: toSint16(array.get(i * 2)), y: toSint16(array.get(i * 2 + 1)) });
  return { type: readSelector(vm.memory, object, vm.selectors.id("type")) & WORD_MASK, points };
}

/** Objets `Polygon` d'une liste du noyau, dans l'ordre. */
function polygonObjects(vm: Vm, listReg: Reg): Reg[] {
  const out: Reg[] = [];
  const list = vm.memory.lists.get(listReg);
  for (let at = list ? list.first : NULL_REG; at !== NULL_REG; ) {
    const node = vm.memory.node(at);
    if (!node) break;
    if (node.value !== NULL_REG) out.push(node.value);
    at = node.succ;
  }
  return out;
}

function pointArray(vm: Vm, points: readonly Point[]): Reg {
  const array = new SciArray(ArrayType.Int16, (points.length + 1) * 2);
  points.forEach((point, index) => {
    array.set(index * 2, fromInt(point.x));
    array.set(index * 2 + 1, fromInt(point.y));
  });
  array.set(points.length * 2, PATH_END);
  array.set(points.length * 2 + 1, PATH_END);
  return vm.memory.arrays.allocate(array);
}

function avoidPath(vm: Vm, argv: Uint32Array): Reg {
  const start = { x: toSint16(argv[0]), y: toSint16(argv[1]) };
  if (argv.length === IN_POLYGON_ARGC) {
    const polygon = readPolygon(vm, argv[2]);
    return polygon && pointInPolygon(start, polygon.points) ? 1 : NULL_REG;
  }
  if (argv.length < PATH_MIN_ARGC) {
    vm.warn(`AvoidPath : ${argv.length} arguments`);
    return NULL_REG;
  }
  const end = { x: toSint16(argv[2]), y: toSint16(argv[3]) };
  const list = argv[4] === NULL_REG ? NULL_REG : readSelector(vm.memory, argv[4], vm.selectors.id("elements"));
  const polygons = polygonObjects(vm, list)
    .map((object) => readPolygon(vm, object))
    .filter((polygon) => polygon !== undefined);
  const opt = argv.length > PATH_OPT_ARG ? argv[PATH_OPT_ARG] & WORD_MASK : 1;
  return pointArray(vm, findPath(start, end, polygons, { width: argv[5] & WORD_MASK, height: argv[6] & WORD_MASK, opt }));
}

function mergePoly(vm: Vm, argv: Uint32Array): Reg {
  const source = arrayOf(vm, argv[0]);
  if (!source) return NULL_REG;
  const work: Point[] = [];
  for (let i = 0; i + 1 < source.size && (source.get(i) & WORD_MASK) !== PATH_END; i += 2) work.push({ x: toSint16(source.get(i)), y: toSint16(source.get(i + 1)) });
  const objects = polygonObjects(vm, argv[1]);
  const inputs = objects.map((object) => readPolygon(vm, object));
  const result = mergePolygons(
    work,
    inputs.map((input) => input ?? { type: 0, points: [] }),
  );
  const typeSelector = vm.selectors.id("type");
  result.merged.forEach((merged, index) => {
    if (merged) writeSelector(vm.memory, objects[index], typeSelector, fromInt(inputs[index]!.type + POLYGON_MERGED));
  });
  return pointArray(vm, result.points);
}

export function registerPolygonKernel(kernel: Kernel): void {
  kernel.register("AvoidPath", avoidPath).register("InPolygon", avoidPath).register("MergePoly", mergePoly);
}
