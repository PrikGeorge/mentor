import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class GroupingTask {
    static class Loan {
        final int bookId;
        final int readerId;

        Loan(int bookId, int readerId) {
            this.bookId = bookId;
            this.readerId = readerId;
        }
    }

    // One DUPLICATE line per book with at least two occurrences.
    // Sort book IDs and unique reader IDs ascending. Preserve loans.
    static List<String> duplicateReport(List<Loan> loans) {
        // TODO: count occurrences per book and collect that book's reader IDs.
        // TODO: build the report only after reading all loans.
        throw new UnsupportedOperationException("TODO: implement duplicateReport");
    }

    public static void main(String[] args) {
        check("same reader twice",
                List.of("DUPLICATE book=40 readers=[9]"),
                duplicateReport(List.of(new Loan(40, 9), new Loan(40, 9))));
        check("two readers, reverse input",
                List.of("DUPLICATE book=40 readers=[2, 9]"),
                duplicateReport(List.of(new Loan(40, 9), new Loan(40, 2))));
        check("different books stay separate",
                List.of("DUPLICATE book=40 readers=[2, 9]",
                        "DUPLICATE book=70 readers=[5]"),
                duplicateReport(List.of(new Loan(70, 5), new Loan(40, 9),
                        new Loan(70, 5), new Loan(40, 2), new Loan(90, 1))));
        check("one occurrence", List.of(),
                duplicateReport(List.of(new Loan(40, 9))));
        check("empty input", List.of(), duplicateReport(List.of()));
        List<Loan> source = new ArrayList<>(List.of(new Loan(70, 5), new Loan(40, 9)));
        List<Loan> before = new ArrayList<>(source);
        duplicateReport(source);
        check("source unchanged", before, source);
        System.out.println("PASS: 6 grouping checks");
    }

    private static void check(String name, Object expected, Object actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError(name + ": expected " + expected + ", got " + actual);
        }
    }
}
