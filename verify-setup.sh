#!/bin/bash

# Verify that the MenuManager setup is complete

echo "🔍 MenuManager Setup Verification"
echo "=================================="
echo ""

ERRORS=0
WARNINGS=0

# Check Node.js
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v)
    echo "  ✅ Node.js installed: $NODE_VERSION"
else
    echo "  ❌ Node.js not found"
    ERRORS=$((ERRORS + 1))
fi

# Check npm
echo "Checking npm..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm -v)
    echo "  ✅ npm installed: $NPM_VERSION"
else
    echo "  ❌ npm not found"
    ERRORS=$((ERRORS + 1))
fi

# Check ngrok
echo "Checking ngrok..."
if command -v ngrok &> /dev/null; then
    echo "  ✅ ngrok installed"
else
    echo "  ⚠️  ngrok not found (needed for local testing)"
    echo "     Install: brew install ngrok"
    WARNINGS=$((WARNINGS + 1))
fi

# Check .env file
echo "Checking .env file..."
if [ -f .env ]; then
    echo "  ✅ .env file exists"
    
    # Check critical variables
    if grep -q "GRAPH_CLIENT_ID=your_" .env; then
        echo "  ⚠️  GRAPH_CLIENT_ID not configured"
        WARNINGS=$((WARNINGS + 1))
    fi
    
    if grep -q "OPENAI_API_KEY=sk-your_" .env || ! grep -q "OPENAI_API_KEY=" .env; then
        echo "  ⚠️  OPENAI_API_KEY not configured"
        WARNINGS=$((WARNINGS + 1))
    fi
    
    if grep -q "WEBHOOK_URL=.*your-public-url" .env || ! grep -q "WEBHOOK_URL=" .env; then
        echo "  ⚠️  WEBHOOK_URL not configured"
        WARNINGS=$((WARNINGS + 1))
    fi
else
    echo "  ❌ .env file not found"
    echo "     Run: cp .env.example .env"
    ERRORS=$((ERRORS + 1))
fi

# Check node_modules
echo "Checking dependencies..."
if [ -d node_modules ]; then
    echo "  ✅ Dependencies installed"
else
    echo "  ❌ Dependencies not installed"
    echo "     Run: npm install"
    ERRORS=$((ERRORS + 1))
fi

# Check if services are built
echo "Checking if services are built..."
if [ -d "services/db/dist" ]; then
    echo "  ✅ Services built"
else
    echo "  ⚠️  Services not built"
    echo "     Run: npm run build --workspaces"
    WARNINGS=$((WARNINGS + 1))
fi

# Check required files
echo "Checking required files..."
REQUIRED_FILES=("sop-processor/qa_prompt.txt" "sop-processor/sop_rules.json")
for file in "${REQUIRED_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  ✅ $file exists"
    else
        echo "  ⚠️  $file not found"
        WARNINGS=$((WARNINGS + 1))
    fi
done

echo ""
echo "=================================="
echo "Summary:"
echo "  Errors: $ERRORS"
echo "  Warnings: $WARNINGS"
echo ""

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "✅ Setup looks good! You're ready to start the services."
    echo ""
    echo "Next steps:"
    echo "  1. Make sure ngrok is running: ngrok http 3000"
    echo "  2. Update WEBHOOK_URL in .env with your ngrok URL"
    echo "  3. Start services: ./start-services.sh"
    echo "  4. Check logs: ./view-logs.sh all"
elif [ $ERRORS -eq 0 ]; then
    echo "⚠️  Setup mostly complete, but some warnings need attention."
    echo "Review the warnings above and configure missing values in .env"
else
    echo "❌ Setup incomplete. Fix the errors above before proceeding."
    echo "See SETUP.md for detailed instructions."
fi

echo ""

