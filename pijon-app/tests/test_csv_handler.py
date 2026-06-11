import csv
import pytest
import tempfile
import os
from src.io.csv_handler import StudentImporter, StudentExporter, FULL_FORMAT_HEADER, fixture_id
from src.models.preference import PreferenceTargetType


def write_csv(rows, tmp_path, filename="students.csv"):
    filepath = tmp_path / filename
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        for row in rows:
            writer.writerow(row)
    return str(filepath)


# ── Simple format ─────────────────────────────────────────────────────────────

class TestSimpleImport:
    def test_plain_names(self, tmp_path):
        p = write_csv([["Alice"], ["Bob"], ["Carol"]], tmp_path)
        students = StudentImporter().import_from_csv(p)
        assert [s.name for s in students] == ["Alice", "Bob", "Carol"]

    def test_header_skipped(self, tmp_path):
        p = write_csv([["name"], ["Alice"], ["Bob"]], tmp_path)
        students = StudentImporter().import_from_csv(p)
        names = [s.name for s in students]
        assert "name" not in names
        assert "Alice" in names

    def test_empty_rows_skipped(self, tmp_path):
        p = write_csv([["Alice"], [""], ["Bob"]], tmp_path)
        students = StudentImporter().import_from_csv(p)
        assert len(students) == 2

    def test_unique_ids_per_session(self, tmp_path):
        p = write_csv([["Alice"], ["Bob"]], tmp_path)
        imp = StudentImporter()
        students = imp.import_from_csv(p)
        assert students[0].id != students[1].id

    def test_ids_differ_across_importers(self, tmp_path):
        p = write_csv([["Alice"]], tmp_path)
        s1 = StudentImporter().import_from_csv(p)[0]
        s2 = StudentImporter().import_from_csv(p)[0]
        # Different salt → different IDs
        assert s1.id != s2.id

    def test_empty_file(self, tmp_path):
        p = write_csv([], tmp_path)
        students = StudentImporter().import_from_csv(p)
        assert students == []


# ── Full format ───────────────────────────────────────────────────────────────

def full_rows(*rows):
    return [FULL_FORMAT_HEADER] + list(rows)


class TestFullImport:
    def test_detected_as_full(self, tmp_path):
        p = write_csv(full_rows(["Alice", "false", "", "", ""]), tmp_path)
        students = StudentImporter().import_from_csv(p)
        assert any(s.name == "Alice" for s in students)

    def test_fixture_flag(self, tmp_path):
        rows = full_rows(
            ["Alice", "false", "", "", ""],
            ["Teacher Desk", "true", "", "", ""],
        )
        p = write_csv(rows, tmp_path)
        students = StudentImporter().import_from_csv(p)
        fixtures = [s for s in students if s.metadata.get("is_fixture")]
        regular = [s for s in students if not s.metadata.get("is_fixture")]
        assert len(fixtures) == 1
        assert fixtures[0].name == "Teacher Desk"
        assert len(regular) == 1

    def test_fixture_id_matches_seat_graph(self, tmp_path):
        rows = full_rows(["Teacher Desk", "true", "", "", ""])
        p = write_csv(rows, tmp_path)
        students = StudentImporter().import_from_csv(p)
        fix = next(s for s in students if s.metadata.get("is_fixture"))
        assert fix.id == fixture_id("Teacher Desk")

    def test_preference_resolved_to_student_id(self, tmp_path):
        rows = full_rows(
            ["Alice", "false", "Bob", "student", "-1.0"],
            ["Bob", "false", "", "", ""],
        )
        p = write_csv(rows, tmp_path)
        students = StudentImporter().import_from_csv(p)
        alice = next(s for s in students if s.name == "Alice")
        bob = next(s for s in students if s.name == "Bob")
        assert len(alice.preferences) == 1
        assert alice.preferences[0].target_id == bob.id
        assert alice.preferences[0].weight == -1.0
        assert alice.preferences[0].target_type == PreferenceTargetType.STUDENT

    def test_malformed_weight_row_skipped(self, tmp_path):
        rows = full_rows(
            ["Alice", "false", "Bob", "student", "not_a_number"],
            ["Bob", "false", "", "", ""],
        )
        p = write_csv(rows, tmp_path)
        students = StudentImporter().import_from_csv(p)
        alice = next(s for s in students if s.name == "Alice")
        assert alice.preferences == []

    def test_unknown_preference_type_skipped(self, tmp_path):
        rows = full_rows(
            ["Alice", "false", "Bob", "invalid_type", "-1.0"],
            ["Bob", "false", "", "", ""],
        )
        p = write_csv(rows, tmp_path)
        students = StudentImporter().import_from_csv(p)
        alice = next(s for s in students if s.name == "Alice")
        assert alice.preferences == []

    def test_duplicate_name_only_one_student(self, tmp_path):
        rows = full_rows(
            ["Alice", "false", "", "", ""],
            ["Alice", "false", "", "", ""],
        )
        p = write_csv(rows, tmp_path)
        students = StudentImporter().import_from_csv(p)
        assert len([s for s in students if s.name == "Alice"]) == 1


# ── Export / import round-trip ────────────────────────────────────────────────

class TestRoundTrip:
    def test_export_then_import_preserves_names(self, tmp_path):
        from src.models.student import Student
        students = [
            Student(id="a1", name="Alice"),
            Student(id="b1", name="Bob"),
        ]
        p = str(tmp_path / "out.csv")
        StudentExporter().export_to_csv(students, p)

        imported = StudentImporter().import_from_csv(p)
        assert sorted(s.name for s in imported) == ["Alice", "Bob"]

    def test_export_then_import_preserves_preferences(self, tmp_path):
        from src.models.student import Student
        from src.models.preference import Preference, PreferenceTargetType
        alice = Student(id="a1", name="Alice")
        bob = Student(id="b1", name="Bob")
        alice.add_preference(Preference(PreferenceTargetType.STUDENT, "b1", -2.0))

        p = str(tmp_path / "out.csv")
        id_to_name = {"a1": "Alice", "b1": "Bob"}
        StudentExporter().export_to_csv([alice, bob], p, id_to_name)

        imported = StudentImporter().import_from_csv(p)
        alice2 = next(s for s in imported if s.name == "Alice")
        bob2 = next(s for s in imported if s.name == "Bob")

        assert len(alice2.preferences) == 1
        assert alice2.preferences[0].target_id == bob2.id
        assert alice2.preferences[0].weight == -2.0

    def test_fixture_round_trip(self, tmp_path):
        from src.models.student import Student
        fixture = Student(id=fixture_id("Teacher Desk"), name="Teacher Desk",
                          metadata={"is_fixture": True})
        regular = Student(id="r1", name="Alice")

        p = str(tmp_path / "out.csv")
        StudentExporter().export_to_csv([regular, fixture], p)

        imported = StudentImporter().import_from_csv(p)
        fixtures = [s for s in imported if s.metadata.get("is_fixture")]
        assert len(fixtures) == 1
        assert fixtures[0].id == fixture_id("Teacher Desk")
