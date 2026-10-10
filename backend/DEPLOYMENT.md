# Backend deployment and migration readiness

The repository's Render service uses `backend` as its root directory. Render
autodeploys changes under that root; an update only to the repository's `docs/`
does not restart this service. See [Render monorepo support](https://render.com/docs/monorepo-support).

## After an approved migration

1. Keep writers paused and verify the explicit database target, private backup,
   preservation plan and guarded migration results.
2. Require all queue, ledger, auth, durable-job and scheduling assertions to pass.
3. Deploy/restart the backend. Schema readiness is captured at startup; an older
   running process deliberately stays in maintenance after database repair.
4. Check `/health/live` (200), `/health/ready` (200 with all schemas ready), and a
   representative public API through the frontend's `/backend` proxy.

An explicitly configured `/test` URI is preserved by code. The approved new
database is `/medipulse`; if startup still reports legacy schemas, inspect the
Render environment privately. Never migrate the historical source to work around
an incorrect connection target. Never paste credentials or original records in Git.

P23 preservation and P03/P04/P07 migrations were approved and completed on
10 October 2026. Original records, rollback IDs and private backups remain
preserved. The full operator record is `docs/P23_RENDER_RECOVERY.md` in the
repository root; files outside the backend root are not included in Render's build.
