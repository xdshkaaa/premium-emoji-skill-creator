# Спека: языковые модули эмодзи (Go / Python / TypeScript)

## Цель

Сейчас скилл даёт только Markdown-каталог (`references/emoji-catalog.md`) со
сниппетами `<tg-emoji>`. Разработчику, который пишет юзербота/клиента на Go,
Python или TypeScript, приходится копировать ID руками. Добавляем к каждому
скиллу готовые к копированию кодовые модули с картой эмодзи и хелпером
форматирования — по одному файлу на язык.

## Что генерируется

Три новых файла в каждом скилле, рядом с каталогом:

```
skills/<slug>/
  SKILL.md
  references/
    emoji-catalog.md
    lib/
      emoji.go
      emoji.py
      emoji.ts
```

Файлы самодостаточны: без зависимостей, без импортов из проекта, копируются в
любой кодбейс как есть. Никакого AI-шага — чистая генерация из тех же
`EmojiRow[]`, что и каталог.

## Общий контракт (одинаков для всех трёх языков)

Каждый модуль обязан содержать:

1. **Шапка-комментарий**: название пака, количество эмодзи, пометка
   "generated, do not edit", дата не пишется (детерминизм коммитов).
2. **Карта `EMOJI`**: fallback-символ → список ID. Список, потому что
   несколько кастомных эмодзи могут иметь один fallback. Ключи и значения —
   строки: `custom_emoji_id` в Bot API — строка, и она длиннее безопасного
   диапазона JS-number; во всех языках храним как string, никогда как число.
3. **Хелпер `tg_emoji(id, fallback)`** (имя по конвенции языка): возвращает
   строку `<tg-emoji emoji-id="ID">FALLBACK</tg-emoji>`, экранируя fallback
   для HTML (`&`, `<`, `>`, `"`). ID не экранируется — он валидируется
   (только цифры), при невалидном ID хелпер кидает ошибку/panic не нужен:
   просто вставляет как есть, валидация — на этапе генерации (см. ниже).
4. **Порядок записей**: сортировка по `custom_emoji_id` (localeCompare /
   лексикографически) — та же, что в `renderCatalog`, чтобы повторная
   публикация того же набора давала байт-в-байт идентичный файл и пустой
   diff.
5. **Напоминание в комментарии**: работает только с `parse_mode=HTML`;
   кастомные эмодзи рендерятся только от Premium-аккаунта или канала, обычный
   бот через Bot API их не отправит.

Генератор (не модуль) валидирует каждый `custom_emoji_id` регэкспом
`^\d+$` и каждый fallback на отсутствие `"`, `\`, переводов строк; при
провале — пропускает строку и пишет `console.warn` (в файл не попадает
мусор, публикация не падает).

## Go — `references/lib/emoji.go`

- Пакет: всегда `package emoji` (slug содержит цифры/дефисы — в имя пакета
  не годится; пользователь переименует при копировании, комментарий об этом
  в шапке).
- Карта: `var Emoji = map[string][]string{ ... }`, ключи — fallback-символы.
- Хелпер:

```go
// Package emoji: generated from Telegram pack "<TITLE>" (<N> emoji).
// Copy into your project; rename the package if needed. Do not edit by hand.
//
// Rendering requires parse_mode=HTML. Custom emoji display only when sent
// from a Telegram Premium account (or an eligible channel), not via a
// regular bot through the Bot API.
package emoji

import "html"

// Emoji maps a fallback character to the custom emoji IDs that use it.
var Emoji = map[string][]string{
	"🔥": {"5368324170671202286"},
	// ...
}

// TgEmoji returns the <tg-emoji> HTML tag for parse_mode=HTML messages.
func TgEmoji(id, fallback string) string {
	return `<tg-emoji emoji-id="` + id + `">` + html.EscapeString(fallback) + `</tg-emoji>`
}
```

- Только stdlib (`html`). Табы для отступов (gofmt-совместимо). Строки в
  двойных кавычках; эмодзи-символы вставляются как есть (UTF-8), без
  `\u`-эскейпов.

## Python — `references/lib/emoji.py`

- Модуль без зависимостей, только stdlib `html`. Python ≥ 3.9 (generic-типы
  в аннотациях через `dict[str, list[str]]` — это 3.9+).
- Снейк-кейс по PEP 8:

```python
"""Generated from Telegram pack "<TITLE>" (<N> emoji). Do not edit by hand.

Rendering requires parse_mode=HTML. Custom emoji display only when sent
from a Telegram Premium account (or an eligible channel), not via a
regular bot through the Bot API.
"""

from html import escape

EMOJI: dict[str, list[str]] = {
    "🔥": ["5368324170671202286"],
    # ...
}


