# Leporello — common tasks. Run `make` for the list.

.DEFAULT_GOAL := help
VENUE         ?=

install: ## Install npm dependencies
	npm install

dev: ## Start server + frontend on http://localhost:3000
	npm run dev

test: ## Run scraper unit tests
	npm test

build: ## Compile TypeScript to dist/
	npm run build

scrape: ## Scrape into ./data (VENUE=<id> for one venue)
	npm run scrape $(if $(VENUE),-- $(VENUE))

deploy: ## Server: git pull, then rebuild + restart the web stack
	git pull
	docker compose up -d --build

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z_-]+:.*##/ {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

.PHONY: install dev test build scrape deploy help
