package ru.mentor.platform.identity;

import org.springframework.stereotype.Component;

import java.io.Console;
import java.util.Arrays;

@Component
public class AdminCommand {
    private final AuthService auth;

    public AdminCommand(AuthService auth) {
        this.auth = auth;
    }

    public void run() {
        Console console = System.console();
        if (console == null)
            throw new IllegalStateException(
                    "Admin setup requires an interactive terminal; passwords cannot be supplied in arguments or stdin.");
        String login = console.readLine("Administrator login: ");
        char[] first = console.readPassword("Password: ");
        char[] second = console.readPassword("Confirm password: ");
        try {
            if (first == null || second == null || !Arrays.equals(first, second))
                throw new IllegalArgumentException("Passwords do not match.");
            auth.createOrRestoreAdmin(login, new String(first));
            console.printf("Administrator access saved.%n");
        } finally {
            if (first != null) Arrays.fill(first, '\0');
            if (second != null) Arrays.fill(second, '\0');
        }
    }
}
