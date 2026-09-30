import java.util.ArrayList;
import java.util.List;

public class ListTask {
    // Оставить числа >= minimum и отсортировать по возрастанию. Не изменять source.
    static List<Integer> select(List<Integer> source, int minimum) {
        List<Integer> result = source.stream()
                .filter(number -> number >= minimum)
                .toList();
        result.sort(Integer::compareTo);
        return result;
    }

    public static void main(String[] args) {
        List<Integer> source = new ArrayList<>(List.of(7, 2, 5, 2));
        check("several values", List.of(2, 2, 5, 7), select(source, 2));
        check("source unchanged", List.of(7, 2, 5, 2), source);
        check("empty result", List.of(), select(source, 10));
        check("one value", List.of(7), select(source, 6));
        check("empty source", List.of(), select(List.of(), 0));
        System.out.println("PASS: 5 list checks");
    }

    private static void check(String name, Object expected, Object actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError(name + ": expected " + expected + ", got " + actual);
        }
    }
}
