# Коллекции (Collections Framework)

## Зачем нужны коллекции

### Проблема с массивами

```java
// Массив фиксированного размера
String[] names = new String[3];
names[0] = "Миша";
names[1] = "Аня";
names[2] = "Петя";
// names[3] = "Вася";  // ArrayIndexOutOfBoundsException!

// Нужно добавить элемент? Мучение!
String[] newNames = new String[names.length + 1];
System.arraycopy(names, 0, newNames, 0, names.length);
newNames[newNames.length - 1] = "Вася";
names = newNames;
```

### Решение — коллекции

```java
List<String> names = new ArrayList<>();
names.add("Миша");
names.add("Аня");
names.add("Петя");
names.add("Вася");  // Легко!
names.add("Даша");  // Ещё легче!

names.remove("Аня");  // Удаление тоже просто
```

### Сравнение массивов и коллекций

| Массив | Коллекция |
|--------|-----------|
| Фиксированный размер | Динамический размер |
| Примитивы и объекты | Только объекты* |
| `array.length` | `collection.size()` |
| Доступ по индексу `[i]` | Зависит от типа коллекции |
| Нет встроенных методов | Богатый API |
| Быстрее (без накладных расходов) | Удобнее |

*Для примитивов есть автобоксинг: `List<Integer>` автоматически преобразует `int` в `Integer`.

---

## Иерархия коллекций

```
                       Iterable<E>
                           │
                      Collection<E>
                      /    │    \
                   List   Set   Queue
                    │      │      │
              ┌─────┼──────┼──────┼─────┐
              │     │      │      │     │
         ArrayList │   HashSet  TreeSet │
                   │      │             │
             LinkedList   │        PriorityQueue
                          │
                    LinkedHashSet
                    

                       Map<K,V>   ← Отдельная иерархия
                           │
                  ┌────────┼────────┐
                  │        │        │
              HashMap   TreeMap  LinkedHashMap
```

### Интерфейсы и их назначение

| Интерфейс | Назначение |
|-----------|------------|
| **Collection** | Базовый интерфейс для коллекций |
| **List** | Упорядоченная коллекция с дубликатами |
| **Set** | Коллекция уникальных элементов |
| **Queue** | Очередь (FIFO) |
| **Deque** | Двусторонняя очередь |
| **Map** | Пары ключ-значение |

### Шпаргалка: когда что использовать

| Задача | Коллекция |
|--------|-----------|
| Список с индексами, частое чтение | `ArrayList` |
| Частые вставки/удаления в середине | `LinkedList` |
| Уникальность, порядок не важен | `HashSet` |
| Уникальность + сортировка | `TreeSet` |
| Уникальность + порядок добавления | `LinkedHashSet` |
| Ключ-значение, быстрый доступ | `HashMap` |
| Ключ-значение + сортировка | `TreeMap` |
| Очередь (FIFO) | `LinkedList` или `ArrayDeque` |
| Приоритетная очередь | `PriorityQueue` |
| Стек (LIFO) | `ArrayDeque` |

---

## List: ArrayList и LinkedList

### ArrayList — "умный массив"

```
Внутри ArrayList:
┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
│ A │ B │ C │ D │ E │   │   │   │   │   │
└───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
  0   1   2   3   4   5   6   7   8   9
                      ↑
                  size=5, capacity=10
```

```java
List<String> list = new ArrayList<>();

// Добавление
list.add("Первый");           // В конец
list.add("Второй");
list.add(1, "Полтора");       // По индексу (сдвигает остальные)

// Получение
String first = list.get(0);   // "Первый"

// Изменение
list.set(0, "Новый первый");

// Удаление
list.remove(0);               // По индексу
list.remove("Второй");        // По значению (первое вхождение)

// Размер
int size = list.size();

// Проверки
boolean contains = list.contains("Полтора");
boolean isEmpty = list.isEmpty();
int index = list.indexOf("Полтора");  // -1 если нет

// Очистка
list.clear();
```

### ArrayList: capacity и size

```java
// Начальная ёмкость по умолчанию: 10
List<String> list1 = new ArrayList<>();

// Можно задать начальную ёмкость (оптимизация!)
List<String> list2 = new ArrayList<>(1000);

// size() — сколько элементов добавлено
// capacity — сколько может хранить без расширения
```

