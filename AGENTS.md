# Working on Playload

Playload is deliberately small. Favor simple, readable code and consistent concepts.

- Preserve the public surface: `cls`, `put`, `spr`, `btn`, `btnp`, `play`, `pcg`, `scr` and `tick`.
- Prefer direct code, meaningful names and blank lines between logical steps. Examples should be
  approachable to beginners; avoid clever shortcuts and comments that merely repeat the code.
- Add files, abstractions or dependencies only when they solve a concrete problem.
- Preserve the approved retro presentation. Fix inconsistencies without redesigning the tool.
- Keep examples playable, focused and within the shared-URL limits. Keep behavior, examples and
  documentation consistent.
- Regenerate derived files from their inputs; retain original third-party data and notices.
  [CONTRIBUTING.md](CONTRIBUTING.md) lists the project layout, generators and commands.

Run `npm run check` after changes. For runtime, input, rendering or media changes, also run the
affected browser tests; for sound synthesis changes, run `npm run test:reference`. Inspect UI
changes in desktop and narrow layouts. Report checks that could not run and distinguish automated
checks from visual, listening and physical-device verification.
