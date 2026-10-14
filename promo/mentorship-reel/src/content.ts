// Весь текст ролика. Не больше 7 слов на экране одновременно, без цифр, кроме «10 лет» из брифа.
// Разметка: *слово* — мятный акцент (путь с наставником), ~слово~ — серое выделение (сцены «боли»).
export const COPY = {
  hook: ["Только начинаешь *в IT?*", "Или *застрял* на рабочей задаче?"],
  pain: [
    // В брифе: «Тонешь в курсах и не знаешь, что учить» — 8 слов; «и» убрано ради лимита в 7 слов.
    "Тонешь ~в курсах~, не знаешь, что учить",
    "Задача ~горит~, а решения нет",
    "И ~не у кого~ спросить",
  ],
  name: "Я — *Георгий*",
  role: "fullstack · 10 лет",
  upper: {
    title: "С нуля → *готов к собеседованиям*",
    stages: ["план", "практика", "собеседование"],
  },
  lower: {
    title: "Рабочая задача → *решение*",
    stages: ["разбор", "решение", "объяснение"],
  },
  steps: ["*Рассказываешь* ситуацию", "Разбираем *вместе*", "Уходишь *с решением* и планом"],
  stepNumbers: ["01", "02", "03"],
  format: {
    title: "Занятия онлайн, *1 на 1*",
    stack: ["Java", "Spring", "Angular"],
  },
  // Ролик для объявления на Авито: по правилам площадки в видео нельзя упоминать соцсети, мессенджеры
  // и сторонние ресурсы, поэтому призыв ведёт к кнопке «Написать» в самом объявлении.
  cta: {
    headline: "Напиши мне — *разберём* твою ситуацию",
    action: "жми «Написать»",
    /** Карточка под линией в квадратном формате: кому писать и с чем. */
    card: { name: "Георгий", stack: "Java · Spring · Angular" },
  },
  /** Иллюстрации к сценам «боли». Мелкий моноширинный текст — фактура, а не главная мысль. */
  props: {
    tabs: [
      ["Java с нуля", "3%"],
      ["Spring Boot за неделю", "0%"],
      ["Angular для начинающих", "12%"],
      ["Алгоритмы", "0%"],
      ["SQL с нуля", "5%"],
      ["Docker за выходные", "1%"],
    ],
    terminal: ["$ ./mvnw spring-boot:run", "[ERROR] APPLICATION FAILED TO START", "NoSuchBeanDefinitionException", "дедлайн: сегодня, 18:00"],
    chat: { message: "Кто-нибудь сталкивался с такой ошибкой?", time: "23:47", status: "прочитано · 0 ответов" },
  },
} as const;

/** Неразрывные пробелы: короткие слова и тире не остаются в конце строки. Маркеры *~ не мешают. */
export const typograph = (text: string): string =>
  text.replace(/(?<=^|[\s *~])([А-Яа-яЁё]{1,2}) /g, "$1 ").replace(/ —/g, " —");

export type Tone = "plain" | "accent" | "mark";
export type Token = { parts: { text: string; tone: Tone }[]; arrow: boolean };

/**
 * Делит фразу на слова для пословного появления. Слова, склеенные неразрывным пробелом, идут одним блоком;
 * стрелка «→» прикрепляется к предыдущему слову, чтобы не отрываться от него при переносе.
 */
export const tokenize = (text: string): Token[] => {
  const tokens: Token[] = [];
  let tone: Tone = "plain";
  for (const word of typograph(text).split(" ")) {
    if (word === "→") {
      if (tokens.length) tokens[tokens.length - 1].arrow = true;
      continue;
    }
    const parts: Token["parts"] = [];
    let buf = "";
    for (const ch of word) {
      if (ch === "*" || ch === "~") {
        if (buf) parts.push({ text: buf, tone });
        buf = "";
        const next: Tone = ch === "*" ? "accent" : "mark";
        tone = tone === next ? "plain" : next;
      } else buf += ch;
    }
    if (buf) parts.push({ text: buf, tone });
    if (parts.length) tokens.push({ parts, arrow: false });
  }
  return tokens;
};
