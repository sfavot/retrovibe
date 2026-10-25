// Post-script : amorce les fonctions que l'auto-analyse n'atteint pas.
// AM1.EXE (Microsoft C 5.x/6, modèle large) appelle beaucoup de code via des pointeurs lointains ou
// des tables ; l'auto-analyse seule laisse environ la moitié des segments de code non désassemblés.
// Sources d'amorces (toutes vérifiées sur le contenu des octets) :
//  1. CALL FAR / JMP FAR (9A / EA off seg) vers un segment de code ;
//  2. paires (offset, segment) adjacentes ou quasi (pointeurs de fonction dans le code ou DGROUP)
//     dont la cible commence par un prologue C (push bp / mov bp,sp) ;
//  3. balayage des prologues « 55 8B EC » (push bp / mov bp,sp) et « C8 nn nn 00 » (enter) dans le
//     code non désassemblé.
// Puis ré-analyse, jusqu'à stabilisation.
//@category Armaeth.RE

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;

import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.address.SegmentedAddressSpace;
import ghidra.program.model.data.Undefined;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.scalar.Scalar;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.pcode.JumpTable;
import ghidra.program.model.mem.MemoryBlock;

public class SeedFunctions extends GhidraScript {
    private Memory mem;
    private SegmentedAddressSpace sp;
    private final TreeSet<Integer> segs = new TreeSet<>();
    private long dgLinear;
    private final Map<Address, List<Address>> jumpTables = new LinkedHashMap<>();

    @Override
    protected void run() throws Exception {
        mem = currentProgram.getMemory();
        sp = ReCommon.space(currentProgram);
        dgLinear = ReCommon.dgroupLinear(currentProgram);
        List<MemoryBlock> code = ReCommon.codeBlocks(currentProgram);
        for (MemoryBlock b : code) segs.add((int) (b.getStart().getOffset() >> 4));

        for (int pass = 1; pass <= 6; pass++) {
            Set<Address> seeds = new LinkedHashSet<>();
            Set<Address> codeOnly = new LinkedHashSet<>(); // à désassembler sans créer de fonction (corps de case)
            long insBefore = currentProgram.getListing().getNumInstructions();
            collectRelocSeeds(code, seeds);
            collectPrologueSweep(code, seeds);
            repairFlow();
            collectJumpTables();
            collectOrphanTables(codeOnly);
            collectCodeGaps(seeds, codeOnly);
            int created = 0;
            for (Address a : codeOnly) {
                if (currentProgram.getListing().getInstructionAt(a) == null) disassemble(a);
            }
            for (Address a : seeds) {
                if (getFunctionAt(a) != null) continue;
                if (currentProgram.getListing().getInstructionContaining(a) != null
                        && currentProgram.getListing().getInstructionAt(a) == null) continue; // au milieu d'une instruction
                disassemble(a);
                if (createFunction(a, null) != null) created++;
            }
            long insAfter = currentProgram.getListing().getNumInstructions();
            println("passe " + pass + " : " + seeds.size() + " amorces, " + created + " fonctions créées, "
                    + (insAfter - insBefore) + " instructions nouvelles");
            if (created == 0 && insAfter == insBefore) break;
            analyzeAll(currentProgram);
        }
        for (int k = 0; k < 4; k++) {
            rebuildSwitchFunctions();
            int adopted = adoptOrphans();
            if (adopted == 0) break;
        }
        rebuildSwitchFunctions();
        long orphans = 0;
        for (Instruction i : currentProgram.getListing().getInstructions(true))
            if (currentProgram.getFunctionManager().getFunctionContaining(i.getAddress()) == null) orphans++;
        println("instructions hors fonction : " + orphans);
        println("fonctions : " + currentProgram.getFunctionManager().getFunctionCount());
    }

