import * as vscode from "vscode";
import * as path from "path";
import * as crypto from "crypto";
import { load, type Cheerio } from "cheerio";
import type { Element } from "domhandler";
import fetch from "node-fetch";

export interface SaveOptions {
  showDialog: boolean;
  showNotifications: boolean;
  embedWebResources: boolean;
  embedLocalResources: boolean;
  rewriteLocalMdLinks: boolean;
}

export function resolveUrlTemplate(
  documentUri: vscode.Uri,
  template: string
): string | undefined {
  if (!template || template.trim() === "") {
    return undefined;
  }

  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  let relativeFileDirname = "";

  if (workspaceFolder) {
    const relativePath = path.relative(
      workspaceFolder.uri.fsPath,
      documentUri.fsPath
    );
    const relativeDir = path.dirname(relativePath);
    relativeFileDirname =
      relativeDir === "." ? "" : relativeDir.replace(/\\/g, "/");
  }

  const parsedPath = path.parse(documentUri.fsPath);
  const fileBasenameNoExtension = parsedPath.name;
  const fileBasename = parsedPath.base;
  const absolutePath = documentUri.fsPath.replace(/\\/g, "/");

  let url = template
    .replace(/\$\{relativeFileDirname\}/g, relativeFileDirname)
    .replace(/\$\{fileBasenameNoExtension\}/g, fileBasenameNoExtension)
    .replace(/\$\{fileBasename\}/g, fileBasename)
    .replace(/\$\{absolutePath\}/g, absolutePath);

  url = url.replace(/([^:])\/{2,}/g, "$1/");
  return url;
}

