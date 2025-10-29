#!/bin/bash
# Setup script for DOCX Redliner
# Run this to set up the Python environment and test the installation

set -e  # Exit on error

echo "=================================="
echo "DOCX Redliner Setup"
echo "=================================="
echo ""

# Check Python version
echo "Checking Python version..."
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed"
    echo "Please install Python 3.8 or higher"
    exit 1
fi

PYTHON_VERSION=$(python3 --version | cut -d' ' -f2)
echo "✓ Found Python $PYTHON_VERSION"
echo ""

# Create virtual environment
echo "Creating virtual environment..."
if [ -d "venv" ]; then
    echo "⚠ Virtual environment already exists"
    read -p "Do you want to recreate it? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf venv
        python3 -m venv venv
        echo "✓ Virtual environment recreated"
    else
        echo "Using existing virtual environment"
    fi
else
    python3 -m venv venv
    echo "✓ Virtual environment created"
fi
echo ""

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate
echo "✓ Virtual environment activated"
echo ""

# Install dependencies
echo "Installing dependencies..."
pip install --upgrade pip > /dev/null 2>&1
pip install -r requirements.txt
echo "✓ Dependencies installed"
echo ""

# Check for .env file
echo "Checking configuration..."
if [ ! -f ".env" ]; then
    echo "⚠ No .env file found"
    echo ""
    read -p "Do you want to create one now? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        read -p "Enter your OpenAI API key: " API_KEY
        echo "OPENAI_API_KEY=$API_KEY" > .env
        echo "OPENAI_MODEL=gpt-4o" >> .env
        echo "✓ Created .env file"
    else
        echo "You can create .env later using:"
        echo "  echo 'OPENAI_API_KEY=your-key' > .env"
    fi
else
    echo "✓ .env file exists"
fi
echo ""

# Run tests
echo "Running tests..."
echo "=================================="
python test_redliner.py
echo "=================================="
echo ""

# Summary
echo "=================================="
echo "Setup Complete! ✅"
echo "=================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Activate the environment (if not already active):"
echo "   source venv/bin/activate"
echo ""
echo "2. Test with a document:"
echo "   python process_menu.py your_menu.docx"
echo ""
echo "3. Read the documentation:"
echo "   - QUICKSTART.md - Getting started guide"
echo "   - README.md - Full documentation"
echo "   - INTEGRATION.md - Integration guide"
echo ""
echo "4. To deactivate when done:"
echo "   deactivate"
echo ""

