# Admin panel design (2026-07-16)

## Access
- New env `ADMIN_TG_ID` (optional, coerced number). Unset = admin panel disabled.
- `/admin` command + `admin:*` callbacks. Guard: `ctx.from.id === config.ADMIN_TG_ID`; silently ignore others.

## Metrics screen (`/admin`, `admin:stats`)
- Totals: users / skills / packs / emojis.
- New users & skills for last 24h and 7d (`created_at`).
- Skills with `published_sha IS NULL` (stuck publications).
- Top 5 users by skill count.

## Skills management (`admin:skills`)
- Last 15 skills: title, slug, owner (@username or id), publish status.
- Tap skill -> card with details + "Delete" -> confirm -> transactional DB delete (emojis, packs, skill). GitHub files untouched (out of scope).

## Files
- `src/db/adminRepo.ts` — metric aggregates, skill list with owner, cascade delete.
- `src/bot/handlers/admin.ts` — command, keyboards, callbacks (style of start.ts).
- Edits: `src/config.ts` (+ADMIN_TG_ID), `src/bot/bot.ts` (+registerAdminHandlers).
- No migrations needed.