export async function renderAndSave(
  context: vscode.ExtensionContext,
  document: vscode.TextDocument,
  options: SaveOptions
) {
  const config = vscode.workspace.getConfiguration(
    "freeze-markdown",
    document.uri
  );

  const process = async (
    progress?: vscode.Progress<{ message?: string; increment?: number }>
  ) => {
    try {
      progress?.report({ increment: 20, message: "Rendering Markdown..." });
      const renderOutput = await vscode.commands.executeCommand<string>(
        "markdown.api.render",
        document.getText()
      );

      if (typeof renderOutput !== "string") {
        throw new Error("Markdown renderer did not return a string.");
      }

      progress?.report({ increment: 30, message: "Constructing full HTML..." });
      const fullHtml = await generateFullHtml(
        context,
        renderOutput,
        document.uri
      );

      // Check the new setting OR if we are in development mode.
      const createDebugFile = config.get("createDebugFile", false);
      if (
        context.extensionMode === vscode.ExtensionMode.Development ||
        createDebugFile
      ) {
        const debugSavePath = vscode.Uri.file(
          document.uri.fsPath + ".debug.html"
        );
        await vscode.workspace.fs.writeFile(
          debugSavePath,
          Buffer.from(fullHtml, "utf8")
        );
      }

      progress?.report({
        increment: 30,
        message: "Embedding/Linking resources...",
      });
      const finalHtml = await embedResources(
        fullHtml,
        document.uri,
        options.embedWebResources,
        options.embedLocalResources,
        options.rewriteLocalMdLinks
      );

      const outputSuffix = config.get("outputSuffix", ".html");
      const finalSavePath =
        document.uri.fsPath.replace(/\.md$/, "") + outputSuffix;

      let saveUri: vscode.Uri | undefined;
      if (options.showDialog) {
        progress?.report({
          increment: 10,
          message: "Prompting for save location...",
        });
        saveUri = await vscode.window.showSaveDialog({
          defaultUri: vscode.Uri.file(finalSavePath),
          filters: { "HTML Files": ["html"] },
        });
      } else {
        saveUri = vscode.Uri.file(finalSavePath);
      }

      if (saveUri) {
        await vscode.workspace.fs.writeFile(
          saveUri,
          Buffer.from(finalHtml, "utf8")
        );
        if (options.showNotifications) {
          vscode.window.showInformationMessage(
            `MD Successfully exported to: ${saveUri.fsPath}`
          );
        }
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Export failed: ${e.message}`);
    }
  };

  if (options.showNotifications) {
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "Exporting HTML...",
        cancellable: false,
      },
      process
    );
  } else {
    await process();
  }
}

async function getTemplate(
  context: vscode.ExtensionContext,
  documentUri: vscode.Uri
): Promise<string> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (workspaceFolder) {
    const workspaceTemplateUri = vscode.Uri.joinPath(
      workspaceFolder.uri,
      ".vscode",
      "freeze-markdown-template.html"
    );
    try {
      const content = await vscode.workspace.fs.readFile(workspaceTemplateUri);
      return content.toString();
    } catch (error) {
      const defaultTemplateUri = vscode.Uri.joinPath(
        context.extensionUri,
        "media",
        "template.html"
      );
      const defaultContent = await vscode.workspace.fs.readFile(
        defaultTemplateUri
      );
      await vscode.workspace.fs.writeFile(workspaceTemplateUri, defaultContent);
      vscode.window.showInformationMessage(
        `Created a customizable HTML template at .vscode/freeze-markdown-template.html`
      );
      return defaultContent.toString();
    }
  }

  const defaultTemplateUri = vscode.Uri.joinPath(
    context.extensionUri,
    "media",
    "template.html"
  );
  const defaultContent = await vscode.workspace.fs.readFile(defaultTemplateUri);
  return defaultContent.toString();
}

/**
 * Constructs a complete HTML document from a rendered Markdown snippet.
 *
 * This function takes the HTML fragment generated by VS Code's Markdown renderer
 * and combines it with a template. It performs several key tasks:
 * 1. Loads a base HTML template (either a default one or a user-provided one).
 * 2. Extracts the body content and any scripts from the rendered Markdown HTML.
 * 3. Intelligently determines a document title from headings (h1, h2, h3) or the first paragraph.
 * 4. Injects the body content, title, and scripts into the template.
 * 5. Gathers and includes links to VS Code's default Markdown preview stylesheets and user-defined stylesheets.
 * 6. Sets a 'vscode-dark' or 'vscode-light' class on the body based on the current theme.
 * 7. Injects editor font settings as CSS variables.
 *
 * @param context The extension context.
 * @param renderOutput The HTML string produced by the `markdown.api.render` command.
 * @param documentUri The URI of the source Markdown document.
 * @returns A promise that resolves to the complete HTML string, ready for resource embedding.
 */
async function generateFullHtml(
  context: vscode.ExtensionContext,
  renderOutput: string,
  documentUri: vscode.Uri
): Promise<string> {
  let templateHtml = await getTemplate(context, documentUri);
  const $rendered = load(renderOutput);

  const bodyContent = $rendered.html();
  const scripts = $rendered("script")
    .toArray()
    .map((el) => load(el).html())
    .join("\n");

  // --- START: Find and add contributed scripts (for mermaid, etc.) ---
  let contributedScriptTags = "";
  // The output of `markdown.api.render` can be inconsistent across platforms (e.g., VS Code vs code-server),
  // sometimes omitting scripts from extensions. We manually collect all `markdown.previewScripts`
  // to ensure extensions like Mermaid work correctly. This might result in harmless duplicate script
  // tags on some platforms, but it guarantees functionality.
  for (const extension of vscode.extensions.all) {
    const contributes = extension.packageJSON?.contributes;
    if (
      contributes &&
      contributes["markdown.previewScripts"] &&
      Array.isArray(contributes["markdown.previewScripts"])
    ) {
      for (const relativeScriptPath of contributes["markdown.previewScripts"]) {
        const scriptUri = vscode.Uri.joinPath(
          extension.extensionUri,
          relativeScriptPath
        );
        contributedScriptTags += `<script src="${scriptUri.toString()}"></script>\n`;
      }
    }
  }
  // --- END: Find and add contributed scripts ---

  // --- START: Find and add contributed styles (for KaTeX, etc.) ---
  let contributedStyleLinks = "";
  for (const extension of vscode.extensions.all) {
    const contributes = extension.packageJSON?.contributes;
    if (
      contributes &&
      contributes["markdown.previewStyles"] &&
      Array.isArray(contributes["markdown.previewStyles"])
    ) {
      for (const relativeStylePath of contributes["markdown.previewStyles"]) {
        const styleUri = vscode.Uri.joinPath(
          extension.extensionUri,
          relativeStylePath
        );
        contributedStyleLinks += `<link rel="stylesheet" href="${styleUri.toString()}" type="text/css" media="screen">\n`;
      }
    }
  }
  // --- END: Find and add contributed styles ---

  // --- START: Improved Title Logic with Debugging ---
  let title = "";
  let titleDebugInfo = "<" + "!-- Title Debug Info: ";

  try {
    const h1 = $rendered("h1").first().text();
    const h2 = $rendered("h2").first().text();
    const h3 = $rendered("h3").first().text();
    const p = $rendered("p").first().text();

    title = h1 || h2 || h3 || "";
    titleDebugInfo += `H1: '${h1}', H2: '${h2}', H3: '${h3}', P: '${p.substring(
      0,
      20
    )}...'`;

    if (!title && p) {
      title = p.split(/[.!?]/)[0];
      if (title.length > 80) {
        title = title.substring(0, 80).trim() + "…";
      }
    }

    if (!title) {
      title = path.basename(documentUri.fsPath, ".md");
      titleDebugInfo += ` | Fell back to filename.`;
    }

    titleDebugInfo += " --" + ">";
  } catch (e: any) {
    title = path.basename(documentUri.fsPath, ".md");
    titleDebugInfo += ` | ERROR during title extraction: ${e.message} --` + ">";
  }

  const config = vscode.workspace.getConfiguration(
    "freeze-markdown",
    documentUri
  );
  const editUrlTemplate = config.get<string>("editUrlTemplate", "");
  const editUrl = resolveUrlTemplate(documentUri, editUrlTemplate);

  let editInjection = "";
  if (editUrl) {
    // Добавляем максимально незаметную кнопку (символ карандаша ✎)
    // И скрипт, который слушает Alt+Shift+E (используем e.code === 'KeyE' для независимости от раскладки клавиатуры)
    editInjection = `
  <a href="${editUrl}" title="Edit Document (Alt+Shift+E)" class="freeze-markdown-edit-btn">✎</a>
  <style>
    .freeze-markdown-edit-btn {
      position: fixed; top: 15px; right: 15px; z-index: 999999;
      text-decoration: none !important; opacity: 0.2; font-size: 20px;
      color: var(--vscode-descriptionForeground, gray); transition: all 0.2s;
    }
    .freeze-markdown-edit-btn:hover { opacity: 1; color: var(--vscode-textLink-foreground, #007acc); }
    @media print { .freeze-markdown-edit-btn { display: none; } }
  </style>
  <script>
    document.addEventListener('keydown', function(e) {
      // Проверяем Alt + Shift + E (e.code 'KeyE' работает даже если включена русская раскладка)
      if (e.altKey && e.shiftKey && (e.code === 'KeyE' || e.key.toLowerCase() === 'e')) {
        e.preventDefault(); window.location.href = "${editUrl}";
      }
    });
  </script>`;
  }

  const { styles: defaultStyles, variables: styleVarsFromConfig } =
    await getDefaultStylesFromConfig(context, documentUri);
  const userStyleLinks = getUserStyles(documentUri);

  const theme = vscode.window.activeColorTheme;
  const bodyClass =
    theme.kind === vscode.ColorThemeKind.Dark ? "vscode-dark" : "vscode-light";

  let styleVariables;
  if (styleVarsFromConfig) {
    styleVariables = styleVarsFromConfig;
  } else {
    const editorConfig = vscode.workspace.getConfiguration(
      "editor",
      documentUri
    );
    styleVariables = `--vscode-editor-font-family: ${editorConfig.get(
      "fontFamily",
      "sans-serif"
    )};`;
  }

  return templateHtml
    .replace("{{TITLE_PLACEHOLDER}}", title.trim())
    .replace("{{STYLE_VARIABLES}}", styleVariables)
    .replace("{{DEFAULT_STYLES_PLACEHOLDER}}", defaultStyles)
    .replace(
      "{{USER_STYLES_PLACEHOLDER}}",
      contributedStyleLinks + userStyleLinks + scripts + contributedScriptTags
    )
    .replace("{{BODY_CLASS}}", bodyClass)
    .replace("{{BODY_PLACEHOLDER}}", bodyContent + "\n" + titleDebugInfo)
    .replace("{{EDIT_INJECTION_PLACEHOLDER}}", editInjection);
}

