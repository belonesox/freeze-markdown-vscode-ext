# Freeze Markdown

A VS Code extension that saves a Markdown Preview as a single, self-contained HTML file.

This extension allows you to «freeze» the rendered preview of a Markdown file into a portable single HTML document with all images. All dependent resources like stylesheets and images can be embedded directly into the HTML file. This makes it easy to share or archive your rendered Markdown documents, as they can be opened in any web browser without needing access to the original source files or an internet connection.

### Why is this needed?

There are many documentation processes out there, but one of the simplest and most convenient is converting Markdown into HTML using `vscode`/`code-server`/`code-oss` loaded with a bunch of extensions.

- We could argue at length:
    - About the downsides of LaTeX/Pandoc/Quattro/Sphinx RST/DITA/... approaches. Suffice it to say, they are very slow to build. For a smooth workflow, you want the exact preview you see to be immediately viewable in a browser (e.g., during a call or an online lecture), matching your local preview 1:1.
        - This isn't ideal if you need both printed documents and web versions from a single source, but let's be honest, printed documents are largely obsolete nowadays.
            - If someone still needs them for «documentation theater», they can be generated later using various `html2docx` projects (I actually have one of those too).
    - About which plain-text markup is the best for documentation. But it seems Markdown has won due to its simplicity and convenience, at least within the `vscode`/`code-server`/`code-oss` stack.
    - About the perfect approach to transforming document semantics into different representations. However, standard custom CSS in VS Code perfectly covers 95% of all needs, since paper documents are unnecessary and CSS is more than enough for the web. You can create not just documents, but also web presentations, etc.
        - For example, see "[Infographic Notes-Presentations](https://gitverse.ru/belonesox/code-notes-infograph)".
- But we won't argue, because if you are reading this, you probably already find this useful.

---

- It seemed like a tiny missing piece — just taking what is already visible in the Web preview and turning it into a "standalone" HTML file.
    - Surprisingly, this turned out to be wildly difficult (although I expected a couple of "save to file" calls). Because of various security constraints, the web-view is heavily isolated from extension code, and you can't just easily pull HTML out of there. I had to take a somewhat roundabout way, but it more or less worked out.

----

### Installation
- Standard installation for a `vscode`/`code-server`/`code-oss` extension.

### Commands

- "Export Markdown to Self-Contained HTML" / `exportToHtml`
    - Generates a preview into an `.html` file (or another extension) from your `.md` file.
- "Export Markdown to HTML (Show Save Dialog)" / `exportToHtmlWithDialog`
    - Same as above, but opens a dialog so you can choose the file name.
- "Update Markdown Preview Theme Styles" / `updateThemeStyles`
    - A technical command that you will likely never need.
        - It updates the built-in HTML-preview styles in `.vscode/freeze-markdown-styles.json`.
            - If this file is missing, it creates it automatically during any export.
            - If it exists, the extension uses it, and you can tweak it manually.
- "Open Frozen HTML in Browser" / `showInWeb`
    - Opens the web URL corresponding to the current Markdown file in your default browser (requires `webUrlTemplate` to be configured).
- "Copy Frozen HTML Web URL" / `copyWebUrl`
    - Copies the web URL of the generated HTML to your clipboard.

### Use Cases

There are different HTML generation use cases, and depending on them, you might want to configure what gets embedded into the generated HTML and what doesn't.

- **Large projects with tons of notes, shared via a web server**
    - In this case, it's better to keep the HTML files as lightweight as possible.
        - Externalize all resources:
            - Keep images and videos in their respective folder structure.
            - Store internal JS/CSS/Fonts from extensions in a shared `.vscode/.cache` folder.
    - Otherwise, every 512-byte Markdown note might generate a 20MB HTML file bloated with scripts and fonts.
- **Total Freeze (Full Archiving)**
    - If you need to transport the result via USB stick or carrier pigeon to a place with no internet:
        - For example, giving a talk at a conference in the wilderness with an unstable connection — a very real scenario.
            - You need to embed and freeze everything, including video embeds.
        - "Archiving" to ensure it survives through the centuries.
