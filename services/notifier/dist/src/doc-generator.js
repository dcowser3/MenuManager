"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateRedlinedDoc = generateRedlinedDoc;
const docx_1 = require("docx");
const buffer_1 = require("buffer");
async function generateRedlinedDoc(markedUpText) {
    const paragraphs = markedUpText.split('\n').map(line => {
        const runs = [];
        // Use a regex to split the line by our [DELETE] and [ADD] tags
        const parts = line.split(/(\[DELETE\].*?\[\/DELETE\]|\[ADD\].*?\[\/ADD\])/g);
        parts.forEach(part => {
            if (part.startsWith('[DELETE]')) {
                runs.push(new docx_1.TextRun({
                    text: part.replace('[DELETE]', '').replace('[/DELETE]', ''),
                    color: "FF0000",
                    strike: true,
                }));
            }
            else if (part.startsWith('[ADD]')) {
                runs.push(new docx_1.TextRun({
                    text: part.replace('[ADD]', '').replace('[/ADD]', ''),
                    color: "00B050", // Green
                    bold: true,
                }));
            }
            else if (part) {
                runs.push(new docx_1.TextRun(part));
            }
        });
        return new docx_1.Paragraph({ children: runs });
    });
    const doc = new docx_1.Document({
        sections: [{
                properties: {},
                children: paragraphs,
            }],
    });
    const buffer = await docx_1.Packer.toBuffer(doc);
    return buffer_1.Buffer.from(buffer);
}
