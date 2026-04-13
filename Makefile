.PHONY: live init doctor

live:
	@while true; do \
		pnpm build && pnpm live; \
		EXIT_CODE=$$?; \
		if [ $$EXIT_CODE -eq 42 ]; then \
			echo "[supervise] molt detected (exit 42) — rebuilding..."; \
			pnpm build; \
			echo "[supervise] restarting with new shell"; \
		elif [ $$EXIT_CODE -eq 0 ] || [ $$EXIT_CODE -eq 130 ]; then \
			echo "[supervise] stopped."; \
			break; \
		else \
			echo "[supervise] crashed (exit $$EXIT_CODE) — restarting in 10s..."; \
			sleep 10; \
		fi; \
	done

init:
	pnpm build && pnpm run init $(NAME)

doctor:
	pnpm build && pnpm run doctor
