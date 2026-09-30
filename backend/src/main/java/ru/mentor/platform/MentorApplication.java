package ru.mentor.platform;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration;
import ru.mentor.platform.identity.AdminCommand;

@SpringBootApplication(exclude=UserDetailsServiceAutoConfiguration.class)
public class MentorApplication {
    public static void main(String[] args) {
        if(args.length > 0 && args[0].equals("admin")) {
            if(args.length != 1) throw new IllegalArgumentException("Admin command accepts no arguments. Use an interactive terminal.");
            SpringApplication app = new SpringApplication(MentorApplication.class); app.setWebApplicationType(WebApplicationType.NONE);
            try(var context = app.run()) { context.getBean(AdminCommand.class).run(); }
        } else { SpringApplication.run(MentorApplication.class,args); }
    }
}
