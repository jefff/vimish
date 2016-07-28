import * as vscode from "vscode";
import {
    VimMode, VimAction, Range, VimDocument, Motion,
    ObjectAction, MotionAction, ChangeModeAction, OperatorAction, InstantAction, ReplaceAction,
} from "./common";
import { calculateMotion } from "./motion";

interface VimRegister {
    linewise: boolean;
    text: string;
}

function modeText(mode: VimMode): string {
    return {
        [VimMode.Normal]: "-- NORMAL --",
        [VimMode.Insert]: "-- INSERT --",
        [VimMode.Visual]: "-- VISUAL --",
        [VimMode.OperatorPending]: "-- NORMAL -- (o)",
        [VimMode.Jump]: "-- JUMP -- ",
    }[mode];
}

function setToLetterGroups(indexSet: number[]): ({ [letter: string]: number[] }) {
    const letterGroups: { [letter: string]: number[] } = {};
    for (let i = 0; i < 26; i++) {
        letterGroups[String.fromCharCode(65 + i)] = [];
    }

    let k = 0;
    indexSet.forEach(i => {
        letterGroups[String.fromCharCode(65 + k)].push(i);
        k = (k + 1) % 26;
    });

    return letterGroups;
}

function escapeRegExp(str: string) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
}

export class Vim {
    public mode: VimMode;
    // A fake mode used to represent multi-key actions
    private pseudoMode: string;
    private pseudoModeParameter: string;
    // In Operator Pending mode, what operator is pending
    private operatorPending: string;
    // The 'range' of the targeted object. Either 'a' or 'i'.
    private objectRange: string;
    // The [partially] entered count before a command
    private enteredCount: string;
    // The [partially] entered count before an object
    private operatorCount: string;
    // A string representing the keys the make up the current command
    private enteredText: string;
    // The last action that was performed on the document
    private lastAction: VimAction;
    // The set of indexes that each letter represents in jump mode
    private lastLineSearch: { motion: string, target: string };
    private indexSet: { [letter: string]: number[] };
    // The destination register for the currently entered command
    private registerTarget: string;

    private registers: { [register: string]: VimRegister };
    private marks: { [letter: string]: vscode.Position };

    private modeStatusBar: vscode.StatusBarItem;
    private enteredTextStatusBar: vscode.StatusBarItem;

    private decorators: { [letter: string]: vscode.TextEditorDecorationType };

    constructor() {
        this.mode = VimMode.Normal;
        this.enteredCount = "";
        this.enteredText = "";
        this.lastAction = null;

        this.decorators = {};
        for (let i = 0; i < 26; i++) {
            let c = String.fromCharCode(65 + i);
            this.decorators[c] = vscode.window.createTextEditorDecorationType(<any> {
                isWholeLine: false,
                before: {
                    color: "rgba(255, 255, 255, 1)",
                    backgroundColor: "rgba(0, 0, 255, 1);position: absolute",
                    contentText: c,
                },
            });
        }

        this.registers = {};
        this.marks = {};
    }

    public updateSelection(selections: vscode.Selection[]) {
        if (this.mode === VimMode.Visual && selections.every(s => s.start.isEqual(s.end))) {
            this.setMode(VimMode.Normal, true);
        } else if ((this.mode === VimMode.Normal || this.mode === VimMode.OperatorPending) &&
            selections.some(s => !s.start.isEqual(s.end))) {
            this.setMode(VimMode.Visual, true);
        }
        this.cleanSelection(selections);
    }

    public setMode(mode: VimMode, reset: boolean) {
        if (reset) {
            this.operatorCount = "";
            this.pseudoMode = null;
            this.pseudoModeParameter = null;
            this.operatorPending = null;
            this.enteredCount = "";
            this.objectRange = null;
            this.indexSet = null;
            this.enteredText = "";
            this.registerTarget = '"';
            for (const v of Object.keys(this.decorators)) {
                vscode.window.activeTextEditor.setDecorations(this.decorators[v], []);
            }
        }
        this.mode = mode;

        this.updateUI();
    }

    public updateUI() {
        if (!this.modeStatusBar)
            this.modeStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);

