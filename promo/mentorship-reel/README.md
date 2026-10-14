# Ролик «Наставничество в IT» — Remotion-проект

Ролик для объявления на Авито: квадрат 1080×1080, 30 fps, 39,3 с, без звука. Есть и вертикальная версия 1080×1920 для Reels/Shorts — тот же код, другая раскладка (`format: "vertical"` в props; размеры — `LAYOUT` в `src/theme.ts`). Ограничения площадки — в начале STORYBOARD.md. Раскадровка, закадровый текст и бриф для музыки собраны в [STORYBOARD.md](STORYBOARD.md).

Готовые файлы: `out/mentorship-reel-1x1.mp4` (Авито) и `out/mentorship-reel-9x16.mp4` (вертикаль). Папка `out/` не попадает в Git.

## Установка

Нужен Node.js 18 или новее и доступ в интернет: при первом рендере Remotion скачивает Chrome Headless Shell, а шрифты загружаются с Google Fonts.

```bash
cd promo/mentorship-reel
npm install
```

## Просмотр и правки

```bash
npm run studio
```

Откроется Remotion Studio в браузере. В панели props включите `showSafeZones`: красным подсветятся поля вне зоны ключевого текста (в вертикали — интерфейс Reels/Shorts). Вертикальная раскладка — `{"format":"vertical"}` в props.

Где что менять:

| Что | Файл |
|---|---|
| Тексты и выделение слов (`*мята*`, `~серая плашка~`) | `src/content.ts` |
| Тайминг (в долях такта, 110 BPM) | `src/timeline.ts`, ключи движения — в `src/components/Journey.tsx` |
| Цвета, шрифты, размеры, безопасные зоны | `src/theme.ts` |
| Форма линии и маршрутов | `src/paths.ts` |
| Свет, дождь, искры, зерно | `src/components/Background.tsx` |
| Иллюстрации боли (вкладки, терминал, чат) | `src/components/PainProps.tsx` |
| Фото и аватар | `public/mentor.png`, `src/components/Portrait.tsx` |

## Экспорт в MP4

```bash
npm run render
```

Результат: `out/mentorship-reel-1x1.mp4` — H.264, yuv420p, BT.709, CRF 16. Вертикальная версия: `npm run render:vertical` → `out/mentorship-reel-9x16.mp4`. Контрольные кадры вертикали: `node scripts/stills.mjs --vertical`.

Контрольная версия с разметкой безопасных зон:

```bash
npm run render:safe
```

Кадр для обложки (финальный CTA) — `out/cover.png`:

```bash
npm run cover
```

Контрольные кадры всех смысловых моментов с разметкой безопасных зон — в `out/stills/`:

```bash
npm run stills
```

## Аватарка Telegram

Отдельная композиция `TelegramAvatar` (`src/avatar/TelegramAvatar.tsx`): «как в Матрице» — реальность → код → реальность. 800×800, 30 fps, 6 с, бесшовный цикл, без звука. Фото — неподвижный нижний слой, лицо не перерисовывается. С 0,5 с струи дождя сами превращаются в светящиеся цепочки символов и замедляются; с 0,8 с колонки цифрового дождя сверху вниз «съедают» кадр, и на месте фото остаётся лицо из символов кода (яркость символа — яркость фото в этой клетке). Пока лицо из кода, по колонкам «пишутся» слова из стека — `@Autowired`, `Spring`, `Java`, `Kafka`, `Angular` (массив `WORDS`). Около 3,5 с вторая волна возвращает фото, цепочки символов снова вытягиваются в дождь. Первый и последний кадры — фото с обычным дождём. Цвет кода — `CODE_COLOR` (мятный из ролика; для классической «Матрицы» — `#00FF41`), тайминг — объект `T`.

Исходник `public/mentor.png` (640×640) увеличен до `public/mentor-800.png` классическим Lanczos, без нейросетевого апскейла:

```bash
ffmpeg -i public/mentor.png -vf "scale=800:800:flags=lanczos" public/mentor-800.png
```

```bash
npm run avatar        # out/telegram-avatar.mp4
npm run avatar:cover  # out/telegram-avatar-cover.png — кадр 1,4 с: половина фото, половина кода
```

При загрузке видео-аватарки Telegram предлагает выбрать кадр-обложку. Рекомендуемый — около 1,4 с: лицо узнаётся даже в кружке 50 px, а код уже виден. Сравнение кандидатов в кружках 160 и 50 px — `out/cover-candidates/compare.png`.

## Как добавить музыку и голос

Рендер намеренно без звука. Музыку на 110 BPM поставьте первой долей на 0:00: смены сцен попадают на начало такта, отметки акцентов — в STORYBOARD.md. Свести можно в CapCut или DaVinci Resolve. Можно и в Remotion: положите файл в `public/music.mp3` и добавьте в `src/MentorshipReel.tsx` компонент `<Audio src={staticFile("music.mp3")} />` из пакета `remotion`.

## Лицензии

- Remotion бесплатен для частных лиц и компаний до 3 человек; для компании больше нужна лицензия.
- Шрифты Unbounded и JetBrains Mono распространяются под SIL Open Font License.
