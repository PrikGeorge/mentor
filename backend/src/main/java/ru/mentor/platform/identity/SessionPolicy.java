package ru.mentor.platform.identity;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;

import org.springframework.session.FindByIndexNameSessionRepository;
import org.springframework.stereotype.Component;

import ru.mentor.platform.shared.Actor;
import ru.mentor.platform.shared.ApiFailure;
import ru.mentor.platform.workspaces.WorkspaceService;

import java.time.Clock;
import java.time.Duration;

@Component
public class SessionPolicy {
    private static final String ACTOR = "mentor.actor",
            CREATED = "mentor.authCreated",
            SEEN = "mentor.authSeen";
    private final IdentityRepository identities;
    private final Clock clock;
    private final WorkspaceService workspaces;

    public SessionPolicy(IdentityRepository identities, Clock clock, WorkspaceService workspaces) {
        this.identities = identities;
        this.clock = clock;
        this.workspaces = workspaces;
    }

    public String login(Actor actor) {
        return actor == null
                ? null
                : identities
                        .findById(actor.userId())
                        .map(IdentityRepository.Account::login)
                        .orElse(null);
    }

    public Actor current(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) return null;
        Object stored = session.getAttribute(ACTOR);
        if (!(stored instanceof Actor actor)) return null;
        var account = identities.findById(actor.userId());
        Long created = (Long) session.getAttribute(CREATED),
                seen = (Long) session.getAttribute(SEEN);
        long now = clock.millis();
        if (created == null
                || seen == null
                || now >= created + Duration.ofDays(7).toMillis()
                || now >= seen + Duration.ofHours(8).toMillis()
                || account.isEmpty()
                || !workspaces.resolve(account.get()).filter(actor::equals).isPresent()) {
            session.invalidate();
            return null;
        }
        session.setAttribute(SEEN, now);
        return actor;
    }

    public Actor requireCurrent(HttpServletRequest request) {
        Actor actor = current(request);
        if (actor == null) throw ApiFailure.unauthorized();
        return actor;
    }

    public void establish(HttpServletRequest request, Actor actor) {
        HttpSession session = request.getSession();
        request.changeSessionId();
        session.setMaxInactiveInterval((int) Duration.ofHours(8).toSeconds());
        session.setAttribute(ACTOR, actor);
        session.setAttribute(CREATED, clock.millis());
        session.setAttribute(SEEN, clock.millis());
        session.setAttribute(
                FindByIndexNameSessionRepository.PRINCIPAL_NAME_INDEX_NAME, actor.userId());
    }

    public void update(HttpServletRequest request, Actor actor) {
        HttpSession session = request.getSession(false);
        if (session == null) throw ApiFailure.unauthorized();
        request.changeSessionId();
        session.setAttribute(ACTOR, actor);
    }
}
