#!/bin/bash

# Menu Redliner Test Script
# Usage: ./test-menu.sh /path/to/your/menu.docx

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Check if file path provided
if [ -z "$1" ]; then
    echo -e "${RED}❌ Error: Please provide a file path${NC}"
    echo -e "Usage: ${CYAN}./test-menu.sh /path/to/your/menu.docx${NC}"
    exit 1
fi

FILE_PATH="$1"

# Check if file exists
if [ ! -f "$FILE_PATH" ]; then
    echo -e "${RED}❌ Error: File not found: $FILE_PATH${NC}"
    exit 1
fi

# Get filename for display
FILENAME=$(basename "$FILE_PATH")

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   🍽️  MENU REDLINER TEST${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}File:${NC} $FILENAME"
echo ""

# Spinner function
spin() {
    local pid=$1
    local delay=0.1
    local spinstr='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    while ps -p $pid > /dev/null 2>&1; do
        for i in $(seq 0 9); do
            printf "\r${YELLOW}   ${spinstr:$i:1} $2${NC}"
            sleep $delay
        done
    done
    printf "\r"
}

# Step 1: Submit the file
echo -e "${YELLOW}📤 Submitting file for review...${NC}"

# Make the curl request in background
RESPONSE=$(curl -s -X POST http://localhost:3001/parser \
    -F "file=@${FILE_PATH};type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
    -F "skip_validation=true" \
    -F "submitter_email=test@example.com" 2>/dev/null)

# Check for error
if echo "$RESPONSE" | grep -q "error\|Error\|Invalid"; then
    echo -e "${RED}❌ Error: $RESPONSE${NC}"
    exit 1
fi

# Extract submission ID
SUBMISSION_ID=$(echo "$RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('submission_id', ''))" 2>/dev/null)

if [ -z "$SUBMISSION_ID" ]; then
    echo -e "${RED}❌ Error: Could not get submission ID${NC}"
    echo -e "Response: $RESPONSE"
    exit 1
fi

echo -e "${GREEN}✓ Submitted!${NC} ID: ${CYAN}$SUBMISSION_ID${NC}"
echo ""

# Step 2: Wait for redlining to complete
echo -e "${YELLOW}🔄 Processing with AI...${NC}"

MAX_WAIT=120  # Maximum 2 minutes
WAITED=0
STATUS=""

while [ $WAITED -lt $MAX_WAIT ]; do
    # Show spinner
    printf "\r${YELLOW}   ⏳ Waiting for AI review... (${WAITED}s)${NC}   "
    
    # Check status
    STATUS_RESPONSE=$(curl -s "http://localhost:3004/submissions/$SUBMISSION_ID" 2>/dev/null)
    STATUS=$(echo "$STATUS_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('status', ''))" 2>/dev/null)
    REDLINED_PATH=$(echo "$STATUS_RESPONSE" | python3 -c "import sys, json; print(json.load(sys.stdin).get('redlined_path', '') or '')" 2>/dev/null)
    
    if [ "$STATUS" = "pending_human_review" ] && [ -n "$REDLINED_PATH" ]; then
        break
    fi
    
    if [ "$STATUS" = "rejected_template" ] || [ "$STATUS" = "needs_prompt_fix" ]; then
        printf "\r"
        echo -e "${RED}❌ Submission rejected: $STATUS${NC}"
        exit 1
    fi
    
    sleep 2
    WAITED=$((WAITED + 2))
done

printf "\r                                                    \r"

if [ -z "$REDLINED_PATH" ] || [ ! -f "$REDLINED_PATH" ]; then
    echo -e "${RED}❌ Redlining timed out or failed${NC}"
    echo -e "Status: $STATUS"
    exit 1
fi

echo -e "${GREEN}✓ Redlining complete!${NC}"
echo ""

# Step 3: Show corrections
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}   📝 CORRECTIONS MADE${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo ""

# Use Python to extract and display corrections with context
python3 << EOF
from docx import Document

redlined = Document('$REDLINED_PATH')

total_deletions = 0
total_additions = 0
paras_with_changes = 0

for para in redlined.paragraphs:
    para_changes = []
    for run in para.runs:
        if run.font.strike and run.text.strip():
            para_changes.append(f"\033[1;33m   🔴 DEL: '{run.text}'\033[0m")
            total_deletions += 1
        if run.font.highlight_color and run.text.strip():
            para_changes.append(f"\033[1;32m   🟢 ADD: '{run.text}'\033[0m")
            total_additions += 1
    
    if para_changes:
        paras_with_changes += 1
        # Show paragraph context (first 65 chars)
        context = para.text[:65] + "..." if len(para.text) > 65 else para.text
        print(f"\033[0;36m📝 {context}\033[0m")
        for change in para_changes:
            print(change)
        print()

if paras_with_changes == 0:
    print("No corrections found in document")
else:
    print(f"\033[1;36m════════════════════════════════════════════════════════════\033[0m")
    print(f"\033[1;36mTotal: {total_deletions} deletions, {total_additions} additions across {paras_with_changes} paragraphs\033[0m")
EOF

echo ""
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Done!${NC}"
echo ""
echo -e "${CYAN}Redlined file:${NC}"
echo -e "  $REDLINED_PATH"
echo ""
echo -e "${CYAN}Open in Word to see tracked changes with context.${NC}"
echo ""