def tg_emoji(emoji_id: str, fallback: str) -> str:
    """Return the <tg-emoji> HTML tag for parse_mode=HTML messages."""
    return f'<tg-emoji emoji-id="{emoji_id}">{escape(fallback)}</tg-emoji>'
```

- 4 пробела отступ, двойные кавычки, финальный перевод строки.

## TypeScript — `references/lib/emoji.ts`

- ESM, без зависимостей, без DOM/Node-специфики (работает и в браузере,
  и в Node, и в Deno/Bun).
- Экранирование HTML — своя мини-функция (в JS нет stdlib-эквивалента):

```ts
/**
 * Generated from Telegram pack "<TITLE>" (<N> emoji). Do not edit by hand.
 *
 * Rendering requires parse_mode=HTML. Custom emoji display only when sent
 * from a Telegram Premium account (or an eligible channel), not via a
 * regular bot through the Bot API.
 */

/** Maps a fallback character to the custom emoji IDs that use it. */
export const EMOJI: Record<string, readonly string[]> = {
  "🔥": ["5368324170671202286"],
  // ...
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Returns the <tg-emoji> HTML tag for parse_mode=HTML messages. */
export function tgEmoji(id: string, fallback: string): string {
  return `<tg-emoji emoji-id="${id}">${escapeHtml(fallback)}</tg-emoji>`;
}
```

- 2 пробела отступ, двойные кавычки — как в остальном репо.

## Изменения в SKILL.md

В `renderSkillMd` (src/skill/template.ts) после секции «Catalog» добавить:

```md
## Code modules

Ready-to-copy maps of fallback → emoji IDs with a `tg-emoji` helper:

- Go: [references/lib/emoji.go](references/lib/emoji.go)
- Python: [references/lib/emoji.py](references/lib/emoji.py)
- TypeScript: [references/lib/emoji.ts](references/lib/emoji.ts)
```

## Имплементация в боте

Затрагиваются 3 файла, БД и миграции не трогаем.

1. **Новый `src/skill/langModules.ts`** — единственное место генерации:

```ts
import type { EmojiRow, SkillRow } from "../db/repo.js";
import type { PublishFile } from "../publish/github.js";

export function renderLangModules(skill: SkillRow, emojis: EmojiRow[]): PublishFile[];
// внутри: sortByEmojiId → validate → buildFallbackMap (Map<string, string[]>)
// → renderGo / renderPython / renderTypeScript, каждая — чистая функция
// (map, title, count) => string
```

2. **`src/skill/template.ts`** — секция «Code modules» (см. выше).

3. **`src/bot/flow/buildSkill.ts`** — в обоих местах вызова `publishFiles`
   (в `runPack` и в `retryPublish`) расширить массив:

```ts
const files = [
  { path: `${skillRow.github_path}/SKILL.md`, content: skillMd },
  { path: `${skillRow.github_path}/references/emoji-catalog.md`, content: catalogMd },
  ...renderLangModules(skillRow, allEmojis).map((f) => ({
    ...f,
    path: `${skillRow.github_path}/${f.path}`,
  })),
];
```

`renderLangModules` возвращает пути относительно корня скилла
(`references/lib/emoji.go` и т.д.), префикс добавляет вызывающий — так же,
как сейчас с каталогом. `publishFiles` уже коммитит массив атомарно,
менять его не нужно.

## Эскейпинг в самих генераторах

- `title` пака попадает в комментарий/докстринг: вырезать `*/` (Go/TS
  block-comment breaker), `"""` (Python), переводы строк → пробел.
- Fallback внутри строкового литерала: экранировать `\` и кавычку
  соответствующего языка (двойную во всех трёх). Эмодзи-символы — как есть.

## Приёмка

- [ ] Новый пак → в репо 5 файлов, один коммит.
- [ ] Повторный `retryPublish` без изменений → файлы байт-в-байт те же.
- [ ] Пак с двумя эмодзи на один fallback → оба ID в одном списке.
- [ ] `gofmt -l emoji.go` пусто; `python -c "import emoji"` без ошибок;
      `tsc --noEmit emoji.ts` (strict) без ошибок — проверить на паке
      Unigram (119 эмодзи) вручную один раз.
- [ ] Fallback `"` или `\` (гипотетический) не ломает синтаксис модулей.
- [ ] SKILL.md ссылается на все три файла, ссылки кликабельны на GitHub.

## Вне скоупа

- Пакеты для менеджеров зависимостей (go module, PyPI, npm) — не публикуем,
  только copy-paste файлы.
- Именованные константы per-emoji (нет человекочитаемых имён у эмодзи,
  только fallback-символ) — ключ карты остаётся fallback-символом.
- Другие языки (Rust, Kotlin и т.д.) — добавляются новой чистой функцией в
  `langModules.ts` по тому же контракту.
