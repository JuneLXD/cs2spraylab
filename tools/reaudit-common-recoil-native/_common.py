"""Path handling shared by bounded native recoil proof stages."""
import argparse
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEFAULT_ROOT = REPO.parent.parent if REPO.parent.name == 'native-audit' else REPO.parent


def arguments(description):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT,
                        help='Workspace containing cs2-game and native-audit')
    parser.add_argument('--output', type=Path, required=True,
                        help='New local run directory; the runner refuses to overwrite it')
    args = parser.parse_args()
    args.root, args.output = args.root.resolve(), args.output.resolve()
    return args
