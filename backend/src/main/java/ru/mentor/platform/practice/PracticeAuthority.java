package ru.mentor.platform.practice;
import org.springframework.stereotype.Component;
import ru.mentor.platform.lessons.*;
import ru.mentor.platform.students.StudentService;
import ru.mentor.platform.workspaces.WorkspaceAccess;
import ru.mentor.platform.shared.*;
@Component
public class PracticeAuthority {
    private final WorkspaceAccess access;private final StudentService students;private final LessonService lessons;
    public PracticeAuthority(WorkspaceAccess access,StudentService students,LessonService lessons){this.access=access;this.students=students;this.lessons=lessons;}
    public void reader(Actor actor,LessonRef l){lessons.requireReader(actor,l.workspaceId(),l.studentId(),l.id());}
    /** Caller transaction: workspace -> card -> current authority -> practice rows. */
    public void lock(Actor actor,LessonRef l){access.lockMember(actor,l.workspaceId());students.lockCard(l.workspaceId(),l.studentId());reader(actor,l);}
    public void student(Actor actor,LessonRef l){lock(actor,l);if(actor.role()!=Actor.Role.STUDENT)throw new ApiFailure(403,"FORBIDDEN","Only the student can save code.");}
    public void teacher(Actor actor,LessonRef l){lock(actor,l);access.requireTeacher(actor,l.workspaceId());}
    public static void audience(String audience){if(audience!=null&&!audience.equals("student"))throw new IllegalArgumentException("Invalid audience.");}
}
