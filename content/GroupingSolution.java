import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class GroupingSolution {
    private static int checks;

    static class Loan {
        final int bookId;
        final int readerId;

        Loan(int bookId, int readerId) {
            this.bookId = bookId;
            this.readerId = readerId;
        }
    }

    static List<String> duplicateReport(List<Loan> loans) {
        Map<Integer, Integer> counts = new HashMap<>();
        Map<Integer, Set<Integer>> readersByBook = new HashMap<>();

        for (Loan loan : loans) {
            if (!counts.containsKey(loan.bookId)) {
                counts.put(loan.bookId, 0);
                readersByBook.put(loan.bookId, new HashSet<>());
            }
            counts.put(loan.bookId, counts.get(loan.bookId) + 1);
            readersByBook.get(loan.bookId).add(loan.readerId);
        }

        List<Integer> bookIds = new ArrayList<>(counts.keySet());
        bookIds.sort(Integer::compareTo);
        List<String> report = new ArrayList<>();
        for (Integer bookId : bookIds) {
            if (counts.get(bookId) > 1) {
                List<Integer> readerIds = new ArrayList<>(readersByBook.get(bookId));
                readerIds.sort(Integer::compareTo);
                report.add("DUPLICATE book=" + bookId + " readers=" + readerIds);
            }
        }
        return report;
    }

    public static void main(String[] args) {
        check("same reader twice", List.of("DUPLICATE book=40 readers=[9]"),
                duplicateReport(List.of(new Loan(40, 9), new Loan(40, 9))));
        check("two readers", List.of("DUPLICATE book=40 readers=[2, 9]"),
                duplicateReport(List.of(new Loan(40, 9), new Loan(40, 2))));
        List<Loan> mixed = new ArrayList<>(List.of(new Loan(70, 5), new Loan(40, 9),
                new Loan(70, 5), new Loan(40, 2), new Loan(90, 1)));
        List<Loan> before = new ArrayList<>(mixed);
        List<String> expectedMixed = List.of("DUPLICATE book=40 readers=[2, 9]",
                "DUPLICATE book=70 readers=[5]");
        check("different books", expectedMixed, duplicateReport(mixed));
        check("source preserved", before, mixed);
        Collections.reverse(mixed);
        check("input order irrelevant", expectedMixed, duplicateReport(mixed));
        check("three occurrences, two readers", List.of("DUPLICATE book=40 readers=[2, 9]"),
                duplicateReport(List.of(new Loan(40, 9), new Loan(40, 2), new Loan(40, 9))));
        check("single occurrence", List.of(), duplicateReport(List.of(new Loan(40, 9))));
        check("same reader, two different books", List.of(),
                duplicateReport(List.of(new Loan(40, 9), new Loan(70, 9))));
        check("empty", List.of(), duplicateReport(List.of()));
        System.out.println("PASS: " + checks + " grouping checks");
    }

    private static void check(String name, Object expected, Object actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError(name + ": expected " + expected + ", got " + actual);
        }
        checks++;
    }
}
