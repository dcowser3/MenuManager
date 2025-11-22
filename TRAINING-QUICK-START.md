# Training Pipeline Quick Start

Get your AI model learning from historical reviews in 5 minutes!

## The Problem You're Solving

Your team has done hundreds of menu reviews. Each one is a learning opportunity - but you haven't had a way to systematically teach your AI from them. Until now.

## What This Does

The training pipeline:
- ✅ Learns from your existing redlined documents
- ✅ Automatically generates new rules
- ✅ Improves AI accuracy before production
- ✅ Provides a web interface for easy training

## Quick Start (Web Interface)

### 1. Access the Training Dashboard

```bash
# Start your services if not running
./start-services.sh

# Open in browser
open http://localhost:3005/training
```

### 2. Upload Document Pairs

1. Click the upload section
2. Select your original menu
3. Select the human-redlined version
4. Click "Upload Pair"
5. Repeat for more documents

### 3. Run Training

1. Set "Minimum Occurrences" (recommended: 2)
2. Click "Start Training"
3. Wait 1-3 minutes for processing
4. Review results

### 4. Download & Apply

- Download the generated rules
- Download the optimized prompt
- Test on sample documents
- Apply to production when satisfied

## Quick Start (Command Line)

### 1. Prepare Your Data

```bash
cd services/docx-redliner

# Interactive pairing (recommended for first time)
python3 prepare_training_data.py \
    --directory ~/Documents/MenuBacklog \
    --interactive

# Or auto-discovery
python3 prepare_training_data.py \
    --directory ~/Documents/MenuBacklog \
    --auto
```

### 2. Run Training

```bash
# Train on all pairs
./batch_train.sh tmp/training/pairs
```

### 3. Review Results

```bash
# Check the output
cat tmp/training/learned_rules_*.json

# Review prompt
cat tmp/training/optimized_prompt_*.txt
```

## File Naming Tips

For best auto-discovery, name your files like:
- `Menu_original.docx` + `Menu_redlined.docx`
- `Brief_v1.docx` + `Brief_v2.docx`
- `Menu_2024-01-15.docx` + `Menu_2024-01-20.docx`

## What Gets Generated

After training, you'll have:

1. **Learned Rules** (`learned_rules_TIMESTAMP.json`)
   - Spelling corrections
   - Diacritic patterns
   - Punctuation fixes
   - Case changes
   - Price formatting

2. **Optimized Prompt** (`optimized_prompt_TIMESTAMP.txt`)
   - Enhanced with real examples
   - Better at handling edge cases

3. **Training Report** (`session_TIMESTAMP.json`)
   - Detailed metrics
   - All corrections found
   - Pattern analysis

## Example Output

```
TRAINING SESSION SUMMARY
================================================================
Session ID: 20250122_143022
Document pairs processed: 15
Total corrections found: 127
Rules generated: 23

Corrections by category:
  spelling: 45
  diacritics: 28
  separator: 18
  punctuation: 15
  price_format: 12
  case_change: 9
================================================================
```

## Common Scenarios

### Scenario 1: Small Backlog (5-10 pairs)
```bash
# Use lower threshold to learn from every example
./batch_train.sh tmp/training/pairs 1
```

### Scenario 2: Large Backlog (20+ pairs)
```bash
# Use higher threshold for more confident rules
./batch_train.sh tmp/training/pairs 3
```

### Scenario 3: Continuous Learning
```bash
# Week 1
./batch_train.sh batch_1/

# Week 2 - add more pairs
./batch_train.sh batch_2/

# Week 3 - keep improving
./batch_train.sh batch_3/
```

## Testing Your Improvements

After training, test on a sample:

```bash
# Generate redlined version with new rules
python3 process_menu.py \
    samples/test_menu.docx \
    tmp/test_output.docx

# Review the output
open tmp/test_output.docx
```

## Next Steps

Once you're happy with results:

1. **Update AI Prompt**
   - Edit `ai_corrector.py`
   - Copy examples from optimized prompt

2. **Review Rules**
   - Check `sop_rules_updated.json`
   - Remove any incorrect rules
   - Backup before replacing production rules

3. **Monitor Performance**
   - Track approval rates
   - Collect more training pairs
   - Retrain monthly

## Troubleshooting

**No pairs discovered?**
```bash
# Use interactive mode
python3 prepare_training_data.py -d /path/to/docs --interactive
```

**Too few corrections?**
- Check that documents actually differ
- Verify .docx format (not .pdf)

**Rules seem wrong?**
```bash
# Increase threshold
./batch_train.sh tmp/training/pairs 5
```

## Need More Help?

See the full guide: [TRAINING-GUIDE.md](./TRAINING-GUIDE.md)

---

**Remember**: The more high-quality pairs you provide, the smarter your AI becomes! 🚀

