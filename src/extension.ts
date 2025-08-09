import * as vscode from 'vscode';
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
                embedWebResources: config.get('embedWebResourcesOnManualExport', true)
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
                embedWebResources: config.get('embedWebResourcesOnManualExport', true)
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
                embedWebResources: config.get('embedWebResourcesOnAutoSave', false)
            });
        }
    });

    const updateStylesCommand = vscode.commands.registerCommand('freeze-markdown.updateThemeStyles', async () => {
        await updateDefaultStyles(context);
    });

    context.subscriptions.push(exportCommand, exportWithDialogCommand, saveListener, updateStylesCommand);
}


export function deactivate() {}
