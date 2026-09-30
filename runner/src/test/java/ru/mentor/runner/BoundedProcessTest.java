package ru.mentor.runner;

import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class BoundedProcessTest {
    static List<String> command(String mode) { return List.of(Path.of(System.getProperty("java.home"),"bin","java").toString(),"-cp",System.getProperty("java.class.path"),Producer.class.getName(),mode); }
    @Test void capsCombinedStdoutAndStderrBeforeParsing() throws Exception {
        var output=new BoundedProcess().run(command("flood"),null,null,Duration.ofSeconds(5),65536);
        assertEquals("output_limit",output.reason()); assertTrue(output.stdout().length()+output.stderr().length()<=65536);
    }
    @Test void unconsumedStdinCannotPreventDeadline() throws Exception {
        long start=System.nanoTime();
        var output=new BoundedProcess().run(command("hang"),null,new byte[2*1024*1024],Duration.ofMillis(500),65536);
        assertEquals("timeout",output.reason()); assertTrue((System.nanoTime()-start)/1_000_000<4000);
    }
    public static class Producer {
        public static void main(String[] args) throws Exception {
            if(args[0].equals("hang")) Thread.sleep(60000);
            else while(true) { System.out.print("x".repeat(1024)); System.err.print("e".repeat(1024)); }
        }
    }
}
