#!/bin/bash
set -e

echo "======================================"
echo "NPM Publishing Setup for webtalk"
echo "======================================"
echo ""

# Check prerequisites
echo "Checking prerequisites..."
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) not found. Install it first:"
    echo "   https://cli.github.com"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Install Node.js first."
    exit 1
fi

echo "✓ GitHub CLI found"
echo "✓ npm found"
echo ""

# Step 1: npm token generation
echo "========================================"
echo "STEP 1: Generate npm Automation Token"
echo "========================================"
echo ""
echo "1. Open this link in your browser:"
echo "   https://www.npmjs.com/settings/tokens"
echo ""
echo "2. Click 'Generate New Token'"
echo "3. Select type: 'Automation'"
echo "4. Description: 'GitHub Actions - webtalk publishing'"
echo "5. Click 'Create'"
echo "6. IMMEDIATELY COPY the token (shown only once)"
echo ""
read -sp "7. Paste your npm token here and press Enter: " NPM_TOKEN
echo ""
echo ""

if [ -z "$NPM_TOKEN" ]; then
    echo "❌ No token provided. Exiting."
    exit 1
fi

echo "✓ Token received"
echo ""

# Step 2: Verify GitHub authentication
echo "========================================"
echo "STEP 2: Verify GitHub Authentication"
echo "========================================"
echo ""

if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated to GitHub. Running: gh auth login"
    gh auth login
fi

echo "✓ GitHub authenticated"
echo ""

# Step 3: Set GitHub secret
echo "========================================"
echo "STEP 3: Adding NPM_TOKEN to GitHub Secrets"
echo "========================================"
echo ""

REPO="AnEntrypoint/realtime-whisper-webgpu"
SECRET_NAME="NPM_TOKEN"

echo "Repository: $REPO"
echo "Secret name: $SECRET_NAME"
echo ""

# Create or update the secret
echo "$NPM_TOKEN" | gh secret set "$SECRET_NAME" --repo "$REPO"

echo ""
echo "✓ Secret created successfully!"
echo ""

# Step 4: Verify secret
echo "========================================"
echo "STEP 4: Verifying Secret"
echo "========================================"
echo ""

if gh secret list --repo "$REPO" | grep -q "$SECRET_NAME"; then
    echo "✓ $SECRET_NAME is now available in GitHub Actions"
    echo ""
    echo "View it at:"
    echo "https://github.com/$REPO/settings/secrets/actions"
else
    echo "⚠ Could not verify secret. Check GitHub manually."
fi

echo ""
echo "========================================"
echo "Setup Complete!"
echo "========================================"
echo ""
echo "Next steps:"
echo "1. Workflow is ready: .github/workflows/publish.yml"
echo "2. Bump version in package.json"
echo "3. git add . && git commit -m 'chore: bump version'"
echo "4. git push origin main"
echo "5. GitHub Actions will automatically publish to npm"
echo ""
echo "Monitor workflow at:"
echo "https://github.com/$REPO/actions"
echo ""
