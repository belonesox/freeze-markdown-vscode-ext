# Change Log

## 0.1.9
- Added setting `rewriteLocalMdLinks`
    - Enabled by default (`true`).
    - When exporting to HTML, any relative links pointing to other `.md` files will be automatically rewritten to point to their corresponding generated files (using `outputSuffix`). For example, `[link](docs/api.md#section)` becomes `<a href="docs/api.html#section">link</a>`.

## 0.1.6
- Added setting `editUrlTemplate`
    - You may need to recreate/merge `freeze-markdown-template.html` for your existing projects

## 0.1.5
- Added commands
    - «Open Frozen HTML in Browser» / `showInWeb`,
    - «Copy Frozen HTML Web URL» / `copyWebUrl`
    - useful, if generated HTML content somehow available in web to download

## 0.1.1
- Add settings `embedLocalResourcesOnManualExport` / `embedLocalResourcesOnAutoSave`

## 0.1.1
- Add settings `embedLocalResourcesOnManualExport` / `embedLocalResourcesOnAutoSave`


## 0.1.0
- Proof Of Concept, testing the extension for several months.
