import java.util.ArrayList;
import java.util.List;

public class ListSolutions {
    private static int checks;

    static List<Integer> broken(List<Integer> source, int minimum) {
        List<Integer> result = source.stream()
                .filter(number -> number >= minimum)
                .toList();
        result.sort(Integer::compareTo);
        return result;
    }

    // Fix 1: sorting is part of producing the result.
    static List<Integer> sortedInStream(List<Integer> source, int minimum) {
        return source.stream()
                .filter(number -> number >= minimum)
                .sorted()
                .toList();
    }

    // Fix 2: an explicitly mutable copy before an in-place operation.
    static List<Integer> mutableCopy(List<Integer> source, int minimum) {
        List<Integer> result = new ArrayList<>(source.stream()
                .filter(number -> number >= minimum)
                .toList());
        result.sort(Integer::compareTo);
        return result;
    }

    public static void main(String[] args) {
        List<Integer> source = new ArrayList<>(List.of(7, 2, 5, 2));
        expectUnsupported("original reproduction", () -> broken(source, 2));
        for (int minimum : new int[]{2, 6, 10}) {
            List<Integer> expected = minimum == 2 ? List.of(2, 2, 5, 7)
                    : minimum == 6 ? List.of(7) : List.of();
            check("stream, minimum=" + minimum, expected, sortedInStream(source, minimum));
            check("copy, minimum=" + minimum, expected, mutableCopy(source, minimum));
        }
        check("empty source, stream", List.of(), sortedInStream(List.of(), 0));
        check("empty source, copy", List.of(), mutableCopy(List.of(), 0));
        check("source preserved", List.of(7, 2, 5, 2), source);
        expectUnsupported("stream result cannot sort", () -> sortedInStream(source, 2).sort(Integer::compareTo));
        List<Integer> editable = mutableCopy(source, 2);
        editable.add(99);
        check("copy remains mutable", List.of(2, 2, 5, 7, 99), editable);
        System.out.println("PASS: " + checks + " list checks");
    }

    private static void check(String name, Object expected, Object actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError(name + ": expected " + expected + ", got " + actual);
        }
        checks++;
    }

    private static void expectUnsupported(String name, Runnable action) {
        try {
            action.run();
        } catch (UnsupportedOperationException expected) {
            checks++;
            return;
        }
        throw new AssertionError(name + ": expected UnsupportedOperationException");
    }
}
