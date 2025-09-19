import express from 'express';
import multer from 'multer';
import { Packer } from 'docx';
import { promises as fs } from 'fs';
import { validateTemplate } from './src/validator';

const app = express();
const port = 3001;

const upload = multer({ dest: '../../../tmp/uploads/' });

app.post('/parser', upload.single('file'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    if (req.file.mimetype !== 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        // Here you would auto-reply with an email, for now, just sending a response
        return res.status(400).send('Invalid file type. Only .docx files are accepted.');
    }

    try {
        const validationResult = await validateTemplate(req.file.path);

        if (!validationResult.isValid) {
            // Here you would auto-reply with an email attaching the official template
            console.log('Template validation failed:', validationResult.errors);
            return res.status(400).json({
                message: 'Document does not match the required template.',
                errors: validationResult.errors
            });
        }
        
        // If validation passes, POST parsed payload to /ai-review
        console.log('Template validation passed. Extracted text length:', validationResult.text.length);

        // Placeholder for sending to ai-review
        
        res.status(200).json({ 
            message: 'File parsed successfully.',
            ...validationResult
        });

    } catch (error) {
        console.error('Error parsing file:', error);
        res.status(500).send('Error parsing file.');
    } finally {
        // Clean up the uploaded file
        if (req.file) {
            await fs.unlink(req.file.path);
        }
    }
});

app.listen(port, () => {
    console.log(`parser service listening at http://localhost:${port}`);
});
