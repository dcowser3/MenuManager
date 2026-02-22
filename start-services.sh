#!/bin/bash

# Start all MenuManager services
# Usage: ./start-services.sh

echo "🚀 Starting MenuManager services..."
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create .env from .env.example and configure your credentials."
    echo "Run: cp .env.example .env"
    exit 1
fi

# Check if built
if [ ! -d "services/db/dist" ]; then
    echo "📦 Building services..."
    npm run build --workspaces
    echo ""
fi

# Start services in background
echo "Starting Database Service (port 3004)..."
npm start --workspace=@menumanager/db > logs/db.log 2>&1 &
DB_PID=$!

sleep 1

echo "Starting Parser Service (port 3001)..."
npm start --workspace=@menumanager/parser > logs/parser.log 2>&1 &
PARSER_PID=$!

sleep 1

echo "Starting AI Review Service (port 3002)..."
npm start --workspace=@menumanager/ai-review > logs/ai-review.log 2>&1 &
AI_PID=$!

sleep 1

echo "Starting Notifier Service (port 3003)..."
npm start --workspace=@menumanager/notifier > logs/notifier.log 2>&1 &
NOTIFIER_PID=$!

sleep 1

echo "Starting Dashboard Service (port 3005)..."
npm start --workspace=@menumanager/dashboard > logs/dashboard.log 2>&1 &
DASHBOARD_PID=$!

sleep 1

echo "Starting Differ Service (port 3006)..."
npm start --workspace=@menumanager/differ > logs/differ.log 2>&1 &
DIFFER_PID=$!

sleep 1

echo "Starting ClickUp Integration Service (port 3007)..."
npm start --workspace=@menumanager/clickup-integration > logs/clickup-integration.log 2>&1 &
CLICKUP_PID=$!

sleep 1

sleep 2

echo ""
echo "✅ All services started!"
echo ""
echo "Process IDs:"
echo "  DB: $DB_PID"
echo "  Parser: $PARSER_PID"
echo "  AI Review: $AI_PID"
echo "  Notifier: $NOTIFIER_PID"
echo "  Dashboard: $DASHBOARD_PID"
echo "  Differ: $DIFFER_PID"
echo "  ClickUp: $CLICKUP_PID"
echo ""
echo "Service URLs:"
echo "  📊 Dashboard: http://localhost:3005"
echo "  💾 Database: http://localhost:3004"
echo ""
echo "Logs are being written to the logs/ directory"
echo "To stop all services, run: ./stop-services.sh"
echo ""
echo "Saving PIDs to logs/services.pid..."
echo "$DB_PID" > logs/services.pid
echo "$PARSER_PID" >> logs/services.pid
echo "$AI_PID" >> logs/services.pid
echo "$NOTIFIER_PID" >> logs/services.pid
echo "$DASHBOARD_PID" >> logs/services.pid
echo "$DIFFER_PID" >> logs/services.pid
echo "$CLICKUP_PID" >> logs/services.pid

echo ""
echo "To view logs in real-time:"
echo "  tail -f logs/db.log"
echo "  tail -f logs/parser.log"
echo "  tail -f logs/ai-review.log"
echo "  tail -f logs/notifier.log"
echo "  tail -f logs/dashboard.log"
echo "  tail -f logs/differ.log"
echo "  tail -f logs/clickup-integration.log"
