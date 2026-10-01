package ru.mentor.platform.migration;

import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.context.ApplicationContext;
import org.springframework.context.annotation.*;
import org.springframework.core.env.Environment;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import javax.sql.DataSource;
import java.sql.SQLException;

@Configuration(proxyBeanMethods=false)
public class DatabaseGateConfiguration {
    @Bean static BeanPostProcessor guardedDatabase(Environment environment,ApplicationContext context){
        return new BeanPostProcessor(){
            public Object postProcessAfterInitialization(Object bean,String name){
                if(!(bean instanceof DataSource source)||bean instanceof DatabaseGate)return bean;
                boolean offline=environment.getProperty("mentor.offline-import",Boolean.class,false);
                if(offline&&context instanceof WebServerApplicationContext)throw new IllegalStateException("Offline import cannot run in a web application.");
                try{return new DatabaseGate(source,offline);}catch(SQLException failure){throw new IllegalStateException("Database gate refused startup.",failure);}
            }
        };
    }
}