async function getDefaultStylesFromConfig(
  context: vscode.ExtensionContext,
  documentUri: vscode.Uri
): Promise<{ styles: string; variables: string }> {
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  let stylesJsonContent: string;

  if (workspaceFolder) {
    const stylesJsonUri = vscode.Uri.joinPath(
      workspaceFolder.uri,
      ".vscode",
      "freeze-markdown-styles.json"
    );
    try {
      const content = await vscode.workspace.fs.readFile(stylesJsonUri);
      stylesJsonContent = content.toString();
    } catch (error) {
      const defaultStylesUri = vscode.Uri.joinPath(
        context.extensionUri,
        "media",
        "default-styles.json"
      );
      const defaultContent = await vscode.workspace.fs.readFile(
        defaultStylesUri
      );
      await vscode.workspace.fs.writeFile(stylesJsonUri, defaultContent);
      vscode.window.showInformationMessage(
        `Created a customizable styles file at .vscode/freeze-markdown-styles.json. Run 'Update Markdown Preview Theme Styles' to populate it.`
      );
      stylesJsonContent = defaultContent.toString();
    }
  } else {
    const defaultStylesUri = vscode.Uri.joinPath(
      context.extensionUri,
      "media",
      "default-styles.json"
    );
    const defaultContent = await vscode.workspace.fs.readFile(defaultStylesUri);
    stylesJsonContent = defaultContent.toString();
  }

  try {
    const stylesConfig = JSON.parse(stylesJsonContent);
    if (stylesConfig.styles && Array.isArray(stylesConfig.styles)) {
      const styleContents = stylesConfig.styles
        .map((style: { content: string }) => style.content)
        .join("\n\n/* --- STYLE SEPARATOR --- */\n\n");
      return {
        styles: `<style data-source="freeze-markdown-styles.json">\n${styleContents}\n</style>`,
        variables: "",
      };
    } else if (stylesConfig.styles && typeof stylesConfig.styles === "string") {
      return { styles: "", variables: stylesConfig.styles };
    }
  } catch (e: any) {
    console.error("Error parsing freeze-markdown-styles.json", e);
    vscode.window.showErrorMessage(
      `Error parsing .vscode/freeze-markdown-styles.json: ${e.message}. Please check its format or run the update command.`
    );
  }

  return { styles: "", variables: "" };
}

