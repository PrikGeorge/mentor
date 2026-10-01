package ru.mentor.platform.migration;
import java.util.*;
public record ImportReport(String importId,String sourceDigest,Map<String,Long> counts,Map<String,String> checksums,List<String> warnings,List<String> errors,boolean completed) {
    public ImportReport {counts=Collections.unmodifiableMap(new TreeMap<>(counts));checksums=Collections.unmodifiableMap(new TreeMap<>(checksums));warnings=List.copyOf(warnings);errors=List.copyOf(errors);}
}
