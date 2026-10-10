# Contributing

Small, focused issues and pull requests are welcome. For a bug, include the browser and OS,
steps to reproduce, expected behavior, and a minimal game or shared URL when possible.
Discuss substantial API or resource-selection changes in an issue first: the small public
surface and consistent retro presentation are part of the project.

## Local development

Use Node.js 24 or newer. Clone the repository and install the development tools:

```sh
git clone https://github.com/kitao/playload.git
cd playload
npm ci
npm run dev
```

The server binds to localhost and opens the tool in your default browser. Use
`npm run dev -- --no-open` to keep the browser closed, or set `PORT` to choose another port.
The application itself has no runtime package dependencies or build step.

## Checks

```sh
npm run check
```

This runs ESLint, Prettier's formatting check, generated-file checks, and the Node.js unit tests.
It is also the main check in GitHub Actions. Run individual checks while working:

| Command                   | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `npm run lint`            | Check JavaScript with ESLint's recommended rules.                 |
| `npm run format`          | Format maintained JavaScript, CSS, HTML, Markdown, JSON and YAML. |
| `npm run format:check`    | Check formatting without changing files.                          |
| `npm test`                | Run the Node.js public-contract tests.                            |
| `npm run test:coverage`   | Measure coverage for modules loaded by the unit tests.            |
| `npm run generated:check` | Check the glyph bank, example URLs and editor highlighter.        |

Frozen font inputs, original notices, reference implementations, and generated artifacts are
excluded from automatic formatting. Generated outputs have their own reproducibility checks.
Coverage normalizes browser cache versions so each source file is counted once.
ESLint handles JavaScript correctness; Prettier handles formatting. Their official guides are
[ESLint configuration](https://eslint.org/docs/latest/use/configure/) and
[Prettier installation](https://prettier.io/docs/install).

### Browser and reference checks

```sh
npx playwright install chromium
npm run test:browser
npm run test:reference
```

Browser tests start their own local server and cover game workers, input, shared URLs, errors,
audio, CRT rendering, screenshots, and WebM export. To use installed Google Chrome instead:

```sh
PLAYLOAD_BROWSER_CHANNEL=chrome npm run test:browser
```

The independent AY comparison requires a C99 compiler (`cc`, or the `CC` environment variable).
GitHub Actions runs both browser tests and this reference check. Coverage is separate from the
browser suite and does not establish subjective audio quality or exact hardware fidelity.
See [retro validation](docs/retro-validation.md) for comparison conditions.
Failed browser runs upload `test-results/`, including Playwright traces, for seven days.

## Project layout

| Location                                    | Purpose                                          |
| ------------------------------------------- | ------------------------------------------------ |
| `index.html`, `src/app.js`, `src/style.css` | Browser tool and presentation                    |
| `src/engine.js`                             | Characters, sprites, screen cells and input      |
| `src/sound.js`, `src/runtime.js`            | Sound synthesis and browser execution            |
| `src/crt.js`, `src/display.js`              | WebGL and CPU rendering                          |
| `src/payload.js`                            | Shared-URL encoding and decoding                 |
| `src/capture.js`, `src/video.js`            | Recording and WebM export                        |
| `examples/`                                 | Single-file games and music                      |
| `tests/`, `tests/browser/`                  | Node.js and Playwright tests                     |
| `data/`, `scripts/`                         | Fixed sources, generators and local server       |
| `docs/`                                     | API, tool guide, resource choices and validation |
| `scripts/serve.js`                          | Local static server                              |

`index.html`, `favicon.svg`, `logo.svg` and `src/` can be served by a static web host.
Keep `LICENSE`, `README.md` and the bundled resource notices with any reduced distribution.
Development dependencies are not loaded by the application.

## Generated files

Edit the inputs and regenerate rather than editing generated output:

| Inputs                                         | Regenerate            | Output                                            |
| ---------------------------------------------- | --------------------- | ------------------------------------------------- |
| `data/fonts/`, font generator scripts          | `npm run fonts`       | `src/glyphs.js`, catalog font and coverage report |
| `examples/*.js`, `data/examples.json`          | `npm run examples`    | `src/example-links.js`                            |
| Tool UI and examples                           | `npm run screenshots` | `docs/images/*.jpg`                               |
| Pinned Prism dependency, highlighter generator | `npm run editor`      | `src/editor-highlighter.js`                       |

Include affected outputs in the same pull request. Regenerating the existing fonts uses the
checked-in source data; importing a new upstream font is a separate process documented in
[font coverage](docs/glyphs.md).

`npm run screenshots` refreshes the four README images at 1600 × 900, starts its own local
server and stops it when finished. Install Chromium with `npx playwright install chromium`,
or use installed Chrome with `PLAYLOAD_BROWSER_CHANNEL=chrome npm run screenshots`.

`npm run fonts` also regenerates emoji colors from the checked-in Twemoji statistics, offline.
To re-extract those statistics from the pinned upstream images, use `npm run fonts:colors`
with Python and Pillow 12.3.0; setup is documented in [font coverage](docs/glyphs.md#browsing-and-reproduction).

## Reviewing changes

Keep the change focused and describe the resulting behavior and validation. Check affected
screens in a real browser, including a narrow viewport, when changing UI or rendering.
Listen to affected sound examples when changing audio. Automated tests complement these checks.

Keep the API reference, examples, and documentation in sync with behavior. New bundled artwork
or other third-party material needs a fixed source, retained permission notice, and an entry in
the [README license section](README.md#license).

Original contributions are covered by the project's [MIT license](LICENSE). Third-party material
retains its upstream license and notices.
