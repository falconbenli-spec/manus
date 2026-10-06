#!/bin/sh
# يشغّل منصة 3,6T تلقائيًا عند تسجيل الدخول، ويعيد تشغيلها إذا توقفت.
# التشغيل: sh ops/install-autostart.sh    والإيقاف: sh ops/uninstall-autostart.sh
set -eu
PROJECT=$(cd "$(dirname "$0")/.." && pwd)
NODE=$(command -v node)
LABEL=sa.36t.platform
TARGET="$HOME/Library/LaunchAgents/$LABEL.plist"
[ -x "$NODE" ] || { echo "تعذر العثور على Node في مسار التشغيل"; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$PROJECT/work/logs"
sed -e "s#__PROJECT__#$PROJECT#g" -e "s#__NODE__#$NODE#g" -e "s#__NODE_DIR__#$(dirname "$NODE")#g" "$PROJECT/ops/$LABEL.plist" > "$TARGET"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$TARGET"
launchctl enable "gui/$(id -u)/$LABEL"
echo "تم التثبيت: $TARGET"
echo "المنصة تعمل على http://127.0.0.1:3600 وتبدأ تلقائيًا مع كل تسجيل دخول."