### Когда ArrayList расширяется?

```java
// При добавлении, если size == capacity:
// 1. Создаётся новый массив размером (capacity * 1.5)
// 2. Копируются все элементы
// 3. Добавляется новый элемент

// Это O(n) операция! Поэтому лучше задавать capacity заранее
List<Integer> list = new ArrayList<>(10000);  // Если знаем примерный размер
```

### LinkedList — связанный список

```
LinkedList (двусвязный):
┌──────┐   ┌──────┐   ┌──────┐   ┌──────┐
│ head │──>│  A   │──>│  B   │──>│  C   │──>null
│      │<──│      │<──│      │<──│ tail │
└──────┘   └──────┘   └──────┘   └──────┘
```

```java
LinkedList<String> list = new LinkedList<>();

// Все методы ArrayList +
list.addFirst("Первый");
list.addLast("Последний");
String first = list.getFirst();
String last = list.getLast();
list.removeFirst();
list.removeLast();

// Можно использовать как очередь/стек
list.push("Stack top");    // Добавить в начало
String top = list.pop();   // Удалить из начала
list.offer("Queue tail");  // Добавить в конец
String head = list.poll(); // Удалить из начала
```

### ArrayList vs LinkedList: производительность

| Операция | ArrayList | LinkedList |
|----------|-----------|------------|
| `get(index)` | **O(1)** | O(n) |
| `add(element)` в конец | **O(1)*** | O(1) |
| `add(0, element)` в начало | O(n) | **O(1)** |
| `add(index, element)` в середину | O(n) | **O(1)** после поиска |
| `remove(index)` | O(n) | **O(1)** после поиска |
| `contains(element)` | O(n) | O(n) |
| Память | Меньше | Больше (ссылки prev/next) |

*Амортизированно O(1), иногда O(n) при расширении

На практике используй ArrayList в 99% случаев. LinkedList выигрывает только при частых вставках/удалениях в начало или при итерации с удалением.

### Обход списка

```java
List<String> names = List.of("Миша", "Аня", "Петя");

// 1. Обычный for (только для List)
for (int i = 0; i < names.size(); i++) {
    System.out.println(names.get(i));
}

// 2. Расширенный цикл for (foreach) — самый частый
for (String name : names) {
    System.out.println(name);
}

// 3. forEach с лямбдой
names.forEach(name -> System.out.println(name));

// 4. forEach со ссылкой на метод
names.forEach(System.out::println);

// 5. Перебор через Iterator
Iterator<String> it = names.iterator();
while (it.hasNext()) {
    System.out.println(it.next());
}

// 6. Обработка через Stream API
names.stream().forEach(System.out::println);
```

### Создание списков

```java
// Изменяемый список
List<String> mutable = new ArrayList<>();
mutable.add("A");

// Неизменяемый список (Java 9+)
List<String> immutable = List.of("A", "B", "C");
// immutable.add("D");  // UnsupportedOperationException

// Неизменяемая копия
List<String> copy = List.copyOf(mutable);

// Arrays.asList — фиксированного размера, но изменяемый
List<String> fixed = Arrays.asList("A", "B", "C");
fixed.set(0, "X");  // Можно изменять
// fixed.add("D");  // UnsupportedOperationException
```

---

## Set: HashSet, TreeSet, LinkedHashSet

### Set — множество уникальных элементов

```java
Set<String> fruits = new HashSet<>();
fruits.add("Яблоко");
fruits.add("Банан");
fruits.add("Яблоко");  // Не добавится — уже есть!

System.out.println(fruits.size());  // 2
```

### HashSet — быстрый, без порядка

```java
Set<Integer> hashSet = new HashSet<>();
hashSet.add(3);
hashSet.add(1);
hashSet.add(2);

System.out.println(hashSet);  // Порядок не гарантирован!
// Может быть [1, 2, 3] или [3, 1, 2] или [2, 3, 1]
```

**Как работает HashSet:**
```
hashCode("Яблоко") = 12345
bucket = 12345 % 16 = 5

Buckets:
[0] → null
[1] → null
[2] → "Банан" → null
[3] → null
[4] → null
[5] → "Яблоко" → null  ← добавляем сюда
...
```

