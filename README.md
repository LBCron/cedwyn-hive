# Hive

The Hive webapp of [cedwyn.bucklerfamily.estate](https://cedwyn.bucklerfamily.estate/hive/), in its own repository.

It was split out of `unclehowell/cedwyn` (branch `hive`) on 5 Nov 2026, because that repository holds about 290 branches
(~43 GB with history) and a job on one webapp should never need the rest. This repository is a few MB
(36 files, 0.9 MB at the split).

## Get the code

```
git clone --depth 1 https://github.com/unclehowell/cedwyn-hive.git
```

## Where to send changes (read this first)

`split-repos.json` on `unclehowell/cedwyn` main sets the mode:

- **mirror** (now): the old branch `hive` on unclehowell/cedwyn is still the source. `mirror.yml` here copies it every
  30 minutes. Send pull requests to `hive` on unclehowell/cedwyn (clone it with
  `git clone --depth 1 --single-branch --branch hive --filter=blob:none https://github.com/unclehowell/cedwyn.git`).
- **split-repo** (after the owner switches it): this repository is the source; send pull requests here.
  unclehowell/cedwyn copies `main` back into `hive`, so the live page and every old path keep working.

`SPLIT.json` records the source commit of the last copy. The app's own notes, if the branch had any, are in `APP-README.md`.

## Previews

`preview.yml` deploys every pull request to Cloudflare Pages and comments the link, once the repository secrets
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set (Settings → Secrets → Actions). Without them it stops quietly.

## History before the split

The full history stays on the old branch: https://github.com/unclehowell/cedwyn/commits/hive

Latest commits on `hive` at the split:

| Date | Commit | Change |
| --- | --- | --- |
| 2026-11-05 | `be1f72c` | hive: SCOREBOARD.json (completions per agent/day, metadata only) |
| 2026-11-05 | `d6e1fa1` | drafts(board): % complete per draft (pct.py, metadata only) |
| 2026-11-05 | `570e168` | drafts: BOARD.json sync from HubSpot (13 change(s)); metadata only |
| 2026-11-04 | `26a2bef` | hive: SCOREBOARD.json (completions per agent/day, metadata only) |
| 2026-11-04 | `ec655e0` | drafts: BOARD.json sync from HubSpot (1 change(s)); metadata only |
| 2026-11-04 | `ad024b0` | hive: record PRC-G5 queue-lease blocker (metadata only) |
| 2026-11-04 | `e89d70c` | hive: record PRC-G5 lease-interface blocker (metadata only) |
| 2026-11-04 | `a33bfd9` | hive: SCOREBOARD.json (completions per agent/day, metadata only) |
| 2026-11-04 | `d3ccb3f` | drafts(board): % complete per draft (pct.py, metadata only) |
| 2026-11-04 | `2f31e8a` | drafts: BOARD.json sync from HubSpot (8 change(s)); metadata only |
| 2026-11-03 | `618b6b0` | hive: SCOREBOARD.json (completions per agent/day, metadata only) |
| 2026-11-03 | `131bf6e` | drafts(board): % complete per draft (pct.py, metadata only) |

Never force-push; never delete the old branch.