        if (vscode.window.activeTextEditor) {
            if (this.mode === VimMode.Insert || this.mode === VimMode.Visual)
                vscode.window.activeTextEditor.options = { cursorStyle: vscode.TextEditorCursorStyle.Line };
            else if (this.mode === VimMode.Normal)
                vscode.window.activeTextEditor.options = { cursorStyle: vscode.TextEditorCursorStyle.Block };
        }

        this.modeStatusBar.text = modeText(this.mode);
        this.modeStatusBar.show();
    }

    public async key(key: string) {
        try {
            switch (this.mode) {
                case VimMode.Normal:
                    this.enteredText += key;
                    await this.normalKey(key);
                    break;

                case VimMode.Jump:
                    this.enteredText += key;
                    this.jumpKey(key);
                    break;

                case VimMode.OperatorPending:
                    this.enteredText += key;
                    await this.keyOperatorPending(key);
                    break;

                case VimMode.Insert:
                    if (key === "<esc>") {
                        const line = vscode.window.activeTextEditor.selection.start.line;
                        const col = Math.max(vscode.window.activeTextEditor.selection.start.character - 1, 0);
                        vscode.window.activeTextEditor.selection = new vscode.Selection(line, col, line, col);
                        this.setMode(VimMode.Normal, true);
                    } else {
                        await vscode.commands.executeCommand("default:type", { text: key });
                    }
                    break;

                case VimMode.Visual:
                    await this.visualKey(key);
                    break;

                default:
                    this.setMode(VimMode.Normal, true);
            }

            if (!this.enteredTextStatusBar)
                this.enteredTextStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
            this.enteredTextStatusBar.text = this.enteredText;
            this.enteredTextStatusBar.show();
        } catch (e) {
            console.error(e);
        }
    }

    public cleanSelection(selections: vscode.Selection[]) {
        if (this.mode === VimMode.Normal || this.mode === VimMode.OperatorPending) {
            let updateSelections = false;
            let newSelections = selections.map(s => {
                if (s.start.character === 0 || s.start.compareTo(s.end) !== 0)
                    return s;

                if (vscode.window.activeTextEditor.document.validatePosition(s.start.translate(0, 1)).character === s.start.character) {
                    updateSelections = true;
                    return new vscode.Selection(s.start.line, s.start.character - 1, s.start.line, s.start.character - 1);
                } else {
                    return s;
                }
            });
            if (updateSelections)
                vscode.window.activeTextEditor.selections = newSelections;
        }
    }

    public getNormalCommand(key: string): VimAction {
        if (this.pseudoMode === "f") {
            this.pseudoMode = null;
            this.lastLineSearch = { motion: this.pseudoModeParameter, target: key };
            return { type: "motion", motion: this.pseudoModeParameter, target: key, count: Number(this.enteredCount || "1") };
        }

        if (this.pseudoMode === "g") {
            this.pseudoMode = null;
            if (key === "g")
                return { type: "motion", motion: "gg", count: Number(this.enteredCount || "0") };
            if (key === "I")
                return { type: "changeMode", newMode: "gI", count: 1 };
            this.setMode(VimMode.Normal, true);
            return null;
        }

        if (this.pseudoMode === "r") {
            this.pseudoMode = null;
            return { type: "replace", replace: key, count: Number(this.enteredCount || "1") };
        }

        if (this.pseudoMode === "Q") {
            return this.jumpKey(key);
        }

        if (this.pseudoMode === '"') {
            this.registerTarget = key;
            this.pseudoMode = null;
            return null;
        }

        if (this.pseudoMode === "m") {
            this.pseudoMode = null;
            return { type: "instant", instant: "m", count: 1, register: this.registerTarget, target: key };
        }

        if (this.pseudoMode === "`" || this.pseudoMode === "'") {
            const markType = this.pseudoMode;
            this.pseudoMode = null;
            return { type: "motion", motion: markType, count: 1, target: key };
        }

        // Object
        if (this.pseudoMode === "o") {
            this.pseudoMode = null;
            if (key.match(/^[wWsp\]\[\)\(<>t{}"'bB]$/)) {
                return { type: "object", range: this.objectRange, object: key, count: Number(this.enteredCount || "1") };
            }
        }

        if (this.mode === VimMode.OperatorPending) {
            if (key === this.operatorPending)
                return { type: "motion", motion: "line", count: Number(this.enteredCount || "1") };
        }

        if (this.mode === VimMode.Visual) {
            if (key.match(/^[dcCRSsxuUyY]$/))
                return { type: "instant", instant: key, count: Number(this.enteredCount || "1"), register: this.registerTarget };
        }

        if (key.match(/^[1-9]$/) || (key === "0" && this.enteredCount.length > 0)) {
            this.enteredCount += key;
            return null;
        }

        // Motion
        if (key.match(/^[0wWeEhjkl$^bBG\-\n+_;,%]$/)) {
            if (key === "G" || key === "%")
                return { type: "motion", motion: key, count: Number(this.enteredCount || "0") };
            return { type: "motion", motion: key, count: Number(this.enteredCount || "1") };
        }

        if (key.match(/^[fFtT]$/)) {
            this.pseudoMode = "f";
            this.pseudoModeParameter = key;
            return null;
        }

        if (key.match(/^[grmQ"'`]$/)) {
            this.pseudoMode = key;
            return null;
        }

        if (this.mode === VimMode.Normal) {
            // Mode switch
            if (key.match(/^[iIaAoOvV]$/))
                return { type: "changeMode", newMode: key, count: Number(this.enteredCount || "1") };

            // Operators
            if (key.match(/^[cdy]$/))
                return { type: "operator", operator: key };

            // Action
            if (key.match(/^[upPxXCDYSs]$/))
                return { type: "instant", instant: key, count: Number(this.enteredCount || "1"), register: this.registerTarget };

            if (key === ".") {
                this.doNormalAction(this.lastAction);
                this.setMode(VimMode.Normal, true);
                return null;
            }
        } else if (this.mode === VimMode.Visual || this.mode === VimMode.OperatorPending) {
            if (key.match(/^[ia]$/)) {
                this.pseudoMode = "o";
                this.objectRange = key;
                return null;
            }
        }

        this.setMode(VimMode.Normal, true);
        return null;
    }

    public documentChanged(e: vscode.TextDocumentChangeEvent) {
        if (e) {
            for (const change of e.contentChanges) {
                for (const c in this.marks) {
                    if (!this.marks[c])
                        continue;
                    if (change.range.contains(this.marks[c]))
                        this.marks[c] = null;
                }
            }

            for (const change of e.contentChanges) {
                let netLines = -Math.abs(change.range.end.line - change.range.start.line) +
                    (change.text.match(/\n/g) || []).length;
                const newMarks: { [letter: string]: vscode.Position } = {};
                for (const c in this.marks) {
                    if (!this.marks.hasOwnProperty(c))
                        continue;
                    if (!this.marks[c] || this.marks[c].isBefore(change.range.start) ||
                        this.marks[c].isBefore(change.range.end)) {
                        newMarks[c] = this.marks[c];
                        continue;
                    }
                    newMarks[c] = this.marks[c].translate(netLines, 0);
                }
                this.marks = newMarks;
            }
        }
    }

    private static findLeftRightRange(leftCharacter: string, rightCharacter: string,
                                      index: number, includeEnclosing: boolean, crossNewlines: boolean): Range {
        // TODO: detect if we're on a character
        let startIndex = Vim.findNextChar(leftCharacter, index, -1, crossNewlines);
        if (startIndex === -1)
            return null;
        let endIndex = Vim.findNextChar(rightCharacter, index, 1, crossNewlines);
        if (endIndex === -1)
            return null;
        // TODO: return null on non-enclosed adjacent characters <>
        return includeEnclosing ? { start: startIndex, end: endIndex } : { start: startIndex + 1, end: endIndex - 1 };
    }

    private static findNextChar(character: string, startIndex: number, direction: number, crossNewlines: boolean): number {
        const doc = vscode.window.activeTextEditor.document.getText();
        for (let i = startIndex; i > 0 && i < doc.length; i += direction) {
            if (!crossNewlines && doc[i] === "\n")
                return -1;
            if (doc[i] === character)
                return i;
        }
        return -1;
    }

    private static findEnclosedRange(character: string, index: number, includeEnclosing: boolean, crossNewlines: boolean): Range {
        const doc = vscode.window.activeTextEditor.document.getText();
        if (doc[index] === character) {
            // TODO: Count from start of line
        }

        return Vim.findLeftRightRange(character, character, index, includeEnclosing, crossNewlines);
    }

    private static calculateObject(doc: VimDocument, object: ObjectAction, index: number): Range {
        if (object.object === "w") {
            const word = doc.getWord(index);
            return {
                start: word.start,
                end: word.end,
            };
        }

        if (object.object === "W") {
            const word = doc.getWORD(index);
            return {
                start: word.start,
                end: word.end,
            };
        }

        switch (object.object) {
            case '"':
            case "'":
            case "`":
                return Vim.findEnclosedRange(object.object, index, object.range === "a", false);

            case "[":
            case "]":
                return Vim.findLeftRightRange("[", "]", index, object.range === "a", true);

            case "(":
            case ")":
            case "b":
                return Vim.findLeftRightRange("(", ")", index, object.range === "a", true);

            case "{":
            case "}":
            case "B":
                return Vim.findLeftRightRange("{", "}", index, object.range === "a", true);

            case "<":
            case ">":
                return Vim.findLeftRightRange("<", ">", index, object.range === "a", true);

            default:
                return null;
        }
    }

    private jumpKey(key: string): MotionAction {
        key = key.toUpperCase();
        let action: MotionAction = null;
        if (this.indexSet == null) {
            const searchRegex = new RegExp(escapeRegExp(key), "ig");
            const text = vscode.window.activeTextEditor.document.getText();
            let match;
            const newIndexSet = [];
            /* tslint:disable */
            while (match = searchRegex.exec(text)) {
                newIndexSet.push(match.index);
            }
            /* tslint:enable */
            this.indexSet = setToLetterGroups(newIndexSet);
        } else {
            const newIndexSet = this.indexSet[key];
            if (!newIndexSet || newIndexSet.length === 0) {
                this.setMode(VimMode.Normal, true);
                this.indexSet = null;
                this.pseudoMode = null;
            } else if (newIndexSet.length === 1) {
                this.indexSet = null;
                action = { type: "motion", motion: "jump", count: 1, target: newIndexSet[0] };
            } else {
                this.indexSet = setToLetterGroups(newIndexSet);
            }
        }

        if (this.indexSet) {
            for (const v of Object.keys(this.indexSet)) {
                vscode.window.activeTextEditor.setDecorations(this.decorators[v], this.indexSet[v].map(i => {
                    let p = vscode.window.activeTextEditor.document.positionAt(i);
                    return new vscode.Range(p.line, p.character, p.line, p.character + 1);
                }));
            }
        } else {
            for (const v of Object.keys(this.decorators)) {
                vscode.window.activeTextEditor.setDecorations(this.decorators[v], []);
            }
        }
        return action;
    }

    private async performOperation(operator: string, motion: Motion) {
        const active = vscode.window.activeTextEditor;
        const doc = new VimDocument(vscode.window.activeTextEditor.document);

        if (motion.end < motion.start) {
            const temp = motion.start;
            motion.start = motion.end;
            motion.end = temp;
        }
        if (motion.inclusive)
            motion.end++;

        if (motion.linewise) {
            const startLine = doc.getLineByIndex(motion.start);
            const endLine = doc.getLineByIndex(motion.end);
            const text = active.document.getText(new vscode.Range(startLine.range.start, endLine.range.end)) + "\n";
            this.registers[this.registerTarget] = { linewise: true, text };
        } else {
            this.registers[this.registerTarget] = { linewise: false, text: doc.getText().substring(motion.start, motion.end) };
        }

        if (operator === "y") {
            this.setMode(VimMode.Normal, true);
        } else if (operator === "c" || operator === "d") {
            let motionIncludesLastLine = false;
            let motionIncludesFirstLine = false;
            await active.edit(e => {
                if (motion.linewise) {
                    const startLineNumber = active.document.positionAt(motion.start).line;
                    const endLine = active.document.lineAt(active.document.positionAt(motion.end).line);
                    // If we're deleting the last line, we can't get rid of the trailing newline (vscode bug?), so instead, push the
                    // starting position back to remove the newline from the line above. The two cancel out and achieve the expected
                    // behavior of no trailing newline.
                    motionIncludesLastLine = endLine.lineNumber === doc.lineCount() - 1;
                    motionIncludesFirstLine = startLineNumber === 0;
                    if (motionIncludesFirstLine && motionIncludesLastLine) {
                        // The range is the entire document, so just delete everything.
                        this.registers[this.registerTarget] = { linewise: true, text: doc.getText() };
                        e.delete(active.document.validateRange(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(Infinity, Infinity))));
                        return;
                    }
                    const startPosition = motionIncludesLastLine ?
                        active.document.lineAt(active.document.positionAt(motion.start).line - 1).range.end :
                        active.document.lineAt(active.document.positionAt(motion.start).line).rangeIncludingLineBreak.start;
                    const endPosition = new vscode.Position(endLine.lineNumber + 1, 0);
                    // TODO: Should go into a register
                    // this.registers[this.registerTarget] = { linewise: true, text: active.document.getText(new vscode.Range(startPosition, endPosition)) };
                    e.delete(new vscode.Range(startPosition, endPosition));
                } else {
                    // TODO: Should go into a register
                    // this.registers[this.registerTarget] = { linewise: false, text: doc.getText().substring(motion.start, motion.end) };
                    e.delete(new vscode.Selection(active.document.positionAt(motion.start), active.document.positionAt(motion.end)));
                    active.selection = new vscode.Selection(active.document.positionAt(motion.start), active.document.positionAt(motion.start));
                }
            });
            this.setMode(operator === "c" ? VimMode.Insert : VimMode.Normal, true);
            // TODO: Do this a less terrible way.
            if (motion.linewise && operator === "c") {
                if (motionIncludesLastLine) {
                    if (!motionIncludesFirstLine)
                        await vscode.commands.executeCommand("editor.action.insertLineAfter");
                } else {
                    await vscode.commands.executeCommand("editor.action.insertLineBefore");
                }
            } else if (motion.linewise && operator === "d") {
                if (motionIncludesLastLine)
                    await vscode.commands.executeCommand("cursorHome");
            }
            this.cleanSelection(vscode.window.activeTextEditor.selections);
        }
    }

    private calculateMotion(doc: VimDocument, motion: MotionAction, index: number): Motion {
        if (motion.motion === "`" || motion.motion === "'") {
            if (!this.marks[motion.target])
                return null;
            const mark = this.marks[motion.target];
            const linewise = motion.motion === "'";
            const endIndex =
                doc.positionFromLine(mark.line, linewise ? doc.getLine(mark.line).firstNonWhitespaceCharacterIndex : mark.character).index;

            return {
                start: index,
                end: endIndex,
                linewise: motion.motion === "'",
                inclusive: false,
            };
        }

        if (motion.motion === ";" || motion.motion === ",") {
            if (!this.lastLineSearch)
                return null;
            let lineMotion = this.lastLineSearch.motion;
            if (motion.motion === ",") {
                // Flip the direction of the search
                lineMotion = {
                    "t": "T", "T": "t",
                    "f": "F", "F": "f",
                }[lineMotion];
            }
            let count = motion.count;
            const calculatedMotion = calculateMotion(doc, {
                type: "motion",
                motion: lineMotion,
                target: this.lastLineSearch.target,
                count: count,
            }, index);
            if (lineMotion.toLowerCase() === "t" && calculatedMotion.start === calculatedMotion.end) {
                // Repeat 'until' line motions should always move even if the motion being typed again would not move
                // from that position. TODO: Do this a less hacky way.
                return calculateMotion(doc, {
                    type: "motion",
                    motion: lineMotion,
                    target: this.lastLineSearch.target,
                    count: count + 1,
                }, index);
            }
            return calculatedMotion;
        }

        return calculateMotion(doc, motion, index);
    }

    private async keyOperatorPending(key: string) {
        if (key === "<esc>") {
            vscode.window.activeTextEditor.selections = vscode.window.activeTextEditor.selections.map(s =>
                new vscode.Selection(s.active, s.active)
            );
            return this.setMode(VimMode.Normal, true);
        }

        const active = vscode.window.activeTextEditor;
        const selStart = active.selection.start;
        const doc = new VimDocument(vscode.window.activeTextEditor.document);

        const command = this.getNormalCommand(key);
        if (!command)
            return;

        if (command.type === "motion") {
            const motionCommand = command as MotionAction;
            motionCommand.count = Number(this.enteredCount || "1") * Number(this.operatorCount || "1");
            // Hack to clear out the count for commands that treat null differently than 1.
            if (motionCommand.motion === "G" || motionCommand.motion === "gg" || motionCommand.motion === "%") {
                if (!this.enteredCount && !this.operatorCount)
                    motionCommand.count = 0;
            }
            // Hack to turn cw -> ce, which is default Vim behavior
            if (this.operatorPending === "c") {
                if (motionCommand.motion === "w")
                    motionCommand.motion = "e";
                else if (motionCommand.motion === "W")
                    motionCommand.motion = "E";
            }

            const motion = this.calculateMotion(doc, motionCommand, active.document.offsetAt(selStart));
            if (!motion) {
                this.setMode(VimMode.Normal, true);
                return;
            }

            if (this.operatorPending === "c" || this.operatorPending === "d" || this.operatorPending === "y") {
                await this.performOperation(this.operatorPending, motion);
            } else {
                this.setMode(VimMode.Normal, true);
            }
        } else if (command.type === "object") {
            const objectCommand = command as ObjectAction;
            const object = Vim.calculateObject(doc, objectCommand, active.document.offsetAt(selStart));
            if (object) {
                await active.edit(e => {
                    e.delete(new vscode.Selection(active.document.positionAt(object.start), active.document.positionAt(object.end + 1)));
                    active.selection = new vscode.Selection(active.document.positionAt(object.start), active.document.positionAt(object.start));

                });
                this.setMode(this.operatorPending === "c" ? VimMode.Insert : VimMode.Normal, true);
                this.cleanSelection(vscode.window.activeTextEditor.selections);
            } else {
                this.setMode(VimMode.Normal, true);
            }
        }
    }

    private async visualKey(key: string) {
        if (key === "<esc>") {
            vscode.window.activeTextEditor.selections = vscode.window.activeTextEditor.selections.map(s =>
                new vscode.Selection(s.active, s.active)
            );
            return this.setMode(VimMode.Normal, true);
        }

        const active = vscode.window.activeTextEditor;
        const activeCursor = active.selection.active;
        const doc = new VimDocument(vscode.window.activeTextEditor.document);

        const command = this.getNormalCommand(key);
        if (!command)
            return;

        if (command.type === "motion") {
            const motion = this.calculateMotion(doc, command as MotionAction, active.document.offsetAt(activeCursor));
            if (motion) {
                if (motion.inclusive)
                    motion.end++;
                active.selection = new vscode.Selection(active.selection.anchor, active.document.positionAt(motion.end));
                active.revealRange(active.selection);
            }
        } else if (command.type === "instant") {
            const instant = command as InstantAction;
            const motion = {
                start: active.document.offsetAt(active.selection.start),
                end: active.document.offsetAt(active.selection.end),
                linewise: false,
                inclusive: false,
            };
            switch (instant.instant) {
                case "x":
                    if (instant.instant === "x")
                        instant.instant = "d";
                case "d":
                case "c":
                case "y":
                    await this.performOperation(instant.instant, motion);
                    active.selection = new vscode.Selection(active.selection.start, active.selection.start);
                    this.setMode(instant.instant === "c" ? VimMode.Insert : VimMode.Normal, true);
                    break;

                case "X":
                    if (instant.instant === "X")
                        instant.instant = "D";
                case "R":
                    if (instant.instant === "R")
                        instant.instant = "C";
                case "D":
                case "C":
                case "Y":
                    motion.linewise = true;
                    await this.performOperation(instant.instant.toLowerCase(), motion);
                    const startLine = new vscode.Position(active.selection.start.line, 0);
                    active.selection = new vscode.Selection(startLine, startLine);
                    this.setMode(instant.instant === "C" ? VimMode.Insert : VimMode.Normal, true);
                    break;

                case "u":
                case "U":
                    await active.edit(e => {
                        const text = active.document.getText(active.selection);
                        e.replace(active.selection, instant.instant === "U" ? text.toUpperCase() : text.toLowerCase());
                    });
                    active.selection = new vscode.Selection(active.selection.start, active.selection.start);
                    this.setMode(VimMode.Normal, true);
                    break;

                default:
                    return;
            }
        } else if (command.type === "replace") {
            const text = active.document.getText(active.selection).replace(/[^\r\n]/g, (command as ReplaceAction).replace);
            await active.edit(e => {
                e.replace(active.selection, text);
            });
            active.selection = new vscode.Selection(active.selection.start, active.selection.start);
            this.setMode(VimMode.Normal, true);
        } else if (command.type === "object") {
            const objectCommand = command as ObjectAction;
            const object = Vim.calculateObject(doc, objectCommand, active.document.offsetAt(activeCursor));
            if (object) {
                const newRange = active.selection.union(new vscode.Range(active.document.positionAt(object.start), active.document.positionAt(object.end)));
                active.selection = new vscode.Selection(newRange.start, newRange.end);
                active.revealRange(active.selection);
            }
        }
    }

    private async normalKey(key: string) {
        if (key === "<esc>") {
            vscode.window.activeTextEditor.selections = vscode.window.activeTextEditor.selections.map(s =>
                new vscode.Selection(s.active, s.active)
            );
            return this.setMode(VimMode.Normal, true);
        }

        const command = this.getNormalCommand(key);
        if (!command)
            return;

        this.doNormalAction(command);
        this.lastAction = command;
    }

    private async doNormalAction(command: VimAction) {
        const active = vscode.window.activeTextEditor;
        const selStart = active.selection.start;
        const doc = new VimDocument(vscode.window.activeTextEditor.document);

        if (command.type === "motion") {
            const motion = this.calculateMotion(doc, command as MotionAction, active.document.offsetAt(selStart));
            if (motion) {
                active.selection = new vscode.Selection(active.document.positionAt(motion.end), active.document.positionAt(motion.end));
                active.revealRange(active.selection);
            }
            this.setMode(VimMode.Normal, true);
        } else if (command.type === "changeMode") {
            switch ((command as ChangeModeAction).newMode) {
                case "i":
                    return this.setMode(VimMode.Insert, true);
                case "I":
                    const targetColumn = active.document.lineAt(selStart.line).firstNonWhitespaceCharacterIndex;
                    active.selection = new vscode.Selection(selStart.line, targetColumn, selStart.line, targetColumn);
                    return this.setMode(VimMode.Insert, true);
                case "a":
                    active.selection = new vscode.Selection(selStart.line, selStart.character + 1, selStart.line, selStart.character + 1);
                    this.setMode(VimMode.Insert, true);
                    return;
                case "A":
                    const lineEnd = active.document.lineAt(selStart.line).range.end.character;
                    active.selection = new vscode.Selection(selStart.line, lineEnd, selStart.line, lineEnd);
                    return this.setMode(VimMode.Insert, true);
                case "o":
                    this.setMode(VimMode.Insert, true);
                    await vscode.commands.executeCommand("editor.action.insertLineAfter");
                    return;
                case "O":
                    this.setMode(VimMode.Insert, true);
                    await vscode.commands.executeCommand("editor.action.insertLineBefore");
                    return;
                case "gI":
                    active.selection = new vscode.Selection(selStart.line, 0, selStart.line, 0);
                    return this.setMode(VimMode.Insert, true);
                case "v":
                    return this.setMode(VimMode.Visual, true);
                default:
                    return this.setMode(VimMode.Normal, true);
            }
        } else if (command.type === "operator") {
            this.operatorPending = (command as OperatorAction).operator;
            this.operatorCount = this.enteredCount;
            this.enteredCount = "";
            this.setMode(VimMode.OperatorPending, false);
        } else if (command.type === "replace") {
            const replace = command as ReplaceAction;
            const line = doc.getLine(selStart.line);
            if (selStart.character + replace.count <= line.text.length) {
                await active.edit(e => {
                    e.replace(new vscode.Range(selStart, selStart.translate(0, replace.count)), new Array(replace.count + 1).join(replace.replace));
                });
                active.selection = new vscode.Selection(selStart.translate(0, replace.count - 1), selStart.translate(0, replace.count - 1));
            }
            this.setMode(VimMode.Normal, true);
        } else if (command.type === "instant") {
            const instant = command as InstantAction;
            switch (instant.instant) {
                case "u":
                    await vscode.commands.executeCommand("undo");
                    this.setMode(VimMode.Normal, true);
                    break;
                case "x":
                case "s":
                    // TODO: Cap to line
                    await active.edit(e => {
                        e.delete(new vscode.Range(selStart, selStart.translate(0, instant.count)));
                    });
                    this.setMode(instant.instant === "x" ? VimMode.Normal : VimMode.Insert, true);
                    this.cleanSelection(vscode.window.activeTextEditor.selections);
                    break;
                case "X":
                    await active.edit(e => {
                        e.delete(new vscode.Range(selStart, selStart.translate(0, Math.max(-instant.count, -selStart.character))));
                    });
                    this.setMode(VimMode.Normal, true);
                    break;
                case "D":
                case "C":
                    const endLineNumber = Math.min(selStart.line + instant.count - 1, doc.lineCount() - 1);
                    const endLine = doc.getLine(endLineNumber);
                    await this.performOperation(instant.instant.toLowerCase(), {
                        start: active.document.offsetAt(selStart),
                        end: active.document.offsetAt(endLine.range.end),
                        linewise: false,
                        inclusive: false,
                    });
                    break;
                case "Y":
                    const lineMotion = calculateMotion(doc, { motion: "line", type: "motion", count: instant.count }, active.document.offsetAt(selStart));
                    await this.performOperation("y", lineMotion);
                    this.setMode(VimMode.Normal, true);
                    break;
                case "S":
                    const sMotionAction: MotionAction = { type: "motion", motion: "line", count: instant.count };
                    const sMotion = calculateMotion(doc, sMotionAction, active.document.offsetAt(selStart));
                    await this.performOperation("c", sMotion);
                    break;
                case "P":
                case "p":
                    if (this.registers[instant.register]) {
                        const reg = this.registers[instant.register];
                        const regText = (new Array(instant.count + 1).join(reg.text));
                        if (reg.linewise) {
                            const line = doc.getLine(selStart.line);
                            let text = regText;
                            let insertPosition: vscode.Position;
                            let cursorPosition: vscode.Position;
                            if (instant.instant === "P") {
                                cursorPosition = insertPosition = line.rangeIncludingLineBreak.start;
                            } else {
                                cursorPosition = insertPosition = line.rangeIncludingLineBreak.end;
                                if (line.lineNumber === doc.lineCount() - 1) {
                                    // If the line does not end with a line break (i.e., it's the last line) add one.
                                    text = "\n" + text.replace(/(\r?\n)+$/, "");
                                    cursorPosition = new vscode.Position(selStart.line + 1, 0);
                                }
                            }
                            await active.edit(e => e.insert(insertPosition, text));
                            active.selection = new vscode.Selection(cursorPosition, cursorPosition);
                        } else {
                            const insertPosition = instant.instant === "P" ? selStart : selStart.translate(0, 1);
                            await active.edit(e => e.insert(insertPosition, regText));
                            // If the inserted text contains a newline, the cursor is moved to the start. If it
                            // doesn't, it's moved to the end. I cannot imagine what justification there is for
                            // this behavior, but it's replicated here.
                            if (regText.indexOf("\n") !== -1) {
                                active.selection = new vscode.Selection(insertPosition, insertPosition);
                            } else {
                                const insertEnd = insertPosition.translate(0, regText.length - 1);
                                active.selection = new vscode.Selection(insertEnd, insertEnd);
                            }
                        }
                    }
                    this.setMode(VimMode.Normal, true);
                    break;
                case "m":
                    this.marks[instant.target] = selStart;
                    this.setMode(VimMode.Normal, true);
                    this.documentChanged(null);
                    break;
                default:
            }
        }
    }
}
