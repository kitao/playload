# Changelog

## 0.9.4

- Increased the sprite limit to 256 characters per frame.
- Limited PCG edits to 256 distinct characters per run.
- Added visual noise and processing delays when sprite or PCG limits are exceeded.
- Updated app and shared-game link previews to use the Playload logo.
- Added a link to kitao.dev on the homepage.

## 0.9.3

- Added six control symbols (⬆ ⬇ ⬅ ➡ Ⓐ Ⓑ) to the Symbols catalog, examples and input guides.
- Limited sprites to 128 characters and PCG writes to 256 bytes per frame, including patterns and colors, ignoring excess characters and bytes. Initialization shared the first frame’s budget.

## 0.9.2

- Improved the homepage layout and placement of the app launch link.
- Clarified the GitHub star and support badge actions.
- Updated the local development server's Undici dependency to address security vulnerabilities.

## 0.9.1

- Added a website link to the app header that remains visible on narrow screens.
- Improved touch player centering and layouts in short and landscape viewports.
- Fixed missed external source edits when file size and timestamp were unchanged.
- Fixed initialization errors when opening shared game URLs through the website.
- Fixed audio resource leaks when sound initialization failed.

## 0.9.0

- Initial release of Playload: a JavaScript game engine and browser tool for sharing games as URLs.
