package ru.mentor.platform.shared;

import java.io.Serializable;

public record Actor(String userId, String workspaceId, Role role, long authVersion) implements Serializable {
    public enum Role { ADMIN, TEACHER, STUDENT }
}
