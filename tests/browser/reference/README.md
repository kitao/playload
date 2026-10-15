# Independent CRT reference

`crt-lottes.glsl` is the unmodified public-domain shader by Timothy Lottes, pinned to [e808ca09c699db7a843154cf7dc4dfd766d18a8a](https://github.com/libretro/glsl-shaders/blob/e808ca09c699db7a843154cf7dc4dfd766d18a8a/crt/shaders/crt-lottes.glsl). Its author and public-domain notice are included in the source.

[reference-renderer.js](../reference-renderer.js) compiles that source in WebGL with the same parameter values as Playload. The Libretro wrapper's uniforms use high precision to match Playload's constants. The upstream curvature values are retained, with no image inset. Playload's rounded glass and vignette are applied to the reference output so the test compares the Gaussian reconstruction, scanlines, mask and bloom independently. The visual reference, size contract and limits of historical calibration are documented in [Retro output design](../../../docs/retro-output.md).

White, checkerboard, palette bands and glyph patterns are compared within the central 544×480 region. Source-edge handling differs intentionally: upstream clamps samples, while Playload returns black beyond the source image. Therefore this comparison excludes source-edge pixels. Separate runtime tests check the final curved border, preserved black, capture and flat fallback when WebGL is unavailable or lost.

A filled white picture separately checks that CRT and flat mode have the same 640×576 maximum width and height. The central horizontal and vertical bands are measured at half peak brightness, excluding the faint halo. Every source perimeter pixel is also checked against an unmasked renderer to detect glass clipping and loss of in-frame phosphor glow.

This establishes agreement with that renderer at matched settings and the documented picture-size contract. It does not establish agreement with a physical CRT's optics or motion behavior. The reference source is used only by development tests.
