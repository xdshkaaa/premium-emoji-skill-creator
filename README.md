# premium-skill-tg

Telegram bot that turns a Telegram premium (custom) emoji pack into an installable
Claude Code agent skill. Send it a `t.me/addemoji/...` link or a message containing
premium emoji; it publishes a skill (`SKILL.md` + `references/emoji-catalog.md`) —
a flat catalog of fallback char, emoji id, and ready `<tg-emoji>` snippet, no AI
description/categorization step — to a public GitHub repo and replies with an
`npx skills add ...` install command.

## One-time setup

1. Create a public GitHub repo to hold generated skills (e.g. `you/telegram-emoji-skills`),
   with a `main` branch containing at least one commit (empty is fine — `git init && git commit --allow-empty -m init && git push`).
   The bot never creates the repo itself, only commits into it.
2. Create a GitHub token (classic or fine-grained) with `contents:write` on that repo.
3. Create a Telegram bot via [@BotFather](https://t.me/BotFather), get `BOT_TOKEN`.
4. Copy `.env.example` to `.env` and fill in all values.

```
BOT_TOKEN=
GITHUB_TOKEN=
GITHUB_SKILLS_REPO=owner/repo
DB_PATH=data/bot.sqlite
```

5. (Optional, for AI color picking on recolor) set `AI_API_KEY` — the button is hidden
   without it. Recolor also needs `ffmpeg`/`ffprobe` on `$PATH` for video (webm) emoji;
   without them video emoji are skipped and reported, static/animated still work.
6. (Optional, faster parallel pack uploads) `WORKER_BOT_TOKENS=token1,token2,...` —
   helper bots created via @BotFather. Telegram caps sticker-set writes at
   ~1.5/min **per bot token**, so each worker adds that much parallel capacity.
   A worker can only create packs for users who pressed /start on it (the master
   bot suggests this after a finished pack); pack links become `_by_<worker>`.

## Run locally

```
npm install
npm run dev     # tsx watch, auto-restart
# or
npm start        # tsx, no watch
```

No build step, no webhook server — long polling only.

## Deploy (systemd, `root@103.214.69.38`)

```bash
ssh root@103.214.69.38
node -v            # need Node 22+ (built-in node:sqlite, no native build)
mkdir -p /opt/premium-skill-tg
# from your machine: rsync -av --exclude node_modules --exclude data --exclude .env \
#   ./ root@103.214.69.38:/opt/premium-skill-tg/
cd /opt/premium-skill-tg
npm ci
vim .env            # fill in real values, see above
```

`/etc/systemd/system/premium-skill-tg.service`:

```ini
[Unit]
Description=premium-skill-tg bot
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/premium-skill-tg
EnvironmentFile=/opt/premium-skill-tg/.env
ExecStart=/usr/bin/env npx tsx src/index.ts
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now premium-skill-tg
systemctl status premium-skill-tg
journalctl -u premium-skill-tg -f
```

Long polling — no inbound ports, no nginx needed.

## Notes

- Storage: SQLite via Node's built-in `node:sqlite` (Node 22.5+), no native compile step —
  this is why `better-sqlite3` isn't used (its prebuilt binaries lag behind newest Node ABIs).
- Recolor uses `sharp` (native dependency, prebuilt binary installed via npm) for static
  webp/png emoji, a pure JS Lottie-JSON walker for `.tgs`, and shells out to `ffmpeg`/`ffprobe`
  for `.webm` video emoji.
- Generated skill files are fully re-rendered from the database on every publish
  (never hand-patched), so merging a second pack into an existing skill is deterministic.
- The bot discloses, once per user before the first publish, that the pack name and
  Telegram user id become part of a public GitHub path.
