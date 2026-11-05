#!/usr/bin/env bash
# 部署到 Cloudflare：第一次會自動建立 D1 資料庫，之後只套用新的資料表變更再上傳程式
set -euo pipefail
DB_NAME="knowledge-islands"

ID=$(npx wrangler d1 list --json | jq -r ".[] | select(.name==\"$DB_NAME\") | .uuid")
if [ -z "$ID" ]; then
  echo "第一次部署：建立 D1 資料庫 $DB_NAME"
  npx wrangler d1 create "$DB_NAME" >/dev/null
  ID=$(npx wrangler d1 list --json | jq -r ".[] | select(.name==\"$DB_NAME\") | .uuid")
fi
sed -i "s/^database_id = .*/database_id = \"$ID\"/" wrangler.toml

npx wrangler d1 migrations apply DB --remote
npx wrangler deploy

# 老師密碼只在第一次登入前使用；在後台改過密碼之後，以後台設定的為準
if [ -n "${TEACHER_PASSWORD:-}" ]; then
  printf '%s' "$TEACHER_PASSWORD" | npx wrangler secret put TEACHER_PASSWORD
fi
