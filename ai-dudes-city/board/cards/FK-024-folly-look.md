# FK-024 · Folly look: cordon, tarp, sign, beam and the drop

| | |
|---|---|
| Milestone | M1 See it |
| Discipline | eng |
| Lane | D · World look |
| Size | M (≈ 1 engineer-day, the maximum) |
| Status | Review (on fk-d at c78d329, not landed) |
| Owner | lane D agent, 2026-10-24 |
| Depends on | [FK-001](FK-001-story-switch-and-contracts.md) |
| Unblocks | [FK-025](FK-025-unveiling-v1.md), [FK-030](FK-030-story-world-kit-review.md), [FK-168](FK-168-unveiling-score.md) |

## Why (what changes for viewers or Sami)

The Folly must read as "something big and secret" from across town, and the reveal has to pop.

## Scope

- client/dudes/objects.ts for `folly` objects: replace the 0.1 silhouette shade (objects.ts:395) with draped cream canvas #EFE3C2 over the bounding box, gold rope bands and a giant gold crown stencil, scaled with pct.
- Cordon: a stake every 2 m, gold rope, swaying gold-and-ink pennants. Sign 4×1.6 m "KEEP OUT. SOMETHING AMAZING." (gold face; only the frame material changes per age). A plaque plate.
- Gold beam: radius 0.6 m at 20% while the cordon is up; 1.6 m at 45% with a 0.4 Hz pulse during a Call.
- Reveal on the `unveil` beat: the tarp drops in 0.4 s, 6 large dust puffs, gold confetti (≤ 24 big pieces), camera still.
- `?demo=folly` draws a local fake Folly (cordon, tarp, sign, beam at STORY_SITES.folly, pct climbing) and plays the drop every 15 s, with no server change, so Sami sees it on 4600 after a client-only rebuild.

## Acceptance criteria

