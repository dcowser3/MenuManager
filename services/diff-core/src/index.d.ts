export type DiffTokenType = 'word' | 'whitespace' | 'separator' | 'punctuation';

export type DiffToken = {
    value: string;
    start: number;
    end: number;
    type: DiffTokenType;
    normalized: string;
};

export type TokenLcs = {
    commonBase: Set<number>;
    commonRev: Set<number>;
};

export type DiffEdit = {
    type: 'equal' | 'delete' | 'insert';
    tokens: DiffToken[];
};

export type RichTextIndexEntry = {
    ch: string;
    tags: string[];
    newline?: boolean;
};

export type RichTextIndex = {
    plain: string;
    entries: RichTextIndexEntry[];
};

export function normalizeDiffTokenValue(value: string): string;
export function getDiffTokenType(value: string): DiffTokenType;
export function tokenizeDiffText(text: string): DiffToken[];
export function tokenizeWords(text: string): string[];
export function diffTokensEqual(left: DiffToken | null | undefined, right: DiffToken | null | undefined): boolean;
export function buildTokenLcs(baseTokens: DiffToken[], revisedTokens: DiffToken[]): TokenLcs;
export function buildTokenEdits(baseTokens: DiffToken[], revisedTokens: DiffToken[]): DiffEdit[];
export function createRichTextIndexFromHtml(html: string): RichTextIndex;
export function renderRichTextRange(entries: RichTextIndexEntry[], start: number, end: number, fallbackText?: string): string;
export function projectRichTextHtml(sourceHtml: string, targetText: string): string;
