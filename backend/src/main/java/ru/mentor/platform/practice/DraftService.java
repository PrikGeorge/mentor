package ru.mentor.platform.practice;

import org.springframework.stereotype.Service;
import ru.mentor.platform.shared.*;
import ru.mentor.platform.lessons.LessonRef;
import java.util.Map;
import java.util.List;
import java.time.Clock;
import org.springframework.transaction.annotation.*;
import ru.mentor.platform.workspaces.WorkspaceAccess;

@Service
public class DraftService {
    private final PracticeRepository repository;private final PracticeAuthority authority;private final AssignmentService assignments;private final CatalogService catalog;private final Clock clock;
    public DraftService(PracticeRepository repository,PracticeAuthority authority,AssignmentService assignments,CatalogService catalog,Clock clock){this.repository=repository;this.authority=authority;this.assignments=assignments;this.catalog=catalog;this.clock=clock;}
    public Draft read(Actor actor,LessonRef lesson,String exerciseId,String audience){
        authority.reader(actor,lesson);PracticeAuthority.audience(audience);var a=repository.byExercise(lesson,exerciseId,false).orElseThrow(WorkspaceAccess::missing);var saved=repository.draft(a,false);if(saved.isPresent())return saved.get();if(!a.active())throw WorkspaceAccess.missing();var current=repository.current(lesson.workspaceId(),exerciseId,false).orElseThrow(WorkspaceAccess::missing);return new Draft(exerciseId,current.revision(),0,current.starterFiles(),null);
    }
    @Transactional public Draft save(Actor actor,LessonRef lesson,String exerciseId,ExerciseRevision exerciseRevision,Map<String,String> files,long revision,ExerciseRevision resetForRevision){
        authority.student(actor,lesson);var a=assignments.requireActive(actor,lesson,exerciseId);var current=catalog.requireCurrent(actor,lesson,exerciseId,exerciseRevision);
        if(revision<0)throw new IllegalArgumentException("Invalid revision.");if(resetForRevision!=null&&!current.revision().equals(resetForRevision))throw AssignmentService.exerciseConflict();
        var validated=SourceFiles.validate(files,current.starterFiles().keySet());var existing=repository.draft(a,true);
        if(existing.map(Draft::revision).orElse(0L)!=revision)throw AssignmentService.conflict();
        boolean changed=existing.isPresent()&&!existing.get().exerciseRevision().equals(current.revision());if(changed&&resetForRevision==null)throw AssignmentService.exerciseConflict();
        var now=clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS);if(changed)repository.archive(a,existing.get(),now);var draft=new Draft(exerciseId,current.revision(),Math.addExact(revision,1),validated,now);repository.save(a,draft);return draft;
    }
    public Page<Map<String,Object>> archives(Actor actor,LessonRef lesson,String exerciseId,int page,int size,String audience){authority.reader(actor,lesson);PracticeAuthority.audience(audience);new Page<>(List.of(),page,size,0);return new Page<>(repository.archives(lesson,exerciseId,page,size),page,size,repository.archiveCount(lesson,exerciseId));}
    public Map<String,Object> archive(Actor actor,LessonRef lesson,String id,String audience){authority.reader(actor,lesson);PracticeAuthority.audience(audience);return repository.archive(lesson,id).orElseThrow(WorkspaceAccess::missing);}
    @Transactional(propagation=Propagation.MANDATORY) public void requireRunnableDraft(Actor actor,LessonRef lesson,AssignmentRef assignment,ExerciseRevision revision){
        authority.student(actor,lesson);var active=assignments.requireActive(actor,lesson,assignment.exerciseId());if(!active.equals(assignment))throw WorkspaceAccess.missing();catalog.requireCurrent(actor,lesson,assignment.exerciseId(),revision);var draft=repository.draft(active,true);if(draft.isPresent()&&!draft.get().exerciseRevision().equals(revision))throw AssignmentService.exerciseConflict();
    }
}
