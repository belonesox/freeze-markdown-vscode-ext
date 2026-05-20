import * as vscode from 'vscode';
import * as path from 'path';
import { renderAndSave } from './commands/exportToHtml';
import { updateDefaultStyles } from './commands/updateThemeStyles';
import { renderNotebookAndSave } from './commands/exportNotebookToHtml';

export function activate(context: vscode.ExtensionContext) {
    console.log('[Freeze Markdown] Extension activated.');

    const exportNotebookCommand = vscode.commands.registerCommand('freeze-markdown.exportNotebookToHtml', async () => {
        const activeNotebookEditor = vscode.window.activeNotebookEditor;
        if (activeNotebookEditor) {
            const notebook = activeNotebookEditor.notebook;
            const config = vscode.workspace.getConfiguration('freeze-markdown', notebook.uri);
            await renderNotebookAndSave(context, notebook, {
                showDialog: false,
                showNotifications: true,
                embedWebResources: config.get('embedWebResourcesOnManualExport', true),
                embedLocalResources: config.get('embedLocalResourcesOnManualExport', true),
                rewriteLocalMdLinks: config.get('rewriteLocalMdLinks', true)
            });
        } else {
            vscode.window.showWarningMessage('Please open a Jupyter Notebook (.ipynb) to export.');
        }
    });

    const exportCommand = vscode.commands.registerCommand('freeze-markdown.exportToHtml', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === 'markdown') {
            const config = vscode.workspace.getConfiguration('freeze-markdown', editor.document.uri);
            await renderAndSave(context, editor.document, {
                showDialog: false,
                showNotifications: true,
                embedWebResources: config.get('embedWebResourcesOnManualExport', true),
                embedLocalResources: config.get('embedLocalResourcesOnManualExport', true),
                rewriteLocalMdLinks: config.get('rewriteLocalMdLinks', true)
            });
        } else {
            vscode.window.showWarningMessage('Please open a Markdown file to export.');
        }
    });
    
    const exportWithDialogCommand = vscode.commands.registerCommand('freeze-markdown.exportToHtmlWithDialog', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === 'markdown') {
            const config = vscode.workspace.getConfiguration('freeze-markdown', editor.document.uri);
            await renderAndSave(context, editor.document, {
                showDialog: true,
                showNotifications: true,
                embedWebResources: config.get('embedWebResourcesOnManualExport', true),
                embedLocalResources: config.get('embedLocalResourcesOnManualExport', true),
                rewriteLocalMdLinks: config.get('rewriteLocalMdLinks', true)
            });
        } else {
            vscode.window.showWarningMessage('Please open a Markdown file to export.');
        }
    });

    const saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
        const config = vscode.workspace.getConfiguration('freeze-markdown', document.uri);
        if (document.languageId === 'markdown' && config.get('autoSaveOnSave')) {
            await renderAndSave(context, document, {
                showDialog: false,
                showNotifications: false,
                embedWebResources: config.get('embedWebResourcesOnAutoSave', false),
                embedLocalResources: config.get('embedLocalResourcesOnAutoSave', true),
                rewriteLocalMdLinks: config.get('rewriteLocalMdLinks', true)
            });
        }
    });

    const updateStylesCommand = vscode.commands.registerCommand('freeze-markdown.updateThemeStyles', async () => {
        await updateDefaultStyles(context);
    });

    const exportWorkspaceCommand = vscode.commands.registerCommand('freeze-markdown.exportWorkspace', async () => {
        const config = vscode.workspace.getConfiguration('freeze-markdown');
        const options = {
            showDialog: false,
            showNotifications: false,
            embedWebResources: config.get<boolean>('embedWebResourcesOnManualExport', true),
            embedLocalResources: config.get<boolean>('embedLocalResourcesOnManualExport', true),
            rewriteLocalMdLinks: config.get<boolean>('rewriteLocalMdLinks', true)
        };

        const mdFiles = await vscode.workspace.findFiles('**/*.md', '{**/node_modules/**,**/.vscode/**}');
        console.log(`[Freeze Markdown] Found ${mdFiles.length} Markdown files.`);
        for (const uri of mdFiles) {
            try {
                const doc = await vscode.workspace.openTextDocument(uri);
                await renderAndSave(context, doc, options);
            } catch (e: any) {
                console.error(`[Freeze Markdown] Failed to export MD: ${uri.fsPath}`, e);
            }
        }

        const ipynbFiles = await vscode.workspace.findFiles('**/*.ipynb', '{**/node_modules/**,**/.vscode/**}');
        console.log(`[Freeze Markdown] Found ${ipynbFiles.length} Jupyter Notebooks.`);
        for (const uri of ipynbFiles) {
            try {
                const doc = await vscode.workspace.openNotebookDocument(uri);
                await renderNotebookAndSave(context, doc, options);
            } catch (e: any) {
                console.error(`[Freeze Markdown] Failed to export Notebook: ${uri.fsPath}`, e);
            }
        }

        vscode.window.showInformationMessage(`Exported ${mdFiles.length} MDs and ${ipynbFiles.length} Notebooks!`);
    });

    // Вспомогательная функция для вычисления URL
    function generateWebUrl(documentUri: vscode.Uri): string | undefined {
        const config = vscode.workspace.getConfiguration('freeze-markdown', documentUri);
        const baseUrl = config.get<string>('baseUrl', '');
        const template = config.get<string>('webUrlTemplate');

        if (!template || template.trim() === '') {
            vscode.window.showErrorMessage("Web URL Template is not configured in settings.");
            return undefined;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage("File must be inside a workspace to calculate its relative web URL.");
            return undefined;
        }

        const parsedPath = path.parse(documentUri.fsPath);
        const relativePath = path.relative(workspaceFolder.uri.fsPath, documentUri.fsPath);
        const relativeDir = path.dirname(relativePath);

        // Нормализуем слеши для URL (заменяем виндовые \ на /)
        const relativeFileDirname = relativeDir === '.' ? '' : relativeDir.replace(/\\/g, '/');
        const workspaceFolderPath = workspaceFolder.uri.fsPath.replace(/\\/g, '/');
        const fileBasenameNoExtension = parsedPath.name;
        const fileBasename = parsedPath.base;

        // Подставляем переменные
        let url = template
            .replace(/\$\{baseUrl\}/g, baseUrl)
            .replace(/\$\{workspaceFolder\}/g, workspaceFolderPath)
            .replace(/\$\{relativeFileDirname\}/g, relativeFileDirname)
            .replace(/\$\{fileBasenameNoExtension\}/g, fileBasenameNoExtension)
            .replace(/\$\{fileBasename\}/g, fileBasename);

        // Защита от двойных слешей в URL (например, если relativeFileDirname пустой)
        // Регулярка убирает двойные слеши, но не трогает http:// или https://
        url = url.replace(/([^:])\/{2,}/g, '$1/');

        return url;
    }

    function getActiveDocumentUri(): vscode.Uri | undefined {
        const textEditor = vscode.window.activeTextEditor;
        if (textEditor?.document.languageId === 'markdown') {
            return textEditor.document.uri;
        }
        const notebookEditor = vscode.window.activeNotebookEditor;
        if (notebookEditor) {
            return notebookEditor.notebook.uri;
        }
        return undefined;
    }

    const showInWebCommand = vscode.commands.registerCommand('freeze-markdown.showInWeb', async () => {
        const documentUri = getActiveDocumentUri();
        if (documentUri) {
            const url = generateWebUrl(documentUri);
            if (url) {
                // Открывает URL в браузере по умолчанию
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        } else {
            vscode.window.showWarningMessage('Please open a Markdown file or Jupyter Notebook to get its Web URL.');
        }
    });

    const copyWebUrlCommand = vscode.commands.registerCommand('freeze-markdown.copyWebUrl', async () => {
        const documentUri = getActiveDocumentUri();
        if (documentUri) {
            const url = generateWebUrl(documentUri);
            if (url) {
                // Копирует текст в буфер обмена
                await vscode.env.clipboard.writeText(url);
                vscode.window.showInformationMessage(`Web URL copied: ${url}`);
            }
        } else {
            vscode.window.showWarningMessage('Please open a Markdown file or Jupyter Notebook to get its Web URL.');
        }
    });

    context.subscriptions.push(exportNotebookCommand, exportCommand, exportWithDialogCommand, saveListener, updateStylesCommand, showInWebCommand, copyWebUrlCommand, exportWorkspaceCommand);
}

export function deactivate() {}
