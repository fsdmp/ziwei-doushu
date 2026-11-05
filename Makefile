.PHONY: help dev test typecheck build upload release verify

# ============================================================
# 线上发布（静态站：build → out/ → rsync → nginx 目录，无进程无重启）
# 与 mistsee 同机（8.140.235.234），参数均可覆盖：
#   make release SERVER=root@1.2.3.4 REMOTE_DIR=/srv/ziwei/html
# ============================================================
SERVER     ?= root@8.140.235.234
REMOTE_DIR ?= /usr/local/ziwei-static/html
SITE       ?= https://ziwei.offiai.cn

GREEN  := \033[0;32m
YELLOW := \033[0;33m
RED    := \033[0;31m
NC     := \033[0m

help: ## 显示帮助
	@echo ""
	@echo "ziwei-doushu 发布工具  (静态导出 → $(SITE))"
	@echo ""
	@echo "$(YELLOW)日常开发:$(NC)"
	@echo "  dev                   - 本机开发服务器 (next dev)"
	@echo "  test                  - 引擎回归测试"
	@echo "  typecheck             - TypeScript 类型检查"
	@echo ""
	@echo "$(YELLOW)线上发布:$(NC)"
	@echo "  build                 - 生产构建（产物 out/）"
	@echo "  upload                - build + rsync 同步到服务器（不验证；校验文件保留）"
	@echo "  release               - 一键发布：upload + 线上指纹/路径验证"
	@echo "  verify                - 仅验证线上版本与关键路径（需本地先有 out/）"
	@echo ""
	@echo "参数: SERVER=$(SERVER)  REMOTE_DIR=$(REMOTE_DIR)  SITE=$(SITE)"
	@echo ""

dev: ## 本机开发服务器
	npm run dev

test: ## 引擎回归测试
	npm test

typecheck: ## TypeScript 类型检查
	npm run typecheck

build: ## 生产构建（产物 out/）
	npm run build
	@test -f out/index.html || { echo "✗ out/index.html 缺失，构建异常"; exit 1; }
	@echo "==> 构建完成 → out/"

upload: build ## rsync 同步到服务器（--delete 清旧 hash 资源，排除线上受保护文件）
	rsync -az --delete \
	  --exclude='MP_verify_*.txt' \
	  --exclude='wLKL4DZ96W.txt' \
	  --exclude='.well-known/' \
	  out/ $(SERVER):$(REMOTE_DIR)/
	@echo "==> 已同步 $(SERVER):$(REMOTE_DIR)/（MP_verify_*.txt、wLKL4DZ96W.txt 与 .well-known 保留，旧 hash 资源已清理）"

release: upload verify ## 一键发布：upload + 线上验证

verify: ## 验证线上指纹与关键路径（对比本地 out/index.html）
	@test -f out/index.html || { echo "$(RED)✗ 缺少 out/index.html，先 make build$(NC)"; exit 1; }
	@FP=$$(python3 -c "import re;print(re.search(r'_next/static/chunks/([\w.-]+)\.js',open('out/index.html').read()).group(1))"); \
	echo "本地构建指纹: $$FP"; \
	LIVE=$$(curl -fsS --max-time 15 $(SITE)/ | grep -o "_next/static/chunks/$$FP\.js" | head -1) || true; \
	if [ -n "$$LIVE" ]; then \
		echo "$(GREEN)✓ 线上已是本次构建$(NC)"; \
	else \
		echo "$(RED)✗ 线上未见本次构建指纹（CDN/缓存或同步未生效）$(NC)"; exit 1; \
	fi; \
	for p in /chart /invite /archive /open-in-mini.html; do \
		code=$$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 $(SITE)$$p); \
		if [ "$$code" = "200" ]; then echo "$(GREEN)✓ $$p → 200$(NC)"; \
		else echo "$(RED)✗ $$p → $$code$(NC)"; exit 1; fi; \
	done; \
	echo "$(GREEN)==> 发布验证通过 $(SITE)$(NC)"
