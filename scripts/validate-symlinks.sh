#!/usr/bin/env sh
# validate-symlinks.sh - Prevent commits with broken symlinks

git diff --cached --name-only --diff-filter=A | while read -r file; do
  [ -L "$file" ] || continue
  [ -e "$file" ] && continue

  printf "❌ Broken symlink detected: %s\n\n" "$file"
  printf "The symlink target does not exist. Please fix it before committing.\n\n"
  printf "To fix:\n"
  printf "  1. Check the symlink target: ls -la \"%s\"\n" "$file"
  printf "  2. Update the symlink: ln -sf <correct-target> \"%s\"\n\n" "$file"
  exit 1
done

exit 0
