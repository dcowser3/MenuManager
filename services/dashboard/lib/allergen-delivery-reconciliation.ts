/** Reconcile model claims about applied allergen codes with delivered rows. */
export type AllergenDeliverySuggestion = { type?: string; menuItem?: string; description?: string; recommendation?: string; [key: string]: unknown };
const APPLIED = /\b(?:added|retain(?:ed)?)\b/i;
const CODE = /\b((?:VG|D|G|N|S|V)(?:\s*,\s*(?:VG|D|G|N|S|V))*)\b(?=\s+(?:allergen\s+)?codes?\b|[.:,;\s]*$)/i;
function row(menu: string, item: string): string | null {
    const needle = item.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
    const matches = menu.split('\n').filter(line => line.toLocaleLowerCase().replace(/\s+/g, ' ').includes(needle));
    return needle && matches.length === 1 ? matches[0] : null;
}
function codes(recommendation: string): string[] { const match = recommendation.match(CODE); return match ? match[1].toUpperCase().split(/\s*,\s*/) : []; }
function trailingCodes(line: string): string[] {
    const withoutPrice = line.replace(/\s+[$€£]?\s*\d+(?:[.,]\d+)?(?:\s*\|\s*[$€£]?\s*\d+(?:[.,]\d+)?)?\s*$/i, '');
    const match = withoutPrice.match(/(?:^|[\s,])([A-Z]{1,3}(?:(?:\s*,\s*|\s+)[A-Z]{1,3})*)\s*$/);
    return match ? match[1].split(/\s*,\s*|\s+/).filter(Boolean) : [];
}
export function reconcileAllergenDeliveryClaims<T extends AllergenDeliverySuggestion>(sourceMenu: string, deliveredMenu: string, suggestions: T[]): { suggestions: T[]; diagnostics: string[] } {
    const diagnostics: string[] = []; const reconciled: T[] = [];
    for (const suggestion of suggestions) {
        if (`${suggestion.type || ''}`.trim().toLowerCase() !== 'allergen code') { reconciled.push(suggestion); continue; }
        const description = `${suggestion.description || ''}`; const recommendation = `${suggestion.recommendation || ''}`;
        const sourceRow = row(sourceMenu, `${suggestion.menuItem || ''}`); const finalRow = row(deliveredMenu, `${suggestion.menuItem || ''}`);
        const undefinedCode = description.match(/\bcode\s+([A-Z]{1,3})\s+is\s+not\s+defined\b/i);
        if (undefinedCode && sourceRow && !trailingCodes(sourceRow).includes(undefinedCode[1].toUpperCase())) { diagnostics.push(`unsupported_allergen_code_source_claim:${undefinedCode[1].toUpperCase()}`); continue; }
        if (!APPLIED.test(`${description} ${recommendation}`)) { reconciled.push(suggestion); continue; }
        const claimed = codes(recommendation);
        if (!sourceRow || !finalRow || !claimed.length) { diagnostics.push(`allergen_delivery_claim_unresolved:${suggestion.menuItem || 'unknown'}`); reconciled.push({ ...suggestion, description: 'The claimed allergen-code change could not be verified against a unique submitted and delivered dish row.', recommendation: 'Unresolved; confirm the appropriate allergen coding with the chef before updating this dish.' } as T); continue; }
        const sourceCodes = trailingCodes(sourceRow); const finalCodes = trailingCodes(finalRow);
        if (claimed.every(code => finalCodes.includes(code))) { reconciled.push(suggestion); continue; }
        diagnostics.push(`allergen_delivery_claim_held:${suggestion.menuItem || 'unknown'}`);
        reconciled.push({ ...suggestion, description: 'The proposed allergen-code change was not applied to the delivered menu.', recommendation: 'Not applied; confirm the appropriate allergen coding with the chef before updating this dish.' } as T);
    }
    return { suggestions: reconciled, diagnostics };
}
