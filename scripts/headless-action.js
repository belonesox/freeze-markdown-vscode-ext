const vscode = require('vscode');

async function run() {
    return new Promise(async (resolve, reject) => {
        try {
            console.log('Waiting for extension to activate...');
            
            // Даем VS Code немного времени на индексацию файлов
            await new Promise(res => setTimeout(res, 2000));

            console.log('Triggering exportWorkspace command...');
            await vscode.commands.executeCommand('freeze-markdown.exportWorkspace');
            
            console.log('Export command finished execution.');
            resolve();
        } catch (error) {
            console.error('Error during headless export:', error);
            reject(error);
        }
    });
}

module.exports = { run };
