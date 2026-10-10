<p align="center">
  <img src="logo.svg" alt="Playload" width="384">
</p>

<p align="center">
  A tiny game engine that lets you share games as URLs
</p>

- Up to 3 KB of compressed JavaScript
- API with 6 functions, 2 variables and 1 callback
- 160 × 144 pixels, 8 colors, CRT display
- Built-in 8 × 8 Unicode letters, symbols and emoji
- ZX 128 PLAY-compatible, 3 sound channels
- 4-direction and 2-button input
- A complete game in one URL — a **playable payload**

<h2 align="center"><a href="https://kitao.github.io/playload/">Open Playload →</a></h2>

<p align="center">
  <a href="docs/images/play.jpg"><img src="docs/images/play.jpg" alt="The code editor beside a running Glyph Quest game" width="400"></a>
  <a href="docs/images/cheat-sheet.jpg"><img src="docs/images/cheat-sheet.jpg" alt="The complete game API and ZX 128 PLAY sound cheat sheets" width="400"></a><br>
  <a href="docs/images/emoji.jpg"><img src="docs/images/emoji.jpg" alt="Emoji alongside their built-in 8 by 8 pixel artwork" width="400"></a>
  <a href="docs/images/examples.jpg"><img src="docs/images/examples.jpg" alt="Playable game and sound examples with their source inside the URL" width="400"></a>
</p>

Edit your game in the **CODE** editor and press **Run**. The URL updates as you edit:
share it to send the game and its code, or bookmark it to save that version.
Start your code with `// @title My Game` to name the browser tab and bookmark.

## Run locally

Requires **Node.js 24+**.

```sh
git clone https://github.com/kitao/playload.git
cd playload
npm run dev
```

No package installation or build step is needed. The server opens Playload in your default browser.
For development tools and checks, see [Contributing](CONTRIBUTING.md).

## License

Playload's code and documentation are licensed under [MIT](LICENSE).

Bundled third-party materials retain their own licenses:

- [Public Pixel](https://ggbot.itch.io/public-pixel-font): CC0.
- [Unscii-8](https://github.com/viznut/unscii): public domain / CC0.
- [Twemoji color reference](https://github.com/jdecked/twemoji): [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Misaki Gothic](https://littlelimit.net/misaki.htm): use, modification and redistribution permitted, including commercial use.
- [Unicode data](https://www.unicode.org/Public/17.0.0/): [Unicode License v3](data/fonts/unicode-LICENSE.txt).
- [DB8](https://pixeljoint.com/forum/forum_posts.asp?TID=26050) (palette): Richard Fhager (DawnBringer).
- [CRT-Lottes](https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl): public domain.
- [AY volume measurements](https://github.com/mamedev/mame/blob/dd06c01bbbd7d0c1c8aefa477c095861c7f8bf31/src/devices/sound/ay8910.cpp): public domain.
- [Prism](https://prismjs.com/): MIT.
- [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) (logo and favicon): SIL OFL 1.1.
- [emu2149](https://github.com/digital-sound-antiques/emu2149) (test reference): MIT.