### TreeSet — отсортированный

```java
Set<Integer> treeSet = new TreeSet<>();
treeSet.add(30);
treeSet.add(10);
treeSet.add(20);

System.out.println(treeSet);  // [10, 20, 30] — всегда отсортирован!

// Дополнительные методы TreeSet
TreeSet<Integer> tree = new TreeSet<>();
tree.addAll(List.of(5, 10, 15, 20, 25));

System.out.println(tree.first());     // 5
System.out.println(tree.last());      // 25
System.out.println(tree.lower(15));   // 10 (меньше 15)
System.out.println(tree.higher(15));  // 20 (больше 15)
System.out.println(tree.floor(17));   // 15 (≤ 17)
System.out.println(tree.ceiling(17)); // 20 (≥ 17)
System.out.println(tree.subSet(10, 20));  // [10, 15]
```

### LinkedHashSet — порядок добавления

```java
Set<Integer> linkedSet = new LinkedHashSet<>();
linkedSet.add(30);
linkedSet.add(10);
linkedSet.add(20);

System.out.println(linkedSet);  // [30, 10, 20] — порядок добавления!
```

### Сравнение Set'ов

| | HashSet | TreeSet | LinkedHashSet |
|-|---------|---------|---------------|
| Порядок | Нет | Сортировка | Добавления |
| add/remove | **O(1)** | O(log n) | O(1) |
| contains | **O(1)** | O(log n) | O(1) |
| Допускает null | Да (один) | Нет* | Да (один) |
| Память | Средне | Больше | Больше |

*TreeSet требует сравнения, null нельзя сравнить

### Операции над множествами

```java
Set<Integer> set1 = new HashSet<>(List.of(1, 2, 3, 4));
Set<Integer> set2 = new HashSet<>(List.of(3, 4, 5, 6));

// Объединение (union): {1, 2, 3, 4, 5, 6}
Set<Integer> union = new HashSet<>(set1);
union.addAll(set2);

// Пересечение (intersection): {3, 4}
Set<Integer> intersection = new HashSet<>(set1);
intersection.retainAll(set2);

// Разность (difference): {1, 2}
Set<Integer> difference = new HashSet<>(set1);
difference.removeAll(set2);

// Симметрическая разность: {1, 2, 5, 6}
Set<Integer> symmetric = new HashSet<>(union);
symmetric.removeAll(intersection);
```

---

## Map: HashMap, TreeMap, LinkedHashMap

### Map — словарь "ключ -> значение"

```java
Map<String, Integer> ages = new HashMap<>();

// Добавление
ages.put("Миша", 25);
ages.put("Аня", 30);
ages.put("Миша", 26);  // Перезапишет! Ключи уникальны

// Получение
Integer mishaAge = ages.get("Миша");        // 26
Integer unknownAge = ages.get("Вася");      // null
int safeAge = ages.getOrDefault("Вася", 0); // 0

// Проверки
boolean hasKey = ages.containsKey("Миша");     // true
boolean hasValue = ages.containsValue(30);     // true

// Удаление
ages.remove("Аня");
ages.remove("Миша", 25);  // Удалит только если значение = 25

// Размер
int size = ages.size();
boolean empty = ages.isEmpty();
```

### Обход Map

```java
Map<String, Integer> map = new HashMap<>();
map.put("A", 1);
map.put("B", 2);
map.put("C", 3);

// 1. По ключам
for (String key : map.keySet()) {
    System.out.println(key + " -> " + map.get(key));
}

// 2. По значениям
for (Integer value : map.values()) {
    System.out.println(value);
}

// 3. По парам Entry (самый эффективный!)
for (Map.Entry<String, Integer> entry : map.entrySet()) {
    System.out.println(entry.getKey() + " -> " + entry.getValue());
}

// 4. forEach с лямбдой (Java 8+)
map.forEach((key, value) -> System.out.println(key + " -> " + value));
```

### HashMap vs TreeMap vs LinkedHashMap

| | HashMap | TreeMap | LinkedHashMap |
|-|---------|---------|---------------|
| Порядок ключей | Нет | Сортировка | Добавления |
| get/put | **O(1)** | O(log n) | O(1) |
| null-ключи | Да (один) | Нет | Да (один) |
| null-значения | Да | Да | Да |