    /**
     * Tables de switch du compilateur : « CMP BX,n ; JA défaut ; SHL BX,1 ; JMP word ptr CS:[BX+table] ».
     * L'analyse de Ghidra ne les résout pas (table dans le segment de code) : les corps des « case »
     * resteraient non désassemblés. On lit n+1 mots à CS:table, on pose une référence de saut calculé
     * vers chaque cible, on désassemble, puis on recrée la fonction pour que son corps les inclue.
     */
    private int collectJumpTables() throws Exception {
        int touched = 0;
        for (Instruction ins : currentProgram.getListing().getInstructions(true)) {
            if (!ins.getMnemonicString().equals("JMP") || !ins.toString().contains("CS:[BX + ")) continue;
            if (hasUserComputedRefs(ins)) continue; // déjà traité
            int n = -1;
            Instruction p = ins;
            for (int k = 0; k < 6 && p != null; k++) {
                p = p.getPrevious();
                if (p != null && p.getMnemonicString().equals("CMP") && p.getScalar(1) != null) {
                    n = (int) p.getScalar(1).getUnsignedValue() + 1;
                    break;
                }
            }
            // variante « table de recherche » : MOV BX,base ; boucle (MOV AX,CS:[BX] ; CMP ; JZ ; ADD BX,2 ; LOOP) ;
            // JMP CS:[BX+disp] avec disp = 2*N : N identifiants puis N gestionnaires.
            long searchBase = -1;
            if (n < 0) {
                Instruction q = ins;
                boolean addBx2 = false;
                for (int k = 0; k < 12 && q != null; k++) {
                    q = q.getPrevious();
                    if (q == null) break;
                    if (q.getMnemonicString().equals("ADD") && q.toString().startsWith("ADD BX,0x2")) addBx2 = true;
                    if (addBx2 && q.getMnemonicString().equals("MOV") && q.toString().startsWith("MOV BX,0x") && q.getScalar(1) != null) {
                        searchBase = q.getScalar(1).getUnsignedValue();
                        break;
                    }
                }
            }
            boolean knownCount = n >= 2 && n <= 512;
            if (!knownCount) n = 256; // sans CMP : on lit tant que les cibles sont plausibles
            Object[] ops = ins.getOpObjects(0);
            long disp = -1;
            for (Object o : ops) if (o instanceof Scalar) disp = ((Scalar) o).getUnsignedValue();
            if (disp < 0) continue;
            if (searchBase >= 0) {
                if (disp % 2 != 0 || disp < 4 || disp > 512) continue;
                n = (int) (disp / 2);
                knownCount = true;
                disp = searchBase + disp;
            }
            int seg = ReCommon.segmentOf(currentProgram, ins.getAddress());
            long blockEnd = mem.getBlock(ins.getAddress()).getEnd().getOffset();
            List<Address> targets = new ArrayList<>();
            for (int k = 0; k < n; k++) {
                int off;
                try {
                    Address t = sp.getAddress(seg, (int) disp + 2 * k);
                    off = (mem.getByte(t) & 0xff) | ((mem.getByte(t.add(1)) & 0xff) << 8);
                } catch (Exception e) {
                    break;
                }
                Address tgt = sp.getAddress(seg, off);
                Address cell = sp.getAddress(seg, (int) disp + 2 * k);
                boolean plausible = isCode(tgt) && tgt.getOffset() <= blockEnd
                        && (currentProgram.getListing().getInstructionContaining(tgt) == null
                            || currentProgram.getListing().getInstructionAt(tgt) != null)
                        && cell.getOffset() > ins.getAddress().getOffset() - 0x10000;
                if (!plausible) {
                    if (knownCount) targets.clear();
                    break;
                }
                targets.add(tgt);
            }
            if (targets.isEmpty() || (!knownCount && targets.size() < 2)) continue;
            // références automatiques fausses sur ce saut
            for (var r : ins.getReferencesFrom()) {
                if (r.getSource() != SourceType.USER_DEFINED
                        && (r.getReferenceType() == RefType.COMPUTED_JUMP || r.getReferenceType() == RefType.READ))
                    currentProgram.getReferenceManager().delete(r);
            }
            // la table elle-même ne doit pas rester désassemblée comme du code
            Address tStart = sp.getAddress(seg, (int) disp);
            Address tEnd = sp.getAddress(seg, (int) disp + 2 * targets.size() - 1);
            if (currentProgram.getListing().getInstructionContaining(tStart) != null
                    || currentProgram.getListing().getInstructionContaining(tEnd) != null) {
                clearListing(tStart, tEnd);
            }
            for (Address t : targets) {
                currentProgram.getReferenceManager().addMemoryReference(ins.getAddress(), t,
                        RefType.COMPUTED_JUMP, SourceType.USER_DEFINED, 0);
                if (currentProgram.getListing().getInstructionAt(t) == null) {
                    disassemble(t);
                    touched++;
                }
            }
            jumpTables.put(ins.getAddress(), new ArrayList<>(targets));
        }
        println("tables de switch : " + touched + " cibles nouvelles, " + jumpTables.size() + " sauts calculés résolus");
        return touched;
    }

