package ru.mentor.runner;

import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.util.Map;

/** Runs the production staging code on a native Linux Docker volume, even from a Windows test host. */
public final class SourceStagingProbe {
    public static void main(String[] args) throws Exception {
        var staged=SourceStaging.create(Map.of(
            "demo/nested/Task.java", "package demo.nested; public class Task { public static void main(String[] args) { System.out.print(Helper.value()); } }",
            "demo/nested/Helper.java", "package demo.nested; class Helper { static String value() { return \"nested-ok\"; } }"));
        Path input=staged.input(), parent=input.getParent();
        if(!Files.getPosixFilePermissions(parent).equals(PosixFilePermissions.fromString("rwx------")))
            throw new AssertionError("The host staging parent must remain owner-private");
        if(((Number)Files.getAttribute(parent,"unix:uid")).intValue()==10001)
            throw new AssertionError("The probe must stage as a different UID from the sandbox");
        if(args.length>0 && args[0].equals("cleanup")) {
            staged.close();
            if(Files.exists(parent)) throw new AssertionError("Staging cleanup left source files behind");
            System.out.print("cleaned");
        } else {
            // The test owns this temporary volume and removes it after its access checks.
            System.out.print(parent.getFileName());
        }
    }
}
