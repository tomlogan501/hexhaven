# Hex Haven

A browser-based, Catan-style hex island game in plain JavaScript — single
HTML page, no build step, no dependencies.

![Hex Haven game board](docs/screenshot.png)

**Play:** open `index.html` in a browser, or serve the folder statically.

```
node -e "console.log('static server: npx serve . or python -m http.server')"
```

## Tests

```
node tools/check.js    # board topology, tokens, harbors
node tools/game-test.js    # rules engine
node tools/dom-test.js     # full turn flow in a headless DOM
```

## Documentation

- `rules.md` — Catan rules → implementation mapping, with a deviation list
- `CHANGELOG.md` — every fix and feature with commit hashes

## Legal

Unofficial fan implementation. **CATAN®** is a trademark of Catan GmbH; this
project is not affiliated with, endorsed by, or sponsored by Catan GmbH.

## License

[MIT](LICENSE) © 2026 Thomas SIMON
