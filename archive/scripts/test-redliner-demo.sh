#!/bin/bash
# Demo script to test the DOCX Redliner integration with the dashboard

set -e

echo "=========================================="
echo "DOCX Redliner Dashboard Demo"
echo "=========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check if services are running
echo -e "${BLUE}Step 1: Checking services...${NC}"
if ! curl -s http://localhost:3004/health > /dev/null 2>&1; then
    echo -e "${YELLOW}Database service not running. Starting it...${NC}"
    cd services/db
    npm start > ../../logs/db.log 2>&1 &
    echo $! > ../../logs/db.pid
    cd ../..
    sleep 2
fi

if ! curl -s http://localhost:3005 > /dev/null 2>&1; then
    echo -e "${YELLOW}Dashboard service not running. Starting it...${NC}"
    cd services/dashboard
    npm start > ../../logs/dashboard.log 2>&1 &
    echo $! > ../../logs/dashboard.pid
    cd ../..
    sleep 3
fi

echo -e "${GREEN}✓ Services are running${NC}"
echo ""

# Step 2: Create a test submission
echo -e "${BLUE}Step 2: Creating test submission...${NC}"

# Copy test document to uploads
TEST_DOC="/Users/deriancowser/Documents/MenuManager/samples/example_pairs/d'Lena Bar Revisions 6.24.25 (1).docx"
UPLOAD_PATH="/Users/deriancowser/Documents/MenuManager/tmp/uploads/test_demo.docx"
mkdir -p /Users/deriancowser/Documents/MenuManager/tmp/uploads
cp "$TEST_DOC" "$UPLOAD_PATH"

# Create AI draft (for testing, we'll just copy the original)
DRAFT_PATH="/Users/deriancowser/Documents/MenuManager/tmp/ai-drafts/sub_test_demo-draft.docx"
mkdir -p /Users/deriancowser/Documents/MenuManager/tmp/ai-drafts
cp "$TEST_DOC" "$DRAFT_PATH"

# Create submission via API
SUBMISSION_ID="sub_test_demo_$(date +%s)"

echo "Creating submission with ID: $SUBMISSION_ID"

curl -X POST http://localhost:3004/submissions \
  -H "Content-Type: application/json" \
  -d "{
    \"id\": \"$SUBMISSION_ID\",
    \"filename\": \"dLena_Bar_Test.docx\",
    \"submitter_email\": \"test@example.com\",
    \"original_path\": \"$UPLOAD_PATH\",
    \"ai_draft_path\": \"$DRAFT_PATH\",
    \"status\": \"pending_human_review\",
    \"created_at\": \"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)\",
    \"parsing_output\": {\"test\": true},
    \"ai_report\": {\"summary\": \"Test submission for redliner demo\"}
  }" \
  -s > /dev/null

echo -e "${GREEN}✓ Test submission created${NC}"
echo ""

# Step 3: Display instructions
echo "=========================================="
echo -e "${GREEN}Demo Ready!${NC}"
echo "=========================================="
echo ""
echo "Test submission created with ID: $SUBMISSION_ID"
echo ""
echo -e "${BLUE}To test the redliner:${NC}"
echo ""
echo "1. Open the dashboard in your browser:"
echo "   ${YELLOW}http://localhost:3005${NC}"
echo ""
echo "2. Click on the test submission: 'dLena_Bar_Test.docx'"
echo ""
echo "3. Scroll down to '✨ Advanced Redlining' section"
echo ""
echo "4. Click 'Generate Redlined Version' button"
echo ""
echo "5. Wait ~30-60 seconds for processing"
echo ""
echo "6. Download the redlined document"
echo ""
echo "7. Open it in Microsoft Word to see:"
echo "   • Red strikethrough for errors"
echo "   • Yellow highlight for corrections"
echo "   • All formatting preserved"
echo ""
echo "=========================================="
echo ""
echo -e "${BLUE}Direct link to review page:${NC}"
echo "   ${YELLOW}http://localhost:3005/review/$SUBMISSION_ID${NC}"
echo ""
echo "=========================================="
echo ""
echo -e "${BLUE}To view logs:${NC}"
echo "   Dashboard: tail -f logs/dashboard.log"
echo "   Database:  tail -f logs/db.log"
echo ""
echo "Press Ctrl+C to stop the demo when done"
echo ""

# Keep script running so services don't stop
tail -f logs/dashboard.log

