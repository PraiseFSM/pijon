"""
Session bundle I/O — reads and writes .pijon files.

A .pijon file is a ZIP archive containing:
  classrooms/   *.json  — one file per classroom
  arrangements/ *.json  — one file per arrangement (may be empty)
  students.csv          — full-format student list with preferences
"""
import json
import tempfile
import zipfile
from pathlib import Path
from typing import Dict, List

from src.models.classroom import Classroom
from src.models.student import Student
from src.io.arrangement_io import ArrangementIO
from src.io.csv_handler import StudentImporter, StudentExporter


class SessionBundle:
    """In-memory representation of a loaded .pijon bundle."""

    def __init__(
        self,
        classrooms: List[Classroom],
        arrangements: Dict[str, Dict[str, str]],
        students: List[Student],
    ):
        self.classrooms   = classrooms
        # classroom_name → {furniture_id: student_name}
        self.arrangements = arrangements
        self.students     = students


class SessionIO:

    @staticmethod
    def save(
        filepath: str | Path,
        classrooms: List[Classroom],
        students: List[Student],
        arrangement_dir: Path = Path("data/arrangements"),
    ) -> None:
        """
        Bundle classrooms, all saved arrangements, and students into *filepath*.

        Arrangements are read from *arrangement_dir*; any .json whose stem
        matches a classroom name is included.
        """
        filepath = Path(filepath)
        filepath.parent.mkdir(parents=True, exist_ok=True)

        id_to_name = {s.id: s.name for s in students}

        with tempfile.NamedTemporaryFile(
            suffix=".csv", delete=False, mode="w", encoding="utf-8"
        ) as tmp:
            tmp_csv = tmp.name

        try:
            StudentExporter().export_to_csv(students, tmp_csv, id_to_name)

            with zipfile.ZipFile(filepath, "w", compression=zipfile.ZIP_DEFLATED) as zf:
                for classroom in classrooms:
                    data = json.dumps(classroom.to_dict(), indent=2)
                    zf.writestr(f"classrooms/{classroom.name}.json", data)

                    arr_path = arrangement_dir / f"{classroom.name}.json"
                    if arr_path.exists():
                        zf.write(arr_path, f"arrangements/{classroom.name}.json")

                zf.write(tmp_csv, "students.csv")
        finally:
            Path(tmp_csv).unlink(missing_ok=True)

    @staticmethod
    def load(filepath: str | Path) -> SessionBundle:
        """
        Read a .pijon bundle and return a SessionBundle.

        Students are returned with a new salt (new IDs) so they can be used
        in a fresh session without colliding with IDs from the current session.
        """
        filepath = Path(filepath)

        with zipfile.ZipFile(filepath, "r") as zf:
            names = zf.namelist()

            classrooms: List[Classroom] = []
            for name in names:
                if name.startswith("classrooms/") and name.endswith(".json"):
                    data = json.loads(zf.read(name).decode("utf-8"))
                    classrooms.append(Classroom.from_dict(data))

            arrangements: Dict[str, Dict[str, str]] = {}
            for name in names:
                if name.startswith("arrangements/") and name.endswith(".json"):
                    data = json.loads(zf.read(name).decode("utf-8"))
                    classroom_name = data.get("classroom", Path(name).stem)
                    arrangements[classroom_name] = data.get("assignments", {})

            students: List[Student] = []
            if "students.csv" in names:
                with tempfile.NamedTemporaryFile(
                    suffix=".csv", delete=False, mode="wb"
                ) as tmp:
                    tmp.write(zf.read("students.csv"))
                    tmp_csv = tmp.name
                try:
                    students = StudentImporter().import_from_csv(tmp_csv)
                finally:
                    Path(tmp_csv).unlink(missing_ok=True)

        return SessionBundle(classrooms, arrangements, students)
