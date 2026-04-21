.PHONY: up down ollama ollama-stop mlx mlx-stop rebuild init status logs reset doctor live-local mlx-log ollama-log

# ── Full stack (Ollama + Docker) ──────────────────────────────────────

up: ollama
	@sleep 3
	@docker compose up -d
	@echo "✓ MLX server + Docker running"

down: ollama-stop
	@docker compose down
	@echo "✓ All stopped"

rebuild: ollama
	@sleep 3
	@docker compose build --no-cache && docker compose up -d
	@echo "✓ Rebuilt and running"

# ── Ollama Server ─────────────────────────────────────────────────────

OLLAMA_MODEL ?= qwen3.6:35b-a3b

ollama:
	@if curl -s http://localhost:11434/v1/models > /dev/null 2>&1; then \
		echo "Ollama already running"; \
	else \
		echo "Starting Ollama..."; \
		OLLAMA_FLASH_ATTENTION=1 \
		OLLAMA_KV_CACHE_TYPE=q8_0 \
		OLLAMA_CONTEXT_LENGTH=65536 \
		OLLAMA_KEEP_ALIVE=-1 \
		OLLAMA_NUM_PARALLEL=1 \
		OLLAMA_MAX_LOADED_MODELS=1 \
		ollama serve > /tmp/ollama.log 2>&1 & \
		sleep 3; \
		if curl -s http://localhost:11434/v1/models > /dev/null 2>&1; then \
			echo "✓ Ollama ready"; \
		else \
			echo "⚠ Ollama still starting... check /tmp/ollama.log"; \
		fi; \
	fi

ollama-stop:
	@pkill -f "ollama serve" 2>/dev/null && echo "✓ Ollama stopped" || echo "Ollama not running"

ollama-log:
	@tail -20 /tmp/ollama.log 2>/dev/null || echo "No Ollama log"

ollama-pull:
	@ollama pull $(OLLAMA_MODEL)

# ── MLX Server (legacy) ───────────────────────────────────────────────

MLX_MODEL ?= mlx-community/Qwen3.6-35B-A3B-4bit
MLX_PORT ?= 8080

mlx:
	@if curl -s http://localhost:$(MLX_PORT)/v1/models > /dev/null 2>&1; then \
		echo "MLX already running"; \
	else \
		echo "Starting MLX server ($(MLX_MODEL))..."; \
		nohup mlx_lm.server \
			--model $(MLX_MODEL) \
			--port $(MLX_PORT) \
			--chat-template-args '{"enable_thinking":true}' \
			--prompt-cache-size 4 \
			--prompt-cache-bytes 4294967296 \
			--prefill-step-size 4096 \
			--prompt-concurrency 1 \
			--decode-concurrency 1 \
			> /tmp/mlx-server.log 2>&1 & \
		echo "MLX PID: $$!"; \
		sleep 5; \
		if curl -s http://localhost:$(MLX_PORT)/v1/models > /dev/null 2>&1; then \
			echo "✓ MLX ready"; \
		else \
			echo "⚠ MLX still loading... check /tmp/mlx-server.log"; \
		fi; \
	fi

mlx-stop:
	@pkill -f "mlx_lm.server" 2>/dev/null && echo "✓ MLX stopped" || echo "MLX not running"

mlx-log:
	@tail -20 /tmp/mlx-server.log 2>/dev/null || echo "No MLX log"

# ── Agent management ──────────────────────────────────────────────────

init:
	@rm -rf data && pnpm run init $(or $(NAME),Soren) --lang $(or $(LANG),ko)
	@echo "✓ Initialized. Edit data/prompts/base.md to set mission."

status:
	@docker exec autonomous-agent cat /agent/data/state.json 2>/dev/null | python3 -c "\
		import sys,json; s=json.load(sys.stdin); \
		print(f'{s[\"mode\"]} | day {s[\"sleepCount\"]} | moment {s[\"totalTurns\"]} | in={s[\"tokensUsed\"][\"input\"]:,} out={s[\"tokensUsed\"][\"output\"]:,}')" \
		2>/dev/null || echo "(not running)"

logs:
	@docker logs -f autonomous-agent

reset: down
	@rm -rf data && pnpm run init $(or $(NAME),Soren) --lang $(or $(LANG),ko)
	@echo "✓ Reset complete. Run 'make up' to start."

# ── Legacy (non-docker) ───────────────────────────────────────────────

live-local:
	@while true; do \
		pnpm live; \
		EXIT_CODE=$$?; \
		if [ $$EXIT_CODE -eq 75 ]; then \
			echo "[supervise] molt swap (exit 75) — restarting..."; \
		elif [ $$EXIT_CODE -eq 0 ] || [ $$EXIT_CODE -eq 130 ]; then \
			echo "[supervise] stopped."; \
			break; \
		else \
			echo "[supervise] crashed (exit $$EXIT_CODE) — restarting in 5s..."; \
			sleep 5; \
		fi; \
	done

doctor:
	@pnpm run doctor
