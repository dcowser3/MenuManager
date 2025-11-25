#!/bin/bash

# Interactive Demo Runner for MenuManager
# Makes it easy to show all validation scenarios

echo "🎬 MenuManager Demo Runner"
echo "=========================="
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Check if services are running
if ! curl -s http://localhost:3005 > /dev/null 2>&1; then
    echo -e "${RED}❌ Services not running!${NC}"
    echo ""
    read -p "Start services now? (y/n): " START
    if [ "$START" = "y" ]; then
        ./start-services.sh
        echo ""
        echo "Waiting for services to be ready..."
        sleep 15
    else
        echo "Please run ./start-services.sh first"
        exit 1
    fi
fi

echo -e "${GREEN}✅ Services are running${NC}"
echo ""
echo "Select a scenario to demonstrate:"
echo ""
echo -e "${GREEN}1.${NC} ✅ PERFECT SUBMISSION - Passes all checks"
echo -e "${RED}2.${NC} ❌ WRONG TEMPLATE - Missing required template"  
echo -e "${YELLOW}3.${NC} ⚠️  TOO MANY ERRORS - Needs QA prompt first"
echo -e "${YELLOW}4.${NC} ⚠️  FORMAT ISSUES - Wrong font/alignment"
echo -e "${BLUE}5.${NC} 📝 MINOR ISSUES - AI review with corrections"
echo ""
echo "6. 📚 Show all email templates"
echo "7. 🌐 Open dashboard"
echo "8. 📊 View system logs"
echo "9. ❓ Help - What do these scenarios mean?"
echo ""
read -p "Enter scenario number (1-9): " SCENARIO

