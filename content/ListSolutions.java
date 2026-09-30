import java.util.ArrayList;
import java.util.List;

// Эталон к части 02/07: два способа исправить сортировку, не меняя исходный список.
// Оба способа дают одинаковые числа, но разрешают разные действия с результатом.
public class ListSolutions {
    // Считаем только проверки, которые действительно завершились успешно.
    private static int checks;

    // Здесь специально оставлена исходная ошибка, чтобы сначала воспроизвести её.
    // В этом упражнении source и его элементы не равны null.
    static List<Integer> broken(List<Integer> source, int minimum) {
        // Поток читает source, а filter оставляет числа не меньше minimum.
        // При входе [7, 2, 5, 2] и minimum = 2 проходят все четыре числа.
        // Повторы остаются: filter проверяет условие, а не уникальность.
        List<Integer> result = source.stream()
                .filter(number -> number >= minimum)
                .toList();

        // Stream.toList() вернул список, который нельзя менять через операции списка.
        // sort пытается переставить элементы внутри него — это тоже изменение.
        // Поэтому получим UnsupportedOperationException, даже для пустого результата.
        // До return выполнение не дойдёт; исходный source мы здесь не сортируем.
        result.sort(Integer::compareTo);
        return result;
    }

    // Способ 1: сортировка выполняется в потоке до создания итогового списка.
    static List<Integer> sortedInStream(List<Integer> source, int minimum) {
        return source.stream()
                // Сначала оставляем подходящие числа; обе двойки сохранятся.
                .filter(number -> number >= minimum)
                // Теперь задаём порядок по возрастанию. Для Integer это обычный
                // числовой порядок: [7, 2, 5, 2] превращается в [2, 2, 5, 7].
                // sorted работает с элементами потока, не сортирует сам source.
                .sorted()
                // Собираем уже упорядоченный результат. Его по-прежнему нельзя
                // менять: add или sort на этом списке вызовет исключение.
                // Способ подходит, когда нам достаточно читать готовый ответ.
                .toList();
    }

    // Способ 2: перед сортировкой самого списка создаём явно изменяемую копию.
    static List<Integer> mutableCopy(List<Integer> source, int minimum) {
        // Внутренний toList() снова вернёт неизменяемый список. Но мы сразу
        // передаём его элементы конструктору ArrayList и получаем другой список.
        // ArrayList разрешает переставлять, добавлять и удалять элементы.
        // Входной source остаётся отдельным списком со своим порядком.
        List<Integer> result = new ArrayList<>(source.stream()
                .filter(number -> number >= minimum)
                .toList());

        // Integer::compareTo задаёт числовое сравнение по возрастанию.
        // Здесь sort меняет нашу копию, поэтому запрещённой операции уже нет.
        result.sort(Integer::compareTo);

        // Вернём изменяемый результат: вызывающий код сможет, например, сделать add.
        // Это копия списка, а не глубокая копия объектов внутри. Здесь Integer
        // неизменяемы; для списка Book ссылки могли бы вести к тем же книгам.
        return result;
    }

    public static void main(String[] args) {
        List<Integer> source = new ArrayList<>(List.of(7, 2, 5, 2));

        // Сначала убеждаемся, что исходная ошибка действительно воспроизводится.
        // Лямбда откладывает вызов broken: его запустит вспомогательный метод.
        expectUnsupported("original reproduction", () -> broken(source, 2));

        // Проверим оба исправления на трёх случаях: подходят все числа,
        // подходит только 7 и не подходит ни одно. Это границы результата,
        // которые легко пропустить, если запускать только один удачный пример.
        for (int minimum : new int[]{2, 6, 10}) {
            // Тернарные операторы выбирают заранее известный ожидаемый список.
            List<Integer> expected = minimum == 2 ? List.of(2, 2, 5, 7)
                    : minimum == 6 ? List.of(7) : List.of();
            check("stream, minimum=" + minimum, expected, sortedInStream(source, minimum));
            check("copy, minimum=" + minimum, expected, mutableCopy(source, minimum));
        }

        // Пустой вход — отдельный случай: оба способа должны вернуть пустой список.
        check("empty source, stream", List.of(), sortedInStream(List.of(), 0));
        check("empty source, copy", List.of(), mutableCopy(List.of(), 0));

        // Правильного ответа мало: после всех вызовов исходные числа должны
        // остаться в прежнем порядке. Сортировка самого source нарушила бы условие.
        check("source preserved", List.of(7, 2, 5, 2), source);

        // Числа уже отсортированы, но результат первого способа всё ещё нельзя менять.
        expectUnsupported("stream result cannot sort", () -> sortedInStream(source, 2).sort(Integer::compareTo));

        // Второй способ возвращает ArrayList. Проверяем различие действием:
        // добавление 99 проходит, и новый элемент появляется в результате.
        List<Integer> editable = mutableCopy(source, 2);
        editable.add(99);
        check("copy remains mutable", List.of(2, 2, 5, 7, 99), editable);
        System.out.println("PASS: " + checks + " list checks");
    }

    // Наш небольшой помощник вместо тестовой библиотеки. У List метод equals
    // сравнивает и элементы, и их порядок. Несовпадение сразу останавливает запуск.
    private static void check(String name, Object expected, Object actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError(name + ": expected " + expected + ", got " + actual);
        }
        checks++;
    }

    // Эта проверка успешна именно тогда, когда действие бросает ожидаемое исключение.
    // Отсутствие исключения означает провал проверки, а другое исключение выйдет наружу.
    private static void expectUnsupported(String name, Runnable action) {
        try {
            // Запускаем переданное действие внутри try, чтобы проверить его результат.
            action.run();
        } catch (UnsupportedOperationException expected) {
            checks++;
            return;
        }
        throw new AssertionError(name + ": expected UnsupportedOperationException");
    }
}
