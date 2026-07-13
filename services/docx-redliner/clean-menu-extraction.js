const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

function shellQuote(value) {
    return `"${String(value).replace(/"/g, '\\"')}"`;
}

async function runPython(scriptPath, args, timeout) {
    const venvPython = path.join(__dirname, 'venv', 'bin', 'python');
    const python = fs.existsSync(venvPython) ? shellQuote(venvPython) : 'python3';
    const command = `${python} ${shellQuote(scriptPath)} ${args.map(shellQuote).join(' ')}`;
    return execAsync(command, { timeout, maxBuffer: 10 * 1024 * 1024 });
}

/**
 * Extract the clean, post-review menu representation from a DOCX.
 *
 * Approval callers first run the same accept-changes transformation as the
 * clean-download route, so stored HTML cannot retain tracked deletions or
 * reviewer formatting. Upload callers can use the cleaner directly because
 * it already omits those artifacts while extracting text.
 */
async function extractCleanMenuFromDocx(docxPath, { acceptChanges = false } = {}) {
    const extractScript = path.join(__dirname, 'extract_clean_menu_text.py');
    let sourcePath = docxPath;
    let tempDir = '';
    try {
        if (acceptChanges) {
            tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'menumanager-approved-clean-'));
            sourcePath = path.join(tempDir, 'approved-clean.docx');
            await runPython(path.join(__dirname, 'create_clean_approved_docx.py'), [docxPath, sourcePath], 120000);
        }
        const extractionResult = await runPython(extractScript, [sourcePath], 120000);
        // Node's exec promisifier returns { stdout, stderr }; test doubles and
        // a few wrappers return stdout directly, so accept both shapes.
        const stdout = typeof extractionResult === 'string' ? extractionResult : extractionResult.stdout;
        const parsed = JSON.parse((stdout || '{}').trim() || '{}');
        if (parsed.error) throw new Error(parsed.error);
        return parsed;
    } finally {
        if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

module.exports = { extractCleanMenuFromDocx };
