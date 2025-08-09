// media/main.js

// This script will be run within the webview itself
(function () {
    // A special function provided by VSCode to get a communication API
    const vscode = acquireVsCodeApi();

    // Listen for messages from the extension
    window.addEventListener('message', event => {
        const message = event.data; // The JSON data that the extension sent

        switch (message.command) {
            case 'getHTML':
                // When the extension asks for the HTML, get the entire document's
                // outer HTML and send it back.
                const html = document.documentElement.outerHTML;
                vscode.postMessage({
                    command: 'htmlResponse',
                    html: html
                });
                break;
        }
    });
}());