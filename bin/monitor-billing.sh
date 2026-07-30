#!/usr/bin/env bash

# Exit on error
set -eo pipefail

echo "========================================="
echo "📊 GitHub Actions Billing Monitor"
echo "========================================="

# 1. Verify gh is installed
if ! command -v gh &> /dev/null; then
    echo "⚠️ GitHub CLI (gh) is not installed."
    echo "To install gh on Debian/Ubuntu, run:"
    echo "  sudo apt-get update && sudo apt-get install -y gh"
    exit 1
fi

echo "✓ GitHub CLI is installed."

# 2. Check Authentication Status
echo "Checking GitHub authentication status..."
if ! gh auth status &>/dev/null; then
    echo "⚠️ You are not logged into GitHub CLI."
    echo "Please authenticate using:"
    echo "  gh auth login"
    echo ""
    echo "If you have a GitHub token, you can run:"
    echo "  export GITHUB_TOKEN=your_token_here"
    echo "And try again."
    exit 1
fi

echo "✓ Authenticated with GitHub."

# 3. Query Billing Endpoint
echo "Retrieving Actions billing for repos/iberi22/swal-agent-runner..."
set +e
BILLING_INFO=$(gh api repos/iberi22/swal-agent-runner/actions/billing 2>&1)
EXIT_CODE=$?
set -e

if [ $EXIT_CODE -ne 0 ]; then
    echo "❌ Error retrieving billing information."
    echo "Details:"
    echo "$BILLING_INFO"
    exit 1
fi

echo "========================================="
echo "📈 Billing Information Retrieved Successfully:"
echo "========================================="
echo "$BILLING_INFO" | jq . 2>/dev/null || echo "$BILLING_INFO"
echo "========================================="

# 4. Extract details if jq is available
if command -v jq &> /dev/null; then
    TOTAL_MINUTES_USED=$(echo "$BILLING_INFO" | jq -r '.total_minutes_used // "N/A"')
    TOTAL_PAID_MINUTES_USED=$(echo "$BILLING_INFO" | jq -r '.total_paid_minutes_used // "N/A"')
    INCLUDED_MINUTES=$(echo "$BILLING_INFO" | jq -r '.included_minutes // "N/A"')

    echo "Included Minutes  : $INCLUDED_MINUTES"
    echo "Total Used        : $TOTAL_MINUTES_USED"
    echo "Paid Minutes Used : $TOTAL_PAID_MINUTES_USED"

    if [ "$INCLUDED_MINUTES" != "N/A" ] && [ "$TOTAL_MINUTES_USED" != "N/A" ]; then
        REMAINING=$((INCLUDED_MINUTES - TOTAL_MINUTES_USED))
        if [ $REMAINING -le 0 ]; then
            echo "⚠️ GitHub Actions budget is currently EXHAUSTED (0 minutes remaining)."
            echo "Deployment will fail until the budget resets on the 1st of the month."
        else
            echo "✅ Budget is AVAILABLE ($REMAINING minutes remaining)."
            echo "You can trigger the workflow manually using:"
            echo "  gh workflow run deploy.yml --repo iberi22/swal-agent-runner"
        fi
    fi
else
    echo "Tip: Install 'jq' to see structured summary statistics."
fi
