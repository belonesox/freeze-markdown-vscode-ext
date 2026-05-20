const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
    try {
        const extensionDevelopmentPath = path.resolve(__dirname, '../');
        const extensionTestsPath = path.resolve(__dirname, './headless-action.js');
        const workspacePath = process.argv[2] || path.resolve(__dirname, '../');

        console.log(`Starting Headless VS Code in workspace: ${workspacePath}`);

        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                workspacePath,
                '--disable-gpu',
                '--disable-extensions'
            ]
        });

        console.log('Headless export completed successfully.');
    } catch (err) {
        console.error('Failed to run headless export', err);
        process.exit(1);
    }
}

main();