### Полезные методы Map (Java 8+)

```java
Map<String, Integer> scores = new HashMap<>();

// putIfAbsent — добавить, только если ключа нет
scores.putIfAbsent("Миша", 100);
scores.putIfAbsent("Миша", 200);  // Не изменит, ключ уже есть
// scores = {Миша=100}

// computeIfAbsent — вычислить, если ключа нет
Map<String, List<String>> groups = new HashMap<>();
groups.computeIfAbsent("Группа А", k -> new ArrayList<>()).add("Миша");
groups.computeIfAbsent("Группа А", k -> new ArrayList<>()).add("Аня");
// groups = {Группа А=[Миша, Аня]}

// merge — объединить значения
scores.put("Миша", 100);
scores.merge("Миша", 50, Integer::sum);  // 100 + 50 = 150
scores.merge("Аня", 50, Integer::sum);   // Нет ключа, добавит 50

// compute — вычислить новое значение
scores.compute("Миша", (k, v) -> v == null ? 0 : v + 10);

// Получение значения или значения по умолчанию: getOrDefault
int score = scores.getOrDefault("Вася", 0);

// Замена существующего значения: replace
scores.replace("Миша", 200);  // Заменить, если ключ есть
scores.replace("Миша", 150, 200);  // Заменить, если ключ есть И значение = 150
```

### Подсчёт частоты элементов

```java
String[] words = {"apple", "banana", "apple", "cherry", "banana", "apple"};
Map<String, Integer> frequency = new HashMap<>();

// Способ 1: классический
for (String word : words) {
    if (frequency.containsKey(word)) {
        frequency.put(word, frequency.get(word) + 1);
    } else {
        frequency.put(word, 1);
    }
}

// Способ 2: getOrDefault
for (String word : words) {
    frequency.put(word, frequency.getOrDefault(word, 0) + 1);
}

// Способ 3: merge (самый элегантный)
for (String word : words) {
    frequency.merge(word, 1, Integer::sum);
}

// Способ 4: compute
for (String word : words) {
    frequency.compute(word, (k, v) -> v == null ? 1 : v + 1);
}
```

---

## Queue и Deque

### Queue — очередь (FIFO)

```
Добавление →  [A] [B] [C] [D]  → Извлечение
              tail        head
```

```java
Queue<String> queue = new LinkedList<>();

// Добавление (в конец)
queue.add("A");      // Исключение, если нет места
queue.offer("B");    // false, если нет места

// Просмотр головы (без удаления)
String head = queue.element();  // Исключение, если пусто
String headSafe = queue.peek(); // null, если пусто

// Извлечение (с удалением)
String removed = queue.remove();  // Исключение, если пусто
String removedSafe = queue.poll();  // null, если пусто
```

### Deque — двусторонняя очередь

```java
Deque<String> deque = new ArrayDeque<>();

// Добавление
deque.addFirst("A");   // В начало
deque.addLast("B");    // В конец
deque.offerFirst("X"); // В начало (безопасный)
deque.offerLast("Y");  // В конец (безопасный)

// Просмотр
deque.getFirst();   // Исключение, если пусто
deque.getLast();
deque.peekFirst();  // null, если пусто
deque.peekLast();

// Удаление
deque.removeFirst();
deque.removeLast();
deque.pollFirst();  // null, если пусто
deque.pollLast();

// Как стек (LIFO)
deque.push("A");    // = addFirst
deque.pop();        // = removeFirst
deque.peek();       // = peekFirst
```

### PriorityQueue — приоритетная очередь

```java
// По умолчанию — минимальный элемент первый
PriorityQueue<Integer> minHeap = new PriorityQueue<>();
minHeap.addAll(List.of(5, 2, 8, 1, 9));
System.out.println(minHeap.poll());  // 1
System.out.println(minHeap.poll());  // 2

// Максимальный элемент первый
PriorityQueue<Integer> maxHeap = new PriorityQueue<>(Comparator.reverseOrder());
maxHeap.addAll(List.of(5, 2, 8, 1, 9));
System.out.println(maxHeap.poll());  // 9
System.out.println(maxHeap.poll());  // 8
```

---

