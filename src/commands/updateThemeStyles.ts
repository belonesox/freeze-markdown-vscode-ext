import * as vscode from 'vscode';
import * as path from 'path';

export async function updateDefaultStyles(context: vscode.ExtensionContext) {
    try {
        const markdownExtension = vscode.extensions.getExtension('vscode.markdown-language-features');
        if (!markdownExtension) {
            vscode.window.showErrorMessage('Could not find VS Code\'s built-in Markdown extension.');
            return;
        }

        const stylePaths = markdownExtension.packageJSON?.contributes?.['markdown.previewStyles'];
        if (!stylePaths || !Array.isArray(stylePaths)) {
            vscode.window.showErrorMessage('Could not find default style paths in Markdown extension.');
            return;
        }

        const styles = [];
        for (const relativePath of stylePaths) {
            const styleUri = vscode.Uri.joinPath(markdownExtension.extensionUri, relativePath);
            try {
                const content = await vscode.workspace.fs.readFile(styleUri);
                styles.push({
                    name: path.basename(styleUri.fsPath),
                    content: content.toString(),
                });
            } catch (e: any) {
                console.error(`Failed to read style file: ${styleUri.fsPath}`, e);
            }
        }
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showErrorMessage('Please open a workspace to store the updated styles file.');
            return;
        }
        const workspaceFolder = workspaceFolders[0];
        const stylesJsonUri = vscode.Uri.joinPath(workspaceFolder.uri, '.vscode', 'freeze-markdown-styles.json');
        
        await vscode.workspace.fs.writeFile(stylesJsonUri, Buffer.from(JSON.stringify({ styles }, null, 2), 'utf8'));

        vscode.window.showInformationMessage(`Successfully updated and saved theme styles to: ${stylesJsonUri.fsPath}`);

    } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to update theme styles: ${e.message}`);
    }
}
