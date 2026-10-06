#!/bin/sh
# يوقف التشغيل التلقائي ويحذف الخدمة. بيانات المنصة لا تُمس.
set -eu
LABEL=sa.36t.platform
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "أُوقف التشغيل التلقائي. لتشغيل المنصة يدويًا: npm start"
