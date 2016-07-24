
import * as vscode from "vscode";

export enum VimMode {
    Normal,
    Insert,
    Visual,
    Select,
    Cmdline,
    Ex,
    OperatorPending,
    Replace,
    VirtualReplace,
    InsertNormal,
    InsertVisual,
    InsertSelect,
    Jump,
}

function getCharacterType(c: string): WordType {
    if (c.match(/\s/)) {
        return WordType.Whitespace;
    }
    if (c.match(/\w/)) {
        return WordType.Text;
    }
    return WordType.Symbols;
}

export class VimDocument {
    private text: string;
    private document: vscode.TextDocument;

    public constructor(textDocument: vscode.TextDocument) {
        this.document = textDocument;
    }

    public positionFromIndex(index: number) {
        const position = this.document.positionAt(index);
        return new Position(this, index, position.line, position.character);
    }

    public positionFromLine(line: number, column: number) {
        const index = this.document.offsetAt(new vscode.Position(line, column));
        const position = this.document.positionAt(index);
        return new Position(this, index, position.line, position.character);
    }

    public getText(): string {
        if (!this.text) {
            this.text = this.document.getText();
        }
        return this.text;
    }

    public lineCount(): number {
        return this.document.lineCount;
    }

    public getLine(n: number): vscode.TextLine {
        return this.document.lineAt(n);
    }

    public getLineByIndex(index: number): vscode.TextLine {
        return this.document.lineAt(this.document.positionAt(index));
    }

    public getWord(index: number): Word {
        const text = this.getText();
        if (text[index] == null) {
            return null;
        }
        const wordType = getCharacterType(text[index]);
        let wordStart = index;
        for (; wordStart >= 0; wordStart--) {
            if (wordType !== getCharacterType(text[wordStart])) {
                wordStart++;
                break;
            }
        }
        let wordEnd = index;
        for (; wordEnd < text.length; wordEnd++) {
            if (wordType !== getCharacterType(text[wordEnd])) {
                wordEnd--;
                break;
            }
        }
        return {
            start: wordStart,
            end: wordEnd,
            type: wordType,
        }
    }

    public getWORD(index: number): Word {
        const text = this.getText();
        if (text[index] == null) {
            return null;
        }
        const wordType = !text[index].match(/\s/);
        let wordStart = index;
        for (; wordStart >= 0; wordStart--) {
            if (wordType !== !text[wordStart].match(/\s/)) {
                wordStart++;
                break;
            }
        }
        let wordEnd = index;
        for (; wordEnd < text.length; wordEnd++) {
            if (wordType !== !text[wordEnd].match(/\s/)) {
                wordEnd--;
                break;
            }
        }
        return {
            start: wordStart,
            end: wordEnd,
            type: wordType ? WordType.Text : WordType.Whitespace,
        }
    }
}

export class Position {
    public index: number;
    public column: number;
    public line: number;
    private document: VimDocument;

    public constructor(document: VimDocument, index: number, line: number, column: number) {
        this.document = document;
        this.index = index;
        this.column = column;
        this.line = line;
    }

    public translate(lineDelta: number, columnDelta: number, fix: boolean): Position {
        if (this.line + lineDelta < 0) {
            return fix ? new Position(this.document, 0, 0, 0) : null;
        }

        const pos = this.document.positionFromLine(this.line + lineDelta, this.column + columnDelta);
        if (!fix && (pos.line != this.line + lineDelta || pos.column != this.column + columnDelta)) {
            return null;
        }

        return new Position(this.document, pos.index, pos.line, pos.column);
    }
}

export interface MotionAction {
    type: "motion";
    motion: string;
    target?: any;
    count: number;
}

export interface ChangeModeAction {
    type: "changeMode";
    newMode: string;
    count: number;
}

export interface OperatorAction {
    type: "operator";
    operator: string;
}

export interface ObjectAction {
    type: "object";
    range: string;
    object: string;
    count: number;
}

export interface InstantAction {
    type: "instant";
    instant: string;
    count: number;
    target?: string;
    register: string;
}

export interface ReplaceAction {
    type: "replace";
    replace: string;
    count: number;
}

export type VimAction = MotionAction | ChangeModeAction | OperatorAction | ObjectAction | InstantAction | ReplaceAction;


export interface Word {
    start: number;
    end: number;
    type: WordType;
}

export interface Range {
    start: number;
    end: number;
}

export enum WordType {
    Text,
    Symbols,
    Whitespace,
}

export interface Motion {
    start: number;
    end: number;
    linewise: boolean;
    inclusive: boolean;
}
