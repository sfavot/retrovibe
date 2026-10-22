// Post-script : points d'entrée des mini-jeux (scènes 22 à 51), lus dans le dispatcher du plateau.
//
// Constat (voir docs/teleportaschtroumpf/re-index.md) : la fonction 1a3c:002a choisit le mini-jeu et
// stocke le numéro de scène dans une globale (0x16 = 22 ... 0x33 = 51), puis exécute
//   CMP numéro-0x16, 0x1d ; JA ... ; SHL BX,1 ; JMP word ptr CS:[BX + 0x1c7]
// La table CS:1a3c:01c7 (30 mots) donne, pour chaque scène, l'adresse d'un petit bloc dont le premier
// CALLF appelle la fonction principale du mini-jeu. Ce script lit la table et écrit
// scene_entries.tsv : numéro de scène, adresse du bloc, fonction appelée, taille de la fonction.
// Les constantes (dispatcher, table, base) sont celles du constat ; si la table n'est pas trouvée le
// script le signale et n'écrit rien.
//@category Teleportaschtroumpf.RE

import java.io.File;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.SegmentedAddressSpace;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.symbol.Reference;

public class ExportSceneEntries extends GhidraScript {
    private static final String DISPATCHER = "1a3c:002a";
    private static final int TABLE_OFFSET = 0x1c7;
    private static final int FIRST_SCENE = 0x16;
    private static final int COUNT = 0x1e;

    @Override
    protected void run() throws Exception {
        Function disp = getFunctionAt(toAddr(DISPATCHER));
        if (disp == null) {
            println("[re] dispatcher " + DISPATCHER + " introuvable : scene_entries.tsv non écrit");
            return;
        }
        SegmentedAddressSpace sp = ReCommon.space(currentProgram);
        int seg = ReCommon.segmentOf(currentProgram, disp.getEntryPoint());
        StringBuilder tsv = new StringBuilder("# scene\tbloc\tfonction_appelee\ttaille\n");
        int n = 0;
        for (int k = 0; k < COUNT; k++) {
            Address cell = sp.getAddress(seg, TABLE_OFFSET + 2 * k);
            int off = (currentProgram.getMemory().getByte(cell) & 0xff) | ((currentProgram.getMemory().getByte(cell.add(1)) & 0xff) << 8);
            Address blk = sp.getAddress(seg, off);
            Function callee = null;
            Instruction ins = getInstructionAt(blk);
            for (int i = 0; i < 6 && ins != null && callee == null; i++, ins = ins.getNext()) {
                for (Reference r : ins.getReferencesFrom()) {
                    if (r.getReferenceType().isCall()) {
                        callee = getFunctionAt(r.getToAddress());
                        break;
                    }
                }
            }
            tsv.append(FIRST_SCENE + k).append('\t').append(ReCommon.addr(currentProgram, blk)).append('\t')
               .append(callee == null ? "-" : ReCommon.addr(currentProgram, callee.getEntryPoint())).append('\t')
               .append(callee == null ? 0 : callee.getBody().getNumAddresses()).append('\n');
            if (callee != null) n++;
        }
        ReCommon.write(new File(ReCommon.outDir(), "scene_entries.tsv"), tsv.toString());
        println("[re] points d'entrée de scènes lus : " + n + " / " + COUNT);
    }
}
