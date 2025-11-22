# Training System - Complete Implementation

## What You Got

A complete training pipeline that learns from your backlog of menu reviews to improve AI accuracy.

## Quick Start

### Option 1: Web Interface (Easiest)
```bash
./start-services.sh
open http://localhost:3005/training
```
Upload pairs → Click "Start Training" → Done!

### Option 2: Command Line
```bash
cd services/docx-redliner
python3 prepare_training_data.py --directory ~/MenuBacklog --auto
./batch_train.sh tmp/training/pairs
```

## What It Does

1. **Analyzes** original + redlined document pairs
2. **Extracts** correction patterns (spelling, diacritics, punctuation, etc.)
3. **Generates** new rules with confidence scores
4. **Optimizes** AI prompt with real examples
5. **Reports** detailed metrics and insights

## Files Created

### Core System
- `services/docx-redliner/training_pipeline.py` - Main training logic
- `services/docx-redliner/prepare_training_data.py` - Data preparation
- `services/docx-redliner/batch_train.sh` - Quick training script

### Dashboard
- Training interface at `/training` route
- Upload, train, and download from web UI

### Documentation
- `TRAINING-GUIDE.md` - Comprehensive guide
- `TRAINING-QUICK-START.md` - 5-minute start guide

## Example Output

After training 15 pairs:
```
Session: 20250122_143022
Pairs: 15
Corrections: 127
Rules: 23

By category:
- spelling: 45
- diacritics: 28
- separator: 18
- punctuation: 15
```

## Next Steps

1. Collect 10-20 document pairs from your backlog
2. Run training via web or CLI
3. Review generated rules
4. Test on sample documents
5. Deploy when satisfied

## Benefits

- ✅ Learn from historical reviews
- ✅ Improve before production
- ✅ Continuous learning capability
- ✅ Both web and CLI interfaces
- ✅ Automatic pattern recognition
- ✅ Confidence scoring
- ✅ Full metrics and reporting

## Support

See detailed guides:
- Quick start: `TRAINING-QUICK-START.md`
- Full guide: `TRAINING-GUIDE.md`
- Technical: `services/docx-redliner/README_TRAINING.md`

