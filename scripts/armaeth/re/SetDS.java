// Pré-script : fixe le registre DS à DGROUP sur toute la mémoire, avant l'auto-analyse.
// Le startup Microsoft C charge DS avec DGROUP (« MOV DI,seg DGROUP ... MOV DS,DI ») et ne le change plus
// (modèle moyen/large : les accès aux données passent par DS:offset). DGROUP est fourni par run.sh
// (RE_DGROUP, lu dans le startup de l'EXE). Sans DS, Ghidra ne résout pas les références aux données.
// Désactive aussi l'analyseur « Non-Returning Functions - Discovered » : sur ce code il marque à tort
// comme « sans retour » des fonctions utilitaires, ce qui coupe le désassemblage de l'appelant.
// Désactive « Decompiler Switch Analysis » : il lit les tables de switch (CS:[BX+table]) avec le mauvais
// segment et crée des références de saut vers n'importe où ; SeedFunctions les traite lui-même.
// Désactive « x86 Constant Reference Analyzer » : il prend des constantes pour des adresses (segments
// et offsets mélangés), pose des références fausses et des « données » dans le code.
//@category Armaeth.RE

import java.math.BigInteger;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.ProgramContext;
import ghidra.program.model.mem.MemoryBlock;

public class SetDS extends GhidraScript {
    @Override
    protected void run() throws Exception {
        int dg = ReCommon.dgroupSegment(currentProgram);
        println("DGROUP = " + String.format("%04x", dg));
        setAnalysisOption(currentProgram, "Non-Returning Functions - Discovered", "false");
        setAnalysisOption(currentProgram, "Decompiler Switch Analysis", "false");
        setAnalysisOption(currentProgram, "x86 Constant Reference Analyzer", "false");
        ProgramContext ctx = currentProgram.getProgramContext();
        Register ds = ctx.getRegister("DS");
        for (MemoryBlock b : currentProgram.getMemory().getBlocks()) {
            if (b.getName().startsWith("HEADER")) continue;
            ctx.setValue(ds, b.getStart(), b.getEnd(), BigInteger.valueOf(dg));
        }
    }
}
