package ru.mentor.platform.practice;

import tools.jackson.databind.*;
import tools.jackson.databind.node.*;
import java.nio.file.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Operator-only parser. No class loading, dependency fetching, process execution or browser input. */
final class CatalogSource {
    private final ObjectMapper json=PracticeJson.MAPPER;
    private static final String IDENT="[A-Za-z_$][A-Za-z0-9_$]*";
    private static final Set<String> SIMPLE=Set.of("int","long","double","float","short","byte","boolean","char","java.lang.Integer","java.lang.Long","java.lang.Double","java.lang.Float","java.lang.Short","java.lang.Byte","java.lang.Boolean","java.lang.Character","java.lang.String","java.lang.Object");
    // Collection/map interfaces are supported by the harness's reflected generic conversion.
    private static final Set<String> COLLECTION=Set.of("java.util.List","java.util.Collection","java.util.Set","java.util.Map");
    record Entry(PublishedExercise exercise,String hash){}
    List<Entry> load(Path source,Path manifest,String manifestHash,String profilesHash)throws Exception {
        Path catalog=source.toAbsolutePath().normalize();Path root=catalog.getParent();if(root==null||Files.isSymbolicLink(root))throw invalid();
        byte[] sourceBytes=read(catalog,2097152),profilesBytes=read(root.resolve("environments.json"),262144),manifestBytes=read(manifest.toAbsolutePath().normalize(),262144);
        if(!hex(manifestHash)||!hex(profilesHash)||!sha(manifestBytes).equals(manifestHash)||!sha(profilesBytes).equals(profilesHash))throw invalid();
        JsonNode profiles=parse(profilesBytes),approved=parse(manifestBytes),records=parse(sourceBytes);
        if(!profiles.isArray()||profiles.isEmpty()||!records.isArray()||records.size()>1000)throw invalid();
        PracticeJson.fields(approved,Set.of("environments"),Set.of("environments"));JsonNode pins=approved.get("environments");if(!pins.isObject()||pins.isEmpty())throw invalid();
        // All entries are structurally checked, including ones not selected by this batch.
        for(var pin:pins.properties()){validatePin(pin.getKey(),pin.getValue());}
        Map<String,JsonNode> environments=new HashMap<>();for(var p:profiles){validateProfile(p);if(environments.put(text(p,"id"),p)!=null)throw invalid();JsonNode pin=pins.get(text(p,"id"));if(pin==null)throw invalid();pair(p,pin);}
        var result=new ArrayList<Entry>();Set<String> ids=new HashSet<>();
        for(var record:records){
            PracticeJson.fields(record,Set.of("id","revision","title","statement","environmentId","starterFiles","className","method","parameterTypes","customTypes","tests"),Set.of("id","revision","title","statement","environmentId","starterFiles","className","method","parameterTypes","tests"));
            String id=text(record,"id");if(!id.matches("[a-z0-9-]{1,100}")||!ids.add(id))throw invalid();
            var revision=ExerciseRevision.fromJson(record.get("revision"));String title=text(record,"title"),statement=text(record,"statement");if(title.isEmpty()||title.length()>200||statement.length()>200000)throw invalid();
            String environmentId=text(record,"environmentId");JsonNode profile=environments.get(environmentId);if(profile==null)throw invalid();
            JsonNode names=record.get("starterFiles");if(!names.isArray()||names.isEmpty()||names.size()>16)throw invalid();
            Map<String,String> files=new TreeMap<>();for(var name:names){String path=PracticeJson.text(name);if(!SourceFiles.javaPath(path)||files.containsKey(path))throw invalid();Path exerciseRoot=root.resolve("exercises").resolve(id);Path target=exerciseRoot.resolve(path).normalize();if(!target.startsWith(exerciseRoot))throw invalid();
                // Refuse every symlink component under the declared root, not merely the final file.
                Path check=root;for(Path part:root.relativize(target)){check=check.resolve(part);if(Files.isSymbolicLink(check))throw invalid();}
                files.put(path,decode(read(target,131072)));
            }declaredTree(root.resolve("exercises").resolve(id),files.keySet());SourceFiles.validate(files,files.keySet());validateExercise(record,files.keySet());
            var publicEnvironment=json.createObjectNode();publicEnvironment.put("id",environmentId);publicEnvironment.put("title",text(profile,"title"));publicEnvironment.put("javaVersion",21);var dependencies=publicEnvironment.putArray("dependencies");for(var d:profile.get("dependencies"))dependencies.add(text(d,"groupId")+":"+text(d,"artifactId")+":"+text(d,"version"));
            var publicExercise=json.createObjectNode();publicExercise.put("id",id);publicExercise.set("revision",revision.toJson());publicExercise.put("title",title);publicExercise.put("statement",statement);publicExercise.set("environment",publicEnvironment);publicExercise.set("starterFiles",json.valueToTree(files));
            var privateExercise=(ObjectNode)record.deepCopy();privateExercise.set("revision",revision.toJson());privateExercise.set("starterFiles",json.valueToTree(files));
            var provenance=json.createObjectNode();provenance.put("sourceSha256",sha(sourceBytes));provenance.put("environmentManifestSha256",manifestHash);provenance.put("environmentProfilesSha256",profilesHash);provenance.set("profile",profile.deepCopy());
            var snapshot=new PublishedExercise(id,revision,publicExercise,privateExercise,pins.get(environmentId),provenance);
            // Batch provenance may change when another exercise/profile is added. Identity uses this exact exercise/profile/pin only.
            result.add(new Entry(snapshot,sha(json.writeValueAsBytes(canonical(json.valueToTree(List.of(publicExercise,privateExercise,pins.get(environmentId),profile)))))));
        }return List.copyOf(result);
    }
    private void validateProfile(JsonNode p){
        PracticeJson.fields(p,Set.of("id","title","javaVersion","dockerImage","dependencies","annotationProcessors"),Set.of("id","title","javaVersion","dockerImage","dependencies","annotationProcessors"));
        if(!text(p,"id").matches("[a-z0-9-]{1,100}")||text(p,"title").isEmpty()||!p.get("javaVersion").isIntegralNumber()||p.get("javaVersion").asInt()!=21||!text(p,"dockerImage").matches("[A-Za-z0-9][A-Za-z0-9_./:@-]*"))throw invalid();
        var deps=p.get("dependencies");if(!deps.isArray()||deps.size()>32)throw invalid();Set<String> coords=new HashSet<>();for(var d:deps){PracticeJson.fields(d,Set.of("groupId","artifactId","version","sha256","transitive"),Set.of("groupId","artifactId","version","sha256"));for(String key:List.of("groupId","artifactId","version"))if(!text(d,key).matches("[A-Za-z0-9_.-]{1,200}"))throw invalid();if(!hex(text(d,"sha256"))||(d.has("transitive")&&!d.get("transitive").isBoolean())||!coords.add(text(d,"groupId")+":"+text(d,"artifactId")))throw invalid();}
        processors(p.get("annotationProcessors"));
    }
    private void validatePin(String id,JsonNode pin){PracticeJson.fields(pin,Set.of("id","revision","imageDigest","dependencies","annotationProcessors"),Set.of("id","revision","imageDigest","dependencies","annotationProcessors"));if(!id.matches("[a-z0-9-]{1,100}")||!id.equals(text(pin,"id"))||!hex(text(pin,"revision"))||!text(pin,"imageDigest").matches("sha256:[a-f0-9]{64}"))throw invalid();var deps=pin.get("dependencies");if(!deps.isArray()||deps.size()>32)throw invalid();for(int i=0;i<deps.size();i++)if(!PracticeJson.text(deps.get(i)).equals("/opt/mentor/deps/dependency-"+i+".jar"))throw invalid();processors(pin.get("annotationProcessors"));}
    private static void pair(JsonNode profile,JsonNode pin){if(profile.get("dependencies").size()!=pin.get("dependencies").size()||!profile.get("annotationProcessors").equals(pin.get("annotationProcessors")))throw invalid();}
    private static void processors(JsonNode node){if(!node.isArray()||node.size()>32)throw invalid();Set<String> values=new HashSet<>();for(var v:node){String s=PracticeJson.text(v);if(!s.matches(IDENT+"(?:\\."+IDENT+")*")||!values.add(s))throw invalid();}}
    private void validateExercise(JsonNode raw,Set<String> files){
        String target=text(raw,"className");if(!typeName(target)||!declared(target,files)||!text(raw,"method").matches(IDENT))throw invalid();
        JsonNode custom=raw.get("customTypes");if(custom==null)custom=json.createObjectNode();if(!custom.isObject()||custom.size()>32)throw invalid();
        Set<String> types=new HashSet<>(SIMPLE);types.addAll(COLLECTION);for(var c:custom.properties()){if(!typeName(c.getKey())||!declared(c.getKey(),files)||!c.getKey().contains("$"))throw invalid();types.add(c.getKey());}
        for(var c:custom.properties()){var v=c.getValue();PracticeJson.fields(v,Set.of("constructorTypes","fields"),Set.of("constructorTypes","fields"));if(!v.get("constructorTypes").isArray()||!v.get("fields").isArray()||v.get("constructorTypes").size()!=v.get("fields").size()||v.get("fields").size()>32)throw invalid();Set<String> fields=new HashSet<>();for(var f:v.get("fields"))if(!PracticeJson.text(f).matches(IDENT)||!fields.add(f.asText()))throw invalid();for(var t:v.get("constructorTypes"))if(!SIMPLE.contains(PracticeJson.text(t)))throw invalid();}
        var parameters=raw.get("parameterTypes");if(!parameters.isArray()||parameters.size()>16)throw invalid();for(var t:parameters)if(!types.contains(PracticeJson.text(t)))throw invalid();
        var tests=raw.get("tests");if(!tests.isArray()||tests.isEmpty()||tests.size()>100)throw invalid();boolean sample=false;Set<String> names=new HashSet<>();
        for(var t:tests){PracticeJson.fields(t,Set.of("name","sample","args","expected","unchangedArguments"),Set.of("name","args","expected"));String name=text(t,"name");if(name.isEmpty()||name.length()>200||!names.add(name)||!t.get("args").isArray()||t.get("args").size()!=parameters.size()||(t.has("sample")&&!t.get("sample").isBoolean()))throw invalid();sample|=t.path("sample").asBoolean();if(t.has("unchangedArguments")){var indices=t.get("unchangedArguments");if(!indices.isArray())throw invalid();Set<Integer> seen=new HashSet<>();for(var i:indices)if(!i.isIntegralNumber()||!i.canConvertToInt()||i.asInt()<0||i.asInt()>=parameters.size()||!seen.add(i.asInt()))throw invalid();}if(json.writeValueAsBytes(t).length>65536)throw invalid();bounded(t,0,new int[]{0});
        }if(!sample)throw invalid();
    }
    private static void bounded(JsonNode node,int depth,int[] count){if(depth>32||++count[0]>10000)throw invalid();if(node.isString()&&!SourceFiles.wellFormed(node.asText()))throw invalid();if(node.isContainer())for(var n:node)bounded(n,depth+1,count);}
    private static boolean declared(String name,Set<String> files){String outer=name.split("\\$",2)[0];return files.contains(outer.replace('.','/')+".java");}
    private static void declaredTree(Path root,Set<String> names)throws java.io.IOException {
        Set<Path> files=new HashSet<>(),directories=new HashSet<>();directories.add(root);
        for(String name:names){Path file=root.resolve(name);files.add(file);for(Path p=file.getParent();p!=null&&p.startsWith(root);p=p.getParent())directories.add(p);}
        try(var tree=Files.walk(root)){
            for(Path p:(Iterable<Path>)tree::iterator)if(Files.isSymbolicLink(p)||!(Files.isDirectory(p,LinkOption.NOFOLLOW_LINKS)?directories.contains(p):Files.isRegularFile(p,LinkOption.NOFOLLOW_LINKS)&&files.contains(p)))throw invalid();
        }
    }
    private static boolean typeName(String s){return s.matches(IDENT+"(?:\\."+IDENT+")*(?:\\$"+IDENT+")*");}
    private static String text(JsonNode n,String field){String s=PracticeJson.text(n.get(field));if(!SourceFiles.wellFormed(s))throw invalid();return s;}
    private JsonNode parse(byte[] bytes){String s=decode(bytes);if(s.startsWith("\uFEFF"))s=s.substring(1);return json.readTree(s);}
    private static String decode(byte[] bytes){try{return StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString();}catch(java.nio.charset.CharacterCodingException e){throw invalid();}}
    private static byte[] read(Path file,int cap)throws java.io.IOException {if(!Files.isRegularFile(file,LinkOption.NOFOLLOW_LINKS)||Files.size(file)>cap)throw invalid();try(var stream=Files.newInputStream(file)){byte[] bytes=stream.readNBytes(cap+1);if(bytes.length>cap)throw invalid();return bytes;}}
    static boolean hex(String s){return s!=null&&s.matches("[a-f0-9]{64}");}
    static String sha(byte[] bytes){try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));}catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}}
    private JsonNode canonical(JsonNode node){if(node.isObject()){var out=json.createObjectNode();new TreeSet<>(node.propertyNames()).forEach(k->out.set(k,canonical(node.get(k))));return out;}if(node.isArray()){var out=json.createArrayNode();for(var child:node)out.add(canonical(child));return out;}return node;}
    private static IllegalArgumentException invalid(){return new IllegalArgumentException("Invalid trusted catalog configuration.");}
}
