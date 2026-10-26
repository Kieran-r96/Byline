# Thin wrapper; Windows users run `py tools/run.py <task>` directly.
PY ?= python3
.PHONY: setup api web verify generate replay-scenario evaluation
setup: ; $(PY) tools/run.py setup
api: ; $(PY) tools/run.py api
web: ; $(PY) tools/run.py web
verify: ; $(PY) tools/run.py verify
generate: ; $(PY) tools/run.py generate
replay-scenario: ; $(PY) tools/run.py replay-scenario $(SCENARIO)
evaluation: ; $(PY) tools/run.py evaluation
