// Post-script : amorce les fonctions que l'auto-analyse du loader NE ne crée pas.
// Le code de MATH est appelé en grande partie par des pointeurs lointains rangés dans le segment de
// données (table des scènes, descripteurs, tables de rappels) : sans appel direct, Ghidra ne crée pas
// de fonction (treize fonctions de scène manquaient, voir docs/mathemagique/engine.md §1.4).
//
// Le loader NE applique les relocations lors de l'import : la mémoire contient déjà les paires
// (offset, sélecteur) résolues (ex. 1108:1b22 contient 0c0e 1108 ...). Aucune lecture de la table de
// relocation n'est nécessaire pour LIRE les pointeurs ; elle sert à CERTIFIER qu'un mot de données est
// bien un sélecteur (une relocation 16 bits de type segment/pointeur lointain y est posée).
// Sources d'amorces :
//  1. la table des scènes de MATH (11 pointeurs vers des descripteurs de 5 pointeurs lointains
//     Enter/Leave/Tick/Exit/Key), nommée ci-dessous ;
//  2. tous les couples (offset, sélecteur de code) des blocs de données dont le mot sélecteur porte une
//     relocation : pointeurs de fonction lointains et vtables lointaines.
// Une cible n'est retenue que si elle est dans un bloc de code, hors d'une instruction ou d'une fonction
// existante (sauf si c'est déjà son début) et si le désassemblage y réussit. Puis ré-analyse.
//@category Mathemagique.RE

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.SegmentedAddressSpace;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.SourceType;

public class SeedFunctions extends GhidraScript {
    // Table des scènes de MATH (docs/mathemagique/engine.md §1.4) : segment de données 1108, offset 1b22.
    private static final int SCENE_TABLE_SEG = 0x1108, SCENE_TABLE_OFF = 0x1b22, SCENE_COUNT = 11;
    private static final String[] SCENES = { "hub", "bowling", "rhythm", "patwin", "hidden", "patterns",
            "sticklers", "rockets", "title", "credits", "trophy" };
    private static final String[] HANDLERS = { "enter", "leave", "tick", "exit", "key" }; // champs +0x00,+0x04,+0x08,+0x0c,+0x10

    private Memory mem;
    private Listing listing;
    private SegmentedAddressSpace sp;
    private final TreeSet<Integer> codeSegs = new TreeSet<>();
    private final Map<String, Integer> skipped = new TreeMap<>();
    private int created;
    private final java.util.Set<Address> existingSet = new java.util.TreeSet<>();
    private final java.util.Set<String> skippedAt = new java.util.LinkedHashSet<>();

    @Override
    protected void run() throws Exception {
        mem = currentProgram.getMemory();
        listing = currentProgram.getListing();
        sp = (SegmentedAddressSpace) currentProgram.getAddressFactory().getDefaultAddressSpace();
        for (MemoryBlock b : mem.getBlocks()) {
            if (b.isExecute() && b.isInitialized()) codeSegs.add(ReCommon.selector(b));
        }
        long before = currentProgram.getFunctionManager().getFunctionCount();

        // 1. table des scènes
        Map<Address, String> names = new LinkedHashMap<>();
        boolean isMath = "MATH".equals(System.getenv("RE_PROG")) || currentProgram.getName().startsWith("MATH");
        int sceneSeeds = 0;
        if (isMath) {
            for (int i = 0; i < SCENE_COUNT; i++) {
                Address cell = sp.getAddress(SCENE_TABLE_SEG, SCENE_TABLE_OFF + 4 * i);
                Address desc = farData(cell);
                if (desc == null) { skip("scène " + i + " : descripteur illisible"); continue; }
                for (int h = 0; h < HANDLERS.length; h++) {
                    Address fn = farCode(desc.add(4L * h));
                    if (fn == null) continue; // handler nul (Exit/Key absents de certaines scènes)
                    if (seed(fn, true)) sceneSeeds++;
                    names.put(fn, "scene_" + SCENES[i] + "_" + HANDLERS[h]);
                }
            }
        }
        println("scènes : " + sceneSeeds + " fonctions créées via la table, " + names.size() + " handlers lus");

        // 2. pointeurs lointains des blocs de données
        List<Address> candidates = new ArrayList<>();
        for (MemoryBlock b : ReCommon.dataBlocks(currentProgram)) {
            long n = b.getSize();
            for (long p = 0; p + 3 < n; p++) {
                Address cell = b.getStart().add(p);
                int sel = u16(cell.add(2));
                if (!codeSegs.contains(sel)) continue;
                // une relocation « pointeur lointain » (type 3) est posée sur le mot offset et couvre les 4 octets
                if (currentProgram.getRelocationTable().getRelocations(cell).isEmpty()
                        && currentProgram.getRelocationTable().getRelocations(cell.add(2)).isEmpty()) continue;
                Address t = farCode(cell);
                if (t != null) candidates.add(t);
            }
        }
        int ptrSeeds = 0;
        for (Address t : candidates) if (seed(t, false)) ptrSeeds++;
        println("pointeurs lointains en données : " + candidates.size() + " candidats, " + ptrSeeds + " fonctions créées");

        analyzeAll(currentProgram);
        // les fonctions nouvelles ont pu en révéler d'autres (appels directs) : un second passage
        int ptrSeeds2 = 0;
        for (Address t : candidates) if (seed(t, false)) ptrSeeds2++;
        if (ptrSeeds2 > 0) analyzeAll(currentProgram);

        // nommage des handlers de scène
        int named = 0;
        for (Map.Entry<Address, String> e : names.entrySet()) {
            Function f = getFunctionAt(e.getKey());
            if (f == null) { skip("handler sans fonction : " + e.getValue()); continue; }
            if (f.getName().equals(e.getValue())) continue;
            // un même handler partagé par deux scènes garde son premier nom
            if (f.getName().startsWith("scene_")) continue;
            f.setName(e.getValue(), SourceType.USER_DEFINED);
            named++;
        }

        long after = currentProgram.getFunctionManager().getFunctionCount();
        println("[re] SeedFunctions : fonctions avant=" + before + " après=" + after + " créées=" + created
                + " (scène=" + sceneSeeds + ", pointeurs=" + (ptrSeeds + ptrSeeds2) + ") déjà présentes=" + existingSet.size()
                + " handlers nommés=" + named);
        // résumé lu par make_index.py : clé<TAB>valeur
        ReCommon.write(new java.io.File(ReCommon.outDir(currentProgram), "seed.tsv"),
                "avant\t" + before + "\napres\t" + after + "\nscene\t" + sceneSeeds + "\nscene_handlers\t" + names.size()
                + "\npointeurs\t" + (ptrSeeds + ptrSeeds2) + "\ncandidats\t" + candidates.size() + "\nnommes\t" + named
                + "\nignorees\t" + skippedAt.size() + "\n");
        for (String l : skippedAt) println("[re]   cible ignorée : " + l);
        for (Map.Entry<String, Integer> e : skipped.entrySet()) println("[re] ignorées : " + e.getValue() + " x " + e.getKey());
    }

