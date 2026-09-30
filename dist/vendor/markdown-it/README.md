# markdown-it

Vendored version: **15.0.2**, MIT licensed. The license is in `LICENSE`.

- Upstream: https://github.com/markdown-it/markdown-it
- Official documentation: https://markdown-it.github.io/markdown-it/
- Package metadata: https://registry.npmjs.org/markdown-it/15.0.2
- Downloaded 2026-09-30 from the official npm package:
  https://registry.npmjs.org/markdown-it/-/markdown-it-15.0.2.tgz
- Package member: `package/dist/browser/markdown-it.umd.min.js`
- Local filename: `markdown-it.min.js` (bundle contents are unchanged).
- Bundle SHA-256:
  `635972b985228e8af9f0143647c68616b7a3bb09f6946e7e4a52e43dcf5e7be5`
- Package SHA-512 integrity, verified before extraction:
  `sha512-q4IGxMv56jCqT4OCRCADBoDP3LO4MhmTXjFbphHPXs4g3j9Xg5RDnxqN8IF/3vIWEU+VCnUq+7JUg/cfy2E6Qw==`

This self-contained UMD browser bundle also supports CommonJS. It is served
locally; no CDN or network import is used at runtime. The upstream source-map
comment is retained; the optional development source map is not distributed.

Load this bundle before `lesson-markdown.js`. That adapter disables raw HTML,
allows only absolute HTTP/HTTPS/mailto destinations, adds opener protection to
links, renders image descriptions as escaped text, and preserves plain-text line
breaks. No parser plugins or syntax highlighters are enabled.

To update, download the chosen official npm release, verify its published
integrity, copy the UMD bundle and license, update this provenance and hash, and
run `node --test test/lesson-markdown.test.cjs` and the project test suite.
