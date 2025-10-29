#!/bin/bash

# ============================================
# Quick Demo Script - MenuManager
# ============================================
# Fast demo for stakeholder presentations

echo "🎬 MenuManager Demo"
echo "=================="
echo ""

# Check if services are running
if ! curl -s http://localhost:3005 > /dev/null 2>&1; then
    echo "Starting services..."
    ./start-services.sh
    sleep 10
fi

echo "✅ Services are running!"
echo ""
echo "📊 Dashboard: http://localhost:3005"
echo ""
echo "Opening dashboard..."
sleep 2
open http://localhost:3005 2>/dev/null || echo "Please open: http://localhost:3005"

echo ""
echo "🎯 Demo Checklist:"
echo "  1. Show pending reviews list"
echo "  2. Click 'Review Now' on any submission"
echo "  3. Download original & AI draft"
echo "  4. Show AI corrections"
echo "  5. Demonstrate approve/upload options"
echo ""
echo "Press Ctrl+C when done"

# Keep script running
tail -f /dev/null