    private int u16(Address a) throws Exception {
        return (mem.getByte(a) & 0xff) | ((mem.getByte(a.add(1)) & 0xff) << 8);
    }

    private void skip(String why) { skipped.merge(why, 1, Integer::sum); }

    private void skipAt(Address a, String why) {
        if (skippedAt.add(ReCommon.addr(a) + " (" + why + ")")) skip(why); // une cible pointée plusieurs fois compte une fois
    }

    /** Pointeur lointain (offset, sélecteur) vers un bloc de données ; null si nul ou invalide. */
    private Address farData(Address cell) throws Exception {
        int off = u16(cell), sel = u16(cell.add(2));
        if (off == 0 && sel == 0) return null;
        try {
            Address t = sp.getAddress(sel, off);
            MemoryBlock b = mem.getBlock(t);
            return b != null && !b.isExecute() ? t : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Pointeur lointain (offset, sélecteur) vers un bloc de code ; null si nul ou hors code. */
    private Address farCode(Address cell) throws Exception {
        int off = u16(cell), sel = u16(cell.add(2));
        if (sel == 0 || !codeSegs.contains(sel)) return null;
        try {
            Address t = sp.getAddress(sel, off);
            MemoryBlock b = mem.getBlock(t);
            return b != null && b.isExecute() && b.isInitialized() ? t : null;
        } catch (Exception e) {
            return null;
        }
    }

    /** Crée une fonction en a si la cible est valide. Renvoie vrai si une fonction a été créée. */
    private boolean seed(Address a, boolean scene) throws Exception {
        if (getFunctionAt(a) != null) { existingSet.add(a); return false; }
        Function in = currentProgram.getFunctionManager().getFunctionContaining(a);
        if (in != null) { skipAt(a, "au milieu d'une fonction existante"); return false; }
        Instruction ci = listing.getInstructionContaining(a);
        if (ci != null && !ci.getAddress().equals(a)) { skipAt(a, "au milieu d'une instruction"); return false; }
        if (listing.getInstructionAt(a) == null && !disassemble(a)) { skipAt(a, "désassemblage impossible"); return false; }
        Instruction first = listing.getInstructionAt(a);
        if (first == null) { skipAt(a, "désassemblage impossible"); return false; }
        if (!scene && !plausibleStart(first)) { skipAt(a, "début peu plausible (octets nuls, ret, jmp ou instruction invalide)"); return false; }
        if (createFunction(a, null) == null) { skipAt(a, "createFunction a échoué"); return false; }
        created++;
        return true;
    }

    /** Début de fonction plausible : pas d'octets nuls (ADD [BX+SI],AL), pas un RET immédiat, 6 premières instructions valides. */
    private boolean plausibleStart(Instruction i) throws Exception {
        if ((mem.getByte(i.getAddress()) & 0xff) == 0 && (mem.getByte(i.getAddress().add(1)) & 0xff) == 0) return false;
        Instruction x = i;
        for (int k = 0; k < 6 && x != null; k++) {
            if (x.getMnemonicString().startsWith("?")) return false;
            x = x.getNext();
        }
        return !i.getMnemonicString().startsWith("RET");
    }
}