    /**
     * Instructions n'appartenant à aucune fonction (corps de case ou fragments atteints seulement par
     * une table) : on crée une fonction au début de chaque suite d'orphelines. Ce sont des « fragments »
     * (nommés frag_* plus tard) : leur décompilation est partielle mais les chaînes qu'ils référencent
     * restent attribuées à un identifiant de fonction.
     */
    private int adoptOrphans() throws Exception {
        List<Address> starts = new ArrayList<>();
        boolean prevOrphan = false;
        Address prevEnd = null;
        for (Instruction i : currentProgram.getListing().getInstructions(true)) {
            boolean orphan = currentProgram.getFunctionManager().getFunctionContaining(i.getAddress()) == null;
            boolean contiguous = prevEnd != null && prevEnd.add(1).equals(i.getAddress());
            if (orphan && !(prevOrphan && contiguous)) starts.add(i.getAddress());
            prevOrphan = orphan;
            prevEnd = i.getMaxAddress();
        }
        int n = 0;
        for (Address a : starts) {
            String nm = "frag_" + ReCommon.addr(currentProgram, a).replace(':', '_');
            if (createFunction(a, nm) != null) n++;
        }
        println("fragments créés : " + n);
        return n;
    }

    /**
     * Pour chaque saut calculé résolu : déclare la table au décompileur (« override » de JumpTable,
     * indispensable : sa récupération automatique lit les tables CS:[BX+n] avec un mauvais segment et
     * s'égare dans du code aléatoire) puis recalcule le corps de la fonction pour inclure les case.
     */
    private void rebuildSwitchFunctions() throws Exception {
        int n = 0;
        for (Map.Entry<Address, List<Address>> e : jumpTables.entrySet()) {
            Function f = currentProgram.getFunctionManager().getFunctionContaining(e.getKey());
            if (f == null) continue;
            JumpTable jt = new JumpTable(e.getKey(), new ArrayList<>(e.getValue()), true, 0);
            jt.writeOverride(f);
            CreateFunctionCmd.fixupFunctionBody(currentProgram, f, monitor);
            n++;
        }
        println("tables déclarées au décompileur : " + n);
    }

    private boolean hasUserComputedRefs(Instruction ins) {
        for (var r : ins.getReferencesFrom())
            if (r.getReferenceType() == RefType.COMPUTED_JUMP && r.getSource() == SourceType.USER_DEFINED) return true;
        return false;
    }

    /**
     * Les analyseurs de références créent des « données » d'un octet dans le code (cibles de
     * constantes mal interprétées), ce qui bloque le désassemblage à cet endroit. On les efface,
     * puis on suit à nouveau les flux (suite d'un appel, branches) jusqu'à stabilisation.
     */
    private int repairFlow() throws Exception {
        int total = 0;
        for (int round = 0; round < 20; round++) {
            for (MemoryBlock b : ReCommon.codeBlocks(currentProgram)) {
                for (Data d : currentProgram.getListing().getDefinedData(new AddressSet(b.getStart(), b.getEnd()), true)) {
                    if (!d.isDefined() || d.getDataType() instanceof Undefined) {
                        clearListing(d.getMinAddress(), d.getMaxAddress());
                    } else if (!d.getDataType().getName().startsWith("uint")) {
                        clearListing(d.getMinAddress(), d.getMaxAddress());
                    }
                }
            }
            int n = 0;
            List<Address> todo = new ArrayList<>();
            for (Instruction ins : currentProgram.getListing().getInstructions(true)) {
                Address ft = ins.getFallThrough();
                if (ft != null && isCode(ft) && currentProgram.getListing().getInstructionAt(ft) == null
                        && currentProgram.getListing().getInstructionContaining(ft) == null) todo.add(ft);
                for (var r : ins.getReferencesFrom()) {
                    if (!r.getReferenceType().isFlow() || r.getReferenceType().isIndirect()) continue;
                    Address t = r.getToAddress();
                    if (isCode(t) && currentProgram.getListing().getInstructionAt(t) == null
                            && currentProgram.getListing().getInstructionContaining(t) == null) todo.add(t);
                }
            }
            for (Address a : todo) {
                clearListing(a);
                if (disassemble(a)) n++;
            }
            total += n;
            if (n == 0) break;
        }
        println("flux réparés : " + total);
        return total;
    }

