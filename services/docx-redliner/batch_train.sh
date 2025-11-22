#!/bin/bash
# Batch Training Script for Menu Redliner
# ========================================
# Quick script to train from document pairs in a directory

set -e

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=================================${NC}"
echo -e "${BLUE}Menu Redliner Training Pipeline${NC}"
echo -e "${BLUE}=================================${NC}"
echo ""

# Check if directory argument provided
if [ -z "$1" ]; then
    echo -e "${YELLOW}Usage: $0 <directory-with-document-pairs> [min-occurrences]${NC}"
    echo ""
    echo "Example:"
    echo "  $0 ./training_docs 2"
    echo ""
    echo "Directory should contain pairs of documents:"
    echo "  - *original*.docx - original menu documents"
    echo "  - *redlined*.docx - human-edited versions"
    exit 1
fi

TRAINING_DIR="$1"
MIN_OCCURRENCES="${2:-2}"

# Check if directory exists
if [ ! -d "$TRAINING_DIR" ]; then
    echo -e "${YELLOW}Error: Directory '$TRAINING_DIR' not found${NC}"
    exit 1
fi

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    echo -e "${GREEN}Activating virtual environment...${NC}"
    source venv/bin/activate
fi

# Check if training_pipeline.py exists
if [ ! -f "training_pipeline.py" ]; then
    echo -e "${YELLOW}Error: training_pipeline.py not found${NC}"
    echo "Make sure you're running this from the docx-redliner directory"
    exit 1
fi

# Run the training pipeline
echo -e "${GREEN}Processing document pairs from: ${TRAINING_DIR}${NC}"
echo -e "${GREEN}Minimum occurrences for rules: ${MIN_OCCURRENCES}${NC}"
echo ""

python3 training_pipeline.py \
    --directory "$TRAINING_DIR" \
    --min-occurrences "$MIN_OCCURRENCES" \
    --merge-rules "../../sop-processor/sop_rules.json" \
    --optimize-prompt

echo ""
echo -e "${GREEN}✓ Training complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Review generated rules in tmp/training/"
echo "  2. Test the updated rules with: ./test-redliner-demo.sh"
echo "  3. If satisfied, update the AI prompt in ai_corrector.py"
echo ""

