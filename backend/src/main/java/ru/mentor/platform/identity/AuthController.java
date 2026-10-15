package ru.mentor.platform.identity;

import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.web.csrf.CsrfToken;
import org.springframework.security.web.csrf.CsrfTokenRepository;
import jakarta.servlet.http.HttpServletResponse;
import com.fasterxml.jackson.annotation.JsonInclude;
import ru.mentor.platform.shared.Actor;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final AuthService auth;
    private final SessionPolicy sessions;
    private final AuthRateLimiter limits;
    private final CsrfTokenRepository csrf;
    public AuthController(AuthService auth,SessionPolicy sessions,AuthRateLimiter limits,CsrfTokenRepository csrf) {
        this.auth = auth; this.sessions = sessions; this.limits = limits; this.csrf = csrf;
    }
    // login names the signed-in account for the header; it is omitted for anonymous clients.
    public record SessionView(Actor account,String csrfToken,@JsonInclude(JsonInclude.Include.NON_NULL) String login) {}
    public record LoginInput(String login,String password) {
        public LoginInput { if(login==null || password==null) throw new IllegalArgumentException("Login and password required."); }
    }
    public record PasswordInput(String currentPassword,String newPassword) {
        public PasswordInput { if(currentPassword==null || newPassword==null) throw new IllegalArgumentException("Current and new password required."); }
    }
    @GetMapping("/session") public SessionView session(HttpServletRequest request,CsrfToken token) { Actor actor = sessions.current(request); return new SessionView(actor,token.getToken(),sessions.login(actor)); }
    @PostMapping("/login") public SessionView login(@RequestBody LoginInput input,HttpServletRequest request,HttpServletResponse response) {
        limits.beforeLogin(input.login());
        Actor actor;
        // Wrong passwords are counted after the check, so a known login alone cannot be locked out by a stranger.
        try { actor = auth.authenticate(input.login(),input.password()); } catch(ru.mentor.platform.shared.ApiFailure rejected) { if(rejected.status()==401) limits.loginFailed(input.login()); throw rejected; }
        limits.loginSucceeded(input.login()); sessions.establish(request,actor);
        return new SessionView(actor,rotateCsrf(request,response),sessions.login(actor));
    }
    @PostMapping("/logout") public ResponseEntity<Void> logout(HttpServletRequest request) {
        var session = request.getSession(false); if(session != null) session.invalidate();
        return ResponseEntity.noContent().build();
    }
    @PostMapping("/change-password") public SessionView changePassword(@RequestBody PasswordInput input,HttpServletRequest request,HttpServletResponse response) {
        Actor actor = sessions.requireCurrent(request);
        Actor updated = auth.changePassword(actor,input.currentPassword(),input.newPassword(),request.getSession(false).getId());
        sessions.update(request,updated);
        return new SessionView(updated,rotateCsrf(request,response),sessions.login(updated));
    }
    private String rotateCsrf(HttpServletRequest request,HttpServletResponse response) {
        CsrfToken token = csrf.generateToken(request); csrf.saveToken(token,request,response); return token.getToken();
    }
}