- [ ] A stream-framed shot of the tarped Folly reads at phone size.
- [ ] The drop plays on the `unveil` beat.
- [ ] `npm run typecheck` and `npm test` green (112 existing + this card's new tests).

## How to verify

- On your lane's demo server (`$PORT`, BOARD.md → Worktrees and demo servers), with Story ON in /admin → Story (dev): Story (dev) → Raise the cordon → `flock /tmp/fk-shot.lock nice -n 10 node ~/gs-tools/shot.mjs "http://localhost:$PORT/?stream=1" /tmp/fk-shots/eng-d/fk024.png --w 1920 --h 1080 --wait 8000` (one shot at a time, behind the shot lock; Read the PNG).
- `?demo=folly`: two shots of /?stream=1&demo=folly on `$PORT`, one under the tarp and one just after a drop.

## Notes and risks

- Engine-drawn so it is the same in every age (board/design-system.md §5).
- Ground rules in BOARD.md apply: Story switch gating, live-save safety, work in your lane's worktree and demo port, commit only your own paths, no restarts of `town` (the coordinator schedules them).

## Log

- (picked up / review notes / done, with dates)
- 2026-10-24, lane D agent: picked up.
- 2026-10-24, lane D agent: built on fk-d (commit 93aee7e, not landed); typecheck green, `npm test` 304/304 (14 new in scripts/folly-look.test.ts). Looked at in a static preview of the built client (`?demo=folly`, shots in /tmp/fk-shots/lane-d/fk024-static-*.png); the demo-port shots wait for a free demo slot (both taken by lanes C and E).
- 2026-10-24, lane D agent: **ready for review** on fk-d at **c78d329** (rebased onto main ed95965), not landed. `npm run typecheck` green, `npm test` 354/354 (14 new in scripts/folly-look.test.ts). Design spend $0. As built:
  - **client/dudes/folly.ts** (new, the kit, about ten draw calls a Folly; only the canvas and the merged kit cast shadows): the tarp is a cream #EFE3C2 canvas draped over the Folly's box (its parts' bounds + 0.3 m): rounded over the top, walls bellied out, pinched by two gold ropes at 20% and 82% of its height (ink rim drawn from inside), a loose skirt in folds flaring at the hem, the top domed; a giant gold crown (the tag icon's crown, ink edge) stencilled on its front and on its top (from the stream's 40° the top is the biggest face a phone sees). It grows with `town.folly.pct`, from 72% across and 40% tall at 0% to the full box at 100%, eased (Story (dev)'s Folly → 100 grows over a second or two). The cordon: an ink stake with a gold knob at every corner and at most 2 m apart (32 round the 16 m plot, 0.3 m inside its edge), a gold rope sagging between them, 96 gold and ink pennants swaying about the rope (still in any scene and under reduced motion). The sign: 4 × 1.6 m, an unlit gold face 1 m up with KEEP OUT. / SOMETHING AMAZING. in ink Fredoka 700, standing in front of the cordon's left half, turned 0.35 rad toward the stream camera; only its frame and posts change with the age (lashed timber, cast bronze, dark oak, riveted iron, painted steel, rusted scrap). The plaque: a gold plate edged in ink with a deep-gold crown emboss, leaning back on an ink stand in front of the right half. Sign and plaque stop 0.45 m short of the crowd's ring and clear of the head's mark. The beam: unlit gold, 60 m tall, fading upward, 0.6 m at 20% while under wraps, 1.6 m at 45% pulsing at 0.4 Hz through the Unveiling's Call, eased between. The drop: the tarp falls in 0.4 s (gravity ease, spreading 10%), lies as a heap 1 s and sinks in 0.6 s; six big dust puffs (1.2 to 2.8 m) round the foot; 24 big (0.72 × 0.46 m) gold and deep-gold confetti pieces up off the top, fluttering down (≤ 3.2 m/s) to lie 1 s, all gone in 6.5 s; the beam fades as the tarp falls; nothing touches the camera. Reduced motion: the tarp is just gone.
  - **client/dudes/storyProps.ts** (new, the layer main.ts mounts; FK-125 adds Wren's sign here, its mount is already done): a look for every `folly` build in the snapshot, its tarp fitted to the parts once they land (its footprint until then); the timer is this age's Folly's, an earlier age's stands full size. The Call is `town.show.banner` while it is up and names the Unveiling (title matches /unveil/i, FK-021's "GATHER: THE UNVEILING"); a Rally's Call is at Wren's fire and leaves the beam alone. **Until FK-021 emits the banner the Call's pulse is only seen in `?demo=folly`.** The drop plays when a Folly seen under wraps loses `silhouette` (the `unveil` beat: FK-025 calls `unveilFolly`), i.e. when the snapshot that unveils it is drawn, within one server tick (≤ 0.5 s) of the beat; a Folly already unveiled when the page opens, or re-tarped, never drops. Story OFF sends no Folly, so the layer is empty (no draw calls). `?demo=folly`: a fake Big Hut on STORY_SITES.folly with no server change, Story on or off: its timer climbs 15 → 100% in 8 s, its Call from 6 s, the drop at 10 s, again every 15 s; the server's own Follies are left alone meanwhile; `window.__follyDemo()` reports where the round is (for smokes and shots).
  - **client/dudes/objects.ts:** a Folly under wraps is not drawn (its group hidden, its own colours kept, so it shows as the tarp drops); any other silhouette keeps today's 0.1 dark shade. New `partsBounds(parts)` (each part's box as it is turned) and `boundsOf(id)`.
  - **Hooks into Lane C's files**, each marked `// hook FK-024`: client/dudes/main.ts +8 lines (the import; the mount; `storyProps.sync(next)` in apply; `storyProps.update(...)` in draw; a 4-line camera branch so `?demo=folly` holds the stream shot on its Folly, a cut when far then eased, ahead of the Mayor's camera; nothing without the param). client/dudes/environment.ts +2 lines (the park trees on the plot, already hidden with Story ON by FK-023's hook, hide under `?demo=folly` too).
  - **Choices for the reviewer and FK-030:** the cordon, sign and plaque stay after the unveil (the Chief's "You may look. Don't touch."); only the tarp and the beam go. The bible's "the beam pulls autoFrame's eye" is not framing code here (autoFrame is Lane C's, FK-062): the beam is 60 m tall, so it shows as a gold stripe up the frame even with the Folly just below it.
  - **Verified on 4614** (data/demo-d, Stone, the 40-chatter test town; three test chatters stood by the Folly through the save and `teleport to the big hut`): Story ON, Raise the cordon, Gather. Shots in /tmp/fk-shots/lane-d/: `fk024.png` (/?stream=1: the tarped Big Hut, giant gold crown on its top and front, gold ropes, cordon and pennants, the sign in lashed timber, the plaque, the faint beam), `fk024-phone.png` (that frame downscaled to 390 px: the crowned tarp is the clearest thing in it); `fk024-demo-tarp.png` (/?stream=1&demo=folly under the tarp, in its Call: the wide beam) and `fk024-demo-drop.png` (just after a drop: the hut revealed, the canvas heap round its foot, six dust puffs, the confetti bursting). Earlier static-preview shots (Modern light, no server): `fk024-static-*.png`. Then Story OFF: no Folly in the snapshot, nothing drawn. Demo server stopped; demo-d left with Story OFF. Headless shots run at about 1.7 fps, so the 0.4 s fall itself never lands in a frame there; at 60 fps it is about 24 frames.
  - **What Sami sees once the coordinator rebuilds the client on 4600** (client-only, no restart): open `/?stream=1&demo=folly`: the camera holds on the SE corner park, the Big Hut under its cream tarp grows, the beam widens and pulses, and every 15 s the tarp drops with dust and gold confetti. After the restart, with Story ON in /admin → Story (dev) → Raise the cordon: the tarp, cordon, sign, plaque and beam stand on the Folly's plot and the tarp grows with the timer (Folly → 0 / 50 / 100 to see it); Re-tarp puts it back under wraps; the drop on the real path comes with FK-025's Unveiling. Story OFF: none of it, today's game.
