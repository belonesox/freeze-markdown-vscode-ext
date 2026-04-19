import * as vscode from 'vscode';
import * as path from 'path';
import { renderAndSave } from './commands/exportToHtml';
import { updateDefaultStyles } from './commands/updateThemeStyles';

export function activate(context: vscode.ExtensionContext) {
    console.log('[Freeze Markdown] Extension activated.');

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


    // Вспомогательная функция для вычисления URL
    function generateWebUrl(documentUri: vscode.Uri): string | undefined {
        const config = vscode.workspace.getConfiguration('freeze-markdown', documentUri);
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
        const fileBasenameNoExtension = parsedPath.name;
        const fileBasename = parsedPath.base;

        // Подставляем переменные
        let url = template
            .replace(/\$\{relativeFileDirname\}/g, relativeFileDirname)
            .replace(/\$\{fileBasenameNoExtension\}/g, fileBasenameNoExtension)
            .replace(/\$\{fileBasename\}/g, fileBasename);

        // Защита от двойных слешей в URL (например, если relativeFileDirname пустой)
        // Регулярка убирает двойные слеши, но не трогает http:// или https://
        url = url.replace(/([^:])\/{2,}/g, '$1/');

        return url;
    }

    const showInWebCommand = vscode.commands.registerCommand('freeze-markdown.showInWeb', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === 'markdown') {
            const url = generateWebUrl(editor.document.uri);
            if (url) {
                // Открывает URL в браузере по умолчанию
                vscode.env.openExternal(vscode.Uri.parse(url));
            }
        } else {
            vscode.window.showWarningMessage('Please open a Markdown file to get its Web URL.');
        }
    });

    const copyWebUrlCommand = vscode.commands.registerCommand('freeze-markdown.copyWebUrl', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor?.document.languageId === 'markdown') {
            const url = generateWebUrl(editor.document.uri);
            if (url) {
                // Копирует текст в буфер обмена
                await vscode.env.clipboard.writeText(url);
                vscode.window.showInformationMessage(`Web URL copied: ${url}`);
            }
        } else {
            vscode.window.showWarningMessage('Please open a Markdown file to get its Web URL.');
        }
    });

    context.subscriptions.push(exportCommand, exportWithDialogCommand, saveListener, updateStylesCommand, showInWebCommand, copyWebUrlCommand);
}

export function deactivate() {}
