package mentor.runner;

/** Trusted PID 1: the container stops at its absolute deadline even after worker death. */
public final class ContainerDeadline {
    public static void main(String[] args) throws Exception {
        long deadline=Math.min(Long.parseLong(args[0]),System.currentTimeMillis()+90000L);
        while(System.currentTimeMillis()<deadline) Thread.sleep(Math.min(1000L,deadline-System.currentTimeMillis()));
        System.exit(0);
    }
}
