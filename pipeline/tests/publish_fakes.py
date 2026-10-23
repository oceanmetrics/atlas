"""a fake om-publish.sh (and fake aws reads) for the publish.sh tests: every call is one line, its arguments joined by spaces."""

import os
import stat
import subprocess
from pathlib import Path

PIPE = Path(__file__).resolve().parent.parent
BUCKET = "oceanmetrics.io-public"

# logs "$*"; a registry_index.json argument is read at call time (the script's tmp copy is gone afterwards) and its
# first eight bytes (1f8b: gzip, 08 deflate, 00 flags, 00000000 mtime: gzip -n) are logged on the next line as "gz:<hex>"; OM_FAKE_EXIT makes the Nth call (1-based) exit with OM_FAKE_EXIT_CODE
FAKE_OM_PUBLISH = r"""#!/usr/bin/env bash
echo "$*" >> "$OM_LOG"
n=$(grep -c '^[^g]\|^g[^z]' "$OM_LOG")
for a in "$@"; do
  if [ "$(basename "$a")" = registry_index.json ] && [ -f "$a" ]; then echo "gz:$(head -c 8 "$a" | od -An -tx1 | tr -d ' \n')" >> "$OM_LOG"; fi
done
[ -n "${OM_FAKE_EXIT:-}" ] && [ "$n" = "${OM_FAKE_EXIT}" ] && exit "${OM_FAKE_EXIT_CODE:-3}"
exit 0
"""

# the only aws call publish.sh still makes: a read (head-object); HEAD_FAILS makes it fail
FAKE_AWS = '#!/usr/bin/env bash\necho "$@" >> "$AWS_LOG"\n[ "$1 $2" = "s3api head-object" ] && [ -n "${HEAD_FAILS:-}" ] && exit 254\nexit 0\n'

ULID = "01HZX3K9M2Q7R8S4T5V6W7X8Y9"


def _exe(path, text):
  path.write_text(text)
  path.chmod(path.stat().st_mode | stat.S_IEXEC)


def run_publish(tmp_path, stage, *args, head_fails=False, prefix_files=None, fail_call=None, publisher=True, prefix_dir=None):
  """run publish.sh against a fake om-publish; returns (CompletedProcess, om-publish call lines, aws call lines)."""
  bindir = tmp_path / "bin"
  bindir.mkdir(exist_ok=True)
  _exe(bindir / "aws", FAKE_AWS)
  _exe(bindir / "om-publish.sh", FAKE_OM_PUBLISH)
  pdir = tmp_path / "prefixes"
  pdir.mkdir(exist_ok=True)
  for name, text in (prefix_files or {}).items():
    (pdir / name).write_text(text + "\n")
  om_log, aws_log = tmp_path / "om.log", tmp_path / "aws.log"
  om_log.write_text("")
  aws_log.write_text("")
  env = os.environ | {"PATH": f"{bindir}:{os.environ['PATH']}", "OM_LOG": str(om_log), "AWS_LOG": str(aws_log),
                      "ATLAS_STAGE": str(stage), "ATLAS_BUCKET": BUCKET, "ATLAS_PREFIX_DIR": str(prefix_dir or pdir),
                      "OM_PUBLISH": str(bindir / "om-publish.sh") if publisher else str(tmp_path / "missing" / "om-publish.sh")}
  if head_fails:
    env["HEAD_FAILS"] = "1"
  if fail_call:
    env["OM_FAKE_EXIT"] = str(fail_call)
  r = subprocess.run(["bash", str(PIPE / "publish.sh"), *args], env=env, capture_output=True, text=True)
  lines = [l for l in om_log.read_text().splitlines() if l]
  return r, lines, [l for l in aws_log.read_text().splitlines() if l]
