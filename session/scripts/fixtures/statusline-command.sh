#!/bin/sh
input=$(cat)

# Model
model=$(echo "$input" | jq -r '.model.display_name // "Unknown"')

# Time (hour only, e.g. "14:00")
hour=$(date +%H:%M)

# Context window
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
if [ -n "$used_pct" ]; then
  context_str=$(printf "🧠 Ctx: %.0f%%" "$used_pct")
else
  context_str="🧠 Ctx: -"
fi

# Rate limits
five=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
week=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

limits=""
if [ -n "$five" ]; then
  limits=$(printf "⏱️ 5h: %.0f%%" "$five")
fi
if [ -n "$week" ]; then
  week_str=$(printf "📅 7d: %.0f%%" "$week")
  if [ -n "$limits" ]; then
    limits="$limits | $week_str"
  else
    limits="$week_str"
  fi
fi

# Git branch with emoji + words
cwd=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // empty')
branch=""
if [ -n "$cwd" ] && [ -d "$cwd" ]; then
  branch=$(git -C "$cwd" --no-optional-locks symbolic-ref --short HEAD 2>/dev/null)
fi

if [ -n "$branch" ]; then
  case "$branch" in
    main|master)
      branch_str="🌿 main"
      ;;
    develop|dev)
      branch_str="🔧 dev"
      ;;
    feat/*|feature/*)
      label=$(echo "$branch" | sed 's|feat/||;s|feature/||')
      branch_str="✨ feat: $label"
      ;;
    fix/*|bugfix/*|hotfix/*)
      label=$(echo "$branch" | sed 's|fix/||;s|bugfix/||;s|hotfix/||')
      branch_str="🐛 fix: $label"
      ;;
    release/*)
      label=$(echo "$branch" | sed 's|release/||')
      branch_str="🚀 release: $label"
      ;;
    chore/*)
      label=$(echo "$branch" | sed 's|chore/||')
      branch_str="🔨 chore: $label"
      ;;
    docs/*)
      label=$(echo "$branch" | sed 's|docs/||')
      branch_str="📝 docs: $label"
      ;;
    *)
      branch_str="🌀 $branch"
      ;;
  esac
else
  branch_str=""
fi

# Assemble output
# Colors: cyan=model, yellow=time, magenta=branch, blue=ctx, green=limits
parts=""

parts=$(printf "\033[0;36m🤖 %s\033[0m | \033[0;33m🕐 %s\033[0m" "$model" "$hour")

if [ -n "$branch_str" ]; then
  parts=$(printf "%s | \033[0;35m%s\033[0m" "$parts" "$branch_str")
fi

parts=$(printf "%s | \033[0;34m%s\033[0m" "$parts" "$context_str")

if [ -n "$limits" ]; then
  parts=$(printf "%s | \033[0;32m%s\033[0m" "$parts" "$limits")
fi

printf "%s" "$parts"
