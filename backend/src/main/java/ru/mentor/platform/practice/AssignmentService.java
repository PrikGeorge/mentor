package ru.mentor.platform.practice;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import ru.mentor.platform.lessons.LessonRef;
import ru.mentor.platform.shared.*;
import ru.mentor.platform.workspaces.WorkspaceAccess;
import java.util.*;

@Service
public class AssignmentService {
    public record AssignmentInput(String exerciseId,Placement placement){}
    public record DraftSummary(String exerciseId,ExerciseRevision exerciseRevision,long revision,java.time.Instant updatedAt,boolean outdated){}
    public record AssignedExercise(String assignmentId,Placement placement,tools.jackson.databind.JsonNode exercise,DraftSummary draft){}
    public record LessonPracticeView(long revision,List<AssignedExercise> exercises){}
    private final PracticeRepository repository;private final PracticeAuthority authority;
    public AssignmentService(PracticeRepository repository,PracticeAuthority authority){this.repository=repository;this.authority=authority;}
    // A fresh snapshot keeps assignment rows, catalog/drafts and the CAS counter consistent even inside a caller transaction.
    @Transactional(propagation=Propagation.REQUIRES_NEW,isolation=Isolation.REPEATABLE_READ,readOnly=true)
    public LessonPracticeView read(Actor actor,LessonRef lesson,String audience){return view(actor,lesson,audience);}
    private LessonPracticeView view(Actor actor,LessonRef lesson,String audience){
        authority.reader(actor,lesson);PracticeAuthority.audience(audience);var exercises=new ArrayList<AssignedExercise>();
        for(var a:repository.assignments(lesson)){var e=repository.current(lesson.workspaceId(),a.exerciseId(),false);if(e.isEmpty())continue;
            var current=e.get();var d=repository.draft(a,false).orElse(new Draft(a.exerciseId(),current.revision(),0,current.starterFiles(),null));
            exercises.add(new AssignedExercise(a.id(),a.placement(),current.publicProjection(),new DraftSummary(a.exerciseId(),d.exerciseRevision(),d.revision(),d.updatedAt(),!current.revision().equals(d.exerciseRevision()))));
        }return new LessonPracticeView(repository.setRevision(lesson,false),List.copyOf(exercises));
    }
    @Transactional public LessonPracticeView replace(Actor actor,LessonRef lesson,long revision,List<AssignmentInput> assignments){
        authority.teacher(actor,lesson);if(revision<0||assignments==null||assignments.size()>100)throw new IllegalArgumentException("Invalid assignments.");
        Set<String> ids=new TreeSet<>();for(var a:assignments){if(a==null||a.exerciseId()==null||a.placement()==null||!ids.add(a.exerciseId()))throw new IllegalArgumentException("Invalid assignments.");}
        for(var id:ids)repository.current(lesson.workspaceId(),id,true).orElseThrow(WorkspaceAccess::missing);
        if(repository.setRevision(lesson,true)!=revision)throw conflict();repository.deactivate(lesson);
        int position=0;for(var a:assignments)repository.activate(lesson,a.exerciseId(),a.placement(),position++);repository.bumpSet(lesson);return view(actor,lesson,null);
    }
    @Transactional(propagation=Propagation.MANDATORY) public AssignmentRef requireActive(Actor actor,LessonRef lesson,String exerciseId){
        authority.lock(actor,lesson);repository.current(lesson.workspaceId(),exerciseId,true).orElseThrow(WorkspaceAccess::missing);
        var a=repository.byExercise(lesson,exerciseId,true).orElseThrow(WorkspaceAccess::missing);if(!a.active())throw WorkspaceAccess.missing();return a;
    }
    public AssignmentRef requireHistoryReader(Actor actor,LessonRef lesson,String assignmentId){authority.reader(actor,lesson);return repository.byId(lesson,assignmentId).orElseThrow(WorkspaceAccess::missing);}
    public AssignmentRef requireHistoryByExercise(Actor actor,LessonRef lesson,String exerciseId){authority.reader(actor,lesson);return repository.byExercise(lesson,exerciseId,false).orElseThrow(WorkspaceAccess::missing);}
    static ApiFailure conflict(){return new ApiFailure(409,"REVISION_CONFLICT","Practice changed. Refresh before saving.");}
    static ApiFailure exerciseConflict(){return new ApiFailure(409,"EXERCISE_REVISION_CONFLICT","Exercise changed. Confirm the current revision.");}
}
