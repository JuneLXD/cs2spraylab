import runpy
from pathlib import Path
helper = runpy.run_path(str(Path(__file__).resolve().parent / "reaudit-sway-clock-inputs.py"))["read_sway_fields"]
def read_sway_fields(read, base, player, node):
    return {"swayInputs": helper(read, base, player)}
