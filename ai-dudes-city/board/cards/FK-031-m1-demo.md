# FK-031 · M1 demo: the restart and Sami's walkthrough

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | product |
| Lane | P · Product / coordinator |
| Size | S (≤ half a day) |
| Status | Backlog |
| Owner | — (write your name and the date here when you pick it up; the coordinator moves the row in BOARD.md) |
| Depends on | [FK-002](FK-002-admin-story-dev-panel.md), [FK-010](FK-010-board-client.md), [FK-011](FK-011-board-server.md), [FK-012](FK-012-sides.md), [FK-013](FK-013-side-markers.md), [FK-016](FK-016-apply-stone-cast-looks.md), [FK-025](FK-025-unveiling-v1.md), [FK-026](FK-026-rally-v1.md), [FK-028](FK-028-one-pet-per-chatter.md), [FK-029](FK-029-world-breathes.md), [FK-030](FK-030-story-world-kit-review.md), [FK-040](FK-040-perspective-camera.md), [FK-124](FK-124-story-scenes-on-stream.md), [FK-125](FK-125-wren-site-sign.md), [FK-126](FK-126-story-sounds-1.md), [FK-127](FK-127-old-scenes-through-runtime.md), [FK-128](FK-128-cast-renames-and-daughter.md), [FK-157](FK-157-speech-blip-guard.md), [FK-158](FK-158-injectable-audio-context.md), [FK-159](FK-159-sound-board.md), [FK-160](FK-160-sound-approve-and-fingerprints.md), [FK-161](FK-161-offline-render-and-levels.md), [FK-162](FK-162-voice-bus-split.md) |
| Unblocks | — |

## Why (what changes for viewers or Sami)

Sami sees it, and his next decisions come from what he sees.

## Scope

- At the check-in (BOARD.md → Restart rule: 4600 needs no off-air window) the coordinator copies the save first (`cp data/world-ai-dudes.json data/world-ai-dudes.pre-FK-031-<yyyymmdd-hhmm>.json`), rebuilds from a clean main and restarts once, then runs the M1 demo script (`test-` names preferred) and takes one shot per step.
- Afterwards (preferred, not critical: 4600 is Sami's test world), remove every test dude's builds, the dudes and their lots (/admin `remove-build`, `remove-dude`, `release-lot`: worlds/ai-dudes/index.ts:1965, 1947, 1787), or restore the pre-demo save; finish with **Story OFF**.
- Sami's notes become new cards; Story stays OFF afterwards unless Sami says otherwise.

## Acceptance criteria

- [ ] Every M1 demo step works, on the ortho camera and again with `&persp=1`.
- [ ] Sami has auditioned every cue and the speech blips on :4600/sounds and clicked Approve; the coordinator has committed client/dudes/audio-approved.json.
- [ ] With Story ON a free build ("build me a hut") still lands on the lot, and one typed mid-scene is built after the release.
- [ ] After clean-up no `test-` dude, build or lot remains, and Story is OFF: today's game is back.
- [ ] Sami's feedback is on the board as cards.

## How to verify

- BOARD.md → M1 demo script.

## Notes and risks

- The two pet asks in the script are real astra design calls on 4600 (about $0.13 each). Without `test-` names and the clean-up, test dudes would keep the best lots for good (the first four in the ranking, src/shared/city.ts:181-188) and be restyled at astra cost every age.
- The coordinator owns this card.

## Log

- (picked up / review notes / done, with dates)
