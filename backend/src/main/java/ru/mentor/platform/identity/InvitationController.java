package ru.mentor.platform.identity;

import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.security.web.csrf.*;
import jakarta.servlet.http.*;
import ru.mentor.platform.shared.*;
import java.util.Map;

@RestController
@RequestMapping("/api/v1")
public class InvitationController {
    private static final String S="/workspaces/{workspaceId}/students/{studentId}";
    private final InvitationService invitations;private final AccountAccessService access;private final SessionPolicy sessions;private final CsrfTokenRepository csrf;
    public InvitationController(InvitationService invitations,AccountAccessService access,SessionPolicy sessions,CsrfTokenRepository csrf){this.invitations=invitations;this.access=access;this.sessions=sessions;this.csrf=csrf;}
    public record RegistrationRequest(String token,String login,String password){public RegistrationRequest{if(token==null||login==null||password==null)throw new IllegalArgumentException("Fields required.");}}
    public record ResetPasswordRequest(String token,String password){public ResetPasswordRequest{if(token==null||password==null)throw new IllegalArgumentException("Fields required.");}}
    public record AccessChange(Boolean disabled){public AccessChange{if(disabled==null)throw new IllegalArgumentException("Disabled required.");}}
    public record PasswordResetRequest(String currentPassword){public PasswordResetRequest{if(currentPassword==null)throw new IllegalArgumentException("Current password required.");}}
    @PostMapping("/auth/register") public AuthController.SessionView register(@RequestBody RegistrationRequest input,HttpServletRequest r,HttpServletResponse response){
        Actor actor=invitations.redeem(input.token(),input.login(),input.password());sessions.establish(r,actor);CsrfToken token=csrf.generateToken(r);csrf.saveToken(token,r,response);return new AuthController.SessionView(actor,token.getToken());
    }
    @PostMapping("/auth/reset-password") public ResponseEntity<Void> reset(@RequestBody ResetPasswordRequest input,HttpServletRequest r){invitations.resetPassword(input.token(),input.password());var session=r.getSession(false);if(session!=null)session.invalidate();return empty();}
    @GetMapping("/admin/teachers") public Page<IdentityRepository.TeacherView> teachers(@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size,HttpServletRequest r){return access.teachers(sessions.requireCurrent(r),page,size);}
    @GetMapping("/admin/teacher-invitations") public Page<TokenRepository.InvitationView> teacherInvitations(@RequestParam(defaultValue="0") int page,@RequestParam(defaultValue="25") int size,HttpServletRequest r){return invitations.listTeachers(sessions.requireCurrent(r),page,size);}
    @PostMapping("/admin/teacher-invitations") public InvitationService.InvitationIssue issueTeacher(@RequestBody Map<String,Object> input,HttpServletRequest r){blank(input);return invitations.issueTeacher(sessions.requireCurrent(r),origin(r));}
    @DeleteMapping("/admin/teacher-invitations/{id}") public ResponseEntity<Void> revokeTeacher(@PathVariable String id,HttpServletRequest r){invitations.revokeTeacher(sessions.requireCurrent(r),id);return empty();}
    @PatchMapping("/admin/teachers/{id}/access") public ResponseEntity<Void> teacherAccess(@PathVariable String id,@RequestBody AccessChange input,HttpServletRequest r){access.changeTeacherAccess(sessions.requireCurrent(r),id,input.disabled());return empty();}
    @PatchMapping("/admin/workspaces/{id}/access") public ResponseEntity<Void> workspaceAccess(@PathVariable String id,@RequestBody AccessChange input,HttpServletRequest r){access.changeWorkspaceAccess(sessions.requireCurrent(r),id,input.disabled());return empty();}
    @PostMapping("/admin/teachers/{id}/password-reset") public InvitationService.PasswordResetIssue teacherReset(@PathVariable String id,@RequestBody PasswordResetRequest input,HttpServletRequest r){return invitations.issueTeacherReset(sessions.requireCurrent(r),id,input.currentPassword(),origin(r));}
    @GetMapping(S+"/access") public AccountAccessService.StudentAccessView studentAccess(@PathVariable String workspaceId,@PathVariable String studentId,HttpServletRequest r){return access.studentAccess(sessions.requireCurrent(r),workspaceId,studentId);}
    @PatchMapping(S+"/access") public ResponseEntity<Void> studentAccess(@PathVariable String workspaceId,@PathVariable String studentId,@RequestBody AccessChange input,HttpServletRequest r){access.changeStudentAccess(sessions.requireCurrent(r),workspaceId,studentId,input.disabled());return empty();}
    @PostMapping(S+"/invitations") public InvitationService.InvitationIssue issueStudent(@PathVariable String workspaceId,@PathVariable String studentId,@RequestBody Map<String,Object> input,HttpServletRequest r){blank(input);return invitations.issueStudent(sessions.requireCurrent(r),workspaceId,studentId,origin(r));}
    @DeleteMapping(S+"/invitations/{id}") public ResponseEntity<Void> revokeStudent(@PathVariable String workspaceId,@PathVariable String studentId,@PathVariable String id,HttpServletRequest r){invitations.revokeStudent(sessions.requireCurrent(r),workspaceId,studentId,id);return empty();}
    @PostMapping(S+"/password-reset") public InvitationService.PasswordResetIssue studentReset(@PathVariable String workspaceId,@PathVariable String studentId,@RequestBody PasswordResetRequest input,HttpServletRequest r){return invitations.issueStudentReset(sessions.requireCurrent(r),workspaceId,studentId,input.currentPassword(),origin(r));}
    private static String origin(HttpServletRequest r){return r.getHeader("Origin");} // Already exactly validated by IdentityRequestFilter.
    private static void blank(Map<String,Object> input){if(!input.isEmpty())throw new IllegalArgumentException("No fields allowed.");}
    private static ResponseEntity<Void> empty(){return ResponseEntity.noContent().build();}
}
