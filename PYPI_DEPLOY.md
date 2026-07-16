# Publishing the Python engine to PyPI — a guide for the deploying agent

You are on the device that holds the PyPI API token. Your job: build the
single-module `rhetorlint` package from `impl/python/`, verify the wheel is
self-contained, and upload it. Follow top to bottom.

Unlike npm, **PyPI has one flat namespace and no scopes** — the package name
`rhetorlint` must be globally free. Check that first.

---

## 0 · Get the exact code and confirm the engines agree

```bash
git clone https://github.com/cambridgetcg/rhetorlint-spec.git   # or: cd rhetorlint-spec && git pull
cd rhetorlint-spec
python3 impl/python/test_conformance.py     # MUST print: 10/10 cases identical (and the bundle guard passes)
```

If the bundle guard complains that `rules_en.json` is stale, resync it and re-run:

```bash
cp packages/rules-en/rules.json impl/python/rules_en.json
python3 impl/python/test_conformance.py
git add impl/python/rules_en.json && git commit -m "chore: resync bundled rules" && git push
```

## 1 · Claim the name

```bash
python3 -m pip install --upgrade requests >/dev/null 2>&1 || true
curl -sSf https://pypi.org/pypi/rhetorlint/json >/dev/null 2>&1 \
  && echo "TAKEN — pick another name (e.g. rhetorlint-engine) and update impl/python/pyproject.toml [project].name" \
  || echo "free — proceed"
```

If you must rename, change `name` in `impl/python/pyproject.toml` and the
`[project.scripts]` key stays `rhetorlint` (the command) only if that binary
name is acceptable; otherwise rename it too. Commit any rename and push.

## 2 · Install the build tooling

```bash
python3 -m pip install --upgrade build twine hatchling
```

## 3 · Build the wheel + sdist

```bash
cd impl/python
python3 -m build          # writes dist/rhetorlint-0.1.0-py3-none-any.whl and .tar.gz
```

Confirm the wheel bundles the rules (this is what makes it work without the repo):

```bash
python3 -c "import zipfile,glob; z=zipfile.ZipFile(glob.glob('dist/*.whl')[0]); print('\n'.join(z.namelist()))"
# expect to see BOTH: rhetorlint.py  AND  rules_en.json
```

## 4 · Verify the wheel in a clean venv (the important test)

```bash
python3 -m venv /tmp/rl-check && /tmp/rl-check/bin/pip install dist/*.whl
echo "We take your privacy extremely seriously, and mistakes were made." \
  | /tmp/rl-check/bin/rhetorlint
# expect valid JSON with density.tells >= 2 and an "agency-hiding.deleted-subject" mark.
# If it errors "could not load rules", the bundle didn't ship — recheck step 3.
```

That proves the installed package loads its bundled rules with no repo present.

## 5 · (Recommended) dry-run on TestPyPI first

```bash
export TWINE_USERNAME=__token__
export TWINE_PASSWORD=<your TestPyPI token>
twine upload --repository testpypi dist/*
python3 -m venv /tmp/rl-test && /tmp/rl-test/bin/pip install \
  -i https://test.pypi.org/simple/ rhetorlint && echo "TestPyPI install OK"
```

## 6 · Publish to PyPI

```bash
export TWINE_USERNAME=__token__
export TWINE_PASSWORD=<your PyPI token, the pypi-... string>   # never commit this
twine upload dist/*
```

## 7 · Verify from public PyPI, then report

```bash
python3 -m venv /tmp/rl-live && /tmp/rl-live/bin/pip install rhetorlint
echo "Everyone knows this, but what about the other side?" | /tmp/rl-live/bin/rhetorlint
```

Then tell Yu: `pip install rhetorlint` works and the JSON output is correct;
paste it as proof. Optionally tag the release:

```bash
cd - && git tag py-v0.1.0 && git push origin py-v0.1.0
```

---

## Caveats (short)

- **A version can't be re-uploaded.** If something's wrong after publish, bump
  to `0.1.1` in `pyproject.toml` and rebuild — do not rely on delete. You can
  `yank` a bad release (hides it from new installs, keeps it for pinned deps).
- **Use an API token, scoped to this project if possible.** Username is the
  literal `__token__`; password is the `pypi-...` token string. Prefer the
  `TWINE_PASSWORD` env var over writing `~/.pypirc`.
- **Name is global.** No `@scope/` on PyPI — if `rhetorlint` is taken you must
  pick a new distribution name (the import name can still be `rhetorlint`).
- The module installs as a top-level `rhetorlint.py` + `rules_en.json`. That's
  fine for a single-module reference engine; a later version may move to a
  package directory if it grows.
