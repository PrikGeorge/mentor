package ru.mentor.platform.identity;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.shared.ApiFailure;
import ru.mentor.platform.workspaces.WorkspaceService;

import java.security.SecureRandom;
import java.text.Normalizer;
import java.util.Base64;
import java.util.Locale;

@Service
public class AuthService {
    private final IdentityRepository identities;
    private final PasswordCodec passwords;
    private final String dummy;
    private final WorkspaceService workspaces;

    public AuthService(
            IdentityRepository identities, PasswordCodec passwords, WorkspaceService workspaces) {
        this.identities = identities;
        this.passwords = passwords;
        this.workspaces = workspaces;
        byte[] salt = new byte[16], hash = new byte[64];
        SecureRandom random = new SecureRandom();
        random.nextBytes(salt);
        random.nextBytes(hash);
        this.dummy =
                passwords.importLegacy(
                        new LegacyPasswordHash(
                                "scrypt",
                                131072,
                                8,
                                1,
                                Base64.getEncoder().encodeToString(salt),
                                Base64.getEncoder().encodeToString(hash)));
    }

    public static String normalizeLogin(String value) {
        if (value == null || value.length() > 200)
            throw new IllegalArgumentException("Invalid login.");
        // Match JavaScript trim, including BOM, without Java strip's extra ASCII separator
        // characters.
        String login =
                Normalizer.normalize(value, Normalizer.Form.NFKC)
                        .replaceAll(
                                "^[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]+|[\\s\\p{Zs}\\u2028\\u2029\\uFEFF]+$",
                                "")
                        .toLowerCase(Locale.ROOT);
        if (!login.matches("[a-z0-9][a-z0-9._-]{2,31}"))
            throw new IllegalArgumentException("Invalid login.");
        return login;
    }

    public Actor authenticate(String login, String password) {
        String normalized = normalizeLogin(login);
        var original = identities.findByLogin(normalized);
        boolean matched =
                passwords.matches(
                        password,
                        original.map(IdentityRepository.Account::passwordHash).orElse(dummy));
        var current = identities.findByLogin(normalized);
        if (!matched
                || original.isEmpty()
                || current.isEmpty()
                || current.get().disabled()
                || !original.get().id().equals(current.get().id())
                || original.get().authVersion() != current.get().authVersion()) {
            throw new ApiFailure(401, "INVALID_CREDENTIALS", "Invalid login or password.");
        }
        return workspaces
                .resolve(current.get())
                .orElseThrow(
                        () ->
                                new ApiFailure(
                                        401, "INVALID_CREDENTIALS", "Invalid login or password."));
    }

    @Transactional
    public Actor changePassword(
            Actor actor, String currentPassword, String newPassword, String sessionId) {
        PasswordCodec.validate(newPassword);
        var account = identities.findById(actor.userId()).orElseThrow(ApiFailure::unauthorized);
        if (account.disabled() || account.authVersion() != actor.authVersion())
            throw ApiFailure.unauthorized();
        if (!passwords.matches(currentPassword, account.passwordHash()))
            throw new ApiFailure(401, "INVALID_CREDENTIALS", "Invalid login or password.");
        String encoded = passwords.encode(newPassword);
        identities.replacePassword(actor, encoded);
        Actor updated =
                workspaces
                        .resolve(
                                identities
                                        .findById(actor.userId())
                                        .orElseThrow(ApiFailure::unauthorized))
                        .orElseThrow(ApiFailure::unauthorized);
        identities.revokeOtherSessions(actor.userId(), sessionId);
        return updated;
    }

    @Transactional
    public Actor createOrRestoreAdmin(String login, String password) {
        Actor actor =
                identities.createOrRestoreAdmin(normalizeLogin(login), passwords.encode(password));
        identities.revokeAllSessions(actor.userId());
        return actor;
    }
}
