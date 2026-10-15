package ru.mentor.platform.identity;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ru.mentor.platform.shared.*;
import ru.mentor.platform.students.*;
import ru.mentor.platform.workspaces.*;

import java.time.Clock;

@Service
public class AccountAccessService {
    private final IdentityRepository identities;
    private final WorkspaceService workspaces;
    private final StudentService students;
    private final PasswordCodec passwords;
    private final TokenRepository tokens;
    private final Clock clock;

    public AccountAccessService(
            IdentityRepository identities,
            WorkspaceService workspaces,
            StudentService students,
            PasswordCodec passwords,
            TokenRepository tokens,
            Clock clock) {
        this.identities = identities;
        this.workspaces = workspaces;
        this.students = students;
        this.passwords = passwords;
        this.tokens = tokens;
        this.clock = clock;
    }

    public void requireAdmin(Actor actor) {
        if (actor == null
                || actor.role() != Actor.Role.ADMIN
                || !identities
                        .findById(actor.userId())
                        .flatMap(workspaces::resolve)
                        .filter(actor::equals)
                        .isPresent()) throw WorkspaceAccess.missing();
    }

    public void verifyIssuer(Actor actor, String password) {
        var account = identities.lock(actor.userId());
        if (!workspaces.resolve(account).filter(actor::equals).isPresent())
            throw ApiFailure.unauthorized();
        if (!passwords.matches(password, account.passwordHash()))
            throw new ApiFailure(401, "INVALID_CREDENTIALS", "Invalid login or password.");
    }

    public Page<IdentityRepository.TeacherView> teachers(Actor actor, int page, int size) {
        requireAdmin(actor);
        return identities.teachers(page, size);
    }

    public IdentityRepository.Account teacherTarget(Actor actor, String id) {
        requireAdmin(actor);
        var target = identities.findById(id).orElseThrow(WorkspaceAccess::missing);
        if (target.role() != Actor.Role.TEACHER || workspaces.workspaceFor(id) == null)
            throw WorkspaceAccess.missing();
        return target;
    }

    @Transactional
    public void changeTeacherAccess(Actor actor, String id, boolean disabled) {
        teacherTarget(actor, id);
        identities.lock(id);
        identities.disable(id, disabled);
        tokens.audit(
                actor.userId(),
                disabled ? "account-paused" : "account-resumed",
                id,
                workspaces.workspaceFor(id),
                clock.instant());
    }

    @Transactional
    public void changeWorkspaceAccess(Actor actor, String id, boolean disabled) {
        requireAdmin(actor);
        workspaces.changeAccess(id, disabled);
        tokens.audit(
                actor.userId(),
                disabled ? "workspace-paused" : "workspace-resumed",
                id,
                id,
                clock.instant());
    }

    public record StudentAccountView(String userId, String login, boolean disabled) {}

    public record StudentAccessView(
            StudentAccountView account, TokenRepository.InvitationView invitation) {}

    @Transactional
    public StudentAccessView studentAccess(Actor actor, String w, String id) {
        var card = students.lockTeacherCard(actor, w, id);
        var account =
                card.userId() == null
                        ? null
                        : identities.findById(card.userId()).orElseThrow(WorkspaceAccess::missing);
        return new StudentAccessView(
                account == null
                        ? null
                        : new StudentAccountView(account.id(), account.login(), account.disabled()),
                tokens.latest(w, id, clock.instant()));
    }

    public String studentTarget(Actor actor, String w, String id) {
        var card = students.lockTeacherCard(actor, w, id);
        if (card.userId() == null)
            throw new ApiFailure(409, "ACCOUNT_REQUIRED", "Profile has no account.");
        return card.userId();
    }

    @Transactional
    public void changeStudentAccess(Actor actor, String w, String id, boolean disabled) {
        String user = studentTarget(actor, w, id);
        identities.lock(user);
        identities.disable(user, disabled);
        tokens.audit(
                actor.userId(),
                disabled ? "account-paused" : "account-resumed",
                user,
                w,
                clock.instant());
    }
}
