"use strict";

import * as vscode from "vscode";
import { Vim } from "./vim/vim";

export function activate(context: vscode.ExtensionContext) {
    const vim = new Vim();

    let disposable = vscode.commands.registerCommand("type", args => {
        vim.key(args.text);
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand("extension.vimEscape", () => {
        vim.key("<esc>");
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand("extension.vimLeft", () => {
        vim.key("<left>");
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand("extension.vimRight", () => {
        vim.key("<right>");
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand("extension.vimUp", () => {
        vim.key("<up>");
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand("extension.vimDown", () => {
        vim.key("<down>");
    });
    context.subscriptions.push(disposable);

    vscode.window.onDidChangeTextEditorSelection(e => {
        vim.updateSelection(e.selections);
    });

    vscode.workspace.onDidChangeTextDocument(e => {
        vim.documentChanged(e);
    });

    vscode.window.onDidChangeActiveTextEditor(e => {
        vim.updateUI();
    });

    vim.updateUI();
}

export function deactivate() {
    // ??
}
