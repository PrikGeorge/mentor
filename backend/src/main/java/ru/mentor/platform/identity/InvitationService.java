package ru.mentor.platform.identity;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ru.mentor.platform.shared.*;
import ru.mentor.platform.students.StudentService;
import ru.mentor.platform.workspaces.*;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.*;
import java.util.*;

@Service
public class InvitationService {
    private final TokenRepository tokens;
    private final IdentityRepository identities;
    private final WorkspaceService workspaces;
    private final StudentService students;
    private final AccountAccessService access;
    private final PasswordCodec passwords;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    public InvitationService(
            TokenRepository tokens,
            IdentityRepository identities,
            WorkspaceService workspaces,
            StudentService students,
            AccountAccessService access,
            PasswordCodec passwords,
            Clock clock) {
        this.tokens = tokens;
        this.identities = identities;
        this.workspaces = workspaces;
        this.students = students;
        this.access = access;
        this.passwords = passwords;
        this.clock = clock;
    }

    public record InvitationIssue(String id, String link, Instant expiresAt) {}

    public record PasswordResetIssue(String link, Instant expiresAt) {}

    @Transactional
    public InvitationIssue issueTeacher(Actor actor, String origin) {
        access.requireAdmin(actor);
        return issue(actor, "TEACHER", null, null, origin);
    }

    @Transactional
    public InvitationIssue issueStudent(Actor actor, String w, String student, String origin) {
        var card = students.lockTeacherCard(actor, w, student);
        if (card.userId() != null)
            throw new ApiFailure(409, "ACCOUNT_EXISTS", "Profile already has an account.");
        tokens.replaceCardInvitations(w, student, clock.instant());
        return issue(actor, "STUDENT", w, student, origin);
    }

    private InvitationIssue issue(
            Actor actor, String kind, String w, String student, String origin) {
        String raw = secret(), id = UUID.randomUUID().toString();
        Instant now = issueTime(), expires = now.plus(Duration.ofHours(72));
        tokens.issueInvitation(id, hash(raw), kind, actor.userId(), w, student, now, expires);
        tokens.audit(actor.userId(), "invitation-issued", id, w, now);
        return new InvitationIssue(id, origin + "/register?token=" + raw, expires);
    }

    public Page<TokenRepository.InvitationView> listTeachers(Actor actor, int page, int size) {
        access.requireAdmin(actor);
        return tokens.teacherInvitations(page, size, clock.instant());
    }

    @Transactional
    public void revokeTeacher(Actor actor, String id) {
        access.requireAdmin(actor);
        revoke(actor, id, null, null);
    }

    @Transactional
    public void revokeStudent(Actor actor, String w, String student, String id) {
        students.lockTeacherCard(actor, w, student);
        revoke(actor, id, w, student);
    }

    private void revoke(Actor actor, String id, String w, String student) {
        if (!tokens.revokeInvitation(id, w, student, clock.instant())) throw invalid();
        tokens.audit(actor.userId(), "invitation-revoked", id, w, clock.instant());
    }

    @Transactional
    public Actor redeem(String token, String login, String password) {
        String normalized = AuthService.normalizeLogin(login);
        PasswordCodec.validate(password);
        String digest = hash(token);
        var initial = tokens.invitation(digest, false).orElseThrow(InvitationService::invalid);
        if (initial.workspace() != null) {
            workspaces.lockActive(initial.workspace());
            if (students.lockCard(initial.workspace(), initial.student()).userId() != null)
                throw invalid();
        }
        var grant = tokens.invitation(digest, true).orElseThrow(InvitationService::invalid);
        valid(grant.expires(), grant.used(), grant.revoked());
        String encoded = passwords.encode(password);
        valid(grant.expires(), grant.used(), grant.revoked());
        IdentityRepository.Account account;
        try {
            account = identities.create(normalized, encoded, Actor.Role.valueOf(grant.kind()));
        } catch (DuplicateKeyException e) {
            throw new ApiFailure(409, "LOGIN_EXISTS", "Login is unavailable.");
        }
        String workspace = grant.workspace();
        if (grant.kind().equals("TEACHER"))
            workspace = workspaces.createForTeacher(account.id(), clock.instant());
        else {
            students.bind(workspace, grant.student(), account.id());
            workspaces.bindStudent(account.id(), workspace, grant.student());
        }
        tokens.useInvitation(grant.id(), clock.instant());
        tokens.audit(account.id(), "invitation-redeemed", grant.id(), workspace, clock.instant());
        return new Actor(account.id(), workspace, account.role(), account.authVersion());
    }

    @Transactional
    public PasswordResetIssue issueTeacherReset(
            Actor actor, String teacher, String currentPassword, String origin) {
        var target = access.teacherTarget(actor, teacher);
        String w = workspaces.workspaceFor(target.id());
        workspaces.lockActive(w);
        access.verifyIssuer(actor, currentPassword);
        return issueReset(actor, target.id(), origin);
    }

    @Transactional
    public PasswordResetIssue issueStudentReset(
            Actor actor, String w, String student, String currentPassword, String origin) {
        String target = access.studentTarget(actor, w, student);
        access.verifyIssuer(actor, currentPassword);
        return issueReset(actor, target, origin);
    }

    private PasswordResetIssue issueReset(Actor actor, String target, String origin) {
        var account = identities.lock(target);
        String raw = secret();
        Instant now = issueTime(), expires = now.plus(Duration.ofMinutes(30));
        tokens.issueReset(
                UUID.randomUUID().toString(),
                hash(raw),
                actor.userId(),
                target,
                account.authVersion(),
                now,
                expires);
        tokens.audit(
                actor.userId(),
                "password-reset-issued",
                target,
                workspaces.workspaceFor(target),
                now);
        return new PasswordResetIssue(origin + "/reset-password?token=" + raw, expires);
    }

    @Transactional
    public void resetPassword(String token, String password) {
        PasswordCodec.validate(password);
        String digest = hash(token);
        var initial = tokens.reset(digest, false).orElseThrow(InvitationService::invalid);
        String w = workspaces.workspaceFor(initial.user());
        if (w == null) throw invalid();
        workspaces.lockActive(w);
        var account = identities.lock(initial.user());
        var grant = tokens.reset(digest, true).orElseThrow(InvitationService::invalid);
        valid(grant.expires(), grant.used(), grant.revoked());
        if (account.authVersion() != grant.version()) throw invalid();
        String encoded = passwords.encode(password);
        valid(grant.expires(), grant.used(), grant.revoked());
        identities.resetPassword(grant.user(), encoded, grant.version());
        tokens.useReset(grant.id(), clock.instant());
        tokens.audit(grant.user(), "password-reset-redeemed", grant.id(), w, clock.instant());
    }

    private void valid(Instant expires, Instant used, Instant revoked) {
        if (used != null || revoked != null || !clock.instant().isBefore(expires)) throw invalid();
    }

    private Instant issueTime() {
        return clock.instant().truncatedTo(java.time.temporal.ChronoUnit.MICROS);
    } // PostgreSQL timestamp precision; never round expiry upward.

    private String secret() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String hash(String raw) {
        if (raw == null || !raw.matches("[A-Za-z0-9_-]{43}")) throw invalid();
        try {
            return HexFormat.of()
                    .formatHex(
                            MessageDigest.getInstance("SHA-256")
                                    .digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    private static ApiFailure invalid() {
        return new ApiFailure(409, "TOKEN_INVALID", "Link is unavailable.");
    }
}
