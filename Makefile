.PHONY: up down mlx mlx-stop rebuild init status logs reset doctor live-local mlx-log

# ── Full stack (MLX + Docker) ─────────────────────────────────────────

up: mlx
	@sleep 3
	@docker compose up -d
	@echo "✓ MLX server + Docker running"

down: mlx-stop
	@docker compose down
	@echo "✓ All stopped"

rebuild: mlx
	@sleep 3
	@docker compose build --no-cache && docker compose up -d
	@echo "✓ Rebuilt and running"

# ── MLX Server ────────────────────────────────────────────────────────

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
