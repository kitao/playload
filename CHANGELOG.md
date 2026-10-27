# Changelog

## 0.9.4

- Show sprite overflow as noise near the sprite and PCG overflow as horizontal noise lines.
- Use the Playload logo for app and shared-game link previews.

## 0.9.3

- Add six control symbols (⬆ ⬇ ⬅ ➡ Ⓐ Ⓑ) to the Symbols catalog and use them in examples and input guides.
- Limit sprites to 128 characters and PCG writes to 256 bytes per frame, including patterns and colors, ignoring excess characters and bytes. Initialization shares the first frame’s budget.

## 0.9.2

- Improve the homepage layout and placement of the app launch link.
- Clarify the GitHub star and support badge actions.
- Update the local development server's Undici dependency to address security vulnerabilities.

## 0.9.1

- Add a website link to the app header that remains visible on narrow screens.
- Improve touch player centering and layouts in short and landscape viewports.
- Detect external source edits even when file size and timestamp are unchanged.
- Fix initialization errors when opening shared game URLs through the website.
- Fix audio resource leaks when sound initialization fails.

## 0.9.0

- Initial release of Playload: a JavaScript game engine and browser tool for sharing games as URLs.
