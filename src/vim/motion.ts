import { MotionAction, Motion, VimDocument, WordType } from "./common";

export function calculateMotion(doc: VimDocument, motion: MotionAction, index: number): Motion {
    if (motion.motion === "line") {
        const endPosition = doc.positionFromIndex(index).translate(motion.count - 1, 0, true);
        return {
            start: index,
            end: endPosition.index,
            inclusive: false,
            linewise: true,
        };
    }

    if (motion.motion === "jump") {
        return {
            start: index,
            end: motion.target,
            inclusive: true,
            linewise: false,
        };
    }

    if (motion.motion === "h") {
        const position = doc.positionFromIndex(index);
        if (position.column >= motion.count) {
            return {
                start: index,
                end: index - motion.count,
                inclusive: false,
                linewise: false,
            };
        }
        return {
            start: index,
            end: index - position.column,
            inclusive: false,
            linewise: false,
        };
    }

    if (motion.motion === "l") {
        const position = doc.positionFromIndex(index);
        const line = doc.getLineByIndex(index);
        if (position.column + motion.count < line.range.end.character) {
            return {
                start: index,
                end: index + motion.count,
                inclusive: false,
                linewise: false,
            };
        }
        return {
            start: index,
            end: index + (line.range.end.character - position.column),
            inclusive: false,
            linewise: false,
        };
    }

    if (motion.motion === "j") {
        const initialPosition = doc.positionFromIndex(index);
        const count = Math.min(motion.count, doc.lineCount() - initialPosition.line - 1);
        const position = initialPosition.translate(count, 0, false);
        if (!position) {
            return null;
        }
        return {
            start: index,
            end: position.index,
            inclusive: false,
            linewise: true,
        };
    }

    if (motion.motion === "k") {
        const initialPosition = doc.positionFromIndex(index);
        const count = Math.min(motion.count, initialPosition.line);
        const position = initialPosition.translate(-count, 0, false);
        if (!position) {
            return null;
        }
        return {
            start: index,
            end: position.index,
            inclusive: false,
            linewise: true,
        };
    }

    if (motion.motion === "0") {
        const position = doc.positionFromIndex(index);
        const newPosition = position.translate(0, -position.column, false);
        return {
            start: index,
            end: newPosition.index,
            inclusive: false,
            linewise: false,
        };
    }

    if (motion.motion === "^") {
        const position = doc.positionFromIndex(index);
        const lineIndex = doc.getLineByIndex(index).firstNonWhitespaceCharacterIndex;
        return {
            start: index,
            end: position.translate(0, lineIndex - position.column, false).index,
            inclusive: false,
            linewise: false,
        };
    }

    if (motion.motion === "$") {
        const lineNumber = doc.positionFromIndex(index).translate(motion.count - 1, 0, true).line;
        const line = doc.getLine(lineNumber);
        const endPosition = doc.positionFromLine(line.range.end.line, line.range.end.character - 1);
        return {
            start: index,
            end: endPosition.index,
            inclusive: true,
            linewise: false,
        };
    }

    if (motion.motion === "w") {
        let endIndex = index;
        for (let i = 0; i < motion.count; i++) {
            let currentWord = doc.getWord(endIndex);
            let nextWord = doc.getWord(currentWord.end + 1);
            if (!nextWord) {
                endIndex = currentWord.end;
                break;
            }
            endIndex = nextWord.end;
            if (nextWord.type === WordType.Whitespace) {
                nextWord = doc.getWord(nextWord.end + 1);
            }
            if (!nextWord) {
                break;
            }
            endIndex = nextWord.start;
        }
        return {
            start: index,
            end: endIndex,
            inclusive: false,
            linewise: false,
        };
    }

    if (motion.motion === "G") {
        let targetLine = (motion.count ? Math.min(motion.count, doc.lineCount()) : doc.lineCount()) - 1;
        const lineIndex = doc.getLine(targetLine).firstNonWhitespaceCharacterIndex;
        return {
            start: index,
            end: doc.positionFromLine(targetLine, lineIndex).index,
            inclusive: false,
            linewise: true,
        };
    }

    if (motion.motion === "gg") {
        let targetLine = (motion.count ? Math.min(motion.count, doc.lineCount()) : 1) - 1;
        const lineIndex = doc.getLine(targetLine).firstNonWhitespaceCharacterIndex;
        return {
            start: index,
            end: doc.positionFromLine(targetLine, lineIndex).index,
            inclusive: false,
            linewise: true,
        };
    }

    if (motion.motion === "W") {
        let endIndex = index;
        for (let i = 0; i < motion.count; i++) {
            let currentWord = doc.getWORD(endIndex);
            let nextWord = doc.getWORD(currentWord.end + 1);
            if (!nextWord) {
                endIndex = currentWord.end;
                break;
            }
            endIndex = nextWord.end;
            if (nextWord.type === WordType.Whitespace) {
                nextWord = doc.getWORD(nextWord.end + 1);
            }
            if (!nextWord) {
                break;
            }
            endIndex = nextWord.start;
        }
        return {
            start: index,
            end: endIndex,
            inclusive: false,
            linewise: false,
        };
    }

    if (motion.motion === "e") {
        let endIndex = index;
        for (let i = 0; i < motion.count; i++) {
            let currentWord = doc.getWord(endIndex);
            if (endIndex === currentWord.end) {
                currentWord = doc.getWord(currentWord.end + 1);
            }
            if (!currentWord) {
                break;
            }
            endIndex = currentWord.end;
            if (currentWord.type === WordType.Whitespace) {
                currentWord = doc.getWord(currentWord.end + 1);
            }
            if (!currentWord) {
                break;
            }
            endIndex = currentWord.end;
        }

        return {
            start: index,
            end: endIndex,
            inclusive: true,
            linewise: false,
        };
    }

    if (motion.motion === "E") {
        let endIndex = index;
        for (let i = 0; i < motion.count; i++) {
            let currentWord = doc.getWORD(endIndex);
            if (endIndex === currentWord.end) {
                currentWord = doc.getWORD(currentWord.end + 1);
            }
            if (!currentWord) {
                break;
            }
            endIndex = currentWord.end;
            if (currentWord.type === WordType.Whitespace) {
                currentWord = doc.getWORD(currentWord.end + 1);
            }
            if (!currentWord) {
                break;
            }
            endIndex = currentWord.end;
        }

        return {
            start: index,
            end: endIndex,
            inclusive: true,
            linewise: false,
        };
    }

    if (motion.motion === "b") {
        let endIndex = index;
        for (let i = 0; i < motion.count; i++) {
            let currentWord = doc.getWord(endIndex);
            if (endIndex === currentWord.start) {
                currentWord = doc.getWord(currentWord.start - 1);
            }
            if (!currentWord) {
                break;
            }
            endIndex = currentWord.start;
            if (currentWord.type === WordType.Whitespace) {
                currentWord = doc.getWord(currentWord.start - 1);
            }
            if (!currentWord) {
                break;
            }
            endIndex = currentWord.start;
        }

        return {
            start: index,
            end: endIndex,
            inclusive: false,
            linewise: false,
        };
    }

    if (motion.motion === "B") {
        let endIndex = index;
        for (let i = 0; i < motion.count; i++) {
            let currentWord = doc.getWORD(endIndex);
            if (endIndex === currentWord.start) {
                currentWord = doc.getWORD(currentWord.start - 1);
            }
            if (!currentWord) {
                break;
            }
            endIndex = currentWord.start;
            if (currentWord.type === WordType.Whitespace) {
                currentWord = doc.getWORD(currentWord.start - 1);
            }
            if (!currentWord) {
                break;
            }
            endIndex = currentWord.start;
        }

        return {
            start: index,
            end: endIndex,
            inclusive: true,
            linewise: false,
        };
    }

    if (motion.motion === "f" || motion.motion === "t") {
        let endIndex = index + 1;
        let k = 0;
        const text = doc.getText();
        for (; endIndex <= text.length; endIndex++) {
            if (endIndex === text.length || text[endIndex] === "\n")
                return null;
            if (text[endIndex] === motion.target) {
                k++;
                if (k === motion.count)
                    break;
            }
        }
        return {
            start: index,
            end: endIndex - (motion.motion === "t" ? 1 : 0),
            inclusive: true,
            linewise: false,
        };
    }

    if (motion.motion === "F" || motion.motion === "T") {
        let endIndex = index - 1;
        let k = 0;
        const text = doc.getText();
        for (; endIndex >= -1; endIndex--) {
            if (endIndex < 0 || text[endIndex] === "\n")
                return null;
            if (text[endIndex] === motion.target) {
                k++;
                if (k === motion.count)
                    break;
            }
        }
        return {
            start: index,
            end: endIndex + (motion.motion === "T" ? 1 : 0),
            inclusive: false,
            linewise: false,
        };
    }

    if (motion.motion === "-" || motion.motion === "\n" || motion.motion === "_" || motion.motion === "+") {
        const count = (motion.count * (motion.motion === "-" ? -1 : 1)) - (motion.motion === "_" ? 1 : 0);
        const targetLineNumber = Math.max(Math.min(doc.getLineByIndex(index).lineNumber + count, doc.lineCount() - 1), 0);
        const targetLine = doc.getLine(targetLineNumber);
        const targetColumn = targetLine.firstNonWhitespaceCharacterIndex;
        return {
            start: index,
            end: doc.positionFromLine(targetLineNumber, targetColumn).index,
            inclusive: false,
            linewise: true,
        };
    }

    if (motion.motion === "%") {
        // {count}% goes to a % of the file.
        if (motion.count) {
            const lineNumber = Math.floor((motion.count * doc.lineCount() + 99) / 100) - 1;
            const line = doc.getLine(lineNumber);
            return {
                start: index,
                end: doc.positionFromLine(lineNumber, line.firstNonWhitespaceCharacterIndex).index,
                inclusive: false,
                linewise: true,
            };
        }

        // % with no count goes to matching next brace.
        let endIndex = index;
        const matchingBraces = {
            "[": "]", "]": "[",
            "{": "}", "}": "{",
            "(": ")", ")": "(",
        };
        const text = doc.getText();
        for (; endIndex <= text.length; endIndex++) {
            if (endIndex === text.length || text[endIndex] === "\n")
                return null;

            if (/^[\(\[\{]$/.test(text[endIndex])) {
                const brace = text[endIndex];
                const matchingBrace = matchingBraces[brace];
                let unmatchedCount = 1;
                endIndex++;
                for (; endIndex < text.length; endIndex++) {
                    if (text[endIndex] === brace) {
                        unmatchedCount++;
                    } else if (text[endIndex] === matchingBrace) {
                        unmatchedCount--;
                        if (unmatchedCount === 0) {
                            return {
                                start: index,
                                end: endIndex,
                                inclusive: true,
                                linewise: false,
                            };
                        }
                    }
                }
                return null;
            } else if (/[\}\]\)]$/.test(text[endIndex])) {
                const brace = text[endIndex];
                const matchingBrace = matchingBraces[brace];
                let unmatchedCount = 1;
                endIndex--;
                for (; endIndex >= 0; endIndex--) {
                    if (text[endIndex] === brace) {
                        unmatchedCount++;
                    } else if (text[endIndex] === matchingBrace) {
                        unmatchedCount--;
                        if (unmatchedCount === 0) {
                            return {
                                start: index,
                                end: endIndex,
                                inclusive: true,
                                linewise: false,
                            };
                        }
                    }
                }
                return null;
            }
        }
        return null;
    }
}