function getUserStyles(documentUri: vscode.Uri): string {
  const markdownStyles = vscode.workspace
    .getConfiguration("markdown", documentUri)
    .get<string[]>("styles", []);
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (workspaceFolder) {
    return markdownStyles
      .map((stylePath) => {
        const styleUri = vscode.Uri.joinPath(workspaceFolder.uri, stylePath);
        return `<link rel="stylesheet" href="${styleUri.toString()}" type="text/css" media="screen">`;
      })
      .join("\n");
  }
  return "";
}

// === NEW HELPER: Caching resources ===
async function cacheFile(
  sourceUri: vscode.Uri,
  documentUri: vscode.Uri,
  contentBuffer: Buffer | Uint8Array
) {
  let cacheDir: vscode.Uri;
  const wf = vscode.workspace.getWorkspaceFolder(documentUri);
  if (wf) {
    cacheDir = vscode.Uri.joinPath(
      wf.uri,
      ".vscode",
      ".cache",
      "freeze-markdown"
    );
  } else {
    // Fallback if no workspace is opened
    cacheDir = vscode.Uri.joinPath(
      vscode.Uri.file(path.dirname(documentUri.fsPath)),
      ".vscode",
      ".cache",
      "freeze-markdown"
    );
  }

  await vscode.workspace.fs.createDirectory(cacheDir);

  // Hash path ensures updates to extensions (which change folder paths) invalidate the cache automatically
  const hash = crypto
    .createHash("md5")
    .update(sourceUri.fsPath)
    .digest("hex")
    .substring(0, 8);
  const ext = path.extname(sourceUri.fsPath);
  const baseName = path.basename(sourceUri.fsPath, ext);
  const filename = `${baseName}_${hash}${ext}`;
  const cachedUri = vscode.Uri.joinPath(cacheDir, filename);

  try {
    await vscode.workspace.fs.stat(cachedUri);
  } catch {
    // File doesn't exist in cache, let's write it
    await vscode.workspace.fs.writeFile(cachedUri, Buffer.from(contentBuffer));
  }

  const htmlDir = path.dirname(documentUri.fsPath);
  let relativeToHtml = path.relative(htmlDir, cachedUri.fsPath);
  relativeToHtml = relativeToHtml.replace(/\\/g, "/");
  if (!relativeToHtml.startsWith(".") && !relativeToHtml.startsWith("/")) {
    relativeToHtml = "./" + relativeToHtml;
  }

  return { cachedUri, relativeToHtml, filename };
}
// === END HELPER ===

