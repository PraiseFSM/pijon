import csv
import hashlib
import secrets
from typing import Dict, List, Optional

from src.models.student import Student
from src.models.preference import Preference, PreferenceTargetType


FULL_FORMAT_HEADER = ['name', 'fixture', 'pref_target', 'pref_type', 'pref_weight']


def fixture_id(name: str) -> str:
    """Deterministic, salt-free ID for fixtures — stable across import sessions."""
    return hashlib.sha256(f"FIXTURE:{name}".encode()).hexdigest()[:12]


class StudentImporter:
    def __init__(self):
        self.salt = secrets.token_hex(16)
        self.warnings: List[str] = []  # populated during import; check after import_from_csv()

    def _name_to_id(self, name: str) -> str:
        return hashlib.sha256(f"{name}{self.salt}".encode()).hexdigest()[:12]

    def _detect_format(self, file_path: str) -> str:
        with open(file_path, 'r', encoding='utf-8') as f:
            first_row = next(csv.reader(f), None)
        if not first_row:
            return 'simple'
        if [c.strip().lower() for c in first_row] == FULL_FORMAT_HEADER:
            return 'full'
        return 'simple'

    def import_from_csv(self, file_path: str) -> List[Student]:
        """
        Auto-detect format and import students.
        - 1-column (or plain name list): simple format, names only
        - Header matches FULL_FORMAT_HEADER: full format with preferences and fixtures

        After calling this, check self.warnings for any non-fatal issues found during import.
        """
        self.warnings = []
        if self._detect_format(file_path) == 'full':
            return self._import_full(file_path)
        students = self.create_student_list(self.parse_csv(file_path))
        if not students:
            self.warnings.append("No students found in the file.")
        return students

    def parse_csv(self, file_path: str) -> List[str]:
        """Simple format: extract student names from first column."""
        names = []
        with open(file_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)
            first_row = next(reader, None)
            if first_row:
                if first_row[0].lower() not in ['name', 'student', 'student name', 'students', 'names']:
                    names.append(first_row[0].strip())
            for row in reader:
                if row and row[0].strip():
                    names.append(row[0].strip())
        return names

    def create_student_list(self, names: List[str]) -> List[Student]:
        return [
            Student(id=self._name_to_id(name), name=name, metadata={})
            for name in names
        ]

    def _import_full(self, file_path: str) -> List[Student]:
        rows = []
        with open(file_path, 'r', encoding='utf-8') as f:
            for row in csv.DictReader(f):
                rows.append(row)

        # Pass 1: build all students (regular + fixture), preserving order
        name_to_student: Dict[str, Student] = {}
        for row in rows:
            name = row['name'].strip()
            if not name or name in name_to_student:
                continue
            is_fix = row.get('fixture', '').strip().lower() == 'true'
            sid = fixture_id(name) if is_fix else self._name_to_id(name)
            name_to_student[name] = Student(
                id=sid,
                name=name,
                metadata={'is_fixture': is_fix}
            )

        # Pass 2: build preferences (resolve target names to IDs)
        for row in rows:
            name = row['name'].strip()
            pref_target = row.get('pref_target', '').strip()
            pref_type_str = row.get('pref_type', '').strip()
            pref_weight_str = row.get('pref_weight', '').strip()

            if not pref_target or not pref_type_str or not pref_weight_str:
                continue

            student = name_to_student.get(name)
            if not student:
                continue

            try:
                weight = float(pref_weight_str)
            except ValueError:
                self.warnings.append(
                    f"Row for '{name}': invalid weight '{pref_weight_str}' — skipped."
                )
                continue
            try:
                target_type = PreferenceTargetType(pref_type_str)
            except ValueError:
                self.warnings.append(
                    f"Row for '{name}': unknown preference type '{pref_type_str}' — skipped."
                )
                continue

            target = name_to_student.get(pref_target)
            target_id_val = target.id if target else pref_target  # fallback: store name as-is

            student.add_preference(Preference(
                target_type=target_type,
                target_id=target_id_val,
                weight=weight,
            ))

        return list(name_to_student.values())


class StudentExporter:

    def export_to_csv(
        self,
        students: List[Student],
        file_path: str,
        id_to_name: Optional[Dict[str, str]] = None,
    ):
        """
        Export students (and fixtures) to full-format CSV.
        id_to_name maps preference target_ids to display names so preferences
        are portable across import sessions.
        """
        if id_to_name is None:
            id_to_name = {s.id: s.name for s in students}

        with open(file_path, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=FULL_FORMAT_HEADER)
            writer.writeheader()

            for student in students:
                is_fix = student.metadata.get('is_fixture', False)
                base = {
                    'name': student.name,
                    'fixture': 'true' if is_fix else 'false',
                }

                if student.preferences:
                    for pref in student.preferences:
                        writer.writerow({
                            **base,
                            'pref_target': id_to_name.get(pref.target_id, pref.target_id),
                            'pref_type': pref.target_type.value,
                            'pref_weight': pref.weight,
                        })
                else:
                    writer.writerow({**base, 'pref_target': '', 'pref_type': '', 'pref_weight': ''})