## Итераторы

### Зачем нужны?

Итератор — универсальный способ обхода с возможностью удаления:

```java
List<String> names = new ArrayList<>(List.of("Миша", "Аня", "Алексей", "Петя"));

// НЕПРАВИЛЬНО — ConcurrentModificationException!
for (String name : names) {
    if (name.startsWith("А")) {
        names.remove(name);
    }
}

// ПРАВИЛЬНО — с итератором можно удалять
Iterator<String> it = names.iterator();
while (it.hasNext()) {
    String name = it.next();
    if (name.startsWith("А")) {
        it.remove();  // Безопасное удаление
    }
}
```

### Методы Iterator

```java
Iterator<String> it = list.iterator();

boolean hasMore = it.hasNext();  // Есть ли ещё элементы?
String element = it.next();      // Получить следующий
it.remove();                     // Удалить текущий
it.forEachRemaining(System.out::println);  // Обработать оставшиеся
```

### ListIterator (для List)

```java
List<String> list = new ArrayList<>(List.of("A", "B", "C"));
ListIterator<String> lit = list.listIterator();

// Вперёд
while (lit.hasNext()) {
    int index = lit.nextIndex();
    String element = lit.next();
    System.out.println(index + ": " + element);
}

// Назад
while (lit.hasPrevious()) {
    int index = lit.previousIndex();
    String element = lit.previous();
    System.out.println(index + ": " + element);
}

// Модификация
lit = list.listIterator();
while (lit.hasNext()) {
    String s = lit.next();
    lit.set(s.toLowerCase());  // Заменить текущий
    lit.add("NEW");            // Добавить после текущего
}
```

---

## Comparable и Comparator

### Проблема: как сортировать объекты?

```java
class Person {
    String name;
    int age;
}

List<Person> people = new ArrayList<>();
Collections.sort(people);  // Ошибка! Как сравнивать Person?
```

### Comparable — "естественный" порядок

```java
class Person implements Comparable<Person> {
    String name;
    int age;
    
    public Person(String name, int age) {
        this.name = name;
        this.age = age;
    }
    
    @Override
    public int compareTo(Person other) {
        // Отрицательное: this < other
        // 0: this == other
        // Положительное: this > other
        return this.age - other.age;  // По возрасту
    }
}

List<Person> people = new ArrayList<>();
people.add(new Person("Миша", 25));
people.add(new Person("Аня", 30));
people.add(new Person("Петя", 22));

Collections.sort(people);  // Теперь работает!
// [Петя(22), Миша(25), Аня(30)]
```

### Comparator — альтернативная сортировка

```java
// Способ 1: Анонимный класс
Comparator<Person> byName = new Comparator<Person>() {
    @Override
    public int compare(Person p1, Person p2) {
        return p1.name.compareTo(p2.name);
    }
};

// Способ 2: Лямбда
Comparator<Person> byAge = (p1, p2) -> p1.age - p2.age;

// Способ 3: Comparator.comparing (лучший!)
Comparator<Person> byNameModern = Comparator.comparing(p -> p.name);
Comparator<Person> byAgeModern = Comparator.comparingInt(p -> p.age);

// Использование
people.sort(byName);
Collections.sort(people, byAge);
```

### Цепочка сортировок

```java
// Сначала по возрасту, потом по имени
Comparator<Person> complex = Comparator
    .comparingInt((Person p) -> p.age)
    .thenComparing(p -> p.name);

// Обратный порядок
Comparator<Person> reversed = Comparator
    .comparingInt((Person p) -> p.age)
    .reversed();

// Сравнение с учётом null
Comparator<Person> nullSafe = Comparator
    .comparing(Person::getName, Comparator.nullsLast(String::compareTo));
```

### Comparable vs Comparator

| Comparable | Comparator |
|------------|------------|
| Реализуется в классе | Отдельный объект |
| Один "естественный" порядок | Много разных сортировок |
| `compareTo(other)` | `compare(o1, o2)` |
| Изменяет класс | Не изменяет класс |

---

## Нюансы и подводные камни

### equals и hashCode для коллекций

