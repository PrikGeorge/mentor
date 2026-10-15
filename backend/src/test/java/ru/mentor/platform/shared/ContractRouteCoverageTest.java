package ru.mentor.platform.shared;

import org.junit.jupiter.api.Test;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import org.yaml.snakeyaml.LoaderOptions;
import org.yaml.snakeyaml.Yaml;
import ru.mentor.platform.support.IdentityHttpTest;
import java.nio.file.*;
import java.util.*;
import java.util.regex.Pattern;
import static org.junit.jupiter.api.Assertions.*;

/**
 * Every public HTTP route the server exposes must be described in contracts/openapi.yaml and vice versa. Path
 * variables are compared by position only, since the contract and the controllers name them differently.
 * The internal runner protocol lives in contracts/runner.openapi.yaml and health probes are operational, so both are excluded.
 */
class ContractRouteCoverageTest extends IdentityHttpTest {
    private static final Pattern VARIABLE=Pattern.compile("\\{[^/}]+\\}");
    @Test void everyControllerRouteIsInTheContractAndEveryContractRouteHasAController()throws Exception {
        Path contract=locate("contracts/openapi.yaml");
        LoaderOptions options=new LoaderOptions();options.setCodePointLimit(16*1024*1024);
        Map<String,Object> document;try(var input=Files.newInputStream(contract)){document=new Yaml(options).load(input);}
        @SuppressWarnings("unchecked") Map<String,Object> paths=(Map<String,Object>)document.get("paths");
        Set<String> declared=new TreeSet<>();
        for(var entry:paths.entrySet()){
            @SuppressWarnings("unchecked") Map<String,Object> operations=(Map<String,Object>)entry.getValue();
            for(String method:operations.keySet())if(Set.of("get","post","put","patch","delete","head","options").contains(method))declared.add(method.toUpperCase(Locale.ROOT)+" /api/v1"+normalize(entry.getKey()));
        }
        Set<String> served=new TreeSet<>();
        // Actuator registers its own controller mapping; only the MVC one carries the API controllers.
        var mapping=context.getBean("requestMappingHandlerMapping",RequestMappingHandlerMapping.class);
        for(var info:mapping.getHandlerMethods().keySet()){
            var patterns=info.getPathPatternsCondition();if(patterns==null)continue;
            Set<RequestMethod> methods=info.getMethodsCondition().getMethods();if(methods.isEmpty())methods=Set.of(RequestMethod.GET);
            for(var pattern:patterns.getPatternValues()){
                if(!pattern.startsWith("/api/v1/"))continue;
                for(var method:methods)served.add(method.name()+" "+normalize(pattern));
            }
        }
        Set<String> undocumented=new TreeSet<>(served);undocumented.removeAll(declared);
        Set<String> unserved=new TreeSet<>(declared);unserved.removeAll(served);
        assertTrue(undocumented.isEmpty(),"Routes served but absent from contracts/openapi.yaml:\n"+String.join("\n",undocumented));
        assertTrue(unserved.isEmpty(),"Routes in contracts/openapi.yaml without a controller:\n"+String.join("\n",unserved));
        assertTrue(served.size()>40,"Suspiciously few routes: "+served.size());
    }
    private static String normalize(String path){return VARIABLE.matcher(path).replaceAll("{}");}
    // Surefire runs from backend/, a direct JUnit launch may run from the repository root.
    private static Path locate(String relative){
        for(Path base:List.of(Paths.get(""),Paths.get(".."),Paths.get("../..")))if(Files.exists(base.resolve(relative)))return base.resolve(relative).toAbsolutePath().normalize();
        throw new IllegalStateException("Cannot find "+relative);
    }
}
