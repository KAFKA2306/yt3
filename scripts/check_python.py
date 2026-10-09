import subprocess

PYTHON_FILES = (
    "scripts/check_python.py",
    "hooks",
    "sbg-nav-audit/scripts",
    "src/scripts/voice_forensic_audit.py",
)


def run(*args: str) -> None:
    subprocess.run(args, check=True)


if __name__ == "__main__":
    run("ruff", "check", *PYTHON_FILES)
    run("ruff", "format", "--check", *PYTHON_FILES)
    run("pyrefly", "check")
