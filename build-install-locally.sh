#!/bin/sh
set -x
rm -f *.vsix
vsce  package
code-server --install-extension *.vsix
