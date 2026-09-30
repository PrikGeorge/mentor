import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class GroupingSolution {
    // Часть 03/07. Эталон для преподавателя: сначала собираем данные, потом строим отчёт.
    private static int checks;

    // Loan — одна запись о выдаче: какую книгу и какому читателю записали.
    // Две записи с одинаковыми ID всё равно считаются двумя вхождениями во входном списке.
    // final не позволяет поменять эти ID после создания записи.
    static class Loan {
        final int bookId;
        final int readerId;

        Loan(int bookId, int readerId) {
            this.bookId = bookId;
            this.readerId = readerId;
        }
    }

    static List<String> duplicateReport(List<Loan> loans) {
        // Эти карты отвечают на разные вопросы об одной и той же книге.
        // counts: сколько раз встретился ID книги, в том числе у одного читателя.
        Map<Integer, Integer> counts = new HashMap<>();
        // readersByBook: какие читатели связаны с книгой. Set убирает повторы их ID.
        // Для двух записей (40, 9) получим counts.get(40) = 2, а в Set останется только 9.
        // Поэтому по одному readersByBook.get(40).size() такой повтор не обнаружить.
        Map<Integer, Set<Integer>> readersByBook = new HashMap<>();

        for (Loan loan : loans) {
            // Заготовку для книги создаём только при первом появлении её ID.
            // До этого get(bookId) вернул бы null: ещё нечего увеличивать или дополнять.
            // Свой HashSet у каждой книги не даёт смешать читателей разных книг.
            if (!counts.containsKey(loan.bookId)) {
                counts.put(loan.bookId, 0);
                readersByBook.put(loan.bookId, new HashSet<>());
            }
            // Считаем каждую запись независимо от того, новый ли у неё читатель.
            // Не обнуляем счётчик при повторе: берём накопленное значение и прибавляем 1.
            counts.put(loan.bookId, counts.get(loan.bookId) + 1);
            // Повторный add того же ID не меняет Set. Счётчик выше уже увеличился.
            readersByBook.get(loan.bookId).add(loan.readerId);
        }

        // HashMap не обещает порядок ключей. Копируем их в изменяемый список
        // и сортируем по возрастанию, чтобы порядок отчёта не зависел от входных записей.
        List<Integer> bookIds = new ArrayList<>(counts.keySet());
        bookIds.sort(Integer::compareTo);
        List<String> report = new ArrayList<>();
        // Отчёт собираем отдельным проходом, когда уже знаем всех читателей каждой книги.
        // В bookIds каждый ID встречается один раз — значит, и строка о повторе будет одна.
        for (Integer bookId : bookIds) {
            if (counts.get(bookId) > 1) {
                // Set уже убрал одинаковые ID, но HashSet не гарантирует их порядок.
                // Получаем отдельный список и сортируем: например, [9, 2] станет [2, 9].
                List<Integer> readerIds = new ArrayList<>(readersByBook.get(bookId));
                readerIds.sort(Integer::compareTo);
                report.add("DUPLICATE book=" + bookId + " readers=" + readerIds);
            }
        }
        // loans и сами Loan мы только читали; сортировали лишь созданные здесь списки.
        // При пустом входе оба цикла пропускаются, и возвращается пустой report.
        return report;
    }

    public static void main(String[] args) {
        // Эти короткие проверки запускаются обычным запуском main, без тестовой библиотеки.
        // Сначала ловим главное различие: две выдачи одному человеку — тоже повтор книги.
        check("same reader twice", List.of("DUPLICATE book=40 readers=[9]"),
                duplicateReport(List.of(new Loan(40, 9), new Loan(40, 9))));
        // У книги два разных читателя: в одной строке нужны оба ID по возрастанию.
        check("two readers", List.of("DUPLICATE book=40 readers=[2, 9]"),
                duplicateReport(List.of(new Loan(40, 9), new Loan(40, 2))));
        // Смешиваем несколько книг. У 40 и 70 есть повторы, а 90 в отчёт попасть не должна.
        List<Loan> mixed = new ArrayList<>(List.of(new Loan(70, 5), new Loan(40, 9),
                new Loan(70, 5), new Loan(40, 2), new Loan(90, 1)));
        // Сохраняем состав и порядок исходного списка до вызова метода.
        // Копии самих Loan здесь не нужны: их поля final, а сравниваем мы списки записей.
        List<Loan> before = new ArrayList<>(mixed);
        List<String> expectedMixed = List.of("DUPLICATE book=40 readers=[2, 9]",
                "DUPLICATE book=70 readers=[5]");
        check("different books", expectedMixed, duplicateReport(mixed));
        check("source preserved", before, mixed);
        // Теперь намеренно меняем порядок только в проверке. Отчёт должен остаться прежним.
        Collections.reverse(mixed);
        check("input order irrelevant", expectedMixed, duplicateReport(mixed));
        // Три вхождения дают одну строку о книге, а повтор читателя 9 не дублирует его ID.
        check("three occurrences, two readers", List.of("DUPLICATE book=40 readers=[2, 9]"),
                duplicateReport(List.of(new Loan(40, 9), new Loan(40, 2), new Loan(40, 9))));
        // Одна запись — не повтор. Один читатель с разными книгами — тоже не ошибка.
        check("single occurrence", List.of(), duplicateReport(List.of(new Loan(40, 9))));
        check("same reader, two different books", List.of(),
                duplicateReport(List.of(new Loan(40, 9), new Loan(70, 9))));
        // Пустой список корректен: искать повторы не в чем.
        check("empty", List.of(), duplicateReport(List.of()));
        // До этой строки дойдём, только если ни одна проверка не выбросила AssertionError.
        System.out.println("PASS: " + checks + " grouping checks");
    }

    private static void check(String name, Object expected, Object actual) {
        // equals у List сравнивает элементы и их порядок, а не только длину списка.
        // Поэтому проверка замечает и лишнюю строку, и неверную сортировку в отчёте.
        if (!expected.equals(actual)) {
            // При несовпадении сразу останавливаем запуск и показываем название проверки,
            // ожидаемый результат и то, что получилось на самом деле.
            throw new AssertionError(name + ": expected " + expected + ", got " + actual);
        }
        // Счётчик увеличиваем только после успешного сравнения.
        checks++;
    }
}