case $SCENARIO in
    1)
        echo ""
        echo -e "${GREEN}=== SCENARIO 1: Perfect Submission ===${NC}"
        echo ""
        echo "This menu:"
        echo "  ✓ Uses RSH Design Brief template"
        echo "  ✓ Has all required fields filled"
        echo "  ✓ Proper formatting (Calibri, 12pt, centered)"
        echo "  ✓ Clean content, minimal errors"
        echo ""
        echo "What happens:"
        echo "  → Template validation passes"
        echo "  → Pre-check passes (< 10 errors)"
        echo "  → Format check passes"
        echo "  → AI generates red-lined corrections"
        echo "  → Appears in dashboard for human review"
        echo ""
        read -p "Press Enter to submit..."
        
        echo ""
        echo "Submitting: TT_DXB_Brief_Half board_07112025.docx"
        curl -s -X POST http://localhost:3000/simulate-email \
          -F "file=@samples/example_pairs/TT_DXB_Brief_Half board_07112025.docx" \
          -F "from=chef@restaurant.com" | python3 -m json.tool 2>/dev/null || echo "Submitted!"
        
        echo ""
        echo -e "${GREEN}✅ Submission successful!${NC}"
        echo ""
        echo "Next steps:"
        echo "  1. Open dashboard: http://localhost:3005"
        echo "  2. Click 'Review Now' on the submission"
        echo "  3. Download original and AI draft"
        echo "  4. Show red-lined corrections to client"
        echo ""
        read -p "Press Enter to open dashboard..." 
        open http://localhost:3005 2>/dev/null
        ;;
        
    2)
        echo ""
        echo -e "${RED}=== SCENARIO 2: Wrong Template ===${NC}"
        echo ""
        echo "Demonstrates what happens when chef submits without RSH template."
        echo ""
        echo "⚠️  NOTE: You need to create a sample Word doc without the template."
        echo ""
        echo "To create test file:"
        echo "  1. Open Word, create new document"
        echo "  2. Add some menu items (no template form)"
        echo "  3. Save as 'wrong-template-sample.docx' in samples/"
        echo ""
        echo "Email reply that would be sent:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Subject: ❌ Menu Submission Rejected - Wrong Template"
        echo ""
        echo "Your submission doesn't match RSH Design Brief template."
        echo ""
        echo "Issues Found:"
        echo "• Missing required section: Design Brief Header"
        echo "• Missing required form field: Restaurant Name"
        echo "• Missing boundary marker"
        echo ""
        echo "What To Do:"
        echo "1. Download official template (Food or Beverage)"
        echo "2. Fill out ALL required fields"
        echo "3. Add menu after boundary marker"
        echo "4. Resubmit"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        ;;
        
    3)
        echo ""
        echo -e "${YELLOW}=== SCENARIO 3: Too Many Errors ===${NC}"
        echo ""
        echo "Demonstrates QA prompt requirement enforcement."
        echo ""
        echo "⚠️  NOTE: You need to create a messy menu sample."
        echo ""
        echo "To create test file:"
        echo "  1. Start with RSH template"
        echo "  2. Add 15+ errors:"
        echo "     - Misspellings (guacamol, avacado)"
        echo "     - Wrong separators (use hyphens)"
        echo "     - Missing diacritics (jalapeño → jalapeno)"
        echo "     - Price inconsistencies"
        echo "  3. Save as 'messy-menu-sample.docx' in samples/"
        echo ""
        echo "Email reply that would be sent:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Subject: ⚠️ Menu Needs Corrections - Use QA Prompt"
        echo ""
        echo "Your menu has 15 issues that need correction."
        echo ""
        echo "Why rejected?"
        echo "Too many errors found. Menu wasn't pre-cleaned"
        echo "using required SOP QA prompt."
        echo ""
        echo "Next Steps:"
        echo "1. Open ChatGPT"
        echo "2. Copy RSH Menu QA Prompt"
        echo "3. Fix all issues"
        echo "4. Resubmit cleaned menu"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        ;;
        
    4)
        echo ""
        echo -e "${YELLOW}=== SCENARIO 4: Format Issues ===${NC}"
        echo ""
        echo "Demonstrates formatting enforcement."
        echo ""
        echo "⚠️  NOTE: You need to create a badly formatted sample."
        echo ""
        echo "To create test file:"
        echo "  1. Start with RSH template"
        echo "  2. Clean content (no errors)"
        echo "  3. But wrong formatting on page 2:"
        echo "     - Use Arial font (not Calibri)"
        echo "     - Left-align text (not centered)"
        echo "     - Use 11pt size (not 12pt)"
        echo "  4. Save as 'bad-format-sample.docx' in samples/"
        echo ""
        echo "Email reply that would be sent:"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "Subject: ⚠️ Menu Submission - Formatting Issues"
        echo ""
        echo "Your menu doesn't meet formatting standards."
        echo ""
        echo "Issues:"
        echo "• Font is Arial (should be Calibri)"
        echo "• Text is left-aligned (should be centered)"
        echo "• Font size is 11pt (should be 12pt)"
        echo ""
        echo "To Fix:"
        echo "Select page 2, set Calibri/12pt/centered, resubmit."
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        ;;
        
    5)
        echo ""
        echo -e "${BLUE}=== SCENARIO 5: Minor Issues (AI Review) ===${NC}"
        echo ""
        echo "This is the ideal path - shows AI value!"
        echo ""
        echo "Menu characteristics:"
        echo "  ✓ Uses RSH template"
        echo "  ✓ Correct formatting"
        echo "  ⚠️  Just 1-3 small errors"
        echo ""
        echo "What happens:"
        echo "  → All validation passes"
        echo "  → AI finds minor issues"
        echo "  → AI generates red-lined corrections"
        echo "  → Human reviews and approves/modifies"
        echo "  → System learns from any human changes"
        echo ""
        echo "This demonstrates:"
        echo "  • AI catches subtle errors humans might miss"
        echo "  • Human has final say"
        echo "  • System learns and improves"
        echo ""
        ;;
        
    6)
        echo ""
        echo "📚 EMAIL TEMPLATES"
        echo "=================="
        echo ""
        echo "The system sends these email replies:"
        echo ""
        echo "1. Template Failure - Wrong/missing template"
        echo "2. Pre-check Failure - Too many errors (>10)"
        echo "3. Format Failure - Wrong font/alignment/size"
        echo ""
        echo "All emails include:"
        echo "  • Specific issues found"
        echo "  • Clear fix instructions"
        echo "  • How to resubmit"
        echo ""
        echo "See DEMO-GUIDE.md for full email templates"
        ;;
        
    7)
        echo ""
        echo "Opening dashboard..."
        open http://localhost:3005 2>/dev/null || echo "Go to: http://localhost:3005"
        ;;
        
    8)
        echo ""
        echo "📊 SYSTEM LOGS"
        echo "=============="
        echo ""
        echo "Select log to view:"
        echo "1. Parser (validation)"
        echo "2. Inbound Email (email replies)"
        echo "3. AI Review"
        echo "4. All logs"
        echo ""
        read -p "Enter number: " LOG
        case $LOG in
            1) tail -50 logs/parser.log ;;
            2) tail -50 logs/inbound-email.log ;;
            3) tail -50 logs/ai-review.log ;;
            4) ./view-logs.sh ;;
        esac
        ;;
        
    9)
        echo ""
        echo "❓ SCENARIO EXPLANATIONS"
        echo "========================"
        echo ""
        echo "The system has 5 validation checkpoints:"
        echo ""
        echo "1. Template Check"
        echo "   → Ensures chef used official RSH template"
        echo "   → Checks for required sections and form fields"
        echo "   → Immediate rejection if fails"
        echo ""
        echo "2. Pre-Check (QA Prompt Verification)"
        echo "   → Runs same QA check chefs should do"
        echo "   → If >10 errors, they didn't pre-clean"
        echo "   → Sends them back to run QA prompt"
        echo ""
        echo "3. Format Lint"
        echo "   → Verifies Calibri, 12pt, centered"
        echo "   → SOP requirement for consistency"
        echo "   → Specific fix instructions sent"
        echo ""
        echo "4. AI Review (Tier 1)"
        echo "   → General QA assessment"
        echo "   → If >99 errors, reject (currently disabled)"
        echo "   → Otherwise proceed to red-lining"
        echo ""
        echo "5. AI Red-lining (Tier 2)"
        echo "   → Generates specific corrections"
        echo "   → Human reviews final draft"
        echo "   → System learns from human edits"
        echo ""
        echo "See DEMO-GUIDE.md for more details"
        ;;
        
    *)
        echo "Invalid selection"
        exit 1
        ;;
esac

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Useful commands:"
echo "  ./run-demo.sh     - Run this demo again"
echo "  ./demo.sh         - Quick stakeholder demo"
echo "  ./view-logs.sh    - View all system logs"
echo ""
echo "Documentation:"
echo "  DEMO-GUIDE.md     - Full demo guide"
echo "  WORKFLOW-GUIDE.md - Technical workflow"
echo "  TESTING-GUIDE.md  - Testing procedures"
