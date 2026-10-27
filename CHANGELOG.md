# Changelog

## Unreleased

- Place sprite overflow noise within ±8 pixels of the intended sprite position, clipping it at screen edges.
- Use the Playload logo for app and shared-game link previews.

## 0.9.4

- Show sprite overflow as 8×8 noise rectangles and PCG overflow as horizontal noise lines, one per excess character or byte, in the affected frame.

## 0.9.3

- Add six built-in control symbols at the start of the Symbols catalog.
- Use circled A and B consistently in examples, input specifications, the API reference, and keyboard hints.
- Limit sprites to 128 characters and PCG writes to 256 bytes per frame, including patterns and colors, ignoring excess characters and bytes. Initialization shares the first frame’s budget.

## 0.9.2

- Improve the homepage layout and placement of the app launch link.
- Clarify the GitHub star and support badge actions.
- Update the local development server's Undici dependency to address security vulnerabilities.
- Standardize source formatting, code organization, comments, and configuration ordering.

## 0.9.1

- Add a website link to the app header that remains visible on narrow screens.
- Improve touch player centering and layouts in short and landscape viewports.
- Refresh the website screenshots.
- Detect external source edits even when file size and timestamp are unchanged.
- Fix initialization errors when opening shared game URLs through the website.
- Close audio resources when sound initialization fails.
- Fix error handling when building multiple bundles.
- Streamline local verification and strengthen runtime, recording, and example tests.

## 0.9.0

- Initial release of Playload: a JavaScript game engine and browser tool for sharing games as URLs.
