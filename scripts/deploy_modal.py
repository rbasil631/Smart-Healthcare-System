# /// script
# requires-python = ">=3.10"
# dependencies = ["modal>=1.6"]
# ///
"""Deploy the SmartHeart prediction API (modal_app.py) to Modal.

    uv run scripts/deploy_modal.py            # deploy -> prints the permanent URL
    uv run scripts/deploy_modal.py --test     # run the example patients in the cloud first, then deploy
    uv run scripts/deploy_modal.py --serve    # temporary dev URL with hot reload (Ctrl+C to stop)
    uv run scripts/deploy_modal.py --rotate-key

uv installs modal in a throwaway environment, so nothing needs to be installed first.
On the first run it logs you in to Modal (opens the browser) and creates the API-key
secret, printing the key once -- save it, every request needs it as the x-api-key header.
"""
import argparse
import secrets
import subprocess
import sys
from pathlib import Path

import modal
from modal.exception import AuthError, NotFoundError

ROOT = Path(__file__).resolve().parents[1]
APP_FILE = "modal_app.py"
SECRET_NAME = "smartheart-api-key"
SECRET_KEY = "SMARTHEART_API_KEY"


def modal_cli(*args: str) -> None:
    """Run the modal CLI from this uv environment, inside the repo root."""
    cmd = [sys.executable, "-m", "modal", *args]
    print("$ modal " + " ".join(args), flush=True)
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        sys.exit(result.returncode)


def secret_exists() -> bool:
    """True/False for the API-key secret; logs in first if there is no Modal token."""
    for attempt in range(2):
        try:
            modal.Secret.from_name(SECRET_NAME).hydrate()
            return True
        except NotFoundError:
            return False
        except AuthError:
            if attempt:
                raise
            print("No Modal credentials found -- starting `modal setup` (opens your browser).")
            modal_cli("setup")
    return False


def create_secret(overwrite: bool) -> None:
    key = secrets.token_urlsafe(32)
    args = ["secret", "create", SECRET_NAME, f"{SECRET_KEY}={key}"]
    modal_cli(*(args + ["--force"] if overwrite else args))
    print("\n" + "=" * 64)
    print(" API key (shown once -- save it now):")
    print(f"   {key}")
    print(" Send it with every request as the header  x-api-key: <key>")
    print("=" * 64 + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--test", action="store_true", help="`modal run` on examples/patients.csv before deploying")
    mode.add_argument("--serve", action="store_true", help="`modal serve` (temporary dev URL) instead of deploying")
    ap.add_argument("--rotate-key", action="store_true", help="replace the API key (old key stops working)")
    a = ap.parse_args()

    if not (ROOT / APP_FILE).exists():
        sys.exit(f"{APP_FILE} not found in {ROOT}")
    for f in ("models/smartheart_ensemble.pth", "models/smartheart_student.pth"):
        if not (ROOT / f).exists():
            sys.exit(f"Missing {f} -- the API serves both model bundles.")

    if a.rotate_key or not secret_exists():
        create_secret(overwrite=a.rotate_key)

    if a.serve:
        modal_cli("serve", APP_FILE)
        return
    if a.test:
        modal_cli("run", APP_FILE)
    modal_cli("deploy", APP_FILE)
    print("\nDone. Open <url>/docs for the interactive API; fill in the x-api-key field on each request.")


if __name__ == "__main__":
    main()
