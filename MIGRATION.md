# Splitting into `iron-claude-pro` (private) and `iron-claude-git-backing` (public)

This branch is ready to become the initial commit on a new private repo
called `iron-claude-pro`. The current repo (`iron-claude`) gets renamed
to `iron-claude-git-backing` and flipped to public as a reference
implementation of the original GitHub-backed version.

Estimated total time: ~15 minutes.

---

## Step 1 — Create the empty private repo on GitHub

1. Go to https://github.com/new
2. Repository name: **`iron-claude-pro`**
3. Owner: **`mosnicholas`**
4. Visibility: **Private**
5. Do NOT initialize with a README, .gitignore, or license — leave it empty
6. Create repository

Don't add any files via the web UI. Step 2 pushes everything.

---

## Step 2 — Push this branch as the new `main`

From the host that has this repo cloned (locally on your machine, not in
this container — you need real SSH credentials to GitHub):

```bash
# Run the migration script
./scripts/migrate-to-new-repo.sh
```

The script does this:

```bash
git fetch origin
git checkout claude/github-to-db-migration-KHB09
git pull origin claude/github-to-db-migration-KHB09

# Create a new local clone in a sibling dir
cd ..
git clone --branch claude/github-to-db-migration-KHB09 \
  git@github.com:mosnicholas/iron-claude.git iron-claude-pro
cd iron-claude-pro

# Repoint origin at the new private repo
git remote set-url origin git@github.com:mosnicholas/iron-claude-pro.git

# Make this branch the new main and push
git branch -m claude/github-to-db-migration-KHB09 main
git push -u origin main
```

After this, `mosnicholas/iron-claude-pro` has a `main` branch with all
23 commits of history.

---

## Step 3 — Configure the new repo's GitHub Actions secrets

In `https://github.com/mosnicholas/iron-claude-pro/settings/secrets/actions`,
add the secrets the workflows need:

| Secret                       | Required for                              |
|------------------------------|-------------------------------------------|
| `FLY_API_TOKEN`              | `.github/workflows/deploy.yml`            |
| `ANTHROPIC_API_KEY`          | `main-ci.yml` scenario tests              |
| `TELEGRAM_BOT_TOKEN`         | optional — deploy notification            |
| `TELEGRAM_ALERT_CHAT_ID`     | optional — deploy notification target     |

You can copy the values from the existing `iron-claude` repo's settings
page if they're the same Fly app + bot.

Also: in `https://github.com/mosnicholas/iron-claude-pro/settings/variables/actions`,
set `ENABLE_FLY_DEPLOY=true` if you want auto-deploys on push to main.

---

## Step 4 — Rename + flip the old repo to public

1. Go to https://github.com/mosnicholas/iron-claude/settings
2. **Repository name** → change to `iron-claude-git-backing` → Rename
3. Scroll to **Danger Zone** → **Change visibility** → **Public**
4. Confirm by typing the new name

After renaming, the old URL `mosnicholas/iron-claude` automatically
redirects to the new name on GitHub.

Then update the old repo's README to reflect its new role:

```bash
# In the OLD repo (now at git@github.com:mosnicholas/iron-claude-git-backing.git)
git checkout main
# Edit README to add the banner:
#   "> ## Reference implementation
#   > This is the original single-user, GitHub-backed implementation of IronClaude.
#   > Active commercial development happens in a private repo; this version is
#   > preserved here under MIT for self-hosters who want a simple personal coach."
git commit -am "Reposition as public reference implementation"
git push

# Tag the last commit as v1.0.0 for archeology
git tag v1.0.0
git push origin v1.0.0

# Delete the dev branch — it lives in iron-claude-pro now
git push origin --delete claude/github-to-db-migration-KHB09
```

---

## Step 5 — Point Fly + Telegram + Supabase at the new repo

If you want a fresh Fly app for the pro version:

```bash
cd iron-claude-pro
fly launch --no-deploy   # creates a new fly.toml app
fly secrets set \
  DATABASE_URL=... \
  ANTHROPIC_API_KEY=... \
  TELEGRAM_BOT_TOKEN=... \
  TELEGRAM_WEBHOOK_SECRET=... \
  SUPABASE_URL=... \
  SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=... \
  INTEGRATION_TOKEN_KEY=... \
  SESSION_SECRET=... \
  CRON_SECRET=... \
  TIMEZONE=America/New_York
fly deploy
```

If you want to keep the existing Fly app and just have it deploy from
the new repo: no changes needed in Fly itself, just confirm
`FLY_API_TOKEN` is set in the new repo's GitHub Actions secrets and
that `fly.toml` in the new repo points at the right app name.

After deploy, update the Telegram webhook to point at the production
URL: `npm run set-webhook` (or `curl` it manually if `set-webhook` isn't
in this branch).

Supabase: no change needed. Same project can back both repos.

---

## Step 6 — Verify

In the new `iron-claude-pro` repo:

1. **CI passes** on `main` (Actions tab)
2. **Fly app boots** (`fly logs` shows migrations applied + server listening)
3. **`/health` returns** `{ ok: true, backlog: 0 }`
4. **Telegram message round-trip** — message your bot, expect a response
5. **`grant-tier` works** — comp yourself: `fly ssh console -C "npm run grant-tier -- --phone +1... --tier athlete"`

---

## Rollback

If anything goes sideways:

- The old repo still has the pre-migration `main` branch intact
- The `claude/github-to-db-migration-KHB09` branch on the old repo
  (before you delete it in Step 4) preserves the full migration history
- You can revert the rename in GitHub Settings within ~90 days

Nothing about this split is destructive until Step 4's branch delete.
