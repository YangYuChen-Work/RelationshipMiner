from pathlib import Path
import tomllib


def test_mysql_sha2_auth_dependency_is_declared():
    pyproject = Path(__file__).parents[2] / "pyproject.toml"
    dependencies = tomllib.loads(pyproject.read_text(encoding="utf-8"))[
        "project"
    ]["dependencies"]

    assert any(
        dependency.lower().startswith("cryptography")
        for dependency in dependencies
    )
