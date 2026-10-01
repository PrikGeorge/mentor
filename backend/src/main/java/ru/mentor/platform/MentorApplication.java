package ru.mentor.platform;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.security.autoconfigure.UserDetailsServiceAutoConfiguration;
import ru.mentor.platform.identity.AdminCommand;
import ru.mentor.platform.practice.CatalogCommand;

@SpringBootApplication(exclude=UserDetailsServiceAutoConfiguration.class)
public class MentorApplication {
    public static void main(String[] args) {
        if(args.length > 0 && args[0].equals("legacy-import")) {
            try {
                var report=ru.mentor.platform.migration.LegacyImportCommand.run(java.util.Arrays.copyOfRange(args,1,args.length));
                System.out.println("Legacy import id="+report.importId()+" completed="+report.completed()+" errors="+report.errors().size());
                if(!report.errors().isEmpty())throw new IllegalStateException("Legacy import rejected; inspect the private report.");
            }catch(Exception failure){throw new IllegalStateException("Legacy import did not complete; inspect its private report and durable run before retrying.");}
        } else if(args.length > 0 && args[0].equals("admin")) {
            if(args.length != 1) throw new IllegalArgumentException("Admin command accepts no arguments. Use an interactive terminal.");
            SpringApplication app = new SpringApplication(MentorApplication.class); app.setWebApplicationType(WebApplicationType.NONE);
            try(var context = app.run()) { context.getBean(AdminCommand.class).run(); }
        } else if(args.length>0&&args[0].equals("catalog")) {
            SpringApplication app=new SpringApplication(MentorApplication.class);app.setWebApplicationType(WebApplicationType.NONE);
            try(var context=app.run()){var report=context.getBean(CatalogCommand.class).run(java.util.Arrays.copyOfRange(args,1,args.length));System.out.println("Catalog workspace="+report.workspaceId()+" published="+report.published()+" errors="+report.errors().size());if(!report.errors().isEmpty())throw new IllegalArgumentException("Catalog publication rejected.");}
        } else { SpringApplication.run(MentorApplication.class,args); }
    }
}
