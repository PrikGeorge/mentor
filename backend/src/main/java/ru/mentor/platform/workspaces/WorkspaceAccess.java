package ru.mentor.platform.workspaces;

import org.springframework.stereotype.Component;
import ru.mentor.platform.shared.*;
import java.util.Objects;

@Component
public class WorkspaceAccess {
    private final WorkspaceRepository workspaces;
    public WorkspaceAccess(WorkspaceRepository workspaces){this.workspaces=workspaces;}
    public WorkspaceRepository.Membership requireMember(Actor actor,String workspaceId){
        if(actor==null || actor.role()==Actor.Role.ADMIN || !Objects.equals(actor.workspaceId(),workspaceId))throw missing();
        var membership=workspaces.active(actor.userId()).orElseThrow(WorkspaceAccess::missing);
        if(!membership.actor().equals(actor))throw missing();return membership;
    }
    public void requireTeacher(Actor actor,String workspaceId){
        requireMember(actor,workspaceId);if(actor.role()!=Actor.Role.TEACHER)throw missing();
    }
    public void lockTeacher(Actor actor,String workspaceId){
        if(!workspaces.lockActive(workspaceId))throw missing();requireTeacher(actor,workspaceId);
    }
    public static ApiFailure missing(){return new ApiFailure(404,"NOT_FOUND","Resource unavailable.");}
}
