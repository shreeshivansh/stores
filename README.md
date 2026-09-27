# Shree Shivansh Stores

A PWA inventory/billing app for Shree Shivansh Stores, built on React + Vite + Supabase, deployed to GitHub Pages.

## Stack

- React 18 + TypeScript + Vite, Tailwind CSS, PWA (via `vite-plugin-pwa`)
- Supabase (Postgres, Auth, RLS) as backend
- GitHub Actions → GitHub Pages for hosting

## Prerequisites

- Node.js 20+
- A Supabase project (free tier is fine)
- Python 3.10+ (only for the XLSM migration script)
- `psql` and a local Postgres (only if you want to run the pgTAP suite locally)

## 1. Clone & install

```bash
git clone <this-repo-url>
cd shivansh-stores
npm ci
```

## 2. Environment variables

```bash
cp .env.example .env.local
```

Fill in from your Supabase dashboard (**Project Settings → API**):

| Variable | Value |
|---|---|
| `VITE_SUPABASE_URL` | Project URL, e.g. `https://xxxx.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | The public `anon` key |
| `VITE_BASE_PATH` | Leave unset for GitHub Pages project sites. Set to `/` for a custom domain or user/org root site. |

The anon key is safe to ship in the built frontend — every table is protected by Row Level Security (see `supabase/migrations/0003_rls_policies.sql`). **Never** put the `service_role` key in `.env.local`, any `VITE_` variable, or anywhere under `src/`.

## 3. Set up the Supabase project

In the Supabase SQL Editor (or via `supabase db push` if you use the Supabase CLI), run the 5 migrations **in order**:

```
supabase/migrations/0001_schema.sql
supabase/migrations/0002_views.sql
supabase/migrations/0003_rls_policies.sql
supabase/migrations/0004_functions.sql
supabase/migrations/0005_seed_settings.sql
```

Do **not** run `supabase/tests/00_supabase_shim.sql` against a real Supabase project — it exists only to fake Supabase's `auth` schema/roles on a bare local Postgres for testing (see below). Supabase already provides all of that.

### Bootstrapping the first admin

New users get a `profiles` row with `role = 'client'` automatically (`handle_new_user()` trigger). Promoting to admin is normally done via the `set_user_role()` RPC, but that function requires the caller to *already* be an admin — so the very first admin must be set directly in SQL, once:

1. Sign up normally through the app (or Supabase Auth dashboard) with the account that should be admin.
2. In the Supabase SQL Editor, run:

   ```sql
   update profiles set role = 'admin' where id =
     (select id from auth.users where email = 'you@example.com');
   ```

3. From then on, that admin can promote/demote other users from within the app (which calls `set_user_role()`), and every promotion is audit-logged.

## 4. Run the app locally

```bash
npm run dev
```

## 5. Frontend tests

```bash
npm test          # vitest run
npm run test:watch
npx tsc -b --noEmit   # type-check
```

## 6. Running the pgTAP suite locally

The pgTAP tests (`supabase/tests/database.test.sql`) exercise the schema, RLS policies and RPCs against a real Postgres. Because they don't run inside Supabase itself, `supabase/tests/00_supabase_shim.sql` first fakes the minimum bit of Supabase's environment (the `anon`/`authenticated`/`service_role` roles, an `auth.users` table, and `auth.uid()`/`auth.role()`) on a plain Postgres instance.

Against a local Postgres with the `pgtap` extension available:

```bash
createdb shivansh_test
psql shivansh_test -f supabase/tests/00_supabase_shim.sql
psql shivansh_test -f supabase/migrations/0001_schema.sql
psql shivansh_test -f supabase/migrations/0002_views.sql
psql shivansh_test -f supabase/migrations/0003_rls_policies.sql
psql shivansh_test -f supabase/migrations/0004_functions.sql
psql shivansh_test -f supabase/migrations/0005_seed_settings.sql
psql shivansh_test -f supabase/tests/database.test.sql
```

Or, with `pg_prove` installed, swap the last line for:

```bash
pg_prove -d shivansh_test supabase/tests/database.test.sql
```

This exact sequence is what CI runs on every push (see `.github/workflows/deploy.yml`).

> **If you edit `0003_rls_policies.sql` or `0004_functions.sql`:** always rerun this full sequence against a *fresh* database afterward. Grants and RLS policies fail silently in ways that only show up under pgTAP, not in normal app usage.

## 7. Importing data from the old XLSM workbook

`scripts/migrate_xlsm.py` migrates the legacy `Shree_Shivansh_Stores_Final.xlsm` workbook into Supabase. It always reads computed values (never raw formulas) and validates before writing.

```bash
cd scripts
pip install openpyxl requests

# 1. Dry run first — validates and reports, writes nothing:
python3 migrate_xlsm.py --file Shree_Shivansh_Stores_Final.xlsm --dry-run

# 2. Review migration_report.json / migration_dry_run_output.txt, then commit:
export SUPABASE_URL=https://xxxx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=...   # service role key — server-side only, never commit it
python3 migrate_xlsm.py --file Shree_Shivansh_Stores_Final.xlsm --commit
```

The script authenticates with the `service_role` key, which bypasses RLS, so it must only ever be run from your own machine or a trusted CI secret — never exposed to the frontend.

Script unit tests:

```bash
cd scripts
python3 -m pytest tests/
```

## 8. Deployment (GitHub Pages)

`.github/workflows/deploy.yml` handles CI/CD on every push to `main`:

1. **test** — `npm test`, `tsc --noEmit`, and the pgTAP suite (against a Postgres service container).
2. **build** — `npm run build`, copies `public/404.html` to `dist/404.html` for SPA routing fallback, uploads the Pages artifact.
3. **deploy** — publishes to GitHub Pages.

Setup steps:

1. In your GitHub repo, go to **Settings → Pages** and set the source to "GitHub Actions".
2. Add repo secrets: **Settings → Secrets and variables → Actions → New repository secret**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
3. (Optional) If deploying to a custom domain or a user/org root site instead of a project site, add a repo **variable** `VITE_BASE_PATH` set to `/`.
4. Push to `main` — the workflow runs automatically. You can also trigger it manually via **Actions → Deploy to GitHub Pages → Run workflow**.

## 9. Installing the PWA

Once deployed, the app is installable:

- **Desktop (Chrome/Edge):** click the install icon in the address bar, or menu → "Install Shree Shivansh Stores".
- **Android (Chrome):** menu → "Add to Home screen" / "Install app".
- **iOS (Safari):** Share button → "Add to Home Screen".

The app then launches standalone (no browser chrome) and works offline for previously visited pages, via the service worker registered through `vite-plugin-pwa`.

## Future extension points

- **Multi-store support** — schema currently assumes a single store; `store_id` scoping would need to be added to core tables + RLS policies if that changes.
- **Offline write queue** — the PWA currently caches for offline *reads*; queuing writes (sales, stock adjustments) made while offline for later sync is a natural next step.
- **Reporting** — `supabase/migrations/0002_views.sql` has the aggregate views used by current reports; new reports should extend that file rather than querying raw tables from the frontend.
- **Role model** — `app_role` (in `0001_schema.sql`) currently has `client`/`admin`; additional roles (e.g. a cashier-only role) should be added as an enum value plus corresponding RLS policy updates in `0003_rls_policies.sql`.
- **CI** — the pgTAP job spins up a fresh Postgres service container per run; if the migration set grows large enough to matter, caching the shimmed+migrated database image is a reasonable optimization.
