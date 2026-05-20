import * as vscode from 'vscode';
import { generateFullHtml, embedResources, SaveOptions } from './exportToHtml';

export async function renderNotebookAndSave(
    context: vscode.ExtensionContext,
    notebook: vscode.NotebookDocument,
    options: SaveOptions
) {
    // Усиливаем получение конфига: если URI ноутбука не дает воркспейс, берем корень
    const rootUri = notebook.uri.scheme === 'file' ? notebook.uri : 
                    (vscode.workspace.workspaceFolders?.[0].uri || notebook.uri);
    const config = vscode.workspace.getConfiguration('freeze-markdown', rootUri);

    const process = async (progress?: vscode.Progress<{ message?: string; increment?: number }>) => {
        try {
            progress?.report({ increment: 10, message: "Reading Notebook cells..." });

            let combinedHtml = '<div class="vscode-notebook-container">\n';

            for (const cell of notebook.getCells()) {
                if (cell.kind === vscode.NotebookCellKind.Markup) {
                    const renderedHtml = await vscode.commands.executeCommand<string>(
                        'markdown.api.render',
                        cell.document.getText()
                    );
                    combinedHtml += `<div class="notebook-cell markdown-cell">\n${renderedHtml}\n</div>\n`;
                } 
                else if (cell.kind === vscode.NotebookCellKind.Code) {
                    const lang = cell.document.languageId;
                    const codeMd = `\`\`\`${lang}\n${cell.document.getText()}\n\`\`\``;
                    const renderedCode = await vscode.commands.executeCommand<string>(
                        'markdown.api.render',
                        codeMd
                    );
                    
                    combinedHtml += `<div class="notebook-cell code-cell">`;
                    combinedHtml += `<div class="code-source">\n${renderedCode}\n</div>`;

                    if (cell.outputs.length > 0) {
                        combinedHtml += `<div class="code-outputs">`;
                        for (const output of cell.outputs) {
                            combinedHtml += renderOutputItem(output);
                        }
                        combinedHtml += `</div>`;
                    }
                    combinedHtml += `</div>\n`;
                }
            }
            combinedHtml += '</div>';

            progress?.report({ increment: 40, message: "Constructing full HTML..." });
            
            const fullHtml = await generateFullHtml(context, combinedHtml, notebook.uri);
            const finalHtml = injectNotebookStyles(fullHtml);

            progress?.report({ increment: 30, message: "Embedding/Linking resources..." });
            const finalEmbeddedHtml = await embedResources(
                finalHtml,
                notebook.uri,
                options.embedWebResources,
                options.embedLocalResources,
                options.rewriteLocalMdLinks
            );

            const outputSuffix = config.get('outputSuffix', '.html');
            const finalSavePath = notebook.uri.fsPath.replace(/\.ipynb$/, '') + outputSuffix;

            let saveUri: vscode.Uri | undefined;
            if (options.showDialog) {
                saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(finalSavePath),
                    filters: { 'HTML Files': ['html'] },
                });
            } else {
                saveUri = vscode.Uri.file(finalSavePath);
            }

            if (saveUri) {
                await vscode.workspace.fs.writeFile(saveUri, Buffer.from(finalEmbeddedHtml, 'utf8'));
                if (options.showNotifications) {
                    vscode.window.showInformationMessage(`Notebook successfully exported to: ${saveUri.fsPath}`);
                }
            }
        } catch (e: any) {
            vscode.window.showErrorMessage(`Export failed: ${e.message}`);
        }
    };

    if (options.showNotifications) {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: "Exporting Notebook...", cancellable: false },
            process
        );
    } else {
        await process();
    }
}

function renderOutputItem(output: vscode.NotebookCellOutput): string {
    let outputHtml = '';
    const priorityMimes = ['text/html', 'image/svg+xml', 'image/png', 'image/jpeg', 'text/plain'];
    
    const sortedItems = [...output.items].sort((a, b) => {
        const indexA = priorityMimes.indexOf(a.mime);
        const indexB = priorityMimes.indexOf(b.mime);
        return (indexA === -1 ? 999 : indexA) - (indexB === -1 ? 999 : indexB);
    });

    const item = sortedItems[0];
    if (!item) return '';

    const data = item.data;
    
    if (item.mime === 'text/html') {
        outputHtml += Buffer.from(data).toString('utf8');
    } else if (item.mime.startsWith('image/')) {
        const b64 = Buffer.from(data).toString('base64');
        outputHtml += `<img src="data:${item.mime};base64,${b64}" />`;
    } else if (item.mime === 'text/plain') {
        const text = Buffer.from(data).toString('utf8');
        const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        outputHtml += `<pre class="output-text">${escaped}</pre>`;
    } else {
        const text = Buffer.from(data).toString('utf8');
        outputHtml += `<pre class="output-stream">${text}</pre>`;
    }

    return `<div class="output-item">${outputHtml}</div>`;
}

function injectNotebookStyles(html: string): string {
    const nbStyles = `
    <style>
        .vscode-notebook-container {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .notebook-cell {
            position: relative;
        }
        .code-cell {
            background-color: var(--vscode-textCodeBlock-background, rgba(0, 0, 0, 0.04));
            border-radius: 4px;
            overflow: hidden;
        }
        .code-source {
            padding: 8px 12px;
        }
        .code-outputs {
            border-top: 1px solid var(--vscode-editorGroup-border, #e4e4e4);
            padding: 12px;
            background-color: var(--vscode-editor-background, #ffffff);
            overflow-x: auto;
        }
        .output-text, .output-stream {
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
            margin: 0;
        }
    </style>`;
    
    return html.replace('</head>', `${nbStyles}\n</head>`);
}