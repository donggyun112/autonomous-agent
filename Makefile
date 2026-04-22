.PHONY: up down serve serve-stop rebuild init status logs reset doctor live-local serve-log

# ── Full stack (vllm-mlx + Docker) ────────────────────────────────────

up: serve
	@sleep 3
	@docker compose up -d
	@echo "✓ vllm-mlx + Docker running"

down: serve-stop
	@docker compose down
	@echo "✓ All stopped"

rebuild: serve
	@sleep 3
	@docker compose build --no-cache && docker compose up -d
	@echo "✓ Rebuilt and running"

# ── vllm-mlx Server ──────────────────────────────────────────────────

MODEL ?= mlx-community/Qwen3.6-35B-A3B-4bit
PORT ?= 8080

serve:
	@if curl -s http://localhost:$(PORT)/v1/models > /dev/null 2>&1; then \
		echo "vllm-mlx already running"; \
	else \
		echo "Starting vllm-mlx ($(MODEL))..."; \
		nohup vllm-mlx serve $(MODEL) \
			--port $(PORT) \
			--enable-prefix-cache \
			--prefix-cache-size 4 \
			--cache-memory-percent 0.3 \
			--kv-cache-quantization \
			--kv-cache-quantization-bits 8 \
			--enable-auto-tool-choice \
			--tool-call-parser qwen \
			--reasoning-parser qwen3 \
			--prefill-step-size 4096 \
			--chunked-prefill-tokens 4096 \
			--gpu-memory-utilization 0.8 \
			--max-num-seqs 1 \
			> /tmp/vllm-mlx.log 2>&1 & \
		echo "vllm-mlx PID: $$!"; \
		sleep 10; \
		if curl -s http://localhost:$(PORT)/v1/models > /dev/null 2>&1; then \
			echo "✓ vllm-mlx ready"; \
		else \
			echo "⚠ vllm-mlx still loading... check /tmp/vllm-mlx.log"; \
		fi; \
	fi

serve-stop:
	@pkill -f "vllm-mlx" 2>/dev/null && echo "✓ vllm-mlx stopped" || echo "vllm-mlx not running"

serve-log:
	@tail -20 /tmp/vllm-mlx.log 2>/dev/null || echo "No vllm-mlx log"

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
