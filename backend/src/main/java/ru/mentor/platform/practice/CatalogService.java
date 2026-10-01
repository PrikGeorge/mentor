package ru.mentor.platform.practice;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import ru.mentor.platform.shared.*;
import ru.mentor.platform.lessons.LessonRef;
import ru.mentor.platform.workspaces.WorkspaceAccess;
import tools.jackson.databind.JsonNode;
import java.nio.file.Path;
import java.util.*;
import java.time.Clock;
import org.springframework.core.env.Environment;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import ru.mentor.platform.workspaces.WorkspaceService;

@Service
public class CatalogService {
    public record CatalogReport(String workspaceId,int published,List<String> errors){}
    private final PracticeRepository repository;private final WorkspaceAccess access;private final PracticeAuthority authority;private final WorkspaceService workspaces;private final Environment configuration;private final Clock clock;private final TransactionTemplate transaction;
    public CatalogService(PracticeRepository repository,WorkspaceAccess access,PracticeAuthority authority,WorkspaceService workspaces,Environment configuration,Clock clock,PlatformTransactionManager manager){this.repository=repository;this.access=access;this.authority=authority;this.workspaces=workspaces;this.configuration=configuration;this.clock=clock;this.transaction=new TransactionTemplate(manager);}
    public Page<JsonNode> list(Actor actor,String workspace,int page,int size,String audience){new Page<>(List.of(),page,size,0);PracticeAuthority.audience(audience);var m=access.requireMember(actor,workspace);String own=actor.role()==Actor.Role.STUDENT?m.studentId():null;return new Page<>(repository.catalog(workspace,own,page,size),page,size,repository.catalogCount(workspace,own));}
    public CatalogReport publish(Path source,String workspaceId){String manifest=configuration.getProperty("mentor.practice.environment-manifest");if(manifest==null||manifest.isBlank())return rejected(workspaceId);return publish(source,workspaceId,Path.of(manifest),configuration.getProperty("mentor.practice.environment-manifest-sha256"),configuration.getProperty("mentor.practice.environment-profiles-sha256"));}
    CatalogReport publish(Path source,String workspaceId,Path manifest,String manifestHash,String profilesHash){
        final List<CatalogSource.Entry> entries;try{entries=new CatalogSource().load(source,manifest,manifestHash,profilesHash);}catch(Exception invalid){return rejected(workspaceId);}
        return transaction.execute(status->{
            workspaces.lockActive(workspaceId);var sorted=entries.stream().sorted(Comparator.comparing(e->e.exercise().exerciseId())).toList();
            for(var e:sorted){repository.current(workspaceId,e.exercise().exerciseId(),true);var prior=repository.snapshotHash(workspaceId,e.exercise().exerciseId(),e.exercise().revision().key());if(prior.isPresent()&&!prior.get().equals(e.hash()))return new CatalogReport(workspaceId,0,List.of("Immutable exercise revision changed: "+e.exercise().exerciseId()));}
            int published=0;for(var e:sorted)if(repository.snapshotHash(workspaceId,e.exercise().exerciseId(),e.exercise().revision().key()).isEmpty()){repository.publish(workspaceId,e.exercise(),e.hash(),clock.instant());published++;}
            return new CatalogReport(workspaceId,published,List.of());
        });
    }
    private static CatalogReport rejected(String workspace){return new CatalogReport(workspace,0,List.of("Trusted catalog or environment approval is invalid."));}
    @Transactional(propagation=Propagation.MANDATORY) public PublishedExercise requireCurrent(Actor actor,LessonRef lesson,String exerciseId,ExerciseRevision expectedRevision){authority.lock(actor,lesson);var e=repository.current(lesson.workspaceId(),exerciseId,true).orElseThrow(WorkspaceAccess::missing);if(!e.revision().equals(expectedRevision))throw AssignmentService.exerciseConflict();return e;}
}
