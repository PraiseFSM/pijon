import json
from pathlib import Path
from typing import Dict, List, Set, Tuple

from src.models.student import Student


DEFAULT_DIR = Path("data/arrangements")


class ArrangementIO:

    @staticmethod
    def save(
        classroom_name: str,
        assignments: Dict[str, Student],
        fixture_seats: Set[str],
        directory: Path = DEFAULT_DIR,
    ) -> Path:
        directory.mkdir(parents=True, exist_ok=True)
        filepath = directory / f"{classroom_name}.json"

        with open(filepath, 'w') as f:
            json.dump({
                "classroom": classroom_name,
                # Fixtures are derived from the classroom on load — don't persist them
                "assignments": {
                    fid: student.name
                    for fid, student in assignments.items()
                    if fid not in fixture_seats
                },
            }, f, indent=2)

        return filepath

    @staticmethod
    def load(
        filepath: Path,
        students: List[Student],
    ) -> Tuple[Dict[str, Student], str]:
        """
        Returns (assignments, classroom_name).
        Furniture IDs that no longer exist in the loaded classroom are silently skipped.
        """
        with open(filepath, 'r') as f:
            data = json.load(f)

        name_to_student = {s.name: s for s in students}
        assignments = {
            fid: name_to_student[name]
            for fid, name in data["assignments"].items()
            if name in name_to_student
        }

        return assignments, data.get("classroom", "")

    @staticmethod
    def list_saved(directory: Path = DEFAULT_DIR) -> List[str]:
        if not directory.exists():
            return []
        return [f.stem for f in directory.glob("*.json")]