```java
class Person {
    String name;
    int age;
    
    // ОБЯЗАТЕЛЬНО переопределить для HashSet/HashMap!
    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        Person person = (Person) o;
        return age == person.age && Objects.equals(name, person.name);
    }
    
    @Override
    public int hashCode() {
        return Objects.hash(name, age);
    }
}
```

### Изменение ключа HashMap

```java
// ОПАСНО! Изменение ключа после добавления
Map<Person, String> map = new HashMap<>();
Person key = new Person("Миша", 25);
map.put(key, "Значение");

key.age = 30;  // Изменили ключ!
System.out.println(map.get(key));  // null! Не найдёт, hashCode изменился

// Используй неизменяемые ключи (String, Integer, записи)
```

### ConcurrentModificationException

```java
List<Integer> list = new ArrayList<>(List.of(1, 2, 3, 4, 5));

// НЕПРАВИЛЬНО — ошибка!
for (Integer num : list) {
    if (num % 2 == 0) {
        list.remove(num);
    }
}

// ПРАВИЛЬНО, способ 1: Iterator
Iterator<Integer> it = list.iterator();
while (it.hasNext()) {
    if (it.next() % 2 == 0) {
        it.remove();
    }
}

// ПРАВИЛЬНО, способ 2: removeIf (Java 8+)
list.removeIf(num -> num % 2 == 0);

// ПРАВИЛЬНО, способ 3: обратный for
for (int i = list.size() - 1; i >= 0; i--) {
    if (list.get(i) % 2 == 0) {
        list.remove(i);
    }
}
```

### Выбор начальной ёмкости

```java
// Если знаешь размер — укажи!
List<String> list = new ArrayList<>(10000);
Set<String> set = new HashSet<>(10000);
Map<String, Integer> map = new HashMap<>(10000);

// Для HashMap: capacity = expectedSize / loadFactor + 1
// loadFactor по умолчанию = 0.75
int expectedSize = 1000;
int capacity = (int) (expectedSize / 0.75) + 1;
Map<String, Integer> optimizedMap = new HashMap<>(capacity);
```

---

## Задачи для практики

### Подсчёт слов

Подсчитай частоту каждого слова в тексте. Используй `HashMap` для хранения результата.

---

### Уникальные элементы с порядком

Удали дубликаты из списка, сохранив исходный порядок элементов.

---

### Телефонная книга

Создай телефонную книгу, где один человек может иметь несколько номеров. Реализуй методы: добавить номер, получить номера по имени, удалить конкретный номер, вывести все контакты.

---

### Топ-N слов

Найди N самых часто встречающихся слов в тексте. Верни их в виде списка.

---

### Группировка по первой букве

Сгруппируй слова по первой букве. Результат — `Map<Character, List<String>>`.

---

### LRU Cache

Реализуй LRU (Least Recently Used) кеш на основе `LinkedHashMap`. При превышении заданной ёмкости должен вытесняться наименее недавно использованный элемент.

---

### Удаление дубликатов

Напиши метод, который принимает `List` и возвращает новый список без дубликатов.

---

### Пересечение списков

Найди общие элементы двух списков.

---

### Инвертирование Map

Создай `Map`, где ключи и значения поменялись местами.
`{A=1, B=2}` -> `{1=A, 2=B}`

---

### Анаграммы

Сгруппируй слова-анаграммы (состоящие из одинаковых букв).
`["eat", "tea", "tan", "ate", "nat", "bat"]` -> `[[eat, tea, ate], [tan, nat], [bat]]`

---

### Два числа с заданной суммой

Найди два числа в массиве, сумма которых равна `target`. Используй `HashMap` для решения за O(n).

---

### Кеш с TTL

Реализуй кеш с временем жизни (Time To Live). Элементы, которые хранятся дольше заданного времени, должны считаться устаревшими.

---

### Свой ArrayList

Реализуй упрощённый `ArrayList` с методами `add`, `get`, `remove`, `size`. Внутри используй обычный массив с расширением при нехватке места.

---

### Группировка людей

Есть список объектов `Person(name, age)`. Сгруппируй их по возрасту в `Map<Integer, List<Person>>`.

---

### Two Sum

Дан массив целых чисел `nums` и число `target`. Верни индексы двух элементов, сумма которых равна `target`.

```java
// twoSum([2, 7, 11, 15], 9) => [0, 1]
```
