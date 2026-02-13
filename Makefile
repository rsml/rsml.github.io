.PHONY: all setup-hooks

all: setup-hooks

setup-hooks:
	git config core.hooksPath .githooks
	@echo "Configured git hooks path to .githooks"
