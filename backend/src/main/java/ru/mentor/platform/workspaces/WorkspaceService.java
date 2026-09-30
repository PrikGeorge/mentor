package ru.mentor.platform.workspaces;

import org.springframework.stereotype.Service;
import ru.mentor.platform.identity.IdentityRepository;
import ru.mentor.platform.shared.*;
import java.time.Instant;
import java.util.*;

@Service
public class WorkspaceService {
    private final WorkspaceRepository repository;
    public WorkspaceService(WorkspaceRepository repository){this.repository=repository;}
    public Optional<Actor> resolve(IdentityRepository.Account account){
        if(account.disabled())return Optional.empty();
        if(account.role()==Actor.Role.ADMIN)return Optional.of(account.actor());
        return repository.active(account.id()).map(WorkspaceRepository.Membership::actor).filter(a->a.authVersion()==account.authVersion());
    }
    public String createForTeacher(String user,Instant now){String id=UUID.randomUUID().toString();repository.create(id,user,now);return id;}
    public void bindStudent(String user,String workspace,String student){repository.addMembership(user,workspace,"STUDENT",student);}
    public void lockActive(String id){if(!repository.lockActive(id))throw WorkspaceAccess.missing();}
    public String workspaceFor(String user){return repository.workspaceFor(user);}
    public void changeAccess(String id,boolean disabled){
        if(!repository.exists(id))throw WorkspaceAccess.missing();
        // Lock even paused workspaces; resumption never implicitly enables accounts.
        repository.lockActive(id);repository.disable(id,disabled);repository.revokeWorkspaceSessions(id);
    }
}
