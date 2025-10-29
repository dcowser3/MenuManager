# Integration Guide - DOCX Redliner with MenuManager

This guide explains how to integrate the Python-based DOCX Redliner service with the existing TypeScript-based MenuManager system.

## Architecture Overview

The DOCX Redliner is a Python service that works alongside your existing TypeScript services. It can be integrated at multiple points in your workflow:

```
[Email Inbound] → [Parser] → [AI Review] → [DOCX Redliner] → [Notifier]
                                              ↑ NEW
```

## Integration Options

### Option 1: CLI Integration (Simplest)

Call the Python script from Node.js using child_process.

#### In your TypeScript service:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function redlineDocument(inputPath: string, outputPath?: string): Promise<string> {
  const outputArg = outputPath ? outputPath : '';
  const command = `python3 services/docx-redliner/process_menu.py "${inputPath}" ${outputArg}`;
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY
      }
    });
    
    console.log('Redliner output:', stdout);
    
    // Extract output path from stdout or use default naming
    const outputFile = outputPath || inputPath.replace('.docx', '_Corrected.docx');
    return outputFile;
    
  } catch (error) {
    console.error('Redliner error:', error);
    throw new Error(`Failed to redline document: ${error.message}`);
  }
}

// Usage in your workflow
const correctedDoc = await redlineDocument('/path/to/menu.docx');
```

### Option 2: Python HTTP Service (More Robust)

Create a simple Flask/FastAPI service wrapper.

#### Create `services/docx-redliner/api.py`:

```python
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import FileResponse
import shutil
import tempfile
from pathlib import Path
from menu_redliner import MenuRedliner
from ai_corrector import AICorrector

app = FastAPI()
corrector = AICorrector()
redliner = MenuRedliner()

@app.post("/redline")
async def redline_document(file: UploadFile = File(...)):
    """Process uploaded DOCX file and return redlined version."""
    
    if not file.filename.endswith('.docx'):
        raise HTTPException(400, "File must be .docx")
    
    # Save uploaded file to temp location
    with tempfile.NamedTemporaryFile(delete=False, suffix='.docx') as tmp_input:
        shutil.copyfileobj(file.file, tmp_input)
        input_path = tmp_input.name
    
    try:
        # Process document
        output_path = redliner.process_document(
            input_path,
            corrector.correct_text
        )
        
        # Return the processed file
        return FileResponse(
            output_path,
            media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            filename=f"redlined_{file.filename}"
        )
        
    finally:
        # Cleanup
        Path(input_path).unlink(missing_ok=True)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)
```

#### Add to requirements.txt:
```
fastapi>=0.104.0
uvicorn>=0.24.0
```

#### Start the service:
```bash
cd services/docx-redliner
python api.py
```

#### Call from TypeScript:
```typescript
import FormData from 'form-data';
import fs from 'fs';
import axios from 'axios';

async function redlineDocumentViaAPI(inputPath: string): Promise<Buffer> {
  const form = new FormData();
  form.append('file', fs.createReadStream(inputPath));
  
  const response = await axios.post('http://localhost:8004/redline', form, {
    headers: form.getHeaders(),
    responseType: 'arraybuffer'
  });
  
  return Buffer.from(response.data);
}

// Usage
const redlinedBuffer = await redlineDocumentViaAPI('/path/to/menu.docx');
fs.writeFileSync('/path/to/output.docx', redlinedBuffer);
```

### Option 3: Direct Integration in AI Review Service

Modify your existing AI Review service to call the redliner.

#### In `services/ai-review/index.ts`:

```typescript
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function processWithRedlining(submissionId: string, inputDoc: string) {
  // Your existing AI review logic...
  
  // Add redlining step
  const redlinedDoc = await redlineDocument(inputDoc);
  
  // Continue with your workflow
  return redlinedDoc;
}

async function redlineDocument(inputPath: string): Promise<string> {
  const pythonScript = path.join(__dirname, '../../docx-redliner/process_menu.py');
  const command = `python3 "${pythonScript}" "${inputPath}"`;
  
  await execAsync(command, {
    env: { ...process.env }
  });
  
  return inputPath.replace('.docx', '_Corrected.docx');
}
```

## Environment Setup

### Shared Environment Variables

Add to your `.env` file at the project root:

```bash
# Existing variables...
OPENAI_API_KEY=your-key-here

# Redliner-specific
REDLINER_BOUNDARY_MARKER=Please drop the menu content below on page 2.
REDLINER_MODEL=gpt-4o
```

### Python Environment

The Python service needs its own virtual environment:

```bash
cd services/docx-redliner
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Adding to Start/Stop Scripts

### Update `start-services.sh`:

```bash
#!/bin/bash

# ... existing services ...

# Start Python redliner API (if using Option 2)
cd services/docx-redliner
source venv/bin/activate
python api.py &
echo $! > ../../logs/redliner.pid
cd ../..
```

### Update `stop-services.sh`:

```bash
#!/bin/bash

# ... existing services ...

# Stop redliner
if [ -f logs/redliner.pid ]; then
  kill $(cat logs/redliner.pid) 2>/dev/null
  rm logs/redliner.pid
fi
```

## Testing Integration

### 1. Test Python Service Independently

```bash
cd services/docx-redliner
source venv/bin/activate
python test_redliner.py
```

### 2. Test CLI Integration

```bash
# From project root
export OPENAI_API_KEY='your-key'
python3 services/docx-redliner/process_menu.py samples/test_menu.docx
```

### 3. Test Full Workflow

Create a test in `test-workflow.sh`:

```bash
# Add to test-workflow.sh

echo "Testing document redlining..."
cp samples/RSH_DESIGN\ BRIEF_FOOD_Menu_Template\ .docx tmp/test_redline.docx
python3 services/docx-redliner/process_menu.py tmp/test_redline.docx
if [ -f tmp/test_redline_Corrected.docx ]; then
  echo "✓ Redlining test passed"
else
  echo "✗ Redlining test failed"
  exit 1
fi
```

## Workflow Integration Points

### Point 1: After Initial Parsing
```
Parser → DOCX Redliner → AI Review → Notifier
```
Redline the document immediately after parsing, before detailed AI review.

### Point 2: After AI Review (Recommended)
```
Parser → AI Review → DOCX Redliner → Notifier
```
Use AI review findings to generate corrections, then apply redlining.

### Point 3: On-Demand
```
Dashboard → Request Redlining → DOCX Redliner → Return to User
```
Allow manual triggering from the dashboard.

## Database Integration

Track redlining in your database:

```typescript
// Add to db schema
interface Submission {
  // ... existing fields ...
  redlined: boolean;
  redlinedDocPath?: string;
  redlineTimestamp?: Date;
  redlineStats?: {
    paragraphsProcessed: number;
    modificationsCount: number;
  };
}
```

## Error Handling

### Handle Python Errors in TypeScript

```typescript
async function redlineDocumentSafe(inputPath: string): Promise<string | null> {
  try {
    return await redlineDocument(inputPath);
  } catch (error) {
    console.error('Redlining failed:', error);
    
    // Log to your logging system
    await logError('redliner', {
      error: error.message,
      inputPath,
      timestamp: new Date()
    });
    
    // Return original document if redlining fails
    return inputPath;
  }
}
```

## Performance Considerations

### For Large Documents

```python
# Use batch correction in ai_corrector.py
from ai_corrector import BatchAICorrector

batch_corrector = BatchAICorrector()
# Process multiple paragraphs in one API call
```

### Caching

```typescript
// Cache corrected documents
const redlineCache = new Map<string, string>();

async function redlineDocumentCached(inputPath: string): Promise<string> {
  const cacheKey = await getFileHash(inputPath);
  
  if (redlineCache.has(cacheKey)) {
    return redlineCache.get(cacheKey)!;
  }
  
  const result = await redlineDocument(inputPath);
  redlineCache.set(cacheKey, result);
  return result;
}
```

## Monitoring

Add logging to track redlining operations:

```typescript
// Add to your logging service
logger.info('Redlining document', {
  submissionId,
  inputSize: fs.statSync(inputPath).size,
  timestamp: new Date()
});

// After processing
logger.info('Redlining complete', {
  submissionId,
  outputSize: fs.statSync(outputPath).size,
  duration: Date.now() - startTime
});
```

## Troubleshooting

### "Python not found"
Ensure Python 3 is installed and in PATH:
```bash
which python3
# Should return: /usr/bin/python3 or similar
```

### "Module not found"
Activate the virtual environment:
```bash
cd services/docx-redliner
source venv/bin/activate
```

### "API key not set"
Ensure environment variables are passed:
```typescript
execAsync(command, {
  env: {
    ...process.env,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY
  }
});
```

## Best Practices

1. **Always use absolute paths** when calling Python from Node.js
2. **Validate file existence** before processing
3. **Handle timeouts** for long-running AI operations
4. **Clean up temporary files** after processing
5. **Log all operations** for debugging
6. **Test with sample documents** before production use

## Next Steps

1. Choose your integration option (CLI or API)
2. Update your workflow scripts
3. Test with sample documents
4. Add error handling and logging
5. Monitor performance in production
6. Consider batch processing for efficiency

## Support

For questions or issues with integration, refer to:
- This guide
- `services/docx-redliner/README.md`
- Main MenuManager documentation

