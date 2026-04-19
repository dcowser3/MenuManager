#!/bin/bash

# Stop all MenuManager services

echo "🛑 Stopping MenuManager services..."

if [ -f logs/services.pid ]; then
    while read pid; do
        if ps -p $pid > /dev/null; then
            echo "Killing process $pid..."
            kill $pid
        fi
    done < logs/services.pid
    rm logs/services.pid
    echo "✅ All services stopped"
else
    echo "⚠️  No PID file found. Services may not be running."
    echo "Attempting to kill by port..."
    
    # Kill processes by port as backup
    lsof -ti:3000 | xargs kill -9 2>/dev/null
    lsof -ti:3001 | xargs kill -9 2>/dev/null
    lsof -ti:3002 | xargs kill -9 2>/dev/null
    lsof -ti:3003 | xargs kill -9 2>/dev/null
    lsof -ti:3004 | xargs kill -9 2>/dev/null
    lsof -ti:3005 | xargs kill -9 2>/dev/null
    lsof -ti:3006 | xargs kill -9 2>/dev/null
    lsof -ti:3007 | xargs kill -9 2>/dev/null
    lsof -ti:3008 | xargs kill -9 2>/dev/null

    echo "✅ Cleaned up any processes on ports 3000-3008"
fi

