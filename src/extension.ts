'use strict';

import * as vscode from 'vscode';
import * as http from 'http';
import * as fs from 'fs';
import { VimMode } from "./vim/common";
import { Vim } from "./vim/vim";
import * as util from 'util';

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

    context.subscriptions.push(disposable);

    function startTestAPI() {
        http.createServer(async (req, res) => {

            //console.log(req);
            console.log(req.method, req.url);
            if (req.method === "GET") {
                if (req.url === "/contents") {
                    const text = vscode.window.activeTextEditor.document.getText();
                    const line = vscode.window.activeTextEditor.selection.active.line;
                    const character = vscode.window.activeTextEditor.selection.active.character;
                    res.writeHead(200, {'Content-Type': 'application/json'});
                    console.log(JSON.stringify({ text, line, character }));
                    res.end(line + ";" + character + ";" + text);
                    //res.end(JSON.stringify({ text, line, character }));
                    return;
                } else if (req.url === "/load") {
                    let data = fs.readFileSync("C:\\hacks\\testbuffer.txt");
                    vscode.window.activeTextEditor.edit((e) => {
                        e.setEndOfLine(vscode.EndOfLine.LF);
                        e.replace(vscode.window.activeTextEditor.document.validateRange(new vscode.Range(0, 0, Infinity, Infinity)), data.toString());
                    }).then(() => {
                        vscode.window.activeTextEditor.selection = new vscode.Selection(0, 0, 0, 0);
                        res.writeHead(200, {'Content-Type': 'text/plain'});
                        res.end("OK");
                    });
                    return;
                } else if (req.url.indexOf("/press?") === 0) {
                    res.writeHead(200, {'Content-Type': 'text/plain'});
                    try {
                        let key = req.url.substr(7);
                        if (key[0] === "x") {
                            await vim.key(String.fromCharCode(+key.substr(1)));
                        } else if (key === "ESC") {
                            await vim.key("<esc>");
                        } else if (key === "ENTER") {
                            await vim.key("\n");
                        } else if (key === "DOT") {
                            await vim.key(".");
                        } else if (key === "SPACE") {
                            await vim.key(" ");
                        } else if (key === "BACKSPACE") {
                            await vscode.commands.executeCommand("deleteLeft");
                        } else if (key === "AND") {
                            await vim.key("&");
                        } else {
                            await vim.key(key);
                        }
                        res.end("OK");
                    } catch (e) {
                        res.end("FAIL");
                    }
                }
            } /*else if (req.method === "POST") {
                if (req.url === "/set")      
                let bodyParts = [];
                req.on("data", chunk => {
                    bodyParts.push(chunk);
                }).on("end", () => {
                    let body = Buffer.concat(bodyParts).toString();

                });
            }*/

            res.writeHead(404, {'Content-Type': 'text/plain'});
            res.end("Not found...");
        }).listen(9615);
    }

    startTestAPI();

    disposable = vscode.commands.registerCommand('extension.testReset', () => {

        /*let data = fs.readFileSync("C:\\hacks\\testbuffer.txt");
        vscode.window.activeTextEditor.edit((e) => {
            e.setEndOfLine(vscode.EndOfLine.LF);
            e.replace(vscode.window.activeTextEditor.document.validateRange(new vscode.Range(0, 0, Infinity, Infinity)), data.toString());
        }).then(() => {
            vscode.window.activeTextEditor.selection = new vscode.Selection(0, 0, 0, 0);
        });*/
    });
    context.subscriptions.push(disposable);

    disposable = vscode.commands.registerCommand('extension.testOutput', () => {
        let data = vscode.window.activeTextEditor.document.getText();
        let line = vscode.window.activeTextEditor.selection.start.line;
        let col = vscode.window.activeTextEditor.selection.start.character;
        // let result = { data, line: , character: vscode.window.activeTextEditor.selection.start.character };
        fs.writeFileSync("C:\\hacks\\testoutput.txt", line + ";" + col + ";" + data);
    });
    context.subscriptions.push(disposable);
}

export function deactivate() {
}