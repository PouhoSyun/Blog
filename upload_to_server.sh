#!/usr/bin/env bash
set -euo pipefail

# 可通过环境变量覆盖这些默认配置。
DEPLOY_HOST="${DEPLOY_HOST:-root@192.3.179.244}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

# 始终从脚本所在的项目目录运行。
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"

git rev-parse --is-inside-work-tree >/dev/null
CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD)"
if [[ "$CURRENT_BRANCH" != "$DEPLOY_BRANCH" ]]; then
  echo "当前分支是 $CURRENT_BRANCH，要求部署分支为 $DEPLOY_BRANCH。"
  exit 1
fi

echo '==> 检查敏感文件没有被 Git 跟踪'
if [[ -n "$(git ls-files -- .env data uploads)" ]]; then
  echo '错误：.env、data 或 uploads 中存在被 Git 跟踪的文件。'
  echo '请先处理并检查 .gitignore，避免提交密码或线上数据。'
  exit 1
fi
for path in .env data/blog.json uploads/probe.png; do
  if ! git check-ignore -q -- "$path"; then
    echo "错误：$path 未被 .gitignore 忽略，请先补充忽略规则。"
    exit 1
  fi
done

echo '==> 本地测试'
npm test

# 有改动时展示清单并确认；不使用 reset、clean 或强制推送。
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  echo
  read -r -p '将以上全部非忽略改动提交并部署，继续？[y/N] ' CONFIRM
  case "$CONFIRM" in
    y|Y|yes|YES) ;;
    *) echo '已取消。'; exit 0 ;;
  esac

  MESSAGE="${*:-}"
  if [[ -z "$MESSAGE" ]]; then
    read -r -p '请输入提交说明：' MESSAGE
  fi
  if [[ -z "$MESSAGE" ]]; then
    echo '提交说明不能为空。'
    exit 1
  fi

  git add -A
  git commit -m "$MESSAGE"
fi

echo '==> 推送 GitHub'
git push origin "$DEPLOY_BRANCH"
EXPECTED_COMMIT="$(git rev-parse HEAD)"

# 限制分支字符，避免它进入远程 shell 时产生歧义。
if [[ ! "$DEPLOY_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo '分支名称包含不支持的字符。'
  exit 1
fi

echo '==> 更新服务器博客'
ssh "$DEPLOY_HOST" bash -s -- "$DEPLOY_BRANCH" "$EXPECTED_COMMIT" <<'REMOTE'
set -euo pipefail

BRANCH="$1"
EXPECTED_COMMIT="$2"
PROJECT=/root/PouhoSyunBlog
SERVICE=pouhosyun-blog
NODE_BIN=/root/.nvm/versions/node/v24.16.0/bin

# 非交互 SSH 通常不会加载 NVM，显式加入现有 Node 路径。
export PATH="$NODE_BIN:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

cd "$PROJECT"
test -x "$NODE_BIN/node"
test -f .env

if [[ "$(git symbolic-ref --quiet --short HEAD)" != "$BRANCH" ]]; then
  echo "服务器当前分支不是 $BRANCH，停止部署。"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo '服务器仓库存在未提交或未跟踪改动，请先检查：'
  git status --short
  exit 1
fi

OLD_COMMIT="$(git rev-parse HEAD)"
echo "原版本：$OLD_COMMIT"
git pull --ff-only origin "$BRANCH"

if [[ "$(git rev-parse HEAD)" != "$EXPECTED_COMMIT" ]]; then
  echo '服务器版本与本次本地推送版本不同，可能有其他人同时推送。'
  echo '停止测试和重启；请同步本地代码后重新部署。'
  exit 1
fi

echo '==> 服务器测试'
if ! npm test; then
  echo '测试失败，未重启服务。磁盘代码已更新，请修复后重新部署。'
  exit 1
fi

echo '==> 重启博客'
if ! systemctl restart "$SERVICE"; then
  systemctl status "$SERVICE" --no-pager -l || true
  journalctl -u "$SERVICE" -n 80 --no-pager
  exit 1
fi

# 等待服务启动，并重复检查，避免仅一次请求成功就误判。
SUCCESS=0
for attempt in {1..20}; do
  if systemctl is-active --quiet "$SERVICE" &&
     curl --fail --silent --show-error --max-time 5 \
       http://127.0.0.1:4180/ >/dev/null; then
    SUCCESS=$((SUCCESS + 1))
    if [[ "$SUCCESS" -ge 3 ]]; then
      systemctl status "$SERVICE" --no-pager -l
      echo "部署成功：$(git rev-parse --short HEAD)"
      echo '访问：https://blog.litchee.us/'
      exit 0
    fi
  else
    SUCCESS=0
  fi
  sleep 2
done

echo '健康检查失败。未自动回滚，请检查以下日志。'
echo "部署前版本：$OLD_COMMIT"
systemctl status "$SERVICE" --no-pager -l || true
journalctl -u "$SERVICE" -n 80 --no-pager
exit 1
REMOTE