async function embedResources(
  html: string,
  sourceUri: vscode.Uri,
  embedWeb: boolean,
  embedLocal: boolean,
  rewriteLinks: boolean
): Promise<string> {
  const $ = load(html);
  const promises: Promise<void>[] = [];

  $('link[rel="stylesheet"]').each((_i, el) => {
    const link = $(el);
    const href = link.attr("href");
    if (href)
      promises.push(resolveAndEmbedCss(href, link, sourceUri, embedLocal));
  });

  $("img").each((_i, el) => {
    const img = $(el);
    const src = img.attr("src");
    if (src && !src.startsWith("data:")) {
      if (!src.startsWith("http") || embedWeb) {
        promises.push(resolveAndEmbedImage(src, img, sourceUri, embedLocal));
      }
    }
  });

  $("script[src]").each((_i, el) => {
    const script = $(el);
    const src = script.attr("src");
    if (!src) {
      return;
    }

    const isWebResource = src.startsWith("http:") || src.startsWith("https:");
    if ((isWebResource && embedWeb) || !isWebResource) {
      promises.push(resolveAndEmbedScript(src, script, sourceUri, embedLocal));
    }
  });

  console.log(`[FreezeMarkdown] === START REWRITING LINKS ===`);
  console.log(`[FreezeMarkdown] Options rewriteLinks is: ${rewriteLinks}`);

  if (rewriteLinks) {
    const outputSuffix = vscode.workspace
      .getConfiguration("freeze-markdown", sourceUri)
      .get("outputSuffix", ".html");
    console.log(`[FreezeMarkdown] Target outputSuffix: ${outputSuffix}`);

    $("a").each((_i, el) => {
      const link = $(el);
      const href = link.attr("href");

      console.log(`[FreezeMarkdown] Found <a> tag with href: "${href}"`);

      if (!href) {
        console.log(`[FreezeMarkdown] -> Ignored (no href)`);
        return;
      }

      const isWebResource =
        href.startsWith("http:") || href.startsWith("https:");
      const isAnchorOnly = href.startsWith("#");
      const isSpecialScheme = href.includes(":") && !isWebResource;

      if (!isWebResource && !isAnchorOnly && !isSpecialScheme) {
        const mdExtensionRegex = /\.md([#?].*)?$/i;
        if (mdExtensionRegex.test(href)) {
          const newHref = href.replace(mdExtensionRegex, `${outputSuffix}$1`);
          console.log(
            `[FreezeMarkdown] -> REWRITING MATCHED! "${href}" -> "${newHref}"`
          );

          link.attr("href", newHref);
          if (link.attr("data-href")) {
            link.attr("data-href", newHref);
          }
        } else {
          console.log(`[FreezeMarkdown] -> Ignored (regex didn't match .md)`);
        }
      } else {
        console.log(
          `[FreezeMarkdown] -> Ignored (isWeb: ${isWebResource}, isAnchor: ${isAnchorOnly}, isSpecial: ${isSpecialScheme})`
        );
      }
    });
  }
  console.log(`[FreezeMarkdown] === END REWRITING LINKS ===`);
  await Promise.all(promises);
  return $.html();
}

async function resolveAndEmbedScript(
  src: string,
  scriptElement: Cheerio<Element>,
  documentUri: vscode.Uri,
  embedLocal: boolean
) {
  try {
    if (src.startsWith("http")) {
      const response = await fetch(src);
      if (!response.ok)
        throw new Error(`Failed to fetch script: ${response.statusText}`);
      const scriptContent = await response.text();
      scriptElement.removeAttr("src").text(scriptContent);
      scriptElement.attr("data-embedded-from", src);
    } else {
      let fileUri: vscode.Uri;
      if (src.startsWith("vscode-resource:")) {
        const tempUri = vscode.Uri.parse(src, true);
        fileUri = vscode.Uri.file(tempUri.fsPath);
      } else {
        fileUri = vscode.Uri.parse(src, true);
        if (fileUri.scheme !== "file" && !path.isAbsolute(src)) {
          const baseUri = vscode.Uri.file(path.dirname(documentUri.fsPath));
          fileUri = vscode.Uri.joinPath(baseUri, src);
        } else if (fileUri.scheme !== "file") {
          fileUri = vscode.Uri.file(fileUri.fsPath);
        }
      }

      const contentBuffer = await vscode.workspace.fs.readFile(fileUri);

      if (embedLocal) {
        scriptElement.removeAttr("src").text(contentBuffer.toString());
        scriptElement.attr("data-embedded-from", src);
      } else {
        const { relativeToHtml } = await cacheFile(
          fileUri,
          documentUri,
          contentBuffer
        );
        scriptElement.attr("src", relativeToHtml);
      }
    }
  } catch (e) {
    console.error(`Failed to process script: ${src}`, e);
    if (embedLocal) {
      scriptElement.remove(); // Only drop if failing to inline
    }
  }
}

async function resolveAndEmbedCss(
  href: string,
  linkElement: Cheerio<Element>,
  documentUri: vscode.Uri,
  embedLocal: boolean
) {
  try {
    let fileUri = vscode.Uri.parse(href, true);
    if (fileUri.scheme === "vscode-resource") {
      fileUri = vscode.Uri.file(fileUri.fsPath);
    } else if (!path.isAbsolute(fileUri.fsPath) && fileUri.scheme !== "file") {
      fileUri = vscode.Uri.joinPath(
        vscode.Uri.file(path.dirname(documentUri.fsPath)),
        href
      );
    }

    const contentBuffer = await vscode.workspace.fs.readFile(fileUri);
    let cssContent = contentBuffer.toString();

    const cssDirUri = vscode.Uri.file(path.dirname(fileUri.fsPath));
    const urlRegex = /url\((?!['"]?data:)['"]?([^'"\)]+)['"]?\)/g;
    const matches = Array.from(cssContent.matchAll(urlRegex));

    const replacements = await Promise.all(
      matches.map(async (match) => {
        const originalUrlMatch = match[0];
        const resourcePath = match[1];
        try {
          const cleanResourcePath = resourcePath.split(/[?#]/)[0];
          const resourceUri = vscode.Uri.joinPath(cssDirUri, cleanResourcePath);

          const resourceContent = await vscode.workspace.fs.readFile(
            resourceUri
          );
          const ext = path
            .extname(resourceUri.fsPath)
            .substring(1)
            .toLowerCase();
          const mimeType = getMimeType(ext);

          if (mimeType === "application/octet-stream") {
            console.warn(
              `Skipping embedding of unknown MIME type for resource: ${resourcePath}`
            );
            return { originalUrlMatch, dataUri: originalUrlMatch };
          }

          if (embedLocal) {
            const base64 = Buffer.from(resourceContent).toString("base64");
            const dataUri = `url('data:${mimeType};base64,${base64}')`;
            return { originalUrlMatch, dataUri };
          } else {
            const { filename } = await cacheFile(
              resourceUri,
              documentUri,
              resourceContent
            );
            // Both CSS and Fonts are in `.vscode/.cache/freeze-markdown/`, so link is flat
            return { originalUrlMatch, dataUri: `url('./${filename}')` };
          }
        } catch (e) {
          console.error(
            `Failed to process resource from CSS (${resourcePath}):`,
            e
          );
          return { originalUrlMatch, dataUri: originalUrlMatch };
        }
      })
    );

    const replacementMap = new Map<string, string>();
    for (const { originalUrlMatch, dataUri } of replacements) {
      replacementMap.set(originalUrlMatch, dataUri);
    }
    for (const [originalUrl, dataUri] of replacementMap.entries()) {
      const escapedUrl = originalUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      cssContent = cssContent.replace(new RegExp(escapedUrl, "g"), dataUri);
    }

    if (embedLocal) {
      linkElement.replaceWith(
        `<style data-embedded-from="${href}">\n${cssContent}\n</style>`
      );
    } else {
      const { relativeToHtml } = await cacheFile(
        fileUri,
        documentUri,
        Buffer.from(cssContent, "utf8")
      );
      linkElement.attr("href", relativeToHtml);
    }
  } catch (e) {
    console.error(`Failed to process CSS: ${href}`, e);
  }
}

async function resolveAndEmbedImage(
  src: string,
  imgElement: Cheerio<Element>,
  documentUri: vscode.Uri,
  embedLocal: boolean
) {
  try {
    let fileUri: vscode.Uri;
    if (src.startsWith("http")) {
      const response = await fetch(src);
      if (!response.ok)
        throw new Error(`HTTP error! status: ${response.status}`);
      const buffer = await response.buffer();
      const mimeType =
        response.headers.get("content-type") || "application/octet-stream";
      const base64 = buffer.toString("base64");
      imgElement.attr("src", `data:${mimeType};base64,${base64}`);
      return;
    }

    const baseUri = vscode.Uri.file(path.dirname(documentUri.fsPath));
    if (src.startsWith("vscode-resource:")) {
      const tempUri = vscode.Uri.parse(src, true);
      fileUri = vscode.Uri.file(tempUri.fsPath);
    } else if (path.isAbsolute(src)) {
      fileUri = vscode.Uri.file(src);
    } else {
      fileUri = vscode.Uri.joinPath(baseUri, src);
    }

    const content = await vscode.workspace.fs.readFile(fileUri);

    if (embedLocal) {
      const ext = path.extname(fileUri.fsPath).substring(1).toLowerCase();
      const mimeType = getMimeType(ext);
      const base64 = Buffer.from(content).toString("base64");
      imgElement.attr("src", `data:${mimeType};base64,${base64}`);
    } else {
      const { relativeToHtml } = await cacheFile(fileUri, documentUri, content);
      imgElement.attr("src", relativeToHtml);
    }
  } catch (e) {
    console.error(`Failed to process image: ${src}`, e);
  }
}

function getMimeType(extension: string): string {
  const mimes: { [key: string]: string } = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    eot: "application/vnd.ms-fontobject",
    otf: "font/otf",
  };
  return mimes[extension] || "application/octet-stream";
}