    /** Zones non désassemblées (sans instruction) de longueur >= min dans les blocs de code. */
    private List<Address[]> gaps(int min) throws Exception {
        List<Address[]> out = new ArrayList<>();
        var l = currentProgram.getListing();
        for (MemoryBlock b : ReCommon.codeBlocks(currentProgram)) {
            Address a = b.getStart();
            while (a != null && a.compareTo(b.getEnd()) <= 0) {
                Instruction in = l.getInstructionContaining(a);
                if (in != null) {
                    a = in.getMaxAddress().next();
                    continue;
                }
                Address s = a;
                int n = 0;
                while (a != null && a.compareTo(b.getEnd()) <= 0 && l.getInstructionContaining(a) == null) {
                    a = a.next();
                    n++;
                }
                if (n >= min) out.add(new Address[] { s, s.add(n - 1) });
            }
        }
        return out;
    }

    private int word(Address a) throws Exception {
        return (mem.getByte(a) & 0xff) | ((mem.getByte(a.add(1)) & 0xff) << 8);
    }

    /** Cible plausible d'une table de sauts du segment du bloc : dans le bloc, non nulle, pas au milieu d'une instruction. */
    private Address plausibleTarget(Address cell) {
        try {
            int seg = ReCommon.segmentOf(currentProgram, cell);
            int off = word(cell);
            if (off == 0) return null;
            Address t = sp.getAddress(seg, off);
            MemoryBlock b = mem.getBlock(t);
            if (b == null || b != mem.getBlock(cell) || !isCode(t)) return null;
            var l = currentProgram.getListing();
            if (l.getInstructionContaining(t) != null && l.getInstructionAt(t) == null) return null;
            return t;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Tables de cibles « orphelines » : les corps des case d'un switch ne sont atteignables que par
     * la table, et l'instruction JMP elle-même peut se trouver dans une zone non atteinte. On cherche
     * dans les zones non désassemblées des suites d'au moins 4 mots qui sont toutes des cibles
     * plausibles (au moins 3 valeurs distinctes) et on amorce leurs cibles.
     */
    private void collectOrphanTables(Set<Address> seeds) throws Exception {
        for (Address[] g : gaps(8)) {
            long start = g[0].getOffset(), end = g[1].getOffset();
            for (long p = start; p + 1 <= end; ) {
                List<Address> run = new ArrayList<>();
                long q = p;
                while (q + 1 <= end) {
                    Address t = plausibleTarget(g[0].add(q - start));
                    if (t == null) break;
                    run.add(t);
                    q += 2;
                }
                if (run.size() >= 4 && new java.util.HashSet<>(run).size() >= 3) {
                    seeds.addAll(run);
                    p = q;
                } else {
                    p++;
                }
            }
        }
    }

    /**
     * Zones de code non atteintes qui suivent une instruction sans suite (RET, JMP...) : corps de
     * switch sans table résolue, routines sans prologue. On amorce le début de la zone si les octets
     * ressemblent à du code (pas du texte, pas des zéros, pas une table de cibles).
     */
    private void collectCodeGaps(Set<Address> seeds, Set<Address> codeOnly) throws Exception {
        for (Address[] g : gaps(12)) {
            Address s = g[0];
            if (!gapStart(s)) continue;
            byte[] d = new byte[Math.min(16, (int) (g[1].getOffset() - s.getOffset() + 1))];
            mem.getBytes(s, d);
            if (d[0] == 0 && d[1] == 0) continue;
            int printable = 0;
            for (byte x : d) if ((x & 0xff) >= 0x20 && (x & 0xff) < 0x7f) printable++;
            if (printable >= 14) continue; // texte
            if (plausibleTarget(s) != null && plausibleTarget(s.add(2)) != null && plausibleTarget(s.add(4)) != null) continue; // table
            // juste après un « JMP CS:[BX+table] » : début d'un corps de case (suite du switch), pas une fonction
            Instruction prev = currentProgram.getListing().getInstructionBefore(s);
            if (prev != null && prev.getFlowType().isJump() && prev.getFlowType().isComputed()) codeOnly.add(s);
            else seeds.add(s);
        }
    }

    private boolean isCode(Address a) {
        if (a == null || a.getOffset() >= dgLinear) return false;
        MemoryBlock b = mem.getBlock(a);
        return b != null && b.isInitialized() && !b.getName().startsWith("HEADER");
    }

    /** Vrai si t est le premier octet d'une zone non désassemblée qui suit une instruction sans suite (RET, JMP...). */
    private boolean gapStart(Address t) {
        var l = currentProgram.getListing();
        if (l.getInstructionContaining(t) != null) return false;
        Instruction prev = l.getInstructionBefore(t);
        return prev != null && prev.getMaxAddress().add(1).equals(t) && prev.getFallThrough() == null;
    }

    private boolean prologue(Address a) {
        try {
            int b0 = mem.getByte(a) & 0xff;
            if (b0 == 0x55) return (mem.getByte(a.add(1)) & 0xff) == 0x8B && (mem.getByte(a.add(2)) & 0xff) == 0xEC;
            if (b0 == 0xC8) return (mem.getByte(a.add(3)) & 0xff) == 0x00; // enter nn,0
        } catch (Exception e) {
            // hors mémoire
        }
        return false;
    }

    /** Pointeurs lointains : mot segment = segment de code, mot offset juste avant (écart 2, ou 3/5/6 avec prologue). */
    private void collectRelocSeeds(List<MemoryBlock> code, Set<Address> seeds) throws Exception {
        for (MemoryBlock b : code) {
            byte[] d = new byte[(int) b.getSize()];
            mem.getBytes(b.getStart(), d);
            for (int p = 0; p + 1 < d.length; p++) {
                int w = (d[p] & 0xff) | ((d[p + 1] & 0xff) << 8);
                if (!segs.contains(w)) continue;
                for (int dl : new int[] { 2, 3, 5, 6 }) {
                    int q = p - dl;
                    if (q < 0) continue;
                    int off = (d[q] & 0xff) | ((d[q + 1] & 0xff) << 8);
                    Address t;
                    try {
                        t = sp.getAddress(w, off);
                    } catch (Exception e) {
                        continue;
                    }
                    if (!isCode(t)) continue;
                    boolean farCall = dl == 2 && q >= 1 && ((d[q - 1] & 0xff) == 0x9A || (d[q - 1] & 0xff) == 0xEA);
                    if (farCall || prologue(t) || gapStart(t)) seeds.add(t);
                }
            }
        }
        // pointeurs de fonction stockés dans DGROUP (tables de callbacks)
        byte[] dg = ReCommon.dgroupBytes(currentProgram);
        for (int p = 0; p + 3 < dg.length; p++) {
            int off = (dg[p] & 0xff) | ((dg[p + 1] & 0xff) << 8);
            int w = (dg[p + 2] & 0xff) | ((dg[p + 3] & 0xff) << 8);
            if (!segs.contains(w)) continue;
            Address t = sp.getAddress(w, off);
            if (isCode(t) && prologue(t)) seeds.add(t);
        }
    }

    private void collectPrologueSweep(List<MemoryBlock> code, Set<Address> seeds) throws Exception {
        for (MemoryBlock b : code) {
            byte[] d = new byte[(int) b.getSize()];
            mem.getBytes(b.getStart(), d);
            for (int p = 0; p + 3 < d.length; p++) {
                boolean pro = ((d[p] & 0xff) == 0x55 && (d[p + 1] & 0xff) == 0x8B && (d[p + 2] & 0xff) == 0xEC)
                        || ((d[p] & 0xff) == 0xC8 && d[p + 3] == 0x00 && (d[p + 1] & 0xff) < 0x40 && d[p + 2] == 0x00);
                if (!pro) continue;
                Address a = b.getStart().add(p);
                if (currentProgram.getListing().getInstructionContaining(a) != null) continue;
                seeds.add(a);
            }
        }
    }
}
