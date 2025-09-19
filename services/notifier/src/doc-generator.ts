import { Document, Packer, Paragraph, TextRun } from "docx";
import { Buffer } from "buffer";

export async function generateRedlinedDoc(markedUpText: string): Promise<Buffer> {
    const paragraphs = markedUpText.split('\n').map(line => {
        const runs: TextRun[] = [];
        // Use a regex to split the line by our [DELETE] and [ADD] tags
        const parts = line.split(/(\[DELETE\].*?\[\/DELETE\]|\[ADD\].*?\[\/ADD\])/g);

        parts.forEach(part => {
            if (part.startsWith('[DELETE]')) {
                runs.push(
                    new TextRun({
                        text: part.replace('[DELETE]', '').replace('[/DELETE]', ''),
                        color: "FF0000",
                        strike: true,
                    })
                );
            } else if (part.startsWith('[ADD]')) {
                runs.push(
                    new TextRun({
                        text: part.replace('[ADD]', '').replace('[/ADD]', ''),
                        color: "00B050", // Green
                        bold: true,
                    })
                );
            } else if (part) {
                runs.push(new TextRun(part));
            }
        });

        return new Paragraph({ children: runs });
    });

    const doc = new Document({
        sections: [{
            properties: {},
            children: paragraphs,
        }],
    });

    const buffer = await Packer.toBuffer(doc);
    return Buffer.from(buffer);
}
