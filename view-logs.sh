#!/bin/bash

# View logs for MenuManager services
# Usage: ./view-logs.sh [service]
# Services: db, parser, ai-review, notifier, inbound-email, all

SERVICE=$1

if [ -z "$SERVICE" ]; then
    echo "Usage: ./view-logs.sh [service]"
    echo ""
    echo "Available services:"
    echo "  db           - Database service logs"
    echo "  parser       - Parser service logs"
    echo "  ai-review     - AI Review service logs"
    echo "  notifier      - Notifier service logs"
    echo "  dashboard     - Dashboard service logs"
    echo "  differ        - Differ service logs"
    echo "  inbound-email - Inbound Email service logs"
    echo "  all           - All logs (combined)"
    exit 1
fi

if [ ! -d "logs" ]; then
    echo "❌ No logs directory found. Are the services running?"
    exit 1
fi

case $SERVICE in
    db)
        tail -f logs/db.log
        ;;
    parser)
        tail -f logs/parser.log
        ;;
    ai-review)
        tail -f logs/ai-review.log
        ;;
    notifier)
        tail -f logs/notifier.log
        ;;
    dashboard)
        tail -f logs/dashboard.log
        ;;
    differ)
        tail -f logs/differ.log
        ;;
    inbound-email)
        tail -f logs/inbound-email.log
        ;;
    all)
        tail -f logs/*.log
        ;;
    *)
        echo "❌ Unknown service: $SERVICE"
        echo "Run ./view-logs.sh without arguments to see available services"
        exit 1
        ;;
esac

