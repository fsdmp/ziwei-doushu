.PHONY: help dev test typecheck build upload release verify

# ============================================================
# 线上发布（静态站：build → out/ → rsync → nginx 目录，无进程无重启）
# 与 mistsee 同机（8.140.235.234）。两个环境同机部署，只按域名/目录区分：
#   make release            → 正式环境 ziwei.offiai.cn
#   make release ENV=test   → 测试环境 test-ziwei.offiai.cn
# ENV 决定 SITE/REMOTE_DIR 默认值；SERVER 等参数仍可显式覆盖：
#   make release ENV=test SERVER=root@1.2.3.4 REMOTE_DIR=/srv/ziwei/html-test
# 测试站只对 mistsee gray 白名单用户下发（MISTSEE_GRAY_TEST_UID_LIST +
# MISTSEE_ZIWEI_WEB_URL_FULL_TEST），链路见 deploy/DEPLOY.md「测试环境」。
# ============================================================
ENV ?= prod
ifeq ($(filter $(ENV),prod test),)
$(error ENV 只支持 prod / test，当前 "$(ENV)"（用法：make release ENV=test）)
endif

SERVER         ?= root@8.140.235.234
SITE_MAP.prod       := https://ziwei.offiai.cn
SITE_MAP.test       := https://test-ziwei.offiai.cn
# 服务器真实拓扑（与正式站同构）：APISIX 按 host 分流 → 本机 openresty 实例
#   prod → 127.0.0.1:8003（/usr/local/ziwei-static）   test → 127.0.0.1:8005（/usr/local/test-ziwei-static）
REMOTE_MAP.prod     := /usr/local/ziwei-static/html
REMOTE_MAP.test     := /usr/local/test-ziwei-static/html
SITE           ?= $(SITE_MAP.$(ENV))
REMOTE_DIR     ?= $(REMOTE_MAP.$(ENV))

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
	@echo "$(YELLOW)线上发布（ENV=prod 正式 / ENV=test 测试）:$(NC)"
	@echo "  build                 - 生产构建（产物 out/，站点地址随 ENV）"
	@echo "  upload                - build + rsync 同步到服务器（不验证；校验文件保留）"
	@echo "  release               - 一键发布：upload + 线上指纹/路径验证"
	@echo "  verify                - 仅验证线上版本与关键路径（需本地先有 out/）"
	@echo ""
	@echo "环境: ENV=$(ENV) → SITE=$(SITE)  REMOTE_DIR=$(REMOTE_DIR)"
	@echo "覆盖: SERVER=$(SERVER)  或显式 SITE= / REMOTE_DIR="
	@echo ""

dev: ## 本机开发服务器
	npm run dev

test: ## 引擎回归测试
	npm test

typecheck: ## TypeScript 类型检查
	npm run typecheck

build: ## 生产构建（产物 out/；NEXT_PUBLIC_SITE_URL 注入随 ENV 的站点地址，压过 .env.production）
	NEXT_PUBLIC_SITE_URL=$(SITE) npm run build
	@test -f out/index.html || { echo "✗ out/index.html 缺失，构建异常"; exit 1; }
	@echo "==> 构建完成 → out/  ($(ENV): $(SITE))"

upload: build ## rsync 同步到服务器（--delete 清旧 hash 资源，排除线上受保护文件）
	rsync -az --delete \
	  --exclude='MP_verify_*.txt' \
	  --exclude='wLKL4DZ96W.txt' \
	  --exclude='vjrssHFjy5.txt' \
	  --exclude='.well-known/' \
	  out/ $(SERVER):$(REMOTE_DIR)/
	@echo "==> 已同步 [$(ENV)] $(SERVER):$(REMOTE_DIR)/（校验文件 MP_verify_*.txt/wLKL4DZ96W.txt/vjrssHFjy5.txt 与 .well-known 保留，旧 hash 资源已清理）"

release: upload verify ## 一键发布：upload + 线上验证

verify: ## 验证线上指纹与关键路径（对比本地 out/index.html）
	@test -f out/index.html || { echo "$(RED)✗ 缺少 out/index.html，先 make build$(NC)"; exit 1; }
	@echo "==> 验证目标 [$(ENV)] $(SITE)"
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
