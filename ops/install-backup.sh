#!/bin/sh
# يثبت نسخة احتياطية يومية 02:30 مع تجربة استعادة. يُشغَّل بموافقة مالك الجهاز فقط.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
TARGET="$HOME/Library/LaunchAgents/sa.36t.backup.plist"
mkdir -p "$ROOT/work/logs" "$HOME/Library/LaunchAgents"
sed -e "s|__ROOT__|$ROOT|g" -e "s|__NODE__|$NODE|g" "$ROOT/ops/sa.36t.backup.plist" > "$TARGET"
launchctl bootout "gui/$(id -u)/sa.36t.backup" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
echo "Daily backup installed. Run now: launchctl kickstart gui/$(id -u)/sa.36t.backup"