- **Sending a file via Email or Messengers**
    - Local resources must be embedded.
    - External images are optional to embed — they will likely be viewed soon and are unlikely to disappear from the internet, and you don't want to overload the email size.
- **Rare, but theoretically useful**
    - Freeze external image links (in case external images suddenly vanish from the internet).
    - But do not freeze local resources (e.g., the project is in a safe place, the cache won't disappear, and resources will be reused).

All of this is controlled by the settings `embedLocalResourcesOnManualExport` / `embedLocalResourcesOnAutoSave` / `embedWebResourcesOnManualExport` / `embedWebResourcesOnAutoSave`, see below.

### Settings

By default, everything is configured reasonably for occasional use: auto-save is off (to avoid littering the workspace with unexpected `.html` files), and all resources are embedded so it works "out of the box".

- `outputSuffix`
    - The file suffix to use for exported HTML files (e.g., '.html' or '.frozen.html').
    - The default extension for the generated file is `.html`.
        - Note: It might be worth splitting this into two settings in the future:
            - One for auto-save (e.g., `.html`).
            - One for "manual generation on demand" (snapshots/archiving) — e.g., `.release.html`.
        - But for now, it's kept simple.
- `autoSaveOnSave`
    - Automatically save a frozen HTML file every time a Markdown file is saved.
    - Disabled by default.
- `templatePath` — Path to the generation template.
    - If not specified, and `.vscode/freeze-markdown-template.html` is missing, the extension will generate one. You can edit it later.
        - It contains placeholders with obvious semantics:
              - `{{TITLE_PLACEHOLDER}}`
              - `{{DEFAULT_STYLES_PLACEHOLDER}}`
              - `{{USER_STYLES_PLACEHOLDER}}`
              - `{{BODY_PLACEHOLDER}}`
              - `{{EDIT_INJECTION_PLACEHOLDER}}`
    - Settings to control what to include/embed during freezing (see [Use Cases](#use-cases)):
        - `embedWebResourcesOnManualExport` — Embed External Resources on Manual Export.
        - `embedWebResourcesOnAutoSave` — Embed External Resources on Auto Save.
        - `embedLocalResourcesOnManualExport` — Embed local resources (CSS/JS/images) directly into the HTML on manual export. If false, resources are cached in `.vscode/.cache` and linked relatively.
        - `embedLocalResourcesOnAutoSave` — Embed local resources directly into the HTML on auto save. If false, resources are cached and linked relatively.
- `rewriteLocalMdLinks`
    - Enabled by default (`true`).
    - When exporting to HTML, any relative links pointing to other `.md` files will be automatically rewritten to point to their corresponding generated files (using `outputSuffix`). For example, `[link](docs/api.md#section)` becomes `<a href="docs/api.html#section">link</a>`.
- `createDebugFile`
    - A technical setting for debugging, disabled by default.
    - Creates an additional `.debug.html` file before embedding resources. Useful for debugging style issues.
- `webUrlTemplate`
    - Template for the web URL of the generated HTML.
        - Used for commands "Open Frozen HTML in Browser" (`showInWeb`) and "Copy Frozen HTML Web URL" (`copyWebUrl`).
        - Supports `${relativeFileDirname}`, `${fileBasenameNoExtension}`, and `${fileBasename}`.
        - Example: `https://your.server.com/prefix/${relativeFileDirname}/${fileBasenameNoExtension}.html`
- `editUrlTemplate`
    - Template for the Edit URL embedded inside the generated HTML document.
        - If configured, a subtle edit button (✎) will be injected into the top-right corner of the HTML page, allowing you to jump back into your editor with a single click or by pressing `Alt+Shift+E`. The button is automatically hidden when printing the document.
        - Supports `${relativeFileDirname}`, `${fileBasenameNoExtension}`, `${fileBasename}`, and `${absolutePath}`.
        - Example for local VS Code: `vscode://file/${absolutePath}`
        - Example for remote code-server: `https://your-code-server.com/?folder=/workspace/${relativeFileDirname}&file=${absolutePath}`
