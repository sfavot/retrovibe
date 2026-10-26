// Post-script : nomme les entrées de la table d'adresses d'imports (IAT) de SWIV_WIN.EXE.
//
// Le PeLoader de Ghidra ne résout pas les imports de ce PE (sections de taille virtuelle nulle : « Invalid file
// index ... ImportDataDirectory »). On lit donc nous-mêmes le répertoire d'imports (en-têtes PE déjà chargés),
// on pose un pointeur nommé « <fonction> » sur chaque case de l'IAT, et on ajoute une référence de donnée depuis
// chaque instruction qui désigne la case (les appels sont des « CALL dword ptr CS:[IAT] », que l'analyse ignore).
// Sortie : imports.tsv (case IAT, DLL, fonction, appelants) lu par make_index.py.
//@category SWIV3D.RE

import java.io.File;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeSet;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.PointerDataType;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.symbol.SourceType;

public class NamePeImports extends GhidraScript {
    private Memory mem;
    private long base;

    private int u32(long rva) throws Exception { return mem.getInt(toAddr(base + rva)); }

    private String cstr(long rva) throws Exception {
        StringBuilder sb = new StringBuilder();
        for (long a = base + rva;; a++) {
            int c = mem.getByte(toAddr(a)) & 0xff;
            if (c == 0) break;
            sb.append((char) c);
        }
        return sb.toString();
    }

    @Override
    protected void run() throws Exception {
        mem = currentProgram.getMemory();
        base = currentProgram.getImageBase().getOffset();
        long pe = u32(0x3c) & 0xffffffffL;
        long impRva = u32(pe + 24 + 96 + 8) & 0xffffffffL; // répertoire de données n°1 (imports)
        Map<Long, String[]> slots = new LinkedHashMap<>(); // adresse de la case -> {dll, fonction}
        for (long d = impRva;; d += 20) {
            long oft = u32(d) & 0xffffffffL, nameRva = u32(d + 12) & 0xffffffffL, ft = u32(d + 16) & 0xffffffffL;
            if (nameRva == 0) break;
            String dll = cstr(nameRva);
            long src = oft != 0 ? oft : ft;
            for (int i = 0;; i++) {
                long th = u32(src + 4L * i) & 0xffffffffL;
                if (th == 0) break;
                String fn = (th & 0x80000000L) != 0 ? "ord" + (th & 0xffff) : cstr(th + 2);
                slots.put(base + ft + 4L * i, new String[] { dll, fn });
            }
        }
        println("[re] imports lus : " + slots.size());
        for (Map.Entry<Long, String[]> e : slots.entrySet()) {
            Address a = toAddr(e.getKey());
            clearListing(a, a.add(3));
            createData(a, PointerDataType.dataType);
            createLabel(a, e.getValue()[1], true, SourceType.USER_DEFINED);
        }
        Map<Long, TreeSet<String>> callers = new LinkedHashMap<>();
        for (Instruction ins : currentProgram.getListing().getInstructions(true)) {
            for (int op = 0; op < ins.getNumOperands(); op++) {
                for (Object o : ins.getOpObjects(op)) {
                    long v;
                    if (o instanceof Address) v = ((Address) o).getOffset();
                    else if (o instanceof ghidra.program.model.scalar.Scalar) v = ((ghidra.program.model.scalar.Scalar) o).getUnsignedValue() & 0xffffffffL;
                    else continue;
                    if (!slots.containsKey(v)) continue;
                    ins.addOperandReference(op, toAddr(v), RefType.READ, SourceType.USER_DEFINED);
                    Function f = currentProgram.getFunctionManager().getFunctionContaining(ins.getAddress());
                    callers.computeIfAbsent(v, k -> new TreeSet<>()).add(f == null ? "-" : ReCommon.addr(currentProgram, f.getEntryPoint()));
                }
            }
        }
        // Petites fonctions « JMP dword ptr [IAT] » (stubs d'import de Watcom) : nommées imp_<fonction>.
        int thunks = 0;
        java.util.Set<String> used = new java.util.HashSet<>();
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            if (f.getBody().getNumAddresses() != 6) continue;
            Instruction ins = getInstructionAt(f.getEntryPoint());
            if (ins == null || !ins.getMnemonicString().equals("JMP")) continue;
            for (Object o : ins.getOpObjects(0)) {
                long v = o instanceof Address ? ((Address) o).getOffset()
                        : o instanceof ghidra.program.model.scalar.Scalar ? ((ghidra.program.model.scalar.Scalar) o).getUnsignedValue() & 0xffffffffL : -1;
                String[] imp = slots.get(v);
                if (imp == null) continue;
                String name = "imp_" + imp[1];
                for (int k = 2; !used.add(name); k++) name = "imp_" + imp[1] + "_" + k;
                f.setName(name, SourceType.USER_DEFINED);
                thunks++;
            }
        }
        println("[re] stubs d'import nommés : " + thunks);
        StringBuilder tsv = new StringBuilder("# case_iat\tdll\tfonction\tfonctions_appelantes\n");
        for (Map.Entry<Long, String[]> e : slots.entrySet()) {
            TreeSet<String> c = callers.get(e.getKey());
            tsv.append(String.format("%08x", e.getKey())).append('\t').append(e.getValue()[0]).append('\t').append(e.getValue()[1]).append('\t')
               .append(c == null ? "" : String.join(",", c)).append('\n');
        }
        ReCommon.write(new File(ReCommon.outDir(), "imports.tsv"), tsv.toString());
    }
}
